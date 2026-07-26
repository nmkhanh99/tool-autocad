/**
 * AutoCAD resource library.
 *
 * Catalogs source/compiled AutoLISP resources without evaluating them, keeps
 * user-reviewed metadata outside protected Autodesk folders, and loads only an
 * opaque catalog id into an exact open document through AcadBridge.
 */
import {
  createHash,
  createPublicKey,
  randomUUID,
  verify as verifySignature,
} from "node:crypto";
import {
  accessSync,
  chmodSync,
  closeSync,
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from "node:path";
import express, { type Router } from "express";
import {
  acadRunning as defaultAcadRunning,
  dispatchLiveJob as defaultDispatchLiveJob,
  listOpenDocs as defaultListOpenDocs,
} from "./acadBridge.js";
import {
  atomicWriteFile,
  ensureBridgeLayout,
  resolveBridgeDir,
} from "./bridgeContract.js";

const RESOURCE_EXTENSIONS = new Set([".lsp", ".mnl", ".dcl", ".scr", ".fas", ".vlx"]);
const SOURCE_EXTENSIONS = new Set([".lsp", ".mnl", ".dcl", ".scr"]);
const LOAD_EXTENSIONS = new Set([".lsp", ".mnl", ".fas", ".vlx"]);
const IGNORED_DIRS = new Set([
  ".git",
  ".next",
  ".turbo",
  "node_modules",
  "dist",
  "build",
  "out",
  "__pycache__",
]);
const MAX_SCAN_DEPTH = 32;
const MAX_RESOURCES = 5000;
const MAX_SOURCE_BYTES = 4 * 1024 * 1024;
const MAX_MANIFEST_BYTES = 512 * 1024;
const ROOTS_FILE = "lisp-library.roots.json";
const OVERRIDES_FILE = "lisp-library.overrides.json";
const MANIFEST_FILE = "library.manifest.json";

type JsonObject = Record<string, any>;

export type LispReviewStatus = "approved" | "stale" | "unreviewed";

export type LispRoot = {
  id: string;
  label: string;
  pathLabel: string;
  builtIn: boolean;
  writable: boolean;
  exists: boolean;
};

type InternalRoot = LispRoot & {
  absolutePath: string;
  kind: "project" | "bundled" | "autodesk-install" | "autodesk-user" | "custom";
};

export type LispInference = {
  commands: string[];
  functions: string[];
  dependencies: string[];
  dialogs: string[];
  cadCommands: string[];
  systemVariables: string[];
  apiCalls: string[];
  fileReferences: string[];
};

export type LispResourceSummary = {
  id: string;
  name: string;
  extension: string;
  kind: string;
  pathLabel: string;
  rootId: string;
  sizeBytes: number;
  modifiedAt: string;
  sourceHash: string;
  readable: boolean;
  loadable: boolean;
  loadBlockReason: string | null;
  commands: string[];
  functions: string[];
  dependencies: string[];
  reviewStatus: LispReviewStatus;
  manifest: JsonObject | null;
  warnings: string[];
};

type InternalResource = LispResourceSummary & {
  absolutePath: string;
  relativePath: string;
  projectPath: string | null;
  root: InternalRoot;
  source: string | null;
  sourceEncoding: "utf8" | "utf16le" | "utf16be" | "latin1" | null;
  inferred: LispInference;
  baseManifest: JsonObject | null;
  override: ManifestOverride | null;
};

type RootRegistry = {
  schemaVersion: 1;
  roots: Array<{ path: string; label?: string }>;
};

type ManifestOverride = {
  manifest: JsonObject;
  approved: boolean;
  approvedSourceHash: string | null;
  approvedEffectiveHash?: string | null;
  updatedAt: string;
};

type OverrideRegistry = {
  schemaVersion: 1;
  resources: Record<string, ManifestOverride>;
};

type RuntimeDependency = {
  reference: string;
  optional: boolean;
  shouldLoad: boolean;
  resource: InternalResource | null;
  ownerId?: string;
  warning?: string;
};

type RuntimeDependencySummary = {
  ownerId: string | null;
  reference: string;
  optional: boolean;
  preload: boolean;
  resolved: boolean;
  resourceId: string | null;
  name: string | null;
  pathLabel: string | null;
  extension: string | null;
  reviewStatus: LispReviewStatus | null;
};

type LibraryOptions = {
  projectRoot?: string;
  dataDir?: string;
  bridgeDir?: string;
  platform?: NodeJS.Platform;
  includeAutodeskRoots?: boolean;
};

type RouterDeps = LibraryOptions & {
  acadRunning?: () => Promise<boolean>;
  listOpenDocs?: (
    timeoutMs?: number,
  ) => Promise<{ alive: boolean; docs: { title: string; file: string; active: boolean }[] }>;
  dispatchLiveJob?: (
    lisp: string,
    target: string | undefined,
    wait: number,
  ) => Promise<{
    jobId: string;
    state: string;
    result: { status: string; message: string } | null;
  }>;
};

function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

type UserReviewProof = {
  resourceId: string;
  baseRevision: string;
  proposalHash: string;
  analysisCoverage: string;
  acknowledgedIncomplete: boolean;
  issuedAt: number;
  nonce: string;
  signature: string;
};

function reviewProofText(proof: Omit<UserReviewProof, "signature">): string {
  return [
    "acad-review-v1",
    proof.resourceId,
    proof.baseRevision,
    proof.proposalHash,
    proof.analysisCoverage,
    proof.acknowledgedIncomplete ? "1" : "0",
    String(proof.issuedAt),
    proof.nonce,
  ].join("\n");
}

function validUserReviewProof(
  raw: unknown,
  expected: {
    resourceId: string;
    baseRevision: string;
    proposalHash: string;
    analysisCoverage: string;
    acknowledgedIncomplete: boolean;
  },
): raw is UserReviewProof {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return false;
  const proof = raw as UserReviewProof;
  if (
    proof.resourceId !== expected.resourceId ||
    proof.baseRevision !== expected.baseRevision ||
    proof.proposalHash !== expected.proposalHash ||
    proof.analysisCoverage !== expected.analysisCoverage ||
    proof.acknowledgedIncomplete !== expected.acknowledgedIncomplete ||
    !Number.isFinite(proof.issuedAt) ||
    Math.abs(Date.now() - proof.issuedAt) > 2 * 60_000 ||
    !/^[0-9a-f-]{36}$/i.test(proof.nonce) ||
    typeof proof.signature !== "string"
  ) {
    return false;
  }
  const encodedKey = process.env.ACAD_REVIEW_PUBLIC_KEY;
  if (!encodedKey) return false;
  try {
    const key = createPublicKey({
      key: Buffer.from(encodedKey, "base64"),
      type: "spki",
      format: "der",
    });
    return verifySignature(
      null,
      Buffer.from(reviewProofText(proof)),
      key,
      Buffer.from(proof.signature, "base64"),
    );
  } catch {
    return false;
  }
}

function hashFile(path: string): string {
  const fd = openSync(path, "r");
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(64 * 1024);
  try {
    for (;;) {
      const count = readSync(fd, chunk, 0, chunk.length, null);
      if (!count) break;
      hash.update(chunk.subarray(0, count));
    }
  } finally {
    closeSync(fd);
  }
  return hash.digest("hex");
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
    .join(",")}}`;
}

function safeReadJson(path: string): JsonObject | null {
  try {
    const value: unknown = JSON.parse(readFileSync(path, "utf8"));
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as JsonObject)
      : null;
  } catch {
    return null;
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  atomicWriteFile(path, JSON.stringify(value, null, 2) + "\n");
}

function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel === "" || (!rel.startsWith(`..${sep}`) && rel !== ".." && !isAbsolute(rel));
}

function unixPath(path: string): string {
  return path.split(sep).join("/");
}

function displayPath(path: string): string {
  const home = homedir();
  return path === home ? "~" : path.startsWith(home + sep) ? `~/${unixPath(relative(home, path))}` : path;
}

function canWrite(path: string): boolean {
  try {
    accessSync(path, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

function readCatalogFile(
  path: string,
  captureSource: boolean,
): {
  sourceHash: string;
  sizeBytes: number;
  source: string | null;
  encoding: "utf8" | "utf16le" | "utf16be" | "latin1" | null;
  warning?: string;
} {
  const fd = openSync(path, "r");
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(64 * 1024);
  const sourceChunks: Buffer[] = [];
  let sizeBytes = 0;
  let sourceTooLarge = false;
  try {
    for (;;) {
      const count = readSync(fd, chunk, 0, chunk.length, null);
      if (!count) break;
      const bytes = Buffer.from(chunk.subarray(0, count));
      hash.update(bytes);
      sizeBytes += count;
      if (captureSource && !sourceTooLarge) {
        if (sizeBytes <= MAX_SOURCE_BYTES) sourceChunks.push(bytes);
        else {
          sourceChunks.length = 0;
          sourceTooLarge = true;
        }
      }
    }
  } finally {
    closeSync(fd);
  }
  const sourceHash = hash.digest("hex");
  if (!captureSource) {
    return { sourceHash, sizeBytes, source: null, encoding: null };
  }
  if (sourceTooLarge) {
    return {
      sourceHash,
      sizeBytes,
      source: null,
      encoding: null,
      warning: "source_too_large",
    };
  }
  const bytes = Buffer.concat(sourceChunks);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return {
      sourceHash,
      sizeBytes,
      source: bytes.subarray(2).toString("utf16le"),
      encoding: "utf16le",
    };
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    const payload = Buffer.from(bytes.subarray(2));
    for (let index = 0; index + 1 < payload.length; index += 2) {
      const first = payload[index];
      payload[index] = payload[index + 1];
      payload[index + 1] = first;
    }
    return {
      sourceHash,
      sizeBytes,
      source: payload.toString("utf16le"),
      encoding: "utf16be",
    };
  }
  try {
    return {
      sourceHash,
      sizeBytes,
      source: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      encoding: "utf8",
    };
  } catch {
    return {
      sourceHash,
      sizeBytes,
      source: bytes.toString("latin1"),
      encoding: "latin1",
    };
  }
}

/** Remove AutoLISP line/block comments while preserving quoted strings. */
export function stripLispComments(source: string): string {
  let output = "";
  let quoted = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (char === "\n") {
        lineComment = false;
        output += "\n";
      } else {
        output += " ";
      }
      continue;
    }
    if (blockComment) {
      if (char === "|" && next === ";") {
        blockComment = false;
        output += "  ";
        index++;
      } else {
        output += char === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (!quoted && char === ";" && next === "|") {
      blockComment = true;
      output += "  ";
      index++;
      continue;
    }
    if (!quoted && char === ";") {
      lineComment = true;
      output += " ";
      continue;
    }
    output += char;
    if (quoted) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
    }
  }
  return output;
}

function decodeLispString(value: string): string {
  return value.replace(/\\"/g, '"').replace(/\\\\/g, "\\");
}

export function inferLispSource(source: string): LispInference {
  const text = stripLispComments(source);
  const commands = new Set<string>();
  const functions = new Set<string>();
  const dependencies = new Set<string>();
  const dialogs = new Set<string>();
  const cadCommands = new Set<string>();
  const systemVariables = new Set<string>();
  const apiCalls = new Set<string>();
  const fileReferences = new Set<string>();
  let match: RegExpExecArray | null;

  const defun = /\(\s*defun\s+([^\s()]+)/gi;
  while ((match = defun.exec(text))) {
    const name = match[1];
    functions.add(name);
    if (/^c:/i.test(name)) commands.add(name.slice(2).toUpperCase());
  }

  const load = /\(\s*(load|load_dialog)\s+"((?:\\.|[^"\\])*)"/gi;
  while ((match = load.exec(text))) {
    dependencies.add(decodeLispString(match[2]));
  }

  const dialog = /\(\s*new_dialog\s+"((?:\\.|[^"\\])*)"/gi;
  while ((match = dialog.exec(text))) dialogs.add(decodeLispString(match[1]));

  const cadCommand = /\(\s*command(?:-s)?\s+"((?:\\.|[^"\\])*)"/gi;
  while ((match = cadCommand.exec(text))) {
    cadCommands.add(decodeLispString(match[1]).replace(/^[_.-]+/, "").toUpperCase());
  }

  const sysvar = /\(\s*(?:getvar|setvar)\s+"((?:\\.|[^"\\])*)"/gi;
  while ((match = sysvar.exec(text))) {
    systemVariables.add(decodeLispString(match[1]).toUpperCase());
  }

  const apiCall = /\(\s*((?:vl|vla|vlax|acet)-[^\s()]+)/gi;
  while ((match = apiCall.exec(text))) apiCalls.add(match[1]);

  const fileCall =
    /\(\s*(?:open|findfile|findtrustedfile|load|load_dialog|startapp)\s+"((?:\\.|[^"\\])*)"/gi;
  while ((match = fileCall.exec(text))) fileReferences.add(decodeLispString(match[1]));

  return {
    commands: [...commands].sort(),
    functions: [...functions].sort((a, b) => a.localeCompare(b)),
    dependencies: [...dependencies].sort(),
    dialogs: [...dialogs].sort(),
    cadCommands: [...cadCommands].filter(Boolean).sort(),
    systemVariables: [...systemVariables].sort(),
    apiCalls: [...apiCalls].sort((a, b) => a.localeCompare(b)),
    fileReferences: [...fileReferences].sort(),
  };
}

function extensionSemantics(extension: string, platform: NodeJS.Platform): {
  kind: string;
  readable: boolean;
  loadable: boolean;
  reason: string | null;
} {
  switch (extension) {
    case ".lsp":
      return { kind: "autolisp-source", readable: true, loadable: true, reason: null };
    case ".mnl":
      return { kind: "menu-lisp", readable: true, loadable: true, reason: null };
    case ".fas":
      return { kind: "compiled-autolisp", readable: false, loadable: true, reason: null };
    case ".vlx":
      return platform === "win32"
        ? { kind: "visual-lisp-application", readable: false, loadable: true, reason: null }
        : {
            kind: "visual-lisp-application",
            readable: false,
            loadable: false,
            reason: "vlx_windows_only",
          };
    case ".dcl":
      return {
        kind: "dialog-resource",
        readable: true,
        loadable: false,
        reason: "dcl_requires_load_dialog",
      };
    case ".scr":
      return {
        kind: "command-script",
        readable: true,
        loadable: false,
        reason: "scr_catalog_only",
      };
    default:
      return { kind: "unknown", readable: false, loadable: false, reason: "unsupported" };
  }
}

function sanitizeManifest(value: unknown, depth = 0): any {
  if (depth > 10) throw new Error("manifest_too_deep");
  if (value === null || typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    if (value.length > 50_000) throw new Error("manifest_string_too_long");
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > 500) throw new Error("manifest_array_too_long");
    return value.map((entry) => sanitizeManifest(entry, depth + 1));
  }
  if (!value || typeof value !== "object") throw new Error("manifest_invalid_value");
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length > 300) throw new Error("manifest_object_too_large");
  const output: JsonObject = {};
  for (const [key, entry] of entries) {
    if (key === "__proto__" || key === "prototype" || key === "constructor") {
      throw new Error("manifest_invalid_key");
    }
    if (key.length > 200) throw new Error("manifest_key_too_long");
    output[key] = sanitizeManifest(entry, depth + 1);
  }
  return output;
}

export function validateApprovedManifest(manifest: JsonObject): void {
  const ai =
    manifest.ai && typeof manifest.ai === "object" && !Array.isArray(manifest.ai)
      ? manifest.ai
      : {};
  const summary = [
    manifest.purpose,
    manifest.summary,
    manifest.description,
    ai.summary,
  ].find((value) => typeof value === "string" && value.trim());
  if (!summary) throw new Error("manifest_summary_required");

  for (const key of [
    "commands",
    "publicFunctions",
    "dependencies",
    "guardrails",
    "examples",
  ]) {
    const value = manifest[key];
    if (value !== undefined && !Array.isArray(value)) {
      throw new Error(`manifest_${key}_must_be_array`);
    }
  }
  for (const key of ["commands", "publicFunctions"]) {
    for (const entry of manifest[key] ?? []) {
      if (
        typeof entry !== "string" &&
        !(
          entry &&
          typeof entry === "object" &&
          !Array.isArray(entry) &&
          typeof entry.name === "string" &&
          entry.name.trim()
        )
      ) {
        throw new Error(`manifest_${key}_entry_invalid`);
      }
    }
  }
  const validateDependencyEntries = (value: unknown, field: string): void => {
    if (value === undefined) return;
    if (!Array.isArray(value)) throw new Error(`manifest_${field}_must_be_array`);
    const allowedKinds = new Set([
      "runtime",
      "runtime-file",
      "file",
      "lisp",
      "dcl",
      "inferred",
      "autocad-resource",
      "environment-variable",
      "generated-resource",
    ]);
    for (const entry of value) {
      if (typeof entry === "string") {
        if (!safeDependencyReference(entry)) {
          throw new Error(`manifest_${field}_entry_invalid`);
        }
        continue;
      }
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new Error(`manifest_${field}_entry_invalid`);
      }
      const kind = String(entry.kind ?? "runtime").toLowerCase();
      const reference = String(entry.path ?? entry.id ?? "").trim();
      if (!allowedKinds.has(kind) || !safeDependencyReference(reference)) {
        throw new Error(`manifest_${field}_entry_invalid`);
      }
      if (entry.optional !== undefined && typeof entry.optional !== "boolean") {
        throw new Error(`manifest_${field}_optional_invalid`);
      }
      if (entry.preload !== undefined && typeof entry.preload !== "boolean") {
        throw new Error(`manifest_${field}_preload_invalid`);
      }
      if (
        entry.preload === true &&
        (["dcl", "autocad-resource", "environment-variable", "generated-resource"].includes(kind) ||
          kind === "runtime-file" ||
          (extname(reference) && !LOAD_EXTENSIONS.has(extname(reference).toLowerCase())))
      ) {
        throw new Error(`manifest_${field}_preload_invalid`);
      }
    }
  };
  validateDependencyEntries(manifest.dependencies, "dependencies");
  validateDependencyEntries(manifest.runtimeFiles, "runtimeFiles");
  if (
    manifest.runtime !== undefined &&
    (!manifest.runtime || typeof manifest.runtime !== "object" || Array.isArray(manifest.runtime))
  ) {
    throw new Error("manifest_runtime_must_be_object");
  }
  validateDependencyEntries(manifest.runtime?.files, "runtime_files");
  if (
    manifest.effects !== undefined &&
    (!manifest.effects || typeof manifest.effects !== "object" || Array.isArray(manifest.effects))
  ) {
    throw new Error("manifest_effects_must_be_object");
  }
  if (
    manifest.effects &&
    Object.values(manifest.effects).some((value) => typeof value !== "boolean")
  ) {
    throw new Error("manifest_effects_values_must_be_boolean");
  }
}

function safeDependencyReference(value: string): boolean {
  const normalized = value.trim().replace(/\\/g, "/");
  if (!normalized || normalized.length > 1_000 || /[\0\r\n]/.test(normalized)) return false;
  if (isAbsolute(value) || normalized.startsWith("/") || /^[A-Za-z]:\//.test(normalized)) {
    return false;
  }
  return !normalized.split("/").some((segment) => segment === "..");
}

function manifestResourceMap(raw: JsonObject | null): Record<string, JsonObject> {
  if (!raw) return {};
  const source = raw.resources ?? raw.entries;
  if (source && typeof source === "object" && !Array.isArray(source)) {
    return Object.fromEntries(
      Object.entries(source).filter(
        ([, value]) => value && typeof value === "object" && !Array.isArray(value),
      ),
    ) as Record<string, JsonObject>;
  }
  if (Array.isArray(source)) {
    const out: Record<string, JsonObject> = {};
    for (const entry of source) {
      if (!entry || typeof entry !== "object") continue;
      const key = String(entry.path ?? entry.id ?? "");
      if (key) out[key] = entry;
    }
    return out;
  }
  return {};
}

function manifestCommands(manifest: JsonObject | null): string[] {
  if (!manifest || !Array.isArray(manifest.commands)) return [];
  return manifest.commands
    .map((entry: unknown) =>
      typeof entry === "string"
        ? entry
        : entry && typeof entry === "object"
          ? String((entry as JsonObject).name ?? "")
          : "",
    )
    .filter(Boolean);
}

function manifestFunctions(manifest: JsonObject | null): string[] {
  const source = manifest?.publicFunctions ?? manifest?.functions;
  if (!Array.isArray(source)) return [];
  return source
    .map((entry: unknown) =>
      typeof entry === "string"
        ? entry
        : entry && typeof entry === "object"
          ? String((entry as JsonObject).name ?? "")
          : "",
    )
    .filter(Boolean);
}

function manifestDependencies(manifest: JsonObject | null): string[] {
  if (!manifest || !Array.isArray(manifest.dependencies)) return [];
  return manifest.dependencies
    .map((entry: unknown) =>
      typeof entry === "string"
        ? entry
        : entry && typeof entry === "object"
          ? String((entry as JsonObject).path ?? (entry as JsonObject).id ?? "")
          : "",
    )
    .filter(Boolean);
}

function inferredManifestFor(input: {
  name: string;
  extension: string;
  kind: string;
  sourceReadable: boolean;
  inferred: LispInference;
}): JsonObject {
  return {
    schemaVersion: 1,
    title: input.name,
    format: input.extension.replace(/^\./, ""),
    role: input.kind,
    sourceReadable: input.sourceReadable,
    purpose: input.sourceReadable
      ? "Cấu hình khởi tạo tự động từ source; cần agent phân tích và user review."
      : "Tài nguyên biên dịch; chỉ có metadata/hash, cần user cung cấp tài liệu trước khi mô tả hành vi.",
    commands: input.inferred.commands.map((name) => ({
      name,
      purpose: "Phát hiện tự động từ định nghĩa c:<command>.",
    })),
    publicFunctions: input.inferred.functions.map((name) => ({
      name,
      purpose: "Phát hiện tự động từ defun; chưa xác nhận API public.",
    })),
    dependencies: input.inferred.dependencies.map((path) => ({
      kind: "inferred",
      path,
      optional: true,
      preload: false,
    })),
    detected: {
      dialogs: input.inferred.dialogs,
      cadCommands: input.inferred.cadCommands,
      systemVariables: input.inferred.systemVariables,
      apiCalls: input.inferred.apiCalls,
      fileReferences: input.inferred.fileReferences,
    },
    ai: {
      summary: input.sourceReadable
        ? "Metadata tự suy ra; chưa đủ để AI tự ý sử dụng."
        : "Binary không đọc được source; không suy diễn chức năng.",
      whenToUse: [],
    },
    effects: { unknown: true },
    guardrails: [
      "Chưa được user duyệt; phải phân tích/review trước khi AI chủ động sử dụng.",
      "Không coi tên hàm/lệnh tự phát hiện là bằng chứng đầy đủ về side effect.",
    ],
    examples: [],
    review: {
      status: "needs-review",
      notes: ["Manifest khởi tạo tự động, không phải attestation."],
    },
  };
}

function union(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function reviewStatus(
  override: ManifestOverride | null,
  effectiveHash: string,
): LispReviewStatus {
  // A checked-in or third-party manifest is descriptive data, not an approval
  // attestation. Only the server-owned override written after the UI action can
  // mark executable content as approved.
  if (!override) return "unreviewed";
  const approvedHash = override.approvedEffectiveHash;
  // Legacy owner-only attestations cannot approve changed/transitive
  // dependencies, so require one explicit re-review after this upgrade.
  if (override.approved && !approvedHash) return "stale";
  if (approvedHash && approvedHash !== effectiveHash) return "stale";
  if (override.approved && approvedHash === effectiveHash) return "approved";
  return "unreviewed";
}

function publicRoot(root: InternalRoot): LispRoot {
  const { id, label, pathLabel, builtIn, writable, exists } = root;
  return { id, label, pathLabel, builtIn, writable, exists };
}

function publicSummary(resource: InternalResource): LispResourceSummary {
  const {
    id,
    name,
    extension,
    kind,
    pathLabel,
    rootId,
    sizeBytes,
    modifiedAt,
    sourceHash,
    readable,
    loadable,
    loadBlockReason,
    commands,
    functions,
    dependencies,
    reviewStatus: status,
    manifest,
    warnings,
  } = resource;
  return {
    id,
    name,
    extension,
    kind,
    pathLabel,
    rootId,
    sizeBytes,
    modifiedAt,
    sourceHash,
    readable,
    loadable,
    loadBlockReason,
    commands,
    functions,
    dependencies,
    reviewStatus: status,
    manifest,
    warnings,
  };
}

export class LispLibrary {
  readonly projectRoot: string;
  readonly dataDir: string;
  readonly bridgeDir: string;
  readonly platform: NodeJS.Platform;
  readonly includeAutodeskRoots: boolean;
  private scanCache: { at: number; resources: InternalResource[]; truncated: boolean } | null = null;
  private scanTruncated = false;

  constructor(options: LibraryOptions = {}) {
    this.projectRoot = resolve(
      options.projectRoot ||
        process.env.ACAD_PROJECT_ROOT ||
        process.env.MEP_PROJECT_ROOT ||
        process.cwd(),
    );
    this.dataDir = resolve(
      options.dataDir ||
        process.env.ACAD_DATA_DIR ||
        process.env.MEP_DATA_DIR ||
        join(homedir(), "Library", "Application Support", "acad-studio"),
    );
    this.bridgeDir = resolve(options.bridgeDir || resolveBridgeDir());
    this.platform = options.platform ?? process.platform;
    this.includeAutodeskRoots = options.includeAutodeskRoots ?? true;
  }

  private rootRegistryPath(): string {
    return join(this.dataDir, ROOTS_FILE);
  }

  private overrideRegistryPath(): string {
    return join(this.dataDir, OVERRIDES_FILE);
  }

  private readRootRegistry(): RootRegistry {
    const raw = safeReadJson(this.rootRegistryPath());
    const roots = Array.isArray(raw?.roots)
      ? raw!.roots
          .filter((entry: unknown) => entry && typeof entry === "object")
          .map((entry: any) => ({
            path: String(entry.path ?? ""),
            label: entry.label ? String(entry.label) : undefined,
          }))
          .filter((entry: { path: string }) => entry.path)
      : [];
    return { schemaVersion: 1, roots };
  }

  private readOverrides(): OverrideRegistry {
    const raw = safeReadJson(this.overrideRegistryPath());
    const resources =
      raw?.resources && typeof raw.resources === "object" && !Array.isArray(raw.resources)
        ? raw.resources
        : {};
    return { schemaVersion: 1, resources };
  }

  private builtInRoot(
    id: string,
    label: string,
    absolutePath: string,
    kind: InternalRoot["kind"],
  ): InternalRoot | null {
    if (!existsSync(absolutePath)) return null;
    let real: string;
    try {
      real = realpathSync(absolutePath);
      if (!statSync(real).isDirectory()) return null;
    } catch {
      return null;
    }
    return {
      id,
      label,
      pathLabel: displayPath(real),
      absolutePath: real,
      kind,
      builtIn: true,
      writable: canWrite(real),
      exists: true,
    };
  }

  private rootsInternal(): InternalRoot[] {
    const roots: InternalRoot[] = [];
    const project = this.builtInRoot("project", "Dự án", this.projectRoot, "project");
    if (project) roots.push(project);

    const bundled = process.env.ACAD_BUNDLED_LISP_ROOT;
    if (bundled) {
      const root = this.builtInRoot(
        "bundled",
        "Thư viện đi kèm app",
        resolve(bundled),
        "bundled",
      );
      if (root) roots.push(root);
    }

    if (this.includeAutodeskRoots) {
      const install = this.builtInRoot(
        "autodesk-install",
        "AutoCAD cài đặt",
        "/Applications/Autodesk",
        "autodesk-install",
      );
      if (install) roots.push(install);
      const system = this.builtInRoot(
        "autodesk-system",
        "AutoCAD dùng chung trên máy",
        "/Library/Application Support/Autodesk",
        "autodesk-install",
      );
      if (system) roots.push(system);
      const user = this.builtInRoot(
        "autodesk-user",
        "AutoCAD người dùng",
        join(homedir(), "Library", "Application Support", "Autodesk"),
        "autodesk-user",
      );
      if (user) roots.push(user);
    }

    const known = new Set(roots.map((root) => root.absolutePath));
    for (const entry of this.readRootRegistry().roots) {
      try {
        const real = realpathSync(resolve(entry.path));
        if (known.has(real) || !statSync(real).isDirectory()) continue;
        known.add(real);
        roots.push({
          id: `custom-${sha256(real).slice(0, 16)}`,
          label: entry.label || basename(real) || "Thư mục tùy chọn",
          pathLabel: displayPath(real),
          absolutePath: real,
          kind: "custom",
          builtIn: false,
          writable: canWrite(real),
          exists: true,
        });
      } catch {
        /* Ignore deleted/unreadable registry entries. */
      }
    }
    return roots;
  }

  roots(): LispRoot[] {
    return this.rootsInternal().map(publicRoot);
  }

  addRoot(rawPath: unknown, rawLabel?: unknown): LispRoot {
    const requested = String(rawPath ?? "").trim();
    if (!requested || /[\0\r\n]/.test(requested)) throw new Error("invalid_root_path");
    let real: string;
    try {
      real = realpathSync(resolve(requested));
    } catch {
      throw new Error("root_not_found");
    }
    if (!statSync(real).isDirectory()) throw new Error("root_not_directory");
    if (real === "/" || real === homedir()) throw new Error("root_too_broad");

    const existing = this.rootsInternal().find((root) => root.absolutePath === real);
    if (existing) return publicRoot(existing);

    const registry = this.readRootRegistry();
    const label = String(rawLabel ?? "").trim().slice(0, 120) || basename(real);
    registry.roots.push({ path: real, label });
    writeJsonAtomic(this.rootRegistryPath(), registry);
    this.scanCache = null;
    const added = this.rootsInternal().find((root) => root.absolutePath === real);
    if (!added) throw new Error("root_registration_failed");
    return publicRoot(added);
  }

  private baseManifestMap(): Record<string, JsonObject> {
    const merged: Record<string, JsonObject> = {};
    const bundled = process.env.ACAD_BUNDLED_LISP_ROOT;
    if (bundled) {
      Object.assign(merged, manifestResourceMap(safeReadJson(join(resolve(bundled), MANIFEST_FILE))));
    }
    Object.assign(
      merged,
      manifestResourceMap(
        safeReadJson(join(this.projectRoot, "acad-lisp", MANIFEST_FILE)),
      ),
    );
    return merged;
  }

  private scan(force = false): InternalResource[] {
    // Catalog/detail browsing is read-only and should stay instant. External
    // file changes are picked up by the explicit UI refresh; mutations and
    // prepareLoad always force a fresh byte/hash scan for CAS safety.
    if (!force && this.scanCache) {
      this.scanTruncated = this.scanCache.truncated;
      return this.scanCache.resources;
    }
    const roots = this.rootsInternal();
    const baseManifests = this.baseManifestMap();
    const overrides = this.readOverrides().resources;
    const resources: InternalResource[] = [];
    const realFiles = new Set<string>();
    const logicalFiles = new Set<string>();
    let truncated = false;

    const visit = (root: InternalRoot, directory: string, depth: number): void => {
      if (depth > MAX_SCAN_DEPTH || resources.length >= MAX_RESOURCES) {
        truncated = true;
        return;
      }
      let entries;
      try {
        entries = readdirSync(directory, { withFileTypes: true });
      } catch {
        return;
      }
      entries.sort((a, b) => a.name.localeCompare(b.name));
      for (const entry of entries) {
        if (resources.length >= MAX_RESOURCES) {
          truncated = true;
          break;
        }
        if (entry.isSymbolicLink()) continue;
        const candidate = join(directory, entry.name);
        if (entry.isDirectory()) {
          if (!IGNORED_DIRS.has(entry.name)) visit(root, candidate, depth + 1);
          continue;
        }
        if (!entry.isFile()) continue;
        const extension = extname(entry.name).toLowerCase();
        if (!RESOURCE_EXTENSIONS.has(extension)) continue;

        let absolutePath: string;
        let stats;
        try {
          absolutePath = realpathSync(candidate);
          if (!isInside(root.absolutePath, absolutePath)) continue;
          stats = statSync(absolutePath);
          if (!stats.isFile()) continue;
        } catch {
          continue;
        }
        if (realFiles.has(absolutePath)) continue;

        const relativePath = unixPath(relative(root.absolutePath, absolutePath));
        const projectPath = isInside(this.projectRoot, absolutePath)
          ? unixPath(relative(this.projectRoot, absolutePath))
          : root.kind === "bundled"
            ? /^(?:acad-lisp|acad-studio)\//.test(relativePath)
              ? relativePath
              : `acad-lisp/${relativePath}`
            : null;
        const logicalPath = projectPath && ["project", "bundled"].includes(root.kind)
          ? projectPath
          : null;
        if (logicalPath && logicalFiles.has(logicalPath)) continue;

        let fileRead: ReturnType<typeof readCatalogFile>;
        try {
          fileRead = readCatalogFile(
            absolutePath,
            SOURCE_EXTENSIONS.has(extension),
          );
        } catch {
          continue;
        }
        const sourceHash = fileRead.sourceHash;
        const semantics = extensionSemantics(extension, this.platform);
        const text = {
          source: fileRead.source,
          encoding: fileRead.encoding,
          warning: fileRead.warning,
        };
        const inferred = text.source ? inferLispSource(text.source) : {
          commands: [],
          functions: [],
          dependencies: [],
          dialogs: [],
          cadCommands: [],
          systemVariables: [],
          apiCalls: [],
          fileReferences: [],
        };
        const id = sha256(`${root.id}\0${relativePath}`).slice(0, 24);
        const baseManifest =
          baseManifests[projectPath || ""] ??
          baseManifests[relativePath] ??
          baseManifests[id] ??
          null;
        const override = overrides[id] ?? null;
        const generatedManifest = inferredManifestFor({
          name: entry.name,
          extension,
          kind: semantics.kind,
          sourceReadable: semantics.readable && text.source !== null,
          inferred,
        });
        const selectedManifest = override?.manifest ?? baseManifest ?? generatedManifest;
        const manifest = {
          ...selectedManifest,
          schemaVersion: selectedManifest.schemaVersion ?? 1,
        };
        const warnings: string[] = [];
        if (text.warning) warnings.push(text.warning);
        if (!baseManifest && !override) warnings.push("manifest_inferred_unreviewed");
        if (extension === ".fas") warnings.push("compiled_source_not_readable");
        if (extension === ".vlx" && this.platform !== "win32") warnings.push("vlx_windows_only");

        resources.push({
          id,
          name: entry.name,
          extension,
          kind: semantics.kind,
          pathLabel: `${root.label}/${relativePath}`,
          rootId: root.id,
          sizeBytes: fileRead.sizeBytes,
          modifiedAt: stats.mtime.toISOString(),
          sourceHash,
          readable: semantics.readable && text.source !== null,
          loadable: semantics.loadable,
          loadBlockReason: semantics.reason,
          commands: union([...inferred.commands, ...manifestCommands(manifest)]),
          functions: union([...inferred.functions, ...manifestFunctions(manifest)]),
          dependencies: union([
            ...inferred.dependencies,
            ...manifestDependencies(manifest),
          ]),
          reviewStatus: "unreviewed",
          manifest,
          warnings,
          absolutePath,
          relativePath,
          projectPath,
          root,
          source: text.source,
          sourceEncoding: text.encoding,
          inferred,
          baseManifest,
          override,
        });
        realFiles.add(absolutePath);
        if (logicalPath) logicalFiles.add(logicalPath);
      }
    };

    for (const root of roots) visit(root, root.absolutePath, 0);
    const sorted = resources.sort((a, b) => a.pathLabel.localeCompare(b.pathLabel));
    for (const resource of sorted) {
      const status = reviewStatus(
        resource.override,
        this.revisionFor(resource, sorted),
      );
      resource.reviewStatus = status;
      if (status === "stale" && !resource.warnings.includes("manifest_dependency_or_source_changed")) {
        resource.warnings.push("manifest_dependency_or_source_changed");
      }
    }
    this.scanTruncated = truncated;
    this.scanCache = { at: Date.now(), resources: sorted, truncated };
    return sorted;
  }

  catalog(force = false): {
    resources: LispResourceSummary[];
    roots: LispRoot[];
    counts: {
      total: number;
      readable: number;
      loadable: number;
      reviewed: number;
      needsReview: number;
    };
    truncated: boolean;
    scanWarnings: string[];
  } {
    const resources = this.scan(force);
    return {
      resources: resources.map(publicSummary),
      roots: this.roots(),
      counts: {
        total: resources.length,
        readable: resources.filter((resource) => resource.readable).length,
        loadable: resources.filter((resource) => resource.loadable).length,
        reviewed: resources.filter((resource) => resource.reviewStatus === "approved").length,
        needsReview: resources.filter((resource) => resource.reviewStatus !== "approved").length,
      },
      truncated: this.scanTruncated,
      scanWarnings: this.scanTruncated ? ["resource_scan_truncated"] : [],
    };
  }

  private find(id: string, resources = this.scan()): InternalResource | null {
    return resources.find((resource) => resource.id === id) ?? null;
  }

  private dependencySpecs(resource: InternalResource): Array<{
    reference: string;
    optional: boolean;
    shouldLoad: boolean;
  }> {
    const specs: Array<{ reference: string; optional: boolean; shouldLoad: boolean }> = [];
    const manifest = resource.manifest;
    const declared = Array.isArray(manifest?.dependencies) ? manifest!.dependencies : [];
    for (const entry of declared) {
      if (typeof entry === "string") {
        specs.push({ reference: entry, optional: false, shouldLoad: false });
        continue;
      }
      if (!entry || typeof entry !== "object") continue;
      const kind = String(entry.kind ?? "runtime").toLowerCase();
      const reference = String(entry.path ?? entry.id ?? "").trim();
      if (!reference) continue;
      const fileKind =
        ["runtime-file", "file", "lisp", "dcl"].includes(kind) ||
        (kind === "runtime" && RESOURCE_EXTENSIONS.has(extname(reference).toLowerCase()));
      if (!fileKind) continue;
      specs.push({
        reference,
        optional: Boolean(entry.optional),
        // Staging and Support Path resolution are the safe defaults. Preloading
        // changes execution order and can duplicate an owner's own LOAD call,
        // so it must be an explicit manifest decision.
        shouldLoad:
          entry.preload === true &&
          !["runtime-file", "dcl"].includes(kind),
      });
    }

    const runtimeFiles = manifest?.runtimeFiles ?? manifest?.runtime?.files;
    if (Array.isArray(runtimeFiles)) {
      for (const entry of runtimeFiles) {
        const reference =
          typeof entry === "string" ? entry : String(entry?.path ?? entry?.id ?? "");
        if (reference) {
          specs.push({
            reference,
            optional: typeof entry === "object" ? Boolean(entry.optional) : false,
            shouldLoad: false,
          });
        }
      }
    }
    for (const reference of resource.inferred.dependencies) {
      specs.push({
        reference,
        optional: true,
        // Staging + persistent support path lets the owner execute its own
        // conditional/ordered LOAD calls without us changing side effects.
        shouldLoad: false,
      });
    }
    const seen = new Set<string>();
    return specs.filter((spec) => {
      const key = `${spec.reference}\0${spec.shouldLoad}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  private resolveDependency(
    owner: InternalResource,
    reference: string,
    resources: InternalResource[],
  ): InternalResource | null {
    const normalized = unixPath(reference.trim()).replace(/^\.\//, "");
    if (!normalized || isAbsolute(normalized) || normalized.split("/").includes("..")) return null;
    const lower = normalized.toLowerCase();

    const exact = resources.filter((candidate) => {
      const projectPath = candidate.projectPath?.toLowerCase();
      const relativePath = candidate.relativePath.toLowerCase();
      return projectPath === lower || relativePath === lower;
    });
    if (exact.length === 1) return exact[0];

    const tryNames = new Set([lower]);
    if (!extname(lower)) {
      tryNames.add(`${lower}.lsp`);
      tryNames.add(`${lower}.fas`);
      tryNames.add(`${lower}.dcl`);
      if (this.platform === "win32") tryNames.add(`${lower}.vlx`);
    }
    const ownerDir = unixPath(dirname(owner.relativePath));
    const sameRoot = resources.filter((candidate) => {
      if (candidate.rootId !== owner.rootId) return false;
      const relativePath = candidate.relativePath.toLowerCase();
      return [...tryNames].some(
        (name) => relativePath === name || relativePath === `${ownerDir}/${name}`,
      );
    });
    if (sameRoot.length === 1) return sameRoot[0];

    const names = new Set([...tryNames].map((name) => basename(name)));
    const byName = resources.filter((candidate) => names.has(candidate.name.toLowerCase()));
    return byName.length === 1 ? byName[0] : null;
  }

  private directRuntimeDependencies(
    resource: InternalResource,
    resources: InternalResource[],
  ): RuntimeDependency[] {
    return this.dependencySpecs(resource).map((spec) => {
      const resolved = this.resolveDependency(resource, spec.reference, resources);
      return {
        ...spec,
        ownerId: resource.id,
        resource: resolved,
        warning: resolved
          ? undefined
          : `${spec.optional ? "optional_" : ""}dependency_unresolved:${spec.reference}`,
      };
    });
  }

  /**
   * Resolve the complete staged dependency graph in post-order. This keeps
   * A -> B -> C self-contained and makes preload order deterministic.
   */
  private runtimeDependencies(
    resource: InternalResource,
    resources: InternalResource[],
  ): RuntimeDependency[] {
    const output: RuntimeDependency[] = [];
    const expanded = new Set<string>();
    const visiting = new Set<string>([resource.id]);
    const seenEdges = new Set<string>();
    const visit = (owner: InternalResource): void => {
      for (const dependency of this.directRuntimeDependencies(owner, resources)) {
        const dependencyId = dependency.resource?.id ?? dependency.reference;
        const edgeKey =
          `${owner.id}\0${dependencyId}\0${dependency.optional}\0${dependency.shouldLoad}`;
        if (seenEdges.has(edgeKey)) continue;
        seenEdges.add(edgeKey);
        const child = dependency.resource;
        if (child && !visiting.has(child.id) && !expanded.has(child.id)) {
          visiting.add(child.id);
          visit(child);
          visiting.delete(child.id);
          expanded.add(child.id);
        }
        output.push(dependency);
      }
    };
    visit(resource);
    return output;
  }

  /**
   * Only preload edges reachable through another preload edge. A support-only
   * A -> B relationship must not cause B's own preload C to execute early.
   */
  private preloadDependencies(
    resource: InternalResource,
    resources: InternalResource[],
  ): RuntimeDependency[] {
    const output: RuntimeDependency[] = [];
    const visiting = new Set<string>([resource.id]);
    const emitted = new Set<string>();
    const visit = (owner: InternalResource): void => {
      for (const dependency of this.directRuntimeDependencies(owner, resources)) {
        if (!dependency.shouldLoad || !dependency.resource) continue;
        const child = dependency.resource;
        if (!visiting.has(child.id)) {
          visiting.add(child.id);
          visit(child);
          visiting.delete(child.id);
        }
        if (!emitted.has(child.id)) {
          emitted.add(child.id);
          output.push(dependency);
        }
      }
    };
    visit(resource);
    return output;
  }

  private dependencyReaches(
    start: InternalResource,
    targetId: string,
    resources: InternalResource[],
  ): boolean {
    const seen = new Set<string>();
    const visit = (resource: InternalResource): boolean => {
      if (seen.has(resource.id)) return false;
      seen.add(resource.id);
      for (const dependency of this.directRuntimeDependencies(resource, resources)) {
        if (!dependency.resource) continue;
        if (dependency.resource.id === targetId || visit(dependency.resource)) return true;
      }
      return false;
    };
    return visit(start);
  }

  private executionManifest(manifest: JsonObject | null): JsonObject | null {
    if (!manifest) return null;
    const { review: _review, ...content } = manifest;
    return content;
  }

  private resourceFileUnchanged(resource: InternalResource): boolean {
    try {
      const stats = statSync(resource.absolutePath);
      return (
        stats.isFile() &&
        stats.size === resource.sizeBytes &&
        stats.mtime.toISOString() === resource.modifiedAt
      );
    } catch {
      return false;
    }
  }

  private publicRuntimeDependencies(
    resource: InternalResource,
    resources: InternalResource[],
  ): RuntimeDependencySummary[] {
    return this.runtimeDependencies(resource, resources).map((dependency) => ({
      ownerId: dependency.ownerId ?? null,
      reference: dependency.reference,
      optional: dependency.optional,
      preload: dependency.shouldLoad,
      resolved: Boolean(dependency.resource),
      resourceId: dependency.resource?.id ?? null,
      name: dependency.resource?.name ?? null,
      pathLabel: dependency.resource?.pathLabel ?? null,
      extension: dependency.resource?.extension ?? null,
      reviewStatus: dependency.resource?.reviewStatus ?? null,
    }));
  }

  private revisionFor(
    resource: InternalResource,
    resources: InternalResource[],
  ): string {
    const dependencies = this.runtimeDependencies(resource, resources).map((dependency) => ({
      ownerId: dependency.ownerId,
      reference: dependency.reference,
      resourceId: dependency.resource?.id ?? null,
      sourceHash: dependency.resource?.sourceHash ?? null,
      manifest: this.executionManifest(dependency.resource?.manifest ?? null),
      optional: dependency.optional,
      shouldLoad: dependency.shouldLoad,
    }));
    return sha256(
      stableJson({
        sourceHash: resource.sourceHash,
        manifest: this.executionManifest(resource.manifest),
        dependencies,
      }),
    );
  }

  detail(id: string): {
    resource: LispResourceSummary & {
      source: string | null;
      sourceEncoding: "utf8" | "utf16le" | "utf16be" | "latin1" | null;
      inferred: LispInference;
      baseManifest: JsonObject | null;
      manifestRevision: string;
      runtimeDependencies: RuntimeDependencySummary[];
    };
  } | null {
    let resources = this.scan();
    let resource = this.find(id, resources);
    if (!resource) return null;
    const relevant = [
      resource,
      ...this.runtimeDependencies(resource, resources)
        .map((dependency) => dependency.resource)
        .filter((entry): entry is InternalResource => Boolean(entry)),
    ];
    if (relevant.some((entry) => !this.resourceFileUnchanged(entry))) {
      resources = this.scan(true);
      resource = this.find(id, resources);
      if (!resource) return null;
    }
    return {
      resource: {
        ...publicSummary(resource),
        source: resource.source,
        sourceEncoding: resource.sourceEncoding,
        inferred: resource.inferred,
        baseManifest: resource.baseManifest,
        manifestRevision: this.revisionFor(resource, resources),
        runtimeDependencies: this.publicRuntimeDependencies(resource, resources),
      },
    };
  }

  saveManifest(
    id: string,
    baseRevision: unknown,
    rawManifest: unknown,
    approved: unknown,
    reviewEvidence?: {
      analysisCoverage: "full-source" | "partial-source" | "metadata-only";
      acknowledgedIncomplete: boolean;
    },
  ): ReturnType<LispLibrary["detail"]> {
    const resources = this.scan(true);
    const resource = this.find(id, resources);
    if (!resource) throw new Error("resource_not_found");
    const currentRevision = this.revisionFor(resource, resources);
    if (!baseRevision || String(baseRevision) !== currentRevision) {
      const error = new Error("revision_conflict") as Error & { currentRevision?: string };
      error.currentRevision = currentRevision;
      throw error;
    }
    if (typeof approved !== "boolean") throw new Error("approval_required");
    const manifest = sanitizeManifest(rawManifest);
    if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) {
      throw new Error("manifest_invalid");
    }
    if (Buffer.byteLength(JSON.stringify(manifest)) > MAX_MANIFEST_BYTES) {
      throw new Error("manifest_too_large");
    }
    if (approved) validateApprovedManifest(manifest);
    // Agent output is only a proposal. Approval fields always come from the
    // explicit UI action, never from proposal JSON.
    manifest.review = {
      status: approved ? "approved" : "unreviewed",
      approvedSourceHash: approved ? resource.sourceHash : null,
      reviewedAt: approved ? new Date().toISOString() : null,
      reviewedBy: approved ? "user" : null,
      analysisCoverage: approved
        ? reviewEvidence?.analysisCoverage ?? "manual-review"
        : null,
      acknowledgedIncompleteAnalysis: approved
        ? Boolean(reviewEvidence?.acknowledgedIncomplete)
        : false,
    };
    if (Buffer.byteLength(JSON.stringify(manifest)) > MAX_MANIFEST_BYTES) {
      throw new Error("manifest_too_large");
    }
    const proposedResource: InternalResource = { ...resource, manifest };
    const proposedResources = resources.map((entry) =>
      entry.id === resource.id ? proposedResource : entry);
    if (approved) {
      const proposedDependencies = this.runtimeDependencies(
        proposedResource,
        proposedResources,
      );
      const missingRequired = proposedDependencies.find(
        (dependency) => !dependency.optional && !dependency.resource,
      );
      if (missingRequired) {
        throw new Error(`dependency_unresolved:${missingRequired.reference}`);
      }
      const needsReview = proposedDependencies.find(
        (dependency) =>
          dependency.resource &&
          dependency.resource.id !== proposedResource.id &&
          dependency.resource.reviewStatus !== "approved" &&
          !this.dependencyReaches(
            dependency.resource,
            proposedResource.id,
            proposedResources,
          ),
      );
      if (needsReview?.resource) {
        throw new Error(
          `dependency_review_required:${needsReview.resource.id}:${needsReview.reference}`,
        );
      }
    }
    const approvedEffectiveHash = approved
      ? this.revisionFor(proposedResource, proposedResources)
      : null;
    const registry = this.readOverrides();
    registry.resources[id] = {
      manifest,
      approved,
      approvedSourceHash: approved ? resource.sourceHash : null,
      approvedEffectiveHash,
      updatedAt: new Date().toISOString(),
    };
    writeJsonAtomic(this.overrideRegistryPath(), registry);
    this.scanCache = null;
    return this.detail(id);
  }

  private stageDestination(
    stageRoot: string,
    resource: InternalResource,
  ): string {
    const relativePath = resource.projectPath
      ? resource.projectPath
      : join(resource.rootId, resource.relativePath);
    const destination = resolve(stageRoot, relativePath);
    if (!isInside(stageRoot, destination)) throw new Error("unsafe_stage_path");
    return destination;
  }

  private copyAtomic(source: string, destination: string): void {
    mkdirSync(dirname(destination), { recursive: true });
    const temporary = `${destination}.${randomUUID().slice(0, 8)}.tmp`;
    copyFileSync(source, temporary);
    renameSync(temporary, destination);
  }

  private setStageReadOnly(path: string): void {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) {
        this.setStageReadOnly(child);
      } else {
        chmodSync(child, 0o444);
      }
    }
    chmodSync(path, 0o555);
  }

  private removeManagedStage(path: string): void {
    if (!existsSync(path)) return;
    const makeWritable = (directory: string): void => {
      chmodSync(directory, 0o755);
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        const child = join(directory, entry.name);
        if (entry.isDirectory()) makeWritable(child);
        else chmodSync(child, 0o644);
      }
    };
    makeWritable(path);
    rmSync(path, { recursive: true, force: true });
  }

  prepareLoad(id: string, baseRevision: unknown): {
    resource: InternalResource;
    revision: string;
    entryPath: string;
    preloadPaths: string[];
    supportPaths: string[];
    warnings: string[];
  } {
    const resources = this.scan(true);
    const resource = this.find(id, resources);
    if (!resource) throw new Error("resource_not_found");
    if (!resource.loadable) throw new Error(resource.loadBlockReason || "resource_not_loadable");
    const revision = this.revisionFor(resource, resources);
    if (!baseRevision || String(baseRevision) !== revision) {
      const error = new Error("revision_conflict") as Error & { currentRevision?: string };
      error.currentRevision = revision;
      throw error;
    }
    const dependencies = this.runtimeDependencies(resource, resources);
    if (resource.reviewStatus !== "approved") {
      throw new Error(`review_required:${resource.reviewStatus}`);
    }
    const dependencyNeedsReview = dependencies.find(
      (dependency) =>
        dependency.resource &&
        dependency.resource.id !== resource.id &&
        dependency.resource.reviewStatus !== "approved",
    );
    if (dependencyNeedsReview?.resource) {
      throw new Error(
        `dependency_review_required:${dependencyNeedsReview.resource.id}:` +
        dependencyNeedsReview.reference,
      );
    }
    const missingRequired = dependencies.find(
      (dependency) => !dependency.optional && !dependency.resource,
    );
    if (missingRequired) throw new Error(`dependency_unresolved:${missingRequired.reference}`);

    ensureBridgeLayout(this.bridgeDir);
    const managedRoot = join(this.bridgeDir, "library", "managed");
    mkdirSync(managedRoot, { recursive: true });
    const resourceStageRoot = join(managedRoot, resource.id);
    mkdirSync(resourceStageRoot, { recursive: true });
    // A versioned stage is immutable for the lifetime of the AutoCAD session.
    // Never replace bytes behind a queued loader or a command that lazily LOADs
    // its dependency after the initial request has completed.
    const stageRoot = join(resourceStageRoot, revision.slice(0, 32));
    const all = [
      resource,
      ...dependencies
        .map((dependency) => dependency.resource)
        .filter((entry): entry is InternalResource => Boolean(entry)),
    ];
    const unique = all.filter(
      (entry, index, entries) => entries.findIndex((candidate) => candidate.id === entry.id) === index,
    );
    const staged = new Map<string, string>();
    if (existsSync(stageRoot)) {
      for (const entry of unique) {
        const destination = this.stageDestination(stageRoot, entry);
        if (!existsSync(destination) || hashFile(destination) !== entry.sourceHash) {
          throw new Error(`managed_stage_corrupt:${entry.id}`);
        }
        staged.set(entry.id, destination);
      }
    } else {
      const temporaryStageRoot = join(
        resourceStageRoot,
        `${revision.slice(0, 32)}.next-${randomUUID().slice(0, 8)}`,
      );
      mkdirSync(temporaryStageRoot, { recursive: true });
      try {
        for (const entry of unique) {
        const destination = this.stageDestination(temporaryStageRoot, entry);
        this.copyAtomic(entry.absolutePath, destination);
        if (hashFile(destination) !== entry.sourceHash) {
          // The source changed after scan/revision calculation. Never execute a
          // staged artifact whose bytes are not the bytes the user reviewed.
          throw new Error(`resource_changed_during_stage:${entry.id}`);
        }
        staged.set(entry.id, destination);
        }
        renameSync(temporaryStageRoot, stageRoot);
        this.setStageReadOnly(stageRoot);
      } catch (error) {
        this.removeManagedStage(temporaryStageRoot);
        throw error;
      }
      for (const [entryId, temporaryPath] of staged) {
        staged.set(
          entryId,
          resolve(stageRoot, relative(temporaryStageRoot, temporaryPath)),
        );
      }
    }
    const entryPath = staged.get(resource.id)!;
    const preloadPaths = this.preloadDependencies(resource, resources)
      .filter(
        (dependency) =>
          dependency.shouldLoad &&
          dependency.resource &&
          LOAD_EXTENSIONS.has(dependency.resource.extension) &&
          dependency.resource.loadable,
      )
      .map((dependency) => staged.get(dependency.resource!.id)!)
      .filter((path, index, paths) => path !== entryPath && paths.indexOf(path) === index);
    const supportPaths = union(
      [stageRoot, dirname(entryPath), ...[...staged.values()].map(dirname)].map((path) =>
        resolve(path),
      ),
    );
    const warnings = dependencies
      .map((dependency) => dependency.warning)
      .filter((warning): warning is string => Boolean(warning));
    warnings.push(
      ...dependencies
        .filter(
          (dependency) =>
            dependency.resource &&
            dependency.resource.id !== resource.id &&
            dependency.resource.reviewStatus !== "approved",
        )
        .map(
          (dependency) =>
            `dependency_review_status:${dependency.resource!.id}:` +
            `${dependency.resource!.reviewStatus}:${dependency.reference}`,
        ),
    );
    if (resource.reviewStatus !== "approved") {
      warnings.push(`review_status:${resource.reviewStatus}`);
    }
    warnings.push("staged_support_paths_added_to_autocad_session");
    return { resource, revision, entryPath, preloadPaths, supportPaths, warnings };
  }
}

function lispString(value: string): string {
  if (/[\0\r\n]/.test(value)) throw new Error("unsafe_lisp_string");
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Build a session loader. Staged support paths intentionally remain available
 * after LOAD because commands can call load/load_dialog lazily much later.
 */
export function buildLibraryLoadLisp(input: {
  entryPath: string;
  preloadPaths?: string[];
  supportPaths: string[];
  displayName: string;
  expectedTitle?: string;
  expectedFile?: string;
}): string {
  if (!input.supportPaths.length || input.supportPaths.some((path) => /[;\0\r\n]/.test(path))) {
    throw new Error("unsafe_support_path");
  }
  const paths = [...(input.preloadPaths ?? []), input.entryPath];
  const supportItems = input.supportPaths
    .map((path) => `"${lispString(path)}"`)
    .join(" ");
  const trustedItem = `${lispString(input.supportPaths[0])}/...`;
  const loadForms = paths
    .map(
      (path) =>
        `(setq acadlib:one (load "${lispString(path)}" "__ACAD_LIBRARY_LOAD_FAILED__"))\n` +
        `(if (= acadlib:one "__ACAD_LIBRARY_LOAD_FAILED__") ` +
        `(error "Khong nap duoc ${lispString(basename(path))}"))`,
    )
    .join("\n");
  const body = `(setq acadlib:old-acad (getenv "ACAD"))
(setq acadlib:old-trusted (getvar "TRUSTEDPATHS"))
(setq acadlib:run
  (vl-catch-all-apply
    '(lambda ( / acadlib:one acadlib:path acadlib:needle acadlib:new-acad acadlib:new-trusted)
      (setq acadlib:new-acad (if acadlib:old-acad acadlib:old-acad ""))
      (foreach acadlib:path (reverse (list ${supportItems}))
        (setq acadlib:needle (strcat ";" (strcase acadlib:path) ";"))
        (if (not (vl-string-search acadlib:needle
              (strcat ";" (strcase acadlib:new-acad) ";")))
          (setq acadlib:new-acad
            (if (> (strlen acadlib:new-acad) 0)
              (strcat acadlib:path ";" acadlib:new-acad)
              acadlib:path))))
      (setenv "ACAD" acadlib:new-acad)
      (if (= (type acadlib:old-trusted) 'STR)
        (progn
          (setq acadlib:new-trusted acadlib:old-trusted)
          (setq acadlib:path "${trustedItem}")
          (setq acadlib:needle (strcat ";" (strcase acadlib:path) ";"))
          (if (not (vl-string-search acadlib:needle
                (strcat ";" (strcase acadlib:new-trusted) ";")))
            (setq acadlib:new-trusted
              (if (> (strlen acadlib:new-trusted) 0)
                (strcat acadlib:path ";" acadlib:new-trusted)
                acadlib:path)))
          (setvar "TRUSTEDPATHS" acadlib:new-trusted)))
      ${loadForms}
      T)
    '()))
(cond
  ((vl-catch-all-error-p acadlib:run)
   (setenv "ACAD" (if acadlib:old-acad acadlib:old-acad ""))
   (if (= (type acadlib:old-trusted) 'STR)
     (setvar "TRUSTEDPATHS" acadlib:old-trusted))
   (acad:write-result "error" (vl-catch-all-error-message acadlib:run)))
  (T (acad:write-result "ok" "Da nap ${lispString(input.displayName)}")))
`;
  const expected = union(
    [input.expectedTitle ?? "", input.expectedFile ?? ""].filter(Boolean),
  );
  if (!expected.length) return body;
  const matches = expected
    .map(
      (value) =>
        `(= acadlib:doc-name "${lispString(value)}") ` +
        `(= acadlib:doc-full "${lispString(value)}")`,
    )
    .join(" ");
  return `(setq acadlib:doc-name (getvar "DWGNAME"))
(setq acadlib:doc-full (strcat (getvar "DWGPREFIX") acadlib:doc-name))
(if (not (or ${matches}))
  (acad:write-result "error" "Ban ve dich da thay doi; huy nap resource.")
  (progn
${body}
  ))
`;
}

function httpStatusFor(error: string): number {
  if (error === "resource_not_found" || error === "root_not_found") return 404;
  if (
    error === "revision_conflict" ||
    error.startsWith("resource_changed_during_stage") ||
    error.startsWith("managed_stage_corrupt")
  ) {
    return 409;
  }
  if (
    error.includes("not_loadable") ||
    error.includes("windows_only") ||
    error.includes("requires_load_dialog") ||
    error.includes("catalog_only") ||
    error.startsWith("review_required") ||
    error.startsWith("dependency_unresolved") ||
    error.startsWith("dependency_review_required")
  ) {
    return 422;
  }
  return 400;
}

export function lispLibraryRouter(deps: RouterDeps = {}): Router {
  const router = express.Router();
  const library = new LispLibrary(deps);
  const acadRunning = deps.acadRunning ?? defaultAcadRunning;
  const listOpenDocs = deps.listOpenDocs ?? defaultListOpenDocs;
  const dispatchLiveJob = deps.dispatchLiveJob ?? defaultDispatchLiveJob;
  const approvalChallenges = new Map<string, {
    resourceId: string;
    baseRevision: string;
    proposalHash: string;
    analysisCoverage: "full-source" | "partial-source" | "metadata-only";
    acknowledgedIncomplete: boolean;
    expiresAt: number;
  }>();
  const usedReviewProofs = new Map<string, number>();

  router.get("/", (req, res) => {
    const catalog = library.catalog(req.query.refresh === "1");
    res.json({ ok: true, ...catalog });
  });

  router.get("/roots", (_req, res) => {
    res.json({ ok: true, roots: library.roots() });
  });

  router.post("/roots", (req, res) => {
    try {
      const root = library.addRoot(req.body?.path, req.body?.label);
      res.status(201).json({ ok: true, root });
    } catch (error) {
      const code = error instanceof Error ? error.message : "root_registration_failed";
      res.status(httpStatusFor(code)).json({ ok: false, code, error: code });
    }
  });

  router.post("/roots/import-autocad", async (req, res) => {
    try {
      if (!(await acadRunning())) {
        return res.status(503).json({
          ok: false,
          code: "autocad_not_running",
          error: "AutoCAD chưa chạy",
        });
      }
      const open = await listOpenDocs(3_000);
      if (!open.alive) {
        return res.status(503).json({
          ok: false,
          code: "plugin_unavailable",
          error: "Plugin AcadBridge không phản hồi",
        });
      }
      const requested = String(req.body?.target ?? "");
      const matches = requested
        ? open.docs.filter((doc) => doc.file === requested || doc.title === requested)
        : [];
      if (requested && matches.length > 1) {
        return res.status(409).json({
          ok: false,
          code: "ambiguous_target",
          error: "Có nhiều bản vẽ trùng tên; hãy chọn đường dẫn file đầy đủ",
        });
      }
      const document = requested ? matches[0] : open.docs.find((doc) => doc.active);
      const exactTarget = document?.file || document?.title || "";
      if (!document || !exactTarget) {
        return res.status(404).json({
          ok: false,
          code: "active_document_not_found",
          error: "Không thấy bản vẽ đang mở để đọc Support File Search Paths",
        });
      }
      const lisp = `(setq acadlib:support-paths (getvar "ACADPREFIX"))
(if (or (null acadlib:support-paths) (/= (type acadlib:support-paths) 'STR))
  (setq acadlib:support-paths (getenv "ACAD")))
(acad:write-result "ok" (if acadlib:support-paths acadlib:support-paths ""))
`;
      const job = await dispatchLiveJob(lisp, exactTarget, 15_000);
      if (job.state !== "done" || job.result?.status !== "ok") {
        const pending = job.state === "sent" || job.state === "pending";
        return res.status(pending ? 202 : 502).json({
          ok: false,
          code: pending ? "support_paths_pending" : "support_paths_query_failed",
          error: pending
            ? "AutoCAD chưa trả Support Paths; hãy thử lại sau vài giây"
            : job.result?.message || "Không đọc được Support Paths từ AutoCAD",
          jobId: job.jobId,
          state: job.state,
        });
      }
      const added: LispRoot[] = [];
      const skipped: string[] = [];
      for (const rawPath of job.result.message.split(";").map((value) => value.trim()).filter(Boolean)) {
        try {
          const real = realpathSync(resolve(rawPath));
          if (isInside(library.bridgeDir, real)) {
            skipped.push("managed-stage");
            continue;
          }
          const root = library.addRoot(real, `AutoCAD Support · ${basename(real)}`);
          if (!added.some((entry) => entry.id === root.id)) added.push(root);
        } catch {
          skipped.push("missing-or-unsafe");
        }
      }
      const catalog = library.catalog(true);
      return res.json({
        ok: true,
        added,
        skippedCount: skipped.length,
        counts: catalog.counts,
        target: { title: document.title, file: document.file },
      });
    } catch (error) {
      const code = error instanceof Error ? error.message : "support_paths_import_failed";
      return res.status(httpStatusFor(code)).json({ ok: false, code, error: code });
    }
  });

  router.post("/:id/approval-challenge", (req, res) => {
    const baseRevision = String(req.body?.baseRevision ?? "");
    const proposalHash = String(req.body?.proposalHash ?? "");
    const analysisCoverage = String(req.body?.analysisCoverage ?? "");
    const acknowledgedIncomplete = req.body?.acknowledgedIncomplete === true;
    if (
      !baseRevision ||
      !/^[a-f0-9]{64}$/.test(proposalHash) ||
      !["full-source", "partial-source", "metadata-only"].includes(analysisCoverage) ||
      (analysisCoverage !== "full-source" && !acknowledgedIncomplete)
    ) {
      return res.status(400).json({
        ok: false,
        code: "invalid_approval_challenge",
        error: "Thiếu xác nhận phạm vi phân tích trước khi duyệt",
      });
    }
    const proofExpected = {
      resourceId: req.params.id,
      baseRevision,
      proposalHash,
      analysisCoverage,
      acknowledgedIncomplete,
    };
    const proof = req.body?.userProof;
    if (
      !validUserReviewProof(proof, proofExpected) ||
      usedReviewProofs.has(proof.nonce)
    ) {
      return res.status(403).json({
        ok: false,
        code: "desktop_user_review_proof_required",
        error: "Chỉ thao tác review trực tiếp trong Acad Studio desktop mới được phép duyệt",
      });
    }
    const detail = library.detail(req.params.id);
    if (!detail) {
      return res.status(404).json({
        ok: false,
        code: "resource_not_found",
        error: "Không thấy resource",
      });
    }
    if (detail.resource.manifestRevision !== baseRevision) {
      return res.status(409).json({
        ok: false,
        code: "revision_conflict",
        error: "Source/cấu hình đã đổi; hãy phân tích lại",
        currentRevision: detail.resource.manifestRevision,
      });
    }
    const now = Date.now();
    for (const [nonce, expiresAt] of usedReviewProofs) {
      if (expiresAt <= now) usedReviewProofs.delete(nonce);
    }
    usedReviewProofs.set(proof.nonce, now + 2 * 60_000);
    for (const [key, challenge] of approvalChallenges) {
      if (challenge.expiresAt <= now) approvalChallenges.delete(key);
    }
    if (approvalChallenges.size > 200) approvalChallenges.delete(approvalChallenges.keys().next().value!);
    const token = sha256(`${randomUUID()}\0${req.params.id}\0${proposalHash}`);
    approvalChallenges.set(token, {
      resourceId: req.params.id,
      baseRevision,
      proposalHash,
      analysisCoverage: analysisCoverage as "full-source" | "partial-source" | "metadata-only",
      acknowledgedIncomplete,
      expiresAt: now + 2 * 60_000,
    });
    return res.json({ ok: true, approvalToken: token, expiresInMs: 2 * 60_000 });
  });

  router.get("/:id", (req, res) => {
    const detail = library.detail(req.params.id);
    if (!detail) {
      return res
        .status(404)
        .json({ ok: false, code: "resource_not_found", error: "Không thấy resource" });
    }
    return res.json({ ok: true, ...detail });
  });

  router.put("/:id/manifest", (req, res) => {
    try {
      let evidence:
        | {
            analysisCoverage: "full-source" | "partial-source" | "metadata-only";
            acknowledgedIncomplete: boolean;
          }
        | undefined;
      if (req.body?.approved === true) {
        const token = String(req.body?.approvalToken ?? "");
        const proposalHash = String(req.body?.proposalHash ?? "");
        const challenge = approvalChallenges.get(token);
        approvalChallenges.delete(token);
        const computedHash = sha256(stableJson({
          resourceId: req.params.id,
          baseRevision: String(req.body?.baseRevision ?? ""),
          manifest: req.body?.manifest,
        }));
        if (
          !challenge ||
          challenge.expiresAt <= Date.now() ||
          challenge.resourceId !== req.params.id ||
          challenge.baseRevision !== String(req.body?.baseRevision ?? "") ||
          challenge.proposalHash !== proposalHash ||
          computedHash !== proposalHash
        ) {
          return res.status(403).json({
            ok: false,
            code: "user_review_challenge_required",
            error: "Cần thao tác duyệt trực tiếp trong UI; token đã thiếu, hết hạn hoặc không khớp proposal",
          });
        }
        evidence = {
          analysisCoverage: challenge.analysisCoverage,
          acknowledgedIncomplete: challenge.acknowledgedIncomplete,
        };
      }
      const detail = library.saveManifest(
        req.params.id,
        req.body?.baseRevision,
        req.body?.manifest,
        req.body?.approved,
        evidence,
      );
      return res.json({ ok: true, ...detail });
    } catch (error) {
      const typed = error as Error & { currentRevision?: string };
      const code = typed?.message || "manifest_save_failed";
      return res.status(httpStatusFor(code)).json({
        ok: false,
        code,
        error: code,
        currentRevision: typed.currentRevision,
      });
    }
  });

  router.post("/:id/load", async (req, res) => {
    try {
      if (!(await acadRunning())) {
        return res
          .status(503)
          .json({ ok: false, code: "autocad_not_running", error: "AutoCAD chưa chạy" });
      }
      const open = await listOpenDocs(3000);
      if (!open.alive) {
        return res.status(503).json({
          ok: false,
          code: "plugin_unavailable",
          error: "Plugin AcadBridge không phản hồi",
        });
      }
      const requested = req.body?.target ? String(req.body.target) : "";
      const matches = requested
        ? open.docs.filter((doc) => doc.title === requested || doc.file === requested)
        : [];
      if (requested && matches.length > 1) {
        return res.status(409).json({
          ok: false,
          code: "ambiguous_target",
          error: "Có nhiều bản vẽ đang mở trùng tên; hãy chọn target bằng đường dẫn file đầy đủ",
        });
      }
      const document = requested ? matches[0] : open.docs.find((doc) => doc.active);
      const exactTarget = document?.file || document?.title || "";
      if (!document || !exactTarget) {
        return res.status(404).json({
          ok: false,
          code: requested ? "target_not_found" : "active_document_not_found",
          error: requested
            ? "Không thấy bản vẽ đang mở khớp chính xác target"
            : "Không thấy bản vẽ active",
        });
      }

      const prepared = library.prepareLoad(req.params.id, req.body?.baseRevision);
      const lisp = buildLibraryLoadLisp({
        entryPath: prepared.entryPath,
        preloadPaths: prepared.preloadPaths,
        supportPaths: prepared.supportPaths,
        displayName: prepared.resource.name,
        expectedTitle: document.title,
        expectedFile: document.file,
      });
      const wait = Math.max(500, Math.min(60_000, Number(req.body?.wait ?? 15_000)));
      const job = await dispatchLiveJob(lisp, exactTarget, wait);
      const ok = job.state !== "error";
      return res.status(ok ? 200 : 502).json({
        ok,
        ...job,
        target: { title: document.title, file: document.file },
        resource: {
          id: prepared.resource.id,
          name: prepared.resource.name,
          revision: prepared.revision,
          reviewStatus: prepared.resource.reviewStatus,
        },
        warnings: prepared.warnings,
        hint:
          job.state === "sent"
            ? "Resource đã được stage; AutoCAD chưa trả kết quả, có thể kiểm tra jobId."
            : undefined,
      });
    } catch (error) {
      const typed = error as Error & { currentRevision?: string };
      const code = typed?.message || "lisp_load_failed";
      return res.status(httpStatusFor(code)).json({
        ok: false,
        code,
        error: code,
        currentRevision: typed.currentRevision,
      });
    }
  });

  return router;
}

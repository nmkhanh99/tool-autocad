import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { assertNotRealStoreInTests } from "./bridgeContract.js";

export const BLOCK_LIBRARY_SCHEMA_VERSION = 1 as const;
export const BLOCK_LIBRARY_FILE_NAME = "block-library.v1.json";
export const TECHNICAL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

export type BlockType = "static" | "dynamic";
export type BlockSpace = "model" | "layout";
export type LibrarySourceKind = "dwg" | "xtp" | "image";

export type BasePoint = {
  x: number;
  y: number;
  z: number;
};

export type LibrarySource = {
  id: string;
  kind: LibrarySourceKind;
  displayName: string;
  path: string;
};

export type BlockAttributeDefinition = {
  tag: string;
  prompt: string;
  defaultValue: string;
  invisible: boolean;
  constant: boolean;
  preset: boolean;
  verify: boolean;
  lockPosition: boolean;
};

export type BlockSyncStatus =
  | "local_only"
  | "cad_only"
  | "synced"
  | "outdated"
  | "conflict";

export type BlockDefinition = {
  id: string;
  technicalName: string;
  cadName?: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  useCases: string[];
  type: BlockType;
  hasAttributes: boolean;
  attributeDefinitions: BlockAttributeDefinition[];
  basePoint: BasePoint;
  units: string;
  defaultLayer: string;
  allowedSpaces: BlockSpace[];
  annotative: boolean;
  scales: string[];
  sourceId?: string;
  sourcePath?: string;
  /** Definition name inside an aggregate source DWG; target drawings use technicalName. */
  sourceBlockName?: string;
  referenceCount?: number;
  sourceRevision?: string;
  geometryFingerprint?: string;
  previewImage?: string;
  toolPalettePath?: string;
  syncStatus: BlockSyncStatus;
  lastSyncedAt?: string;
};

export type BlockLibraryCatalog = {
  schemaVersion: typeof BLOCK_LIBRARY_SCHEMA_VERSION;
  revision: string;
  sources: LibrarySource[];
  blocks: BlockDefinition[];
};

export type BlockDuplicateGroup = {
  reason: "name_collision" | "geometry_fingerprint";
  key: string;
  blockIds: string[];
};

export type BlockLibraryStorageOptions = {
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
};

type JsonRecord = Record<string, unknown>;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const DESCRIPTION_MARKER_PATTERN = /^ACADLIB:v1;id=([A-Za-z0-9][A-Za-z0-9._-]{0,95})$/;
const INLINE_DESCRIPTION_MARKER_PATTERN =
  /^(.*?)(?:\s+\|\s+)ACADLIB:v1;id=([A-Za-z0-9][A-Za-z0-9._-]{0,95})$/;
const MAX_BLOCKS = 10_000;
const MAX_SOURCES = 1_000;

export class BlockLibraryValidationError extends Error {
  readonly code = "block_library_validation_error";

  constructor(message: string) {
    super(message);
    this.name = "BlockLibraryValidationError";
  }
}

export class BlockLibraryConflictError extends Error {
  readonly code = "block_library_revision_conflict";

  constructor(message: string) {
    super(message);
    this.name = "BlockLibraryConflictError";
  }
}

function validationError(path: string, message: string): never {
  throw new BlockLibraryValidationError(`${path}: ${message}`);
}

function recordValue(value: unknown, path: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return validationError(path, "phải là object");
  }
  return value as JsonRecord;
}

function stringValue(
  value: unknown,
  path: string,
  options: { allowEmpty?: boolean; maxLength?: number } = {},
): string {
  if (typeof value !== "string") {
    return validationError(path, "phải là chuỗi");
  }
  const result = value.trim();
  if (!options.allowEmpty && !result) {
    return validationError(path, "không được để trống");
  }
  const maxLength = options.maxLength ?? 160;
  if (result.length > maxLength) {
    return validationError(path, `không được dài quá ${maxLength} ký tự`);
  }
  return result;
}

function optionalString(value: unknown, path: string, maxLength: number): string | undefined {
  if (value == null || value === "") return undefined;
  return stringValue(value, path, { maxLength });
}

function numberValue(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return validationError(path, "phải là số hữu hạn");
  }
  return value;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    return validationError(path, "phải là boolean");
  }
  return value;
}

function idValue(value: unknown, path: string): string {
  const id = stringValue(value, path, { maxLength: 96 });
  if (!ID_PATTERN.test(id)) {
    return validationError(path, "chỉ được gồm ký tự ASCII, số, dấu chấm, _ và -");
  }
  return id;
}

function enumValue<T extends string>(
  value: unknown,
  path: string,
  allowed: readonly T[],
): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    return validationError(path, `phải là một trong: ${allowed.join(", ")}`);
  }
  return value as T;
}

function stringArray(value: unknown, path: string, maxItems: number): string[] {
  if (!Array.isArray(value)) {
    return validationError(path, "phải là mảng");
  }
  if (value.length > maxItems) {
    return validationError(path, `không được quá ${maxItems} phần tử`);
  }
  const result = value.map((item, index) =>
    stringValue(item, `${path}[${index}]`, { maxLength: 64 }));
  const seen = new Set<string>();
  for (const item of result) {
    const key = item.toLocaleLowerCase("en-US");
    if (seen.has(key)) validationError(path, `giá trị trùng lặp: ${item}`);
    seen.add(key);
  }
  return result;
}

function optionalStringArray(value: unknown, path: string, maxItems: number): string[] {
  return value == null ? [] : stringArray(value, path, maxItems);
}

function sanitizeAttributeDefinition(
  value: unknown,
  path: string,
): BlockAttributeDefinition {
  const source = recordValue(value, path);
  const tag = stringValue(source.tag, `${path}.tag`, { maxLength: 255 });
  if (!TECHNICAL_NAME_PATTERN.test(tag)) {
    return validationError(`${path}.tag`, "phải là tên ASCII ổn định");
  }
  return {
    tag,
    prompt: stringValue(source.prompt ?? "", `${path}.prompt`, {
      allowEmpty: true,
      maxLength: 500,
    }),
    defaultValue: stringValue(source.defaultValue ?? "", `${path}.defaultValue`, {
      allowEmpty: true,
      maxLength: 2_000,
    }),
    invisible: booleanValue(source.invisible ?? false, `${path}.invisible`),
    constant: booleanValue(source.constant ?? false, `${path}.constant`),
    preset: booleanValue(source.preset ?? false, `${path}.preset`),
    verify: booleanValue(source.verify ?? false, `${path}.verify`),
    lockPosition: booleanValue(source.lockPosition ?? false, `${path}.lockPosition`),
  };
}

function sanitizeAttributeDefinitions(value: unknown, path: string): BlockAttributeDefinition[] {
  if (value == null) return [];
  if (!Array.isArray(value)) return validationError(path, "phải là mảng");
  if (value.length > 500) return validationError(path, "không được quá 500 phần tử");
  const output = value.map((item, index) =>
    sanitizeAttributeDefinition(item, `${path}[${index}]`));
  const seen = new Set<string>();
  for (const item of output) {
    const key = item.tag.toLocaleLowerCase("en-US");
    if (seen.has(key)) validationError(path, `attribute tag trùng lặp: ${item.tag}`);
    seen.add(key);
  }
  return output;
}

function optionalIsoDate(value: unknown, path: string): string | undefined {
  if (value == null || value === "") return undefined;
  const raw = stringValue(value, path, { maxLength: 64 });
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return validationError(path, "không phải ngày ISO hợp lệ");
  return date.toISOString();
}

function assertUniqueIds(values: { id: string }[], path: string): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value.id)) validationError(path, `id trùng lặp: ${value.id}`);
    seen.add(value.id);
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      result[key] = canonicalize(source[key]);
    }
    return result;
  }
  return value;
}

export function slugifyTechnicalName(value: string): string {
  const slug = value
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 128)
    .replace(/_+$/g, "");
  return slug || "block";
}

export function blockDescriptionMarker(id: string): string {
  return `ACADLIB:v1;id=${idValue(id, "id")}`;
}

export function parseBlockDescription(value: string): {
  description: string;
  id?: string;
} {
  if (typeof value !== "string") {
    return validationError("description", "phải là chuỗi");
  }
  let id: string | undefined;
  const descriptionLines: string[] = [];
  for (const line of value.replace(/\r\n?/g, "\n").split("\n")) {
    const match = line.trim().match(DESCRIPTION_MARKER_PATTERN);
    if (match) {
      id = match[1];
      continue;
    }
    // AutoLISP's DXF group-4 fallback is kept to one line. Accept that
    // representation too; the native bridge writes the canonical newline form.
    const inline = line.trim().match(INLINE_DESCRIPTION_MARKER_PATTERN);
    if (inline) {
      id = inline[2];
      if (inline[1].trim()) descriptionLines.push(inline[1].trim());
    } else {
      descriptionLines.push(line);
    }
  }
  return {
    description: descriptionLines.join("\n").trim(),
    ...(id == null ? {} : { id }),
  };
}

export function mergeBlockDescription(description: string, id: string): string {
  const parsed = parseBlockDescription(description);
  const marker = blockDescriptionMarker(id);
  return parsed.description ? `${parsed.description}\n${marker}` : marker;
}

export function sanitizeLibrarySource(value: unknown): LibrarySource {
  const source = recordValue(value, "source");
  return {
    id: idValue(source.id, "source.id"),
    kind: enumValue(source.kind, "source.kind", ["dwg", "xtp", "image"] as const),
    displayName: stringValue(source.displayName, "source.displayName", { maxLength: 160 }),
    path: stringValue(source.path, "source.path", { maxLength: 2_048 }),
  };
}

export function sanitizeBlockDefinition(value: unknown): BlockDefinition {
  const source = recordValue(value, "block");
  const technicalName = stringValue(source.technicalName, "block.technicalName", {
    maxLength: 128,
  });
  if (!TECHNICAL_NAME_PATTERN.test(technicalName)) {
    return validationError(
      "block.technicalName",
      "phải là tên ASCII và chỉ gồm chữ, số, dấu chấm, _ hoặc -",
    );
  }
  const basePoint = recordValue(source.basePoint, "block.basePoint");
  if (!Array.isArray(source.allowedSpaces) || source.allowedSpaces.length === 0) {
    return validationError("block.allowedSpaces", "phải là mảng không rỗng");
  }
  const allowedSpaces = source.allowedSpaces.map((space, index) =>
    enumValue(space, `block.allowedSpaces[${index}]`, ["model", "layout"] as const));
  if (new Set(allowedSpaces).size !== allowedSpaces.length) {
    return validationError("block.allowedSpaces", "không được chứa giá trị trùng lặp");
  }
  let referenceCount: number | undefined;
  if (source.referenceCount != null) {
    referenceCount = numberValue(source.referenceCount, "block.referenceCount");
    if (!Number.isInteger(referenceCount) || referenceCount < 0) {
      return validationError("block.referenceCount", "phải là số nguyên không âm");
    }
  }
  const cadName = optionalString(source.cadName, "block.cadName", 255);
  const sourceId = optionalString(source.sourceId, "block.sourceId", 96);
  const sourcePath = optionalString(source.sourcePath, "block.sourcePath", 2_048);
  const sourceBlockName = optionalString(
    source.sourceBlockName,
    "block.sourceBlockName",
    255,
  );
  const sourceRevision = optionalString(
    source.sourceRevision,
    "block.sourceRevision",
    256,
  );
  const geometryFingerprint = optionalString(
    source.geometryFingerprint,
    "block.geometryFingerprint",
    256,
  );
  const previewImage = optionalString(source.previewImage, "block.previewImage", 2_048);
  const toolPalettePath = optionalString(
    source.toolPalettePath,
    "block.toolPalettePath",
    2_048,
  );
  const lastSyncedAt = optionalIsoDate(source.lastSyncedAt, "block.lastSyncedAt");
  return {
    id: idValue(source.id, "block.id"),
    technicalName,
    ...(cadName == null ? {} : { cadName }),
    displayName: stringValue(source.displayName, "block.displayName", { maxLength: 160 }),
    description: stringValue(source.description, "block.description", {
      allowEmpty: true,
      maxLength: 2_000,
    }),
    category: stringValue(source.category ?? "", "block.category", {
      allowEmpty: true,
      maxLength: 160,
    }),
    tags: optionalStringArray(source.tags, "block.tags", 100),
    useCases: optionalStringArray(source.useCases, "block.useCases", 100),
    type: enumValue(source.type, "block.type", ["static", "dynamic"] as const),
    hasAttributes: booleanValue(source.hasAttributes, "block.hasAttributes"),
    attributeDefinitions: sanitizeAttributeDefinitions(
      source.attributeDefinitions,
      "block.attributeDefinitions",
    ),
    basePoint: {
      x: numberValue(basePoint.x, "block.basePoint.x"),
      y: numberValue(basePoint.y, "block.basePoint.y"),
      z: numberValue(basePoint.z, "block.basePoint.z"),
    },
    units: stringValue(source.units, "block.units", { maxLength: 32 }),
    defaultLayer: stringValue(source.defaultLayer, "block.defaultLayer", { maxLength: 255 }),
    allowedSpaces,
    annotative: booleanValue(source.annotative, "block.annotative"),
    scales: stringArray(source.scales, "block.scales", 100),
    ...(sourceId == null ? {} : { sourceId: idValue(sourceId, "block.sourceId") }),
    ...(sourcePath == null ? {} : { sourcePath }),
    ...(sourceBlockName == null ? {} : { sourceBlockName }),
    ...(referenceCount == null ? {} : { referenceCount }),
    ...(sourceRevision == null ? {} : { sourceRevision }),
    ...(geometryFingerprint == null ? {} : { geometryFingerprint }),
    ...(previewImage == null ? {} : { previewImage }),
    ...(toolPalettePath == null ? {} : { toolPalettePath }),
    syncStatus: enumValue(
      source.syncStatus ?? "local_only",
      "block.syncStatus",
      ["local_only", "cad_only", "synced", "outdated", "conflict"] as const,
    ),
    ...(lastSyncedAt == null ? {} : { lastSyncedAt }),
  };
}

export function createBlockDefinition(
  value: Omit<BlockDefinition, "id">,
  id = randomUUID(),
): BlockDefinition {
  return sanitizeBlockDefinition({ ...value, id });
}

export function createLibrarySource(
  value: Omit<LibrarySource, "id">,
  id = randomUUID(),
): LibrarySource {
  return sanitizeLibrarySource({ ...value, id });
}

export function calculateBlockLibraryRevision(
  catalog: Omit<BlockLibraryCatalog, "revision"> | BlockLibraryCatalog,
): string {
  const { revision: _revision, ...content } = catalog as BlockLibraryCatalog;
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(content)))
    .digest("hex");
}

export function sanitizeBlockLibraryCatalog(value: unknown): BlockLibraryCatalog {
  const source = recordValue(value, "catalog");
  if (source.schemaVersion !== BLOCK_LIBRARY_SCHEMA_VERSION) {
    return validationError(
      "catalog.schemaVersion",
      `chỉ hỗ trợ phiên bản ${BLOCK_LIBRARY_SCHEMA_VERSION}`,
    );
  }
  if (!Array.isArray(source.sources)) {
    return validationError("catalog.sources", "phải là mảng");
  }
  if (source.sources.length > MAX_SOURCES) {
    return validationError("catalog.sources", `không được quá ${MAX_SOURCES} phần tử`);
  }
  if (!Array.isArray(source.blocks)) {
    return validationError("catalog.blocks", "phải là mảng");
  }
  if (source.blocks.length > MAX_BLOCKS) {
    return validationError("catalog.blocks", `không được quá ${MAX_BLOCKS} phần tử`);
  }
  const sources = source.sources.map(sanitizeLibrarySource);
  const blocks = source.blocks.map(sanitizeBlockDefinition);
  assertUniqueIds(sources, "catalog.sources");
  assertUniqueIds(blocks, "catalog.blocks");
  const sourceIds = new Set(sources.map((item) => item.id));
  for (const block of blocks) {
    if (block.sourceId && !sourceIds.has(block.sourceId)) {
      return validationError(
        "catalog.blocks.sourceId",
        `không tìm thấy nguồn ${block.sourceId} cho block ${block.id}`,
      );
    }
  }
  const withoutRevision: Omit<BlockLibraryCatalog, "revision"> = {
    schemaVersion: BLOCK_LIBRARY_SCHEMA_VERSION,
    sources,
    blocks,
  };
  return {
    ...withoutRevision,
    revision: calculateBlockLibraryRevision(withoutRevision),
  };
}

export function emptyBlockLibraryCatalog(): BlockLibraryCatalog {
  return sanitizeBlockLibraryCatalog({
    schemaVersion: BLOCK_LIBRARY_SCHEMA_VERSION,
    sources: [],
    blocks: [],
  });
}

export function resolveBlockLibraryDataDir(
  options: BlockLibraryStorageOptions = {},
): string {
  if (options.dataDir?.trim()) return options.dataDir.trim();
  const configured = (options.env ?? process.env).ACAD_DATA_DIR?.trim();
  if (configured) return configured;
  /* Đường lùi về kho THẬT. Xem `assertNotRealStoreInTests()` — script kiểm thử
     tới được đây nghĩa là nó quên truyền `dataDir`, và lần trước điều đó đã xoá
     mất dữ liệu thật của người dùng. */
  assertNotRealStoreInTests("Kho thư viện block");
  return join(
    options.homeDir ?? homedir(),
    "Library",
    "Application Support",
    "acad-studio",
  );
}

export function blockLibraryFilePath(
  options: BlockLibraryStorageOptions = {},
): string {
  return join(resolveBlockLibraryDataDir(options), BLOCK_LIBRARY_FILE_NAME);
}

function writeCatalogAtomic(
  catalog: BlockLibraryCatalog,
  options: BlockLibraryStorageOptions,
): void {
  const dataDir = resolveBlockLibraryDataDir(options);
  const filePath = join(dataDir, BLOCK_LIBRARY_FILE_NAME);
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  mkdirSync(dataDir, { recursive: true });
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(catalog, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporaryPath, filePath);
  } catch (error) {
    if (existsSync(temporaryPath)) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // Preserve the original persistence error.
      }
    }
    throw error;
  }
}

export function loadBlockLibraryCatalog(
  options: BlockLibraryStorageOptions = {},
): BlockLibraryCatalog {
  const filePath = blockLibraryFilePath(options);
  if (!existsSync(filePath)) return emptyBlockLibraryCatalog();
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    throw new BlockLibraryValidationError(
      `Không đọc được ${BLOCK_LIBRARY_FILE_NAME}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return sanitizeBlockLibraryCatalog(parsed);
}

export function saveBlockLibraryCatalog(
  value: unknown,
  expectedRevision?: string,
  options: BlockLibraryStorageOptions = {},
): BlockLibraryCatalog {
  if (expectedRevision != null) {
    const current = loadBlockLibraryCatalog(options);
    if (current.revision !== expectedRevision) {
      throw new BlockLibraryConflictError(
        "Block library đã thay đổi; hãy tải lại trước khi lưu.",
      );
    }
  }
  const catalog = sanitizeBlockLibraryCatalog(value);
  writeCatalogAtomic(catalog, options);
  return catalog;
}

export function upsertBlockDefinition(
  value: unknown,
  expectedRevision: string,
  options: BlockLibraryStorageOptions = {},
): BlockLibraryCatalog {
  const catalog = loadBlockLibraryCatalog(options);
  if (catalog.revision !== expectedRevision) {
    throw new BlockLibraryConflictError(
      "Block library đã thay đổi; hãy tải lại trước khi lưu.",
    );
  }
  const block = sanitizeBlockDefinition(value);
  const index = catalog.blocks.findIndex((item) => item.id === block.id);
  if (index >= 0) catalog.blocks[index] = block;
  else catalog.blocks.push(block);
  return saveBlockLibraryCatalog(catalog, expectedRevision, options);
}

export function upsertLibrarySource(
  value: unknown,
  expectedRevision: string,
  options: BlockLibraryStorageOptions = {},
): BlockLibraryCatalog {
  const catalog = loadBlockLibraryCatalog(options);
  if (catalog.revision !== expectedRevision) {
    throw new BlockLibraryConflictError(
      "Block library đã thay đổi; hãy tải lại trước khi lưu.",
    );
  }
  const source = sanitizeLibrarySource(value);
  const index = catalog.sources.findIndex((item) => item.id === source.id);
  if (index >= 0) catalog.sources[index] = source;
  else catalog.sources.push(source);
  return saveBlockLibraryCatalog(catalog, expectedRevision, options);
}

export function findBlockDuplicateGroups(
  blocks: BlockDefinition[],
): BlockDuplicateGroup[] {
  const groups: BlockDuplicateGroup[] = [];
  const collect = (
    reason: BlockDuplicateGroup["reason"],
    keyFor: (block: BlockDefinition) => string | undefined,
  ): void => {
    const byKey = new Map<string, string[]>();
    for (const block of blocks) {
      const key = keyFor(block)?.trim().toLocaleLowerCase("en-US");
      if (!key) continue;
      const ids = byKey.get(key) ?? [];
      ids.push(block.id);
      byKey.set(key, ids);
    }
    for (const [key, blockIds] of byKey) {
      if (blockIds.length > 1) {
        groups.push({ reason, key, blockIds: [...blockIds].sort() });
      }
    }
  };
  collect("name_collision", (block) => block.technicalName);
  collect("geometry_fingerprint", (block) => block.geometryFingerprint);
  return groups.sort((a, b) =>
    a.reason.localeCompare(b.reason) || a.key.localeCompare(b.key));
}

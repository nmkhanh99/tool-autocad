/**
 * Shared file-bridge contract (daemon ↔ AutoLISP ↔ ObjectARX).
 *
 * Primary product identity is domain-agnostic:
 *   ~/Acad-Bridge/job.lsp · raw.job · results/ · docs.*
 *
 * Legacy MEP-Bridge / mep_job.lsp names remain readable as aliases only.
 * Keep this module free of Express / CAD process I/O so unit tests can
 * exercise path resolution + atomic writers without a live session.
 */
import { existsSync, mkdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

/** Primary bridge directory name under $HOME. */
export const BRIDGE_DIR_NAME = "Acad-Bridge";
/** Legacy alias (one release) — still accepted if primary missing. */
export const LEGACY_BRIDGE_DIR_NAME = "MEP-Bridge";

/** Primary live-job LISP filename. */
export const JOB_LSP_NAME = "job.lsp";
/** Legacy alias filename still watched/written when needed. */
export const LEGACY_JOB_LSP_NAME = "mep_job.lsp";

export const RAW_JOB_NAME = "raw.job";
export const RAW_DONE_NAME = "raw.done";
export const DRAWING_INFO_REQUEST_NAME = "drawing-info.req";
export const DRAWING_INFO_RESPONSE_NAME = "drawing-info.json";
/** Hình học 2D để vẽ lên canvas. Tách khỏi `drawing-info` vì snapshot đó đã
 * 350 KB khi chưa có toạ độ nào — nhét hình học vào sẽ bắt mọi màn hình chỉ cần
 * số đếm phải kéo theo cả bản vẽ. */
export const GEOMETRY_REQUEST_NAME = "geometry.req";
export const GEOMETRY_RESPONSE_NAME = "geometry.json";
export const RESULTS_DIR_NAME = "results";

/** Autoloader package name (outer .bundle). */
export const PLUGIN_BUNDLE_NAME = "Acad-Bridge.bundle";
/** Flat ARX binary inside Contents/MacOS (exports acrxEntryPoint). */
export const PLUGIN_BINARY_NAME = "AcadBridge";
export const PLUGIN_BINARY_REL = `Contents/MacOS/${PLUGIN_BINARY_NAME}`;

/** Env vars — ACAD_* preferred; MEP_* accepted as alias. */
export function bridgeDirFromEnv(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const v = env.ACAD_BRIDGE_DIR || env.MEP_BRIDGE_DIR;
  return v && String(v).trim() ? String(v).trim() : undefined;
}

/**
 * Resolve bridge directory:
 * 1. ACAD_BRIDGE_DIR / MEP_BRIDGE_DIR env
 * 2. ~/Acad-Bridge if it exists (or neither primary nor legacy exists → create primary)
 * 3. ~/MEP-Bridge if primary missing but legacy exists (compat)
 */
export function resolveBridgeDir(opts?: {
  home?: string;
  env?: NodeJS.ProcessEnv;
}): string {
  const home = opts?.home ?? homedir();
  const fromEnv = bridgeDirFromEnv(opts?.env ?? process.env);
  if (fromEnv) return fromEnv;
  const primary = join(home, BRIDGE_DIR_NAME);
  const legacy = join(home, LEGACY_BRIDGE_DIR_NAME);
  if (existsSync(primary)) return primary;
  if (existsSync(legacy)) return legacy;
  return primary;
}

export function jobLspPath(bridgeDir: string): string {
  return join(bridgeDir, JOB_LSP_NAME);
}

export function legacyJobLspPath(bridgeDir: string): string {
  return join(bridgeDir, LEGACY_JOB_LSP_NAME);
}

export function rawJobPath(bridgeDir: string): string {
  return join(bridgeDir, RAW_JOB_NAME);
}

export function rawDonePath(bridgeDir: string): string {
  return join(bridgeDir, RAW_DONE_NAME);
}

export function drawingInfoRequestPath(bridgeDir: string): string {
  return join(bridgeDir, DRAWING_INFO_REQUEST_NAME);
}

export function drawingInfoResponsePath(bridgeDir: string): string {
  return join(bridgeDir, DRAWING_INFO_RESPONSE_NAME);
}

export function geometryRequestPath(bridgeDir: string): string {
  return join(bridgeDir, GEOMETRY_REQUEST_NAME);
}

export function geometryResponsePath(bridgeDir: string): string {
  return join(bridgeDir, GEOMETRY_RESPONSE_NAME);
}

export function resultsDir(bridgeDir: string): string {
  return join(bridgeDir, RESULTS_DIR_NAME);
}

/** Ensure bridge + results/ exist; returns results path. */
export function ensureBridgeLayout(bridgeDir?: string): string {
  const dir = bridgeDir ?? resolveBridgeDir();
  const results = resultsDir(dir);
  mkdirSync(results, { recursive: true });
  return results;
}

/**
 * Atomic write (temp + rename on same volume).
 * Required so FSEvents watchers never observe a half-written job/raw file.
 */
export function atomicWriteFile(path: string, content: string): void {
  const tmp = `${path}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

/** Product-facing labels (no MEP identity). */
export const PRODUCT = {
  plugin: "AcadBridge",
  bridgeHomeHint: `~/${BRIDGE_DIR_NAME}`,
  jobHint: JOB_LSP_NAME,
  runCommand: "ACAD-RUN",
  arxCommand: "ACADARX",
} as const;

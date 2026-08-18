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
/** Chặn một script TEST lùi về kho dữ liệu THẬT của người dùng.
 *
 * Ngày 2026-08-17 một script đo hành vi xoá đã xoá hồ sơ quy chuẩn thật của
 * người dùng: nó truyền `{ dir }` thay vì `{ dataDir }`, hàm giải đường dẫn bỏ
 * qua khoá lạ trong im lặng rồi lùi về `~/Library/Application Support/acad-studio`.
 * Không có bản sao nào để lấy lại.
 *
 * Phép kiểm khoá-lạ đã thêm sau đó chỉ bắt ca GÕ NHẦM TÊN. Ca còn hở — và là ca
 * dễ xảy ra hơn — là **quên truyền tuỳ chọn hoàn toàn**: khi đó mọi thứ hợp lệ
 * về kiểu, và đường lùi đưa thẳng vào dữ liệu thật.
 *
 * Nhận diện bằng `argv[1]`: mọi script kiểm thử của dự án chạy dưới dạng
 * `scripts/test-*.mjs`, còn daemon thật chạy `src/server.ts`. Thô, nhưng nó
 * đúng cho đúng cái nhóm đã gây ra mất mát, và nó KHÔNG đụng gì tới đường chạy
 * thật.
 *
 * Đặt ở đây vì cả ba kho (hồ sơ quy chuẩn, thư viện block, thư viện LISP) đều
 * cần — mỗi kho tự chép một bản là sớm muộn có bản quên. */
export function assertNotRealStoreInTests(what: string): void {
  const entry = process.argv[1] ?? "";
  if (!/[/\\]scripts[/\\]test-[^/\\]*\.(mjs|ts)$/.test(entry)) return;
  throw new Error(
    `${what}: script kiểm thử không được dùng kho dữ liệu thật của người dùng. `
    + "Truyền `dataDir` (hoặc đặt ACAD_DATA_DIR) trỏ vào một thư mục tạm. "
    + "Ngày 2026-08-17 đúng đường lùi này đã xoá mất hồ sơ quy chuẩn thật.",
  );
}

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

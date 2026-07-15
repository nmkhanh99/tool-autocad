/**
 * Daemon-side raw ObjectARX invoke: write raw.job → wait raw.done.
 * Uses the same pure builder as unit tests (real shipped path).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  buildRawJob,
  defaultParamsFor,
  parseRawResult,
  validateRawInvoke,
  type RawJobRequest,
  type RawParams,
  type RawResult,
} from "./rawJob.js";
import {
  byCapabilityId,
  capabilitiesByGroup,
  coverageSummary,
  macAvailableCapabilities,
  RAW_CAPABILITIES,
  type RawCapability,
} from "./catalog.js";

const BRIDGE_DIR = process.env.MEP_BRIDGE_DIR || join(homedir(), "MEP-Bridge");
const RAW_JOB = join(BRIDGE_DIR, "raw.job");
const RAW_DONE = join(BRIDGE_DIR, "raw.done");

function ensureBridge(): void {
  mkdirSync(BRIDGE_DIR, { recursive: true });
}

function atomicWrite(path: string, content: string): void {
  const tmp = `${path}.${randomUUID().slice(0, 6)}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

export function exportRawCatalog() {
  const byGroup = capabilitiesByGroup();
  const summary = coverageSummary();
  return {
    ok: true,
    summary,
    groups: Object.fromEntries(
      Object.entries(byGroup).map(([g, items]) => [
        g,
        items.map((c) => ({
          id: c.id,
          name: c.name,
          api: c.api,
          catalogStatus: c.catalogStatus,
          macAvailable: c.macAvailable,
          enabled: c.enabled,
          interactive: c.interactive,
          handler: c.handler,
          verificationKind: c.verificationKind,
          reason: c.reason,
          defaultParams: c.enabled ? defaultParamsFor(c.id) : {},
        })),
      ]),
    ),
    capabilities: RAW_CAPABILITIES,
  };
}

export type InvokeOptions = {
  waitMs?: number;
  /** When true, only validate + build job body — do not touch AutoCAD (tests / dry-run). */
  dryRun?: boolean;
  /** Caller already checked AutoCAD is running. */
  acadRunning?: boolean;
};

/**
 * Invoke a raw capability. Real path:
 *  1. Catalog validation (disabled → structured blocked)
 *  2. Build raw.job via shipped builder
 *  3. Unless dryRun: write bridge file, poll raw.done
 */
export async function invokeRaw(
  req: RawJobRequest,
  opts: InvokeOptions = {},
): Promise<RawResult & { jobBody?: string; dryRun?: boolean }> {
  const id = String(req.id || "").trim();
  const { cap, preflight } = validateRawInvoke({ ...req, id });
  if (preflight) return preflight;

  const params: RawParams = {
    ...defaultParamsFor(id),
    ...(req.params || {}),
  };
  const jobReq: RawJobRequest = { id, target: req.target, params };
  const jobBody = buildRawJob(jobReq);

  if (opts.dryRun) {
    return {
      ok: true,
      id,
      dryRun: true,
      jobBody,
      payload: {
        name: cap!.name,
        group: cap!.group,
        interactive: cap!.interactive,
        handler: cap!.handler,
        params,
      },
      diagnostic: "dry_run",
    };
  }

  // Interactive ops still need AutoCAD; if not running → blocked (honest).
  if (opts.acadRunning === false) {
    return {
      ok: false,
      id,
      blocked: true,
      interactive: cap!.interactive,
      error: "AutoCAD chưa chạy — không thể gọi ObjectARX live",
      diagnostic: "autocad_not_running",
      payload: { name: cap!.name, api: cap!.api, interactive: cap!.interactive },
    };
  }

  ensureBridge();
  const before = Date.now();
  // Clear stale done so we don't read an old result.
  try {
    writeFileSync(RAW_DONE + ".stamp", String(before), "utf8");
  } catch { /* */ }
  atomicWrite(RAW_JOB, jobBody);

  const waitMs = opts.waitMs ?? (cap!.interactive ? 120_000 : 8_000);
  while (Date.now() - before < waitMs) {
    try {
      const st = statSync(RAW_DONE);
      if (st.mtimeMs >= before - 50) {
        const text = readFileSync(RAW_DONE, "utf8");
        const result = parseRawResult(text);
        // Ignore stale result from a previous job with different id
        if (result.id === id || result.id === "*") return result;
      }
    } catch { /* not yet */ }
    await new Promise((r) => setTimeout(r, 120));
  }

  return {
    ok: false,
    id,
    blocked: true,
    interactive: cap!.interactive,
    error: cap!.interactive
      ? "Timeout — lệnh interactive cần người dùng thao tác trong AutoCAD (plugin có thể đã mở prompt)."
      : "Plugin không phản hồi raw.done — khởi động lại AutoCAD để nạp plugin raw, hoặc kiểm tra MepBridge.",
    diagnostic: "plugin_timeout",
    jobBody,
    payload: { name: cap!.name, api: cap!.api },
  };
}

export function getCapability(id: string): RawCapability | undefined {
  return byCapabilityId(id);
}

export function listMacIds(): string[] {
  return macAvailableCapabilities().map((c) => c.id);
}

export { BRIDGE_DIR, RAW_JOB, RAW_DONE };

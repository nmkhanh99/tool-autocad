/**
 * Live on-AutoCAD preview: stage geometry on layer MEP-PREVIEW (plugin native.job),
 * then APPLY (promote to permanent layers) or REJECT (erase) only after app confirm.
 *
 * Concurrency: every job carries TOKEN; waitNativeDone only accepts native.done that
 * echoes the same token+mode+opId — never a stale previous reply.
 */
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

export const PREVIEW_LAYER = "MEP-PREVIEW";
export const PREVIEW_ACI = 30;

/** System name → permanent layer (same map as native commit path). */
export const STD_LAYER_COLOR: Record<string, number> = {
  "P-ThoatXi": 190,
  "P-ThoatRua": 50,
  "P-ThongHoi": 5,
  "DCCD-nuoclanh": 90,
  "P-ThietBi": 2,
  "MEP-GHICHU": 2,
};

export function sysToLayer(s: string): string {
  const u = String(s).toUpperCase();
  if (/XI/.test(u)) return "P-ThoatXi";
  if (/RUA|RỬA/.test(u)) return "P-ThoatRua";
  if (/HOI|HƠI/.test(u)) return "P-ThongHoi";
  if (/CAP|NUOC|CẤP/.test(u)) return "DCCD-nuoclanh";
  return s;
}

export type PipeSpec = { system: string; dn?: number; points: number[][] };

export type LiveOpState = "staged" | "applied" | "rejected";
export type LiveOp = {
  opId: string;
  recipe: string;
  target: string;
  state: LiveOpState;
  params: { pipes?: PipeSpec[] };
  count?: number;
  handles?: string[];
  createdAt: number;
};

const ops = new Map<string, LiveOp>();

export function __resetLiveOpsForTests(): void {
  ops.clear();
}

export function getLiveOp(opId: string): LiveOp | undefined {
  return ops.get(opId);
}

export function listLiveOps(): LiveOp[] {
  return [...ops.values()];
}

export function newJobToken(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

/** Build native.job body for PREVIEW mode (entities on MEP-PREVIEW, XDATA opId+dest). */
export function buildLivePreviewJob(opts: {
  opId: string;
  token: string;
  target?: string;
  pipes: PipeSpec[];
}): string {
  const { opId, token, target = "", pipes } = opts;
  if (!opId) throw new Error("opId required");
  if (!token) throw new Error("token required");
  if (!Array.isArray(pipes) || !pipes.length) throw new Error("pipes required");
  const lines: string[] = [`MODE\tPREVIEW`, `OPID\t${opId}`, `TOKEN\t${token}`];
  if (target) lines.push(`TARGET\t${target}`);
  lines.push(`LAYER\t${PREVIEW_LAYER}\t${PREVIEW_ACI}`);
  const seen = new Set<string>();
  for (const p of pipes) {
    const dest = sysToLayer(p.system);
    if (!seen.has(dest)) {
      lines.push(`LAYER\t${dest}\t${STD_LAYER_COLOR[dest] ?? 0}`);
      seen.add(dest);
    }
    const pts = (p.points || []).map((pt) => `${pt[0]},${pt[1]}`).join(" ");
    lines.push(`PIPE\t${dest}\t${Number(p.dn) || 90}\t${p.system}\t${pts}`);
  }
  return lines.join("\n");
}

export function buildLiveApplyJob(opId: string, token: string, target?: string): string {
  if (!token) throw new Error("token required");
  const lines = [`MODE\tAPPLY`, `OPID\t${opId}`, `TOKEN\t${token}`];
  if (target) lines.push(`TARGET\t${target}`);
  return lines.join("\n");
}

export function buildLiveRejectJob(opId: string, token: string, target?: string): string {
  if (!token) throw new Error("token required");
  const lines = [`MODE\tREJECT`, `OPID\t${opId}`, `TOKEN\t${token}`];
  if (target) lines.push(`TARGET\t${target}`);
  return lines.join("\n");
}

export type NativeDone = {
  ok: boolean;
  mode?: string;
  opId?: string;
  token?: string;
  count: number;
  handles?: string[];
  layer?: string;
  committed?: boolean;
  discarded?: boolean;
  error?: string;
  raw?: string;
};

/** Parse plugin native.done — JSON preferred; bare integer still accepted (legacy COMMIT only). */
export function parseNativeDone(text: string): NativeDone {
  const s = String(text || "").trim();
  if (!s) return { ok: false, count: 0, error: "empty native.done" };
  if (s.startsWith("{")) {
    try {
      const o = JSON.parse(s) as NativeDone;
      if (typeof o.count !== "number") o.count = Number(o.count) || 0;
      if (typeof o.ok !== "boolean") o.ok = !o.error;
      return o;
    } catch {
      return { ok: false, count: 0, error: "invalid JSON native.done", raw: s };
    }
  }
  const n = Number(s);
  if (Number.isFinite(n)) return { ok: true, count: n, mode: "COMMIT" };
  return { ok: false, count: 0, error: "unrecognized native.done", raw: s };
}

export type WaitExpect = {
  token: string;
  mode: string;
  opId?: string;
};

/**
 * True when this done is a fresh reply for the job we just wrote.
 * Requires matching token (and mode; opId when expected).
 */
export function matchesNativeDone(done: NativeDone, expect: WaitExpect): boolean {
  if (!done || !expect?.token) return false;
  if (done.token !== expect.token) return false;
  if (String(done.mode || "").toUpperCase() !== String(expect.mode).toUpperCase()) return false;
  if (expect.opId != null && expect.opId !== "" && done.opId !== expect.opId) return false;
  return true;
}

const BRIDGE = () => process.env.MEP_BRIDGE_DIR || join(homedir(), "MEP-Bridge");

function atomicWrite(path: string, content: string): void {
  mkdirSync(BRIDGE(), { recursive: true });
  const tmp = `${path}.${randomUUID().slice(0, 6)}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

/** Invalidate any previous native.done so we never race on mtime alone. */
function clearNativeDone(): void {
  try {
    rmSync(join(BRIDGE(), "native.done"), { force: true });
  } catch {
    /* */
  }
}

/**
 * Wait until native.done matches expect.token (+ mode/opId).
 * Never returns a stale previous job's result.
 */
export async function waitNativeDone(
  expect: WaitExpect,
  waitMs = 12000,
): Promise<NativeDone> {
  const doneFile = join(BRIDGE(), "native.done");
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) {
    try {
      const done = parseNativeDone(readFileSync(doneFile, "utf8"));
      if (matchesNativeDone(done, expect)) return done;
    } catch {
      /* not yet or unreadable */
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  return {
    ok: false,
    count: 0,
    error: `Plugin không phản hồi native.done (token=${expect.token} mode=${expect.mode}) — restart AutoCAD / APPLOAD MepBridge.`,
  };
}

/** Write job after clearing done; return the token used. */
export async function runNativeJob(
  body: string,
  expect: WaitExpect,
  waitMs?: number,
): Promise<NativeDone> {
  clearNativeDone();
  // small yield so FS watchers see delete before create
  await new Promise((r) => setTimeout(r, 30));
  atomicWrite(join(BRIDGE(), "native.job"), body);
  return waitNativeDone(expect, waitMs ?? 12000);
}

export type StageResult =
  | {
      ok: true;
      opId: string;
      live: true;
      count: number;
      handles: string[];
      layer: string;
      committed: false;
      target: string;
      hint: string;
    }
  | { ok: false; error: string };

/**
 * Stage a live preview in the open AutoCAD session (visible, not accepted).
 * Prior staged ops are REJECTED on CAD first (no orphan MEP-PREVIEW entities).
 */
export async function stageLivePreview(opts: {
  pipes: PipeSpec[];
  target?: string;
  recipe?: string;
  waitMs?: number;
}): Promise<StageResult> {
  const pipes = opts.pipes;
  if (!Array.isArray(pipes) || !pipes.length) return { ok: false, error: "Thiếu pipes" };

  const target = opts.target || "";
  // Discard any prior staged live op in CAD + registry (prevents orphans).
  const prior = [...ops.values()].filter((o) => o.state === "staged");
  for (const o of prior) {
    await rejectLivePreview(o.opId, opts.waitMs ?? 12000).catch(() => null);
  }

  const opId = randomUUID().slice(0, 8);
  const token = newJobToken();
  const body = buildLivePreviewJob({ opId, token, target, pipes });
  const done = await runNativeJob(body, { token, mode: "PREVIEW", opId }, opts.waitMs ?? 12000);
  if (!done.ok) return { ok: false, error: done.error || "native preview failed" };
  if (done.count < 1) {
    return { ok: false, error: `Preview không tạo entity (count=${done.count})` };
  }
  ops.set(opId, {
    opId,
    recipe: opts.recipe || "drawpipes",
    target,
    state: "staged",
    params: { pipes },
    count: done.count,
    handles: done.handles || [],
    createdAt: Date.now(),
  });
  return {
    ok: true,
    opId,
    live: true,
    count: done.count,
    handles: done.handles || [],
    layer: PREVIEW_LAYER,
    committed: false,
    target,
    hint: `✓ Preview trên AutoCAD (layer ${PREVIEW_LAYER}, ${done.count} đối tượng). Chưa commit — bấm Chấp nhận / Không chấp nhận.`,
  };
}

export type CommitResult =
  | { ok: true; applied: string; count: number; handles: string[]; committed: true }
  | { ok: false; error: string };

export async function applyLivePreview(opId: string, waitMs = 12000): Promise<CommitResult> {
  const op = ops.get(opId);
  if (!op || op.state !== "staged") return { ok: false, error: "Không có live op staged để apply" };
  const expectedMin = Math.max(1, op.count || 1);
  const token = newJobToken();
  const body = buildLiveApplyJob(opId, token, op.target);
  const done = await runNativeJob(body, { token, mode: "APPLY", opId }, waitMs);
  if (!done.ok) return { ok: false, error: done.error || "apply failed" };
  if (String(done.mode).toUpperCase() !== "APPLY" || done.opId !== opId) {
    return { ok: false, error: `apply reply mismatch mode=${done.mode} opId=${done.opId}` };
  }
  if (done.count < expectedMin) {
    return {
      ok: false,
      error: `apply count=${done.count} < expected ${expectedMin} — preview geometry not promoted`,
    };
  }
  op.state = "applied";
  op.count = done.count;
  op.handles = done.handles || op.handles;
  return { ok: true, applied: opId, count: done.count, handles: done.handles || [], committed: true };
}

export type DiscardResult =
  | { ok: true; rejected: string; count: number; discarded: true }
  | { ok: false; error: string };

export async function rejectLivePreview(opId: string, waitMs = 12000): Promise<DiscardResult> {
  const op = ops.get(opId);
  if (!op || op.state !== "staged") return { ok: false, error: "Không có live op staged để reject" };
  const token = newJobToken();
  const body = buildLiveRejectJob(opId, token, op.target);
  const done = await runNativeJob(body, { token, mode: "REJECT", opId }, waitMs);
  if (!done.ok) return { ok: false, error: done.error || "reject failed" };
  if (String(done.mode).toUpperCase() !== "REJECT" || done.opId !== opId) {
    return { ok: false, error: `reject reply mismatch mode=${done.mode} opId=${done.opId}` };
  }
  // count may be 0 if already erased; matching REJECT reply is enough for discard.
  op.state = "rejected";
  op.count = done.count;
  return { ok: true, rejected: opId, count: done.count, discarded: true };
}

/** Recipes that support live on-CAD preview via native plugin. */
export function supportsLiveCadPreview(recipe: string): boolean {
  return recipe === "drawpipes";
}

/**
 * Live on-AutoCAD preview: stage geometry on layer MEP-PREVIEW (plugin native.job),
 * then APPLY (promote to permanent layers) or REJECT (erase) only after app confirm.
 *
 * Concurrency: every job carries TOKEN; waitNativeDone only accepts native.done that
 * echoes the same token+mode+opId — never a stale previous reply.
 */
import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import {
  PRODUCT,
  atomicWriteFile,
  ensureBridgeLayout,
  resolveBridgeDir,
} from "./bridgeContract.js";

/** Sample preview layer for plumbing demos (profile/sample — not product identity). */
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
  params: {
    pipes?: PipeSpec[];
    /** native RECT | lisp outline fallback | named_lisp INSERT B_MBT* */
    channel?: "native" | "lisp" | "named_lisp";
    previewLayer?: string;
    destLayer?: string;
    /** block name → permanent layer after apply */
    blockDestMap?: Record<string, string>;
    blockNames?: string[];
  };
  count?: number;
  handles?: string[];
  createdAt: number;
};

const ops = new Map<string, LiveOp>();

export function __resetLiveOpsForTests(): void {
  ops.clear();
}

export function __seedLiveOpForTests(op: LiveOp): void {
  ops.set(op.opId, op);
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

const BRIDGE = () => resolveBridgeDir();

function atomicWrite(path: string, content: string): void {
  ensureBridgeLayout(BRIDGE());
  atomicWriteFile(path, content);
}

/** Invalidate any previous native.done so we never race on mtime alone. */
function clearNativeDone(): void {
  try {
    rmSync(join(BRIDGE(), "native.done"), { force: true });
  } catch {
    /* */
  }
}

let nativeJobQueue: Promise<void> = Promise.resolve();

async function acquireNativeJobLock(): Promise<() => void> {
  const previous = nativeJobQueue;
  let release!: () => void;
  nativeJobQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  return release;
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
    error: `Plugin không phản hồi native.done (token=${expect.token} mode=${expect.mode}) — restart AutoCAD / APPLOAD ${PRODUCT.plugin}.`,
  };
}

/** Write job after clearing done; return the token used. */
export async function runNativeJob(
  body: string,
  expect: WaitExpect,
  waitMs?: number,
): Promise<NativeDone> {
  const release = await acquireNativeJobLock();
  try {
    clearNativeDone();
    // small yield so FS watchers see delete before create
    await new Promise((r) => setTimeout(r, 30));
    atomicWrite(join(BRIDGE(), "native.job"), body);
    return await waitNativeDone(expect, waitMs ?? 12000);
  } finally {
    release();
  }
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
    const rejected = await rejectLivePreview(o.opId, opts.waitMs ?? 12000).catch((error) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    }));
    if (!rejected.ok) {
      return {
        ok: false,
        error: `Không thể dọn preview trước đó ${o.opId}: ${rejected.error}`,
      };
    }
  }

  const opId = randomUUID().replaceAll("-", "").slice(0, 24);
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

/**
 * Convert native RECT/TEXT/SYMBOL lines → AutoLISP RECTANG/TEXT/CIRCLE.
 * Used when running AutoCAD still has old plugin without RECT/SYMBOL.
 * Layer: unique MEP-PREVIEW-<opId> so apply/reject can ssget.
 */
export function nativePlanJobToLisp(
  body: string,
  previewLayer: string,
): { lisp: string; estimatedCount: number; destLayer: string } {
  const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  let destLayer = "0";
  let estimatedCount = 0;
  const cmds: string[] = [
    '(setvar "CMDECHO" 0)(setvar "FILEDIA" 0)',
    `(command "_.-LAYER" "_M" "${esc(previewLayer)}" "_C" "30" "" "")`,
    `(setvar "CLAYER" "${esc(previewLayer)}")`,
  ];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("MODE\t") || line.startsWith("OPID\t") || line.startsWith("TOKEN\t") || line.startsWith("TARGET\t"))
      continue;
    const t = line.split("\t");
    const op = t[0];
    if (op === "LAYER" && t[1] && t[1] !== PREVIEW_LAYER && t[1] !== previewLayer) {
      destLayer = t[1];
      continue;
    }
    if (op === "RECT" && t.length >= 6) {
      // RECT layer x1 y1 x2 y2 — layer field is dest when COMMIT; PREVIEW job uses MEP-PREVIEW
      if (t[1] && t[1] !== PREVIEW_LAYER && t[1] !== previewLayer) destLayer = t[1];
      cmds.push(`(command "_.RECTANG" "${t[2]},${t[3]}" "${t[4]},${t[5]}")`);
      estimatedCount++;
    } else if (op === "TEXT" && t.length >= 6) {
      const h = Math.max(50, Number(t[4]) || 200);
      const txt = esc(t.slice(5).join(" "));
      cmds.push(`(command "_.TEXT" "${t[2]},${t[3]}" "${h}" "0" "${txt}")`);
      estimatedCount++;
    } else if (op === "SYMBOL" && t.length >= 6) {
      const r = Math.max(50, Number(t[4]) || 100);
      const label = esc(t.slice(5).join("_"));
      cmds.push(
        `(command "_.CIRCLE" "${t[2]},${t[3]}" "${r}")`,
        `(command "_.TEXT" "${Number(t[2]) + r * 1.2},${t[3]}" "${r * 0.8}" "0" "${label}")`,
      );
      estimatedCount += 2;
    }
  }
  cmds.push(
    `(acad:write-result "ok" (strcat "plan_lisp=" (itoa ${estimatedCount}) " layer=${esc(previewLayer)}"))`,
  );
  return { lisp: cmds.join("\n") + "\n", estimatedCount, destLayer };
}

async function runLispPlanJob(
  lisp: string,
  target: string,
  waitMs: number,
): Promise<{ ok: boolean; jobId?: string; message?: string; error?: string }> {
  // Dynamic import avoids circular dep (acadBridge imports livePreview)
  const bridge = await import("./acadBridge.js");
  const dispatched = await bridge.dispatchLiveJob(lisp, target || undefined, waitMs);
  if (dispatched.result) {
    const ok = dispatched.result.status === "ok";
    return {
      ok,
      jobId: dispatched.jobId,
      message: dispatched.result.message,
      error: ok ? undefined : dispatched.result.message,
    };
  }
  return {
    ok: false,
    jobId: dispatched.jobId,
    error: "LISP plan job timeout — plugin may not be loading job.lsp",
  };
}

type LispPlanJobRunner = typeof runLispPlanJob;
let lispPlanJobRunner: LispPlanJobRunner = runLispPlanJob;

export function __setLispPlanJobRunnerForTests(runner?: LispPlanJobRunner): void {
  lispPlanJobRunner = runner ?? runLispPlanJob;
}

/**
 * Stage plan blocks on CAD.
 * Primary (when instances given): named INSERT B_MBT* / B_HienTrang on preview layer
 *   → apply CHPROP to dest layers (re-read shows named blocks).
 * Optional nativeJobBody: RECT/TEXT/SYMBOL visual only (does not create named INSERTs).
 * Same wait-apply contract as pipes.
 */
export async function stagePlanBlockPreview(opts: {
  /** Prefer named INSERT path (demo-flow plan steps). */
  instances?: import("./planBlockLibrary.js").PlanBlockInstance[];
  metrics?: import("./planBlockLibrary.js").PlanBlockLibrary["metrics"];
  /** Optional visual RECT job (secondary; not sufficient for named re-read). */
  nativeJobBody?: string;
  target?: string;
  recipe?: string;
  waitMs?: number;
  meta?: Record<string, unknown>;
}): Promise<StageResult> {
  const target = opts.target || "";
  const prior = [...ops.values()].filter((o) => o.state === "staged");
  for (const o of prior) {
    const rejected = await rejectLivePreview(o.opId, opts.waitMs ?? 12000).catch((error) => ({
      ok: false as const,
      error: error instanceof Error ? error.message : String(error),
    }));
    if (!rejected.ok) {
      return {
        ok: false,
        error: `Không thể dọn preview trước đó ${o.opId}: ${rejected.error}`,
      };
    }
  }
  const opId = randomUUID().replaceAll("-", "").slice(0, 24);
  const instances = opts.instances || [];

  // ── Primary: named block DEFINE + INSERT on preview layer ──
  if (instances.length > 0) {
    const { buildNamedPlanStageLisp } = await import("./planBlockLibrary.js");
    const previewLayer = `${PREVIEW_LAYER}-${opId}`;
    const { lisp, insertCount, blockDestMap } = buildNamedPlanStageLisp(
      instances,
      previewLayer,
      opts.metrics,
    );
    if (insertCount < 1) {
      return { ok: false, error: "named plan stage: no instances to INSERT" };
    }
    const lispRes = await lispPlanJobRunner(lisp, target, opts.waitMs ?? 45000);
    if (!lispRes.ok) {
      return {
        ok: false,
        error: lispRes.error || "named plan INSERT stage failed",
      };
    }
    const names = [...new Set(instances.map((i) => i.name))];
    ops.set(opId, {
      opId,
      recipe: opts.recipe || "planblocks",
      target,
      state: "staged",
      params: {
        ...(opts.meta || {}),
        channel: "named_lisp",
        previewLayer,
        blockDestMap,
        blockNames: names,
      },
      count: insertCount,
      handles: [],
      createdAt: Date.now(),
    });
    return {
      ok: true,
      opId,
      live: true,
      count: insertCount,
      handles: [],
      layer: previewLayer,
      committed: false,
      target,
      hint:
        `✓ Preview named plan INSERT (${insertCount}: ${names.join(", ")}) layer ${previewLayer}. ` +
        `Re-read after Chấp nhận will show block names. **Chờ Chấp nhận.**`,
    };
  }

  // ── Secondary: native RECT / LISP outline (no named INSERT) ──
  const body = opts.nativeJobBody || "";
  if (!body || (!body.includes("RECT\t") && !body.includes("TEXT\t") && !body.includes("SYMBOL\t"))) {
    return { ok: false, error: "Thiếu instances (named INSERT) hoặc RECT/TEXT/SYMBOL plan-block job" };
  }
  const token = newJobToken();
  let lines = body.split("\n").filter((l) => l.trim());
  lines = lines.filter(
    (l) =>
      !l.startsWith("MODE\t") &&
      !l.startsWith("OPID\t") &&
      !l.startsWith("TOKEN\t") &&
      !l.startsWith("TARGET\t"),
  );
  const head = [
    "MODE\tPREVIEW",
    `OPID\t${opId}`,
    `TOKEN\t${token}`,
    ...(target ? [`TARGET\t${target}`] : []),
  ];
  const full = [...head, ...lines].join("\n") + "\n";
  const done = await runNativeJob(full, { token, mode: "PREVIEW", opId }, opts.waitMs ?? 15000);

  if (done.ok && done.count >= 1) {
    ops.set(opId, {
      opId,
      recipe: opts.recipe || "planblocks",
      target,
      state: "staged",
      params: { ...(opts.meta || {}), channel: "native" },
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
      hint: `✓ Preview mặt bằng (${done.count} entity: RECT/TEXT/SYMBOL only — not named INSERT). Chưa commit.`,
    };
  }

  const previewLayer = `${PREVIEW_LAYER}-${opId}`;
  const { lisp, estimatedCount, destLayer } = nativePlanJobToLisp(full, previewLayer);
  if (estimatedCount < 1) {
    return {
      ok: false,
      error:
        done.error ||
        `Plan preview count=0 — provide instances for named INSERT or rebuild plugin (RECT/SYMBOL)`,
    };
  }
  const lispRes = await lispPlanJobRunner(lisp, target, opts.waitMs ?? 25000);
  if (!lispRes.ok) {
    return {
      ok: false,
      error: lispRes.error || done.error || "Plan stage failed",
    };
  }
  ops.set(opId, {
    opId,
    recipe: opts.recipe || "planblocks",
    target,
    state: "staged",
    params: {
      ...(opts.meta || {}),
      channel: "lisp",
      previewLayer,
      destLayer: destLayer || "RSA -HACK",
    },
    count: estimatedCount,
    handles: [],
    createdAt: Date.now(),
  });
  return {
    ok: true,
    opId,
    live: true,
    count: estimatedCount,
    handles: [],
    layer: previewLayer,
    committed: false,
    target,
    hint: `✓ Preview outline via LISP (${estimatedCount} entity) — not named INSERT. Prefer instances path.`,
  };
}

export type CommitResult =
  | { ok: true; applied: string; count: number; handles: string[]; committed: true }
  | { ok: false; error: string };

export async function applyLivePreview(opId: string, waitMs = 12000): Promise<CommitResult> {
  const op = ops.get(opId);
  if (!op || op.state !== "staged") return { ok: false, error: "Không có live op staged để apply" };

  // Named plan INSERT: CHPROP each INSERT to dest layer by block name map
  if (op.params?.channel === "named_lisp" && op.params.previewLayer && op.params.blockDestMap) {
    const { buildNamedPlanApplyLisp } = await import("./planBlockLibrary.js");
    const lisp = buildNamedPlanApplyLisp(
      String(op.params.previewLayer),
      op.params.blockDestMap as Record<string, string>,
    );
    const r = await lispPlanJobRunner(lisp, op.target, waitMs);
    if (!r.ok) return { ok: false, error: r.error || "named plan apply failed" };
    op.state = "applied";
    return { ok: true, applied: opId, count: op.count || 0, handles: [], committed: true };
  }

  // Outline LISP channel: CHPROP layer preview → dest
  if (op.params?.channel === "lisp" && op.params.previewLayer) {
    const pl = String(op.params.previewLayer).replace(/"/g, "");
    const dest = String(op.params.destLayer || "0").replace(/"/g, "");
    const lisp = `
(setvar "CMDECHO" 0)
(command "_.-LAYER" "_M" "${dest}" "")
(setq ss (ssget "_X" (list (cons 8 "${pl}"))))
(if ss
  (progn
    (command "_.CHPROP" ss "" "_LA" "${dest}" "")
    (acad:write-result "ok" (strcat "applied=" (itoa (sslength ss))))
  )
  (acad:write-result "ok" "applied=0")
)
`;
    const r = await lispPlanJobRunner(lisp, op.target, waitMs);
    if (!r.ok) return { ok: false, error: r.error || "LISP apply failed" };
    op.state = "applied";
    return { ok: true, applied: opId, count: op.count || 0, handles: [], committed: true };
  }

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

  if (
    (op.params?.channel === "lisp" || op.params?.channel === "named_lisp") &&
    op.params.previewLayer
  ) {
    const { buildNamedPlanRejectLisp } = await import("./planBlockLibrary.js");
    const lisp =
      op.params.channel === "named_lisp"
        ? buildNamedPlanRejectLisp(String(op.params.previewLayer))
        : `
(setvar "CMDECHO" 0)
(setq ss (ssget "_X" (list (cons 8 "${String(op.params.previewLayer).replace(/"/g, "")}"))))
(if ss
  (progn (command "_.ERASE" ss "") (acad:write-result "ok" (strcat "rejected=" (itoa (sslength ss)))))
  (acad:write-result "ok" "rejected=0")
)
`;
    const result = await lispPlanJobRunner(lisp, op.target, waitMs);
    if (!result.ok) {
      return {
        ok: false,
        error: result.error || "LISP reject failed",
      };
    }
    op.state = "rejected";
    return {
      ok: true,
      rejected: opId,
      count: op.count || 0,
      discarded: true,
    };
  }

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

/** Recipes that support live on-CAD preview via native plugin (or LISP fallback). */
export function supportsLiveCadPreview(recipe: string): boolean {
  return recipe === "drawpipes" || recipe === "planblocks";
}

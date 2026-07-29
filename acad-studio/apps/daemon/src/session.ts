/** Phiên vẽ có PREVIEW + ACCEPT/REJECT + ROLLBACK.
 * Nguyên tắc: file gốc CHỈ được COPY vào base.dwg (bất biến). Preview chạy trên
 * bản work (copy của current) → SAVEAS staged.dwg; current bất biến tới khi accept.
 * Diff geometry theo HANDLE. Accept = backup current + thay bằng staged (atomic).
 */
import { createHash, randomUUID } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, join } from "node:path";
import express, { type Router } from "express";
import {
  dispatchLiveJob,
  findCoreConsole,
  inlineLib,
  mepLib,
  runHeadless,
} from "./acadBridge.js";

/** Session root — overridable for tests via ACAD_SESSIONS_DIR / MEP_SESSIONS_DIR. */
export function sessionsRoot(): string {
  return (
    process.env.ACAD_SESSIONS_DIR ||
    process.env.MEP_SESSIONS_DIR ||
    join(homedir(), "Acad-Studio", "sessions")
  );
}

const esc = (p: string) => p.replace(/\\/g, "\\\\");

export type Geom = {
  h: string;
  t: string;
  l: string;
  p?: number[][];
  xy?: number[];
  tx?: string;
  c?: number[];
  r?: number;
  dn?: number;
};
export type OpState = "staged" | "applied" | "rejected";
export interface Op {
  opId: string;
  recipe: string;
  params: any;
  state: OpState;
  summary: any;
  backup?: string;
  createdAt: number;
}
export interface Session {
  id: string;
  dir: string;
  originalPath: string;
  head: string | null;
  ops: Op[];
}

export type GeomDiff = {
  added: Geom[];
  removed: Geom[];
  modified: Geom[];
  summary: { added: number; removed: number; modified: number };
};

/** Recipes that support sandbox preview→confirm. */
export const PREVIEW_RECIPES = [
  "drawpipes",
  "tagpipes",
  "numberpipes",
  "stdlayers",
  "titlefix",
  "qa",
  "copyfloor",
] as const;

const sessions = new Map<string, Session>();
const sdir = (id: string) => join(sessionsRoot(), id);

export function loadGeom(p: string): Geom[] {
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "latin1"));
  } catch {
    return [];
  }
}

const sig = (e: Geom) => JSON.stringify([e.t, e.l, e.p, e.xy, e.tx, e.c, e.r, e.dn]);

/** Diff geometry by durable AutoCAD HANDLE (DXF code 5). Exported for unit tests. */
export function diffGeoms(before: Geom[], after: Geom[]): GeomDiff {
  const bMap = new Map(before.map((e) => [e.h, e]));
  const aMap = new Map(after.map((e) => [e.h, e]));
  const added: Geom[] = [];
  const removed: Geom[] = [];
  const modified: Geom[] = [];
  for (const [h, e] of aMap) {
    if (!bMap.has(h)) added.push(e);
    else if (sig(e) !== sig(bMap.get(h)!)) modified.push(e);
  }
  for (const [h, e] of bMap) if (!aMap.has(h)) removed.push(e);
  return {
    added,
    removed,
    modified,
    summary: { added: added.length, removed: removed.length, modified: modified.length },
  };
}

/** Content fingerprint — used to prove preview does not mutate accepted/original files. */
export function fileFingerprint(path: string): string | null {
  if (!existsSync(path)) return null;
  const st = statSync(path);
  const hash = createHash("sha256").update(readFileSync(path)).digest("hex").slice(0, 16);
  return `${st.size}:${hash}`;
}

/** LISP THAO TÁC (dùng hàm mep_lib), KHÔNG kèm load/save — tái dùng cho preview & live. */
export function opLisp(recipe: string, params: any): string | null {
  switch (recipe) {
    case "drawpipes": {
      const pipes = params?.pipes;
      if (!Array.isArray(pipes) || !pipes.length) return null;
      const sysLayer = (s: string) => {
        const u = String(s).toUpperCase();
        if (/XI/.test(u)) return "P-ThoatXi";
        if (/RUA|RỬA/.test(u)) return "P-ThoatRua";
        if (/HOI|HƠI/.test(u)) return "P-ThongHoi";
        if (/CAP|NUOC|CẤP/.test(u)) return "DCCD-nuoclanh";
        return s;
      };
      const draws = pipes
        .map(
          (p: any) =>
            `(mep:draw-pipe "${sysLayer(p.system)}" ${Number(p.dn) || 90} (list ${(p.points || [])
              .map((pt: number[]) => `(list ${pt[0]} ${pt[1]})`)
              .join(" ")}))`,
        )
        .join("\n");
      return `(mep:std-layers)\n${draws}`;
    }
    case "tagpipes":
      return "(mep:tag-pipes)";
    case "numberpipes":
      return "(mep:number-pipes)";
    case "stdlayers":
      return "(mep:std-layers)";
    case "titlefix":
    case "titleform": {
      const kv = Object.entries(params || {})
        .map(([k, v]) => `(cons "${String(k).toUpperCase()}" "${esc(String(v))}")`)
        .join(" ");
      return kv ? `(mep:set-title (list ${kv}))` : null;
    }
    case "qa":
      return `(command "_.AUDIT" "_Y")\n(command "_.-OVERKILL" (ssget "_X") "" "")\n(command "_.-PURGE" "_All" "*" "_N")`;
    case "copyfloor": {
      const p = params || {};
      const dx = Number(p.dx) || 0;
      const dy = Number(p.dy) || 0;
      const times = Math.max(1, Math.min(20, Number(p.times) || 1));
      return `(setq ss (ssget "_X" '((8 . "P-*,DCCD*,MEP*,N-T*,DM-*"))))
(if (null ss) (princ "\\n[MEP] Khong tim thay doi tuong MEP de copy.")
  (progn (setq k 1)
    (repeat ${times}
      (command "_.COPY" ss "" (list 0 0) (list (* ${dx} k) (* ${dy} k)))
      (setq k (1+ k)))
    (princ (strcat "\\n[MEP] Da copy " (itoa (sslength ss)) " doi tuong x ${times}."))))`;
    }
    case "tagmeta": {
      const p = params || {};
      const v = (s: any) => esc(String(s ?? ""));
      return `(regapp "MEP_STUDIO")
(setq ss (cadr (ssgetfirst)))
(if (null ss) (setq ss (ssget "_I")))
(if ss (progn (setq i 0 n (sslength ss))
  (while (< i n) (setq en (ssname ss i) el (entget en))
    (entmod (append el (list (list -3 (list "MEP_STUDIO"
      (cons 1000 "sys=${v(p.sys)}") (cons 1000 "dn=${v(p.dn)}") (cons 1000 "mat=${v(p.mat)}"))))))
    (entupd en) (setq i (1+ i)))
  (princ (strcat "\\n[MEP] Da gan metadata cho " (itoa n) " doi tuong.")))
  (princ "\\n[MEP] Chua chon doi tuong nao."))`;
    }
    default:
      return null;
  }
}

/** Body cho PREVIEW headless: load lib → thao tác → SAVEAS staged → dump-geom. */
export function recipeBody(recipe: string, staged: string, params: any): string | null {
  const op = opLisp(recipe, params);
  if (!op) return null;
  const geo = staged.replace(/\.dwg$/i, ".json");
  return (
    `(load "${esc(mepLib())}")(setvar "FILEDIA" 0)(setvar "CMDDIA" 0)\n${op}\n` +
    `(command "_.SAVEAS" "2018" "${esc(staged)}")\n(mep:dump-geom "${esc(geo)}")\n(princ)`
  );
}

async function dumpGeom(bin: string, dwg: string, out: string): Promise<Geom[]> {
  await runHeadless(bin, dwg, `(load "${esc(mepLib())}")\n(mep:dump-geom "${esc(out)}")(princ)`, 120000);
  return loadGeom(out);
}

export function getSession(id: string): Session | undefined {
  return sessions.get(id);
}

/** Clear in-memory map (tests only). */
export function __resetSessionsForTests(): void {
  sessions.clear();
}

export type OpenResult =
  | { ok: true; sessionId: string; file: string; geometry: Geom[]; dir: string }
  | { ok: false; error: string };

export async function openSession(originalPath: string): Promise<OpenResult> {
  const bin = findCoreConsole();
  if (!bin) return { ok: false, error: "Không thấy AcCoreConsole" };
  if (!originalPath || !existsSync(originalPath)) return { ok: false, error: "Thiếu/không thấy originalPath" };
  const id = randomUUID().slice(0, 8);
  const dir = sdir(id);
  mkdirSync(join(dir, "backups"), { recursive: true });
  mkdirSync(join(dir, "snapshots"), { recursive: true });
  // Original is only COPIED — never opened for write by us.
  copyFileSync(originalPath, join(dir, "base.dwg"));
  copyFileSync(originalPath, join(dir, "current.dwg"));
  const geom = await dumpGeom(bin, join(dir, "current.dwg"), join(dir, "snapshots", "current.json"));
  const s: Session = { id, dir, originalPath, head: null, ops: [] };
  sessions.set(id, s);
  writeFileSync(join(dir, "meta.json"), JSON.stringify({ id, originalPath, createdAt: Date.now() }));
  return { ok: true, sessionId: id, file: basename(originalPath), geometry: geom, dir };
}

export type PreviewResult =
  | {
      ok: true;
      sessionId: string;
      opId: string;
      recipe: string;
      diff: GeomDiff;
      geometry: Geom[];
      before: Geom[];
      /** Fingerprints after preview — current + original must match pre-preview. */
      immutable: { current: string | null; original: string | null; currentUnchanged: boolean; originalUnchanged: boolean };
    }
  | { ok: false; error: string };

/**
 * Stage a modifying recipe without changing accepted `current.dwg` or the user's original.
 * Runs headless on a disposable work copy of current.
 */
export async function previewOp(
  sessionId: string,
  recipe: string,
  params: any = {},
): Promise<PreviewResult> {
  const bin = findCoreConsole();
  const s = sessions.get(sessionId);
  if (!bin || !s) return { ok: false, error: "Session không hợp lệ (mở /session/open trước)" };
  const body = recipeBody(recipe, join(s.dir, "staged.dwg"), params);
  if (!body) return { ok: false, error: `recipe không hỗ trợ preview: ${recipe}` };

  const opId = randomUUID().slice(0, 8);
  const currentPath = join(s.dir, "current.dwg");
  const staged = join(s.dir, "staged.dwg");
  const stagedJson = join(s.dir, "snapshots", `staged-${opId}.json`);
  const work = join(s.dir, `work-${opId}.dwg`);

  const fpCurrentBefore = fileFingerprint(currentPath);
  const fpOriginalBefore = fileFingerprint(s.originalPath);
  // Guard copy so we can restore accepted state if headless ever dirties current.
  const currentGuard = join(s.dir, `current-guard-${opId}.dwg`);
  copyFileSync(currentPath, currentGuard);

  // Drop any previous staged candidate (only one staged op at a time).
  for (const o of s.ops.filter((x) => x.state === "staged")) {
    rmSync(join(s.dir, "snapshots", `staged-${o.opId}.json`), { force: true });
  }
  rmSync(staged, { force: true });
  rmSync(staged.replace(/\.dwg$/i, ".json"), { force: true });
  s.ops = s.ops.filter((o) => o.state !== "staged");

  // CRITICAL: never open accepted current for the mutating script — only a work copy.
  copyFileSync(currentPath, work);
  try {
    const run = await runHeadless(bin, work, body, 180000);
    const sideJson = staged.replace(/\.dwg$/i, ".json");
    if (existsSync(sideJson)) renameSync(sideJson, stagedJson);
    if (!run.ok || !existsSync(staged)) {
      rmSync(currentGuard, { force: true });
      return { ok: false, error: "Chạy op lỗi: " + (run.stdout || "").slice(-300) };
    }
  } finally {
    rmSync(work, { force: true });
    rmSync(work.replace(/\.dwg$/i, ".json"), { force: true });
  }

  let currentUnchanged = fileFingerprint(currentPath) === fpCurrentBefore;
  if (!currentUnchanged) {
    copyFileSync(currentGuard, currentPath);
    currentUnchanged = fileFingerprint(currentPath) === fpCurrentBefore;
  }
  rmSync(currentGuard, { force: true });
  const fpCurrentAfter = fileFingerprint(currentPath);
  const fpOriginalAfter = fileFingerprint(s.originalPath);
  const originalUnchanged = fpOriginalBefore === fpOriginalAfter;

  const before = loadGeom(join(s.dir, "snapshots", "current.json"));
  const after = loadGeom(stagedJson);
  const d = diffGeoms(before, after);
  s.ops.push({ opId, recipe, params, state: "staged", summary: d.summary, createdAt: Date.now() });
  return {
    ok: true,
    sessionId,
    opId,
    recipe,
    diff: d,
    geometry: after,
    before,
    immutable: {
      current: fpCurrentAfter,
      original: fpOriginalAfter,
      currentUnchanged,
      originalUnchanged,
    },
  };
}

export type ApplyResult =
  | { ok: true; head: string; applied: string; backup: string }
  | { ok: false; error: string };

/** Promote staged candidate to accepted state; backup prior accepted. */
export function applyOp(sessionId: string, opId: string): ApplyResult {
  const s = sessions.get(sessionId);
  const op = s?.ops.find((o) => o.opId === opId && o.state === "staged");
  if (!s || !op) return { ok: false, error: "Không có op staged để apply" };
  const staged = join(s.dir, "staged.dwg");
  const current = join(s.dir, "current.dwg");
  const stagedSnap = join(s.dir, "snapshots", `staged-${opId}.json`);
  if (!existsSync(staged)) return { ok: false, error: "Không thấy staged.dwg" };
  const backup = join(s.dir, "backups", `current-${Date.now()}-${opId}.dwg`);
  copyFileSync(current, backup);
  // Atomic promote: replace current with staged
  renameSync(staged, current);
  if (existsSync(stagedSnap)) {
    const curSnap = join(s.dir, "snapshots", "current.json");
    rmSync(curSnap, { force: true });
    renameSync(stagedSnap, curSnap);
  }
  op.state = "applied";
  op.backup = backup;
  s.head = opId;
  return { ok: true, head: opId, applied: opId, backup: basename(backup) };
}

export type RejectResult = { ok: true; rejected: string } | { ok: false; error: string };

/** Discard staged candidate; accepted state and original stay as-is. */
export function rejectOp(sessionId: string, opId: string): RejectResult {
  const s = sessions.get(sessionId);
  const op = s?.ops.find((o) => o.opId === opId && o.state === "staged");
  if (!s || !op) return { ok: false, error: "Không có op staged để reject" };
  rmSync(join(s.dir, "staged.dwg"), { force: true });
  rmSync(join(s.dir, "snapshots", `staged-${opId}.json`), { force: true });
  op.state = "rejected";
  return { ok: true, rejected: opId };
}

export function sessionRouter(): Router {
  const r = express.Router();

  r.post("/session/open", async (req, res) => {
    const { originalPath } = req.body ?? {};
    const out = await openSession(originalPath);
    if (!out.ok) return res.status(400).json({ error: out.error });
    res.json({ sessionId: out.sessionId, file: out.file, geometry: out.geometry });
  });

  r.post("/preview", async (req, res) => {
    const { sessionId, recipe, params } = req.body ?? {};
    const out = await previewOp(String(sessionId || ""), String(recipe || ""), params || {});
    if (!out.ok) return res.status(out.error.includes("không hỗ trợ") ? 400 : 500).json({ error: out.error });
    res.json({
      sessionId: out.sessionId,
      opId: out.opId,
      recipe: out.recipe,
      diff: out.diff,
      geometry: out.geometry,
      before: out.before,
      immutable: out.immutable,
    });
  });

  r.post("/apply", (req, res) => {
    const { sessionId, opId } = req.body ?? {};
    const out = applyOp(String(sessionId || ""), String(opId || ""));
    if (!out.ok) return res.status(400).json({ error: out.error });
    res.json({ head: out.head, applied: out.applied, backup: out.backup });
  });

  r.post("/reject", (req, res) => {
    const { sessionId, opId } = req.body ?? {};
    const out = rejectOp(String(sessionId || ""), String(opId || ""));
    if (!out.ok) return res.status(400).json({ error: out.error });
    res.json({ rejected: out.rejected });
  });

  r.get("/history", (req, res) => {
    const s = sessions.get(String(req.query.sessionId));
    if (!s) return res.status(400).json({ error: "Không thấy session" });
    res.json({
      head: s.head,
      ops: s.ops.map((o) => ({
        opId: o.opId,
        recipe: o.recipe,
        state: o.state,
        summary: o.summary,
        backup: o.backup && basename(o.backup),
        createdAt: o.createdAt,
      })),
    });
  });

  r.post("/rollback", async (req, res) => {
    const bin = findCoreConsole();
    const { sessionId, opId } = req.body ?? {};
    const s = sessions.get(sessionId);
    const op = s?.ops.find((o) => o.opId === opId && o.state === "applied" && o.backup);
    if (!bin || !s || !op) return res.status(400).json({ error: "Không có op applied để rollback" });
    copyFileSync(join(s.dir, "current.dwg"), join(s.dir, "backups", `current-${Date.now()}-rb.dwg`));
    copyFileSync(op.backup!, join(s.dir, "current.dwg"));
    const geom = await dumpGeom(bin, join(s.dir, "current.dwg"), join(s.dir, "snapshots", "current.json"));
    op.state = "rejected";
    s.head = null;
    res.json({ head: s.head, geometry: geom });
  });

  // Optional LIVE channel — explicit second action, not the sandbox accept path.
  r.post("/live", async (req, res) => {
    const { recipe, params, target } = req.body ?? {};
    const op = opLisp(recipe, params);
    if (!op) return res.status(400).json({ error: `recipe không hỗ trợ live: ${recipe}` });
    const lisp = `${inlineLib()}(setvar "FILEDIA" 0)(setvar "CMDDIA" 0)\n${op}\n(command "_.ZOOM" "_E")(princ)`;
    const dispatched = await dispatchLiveJob(lisp, target, 15_000);
    res.json({
      ok: dispatched.state !== "error",
      ...dispatched,
      target: target || "(bản vẽ đang active)",
      hint:
        dispatched.state === "sent"
          ? "Đã gửi nhưng AutoCAD chưa trả kết quả; bridge đang giữ thứ tự job."
          : "✓ AutoCAD đã xử lý trên " + (target || "bản vẽ đang active") + ".",
    });
  });

  r.post("/export", (req, res) => {
    const { sessionId, targetPath } = req.body ?? {};
    const s = sessions.get(sessionId);
    if (!s) return res.status(400).json({ error: "Không thấy session" });
    const dst = targetPath || s.originalPath.replace(/\.dwg$/i, ".reviewed.dwg");
    copyFileSync(join(s.dir, "current.dwg"), dst);
    res.json({ ok: true, written: dst });
  });

  return r;
}

/** Cầu điều khiển AutoCAD for Mac — 3 kênh, xếp theo độ tin cậy:
 *  1. headless : AcCoreConsole (Contents/Helpers) chạy .scr trên DWG đóng, không cần GUI.
 *  2. job      : nạp job .lsp vào SESSION ĐANG MỞ qua `open -a` (odoc, tương đương kéo-thả
 *                — .lsp nằm trong CFBundleDocumentTypes). LISP ghi result file để daemon đọc.
 *  3. keystroke: bơm phím qua System Events — CHỈ fallback (cần Accessibility, phụ thuộc focus).
 */
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import express, { type Router } from "express";
import { detectAgents } from "./agents.js";
import { exportRawCatalog, invokeRaw } from "./objectarx/rawDispatch.js";
import {
  applyLivePreview,
  rejectLivePreview,
  stageLivePreview,
  supportsLiveCadPreview,
  parseNativeDone,
  getLiveOp,
} from "./livePreview.js";
import { coverageSummary } from "./objectarx/catalog.js";
import {
  buildStaticHealthChecks,
  buildStabilityChecks,
  bridgeResultsDir,
  cerNotRootCauseMessage,
  checkStabilityFonts,
  countRecentCerReports,
  defaultMepbridgeCppPath,
  ensureBridgeDir,
  fixStabilityFonts,
  healthReportOk,
  isPluginInstalled,
  mergeLiveHealth,
  openPayload,
  pluginApploadPath,
  pluginInstallDirs,
  reactorFixPresentInSource,
  scratchDwgPath,
  sdkIncPath,
} from "./acadControl.js";
import {
  PRODUCT,
  atomicWriteFile,
  drawingInfoRequestPath,
  drawingInfoResponsePath,
  ensureBridgeLayout,
  jobLspPath,
  resolveBridgeDir,
  resultsDir as resultsDirOf,
} from "./bridgeContract.js";

/** Headless AutoLISP helper library (generic core; plumbing profile optional). */
export function acadLib(): string {
  if (process.env.ACAD_LIB || process.env.MEP_ACAD_LIB) {
    return process.env.ACAD_LIB || process.env.MEP_ACAD_LIB!;
  }
  const projectRoot =
    process.env.ACAD_PROJECT_ROOT ||
    process.env.MEP_PROJECT_ROOT ||
    join(homedir(), "Desktop", "tool-autocad");
  const assetRoot =
    process.env.ACAD_ASSET_ROOT ||
    process.env.ACAD_BUNDLED_LISP_ROOT ||
    projectRoot;
  // Prefer generic core lib; fall back to legacy mep_lib.lsp path.
  const core = join(assetRoot, "acad-lisp/headless/acad_lib.lsp");
  const legacy = join(assetRoot, "acad-lisp/headless/mep_lib.lsp");
  return existsSync(core) ? core : legacy;
}

/** @deprecated use acadLib() — kept for sample/profile callers. */
export function mepLib(): string {
  return acadLib();
}

/** Decode chuỗi AutoCAD (\U+xxxx) sang Unicode để hiển thị tiếng Việt. */
function decodeAcad(s: string): string {
  return s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)));
}
function csvToRows(text: string): string[][] {
  return text.trim().split("\n").filter(Boolean).map((l) => decodeAcad(l).split(","));
}

/** Decode the unread suffix of an event log whose cursor is a byte offset. */
export function utf8FromByteOffset(data: Buffer, byteOffset: number): string {
  const offset = Number.isSafeInteger(byteOffset) && byteOffset > 0
    ? Math.min(byteOffset, data.length)
    : 0;
  return data.subarray(offset).toString("utf8");
}
/** Chạy AcCoreConsole 1 lần trên 1 DWG với script body cho trước. */
export function runHeadless(bin: string, dwg: string | null, body: string, timeoutMs: number):
  Promise<{ ok: boolean; exit: any; stdout: string }> {
  const scr = join(tmpdir(), `acad_${randomUUID().slice(0, 8)}.scr`);
  writeFileSync(scr, body.endsWith("\n") ? body : body + "\n", "utf8");
  const args = [...(dwg ? ["/i", dwg] : []), "/s", scr, "/l", "en-US"];
  return new Promise((resolve) => {
    const child = execFile(
      bin,
      args,
      {
        timeout: timeoutMs,
        maxBuffer: 8 * 1024 * 1024,
        killSignal: "SIGKILL",
        env: { ...process.env, LANG: "en_US.UTF-8", LC_ALL: "en_US.UTF-8" },
      },
      (err, so, se) => {
        try {
          rmSync(scr);
        } catch {
          /* */
        }
        resolve({
          ok: !err,
          exit: err ? ((err as any).code ?? "killed") : 0,
          stdout: (so || "") + (se || ""),
        });
      },
    );
    // Extra safety: if node timeout callback doesn't fire, force-kill after grace.
    const hard = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* */
      }
    }, timeoutMs + 5000);
    child.on("exit", () => clearTimeout(hard));
  });
}
const loadLib = () => `(load "${acadLib().replace(/\\/g, "\\\\")}")\n(setvar "FILEDIA" 0)(setvar "CMDDIA" 0)\n`;

/**
 * Plumbing sample: layer colors for demo native.job only.
 * Domain-specific — not part of the generic control-plane contract.
 * Prefer generic LAYER/POLYLINE raw ops for non-plumbing work.
 */
const SAMPLE_PIPE_LAYER_COLOR: Record<string, number> = {
  "P-ThoatXi": 190, "P-ThoatRua": 50, "P-ThongHoi": 5, "DCCD-nuoclanh": 90, "P-ThietBi": 2, "NOTE": 2,
};
function sampleSysToLayer(s: string): string {
  const u = String(s).toUpperCase();
  if (/XI/.test(u)) return "P-ThoatXi";
  if (/RUA|RỬA/.test(u)) return "P-ThoatRua";
  if (/HOI|HƠI/.test(u)) return "P-ThongHoi";
  if (/CAP|NUOC|CẤP/.test(u)) return "DCCD-nuoclanh";
  return s;
}
/**
 * Sample helper: build native.job TAB body for plumbing-demo pipes.
 * Control plane stays generic; this is profile/sample data only.
 */
export function buildNativeJob(target: string, pipes: any[]): string {
  const lines: string[] = ["MODE\tCOMMIT"];
  if (target) lines.push(`TARGET\t${target}`);
  const seen = new Set<string>();
  for (const p of pipes) {
    const layer = sampleSysToLayer(p.system);
    if (!seen.has(layer)) {
      lines.push(`LAYER\t${layer}\t${SAMPLE_PIPE_LAYER_COLOR[layer] ?? 0}`);
      seen.add(layer);
    }
    const pts = (p.points || []).map((pt: number[]) => `${pt[0]},${pt[1]}`).join(" ");
    lines.push(`PIPE\t${layer}\t${Number(p.dn) || 90}\t${p.system}\t${pts}`);
  }
  return lines.join("\n");
}

/** Generic native.job: create/set layers only (no domain). */
export function buildGenericLayerJob(
  target: string,
  layers: { name: string; aci?: number }[],
): string {
  const lines: string[] = ["MODE\tCOMMIT"];
  if (target) lines.push(`TARGET\t${target}`);
  for (const L of layers) {
    lines.push(`LAYER\t${L.name}\t${L.aci ?? 7}`);
  }
  return lines.join("\n");
}

/** Resolve at call time (ACAD_BRIDGE_DIR / plugin dir may change). */
function getBridgeDir(): string {
  return resolveBridgeDir();
}
function getResultsDir(): string {
  return resultsDirOf(getBridgeDir());
}
function getJobLsp(): string {
  return jobLspPath(getBridgeDir());
}

export function findAcadApp(): string | null {
  // Chỉ nhận app chính "AutoCAD <năm>.app" (loại Plot Style Editor, Remove AutoCAD...).
  const root = "/Applications/Autodesk";
  let hits: string[] = [];
  try {
    hits = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^AutoCAD \d{4}$/.test(entry.name))
      .map((entry) => join(root, entry.name, `${entry.name}.app`))
      .filter((path) => existsSync(path))
      .sort();
  } catch {
    /* Autodesk directory missing */
  }
  return hits.length ? hits[hits.length - 1] : null;
}
export function findCoreConsole(): string | null {
  const app = findAcadApp();
  if (!app) return null;
  const p = join(app, "Contents/Helpers/AcCoreConsole.app/Contents/MacOS/AcCoreConsole");
  return existsSync(p) ? p : null;
}
export function acadRunning(): Promise<boolean> {
  return new Promise((r) =>
    execFile("pgrep", ["-f", "AutoCAD.*\\.app/Contents/MacOS/AutoCAD"], (err) => r(!err)));
}

/** Kill AutoCAD GUI processes (best-effort; used by restartacad setup).
 *  macOS: `pkill -x AutoCAD` often no-ops (process name is full path); use pgrep PIDs + SIGTERM/SIGKILL. */
export function killAcadGui(): Promise<void> {
  return new Promise((resolve) => {
    execFile("pgrep", ["-f", "AutoCAD.*\\.app/Contents/MacOS/AutoCAD"], (_err, stdout) => {
      const pids = String(stdout || "")
        .trim()
        .split(/\s+/)
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n) && n > 0);
      if (!pids.length) {
        // Fallback name match (best-effort)
        return execFile("killall", ["-9", "AutoCAD"], () => setTimeout(resolve, 400));
      }
      for (const pid of pids) {
        try {
          process.kill(pid, "SIGTERM");
        } catch {
          /* already gone */
        }
      }
      setTimeout(() => {
        for (const pid of pids) {
          try {
            process.kill(pid, "SIGKILL");
          } catch {
            /* already gone */
          }
        }
        // Allow binary reload: wait until processes are gone
        setTimeout(resolve, 1200);
      }, 1800);
    });
  });
}

export function ensureBridgeDirs(): void {
  ensureBridgeLayout(getBridgeDir());
}

/** Ghi ATOMIC (temp + rename) để plugin ObjectARX watch không đọc file ghi dở. */
function atomicWrite(path: string, content: string): void {
  atomicWriteFile(path, content);
}

/** Nội dung acad_lib/mep_lib để NHÚNG THẲNG vào job (không (load) lồng → không SECURELOAD lần 2). */
export function inlineLib(): string {
  try { return readFileSync(acadLib(), "utf8") + "\n"; } catch { return ""; }
}

export type OpenAcadDocument = {
  title: string;
  file: string;
  active: boolean;
  instance?: string;
  revision?: number;
};

/** Resolve one open document, preferring a full-path match over a title match. */
export function selectOpenDocument<T extends Pick<OpenAcadDocument, "title" | "file" | "active">>(
  documents: readonly T[],
  target: unknown,
): { document: T | null; ambiguous: boolean } {
  const requested = String(target ?? "").trim();
  const matches = requested
    ? (() => {
        const files = documents.filter((document) => document.file === requested);
        return files.length
          ? files
          : documents.filter((document) => document.title === requested);
      })()
    : documents.filter((document) => document.active);
  return {
    document: matches.length === 1 ? matches[0] : null,
    ambiguous: matches.length > 1,
  };
}

/** Hỏi plugin danh sách bản vẽ đang mở (ghi docs.req → chờ docs.json mới). Heartbeat plugin. */
export async function listOpenDocs(timeoutMs = 3000):
  Promise<{ alive: boolean; docs: OpenAcadDocument[] }> {
  ensureBridgeDirs();
  const reqAt = Date.now();
  writeFileSync(join(getBridgeDir(), "docs.req"), String(reqAt), "utf8");
  const docsPath = join(getBridgeDir(), "docs.json");
  while (Date.now() - reqAt < timeoutMs) {
    try {
      const st = statSync(docsPath);
      if (st.mtimeMs >= reqAt - 50) {
        const d = JSON.parse(readFileSync(docsPath, "utf8"));
        return { alive: true, docs: d.docs ?? [] };
      }
    } catch { /* chưa có */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  return { alive: false, docs: [] };
}

export type DrawingInfoPluginSnapshot = {
  requestId: string;
  ok?: boolean;
  status?: string;
  code?: string;
  error?: string;
  [key: string]: unknown;
};

/** Protocol body: line 1 is requestId; the remaining text is the exact document target. */
export function buildDrawingInfoRequest(requestId: string, target = ""): string {
  if (!requestId || /[\r\n]/.test(requestId)) {
    throw new Error("drawing-info requestId must be one non-empty line");
  }
  return `${requestId}\n${target}`;
}

/** Parse only the response belonging to this request; malformed/stale data is ignored. */
export function parseDrawingInfoResponse(
  raw: string,
  expectedRequestId: string,
): DrawingInfoPluginSnapshot | null {
  try {
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const snapshot = value as Record<string, unknown>;
    if (snapshot.requestId !== expectedRequestId) return null;
    return snapshot as DrawingInfoPluginSnapshot;
  } catch {
    return null;
  }
}

export function isDrawingInfoResponseFresh(mtimeMs: number, requestStartedAt: number): boolean {
  return Number.isFinite(mtimeMs) && mtimeMs >= requestStartedAt - 50;
}

/** Read a complete, fresh response for requestId. Exported for contract tests. */
export function readDrawingInfoResponse(
  path: string,
  requestId: string,
  requestStartedAt: number,
): DrawingInfoPluginSnapshot | null {
  try {
    const st = statSync(path);
    if (!isDrawingInfoResponseFresh(st.mtimeMs, requestStartedAt)) return null;
    return parseDrawingInfoResponse(readFileSync(path, "utf8"), requestId);
  } catch {
    return null;
  }
}

let drawingInfoQueue: Promise<void> = Promise.resolve();

async function withDrawingInfoLock<T>(run: () => Promise<T>): Promise<T> {
  const previous = drawingInfoQueue;
  let release!: () => void;
  drawingInfoQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    return await run();
  } finally {
    release();
  }
}

export async function requestDrawingInfo(target: string, timeoutMs = 8000):
  Promise<DrawingInfoPluginSnapshot | null> {
  return withDrawingInfoLock(async () => {
    ensureBridgeDirs();
    const bridgeDir = getBridgeDir();
    const requestId = randomUUID();
    const requestStartedAt = Date.now();
    atomicWrite(
      drawingInfoRequestPath(bridgeDir),
      buildDrawingInfoRequest(requestId, target),
    );
    const responsePath = drawingInfoResponsePath(bridgeDir);
    while (Date.now() - requestStartedAt < timeoutMs) {
      const snapshot = readDrawingInfoResponse(
        responsePath,
        requestId,
        requestStartedAt,
      );
      if (snapshot) return snapshot;
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    return null;
  });
}

function drawingFileInfo(path: string): {
  exists: boolean;
  sizeBytes: number | null;
  createdAt: string | null;
  modifiedAt: string | null;
} {
  if (!path) return { exists: false, sizeBytes: null, createdAt: null, modifiedAt: null };
  try {
    const st = statSync(path);
    return {
      exists: true,
      sizeBytes: st.size,
      createdAt: st.birthtime.toISOString(),
      modifiedAt: st.mtime.toISOString(),
    };
  } catch {
    return { exists: false, sizeBytes: null, createdAt: null, modifiedAt: null };
  }
}

function drawingInfoRuntime(
  running: boolean,
  alive: boolean,
  documents: { title: string; file: string; active: boolean }[],
  filePath = "",
) {
  return {
    running,
    alive,
    collectedAt: new Date().toISOString(),
    documents,
    application: {
      appPath: findAcadApp(),
      coreConsole: findCoreConsole(),
      bridgeDir: getBridgeDir(),
    },
    file: drawingFileInfo(filePath),
  };
}

/** Escape chuỗi cho AutoLISP. */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");

/**
 * Bọc payload LISP: đánh dấu running, bẫy lỗi, ghi result file có sentinel.
 * Uses acad:write-result (primary) with mep:write-result alias for older jobs.
 */
export function wrapJob(jobId: string, lisp: string, resultsDir?: string): string {
  resultsDir = resultsDir ?? getResultsDir();
  const res = esc(join(resultsDir, `${jobId}.txt`));
  const run = esc(join(resultsDir, `${jobId}.running`));
  return `;;; Acad job ${jobId} — AutoCAD Toolkit daemon
(setq acad:resfile "${res}")
(setq mep:resfile acad:resfile)
(defun acad:write-result (status msg / f)
  (setq f (open acad:resfile "w"))
  (write-line (strcat "status=" status) f)
  (write-line (if (= (type msg) 'STR) msg (vl-princ-to-string msg)) f)
  (write-line "==end==" f)
  (close f)
  (princ))
(defun mep:write-result (status msg) (acad:write-result status msg))
(setq f (open "${run}" "w")) (write-line "running" f) (close f)
(setq acad:outer-error *error*)
(setq *error*
  (lambda (m)
    (setq *error* acad:outer-error)
    (acad:write-result "error" (if m m "loi khong ro"))
    (princ)))
${lisp}
(if (null (findfile acad:resfile)) (acad:write-result "ok" "job da chay xong"))
(setq *error* acad:outer-error)
(princ)
`;
}

interface JobRecord {
  jobId: string;
  state: "pending" | "sent" | "done" | "error" | "timeout";
  createdAt: number;
  result?: { status: string; message: string };
}
let activeJob: JobRecord | null = null;
const history: JobRecord[] = [];
let liveJobQueue: Promise<void> = Promise.resolve();
let liveJobPending = 0;

async function acquireLiveJobLock(): Promise<() => void> {
  liveJobPending++;
  const previous = liveJobQueue;
  let release!: () => void;
  liveJobQueue = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    release();
    liveJobPending--;
  };
}

function rememberJob(job: JobRecord): void {
  const prior = history.findIndex((entry) => entry.jobId === job.jobId);
  if (prior >= 0) history.splice(prior, 1);
  history.unshift({ ...job });
  history.splice(20);
}

/** Parse result file written by wrapJob (status=… / message / ==end==). Exported for tests. */
export function parseJobResultText(raw: string): { status: string; message: string } | null {
  if (!raw.includes("==end==")) return null;
  const lines = raw.split("\n");
  const status = (lines[0] || "").replace("status=", "").trim() || "ok";
  const message = lines.slice(1, lines.indexOf("==end==")).join("\n").trim();
  return { status, message };
}

function readResult(jobId: string, resultsDir?: string): { status: string; message: string } | null {
  resultsDir = resultsDir ?? getResultsDir();
  const p = join(resultsDir, `${jobId}.txt`);
  if (!existsSync(p)) return null;
  return parseJobResultText(readFileSync(p, "utf8"));
}

async function pollResult(job: JobRecord, waitMs: number): Promise<JobRecord["state"]> {
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) {
    const r = readResult(job.jobId);
    if (r) {
      job.result = r;
      job.state = r.status === "ok" ? "done" : "error";
      return job.state;
    }
    await new Promise((s) => setTimeout(s, 400));
  }
  return "sent"; // chưa xong — client có thể GET /job/:id sau
}

/**
 * Gửi một payload qua file bridge và chờ kết quả.
 * Exported để các router chuyên biệt (ví dụ thư viện AutoLISP) không phải
 * tự ghi job.lsp hoặc sao chép protocol.
 */
export async function dispatchLiveJob(
  lisp: string,
  target: string | undefined,
  wait: number,
) {
  const release = await acquireLiveJobLock();
  let backgroundOwnsRelease = false;
  try {
    const jobId = randomUUID().slice(0, 8);
    ensureBridgeDirs();
    writeFileSync(join(getBridgeDir(), "job_target.txt"), target ? String(target) : "", "utf8");
    atomicWrite(getJobLsp(), wrapJob(jobId, lisp));
    const job: JobRecord = { jobId, state: "sent", createdAt: Date.now() };
    activeJob = job;
    const state = await pollResult(job, wait);
    rememberJob(job);
    if (state === "sent") {
      // The HTTP caller may stop waiting, but job.lsp is still a shared
      // transport. Keep ownership in the background so another feature cannot
      // overwrite a delayed AutoCAD load.
      backgroundOwnsRelease = true;
      void (async () => {
        try {
          const settled = await pollResult(job, 120_000);
          if (settled === "sent") job.state = "timeout";
          rememberJob(job);
        } finally {
          release();
        }
      })();
    }
    return { jobId, state, result: job.result ?? null };
  } finally {
    if (!backgroundOwnsRelease) release();
  }
}

export function acadBridgeRouter(): Router {
  const r = express.Router();

  r.get("/status", async (_req, res) => {
    const app = findAcadApp();
    res.json({
      app,
      running: await acadRunning(),
      coreConsole: findCoreConsole(),
      bridgeDir: getBridgeDir(),
      activeJob: activeJob ? { jobId: activeJob.jobId, state: activeJob.state } : null,
      trustedHint:
        "Lần đầu chạy job nếu AutoCAD hỏi SECURELOAD, chọn 'Load'. Để hết hỏi: lệnh TRUSTEDPATHS thêm " +
        getBridgeDir() + "/...",
    });
  });

  // Sự kiện realtime từ AutoCAD (plugin ghi events.jsonl qua reactor) — SSE.
  r.get("/events", (_req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();
    const file = join(getBridgeDir(), "events.jsonl");
    let pos = 0;
    const push = (chunk: string) =>
      chunk.split("\n").filter(Boolean).forEach((l) => res.write(`data: ${l}\n\n`));
    try {
      const all = readFileSync(file);
      push(all.toString("utf8").split("\n").filter(Boolean).slice(-15).join("\n"));
      pos = all.length;
    } catch { /* chưa có file */ }
    const timer = setInterval(() => {
      try {
        const st = statSync(file);
        if (st.size < pos) pos = 0;                                   // plugin truncate
        if (st.size > pos) {
          const all = readFileSync(file);
          push(utf8FromByteOffset(all, pos));
          pos = all.length;
        }
      } catch { /* */ }
    }, 500);
    res.on("close", () => clearInterval(timer));
  });

  // Truy vấn TRỰC TIẾP bản vẽ đang mở: selection / layers / count / title.
  r.post("/livequery", async (req, res) => {
    const { what, target, wait = 8000 } = req.body ?? {};
    if (!(await acadRunning())) return res.status(400).json({ error: "AutoCAD chưa chạy" });
    const out = join(getResultsDir(), `q_${randomUUID().slice(0, 6)}.txt`);
    let lisp: string | null = null;
    switch (what) {
      case "selection":
        lisp = `(setq ss (cadr (ssgetfirst)))
(if (null ss) (mep:write-result "ok" "selection=0")
  (progn (setq n (sslength ss) i 0 acc "")
    (while (< i n) (setq el (entget (ssname ss i))
      acc (strcat acc (cdr (assoc 0 el)) "|" (cdr (assoc 8 el)) "|" (cdr (assoc 5 el)) "\\n") i (1+ i)))
    (mep:write-result "ok" (strcat "selection=" (itoa n) "\\n" acc))))`;
        break;
      case "layers":
        lisp = `(setq e (tblnext "LAYER" T) acc "")
(while e (setq acc (strcat acc (cdr (assoc 2 e)) "|" (itoa (abs (cdr (assoc 62 e)))) "\\n") e (tblnext "LAYER")))
(mep:write-result "ok" acc)`;
        break;
      case "count":
        lisp = `(setq ss (ssget "_X")) (mep:write-result "ok" (strcat "entities=" (if ss (itoa (sslength ss)) "0")))`;
        break;
      case "title":
        lisp = `${inlineLib()}(mep:read-title "${esc(out)}")(mep:write-result "ok" "title-written")`;
        break;
      default:
        return res.status(400).json({ error: "what phải là selection|layers|count|title" });
    }
    const r2 = await dispatchLiveJob(lisp, target, wait);
    const payload: any = { ...r2, what };
    if (what === "title" && existsSync(out)) {
      payload.title = Object.fromEntries(readFileSync(out, "latin1").trim().split("\n").filter(Boolean)
        .map((l) => { const [t, ...v] = l.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_m, h) => String.fromCodePoint(parseInt(h, 16))).split("\t"); return [t, v.join("\t")]; }));
      rmSync(out, { force: true });
    }
    res.json(payload);
  });

  // ── ObjectARX RAW catalog (one-to-one with OBJECTARX-CAPABILITIES.md) ──
  r.get("/raw/catalog", (_req, res) => {
    res.json(exportRawCatalog());
  });
  r.get("/raw/coverage", (_req, res) => {
    res.json({ ok: true, ...coverageSummary() });
  });
  r.post("/raw/invoke", async (req, res) => {
    const { id, target, params, dryRun = false, waitMs } = req.body ?? {};
    const capabilityId = String(id ?? "").trim();
    if (!capabilityId) {
      return res.status(400).json({
        ok: false,
        error: "Thiếu id (capability id từ catalog)",
      });
    }
    if (capabilityId === "ed.selection_control" && !dryRun) {
      return res.status(409).json({
        ok: false,
        id: "ed.selection_control",
        code: "confirmation_required",
        error:
          "Selection control phải đi qua /api/acad/selection/prepare → xác nhận → apply",
      });
    }
    const running = await acadRunning();
    const result = await invokeRaw(
      { id: capabilityId, target: target ? String(target) : undefined, params: params || {} },
      { dryRun: !!dryRun, waitMs, acadRunning: running },
    );
    // Always return structured body with ok + id (acceptance criterion).
    res.json(result);
  });

  // VẼ NATIVE (rank 2+6): dựng native.job dạng bảng → plugin C++ vẽ trực tiếp (không LISP/SECURELOAD).
  r.post("/native", async (req, res) => {
    if (!(await acadRunning())) return res.status(400).json({ error: "AutoCAD chưa chạy" });
    ensureBridgeDirs();
    const { target = "", pipes = [] } = req.body ?? {};
    if (!Array.isArray(pipes) || !pipes.length) return res.status(400).json({ error: "Thiếu dữ liệu ống" });
    const before = Date.now();
    atomicWrite(join(getBridgeDir(), "native.job"), buildNativeJob(target, pipes));
    const doneFile = join(getBridgeDir(), "native.done");
    while (Date.now() - before < 8000) {
      try {
        const st = statSync(doneFile);
        if (st.mtimeMs >= before - 50) {
          const parsed = parseNativeDone(readFileSync(doneFile, "utf8"));
          const n = parsed.count;
          return res.json({
            ok: parsed.ok !== false,
            count: n,
            handles: parsed.handles,
            hint: `✓ Đã vẽ ${n} đối tượng (native C++, không LISP).`,
          });
        }
      } catch { /* chưa có */ }
      await new Promise((r2) => setTimeout(r2, 120));
    }
    res.json({ ok: false, error: "Plugin không phản hồi — khởi động lại AutoCAD (nạp plugin mới)." });
  });

  // LIVE PREVIEW on AutoCAD (visible stage) → confirm apply / reject discard.
  r.post("/livepreview", async (req, res) => {
    if (!(await acadRunning())) return res.status(400).json({ ok: false, error: "AutoCAD chưa chạy" });
    const alive = (await listOpenDocs(2500)).alive;
    if (!alive) return res.status(400).json({ ok: false, error: "Plugin AcadBridge không phản hồi (heartbeat)" });
    const { recipe = "drawpipes", params = {}, target = "" } = req.body ?? {};
    if (!supportsLiveCadPreview(String(recipe))) {
      return res.status(400).json({
        ok: false,
        error: `recipe chưa hỗ trợ live CAD preview: ${recipe}`,
        fallback: "session",
      });
    }
    const pipes = params.pipes;
    if (!Array.isArray(pipes) || !pipes.length) return res.status(400).json({ ok: false, error: "Thiếu params.pipes" });
    ensureBridgeDirs();
    const out = await stageLivePreview({ pipes, target: target || undefined, recipe: String(recipe) });
    if (!out.ok) return res.status(500).json(out);
    res.json(out);
  });
  r.post("/livepreview/apply", async (req, res) => {
    const { opId } = req.body ?? {};
    if (!opId) return res.status(400).json({ ok: false, error: "Thiếu opId" });
    const out = await applyLivePreview(String(opId));
    if (!out.ok) return res.status(400).json(out);
    res.json(out);
  });
  r.post("/livepreview/reject", async (req, res) => {
    const { opId } = req.body ?? {};
    if (!opId) return res.status(400).json({ ok: false, error: "Thiếu opId" });
    const out = await rejectLivePreview(String(opId));
    if (!out.ok) return res.status(400).json(out);
    res.json(out);
  });
  r.get("/livepreview/:opId", (req, res) => {
    const op = getLiveOp(req.params.opId);
    if (!op) return res.status(404).json({ ok: false, error: "Không thấy op" });
    res.json({ ok: true, op });
  });

  // Legacy direct highlight mutated Pickfirst/active document without a proposal.
  // Keep the route fail-closed for old clients; the UI uses selection/prepare.
  r.post("/highlight", (_req, res) => {
    res.status(409).json({
      ok: false,
      code: "confirmation_required",
      error:
        "Chọn layer phải đi qua /api/acad/selection/prepare → xác nhận → apply",
    });
  });

  // Chèn BẢNG BOQ (AcDbTable) vào bản vẽ đang mở — plugin C++ dựng bảng thật.
  r.post("/bomtable", async (req, res) => {
    if (!(await acadRunning())) return res.status(400).json({ error: "AutoCAD chưa chạy" });
    ensureBridgeDirs();
    const { target = "", x = 0, y = 0 } = req.body ?? {};
    const before = Date.now();
    writeFileSync(join(getBridgeDir(), "bomtable.req"), `${target}|${Number(x) || 0}|${Number(y) || 0}`, "utf8");
    const evFile = join(getBridgeDir(), "events.jsonl");
    while (Date.now() - before < 6000) {   // chờ event bomTableInserted
      try {
        const st = statSync(evFile);
        if (st.mtimeMs >= before - 50 && readFileSync(evFile, "utf8").includes("bomTableInserted")) {
          const last = readFileSync(evFile, "utf8").trim().split("\n").slice(-3).join(" ");
          if (last.includes("bomTableInserted")) return res.json({ ok: true, hint: "✓ Đã chèn bảng BOQ vào bản vẽ." });
        }
      } catch { /* */ }
      await new Promise((r2) => setTimeout(r2, 150));
    }
    res.json({ ok: false, error: "Plugin không phản hồi — khởi động lại AutoCAD (nạp plugin mới)." });
  });

  // BOM NATIVE từ bản vẽ ĐANG MỞ (plugin C++ quét model space, tính chiều dài + đếm block).
  r.get("/livebom", async (req, res) => {
    if (!(await acadRunning())) return res.status(400).json({ error: "AutoCAD chưa chạy" });
    ensureBridgeDirs();
    const reqAt = Date.now();
    writeFileSync(join(getBridgeDir(), "bom.req"), String(req.query.target ?? ""), "utf8");
    const bomPath = join(getBridgeDir(), "bom.json");
    while (Date.now() - reqAt < 6000) {
      try {
        const st = statSync(bomPath);
        if (st.mtimeMs >= reqAt - 50) {
          const d = JSON.parse(readFileSync(bomPath, "utf8"));
          return res.json({ alive: true, ...d });
        }
      } catch { /* */ }
      await new Promise((r2) => setTimeout(r2, 150));
    }
    res.json({ alive: false, error: "Plugin không phản hồi — khởi động lại AutoCAD để nạp plugin v3." });
  });

  // Danh sách bản vẽ ĐANG MỞ trong AutoCAD (plugin trả lời — kiêm heartbeat).
  r.get("/docs", async (_req, res) => {
    if (!(await acadRunning())) return res.json({ running: false, alive: false, docs: [] });
    const out = await listOpenDocs();
    const appload = pluginApploadPath();
    res.json({
      running: true, ...out,
      appload,
      hint: out.alive ? undefined
        : `Plugin AcadBridge không phản hồi. APPLOAD: ${appload} — hoặc setup/restartacad (⚙ Kiểm tra AutoCAD).`,
    });
  });

  // Snapshot read-only của đúng bản vẽ đang mở, qua protocol drawing-info.req/json.
  r.get("/drawing-info", async (req, res) => {
    const queryTarget = req.query.target;
    const running = await acadRunning();
    if (queryTarget !== undefined && typeof queryTarget !== "string") {
      return res.status(400).json({
        ok: false,
        status: "invalid_target",
        code: "invalid_target",
        error: "target phải là một title hoặc file path",
        ...drawingInfoRuntime(running, false, []),
      });
    }

    if (!running) {
      return res.status(503).json({
        ok: false,
        status: "not_running",
        code: "not_running",
        error: "AutoCAD chưa chạy",
        ...drawingInfoRuntime(false, false, []),
      });
    }

    const open = await listOpenDocs();
    if (!open.alive) {
      return res.status(503).json({
        ok: false,
        status: "plugin_unavailable",
        code: "plugin_unavailable",
        error: "Plugin AcadBridge không phản hồi",
        ...drawingInfoRuntime(true, false, open.docs),
      });
    }

    const requestedTarget = queryTarget ?? "";
    const selected = selectOpenDocument(open.docs, requestedTarget);
    if (selected.ambiguous) {
      return res.status(409).json({
        ok: false,
        status: "target_ambiguous",
        code: "target_ambiguous",
        error: "Có nhiều bản vẽ khớp target; hãy chọn bằng full file path",
        ...drawingInfoRuntime(true, true, open.docs),
      });
    }
    const document = selected.document;
    const exactTarget = document?.file || document?.title || "";
    if (!document || !exactTarget) {
      const status = requestedTarget ? "not_found" : "active_document_not_found";
      return res.status(404).json({
        ok: false,
        status,
        code: "not_found",
        error: requestedTarget
          ? "Không thấy bản vẽ đang mở khớp chính xác target"
          : "Không thấy bản vẽ active",
        ...drawingInfoRuntime(true, true, open.docs),
      });
    }

    const snapshot = await requestDrawingInfo(exactTarget);
    if (!snapshot) {
      return res.status(504).json({
        ok: false,
        status: "timeout",
        code: "timeout",
        error: "Plugin không trả drawing-info.json hợp lệ trong 8 giây",
        ...drawingInfoRuntime(true, true, open.docs, document.file),
      });
    }

    const pluginCode = typeof snapshot.code === "string" ? snapshot.code.toLowerCase() : "";
    const ok = snapshot.ok !== false && pluginCode !== "busy" && pluginCode !== "not_found";
    const status = typeof snapshot.status === "string" && snapshot.status
      ? snapshot.status
      : ok ? "ok" : pluginCode || "error";
    const httpStatus = pluginCode === "busy"
      ? 409
      : pluginCode === "not_found"
        ? 404
        : ok ? 200 : 502;
    return res.status(httpStatus).json({
      ...snapshot,
      ok,
      status,
      ...drawingInfoRuntime(true, true, open.docs, document.file),
    });
  });

  // Kiểm tra cấu hình AutoCAD/plugin — checklist + stability (CER vs root cause).
  r.get("/health", async (_req, res) => {
    const projectRoot = process.env.MEP_PROJECT_ROOT || join(homedir(), "Desktop", "tool-autocad");
    const app = findAcadApp();
    const core = findCoreConsole();
    const bridgeOk = existsSync(getResultsDir());
    const pluginOk = isPluginInstalled();
    const clang = await new Promise<boolean>((r2) => execFile("which", ["clang++"], (e) => r2(!e)));
    const agents = detectAgents().filter((a: { available: boolean }) => a.available);
    const staticChecks = buildStaticHealthChecks({
      acadApp: app,
      coreConsole: core,
      bridgeOk,
      bridgeDetail: bridgeResultsDir(),
      pluginOk,
      sdkOk: existsSync(sdkIncPath()),
      clangOk: clang,
      agentsOk: agents.length > 0,
      agentsDetail: agents.length ? agents.map((a: { label: string }) => a.label).join(", ") : "Chưa có",
    });
    const running = await acadRunning();
    let pluginAlive = false;
    let docsCount = 0;
    if (running) {
      const out = await listOpenDocs(2500);
      pluginAlive = out.alive;
      docsCount = out.docs?.length ?? 0;
    }
    let checks = mergeLiveHealth(staticChecks, {
      running,
      pluginAlive,
      docsCount,
      pluginInstalled: pluginOk,
      apploadPath: pluginApploadPath(),
    });
    const fonts = checkStabilityFonts();
    const cerReports = countRecentCerReports();
    const reactorSrc = reactorFixPresentInSource(defaultMepbridgeCppPath(projectRoot));
    const stability = buildStabilityChecks({
      pluginInstalled: pluginOk,
      pluginAlive,
      running,
      fonts,
      cerReports,
      apploadPath: pluginApploadPath(),
      reactorFixInSource: reactorSrc,
    });
    checks = [...checks, ...stability];
    const dirs = pluginInstallDirs();
    res.json({
      ok: healthReportOk(checks),
      checks,
      stability: {
        cerNotRootCause: cerNotRootCauseMessage(),
        fonts,
        cerReports,
        reactorFixInSource: reactorSrc,
        fixes: ["buildplugin", "restartacad", "openacad", "fixfonts"],
      },
      channels: {
        headless: !!core,
        livePlugin: pluginAlive,
        running,
      },
      paths: {
        bridge: getBridgeDir(),
        pluginPlugins: dirs.plugins,
        pluginAddins: dirs.addins,
        appload: pluginApploadPath(),
        scratch: scratchDwgPath(projectRoot),
        cer: cerReports.cerDir,
      },
    });
  });

  // Sửa cái thiếu: bridge / build plugin / open / restart / fonts.
  r.post("/setup/:action", async (req, res) => {
    const action = req.params.action;
    if (action === "mkbridge") {
      ensureBridgeDir();
      ensureBridgeDirs();
      return res.json({ ok: true, detail: `Đã tạo ${PRODUCT.bridgeHomeHint} + results/` });
    }
    if (action === "fixfonts") {
      const projectRoot = process.env.MEP_PROJECT_ROOT || join(homedir(), "Desktop", "tool-autocad");
      const out = fixStabilityFonts({ projectRoot });
      if (!out.ok) return res.status(400).json(out);
      return res.json(out);
    }
    if (action === "buildplugin") {
      const root = process.env.MEP_PROJECT_ROOT || join(homedir(), "Desktop", "tool-autocad");
      const dir = join(root, "objectarx");
      if (!existsSync(join(dir, "build.sh"))) return res.status(400).json({ ok: false, error: "Không thấy objectarx/build.sh" });
      if (!existsSync(sdkIncPath()))
        return res.status(400).json({ ok: false, error: "Chưa có ObjectARX SDK — tải trước tại aps.autodesk.com (mục SDK)." });
      return execFile("bash", ["build.sh"], { cwd: dir, timeout: 300000, maxBuffer: 4 * 1024 * 1024 }, (err, so, se) => {
        const out = ((so || "") + (se || ""));
        const okBuilt = /Da cai:/.test(out) && !err;
        res.json({
          ok: okBuilt,
          detail: okBuilt
            ? `Đã build + cài plugin (gồm fix reactor). APPLOAD: ${pluginApploadPath()} — BẮT BUỘC Restart AutoCAD để nạp bản mới.`
            : "Build lỗi",
          appload: pluginApploadPath(),
          next: okBuilt ? "restartacad" : null,
          output: out.slice(-1500),
        });
      });
    }
    if (action === "openacad" || action === "restartacad") {
      if (action === "restartacad") await killAcadGui();
      // Reuse open-with-new logic via internal call pattern
      const app = findAcadApp();
      if (!app) return res.status(400).json({ ok: false, error: "Không thấy AutoCAD" });
      const projectRoot = process.env.MEP_PROJECT_ROOT || join(homedir(), "Desktop", "tool-autocad");
      const scratch = scratchDwgPath(projectRoot);
      mkdirSync(join(projectRoot, "acad-studio", ".work"), { recursive: true });
      if (!existsSync(scratch)) {
        const bin = findCoreConsole();
        if (bin) {
          await runHeadless(
            bin,
            null,
            `(setvar "FILEDIA" 0)(setvar "CMDDIA" 0)\n` +
              `(command "_.SAVEAS" "2018" "${scratch.replace(/\\/g, "\\\\")}")\n(princ)\n`,
            45_000,
          );
        }
      }
      const pathToOpen = existsSync(scratch) ? scratch : undefined;
      const args = pathToOpen ? ["-a", app, pathToOpen] : ["-a", app];
      return execFile("open", args, (err) => {
        if (err) return res.status(500).json({ ok: false, error: String(err) });
        res.json({
          ...openPayload({ app, path: pathToOpen || null, created: pathToOpen || null }),
          action,
          appload: pluginApploadPath(),
          detail:
            action === "restartacad"
              ? "Đã restart AutoCAD — đợi plugin AcadBridge nạp (heartbeat)."
              : undefined,
        });
      });
    }
    res.status(400).json({
      ok: false,
      error: "action không hợp lệ (mkbridge|buildplugin|openacad|restartacad|fixfonts)",
    });
  });

  // Kênh 1 — headless: chạy .scr (hoặc trên 1 DWG) bằng AcCoreConsole, không cần GUI.
  r.post("/headless", async (req, res) => {
    const { script, dwg, timeoutMs = 120000 } = req.body ?? {};
    const bin = findCoreConsole();
    if (!bin) return res.status(400).json({ error: "Không thấy AcCoreConsole (cần AutoCAD 2027)" });
    if (!script) return res.status(400).json({ error: "Thiếu 'script' (nội dung .scr)" });
    const run = await runHeadless(
      bin,
      dwg ? String(dwg) : null,
      String(script),
      Number(timeoutMs) || 120_000,
    );
    res.json({ ok: run.ok, exit: run.exit, output: run.stdout.slice(-4000) });
  });

  // Kênh 1b — batch: chạy CÙNG một script trên NHIỀU file DWG (headless, tuần tự).
  r.post("/batch", async (req, res) => {
    const { script, dwgs, timeoutMs = 120000 } = req.body ?? {};
    const bin = findCoreConsole();
    if (!bin) return res.status(400).json({ error: "Không thấy AcCoreConsole" });
    if (!script || !Array.isArray(dwgs) || !dwgs.length)
      return res.status(400).json({ error: "Cần 'script' và mảng 'dwgs'" });
    const results: any[] = [];
    for (const dwg of dwgs) {
      const run = await runHeadless(bin, String(dwg), String(script), Number(timeoutMs) || 120_000);
      results.push({
        dwg,
        ok: run.ok,
        exit: run.exit,
        tail: run.stdout.slice(-500),
      });
    }
    res.json({ count: results.length, ok: results.filter((x) => x.ok).length, results });
  });

  // Kênh 2 — job vào session GUI đang mở: ghi job.lsp; plugin auto-load (keystroke = fallback).
  r.post("/job", async (req, res) => {
    const { lisp, wait = 15000 } = req.body ?? {};
    if (!lisp) return res.status(400).json({ error: "Thiếu 'lisp' (payload AutoLISP)" });
    if (
      liveJobPending > 0 ||
      (activeJob && activeJob.state === "sent" && Date.now() - activeJob.createdAt < 120000)
    )
      return res.status(409).json({ error: "Đang có job chạy dở", jobId: activeJob?.jobId });
    if (!(await acadRunning()))
      return res.status(400).json({ error: "AutoCAD chưa chạy — POST /api/acad/open trước" });

    const trigger = req.body?.trigger || "run"; // "run" = plugin bridge; "keystroke" = tự bơm
    if (trigger === "run") {
      const out = await dispatchLiveJob(
        String(lisp),
        req.body?.target ? String(req.body.target) : undefined,
        wait,
      );
      return res.json({
        ...out,
        hint:
          out.state === "sent"
            ? "Job đã sẵn ở " + getJobLsp() + ". Trong AutoCAD gõ MEP-RUN (hoặc bấm nút MEP-RUN) để chạy."
            : undefined,
      });
    }

    const release = await acquireLiveJobLock();
    let backgroundOwnsRelease = false;
    try {
      const jobId = randomUUID().slice(0, 8);
      ensureBridgeDirs();
      writeFileSync(
        join(getBridgeDir(), "job_target.txt"),
        req.body?.target ? String(req.body.target) : "",
        "utf8",
      );
      atomicWrite(getJobLsp(), wrapJob(jobId, lisp));
      const job: JobRecord = { jobId, state: "pending", createdAt: Date.now() };
      activeJob = job;

      const app = findAcadApp()!;
      const loadForm = `(load "${getJobLsp().replace(/\\/g, "\\\\")}")`;

      // Cách KEYSTROKE (tự động, cần Accessibility): DÁN qua clipboard để bỏ qua bộ gõ tiếng Việt.
      await new Promise<void>((resolve) => {
        const pb = spawn("pbcopy");
        pb.on("close", () => resolve());
        pb.on("error", () => resolve());
        pb.stdin.end(loadForm);
      });
      const scpt = `tell application "${app}" to activate
delay 0.8
tell application "System Events"
  key code 53
  key code 53
  delay 0.2
  keystroke "v" using command down
  delay 0.2
  key code 36
end tell`;
      const keyError = await new Promise<{ err: Error | null; stderr: string }>((resolve) => {
        execFile("osascript", ["-e", scpt], (err, _o, stderr) =>
          resolve({ err, stderr: stderr || "" }));
      });
      const { err, stderr } = keyError;
      const msg = (stderr || String(err || "")).toLowerCase();
      if (err && /assistive|1002|-1728|1743|not allowed/.test(msg)) {
        job.state = "error";
        rememberJob(job);
        return res.status(403).json({
          jobId, state: "error",
          error: "Chưa có quyền Accessibility cho Acad Studio (System Settings › Privacy & Security › Accessibility). " +
            "Cách chắc chắn không cần quyền: gõ MEP-RUN trong AutoCAD — job đã ghi sẵn ở " + getJobLsp(),
          manualLisp: loadForm,
        });
      }
      job.state = "sent";
      const state = await pollResult(job, wait);
      rememberJob(job);
      if (state === "sent") {
        backgroundOwnsRelease = true;
        void (async () => {
          try {
            const settled = await pollResult(job, 120_000);
            if (settled === "sent") job.state = "timeout";
            rememberJob(job);
          } finally {
            release();
          }
        })();
      }
      return res.json({ jobId, state, result: job.result ?? null,
        hint: state === "sent" ? "Nếu AutoCAD hiện SECURELOAD bấm 'Load'; hoặc gõ MEP-RUN." : undefined });
    } finally {
      if (!backgroundOwnsRelease) release();
    }
  });

  r.get("/job/:id", (req, res) => {
    const id = req.params.id;
    const r2 = readResult(id);
    if (r2) return res.json({ jobId: id, state: r2.status === "ok" ? "done" : "error", result: r2 });
    const h = history.find((j) => j.jobId === id) || (activeJob?.jobId === id ? activeJob : null);
    res.json({ jobId: id, state: h?.state ?? "unknown", result: h?.result ?? null });
  });

  // Hộp thoại chọn file/thư mục native (macOS) — trả path tuyệt đối.
  r.post("/pick", (req, res) => {
    const kind = (req.body ?? {}).kind;
    const purpose = (req.body ?? {}).purpose;
    const script = kind === "folder"
      ? purpose === "lisp-library"
        ? 'POSIX path of (choose folder with prompt "Chọn thư mục chứa LISP / DCL / FAS / VLX")'
        : 'POSIX path of (choose folder with prompt "Chọn thư mục bản vẽ")'
      : 'POSIX path of (choose file with prompt "Chọn bản vẽ (.dwg)" of type {"dwg"})';
    execFile("osascript", ["-e", script], (err, stdout) => {
      if (err) return res.json({ cancelled: true });
      res.json({ path: stdout.trim() });
    });
  });

  // Mở app / mở bản vẽ trong GUI.
  // body: { path?: string, new?: boolean }
  //  - path: mở file DWG cụ thể
  //  - new: true → tạo/ghi scratch DWG trống rồi mở (để thao tác ObjectARX raw ngay)
  //  - không path: chỉ mở AutoCAD (user New/Open thủ công)
  r.post("/open", async (req, res) => {
    const { path: reqPath, new: wantNew } = req.body ?? {};
    const app = findAcadApp();
    if (!app) return res.status(400).json({ error: "Không thấy AutoCAD trong /Applications/Autodesk" });

    let pathToOpen: string | undefined = reqPath ? String(reqPath) : undefined;
    let created: string | undefined;

    if (wantNew || (!pathToOpen && req.body?.scratch)) {
      // Scratch DWG trong thư mục dự án .work (tạo bằng AcCoreConsole nếu chưa có)
      const projectRoot = process.env.MEP_PROJECT_ROOT || join(homedir(), "Desktop", "tool-autocad");
      const workDir = join(projectRoot, "acad-studio", ".work");
      mkdirSync(workDir, { recursive: true });
      const scratch = join(workDir, "MEP-RAW-scratch.dwg");
      if (!existsSync(scratch)) {
        const bin = findCoreConsole();
        if (bin) {
          const escPath = scratch.replace(/\\/g, "\\\\");
          await runHeadless(
            bin,
            null,
            `(setvar "FILEDIA" 0)(setvar "CMDDIA" 0)\n` +
              `(command "_.SAVEAS" "2018" "${escPath}")\n(princ)\n`,
            45_000,
          );
        }
      }
      if (existsSync(scratch)) {
        pathToOpen = scratch;
        created = scratch;
      } else if (wantNew) {
        // Fallback: chỉ mở app; user gõ NEW trong AutoCAD
        pathToOpen = undefined;
      }
    }

    const args = pathToOpen ? ["-a", app, pathToOpen] : ["-a", app];
    execFile("open", args, (err) =>
      res.json({
        ok: !err,
        error: err ? String(err) : undefined,
        app,
        path: pathToOpen || null,
        created: created || null,
        hint: pathToOpen
          ? `Đã mở AutoCAD với ${pathToOpen}. Đợi plugin AcadBridge nạp, rồi chạy ObjectARX raw.`
          : "Đã mở AutoCAD. Trong AutoCAD: File → New (hoặc gõ NEW), rồi chạy ObjectARX raw.",
      }));
  });

  // ── Recipe MEP: tận dụng AcCoreConsole headless (đọc/bóc tách/sửa/xuất) ──
  // POST /api/acad/mep/:recipe  { dwgs?:[], dir?, params?, save?, outDir?, timeoutMs? }
  r.post("/mep/:recipe", async (req, res) => {
    const bin = findCoreConsole();
    if (!bin) return res.status(400).json({ error: "Không thấy AcCoreConsole (cần AutoCAD 2027)" });
    if (!existsSync(mepLib())) return res.status(500).json({ error: "Không thấy mep_lib.lsp: " + mepLib() });

    const recipe = req.params.recipe;
    const { dwgs, dir, params = {}, save = "copy", outDir, timeoutMs = 120000 } = req.body ?? {};
    let files: string[] = Array.isArray(dwgs) ? dwgs : [];
    if (dir) {
      try {
        files = files.concat(
          readdirSync(String(dir), { withFileTypes: true })
            .filter((entry) => entry.isFile() && /\.dwg$/i.test(entry.name))
            .map((entry) => join(String(dir), entry.name)),
        );
      } catch {
        /* validation below reports an empty input */
      }
    }
    files = [...new Set(files)].filter((f) => existsSync(f));
    if (!files.length && recipe === "drawpipes") files = [""]; // vẽ vào bản vẽ mới (trống)
    if (!files.length) return res.status(400).json({ error: "Cần 'dwgs' (mảng path) hoặc 'dir'" });

    const outBase = outDir || join(tmpdir(), `mep_out_${randomUUID().slice(0, 6)}`);
    mkdirSync(outBase, { recursive: true });
    const esc = (p: string) => p.replace(/\\/g, "\\\\");
    const sv = (dwg: string) => {
      if (save === "inplace") return `(command "_.QSAVE")`;
      const o = join(outBase, basename(dwg));
      return `(command "_.SAVEAS" "2018" "${esc(o)}")`;
    };

    // recipe → { body(dwg,jobOut), reads:[file], modifies }
    const build = (dwg: string, jobOut: string): { body: string; reads: string[] } | null => {
      const o = (n: string) => esc(join(jobOut, n));
      switch (recipe) {
        case "bompipe": return { body: `(mep:pipe-bom "${o("pipe.csv")}")(princ)`, reads: ["pipe.csv"] };
        case "bompipe2": return { body: `(mep:pipe-bom-dn "${o("pipe.csv")}")(princ)`, reads: ["pipe.csv"] };
        case "titlerows": return { body: `(mep:title-rows "${o("index.csv")}")(princ)`, reads: ["index.csv"] };
        case "bomfit": return { body: `(mep:fit-bom "${o("fit.csv")}")(princ)`, reads: ["fit.csv"] };
        case "layers": return { body: `(mep:layers "${o("lay.csv")}")(princ)`, reads: ["lay.csv"] };
        case "stats": return { body: `(mep:stats "${o("stat.csv")}")(princ)`, reads: ["stat.csv"] };
        case "titleindex": return { body: `(mep:read-title "${o("title.txt")}")(princ)`, reads: ["title.txt"] };
        case "titlefix": {
          const kv = Object.entries(params as Record<string, string>)
            .map(([k, v]) => `(cons "${String(k).toUpperCase()}" "${esc(String(v))}")`).join(" ");
          if (!kv) return null;
          return { body: `(mep:set-title (list ${kv}))\n${sv(dwg)}(princ)`, reads: [] };
        }
        case "qa":
          return { body: `(command "_.AUDIT" "_Y")\n(command "_.-OVERKILL" (ssget "_X") "" "")\n(command "_.-PURGE" "_All" "*" "_N")\n${sv(dwg)}(princ)`, reads: [] };
        case "stdlayers": return { body: `(mep:std-layers)\n${sv(dwg)}(princ)`, reads: [] };
        case "tagpipes": return { body: `(mep:tag-pipes)\n${sv(dwg)}(princ)`, reads: [] };
        case "numberpipes": return { body: `(mep:number-pipes)\n${sv(dwg)}(princ)`, reads: [] };
        case "drawpipes": {
          const pipes = (params as any).pipes;
          if (!Array.isArray(pipes) || !pipes.length) return null;
          const sysLayer = (s: string) => {
            const u = String(s).toUpperCase();
            if (/XI/.test(u)) return "P-ThoatXi";
            if (/RUA|RỬA/.test(u)) return "P-ThoatRua";
            if (/HOI|HƠI/.test(u)) return "P-ThongHoi";
            if (/CAP|NUOC|CẤP/.test(u)) return "DCCD-nuoclanh";
            return s;
          };
          const draws = pipes.map((p: any) => {
            const pts = (p.points || []).map((pt: number[]) => `(list ${pt[0]} ${pt[1]})`).join(" ");
            return `(mep:draw-pipe "${sysLayer(p.system)}" ${Number(p.dn) || 90} (list ${pts}))`;
          }).join("\n");
          const outName = dwg ? basename(dwg) : "ban-ve-moi.dwg";
          return { body: `(mep:std-layers)\n${draws}\n(command "_.SAVEAS" "2018" "${esc(join(outBase, outName))}")(princ)`, reads: [] };
        }
        case "convert":
          return { body: `(command "_.SAVEAS" "${(params as any).version || "2013"}" "${esc(join(outBase, basename(dwg)))}")(princ)`, reads: [] };
        case "dxfout":
          return { body: `(command "_.DXFOUT" "${esc(join(outBase, basename(dwg).replace(/\.dwg$/i, ".dxf")))}" "_V" "2018" "16")(princ)`, reads: [] };
        default: return null;
      }
    };

    if (!build(files[0], outBase)) return res.status(400).json({ error: `recipe không hợp lệ: ${recipe}` });

    const MODIFY = ["convert", "dxfout", "titlefix", "qa", "stdlayers", "tagpipes", "numberpipes", "drawpipes"];
    const results: any[] = [];
    for (const dwg of files) {
      const jobOut = files.length > 1 && !MODIFY.includes(recipe)
        ? join(outBase, basename(dwg, ".dwg")) : outBase;
      if (jobOut !== outBase) mkdirSync(jobOut, { recursive: true });
      const spec = build(dwg, jobOut)!;
      const run = await runHeadless(bin, dwg || null, loadLib() + spec.body, timeoutMs);
      const data: any = { dwg: dwg ? basename(dwg) : "ban-ve-moi.dwg", ok: run.ok };
      for (const rf of spec.reads) {
        const p = join(jobOut, rf);
        if (existsSync(p)) data[rf.replace(/\.\w+$/, "")] =
          rf.endsWith(".csv") ? csvToRows(readFileSync(p, "latin1"))
            : Object.fromEntries(readFileSync(p, "latin1").trim().split("\n").filter(Boolean)
                .map((l) => { const [t, ...v] = decodeAcad(l).split("\t"); return [t, v.join("\t")]; }));
      }
      if (!run.ok) data.error = run.stdout.slice(-300);
      results.push(data);
    }
    res.json({ recipe, count: results.length, outDir: outBase, results });
  });

  // Kênh 3 — fallback: bơm phím (cần quyền Accessibility). Chỉ ASCII + Return.
  r.post("/keystroke", async (req, res) => {
    const { text } = req.body ?? {};
    if (!text || !/^[\x20-\x7e]+$/.test(text))
      return res.status(400).json({ error: "Chỉ nhận text ASCII 1 dòng" });
    if (!(await acadRunning())) return res.status(400).json({ error: "AutoCAD chưa chạy" });
    const scpt = `tell application "${findAcadApp()}" to activate
delay 0.6
tell application "System Events"
  key code 53
  key code 53
  keystroke "${text.replace(/[\\"]/g, "")}"
  key code 36
end tell`;
    execFile("osascript", ["-e", scpt], (err, _o, stderr) =>
      res.json({ ok: !err, error: err ? (stderr || String(err)).slice(0, 300) : undefined }));
  });

  return r;
}

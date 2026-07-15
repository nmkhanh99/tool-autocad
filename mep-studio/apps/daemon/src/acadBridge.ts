/** Cầu điều khiển AutoCAD for Mac — 3 kênh, xếp theo độ tin cậy:
 *  1. headless : AcCoreConsole (Contents/Helpers) chạy .scr trên DWG đóng, không cần GUI.
 *  2. job      : nạp job .lsp vào SESSION ĐANG MỞ qua `open -a` (odoc, tương đương kéo-thả
 *                — .lsp nằm trong CFBundleDocumentTypes). LISP ghi result file để daemon đọc.
 *  3. keystroke: bơm phím qua System Events — CHỈ fallback (cần Accessibility, phụ thuộc focus).
 */
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, globSync } from "node:fs";
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
  bridgeResultsDir,
  ensureBridgeDir,
  healthReportOk,
  isPluginInstalled,
  mergeLiveHealth,
  openPayload,
  pluginApploadPath,
  pluginInstallDirs,
  scratchDwgPath,
  sdkIncPath,
} from "./acadControl.js";

export function mepLib(): string {
  if (process.env.MEP_ACAD_LIB) return process.env.MEP_ACAD_LIB;
  const root = process.env.MEP_PROJECT_ROOT || join(homedir(), "Desktop", "tool-autocad");
  return join(root, "acad-lisp/headless/mep_lib.lsp");
}

/** Decode chuỗi AutoCAD (\U+xxxx) sang Unicode để hiển thị tiếng Việt. */
function decodeAcad(s: string): string {
  return s.replace(/\\U\+([0-9A-Fa-f]{4})/g, (_m, h) => String.fromCodePoint(parseInt(h, 16)));
}
function csvToRows(text: string): string[][] {
  return text.trim().split("\n").filter(Boolean).map((l) => decodeAcad(l).split(","));
}
/** Chạy AcCoreConsole 1 lần trên 1 DWG với script body cho trước. */
export function runHeadless(bin: string, dwg: string | null, body: string, timeoutMs: number):
  Promise<{ ok: boolean; exit: any; stdout: string }> {
  const scr = join(tmpdir(), `mep_${randomUUID().slice(0, 8)}.scr`);
  writeFileSync(scr, body.endsWith("\n") ? body : body + "\n", "utf8");
  const args = [...(dwg ? ["/i", dwg] : []), "/s", scr, "/l", "en-US"];
  return new Promise((resolve) =>
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, so, se) => {
      try { rmSync(scr); } catch { /* */ }
      resolve({ ok: !err, exit: err ? ((err as any).code ?? "killed") : 0, stdout: (so || "") + (se || "") });
    }));
}
const loadLib = () => `(load "${mepLib().replace(/\\/g, "\\\\")}")\n(setvar "FILEDIA" 0)(setvar "CMDDIA" 0)\n`;

/** Hệ → (layer, màu ACI) khớp *MEP-STD-LAYERS* trong mep_lib.lsp. */
const STD_LAYER_COLOR: Record<string, number> = {
  "P-ThoatXi": 190, "P-ThoatRua": 50, "P-ThongHoi": 5, "DCCD-nuoclanh": 90, "P-ThietBi": 2, "MEP-GHICHU": 2,
};
function sysToLayer(s: string): string {
  const u = String(s).toUpperCase();
  if (/XI/.test(u)) return "P-ThoatXi";
  if (/RUA|RỬA/.test(u)) return "P-ThoatRua";
  if (/HOI|HƠI/.test(u)) return "P-ThongHoi";
  if (/CAP|NUOC|CẤP/.test(u)) return "DCCD-nuoclanh";
  return s;
}
/** Dựng file native.job (bảng phân tách TAB) cho plugin C++ từ danh sách ống {system,dn,points}. */
export function buildNativeJob(target: string, pipes: any[]): string {
  const lines: string[] = ["MODE\tCOMMIT"];
  if (target) lines.push(`TARGET\t${target}`);
  const seen = new Set<string>();
  for (const p of pipes) {
    const layer = sysToLayer(p.system);
    if (!seen.has(layer)) { lines.push(`LAYER\t${layer}\t${STD_LAYER_COLOR[layer] ?? 0}`); seen.add(layer); }
    const pts = (p.points || []).map((pt: number[]) => `${pt[0]},${pt[1]}`).join(" ");
    lines.push(`PIPE\t${layer}\t${Number(p.dn) || 90}\t${p.system}\t${pts}`);
  }
  return lines.join("\n");
}

const BRIDGE_DIR = process.env.MEP_BRIDGE_DIR || join(homedir(), "MEP-Bridge");
const RESULTS_DIR = join(BRIDGE_DIR, "results");
const JOB_LSP = join(BRIDGE_DIR, "mep_job.lsp");

export function findAcadApp(): string | null {
  // Chỉ nhận app chính "AutoCAD <năm>.app" (loại Plot Style Editor, Remove AutoCAD...).
  const hits = globSync("/Applications/Autodesk/AutoCAD */AutoCAD *.app")
    .filter((p) => /\/AutoCAD \d{4}\.app$/.test(p))
    .sort();
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
    execFile("pgrep", ["-f", "AutoCAD.*\\.app/Contents/MacOS/AutoCAD"], (err, stdout) => {
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
  mkdirSync(RESULTS_DIR, { recursive: true });
}

/** Ghi ATOMIC (temp + rename) để plugin ObjectARX watch không đọc file ghi dở. */
function atomicWrite(path: string, content: string): void {
  const tmp = `${path}.${randomUUID().slice(0, 6)}.tmp`;
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, path);
}

/** Ghi 1 job LISP (đã bọc result) vào ~/MEP-Bridge/mep_job.lsp — plugin tự chạy, hoặc gõ MEP-RUN.
 *  target: tên/đường dẫn bản vẽ đích đang mở trong AutoCAD (plugin sẽ gửi job vào đúng bản vẽ đó). */
export function writeLiveJob(lisp: string, target?: string): string {
  ensureBridgeDirs();
  writeFileSync(join(BRIDGE_DIR, "job_target.txt"), target ? String(target) : "", "utf8");
  atomicWrite(JOB_LSP, wrapJob(randomUUID().slice(0, 8), lisp));
  return JOB_LSP;
}

/** Nội dung mep_lib.lsp để NHÚNG THẲNG vào job (không (load) lồng → không SECURELOAD lần 2). */
export function inlineLib(): string {
  try { return readFileSync(mepLib(), "utf8") + "\n"; } catch { return ""; }
}

/** Hỏi plugin danh sách bản vẽ đang mở (ghi docs.req → chờ docs.json mới). Heartbeat plugin. */
export async function listOpenDocs(timeoutMs = 3000):
  Promise<{ alive: boolean; docs: { title: string; file: string; active: boolean }[] }> {
  ensureBridgeDirs();
  const reqAt = Date.now();
  writeFileSync(join(BRIDGE_DIR, "docs.req"), String(reqAt), "utf8");
  const docsPath = join(BRIDGE_DIR, "docs.json");
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

/** Escape chuỗi cho AutoLISP. */
const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/"/g, "\\\"");

/** Bọc payload LISP: đánh dấu running, bẫy lỗi, ghi result file có sentinel. */
function wrapJob(jobId: string, lisp: string): string {
  const res = esc(join(RESULTS_DIR, `${jobId}.txt`));
  const run = esc(join(RESULTS_DIR, `${jobId}.running`));
  return `;;; MEP job ${jobId} — sinh tự động bởi mep-daemon
(setq mep:resfile "${res}")
(defun mep:write-result (status msg / f)
  (setq f (open mep:resfile "w"))
  (write-line (strcat "status=" status) f)
  (write-line (if (= (type msg) 'STR) msg (vl-princ-to-string msg)) f)
  (write-line "==end==" f)
  (close f)
  (princ))
(setq f (open "${run}" "w")) (write-line "running" f) (close f)
(setq *error*
  (lambda (m) (mep:write-result "error" (if m m "loi khong ro")) (princ)))
${lisp}
(if (null (findfile mep:resfile)) (mep:write-result "ok" "job da chay xong"))
(setq *error* nil)
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

function readResult(jobId: string): { status: string; message: string } | null {
  const p = join(RESULTS_DIR, `${jobId}.txt`);
  if (!existsSync(p)) return null;
  const raw = readFileSync(p, "utf8");
  if (!raw.includes("==end==")) return null; // đang ghi dở
  const lines = raw.split("\n");
  const status = (lines[0] || "").replace("status=", "").trim() || "ok";
  const message = lines.slice(1, lines.indexOf("==end==")).join("\n").trim();
  return { status, message };
}

async function pollResult(jobId: string, waitMs: number): Promise<JobRecord["state"]> {
  const t0 = Date.now();
  while (Date.now() - t0 < waitMs) {
    const r = readResult(jobId);
    if (r) {
      activeJob!.result = r;
      activeJob!.state = r.status === "ok" ? "done" : "error";
      return activeJob!.state;
    }
    await new Promise((s) => setTimeout(s, 400));
  }
  return "sent"; // chưa xong — client có thể GET /job/:id sau
}

export function acadBridgeRouter(): Router {
  const r = express.Router();

  r.get("/status", async (_req, res) => {
    const app = findAcadApp();
    res.json({
      app,
      running: await acadRunning(),
      coreConsole: findCoreConsole(),
      bridgeDir: BRIDGE_DIR,
      activeJob: activeJob ? { jobId: activeJob.jobId, state: activeJob.state } : null,
      trustedHint:
        "Lần đầu chạy job nếu AutoCAD hỏi SECURELOAD, chọn 'Load'. Để hết hỏi: lệnh TRUSTEDPATHS thêm " +
        BRIDGE_DIR + "/...",
    });
  });

  // Gửi 1 job LISP vào AutoCAD đang mở và chờ kết quả (dùng chung cho /job + /livequery).
  async function dispatchLiveJob(lisp: string, target: string | undefined, wait: number) {
    const jobId = randomUUID().slice(0, 8);
    ensureBridgeDirs();
    writeFileSync(join(BRIDGE_DIR, "job_target.txt"), target ? String(target) : "", "utf8");
    atomicWrite(JOB_LSP, wrapJob(jobId, lisp));
    activeJob = { jobId, state: "sent", createdAt: Date.now() };
    const state = await pollResult(jobId, wait);
    history.unshift({ ...activeJob! }); history.splice(20);
    return { jobId, state, result: activeJob!.result ?? null };
  }

  // Sự kiện realtime từ AutoCAD (plugin ghi events.jsonl qua reactor) — SSE.
  r.get("/events", (req, res) => {
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache");
    res.flushHeaders();
    const file = join(BRIDGE_DIR, "events.jsonl");
    let pos = 0;
    const push = (chunk: string) =>
      chunk.split("\n").filter(Boolean).forEach((l) => res.write(`data: ${l}\n\n`));
    try {
      const all = readFileSync(file, "utf8");
      push(all.split("\n").filter(Boolean).slice(-15).join("\n"));   // 15 sự kiện gần nhất
      pos = Buffer.byteLength(all);
    } catch { /* chưa có file */ }
    const timer = setInterval(() => {
      try {
        const st = statSync(file);
        if (st.size < pos) pos = 0;                                   // plugin truncate
        if (st.size > pos) {
          const all = readFileSync(file, "utf8");
          push(all.slice(pos));
          pos = Buffer.byteLength(all);
        }
      } catch { /* */ }
    }, 500);
    res.on("close", () => clearInterval(timer));
  });

  // Truy vấn TRỰC TIẾP bản vẽ đang mở: selection / layers / count / title.
  r.post("/livequery", async (req, res) => {
    const { what, target, wait = 8000 } = req.body ?? {};
    if (!(await acadRunning())) return res.status(400).json({ error: "AutoCAD chưa chạy" });
    const out = join(RESULTS_DIR, `q_${randomUUID().slice(0, 6)}.txt`);
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
    if (!id) return res.status(400).json({ ok: false, error: "Thiếu id (capability id từ catalog)" });
    const running = await acadRunning();
    const result = await invokeRaw(
      { id: String(id), target: target ? String(target) : undefined, params: params || {} },
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
    atomicWrite(join(BRIDGE_DIR, "native.job"), buildNativeJob(target, pipes));
    const doneFile = join(BRIDGE_DIR, "native.done");
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
    if (!alive) return res.status(400).json({ ok: false, error: "Plugin MepBridge không phản hồi (heartbeat)" });
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

  // QA highlight + zoom (rank 7): app bấm 1 nhóm ống → AutoCAD sáng + zoom tới nhóm đó.
  r.post("/highlight", async (req, res) => {
    if (!(await acadRunning())) return res.status(400).json({ error: "AutoCAD chưa chạy" });
    ensureBridgeDirs();
    const { target = "", layer = "" } = req.body ?? {};
    const before = Date.now();
    atomicWrite(join(BRIDGE_DIR, "select.req"), `${target}|${layer}`);
    const evFile = join(BRIDGE_DIR, "events.jsonl");
    while (Date.now() - before < 6000) {   // chờ event highlighted
      try {
        const st = statSync(evFile);
        if (st.mtimeMs >= before - 50) {
          const last = readFileSync(evFile, "utf8").trim().split("\n").slice(-3).join(" ");
          if (last.includes("highlighted")) return res.json({ ok: true, hint: `✓ Đã sáng + zoom "${layer}".` });
        }
      } catch { /* */ }
      await new Promise((r2) => setTimeout(r2, 120));
    }
    res.json({ ok: false, error: "Plugin không phản hồi — khởi động lại AutoCAD (nạp plugin mới)." });
  });

  // Chèn BẢNG BOQ (AcDbTable) vào bản vẽ đang mở — plugin C++ dựng bảng thật.
  r.post("/bomtable", async (req, res) => {
    if (!(await acadRunning())) return res.status(400).json({ error: "AutoCAD chưa chạy" });
    ensureBridgeDirs();
    const { target = "", x = 0, y = 0 } = req.body ?? {};
    const before = Date.now();
    writeFileSync(join(BRIDGE_DIR, "bomtable.req"), `${target}|${Number(x) || 0}|${Number(y) || 0}`, "utf8");
    const evFile = join(BRIDGE_DIR, "events.jsonl");
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
    writeFileSync(join(BRIDGE_DIR, "bom.req"), String(req.query.target ?? ""), "utf8");
    const bomPath = join(BRIDGE_DIR, "bom.json");
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
        : `Plugin MepBridge không phản hồi. APPLOAD: ${appload} — hoặc setup/restartacad (⚙ Kiểm tra AutoCAD).`,
    });
  });

  // Kiểm tra cấu hình AutoCAD/plugin — checklist + fix id.
  r.get("/health", async (_req, res) => {
    const app = findAcadApp();
    const core = findCoreConsole();
    const bridgeOk = existsSync(RESULTS_DIR);
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
    const checks = mergeLiveHealth(staticChecks, {
      running,
      pluginAlive,
      docsCount,
      pluginInstalled: pluginOk,
      apploadPath: pluginApploadPath(),
    });
    const dirs = pluginInstallDirs();
    res.json({
      ok: healthReportOk(checks),
      checks,
      channels: {
        headless: !!core,
        livePlugin: pluginAlive,
        running,
      },
      paths: {
        bridge: BRIDGE_DIR,
        pluginPlugins: dirs.plugins,
        pluginAddins: dirs.addins,
        appload: pluginApploadPath(),
        scratch: scratchDwgPath(process.env.MEP_PROJECT_ROOT || join(homedir(), "Desktop", "tool-autocad")),
      },
    });
  });

  // Sửa cái thiếu: bridge / build plugin / open / restart AutoCAD.
  r.post("/setup/:action", async (req, res) => {
    const action = req.params.action;
    if (action === "mkbridge") {
      ensureBridgeDir();
      ensureBridgeDirs();
      return res.json({ ok: true, detail: "Đã tạo ~/MEP-Bridge + results/" });
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
            ? `Đã build + cài plugin. APPLOAD: ${pluginApploadPath()} — hoặc restart AutoCAD.`
            : "Build lỗi",
          appload: pluginApploadPath(),
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
      mkdirSync(join(projectRoot, "mep-studio", ".work"), { recursive: true });
      if (!existsSync(scratch)) {
        const bin = findCoreConsole();
        if (bin) {
          const scr = join(tmpdir(), `mep_new_${randomUUID().slice(0, 6)}.scr`);
          writeFileSync(scr,
            `(setvar "FILEDIA" 0)(setvar "CMDDIA" 0)\n(command "_.SAVEAS" "2018" "${scratch.replace(/\\/g, "\\\\")}")\n(princ)\n`,
            "utf8");
          await new Promise<void>((resolve) =>
            execFile(bin, ["/s", scr, "/l", "en-US"], { timeout: 45000 }, () => {
              try { rmSync(scr, { force: true }); } catch { /* */ }
              resolve();
            }));
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
        });
      });
    }
    res.status(400).json({ ok: false, error: "action không hợp lệ (mkbridge|buildplugin|openacad|restartacad)" });
  });

  // Kênh 1 — headless: chạy .scr (hoặc trên 1 DWG) bằng AcCoreConsole, không cần GUI.
  r.post("/headless", async (req, res) => {
    const { script, dwg, timeoutMs = 120000 } = req.body ?? {};
    const bin = findCoreConsole();
    if (!bin) return res.status(400).json({ error: "Không thấy AcCoreConsole (cần AutoCAD 2027)" });
    if (!script) return res.status(400).json({ error: "Thiếu 'script' (nội dung .scr)" });
    const scr = join(tmpdir(), `mep_${randomUUID().slice(0, 8)}.scr`);
    writeFileSync(scr, script.endsWith("\n") ? script : script + "\n", "utf8");
    const args = [...(dwg ? ["/i", dwg] : []), "/s", scr, "/l", "en-US"];
    execFile(bin, args, { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (err, stdout, stderr) => {
      const out = (stdout || "") + (stderr || "");
      res.json({ ok: !err, exit: err ? ((err as any).code ?? "killed") : 0, output: out.slice(-4000) });
    });
  });

  // Kênh 1b — batch: chạy CÙNG một script trên NHIỀU file DWG (headless, tuần tự).
  r.post("/batch", async (req, res) => {
    const { script, dwgs, timeoutMs = 120000 } = req.body ?? {};
    const bin = findCoreConsole();
    if (!bin) return res.status(400).json({ error: "Không thấy AcCoreConsole" });
    if (!script || !Array.isArray(dwgs) || !dwgs.length)
      return res.status(400).json({ error: "Cần 'script' và mảng 'dwgs'" });
    const scr = join(tmpdir(), `mep_batch_${randomUUID().slice(0, 8)}.scr`);
    writeFileSync(scr, script.endsWith("\n") ? script : script + "\n", "utf8");
    const results: any[] = [];
    for (const dwg of dwgs) {
      const out = await new Promise<any>((resolve) =>
        execFile(bin, ["/i", dwg, "/s", scr, "/l", "en-US"],
          { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 },
          (err, stdout, stderr) =>
            resolve({ dwg, ok: !err, exit: err ? ((err as any).code ?? "killed") : 0,
              tail: ((stdout || "") + (stderr || "")).slice(-500) })));
      results.push(out);
    }
    res.json({ count: results.length, ok: results.filter((x) => x.ok).length, results });
  });

  // Kênh 2 — job vào session GUI đang mở: ghi mep_job.lsp rồi keystroke (load ...).
  r.post("/job", async (req, res) => {
    const { lisp, wait = 15000 } = req.body ?? {};
    if (!lisp) return res.status(400).json({ error: "Thiếu 'lisp' (payload AutoLISP)" });
    if (activeJob && activeJob.state === "sent" && Date.now() - activeJob.createdAt < 120000)
      return res.status(409).json({ error: "Đang có job chạy dở", jobId: activeJob.jobId });
    if (!(await acadRunning()))
      return res.status(400).json({ error: "AutoCAD chưa chạy — POST /api/acad/open trước" });

    const jobId = randomUUID().slice(0, 8);
    ensureBridgeDirs();
    writeFileSync(join(BRIDGE_DIR, "job_target.txt"), req.body?.target ? String(req.body.target) : "", "utf8");
    atomicWrite(JOB_LSP, wrapJob(jobId, lisp));
    activeJob = { jobId, state: "pending", createdAt: Date.now() };

    const app = findAcadApp()!;
    const loadForm = `(load "${JOB_LSP.replace(/\\/g, "\\\\")}")`;
    const trigger = req.body?.trigger || "run"; // "run" = native MEP-RUN (không Accessibility); "keystroke" = tự bơm

    // Cách NATIVE (khuyên dùng): job đã ghi sẵn, người dùng gõ MEP-RUN trong AutoCAD.
    // Không cần Accessibility, không kẹt bộ gõ tiếng Việt.
    if (trigger === "run") {
      activeJob!.state = "sent";
      const state = await pollResult(jobId, wait);
      history.unshift({ ...activeJob! }); history.splice(20);
      return res.json({ jobId, state, result: activeJob!.result ?? null,
        hint: state === "sent" ? "Job đã sẵn ở " + JOB_LSP + ". Trong AutoCAD gõ MEP-RUN (hoặc bấm nút MEP-RUN) để chạy." : undefined });
    }

    // Cách KEYSTROKE (tự động, cần Accessibility): DÁN qua clipboard để bỏ qua bộ gõ tiếng Việt.
    await new Promise<void>((resolve) => {
      const pb = spawn("pbcopy"); pb.on("close", () => resolve()); pb.on("error", () => resolve()); pb.stdin.end(loadForm);
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
    execFile("osascript", ["-e", scpt], async (err, _o, stderr) => {
      const msg = (stderr || String(err || "")).toLowerCase();
      if (err && /assistive|1002|-1728|1743|not allowed/.test(msg)) {
        activeJob!.state = "error";
        return res.status(403).json({
          jobId, state: "error",
          error: "Chưa có quyền Accessibility cho MEP Studio (System Settings › Privacy & Security › Accessibility). " +
            "Cách chắc chắn không cần quyền: gõ MEP-RUN trong AutoCAD — job đã ghi sẵn ở " + JOB_LSP,
          manualLisp: loadForm,
        });
      }
      activeJob!.state = "sent";
      const state = await pollResult(jobId, wait);
      history.unshift({ ...activeJob! }); history.splice(20);
      res.json({ jobId, state, result: activeJob!.result ?? null,
        hint: state === "sent" ? "Nếu AutoCAD hiện SECURELOAD bấm 'Load'; hoặc gõ MEP-RUN." : undefined });
    });
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
    const script = kind === "folder"
      ? 'POSIX path of (choose folder with prompt "Chọn thư mục bản vẽ")'
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
      const workDir = join(projectRoot, "mep-studio", ".work");
      mkdirSync(workDir, { recursive: true });
      const scratch = join(workDir, "MEP-RAW-scratch.dwg");
      if (!existsSync(scratch)) {
        const bin = findCoreConsole();
        if (bin) {
          const scr = join(tmpdir(), `mep_new_${randomUUID().slice(0, 6)}.scr`);
          const escPath = scratch.replace(/\\/g, "\\\\");
          writeFileSync(scr,
            `(setvar "FILEDIA" 0)(setvar "CMDDIA" 0)\n` +
            `(command "_.SAVEAS" "2018" "${escPath}")\n(princ)\n`, "utf8");
          await new Promise<void>((resolve) => {
            execFile(bin, ["/s", scr, "/l", "en-US"], { timeout: 45000 }, () => {
              try { rmSync(scr, { force: true }); } catch { /* */ }
              resolve();
            });
          });
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
          ? `Đã mở AutoCAD với ${pathToOpen}. Đợi plugin MepBridge nạp, rồi chạy ObjectARX raw.`
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
    if (dir) files = files.concat(globSync(join(dir, "*.dwg")));
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

/**
 * headlessDraw — chạy job vẽ bằng AcCoreConsole trên DWG ĐÓNG.
 *
 * Đây là kênh vẽ THẬT không cần GUI: mỗi lần gọi mở DWG, load draw_lib.lsp,
 * chạy LISP, ghi kết quả ra file rồi SAVEAS lại chính DWG đó.
 * Kênh live (AutoCAD đang mở + AcadBridge) dùng cùng LISP qua acadBridge.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

export const CORE_CONSOLE =
  process.env.ACAD_CORE_CONSOLE ||
  "/Applications/Autodesk/AutoCAD 2027/AutoCAD 2027.app/Contents/Helpers/AcCoreConsole.app/Contents/MacOS/AcCoreConsole";

export function coreConsoleAvailable(): boolean {
  return existsSync(CORE_CONSOLE);
}

export type HeadlessResult = {
  ok: boolean;
  exit: number | null;
  /** key=value đọc từ file result do (dl:result …) ghi ra */
  result: Record<string, string>;
  output: string;
  error?: string;
};

function parseResultFile(path: string): Record<string, string> {
  if (!existsSync(path)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    if (!line || line === "==end==") continue;
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i)] = line.slice(i + 1);
  }
  return out;
}

/**
 * Chạy một khối LISP. `dwg` = bản vẽ đích (bỏ trống → bản vẽ trống mới).
 * LISP tự chịu trách nhiệm SAVEAS (dùng buildStageLisp/… với savePath).
 */
export function runHeadlessLisp(opts: {
  lisp: string;
  dwg?: string;
  resultPath: string;
  timeoutMs?: number;
}): Promise<HeadlessResult> {
  const work = join(tmpdir(), `acad-draw-${randomUUID().slice(0, 8)}`);
  mkdirSync(work, { recursive: true });
  const lspPath = join(work, "job.lsp");
  const scrPath = join(work, "job.scr");
  writeFileSync(lspPath, opts.lisp, "utf8");
  // AcCoreConsole cần đường dẫn TUYỆT ĐỐI cho cả .scr lẫn (load …)
  writeFileSync(scrPath, `(load "${lspPath.replace(/\\/g, "\\\\")}")\n`, "utf8");
  if (existsSync(opts.resultPath)) rmSync(opts.resultPath, { force: true });
  mkdirSync(dirname(opts.resultPath), { recursive: true });

  const args = opts.dwg ? ["/i", opts.dwg, "/s", scrPath] : ["/s", scrPath];
  const timeoutMs = opts.timeoutMs ?? 180_000;

  return new Promise<HeadlessResult>((resolve) => {
    if (!coreConsoleAvailable()) {
      return resolve({
        ok: false, exit: null, result: {}, output: "",
        error: `Không thấy AcCoreConsole tại ${CORE_CONSOLE}`,
      });
    }
    const child = spawn(CORE_CONSOLE, args, { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let done = false;
    const timer = setTimeout(() => {
      if (!done) { done = true; child.kill("SIGKILL");
        resolve({ ok: false, exit: null, result: parseResultFile(opts.resultPath),
                  output: out, error: `AcCoreConsole quá ${timeoutMs}ms` }); }
    }, timeoutMs);
    child.stdout.on("data", (d) => (out += d.toString()));
    child.stderr.on("data", (d) => (out += d.toString()));
    child.on("close", (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      const result = parseResultFile(opts.resultPath);
      rmSync(work, { recursive: true, force: true });
      // AcCoreConsole trả 0 kể cả khi LISP lỗi → tin vào file result.
      const lispError = /; error:/.test(out);
      resolve({
        ok: !lispError && Object.keys(result).length > 0,
        exit: code, result, output: out,
        error: lispError ? (out.match(/; error:.*/)?.[0] ?? "LISP error") : undefined,
      });
    });
    child.on("error", (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve({ ok: false, exit: null, result: {}, output: out, error: String(e) });
    });
  });
}

/** Tạo bản vẽ trống mới tại `path` (dùng làm bản vẽ đích cho demo). */
export async function createBlankDwg(path: string): Promise<HeadlessResult> {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) rmSync(path, { force: true });
  const resultPath = `${path}.new.txt`;
  const lisp =
    `(setvar "CMDECHO" 0)(setvar "FILEDIA" 0)\n` +
    `(setvar "INSUNITS" 4)\n` +
    `(setq f (open "${resultPath}" "w"))(write-line "state=created" f)(write-line "==end==" f)(close f)\n` +
    `(command "_.SAVEAS" "2018" "${path}")\n(princ)\n`;
  const r = await runHeadlessLisp({ lisp, resultPath });
  rmSync(resultPath, { force: true });
  return { ...r, ok: r.ok && existsSync(path) };
}

/** Đọc báo cáo kiểm đếm do (dl:report …) ghi ra. */
export function readReport(path: string): Record<string, number> {
  if (!existsSync(path)) return {};
  const out: Record<string, number> = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const i = line.indexOf("=");
    if (i > 0) out[line.slice(0, i)] = Number(line.slice(i + 1)) || 0;
  }
  return out;
}

export { renameSync };

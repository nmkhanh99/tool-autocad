#!/usr/bin/env node
/**
 * Acad Studio — 1 entrypoint (giống `pnpm tools-dev` của Open Design).
 * Khởi động daemon + web, chờ 2 cổng sẵn sàng, rồi mở Electron shell.
 * Đóng cửa sổ / Ctrl+C -> tắt sạch cả 3 tiến trình.
 *
 * Dùng:  pnpm tools-dev            (mặc định: chạy full app desktop)
 *        pnpm tools-dev web        (chỉ daemon + web, mở trình duyệt)
 */
import { spawn } from "node:child_process";

const MODE = process.argv[2] || "app";
const DAEMON_URL = "http://127.0.0.1:8788/api/health";
const WEB_URL = "http://localhost:3000";
const procs = [];

function run(name, args, color) {
  const p = spawn("pnpm", args, { stdio: ["ignore", "pipe", "pipe"], env: process.env });
  const tag = `\x1b[${color}m[${name}]\x1b[0m `;
  const pipe = (s) => s.on("data", (d) =>
    d.toString().split("\n").filter(Boolean).forEach((l) => process.stdout.write(tag + l + "\n")));
  pipe(p.stdout); pipe(p.stderr);
  p.on("exit", (code) => {
    if (name === "electron") shutdown(0);
    else if (code) process.stdout.write(tag + `thoát mã ${code}\n`);
  });
  procs.push(p);
  return p;
}

async function waitFor(url, label, tries = 120) {
  process.stdout.write(`  … chờ ${label} (${url})\n`);
  for (let i = 0; i < tries; i++) {
    try { const r = await fetch(url); if (r.ok) { process.stdout.write(`  ✓ ${label} sẵn sàng\n`); return; } }
    catch { /* chưa lên */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  process.stdout.write(`  ✗ ${label} không lên sau ${tries / 2}s\n`);
}

function shutdown(code = 0) {
  for (const p of procs) { try { p.kill("SIGTERM"); } catch { /* */ } }
  setTimeout(() => process.exit(code), 300);
}
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log(`\n  🧰 Acad Studio — khởi động (${MODE})\n`);
run("daemon", ["--filter", "@acad/daemon", "dev"], "36");
run("web", ["--filter", "@acad/web", "dev"], "33");

await waitFor(DAEMON_URL, "daemon");
await waitFor(WEB_URL, "web");

if (MODE === "web") {
  console.log(`\n  🌐 Mở trình duyệt: ${WEB_URL}\n`);
  spawn("open", [WEB_URL]);
} else {
  console.log(`\n  🖥  Mở cửa sổ app...\n`);
  run("electron", ["--filter", "@acad/desktop", "dev"], "35");
}

#!/usr/bin/env node
/** Đóng gói MEP Studio -> .app/.dmg.
 * 1) Next static export  2) bundle daemon (esbuild)  3) copy wasm + web
 * 4) electron-builder (dmg + .app).
 */
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WEB = join(ROOT, "apps/web");
const DAEMON = join(ROOT, "apps/daemon");
const DESK = join(ROOT, "apps/desktop");
const BUILD = join(DESK, "build");
const run = (cmd, args, cwd, env = {}) =>
  execFileSync(cmd, args, { cwd, stdio: "inherit", env: { ...process.env, ...env } });

// Tìm binary trong .pnpm (không phụ thuộc .bin của package con)
import { globSync } from "node:fs";
function findBin(name) {
  const hits = globSync(`node_modules/.pnpm/**/node_modules/.bin/${name}`, { cwd: ROOT });
  if (!hits.length) throw new Error(`Không thấy binary: ${name}`);
  return join(ROOT, hits[0]);
}

console.log("\n[1/4] Next static export…");
run(findBin("next"), ["build"], WEB, { NEXT_PUBLIC_DAEMON_URL: "http://127.0.0.1:8788" });

console.log("\n[2/4] Bundle daemon (esbuild)…");
rmSync(BUILD, { recursive: true, force: true });
mkdirSync(BUILD, { recursive: true });
run(findBin("esbuild"), [
  join(DAEMON, "src/server.ts"),
  "--bundle", "--platform=node", "--format=cjs", "--target=node18",
  `--outfile=${join(BUILD, "daemon.cjs")}`,
], ROOT);

console.log("\n[3/4] Copy wasm + web…");
cpSync(join(DAEMON, "node_modules/sql.js/dist/sql-wasm.wasm"), join(BUILD, "sql-wasm.wasm"));
cpSync(join(WEB, "out"), join(BUILD, "web"), { recursive: true });

console.log("\n[4/4] electron-builder…");
run(findBin("electron-builder"), [], DESK);

console.log("\n✓ Xong. Xem apps/desktop/dist/ (có .dmg và MEP Studio.app)\n");

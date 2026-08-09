/** Bản đóng gói có phục vụ đúng route không?
 *
 * Đây là guardrail cho hai lỗi im lặng mà `next dev` không bao giờ lộ ra:
 *
 *  1. Thiếu `trailingSlash: true` → Next sinh out/changes.html, express.static
 *     (không bật option `extensions`) không tìm ra, request rơi vào catch-all và
 *     trả HTTP 200 kèm nội dung route "/". Không lỗi, không cảnh báo.
 *
 *  2. Catch-all nuốt cả asset build và payload điều hướng client (*.txt). Router
 *     Next nhận HTML thay vì payload → điều hướng client hỏng, trong khi mọi
 *     lệnh curl route HTML vẫn xanh.
 *
 * Test khởi động daemon THẬT trên một cổng riêng, với ACAD_DATA_DIR và
 * ACAD_BRIDGE_DIR trỏ vào thư mục tạm nên không chạm dữ liệu thật của máy.
 *
 * Yêu cầu: đã chạy `pnpm build` (script test:routes trong package.json lo việc này).
 */
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const daemonDir = resolve(webDir, "../daemon");
const outDir = join(webDir, "out");
const PORT = Number(process.env.ACAD_ROUTE_TEST_PORT || 8799);
const base = `http://127.0.0.1:${PORT}`;

/** Mốc kỳ vọng ở route "/". Đổi sang "home" trong CÙNG commit với việc dời
 * app/page.tsx sang app/legacy/page.tsx (giai đoạn 8). Nếu ai đó tạo
 * app/(shell)/page.tsx sớm, Next âm thầm bỏ nó và assert này là thứ duy nhất
 * phát hiện ra — Next không in một dòng cảnh báo nào. */
const EXPECTED_ROOT_SCREEN = "legacy";

// Kiểm tra cấu trúc TRƯỚC khi build/serve: hai file cùng resolve về "/" thì
// Next 16 build xanh, không in cảnh báo, và âm thầm bỏ file trong route group.
// Đã kiểm chứng trực tiếp trên Next 16.2.10. Chỉ assert này bắt được lúc dev
// vừa tạo file, trước khi họ mất nửa ngày tưởng route group hỏng.
const rootPages = [
  join(webDir, "app/page.tsx"),
  join(webDir, "app/(shell)/page.tsx"),
].filter(existsSync);
assert.ok(
  rootPages.length <= 1,
  'có nhiều hơn một page.tsx cùng resolve về "/":\n  ' +
    rootPages.join("\n  ") +
    '\nNext sẽ âm thầm bỏ một cái. Dời app/page.tsx sang app/legacy/page.tsx' +
    " trong cùng commit với việc tạo app/(shell)/page.tsx.",
);

assert.ok(existsSync(outDir), "chưa có out/ — chạy `pnpm build` trước");
assert.ok(
  existsSync(join(outDir, "changes", "index.html")),
  "out/changes/index.html không tồn tại — `trailingSlash: true` đã bị gỡ khỏi next.config.mjs",
);

const dataDir = mkdtempSync(join(tmpdir(), "acad-route-data-"));
const bridgeDir = mkdtempSync(join(tmpdir(), "acad-route-bridge-"));

const daemon = spawn(
  join(daemonDir, "node_modules/.bin/tsx"),
  ["src/server.ts"],
  {
    cwd: daemonDir,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ACAD_WEB_DIR: outDir,
      ACAD_DAEMON_PORT: String(PORT),
      ACAD_DATA_DIR: dataDir,
      ACAD_BRIDGE_DIR: bridgeDir,
      ACAD_SQLJS_WASM: join(daemonDir, "node_modules/sql.js/dist/sql-wasm.wasm"),
    },
  },
);

let daemonLog = "";
daemon.stdout.on("data", (b) => { daemonLog += b; });
daemon.stderr.on("data", (b) => { daemonLog += b; });

function shutdown() {
  if (!daemon.killed) daemon.kill("SIGTERM");
  rmSync(dataDir, { recursive: true, force: true });
  rmSync(bridgeDir, { recursive: true, force: true });
}
process.on("exit", shutdown);

async function waitForDaemon(timeoutMs = 40_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (daemon.exitCode !== null) {
      throw new Error(`daemon thoát sớm (mã ${daemon.exitCode}):\n${daemonLog}`);
    }
    try {
      const res = await fetch(`${base}/`, { redirect: "manual" });
      if (res.status > 0) return;
    } catch {
      // chưa listen — thử lại
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`daemon không lên trong ${timeoutMs}ms:\n${daemonLog}`);
}

async function main() {
  await waitForDaemon();

  // 1. Route con phục vụ đúng nội dung của chính nó, không phải của "/".
  const changes = await fetch(`${base}/changes/`);
  assert.equal(changes.status, 200, "GET /changes/ phải 200");
  const changesHtml = await changes.text();
  assert.ok(
    changesHtml.includes('data-screen="changes"'),
    "GET /changes/ trả nội dung route khác — catch-all đang nuốt route con",
  );

  // 2. Dạng không có dấu / cuối phải được serve-static redirect, không rơi catch-all.
  const bare = await fetch(`${base}/changes`, { redirect: "manual" });
  assert.equal(bare.status, 301, "GET /changes phải 301 sang /changes/");
  assert.ok(
    (bare.headers.get("location") || "").endsWith("/changes/"),
    "redirect của /changes phải trỏ tới /changes/",
  );
  const followed = await fetch(`${base}/changes`);
  assert.ok(
    (await followed.text()).includes('data-screen="changes"'),
    "đi theo redirect của /changes phải ra đúng nội dung route",
  );

  // 3. Route "/" vẫn do đúng màn hình của giai đoạn hiện tại phục vụ.
  const root = await fetch(`${base}/`);
  assert.equal(root.status, 200, "GET / phải 200");
  assert.ok(
    (await root.text()).includes(`data-screen="${EXPECTED_ROOT_SCREEN}"`),
    `GET / không mang data-screen="${EXPECTED_ROOT_SCREEN}" — có thể một page.tsx thứ hai đang tranh route "/"`,
  );

  // 4. Asset build không tìm thấy phải 404, không phải index.html kèm 200.
  const missingAsset = await fetch(`${base}/_next/static/khong-ton-tai.js`);
  assert.equal(missingAsset.status, 404, "asset /_next/* thiếu phải trả 404");

  // 5. Payload điều hướng client phải giữ nguyên kiểu text/plain.
  const payload = await fetch(`${base}/changes/index.txt`);
  assert.equal(payload.status, 200, "payload .txt của route phải tồn tại");
  assert.ok(
    (payload.headers.get("content-type") || "").startsWith("text/plain"),
    "payload .txt bị catch-all trả về dưới dạng text/html",
  );

  // 6. Payload không tồn tại cũng phải 404, không phải HTML.
  const missingPayload = await fetch(`${base}/changes/__next.khong-ton-tai.txt`);
  assert.equal(missingPayload.status, 404, "payload .txt thiếu phải trả 404");

  // 7. Route HTML lạ vẫn rơi về app shell — đây là hành vi CỐ Ý của SPA fallback.
  const unknown = await fetch(`${base}/khong-ton-tai`);
  assert.ok(
    (unknown.headers.get("content-type") || "").includes("text/html"),
    "route HTML lạ phải rơi về app shell dạng text/html",
  );

  console.log("✓ route serving: trailingSlash, redirect 301, mốc route /, 404 cho _next và .txt");
}

main()
  .then(() => { shutdown(); process.exit(0); })
  .catch((err) => { shutdown(); console.error(err); process.exit(1); });

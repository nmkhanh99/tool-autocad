/** Trích mọi mã lỗi có kiểu mà daemon phát ra, và bắt UI phải có thái độ với
 * từng mã.
 *
 * Vì sao không chép tay: bộ mẫu thiết kế liệt kê 11 mã. Chỉ riêng
 * `cadSelection.ts` đã ném hơn 30 mã qua `SelectionApiError`, và bốn mã mà
 * `/changes` sẽ gặp nhiều nhất khi apply một thao tác cũ — `operation_expired`,
 * `operation_not_found`, `operation_not_pending`, `operation_revision_mismatch`
 * — không có trong danh sách của mẫu. Chép tay nghĩa là người dùng gặp một mã
 * lạ và nhận được câu "HTTP 409".
 *
 * Mỗi mã phải rơi vào MỘT trong ba trạng thái, nếu không script fail:
 *   1. có entry trong `features/staged-ops/guards.ts` — mã người dùng gặp được,
 *      phải có câu giải thích và lối thoát;
 *   2. nằm trong GENERIC_CODES — lỗi lập trình hoặc lỗi giao thức, người dùng
 *      không làm gì được, hiển thị thông điệp thô là đủ;
 *   3. chưa xử lý → fail, kèm danh sách mã mới.
 *
 * Chạy: node scripts/extract-guard-codes.mjs [--list]
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const daemonSrc = resolve(webDir, "../daemon/src");
const guardsFile = join(webDir, "features/staged-ops/guards.ts");

/** Mã người dùng không hành động được: lỗi lập trình, lỗi giao thức, hoặc lỗi
 * hạ tầng đã có thông điệp riêng. Hiển thị message thô của daemon là đủ. */
const GENERIC_CODES = new Set([
  "invalid_request",
  "invalid_scope",
  "invalid_target",
  "invalid_action",
  "native_response_invalid",
  "native_response_mismatch",
  "snapshot_incomplete",
  "snapshot_timeout",
  "apply_result_mismatch",
]);

function walk(dir, acc = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (full.endsWith(".ts")) acc.push(full);
  }
  return acc;
}

const codes = new Map(); // code -> Set<file>
for (const file of walk(daemonSrc)) {
  const text = readFileSync(file, "utf8");
  const rel = file.slice(daemonSrc.length + 1);
  const patterns = [
    /new SelectionApiError\(\s*"([a-z0-9_]+)"/g,
    /\bcode:\s*"([a-z0-9_]+)"/g,
    /readonly code\s*=\s*"([a-z0-9_]+)"/g,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      if (!codes.has(m[1])) codes.set(m[1], new Set());
      codes.get(m[1]).add(rel);
    }
  }
}

assert.ok(codes.size > 0, "không trích được mã nào — kiểm tra lại pattern");

if (process.argv.includes("--list")) {
  for (const [code, files] of [...codes].sort()) {
    console.log(`${code.padEnd(34)} ${[...files].join(", ")}`);
  }
  console.log(`\n${codes.size} mã.`);
  process.exit(0);
}

if (!existsSync(guardsFile)) {
  console.log(
    `✓ guard codes: ${codes.size} mã trong daemon; chưa có features/staged-ops/guards.ts (giai đoạn 0–1)`,
  );
  process.exit(0);
}

const guards = readFileSync(guardsFile, "utf8");
const handled = new Set(
  [...guards.matchAll(/^\s{2}([a-z0-9_]+):\s*\{/gm)].map((m) => m[1]),
);

/* Backend phát vài cặp mã đồng nghĩa. Client chuẩn hoá chúng ở biên nhận, nên
   chỉ mã đích mới cần entry — đọc bảng alias từ chính client thay vì khai lại
   ở đây, để hai nơi không bao giờ lệch nhau. */
const clientFile = join(webDir, "lib/daemon/client.ts");
const aliases = new Map();
if (existsSync(clientFile)) {
  const block = /const CODE_ALIASES[^{]*\{([\s\S]*?)\n\};/.exec(readFileSync(clientFile, "utf8"));
  assert.ok(block, "không đọc được CODE_ALIASES trong lib/daemon/client.ts");
  for (const m of block[1].matchAll(/([a-z0-9_]+):\s*"([a-z0-9_]+)"/g)) {
    aliases.set(m[1], m[2]);
  }
}
const canonical = (code) => aliases.get(code) || code;

const missing = [...codes.keys()]
  .map(canonical)
  .filter((code) => !handled.has(code) && !GENERIC_CODES.has(code))
  .sort();

assert.equal(
  missing.length,
  0,
  `daemon phát ${missing.length} mã lỗi mà UI chưa có thái độ:\n  ` +
    missing.map((c) => `${c}  (${[...codes.get(c)].join(", ")})`).join("\n  ") +
    "\n\nThêm entry vào features/staged-ops/guards.ts, hoặc thêm vào GENERIC_CODES" +
    " trong script này nếu người dùng thật sự không làm gì được với mã đó.",
);

/* Chiều ngược lại: một entry guard cho mã daemon không còn phát ra là câu chữ
   chết — người viết tưởng đã lo, thực ra không bao giờ hiện. */
const emitted = new Set([...codes.keys()].map(canonical));
const orphans = [...handled].filter((code) => !emitted.has(code)).sort();
assert.equal(
  orphans.length,
  0,
  `guards.ts còn entry cho mã daemon không phát ra nữa: ${orphans.join(", ")}`,
);

console.log(
  `✓ guard codes: ${codes.size} mã daemon · ${handled.size} có copy riêng · ${GENERIC_CODES.size} generic`,
);

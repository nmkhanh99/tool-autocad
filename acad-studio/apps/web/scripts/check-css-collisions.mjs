/** Hai hệ CSS sống song song trong lúc migrate: `globals.css` (legacy, sẽ chết)
 * và `design-system.css` (copy nguyên văn mau-thiet-ke/css/app.css, sẽ sống).
 *
 * Va chạm ở đây không tạo ra trang trắng — nó tạo ra MỘT PHẦN trang đổi màu
 * hoặc đổi layout, thứ dễ trượt qua review nhất. Ví dụ có thật: `--bg` là đen
 * ở legacy và trắng ở design system; `.modal` là backdrop ở legacy nhưng là hộp
 * dialog ở design system — đảo nghĩa hoàn toàn.
 *
 * QUAN TRỌNG — so trên SELECTOR, không trên token class rời.
 * Giao của tập class thô là 8 phần tử, nhưng 3 trong số đó
 * (`.count`, `.spacer`, `.check`) chỉ xuất hiện dưới dạng có tổ tiên riêng
 * (`.rail-link .count`, `.topbar .spacer`, `.standards-table td.check`) nên
 * không bao giờ chạm nhau. Báo chúng là dương tính giả, và một script hay báo
 * sai sẽ bị nới lỏng cho tới lúc vô dụng.
 * Chỉ coi là va chạm khi một class xuất hiện ở CẢ HAI file dưới dạng selector
 * đơn `.x` (cho phép kèm pseudo/attribute, vì `.chip:hover` vẫn nhắm vào
 * mọi `.chip`).
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "../app");
const legacyPath = join(appDir, "globals.css");
const designPath = join(appDir, "design-system.css");

/** Trần hex literal của globals.css. Chỉ được giảm, không được tăng: mỗi màu
 * viết cứng mới là một chỗ sẽ không đổi theo theme và sẽ phải sửa tay ở GĐ10. */
const LEGACY_HEX_CEILING = 1119;

/** Tách chuỗi selector, bỏ qua nội dung trong ngoặc kép và ngoặc đơn. */
function splitTopLevel(text, sep) {
  const parts = [];
  let buf = "";
  let depth = 0;
  let quote = "";
  for (const ch of text) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === sep && depth === 0) { parts.push(buf); buf = ""; continue; }
    buf += ch;
  }
  parts.push(buf);
  return parts;
}

/** Mọi prelude selector trong file, kể cả bên trong @media/@supports.
 * Bỏ qua @keyframes (prelude bên trong là phần trăm, không phải selector). */
function selectorsOf(css) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  const stack = [];
  let buf = "";
  let quote = "";
  for (const ch of src) {
    if (quote) {
      buf += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; buf += ch; continue; }
    if (ch === "{") {
      const prelude = buf.trim();
      buf = "";
      if (prelude.startsWith("@")) {
        const name = prelude.slice(1).split(/[\s({]/)[0].toLowerCase();
        const descends = ["media", "supports", "container", "layer", "scope"].includes(name);
        stack.push(descends ? "at-descend" : "at-skip");
      } else {
        if (prelude && !stack.includes("at-skip")) out.push(prelude);
        stack.push("rule");
      }
      continue;
    }
    if (ch === "}") { stack.pop(); buf = ""; continue; }
    if (ch === ";") { buf = ""; continue; }
    buf += ch;
  }
  return out;
}

/** Class nào được nhắm tới bằng một selector đơn, không có tổ tiên và không
 * ghép với class/element khác. */
function unscopedClasses(css) {
  const found = new Map();
  for (const prelude of selectorsOf(css)) {
    for (const raw of splitTopLevel(prelude, ",")) {
      /* Thay `[...]` bằng một token KHÔNG có khoảng trắng trước khi tách tổ
         tiên. Bóc hẳn nó đi (như bản trước) sẽ biến
         `[data-screen="x"] .info` thành ` .info`, và một selector CÓ tổ tiên bị
         đọc thành không có — đúng lỗi làm lọt `.info` qua guardrail này. */
      const masked = raw
        .trim()
        .replace(/\[[^\]]*\]/g, "\u0000")
        .replace(/::?[A-Za-z-]+(\([^)]*\))?/g, "");
      const parts = masked.split(/\s*[>+~]\s*|\s+/).filter(Boolean);
      /* Có tổ tiên hoặc anh em → không phải quy tắc không phạm vi. */
      if (parts.length !== 1) continue;
      const bare = parts[0].replace(/\u0000/g, "").trim();
      const match = /^\.([A-Za-z0-9_-]+)$/.exec(bare);
      if (match && !found.has(match[1])) found.set(match[1], raw.trim());
    }
  }
  return found;
}

/** MỌI tên class được nhắc tới trong CSS, kể cả trong selector ghép.
 *
 * Cần nó vì phép so hai chiều là ASYMMETRIC: một quy tắc design-system viết
 * `.info { … }` sẽ trúng MỌI phần tử mang class đó, kể cả phần tử mà legacy chỉ
 * nhắm bằng selector ghép như `.lisp-library-notice.info`. So "class đơn với
 * class đơn" bỏ lọt đúng trường hợp đó — và đã bỏ lọt thật một lần. */
function allClasses(css) {
  const found = new Set();
  for (const prelude of selectorsOf(css)) {
    for (const m of prelude.matchAll(/\.([A-Za-z0-9_-]+)/g)) found.add(m[1]);
  }
  return found;
}

function customProps(css) {
  const found = new Set();
  for (const m of css.matchAll(/(^|[;{\s])(--[A-Za-z0-9_-]+)\s*:/g)) found.add(m[2]);
  return found;
}

const legacy = readFileSync(legacyPath, "utf8");
const legacyHex = new Set(
  [...legacy.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0].toLowerCase()),
);
assert.ok(
  legacyHex.size <= LEGACY_HEX_CEILING,
  `globals.css có ${legacyHex.size} hex literal khác nhau, vượt trần ${LEGACY_HEX_CEILING}.` +
    " Màu mới phải đi qua token, không viết cứng.",
);

if (!existsSync(designPath)) {
  console.log(
    `✓ css collisions: chưa có design-system.css (giai đoạn 0) · globals.css ${legacyHex.size}/${LEGACY_HEX_CEILING} hex`,
  );
  process.exit(0);
}

const design = readFileSync(designPath, "utf8");
const legacyClasses = unscopedClasses(legacy);
const designClasses = unscopedClasses(design);

const clashes = [...legacyClasses.keys()]
  .filter((name) => designClasses.has(name))
  .map((name) => `  .${name}\n      legacy: ${legacyClasses.get(name)}\n      design: ${designClasses.get(name)}`);
assert.equal(
  clashes.length,
  0,
  "class va chạm giữa hai hệ CSS — đổi tên phía LEGACY (sẽ chết), không đổi phía design system:\n" +
    clashes.join("\n"),
);

/* Chiều thứ hai: quy tắc design-system KHÔNG có phạm vi sẽ trúng cả phần tử
   legacy mang class đó, dù legacy nhắm nó bằng selector ghép. */
const legacyAll = allClasses(legacy);
const bleeding = [...designClasses.keys()]
  .filter((name) => legacyAll.has(name) && !legacyClasses.has(name))
  .map((name) => `  .${name}  (design: ${designClasses.get(name)})`);
assert.equal(
  bleeding.length,
  0,
  "quy tắc design-system không có phạm vi sẽ trúng phần tử LEGACY mang cùng class:\n" +
    bleeding.join("\n") +
    "\n  Bọc quy tắc trong [data-screen=\"…\"], hoặc đổi tên phía legacy.",
);

const propClashes = [...customProps(legacy)].filter((p) => customProps(design).has(p));
assert.equal(
  propClashes.length,
  0,
  `custom property va chạm: ${propClashes.join(", ")} — đổi tên phía legacy thành --legacy-*`,
);

/* ------------------------------------------------------------------ *
 * Ngoặc phải cân
 * ------------------------------------------------------------------ *
 *
 * Thiếu MỘT dấu `}` không làm hỏng build và không làm trắng trang: trình duyệt
 * chỉ nuốt luôn khối kế tiếp vào khối đang mở. Lỗi có thật, vừa xảy ra: một
 * script dọn CSS ăn mất dấu đóng của `@keyframes legacy-spin`, và cả khối
 * `.standards-confirm-*` — vẫn đang dùng — bị hút vào trong keyframes. Mọi phép
 * kiểm khác của file này quét VĂN BẢN nên không thấy gì cả.
 *
 * Đếm ngoặc là phép kiểm thô, nhưng nó bắt đúng loại hỏng mà một bản vá tay hay
 * một script sinh ra — và nó không bao giờ báo sai. */
for (const [label, source] of [["globals.css", legacy], ["design-system.css", design]]) {
  /* Bỏ chú thích và chuỗi trước khi đếm: một dấu ngoặc trong `content: "}"`
     hoặc trong lời giải thích không phải là ngoặc của cú pháp. */
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
  const open = (stripped.match(/\{/g) ?? []).length;
  const close = (stripped.match(/\}/g) ?? []).length;
  assert.equal(
    open,
    close,
    `${label} lệch ngoặc: ${open} dấu mở, ${close} dấu đóng. Thiếu một dấu đóng `
      + "thì khối kế tiếp bị hút vào khối đang mở — trang vẫn dựng, chỉ là sai.",
  );
}

console.log(
  `✓ css collisions: 0 class + 0 rò rỉ sang legacy + 0 token va chạm ` +
    `(legacy ${legacyClasses.size} class đơn / ${legacyAll.size} tổng, design ${designClasses.size})`,
);

/* ------------------------------------------------------------------ *
 * Token CSS dùng mà KHÔNG được định nghĩa
 * ------------------------------------------------------------------ *
 *
 * `color: var(--danger)` với `--danger` không tồn tại là một khai báo KHÔNG HỢP
 * LỆ — trình duyệt bỏ nó lặng lẽ, không cảnh báo, không lỗi. Hậu quả trông y hệt
 * "quên viết CSS", nên nó sống sót qua review: dòng sai không có viền đỏ, ô màu
 * đang chọn không có viền đậm, và người đọc code thấy một khai báo trông đúng.
 *
 * Đã mắc HAI lần trong cùng một mục: `--danger` (không có, vì hệ thiết kế cố ý
 * đơn sắc) rồi `--ink`/`--line` (tên đúng là `--fg`/`--border`). Cả hai lần đều
 * chỉ lộ ra khi có người soi lại bằng mắt. Vì vậy chặn bằng script.
 */
const sourceFiles = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "out" || entry.name === ".next") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(tsx?|css)$/.test(entry.name)) sourceFiles.push(full);
  }
};
walk(resolve(appDir, ".."));

/* Gom định nghĩa từ MỌI nguồn, không chỉ hai file CSS gốc. Token hợp lệ được đặt
   ở ba chỗ:
     · bất kỳ file `.css` nào, gồm cả `*.module.css` tự khai token riêng;
     · inline trong TSX — `style={{ "--review-zoom": ... }}` là cách hợp lệ để
       truyền một giá trị chạy được vào CSS;
     · fallback `var(--x, ...)` thì không cần định nghĩa (xử lý ở dưới).
   Bỏ sót một nguồn là script báo sai, và một script hay báo sai sẽ bị nới lỏng
   cho tới lúc vô dụng — đúng điều file này đã tự cảnh báo ở phần trên. */
/* Bỏ chú thích trước khi tìm — ở CẢ HAI lượt quét.
   Bỏ nó chỉ ở lượt tìm CHỖ DÙNG là guardrail tự chọc thủng chính mình: một
   `--foo:` nằm trong chú thích (ví dụ minh hoạ, hay đoạn giải thích một lỗi cũ)
   sẽ được tính là ĐỊNH NGHĨA, và `var(--foo)` thật ở chỗ khác đi qua trong im
   lặng. Chính `design-system.css` có một chú thích như vậy.
   `//` chỉ bỏ khi nó chiếm trọn dòng: `//` giữa dòng có thể là `https://`, và
   bỏ nhầm ở đó lại giấu mất một định nghĩa thật. */
const withoutComments = (text) =>
  text.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^[ \t]*\/\/.*$/gm, " ");

const definedTokens = new Set();
for (const file of sourceFiles) {
  const text = withoutComments(readFileSync(file, "utf8"));
  for (const match of text.matchAll(/(--[a-z0-9-]+)\s*:/gi)) definedTokens.add(match[1]);
  for (const match of text.matchAll(/["'](--[a-z0-9-]+)["']\s*:/gi)) definedTokens.add(match[1]);
}

const missing = new Map();
for (const file of sourceFiles) {
  const text = withoutComments(readFileSync(file, "utf8"));
  for (const match of text.matchAll(/var\(\s*(--[a-z0-9-]+)/gi)) {
    const token = match[1];
    /* `var(--x, fallback)` vẫn vẽ ra thứ gì đó nên không phải lỗi câm — bỏ qua.
       Chỉ bắt lời gọi TRẦN, thứ biến cả khai báo thành vô hiệu. */
    const after = text.slice(match.index + match[0].length);
    if (/^\s*,/.test(after)) continue;
    if (definedTokens.has(token)) continue;
    const rel = file.slice(resolve(appDir, "..").length + 1);
    if (!missing.has(token)) missing.set(token, new Set());
    missing.get(token).add(rel);
  }
}

assert.equal(
  missing.size,
  0,
  `token CSS dùng mà không được định nghĩa (trình duyệt bỏ lặng lẽ):\n` +
    [...missing.entries()]
      .map(([token, files]) => `  ${token}  (${[...files].join(", ")})`)
      .join("\n"),
);
console.log(`\u2713 css tokens: ${definedTokens.size} token khai báo · 0 lời gọi treo`);

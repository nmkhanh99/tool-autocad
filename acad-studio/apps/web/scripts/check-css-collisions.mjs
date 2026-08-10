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
import { existsSync, readFileSync } from "node:fs";
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

console.log(
  `✓ css collisions: 0 class + 0 rò rỉ sang legacy + 0 token va chạm ` +
    `(legacy ${legacyClasses.size} class đơn / ${legacyAll.size} tổng, design ${designClasses.size})`,
);

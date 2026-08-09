/** Ba ranh giới thư mục của kiến trúc mới, khoá bằng script thay vì bằng quy ước.
 *
 * `@acad/web` không có ESLint và không cần thêm một bộ tooling chỉ để kiểm 3
 * quy tắc, nên đây là ~100 dòng node đọc thẳng câu lệnh import.
 *
 * Phạm vi CỐ Ý hẹp: chỉ áp cho `components/` và `features/` — code mới. Thư mục
 * `app/` còn giữ màn hình legacy với 32 đường dẫn API rải rác; ép nó tuân thủ
 * ngay bây giờ chỉ tạo ra một danh sách ngoại lệ dài, và danh sách ngoại lệ thì
 * không ai đọc. Legacy được dọn khi từng màn hình được migrate.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ENDPOINT_HOME = join("lib", "daemon", "endpoints.ts");

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(tsx?|mts)$/.test(full)) acc.push(full);
  }
  return acc;
}

/** Bỏ comment. Một doc comment nhắc tên endpoint mà nó mô tả là chuyện bình
 * thường và hữu ích — chỉ lời gọi thật mới là phụ thuộc. */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

/** Mọi module specifier trong file: import tĩnh, re-export, và import động. */
function importsOf(source) {
  const specs = [];
  const patterns = [
    /(?:^|\n)\s*import\s[^;]*?from\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*import\s*["']([^"']+)["']/g,
    /(?:^|\n)\s*export\s[^;]*?from\s*["']([^"']+)["']/g,
    /\bimport\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const re of patterns) for (const m of source.matchAll(re)) specs.push(m[1]);
  return specs;
}

/** Thư mục feature của một đường dẫn, ví dụ features/review/x/y.ts → "review". */
function featureOf(relPath) {
  const parts = relPath.split(sep);
  return parts[0] === "features" && parts.length > 2 ? parts[1] : null;
}

/** Giải một specifier tương đối về đường dẫn relative so với webDir. */
function resolveRelative(fromRel, spec) {
  if (!spec.startsWith(".")) return null;
  return relative(webDir, resolve(webDir, dirname(fromRel), spec));
}

const files = [...walk(join(webDir, "components")), ...walk(join(webDir, "features"))]
  .map((f) => relative(webDir, f));

const violations = [];

for (const rel of files) {
  const source = stripComments(readFileSync(join(webDir, rel), "utf8"));
  const parts = rel.split(sep);
  const specs = importsOf(source);

  // 1. Primitive UI phải dùng được ở bất kỳ đâu → không biết gì về feature hay daemon.
  if (parts[0] === "components" && parts[1] === "ui") {
    for (const spec of specs) {
      const target = resolveRelative(rel, spec) ?? spec;
      if (/(^|[/\\])features([/\\]|$)/.test(target) || /lib[/\\]daemon/.test(target)) {
        violations.push(
          `${rel}: primitive UI import "${spec}" — components/ui không được biết tới features/ hay lib/daemon/.` +
            " Nhận dữ liệu qua props, hoặc đẩy phần phụ thuộc lên component gọi nó.",
        );
      }
    }
  }

  // 2. Feature không import chéo feature. Cần dùng chung → đẩy lên features/staged-ops hoặc lib/.
  const owner = featureOf(rel);
  if (owner) {
    for (const spec of specs) {
      const target = resolveRelative(rel, spec) ?? spec;
      const match = /(?:^|[/\\])features[/\\]([^/\\]+)/.exec(target);
      if (match && match[1] !== owner) {
        violations.push(
          `${rel}: import chéo feature "${spec}" (${owner} → ${match[1]}).` +
            " Đẩy phần dùng chung lên features/staged-ops hoặc lib/.",
        );
      }
    }
  }

  // 3. Đường dẫn API chỉ được khai ở một chỗ, để đổi endpoint không phải grep cả repo.
  if (rel !== ENDPOINT_HOME) {
    for (const m of source.matchAll(/["'`](\/api\/[^"'`]*)["'`]/g)) {
      violations.push(
        `${rel}: chuỗi endpoint "${m[1]}" — mọi đường dẫn API phải khai trong ${ENDPOINT_HOME}.`,
      );
    }
  }
}

assert.equal(
  violations.length,
  0,
  `vi phạm ranh giới thư mục:\n  ${violations.join("\n  ")}`,
);

console.log(
  files.length === 0
    ? "✓ import boundaries: chưa có components/ hay features/ (giai đoạn 0) — 3 quy tắc đã sẵn sàng"
    : `✓ import boundaries: ${files.length} file, 0 vi phạm`,
);

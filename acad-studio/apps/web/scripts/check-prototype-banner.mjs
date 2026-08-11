/** Màn hình không có backend PHẢI mang dải "bản dựng thử".
 *
 * Quyết định D2 của `ROADMAP.md`. Vì sao cần một script canh:
 *
 * Dải cảnh báo là thứ dễ bị gỡ nhất trong cả repo. Nó xấu, nó chiếm chỗ, và ai
 * cũng "biết rồi" — nên nó sẽ bị gỡ trong một lượt dọn giao diện nào đó, và
 * không ai nhận ra cho tới khi một con số bịa đi vào hồ sơ thầu. Ràng buộc phải
 * nằm ở chỗ máy kiểm được, không nằm ở trí nhớ.
 *
 * ## Vì sao là DANH SÁCH, không phải đếm lời gọi API
 *
 * Bản đầu của script này đếm `fetch(` và coi "dưới 2 lời gọi" là chưa có
 * backend. Nó báo nhầm ngay hai chỗ:
 *
 *  - `CadWebViewerPanel` nhận snapshot qua **prop** — không gọi API là kiến trúc
 *    đúng của một viewer, không phải dấu hiệu prototype.
 *  - `DrawingInfoPanel` gọi **một** lời gọi tới `/api/acad/drawing-info`, và
 *    endpoint đó trả về toàn bộ hồ sơ. Một lời gọi là đủ.
 *
 * Một script hay báo sai sẽ bị nới lỏng cho tới lúc vô dụng. Nên ràng buộc bám
 * vào thứ đã được QUYẾT ĐỊNH (danh sách D2) chứ không vào một chỉ số suy đoán.
 * Thêm một màn hình dựng thử mới là một quyết định — nó thuộc về `ROADMAP.md`
 * trước, rồi mới tới đây.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), "../app");

/** Màn hình đã được xác định là dựng thử — `ROADMAP.md`, quyết định D2.
 *
 * Gỡ một tên khỏi đây CHỈ khi màn hình đó có endpoint thật, và phải sửa
 * `ROADMAP.md` trong cùng lượt. */
const PROTOTYPE_PANELS = new Map([
  ["PreconstructionPanel.tsx", "0 lời gọi API — mọi khối lượng, đơn giá, tiến độ là hằng số"],
  ["DocumentReviewPanel.tsx", "1 lời gọi (chỉ đọc INSUNITS) — mọi số đo và danh sách là hằng số"],
]);

/** Dải cảnh báo có THẬT SỰ được render không.
 *
 * Tìm chuỗi thô là chưa đủ: `{/* <PrototypeBanner /> *​/}` vẫn khớp, mà trên màn
 * hình không có gì cả — và "bọc lại trong comment" đúng là cách người ta tạm bỏ
 * một thứ vướng mắt trong một lượt dọn giao diện. Bóc chú thích trước rồi mới
 * tìm. */
function rendersBanner(source) {
  const stripped = source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[\s;{(])\/\/[^\n]*/g, "$1");
  return /<PrototypeBanner[\s/>]/.test(stripped);
}

const violations = [];

for (const [name, why] of PROTOTYPE_PANELS) {
  const path = join(appDir, name);
  if (!existsSync(path)) {
    violations.push(`  ${name}: có trong danh sách D2 nhưng không còn tệp. Cập nhật ROADMAP.md và script này.`);
    continue;
  }
  if (!rendersBanner(readFileSync(path, "utf8"))) {
    violations.push(`  ${name}: ${why} — nhưng KHÔNG có <PrototypeBanner>.`);
  }
}

/* Chiều ngược lại: có dải cảnh báo mà không nằm trong danh sách nghĩa là danh
   sách và mã đã lệch nhau. Lệch chiều nào cũng làm cả hai mất giá trị. */
for (const name of readdirSync(appDir)) {
  if (!name.endsWith(".tsx") || PROTOTYPE_PANELS.has(name)) continue;
  if (rendersBanner(readFileSync(join(appDir, name), "utf8"))) {
    violations.push(`  ${name}: có <PrototypeBanner> nhưng không nằm trong danh sách D2. Ghi vào ROADMAP.md.`);
  }
}

/* Hai panel dựng thử là lưới hàng CỐ ĐỊNH, và dải cảnh báo là một hàng nữa.
   Một override responsive quên hàng đó thì banner chiếm mất hàng header, thân
   panel bị nén vào hàng footer, và cả màn hình vỡ — chỉ ở một khổ màn hình, nên
   không ai thấy cho tới khi người dùng thu hẹp cửa sổ. Đã sót thật một lần: ba
   override quên trong khi bản gốc đã sửa. */
const cssPath = join(appDir, "globals.css");
if (existsSync(cssPath)) {
  const css = readFileSync(cssPath, "utf8");
  for (const m of css.matchAll(
    /\.(review-panel|precon-panel)\s*\{[^}]*?grid-template-rows:\s*([^;]+);/g,
  )) {
    if (!/^\s*auto\b/.test(m[2])) {
      violations.push(
        `  globals.css: .${m[1]} có grid-template-rows "${m[2].trim()}" không bắt đầu bằng` +
          " `auto` — thiếu hàng cho dải bản dựng thử.",
      );
    }
  }
}

assert.equal(
  violations.length,
  0,
  "dải cảnh báo màn hình dựng thử lệch với quyết định D2:\n" + violations.join("\n"),
);

console.log(
  `✓ prototype banner: ${PROTOTYPE_PANELS.size}/${PROTOTYPE_PANELS.size} màn hình dựng thử đã gắn cảnh báo`,
);

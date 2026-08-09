# CHANGELOG

## 2026-08-09 — Giai đoạn 1: dọn va chạm CSS

Giao diện **không đổi**. Đây là điều kiện nghiệm thu chính của giai đoạn, đã
kiểm bằng trình duyệt thật chứ không chỉ bằng script.

### Added

- `apps/web/app/design-system.css` — copy của `mau-thiet-ke/css/app.css` @
  `82f5232`, với đúng 2 sai lệch được khai ngay đầu file: khối reset gate bằng
  `body[data-ds]`, và mục 8 mở rộng khoá lệnh ghi cho `missing` / `no-plugin` /
  `mute` (mẫu chỉ khoá `busy` và `off`).
- Route `(shell)/changes` nay đặt `data-ds` và dùng class của design system —
  nó là chỗ duy nhất chứng minh `design-system.css` thật sự áp được trước khi
  `AppShell` tồn tại ở giai đoạn 3.

### Changed

- Đổi tên mọi thứ va chạm ở **phía legacy** (phía sẽ chết), không đụng phía
  design system: `--bg` → `--legacy-bg`, `--accent` → `--legacy-accent`,
  `.app` `.main` `.empty` `.modal` `.field` → tiền tố `legacy-`.
- Gate `body` và 5 rule cấp element của legacy (`select`, `textarea`,
  `textarea:focus`, `code`, `footer`) bằng `body[data-legacy="1"]`. Mọi gate
  dùng `:where()` nên **specificity không đổi** — mục tiêu là cascade giữ
  nguyên, không chỉ giao diện giữ nguyên.
- `app/page.tsx` đặt `data-legacy` trong `useEffect` và gỡ khi unmount.

### Fixed

- Gộp 3 `@keyframes` xoay giống hệt nhau (`drawing-spin`, `standards-spin`,
  `lisp-library-spin`) thành `legacy-spin`; giữ nguyên tên class vì chúng được
  dùng trong TSX. Còn 5 keyframes.
- Xoá dead code đã xác minh 0 usage: `.chips`, `.chip`, `.chip:hover`, `.log`.

### Technical

- **Đếm usage trước/sau khớp tuyệt đối** — đây là tiêu chí thay cho "khác một
  pixel" vốn không đo được: `.app` 1→1, `.modal` 1→1, `.field` 4→4, `.empty`
  2→2, `.main` 1→1 (CSS); 1/2/2/1/1 (JSX); `var(--bg)` 1→1, `var(--accent)`
  40→40.
- **Kiểm bằng Chrome thật, không chỉ bằng script.** Route legacy:
  `data-legacy="1"`, body `rgb(15,18,22)`, chữ `rgb(230,233,238)`, 15px, grid
  `240px 1fr auto`. Route shell: `data-ds="1"`, body `rgb(245,245,245)`, 13px,
  `SF Pro HK`, `--muted` `rgb(140,140,140)`, không rò `data-legacy`. Các rule
  vừa gate cũng khớp bản gốc: `select`/`textarea` nền `#1e242c`, `footer` nền
  `#171b21` viền `#2a313b`.
- Ghi vào `DEVELOPMENT.md` một bẫy dev đã mất thời gian truy: `next dev` chặn
  `/_next/*` từ `127.0.0.1`, làm React **không hydrate** — trang trông như đã
  chạy nhưng chết hoàn toàn, console không báo gì. Dùng `localhost:3000`.

---

## 2026-08-09 — Giai đoạn 0: gỡ blocker & dựng guardrail

### Added

- `KE-HOACH-CHUYEN-DOI-UI.html` — kế hoạch chuyển giao diện sang bộ mẫu
  `mau-thiet-ke/`: 11 giai đoạn, bảng 14 màn hình, danh sách bỏ, backend cần
  thêm, 11 rủi ro và 6 quyết định cần chốt.
- `DEVELOPMENT.md`, `ROADMAP.md`, `USER_GUIDE.md`, `CHANGELOG.md`.
- `apps/web/scripts/test-route-serving.mjs` — khởi động daemon thật trên cổng
  riêng (dữ liệu ghi vào thư mục tạm) và khẳng định bản đóng gói phục vụ đúng
  route: `out/changes/index.html` tồn tại, `/changes` trả 301 sang `/changes/`,
  route `/` mang đúng mốc `data-screen` của giai đoạn hiện tại, `/_next/*` thiếu
  trả 404, payload `.txt` giữ `text/plain`.
- `apps/web/scripts/check-css-collisions.mjs` — dò va chạm giữa hai hệ CSS trên
  **selector đã chuẩn hoá**, cộng trần hex literal cho `globals.css`.
- `apps/web/scripts/check-import-boundaries.mjs` — khoá 3 ranh giới thư mục của
  kiến trúc mới bằng ~100 dòng node, không dựng thêm tooling lint.
- `apps/web/app/(shell)/changes/page.tsx` — route giàn giáo để test route
  serving có đối tượng thật để kiểm.
- Script `check:css`, `check:boundaries`, `test:routes` và `verify` trong
  `apps/web/package.json`.

### Fixed

- **Bản đóng gói phục vụ sai nội dung cho mọi route con.** `next.config.mjs`
  thiếu `trailingSlash: true`, nên Next sinh `out/changes.html` mà
  `express.static` (không bật option `extensions`) không tìm ra; request rơi vào
  catch-all và trả HTTP **200** kèm nội dung route `/`. `next dev` chạy đúng nên
  lỗi chỉ lộ khi đóng gói.
- **Catch-all của daemon nuốt cả asset build và payload điều hướng client.**
  `apps/daemon/src/server.ts` nay trả 404 cho đường dẫn bắt đầu `/_next/` hoặc
  kết thúc `.txt`. Trước đó một payload RSC thiếu được trả về dưới dạng
  `index.html` kèm 200 `text/html`, làm router Next nhận HTML thay vì payload —
  điều hướng client hỏng im lặng trong khi curl route HTML vẫn xanh.

### Changed

- `apps/web/scripts/test-contract.mjs` viết lại theo glob. Bản cũ đọc 6 file
  theo path cứng, nên mọi assert phủ định (`!includes`, `doesNotMatch`) **tự
  động xanh** khi code chuyển sang file khác — đúng những bất biến an toàn nhất
  sẽ âm thầm biến mất giữa một đợt di chuyển file. Nay assert phủ định chạy trên
  toàn bộ source nối lại, assert khẳng định tra file bằng đuôi đường dẫn. Giữ
  nguyên toàn bộ bất biến cũ, thêm: chỉ một `EventSource`, không `data-write`
  trên `<button>` thô, không hardcode đường dẫn home.
- `apps/web/app/page.tsx` thêm `data-screen="legacy"` trên phần tử gốc làm mốc
  cho `test-route-serving.mjs`.

### Technical

- Kiểm chứng trực tiếp trên Next 16.2.10: khi `app/page.tsx` và
  `app/(shell)/page.tsx` cùng tồn tại, build **thành công, không một dòng cảnh
  báo**, và file trong route group bị bỏ im lặng. `test-route-serving.mjs` có
  assert cấu trúc chặn trường hợp này ngay lúc dev tạo file.
- Đo lại các con số nền của kế hoạch: `globals.css` có **1.119** hex literal khác
  nhau; va chạm CSS thật giữa hai hệ là **5 class** (`.app` `.main` `.empty`
  `.modal` `.field`) và **2 token** (`--bg` `--accent`). Ba class `.count`
  `.spacer` `.check` **không** va chạm — cả hai phía đều đã có tổ tiên riêng, nên
  bộ dò phải so trên selector chứ không trên token class rời.
- Cả ba script guardrail đã được kiểm bằng negative test: cố tình tạo vi phạm thì
  chúng đỏ, gỡ vi phạm thì xanh trở lại.

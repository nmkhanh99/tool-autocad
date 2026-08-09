# CHANGELOG

## 2026-08-10 — Giai đoạn 2B: chat sửa message theo ID, không theo vị trí

Mọi handler của chat đều có dạng "thêm chỗ giữ chỗ → await mạng 0,2–120 giây →
điền kết quả". Bước cuối trước đây dùng `patchLast` — sửa phần tử **cuối mảng**.
Giả định ngầm là không có message nào chen vào giữa lúc `await`; giả định đó sai
bất cứ khi nào người dùng gõ tiếp, một sự kiện AutoCAD chèn thông báo, hay hai
chức năng chạy song song. Hậu quả không phải crash mà là **kết quả rơi vào nhầm
message** — người dùng thấy kết quả của thao tác này nằm dưới nhãn của thao tác
khác.

### Added

- `features/assistant/messages.ts` — `newMessageId()` và `patchById()`.
  `patchById` giữ nguyên identity của message không đụng tới (React dựa vào đó
  để bỏ qua re-render) và trả lại danh sách cũ nguyên vẹn khi ID không còn.
- `scripts/test-chat-messages.test.ts` — 7 test, gồm một test ghi lại **hành vi
  sai của bản cũ** để sau này còn biết bất biến này tồn tại vì lý do gì.
- `appendMessage()` trong `page.tsx`: thêm message và **trả về ID**, để handler
  giữ ID từ bước đầu.

### Changed

- Xoá toàn bộ **28** lời gọi `patchLast`; 17 hàm nay patch theo ID.
- `decide` và `decideLispProposal` nhận **ID** thay vì chỉ số mảng; chúng từng
  đọc `messagesRef.current[idx]` sau `await`. `decideBusy` và
  `lispProposalBusy` đổi từ `number | null` sang `string | null`.
- `refreshBom` từng nhớ **chỉ số** thẻ BOM trong `bomIdxRef` rồi cập nhật theo
  chỉ số đó — xoá một hội thoại hay chèn một thông báo là BOM ghi đè lên message
  khác. Nay là `bomMessageIdRef`.
- `key` của message bỏ fallback `m.id || <chỉ số>`.

### Fixed

- **`Msg.id` đổi từ tuỳ chọn sang bắt buộc.** Đây là thay đổi có sức nặng nhất:
  ngay khi siết kiểu, TypeScript chỉ ra **13 chỗ** tạo message không có ID mà
  grep không tìm ra hết. Để `id?` là mở lại đúng cái cửa vừa đóng.
- **Auto-BOM tắt câm khi đổi hội thoại** (Codex review phát hiện). `patchById`
  cố ý không làm gì khi ID đã biến mất, nên khi người dùng sang hội thoại khác,
  `refreshBom` vẫn cầm ID của thẻ cũ và mọi sự kiện vẽ tiếp theo không hiện gì —
  không lỗi, không thông báo. Nay `refreshBom` kiểm sự hiện diện của thẻ trước
  khi patch và dựng thẻ mới nếu không còn, `newChat` cũng xoá ref. Bản cũ dùng
  chỉ số cũng hỏng ở tình huống này, chỉ hỏng theo kiểu khác.

### Technical

- Bất biến mới: `patchLast(` = 0 · `messagesRef.current[` = 0 · `bomIdxRef` = 0 ·
  `key={m.id ||` không tồn tại · `Msg.id` khai là bắt buộc.
- Kiểm end-to-end bằng Chrome: chạy nối tiếp hai chức năng khi daemon tắt, **mỗi
  lỗi rơi vào đúng message của nó**. Với `patchLast` cũ thì message đầu sẽ không
  có lỗi còn message sau bị ghi hai lần.

---

## 2026-08-10 — Giai đoạn 2A (phần 3): một EventSource, một nơi đọc danh sách bản vẽ

### Added

- `features/acad-connection/events.ts` — bus sự kiện AutoCAD. Một
  `EventSource` cho toàn app, đếm tham chiếu (mở khi có listener đầu tiên, đóng
  khi listener cuối rời đi), listener giữ trong `Set` cấp module chứ không
  trong state. Một listener ném lỗi không làm câm các listener còn lại.
  Chuẩn hoá dấu thời gian: daemon lúc gửi mili giây lúc gửi giây.
- `lib/daemon/docs.ts` — một `fetchDocs()` cho cả ba màn hình từng tự fetch và
  tự bóc payload `/api/acad/docs`.
- `scripts/test-acad-events.test.ts` — 8 test cho vòng đời đăng ký, chạy trong
  `test:contract` với một `EventSource` giả. Lỗi của bus không lộ ra ngay: nó
  biểu hiện thành "màn hình kia bỗng ngừng nhận sự kiện" nhiều thao tác về sau,
  nên phần này được khoá bằng test thay vì bằng đọc code.

### Changed

- `page.tsx` không còn tự mở `EventSource`; nó đăng ký qua `useAcadEvents`.
  Hành vi xử lý sự kiện giữ nguyên từng nhánh.

### Fixed

- **Đăng ký trùng callback huỷ nhầm nhau** (Codex review phát hiện).
  `subscribeAcadEvents` thêm thẳng `listener` vào `Set`, mà `Set` khoá theo
  identity — nên cùng một hàm đăng ký hai lần chỉ tạo một entry, và hàm huỷ của
  người này gỡ đăng ký của người kia rồi đóng luôn kết nối chung. Nay mỗi lần
  đăng ký được bọc trong wrapper riêng, huỷ lặp không tính hai lần, và chỉ xoá
  bus khỏi bảng nếu bus trong bảng vẫn đúng là bus đó.

### Technical

- Bất biến siết thêm: `new EventSource` không chỉ **= 1** mà còn phải **nằm
  trong** `features/acad-connection/events.ts`. Tiêu chí "= 1" đơn thuần đã
  đúng sẵn từ trước khi làm gì, nên nó không đo được gì. Tương tự, endpoint
  `docs`/`events` chỉ được khai trong `lib/daemon/endpoints.ts`.
- Negative test cho chính bản sửa: hoàn nguyên về `Set` khoá theo identity thì
  đúng 1 trong 8 test đỏ (test đăng ký trùng), khôi phục thì xanh lại.
- **Thêm `check:types` vào chuỗi `verify`.** Codex review lần hai bắt được một
  lỗi TypeScript trong chính test mới mà `pnpm verify` lúc đó vẫn báo xanh:
  `next build` **không** typecheck thư mục `scripts/`, dù `tsconfig.json` có
  include nó. Nghĩa là suốt từ giai đoạn 0 tới giờ, mọi lỗi kiểu trong script
  kiểm thử đều lọt. Nay `tsc --noEmit -p tsconfig.json` chạy như một bước riêng.
- Contract test đỏ đúng vai lần thứ hai: đổi tên biến `eventAt` → `event.at`
  làm assert về dấu thời gian drawing-info fail. Bất biến vẫn đúng, chỉ mẫu cần
  cập nhật — đó chính là lúc con người phải xác nhận thay vì máy đoán.

### Hai điều CỐ Ý không làm

- **Không** chuyển bảy `setState` của handler SSE ra khỏi `Page()`. Cái lợi
  re-render chỉ đến khi từng panel tự đăng ký, mà việc đó đổi hợp đồng props
  của hai panel lớn nhất — thuộc về lúc migrate chúng sang route (GĐ5–6).
- **Không** gộp quy tắc suy đích vẽ vào `fetchDocs`. Ba màn hình suy khác nhau
  và gộp bừa sẽ làm đích vẽ nhảy sang bản vẽ khác trong im lặng. Chi tiết ba
  quy tắc ghi trong `lib/daemon/docs.ts`.

---

## 2026-08-10 — Giai đoạn 2A (phần 2): một bộ đọc phản hồi daemon

### Changed

- Xoá 3 bản `responseJson` cục bộ trong `BlockLibraryPanel`, `LispLibraryPanel`,
  `DrawingStandardsPanel`; cả ba nay dùng `daemonRecord` / `daemonJson` từ
  `lib/daemon/client.ts`. Đổi tên tại chỗ dùng thay vì import kèm alias — một
  cái tên nói dối buộc người đọc sau này phải nhảy lên đầu file mới biết mình
  đang gọi gì.
- Xoá `app/json.ts`; `asRecord` và `JsonRecord` chuyển về
  `lib/daemon/client.ts`. Bốn panel đổi đường import.

### Fixed

- Thông điệp lỗi nay chỉ nhận giá trị nguyên thuỷ. Ba trong bốn bản cũ dùng
  `String(record.error)`, nên khi daemon trả `error` là một object thì người
  dùng nhận được `[object Object]` — vô nghĩa và tệ hơn cả mã HTTP. Lấy theo
  bản an toàn nhất trong bốn bản (`LispLibraryPanel`): không phải chuỗi/số/bool
  thì lùi về `HTTP <mã>`.

### Technical

- Bất biến mới: không panel nào được tự viết lại bộ đọc phản hồi
  (`async function responseJson|responseRecord` = 0), và cả bốn panel phải
  import từ `lib/daemon/client`.
- Contract test đỏ đúng như thiết kế khi `app/json.ts` bị xoá (assert
  `from "./json"`), và `tsc` bắt được một call site `responseJson` mà regex đổi
  tên bỏ sót. Đây là hai lưới an toàn hoạt động đúng vai, không phải phiền toái.

---

## 2026-08-10 — Giai đoạn 2A (phần 1): một luồng ghi duy nhất

Gộp 3 bản sao của luồng ghi hai pha **trước khi** di chuyển bất kỳ file nào.
Thứ tự này không tuỳ ý: lệnh ghi vào bản vẽ không hoàn tác được, và một bản port
sót `confirmed: true` là một đường ghi chạy mà không hiện danh sách đối tượng
cho ai xem.

### Added

- `lib/daemon/endpoints.ts` — mọi đường dẫn API khai một chỗ.
- `lib/daemon/client.ts` — `DaemonError` giữ `code` và `status`; chuẩn hoá cặp
  mã đồng nghĩa `ambiguous_target` → `target_ambiguous` và
  `autocad_not_running` → `not_running` ngay tại biên nhận.
- `features/staged-ops/{types,guards,prepareApplyReject}.ts` — một bản duy nhất
  của prepare → confirm → reject. `confirmed: true` chỉ tồn tại ở đây.
- `scripts/extract-guard-codes.mjs` + script `check:guards`. Nó quét daemon và
  bắt UI phải có thái độ với **từng** mã: hoặc có câu chữ riêng, hoặc nằm trong
  `GENERIC_CODES`, hoặc fail build. Chặn cả chiều ngược lại — entry cho mã
  daemon không còn phát ra cũng fail, vì câu chữ chết còn tệ hơn không có.

### Changed

- `page.tsx`, `DrawingInfoPanel`, `DrawingStandardsPanel` gọi module chung thay
  cho ba bản tự viết.
- Bản trong `page.tsx` trước đây **không kiểm `ok === false`** và vứt luôn mã
  lỗi có kiểu của daemon; nay nó dùng chung đường xử lý lỗi với hai panel kia.
- Chuỗi rút số đối tượng lấy theo bản đầy đủ nhất trong ba bản. Bản ngắn ở
  `page.tsx` bỏ sót `summary.subjectCount` và độ dài mảng `subjects`.
- `prepare` nay từ chối cả phản hồi thiếu `revision`, không chỉ thiếu `id` —
  thiếu revision thì daemon không có gì để đối chiếu lúc ghi.
- Tập mã "snapshot đã cũ" mở rộng từ 4 lên 7. Bốn mã cũ là các mã kết thúc bằng
  `_stale` trừ `destination_stale` — một thiếu sót. Thêm
  `operation_revision_mismatch` và `target_mismatch` vì cả hai đều có nghĩa là
  thứ app đang cầm không còn khớp bản vẽ. Mở rộng theo hướng an toàn: nhiều
  trường hợp hơn sẽ đánh dấu snapshot cũ và buộc quét lại.

### Fixed

- 62 mã lỗi của daemon nay đều có thái độ, trong đó 51 mã có câu giải thích và
  lối thoát riêng. Bộ mẫu thiết kế chỉ liệt kê 11 — thiếu cả bốn mã mà màn
  "Thay đổi chờ duyệt" sẽ gặp nhiều nhất khi apply một thao tác cũ
  (`operation_expired`, `operation_not_found`, `operation_not_pending`,
  `operation_revision_mismatch`) và thiếu `selection_too_large`.

### Technical

- Bất biến mới trong `test-contract.mjs`: `confirmed: true` đúng **1** lần
  (trước là 3) và phải nằm trong `features/staged-ops/prepareApplyReject.ts`;
  không file nào ngoài `lib/daemon/endpoints.ts` được nhắc endpoint
  prepare/operations. Phép đếm **bỏ comment trước khi đếm** — chính comment giải
  thích bất biến lại chứa chuỗi đang đếm.
- `check-import-boundaries.mjs` cũng bỏ comment: một doc comment nhắc tên
  endpoint mà nó mô tả không phải là phụ thuộc.
- Negative test: thêm một bản sao luồng ghi thứ hai thì contract test đỏ
  (`2 !== 1`), gỡ ra thì xanh lại.
- `tsc --noEmit` sạch. `applyStagedOp` trả `JsonRecord` (giá trị `unknown`) thay
  vì `any` như `response.json()` cũ — siết chặt hơn, đã sửa một chỗ gọi.

---

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

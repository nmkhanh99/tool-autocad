# ROADMAP

Backlog của việc chuyển giao diện sang bộ mẫu `mau-thiet-ke/`.
Kế hoạch đầy đủ và lý do từng quyết định: `KE-HOACH-CHUYEN-DOI-UI.html`.

---

## Done

### Giai đoạn 0 — Gỡ blocker & dựng guardrail (2026-08-09)

- `trailingSlash: true` — bản đóng gói phục vụ đúng route con.
- Catch-all daemon trả 404 cho `/_next/*` và `*.txt`.
- `test-route-serving.mjs`, `check-css-collisions.mjs`,
  `check-import-boundaries.mjs`; script `verify` gộp cả chuỗi.
- `test-contract.mjs` viết lại theo glob để assert phủ định không tự động xanh
  khi code di chuyển.
- `DEVELOPMENT.md`, `CHANGELOG.md`, `ROADMAP.md`, `USER_GUIDE.md`.

### Giai đoạn 1 — Dọn va chạm CSS (2026-08-09)

Giao diện không đổi, đã kiểm bằng Chrome thật.

- Đổi tên phía legacy: 2 token + 5 class → tiền tố `legacy-`. Đếm usage
  trước/sau khớp tuyệt đối.
- Gate hai hệ bằng `body[data-legacy]` / `body[data-ds]`, dùng `:where()` để giữ
  nguyên specificity.
- `design-system.css` = copy `app.css` @ `82f5232` + 2 sai lệch được khai.
- Gộp 3 keyframes xoay trùng; xoá `.chips` `.chip` `.log`.

---

### Giai đoạn 2A — Gộp luồng ghi

**Phần 1 xong (2026-08-10):** `lib/daemon/{client,endpoints}.ts` +
`features/staged-ops/{types,guards,prepareApplyReject}.ts`; 3 call site đã
chuyển; `confirmed: true` từ 3 → **1**; 62 mã guard đều có thái độ, khoá bằng
`check:guards`.

**Phần 2 xong (2026-08-10):** gộp 4 bản `responseJson`/`responseRecord` về
`lib/daemon/client.ts`; xoá `app/json.ts`; thông điệp lỗi không còn cho ra
`[object Object]`.

**Phần 3 xong (2026-08-10):** `features/acad-connection/events.ts` — một
`EventSource` cho toàn app, đếm tham chiếu, listener trong `Set` cấp module.
`lib/daemon/docs.ts` — một `fetchDocs()`, ba màn hình dùng chung.

Hai ghi chú khảo sát để phiên sau không làm sai:

- **Cái lợi re-render của bus chưa đến.** Bảy `setState` của handler SSE vẫn
  nằm trong `Page()`, nên mỗi sự kiện vẫn re-render cả cây. Lợi ích chỉ đến khi
  từng panel tự đăng ký — mà việc đó đổi hợp đồng props (`refreshToken`,
  `refreshEventAt`, `initialTarget`) của hai panel lớn nhất. Làm cùng lúc với
  việc migrate chúng sang route (giai đoạn 5–6), không làm sớm chỉ để đạt một
  chỉ số.
- **Không gộp quy tắc suy đích vẽ vào `fetchDocs`.** Ba màn hình suy khác nhau:
  `LispLibraryPanel` ưu tiên `initialTarget` rồi mới tới active;
  `DrawingStandardsPanel` kiểm `current` còn hợp lệ trước đã; `page.tsx` không
  suy đích mà trả payload cho nơi gọi dùng inline. Gộp mà bỏ qua khác biệt này
  sẽ làm đích vẽ nhảy sang bản vẽ khác trong im lặng — trên một app mà mọi lệnh
  ghi đều không hoàn tác được, và không test nào hiện có bắt được.

**Còn lại:** `ConfirmSheet.tsx` dùng chung. Hoãn tới giai đoạn 3 vì nó cần bộ
primitive của design system (`Modal`, `Button`, `GuardStrip`) chưa tồn tại; ba
màn hình hiện dựng phần xác nhận bằng markup riêng, hoà làm một trước khi có
primitive chỉ tạo ra một component thứ tư phải viết lại.

Ngoại lệ phải viết ra: `DrawingInfoPanel` lấy `documents` từ payload
`/drawing-info` vì cần cùng revision với snapshot — panel này **không** dùng
`fetchDocs()`.

### Giai đoạn 2B — Chat sang id-based (2026-08-10)

Làm **khi chat còn đứng yên trong `page.tsx`**, không cùng PR với việc di
chuyển nó sang route.

- `features/assistant/messages.ts` + 7 test viết **trước** khi đụng code.
- Xoá 28 `patchLast`; `decide`/`decideLispProposal`/`refreshBom` nhận ID thay
  vì chỉ số mảng.
- **`Msg.id` từ tuỳ chọn thành bắt buộc** — siết kiểu xong, TypeScript chỉ ra
  13 chỗ tạo message không ID mà grep không tìm hết.
- Kiểm end-to-end bằng Chrome: hai thao tác nối tiếp, mỗi lỗi vào đúng message.

### Giai đoạn 3 — Shell dùng chung (2026-08-10)

- `icons.tsx` (27 glyph) và `nav.ts` (14 mục / 15 lệnh) **sinh từ mẫu**.
- `AppShell` + titlebar / rail / statusbar / ⌘K / nhật ký; 5 primitive UI.
- `useAcadState` 6 trạng thái; `WriteButton` đọc trạng thái từ context,
  fail-closed khi thiếu provider.
- **D6 xong**: plugin phát `dbmod` cho mọi bản vẽ đang mở, suy từ bộ đếm
  revision + `AcRxEventReactor::saveComplete`. Plugin đã build được.
- Kiểm bằng Chrome: ⌘K, ⌘B, và điều hướng client-side hai chiều gỡ sạch
  attribute.

---

### D6 — xác minh `dbmod` trên AutoCAD thật (2026-08-10)

Plugin đã build và **nạp vào AutoCAD 2027**. Chạy đủ ba bước kiểm:

| Bước | `revision` | `dbmod` |
|---|---|---|
| Bản vẽ vừa mở | 0 | **0** |
| Sau khi vẽ 1 đường | 3 | **1** |
| Sau khi lưu | 44 | **0** |

Sự kiện `drawingSaved` phát đúng chỗ trong `events.jsonl`.

Ghi lại một điều học được: sau khi lưu, `revision` nhảy 3 → 44 vì AutoCAD chạm
nhiều đối tượng trong lúc lưu. So bộ đếm thô sẽ báo "chưa lưu" ngay sau khi vừa
lưu xong — đó chính là lý do thiết kế cần **mốc đặt lại bởi `saveComplete`** chứ
không so thẳng bộ đếm.

---

## Quyết định đã chốt

| # | Quyết định | Chốt ngày | Hệ quả |
|---|-----------|-----------|--------|
| **D1** | Giao diện **theo mẫu (sáng) + khối dark** tôn trọng `prefers-color-scheme` | 2026-08-09 | Copy `app.css` nguyên văn ở GĐ1; thêm ~20 dòng khối dark ở GĐ10 bằng cách đảo vai trò 7 literal |
| **D6** | **Thêm `dbmod`** vào `writeDocs()` của plugin ObjectARX | 2026-08-09 | ~5 dòng C++ (`objectarx/mepbridge.cpp`) + `dbmod?: number` vào `OpenAcadDocument`; phải build lại plugin. Giữ chấm saved trên doctab, hộp thoại khởi động lại liệt kê đúng, giữ cột "Lưu" ở Tổng quan |
| **D2** | **Giữ** 2 panel prototype — bê nguyên vào route + banner "bản dựng thử" | 2026-08-10 | Tạo `/preconstruction` và `/review-pdf` ở GĐ10. **Không refactor** — refactor làm chúng trông đã hoàn thiện. Banner cấp route, không tắt được. Giữ luôn 1.745 dòng CSS |
| **D3** | **Build** 3 endpoint enumerate + `onConflict` cho `/publish` | 2026-08-10 | `/plot/devices`, `/plot/style-sheets`, `/plot/page-setups`, `/layouts`; thêm `onConflict: "fail"\|"overwrite"\|"suffix"` vào whitelist. ~3–5 ngày backend. **Vẫn phải cắt** dpi / tỉ lệ ngoài `fit\|1:1` / vùng in "Cửa sổ" — giới hạn kênh plot macOS, không phải thiếu route |
| **D4** | **Build cả (b) và (c)** cho `/batch` | 2026-08-10 | (b) `/files`, `recursive`, `/mep/recipes`, job model + SSE + cancel — ~5–8 ngày. (c) cầu nối Python `/api/acad/offline/*` — ~3–5 ngày. (c) là lối thoát duy nhất khi máy chưa cài AutoCAD |
| **D7** | Duyệt LISP: **chỉ đầy đủ trong app desktop**, web hiện lý do | 2026-08-10 | Giao diện kết luận theo **môi trường đang chạy** (`window.acadStudio.signReview`), không viết cứng. Không dời luồng duyệt sang desktop shell, không đổi thiết kế bảo mật. **Còn phải giải:** đề xuất manifest lấy từ đâu — xem mục Giai đoạn 4 |
| **D5** | **Dựng** sync server nhận `.cadweb` | 2026-08-10 | ~10–15 ngày + phần Windows chưa rõ. Cần process + 5 implementation (`Authenticator`, `Authorizer`, `ImmutableBlobStore`, `RevisionMetadataStore`, `RevisionEventPublisher`). Mở khoá `.revstrip` ở `/workspace` và bảng snapshot per-drawing ở `/cadweb` |

**Không còn quyết định nào đang chặn.** Tổng backend phát sinh từ D3+D4+D5:
khoảng **21–33 ngày công**, tính riêng ngoài 95–140 ngày front-end.

---

## Next

### Giai đoạn 4 — `/library/blocks` và `/library/lisp` — **XONG (2026-08-10)**

**Xong:** tách `features/blocks/model.ts` (9 test); route `/library/blocks`
bản **chỉ đọc** với CSS module riêng trích từ mẫu.

**Xong tiếp (2026-08-10):** `ConfirmSheet` dùng chung; hai lệnh ghi một pha
`insert` / `sync` trên `/library/blocks`; sắp lại ranh giới (`lib/acadState.ts`
+ `components/ui/WriteButton`).

**Xong tiếp (2026-08-10):** form **sửa metadata** (`BlockMetadataForm`),
`PUT /blocks/:id` kèm `expectedRevision`, validate dùng chung với panel cũ; thông
báo nói rõ việc lưu metadata đẩy block `synced` về `outdated`.

Phần này qua **11 vòng Codex review** mới sạch — 9 phát hiện, trong đó 2 là P1
(ghi đè im lặng thay đổi của người khác; mất bản nháp khi tải lại hỏng). Gần như
tất cả đều nằm quanh **một câu hỏi**: form giữ bản nháp bao lâu, và mốc nào để
biết "đã sửa gì chưa". Ghi lại để phiên sau đừng làm lại từ đầu:

- Bản nháp chỉ giữ **những trường form sửa được**, không phải cả định nghĩa.
- Đặt lại theo `block.id`, không theo object `block` — danh mục tải lại liên tục.
- Mốc so sánh là **state riêng**, không phải prop `block`.
- Lượt lưu mang **revision của mốc**, không phải revision mới nhất của danh mục.
- Đọc bản đã ghi từ **phản hồi `PUT`**, không đợi danh mục tải lại.
- Tải lại hỏng thì **giữ danh mục cũ**; block đang chọn tra trong **toàn** danh
  mục, không phải danh sách đã lọc.

Cùng bộ ràng buộc này sẽ lặp lại ở form **tạo block từ bộ chọn** và các form ở
`/library/lisp`, `/standards`, `/settings`.

**Xong tiếp (2026-08-10):** **tạo block từ bộ chọn** (`POST /blocks/create`,
dựng trong `ConfirmSheet` vì nó xoá đối tượng khỏi bản vẽ) và **nguồn thư viện**
(`POST /blocks/sources` + ô `sourceId` trong form metadata). `ConfirmSheet`
chuyển sang `components/ui/` — hạ tầng dùng chung, không thuộc `staged-ops`.

**Còn lại:**

- `POST /blocks/scan` — quét **bản vẽ đang mở** để đưa định nghĩa của nó vào danh
  mục. Vẫn ở màn hình cũ. Lưu ý khi dựng: nhãn "Quét lại nguồn" của bộ mẫu **mô
  tả sai** — endpoint này không đụng tới thư mục nguồn.
- `/library/lisp` **bản chỉ đọc xong (2026-08-10)**: danh mục, bộ lọc, pane chi
  tiết, nhãn tiếng Việt cho mọi mã của daemon, và **hiện rõ `analysisCoverage`**
  cùng hash lúc duyệt — mục đó của kế hoạch coi như xong.

  **D7 đã chốt (2026-08-10): đường (a)** — chỉ dựng đầy đủ khi chạy trong app
  desktop, web thì hiện lý do.

  Phần đầu của (a) **đã làm**: banner kết luận theo `window.acadStudio.signReview`
  chứ không viết cứng, và nói rõ có bộ ký mới là **nửa** điều kiện — nửa còn lại
  (`ACAD_REVIEW_PUBLIC_KEY` của daemon) client không nhìn thấy được nên giao
  diện không kết luận thay. Trước đó banner nói "web không duyệt được" vô điều
  kiện, tức nói **sai** khi chính trang này được app desktop mở.

  **Duyệt đã dựng xong (2026-08-10) — và không cần agent.** Giả định "phải có đề
  xuất của agent mới duyệt được" là **sai**: `validateApprovedManifest()` chỉ
  bắt buộc một câu tóm tắt, phần còn lại daemon đã phân tích tĩnh sẵn
  (`inferred`), và chữ ký Ed25519 xác nhận *một con người đã đọc source* chứ
  không xác nhận rằng một agent đã chạy. Hộp duyệt vì thế hiện source ra, bắt
  viết tóm tắt, bắt tích xác nhận — rồi ký.

  Vẫn còn ở màn hình cũ: **nhờ agent phân tích rồi đề xuất manifest**. Đó là một
  tiện ích, không phải điều kiện để duyệt. Chuyển nó sang màn mới vẫn cần trả
  lời "đề xuất lưu ở đâu" (`db.ts` chỉ lưu *quyết định*), nhưng nó không còn
  chặn gì nữa.

  **Nạp script và thư mục gốc đã xong (2026-08-10).** `ConfirmSheet` có thêm chế
  độ `session` cho lệnh đổi phiên AutoCAD chứ không ghi bản vẽ; `guards.ts`
  chuyển sang `lib/daemon/`.

  Một mục của kế hoạch **bỏ**: `.countdown` 2 phút cho "token nạp". Mẫu vẽ nó,
  nhưng `POST /:id/load` **không** phát token nào — nó chạy job LISP rồi trả kết
  quả trong 15 giây. Cái có hạn 2 phút là **token duyệt** của
  `approval-challenge`, thuộc luồng duyệt (desktop). Dựng đồng hồ đếm ngược ở
  màn nạp là vẽ một cơ chế không tồn tại.

  **Giữ nguyên `askAgent()`** — budget 180 KB, cắt đôi 12 lần, chống
  prompt-injection.
- Xoá CSS `blocklib-*` (281 dòng) và `lisp-*` (407 dòng) khỏi `globals.css` khi
  panel cũ bị gỡ.

**Ghi chú cho phiên sau:** mỗi màn hình trong mẫu có khối `<style>` riêng ngoài
design system. Đừng nhét chúng vào `design-system.css` — dùng CSS module cạnh
route, như `blocks.module.css` vừa làm.

---

## Later

- **Giai đoạn 5** — `/workspace`. **Đã xong (2026-08-10)**, cả backend lẫn giao diện. Ghi lại vì sao nó từng bị chặn: Đã kiểm ngày 2026-08-10 trên snapshot thật (`~/Acad-Bridge/drawing-info.json`,
  350 KB) và trên mã nguồn: **không chỗ nào trong daemon hay plugin trả toạ độ
  của bất kỳ đối tượng nào.** `drawing-info` có số đếm theo type/layer/space,
  bảng layer/block/layout/style, và **một** bounding box của cả bản vẽ;
  `selection.objects` và `SelectionSubject` chỉ có `{handle, type, layer,
  layerHandle, ownerHandle}`. Grep `vertices|geometry|startPoint|endPoint` trong
  `apps/daemon/src` và `objectarx/mepbridge.cpp`: không có.

  Nghĩa là canvas không có gì để vẽ — dựng nó bây giờ sẽ ra đúng một
  `PreconstructionPanel` thứ hai (hình bịa, người dùng tin là bản vẽ thật). Ghi
  chú "hit-test trên canvas WebGL2" trong kế hoạch cũng lệch với bộ mẫu: mẫu
  `workspace.html` dùng **SVG inline** với `data-entity`/`data-handle` viết cứng.

  **Đã gỡ chặn (2026-08-10): plugin xuất hình học.** `geometry.req` →
  `geometry.json`, và `GET /api/acad/geometry`. Đã chạy thật trên bản vẽ
  as-built của dự án: 258 đối tượng, dưới 1 giây, `bounds` theo từng space.

  **Phần giao diện của giai đoạn 5 giờ làm được**, nhưng phải mang theo ba sự
  thật của dữ liệu, nếu không sẽ ra đúng một `PreconstructionPanel` thứ hai:

  - **62/258 đối tượng chỉ có hình bao** (`a:1`, `aw:"bounding-box"`) —
    DIMENSION, MULTILEADER, HATCH, VIEWPORT. Canvas phải vẽ chúng khác đi và
    màn hình phải nói ra, không được để người dùng tưởng đó là hình thật.
  - **41 MLINE là TIM ỐNG**, không phải hai đường thành ống
    (`aw:"mline-centerline"`).
  - **`truncated`** phải hiện lên. Vẽ 3.000/47.000 đối tượng mà im lặng thì
    người dùng tin đó là cả bản vẽ.

  **Đã làm nốt (2026-08-10): nội dung định nghĩa block.** Đối chiếu với ảnh bản
  vẽ thật mới lộ ra rằng đây không phải việc "để sau": bản vẽ chỉ có 259 đối
  tượng ở cấp trên cùng, còn cả mặt bằng nằm trong 95 định nghĩa block. Nay
  `geometry.json` có `blocks` (147 định nghĩa, 10.122 đối tượng) và mỗi lần chèn
  mang ma trận `m`.

  **Đã dựng hình HATCH, DIMENSION, ELLIPSE, SPLINE (2026-08-10).** Hình bao còn
  0,7% (74/10.888). Còn lại: 43 HATCH tô đặc có biên dạng cạnh rời, 23
  MULTILEADER, 8 VIEWPORT.

  **Đã làm nốt `worldDraw` (2026-08-10).** Hình bao còn **0,01%** (1/10.888 —
  đúng một VIEWPORT). MULTILEADER, HATCH tô đặc và VIEWPORT đều qua đường này.

  **Đã làm nốt (2026-08-11): VIEWPORT, MTEXT, căn lề.** Hình bao còn **0/10.888**.

  **Đã làm nốt (2026-08-11): "Chọn trong AutoCAD".** Đường duy nhất từ màn hình
  này chạm tới AutoCAD, qua hai pha. Ràng buộc tìm ra bằng cách thử: chọn theo
  handle chỉ chạy với **không gian hiện hành** của AutoCAD — nút tự khoá kèm lý
  do khi lệch. Pha xác nhận chưa chạy được trọn trên máy này; xem `CHANGELOG.md`.

  Chưa làm ở plugin:
  - **Chữ mã hoá phông Việt cũ** (TCVN3/VNI) đọc ra là chuỗi rác. Xem
    `CHANGELOG.md` 2026-08-11 — cần nhận diện phông rồi giải mã theo bảng.
  - **Định dạng bên trong MTEXT** (đậm, nghiêng, đổi cỡ giữa dòng) bị bóc đi;
    giữ lại đòi tách một MTEXT thành nhiều thẻ có kiểu riêng.
  - Chữ bắt qua `worldDraw` vẫn không có căn lề — nó đến từ lời gọi cấp thấp
    không mang thông tin đó.
- **Giai đoạn 6** — `/drawing-info` **đã xong (2026-08-11)**; còn tách `/review`
  và `/standards`.

  **`DrawingInfoPanel` legacy đã XOÁ (2026-08-11)** — panel đầu tiên trong đợt
  migrate. Ba chức năng cuối đã port trước khi xoá: bộ chọn bản vẽ, danh mục đối
  tượng (lọc + phân trang + chọn cả tập), và JSON thô. Cùng với 184 quy tắc CSS
  và 24 assert contract chết theo; 5 bất biến còn giá trị chuyển sang màn hình
  mới.

  **Đổi tab Model/Layout — đã bắt được (2026-08-11).** Plugin nay phát `space`
  trong `/docs` và sự kiện `layoutSwitched`; `profileStaleReason` thêm loại
  `space-changed`. Guard máy chủ vẫn chỉ soi `instance` + `revision`, không soi
  không gian — nên đây là chốt chặn ở phía giao diện, không phải ở daemon.

  Ghi lại một giả định đã sai để không lặp lại: tôi từng viết "đổi tab không làm
  revision tăng". Đo thật thì nó tăng (0 → 121), vì AutoCAD dựng lại viewport.
  Bài học: đừng suy hành vi bộ đếm từ ý nghĩa của thao tác — đo nó.

  **Cách làm cho các panel sau:** rà TỪNG chức năng của panel cũ trước, port cái
  còn thiếu, chạy thật, rồi mới xoá. Lượt này suýt xoá sớm vì tưởng màn hình mới
  đã đủ.

  Phần đã xong mang theo một sự thật của backend mà mọi màn hình ghi khác cũng
  phải biết: `select` chạy theo **phạm vi**, còn `move-to-layer` chạy trên **bộ
  chọn hiện tại của AutoCAD** và bỏ qua phạm vi hoàn toàn.

  **Tách `/review` và `/standards` đã xong (2026-08-12).** `/standards` soạn hồ
  sơ quy tắc, `/review` quét và sửa.

  **Ba bảng còn thiếu đã dựng xong (2026-08-12).** Bảng layer, bảng ánh xạ và
  bảng 20 trường kích thước nâng cao — cả ba sửa tại chỗ, trong
  `features/standards/ProfileTables.tsx`. Nhãn "chưa có ở màn này" đã gỡ.

  Việc bê sang làm lộ một lỗi thang đo tôi tự gây: bảng bề dày nét dựng theo mã
  DXF group 370 (1/100 mm, ba giá trị âm), trong khi kho hồ sơ nhận **milimét
  `0…2.11`** cộng ba **chuỗi** `Default`/`ByLayer`/`ByBlock`. 26/27 lựa chọn sẽ
  ăn 400 lúc lưu. Đã đo trực tiếp trên daemon: `40` → 400, `-3` → 400,
  `"Default"` → 200.

  **Đã rà xong toàn bộ `DrawingStandardsPanel.tsx` (2.411 dòng) — KẾT LUẬN:
  chưa xoá được (2026-08-12).** Rà từng chức năng, đối chiếu với `/standards` +
  `/review`. Còn **10 khoảng trống**, chia ba nhóm:

  **Nhóm 1 — soạn hồ sơ, còn 2 việc** (2 việc khác đã đóng ngay khi rà: hai
  trường `linearFormat` và `frameTolerancePercent` vô hình ở màn mới, và ô `Loại`
  của ánh xạ bị khoá thành select trong khi panel cho gõ tự do):

  - `importCurrentLayers()` — nạp danh sách layer thẳng từ bản vẽ qua
    `/api/acad/drawing-info`, kèm quy đổi bề dày DXF→mm. Thay cho việc gõ tay
    hàng chục layer. **Đáng port nhất trong cả danh sách.**
  - `BoundsEditor` — ô JSON thô sửa `mapping.bounds`. `/standards` giữ được
    `bounds` nhưng không sửa được.

  **Nhóm 2 — quét và sửa, còn 4 việc:**

  - Bảng **đối tượng đã nhận diện** (nhãn/loại/handle/layer/rộng/cao/diện tích).
    Máy chủ *đã trả* `objects` trong kết quả quét; `/review` vứt đi. Hệ quả trực
    tiếp: câu app đang khuyên ở màn hồ sơ — “lưu, rồi quét và đối chiếu số đối
    tượng” — **hiện không làm theo được**.
  - Bảng **dimension** đọc từ lượt quét (`dimensions`, cũng đang bị vứt).
  - **Chọn + zoom đối tượng trong AutoCAD** từ handle của một phát hiện
    (`prepareHandleSelection`). `/review` chỉ in handle ra dạng chữ.
  - **DIMSPACE**: chọn một DIM làm chuẩn rồi căn đều các DIM đã tích. Đây chính
    là lý do `unsupportedFixReason()` đang chặn hành động `dimspace`.

  **Nhóm 3 — công cụ thao tác trực tiếp: BỎ, không port (user quyết
  2026-08-12).** Gồm `scale`, `rotate`, `color`, `layer`→`move-to-layer`, `area`,
  và `importCurrentSelection()` đọc pickfirst selection.

  Lý do bỏ: đây là các lệnh AutoCAD gốc, và một kỹ sư đang mở sẵn AutoCAD gõ
  `SCALE` nhanh hơn chuyển sang trình duyệt rồi bấm. Chúng cũng là nhóm rủi ro
  nhất — `scale`/`rotate` chạy được trên **cả bản vẽ** và không hoàn tác được từ
  app. Không có quy trình thật nào cần chúng.

  Hệ quả: xoá panel chỉ còn chờ nhóm 1 và 2. Endpoint
  `/standards/action` vẫn giữ nguyên ở daemon — `/review` dùng nó cho các hành
  động sửa theo phát hiện, và `select` (mục 2.2) cũng đi qua đó.

  > Một mục tôi từng đề xuất giữ mà nay cũng bỏ theo: `area` (đo diện tích) và
  > đọc bộ chọn — cả hai đều chỉ ĐỌC, và tôi đã đề xuất chuyển sang
  > `/workspace`. Nếu sau này cần lại thì đó là một việc nhỏ, tách riêng.

  Một thứ **cố ý không port**: dấu ★ “hồ sơ đang dùng”. Daemon tính
  `activeProfileId` bằng `state.profiles[0]?.id` — không có kho, không có
  endpoint đặt nó. Ngôi sao đó nói “hồ sơ đầu danh sách”, không phải “đang dùng”.

  **Thứ tự đã chốt (user duyệt 2026-08-12).** Cả năm mục đều KHÔNG cần viết thêm
  endpoint nào — backend đã có sẵn:

  | # | Việc | Vì sao ở vị trí này |
  |---|---|---|
  | 1 | **2.1** Bảng đối tượng đã nhận diện | Vá một lời khuyên app đang đưa ra mà không thực hiện được; dữ liệu máy chủ đã trả sẵn, `/review` đang vứt đi |
  | 2 | **1.1** Nhập layer từ bản vẽ | Đối chiếu chứ không thay sạch; nhớ quy đổi bề dày DXF→mm |
  | 3 | **2.2** Chọn + zoom đối tượng trong AutoCAD | Cây cầu duy nhất từ danh sách phát hiện sang bản vẽ |
  | 4 | **1.2** Sửa `bounds` bằng hai nhóm ô có nhãn, KHÔNG phải ô JSON | Xem bảng ba nghĩa của `bounds` ở trên |
  | 5 | **2.3** Bảng dimension + DIMSPACE | Mở khoá hành động thứ 5/5; hẹp hơn bốn mục trên |

  **Bẫy đã phát hiện trước khi bắt tay vào 2.1:** phản hồi của `POST /scan` gửi
  `parsed.objects` **thô** — diện tích theo đơn vị bản vẽ, không kèm `areaUnit` —
  trong khi bản lưu phiên dùng `displayObjects()` đã quy đổi sang m². Với bản vẽ
  mm, một phòng 20 m² ra `20000000`. Cách gọn nhất là cho daemon gửi luôn bản đã
  quy đổi; nó đã tính sẵn cho phiên rồi.

  **Bản rà soát trên còn THIẾU — sửa lại 2026-08-12 sau khi đối chiếu
  `KE-HOACH-CHUYEN-DOI-UI.html`.** Tôi rà panel cũ ↔ màn mới, nên mọi yêu cầu
  của kế hoạch mà panel cũ *cũng* không có thì phép so đó mù hoàn toàn. Ba thứ
  lọt lưới, cả ba thuộc giai đoạn 6:

  | # | Kế hoạch đòi | Hiện trạng |
  |---|---|---|
  | 6 | `features/review/scopes.ts` — bảng tra **6 hằng số** thay cho `scopeMatches()` lọc bằng regex tiếng Việt (`/frame\|paper\|scale\|khung\|tỷ lệ\|ty le/`) | thư mục không tồn tại. Sáu hằng số thật: `unit` · `layer` · `dimstyle` · `dim-row` · `frame` · `mapping-required` |
  | 7 | Nút **Xoá hồ sơ** (`DELETE /profiles/:id`) — kế hoạch ghi rõ đây là "việc thêm mới thật" | daemon có endpoint (`drawingStandards.ts:704`), **không màn nào có nút** |
  | — | Bất biến CI **#7**: tập `scope:"…"` trích từ `standardsEngine.ts` = tập hằng số trong `features/review/scopes.ts` | `test-contract.mjs` không assert gì về scope |

  Lý do kế hoạch nêu cho việc bỏ regex đáng giữ nguyên văn: *backend đổi một chữ
  là issue biến mất im lặng*. `/review` hiện lọc theo mức độ + từ khoá nên không
  mắc đúng lỗi đó, nhưng cũng chưa có bảng tra.

  Tiêu chí nghiệm thu `grep -c "scopeMatches" = 0` hiện là **4** — tự đạt khi xoá
  panel.

  **Xoá panel khi xong 2.1 + 1.1 + 2.2** — lúc đó nó không còn giữ thứ gì thiết
  yếu. 1.2, 2.3 và hai mục 6–7 làm sau cũng được.

  Bản đề xuất đầy đủ kèm ràng buộc cho từng mục: `DE-XUAT-UI-CON-THIEU.html`.

  `DocumentReviewPanel.tsx` (1.348 dòng) là chuyện khác: prototype PDF, thành
  `/review-pdf` ở giai đoạn 10 theo D2.

  **Nợ kỹ thuật phát sinh — bộ chạy job kích hoạt bản vẽ đích.** `runJob()` gọi
  `executeInApplicationContext(pDoc, cmd, !readOnly, …)`: job GHI luôn kích hoạt
  bản vẽ đích trước khi chạy. Hệ quả: người dùng đổi tab trong quãng giữa lúc
  daemon kiểm và lúc job chạy thì AutoCAD nhảy về bản vẽ cũ rồi ghi vào đó —
  trong khi họ đang nhìn bản vẽ khác. Ba tầng chốt hiện có (giao diện, daemon,
  chương trình LISP) đều đọc trạng thái TRƯỚC mốc đó nên không bịt được.

  Cách bịt: cho job ghi một chế độ "không kích hoạt, từ chối nếu đích chưa
  active". Chạm tới bộ chạy dùng chung cho MỌI lệnh ghi (chèn block, LISP, sửa
  tiêu chuẩn), nên phải làm thành một lượt riêng có test cho từng đường.
- **Giai đoạn 7** — `/changes` (trục xoay), `/takeoff`, `/settings`.
- **Giai đoạn 8** — `/publish`, `/batch`, `/cadweb`, `/` Tổng quan. Phạm vi đã
  chốt qua D3/D4/D5; **backend phải xong trước** (xem mục dưới).
- **Giai đoạn 9** — `/assistant`, xoá route legacy.
- **Giai đoạn 10** — xoá `globals.css`, hoàn tất token; tạo `/preconstruction`
  và `/review-pdf` theo D2 (bê nguyên + banner, **không refactor**).

### Backend phát sinh từ D3/D4/D5 — làm trước giai đoạn 8

Khoảng **21–33 ngày công**, tính riêng ngoài 95–140 ngày front-end.

- **D3 · `/publish`** — `GET /plot/devices`, `/plot/style-sheets`,
  `/plot/page-setups`, `/layouts?target=`; thêm
  `onConflict: "fail"|"overwrite"|"suffix"` vào whitelist 15 field của
  `plotPdf.ts`; `POST /job/:id/cancel`; `POST /reveal {path}` (~5 dòng,
  `open -R`). ~3–5 ngày.
- **D4b · `/batch`** — `GET /files?dir=&recursive=&ext=dwg` (guard: đường dẫn
  tuyệt đối, tồn tại, trong allowlist); thêm `recursive?` cho `/mep/:recipe` và
  đổi `readdirSync` sang duyệt cây có giới hạn độ sâu; `GET /mep/recipes`;
  job model 202 + `/jobs/:id` + SSE + cancel. Hiện `/mep/:recipe` chạy vòng
  `for` đồng bộ trong **một** request: 100 tệp × 120 s = 3 giờ trong một HTTP
  request. ~5–8 ngày.
- **D4c · nhân offline Python** — `POST /api/acad/offline/:command` spawn
  `python3 app/cli.py`; `GET /api/acad/offline/health`. Lối thoát duy nhất khi
  máy chưa cài AutoCAD — hiện `app/cli.py` hoàn toàn không truy cập được từ
  web. ~3–5 ngày.
- **D5 · sync server `.cadweb`** — dựng process bind
  `createSyncHttpHandler` (hiện **chỉ được gọi trong test**) + 5 implementation:
  `Authenticator`, `Authorizer`, `ImmutableBlobStore`, `RevisionMetadataStore`,
  `RevisionEventPublisher`. Kèm `GET /api/cadweb/snapshots?drawing=` và
  `POST /sync/retry/:artifactId`. Mở khoá `.revstrip` ở `/workspace`.
  ~10–15 ngày; phần Windows chưa rõ.

---

## Hoàn tác bản plugin

Bản plugin cũ (build 29.07) được sao lưu trước khi ghi đè:

```
/Users/khanhnm/Desktop/tool-autocad/objectarx/build/backup-plugin-20260810-095550
```

Khôi phục: copy hai thư mục `ApplicationPlugins-*` / `ApplicationAddins-*` trong
đó trở lại `~/Library/Application Support/Autodesk/<tương ứng>/Acad-Bridge.bundle`
rồi khởi động lại AutoCAD.

---

## Technical Debt

- **21% web app là prototype không backend.** `PreconstructionPanel` (1.089 dòng
  TSX + 1.118 dòng CSS, **0** lời gọi API) và `DocumentReviewPanel` (1.358 dòng,
  **1** lời gọi, chỉ đọc `INSUNITS`; mọi số đo là hằng số). Theo **D2** thì giữ
  và gắn banner "bản dựng thử" cấp route, không tắt được. Điều kiện thoát: chỉ
  gỡ banner khi có endpoint thật. **Không refactor** — refactor làm chúng trông
  đã hoàn thiện, đúng thứ nguy hiểm nhất: người dùng tin vào con số bịa.

  **Banner đã gắn (2026-08-11)**, kèm `pnpm check:prototype` canh nó: danh sách
  hai màn hình này là hợp đồng, kiểm cả hai chiều, bóc chú thích trước khi tìm
  (bọc vào comment không qua được), và đòi lưới của hai panel chừa hàng cho
  banner ở **mọi** khổ màn hình. Gỡ một tên khỏi danh sách phải sửa mục này
  trong cùng lượt.
- **Nghi vấn ở `buildCreateBlockLisp` — chưa xác minh, chưa sửa.** Sau khi chạy
  `-BLOCK` (lệnh này **xoá** các đối tượng đã chọn), LISP làm
  `(setq acadlib:ref (entlast))` rồi `CHPROP` đối tượng đó sang layer mặc định
  của block. Nhưng `-BLOCK` không chèn thể hiện nào, nên `entlast` khả năng cao
  **không** phải block vừa tạo mà là một đối tượng bất kỳ — tức có thể âm thầm
  đổi layer của một hình không liên quan. Đã thử dò trên AutoCAD thật nhưng job
  LISP lỗi giữa chừng và không trả kết quả, nên **chưa kết luận được**. Không sửa
  trong giai đoạn UI này; cần một lượt kiểm riêng trên bản vẽ nháp.
  File: `apps/daemon/src/blockLibraryCad.ts`, quanh dòng 277-287.
- **Job LISP lỗi giữa chừng làm kẹt `activeJob` 2 phút.** `acad:write-result`
  không chạy thì daemon giữ `state:"sent"` tới khi `JOB_BUSY_MS` hết hạn, và mọi
  lệnh ghi bị chặn trong quãng đó. Tự khỏi nên không nghiêm trọng, nhưng thông
  điệp cho người dùng lúc ấy là "AutoCAD đang bận" — sai nguyên nhân.
- **`globals.css` 3.500 dòng, 1.119 hex literal.** Xoá ở giai đoạn 10.
- **32 đường dẫn API rải rác trong `app/page.tsx`.** Ranh giới "endpoint chỉ khai
  ở `lib/daemon/endpoints.ts`" hiện chỉ áp cho `components/` và `features/`.
- **Thao tác chờ duyệt không persist** — 6 cơ chế staged đều trong `Map` RAM,
  không có API liệt kê. Cần `StagedOpRegistry` + persist trước khi `/changes` có
  thể hứa một hàng chờ thật.
- **"Revision" mang 4 nghĩa không so sánh được với nhau** (CadWeb integer ·
  document instance · content-hash hồ sơ/catalog · `manifestRevision`). Phải đặt
  4 nhãn khác nhau trong UI trước khi viết thêm màn hình.
- **`copyfloor` và `tagmeta`** trong `functions.ts` khai `liveRecipe` nhưng không
  có trong 15 recipe headless — chưa đối chiếu với `/api/acad/live`. Nếu không
  có handler thì đó là 2 nút luôn báo lỗi.
- **Không có lint/format.** Ba ranh giới thư mục kiểm bằng script riêng.
- **Chat vẫn thiếu test cho luồng gửi/nhận.** Đã có 7 test cho việc sửa message
  theo ID và 8 test cho bus sự kiện, nhưng `send()` và luồng stream SSE của
  agent thì chưa. Viết khi chat được migrate sang `/assistant` (giai đoạn 9).

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

  **ĐÃ XOÁ `DrawingStandardsPanel.tsx` (2.411 dòng) ngày 2026-08-15.** Cả năm
  mục chặn (2.1 · 1.1 · 2.2 · 1.2 · 2.3) đã xong; chủ dự án quyết định xoá và để
  nút **Xoá hồ sơ** làm sau. Nút "✓ Chuẩn hóa" ở màn hình cũ thay bằng hai đường
  dẫn — `/standards/` và `/review/` — vì panel gộp hai việc khác hẳn nhau. Kèm
  theo: 48 lớp CSS legacy chết được dọn (365 → 319 class đơn).

  **CÒN NỢ sau khi xoá:** không còn đường nào **xoá hồ sơ** trên giao diện.
  `DELETE /profiles/:id` vẫn có ở daemon (`drawingStandards.ts`); chỉ thiếu nút.

  Bản rà cũ giữ lại làm lịch sử — kết luận lúc đó (2026-08-12) là *chưa xoá được*: Rà từng chức năng, đối chiếu với `/standards` +
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
  | ~~1~~ | **2.1** Bảng đối tượng đã nhận diện — **XONG 2026-08-12** | `features/standards/RecognizedObjects.tsx`. Bẫy đơn vị đã bịt (daemon gửi bản quy đổi, giao diện hiện `areaUnit` chứ không ghim `m²`). Bản vẽ thật dạy thêm: `area: 0` là *chưa đo được*, không phải diện tích bằng không |
  | ~~2~~ | **1.1** Nhập layer từ bản vẽ — **XONG 2026-08-13** | `features/standards/ImportLayers.tsx`. Đối chiếu ba nhóm, mặc định an toàn. Quy đổi group 370 chia thẳng 100 (không dùng ngưỡng đoán như bộ mẫu) và làm tròn 2 chữ số vì `13/100` là `0.13000000000000003` |
  | ~~3~~ | **2.2** Chọn đối tượng trong AutoCAD — **XONG 2026-08-14** | Cây cầu duy nhất từ danh sách phát hiện sang bản vẽ. `ZOOM` **không** port được: nó không tồn tại ở backend (`select` chỉ `acedSSSetFirst`; `h_view_zoom` chỉ là mã dò năng lực). Giao diện chỉ đường dùng `ZOOM → Object` trong AutoCAD |
  | ~~4~~ | **1.2** Sửa `bounds` bằng hai nhóm ô có nhãn — **XONG 2026-08-15** | Hai nhóm theo tác dụng thật; khoá chết nói ra kèm nút xoá, không tự xoá. Đọc được cả ba cách viết mà engine chấp nhận, ghi thì dọn về một |
  | ~~5~~ | **2.3** Bảng dimension + DIMSPACE — **XONG 2026-08-15** | Đủ 5/5 hành động sửa. Nút chọn DIM chuẩn nằm TRONG bảng, gộp theo trục vì `DIMSPACE` chỉ căn được các DIM cùng trục |

  **Bẫy đơn vị đã bịt khi làm 2.1.** Phản hồi `POST /scan` từng gửi
  `parsed.objects` **thô** — diện tích theo đơn vị bản vẽ, không kèm `areaUnit` —
  trong khi bản lưu phiên dùng `displayObjects()` đã quy đổi. Nay gửi đúng bản đã
  lưu vào phiên. Lưu ý còn giá trị: `areaUnit` **không phải lúc nào cũng `m²`**,
  vì `metersPerUnit()` chỉ nhận INSUNITS 1/2/4/5/6; INSUNITS 0 (không đơn vị,
  thường gặp ở bản vẽ cũ) giữ số thô và mang nhãn `drawing-unit²`.

  **Và một điều chỉ bản vẽ thật dạy được:** `area: 0` nghĩa là *chưa đo được*,
  không phải diện tích bằng không — chương trình LISP trả 0 cho thứ nó không đo
  nổi, và bộ máy gọi đúng đó là `frame-unmeasurable`. Đo được: 8 đối tượng khung
  tên, cả 8 đều `area/width/height = 0`.

  **Bản rà soát trên còn THIẾU — sửa lại 2026-08-12 sau khi đối chiếu
  `KE-HOACH-CHUYEN-DOI-UI.html`.** Tôi rà panel cũ ↔ màn mới, nên mọi yêu cầu
  của kế hoạch mà panel cũ *cũng* không có thì phép so đó mù hoàn toàn. Ba thứ
  lọt lưới, cả ba thuộc giai đoạn 6:

  | # | Kế hoạch đòi | Hiện trạng |
  |---|---|---|
  | ~~6~~ | `features/review/scopes.ts` — bảng tra **6 hằng số** thay cho `scopeMatches()` lọc bằng regex tiếng Việt | **XONG 2026-08-16.** Sáu mã đã đo từ `standardsEngine.ts`: `unit` · `layer` · `dimstyle` · `dim-row` · `frame` · `mapping-required`. Kèm bộ lọc theo nhóm ở `/review` — bảng không có người dùng thì là hằng số chết |
  | ~~7~~ | Nút **Xoá hồ sơ** (`DELETE /profiles/:id`) | **XONG 2026-08-17.** Gửi `If-Match`, xác nhận bằng chế độ `data` mới của `ConfirmSheet` (không nhắc `UNDO`, không dùng `WriteButton` — nút đó khoá theo trạng thái AutoCAD mà hồ sơ thì nằm trên đĩa của app) |
  | ~~—~~ | Bất biến CI **#7**: tập `scope:"…"` trích từ `standardsEngine.ts` = tập hằng số trong `features/review/scopes.ts` | **XONG 2026-08-16.** So hai chiều, cộng một phép chặn ca "regex trích hỏng → so trên tập rỗng thì luôn xanh" |

  Lý do kế hoạch nêu cho việc bỏ regex đáng giữ nguyên văn: *backend đổi một chữ
  là issue biến mất im lặng*. `/review` hiện lọc theo mức độ + từ khoá nên không
  mắc đúng lỗi đó, nhưng cũng chưa có bảng tra.

  Tiêu chí nghiệm thu `grep -c "scopeMatches" = 0` hiện là **4** — tự đạt khi xoá
  panel.

  **Nợ kỹ thuật của 1.1 — ba ca biên, đã xử lý 2026-08-13.** Mục này qua **12 vòng
  Codex review, ~50 phát hiện**, và mọi đường **mất hoặc bịa dữ liệu** đã bịt. Ba
  ca biên còn lại đều đã sửa; cả ba đụng plugin nên **phải khởi động lại AutoCAD**:

  - ~~Bản vẽ **chưa lưu** chỉ định danh được bằng tiêu đề.~~ **Xong.** `findDocExact`
    nhận thêm mã phiên làm đích, `selectOpenDocument` khớp `instance` xen giữa
    đường khớp theo file và theo tiêu đề. `requestTargetOf()` tách khỏi
    `targetOf()` — hai hàm trả lời hai câu khác nhau và gộp lại sẽ hỏng `/review`,
    nơi so đích với `scan.target` mà daemon đặt bằng `file || title`.
    Codex review bắt được một tầng nữa: `GET /drawing-info` dựng lại đích bằng
    `file || title` sau khi đã chọn đúng bản vẽ, nên cả đường vẫn hỏng ở bước kế.
    Nay có `nativeDocumentTarget()`. **Các route khác** (`blockLibraryRouter`,
    `cadSelection`, đường quét/áp của `drawingStandards`) cũng đã nhận mã phiên
    (2026-08-13). Còn lại: `documentGuardLisp()` không phân biệt được hai bản vẽ
    chưa lưu trùng tiêu đề vì nó chỉ có `DWGNAME` — bù lại plugin định tuyến job
    bằng mã phiên, nên tổng thể không yếu đi.
  - ~~Layer **màu thật** không nhập được.~~ **Xong**, và đã kiểm trên AutoCAD
    2027 thật (2026-08-14): 420 ghi đúng, đặt ACI xoá 420, layer đang tắt không
    bị bật lại ở cả hai đường. Hồ sơ nhận `#RRGGBB`, đường áp
    dụng ghi DXF **group 420**. Ba điểm phải đúng cùng lúc: (a) plugin phát thêm
    `colorMethod` vì màu thật ĐEN TUYỀN cũng là `rgb: [0,0,0]` nên không đoán được
    từ `rgb`; (b) đặt màu ACI phải **xoá** 420, vì 420 thắng 62 và sót lại là lệnh
    chạy xong mà màu không đổi; (c) đặt màu thật thì **không đụng** 62 — giữ nguyên
    được cả dấu ÂM của nó, mà dấu âm nghĩa là layer đang TẮT.
  - ~~Bảng layer quá **500 dòng** thì nhóm xoá bị ẩn vĩnh viễn.~~ **XONG
    2026-08-14** — đọc theo trang (`?allLayers=1`), mọi trang phải cùng
    `instance`+`revision`. Ghi chú nâng trần bên dưới giữ lại làm bối cảnh.
    Riêng bảng layer lên **5.000** dòng (`kInfoMaxLayerItems`, tách khỏi
    `kInfoMaxTableItems` dùng chung cho linetype/textstyle/dimstyle) và plugin công
    bố ngưỡng đó trong `limits`. Bản vẽ **quá 5.000 layer vẫn ẩn nhóm xoá** —
    ngưỡng lớn hơn không phải là phân trang. Muốn hết thì plugin phải phát theo
    trang.

  Bài học đắt nhất, ghi lại nguyên văn: tôi dựng một cơ chế **giữ ảnh chụp cho
  tươi** (`instance` + `revision` + sự kiện + dấu thời gian) và tám vòng liên tiếp
  đều tìm ra khe trong chính nó — vì nguyên nhân chung là **có một khoảng thời
  gian giữa lúc đọc và lúc ghi**, không phải thiếu tín hiệu. Bỏ hẳn khoảng đó
  (đọc lại ngay lúc bấm Nhận) mới cắt được cả họ lỗi. Thấy ba vòng liền ra lỗi
  cùng dạng thì đó là dấu hiệu **thiết kế sai**, không phải cần thêm một bản vá.

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

  **`/changes` đã dựng (2026-08-18).** Phần backend cần thêm hoá ra chỉ là một
  đường liệt kê: `GET /api/acad/selection/operations`. Daemon vốn đã giữ thao tác
  đã chuẩn bị trong một `Map` — chỉ là không ai liệt kê được, nên hàng chờ **vô
  hình** với mọi màn hình trừ chính màn vừa tạo ra nó.

  Kèm theo: chip ở thanh trên và huy hiệu ở rail chuyển sang đọc **cùng nguồn**
  với màn hình. Trước đó chúng đọc `features/staged-ops/store.ts` — kho trong
  trình duyệt mà `writeStaged()` có **0 nơi gọi**, tức chip vĩnh viễn bằng 0. Kho
  đó đã xoá, và `test-contract.mjs` chặn nó sống lại.

  **Hai khoảng trống đã biết, ghi ra thay vì để màn hình hứa thừa:**

  | Việc | Vì sao chưa làm trong lượt này |
  |---|---|
  | Gộp **hàng chờ của bộ vẽ** (`/draw/stage`) vào cùng bảng | `drawRouter` giữ một `Map` riêng với vòng đời `stage → apply/reject` khác hẳn. Cần thêm một đường liệt kê nữa và một mô hình gộp hai loại thao tác có hình dạng khác nhau. Màn hình nay **nói rõ** nó chỉ liệt kê thao tác của bộ chọn, thay vì để câu "mọi lệnh ghi dừng ở đây" hứa thừa |
  | `/draw/target` **đánh rơi mã phiên** | Nó lưu `DrawTarget` chỉ gồm `title` + `file`. Hai bản vẽ **chưa lưu trùng tiêu đề** vì thế không đặt đích được: lượt `/draw/stage` sau đó gửi một tiêu đề mơ hồ và `findDocExact` từ chối. Lỗi có sẵn ở `drawRouter`, mọi nơi gọi `/draw/target` đều dính; sửa phải thêm `instance` vào `DrawTarget` và truy hết đường dùng nó |

  **17 vòng Codex review (2026-08-18 → 19).** Phần lớn phát hiện không nằm ở
  màn hình mới mà ở chỗ nó **chạm vào hệ thống cũ**. Nặng nhất: xác nhận một
  lượt đổi bản vẽ gọi `/draw/target`, mà đường đó `discardStagedOps()` — gửi
  lệnh reject vào AutoCAD, tức **xoá hình đã vẽ** ở một hàng chờ màn hình này
  không hề bày ra. Mối nguy ấy đã được ghi ở bảng trên từ đầu; ghi lại một mối
  nguy không phải là xử lý nó, và trong khoảng đó nó vẫn xoá hình thật.

  Ba lỗi cùng một hình dạng, đáng ghi lại vì sẽ còn gặp: **không biết bị quy
  thành cho qua**. Đọc hỏng hàng chờ bộ vẽ → coi như rỗng; không xác nhận được
  bản vẽ hoạt động → vẫn gọi đường xoá; `{ok: true}` thiếu `operations` → dựng
  bảng trống rồi báo "không có gì chờ". Chốt phải hỏi *"có chắc là ĐÚNG không"*,
  không phải *"có chắc là SAI không"*.

  **Còn lại của giai đoạn 7:** `/takeoff` và `/settings`.
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

- **Kích hoạt bản vẽ và đặt đích vẽ chưa nguyên tử.** Daemon giữ HAI đích: bản vẽ
  đang hoạt động của AutoCAD, và đích của `/draw/stage`. `activate-document` chỉ
  đổi cái đầu, nên khách phải gọi thêm `/draw/target` — và hai tab cùng làm việc
  đó sẽ đua nhau. Đã thu hẹp bằng cách kiểm bản vẽ đang hoạt động trước khi đặt
  đích (2026-08-18), nhưng khe giữa lúc đọc và lúc POST vẫn còn.

  Đóng hẳn: gộp hai bước vào một giao dịch phía daemon. Vướng ở chỗ
  `/draw/target` hiện còn **huỷ staged op** và tự giải bản vẽ, nên gọi nó từ
  đường apply của `cadSelection` kéo theo hành vi phụ mà đường đó chưa từng có.


- ~~**Script test đọc/ghi được vào kho dữ liệu thật.**~~ **ĐÓNG 2026-08-18.**

  Đã rà **toàn bộ** `apps/daemon/scripts/`: bảy script chạm tới mã kho, sáu cái
  đã có rào (`dataDir` hoặc `ACAD_DATA_DIR`), cái thứ bảy
  (`test-block-library-cad.mjs`) chỉ import hai hàm **thuần** nên không chạm kho.
  Mục nợ này lúc viết ra là **nói quá** — tôi ghi theo suy đoán chứ không theo đo
  đạc.

  Nhưng lỗ thật thì có, và nay đã bịt: `assertNotRealStoreInTests()` chặn đường
  lùi về kho thật khi tiến trình đang chạy `scripts/test-*.mjs`. Phép kiểm khoá-lạ
  trước đó chỉ bắt ca **gõ nhầm tên**; ca **quên truyền hoàn toàn** — dễ xảy ra
  hơn, và đúng là ca đã xoá mất dữ liệu — giờ mới bị chặn.

  Khoá bằng `test-store-isolation.mjs` (nằm trong `pnpm verify`), kiểm cả hai
  chiều: script test bị chặn, mà đường chạy thật thì không.


- **Không có công cụ bắt lỗi danh sách phụ thuộc của hook.** Hai lỗi cùng dạng đã
  lọt tới vòng review — `cancelPick` đọc `pickBusy` cũ, `applyPicked` gửi DIM
  chuẩn cũ — cả hai trên đường ghi không hoàn tác được. `react-hooks/exhaustive-deps`
  bắt chính xác loại này, nhưng dự án chưa cài eslint và việc thêm một linter là
  quyết định của chủ dự án, không phải của một lượt sửa review. Chốt tạm thời:
  không bọc `useCallback` cho hàm gửi lệnh ghi (không component nào dùng `memo`,
  nên nó không giữ được gì).


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
- ~~**Nghi vấn ở `buildCreateBlockLisp` — `entlast` có thể trỏ nhầm.**~~ **ĐÓNG
  2026-08-19 — đã ĐO trên AutoCAD thật; nghi vấn SAI, nhưng đã chốt lại.**

  Đo bằng AcCoreConsole 2027 trên bản vẽ nháp: `-BLOCK` **đổi** phần đã chọn
  thành một thể hiện của block vừa tạo, nên `entlast` ra đúng `INSERT` mang đúng
  tên block, và đối tượng khác **không** bị đụng. Tiền đề của mục nợ ("`-BLOCK`
  không chèn thể hiện nào") sai — và đó cũng là suy luận tôi tự dựng lại trước
  khi đo, rồi bị chính phép đo bác.

  Nhưng mã đúng nhờ một điều kiện **ngầm**: không có gì thêm đối tượng vào bản vẽ
  giữa `-BLOCK` và `entlast`. Chèn một bước vào quãng đó là `CHPROP` lặng lẽ đổi
  layer của một hình không liên quan — hỏng kiểu không ai biết mà sửa. Nên nay
  kiểm thẳng thứ vừa nhặt: đúng loại `INSERT` **và** đúng tên block thì mới đổi,
  sai thì bỏ qua. Đã đo cả ca chèn ngang: chốt báo "BỎ QUA" và hình kia còn
  nguyên layer cũ.

  Bản vẽ nháp dùng để đo: `$CLAUDE_JOB_DIR/tmp/blocktest/` (không commit).
- **Job LISP lỗi giữa chừng làm kẹt `activeJob` 2 phút.** `acad:write-result`
  không chạy thì daemon giữ `state:"sent"` tới khi `JOB_BUSY_MS` hết hạn, và mọi
  lệnh ghi bị chặn trong quãng đó. Tự khỏi nên không nghiêm trọng.

  **Phần thông điệp đã sửa (2026-08-19).** Nhãn cũ "AutoCAD đang bận" là một
  **chẩn đoán daemon không làm được**: job đang chạy thật và job đã chết giữa
  chừng cho ra cùng một trạng thái, mà ở ca thứ hai thì AutoCAD đang rảnh — người
  dùng đọc câu đó rồi đi tìm nhầm chỗ. Nay nói đúng thứ daemon biết ("Đang chờ
  AutoCAD trả kết quả"), kèm `busyUntil` để nói được "tự hết sau N giây": khác
  biệt giữa "app hỏng rồi" và "chờ thêm chút nữa".

  **Cũng đã đo và KHÔNG làm:** đồng hồ đếm ngược chỉ có ở đường `/live` và
  `/job`. `/plot-pdf` không khai hạn vì `invokeRaw()` có hàng đợi riêng — lượt
  chờ ở đó phụ thuộc job xếp trước nên không có cận trên nào đúng.

  **Còn lại:** chính cái kẹt 2 phút. Không tự dọn được vì daemon không phân biệt
  nổi hai ca, mà cho người dùng gỡ khoá bằng tay thì mở đường cho hai lệnh ghi
  chạy song song — nguy hiểm hơn hẳn việc chờ. Cần plugin báo được "job này đã
  kết thúc" (kể cả khi hỏng) thì mới đóng được.
- **`globals.css` 3.500 dòng, 1.119 hex literal.** Xoá ở giai đoạn 10.
- **32 đường dẫn API rải rác trong `app/page.tsx`.** Ranh giới "endpoint chỉ khai
  ở `lib/daemon/endpoints.ts`" hiện chỉ áp cho `components/` và `features/`.
- **Thao tác chờ duyệt không persist** — 6 cơ chế staged đều trong `Map` RAM,
  không có API liệt kê. Cần `StagedOpRegistry` + persist trước khi `/changes` có
  thể hứa một hàng chờ thật.
- ~~**"Revision" mang 4 nghĩa không so sánh được với nhau.**~~ **ĐÓNG
  2026-08-19.** Bốn nghĩa đã xác minh trong code, không lấy từ trí nhớ:

  | Loại | Kiểu | Nguồn | Trả lời được câu gì |
  |---|---|---|---|
  | `document` | số | `AcadDocument.revision` | dữ liệu đọc lúc trước còn dùng được không (chỉ có nghĩa khi kèm `instance`). **Không** đếm số lần sửa — thao tác chỉ-đọc như `ssget "_X"` cũng làm nó nhảy |
  | `content` | chuỗi | `calculateProfileRevision()` | nội dung hồ sơ có đổi không — **không** nói được cái nào mới hơn |
  | `manifest` | chuỗi | `lispLibrary.revisionFor()` | băm nội dung tài nguyên LISP **kể cả phụ thuộc** — đổi một phụ thuộc là mã đổi dù tài nguyên không sửa dòng nào |
  | `cadweb` | số | `CadWebRevisionState` | MÔ HÌNH đang ở bản nào (tiến theo delta/epoch) — **không** phải phiên bản định dạng tệp, cái đó là `manifest.formatVersion` |

  Từ vựng ở `lib/revisionKinds.ts` (cùng hình dạng với `lib/acadState.ts`: tên
  tách khỏi cách đọc). **Bất biến #9** cấm nhãn trần "Revision" trong
  `app/(shell)` — chỉ soi màn hình mới, vì màn cũ và hai panel dựng thử còn dùng
  chữ đó theo nghĩa thứ năm (revision bản vẽ P01/P02) và sẽ bị xoá ở giai đoạn
  9-10; áp luật lên chúng là ép sửa thứ sắp vứt.

  **Ba** nhãn tôi đặt SAI, review bắt được — bảng sinh ra để chống lẫn lộn thì
  chính nó lẫn trước: gọi `manifest` là "Phiên bản thư
  viện" (nghe như có thứ tự, trong khi nó là băm) và gọi `cadweb` là "Bản dựng
  .cadweb" (sai đối tượng — nó đếm mô hình, không phải tệp), và gọi `document` là
  "Bản sửa của bản vẽ" (AutoCAD đẩy bộ đếm đó lên cả khi chỉ-đọc, nên nhãn ấy làm
  màn hình báo một lượt sửa chưa từng xảy ra). Thêm
  `revisionOrdering()` cho chỗ nào định sắp xếp hay so `>`. Ba mức: `none` (hai
  loại băm) · `within-instance` (bộ đếm bản vẽ) · `within-drawing-epoch` (bản mô
  hình CadWeb). **Không có mức toàn cục** — cả hai loại có thứ tự đều kèm điều
  kiện, và mỗi lần tôi bỏ điều kiện đi là một vòng review bắt lại.

  Kèm `revisionText()`: `0` là bộ đếm THẬT (bản vẽ vừa mở, chưa sửa gì), không
  phải "chưa biết" — quy nó về `—` là nói sai theo chiều ngược lại.
- ~~**`copyfloor` và `tagmeta` có thể là 2 nút luôn báo lỗi.**~~ **ĐÓNG
  2026-08-19 — mục nợ này SAI.**

  Cả hai đều có `case` trong `opLisp()`, và `recipeBody()` (đường headless) gọi
  chung đúng hàm đó — nên không có chuyện "có live mà thiếu headless". Đối chiếu
  cả ba mục khai `live: true` (`copyfloor`, `tagmeta`, `livedraw`): đủ handler.
  Mục nợ viết theo suy đoán chứ không theo đo đạc, giống hệt mục "script test
  đọc/ghi kho thật" phía trên.

  Nguy cơ nó chỉ tới thì có thật, nên thay suy đoán bằng **bất biến #8** trong
  `test-contract.mjs`: mọi mục `live: true` phải có `case` tương ứng trong
  `opLisp()`, nếu không `/live` trả 400 và nút đó hỏng **mọi lần bấm**. Kiểm
  bằng đột biến hai chiều (gõ nhầm tên ở web · đổi tên case ở daemon).

  Ba cái bẫy khi tự đo, đã trả giá đủ cả ba và ghi lại trong chính phép kiểm:
  bóc chú thích trước khi khớp (dòng khai kiểu có chữ `"drawpipes"` trong
  comment); so **nhãn `case`** chứ đừng GỌI `opLisp` (gọi với tham số đoán bừa
  thì "không có handler" và "thiếu tham số" ra cùng một `null`); và nhớ giá trị
  **mặc định** `"drawpipes"` khi thiếu `liveRecipe`.
- ~~**Script test mang đường dẫn tuyệt đối của một máy cụ thể.**~~ **Xong
  2026-08-14** — chín file (không phải bảy), nay dùng `mkdtempSync(tmpdir())`.
- **Lượt quét không ghi KHÔNG GIAN của từng đối tượng.** `acadstd:scan` dùng
  `ssget "_X"` (mọi không gian) nhưng dòng kết quả không có group 410, trong khi
  lệnh chọn chỉ chọn được đối tượng thuộc không gian hiện hành. Hệ quả: một phát
  hiện thuộc layout khác bấm "Chọn trong AutoCAD" sẽ bị từ chối. Hiện giao diện
  nói rõ giới hạn và hiện không gian lúc quét; sửa đủ cần LISP ghi thêm cột, rồi
  parser → model → giao diện đọc nó (bốn tầng).
- ~~**Thao tác chọn không bị huỷ khi rời trang.**~~ **ĐÓNG 2026-08-19 — không
  sửa, vì cách sửa đã đề ra nay là SAI.**

  Mục này viết khi hàng chờ còn vô hình, nên "nằm lại tới hết TTL" đồng nghĩa với
  rác không ai thấy. `/changes` (2026-08-18) đổi hẳn tiền đề: một thao tác đã
  chuẩn bị nay **hiện ra và bỏ được** từ màn hình đó. Tác hại mục này nêu —
  "hiện ra ở màn Thay đổi như một lệnh treo" — chính là thứ màn đó sinh ra để
  làm.

  Thêm nữa, tự huỷ lúc unmount sẽ **phá** đúng luồng vừa dựng: chuẩn bị ở
  `/review` rồi sang `/changes` xác nhận là đường đi hợp lệ, và huỷ ngầm lúc rời
  trang là xoá thứ người dùng đang đi tới để xác nhận — một hành động phá huỷ
  không hỏi ai.

  `/review` vẫn huỷ ở ba ca nó THỰC SỰ biết là thừa: lượt quét đổi giữa chừng,
  người dùng bấm Bỏ, và kết quả về sau khi lượt quét đã đổi. Đó là những ca mã
  chắc chắn; rời trang thì không.
- **Không có lint/format.** Ba ranh giới thư mục kiểm bằng script riêng.
- **Chat vẫn thiếu test cho luồng gửi/nhận.** Đã có 7 test cho việc sửa message
  theo ID và 8 test cho bus sự kiện, nhưng `send()` và luồng stream SSE của
  agent thì chưa. Viết khi chat được migrate sang `/assistant` (giai đoạn 9).

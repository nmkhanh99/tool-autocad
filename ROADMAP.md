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

## In Progress

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

---

## Quyết định đã chốt

| # | Quyết định | Chốt ngày | Hệ quả |
|---|-----------|-----------|--------|
| **D1** | Giao diện **theo mẫu (sáng) + khối dark** tôn trọng `prefers-color-scheme` | 2026-08-09 | Copy `app.css` nguyên văn ở GĐ1; thêm ~20 dòng khối dark ở GĐ10 bằng cách đảo vai trò 7 literal |
| **D6** | **Thêm `dbmod`** vào `writeDocs()` của plugin ObjectARX | 2026-08-09 | ~5 dòng C++ (`objectarx/mepbridge.cpp`) + `dbmod?: number` vào `OpenAcadDocument`; phải build lại plugin. Giữ chấm saved trên doctab, hộp thoại khởi động lại liệt kê đúng, giữ cột "Lưu" ở Tổng quan |
| **D2** | **Giữ** 2 panel prototype — bê nguyên vào route + banner "bản dựng thử" | 2026-08-10 | Tạo `/preconstruction` và `/review-pdf` ở GĐ10. **Không refactor** — refactor làm chúng trông đã hoàn thiện. Banner cấp route, không tắt được. Giữ luôn 1.745 dòng CSS |
| **D3** | **Build** 3 endpoint enumerate + `onConflict` cho `/publish` | 2026-08-10 | `/plot/devices`, `/plot/style-sheets`, `/plot/page-setups`, `/layouts`; thêm `onConflict: "fail"\|"overwrite"\|"suffix"` vào whitelist. ~3–5 ngày backend. **Vẫn phải cắt** dpi / tỉ lệ ngoài `fit\|1:1` / vùng in "Cửa sổ" — giới hạn kênh plot macOS, không phải thiếu route |
| **D4** | **Build cả (b) và (c)** cho `/batch` | 2026-08-10 | (b) `/files`, `recursive`, `/mep/recipes`, job model + SSE + cancel — ~5–8 ngày. (c) cầu nối Python `/api/acad/offline/*` — ~3–5 ngày. (c) là lối thoát duy nhất khi máy chưa cài AutoCAD |
| **D5** | **Dựng** sync server nhận `.cadweb` | 2026-08-10 | ~10–15 ngày + phần Windows chưa rõ. Cần process + 5 implementation (`Authenticator`, `Authorizer`, `ImmutableBlobStore`, `RevisionMetadataStore`, `RevisionEventPublisher`). Mở khoá `.revstrip` ở `/workspace` và bảng snapshot per-drawing ở `/cadweb` |

**Không còn quyết định nào đang chặn.** Tổng backend phát sinh từ D3+D4+D5:
khoảng **21–33 ngày công**, tính riêng ngoài 95–140 ngày front-end.

---

## Next

### Giai đoạn 2B — Chat sang id-based

Tách khỏi 2A để có thể trượt mà không chặn giai đoạn 3. Làm **khi chat còn đứng
yên trong `page.tsx`** — không bao giờ cùng PR với việc di chuyển nó.

- Trước tiên: viết 5–8 test cho `decide` / `decideLispProposal` / `patchLast`.
  Hiện **không có test nào** phủ chat; đổi ~68 điểm gọi không lưới an toàn là
  đánh bạc.
- Gán `id` cho mọi message do handler tạo qua một factory duy nhất; đổi ba
  handler sang `patchMessage(id, …)`; `key={m.id}` không fallback index.

Nghiệm thu: `patchLast(` = 0 · `messagesRef.current[` = 0 · contract test khoá
việc mọi message `role:"function"|"preview"` đều có `id`.

---

## Later

- **Giai đoạn 3** — shell dùng chung (titlebar/rail/statusbar/palette ⌘K);
  `Button` primitive có `disabled` thật. Kèm việc backend theo **D6**: thêm
  `dbmod` vào `writeDocs()` (`objectarx/mepbridge.cpp`, đọc `DBMOD` cho từng
  document trong iterator như đoạn đã có ở snapshot `/drawing-info`) và
  `dbmod?: number` vào `OpenAcadDocument` (`apps/daemon/src/acadBridge.ts`).
  Contract test đi kèm: nếu UI render "chưa lưu"/"đã lưu" từ `useDocs()` thì
  `/docs` phải trả `dbmod`.
- **Giai đoạn 4** — `/library/blocks`, `/library/lisp`. Không còn bị D2 chặn.
- **Giai đoạn 5** — `/workspace`: hit-test entity trên canvas WebGL2 là code
  mới hoàn toàn, không tái sử dụng được gì.
- **Giai đoạn 6** — `/drawing-info`, tách `/review` và `/standards`.
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

## Technical Debt

- **21% web app là prototype không backend.** `PreconstructionPanel` (1.089 dòng
  TSX + 1.118 dòng CSS, **0** lời gọi API) và `DocumentReviewPanel` (1.348 dòng,
  **1** lời gọi, chỉ đọc `INSUNITS`; mọi số đo là hằng số). Theo **D2** thì giữ
  và gắn banner "bản dựng thử" cấp route, không tắt được. Điều kiện thoát: chỉ
  gỡ banner khi có endpoint thật. **Không refactor** — refactor làm chúng trông
  đã hoàn thiện, đúng thứ nguy hiểm nhất: người dùng tin vào con số bịa.
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
- **Chat không có test nào.** (Bus sự kiện đã có 8 test từ 10.08.) Cần 5–8 test trước khi đổi ~68 điểm gọi ở giai
  đoạn 2B.

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

**Phần 3 còn lại:**

- `ConfirmSheet.tsx` dùng chung, có checkbox ack và banner "không hoàn tác".
  Hiện mỗi màn hình vẫn tự dựng phần xác nhận của mình.
- `features/acad-connection/events.ts` — event bus bằng ref, thay cho 6 lần
  `setState` mỗi sự kiện SSE.
- `useDocs()` nguồn duy nhất; xoá 3 `refreshToken`, **giữ** `refreshEventAt`.
  Ngoại lệ phải viết ra: `DrawingInfoPanel` lấy `documents` từ payload
  `/drawing-info` vì cần cùng revision với snapshot — panel này **không** dùng
  `useDocs()`.

---

## Quyết định đã chốt

| # | Quyết định | Chốt ngày | Hệ quả |
|---|-----------|-----------|--------|
| **D1** | Giao diện **theo mẫu (sáng) + khối dark** tôn trọng `prefers-color-scheme` | 2026-08-09 | Copy `app.css` nguyên văn ở GĐ1; thêm ~20 dòng khối dark ở GĐ10 bằng cách đảo vai trò 7 literal |
| **D6** | **Thêm `dbmod`** vào `writeDocs()` của plugin ObjectARX | 2026-08-09 | ~5 dòng C++ (`objectarx/mepbridge.cpp`) + `dbmod?: number` vào `OpenAcadDocument`; phải build lại plugin. Giữ chấm saved trên doctab, hộp thoại khởi động lại liệt kê đúng, giữ cột "Lưu" ở Tổng quan |

Còn chờ: **D2** (2 panel prototype — chặn GĐ4) · **D3/D4/D5** (chặn GĐ8).

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

- **Giai đoạn 2A** — gộp 3 bản sao luồng `prepare→apply` về một; sinh bảng mã
  guard tự động từ daemon (33+ mã, không chép tay).
- **Giai đoạn 2B** — chat sang id-based; viết test cho handler trước khi đổi.
- **Giai đoạn 3** — shell dùng chung (titlebar/rail/statusbar/palette ⌘K);
  `Button` primitive có `disabled` thật. Kèm việc backend theo **D6**: thêm
  `dbmod` vào `writeDocs()` (`objectarx/mepbridge.cpp`, đọc `DBMOD` cho từng
  document trong iterator như đoạn đã có ở snapshot `/drawing-info`) và
  `dbmod?: number` vào `OpenAcadDocument` (`apps/daemon/src/acadBridge.ts`).
  Contract test đi kèm: nếu UI render "chưa lưu"/"đã lưu" từ `useDocs()` thì
  `/docs` phải trả `dbmod`.
- **Giai đoạn 4** — `/library/blocks`, `/library/lisp`.
- **Giai đoạn 5** — `/workspace`: hit-test entity trên canvas WebGL2 là code
  mới hoàn toàn, không tái sử dụng được gì.
- **Giai đoạn 6** — `/drawing-info`, tách `/review` và `/standards`.
- **Giai đoạn 7** — `/changes` (trục xoay), `/takeoff`, `/settings`.
- **Giai đoạn 8** — `/publish`, `/batch`, `/cadweb`, `/` Tổng quan. **Chưa có
  phạm vi** cho tới khi chốt D3/D4/D5.
- **Giai đoạn 9** — `/assistant`, xoá route legacy.
- **Giai đoạn 10** — xoá `globals.css`, hoàn tất token.
- **Dựng máy chủ nhận `.cadweb`** — `createSyncHttpHandler` hiện chỉ được gọi
  trong test. Điều kiện để mở khoá `.revstrip` ở `/workspace`.

---

## Technical Debt

- **21% web app là prototype không backend.** `PreconstructionPanel` (1.089 dòng
  TSX + 1.118 dòng CSS, **0** lời gọi API) và `DocumentReviewPanel` (1.348 dòng,
  **1** lời gọi, chỉ đọc `INSUNITS`; mọi số đo là hằng số). Chặn bởi quyết định
  **D2**. Điều kiện thoát: chỉ gỡ nhãn "bản dựng thử" khi có endpoint thật.
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
- **Chat không có test nào.** Cần 5–8 test trước khi đổi ~68 điểm gọi ở giai
  đoạn 2B.

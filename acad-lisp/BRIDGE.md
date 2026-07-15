# Cầu nối: App ngoài ⇄ AutoCAD (kiến trúc Hybrid)

App ngoài đẹp (web/Tauri) lo **thư viện block, BOM, form khung tên, batch**. AutoCAD lo **vẽ**. Hai bên nói chuyện qua **file** trong `~/MEP-Bridge/` — không cần API riêng của Windows nên chạy cả **Mac & Win**.

```
App ngoài (UI đẹp)                         AutoCAD (bản vẽ đang mở)
─────────────────                          ────────────────────────
Người dùng chọn lệnh
   │ POST /api/bridge/job
   ▼
Ghi  ~/MEP-Bridge/mep_job.lsp   ───────►   Gõ  MEP-RUN
     ~/MEP-Bridge/params.json              → load job → vẽ/chú thích/layer
```

## Vì sao có bước "gõ MEP-RUN" (không tự động trên Mac)
AutoCAD **for Mac** không có COM / `accoreconsole` / switch `/b` → **app không thể tự bơm lệnh vào bản vẽ đang mở**. Nên app chỉ *ghi file job*, còn người dùng *bấm `MEP-RUN`* một phát để nạp.
**Windows**: có thể nâng cấp để app tự gọi (COM `SendCommand` hoặc `accoreconsole` cho batch) — tùy chọn sau, không bắt buộc.

## Hợp đồng dữ liệu (`params.json` / action)
| op | Tham số | Sinh ra AutoLISP | Ghi chú |
|----|---------|------------------|---------|
| `init` | — | `(c:MEP-INIT)` | tạo bộ layer chuẩn |
| `pipe` | `sys`, `dn` | `(mep-pipe "Rua" 90)` | `sys` ∈ `Xi/Rua/Hoi/Cap`; vẽ MLINE scale=DN, rồi click các điểm |
| `fit` | `type`, `mat`, `dn` | `(mep-fit "Chech" "Upvc" 90)` | chỉ chú thích text; `type` ∈ `Cut/Chech/Te/Tedeu/Y/Ydeu/Con/Sip`; `mat` ∈ `Upvc/Ppr` |
| `sym` | `type`, `mat`, `dn` | `(mep-sym "Chech" "Upvc" 90)` | **F2**: vẽ symbol sơ đồ (theo DN) + chú thích BOM; click 1 điểm đặt |
| `layerfix` | — | `(mep-layerfix)` | **F4**: tạo bộ layer chuẩn + `-PURGE All` + `AUDIT` (bản vẽ đang mở) |
| `pdf` | — | `(mep-pdf)` | **F4**: xuất layout hiện tại ra PDF vào `~/MEP-Bridge/` (tên thiết bị có thể khác Mac/Win) |
| `khbv` | — | `(c:MEP-KHBV)` | hỏi hệ thống + tầng, sinh ký hiệu `ME-…` |
| `title` | `fields{}` | `(mep-title (list (cons "KHBV" "…") …))` | điền khung tên bản vẽ **đang mở**; field→TAG map ở `bridge.TITLE_TAGS`; trường rỗng bị bỏ qua |

Các giá trị hợp lệ **khớp đúng** `*MEP-HETHONG*` / `*MEP-PHUKIEN*` trong `mep.lsp`; phía app validate ở `engine/bridge.py` (sai 1 action → không ghi file nào, trả lỗi 400).

### Ví dụ `params.json`
```json
{ "actions": [
  { "op": "init" },
  { "op": "pipe", "sys": "Rua", "dn": 90 },
  { "op": "fit",  "type": "Chech", "mat": "Upvc", "dn": 90 }
] }
```
→ sinh `mep_job.lsp`:
```lisp
(c:MEP-INIT)
(mep-pipe "Rua" 90)
(mep-fit "Chech" "Upvc" 90)
(princ)
```

## Quy trình dùng
1. Trong AutoCAD: nạp `mep.lsp` (APPLOAD / Startup Suite) — **một lần**.
2. App ngoài: chọn việc → bấm gửi (POST `/api/bridge/job`). App ghi `~/MEP-Bridge/mep_job.lsp`.
3. Sang AutoCAD: gõ **`MEP-RUN`** → job chạy vào bản vẽ đang mở.
   - Với ống: sau khi chạy, AutoCAD vào lệnh MLINE → **click các điểm**, Enter để xong.
4. Vẽ xong → quay lại app, BOM bóc khối lượng đọc ngay (vòng khép kín).

## Liên quan
- Phía AutoCAD: `acad-lisp/mep.lsp` — lệnh `MEP-RUN`, hàm `mep:bridgedir`.
- Phía app: `mep-tool/engine/bridge.py` — `write_job()`, route `POST /api/bridge/job`, `GET /api/bridge/info`.
- UI nút bấm trong CAD (không cần app): `acad-lisp/README.md` (gõ `MEP`).

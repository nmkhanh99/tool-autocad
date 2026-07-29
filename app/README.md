# acadtool — Offline core (AutoCAD Toolkit)

Cột **A** trong toolkit 3 cột (Offline · ACAD Control · ObjectARX).  
Chạy **offline** — không cần AutoCAD mở — để inventory / takeoff / title.  
Sửa bản vẽ “thật” trong/gần CAD = cột B (AcCoreConsole) hoặc C (AcadBridge), không thay bằng offline-only.

MEP/plumbing BOM là **profile sample**, không phải product identity.

## Trạng thái (MVP)

| Tính năng | Lệnh | Trạng thái |
|---|---|---|
| #2 Bóc BOM (phụ kiện + chiều dài ống) → Excel | `bom` | ✅ Chạy được |
| #1 Soát khung tên + sinh mã KHBV | `title` | ✅ Đọc/soát |
| #1 Ghi/sửa khung tên (sinh AutoLISP) | `titlefix` | ✅ Sinh .lsp; cần chạy thử trong AutoCAD 2027 |
| #3 Chuẩn hoá layer (đề xuất mapping → Excel) | `layers` | ✅ Phân tích/đề xuất; áp đổi tên qua AutoCAD |
| #5 Tích hợp Gemini AI (Phân tích, Hỏi đáp, Sinh AutoLISP) | `gemini` | ✅ Sẵn sàng (`analyze`, `ask`, `lisp`) |
| #4 Batch PDF + sheet index | — | ⏳ Chưa triển khai |

## Kiến trúc

```
.dwg ──(dwgjson.py: LibreDWG `dwgread -O JSON`, có cache)──► model.py
                                      Drawing { layers, inserts+attribs, texts, pipes }
        ├─► bom.py + excel.py      → BOM.xlsx
        ├─► titleblock.py          → soát mã KHBV, trường khung tên
        └─► gemini.py              → Phân tích AI, Q&A bản vẽ, sinh AutoLISP
```

`model.read_drawing()` dùng **LibreDWG** làm backend duy nhất. Với file LibreDWG
không giải mã được, CLI báo lỗi cho file đó và tiếp tục xử lý các file còn lại.
Phần ghi bản vẽ dùng AutoLISP/AcadBridge trong AutoCAD, không round-trip qua DXF.

## Cài đặt

```bash
pip3 install -r requirements.txt

brew install libredwg

# Cấu hình Gemini API Key (cho tính năng gemini):
export GEMINI_API_KEY="AIzaSy..."
```

## Dùng

```bash
cd app
# Bóc BOM cả thư mục bản vẽ ra Excel
python3 cli.py bom "../As-built drawing" -o BOM.xlsx

# Soát khung tên + mã hiệu KHBV của cả bộ
python3 cli.py title "../As-built drawing"

# Đề xuất chuẩn hoá layer (xuất bảng mapping để bạn duyệt/sửa)
python3 cli.py layers "../As-built drawing" -o LayerMap.xlsx

# Sinh AutoLISP sửa khung tên (sửa mã KHBV sai + điền trường chung)
python3 cli.py titlefix "../As-built drawing" -o MEPFIX.lsp --set "DD/MM/YYYY=22/06/2026"
# rồi trong AutoCAD 2027: APPLOAD MEPFIX.lsp -> mở từng bản vẽ -> gõ MEPFIX

# --- TÍCH HỢP GEMINI AI ---
# Phân tích bản vẽ với Gemini AI
python3 cli.py gemini analyze "../As-built drawing/T1-DEMO-VE-THAT.dwg"

# Hỏi đáp thông tin bản vẽ với Gemini AI
python3 cli.py gemini ask "File này có những loại block nào chính?" "../As-built drawing/T1-DEMO-VE-THAT.dwg"

# Sinh mã AutoLISP bằng Gemini AI theo yêu cầu
python3 cli.py gemini lisp "Viết lệnh C:DRAW_CIRCLES vẽ 5 đường tròn đồng tâm tại (0,0)" -o draw_circles.lsp

# Xem nhanh 1 bản vẽ
python3 cli.py info "../As-built drawing/<file>.dwg"
```

## Quy luật đang dùng (rút từ bản vẽ mẫu — cần bạn xác nhận)

- **Mã KHBV** = `ME-[hệ]-T[tầng]`: hệ CN=cấp nước, TN=thoát nước, TH=thông hơi;
  tầng = nhóm "tang N" đầu tiên trong tên file (lấy số cuối nếu là danh sách
  `5, 6, 7`). Sửa bảng `_SYSTEMS` trong `titleblock.py` nếu công ty dùng mã khác.
- **Phân loại phụ kiện**: theo tên block (`Co125`, `PPR-RED 40-25`, `ELB 90-20`,
  `Stop Globe Valve-25`...). Luật ở `_RULES` trong `bom.py`. Block không khớp vào
  nhóm "Chưa phân loại" để bạn rà (không bị bỏ im lặng).
- **Layer hệ MEP** (để tính mét ống) nhận theo tiền tố `P-`, `DCCD`, `N-T`...
  (`_MEP_LAYER` trong `bom.py`).

## Việc cần làm tiếp

1. Bổ sung kiểm thử cho các biến thể JSON LibreDWG từ nhiều phiên bản DWG.
2. Hoàn thiện ghi layer/khung tên và xuất PDF qua AutoCAD/AcadBridge.
3. Xác nhận quy ước mã KHBV và bộ layer chuẩn của công ty.
4. `bnn2` (xuất hiện 26 lần) là thiết bị gì? — để phân loại đúng trong BOM.

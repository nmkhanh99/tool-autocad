# acadtool — Công cụ MEP as-built (offline, Mac)

Công cụ hỗ trợ làm bản vẽ hoàn công cơ điện (MEP). Chạy **offline trên Mac**,
không cần mở AutoCAD cho các tác vụ đọc/bóc tách. Phần đặt linh kiện live trong
AutoCAD (ObjectARX) sẽ làm ở giai đoạn sau.

## Trạng thái (MVP)

| Tính năng | Lệnh | Trạng thái |
|---|---|---|
| #2 Bóc BOM (phụ kiện + chiều dài ống) → Excel | `bom` | ✅ Chạy được |
| #1 Soát khung tên + sinh mã KHBV | `title` | ✅ Đọc/soát |
| #1 Ghi/sửa khung tên (sinh AutoLISP) | `titlefix` | ✅ Sinh .lsp; cần chạy thử trong AutoCAD 2027 |
| #3 Chuẩn hoá layer (đề xuất mapping → Excel) | `layers` | ✅ Phân tích/đề xuất; ✍️ áp đổi tên: chờ ODA |
| #4 Batch PDF + sheet index | — | ⏳ Cần ODA |

## Kiến trúc

```
.dwg ──(dxfsource.py: ODA File Converter, có cache)──► .dxf ──(ezdxf)──┐
        │  backend ĐỌC CHÍNH (sạch, không mojibake, đọc được cả file    │
        │  LibreDWG parse hỏng)                                          ▼
        └──(fallback: dwgjson.py dwgread -O JSON khi CHƯA cài ODA)──► model.py
                                          Drawing { layers, inserts+attribs, texts, pipes }
        ├─► bom.py + excel.py      → BOM.xlsx
        └─► titleblock.py          → soát mã KHBV, trường khung tên
```

`model.read_drawing()` tự chọn backend: **có ODA → ezdxf** (`read_drawing_dxf`),
chưa có → **LibreDWG** (`_read_drawing_libredwg`). LibreDWG đọc được 8/9 file mẫu
nhưng (a) hỏng JSON ở 1 file, (b) không ghi tin cậy, (c) text Việt mojibake một
phần — nên ODA + ezdxf là đường chuẩn cho production (đọc/ghi/PDF).

## Cài đặt

```bash
pip3 install -r requirements.txt

# Backend đọc chính — ODA File Converter (miễn phí, bản macOS):
#   Tải tại https://www.opendesign.com/guestfiles/oda_file_converter
#   Cài vào /Applications; app tự dò binary (hoặc đặt ODA_FILE_CONVERTER=<path>).

brew install libredwg          # tuỳ chọn: fallback khi chưa cài ODA
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

1. **Cài ODA File Converter** (miễn phí, bản Mac) để kích hoạt backend ezdxf:
   đọc được file thứ 9 + hết mojibake tiếng Việt. Đường ĐỌC qua ODA đã hiện thực
   (`dxfsource.py` + `model.read_drawing_dxf`); chỉ cần cài là tự dùng.
2. Ghi DWG qua ezdxf→ODA (điền khung tên #1, đổi layer #3) và xuất PDF #4.
3. Xác nhận quy ước mã KHBV và bộ layer chuẩn của công ty.
4. `bnn2` (xuất hiện 26 lần) là thiết bị gì? — để phân loại đúng trong BOM.

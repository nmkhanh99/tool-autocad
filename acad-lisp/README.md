# MEP CAD Companion — Bộ lệnh hỗ trợ vẽ trong AutoCAD

Phần **hỗ trợ vẽ trực tiếp trong AutoCAD** (chạy được cả **macOS & Windows** qua AutoLISP — đường duy nhất AutoCAD for Mac mở ra, vì Mac không chạy plugin .NET).

> Vẽ ra **đúng chuẩn** đã phân tích từ bản vẽ thật của công ty → và **ăn khớp với web BOM**: ống là MLINE `scale=DN` trên layer `P-*`, phụ kiện chú thích `"Loại, Vật liệu, DNxx"`. Vẽ bằng tool ⇒ web bóc khối lượng đọc được ngay.

## 👉 Có GIAO DIỆN nút bấm — gõ `MEP`
Lệnh **`MEP`** mở **hộp thoại (dialog) có nút bấm thật** ngay trong AutoCAD — chọn hệ thống, nhập DN, bấm **Vẽ ống / Phụ kiện / Layer chuẩn / Ký hiệu BV**. Không phải gõ lệnh nữa.
> AutoCAD for Mac **có** DCL từ bản 2021 (bạn đang dùng 2026) nên dialog chạy được cả **Mac & Windows**. Tự sinh file `.dcl` ra thư mục tạm — chỉ cần nạp 1 file `mep.lsp`.

Muốn thêm **nút trên thanh công cụ** (bấm 1 phát mở UI, hoặc nút một-chạm vẽ ngay): xem **[TOOLPALETTE.md](TOOLPALETTE.md)**.

## Nạp vào AutoCAD
1. Mở AutoCAD, mở bản vẽ.
2. Gõ lệnh **`APPLOAD`** → chọn `acad-lisp/mep.lsp` → **Load**. (Hoặc kéo-thả file vào cửa sổ bản vẽ.)
3. Gõ **`MEP`** → hiện **bảng nút bấm**. (Gõ `MEP-HELP` để xem danh sách lệnh.)
> Muốn tự nạp mỗi lần mở: thêm `mep.lsp` vào **Startup Suite** trong hộp thoại APPLOAD.

## Các lệnh

| Lệnh | Tác dụng |
|------|----------|
| **`MEP-INIT`** | Tạo bộ layer chuẩn: `P-ThoatXi`, `P-ThoatRua`, `P-ThongHoi`, `DCCD-nuoclanh`, `P-ThietBi`, `MEP-GHICHU` (đúng màu) |
| **`MEP-ONG`** | **Vẽ ống**: chọn hệ thống (X/R/H/C) → nhập DN → vẽ MLINE `scale=DN` trên đúng layer. Click các điểm, Enter để xong |
| **`MEP-PK`** | **Chú thích phụ kiện**: chọn loại (Cút/Chếch/Tê/Y/Côn/Siphong) → vật liệu (uPVC/PPR) → DN → click điểm. Ghi text `"Loại, Vật liệu, DNxx"` đúng format BOM |
| **`MEP-KHBV`** | Sinh ký hiệu bản vẽ `ME-{CN\|TN\|TH}-T{tầng}` (chuẩn hoá, chống lỗi placeholder `CTN-01`) |

## Quy trình khép kín với web tool
```
   AutoCAD (vẽ)                          Máy tính (hậu kỳ)
   ─────────────                         ─────────────────
   MEP-ONG  → ống MLINE scale=DN  ─┐
   MEP-PK   → chú thích phụ kiện   ─┼─►  Web MEP CAD Companion
   MEP-INIT → layer chuẩn          ─┘     (server.py) đọc DWG →
                                          BOM ống + phụ kiện, soát
                                          khung tên/layer, xuất Excel
```
Vì lệnh vẽ tuân đúng chuẩn mà bộ bóc khối lượng mong đợi, **không cần khai báo thủ công** — vẽ tới đâu, BOM cộng tới đó.

## Giao diện: DCL dialog (chạy cả Mac & Windows)
- **Dialog có nút bấm** dùng **DCL** — AutoCAD for Mac **hỗ trợ DCL từ bản 2021** ([Autodesk: DCL Support with AutoLISP](https://help.autodesk.com/cloudhelp/2021/ENU/AutoCAD-MAC-WhatsNew/files/GUID-398836D1-D64F-41F0-9C49-24CCF84C15F1.htm)). File DCL viết cho Windows hầu hết chạy trên Mac, trừ vài thuộc tính tile hiếm.
- Panel-dock kiểu **HTOOLS** mới là **.NET/WPF — chỉ Windows**; ta KHÔNG cần nó vì DCL đã đủ cho UI nút bấm cross-platform.
- Vẫn giữ các lệnh rời (`MEP-ONG`, `MEP-PK`…) cho ai thích gõ; dialog `MEP` chỉ là lớp UI gọi lại đúng các hàm đó.

## Ghi chú
- Đơn vị bản vẽ là **milimet**: DN90 = MLINE scale 90; text cao theo `TEXTSIZE` (mặc định 250).
- Màu/tên layer chỉnh trong biến `*MEP-LAYERS*` đầu file `mep.lsp`; thêm hệ thống/phụ kiện ở `*MEP-HETHONG*`/`*MEP-PHUKIEN*`.
- MVP hỗ trợ vẽ; mở rộng được: chèn block phụ kiện thật (thay text), tự đánh số, tự dim.
- AutoLISP chạy trên AutoCAD full (Mac/Win). **AutoCAD LT không hỗ trợ AutoLISP.**
```

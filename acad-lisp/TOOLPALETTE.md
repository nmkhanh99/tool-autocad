# Nút lệnh MEP và palette block theo nền tảng

AutoCAD trên Windows và macOS không có cùng cơ chế Tool Palettes. Không dùng file XTP
làm dữ liệu gốc của thư viện và không giả định một palette tùy biến trên Windows sẽ hoạt
động nguyên trạng trên Mac.

## Chọn đúng giao diện

| Nhu cầu | Windows | macOS |
|---|---|---|
| Nút chạy lệnh MEP | Tạo Tool Palette bằng `TOOLPALETTES`, hoặc toolbar/menu trong `CUI` | Tạo custom panel trong **Tool Sets** hoặc menu bằng `CUI`; cũng có thể dùng hộp thoại `MEP` có sẵn trong Lisp |
| Duyệt/chèn block | Tool Palettes hoặc Blocks palette (`BLOCKSPALETTE`) | Blocks palette: chạy `CONTENT` hoặc chọn **Window → Blocks** |
| Chia sẻ palette tùy biến | Có thể import/export XTP | Không xem XTP là định dạng palette native; dùng catalog của Acad Studio và DWG nguồn |

Autodesk ghi rõ phần tùy biến Tool Palettes chỉ được hỗ trợ trên Windows. Trên Mac, nếu
một command trong bảng không tồn tại ở bản cài cụ thể, dùng `CUI`/Tool Sets cho nút lệnh và
`CONTENT` cho nội dung block thay vì cố import XTP.

## Bước 1 — Cho Lisp tự nạp

1. Chạy `APPLOAD`.
2. Trong **Startup Suite** chọn **Contents… → Add** rồi thêm `acad-lisp/mep.lsp`.
3. Mở lại AutoCAD và chạy thử `MEP` hoặc `MEP-INIT`.

Nếu nút báo `no function definition`, kiểm tra lại Startup Suite và đường dẫn Support File
Search Path.

## Bước 2A — Nút lệnh trên Windows

1. Chạy `TOOLPALETTES`.
2. Chuột phải vùng palette → **New Palette** → đặt tên `MEP`.
3. Chạy `CUI`, tạo command mới trong **Command List**, điền Name và Macro theo bảng dưới.
4. Kéo command từ Command List sang palette `MEP`.
5. Có thể gán icon qua **Specify Image…**.

## Bước 2B — Nút lệnh trên macOS

1. Chạy `CUI`, mở tab **Commands** và tạo command với Name/Macro theo bảng dưới.
2. Trong **Tool Sets**, tạo custom panel `MEP` rồi thêm command vào panel; cách bố trí có
   thể khác nhẹ theo release.
3. Nếu không muốn dùng Tool Sets, kéo command vào một menu tùy biến trong tab **Menus**.

Không cần tạo palette để dùng các lệnh: chạy `MEP` mở hộp thoại chức năng, còn `MR` chạy
job live mà Acad Studio vừa gửi.

## Macro đề xuất

| Tên nút | Macro | Tác dụng |
|---|---|---|
| **Chạy job từ app** | `^C^CMEP-RUN` | Chạy job live Acad Studio vừa gửi; lệnh tắt `MR` |
| **Vẽ ống** | `^C^CMEP-ONG` | Chọn hệ thống, DN rồi vẽ |
| **Phụ kiện** | `^C^CMEP-PK` | Tạo chú thích phụ kiện để BOM đọc được |
| **Layer chuẩn** | `^C^CMEP-INIT` | Tạo bộ layer chuẩn |
| **Ký hiệu BV** | `^C^CMEP-KHBV` | Sinh ký hiệu `ME-…` |

Các nút một chạm có thể gọi thẳng hàm Lisp:

| Tên nút | Macro |
|---|---|
| **Thoát rửa DN90** | `^C^C(mep-pipe "Rua" 90)` |
| **Thoát xí DN110** | `^C^C(mep-pipe "Xi" 110)` |
| **Thông hơi DN60** | `^C^C(mep-pipe "Hoi" 60)` |
| **Cấp nước DN25** | `^C^C(mep-pipe "Cap" 25)` |

Ví dụ phụ kiện: `^C^C(mep-fit "Chech" "Upvc" 90)`. Hệ thống hợp lệ hiện tại là
`Xi`, `Rua`, `Hoi`, `Cap`; loại phụ kiện gồm `Cut`, `Chech`, `Te`, `Tedeu`, `Y`,
`Ydeu`, `Con`, `Sip`.

## Vai trò của XTP

- XTP là artifact tương thích để trao đổi Tool Palette trên Windows; khả năng import phụ
  thuộc release và sản phẩm AutoCAD.
- Khi export palette, hình ảnh và các file nguồn được tham chiếu vẫn phải được phân phối ở
  vị trí truy cập được. XTP không biến DWG nguồn thành một liên kết hình học sống.
- Trên Mac, chỉ lưu đường dẫn XTP trong catalog nếu cần truy vết/trao đổi với máy Windows;
  không dùng XTP làm source of truth.
- Source of truth của thư viện dự án là catalog Acad Studio, DWG nguồn và metadata `ACADLIB`
  trong bản vẽ. Ảnh preview và XTP chỉ là artifact phụ trợ.

Kiến trúc catalog, quy tắc metadata và luồng scan/create/insert/sync được mô tả tại
[BLOCK-LIBRARY.md](../acad-studio/BLOCK-LIBRARY.md).

## Tài liệu Autodesk

- [Supported Programming Interfaces — Tool palette customization is Windows-only](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-Customization/files/GUID-E6429154-36DF-4D84-8ABC-9FCA15B66158.htm)
- [Customize Tool Palettes](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-Customization/files/GUID-CDF5C4CB-BE69-4ECE-B9EC-49BA422B878E.htm)
- [Share Tool Palettes and Tool Palette Groups (XTP)](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-Core/files/GUID-CF1117E9-DD3B-4E79-9333-41D5E6388981.htm)
- [Specify the Location of Tool Palettes](https://help.autodesk.com/cloudhelp/2024/ENU/AutoCAD-Customization/files/GUID-5FE479F3-9519-4B58-A0EB-70D6CD88E531.htm)
- [Create a custom command on Mac](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-LT-MAC-Customization/files/GUID-A3704961-B766-4DE2-A582-7A7220558032.htm)
- [About Tool Sets on Mac](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-MAC-Core/files/GUID-80278E4A-D01B-43E6-BF9E-9DCFD18B5CE6.htm)
- [Blocks Palette on Mac (`CONTENT`)](https://help.autodesk.com/cloudhelp/2025/ENU/AutoCAD-MAC-Core/files/GUID-09389064-395E-4D18-99CF-7F6C18718EF3.htm)

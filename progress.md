 9 file .dwg định dạng AC1021 (AutoCAD 2007/2008/2009) — toàn bộ là bản vẽ hoàn công hệ thống cơ điện (MEP) của một tòa nhà 
  nhiều tầng:

  ┌────────────┬────────┬───────────────────────────────────────────────────────┐
  │    Nhóm    │  File  │                       Nội dung                        │
  ├────────────┼────────┼───────────────────────────────────────────────────────┤
  │ Cấp nước   │ 1 file │ Hệ thống cấp nước tầng 5,6,7                          │
  ├────────────┼────────┼───────────────────────────────────────────────────────┤
  │ Thoát nước │ 5 file │ Thoát nước + trần từng tầng (1,3,5,6,7)               │
  ├────────────┼────────┼───────────────────────────────────────────────────────┤
  │ Thông hơi  │ 2 file │ Thông hơi tầng 8, 9                                   │
  ├────────────┼────────┼───────────────────────────────────────────────────────┤
  │ Khung tên  │ 1 file │ Khung ban ve_Hoan cong — template khung tên hoàn công │
  └────────────┴────────┴───────────────────────────────────────────────────────┘

  Điểm quan trọng: bộ tên file đã rất chuẩn hóa theo công thức ABD_[Hệ thống]_[Tầng]_[Ngày]_V.[phiên bản].dwg. Đây chính là tín
  hiệu cho thấy đội đang làm thủ công những việc lặp đi lặp lại — và đó là nơi tool tạo giá trị lớn nhất.

  ▎ Lưu ý kỹ thuật: máy hiện chưa có công cụ đọc DWG (ODA/LibreDWG/ezdxf). Để tool đọc được nội dung hình học bên trong (đường 
  ▎ ống, block, layer...) ta sẽ cần một trong các thư viện đó. Tôi sẽ tính đến trong đề xuất.

  Bài toán tool nên giải (theo thứ tự đau nhất với MEP hoàn công)

  1. Khung tên & metadata tự động — điền tên dự án, hệ thống, tầng, ngày, phiên bản, người vẽ vào Khung ban ve thay vì gõ tay
  từng sheet.
  2. Chuẩn hóa layer/block/màu theo tiêu chuẩn công ty — gom nhiều file về 1 chuẩn.
  3. Thư viện linh kiện MEP (ống, van, phụ kiện, thiết bị vệ sinh, miệng gió) — đặt nhanh, đúng block chuẩn.
  4. Thống kê khối lượng vật tư (BOM/bóc tách) — đếm ống theo chiều dài/đường kính, đếm thiết bị → xuất Excel.
  5. Đánh số & ghi chú tự động (auto-number, auto-tag).
  6. Batch xử lý nhiều file + xuất PDF hàng loạt theo đúng tên chuẩn.
  7. Quản lý phiên bản & sheet index (V.00 → V.01...).


   Ý tưởng cốt lõi: tách phần nặng ra khỏi AutoCAD. Hầu hết việc bạn cần (khung tên, BOM, chuẩn layer, PDF) không cần AutoCAD 
  đang mở — làm trực tiếp trên dữ liệu bản vẽ qua DXF. Chỉ phần "đặt linh kiện realtime" mới cần nói chuyện với AutoCAD.

  ┌─────────────────────────────────────────────┐
  │  APP DESKTOP (Tauri/Electron) — Mac & Win    │  ← UI/UX hiện đại: panel
  │  React + TypeScript, giao diện kéo-thả        │    thư viện, form khung tên,
  └───────────────┬─────────────────┬────────────┘    bảng BOM, batch
                  │                 │
     ┌────────────▼─────────┐  ┌────▼──────────────────┐
     │ LÕI DXF (offline)     │  │ CẦU NỐI AutoCAD (live) │
     │ ODA File Converter    │  │ sinh .lsp/.scr (AutoLISP│
     │ (free) + ezdxf (Python)│  │ chạy cả Mac+Win)        │
     │ DWG↔DXF, đọc/ghi       │  │ + AppleScript (Mac)     │
     │ layer/block/attribute  │  │ → đặt block vào bản vẽ  │
     └────────────────────────┘  └─────────────────────────┘

  Tại sao lõi DXF: DXF là định dạng text, công khai, không cần AutoCAD. ezdxf (Python) đọc/ghi rất mạnh; ODA File Converter
  (miễn phí, có bản Mac) lo chuyển DWG↔DXF. Pipeline: DWG → DXF → xử lý → DXF → DWG. Bonus: tool gần như độc lập phiên bản 
  AutoCAD, thậm chí chạy được cả khi máy không có AutoCAD full — rất hợp vì đội bạn "chưa rõ phiên bản".

  4 tính năng bạn chọn → ánh xạ vào kiến trúc

  ┌────────────────────────────┬─────────────────────────────────────────────────────────────────────────┬────────────────┐
  │         Tính năng          │                                Cách làm                                 │  Cần AutoCAD   │
  │                            │                                                                         │      mở?       │
  ├────────────────────────────┼─────────────────────────────────────────────────────────────────────────┼────────────────┤
  │ Khung tên & metadata       │ Đọc/ghi ATTRIBUTE trong block khung tên qua ezdxf, điền hàng loạt từ    │ ❌ Không       │
  │                            │ form                                                                    │                │
  ├────────────────────────────┼─────────────────────────────────────────────────────────────────────────┼────────────────┤
  │ Bóc tách BOM               │ Đếm block + đo chiều dài polyline ống theo layer/đường kính → xuất      │ ❌ Không       │
  │                            │ Excel                                                                   │                │
  ├────────────────────────────┼─────────────────────────────────────────────────────────────────────────┼────────────────┤
  │ Chuẩn hóa layer +          │ Layer mapping/rename qua ezdxf; PDF qua script PLOT hoặc render ODA     │ ❌ Không       │
  │ batch/PDF                  │                                                                         │                │
  ├────────────────────────────┼─────────────────────────────────────────────────────────────────────────┼────────────────┤
  │ Thư viện linh kiện MEP     │ Panel kéo-thả → sinh LISP/AppleScript chèn block vào bản vẽ đang mở     │ ✅ Có          │
  └────────────────────────────┴─────────────────────────────────────────────────────────────────────────┴────────────────┘

  Lộ trình đề xuất (offline-first — ra giá trị nhanh, rủi ro thấp)

  - Giai đoạn 0 (~1 tuần): Khung app + pipeline DWG↔DXF, mở file, liệt kê sheet/layer/block. Xác thực đọc được đúng 9 file mẫu
  của bạn.
  - Giai đoạn 1 — MVP (Khung tên + BOM): giá trị cao nhất, không phụ thuộc AutoCAD, chạy ngay trên Mac & Win. Đây là nơi nên
  bắt đầu.
  - Giai đoạn 2 — Chuẩn layer + batch/PDF: đồng bộ chuẩn công ty, xuất PDF hàng loạt đúng tên ABD_..._V.xx.
  - Giai đoạn 3 — Thư viện MEP live: phần phụ thuộc AutoCAD nhiều nhất, làm sau cùng. Cần build sẵn bộ block chuẩn
  (ống/van/thiết bị/miệng gió).

  Tech stack đề xuất

  - UI: Tauri (Rust + React/TS) — nhẹ, nhanh, native Mac & Win. (Hoặc Electron nếu đội mạnh JS hơn.) Dùng Ant Design cho bảng
  BOM tốt.
  - Lõi CAD: Python sidecar + ezdxf + ODA File Converter (miễn phí).
  - Cầu nối CAD: AutoLISP .lsp/.scr (Mac+Win) + AppleScript (Mac).
  - Xuất Excel: openpyxl.

  ---
  Trước khi tôi đi sâu vào thiết kế chi tiết Giai đoạn 1, có một việc kỹ thuật chặn đường cần làm rõ: máy bạn hiện chưa có công
  cụ đọc DWG nào (tôi đã kiểm tra: không có ODA/ezdxf/LibreDWG). Tôi đề xuất bước tiếp theo cụ thể:
  
  1. Tôi cài thử pipeline đọc DWG (ODA File Converter + ezdxf) rồi mở thật 9 file của bạn, in ra cấu trúc layer/block/attribute
  — để biết chính xác khung tên dùng block gì, ống nằm ở layer nào. Đây là dữ liệu bắt buộc để thiết kế đúng BOM & auto khung
  tên.
  2. Sau khi có cấu trúc thật, tôi dựng MVP Giai đoạn 1 (app + form khung tên + BOM).

  Bạn muốn tôi bắt đầu bằng việc cài pipeline và phân tích thật 9 file mẫu ngay bây giờ không? (Cần tải ODA File Converter bản
  Mac — tôi sẽ hướng dẫn lệnh, hoặc bạn gõ ! brew install ... để tôi chạy.) Hay bạn muốn tôi viết tài liệu đặc tả kỹ thuật + UI
  mockup cho cả 4 tính năng trước?
# USER GUIDE

Hướng dẫn cho người dùng cuối AutoCAD Toolkit.

> **Trạng thái tài liệu.** Giao diện đang được chuyển sang bộ mẫu thiết kế mới
> (xem `ROADMAP.md`). Tài liệu này chỉ mô tả những gì đã xác minh được từ code
> và cấu hình. Phần chưa xác minh ghi rõ `Sẽ bổ sung sau` thay vì phỏng đoán.

---

## 1. Ứng dụng này làm gì

Đọc, phân tích và chỉnh sửa bản vẽ AutoCAD trên macOS. Ba đường làm việc, dùng
được độc lập:

| Cách dùng | Cần AutoCAD mở? | Làm được gì |
|-----------|-----------------|-------------|
| Offline | Không | Đọc thông tin bản vẽ, layer, khung tên, bóc tách sơ bộ từ tệp DWG đóng |
| Điều khiển AutoCAD | Có | Quét tiêu chuẩn, chọn đối tượng, chèn block, chạy LISP trên bản vẽ đang mở |
| Xử lý hàng loạt | Không | Chạy công việc lặp trên nhiều tệp DWG đóng |

---

## 2. Khởi động

1. Mở Terminal, chạy daemon:

   ```bash
   cd acad-studio && pnpm --filter @acad/daemon start
   ```

2. Mở giao diện: `pnpm --filter @acad/web dev`, rồi vào
   <http://127.0.0.1:3000>.

**Không mở tệp HTML trực tiếp bằng `file://`.** Ứng dụng sẽ báo lỗi kết nối ở
mọi thao tác, vì daemon từ chối các nguồn không nằm trong danh sách cho phép
(mã lỗi `origin_not_allowed`). Luôn mở qua địa chỉ ở trên.

---

## 3. Nguyên tắc an toàn cần biết trước khi dùng

Đây là những giới hạn cố ý của sản phẩm, không phải lỗi:

- **Mọi thao tác ghi vào bản vẽ đều có hai bước:** ứng dụng chuẩn bị trước, bạn
  xác nhận sau. Không có thao tác nào tự chạy.
- **Không có nút hoàn tác.** Ứng dụng không giữ lịch sử để quay lại. Cách duy
  nhất là gõ `UNDO` trong chính AutoCAD.
- **Một số việc kết thúc trong AutoCAD, không trong ứng dụng.** Ví dụ: chọn điểm
  chèn block, hoặc nạp LISP qua hộp thoại bảo mật. Khi đó ứng dụng sẽ nói rõ để
  bạn chuyển sang cửa sổ AutoCAD.
- **Danh sách bản vẽ là các bản vẽ AutoCAD đang mở**, không phải danh sách tệp
  mở gần đây. Ứng dụng không đọc được số đối tượng của tệp chưa mở.

---

## 4. Giới hạn đã biết

- **Không in được tệp DWG đang đóng trên macOS.** Đây là giới hạn của AutoCAD,
  không phải tính năng chưa làm. Muốn in thì mở bản vẽ trong AutoCAD trước.
- **Thao tác đã chuẩn bị sẽ mất nếu khởi động lại daemon.** Hàng chờ không được
  lưu xuống đĩa; phải chuẩn bị lại từ màn hình gốc.
- **Đồng bộ khung xem (`.cadweb`) chưa hoạt động.** Tính năng mặc định tắt và
  hiện chưa có máy chủ nhận dữ liệu.
- **Hai màn hình là bản dựng thử.** "Preconstruction" và "Xem lại tài liệu PDF"
  hiển thị số liệu mẫu, chưa nối máy chủ — đừng dùng để ra quyết định.

---

## 5. Giao diện mới

Giao diện đang được dựng lại. Hai giao diện chạy song song và bạn đi lại giữa
chúng được:

- Từ **màn hình cũ**: bấm **→ Giao diện mới** ở thanh trên.
- Từ **giao diện mới**: bấm **Màn hình cũ** ở cuối thanh điều hướng bên trái.

### Khung chung

Thanh điều hướng bên trái chia 5 nhóm, 14 mục. Mục **chưa dựng thì mờ đi và nói
rõ lý do** khi bạn rê chuột vào — không dẫn bạn tới trang trống.

| Thao tác | Phím |
|---|---|
| Mở bảng lệnh, đi tới màn hình | `⌘K` |
| Thu / mở thanh điều hướng | `⌘B` |
| Đóng bảng lệnh, hộp thoại | `Esc` |

Thanh trên hiển thị: bản vẽ AutoCAD **đang mở** (không phải tệp mở gần đây), số
thay đổi chờ duyệt, và trạng thái kết nối AutoCAD. Chấm cạnh mỗi bản vẽ có **ba**
trạng thái — đã lưu, chưa lưu, và *không đọc được* (chấm rỗng viền đứt: plugin
AcadBridge bản cũ chưa báo được trạng thái này, hãy build lại plugin).

Thanh điều hướng thu gọn tự động khi cửa sổ hẹp dưới 900px; dưới mức đó nút
thu/mở bị khoá và nói rõ vì sao.

### Thư viện block (`/library/blocks`)

Duyệt và tra cứu định nghĩa block dùng chung.

- Ô tìm kiếm khớp cả tên hiển thị, tên kỹ thuật và thẻ.
- Bộ lọc có **6** trạng thái đồng bộ: khớp thư viện · bản vẽ dùng bản cũ · chỉ có
  trong bản vẽ · chỉ có trong thư viện · **xung đột** · và "mọi trạng thái".
  Xung đột là trạng thái duy nhất bạn buộc phải xử lý tay.
- Bấm một block để xem chi tiết ở cột phải: trạng thái đồng bộ, kiểu block, số
  thuộc tính, không gian cho phép, điểm chèn.
- **Không có ảnh xem trước.** Máy chủ không render hình block, nên ô đó hiện tên
  định nghĩa thay vì một hình vẽ ngụ ý máy chủ biết block trông thế nào.

**Màn hình này chỉ đọc.** Tạo block từ bộ chọn, chèn vào bản vẽ, đồng bộ định
nghĩa và sửa metadata vẫn ở màn hình cũ — chúng là lệnh ghi và cần bước xác nhận
chưa dựng lại ở đây. Nút **Mở màn hình cũ để sửa** mở thẳng thư viện ở màn hình
cũ.

### Các màn hình còn lại

Chưa dựng. Thứ tự dự kiến: Thư viện LISP · Khung bản vẽ · Thông tin bản vẽ ·
Kiểm tra · Hồ sơ tiêu chuẩn · Thay đổi chờ duyệt · Bóc tách · Kết nối AutoCAD ·
Xuất bản PDF · Xử lý thư mục · Đồng bộ CadWeb · Tổng quan · Trợ lý AI.

---

## 6. Lỗi thường gặp

| Hiện tượng | Nguyên nhân | Cách xử lý |
|------------|-------------|------------|
| Mọi thao tác báo lỗi kết nối | Mở bằng `file://`, hoặc dev server chạy cổng khác 3000 | Mở qua <http://127.0.0.1:3000>, hoặc đặt `ACAD_WEB_URL` |
| "AutoCAD chưa chạy" | AutoCAD chưa mở, hoặc chưa nạp plugin AcadBridge | Mở AutoCAD; nạp plugin bằng `APPLOAD` |
| Thao tác báo bản vẽ đã thay đổi | Bản vẽ được sửa sau khi thao tác được chuẩn bị | Chuẩn bị lại từ màn hình gốc — không thử lại thao tác cũ |
| Hàng chờ trống sau khi khởi động lại | Hàng chờ chỉ sống trong phiên | Chuẩn bị lại các thao tác |

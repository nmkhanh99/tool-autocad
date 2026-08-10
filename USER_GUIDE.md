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

#### Chèn vào bản vẽ

Ghi **một pha**: bấm xác nhận là AutoCAD chèn ngay, thao tác **không** xuất hiện
ở màn Thay đổi chờ duyệt và **không hoàn tác được** từ app.

Sau khi xác nhận, hộp thoại đóng ngay và bạn phải **chuyển sang AutoCAD để chỉ
điểm chèn**. Máy chủ chờ tối đa **2 phút**; quá hạn là lệnh bị bỏ. Trong lúc chờ,
nút đổi thành "Đang chờ AutoCAD…" nên không xếp được hai lệnh chồng nhau.

#### Đồng bộ metadata

Ghi thông tin mô tả (tên hiển thị, layer, nhóm, thẻ) của định nghĩa **đã có sẵn**
trong bản vẽ. **Hình học của block không đổi** — lệnh này không nhập lại và không
thay hình vẽ. Nếu bản vẽ chưa có định nghĩa đó, máy chủ từ chối và trang báo lý
do; hãy chèn trước rồi đồng bộ sau.

Cột trạng thái đồng bộ là kết quả **lần quét gần nhất của thư viện**, không phải
trạng thái so với bản vẽ bạn đang mở — đừng dựa vào nó để đoán lệnh sẽ thành công.

#### Sửa metadata

Form dưới pane chi tiết ghi vào **thư viện**, không chạm bản vẽ nào. Vì thế nó
không có hộp xác nhận: sửa sai thì sửa lại.

- Nút **Lưu metadata** chỉ bật khi bạn đã đổi gì đó *và* dữ liệu hợp lệ; để chuột
  lên nút bị khoá sẽ thấy lý do.
- **Tên kỹ thuật** đi thẳng vào AutoCAD nên chỉ nhận ASCII không dấu, gồm chữ,
  số, dấu chấm, `_` và `-`. Gõ "Van cổng DN80" là không hợp lệ.
- **Hoàn tác** trả form về bản đang lưu trên máy chủ.
- Nếu người khác vừa sửa thư viện, máy chủ từ chối lượt lưu thay vì ghi đè im
  lặng; tải lại trang rồi sửa trên bản mới.
- **Lưu metadata cho block đang "Đã sync" sẽ đổi trạng thái thành "Cần cập
  nhật".** Đúng như vậy: bản vẽ vẫn giữ thông tin cũ. Thông báo sẽ nhắc bạn chạy
  **Đồng bộ metadata** để ghi bản mới xuống bản vẽ.

#### Tạo từ bộ chọn

Lệnh ghi **duy nhất lấy đi thứ đang có trên bản vẽ**. AutoCAD gom các đối tượng
bạn đang chọn thành một định nghĩa block rồi **xoá chúng khỏi bản vẽ** — đó là
hành vi của lệnh `-BLOCK`, không phải lựa chọn của app. Gõ `OOPS` trong AutoCAD
ngay sau đó nếu cần lấy lại.

Ba điều phải tự lo trước khi bấm, app **không kiểm hộ được**:

1. **Chọn đối tượng trong AutoCAD trước.** App không tạo được bộ chọn thay bạn;
   máy chủ từ chối nếu bộ chọn rỗng.
2. **Bản vẽ đích phải đang hoạt động.**
3. **Sau khi bấm, chuyển sang AutoCAD để chỉ điểm chèn.** Chờ tối đa 2 phút.

App chặn trước hai thứ nó biết chắc: tên kỹ thuật sai định dạng, và tên đã có
trong thư viện (không phân biệt hoa thường). Còn nếu **bản vẽ** đã có block cùng
tên thì máy chủ mới từ chối — kể cả khi thư viện chưa có.

Chỉ tạo được **block tĩnh**. Block động phải dựng trong Block Editor.

#### Nguồn thư viện

Mở bằng nút **Nguồn thư viện** ở góc trên.

**Thêm nguồn không quét gì cả.** Máy chủ chỉ ghi đường dẫn vào danh mục — không
định nghĩa nào được tìm thấy hay nhập vào. Một nguồn chỉ có tác dụng khi bạn
**gán nó cho một định nghĩa** ở ô *Nguồn DWG* trong phần sửa metadata; khi đó,
chèn định nghĩa ấy vào một bản vẽ **chưa có nó** sẽ lấy hình từ file này.

- Nguồn là **một file `.dwg`**, không phải thư mục. Loại `xtp`/`image` ghi được
  nhưng không chèn được, và danh sách nói rõ điều đó.
- **Không dùng `~`** — máy chủ không nở dấu ngã. Viết đường dẫn tuyệt đối.
- Đường dẫn không được kiểm lúc lưu; viết sai chỉ lộ ra khi chèn.
- **Không xoá được nguồn**, cũng không xoá được định nghĩa — backend chưa có
  đường đó, ở cả màn hình mới lẫn màn hình cũ.

**Vẫn còn ở màn hình cũ:** quét bản vẽ đang mở để đưa định nghĩa của nó vào danh
mục. Nút **Mở màn hình cũ để sửa** mở thẳng thư viện ở màn hình cũ.

### Thư viện LISP (`/library/lisp`)

Tra cứu script AutoLISP đang được quản lý. **Màn hình này chỉ đọc.**

- Ô tìm kiếm khớp cả tên file, **tên lệnh** (`CTY-...`) và đường dẫn.
- Lọc theo trạng thái duyệt: chưa duyệt · bản duyệt đã cũ · đã duyệt.
- **Quét lại đĩa** bắt máy chủ đọc lại thư mục gốc. Nếu danh sách bị cắt bớt vì
  quá nhiều file, trang nói ra — đừng kết luận "không có script nào tên X" khi
  chưa thấy cảnh báo đó.

#### "Đã duyệt" nghĩa là gì

Không phải cứ đã duyệt là đã có người đọc hết mã. Pane chi tiết nói rõ **phạm vi
người duyệt thật sự đọc được** lúc ký:

| Phạm vi | Nghĩa |
|---|---|
| Đọc toàn bộ source | Bản duyệt dựa trên toàn bộ mã. |
| Chỉ đọc được một phần source | Mã quá dài, agent chỉ nhận được một phần. |
| Chỉ đọc metadata | Không đọc mã — thường là file đã biên dịch. |
| Bản duyệt cũ | Không ghi lại phạm vi, nên không kiểm chứng được. |

Trang cũng so **hash lúc duyệt** với hash hiện tại. Khác nhau nghĩa là file đã
đổi sau khi duyệt, và bản duyệt cũ không còn nói về nội dung đang có.

#### Duyệt phải làm trong app desktop

Máy chủ đòi một chữ ký Ed25519 do app Acad Studio desktop tạo, và chỉ chấp nhận
khi **chính app đó khởi chạy daemon**. Đây là thiết kế bảo mật cố ý, không phải
thiếu tính năng. Bản duyệt còn hết hạn sau **2 phút**, nên mỗi lượt phải làm
liền một mạch.

Banner ở đầu màn hình cho biết cửa sổ bạn đang mở có duyệt được không:

- **Mở bằng trình duyệt** — không có bộ ký, không duyệt được.
- **Mở trong app Acad Studio desktop** — có bộ ký, nhưng đó mới là *nửa* điều
  kiện. Nếu daemon đang chạy được bật bằng tay (không phải do app desktop khởi
  chạy) thì lượt duyệt vẫn bị từ chối. App không nhìn thấy được điều đó nên
  không kết luận thay bạn.

#### Nạp script vào AutoCAD

Nút **Nạp vào AutoCAD** ở pane chi tiết. Chỉ nạp được script **đã duyệt** và có
định dạng nạp được — hộp xác nhận liệt kê từng điều kiện và nói rõ cái nào chưa
đạt.

Ba điều xảy ra khi nạp, không phải một:

1. **AutoCAD thực thi file ngay.** Biểu thức nào nằm ở mức cao nhất sẽ chạy
   luôn — kể cả biểu thức sửa bản vẽ. Chỉ định nghĩa hàm thì không sao; đó là
   điều bản duyệt phải xác nhận.
2. Thư mục chứa mã được thêm vào **support path** của phiên.
3. Thư mục đó được thêm vào **`TRUSTEDPATHS`** — từ đó AutoCAD tin mã trong thư
   mục ấy mà không hỏi `SECURELOAD` nữa.

Nạp hỏng thì (2) và (3) được trả lại như cũ. Nạp **xong** thì chúng nằm lại tới
khi bạn đóng AutoCAD. **`UNDO` không gỡ được mã đã nạp.**

Nếu thông báo nói "đã gửi lệnh nạp, AutoCAD chưa trả kết quả" thì lệnh mới chỉ
tới AutoCAD — kiểm tra trong AutoCAD trước khi gõ tên lệnh.

#### Thư mục gốc

Nút **Thư mục gốc** ở góc trên. Đây là các thư mục mà lượt quét sẽ đọc; chưa có
thư mục nào thì danh mục rỗng dù trên đĩa có script.

- Phải là **một thư mục**, không phải file — khác với nguồn của thư viện block.
- **Không dùng `~`**; gốc hệ thống và thư mục nhà bị từ chối vì quá rộng.
- **Lấy support path từ AutoCAD** đọc *Support File Search Path* của AutoCAD
  đang chạy và thêm từng đường dẫn. Cần AutoCAD mở và plugin trả lời. Đường dẫn
  không tồn tại bị bỏ qua và đếm lại cho bạn.
- Thêm xong phải **Quét lại đĩa** thì danh mục mới đọc thư mục mới.
- **Không bỏ được thư mục gốc** — backend chưa có đường đó.

**Vẫn còn ở màn hình cũ:** phân tích bằng agent và duyệt manifest.

### Các màn hình còn lại

Chưa dựng. Thứ tự dự kiến: Khung bản vẽ · Thông tin bản vẽ ·
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

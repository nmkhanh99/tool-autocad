# Acad Studio — Lộ trình chức năng (từ phân tích 9 bản vẽ thật)

Thiết kế bằng workflow đọc sâu bản vẽ (block/layer/annotation/ống/khung tên) + năng lực AutoCAD headless đã kiểm chứng. 
`✓` = đã build & test; `○` = có spec, chờ build.


## VẼ & HỖ TRỢ VẼ

| | Chức năng | Cách làm | Effort |
|---|---|---|---|
| ✓ | 🖊️ **Vẽ ống (MLINE theo hệ + DN)** | gui-needed | low |
| ✓ | 🏷️ **Chú thích phụ kiện 'Loại, VL, DN'** | gui-needed | low |
| ✓ | 🔧 **Vẽ ký hiệu phụ kiện (symbol LISP)** | gui-needed | low |
| ✓ | 🔡 **Sinh mã hiệu bản vẽ (KHBV)** | offline-python | low |
| ○ | 🗂️ **Tạo bộ layer chuẩn MEP** | hybrid | low |
| ○ | 🔖 **Auto-tag ống (nhãn hệ-VL-DN;I=%)** | headless | med |
| ○ | ⭕ **Vẽ ống đứng (riser = CIRCLE, dia=DN)** | hybrid | low |
| ○ | 🔢 **Đánh số phụ kiện/ống + lưu XDATA** | headless | med |
| ○ | 📐 **Vẽ ống từ bảng toạ độ (file đóng)** | headless | med |
| ○ | 📚 **Dựng thư viện block MEP (-WBLOCK)** | headless | med |
| ○ | 🧩 **Chèn phụ kiện từ thư viện block THẬT** | hybrid | high |

## TÍNH TOÁN & BÓC TÁCH

| | Chức năng | Cách làm | Effort |
|---|---|---|---|
| ○ | 📊 **Bóc BOM ống theo DN & hệ thống** | headless | high |
| ○ | 🧾 **Bóc BOM phụ kiện theo nhãn (ATTRIBUTE)** | hybrid | med |
| ○ | 📗 **Bảng vật tư tổng hợp (Excel)** | hybrid | med |
| ○ | 📏 **Tổng chiều dài từng hệ (m)** | headless | low |
| ○ | 🔵 **Đếm ống đứng (riser) theo DN** | headless | med |
| ○ | 💬 **Bóc spec ống & BOM trục đứng (MULTILEADER)** | hybrid | low |
| ○ | 🎯 **Kiểm tra DN (nhãn ↔ hình học)** | hybrid | high |
| ○ | 📉 **Kiểm tra độ dốc thoát tối thiểu** | hybrid | med |
| ○ | 🛡️ **Kiểm tra chất lượng bóc tách (BOM QA)** | hybrid | med |
| ○ | 🧮 **Máy tính DN theo lưu lượng/thiết bị** | offline-python | low |

## QUẢN LÝ & XUẤT BẢN

| | Chức năng | Cách làm | Effort |
|---|---|---|---|
| ✓ | 🧹 **Dọn & sửa lỗi bản vẽ (Audit+Purge+Overkill)** | headless | low |
| ✓ | 📤 **Xuất DXF cả bộ (cầu nối offline)** | headless | low |
| ✓ | 📑 **Mục lục bản vẽ (Sheet Index)** | headless | low |
| ✓ | ✏️ **Điền/sửa khung tên (đơn lẻ + hàng loạt)** | hybrid | low |
| ✓ | 🔁 **Đổi version DWG hàng loạt** | headless | low |
| ○ | ✅ **Kiểm tra tuân thủ layer chuẩn (audit)** | headless | low |
| ○ | 🔢 **Tự sinh mã & đánh số bản vẽ (auto KHBV)** | hybrid | med |
| ○ | 🏷️ **Đổi tên file theo chuẩn (rename theo KHBV)** | hybrid | med |
| ○ | 🗄️ **Chuẩn hoá layer cả bộ (map→rename→màu)** | hybrid | high |
| ○ | 🔍 **So sánh phiên bản bản vẽ (revision diff)** | hybrid | med |
| ○ | 📦 **Đóng gói phát hành + Quản lý phiên bản** | hybrid | med |
| ○ | 🖨️ **Batch xuất PDF phát hành (multi-sheet)** | gui-needed | high |

## Cần build backend (spec sẵn)

- **tao-layer-chuan** — Tạo bộ layer chuẩn MEP đúng màu bản vẽ thật + áp cả folder headless (GUI hiện SAI màu)
- **auto-tag-ong** — Tự gắn nhãn hệ-VL-DN;I=% cho mọi MLINE tại trung điểm
- **ve-ong-dung** — Vẽ riser CIRCLE đường kính=DN trên layer hệ
- **danh-so-phu-kien** — Gán mã tuần tự WP-01/SP-02… + lưu XDATA
- **ve-ong-toa-do** — Vẽ MLINE vào DWG ĐÓNG từ bảng toạ độ (headless)
- **dung-thu-vien-block** — Trích block phụ kiện CÓ TÊN ra thư viện .dwg
- **chen-phu-kien-block** — Chèn block phụ kiện thật từ thư viện
- **insert-khung-ten** — Chèn khung tên A3 mới từ template khi bản vẽ chưa có (sub của sua-khung-ten)
- **bom-ong** — Bóc BOM ống theo DN(scale)×hệ×VL, đệ quy container, khử trùng (thay bompipe)
- **bom-phu-kien** — Đếm phụ kiện theo ATTRIBUTE 'Loại,VL,DN', đệ quy (thay bomfit)
- **bang-vat-tu-excel** — Gộp BOM ống+phụ kiện+riser ra Excel nhiều sheet
- **tong-chieu-dai-he** — Roll-up tổng mét ống mỗi hệ
- **dem-ong-dung** — Đếm riser CIRCLE theo DN=2×bán kính
- **boc-spec-mleader** — Đọc MULTILEADER → bảng spec tuyến + BOM trục đứng
- **kiem-tra-dn** — Đối chiếu DN vẽ (scale) ↔ DN nhãn ↔ DIMSTYLE
- **kiem-tra-do-doc** — So dốc GHI (;I=%) với i_min theo DN
- **bom-qa** — Rà rủi ro sai khối lượng trước bàn giao
- **may-tinh-dn** — Ước tính DN tối thiểu từ FU/Q theo bảng tra
- **muc-luc-upgrade** — Nâng cấp mục lục: không mất dòng khi 1 file nhiều khung tên (CN 21 sheet)
- **audit-layer** — So layer+màu+linetype với danh mục chuẩn (read-only)
- **auto-khbv** — Suy KHBV ME-<hệ>-T<tầng> từ tên file + điền khung tên cả bộ, params riêng mỗi file
- **doi-ten-file** — Đổi tên/sao chép file theo mẫu {KHBV} với preview
- **chuan-hoa-layer** — Map→rename→đổi màu layer chuẩn cho cả bộ
- **so-sanh-phien-ban** — Diff 2 thư mục (KHBV/ngày, entity, layer, dung lượng)
- **dong-goi-phat-hanh** — Chuỗi QA→convert→rename→index→zip + manifest + checksum
- **xuat-pdf-batch** — Xuất PDF cả bộ (GUI script hoặc render thô offline)

## Cách agent gợi ý chức năng

MỤC TIÊU: Agent chat biến yêu cầu tiếng Việt tự nhiên của user thành lời gọi chức năng trong catalog. Nguyên tắc xuyên suốt: ƯU TIÊN DÙNG NGAY (ready=true) — nếu chức năng đúng nhất chưa build (ready=false) thì vẫn đề xuất nó nhưng gắn nhãn 'cần build' và kèm chức năng ready gần nhất làm phương án chạy được ngay.

===== A. PHÂN LOẠI YÊU CẦU =====
1) RÕ RÀNG (chỉ đích danh 1 hành động, đủ tham số suy được) → GỌI THẲNG. Nếu yêu cầu là 1 pipeline hiển nhiên (vd 'xuất bảng vật tư') → gọi CHUỖI nhiều chức năng theo thứ tự phụ thuộc.
2) MƠ HỒ (nêu mục tiêu nhưng nhiều đường, thiếu tham số, hoặc từ khoá trùng nhiều chức năng) → ĐỀ XUẤT 2-4 chức năng cho user chọn/xác nhận, xếp ready-first.
3) KHÔNG MAP ĐƯỢC → hỏi 1 câu làm rõ + gợi ý 2-3 nhóm chức năng phổ biến (bóc BOM, dọn bản vẽ, mục lục).

===== B. BẢN ĐỒ TỪ KHOÁ → CHỨC NĂNG =====
- 'bóc khối lượng / thống kê ống / BOM ống / tổng mét' → bom-ong (chính), tong-chieu-dai-he, dem-ong-dung.
- 'phụ kiện / cút chếch tê / đếm co' → bom-phu-kien.
- 'bảng vật tư / xuất excel / bảng khối lượng bàn giao' → bang-vat-tu-excel (pipeline: bom-ong + bom-phu-kien + dem-ong-dung → excel).
- 'dọn / làm sạch / giảm dung lượng / purge / audit lỗi' → qa-don-ban-ve (ready).
- 'mục lục / danh sách bản vẽ / sheet index' → muc-luc-ban-ve (ready).
- 'khung tên / điền tên bản vẽ / ngày / người ký' → sua-khung-ten (ready); sinh mã → khbv-gen (ready) / auto-khbv (batch).
- 'đổi version / lưu về 2010 / cad cũ' → doi-version-dwg (ready).
- 'xuất dxf' → xuat-dxf
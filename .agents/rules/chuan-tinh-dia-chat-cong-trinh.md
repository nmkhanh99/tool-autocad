# Chuẩn Tính Địa Chất Công Trình

## Activation
- Model Decision

## Rules
- Áp dụng rule này khi task liên quan đánh giá điều kiện địa chất công trình, trụ địa chất, chỉ tiêu cơ lý đất, mực nước ngầm, móng nông, đệm cát hoặc nền móng.
- Trước khi tính, phải liệt kê dữ liệu đầu vào, đơn vị và giả định. Nếu thiếu dữ liệu bắt buộc, không được bịa số; phải ghi rõ chưa đủ dữ liệu để tính phần đó.
- Rule này chỉ kiểm soát quy trình và việc dùng đúng skill; công thức chi tiết của từng thành phần phải nằm trong skill chuyên trách, không duy trì trùng lặp trong rule.
- Phải ưu tiên file `TỔNG_HỢP_CÔNG_THỨC_NỀN_VÀ_MÓNG_(đã_sửa_v3).md` và các skill được reference bên dưới làm nguồn chuẩn. Nếu có khác biệt giữa rule và skill, phải theo skill chuyên trách và báo lại để cập nhật rule.
- Trình tự đánh giá tối thiểu phải đi qua skill `danh-gia-dia-chat-cong-trinh`: kiểm tra dữ liệu; chuẩn hóa đơn vị; lập bảng lớp đất; xác định thành phần cần tính; gọi skill thành phần tương ứng; phân loại; kết luận điều kiện địa chất.
- Khi tính độ sệt đất dính hoặc phân loại trạng thái theo $I_L$, bắt buộc áp dụng skill `tinh-do-set-dat-dinh`.
- Khi tính hệ số rỗng $e$, bắt buộc áp dụng skill `tinh-he-so-rong-dat`.
- Khi tính trọng lượng thể tích đẩy nổi $gamma_{dn}$, bắt buộc áp dụng skill `tinh-trong-luong-the-tich-day-noi`.
- Khi tính ứng suất bản thân $sigma_z^{bt}$ hoặc lập bảng/biểu đồ ứng suất địa tầng, bắt buộc áp dụng skill `tinh-ung-suat-ban-than-dat`.
- Nếu một phép tính thành phần chưa có skill chuyên trách, không được tự mở rộng rule bằng công thức mới; phải tạo hoặc cập nhật skill riêng rồi thêm reference vào rule.
- Kết quả phải có bước thay số hoặc bảng tính để kiểm tra được, không chỉ đưa đáp án cuối.
- Nếu user yêu cầu dùng tiêu chuẩn khác hoặc công thức khác với tài liệu nguồn, phải nêu rõ sự thay đổi chuẩn trước khi tính.

## @ References
@TỔNG_HỢP_CÔNG_THỨC_NỀN_VÀ_MÓNG_(đã_sửa_v3).md
@.agents/skills/danh-gia-dia-chat-cong-trinh/SKILL.md
@.agents/skills/tinh-do-set-dat-dinh/SKILL.md
@.agents/skills/tinh-he-so-rong-dat/SKILL.md
@.agents/skills/tinh-trong-luong-the-tich-day-noi/SKILL.md
@.agents/skills/tinh-ung-suat-ban-than-dat/SKILL.md

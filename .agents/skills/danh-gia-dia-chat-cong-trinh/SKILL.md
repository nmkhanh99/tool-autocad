---
name: danh-gia-dia-chat-cong-trinh
description: "Đánh giá điều kiện địa chất công trình theo đầy đủ bước: đọc trụ địa chất, tính chỉ tiêu cơ lý, phân loại lớp đất, ứng suất bản thân và kết luận nền móng. Use when user asks đánh giá địa chất, điều kiện địa chất công trình, phân tích trụ địa chất, phân loại trạng thái đất."
---

# Đánh Giá Địa Chất Công Trình

## Goal
Đánh giá điều kiện địa chất công trình từ trụ địa chất và chỉ tiêu cơ lý, bảo đảm tính đúng các đại lượng nền tảng trước khi đề xuất phương án nền móng.

## When to use this skill
- User yêu cầu đánh giá điều kiện địa chất công trình.
- User đưa trụ địa chất, bảng chỉ tiêu cơ lý, mực nước ngầm và cần nhận xét nền đất.
- User cần phân loại trạng thái lớp đất, xác định lớp yếu, lớp chịu lực hoặc sơ bộ chọn móng.

## Instructions
1. Thu thập dữ liệu đầu vào cho từng lớp: tên đất, chiều dày, cao độ hoặc độ sâu, W, Wp, WL, gamma, gamma_s, gamma_sat, c, phi, E, SPT/CPT nếu có, và mực nước ngầm.
2. Chuẩn hóa đơn vị: chiều sâu m; gamma kN/m3; W, Wp, WL cùng hệ phần trăm; ứng suất kPa hoặc kN/m2. Nêu rõ giả định, ví dụ gamma_w = 10 kN/m3 nếu đề không cho.
3. Lập bảng địa tầng theo cao độ hoặc độ sâu: đỉnh lớp, đáy lớp, chiều dày, vị trí so với mực nước ngầm, chỉ tiêu cơ lý có sẵn và chỉ tiêu cần tính.
4. Với đất dính, tính độ sệt bằng skill `tinh-do-set-dat-dinh`: $I_L = (W - W_p)/(W_L - W_p)$, sau đó phân loại trạng thái theo ngưỡng trong tài liệu nguồn.
5. Khi có gamma_s, W và gamma, tính hệ số rỗng bằng skill `tinh-he-so-rong-dat`: $e = gamma_s(1 + 0.01W)/gamma - 1$.
6. Với phần đất dưới mực nước ngầm, tính trọng lượng thể tích đẩy nổi bằng skill `tinh-trong-luong-the-tich-day-noi`: $gamma_{dn} = gamma_{sat} - gamma_w$ hoặc $gamma_{dn} = (gamma_s - gamma_w)/(1 + e)$.
7. Tính ứng suất bản thân tại đáy từng lớp và các cao độ cần kiểm tra bằng skill `tinh-ung-suat-ban-than-dat`: $sigma_z^{bt} = sum(gamma_i h_i)$, tách lớp tại mực nước ngầm nếu mực nước nằm trong lớp.
8. Nhận xét từng lớp: trạng thái, độ chặt/độ yếu nếu có dữ liệu, khả năng chịu tải, tính nén lún, mức độ bất lợi do nước ngầm, và vai trò lớp đất đối với móng.
9. Kết luận điều kiện địa chất: lớp đất yếu cần xử lý, lớp có thể đặt móng, rủi ro lún/chênh lún/nước ngầm, phương án sơ bộ như móng nông, đệm cát hoặc móng cọc nếu có đủ cơ sở.
10. Trình bày kết quả theo cấu trúc: dữ liệu và giả định; bảng tính chỉ tiêu; bảng phân loại; biểu hoặc bảng ứng suất bản thân; nhận xét; kết luận và dữ liệu còn thiếu.

## Constraints
- Không tự bịa chỉ tiêu cơ lý còn thiếu. Nếu thiếu dữ liệu để tính, ghi rõ “chưa đủ dữ liệu” và chỉ đánh giá định tính phần còn lại.
- Không tính $I_L$ cho đất rời như cát, sỏi nếu không có cơ sở phân loại đất dính.
- Không dùng gamma tự nhiên cho phần đất dưới mực nước ngầm khi bài yêu cầu tính ứng suất hữu hiệu/đẩy nổi; phải dùng gamma_dn sau khi qua mực nước ngầm.
- Không đổi công thức hoặc ngưỡng phân loại khác với tài liệu nguồn nếu user không yêu cầu tiêu chuẩn khác.
- Không bỏ qua kiểm tra đơn vị của W, Wp, WL; các giá trị này phải cùng thang đo trước khi thay vào công thức.

## Best practices
- Với nhiều lớp đất, trình bày một dòng thay số mẫu rồi tổng hợp các lớp còn lại bằng bảng.
- Luôn ghi rõ lớp nào là đất yếu và vì sao: $I_L$ cao, gamma nhỏ, e lớn, E nhỏ, c/phi thấp hoặc nằm ngay dưới đáy móng.
- Khi mực nước ngầm cắt qua một lớp, chia lớp đó thành hai đoạn trên/dưới mực nước trong bảng tính ứng suất.
- Dùng file nguồn `TỔNG_HỢP_CÔNG_THỨC_NỀN_VÀ_MÓNG_(đã_sửa_v3).md`, Phần I, làm chuẩn công thức trong workspace này.

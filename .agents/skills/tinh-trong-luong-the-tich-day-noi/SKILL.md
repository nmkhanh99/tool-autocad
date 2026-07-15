---
name: tinh-trong-luong-the-tich-day-noi
description: "Tính trọng lượng thể tích đẩy nổi gamma_dn cho lớp đất dưới mực nước ngầm. Use when user asks tính gamma đẩy nổi, gamma_dn, trọng lượng thể tích dưới nước."
---

# Tính Trọng Lượng Thể Tích Đẩy Nổi

## Goal
Tính $gamma_{dn}$ cho phần đất nằm dưới mực nước ngầm để dùng trong ứng suất bản thân và các kiểm tra nền móng.

## When to use this skill
- User yêu cầu tính trọng lượng thể tích đẩy nổi, $gamma_{dn}$ hoặc dung trọng dưới nước.
- Bài toán có mực nước ngầm và cần tính ứng suất bản thân hữu hiệu.
- Cần tính $gamma_{dn}$ từ $gamma_{sat}$ hoặc từ $gamma_s$ và $e$.

## Instructions
1. Xác định phần lớp đất nằm dưới mực nước ngầm.
2. Xác định dữ liệu có sẵn:
   - Nếu có $gamma_{sat}$, dùng $gamma_{dn} = gamma_{sat} - gamma_w$.
   - Nếu không có $gamma_{sat}$ nhưng có $gamma_s$ và $e$, dùng $gamma_{dn} = (gamma_s - gamma_w)/(1 + e)$.
3. Dùng $gamma_w = 10$ kN/m3 nếu đề không cho giá trị khác.
4. Kiểm tra đơn vị của $gamma_{sat}$, $gamma_s$, $gamma_w$ phải cùng đơn vị.
5. Trả kết quả gồm công thức thay số, $gamma_{dn}$, nguồn dữ liệu đã dùng và ghi chú áp dụng cho đoạn dưới mực nước ngầm.

## Constraints
- Không dùng $gamma_{dn}$ cho đoạn đất nằm trên mực nước ngầm.
- Không dùng đồng thời hai công thức rồi chọn tùy ý nếu kết quả lệch lớn; phải nêu chênh lệch và kiểm tra dữ liệu.
- Không tự giả định $gamma_{sat}$, $gamma_s$ hoặc $e$ nếu đề không cho.
- Không để $gamma_{dn} \le 0$ mà không cảnh báo dữ liệu bất thường.

## Best practices
- Khi mực nước ngầm nằm trong một lớp, chia lớp thành đoạn trên MNN dùng $gamma$ tự nhiên và đoạn dưới MNN dùng $gamma_{dn}$.
- Nếu có cả $gamma_{sat}$ và công thức từ $gamma_s, e$, tính đối chiếu nhanh để phát hiện sai đơn vị.
- Giữ $gamma_{dn}$ theo kN/m3 để thay trực tiếp vào bảng ứng suất.

---
name: tinh-ung-suat-ban-than-dat
description: "Tính ứng suất bản thân sigma_z^bt theo phân lớp đất và mực nước ngầm. Use when user asks tính ứng suất bản thân, áp lực bản thân, sigma_z bt, biểu đồ ứng suất địa tầng."
---

# Tính Ứng Suất Bản Thân Đất

## Goal
Tính $sigma_z^{bt}$ tại các độ sâu cần kiểm tra bằng cách cộng trọng lượng các lớp đất theo chiều sâu, có xét mực nước ngầm.

## When to use this skill
- User yêu cầu tính ứng suất bản thân, áp lực bản thân hoặc $sigma_z^{bt}$.
- Cần lập biểu đồ ứng suất địa tầng cho tính lún, kiểm tra đệm cát hoặc cường độ nền.
- Skill tổng `danh-gia-dia-chat-cong-trinh` cần ứng suất tại đáy lớp, đáy móng hoặc đáy vùng xử lý.

## Instructions
1. Thu thập chiều dày từng lớp, vị trí mực nước ngầm, $gamma$ tự nhiên và $gamma_{dn}$ nếu lớp nằm dưới mực nước ngầm.
2. Xác định các độ sâu cần tính: đáy từng lớp, mực nước ngầm, đáy móng, đáy đệm hoặc điểm user yêu cầu.
3. Nếu mực nước ngầm nằm trong một lớp, tách lớp đó thành hai đoạn: trên MNN dùng $gamma$, dưới MNN dùng $gamma_{dn}$.
4. Tính ứng suất bản thân:
   $$sigma_z^{bt} = \sum_{i=1}^{n} gamma_i h_i$$
5. Khi xuống dưới MNN, tiếp tục cộng từ giá trị tại MNN và đổi dung trọng đoạn sau sang $gamma_{dn}$.
6. Trả kết quả bằng bảng gồm đoạn tính, chiều dày, gamma sử dụng, gia tăng ứng suất và $sigma_z^{bt}$ lũy tích.

## Constraints
- Không reset ứng suất tại mực nước ngầm; chỉ thay dung trọng dùng cho đoạn phía dưới.
- Không dùng $gamma$ tự nhiên cho phần dưới MNN nếu bài toán yêu cầu xét đẩy nổi.
- Không bỏ qua đoạn mực nước ngầm nằm giữa một lớp đất.
- Không cộng chiều dày âm hoặc vượt quá độ sâu cần tính.

## Best practices
- Giữ đơn vị nhất quán: kN/m3 nhân m cho ra kPa hoặc kN/m2.
- Với bảng địa tầng dài, tính tại các mốc quan trọng trước rồi nội suy theo đoạn nếu cần.
- Ghi rõ công thức từng đoạn khi có thay đổi dung trọng tại MNN để người đọc kiểm tra được.

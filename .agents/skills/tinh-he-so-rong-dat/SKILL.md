---
name: tinh-he-so-rong-dat
description: "Tính hệ số rỗng e của đất từ gamma_s, W và gamma. Use when user asks tính hệ số rỗng, void ratio, e của lớp đất."
---

# Tính Hệ Số Rỗng Đất

## Goal
Tính hệ số rỗng $e$ của lớp đất từ trọng lượng riêng hạt, độ ẩm tự nhiên và trọng lượng thể tích tự nhiên.

## When to use this skill
- User yêu cầu tính hệ số rỗng, void ratio hoặc $e$.
- Cần xác định $e$ để tra cường độ quy ước, nhận xét độ rỗng hoặc tính $gamma_{dn}$.
- Skill tổng `danh-gia-dia-chat-cong-trinh` cần bổ sung chỉ tiêu cơ lý cho từng lớp đất.

## Instructions
1. Thu thập $gamma_s$, W và $gamma$ của cùng một lớp đất.
2. Kiểm tra đơn vị: $gamma_s$ và $gamma$ phải cùng đơn vị, thường là kN/m3; W dùng phần trăm trong công thức.
3. Kiểm tra $gamma > 0$ và $gamma_s > 0$.
4. Tính hệ số rỗng:
   $$e = \frac{gamma_s(1 + 0.01W)}{gamma} - 1$$
5. Trả kết quả gồm công thức thay số, giá trị $e$, và nhận xét nếu $e$ âm hoặc bất thường.

## Constraints
- Không dùng công thức này nếu W đang là số thập phân nhưng chưa quy đổi về phần trăm trong biểu thức $0.01W$.
- Không trộn $gamma$ tự nhiên với $gamma_{sat}$ hoặc $gamma_{dn}$ nếu đề không chỉ rõ.
- Không tự giả định $gamma_s$ khi đề không cho.
- Không chấp nhận kết quả $e < 0$ như kết quả bình thường; phải cảnh báo dữ liệu hoặc đơn vị có vấn đề.

## Best practices
- Ghi rõ W đang dùng là phần trăm, ví dụ W = 24.5% thì thay $1 + 0.01 \times 24.5$.
- Khi tính nhiều lớp, lập bảng gồm lớp đất, $gamma_s$, W, $gamma$, $e$.
- Nếu $e$ dùng tiếp để tính $gamma_{dn}$, giữ đủ chữ số trung gian rồi mới làm tròn kết quả cuối.

---
name: tinh-do-set-dat-dinh
description: "Tính độ sệt IL của đất dính và phân loại trạng thái theo W, WL, Wp. Use when user asks tính độ sệt, chỉ số sệt, IL, trạng thái đất dính."
---

# Tính Độ Sệt Đất Dính

## Goal
Tính chỉ số độ sệt $I_L$ của đất dính và phân loại trạng thái vật lý theo công thức trong tài liệu nền móng của workspace.

## When to use this skill
- User yêu cầu tính độ sệt, chỉ số sệt hoặc $I_L$.
- User cần phân loại trạng thái đất dính từ W, WL, Wp.
- Skill tổng `danh-gia-dia-chat-cong-trinh` cần tính trạng thái cho từng lớp đất dính.

## Instructions
1. Xác nhận đất đang xét là đất dính và có đủ W, Wp, WL.
2. Chuẩn hóa W, Wp, WL về cùng thang đo. Công thức trong tài liệu dùng giá trị phần trăm, ví dụ 28, không phải 0.28.
3. Kiểm tra điều kiện hợp lệ: $W_L > W_p$. Nếu không thỏa, dừng tính và báo dữ liệu sai hoặc cần kiểm tra lại.
4. Tính độ sệt:
   $$I_L = \frac{W - W_p}{W_L - W_p}$$
5. Phân loại trạng thái:
   - $I_L < 0$: cứng.
   - $0 \le I_L \le 0.25$: nửa cứng hoặc dẻo cứng.
   - $0.25 < I_L \le 0.5$: dẻo vừa.
   - $0.5 < I_L \le 0.75$: dẻo mềm.
   - $0.75 < I_L \le 1.0$: dẻo nhão.
   - $I_L > 1.0$: nhão hoặc chảy.
6. Trả kết quả gồm công thức thay số, giá trị $I_L$ làm tròn hợp lý, trạng thái và nhận xét nếu W nằm ngoài khoảng Wp đến WL.

## Constraints
- Không tính $I_L$ nếu thiếu một trong ba giá trị W, Wp, WL.
- Không dùng cho đất rời nếu đề không xác định là đất dính.
- Không tự chuyển phần trăm sang số thập phân nếu ba giá trị đã cùng thang đo; tỷ số không đổi nhưng phần thay số phải nhất quán.
- Không phân loại khi $W_L \le W_p$.

## Best practices
- Làm tròn $I_L$ đến 2 hoặc 3 chữ số thập phân tùy độ chính xác dữ liệu đầu vào.
- Nếu $I_L < 0$ hoặc $I_L > 1$, nhấn mạnh đây là trạng thái ngoài khoảng dẻo thông thường và cần kiểm tra lại mẫu nếu kết quả bất thường.
- Khi tính nhiều lớp, dùng bảng gồm lớp đất, W, Wp, WL, $I_L$, trạng thái.

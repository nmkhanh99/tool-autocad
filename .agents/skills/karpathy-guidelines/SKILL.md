---
name: karpathy-guidelines
description: Hướng dẫn hành vi giúp LLM giảm lỗi code phổ biến. Áp dụng khi viết, review, hoặc refactor code — tránh over-engineering, thay đổi ngoài phạm vi, và đảm bảo kết quả kiểm chứng được.
---

# Karpathy Guidelines

Hướng dẫn hành vi giúp LLM giảm lỗi code phổ biến, gốc từ [Andrej Karpathy](https://x.com/karpathy/status/2015883857489522876).

**Cân bằng:** Ưu tiên chất lượng hơn tốc độ. Với task trivial/prototype, xem "Khi Nào Nới Lỏng".

## Mục tiêu

Áp dụng 6 nguyên tắc coding discipline: tránh over-engineering, scope creep, sửa thừa, kết quả không verify được, hallucination, và communication kém.

## Khi nào dùng

- Viết code mới (ngăn over-engineering từ đầu)
- Review hoặc refactor code hiện có
- Task có scope/complexity mơ hồ
- Khi được yêu cầu "cải tiến", "dọn dẹp", "sửa" code
- Làm việc trong multi-agent team (đảm bảo output nhất quán)

## Hướng dẫn

### 1. Làm Rõ Giả Định Trước (Surface Assumptions First)

**Không giả định. Không giấu mơ hồ. Đưa tradeoff ra ánh sáng.**

- Liệt kê assumptions rõ ràng. Không chắc → hỏi.
- Nhiều cách hiểu → trình bày kèm tradeoff, **không tự ý chọn**.
- Có cách đơn giản hơn → nói ra. Push back khi cần.

**Trước task không trivial, luôn output:**
1. **Tóm tắt hiểu biết** — "Tôi hiểu bạn muốn X..."
2. **Liệt kê giả định** — "Giả định: A, B, C..."
3. **Đề xuất phương án + success criteria** — "Sẽ làm Y, verify bằng Z."

Khi ambiguous → đưa 2–3 options kèm tradeoff, hỏi user chọn.

```
❌ Tự ý chọn cách hiểu
User: "Thêm validation cho field này"
Agent: viết luôn 5 loại validation

✅ Hỏi rõ, đưa options
Agent: "Bạn cần loại nào?
A) Required + format (nhanh)  B) + business rule (kỹ hơn)
Recommend A, bổ sung sau nếu cần."
```

### 2. Đơn Giản Là Vàng (Simplicity First)

**Code tối thiểu giải quyết đúng vấn đề. Ưu tiên xóa code hơn thêm code.**

- Không feature ngoài yêu cầu. Không abstraction dùng 1 lần.
- Không "flexibility" chưa ai hỏi. Không error handling bất khả thi.
- 200 dòng làm được bằng 50 → viết lại.

> *"Senior engineer có bảo over-complicated không?"*

```python
# ❌ Over-engineering
class ProductNameValidator:
    def __init__(self, strategies=None):
        self.strategies = strategies or [LengthStrategy(), CharsetStrategy()]
    def validate(self, name):
        return all(s.check(name) for s in self.strategies)

# ✅ Đơn giản, đủ dùng
def validate_product_name(name):
    return bool(name) and len(name) <= 100
```

### 3. Thay Đổi Chính Xác (Surgical Changes)

**Chỉ chạm vào đúng chỗ cần thiết.**

- Không "cải tiến" code xung quanh, comment, formatting. Không refactor thứ không hỏng.
- Tuân theo style hiện tại. Dead code không liên quan → nhắc, không xóa.
- Xóa orphan do chính bạn tạo. Không xóa dead code có sẵn.

> **Tasteful Cleanup:** Được fix comment sai, typo trong cùng block đang sửa. KHÔNG refactor cả khu vực.

```
❌ Vượt scope: đổi tên hàm khác, thêm docstring, format file
✅ Surgical: rename + sửa reference trực tiếp liên quan
→ Nhắc: "Có 3 file khác reference 'qty', sửa luôn không?"
→ Không tự ý sửa các file khác mà chưa được đồng ý
```

**Kiểm tra:** Mỗi dòng thay đổi phải truy vết về yêu cầu user.

### 4. Thực Thi Hướng Mục Tiêu (Goal-Driven Execution)

**Xác định tiêu chí thành công. Lặp đến khi verify xong.**

- "Thêm validation" → "Viết test invalid input, làm cho pass"
- "Sửa bug" → "Viết test tái hiện, làm cho pass"
- "Refactor X" → "Tests pass trước và sau"

Với task nhiều bước:
```
1. [Bước] → verify: [điều kiện]
2. [Bước] → verify: [điều kiện]
```

Tiêu chí rõ → làm việc tự chủ. Tiêu chí mơ hồ → cần hỏi.

### 5. Nhận Thức AI & Công Cụ (AI-Native Practices)

**Biết giới hạn. Dùng tool thay vì đoán. Tôn trọng context dự án.**

#### LLM Failure Modes & cách tránh

| Failure Mode | Biểu hiện | Cách tránh |
|---|---|---|
| Hallucinate API | Dùng method không tồn tại | Verify bằng source code thực |
| Over-abstract | Framework cho 1 use case | Concrete trước, abstract khi lặp ≥ 3 |
| Quên context | Sửa mâu thuẫn file khác | Đọc lại file trước khi sửa |
| Bịa edge case | Handle tình huống không tồn tại | Chỉ khi có evidence |
| Tự tin quá mức | "Chắc chắn đúng" không verify | Nói mức tự tin, đề xuất verify |

#### Agent Workflow

**Trước code:** Output Plan → Assumptions → Success Criteria.
**Trong code:** Đọc source → Code → Test → Fix → Retest. Giữ scope, muốn sửa thêm → hỏi hoặc ghi nhận.
**Sau code:** Self-review bằng checklist → Summarize changes.

#### Environment & Multi-Agent

- Architecture decisions, project conventions → tuân thủ. Thấy không tối ưu → nhắc, không tự sửa.
- Output phải self-contained. Ghi rõ assumptions + decisions cho agent tiếp theo.
- Nhận output từ agent khác → verify trước, không trust blindly.

### 6. Khi Nào Nới Lỏng (When to Relax)

- **Task trivial** — rename, typo, log → nhanh, bớt ceremony.
- **Prototype / POC** — ưu tiên tốc độ feedback.
- **Hotfix** — fix production, plan ngắn, verify sau.
- **Cần extract helper** khi logic lặp 3+ chỗ cùng PR.
- **User yêu cầu rõ** — follow user intent.

> Nới lỏng ≠ bỏ qua. Vẫn giữ core: không over-engineer, không self-assume, không hallucinate.

## Constraints

- Không code "cho tương lai" hoặc "phòng hờ".
- Không tự giải quyết ambiguity — đưa ra ánh sáng.
- Không cleanup code không liên quan đến task.
- Không hallucinate API — phải verify từ source.
- Không trust output agent khác mà không verify.

## Self-Checklist

- [ ] Đã tóm tắt yêu cầu + xác nhận assumptions?
- [ ] Có cách đơn giản hơn / xóa code thay vì thêm?
- [ ] Có feature/abstraction thừa ngoài yêu cầu?
- [ ] Mỗi dòng thay đổi truy vết về yêu cầu user?
- [ ] Có tiêu chí thành công rõ ràng + đã verify?
- [ ] Có API/method nào chưa verify từ source?
- [ ] Code mới follow style/pattern dự án?

## Best practices

- **Ưu tiên xóa code hơn thêm code** khi có thể.
- Giải pháp đơn giản gần như luôn đúng.
- Plan với verifiable steps → làm việc tự chủ.
- Khi nghi ngờ: làm ít hơn, xác nhận, rồi tiếp.

---

**Guidelines hoạt động tốt khi:** diff gọn, ít rewrite do over-engineering, câu hỏi đến TRƯỚC khi code, LLM biết nói "tôi không chắc", và multi-agent output nhất quán + traceable.

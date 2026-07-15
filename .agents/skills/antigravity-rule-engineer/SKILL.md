---
name: antigravity-rule-engineer
description: "Quản lý toàn bộ vòng đời Rules trong Antigravity: tạo mới, đánh giá/review và chỉnh sửa/cải tiến Rule theo đúng chuẩn chính thức của Google. Use when the user asks to create, build, review, evaluate, improve, refine or fix any Rule."
---

# Antigravity Rule Engineer

## When to use this skill
- “tạo rule mới”, “build rule”, “create rule”
- “đánh giá rule”, “review rule”, “evaluate rule”
- “chỉnh sửa rule”, “improve rule”, “cải tiến rule”

## Decision Tree
1. Chứa “tạo mới / build / create” → mode CREATE  
2. Chứa “đánh giá / review / evaluate” → mode REVIEW  
3. Chứa “chỉnh sửa / improve / refine” → mode IMPROVE

## Instructions
1. Xác định mode.
2. Chạy script (hỗ trợ chọn activation):
   - `python scripts/rule_engineer.py --create <tên-rule> --desc "<mô tả>" --activation "Always On"`
   - `python scripts/rule_engineer.py --review <đường_dẫn_rule.md>`
   - `python scripts/rule_engineer.py --improve <đường_dẫn_rule.md> --suggestions "<gợi ý>"`
3. Dùng template + ACTIVATION_MODES.md + checklist.

## Constraints
- Rule là Markdown thuần (không frontmatter).
- Giữ dưới 12.000 ký tự/file.
- Mỗi rule chỉ làm một việc.

## Best practices
- Luôn đọc `resources/ACTIVATION_MODES.md` trước khi tạo.
- Dùng Glob cho rule liên quan file.
- Dùng @ References để tái sử dụng.

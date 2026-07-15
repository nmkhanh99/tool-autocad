---
name: antigravity-skill-engineer
description: "Quản lý toàn bộ vòng đời Skill Antigravity theo đúng chuẩn Google: tạo mới, đánh giá/review và chỉnh sửa/hoàn thiện skill có sẵn. Use when the user asks to create, build, review, evaluate, improve, refine or fix any Antigravity Skill."
---

# Antigravity Skill Engineer

## Goal
Tạo và duy trì các Skill đúng 100% format chính thức từ antigravity.google/docs/skills và codelab, giúp agent làm việc hiệu quả hơn qua progressive disclosure.

## When to use this skill
- “tạo skill mới”, “build skill”, “generate skill”
- “đánh giá skill”, “review skill”, “evaluate skill”
- “chỉnh sửa skill”, “improve skill”, “hoàn thiện skill”, “refine skill”

## Decision Tree
1. Chứa “tạo mới / build / generate” → mode CREATE  
2. Chứa “đánh giá / review / evaluate” → mode REVIEW  
3. Chứa “chỉnh sửa / improve / refine” → mode IMPROVE

## Instructions
1. Xác định mode theo Decision Tree.
2. Chạy script (hỗ trợ Global):
   - `python scripts/skill_engineer.py --create <skill_name> --desc "<mô tả>" [--global]`
   - `python scripts/skill_engineer.py --review <đường_dẫn_SKILL.md>`
   - `python scripts/skill_engineer.py --improve <đường_dẫn_SKILL.md> --suggestions "<gợi ý>"`
3. Luôn đọc `resources/SKILL_STRUCTURE_GUIDE.md` và checklist trước khi tạo.
4. Sau khi xong: liệt kê cấu trúc thư mục + cách test.

## Constraints
- Mỗi skill chỉ làm một việc duy nhất (single responsibility).
- Frontmatter chỉ có name + description (description bắt buộc).
- Không thay đổi cấu trúc thư mục chuẩn của Google.

## Best practices
- Description phải chứa trigger rõ ràng để progressive disclosure hoạt động tốt.
- Giữ SKILL.md ngắn gọn (<150 dòng).
- Tham khảo examples/ và SKILL_STRUCTURE_GUIDE.md để chuẩn hãng.

---
name: antigravity-workflow-engineer
description: Tạo mới, đánh giá/review và cải tiến Workflows (slash commands /tên-workflow) theo đúng chuẩn chính thức của Google Antigravity. Use when the user asks to create, build, review, evaluate, improve or refine any workflow or slash command.
---

# Antigravity Workflow Engineer

## Goal
Xây dựng các Workflow tự động chạy pipeline (Skills + Rules + Agents) một cách chuẩn chính thức, giúp biến Antigravity thành AI team tự vận hành.

## When to use this skill
- “tạo workflow”, “build slash command”, “tạo /new-feature”
- “đánh giá workflow”, “review workflow”, “cải tiến workflow”

## Decision Tree
1. Chứa “tạo mới / build” → mode CREATE  
2. Chứa “đánh giá / review / evaluate” → mode REVIEW  
3. Chứa “cải tiến / refine” → mode IMPROVE

## Instructions
1. Xác định mode theo Decision Tree.
2. Chạy script:
   - `python scripts/workflow_engineer.py --create <workflow-name> --desc "<mô tả>"`
   - `python scripts/workflow_engineer.py --review .agents/workflows/<file>.md`
   - `python scripts/workflow_engineer.py --improve .agents/workflows/<file>.md --suggestions "<gợi ý>"`
3. Sau khi xong: liệt kê cách chạy `/tên-workflow` và cách test.

## Constraints
- Workflow chỉ là Markdown thuần (không frontmatter bắt buộc).
- Giữ dưới 12.000 ký tự/file.
- Không được chạm vào 3 base skills hoặc @meta-engineer.

## Best practices
- Workflow nên gọi nested workflow khi cần.
- Luôn pause cho user approve ở bước quan trọng.
- Tham khảo examples/ để học pattern chuẩn hãng.
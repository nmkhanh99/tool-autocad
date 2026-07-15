---
name: antigravity-agent-architect
description: Phân tích dự án và xác định Multi-Agent Team chuẩn cần thiết. Tạo/cải tiến file .agents/agents.md theo đúng format chính thức của Google Antigravity. Use when the user asks to design, build, define, review or optimize AI team / agents / multi-agent pipeline.
---

# Antigravity Agent Architect

## Goal
Xác định chính xác các Agent (persona) cần thiết cho dự án, tạo file .agents/agents.md chuẩn để Agent Manager hoạt động như một đội ngũ chuyên nghiệp.

## When to use this skill
- “xác định agents”, “thiết kế team agent”, “build multi-agent”, “tạo agents.md”
- “review team agent”, “cải tiến agents”, “optimize AI team”

## Decision Tree
1. Chứa “tạo mới / build / thiết kế / xác định” → mode CREATE  
2. Chứa “review / đánh giá / evaluate” → mode REVIEW  
3. Chứa “cải tiến / improve / optimize” → mode IMPROVE

## Instructions
1. Phân tích dự án (đọc code, package.json, README, yêu cầu user).
2. Chạy script:
   - `python scripts/agent_architect.py --create --project-type "FastAPI + React"`
   - `python scripts/agent_architect.py --review .agents/agents.md`
   - `python scripts/agent_architect.py --improve .agents/agents.md --suggestions "thêm QA và DevOps"`
3. Dùng template từ `resources/AGENT_TEMPLATE.md` và checklist.
4. Sau khi xong: liệt kê các role + cách dùng @role trong chat.

## Constraints
- Mỗi persona chỉ chịu trách nhiệm 1 lĩnh vực rõ ràng.
- Phải có @role để mention trong chat.
- Không được để 1 agent làm hết mọi việc.

## Best practices
- Luôn đọc `resources/COMMON_ROLES.md` để chọn role chuẩn.
- Giữ mỗi persona có Goal + Traits + Constraint.
- Bắt đầu với 4-6 role cho hầu hết dự án.
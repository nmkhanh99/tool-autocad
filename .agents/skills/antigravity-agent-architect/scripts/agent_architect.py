import sys
from pathlib import Path
import argparse

def create_team(project_type: str):
    agents_file = Path(".agents/agents.md")
    agents_file.parent.mkdir(parents=True, exist_ok=True)
    
    template = Path(".agents/skills/antigravity-agent-architect/resources/AGENT_TEMPLATE.md").read_text()
    content = "# Autonomous Development Team for " + project_type + "\n\n"
    
    # Thêm các role cơ bản
    roles = ["Product Manager (@pm)", "Full-Stack Engineer (@engineer)", "QA Engineer (@qa)", "DevOps Master (@devops)"]
    for role in roles:
        content += template.replace("[Role Name]", role.split(" ")[0]).replace("[mô tả senior level]", "senior specialist") + "\n\n"
    
    agents_file.write_text(content)
    print(f"✅ Đã tạo .agents/agents.md cho dự án {project_type}")
    print("   Bây giờ bạn có thể dùng @pm, @engineer, @qa trong chat!")

# review và improve tương tự (bạn có thể mở rộng)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--create", action="store_true")
    parser.add_argument("--project-type", type=str, default="General Project")
    # --review, --improve...
    args = parser.parse_args()
    if args.create:
        create_team(args.project_type)
import sys
from pathlib import Path
import argparse

def create_skill(name: str, desc: str = "", global_skill: bool = False):
    if global_skill:
        base = Path.home() / ".gemini" / "antigravity" / "skills" / name
        mode = "Global"
    else:
        base = Path(".agents/skills") / name
        mode = "Workspace"
    
    base.mkdir(parents=True, exist_ok=True)
    (base / "scripts").mkdir(exist_ok=True)
    (base / "resources").mkdir(exist_ok=True)
    (base / "examples").mkdir(exist_ok=True)
    
    template = Path(".agents/skills/antigravity-skill-engineer/resources/SKILL_TEMPLATE.md").read_text()
    content = template.replace("[tên-skill]", name).replace("[Mô tả ngắn gọn + trigger rõ ràng]", desc or f"Skill chuyên xử lý {name.replace('-', ' ')}")
    (base / "SKILL.md").write_text(content)
    
    print(f"✅ Đã tạo Skill {mode}: {base}")
    print("   Đọc resources/SKILL_STRUCTURE_GUIDE.md để kiểm tra chuẩn hãng")

# review_skill và improve_skill giữ nguyên như phiên bản cũ (bạn có thể copy lại)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--create", type=str)
    parser.add_argument("--desc", type=str, default="")
    parser.add_argument("--global", action="store_true")
    # --review và --improve giống trước
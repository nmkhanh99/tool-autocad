import sys
from pathlib import Path
import argparse

def create_rule(name: str, desc: str = "", activation: str = "Always On", global_rule: bool = False):
    if global_rule:
        file_path = Path.home() / ".gemini" / "GEMINI.md"
    else:
        Path(".agents/rules").mkdir(parents=True, exist_ok=True)
        file_path = Path(".agents/rules") / f"{name}.md"
    
    template = Path(".agents/skills/antigravity-rule-engineer/resources/RULE_TEMPLATE.md").read_text()
    content = template.replace("[Tên Rule Đẹp]", name.replace('-', ' ').title())
    content = content.replace("- Always On", f"- {activation}")
    content = content.replace("## Rules\n- Ràng buộc rõ ràng và cụ thể.", f"## Rules\n- {desc or 'Ràng buộc theo yêu cầu'}")
    
    file_path.write_text(content)
    print(f"✅ Đã tạo Rule ({activation}) tại: {file_path}")
    print(f"   Mode: {activation} | Xem ACTIVATION_MODES.md để hiểu rõ")

# (phần review và improve giữ nguyên như cũ, chỉ cần copy từ phiên bản trước)

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--create", type=str)
    parser.add_argument("--desc", type=str, default="")
    parser.add_argument("--activation", type=str, default="Always On", choices=["Always On", "Manual", "Model Decision", "Glob"])
    parser.add_argument("--global", action="store_true")
    # ... (thêm --review, --improve như trước)
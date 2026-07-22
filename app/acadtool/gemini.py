"""Tích hợp Gemini AI vào acadtool (Offline core của AutoCAD Toolkit).

Cung cấp khả năng phân tích bản vẽ DWG/DXF, trả lời câu hỏi về bản vẽ,
và sinh mã AutoLISP bằng Google Gemini AI từ CLI.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from .model import Drawing

import shutil
import subprocess

DEFAULT_MODEL = "gemini-2.5-flash"


def find_agy_bin() -> str | None:
    """Tìm đường dẫn tới CLI `agy` (Google Antigravity CLI)."""
    path = shutil.which("agy")
    if path:
        return path
    home = os.environ.get("HOME", "")
    candidate = os.path.join(home, ".local/bin/agy")
    if os.path.exists(candidate):
        return candidate
    return None


def get_api_key(provided_key: str | None = None) -> str | None:
    """Lấy Gemini API key từ argument hoặc biến môi trường GEMINI_API_KEY / GOOGLE_API_KEY."""
    key = provided_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    return key.strip() if key else None


def call_gemini(
    prompt: str,
    system_instruction: str = "",
    api_key: str | None = None,
    model: str | None = None,
) -> str:
    """Gọi Gemini AI thông qua agy CLI (không cần API Key) hoặc REST API (khi có API key)."""
    full_prompt = prompt
    if system_instruction:
        full_prompt = f"{system_instruction}\n\n{prompt}"

    key = get_api_key(api_key)
    agy_path = find_agy_bin()

    # Ưu tiên sử dụng agy CLI khi không có API key hoặc khi tìm thấy agy CLI trên máy
    if agy_path and not key:
        cmd = [agy_path, "--dangerously-skip-permissions", "-p", full_prompt]
        if model:
            cmd.extend(["--model", model])
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
            if res.returncode == 0 and res.stdout.strip():
                return res.stdout.strip()
            elif res.stderr.strip():
                raise RuntimeError(f"Lỗi agy CLI: {res.stderr.strip()}")
        except Exception as e:
            if not key:
                raise RuntimeError(f"Lỗi khi thực thi agy CLI: {e}") from e

    # Fallback dùng Direct REST API nếu người dùng cung cấp API Key
    if not key and not agy_path:
        raise ValueError(
            "Không tìm thấy CLI `agy` và cũng không có GEMINI_API_KEY.\n"
            "Vui lòng đảm bảo CLI `agy` có trong PATH (~/.local/bin/agy) hoặc thiết lập GEMINI_API_KEY."
        )

    selected_model = model or os.environ.get("GEMINI_MODEL") or DEFAULT_MODEL
    url = f"https://generativelanguage.googleapis.com/v1beta/models/{selected_model}:generateContent?key={key}"

    payload = {
        "contents": [
            {
                "parts": [
                    {"text": prompt}
                ]
            }
        ]
    }
    if system_instruction:
        payload["systemInstruction"] = {
            "parts": [
                {"text": system_instruction}
            ]
        }

    headers = {"Content-Type": "application/json"}

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            resp_data = json.loads(resp.read().decode("utf-8"))
            candidates = resp_data.get("candidates", [])
            if not candidates:
                return "Gemini không phản hồi (không có candidates trong kết quả)."
            parts = candidates[0].get("content", {}).get("parts", [])
            text_result = "".join(p.get("text", "") for p in parts)
            return text_result.strip()
    except urllib.error.HTTPError as e:
        err_msg = e.read().decode("utf-8", errors="ignore")
        try:
            err_json = json.loads(err_msg)
            message = err_json.get("error", {}).get("message", err_msg)
        except Exception:
            message = err_msg
        raise RuntimeError(f"Lỗi kết nối Gemini API (HTTP {e.code}): {message}") from e
    except urllib.error.URLError as e:
        raise RuntimeError(f"Lỗi mạng khi kết nối Gemini API: {e.reason}") from e



def format_drawing_context(drawings: list[Drawing]) -> str:
    """Trích xuất thông tin cấu trúc bản vẽ để gửi làm ngữ cảnh cho Gemini."""
    lines = []
    lines.append(f"Tổng số bản vẽ: {len(drawings)}\n")

    for i, d in enumerate(drawings, 1):
        lines.append(f"=== Bản vẽ #{i}: {d.name} ({d.path.name}) ===")
        lines.append(f"- Layers ({len(d.layers)}): {', '.join(d.layers[:30])}" + ("..." if len(d.layers) > 30 else ""))
        
        # Thống kê layer usage
        top_layers = sorted(d.layer_usage.items(), key=lambda x: x[1], reverse=True)[:10]
        usage_str = ", ".join(f"{k}: {v}" for k, v in top_layers)
        lines.append(f"- Top layers sử dụng: {usage_str}")

        # Block inserts
        block_counts: dict[str, int] = {}
        for ins in d.inserts:
            block_counts[ins.name] = block_counts.get(ins.name, 0) + 1
        top_blocks = sorted(block_counts.items(), key=lambda x: x[1], reverse=True)[:10]
        blocks_str = ", ".join(f"{k}: {v}" for k, v in top_blocks)
        lines.append(f"- Blocks ({len(d.inserts)} inserts, {len(block_counts)} loại): {blocks_str}")

        # Sample attributes from block inserts (khung tên, v.v.)
        attrib_samples = []
        for ins in d.inserts:
            if ins.attribs:
                for k, v in ins.attribs.items():
                    if v and len(attrib_samples) < 15:
                        attrib_samples.append(f"{ins.name}.{k}='{v}'")
        if attrib_samples:
            lines.append(f"- Block attributes tiêu biểu: {', '.join(attrib_samples)}")

        # Texts sample
        sample_texts = [t[0].strip() for t in d.texts if t[0].strip()][:15]
        if sample_texts:
            lines.append(f"- Mẫu Text/MText ({len(d.texts)}): {'; '.join(sample_texts)}")

        # Pipes stats
        if d.pipes:
            total_len = sum(p.length for p in d.pipes)
            lines.append(f"- Đoạn nét/ống ({len(d.pipes)} đoạn): Tổng chiều dài bản vẽ ~{round(total_len, 1)} mm (~{round(total_len/1000, 1)} m)")
        lines.append("")

    return "\n".join(lines)


def analyze_drawings(
    drawings: list[Drawing],
    custom_prompt: str = "",
    api_key: str | None = None,
    model: str | None = None,
) -> str:
    """Phân tích toàn bộ bản vẽ với Gemini AI."""
    ctx = format_drawing_context(drawings)
    system_inst = (
        "Bạn là một chuyên gia CAD & Kỹ sư Xây dựng/MEP hàng đầu. "
        "Hãy phân tích dữ liệu bản vẽ AutoCAD được cung cấp dưới dạng cấu trúc metadata "
        "và đưa ra nhận xét chuyên môn, đánh giá chất lượng layer, khung tên, thiết bị, "
        "và các khuyến nghị cải tiến."
    )
    user_prompt = f"Dưới đây là thông tin cấu trúc dữ liệu bản vẽ AutoCAD:\n\n{ctx}\n"
    if custom_prompt:
        user_prompt += f"Yêu cầu bổ sung của người dùng: {custom_prompt}\n"
    else:
        user_prompt += (
            "Hãy tổng hợp phân tích bản vẽ này gồm:\n"
            "1. Tóm tắt tổng quan bộ bản vẽ.\n"
            "2. Đánh giá hệ thống Layer & đặt tên (có tuân thủ chuẩn không, layer nào cần gom/chuẩn hoá).\n"
            "3. Đánh giá thống kê thiết bị / Block / Thẻ khung tên.\n"
            "4. Các lỗi tiềm ẩn hoặc điểm cần chú ý khi làm việc với file này."
        )

    return call_gemini(user_prompt, system_instruction=system_inst, api_key=api_key, model=model)


def ask_drawings(
    drawings: list[Drawing],
    question: str,
    api_key: str | None = None,
    model: str | None = None,
) -> str:
    """Trả lời câu hỏi về bản vẽ dùng Gemini AI."""
    ctx = format_drawing_context(drawings)
    system_inst = (
        "Bạn là trợ lý AI thông minh tích hợp trong CLI acadtool của AutoCAD Toolkit. "
        "Trả lời ngắn gọn, chính xác dựa trên dữ liệu bản vẽ được cung cấp."
    )
    user_prompt = (
        f"Dữ liệu bản vẽ AutoCAD:\n\n{ctx}\n\n"
        f"Câu hỏi của người dùng: {question}"
    )
    return call_gemini(user_prompt, system_instruction=system_inst, api_key=api_key, model=model)


def generate_lisp(
    prompt: str,
    api_key: str | None = None,
    model: str | None = None,
) -> str:
    """Sinh mã AutoLISP dựa trên yêu cầu ngôn ngữ tự nhiên."""
    system_inst = (
        "Bạn là chuyên gia lập trình AutoLISP / Visual LISP cho AutoCAD. "
        "Hãy viết mã AutoLISP hoàn chỉnh, sạch mẽ, có comment giải thích bằng tiếng Việt, "
        "sử dụng đúng syntax AutoCAD AutoLISP (định nghĩa lệnh dạng `defun c:TÊN_LỆNH () ...`). "
        "Chỉ trả về mã LISP nằm trong markdown block ```lisp ... ```."
    )
    user_prompt = f"Yêu cầu viết AutoLISP script: {prompt}"
    return call_gemini(user_prompt, system_instruction=system_inst, api_key=api_key, model=model)

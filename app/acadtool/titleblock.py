"""Khung tên: đọc trường ATTRIB, sinh mã KHBV từ tên file, soát lỗi.

WRITE-back (điền hàng loạt vào .dwg) cần backend ODA — sẽ bổ sung sau.
Hiện tại module này lo phần ĐỌC + KIỂM TRA, đủ để audit cả bộ bản vẽ.
"""
from __future__ import annotations

import re
import unicodedata
from dataclasses import dataclass

from .model import Drawing

# Tag ATTRIB -> tên trường dễ đọc (khớp khung tên thực tế của bộ bản vẽ).
TITLE_TAGS: dict[str, str] = {
    "KHBV": "Mã hiệu bản vẽ",
    "TENBANVE1_001": "Tên bản vẽ",
    "XX/YY/ZZZZ": "Số tờ / năm",
    "DD/MM/YYYY": "Ngày",
    "VE1_001": "Người vẽ 1",
    "VE2_001": "Người vẽ 2",
    "THIETKE_001": "Thiết kế",
    "CHUTRIBOMON_001": "Chủ trì bộ môn",
    "CHUNHIEM": "Chủ nhiệm",
}

# Nhận diện trường khung tên trong bản vẽ.
_TB_KEYS = {"KHBV", "TENBANVE1_001", "TENBANVE1", "THIETKE_001"}

# Từ khoá hệ thống trong tên file -> mã hệ.
_SYSTEMS: list[tuple[re.Pattern, str]] = [
    (re.compile(r"cap\s*nuoc", re.I), "CN"),    # cấp nước
    (re.compile(r"thoat\s*nuoc", re.I), "TN"),  # thoát nước
    (re.compile(r"thong\s*hoi", re.I), "TH"),   # thông hơi
    (re.compile(r"chua\s*chay|pccc", re.I), "CC"),
]


def _ascii(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()


def read_titleblock(d: Drawing) -> dict[str, str]:
    """Gộp các trường khung tên của 1 bản vẽ thành dict {tag: value}."""
    merged: dict[str, str] = {}
    for ins in d.inserts:
        if _TB_KEYS & set(ins.attribs):
            for tag, val in ins.attribs.items():
                # Không cho giá trị rỗng đè giá trị đã có.
                if val or tag not in merged:
                    merged[tag] = val
    return merged


def gen_khbv(filename: str) -> str | None:
    """Sinh mã KHBV mong muốn ME-[hệ]-T[tầng] từ tên file as-built.

    Vd: '...He thong thoat nuoc tang 7...' -> 'ME-TN-T07'.
    Trả None nếu không nhận ra hệ hoặc tầng.
    """
    name = _ascii(filename)
    sys_code = next((code for rx, code in _SYSTEMS if rx.search(name)), None)
    # Nhóm tầng ĐẦU TIÊN = tầng hệ thống (có thể là danh sách "5, 6, 7").
    grp = re.search(r"tang\s*([\d ,]*\d)", name, re.I)
    if not sys_code or not grp:
        return None
    nums = re.findall(r"\d+", grp.group(1))
    floor = int(nums[-1])  # trong nhóm: số cuối (vd "5, 6, 7" -> 7)
    return f"ME-{sys_code}-T{floor:02d}"


@dataclass
class TitleAudit:
    sheet: str
    khbv_actual: str
    khbv_expected: str | None
    title: str
    issues: list[str]


def audit_titleblock(d: Drawing) -> TitleAudit:
    tb = read_titleblock(d)
    actual = tb.get("KHBV", "")
    expected = gen_khbv(d.name)
    title = tb.get("TENBANVE1_001") or tb.get("TENBANVE1") or ""

    issues: list[str] = []
    if not actual or actual in ("NO.", "TENBANVE"):
        issues.append("KHBV trống/placeholder")
    elif expected and actual.upper() != expected.upper():
        issues.append(f"KHBV lệch (đang '{actual}', nên '{expected}')")
    if not tb.get("DD/MM/YYYY"):
        issues.append("thiếu Ngày")
    if not title:
        issues.append("thiếu Tên bản vẽ")
    return TitleAudit(d.name, actual, expected, title, issues)

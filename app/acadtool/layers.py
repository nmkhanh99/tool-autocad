"""Chuẩn hoá layer: phân loại 143 layer hỗn loạn về bộ chuẩn đề xuất.

ĐÂY LÀ ĐỀ XUẤT (rút từ bản vẽ mẫu) — cần bạn xác nhận/khớp chuẩn công ty.
Sửa bảng _MAP bên dưới để đổi tên layer chuẩn. Phần ÁP đổi tên vào .dwg cần
kênh ghi trong AutoCAD.
"""
from __future__ import annotations

import re
import unicodedata
from collections import defaultdict
from dataclasses import dataclass

from .model import Drawing


def _norm(s: str) -> str:
    return unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode().lower()


# (regex trên tên đã chuẩn-hoá-ascii-lowercase, layer chuẩn, nhóm)
# Thứ tự quan trọng: hệ MEP và luật cụ thể đặt TRƯỚC luật chung.
_MAP: list[tuple[re.Pattern, str, str]] = [
    (re.compile(r"nuoclanh|cap ?nuoc|dccd-?nuoc"), "ME-CAP-NUOC", "MEP"),
    (re.compile(r"thoat ?xi|^p-?thoatxi"), "ME-THOAT-XI", "MEP"),
    (re.compile(r"thoat ?rua|^p-?thoatrua"), "ME-THOAT-RUA", "MEP"),
    (re.compile(r"thong ?hoi|^p-?thonghoi"), "ME-THONG-HOI", "MEP"),
    (re.compile(r"thiet ?bi|dccd-?thietbi"), "ME-THIET-BI", "MEP"),
    (re.compile(r"hientrang|hien trang"), "ME-HIEN-TRANG", "MEP"),
    (re.compile(r"^dccd|ct-?leader|^leader\b"), "ME-GHI-CHU", "MEP"),
    (re.compile(r"khung ?ban ?ve|khung ?ten|khung b\b"), "KHUNG-TEN", "Khung tên"),
    (re.compile(r"\bdim|kich ?thuoc|xmt.?dim|^a15|a\.dim"), "DIM", "Ghi chú"),
    (re.compile(r"hatch|pattern|-hat\b|0-hat"), "HATCH", "Ghi chú"),
    (re.compile(r"\bchu\b|\btext\b|^a16|ailand|0-text"), "TEXT", "Ghi chú"),
    (re.compile(r"tuong|\bwall\b|^a2\b"), "KT-TUONG", "Kiến trúc"),
    (re.compile(r"be ?tong|concrete|^a1\b"), "KT-BE-TONG", "Kiến trúc"),
    (re.compile(r"door|window|\bcua\b|^a7\b"), "KT-CUA", "Kiến trúc"),
    (re.compile(r"noi ?that|furnitur|^a8\b|noithat"), "KT-NOI-THAT", "Kiến trúc"),
    (re.compile(r"^a[3-6]\b|net (thay|manh|tim|dut|cua)|normal_?line"),
     "KT-NET", "Kiến trúc"),
]

_KEEP = re.compile(r"^(0|defpoints)$", re.I)


def classify_layer(name: str) -> tuple[str, str]:
    """Trả (layer_chuẩn, nhóm). Layer giữ nguyên -> chính nó; lạ -> KHAC."""
    if _KEEP.match(name):
        return name, "Giữ nguyên"
    # Layer từ xref có dạng "<tên_xref>|<layer>" -> phân loại theo phần sau '|'.
    base = name.split("|")[-1]
    n = _norm(base)
    for rx, target, kind in _MAP:
        if rx.search(n):
            return target, kind
    return "KHAC", "Chưa rõ"


@dataclass
class LayerRow:
    original: str
    target: str
    kind: str
    sheets: int
    entities: int


def build_layer_map(drawings: list[Drawing]) -> list[LayerRow]:
    sheets: dict[str, int] = defaultdict(int)
    ents: dict[str, int] = defaultdict(int)
    for d in drawings:
        seen = set(d.layers) | set(d.layer_usage)
        for lyr in seen:
            sheets[lyr] += 1
            ents[lyr] += d.layer_usage.get(lyr, 0)
    rows = []
    for lyr in sheets:
        target, kind = classify_layer(lyr)
        rows.append(LayerRow(lyr, target, kind, sheets[lyr], ents[lyr]))
    # Sắp theo nhóm rồi layer chuẩn rồi mức dùng nhiều -> dễ rà.
    rows.sort(key=lambda r: (r.kind, r.target, -r.entities))
    return rows


def summary(rows: list[LayerRow]) -> dict[str, int]:
    """Số layer gốc gom về từng layer chuẩn."""
    agg: dict[str, int] = defaultdict(int)
    for r in rows:
        agg[r.target] += 1
    return dict(sorted(agg.items(), key=lambda x: -x[1]))

"""Bóc tách BOM: phân loại phụ kiện từ tên block + tổng chiều dài ống theo layer.

Quy luật phân loại rút ra từ chính các bản vẽ mẫu (Co125, Coupling-D90,
PPR-RED 40-25, ELB 90-20 PPR, B_MangXong...). Tên không khớp KHÔNG bị bỏ —
đẩy vào nhóm "Chưa phân loại" để người dùng tự rà.
"""
from __future__ import annotations

import re
from collections import defaultdict
from dataclasses import dataclass

from .model import Drawing

# (regex, category, material) — material=None nghĩa là suy từ tên.
# Thứ tự quan trọng: luật cụ thể đặt TRƯỚC luật chung.
_RULES: list[tuple[re.Pattern, str, str | None]] = [
    (re.compile(r"^Co(\d+)\(.*\)DN", re.I), "Cút (co)", None),
    (re.compile(r"^ELB\s*\d+-(\d+)\(.*\)\s*(PPR|UPVC)?", re.I), "Cút 90°", None),
    (re.compile(r"^ELB\b.*?(\d+)", re.I), "Cút ren", None),
    (re.compile(r"^Coupling-?D?(\d+)", re.I), "Nối thẳng (coupling)", None),
    (re.compile(r"^B_MangXong(?:PPR)?D?(\d+)", re.I), "Măng xông", None),
    (re.compile(r"^(?:PPR-?RED|RED-?|C[oô]n\s*thu)\D*(\d+)\D+(\d+)", re.I),
     "Côn thu", None),
    (re.compile(r"Globe Valve\D*(\d+)", re.I), "Van chặn (globe)", None),
    (re.compile(r"Gate Valve\D*(\d+)", re.I), "Van cổng (gate)", None),
    (re.compile(r"Check Valve\D*(\d+)", re.I), "Van 1 chiều", None),
    (re.compile(r"\bValve\b\D*(\d+)", re.I), "Van", None),
    (re.compile(r"^(?:Tee|Te|Chia)\D*(\d+)", re.I), "Tê (rẽ nhánh)", None),
    (re.compile(r"^TuThong\D*D?(\d+)", re.I), "Cút thông tắc", None),
    (re.compile(r"^SIPHON", re.I), "Siphon", None),
    (re.compile(r"voitam|voi tam|voi-tam", re.I), "Vòi tắm", None),
    (re.compile(r"lavabo|basin|ch[aậ]u r[uử]a", re.I), "Lavabo / chậu rửa", None),
]

# Tên block KHÔNG phải vật tư (anon dynamic, mặt bằng, nội thất, khung lưới...).
_IGNORE = re.compile(
    r"\$A\$C|ISO3TGROUP|"
    r"^(\*|A\$C|_|Axis$|S13-|B_|ABD_|M[ăa]t\s*b[ằa]ng|dinh vi|truc|10X|"
    r"1{3,}|251|QUANG|LOGO|SSA-|TRU|BED|TIVI|SOFA|CURTAIN|RUG|TABLE|CHAIR|"
    r"xcv|xx\b|[a-z]{2,}sdsa|asdf|fsf)",
    re.I,
)

# Layer là hệ MEP (khớp tiền tố/đặc trưng, KHÔNG khớp chuỗi con như "tuong"->"ong").
_MEP_LAYER = re.compile(r"^(p-|dccd|n-t)|sleeve|pipe|duct", re.I)


def _material(name: str, rule_mat: str | None) -> str:
    if rule_mat:
        return rule_mat
    up = name.upper()
    if "PPR" in up:
        return "PPR"
    if "UPVC" in up or "PVC" in up:
        return "uPVC"
    return ""


@dataclass
class FittingRow:
    category: str
    dn: str
    material: str
    count: int
    sample_block: str


@dataclass
class PipeRow:
    layer: str
    is_mep: bool
    length_m: float


def classify(name: str) -> tuple[str, str, str] | None:
    """Trả (category, dn, material) hoặc None nếu nên bỏ qua."""
    if not name or _IGNORE.search(name):
        return None
    for rx, cat, mat in _RULES:
        m = rx.search(name)
        if m:
            dn = "-".join(g for g in m.groups() if g and g.isdigit())
            return cat, (f"DN{dn}" if dn else ""), _material(name, mat)
    return "Chưa phân loại", "", _material(name, None)


def fittings_bom(drawings: list[Drawing]) -> list[FittingRow]:
    agg: dict[tuple[str, str, str], list] = defaultdict(lambda: [0, ""])
    for d in drawings:
        for ins in d.inserts:
            res = classify(ins.name)
            if res is None:
                continue
            cat, dn, mat = res
            cell = agg[(cat, dn, mat)]
            cell[0] += 1
            cell[1] = ins.name  # giữ 1 tên block mẫu
    rows = [
        FittingRow(cat, dn, mat, cnt, sample)
        for (cat, dn, mat), (cnt, sample) in agg.items()
    ]
    rows.sort(key=lambda r: (r.category, r.dn, r.material))
    return rows


def pipe_bom(drawings: list[Drawing]) -> list[PipeRow]:
    agg: dict[str, float] = defaultdict(float)
    for d in drawings:
        for p in d.pipes:
            agg[p.layer] += p.length
    rows = [
        PipeRow(layer, bool(_MEP_LAYER.search(layer)), round(length / 1000.0, 2))
        for layer, length in agg.items()
    ]
    rows.sort(key=lambda r: (not r.is_mep, -r.length_m))
    return rows

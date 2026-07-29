"""Chuẩn hoá JSON LibreDWG -> mô hình Drawing dùng chung cho mọi tính năng."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path

from .dwgjson import DwgReadError, dwg_to_json


class DrawingReadError(RuntimeError):
    """LibreDWG could not decode a drawing."""


@dataclass
class Insert:
    name: str          # tên block
    layer: str
    pos: tuple[float, float]
    attribs: dict[str, str] = field(default_factory=dict)  # tag -> value


@dataclass
class PolyPipe:
    dxftype: str       # LINE | LWPOLYLINE | MLINE
    layer: str
    length: float      # đơn vị bản vẽ (mm theo các file mẫu)


@dataclass
class Drawing:
    path: Path
    layers: list[str]
    inserts: list[Insert]
    texts: list[tuple[str, str]]      # (text, layer)
    pipes: list[PolyPipe]
    layer_usage: dict[str, int]       # layer -> số entity ở model space

    @property
    def name(self) -> str:
        return self.path.stem


def _h(ref):
    """Handle/ref array -> int (phần tử cuối)."""
    return ref[-1] if isinstance(ref, list) and ref else None


def fix_text(s):
    """Best-effort sửa mojibake: LibreDWG ghi bytes, ta đọc latin-1.
    Nhiều chuỗi thực ra là UTF-8 nên thử khôi phục lại."""
    if not isinstance(s, str):
        return s
    try:
        fixed = s.encode("latin-1").decode("utf-8")
        return fixed
    except (UnicodeDecodeError, UnicodeEncodeError):
        return s


def _poly_len(points) -> float:
    total = 0.0
    for a, b in zip(points, points[1:]):
        total += math.dist(a[:2], b[:2])
    return total


def _lwpolyline_len(
    points: list[tuple[float, float, float]],
    *,
    closed: bool,
) -> float:
    """Return chord/arc length; each vertex bulge describes its next segment."""
    if len(points) < 2:
        return 0.0
    pairs = list(zip(points, points[1:]))
    if closed:
        pairs.append((points[-1], points[0]))

    total = 0.0
    for start, end in pairs:
        chord = math.dist(start[:2], end[:2])
        bulge = abs(start[2])
        if chord == 0.0 or bulge == 0.0:
            total += chord
            continue
        angle = 4.0 * math.atan(bulge)
        radius = chord * (1.0 + bulge * bulge) / (4.0 * bulge)
        total += radius * angle
    return total


def read_drawing(dwg_path: str | Path) -> Drawing:
    """Đọc bản vẽ bằng LibreDWG rồi chuẩn hóa thành Drawing."""
    try:
        return _read_drawing_libredwg(dwg_path)
    except (DwgReadError, OSError) as exc:
        raise DrawingReadError(str(exc)) from exc


def _read_drawing_libredwg(dwg_path: str | Path) -> Drawing:
    data = dwg_to_json(dwg_path)
    objs = data["OBJECTS"]

    layer_name: dict[int, str] = {}
    block_name: dict[int, str] = {}
    for o in objs:
        t = o.get("object")
        if t == "LAYER":
            layer_name[_h(o.get("handle"))] = o.get("name")
        elif t == "BLOCK_HEADER":
            block_name[_h(o.get("handle"))] = o.get("name")

    layers = sorted(
        {n for n in layer_name.values() if n and n != "0"}, key=str.lower
    )

    inserts: list[Insert] = []
    texts: list[tuple[str, str]] = []
    pipes: list[PolyPipe] = []
    layer_usage: dict[str, int] = {}

    def lname(o) -> str:
        return layer_name.get(_h(o.get("layer")), "0") or "0"

    # Duyệt theo thứ tự để gắn ATTRIB (đứng sau INSERT) vào đúng INSERT.
    pending: Insert | None = None
    for o in objs:
        ent = o.get("entity")
        if not ent:
            continue
        if ent not in ("ATTRIB", "SEQEND", "VERTEX_2D", "BLOCK", "ENDBLK"):
            layer_usage[lname(o)] = layer_usage.get(lname(o), 0) + 1
        if ent == "INSERT":
            name = block_name.get(_h(o.get("block_header")))
            pos = o.get("ins_pt") or [0, 0]
            pending = Insert(
                name=fix_text(name) if name else "?",
                layer=lname(o),
                pos=(pos[0], pos[1]),
            )
            inserts.append(pending)
            if not o.get("has_attribs"):
                pending = None
        elif ent == "ATTRIB":
            if pending is not None:
                tag = o.get("tag")
                if tag:
                    pending.attribs[tag] = fix_text(o.get("text_value") or "")
        elif ent == "SEQEND":
            pending = None
        elif ent in ("TEXT", "MTEXT"):
            val = o.get("text_value") if ent == "TEXT" else o.get("text")
            if val:
                texts.append((fix_text(val), lname(o)))
        elif ent == "LINE":
            s, e = o.get("start"), o.get("end")
            if s and e:
                pipes.append(PolyPipe("LINE", lname(o), math.dist(s[:2], e[:2])))
        elif ent == "LWPOLYLINE":
            pts = o.get("points") or []
            if len(pts) >= 2:
                bulges = o.get("bulges") or []
                vertices = [
                    (
                        float(point[0]),
                        float(point[1]),
                        float(bulges[index]) if index < len(bulges) else 0.0,
                    )
                    for index, point in enumerate(pts)
                ]
                # LibreDWG's internal flag uses bit 512 for closed; bit 1
                # means the optional extrusion vector is present.
                closed = bool(int(o.get("flag") or 0) & 512)
                pipes.append(PolyPipe(
                    "LWPOLYLINE",
                    lname(o),
                    _lwpolyline_len(vertices, closed=closed),
                ))
        elif ent == "MLINE":
            verts = o.get("verts") or o.get("vertices") or []
            pts = [v.get("vertex", v) if isinstance(v, dict) else v for v in verts]
            pts = [p for p in pts if isinstance(p, list) and len(p) >= 2]
            if len(pts) >= 2:
                pipes.append(PolyPipe("MLINE", lname(o), _poly_len(pts)))

    return Drawing(
        path=Path(dwg_path),
        layers=layers,
        inserts=inserts,
        texts=texts,
        pipes=pipes,
        layer_usage=layer_usage,
    )

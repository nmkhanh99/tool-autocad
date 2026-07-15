"""Chuẩn hoá JSON LibreDWG -> mô hình Drawing dùng chung cho mọi tính năng."""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from pathlib import Path

from .dwgjson import dwg_to_json


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
    Nhiều chuỗi thực ra là UTF-8 -> thử khôi phục. (Sẽ chuẩn hẳn khi dùng ODA.)"""
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


def read_drawing(dwg_path: str | Path) -> Drawing:
    """Đọc bản vẽ -> Drawing. Ưu tiên ODA + ezdxf (sạch, không mojibake, đọc
    được file LibreDWG hỏng); nếu chưa cài ODA thì fallback LibreDWG."""
    from .dxfsource import oda_available

    if oda_available():
        return read_drawing_dxf(dwg_path)
    return _read_drawing_libredwg(dwg_path)


def read_drawing_dxf(dwg_path: str | Path) -> Drawing:
    """Đọc qua ODA File Converter (DWG->DXF) rồi ezdxf. Không cần fix_text."""
    import ezdxf

    from .dxfsource import dwg_to_dxf

    dxf = dwg_to_dxf(dwg_path)
    doc = ezdxf.readfile(dxf)
    return _drawing_from_doc(doc, Path(dwg_path))


def _drawing_from_doc(doc, path: Path) -> Drawing:
    """Dựng Drawing từ một ezdxf Document (tách ra để test độc lập với ODA)."""
    msp = doc.modelspace()

    layers = sorted(
        {l.dxf.name for l in doc.layers if l.dxf.name and l.dxf.name != "0"},
        key=str.lower,
    )

    inserts: list[Insert] = []
    texts: list[tuple[str, str]] = []
    pipes: list[PolyPipe] = []
    layer_usage: dict[str, int] = {}

    for e in msp:
        et = e.dxftype()
        lyr = e.dxf.get("layer", "0") or "0"
        layer_usage[lyr] = layer_usage.get(lyr, 0) + 1

        if et == "INSERT":
            pos = e.dxf.insert
            attribs = {a.dxf.tag: (a.dxf.text or "") for a in e.attribs}
            inserts.append(Insert(
                name=e.dxf.name or "?",
                layer=lyr,
                pos=(float(pos.x), float(pos.y)),
                attribs=attribs,
            ))
        elif et == "TEXT":
            val = e.dxf.text
            if val:
                texts.append((val, lyr))
        elif et == "MTEXT":
            val = e.text
            if val:
                texts.append((e.plain_text() if hasattr(e, "plain_text") else val, lyr))
        elif et == "LINE":
            s, en = e.dxf.start, e.dxf.end
            pipes.append(PolyPipe("LINE", lyr, math.dist((s.x, s.y), (en.x, en.y))))
        elif et == "LWPOLYLINE":
            pts = [(p[0], p[1]) for p in e.get_points("xy")]
            if len(pts) >= 2:
                pipes.append(PolyPipe("LWPOLYLINE", lyr, _poly_len(pts)))
        elif et == "MLINE":
            locs = _mline_points(e)
            if len(locs) >= 2:
                pipes.append(PolyPipe("MLINE", lyr, _poly_len(locs)))

    return Drawing(
        path=path,
        layers=layers,
        inserts=inserts,
        texts=texts,
        pipes=pipes,
        layer_usage=layer_usage,
    )


def _mline_points(mline) -> list[tuple[float, float]]:
    """Lấy toạ độ đỉnh MLINE (ezdxf API khác nhau giữa các bản)."""
    try:
        locs = mline.get_locations()  # -> list[Vec3]
    except AttributeError:
        locs = [v.location for v in getattr(mline, "vertices", [])]
    return [(p[0], p[1]) for p in locs]


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
                pipes.append(PolyPipe("LWPOLYLINE", lname(o), _poly_len(pts)))
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

#!/usr/bin/env python3
"""acadtool CLI — công cụ MEP as-built (offline).

Lệnh:
  bom <file_hoặc_thư_mục.dwg> [-o out.xlsx]   Bóc BOM phụ kiện + chiều dài ống -> Excel
  info <file.dwg>                              In nhanh layer/block/ống của 1 bản vẽ
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from acadtool.bom import fittings_bom, pipe_bom
from acadtool.dwgjson import DwgReadError
from acadtool.excel import write_bom, write_layer_map
from acadtool.layers import build_layer_map, summary as layer_summary
from acadtool.lispgen import write_titlefix_lisp
from acadtool.model import read_drawing
from acadtool.titleblock import audit_titleblock


def _collect(paths: list[str]) -> list[Path]:
    out: list[Path] = []
    for p in paths:
        path = Path(p)
        if path.is_dir():
            out.extend(sorted(path.glob("*.dwg")))
        elif path.is_file():
            out.append(path)
        else:
            print(f"  ! bỏ qua (không thấy): {p}", file=sys.stderr)
    return out


def _read_all(files: list[Path]):
    drawings = []
    for f in files:
        try:
            d = read_drawing(f)
            drawings.append(d)
            print(f"  ✓ {f.name}  (layers={len(d.layers)} blocks={len(d.inserts)})")
        except DwgReadError as e:
            print(f"  ✗ {f.name}: {e}", file=sys.stderr)
    return drawings


def cmd_bom(args) -> int:
    files = _collect(args.paths)
    if not files:
        print("Không có file .dwg nào.", file=sys.stderr)
        return 1
    print(f"Đọc {len(files)} bản vẽ...")
    drawings = _read_all(files)
    if not drawings:
        return 1
    fittings = fittings_bom(drawings)
    pipes = pipe_bom(drawings)
    out = write_bom(args.output, fittings, pipes)
    n_fit = sum(r.count for r in fittings)
    mep_m = round(sum(r.length_m for r in pipes if r.is_mep), 1)
    print(f"\n→ {out}")
    print(f"  {len(fittings)} loại phụ kiện, tổng {n_fit} cái; "
          f"ống hệ MEP ~{mep_m} m.")
    return 0


def cmd_info(args) -> int:
    files = _collect(args.paths)
    drawings = _read_all(files)
    for d in drawings:
        print(f"\n# {d.name}")
        print(f"  layers={len(d.layers)} inserts={len(d.inserts)} "
              f"texts={len(d.texts)} pipes={len(d.pipes)}")
    return 0 if drawings else 1


def cmd_title(args) -> int:
    files = _collect(args.paths)
    drawings = _read_all(files)
    if not drawings:
        return 1
    print(f"\n{'Bản vẽ':46s} {'KHBV':11s} {'Nên là':11s} Vấn đề")
    print("-" * 100)
    n_issue = 0
    for d in drawings:
        a = audit_titleblock(d)
        flag = "; ".join(a.issues) if a.issues else "OK"
        if a.issues:
            n_issue += 1
        print(f"{d.name[:46]:46s} {a.khbv_actual[:11]:11s} "
              f"{(a.khbv_expected or '?')[:11]:11s} {flag}")
    print("-" * 100)
    print(f"{len(drawings)} bản vẽ, {n_issue} bản vẽ có vấn đề cần sửa.")
    return 0


def cmd_layers(args) -> int:
    files = _collect(args.paths)
    drawings = _read_all(files)
    if not drawings:
        return 1
    rows = build_layer_map(drawings)
    out = write_layer_map(args.output, rows)
    agg = layer_summary(rows)
    khac = sum(1 for r in rows if r.target == "KHAC")
    print(f"\n→ {out}")
    print(f"  {len(rows)} layer gốc → {len(agg)} layer chuẩn. "
          f"{khac} layer 'KHAC' cần rà tay.")
    print("  Gom về (top):")
    for target, n in list(agg.items())[:12]:
        print(f"    {n:3d} ← {target}")
    return 0


def cmd_titlefix(args) -> int:
    files = _collect(args.paths)
    drawings = _read_all(files)
    if not drawings:
        return 1
    common: dict[str, str] = {}
    for item in args.set or []:
        if "=" in item:
            tag, val = item.split("=", 1)
            common[tag.strip()] = val.strip()
    out = write_titlefix_lisp(args.output, drawings, common)
    print(f"\n→ {out}")
    print("  Mở AutoCAD 2027 → APPLOAD nạp file này → gõ MEPFIX trên từng bản vẽ.")
    if common:
        print(f"  Trường áp chung: {common}")
    print("  (KHBV chuẩn được sinh tự động từ tên file cho mỗi sheet.)")
    return 0


def main(argv=None) -> int:
    p = argparse.ArgumentParser(prog="acadtool", description=__doc__,
                                formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)

    pb = sub.add_parser("bom", help="Bóc BOM ra Excel")
    pb.add_argument("paths", nargs="+", help="File .dwg hoặc thư mục")
    pb.add_argument("-o", "--output", default="BOM.xlsx", help="File Excel xuất ra")
    pb.set_defaults(func=cmd_bom)

    pi = sub.add_parser("info", help="In nhanh thông tin bản vẽ")
    pi.add_argument("paths", nargs="+")
    pi.set_defaults(func=cmd_info)

    pt = sub.add_parser("title", help="Soát khung tên + mã KHBV cả bộ bản vẽ")
    pt.add_argument("paths", nargs="+", help="File .dwg hoặc thư mục")
    pt.set_defaults(func=cmd_title)

    pl = sub.add_parser("layers", help="Đề xuất chuẩn hoá layer -> Excel mapping")
    pl.add_argument("paths", nargs="+", help="File .dwg hoặc thư mục")
    pl.add_argument("-o", "--output", default="LayerMap.xlsx", help="File Excel xuất ra")
    pl.set_defaults(func=cmd_layers)

    pf = sub.add_parser("titlefix",
                        help="Sinh script AutoLISP sửa khung tên (chạy trong AutoCAD)")
    pf.add_argument("paths", nargs="+", help="File .dwg hoặc thư mục")
    pf.add_argument("-o", "--output", default="MEPFIX.lsp", help="File .lsp xuất ra")
    pf.add_argument("--set", action="append", metavar="TAG=VALUE",
                    help="Trường áp chung mọi sheet, vd --set DD/MM/YYYY=22/06/2026")
    pf.set_defaults(func=cmd_titlefix)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())

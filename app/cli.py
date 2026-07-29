#!/usr/bin/env python3
"""acadtool CLI — Offline core của AutoCAD Toolkit (không cần AutoCAD GUI).

Cột A trong kiến trúc 3 cột (Offline / ACAD Control / ObjectARX).
Profile plumbing (BOM ống) là optional sample, không phải product identity.

Lệnh:
  bom <file_hoặc_thư_mục.dwg> [-o out.xlsx]   Bóc BOM / takeoff (profile-aware)
  info <file.dwg>                              Inventory: layer / block / text / pipes
  title <file_hoặc_thư_mục.dwg>                Soát khung tên + mã KHBV
  layers <file_hoặc_thư_mục.dwg>               Đề xuất chuẩn hoá layer -> Excel
  titlefix <file_hoặc_thư_mục.dwg>             Sinh script AutoLISP sửa khung tên
  gemini analyze <paths.dwg...>                Phân tích bản vẽ với Gemini AI
  gemini ask <câu_hỏi> <paths.dwg...>          Hỏi Gemini AI về bản vẽ
  gemini lisp <yêu_cầu> [-o script.lsp]        Sinh AutoLISP bằng Gemini AI
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from acadtool.bom import fittings_bom, pipe_bom
from acadtool.excel import write_bom, write_layer_map
from acadtool.layers import build_layer_map, summary as layer_summary
from acadtool.lispgen import write_titlefix_lisp
from acadtool.model import DrawingReadError, read_drawing
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
            print(
                f"  ✓ {f.name}  (layers={len(d.layers)} blocks={len(d.inserts)})",
                file=sys.stderr,
            )
        except DrawingReadError as e:
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


from acadtool.gemini import (
    analyze_drawings,
    ask_drawings,
    generate_lisp,
)


import json


def cmd_gemini(args) -> int:
    try:
        is_json = getattr(args, "json", False)

        if args.gemini_cmd == "analyze":
            files = _collect(args.paths)
            drawings = _read_all(files) if files else []
            if not is_json:
                print(f"\n🤖 Đang gửi thông tin {len(drawings)} bản vẽ cho Gemini AI phân tích...")
            res = analyze_drawings(drawings, custom_prompt=args.prompt or "", api_key=args.key, model=args.model)
            if is_json:
                print(json.dumps({"type": "text", "data": res}, ensure_ascii=False))
                print(json.dumps({"type": "end"}))
            else:
                print("\n" + "=" * 80)
                print("KẾT QUẢ PHÂN TÍCH TỪ GEMINI AI:")
                print("=" * 80)
                print(res)
                print("=" * 80)
            return 0

        elif args.gemini_cmd == "ask":
            files = _collect(args.paths) if getattr(args, "paths", None) else []
            drawings = _read_all(files) if files else []
            if not is_json and files:
                print(f"\n🤖 Đang gửi câu hỏi tới Gemini AI về {len(drawings)} bản vẽ...")
            elif not is_json:
                print(f"\n🤖 Đang gửi câu hỏi tới Gemini AI...")
            res = ask_drawings(drawings, question=args.question, api_key=args.key, model=args.model)
            if is_json:
                print(json.dumps({"type": "text", "data": res}, ensure_ascii=False))
                print(json.dumps({"type": "end"}))
            else:
                print("\n" + "=" * 80)
                print("TRẢ LỜI TỪ GEMINI AI:")
                print("=" * 80)
                print(res)
                print("=" * 80)
            return 0

        elif args.gemini_cmd == "lisp":
            if not is_json:
                print(f"\n🤖 Đang yêu cầu Gemini sinh mã AutoLISP...")
            code = generate_lisp(prompt=args.prompt, api_key=args.key, model=args.model)
            if is_json:
                print(json.dumps({"type": "text", "data": code}, ensure_ascii=False))
                print(json.dumps({"type": "end"}))
            elif args.output:
                output_path = Path(args.output)
                output_path.write_text(code, encoding="utf-8")
                print(f"→ Đã ghi mã AutoLISP vào: {output_path}")
            else:
                print("\n" + "=" * 80)
                print("MÃ AUTOLISP SINH TỪ GEMINI AI:")
                print("=" * 80)
                print(code)
                print("=" * 80)
            return 0
        else:
            print("Vui lòng chọn lệnh gemini: analyze, ask, hoặc lisp", file=sys.stderr)
            return 1
    except Exception as e:
        if getattr(args, "json", False):
            print(json.dumps({"type": "error", "message": str(e)}, ensure_ascii=False))
        else:
            print(f"\n❌ Lỗi Gemini AI: {e}", file=sys.stderr)
        return 1


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

    # Gemini AI integration
    pg = sub.add_parser("gemini", help="Tích hợp Gemini AI (phân tích, hỏi đáp, sinh AutoLISP)")
    gsub = pg.add_subparsers(dest="gemini_cmd", required=True)

    # gemini analyze
    ga = gsub.add_parser("analyze", help="Đưa metadata bản vẽ cho Gemini AI phân tích & đề xuất")
    ga.add_argument("paths", nargs="*", help="File .dwg hoặc thư mục (tùy chọn)")
    ga.add_argument("-p", "--prompt", default="", help="Yêu cầu phân tích cụ thể")
    ga.add_argument("--key", help="Gemini API Key (mặc định lấy từ GEMINI_API_KEY env)")
    ga.add_argument("--model", help="Tên model Gemini (mặc định: gemini-2.5-flash)")
    ga.add_argument("--json", action="store_true", help="Xuất dạng JSONL event stream cho agent daemon")
    ga.set_defaults(func=cmd_gemini)

    # gemini ask
    gk = gsub.add_parser("ask", help="Hỏi Gemini AI về bản vẽ")
    gk.add_argument("question", help="Câu hỏi về bản vẽ")
    gk.add_argument("paths", nargs="*", help="File .dwg hoặc thư mục (tùy chọn)")
    gk.add_argument("--key", help="Gemini API Key (mặc định lấy từ GEMINI_API_KEY env)")
    gk.add_argument("--model", help="Tên model Gemini (mặc định: gemini-2.5-flash)")
    gk.add_argument("--json", action="store_true", help="Xuất dạng JSONL event stream cho agent daemon")
    gk.set_defaults(func=cmd_gemini)

    # gemini lisp
    gl = gsub.add_parser("lisp", help="Dùng Gemini AI sinh script AutoLISP theo yêu cầu")
    gl.add_argument("prompt", help="Mô tả chức năng/lệnh AutoLISP cần viết")
    gl.add_argument("-o", "--output", help="File .lsp xuất ra (nếu muốn lưu)")
    gl.add_argument("--key", help="Gemini API Key (mặc định lấy từ GEMINI_API_KEY env)")
    gl.add_argument("--model", help="Tên model Gemini (mặc định: gemini-2.5-flash)")
    gl.add_argument("--json", action="store_true", help="Xuất dạng JSONL event stream cho agent daemon")
    gl.set_defaults(func=cmd_gemini)

    args = p.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())

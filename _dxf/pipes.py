#!/usr/bin/env python3
"""BOM ong chinh tu MLINE: chieu dai theo (layer he thong, duong kinh=abs(scale))."""
import json, glob, re, collections, math
from analyze import dec, href, seg_len, load

FILES = sorted(glob.glob('_dxf/sheet_*.json'), key=lambda p: int(re.search(r'(\d+)', p).group(1)))
SHEET = {1:'Cap nuoc T5-7',2:'Thoat nuoc T1',3:'Thoat nuoc T3',4:'Thoat nuoc T5',
         5:'Thoat nuoc T6',6:'Thoat nuoc T7',7:'Thong hoi T8',8:'Thong hoi T9'}
MM_PER_M = 1000.0

# (he_thong_layer, DN) -> tong met ; va theo sheet
agg = collections.Counter()
per_sheet = collections.defaultdict(collections.Counter)

for f in FILES:
    idx = int(re.search(r'(\d+)', f).group(1))
    try:
        d = load(f)
    except Exception as e:
        print(f"[BO QUA] sheet {idx}: {type(e).__name__}"); continue
    objs = d['OBJECTS']
    lname = {href(o.get('handle')): dec(o.get('name')) for o in objs if o.get('object') == 'LAYER'}
    for o in objs:
        if o.get('entity') != 'MLINE':
            continue
        L = lname.get(href(o.get('layer')), '?')
        dn = abs(o.get('scale') or 0)
        pts = [v['vertex'] for v in (o.get('verts') or []) if v.get('vertex')]
        if len(pts) >= 2 and dn:
            m = seg_len(pts, False) / MM_PER_M
            agg[(L, dn)] += m
            per_sheet[idx][(L, dn)] += m

print("="*70)
print("BOM ONG CHINH (MLINE) — chieu dai theo He thong + Duong kinh")
print("="*70)
print(f"  {'He thong (layer)':22} {'DN':>6}  {'Chieu dai (m)':>14}")
print("  " + "-"*46)
grand = 0
for (L, dn), m in sorted(agg.items(), key=lambda x: (x[0][0], -x[1])):
    print(f"  {L:22} DN{int(dn):<4}  {m:14.1f}")
    grand += m
print("  " + "-"*46)
print(f"  {'TONG CONG (8/8 sheet)':22} {'':6}  {grand:14.1f}")

print("\n  Tong chieu dai ong moi sheet (m):")
for idx in sorted(per_sheet):
    print(f"     S{idx} {SHEET.get(idx,''):16} {sum(per_sheet[idx].values()):9.1f} m")

#!/usr/bin/env python3
"""Tong hop 8 sheet: layer MEP, chieu dai ong, attrib phu kien, khung ten per-sheet."""
import glob, collections, re
from analyze import analyze, dec

FILES = sorted(glob.glob('_dxf/sheet_*.json'), key=lambda p: int(re.search(r'(\d+)', p).group(1)))

# Ten that cua tung sheet (map theo thu tu convert trong plan)
SHEET_NAMES = {
    1: 'Cap nuoc tang 5,6,7',
    2: 'Thoat nuoc tang 1',
    3: 'Thoat nuoc tang 3',
    4: 'Thoat nuoc tang 5',
    5: 'Thoat nuoc tang 6',
    6: 'Thoat nuoc tang 7',
    7: 'Thong hoi tang 8',
    8: 'Thong hoi tang 9',
}

# Tag khung ten (tu file template)
TITLE_TAGS = {'KHBV', 'TENBANVE1', 'KIENTRUC1-ARCHITECTURE', 'VE1', 'VE2',
              'THIETKE', 'CHUTRIBOMON', 'CHUNHIEM'}

results = {}
for f in FILES:
    idx = int(re.search(r'(\d+)', f).group(1))
    try:
        results[idx] = analyze(f)
    except Exception as e:
        print(f"  [BO QUA] sheet {idx}: {type(e).__name__}: {str(e)[:80]}")

# ---- 1. LAYER MEP (P-*, DCCD-*, DM-*) dung o sheet nao + chieu dai ----
print("="*80)
print("1. LAYER MEP — chieu dai (don vi ban ve, /1000) theo tung sheet")
print("="*80)
mep_layers = set()
for r in results.values():
    for l in r['layers']:
        if re.match(r'^(P-|DCCD|DM|PR-|CN-|TN-|TH-)', l, re.I) or 'thoat' in l.lower() or 'nuoc' in l.lower() or 'hoi' in l.lower():
            mep_layers.add(l)
for l in sorted(mep_layers):
    row = []
    for idx in sorted(results):
        ln = results[idx]['layer_len'].get(l, 0)
        row.append(f"{ln/1000:7.1f}" if ln else "    -  ")
    print(f"  {l:22} " + " ".join(row))
print("  " + " "*22 + " " + " ".join(f"S{idx:<6d}" for idx in sorted(results)))

# ---- 2. ATTRIB phu kien MEP: tag -> mau gia tri (loai, vat lieu, DN) ----
print("\n" + "="*80)
print("2. ATTRIB PHU KIEN MEP — tag chu thich & mau gia tri")
print("="*80)
tag_vals = collections.defaultdict(collections.Counter)
for r in results.values():
    for tag, val in r['attribs']:
        if tag in TITLE_TAGS or tag == 'AXIS':
            continue
        tag_vals[tag][val] += 1
for tag in sorted(tag_vals, key=lambda t: -sum(tag_vals[t].values())):
    total = sum(tag_vals[tag].values())
    samples = "; ".join(f"{v!r}x{c}" for v, c in tag_vals[tag].most_common(4))
    print(f"  {tag:18} (tong {total:4d})  {samples}")

# ---- 3. Parse phu kien -> BOM thu (loai, vat lieu, DN) ----
print("\n" + "="*80)
print("3. BOM THU tu ATTRIB phu kien (parse 'Loai, Vatlieu, DNxxx')")
print("="*80)
bom = collections.Counter()
pat = re.compile(r'^\s*([^,]+),\s*([^,]+),\s*(DN\s*\d+)', re.I)
for r in results.values():
    for tag, val in r['attribs']:
        m = pat.match(val or '')
        if m:
            loai = m.group(1).strip()
            vl = m.group(2).strip()
            dn = m.group(3).replace(' ', '').upper()
            bom[(loai, vl, dn)] += 1
for (loai, vl, dn), c in bom.most_common(40):
    print(f"  {loai:14} {vl:8} {dn:8} : {c:4d} cai")
print(f"  --> Tong loai phu kien khac nhau: {len(bom)}")

# ---- 4. Khung ten per-sheet ----
print("\n" + "="*80)
print("4. KHUNG TEN per-sheet (gia tri da dien)")
print("="*80)
for idx in sorted(results):
    print(f"\n  [Sheet {idx}] {SHEET_NAMES.get(idx,'?')}")
    tb = {}
    for tag, val in results[idx]['attribs']:
        if tag in TITLE_TAGS and tag not in tb:
            tb[tag] = val
    for tag in TITLE_TAGS:
        if tag in tb:
            print(f"      {tag:24} = {tb[tag]!r}")

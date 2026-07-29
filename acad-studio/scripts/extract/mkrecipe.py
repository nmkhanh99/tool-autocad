#!/usr/bin/env python3
"""Trích 'công thức vẽ' (draw recipe) từ dump AcCoreConsole của bản vẽ mẫu T1.

Xuất JSON: hình học đã DỜI VỀ GỐC CỤC BỘ (0,0) để vẽ lại trên bản vẽ mới.
Text tiếng Việt: dùng bản Unicode giải mã từ escape \\U+XXXX (nguồn tin cậy);
các chuỗi lưu bằng byte TCVN3 legacy được thay bằng bản Unicode tương đương
đã đối chiếu với nhãn ATTRIB (xem DRAW-FUNCTIONS.md §Text).
"""
import csv, json, math, os, re, collections
from pathlib import Path

DUMP = Path(os.environ.get("ACAD_DUMP_OUT", "/tmp/acad-dump"))
OUT = Path(os.environ.get("ACAD_RECIPE_OUT",
                          Path(__file__).resolve().parents[2] / "demo/t1-draw-recipe.json"))

def dec(s):
    return re.sub(r'\\U\+([0-9A-Fa-f]{4})', lambda m: chr(int(m.group(1), 16)), s or '')

def rows(name):
    return list(csv.DictReader(open(DUMP / name, encoding='cp1252', errors='replace')))

def pts(s):
    return [[float(a), float(b)] for a, b in re.findall(r'\(([-\d.e+]+) ([-\d.e+]+)\)', s)]

def num(s, key):
    m = re.search(key + r'=\(?([-\d.e+]+)', s)
    return float(m.group(1)) if m else None

def pair(s, key):
    m = re.search(key + r'=\(([-\d.e+]+) ([-\d.e+]+)\)', s)
    return [float(m.group(1)), float(m.group(2))] if m else None

# ---------------------------------------------------------------- nguồn
mlines = rows('mlines.csv')
inserts = rows('inserts.csv')
attribs = rows('attribs.csv')
ents = rows('ents-model.csv')

REAL = [m for m in mlines if float(m['dn']) > 10]          # ống thật (loại stub legend scale 0.9)
LEGEND_ML = [m for m in mlines if float(m['dn']) <= 10]    # mẫu ống trong bảng ký hiệu

# ------------------------------------------------- gốc cục bộ = min bbox ống
allp = [p for m in REAL for p in pts(m['pts'])]
OX = min(p[0] for p in allp)
OY = min(p[1] for p in allp)

def T(p):
    return [round(p[0] - OX, 1), round(p[1] - OY, 1)]

def inside(p):
    """điểm có thuộc vùng mặt bằng không (loại các phần tử ở xa như khung tên)"""
    x, y = p[0] - OX, p[1] - OY
    return -20000 <= x <= 90000 and -20000 <= y <= 40000

# ------------------------------------------------------------------- ống
pipes = []
for m in REAL:
    P = [T(p) for p in pts(m['pts'])]
    L = sum(math.dist(P[i], P[i + 1]) for i in range(len(P) - 1))
    pipes.append({
        "handle": m['handle'], "layer": m['layer'], "mlstyle": m['style'],
        "dn": int(float(m['dn'])), "points": P, "length_mm": round(L, 1),
    })
pipes.sort(key=lambda p: (p['layer'], -p['dn'], p['points'][0][1]))

# -------------------------------------------------------------- phụ kiện
# nhãn phụ kiện nằm trong ATTRIB của INSERT (block ẩn danh *U…)
lbl = {}
for a in attribs:
    v = dec(a['value']).strip()
    if v and a['tag'] in ('CHECHDENHAT', 'YTIENPHONGTHOAT', 'CONTIENPHONGTHOAT', 'CUTDENHAT'):
        lbl[a['insert_handle']] = (a['tag'], v)

KIND = {'CHECHDENHAT': 'CHECH', 'YTIENPHONGTHOAT': 'Y',
        'CONTIENPHONGTHOAT': 'CON', 'CUTDENHAT': 'CUT'}

fittings = []
for i in inserts:
    if i['handle'] not in lbl:
        continue
    tag, v = lbl[i['handle']]
    p = [float(i['x']), float(i['y'])]
    if not inside(p):
        continue
    dnm = re.search(r'D[N]?\s*(\d+)', v)
    fittings.append({
        "handle": i['handle'], "layer": i['layer'], "kind": KIND[tag],
        "dn": int(dnm.group(1)) if dnm else 90,
        "label": v, "point": T(p), "rot_deg": round(float(i['rot']), 2),
    })
fittings.sort(key=lambda f: (f['kind'], -f['dn']))

# ------------------------------------------------------------ kích thước
# Nguồn: dims-detail.csv (có group 50 = góc quay, 42 = số đo).
# Mọi dim của bản mẫu là AcDbRotatedDimension (g70=32/160), g50 ∈ {0, pi/2}
# → dựng lại bằng DIMLINEAR "_H"/"_V", KHÔNG phải DIMALIGNED.
dims = []
for d in rows('dims-detail.csv'):
    p13 = [float(d['p13x']), float(d['p13y'])]
    p14 = [float(d['p14x']), float(d['p14y'])]
    p10 = [float(d['p10x']), float(d['p10y'])]
    orient = "V" if abs(float(d['g50'])) > 0.1 else "H"
    dims.append({
        "handle": d['handle'], "layer": d['layer'], "dimstyle": d['style'],
        "orient": orient, "measure_mm": round(float(d['meas']), 2),
        "p1": T(p13), "p2": T(p14), "ptext": T(p10),
    })

# ------------------------------------------------------------ ghi chú dẫn
mltxt = open(DUMP / 'mleaders.txt', encoding='cp1252', errors='replace').read()
leaders = []
for b in mltxt.split('--- ')[1:]:
    head = b.split('\n')[0]
    h = head.split()[0]
    lay = re.search(r'layer=(.*)$', head)
    lay = lay.group(1).strip() if lay else '0'
    texts = [dec(t).strip() for t in re.findall(r'304 = (.*)', b) if not t.strip().endswith('{')]
    if not texts:
        continue
    ctx = b.split('302 = LEADER{')[0]
    land = re.findall(r'12 = \(([-\d.e+]+) ([-\d.e+]+)', ctx)
    seg = b.split('304 = LEADER_LINE{')
    arrow = None
    if len(seg) > 1:
        ap = re.findall(r'10 = \(([-\d.e+]+) ([-\d.e+]+)', seg[1])
        if ap:
            arrow = [float(ap[0][0]), float(ap[0][1])]
    if not (land and arrow):
        continue
    lp = [float(land[0][0]), float(land[0][1])]
    if not (inside(lp) and inside(arrow)):
        continue
    leaders.append({
        "handle": h, "layer": lay, "arrow": T(arrow), "landing": T(lp),
        "text": texts[0], "ascii_only": all(ord(c) < 128 for c in texts[0]),
    })
leaders.sort(key=lambda l: (l['layer'], l['text']))

# ------------------------------------------------- LWPOLYLINE / CIRCLE / HATCH
lwp, circles = [], []
for e in ents:
    if e['type'] == 'LWPOLYLINE':
        P = [T(p) for p in pts(e['data'])]
        if not P or not all(inside([p[0] + OX, p[1] + OY]) for p in P):
            continue
        lwp.append({"handle": e['handle'], "layer": e['layer'],
                    "closed": 'closed=1' in e['data'], "points": P})
    elif e['type'] == 'CIRCLE':
        c = pair(e['data'], 'c')
        r = num(e['data'], 'r')
        if c and inside(c):
            circles.append({"handle": e['handle'], "layer": e['layer'],
                            "center": T(c), "radius": r})

hatches = [{"handle": e['handle'], "layer": e['layer'], "pattern": "ANSI31",
            "scale": 20.0, "angle": 0.0}
           for e in ents if e['type'] == 'HATCH']

# ------------------------------------------------------------------ khung tên
tb = {}
for a in attribs:
    if a['block'] == 'A3-1-1-ISO3TGROUP':
        v = dec(a['value']).strip()
        if v and a['tag'] not in tb:
            tb[a['tag']] = v

# ------------------------------------------------------------------- layer
layers = [{"name": r['name'], "color": int(r['color']), "linetype": r['linetype']}
          for r in rows('layers.csv')
          if r['name'] in ('P-ThoatXi', 'P-ThoatRua', 'P-ThongHoi', 'P-Hientrang',
                           'DCCD-nuoclanh', 'DCCD-text', 'A.DIM', 'Leader',
                           'CT-Leader', 'RSA -HACK', '0-9')]

# --------------------------------------------------------------- dimstyles
used = {d['dimstyle'] for d in dims}
dsty = []
for r in rows('dimstyles-key.csv'):
    if r['name'] in used:
        dsty.append({
            "name": r['name'], "dimpost": r['dimpost'],
            "dimscale": float(r['dimscale']), "dimtxt": float(r['dimtxt']),
            "dimasz": float(r['dimasz']), "dimclrt": int(r['clrt'] or 256),
            "textstyle": r['txtstyle'] or "Romans",
        })
dsty.sort(key=lambda x: x['name'])

recipe = {
    "id": "t1-draw-recipe",
    "source_dwg": "As-built drawing/ABD_He thong thoat nuoc tang 1_Tran tang 1_V.00.dwg",
    "extracted_by": "AcCoreConsole dump → mkrecipe.py",
    "units": "mm (INSUNITS=4)",
    "plot_scale": "1:100 (DIMSCALE=100, khung A3 420x297 insert scale 103.704)",
    "world_origin_offset_mm": [round(OX, 1), round(OY, 1)],
    "note_text_encoding": (
        "Bản mẫu (DWGCODEPAGE=ANSI_1252) lưu chữ Việt hỗn hợp: ký tự có trong CP1252 (ô, ú, à…) "
        "lưu thẳng byte CP1252; ký tự ngoài CP1252 (ế, ề, ắ…) lưu escape \\U+XXXX; "
        "riêng text dùng font TCVN3 (.VnAvantH/vnshxh.shx) lưu byte TCVN3. "
        "Recipe dùng Unicode; nhãn phụ kiện lấy từ escape \\U+XXXX nên chính xác."
    ),
    "layers": layers,
    "mlinestyles": sorted({m['style'] for m in REAL}),
    "dimstyles": dsty,
    "titleblock": {"block": "A3-1-1-ISO3TGROUP", "attrs": tb},
    "pipes": pipes,
    "fittings": fittings,
    "dims": dims,
    "leaders": leaders,
    "lwpolylines": lwp,
    "circles": circles,
    "hatches": hatches,
    "legend_pipe_samples": [
        {"layer": m['layer'], "mlstyle": m['style'], "scale": float(m['dn']),
         "points": pts(m['pts'])} for m in LEGEND_ML
    ],
    "totals": {
        "pipes": len(pipes),
        "pipe_length_m": round(sum(p['length_mm'] for p in pipes) / 1000.0, 2),
        "fittings": len(fittings),
        "dims": len(dims),
        "leaders": len(leaders),
        "lwpolylines": len(lwp),
        "circles": len(circles),
        "hatches": len(hatches),
    },
}

OUT.write_text(json.dumps(recipe, ensure_ascii=False, indent=1), encoding='utf-8')
print("wrote", OUT)
print(json.dumps(recipe['totals'], ensure_ascii=False, indent=1))
print("\npipes theo layer/DN:")
c = collections.Counter((p['layer'], p['dn']) for p in pipes)
for k, n in sorted(c.items()):
    print(f"   {n:3d}x {k[0]:12s} DN{k[1]}")
print("\nphụ kiện:")
c = collections.Counter(f['label'] for f in fittings)
for k, n in c.most_common():
    print(f"   {n:3d}x {k}")
print("\nleader:")
c = collections.Counter((l['layer'], l['text'][:40]) for l in leaders)
for k, n in c.most_common():
    print(f"   {n:3d}x [{k[0]}] {k[1]}")
print("\ndimstyles:", dsty)
print("bbox ống:", [round(min(p[0] for pp in pipes for p in pp['points'])),
                   round(min(p[1] for pp in pipes for p in pp['points'])),
                   round(max(p[0] for pp in pipes for p in pp['points'])),
                   round(max(p[1] for pp in pipes for p in pp['points']))])

#!/usr/bin/env python3
"""Phan tich JSON tu dwgread (LibreDWG): layer, block, attrib, chieu dai ong."""
import sys, json, math, collections

MOJIBAKE = ('Ã', 'Ä', 'á»', 'áº', 'Æ', 'â\x80')

def dec(s):
    """Giai ma text tieng Viet tu JSON (doc latin-1). File tron utf-8 + cp1258."""
    if not isinstance(s, str):
        return s
    raw = s.encode('latin-1', 'ignore')
    # Thu utf-8 truoc; neu ket qua co dau hieu mojibake -> chuoi goc la cp1258
    try:
        u = raw.decode('utf-8')
        if not any(m in u for m in MOJIBAKE):
            return u
    except Exception:
        u = None
    try:
        return raw.decode('cp1258')
    except Exception:
        return u if u is not None else raw.decode('latin-1')

def href(ref):
    """Lay handle tuyet doi tu mang tham chieu [code,size,value,abs] hoac [code,size,value]."""
    if isinstance(ref, list) and ref:
        return ref[-1]
    return None

def seg_len(pts, closed):
    total = 0.0
    for i in range(1, len(pts)):
        ax, ay = pts[i-1][0], pts[i-1][1]
        bx, by = pts[i][0], pts[i][1]
        total += math.hypot(bx-ax, by-ay)
    if closed and len(pts) > 2:
        ax, ay = pts[-1][0], pts[-1][1]
        bx, by = pts[0][0], pts[0][1]
        total += math.hypot(bx-ax, by-ay)
    return total

import re as _re
# LibreDWG doi khi sinh so rac khong lo (vd '2884...3168.') o gia tri toa do -> hong JSON.
# Toa do that chi vai chu so; thay moi so >=16 chu so phan nguyen bang 0.0
_BADNUM = _re.compile(r'(?<![\d.eE])-?\d{16,}(?:\.\d*)?')

def load(path):
    txt = open(path, 'rb').read().decode('latin-1')
    try:
        return json.loads(txt, strict=False)
    except json.JSONDecodeError:
        fixed = _BADNUM.sub('0.0', txt)
        fixed = ''.join(ch for ch in fixed if ch >= ' ' or ch in '\n\r\t')
        return json.loads(fixed, strict=False)

def analyze(path):
    d = load(path)
    objs = d['OBJECTS']
    # maps handle -> name
    layer_name = {}
    block_name = {}
    for o in objs:
        if o.get('object') == 'LAYER':
            layer_name[href(o.get('handle'))] = dec(o.get('name'))
        elif o.get('object') == 'BLOCK_HEADER':
            block_name[href(o.get('handle'))] = dec(o.get('name'))

    ent_count = collections.Counter()
    layer_ent = collections.Counter()           # so doi tuong / layer
    layer_len = collections.Counter()           # tong chieu dai LINE+LWPOLYLINE / layer
    mline_len = collections.Counter()           # tong chieu dai MLINE (tim ong) / layer
    mline_cnt = collections.Counter()           # so MLINE / layer
    block_use = collections.Counter()           # so INSERT / block name
    block_layer = collections.defaultdict(collections.Counter)  # block -> layer dist
    attribs = []                                 # (tag, value) khung ten

    for o in objs:
        et = o.get('entity')
        if not et:
            continue
        ent_count[et] += 1
        lname = layer_name.get(href(o.get('layer')), '?')

        if et in ('LINE', 'LWPOLYLINE', 'ARC', 'SPLINE'):
            layer_ent[lname] += 1
        if et == 'LINE':
            s, e = o.get('start'), o.get('end')
            if s and e:
                layer_len[lname] += math.hypot(e[0]-s[0], e[1]-s[1])
        elif et == 'LWPOLYLINE':
            pts = o.get('points') or []
            if pts:
                closed = bool((o.get('flag', 0) or 0) & 1)
                layer_len[lname] += seg_len(pts, closed)
        elif et == 'MLINE':
            verts = o.get('verts') or []
            pts = [v.get('vertex') for v in verts if v.get('vertex')]
            if len(pts) >= 2:
                mline_len[lname] += seg_len(pts, False)
                mline_cnt[lname] += 1
        elif et == 'INSERT':
            bn = block_name.get(href(o.get('block_header')), '?')
            block_use[bn] += 1
            block_layer[bn][lname] += 1
        elif et == 'ATTRIB':
            tag = dec(o.get('tag', ''))
            val = dec(o.get('default_value', o.get('text_value', '')))
            if (val or '').strip():
                attribs.append((tag, val))

    return dict(ent_count=ent_count, layer_ent=layer_ent, layer_len=layer_len,
                mline_len=mline_len, mline_cnt=mline_cnt,
                block_use=block_use, block_layer=block_layer, attribs=attribs,
                layers=sorted(set(layer_name.values())))

if __name__ == '__main__':
    path = sys.argv[1]
    r = analyze(path)
    name = path.split('/')[-1]
    print(f"\n{'='*78}\n{name}\n{'='*78}")
    print(f"Entities: " + ", ".join(f"{k}={v}" for k, v in r['ent_count'].most_common()))
    print(f"\nLAYERS ({len(r['layers'])}):")
    for l in r['layers']:
        print(f"   {l}")
    print(f"\nLAYER co hinh hoc (so dt | chieu dai):")
    for l, n in r['layer_ent'].most_common():
        ln = r['layer_len'].get(l, 0)
        print(f"   {l:42} {n:5d} dt   {ln/1000:10.1f} (k.don.vi)")
    print(f"\nBLOCK INSERT (top 30):")
    for b, n in r['block_use'].most_common(30):
        print(f"   {b:42} x{n}")
    print(f"\nATTRIB (khung ten) {len(r['attribs'])} gia tri co noi dung:")
    for tag, val in r['attribs'][:40]:
        print(f"   {tag:26} = {val!r}")

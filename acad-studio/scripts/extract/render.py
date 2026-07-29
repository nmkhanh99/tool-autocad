#!/usr/bin/env python3
"""Render CSV hình học phẳng (từ walk.lsp) ra PNG để MẮT NGƯỜI xem được."""
import csv, math, os, re, sys
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.collections import LineCollection

src = sys.argv[1]
out = sys.argv[2]
title = sys.argv[3] if len(sys.argv) > 3 else src
# vùng cắt tuỳ chọn: xmin ymin xmax ymax
clip = [float(x) for x in sys.argv[4:8]] if len(sys.argv) >= 8 else None

rows = list(csv.DictReader(open(src, encoding="cp1252", errors="replace")))
ROOTS = os.environ.get("RENDER_ROOTS")
if ROOTS:
    want = set(ROOTS.split(","))
    rows = [r for r in rows if (r.get("root") or "") in want]

segs, texts, circles = [], [], []

def nums(s):
    out = []
    for t in s.split("|")[0].split():
        try: out.append(float(t))
        except ValueError: pass
    return out

for r in rows:
    ty, d = r["type"], r["data"]
    v = nums(d)
    try:
        if ty == "LINE" and len(v) >= 4:
            segs.append(((v[0], v[1]), (v[2], v[3])))
        elif ty in ("LWPOLYLINE", "MLINE") and len(v) >= 4:
            pts = [(v[i], v[i + 1]) for i in range(0, len(v) - 1, 2)]
            closed = ty == "LWPOLYLINE" and d.split("|")[-1].strip() in ("1", "129")
            for i in range(len(pts) - 1):
                segs.append((pts[i], pts[i + 1]))
            if closed and len(pts) > 2:
                segs.append((pts[-1], pts[0]))
        elif ty == "CIRCLE" and len(v) >= 3:
            circles.append((v[0], v[1], v[2]))
        elif ty == "ARC" and len(v) >= 5:
            cx, cy, rr, a1, a2 = v[0], v[1], v[2], v[3], v[4]
            if a2 < a1: a2 += 360.0
            n = max(6, int((a2 - a1) / 8))
            pts = [(cx + rr * math.cos(math.radians(a1 + (a2 - a1) * k / n)),
                    cy + rr * math.sin(math.radians(a1 + (a2 - a1) * k / n))) for k in range(n + 1)]
            for i in range(len(pts) - 1): segs.append((pts[i], pts[i + 1]))
        elif ty == "ELLIPSE" and len(v) >= 5:
            cx, cy, mx, my, ratio = v[:5]
            a = math.hypot(mx, my); b = a * ratio; rot = math.atan2(my, mx)
            pts = []
            for k in range(37):
                t = 2 * math.pi * k / 36
                x, y = a * math.cos(t), b * math.sin(t)
                pts.append((cx + x * math.cos(rot) - y * math.sin(rot),
                            cy + x * math.sin(rot) + y * math.cos(rot)))
            for i in range(len(pts) - 1): segs.append((pts[i], pts[i + 1]))
        elif ty in ("TEXT", "MTEXT", "ATTRIB") and len(v) >= 3:
            txt = d.split("|", 1)[1] if "|" in d else ""
            # AutoCAD lưu ký tự ngoài codepage dạng \U+XXXX -> giải mã để xem đúng
            txt = re.sub(r"\\U\+([0-9A-Fa-f]{4})", lambda m: chr(int(m.group(1), 16)), txt)
            txt = re.sub(r"\\[A-Za-z][^;]*;", "", txt)
            if txt.strip():
                texts.append((v[0], v[1], v[2], txt.strip()))
    except Exception:
        pass

allpts = [p for s in segs for p in s] + [(c[0], c[1]) for c in circles]
if clip:
    x0, y0, x1, y1 = clip
    segs = [s for s in segs if x0 <= s[0][0] <= x1 and y0 <= s[0][1] <= y1]
    circles = [c for c in circles if x0 <= c[0] <= x1 and y0 <= c[1] <= y1]
    texts = [t for t in texts if x0 <= t[0] <= x1 and y0 <= t[1] <= y1]
    allpts = [p for s in segs for p in s]

if not allpts:
    print("KHÔNG có hình học để vẽ"); sys.exit(1)

xs = [p[0] for p in allpts]; ys = [p[1] for p in allpts]
xmin, xmax, ymin, ymax = min(xs), max(xs), min(ys), max(ys)
w, h = xmax - xmin, ymax - ymin
pad = max(w, h) * 0.03

fig, ax = plt.subplots(figsize=(20, 20 * max(h, 1) / max(w, 1)), dpi=110)
ax.add_collection(LineCollection(segs, linewidths=0.35, colors="#111111"))
for cx, cy, rr in circles:
    ax.add_patch(plt.Circle((cx, cy), rr, fill=False, lw=0.35, color="#111111"))

span = max(w, h)
for tx, ty_, th, s in texts:
    if th > span / 400:
        ax.text(tx, ty_, s[:40], fontsize=min(9, max(3, th / span * 900)),
                color="#0055aa", ha="left", va="bottom")

ax.set_xlim(xmin - pad, xmax + pad); ax.set_ylim(ymin - pad, ymax + pad)
ax.set_aspect("equal"); ax.axis("off")
ax.set_title(f"{title}\n{len(segs)} đoạn · {len(circles)} tròn · {len(texts)} chữ · "
             f"bbox {w:.0f} × {h:.0f} mm", fontsize=11)
plt.tight_layout(); plt.savefig(out, bbox_inches="tight", facecolor="white")
print(f"{out}  segs={len(segs)} circles={len(circles)} texts={len(texts)} bbox=({xmin:.0f},{ymin:.0f})..({xmax:.0f},{ymax:.0f})")

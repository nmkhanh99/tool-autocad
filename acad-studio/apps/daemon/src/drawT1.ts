/**
 * drawT1 — VẼ THẬT bản vẽ kiểu "ABD_He thong thoat nuoc tang 1".
 *
 * Nguồn hình học: demo/t1-draw-recipe.json (trích từ bản vẽ mẫu bằng
 * AcCoreConsole → scripts/mkrecipe.py). KHÔNG clone/INSERT as-built —
 * mọi entity được vẽ lại từ đầu bằng acad-lisp/headless/draw_lib.lsp.
 *
 * Mỗi bước tuân thủ hợp đồng wait-apply:
 *   stage  → vẽ lên layer ACAD-PREVIEW-<opId>, chưa đụng layer đích
 *   apply  → CHPROP sang layer đích (chỉ chạy sau khi user Chấp nhận)
 *   reject → ERASE toàn bộ preview
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

export function projectRoot(): string {
  return (
    process.env.ACAD_PROJECT_ROOT ||
    process.env.MEP_PROJECT_ROOT ||
    resolve(HERE, "../../../..")
  );
}

export function drawLibPath(): string {
  return join(projectRoot(), "acad-lisp/headless/draw_lib.lsp");
}

export function recipePath(): string {
  return join(projectRoot(), "acad-studio/demo/t1-draw-recipe.json");
}

export function planSpecPath(): string {
  return join(projectRoot(), "acad-studio/demo/t1-plan-spec.json");
}

// ────────────────────────────────────────────── mặt bằng kiến trúc (nền)

export type PlanSpec = {
  source: string;
  extent_mm: [number, number];
  grid: {
    x: Record<string, number>;
    y: Record<string, number>;
    bubble_r: number;
    label_h: number;
  };
  walls: { p1: Pt; p2: Pt; thickness: number; kind: string }[] | null;
  cores: {
    stair: { box: [number, number, number, number]; steps: number; step_dir: "V" | "H" } | null;
    elevators: { box: [number, number, number, number] }[] | null;
    wc: {
      box: [number, number, number, number];
      fixtures: { kind: string; p: Pt; r: number }[];
    } | null;
  };
  doors: { hinge: Pt; width: number; angle_deg: number }[] | null;
  rooms: { name: string; p: Pt; h: number }[] | null;
  ramp: { outline: Pt[] } | null;
};

let planCache: PlanSpec | null = null;

export function loadPlanSpec(path?: string): PlanSpec | null {
  if (!path && planCache) return planCache;
  const p = path || planSpecPath();
  if (!existsSync(p)) return null;
  const s = JSON.parse(readFileSync(p, "utf8")) as PlanSpec;
  if (!path) planCache = s;
  return s;
}

export function __resetPlanCache(): void {
  planCache = null;
}

// ───────────────────────────────────────────────────────────── recipe types

export type Pt = [number, number];

export type RecipePipe = {
  handle: string; layer: string; mlstyle: string; dn: number;
  points: Pt[]; length_mm: number;
};
export type RecipeFitting = {
  handle: string; layer: string; kind: "CHECH" | "Y" | "CON" | "CUT";
  dn: number; label: string; point: Pt; rot_deg: number;
};
export type RecipeDim = {
  handle: string; layer: string; dimstyle: string;
  /** "H" = g50 0 (ngang), "V" = g50 pi/2 (đứng) — bản mẫu chỉ có 2 giá trị này */
  orient: "H" | "V";
  measure_mm: number;
  p1: Pt; p2: Pt; ptext: Pt;
};
export type RecipeDimStyle = {
  name: string; dimpost: string; dimscale: number; dimtxt: number;
  dimasz: number; dimclrt: number; textstyle: string;
};
export type RecipeLeader = {
  handle: string; layer: string; arrow: Pt; landing: Pt; text: string;
};
export type RecipeLwp = { handle: string; layer: string; closed: boolean; points: Pt[] };
export type RecipeCircle = { handle: string; layer: string; center: Pt; radius: number };

export type DrawRecipe = {
  id: string;
  source_dwg: string;
  units: string;
  plot_scale: string;
  layers: { name: string; color: number; linetype: string }[];
  mlinestyles: string[];
  dimstyles: RecipeDimStyle[];
  titleblock: { block: string; attrs: Record<string, string> };
  pipes: RecipePipe[];
  fittings: RecipeFitting[];
  dims: RecipeDim[];
  leaders: RecipeLeader[];
  lwpolylines: RecipeLwp[];
  circles: RecipeCircle[];
  hatches: { handle: string; layer: string; pattern: string; scale: number; angle: number }[];
  totals: Record<string, number>;
};

let cached: DrawRecipe | null = null;

export function loadDrawRecipe(path?: string): DrawRecipe {
  if (!path && cached) return cached;
  const p = path || recipePath();
  if (!existsSync(p)) throw new Error(`Không thấy draw recipe: ${p}`);
  const r = JSON.parse(readFileSync(p, "utf8")) as DrawRecipe;
  if (!path) cached = r;
  return r;
}

export function __resetRecipeCache(): void {
  cached = null;
}

// ────────────────────────────────────────────────────────── LISP generation

/**
 * ĐẶT HỆ ỐNG LÊN MẶT BẰNG.
 *
 * Hình học ống trong recipe nằm ở hệ toạ độ riêng gồm 3 cụm rời nhau
 * (xem DRAW-T1-REAL.md §1.3):
 *   - cụm x≈36 000, cao 11.26 m  → tuyến thoát chính chạy dọc trục D
 *   - 2 cụm x≈0 và x≈51 000, cao ~2.6-3.0 m → chi tiết trục đứng WC
 *
 * Bản mẫu trải 3 cụm này ra 4 tờ A3 khác nhau. Demo dựng 1 tờ nên phải dời
 * chúng về đúng chỗ trên mặt bằng: tuyến chính áp trục D, 2 chi tiết đặt
 * thành hình vẽ phụ bên phải nhà.
 */
type Cluster = { xFrom: number; xTo: number; dx: number; dy: number; label: string };

const PIPE_PLACEMENT: Cluster[] = [
  { xFrom: -1e9, xTo: 20000, dx: 25000, dy: 3000, label: "chi tiết trục đứng WC - 1" },
  { xFrom: 20000, xTo: 45000, dx: -17860, dy: 11500, label: "tuyến thoát chính (trục D)" },
  { xFrom: 45000, xTo: 1e9, dx: -20000, dy: 3000, label: "chi tiết trục đứng WC - 2" },
];

function place(p: Pt): Pt {
  const c = PIPE_PLACEMENT.find((k) => p[0] >= k.xFrom && p[0] < k.xTo);
  return c ? [p[0] + c.dx, p[1] + c.dy] : p;
}

const q = (s: string) => `"${String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
const n = (x: number) => (Number.isFinite(x) ? String(Number(x.toFixed(3))) : "0");
const pt = (p: Pt) => `(list ${n(p[0])} ${n(p[1])})`;
const ptList = (ps: Pt[]) => `(list ${ps.map(pt).join(" ")})`;
const rad = (deg: number) => Number(((deg * Math.PI) / 180).toFixed(6));

/** Layer preview riêng cho từng op — khớp dl:preview-layer. */
export function previewLayer(opId: string): string {
  return `ACAD-PREVIEW-${opId}`;
}

// ────────────────────────────────────────────────────────────── step model

export type DrawPhase =
  | "I_setup" | "II_plan" | "III_pipes" | "IV_shapes" | "V_fittings"
  | "VI_dims" | "VII_leaders" | "VIII_hatch" | "IX_legend" | "X_bom" | "XI_layout";

export type DrawStep = {
  id: string;
  order: number;
  phase: DrawPhase;
  /** Câu người dùng gõ trong chat (kịch bản demo). */
  prompt: string;
  title: string;
  /** Layer đích khi apply. null = bước không tạo entity trên layer đích (setup). */
  destLayer: string | null;
  /** Số entity kỳ vọng tạo ra (dùng để xác minh). */
  expectCount: number;
  /** Sinh phần thân LISP vẽ. `L` là biến chứa tên layer preview. */
  body: (r: DrawRecipe) => string[];
};

const F = (x: number) => Number(x.toFixed(3));

/**
 * Bước vẽ MẶT BẰNG KIẾN TRÚC — nền của bản vẽ MEP.
 * Bản mẫu chứa ~30 000 đoạn kiến trúc so với ~35 tuyến ống: mặt bằng LÀ phần
 * lớn bản vẽ, phải vẽ TRƯỚC thì bản vẽ mới đọc được.
 */
function planSteps(p: PlanSpec | null): DrawStep[] {
  if (!p) return [];
  const out: DrawStep[] = [];
  const G = p.grid;
  const gx = Object.entries(G.x).sort((a, b) => a[1] - b[1]);
  const gy = Object.entries(G.y).sort((a, b) => a[1] - b[1]);

  out.push({
    id: "plan_grid",
    order: 20,
    phase: "II_plan",
    prompt: `Vẽ lưới trục định vị ${gx.map((a) => a[0]).join("-")} và ${gy.map((a) => a[0]).join("-")}`,
    title: `Lưới trục ${gx.length} dọc × ${gy.length} ngang + bubble R${G.bubble_r}`,
    destLayer: "A-TRUC",
    // mỗi trục: 1 LINE + 2 CIRCLE + 2 TEXT = 5 entity
    expectCount: (gx.length + gy.length) * 5,
    body: () =>
      [
        "(dl:arch-layers)",
        `(dl:grid L "MEP-TXT" (list ${gx.map(([k, v]) => `(cons ${q(k)} ${n(v)})`).join(" ")}) ` +
          `(list ${gy.map(([k, v]) => `(cons ${q(k)} ${n(v)})`).join(" ")}) ` +
          `${n(G.bubble_r)} 1400.0)`,
      ],
  });

  const walls = p.walls || [];
  const bao = walls.filter((w) => w.kind === "bao");
  const ngan = walls.filter((w) => w.kind !== "bao");
  if (bao.length) {
    out.push({
      id: "plan_wall_outer",
      order: 21,
      phase: "II_plan",
      prompt: "Vẽ tường bao công trình",
      title: `Tường bao ×${bao.length} (dày ${bao[0].thickness} mm)`,
      destLayer: "A-TUONG",
      expectCount: bao.length * 2,
      body: () => bao.map((w) => `(dl:wall L ${pt(w.p1)} ${pt(w.p2)} ${n(w.thickness)})`),
    });
  }
  if (ngan.length) {
    out.push({
      id: "plan_wall_inner",
      order: 22,
      phase: "II_plan",
      prompt: "Vẽ tường ngăn và vách trong nhà",
      title: `Tường ngăn ×${ngan.length}`,
      destLayer: "A-TUONG",
      expectCount: ngan.length * 2,
      body: () => ngan.map((w) => `(dl:wall L ${pt(w.p1)} ${pt(w.p2)} ${n(w.thickness)})`),
    });
  }

  const st = p.cores?.stair;
  if (st) {
    out.push({
      id: "plan_stair",
      order: 23,
      phase: "II_plan",
      prompt: "Vẽ cầu thang bộ",
      title: `Cầu thang ${st.steps} bậc`,
      destLayer: "A-LOI",
      // khung + (steps-1) bậc + 3 nét mũi tên
      expectCount: 1 + (st.steps - 1) + 3,
      body: () =>
        [
          `(dl:stair L ${n(st.box[0])} ${n(st.box[1])} ${n(st.box[2])} ${n(st.box[3])} ` +
            `${st.steps} ${q(st.step_dir)})`,
        ],
    });
  }

  const lifts = p.cores?.elevators || [];
  if (lifts.length) {
    out.push({
      id: "plan_elevator",
      order: 24,
      phase: "II_plan",
      prompt: `Vẽ ${lifts.length} thang máy`,
      title: `Thang máy ×${lifts.length}`,
      destLayer: "A-LOI",
      expectCount: lifts.length * 4,
      body: () =>
        lifts.map(
          (e) => `(dl:elevator L ${n(e.box[0])} ${n(e.box[1])} ${n(e.box[2])} ${n(e.box[3])})`,
        ),
    });
  }

  const wc = p.cores?.wc;
  if (wc) {
    const fx = wc.fixtures || [];
    out.push({
      id: "plan_wc",
      order: 25,
      phase: "II_plan",
      prompt: "Vẽ khu WC và thiết bị vệ sinh",
      title: `Khu WC + ${fx.length} thiết bị vệ sinh`,
      destLayer: "A-TB",
      // 1 khung phòng + mỗi thiết bị: "xi"/"tieu" vẽ 2 entity, "chau" vẽ 1.
      expectCount:
        1 + fx.reduce((s, f) => s + (f.kind === "chau" ? 1 : 2), 0),
      body: () =>
        [
          `(dl:room-box L ${n(wc.box[0])} ${n(wc.box[1])} ${n(wc.box[2])} ${n(wc.box[3])})`,
          ...fx.map((f) => `(dl:fixture L ${q(f.kind)} ${pt(f.p)} ${n(f.r)})`),
        ],
    });
  }

  const doors = p.doors || [];
  if (doors.length) {
    out.push({
      id: "plan_doors",
      order: 26,
      phase: "II_plan",
      prompt: "Vẽ cửa đi",
      title: `Cửa ×${doors.length} (cánh + cung quét)`,
      destLayer: "A-CUA",
      expectCount: doors.length * 2,
      body: () => doors.map((d) => `(dl:door L ${pt(d.hinge)} ${n(d.width)} ${n(d.angle_deg)})`),
    });
  }

  if (p.ramp?.outline?.length) {
    out.push({
      id: "plan_ramp",
      order: 27,
      phase: "II_plan",
      prompt: "Vẽ lối lên xuống tầng hầm",
      title: "Ram dốc tầng hầm + hatch",
      destLayer: "A-HATCH",
      expectCount: 2,
      body: () => [
        `(dl:hatch L "ANSI31" 200 45 (dl:lwpoly L ${ptList(p.ramp!.outline)} T))`,
      ],
    });
  }

  const rooms = p.rooms || [];
  if (rooms.length) {
    out.push({
      id: "plan_room_labels",
      order: 28,
      phase: "II_plan",
      prompt: "Vẽ tên các phòng",
      title: `Nhãn phòng ×${rooms.length}: ${rooms.slice(0, 3).map((r) => r.name).join(", ")}…`,
      destLayer: "A-TEXT",
      expectCount: rooms.length,
      body: () =>
        rooms.map((r) => `(dl:room-label L "MEP-TXT" ${pt(r.p)} ${n(r.h)} ${q(r.name)})`),
    });
  }

  return out;
}

function pipeSteps(r: DrawRecipe): DrawStep[] {
  const groups = new Map<string, RecipePipe[]>();
  for (const p of r.pipes) {
    const k = `${p.layer}|${p.dn}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(p);
  }
  // Trục chính (DN lớn) vẽ trước, nhánh nhỏ sau — đúng thứ tự thi công.
  const keys = [...groups.keys()].sort((a, b) => {
    const [la, da] = a.split("|");
    const [lb, db] = b.split("|");
    if (la !== lb) return la === "P-ThoatXi" ? -1 : 1;
    return Number(db) - Number(da);
  });
  return keys.map((k, i) => {
    const [layer, dnStr] = k.split("|");
    const dn = Number(dnStr);
    const list = groups.get(k)!;
    const he = layer === "P-ThoatXi" ? "thoát xí" : layer === "P-ThoatRua" ? "thoát rửa" : layer;
    const m = F(list.reduce((s, p) => s + p.length_mm, 0) / 1000);
    return {
      id: `pipe_${layer.replace(/[^A-Za-z]/g, "").toLowerCase()}_dn${dn}`,
      order: 100 + i,
      phase: "III_pipes" as DrawPhase,
      prompt: `Vẽ ống ${he} DN${dn}`,
      title: `Ống ${he} DN${dn} — ${list.length} tuyến, ${m} m`,
      destLayer: layer,
      expectCount: list.length,
      body: () =>
        list.map(
          (p) => `(dl:pipe L ${q(p.mlstyle)} ${dn} ${ptList(p.points.map(place))})`,
        ),
    };
  });
}

function fittingSteps(r: DrawRecipe): DrawStep[] {
  const groups = new Map<string, RecipeFitting[]>();
  for (const f of r.fittings) {
    const k = `${f.kind}|${f.dn}|${f.layer}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(f);
  }
  const KIND_VN: Record<string, string> = {
    CHECH: "chếch", Y: "nhánh Y", CON: "côn thu", CUT: "cút",
  };
  const keys = [...groups.keys()].sort((a, b) => {
    const [ka, da] = a.split("|");
    const [kb, db] = b.split("|");
    if (ka !== kb) return ka.localeCompare(kb);
    return Number(db) - Number(da);
  });
  return keys.map((k, i) => {
    const [kind, dnStr, layer] = k.split("|");
    const dn = Number(dnStr);
    const list = groups.get(k)!;
    return {
      id: `fit_${kind.toLowerCase()}_dn${dn}_${layer === "P-ThoatXi" ? "xi" : "rua"}`,
      order: 200 + i,
      phase: "V_fittings" as DrawPhase,
      prompt: `Vẽ phụ kiện ${KIND_VN[kind]} DN${dn} trên ${layer === "P-ThoatXi" ? "ống thoát xí" : "ống thoát rửa"}`,
      title: `Phụ kiện ${KIND_VN[kind]} DN${dn} ×${list.length} (${layer})`,
      destLayer: layer,
      expectCount: list.length,
      body: () =>
        list.map(
          (f) =>
            `(dl:fitting L ${q(f.kind)} ${dn} ${pt(place(f.point))} ${rad(f.rot_deg)} ${q(f.label)})`,
        ),
    };
  });
}

function dimSteps(r: DrawRecipe): DrawStep[] {
  const groups = new Map<string, RecipeDim[]>();
  for (const d of r.dims) {
    if (!groups.has(d.dimstyle)) groups.set(d.dimstyle, []);
    groups.get(d.dimstyle)!.push(d);
  }
  return [...groups.keys()].sort().map((sty, i) => {
    const list = groups.get(sty)!;
    const m = F(list.reduce((s, d) => s + d.measure_mm, 0) / 1000);
    return {
      id: `dim_${sty.replace(/[^A-Za-z0-9]/g, "").toLowerCase()}`,
      order: 300 + i,
      phase: "VI_dims" as DrawPhase,
      prompt: `Vẽ kích thước dimstyle ${sty}`,
      title: `DIMENSION ${sty} ×${list.length} trên layer A.DIM (tổng đo ${m} m)`,
      destLayer: "A.DIM",
      expectCount: list.length,
      body: () =>
        list.map(
          (d) =>
            `(dl:dim-linear L ${q(d.dimstyle)} ${q(d.orient)} ${pt(place(d.p1))} ${pt(place(d.p2))} ${pt(place(d.ptext))})`,
        ),
    };
  });
}

function leaderSteps(r: DrawRecipe): DrawStep[] {
  const groups = new Map<string, RecipeLeader[]>();
  for (const l of r.leaders) {
    if (!groups.has(l.text)) groups.set(l.text, []);
    groups.get(l.text)!.push(l);
  }
  return [...groups.keys()].sort().map((text, i) => {
    const list = groups.get(text)!;
    return {
      id: `leader_${text.replace(/[^A-Za-z0-9]/g, "").toLowerCase()}`,
      order: 400 + i,
      phase: "VII_leaders" as DrawPhase,
      prompt: `Vẽ ghi chú dẫn ${text}`,
      title: `Ghi chú dẫn «${text}» ×${list.length}`,
      destLayer: "Leader",
      // mỗi ghi chú = 1 LEADER + 1 LWPOLYLINE mũi tên + 1 TEXT
      expectCount: list.length * 3,
      body: () =>
        list.map((l) => `(dl:mleader L ${pt(place(l.arrow))} ${pt(place(l.landing))} ${q(l.text)} 200.0)`),
    };
  });
}

/** Ghi chú chung + bảng ký hiệu — nội dung Unicode (bản mẫu lưu TCVN3 legacy). */
export const LEGEND_ROWS: { layer: string; label: string }[] = [
  { layer: "P-ThoatXi", label: "Ống thoát nước xí" },
  { layer: "P-ThoatRua", label: "Ống thoát nước rửa" },
];
export const GENERAL_NOTE =
  "- ỐNG THOÁT NƯỚC SẼ ĐƯỢC BỌC BẢO ÔN TIÊU ÂM DÀY 25MM.";

export function buildDrawSteps(r?: DrawRecipe): DrawStep[] {
  const rec = r || loadDrawRecipe();
  const steps: DrawStep[] = [];

  // ── I. Chuẩn bị: layer + style ────────────────────────────────────────
  steps.push({
    id: "setup_layers",
    order: 1,
    phase: "I_setup",
    prompt: "Vẽ bộ layer chuẩn hệ thoát nước",
    title: `Tạo ${rec.layers.length} layer chuẩn (P-ThoatXi 190, P-ThoatRua 50, …)`,
    destLayer: null,
    expectCount: 0,
    body: (rr) => [
      "(dl:std-layers)",
      ...rr.layers.map((l) => `(dl:layer ${q(l.name)} ${l.color} nil)`),
    ],
  });
  steps.push({
    id: "setup_styles",
    order: 2,
    phase: "I_setup",
    prompt: "Vẽ style chuẩn: mline style, text style, dimstyle",
    title: `MLINE style ${rec.mlinestyles.join("/")} + text style + ${rec.dimstyles.length} dimstyle`,
    destLayer: null,
    expectCount: 0,
    body: (rr) => [
      ...rr.mlinestyles.map((s) => `(dl:mlstyle ${q(s)} "AcadToolkit pipe")`),
      `(dl:textstyle "MEP-TXT" "romans.shx" 0.8)`,
      // DIMSCALE=100 / DIMTXT=2 / DIMASZ=0.5 lấy đúng từ bản vẽ mẫu
      ...rr.dimstyles.map(
        (s) =>
          `(dl:dimstyle ${q(s.name)} ${q(s.dimpost)} ${n(s.dimscale)} ${n(s.dimtxt)} ` +
          `${n(s.dimasz)} ${s.dimclrt} "MEP-TXT")`,
      ),
    ],
  });

  // ── II. Mặt bằng kiến trúc (nền) ─────────────────────────────────────
  steps.push(...planSteps(loadPlanSpec()));

  // ── Khung tên (vẽ sau cùng, cùng nhóm sheet) ─────────────────────────
  steps.push({
    id: "sheet_titleblock",
    order: 750,
    phase: "X_bom",
    prompt: "Vẽ khung tên A3 và điền thông tin bản vẽ",
    title: `Khung tên A3 + ${Object.keys(rec.titleblock.attrs).length} thuộc tính (KHBV ${rec.titleblock.attrs["KHBV"] || "-"})`,
    destLayer: "0-9",
    expectCount: 1,
    body: (rr) => {
      const attrs = Object.entries(rr.titleblock.attrs)
        .map(([k, v]) => `(cons ${q(k)} ${q(v)})`)
        .join(" ");
      // Khung A3 scale 103.704 → 43 556 × 30 800 mm. Đặt gốc sao cho MẶT BẰNG
      // (0,0)-(21909,26463) nằm GỌN TRONG khung, chừa lề trái 3 m / dưới 2 m —
      // giống bản mẫu: khung bao quanh mặt bằng chứ không nằm cạnh.
      return [`(dl:titleblock L "A3-FRAME" (list -3000.0 -2000.0) 103.704 (list ${attrs}))`];
    },
  });

  // ── III. Ống ──────────────────────────────────────────────────────────
  steps.push(...pipeSteps(rec));

  // ── IV. Đường bao / trục đứng ────────────────────────────────────────
  if (rec.lwpolylines.length) {
    steps.push({
      id: "shape_lwpoly",
      order: 150,
      phase: "IV_shapes",
      prompt: "Vẽ đường bao và ký hiệu hướng dòng chảy",
      title: `LWPOLYLINE ×${rec.lwpolylines.length} trên P-ThoatRua`,
      destLayer: "P-ThoatRua",
      expectCount: rec.lwpolylines.length,
      body: (rr) =>
        rr.lwpolylines.map(
          (p) => `(dl:lwpoly L ${ptList(p.points.map(place))} ${p.closed ? "T" : "nil"})`,
        ),
    });
  }
  if (rec.circles.length) {
    steps.push({
      id: "shape_riser",
      order: 151,
      phase: "IV_shapes",
      prompt: "Vẽ ký hiệu trục đứng",
      title: `CIRCLE trục đứng ×${rec.circles.length} (R=${rec.circles[0].radius})`,
      destLayer: rec.circles[0].layer,
      expectCount: rec.circles.length,
      body: (rr) => rr.circles.map((c) => `(dl:circle L ${pt(place(c.center))} ${n(c.radius)})`),
    });
  }

  // ── V. Phụ kiện ───────────────────────────────────────────────────────
  steps.push(...fittingSteps(rec));

  // ── VI. Kích thước ────────────────────────────────────────────────────
  steps.push(...dimSteps(rec));

  // ── VII. Ghi chú dẫn ─────────────────────────────────────────────────
  steps.push(...leaderSteps(rec));

  // ── VIII. Hatch ───────────────────────────────────────────────────────
  if (rec.hatches.length) {
    steps.push({
      id: "hatch_ansi31",
      order: 500,
      phase: "VIII_hatch",
      prompt: "Vẽ hatch ANSI31 vùng kỹ thuật",
      title: `HATCH ANSI31 ×${rec.hatches.length} (scale 20)`,
      destLayer: "P-ThoatRua",
      // mỗi vùng = 1 LWPOLYLINE biên + 1 HATCH
      expectCount: rec.hatches.length * 2,
      body: (rr) => {
        // Bản mẫu không lưu biên hatch dạng LWPOLYLINE riêng → dựng biên
        // vuông quanh 2 hộp kỹ thuật đầu tiên trong danh sách LWPOLYLINE đóng.
        const boxes = rr.lwpolylines.filter((p) => p.closed).slice(0, rr.hatches.length);
        return boxes.map(
          (b) =>
            `(dl:hatch L "ANSI31" 20 0 (dl:lwpoly L ${ptList(b.points.map(place))} T))`,
        );
      },
    });
  }

  // ── IX. Bảng ký hiệu + ghi chú chung ─────────────────────────────────
  steps.push({
    id: "legend_block",
    order: 600,
    phase: "IX_legend",
    prompt: "Vẽ bảng ký hiệu và ghi chú chung",
    title: `Bảng ký hiệu ${LEGEND_ROWS.length} dòng + ghi chú bảo ôn`,
    destLayer: "DCCD-text",
    expectCount: LEGEND_ROWS.length * 2 + 2,
    body: () => {
      const x = 25000, y0 = 24000, dy = 1400;
      const out: string[] = [`(dl:text L "MEP-TXT" (list ${x} ${y0 + dy * 2}) 500 0 ${q("KÝ HIỆU")})`];
      LEGEND_ROWS.forEach((row, i) => {
        const y = y0 - i * dy;
        out.push(`(dl:pipe L "MLST1" 90 (list (list ${x} ${y}) (list ${x + 2500} ${y})))`);
        out.push(`(dl:text L "MEP-TXT" (list ${x + 3000} ${y - 200}) 400 0 ${q(row.label)})`);
      });
      out.push(
        `(dl:text L "MEP-TXT" (list ${x} ${y0 - LEGEND_ROWS.length * dy - 800}) 400 0 ${q(GENERAL_NOTE)})`,
      );
      return out;
    },
  });

  // ── X. Bảng khối lượng ───────────────────────────────────────────────
  // Bảng vẽ bằng LINE + TEXT: mỗi ô = 2 LINE + 1 TEXT, mỗi dòng thêm 1 LINE
  // viền phải, cuối bảng thêm `cols` LINE viền đáy.
  const bomRowCount = new Set(rec.pipes.map((p) => `${p.layer}|${p.dn}`)).size + 2;
  const BOM_COLS = 3;
  steps.push({
    id: "bom_table",
    order: 700,
    phase: "X_bom",
    prompt: "Vẽ bảng khối lượng ống",
    title: `Bảng khối lượng ${bomRowCount} dòng theo hệ / DN + tổng chiều dài`,
    destLayer: "DCCD-text",
    expectCount: bomRowCount * (BOM_COLS * 3 + 1) + BOM_COLS,
    body: (rr) => {
      const agg = new Map<string, number>();
      for (const p of rr.pipes) {
        const k = `${p.layer}|${p.dn}`;
        agg.set(k, (agg.get(k) || 0) + p.length_mm);
      }
      const rows = [`(list ${q("Hệ thống")} ${q("DN")} ${q("Dài (m)")})`];
      let total = 0;
      for (const [k, v] of [...agg.entries()].sort()) {
        const [layer, dn] = k.split("|");
        total += v;
        const he = layer === "P-ThoatXi" ? "Thoát xí" : "Thoát rửa";
        rows.push(`(list ${q(he)} ${q(dn)} ${q(F(v / 1000).toFixed(2))})`);
      }
      rows.push(`(list ${q("TỔNG")} ${q("")} ${q(F(total / 1000).toFixed(2))})`);
      return [
        `(dl:table L "MEP-TXT" (list 25000.0 17000.0) (list 6000.0 3000.0 4000.0) 1200 (list ${rows.join(" ")}))`,
      ];
    },
  });

  // ── XI. Layout + viewport ────────────────────────────────────────────
  steps.push({
    id: "layout_a3",
    order: 800,
    phase: "XI_layout",
    prompt: "Vẽ layout A3 và viewport",
    // Tỷ lệ viewport KHÔNG set được bằng AutoLISP thuần trên macOS (không có
    // ActiveX; ZOOM …xp bị AcCoreConsole từ chối) — đặt thủ công trong GUI.
    title: "Layout A3 420×297 + VIEWPORT (tỷ lệ đặt thủ công, bản mẫu 1:103.7)",
    destLayer: null,
    // MVIEW sinh 2 VIEWPORT: 1 viewport 'giả' của paper space (g69=1) + 1 viewport
    // thật nhìn vào model. Bản mẫu cũng có cặp này ở mỗi layout.
    expectCount: 2,
    body: () => [
      `(dl:layout "SHEET-01")`,
      `(dl:viewport (list 20.0 20.0) (list 400.0 280.0))`,
      `(dl:to-model)`,
    ],
  });

  return steps.sort((a, b) => a.order - b.order);
}

// ────────────────────────────────────────────────────────── LISP builders

function header(): string[] {
  return [`(load ${q(drawLibPath())})`, "(dl:silent)"];
}

/** Bảo đảm layer + style tồn tại trước MỌI bước (bước có thể chạy riêng lẻ). */
function ensureStandards(r: DrawRecipe): string[] {
  return [
    "(dl:std-layers)",
    ...r.mlinestyles.map((s) => `(dl:mlstyle ${q(s)} "AcadToolkit pipe")`),
    `(dl:textstyle "MEP-TXT" "romans.shx" 0.8)`,
    ...r.dimstyles.map(
      (s) =>
        `(dl:dimstyle ${q(s.name)} ${q(s.dimpost)} ${n(s.dimscale)} ${n(s.dimtxt)} ` +
        `${n(s.dimasz)} ${s.dimclrt} "MEP-TXT")`,
    ),
  ];
}

export type LispJob = { lisp: string; opId: string; destLayer: string | null; expectCount: number };

/**
 * Chế độ chạy:
 *  - "headless": AcCoreConsole mở DWG ĐÓNG → tự ghi result file + SAVEAS.
 *  - "live":     bridge nạp job vào AutoCAD ĐANG MỞ → trả kết quả qua
 *                (acad:write-result …) do wrapJob cung cấp, KHÔNG SAVEAS
 *                (giữ bản vẽ ở trạng thái dirty để người dùng tự Undo/Save).
 */
export type DrawMode = "headless" | "live";

type BuildOpts = {
  resultPath?: string;
  savePath?: string;
  recipe?: DrawRecipe;
  mode?: DrawMode;
};

/** Sinh câu trả kết quả đúng theo chế độ. kvs = list cặp (khoá, biểu-thức-LISP-chuỗi). */
function resultLine(mode: DrawMode, resultPath: string | undefined, kvs: [string, string][]): string {
  if (mode === "live") {
    // Ghép thành một chuỗi "k=v k=v" cho acad:write-result — daemon tự tách.
    const parts = kvs.map(([k, v]) => `${q(`${k}=`)} ${v}`).join(" " + q(" ") + " ");
    return `(acad:write-result "ok" (strcat ${parts}))`;
  }
  const pairs = kvs.map(([k, v]) => `(cons ${q(k)} ${v})`).join(" ");
  return `(dl:result ${q(resultPath || "")} (list ${pairs}))`;
}

/** STAGE: vẽ lên layer preview. Chưa đụng layer đích. */
export function buildStageLisp(
  stepId: string,
  opId: string,
  opts: BuildOpts,
): LispJob {
  const r = opts.recipe || loadDrawRecipe();
  const mode: DrawMode = opts.mode || "headless";
  const step = buildDrawSteps(r).find((s) => s.id === stepId);
  if (!step) throw new Error(`Không có bước vẽ '${stepId}'`);
  const lines = [
    ...header(),
    ...ensureStandards(r),
    `(dl:preview-begin ${q(opId)})`,
    `(setq L (dl:preview-layer ${q(opId)}))`,
    ...step.body(r),
    `(setq N (dl:preview-count ${q(opId)}))`,
    resultLine(mode, opts.resultPath, [
      ["step", q(stepId)],
      ["opId", q(opId)],
      ["state", q("staged")],
      ["staged", "(itoa N)"],
      ["expect", q(String(step.expectCount))],
      ["previewLayer", `(dl:preview-layer ${q(opId)})`],
      ["destLayer", q(step.destLayer || "")],
    ]),
  ];
  if (mode === "headless" && opts.savePath) lines.push(`(dl:save ${q(opts.savePath)})`);
  lines.push("(princ)");
  return { lisp: lines.join("\n") + "\n", opId, destLayer: step.destLayer, expectCount: step.expectCount };
}

/** APPLY: chỉ chạy SAU khi user Chấp nhận. Chuyển preview → layer đích. */
export function buildApplyLisp(
  stepId: string,
  opId: string,
  opts: BuildOpts,
): LispJob {
  const r = opts.recipe || loadDrawRecipe();
  const mode: DrawMode = opts.mode || "headless";
  const step = buildDrawSteps(r).find((s) => s.id === stepId);
  if (!step) throw new Error(`Không có bước vẽ '${stepId}'`);
  // Bước setup/layout không tạo entity → chỉ dọn layer preview.
  const dest = step.destLayer || "0";
  const lines = [
    ...header(),
    `(setq N (dl:preview-apply ${q(opId)} ${q(dest)}))`,
    resultLine(mode, opts.resultPath, [
      ["step", q(stepId)],
      ["opId", q(opId)],
      ["state", q("applied")],
      ["applied", "(itoa N)"],
      ["destLayer", q(dest)],
    ]),
  ];
  if (mode === "headless" && opts.savePath) lines.push(`(dl:save ${q(opts.savePath)})`);
  lines.push("(princ)");
  return { lisp: lines.join("\n") + "\n", opId, destLayer: dest, expectCount: step.expectCount };
}

/** REJECT: xoá sạch preview, bản vẽ trở lại trạng thái trước bước. */
export function buildRejectLisp(
  stepId: string,
  opId: string,
  opts: BuildOpts,
): LispJob {
  const mode: DrawMode = opts.mode || "headless";
  const lines = [
    ...header(),
    `(setq N (dl:preview-reject ${q(opId)}))`,
    resultLine(mode, opts.resultPath, [
      ["step", q(stepId)],
      ["opId", q(opId)],
      ["state", q("rejected")],
      ["erased", "(itoa N)"],
    ]),
  ];
  if (mode === "headless" && opts.savePath) lines.push(`(dl:save ${q(opts.savePath)})`);
  lines.push("(princ)");
  return { lisp: lines.join("\n") + "\n", opId, destLayer: null, expectCount: 0 };
}

/** Kiểm đếm bản vẽ hiện tại để đối chiếu với bản mẫu. */
export function buildVerifyLisp(reportPath: string): string {
  return [...header(), `(dl:report ${q(reportPath)})`, "(princ)"].join("\n") + "\n";
}

// ────────────────────────────────────────────────────────────── matching

/** Khớp câu chat tiếng Việt «Vẽ …» với một bước. */
export function matchDrawStep(text: string, steps?: DrawStep[]): DrawStep | null {
  const all = steps || buildDrawSteps();
  const norm = (s: string) =>
    s.toLowerCase().normalize("NFC").replace(/\s+/g, " ").trim();
  const t = norm(text);
  if (!t) return null;
  let best: { step: DrawStep; score: number } | null = null;
  for (const s of all) {
    const p = norm(s.prompt);
    let score = 0;
    if (t === p) score = 1000;
    else if (t.includes(p) || p.includes(t)) score = 500 + Math.min(p.length, t.length);
    else {
      const words = p.split(" ").filter((w) => w.length > 2);
      const hit = words.filter((w) => t.includes(w)).length;
      // yêu cầu khớp phần lớn từ khoá để tránh nhận nhầm bước khác DN
      if (hit >= Math.ceil(words.length * 0.8)) score = hit;
    }
    if (score > 0 && (!best || score > best.score)) best = { step: s, score };
  }
  return best ? best.step : null;
}

/** Kịch bản demo dạng JSON cho UI / agent. */
export function drawScenarioJson(): {
  id: string;
  source: string;
  totalSteps: number;
  contract: string;
  steps: {
    order: number; id: string; phase: DrawPhase; prompt: string;
    title: string; destLayer: string | null; expectCount: number;
  }[];
} {
  const r = loadDrawRecipe();
  const steps = buildDrawSteps(r);
  return {
    id: "t1-draw-scenario",
    source: r.source_dwg,
    totalSteps: steps.length,
    contract:
      "stage → chờ user Chấp nhận → apply. Không apply trong cùng request với stage.",
    steps: steps.map((s) => ({
      order: s.order, id: s.id, phase: s.phase, prompt: s.prompt,
      title: s.title, destLayer: s.destLayer, expectCount: s.expectCount,
    })),
  };
}

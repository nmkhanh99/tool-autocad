/**
 * Architecture plan-block library from sample extract.
 *
 * Sample analysis (deep-entities.csv model-level INSERT):
 *   B_MBT1 ×3 @ RSA -HACK  (y pitch ≈ 30800) — nested: stairs, elevator, doors, axes
 *   B_MBT2 ×1               — MB phụ
 *   B_HienTrang ×2 @ P-ThoatRua (near origin — detail/context)
 *   B_ThoatXi_Tang1 ×2, B_ThoatRua_Tang1 ×2 — MEP plan containers
 *   A3-1-1-ISO3TGROUP ×5    — title frames
 *
 * Strategy: place parent footprints + internal arch symbols (not full as-built clone).
 * Stairs/elevators/doors live nested inside B_MBT* — never model-level free inserts.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Model-level plan / architecture blocks (not fittings). */
export const PLAN_BLOCK_NAMES = [
  "B_MBT1",
  "B_MBT2",
  "B_HienTrang",
  "B_ThoatXi_Tang1",
  "B_ThoatRua_Tang1",
  "A3-1-1-ISO3TGROUP",
] as const;

export type PlanBlockInstance = {
  name: string;
  layer: string;
  x: number;
  y: number;
  /** Uniform scale (extract default 1 when CSV has no scale cols). */
  scale?: number;
  /** Rotation degrees (extract default 0). */
  rotation?: number;
  /** Nested content note from analysis */
  nested?: string[];
};

export type PlanBlockLibrary = {
  version: 1;
  source: string;
  generatedAt: string;
  note: string;
  instances: PlanBlockInstance[];
  byName: Record<string, PlanBlockInstance[]>;
  counts: Record<string, number>;
  /** Measured sheet pitch from sample (drawing units) */
  metrics: {
    mbtPitchY: number;
    mbtSpanX: number;
  };
};

function parseCsv(text: string): Record<string, string>[] {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (!lines.length) return [];
  const headers = lines[0].split(",");
  return lines.slice(1).map((line) => {
    const cols = line.split(",");
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h.trim()] = (cols[i] ?? "").trim();
    });
    return row;
  });
}

export function defaultDeepEntitiesPath(): string {
  return join(HERE, "../../../demo/sample-t1-deep/deep-entities.csv");
}

export function defaultLibraryOutPath(): string {
  return join(HERE, "../../../demo/plan-block-library.json");
}

export function defaultSampleDwg(): string {
  return join(
    HERE,
    "../../../../As-built drawing/ABD_He thong thoat nuoc tang 1_Tran tang 1_V.00.dwg",
  );
}

export function defaultBlockDwgsDir(): string {
  return join(HERE, "../../../demo/plan-blocks");
}

/**
 * Build library of plan-block insert instances from deep-entities.csv.
 */
export function buildPlanBlockLibrary(opts?: {
  entitiesCsv?: string;
  source?: string;
}): PlanBlockLibrary {
  const csvPath = opts?.entitiesCsv || defaultDeepEntitiesPath();
  if (!existsSync(csvPath)) throw new Error("entities csv missing: " + csvPath);
  const rows = parseCsv(readFileSync(csvPath, "utf8"));
  const want = new Set<string>(PLAN_BLOCK_NAMES as unknown as string[]);
  const instances: PlanBlockInstance[] = [];
  for (const e of rows) {
    if ((e.type || "") !== "INSERT") continue;
    const name = e.block || "";
    if (!want.has(name)) continue;
    const x = Number(e.x);
    const y = Number(e.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    const nested =
      name.startsWith("B_MBT")
        ? ["cau_thang", "thang_may", "cua", "truc_Axis", "noi_that"]
        : name === "B_HienTrang"
          ? ["hien_trang"]
          : name.startsWith("B_Thoat")
            ? ["mep_container"]
            : name.startsWith("A3")
              ? ["khung_title"]
              : undefined;
    // deep-entities.csv has x,y only — scale/rotation default identity (not invented free positions)
    const scale = Number(e.scale);
    const rotation = Number(e.rotation ?? e.rot);
    instances.push({
      name,
      layer: e.layer || "0",
      x,
      y,
      scale: Number.isFinite(scale) && scale > 0 ? scale : 1,
      rotation: Number.isFinite(rotation) ? rotation : 0,
      nested,
    });
  }
  if (!instances.length) {
    throw new Error("no plan block inserts found in extract");
  }
  const byName: Record<string, PlanBlockInstance[]> = {};
  const counts: Record<string, number> = {};
  for (const inst of instances) {
    if (!byName[inst.name]) byName[inst.name] = [];
    byName[inst.name].push(inst);
    counts[inst.name] = (counts[inst.name] || 0) + 1;
  }
  // Sort each by Y desc then X for stable sheet order
  for (const k of Object.keys(byName)) {
    byName[k].sort((a, b) => b.y - a.y || a.x - b.x);
  }

  const mbt1 = byName["B_MBT1"] || [];
  let mbtPitchY = 30800;
  if (mbt1.length >= 2) {
    const ys = mbt1.map((i) => i.y).sort((a, b) => b - a);
    mbtPitchY = Math.abs(ys[0] - ys[1]) || 30800;
  }
  const mbt2 = byName["B_MBT2"]?.[0];
  const mbtSpanX =
    mbt2 && mbt1[0] ? Math.abs(mbt2.x - mbt1[0].x) : 52845;

  return {
    version: 1,
    source:
      opts?.source ||
      "As-built drawing/ABD_He thong thoat nuoc tang 1_Tran tang 1_V.00.dwg",
    generatedAt: new Date().toISOString(),
    note:
      "Stairs/elevators/doors are nested inside B_MBT*; place parent footprint + symbols, do not clone full as-built.",
    instances,
    byName,
    counts,
    metrics: { mbtPitchY, mbtSpanX },
  };
}

export function writePlanBlockLibrary(
  lib: PlanBlockLibrary,
  outPath?: string,
): string {
  const p = outPath || defaultLibraryOutPath();
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, JSON.stringify(lib, null, 2) + "\n", "utf8");
  return p;
}

/**
 * Footprint size from measured sample pitch.
 * B_MBT1 pitch Y ≈ 30800 → footprint slightly smaller so sheets don't overlap.
 */
export function footprintForBlock(
  name: string,
  metrics?: PlanBlockLibrary["metrics"],
): { w: number; h: number } {
  const pitchY = metrics?.mbtPitchY || 30800;
  const spanX = metrics?.mbtSpanX || 52845;
  if (name === "B_MBT1") return { w: spanX * 0.92, h: pitchY * 0.9 };
  if (name === "B_MBT2") return { w: spanX * 0.85, h: pitchY * 0.9 };
  if (name === "B_HienTrang") return { w: 42000, h: 28000 };
  if (name.startsWith("B_Thoat")) return { w: spanX * 0.9, h: pitchY * 0.85 };
  if (name.startsWith("A3")) return { w: spanX * 1.15, h: pitchY * 1.05 };
  return { w: 5000, h: 4000 };
}

function pushRect(
  lines: string[],
  lay: string,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
): void {
  lines.push(`RECT\t${lay}\t${x1}\t${y1}\t${x2}\t${y2}`);
}

function pushText(
  lines: string[],
  lay: string,
  x: number,
  y: number,
  h: number,
  text: string,
): void {
  // No tabs/newlines in text field
  const t = String(text).replace(/[\t\n\r]/g, " ").slice(0, 80);
  lines.push(`TEXT\t${lay}\t${x}\t${y}\t${h}\t${t}`);
}

function pushSymbol(
  lines: string[],
  lay: string,
  x: number,
  y: number,
  size: number,
  label: string,
): void {
  const t = String(label).replace(/[\t\n\r]/g, "_").slice(0, 40);
  lines.push(`SYMBOL\t${lay}\t${x}\t${y}\t${size}\t${t}`);
}

/**
 * Draw internal architecture sketch inside a B_MBT footprint:
 * corridor, stair zone, elevator, door ticks, axis marks.
 * Makes "nhiều block mặt bằng" visible without cloning nested *U blocks.
 */
function pushMbtInternals(
  lines: string[],
  lay: string,
  x: number,
  y: number,
  w: number,
  h: number,
  sheetIndex: number,
): void {
  // Corridor strip (horizontal mid band)
  const cy0 = y + h * 0.42;
  const cy1 = y + h * 0.58;
  pushRect(lines, lay, x + w * 0.05, cy0, x + w * 0.95, cy1);

  // Stair zone (left bay) — stepped rectangles
  const sx0 = x + w * 0.08;
  const sy0 = y + h * 0.62;
  const sw = w * 0.22;
  const sh = h * 0.28;
  pushRect(lines, lay, sx0, sy0, sx0 + sw, sy0 + sh);
  // stair steps as small rects
  for (let i = 0; i < 5; i++) {
    const stepY = sy0 + (sh / 5) * i;
    pushRect(
      lines,
      lay,
      sx0 + sw * 0.1,
      stepY,
      sx0 + sw * 0.9,
      stepY + sh * 0.08,
    );
  }
  pushSymbol(lines, lay, sx0 + sw * 0.5, sy0 + sh * 0.5, Math.max(200, w * 0.025), "CAU_THANG");

  // Elevator shaft (right of stair)
  const ex0 = x + w * 0.35;
  const ey0 = y + h * 0.65;
  const ew = w * 0.12;
  const eh = h * 0.22;
  pushRect(lines, lay, ex0, ey0, ex0 + ew, ey0 + eh);
  pushSymbol(lines, lay, ex0 + ew * 0.5, ey0 + eh * 0.5, Math.max(180, w * 0.02), "THANG_MAY");

  // Room bays (simplified grid bottom)
  const rooms = 3;
  for (let i = 0; i < rooms; i++) {
    const rx0 = x + w * (0.08 + i * 0.28);
    const ry0 = y + h * 0.08;
    pushRect(lines, lay, rx0, ry0, rx0 + w * 0.24, y + h * 0.38);
  }

  // Door ticks on bottom edge
  for (let i = 0; i < 4; i++) {
    const dx = x + w * (0.15 + i * 0.2);
    pushRect(lines, lay, dx - w * 0.015, y + h * 0.02, dx + w * 0.015, y + h * 0.08);
  }
  pushSymbol(lines, lay, x + w * 0.5, y + h * 0.05, Math.max(120, w * 0.015), "CUA");

  // Axis crosses (3 vertical + label)
  for (let i = 0; i < 3; i++) {
    const ax = x + w * (0.2 + i * 0.3);
    pushSymbol(lines, lay, ax, y + h * 0.5, Math.max(100, w * 0.012), `TRUC_${i + 1}`);
  }

  // Sheet label
  pushText(
    lines,
    lay,
    x + w * 0.05,
    y + h * 0.92,
    Math.max(250, w * 0.035),
    `B_MBT1_S${sheetIndex + 1}`,
  );
}

/**
 * Build native.job TAB body: RECT + TEXT + SYMBOL for plan blocks.
 * PREVIEW → layer MEP-PREVIEW; COMMIT → real layers.
 *
 * detail:
 *   "footprint" — outer rect + name only
 *   "full"      — + internal arch sketch (default for B_MBT*)
 *   "symbols"   — symbols only (stairs/elevator step re-emphasize)
 */
export function buildPlanBlockNativeJob(opts: {
  instances: PlanBlockInstance[];
  mode?: "PREVIEW" | "COMMIT";
  opId?: string;
  token?: string;
  target?: string;
  detail?: "footprint" | "full" | "symbols";
  metrics?: PlanBlockLibrary["metrics"];
  stepId?: string;
}): string {
  const mode = opts.mode || "COMMIT";
  const detail =
    opts.detail ||
    (opts.stepId === "plan_stairs_elevator" || opts.stepId === "plan_doors_axes"
      ? "symbols"
      : "full");
  const lines: string[] = [`MODE\t${mode}`];
  if (opts.opId) lines.push(`OPID\t${opts.opId}`);
  if (opts.token) lines.push(`TOKEN\t${opts.token}`);
  if (opts.target) lines.push(`TARGET\t${opts.target}`);
  if (mode === "PREVIEW") {
    lines.push(`LAYER\tMEP-PREVIEW\t30`);
  }
  const seenLay = new Set<string>();
  let sheetIdx = 0;
  for (const inst of opts.instances) {
    const lay = mode === "PREVIEW" ? "MEP-PREVIEW" : inst.layer || "0";
    if (mode !== "PREVIEW" && !seenLay.has(inst.layer)) {
      lines.push(`LAYER\t${inst.layer}\t8`);
      seenLay.add(inst.layer);
    }
    const { w, h } = footprintForBlock(inst.name, opts.metrics);
    const x1 = inst.x;
    const y1 = inst.y;
    const x2 = inst.x + w;
    const y2 = inst.y + h;

    if (detail !== "symbols") {
      pushRect(lines, lay, x1, y1, x2, y2);
      pushText(
        lines,
        lay,
        inst.x + w * 0.05,
        inst.y + h * 0.5,
        Math.max(200, w * 0.04),
        inst.name,
      );
    }

    if (inst.name.startsWith("B_MBT") && detail === "full") {
      pushMbtInternals(lines, lay, inst.x, inst.y, w, h, sheetIdx);
      sheetIdx++;
    } else if (inst.name.startsWith("B_MBT") && detail === "symbols") {
      // Re-emphasize nested symbols only (all MBT instances)
      pushSymbol(
        lines,
        lay,
        inst.x + w * 0.2,
        inst.y + h * 0.75,
        Math.max(250, w * 0.03),
        "CAU_THANG",
      );
      pushSymbol(
        lines,
        lay,
        inst.x + w * 0.4,
        inst.y + h * 0.75,
        Math.max(220, w * 0.025),
        "THANG_MAY",
      );
      pushSymbol(
        lines,
        lay,
        inst.x + w * 0.5,
        inst.y + h * 0.1,
        Math.max(150, w * 0.02),
        "CUA",
      );
      for (let i = 0; i < 3; i++) {
        pushSymbol(
          lines,
          lay,
          inst.x + w * (0.2 + i * 0.3),
          inst.y + h * 0.5,
          Math.max(100, w * 0.015),
          `TRUC_${i + 1}`,
        );
      }
      sheetIdx++;
    } else if (inst.name === "B_HienTrang" && detail === "full") {
      // Context hatch-like grid
      pushRect(lines, lay, x1 + w * 0.1, y1 + h * 0.1, x2 - w * 0.1, y2 - h * 0.1);
      pushText(
        lines,
        lay,
        inst.x + w * 0.15,
        inst.y + h * 0.3,
        Math.max(180, w * 0.03),
        "HIEN_TRANG",
      );
    } else if (inst.name.startsWith("B_Thoat") && detail === "full") {
      pushText(
        lines,
        lay,
        inst.x + w * 0.1,
        inst.y + h * 0.7,
        Math.max(180, w * 0.03),
        inst.name.replace("B_", ""),
      );
      // MEP zone markers
      pushSymbol(
        lines,
        lay,
        inst.x + w * 0.3,
        inst.y + h * 0.4,
        Math.max(150, w * 0.02),
        inst.name.includes("Xi") ? "XI" : "RUA",
      );
    } else if (inst.name.startsWith("A3") && detail !== "symbols") {
      // Inner title margin
      pushRect(
        lines,
        lay,
        x1 + w * 0.02,
        y1 + h * 0.02,
        x2 - w * 0.02,
        y2 - h * 0.02,
      );
      pushText(
        lines,
        lay,
        inst.x + w * 0.7,
        inst.y + h * 0.05,
        Math.max(150, w * 0.02),
        "A3",
      );
    } else if (detail === "symbols" && inst.nested?.length) {
      let i = 0;
      for (const label of inst.nested.slice(0, 4)) {
        pushSymbol(
          lines,
          lay,
          inst.x + w * (0.15 + i * 0.2),
          inst.y + h * 0.25,
          Math.max(150, w * 0.03),
          label,
        );
        i++;
      }
    }
  }
  return lines.join("\n") + "\n";
}

/**
 * AutoLISP: INSERT plan block DWGs from library dir at instance positions.
 * Paths absolute; uses dialog-free -INSERT.
 */
export function buildPlanInsertLisp(
  instances: PlanBlockInstance[],
  blockDwgsDir: string,
): string {
  const esc = (s: string) => s.replace(/\\/g, "/").replace(/"/g, '\\"');
  const lines: string[] = [
    '(setvar "FILEDIA" 0)(setvar "ATTREQ" 0)(setvar "ATTDIA" 0)',
  ];
  for (const inst of instances) {
    const dwg = join(blockDwgsDir, `${inst.name}.dwg`).replace(/\\/g, "/");
    const sc = inst.scale ?? 1;
    const rot = inst.rotation ?? 0;
    lines.push(
      `(if (findfile "${esc(dwg)}")` +
        `(progn` +
        `(command "_.-LAYER" "_M" "${esc(inst.layer)}" "")` +
        `(command "_.-INSERT" "${esc(dwg)}" "${inst.x},${inst.y}" "${sc}" "${sc}" "${rot}")` +
        `(princ "\\nOK ${esc(inst.name)}")` +
        `)` +
        `(princ "\\nMISS ${esc(dwg)}")` +
        `)`,
    );
  }
  lines.push('(princ "\\nACAD_PLAN_INSERT_DONE\\n")');
  return lines.join("\n") + "\n";
}

/** Shared AutoLISP helper: define one plan block at origin (idempotent). */
function lispDefPlanFn(): string[] {
  return [
    "(defun ACAD-DEF-PLAN (name w h / ss e1 e2 e3 e4 e5)",
    '  (if (tblsearch "BLOCK" name)',
    '    (princ (strcat "\\nBLK_EXISTS " name))',
    "    (progn",
    '      (command "_.RECTANG" "0,0" (strcat (rtos w 2 4) "," (rtos h 2 4)))',
    "      (setq e1 (entlast))",
    '      (command "_.CIRCLE" (strcat (rtos (* w 0.2) 2 4) "," (rtos (* h 0.75) 2 4)) (rtos (max 200 (* w 0.03)) 2 4))',
    "      (setq e2 (entlast))",
    '      (command "_.CIRCLE" (strcat (rtos (* w 0.4) 2 4) "," (rtos (* h 0.75) 2 4)) (rtos (max 180 (* w 0.025)) 2 4))',
    "      (setq e3 (entlast))",
    '      (command "_.TEXT" (strcat (rtos (* w 0.05) 2 4) "," (rtos (* h 0.5) 2 4)) (rtos (max 200 (* w 0.04)) 2 4) "0" name)',
    "      (setq e4 (entlast))",
    '      (command "_.TEXT" (strcat (rtos (* w 0.15) 2 4) "," (rtos (* h 0.72) 2 4)) (rtos (max 150 (* w 0.02)) 2 4) "0" "CAU_THANG")',
    "      (setq e5 (entlast))",
    "      (setq ss (ssadd))",
    "      (foreach e (list e1 e2 e3 e4 e5) (if e (setq ss (ssadd e ss))))",
    '      (command "_.-BLOCK" name "0,0" ss "")',
    '      (princ (strcat "\\nBLK_DEF " name))',
    "    )",
    "  )",
    "  (princ)",
    ")",
  ];
}

/**
 * Define named plan blocks then INSERT at library transforms on dest layers (commit-style).
 * Re-read shows INSERT name B_MBT1 / B_HienTrang / … — not clone fullsheet.
 */
export function buildDefineAndInsertPlanBlocksLisp(
  instances: PlanBlockInstance[],
  metrics?: PlanBlockLibrary["metrics"],
): string {
  const esc = (s: string) => s.replace(/\\/g, "/").replace(/"/g, '\\"');
  const unique = [...new Map(instances.map((i) => [i.name, i])).values()];
  const lines: string[] = [
    '(setvar "FILEDIA" 0)(setvar "ATTREQ" 0)(setvar "ATTDIA" 0)(setvar "CMDECHO" 0)',
    ...lispDefPlanFn(),
  ];
  for (const u of unique) {
    const { w, h } = footprintForBlock(u.name, metrics);
    lines.push(`(ACAD-DEF-PLAN "${esc(u.name)}" ${w} ${h})`);
  }
  let nIns = 0;
  for (const inst of instances) {
    const sc = inst.scale ?? 1;
    const rot = inst.rotation ?? 0;
    lines.push(
      `(command "_.-LAYER" "_M" "${esc(inst.layer)}" "")`,
      `(if (tblsearch "BLOCK" "${esc(inst.name)}")` +
        `(progn` +
        `(command "_.-INSERT" "${esc(inst.name)}" "${inst.x},${inst.y}" "${sc}" "${sc}" "${rot}")` +
        `(princ "\\nINS_OK ${esc(inst.name)}")` +
        `)` +
        `(princ "\\nINS_FAIL ${esc(inst.name)}")` +
        `)`,
    );
    nIns++;
  }
  lines.push(
    `(princ (strcat "\\nACAD_PLAN_NAMED_INSERT_DONE inserts=${nIns}\\n"))`,
    `(acad:write-result "ok" "named_inserts=${nIns}")`,
  );
  return lines.join("\n") + "\n";
}

/**
 * Stage path for demo-flow: define named blocks + INSERT on unique preview layer.
 * Apply later CHPROPs each INSERT to its dest layer (from blockDestMap).
 * Re-read after apply shows named B_MBT1 / B_HienTrang / … inserts.
 */
export function buildNamedPlanStageLisp(
  instances: PlanBlockInstance[],
  previewLayer: string,
  metrics?: PlanBlockLibrary["metrics"],
): { lisp: string; insertCount: number; blockDestMap: Record<string, string> } {
  const esc = (s: string) => s.replace(/\\/g, "/").replace(/"/g, '\\"');
  const pl = esc(previewLayer);
  const unique = [...new Map(instances.map((i) => [i.name, i])).values()];
  const blockDestMap: Record<string, string> = {};
  for (const inst of instances) {
    if (!blockDestMap[inst.name]) blockDestMap[inst.name] = inst.layer || "0";
  }
  const lines: string[] = [
    '(setvar "FILEDIA" 0)(setvar "ATTREQ" 0)(setvar "ATTDIA" 0)(setvar "CMDECHO" 0)',
    ...lispDefPlanFn(),
    `(command "_.-LAYER" "_M" "${pl}" "_C" "30" "" "")`,
    `(setvar "CLAYER" "${pl}")`,
  ];
  for (const u of unique) {
    const { w, h } = footprintForBlock(u.name, metrics);
    lines.push(`(ACAD-DEF-PLAN "${esc(u.name)}" ${w} ${h})`);
  }
  let nIns = 0;
  for (const inst of instances) {
    const sc = inst.scale ?? 1;
    const rot = inst.rotation ?? 0;
    // Stay on preview layer — INSERT inherits CLAYER
    lines.push(
      `(if (tblsearch "BLOCK" "${esc(inst.name)}")` +
        `(progn` +
        `(setvar "CLAYER" "${pl}")` +
        `(command "_.-INSERT" "${esc(inst.name)}" "${inst.x},${inst.y}" "${sc}" "${sc}" "${rot}")` +
        `(princ "\\nSTAGE_INS ${esc(inst.name)}")` +
        `)` +
        `(princ "\\nSTAGE_FAIL ${esc(inst.name)}")` +
        `)`,
    );
    nIns++;
  }
  lines.push(
    `(princ (strcat "\\nACAD_PLAN_NAMED_STAGE_DONE inserts=${nIns} layer=${pl}\\n"))`,
    `(acad:write-result "ok" (strcat "named_stage=${nIns}"))`,
  );
  return { lisp: lines.join("\n") + "\n", insertCount: nIns, blockDestMap };
}

/**
 * Apply staged named plan INSERTs: set layer from block name → dest map.
 * Uses (cons "name" "layer") pairs — dotted pair syntax is invalid in AutoLISP source.
 */
export function buildNamedPlanApplyLisp(
  previewLayer: string,
  blockDestMap: Record<string, string>,
): string {
  const esc = (s: string) => s.replace(/\\/g, "/").replace(/"/g, '\\"');
  const pl = esc(previewLayer);
  const pairs = Object.entries(blockDestMap)
    .map(([bn, lay]) => `(cons "${esc(bn)}" "${esc(lay)}")`)
    .join(" ");
  // CHPROP per entity; ensure dest layers exist first
  const ensureLayers = [
    ...new Set(Object.values(blockDestMap).map((l) => l || "0")),
  ]
    .map((lay) => `(command "_.-LAYER" "_M" "${esc(lay)}" "")`)
    .join("\n");
  return `
(setvar "CMDECHO" 0)(setvar "FILEDIA" 0)
${ensureLayers}
(setq destmap (list ${pairs}))
(setq ss (ssget "_X" (list (cons 0 "INSERT") (cons 8 "${pl}"))))
(setq n 0)
(if ss
  (progn
    (setq i 0)
    (repeat (sslength ss)
      (setq en (ssname ss i))
      (setq ed (entget en))
      (setq bn (cdr (assoc 2 ed)))
      (setq lay nil)
      (foreach p destmap
        (if (and (null lay) (= bn (car p))) (setq lay (cdr p)))
      )
      (if lay
        (progn
          (command "_.CHPROP" en "" "_LA" lay "")
          (setq n (1+ n))
        )
      )
      (setq i (1+ i))
    )
  )
)
(acad:write-result "ok" (strcat "named_apply=" (itoa n)))
(princ)
`.trim() + "\n";
}

/** Reject staged named plan INSERTs on preview layer. */
export function buildNamedPlanRejectLisp(previewLayer: string): string {
  const esc = (s: string) => s.replace(/\\/g, "/").replace(/"/g, '\\"');
  const pl = esc(previewLayer);
  return `
(setvar "CMDECHO" 0)
(setq ss (ssget "_X" (list (cons 8 "${pl}"))))
(if ss
  (progn (command "_.ERASE" ss "") (acad:write-result "ok" (strcat "named_reject=" (itoa (sslength ss)))))
  (acad:write-result "ok" "named_reject=0")
)
(princ)
`.trim() + "\n";
}

/** Map block name → dest layer from instances (first wins). */
export function blockDestMapFromInstances(
  instances: PlanBlockInstance[],
): Record<string, string> {
  const m: Record<string, string> = {};
  for (const i of instances) {
    if (!m[i.name]) m[i.name] = i.layer || "0";
  }
  return m;
}

/**
 * Inventory named plan INSERT counts (for re-read after place).
 * Writes one line per name: NAME=count
 */
export function buildPlanBlockInventoryLisp(names: string[] = [...PLAN_BLOCK_NAMES]): string {
  const want = names.map((n) => n.replace(/"/g, ""));
  const lines: string[] = [
    '(setvar "CMDECHO" 0)',
    '(setq acc "")',
    `(setq want (list ${want.map((n) => `"${n}"`).join(" ")}))`,
    "(foreach nm want",
    "  (setq c 0)",
    '  (setq ss (ssget "_X" (list (cons 0 "INSERT") (cons 2 nm))))',
    "  (if ss (setq c (sslength ss)))",
    '  (setq acc (strcat acc nm "=" (itoa c) "\\n"))',
    ")",
    '(acad:write-result "ok" acc)',
    "(princ)",
  ];
  return lines.join("\n") + "\n";
}

/**
 * Headless script: WBLOCK each unique plan block from sample to library dir.
 */
export function buildWblockExportScript(
  sampleDwg: string,
  blockNames: string[],
  outDir: string,
): string {
  const esc = (s: string) => s.replace(/\\/g, "/");
  const lines = ['(setvar "FILEDIA" 0)(setvar "CMDDIA" 0)'];
  for (const name of blockNames) {
    const out = join(outDir, `${name}.dwg`).replace(/\\/g, "/");
    lines.push(
      `(if (tblsearch "BLOCK" "${name}")` +
        `(progn` +
        `(command "_.-WBLOCK" "${esc(out)}" "${name}")` +
        `(princ "\\nWBLOCK_OK ${name}\\n")` +
        `)` +
        `(princ "\\nWBLOCK_SKIP ${name}\\n")` +
        `)`,
    );
  }
  lines.push('(princ "\\nACAD_WBLOCK_EXPORT_DONE\\n")');
  return lines.join("\n") + "\n";
}

/**
 * AutoLISP fallback when ObjectARX RECT/SYMBOL unavailable:
 * RECTANG + TEXT + CIRCLE at instance footprints.
 */
export function buildPlanOutlineLisp(
  instances: PlanBlockInstance[],
  metrics?: PlanBlockLibrary["metrics"],
  detail: "footprint" | "full" | "symbols" = "full",
): string {
  const esc = (s: string) => s.replace(/\\/g, "/").replace(/"/g, '\\"');
  const lines: string[] = [
    '(setvar "FILEDIA" 0)(setvar "CMDECHO" 0)',
    '(command "_.-LAYER" "_M" "MEP-PREVIEW" "_C" "30" "" "")',
    '(setvar "CLAYER" "MEP-PREVIEW")',
  ];
  let sheetIdx = 0;
  for (const inst of instances) {
    const { w, h } = footprintForBlock(inst.name, metrics);
    const x1 = inst.x;
    const y1 = inst.y;
    const x2 = inst.x + w;
    const y2 = inst.y + h;
    if (detail !== "symbols") {
      lines.push(
        `(command "_.RECTANG" "${x1},${y1}" "${x2},${y2}")`,
        `(command "_.TEXT" "${x1 + w * 0.05},${y1 + h * 0.5}" "${Math.max(200, w * 0.04)}" "0" "${esc(inst.name)}")`,
      );
    }
    if (inst.name.startsWith("B_MBT") && detail !== "footprint") {
      // stair + elevator markers
      const sx = x1 + w * 0.2;
      const sy = y1 + h * 0.75;
      const r = Math.max(250, w * 0.03);
      lines.push(
        `(command "_.CIRCLE" "${sx},${sy}" "${r}")`,
        `(command "_.TEXT" "${sx + r * 1.2},${sy}" "${r * 0.8}" "0" "CAU_THANG")`,
        `(command "_.CIRCLE" "${x1 + w * 0.4},${sy}" "${r * 0.9}")`,
        `(command "_.TEXT" "${x1 + w * 0.4 + r},${sy}" "${r * 0.7}" "0" "THANG_MAY")`,
        `(command "_.TEXT" "${x1 + w * 0.05},${y1 + h * 0.9}" "${Math.max(200, w * 0.03)}" "0" "B_MBT_S${sheetIdx + 1}")`,
      );
      sheetIdx++;
    }
  }
  lines.push('(princ "\\nACAD_PLAN_OUTLINE_DONE\\n")');
  return lines.join("\n") + "\n";
}

/** Filter library instances for a rebuild step id. */
export function instancesForStep(
  lib: PlanBlockLibrary,
  stepId: string,
): PlanBlockInstance[] {
  switch (stepId) {
    case "plan_mbt1":
    case "plan_outline_mbt":
      return lib.byName["B_MBT1"] || [];
    case "plan_mbt2":
      return lib.byName["B_MBT2"] || [];
    case "plan_hientrang":
      return lib.byName["B_HienTrang"] || [];
    case "plan_mep_containers":
      return [
        ...(lib.byName["B_ThoatXi_Tang1"] || []),
        ...(lib.byName["B_ThoatRua_Tang1"] || []),
      ];
    case "plan_stairs_elevator":
      // Nested symbols on ALL B_MBT1 sheets (not just first)
      return lib.byName["B_MBT1"] || [];
    case "plan_doors_axes":
      // Doors/axes on B_MBT1 + B_MBT2
      return [
        ...(lib.byName["B_MBT1"] || []),
        ...(lib.byName["B_MBT2"] || []),
      ];
    case "title_plan_frame":
      return (lib.byName["A3-1-1-ISO3TGROUP"] || []).slice(0, 1);
    case "title_ctn_frames":
      return (lib.byName["A3-1-1-ISO3TGROUP"] || []).slice(1, 5);
    default:
      return [];
  }
}

export function isPlanBlockStep(stepId: string): boolean {
  return (
    stepId.startsWith("plan_") ||
    stepId === "title_plan_frame" ||
    stepId === "title_ctn_frames"
  );
}

/** Expected entity count (approx) for a staged plan step — for tests. */
export function expectedEntityCount(
  lib: PlanBlockLibrary,
  stepId: string,
): number {
  const instances = instancesForStep(lib, stepId);
  if (!instances.length) return 0;
  const detail =
    stepId === "plan_stairs_elevator" || stepId === "plan_doors_axes"
      ? "symbols"
      : "full";
  // Rough: each line in native job that creates geometry
  const body = buildPlanBlockNativeJob({
    instances,
    detail,
    metrics: lib.metrics,
    stepId,
  });
  // RECT/TEXT count 1 each; SYMBOL counts as 2 (circle+text) in plugin
  let n = 0;
  for (const line of body.split("\n")) {
    if (line.startsWith("RECT\t") || line.startsWith("TEXT\t")) n += 1;
    else if (line.startsWith("SYMBOL\t")) n += 2;
  }
  return n;
}

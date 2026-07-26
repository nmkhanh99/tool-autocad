import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import express, { type Router } from "express";
import {
  acadRunning,
  dispatchLiveJob,
  listOpenDocs,
  requestDrawingInfo,
} from "./acadBridge.js";
import {
  ensureBridgeLayout,
  resolveBridgeDir,
} from "./bridgeContract.js";
import {
  auditStandards,
  buildStandardsScanLisp,
  parseStandardsScanTsv,
  readStandardsLib,
  type StandardsAuditIssue,
  type StandardsDimension,
  type StandardsObject,
  type StandardsScan,
} from "./standardsEngine.js";
import {
  StandardsConflictError,
  StandardsValidationError,
  createProfile,
  deleteProfile,
  getProfile,
  loadStandardsState,
  upsertProfile,
  type DimensionStandard,
  type DrawingStandard,
  type DrawingStandardProfile,
  type LayerStandard,
} from "./standardsProfile.js";

type OpenDocument = {
  title: string;
  file: string;
  active: boolean;
};

type ScanSession = {
  scanId: string;
  target: string;
  exactTarget: string;
  profileId: string;
  profileRevision: string;
  drawingRevision: string;
  scannedAt: string;
  settings: Record<string, string>;
  dimensions: StandardsDimension[];
  objects: StandardsObject[];
  issues: StandardsAuditIssue[];
};

type JsonRecord = Record<string, unknown>;

const MAX_SCAN_ITEMS = 2_000;
const MAX_HANDLES = 5_000;
const SCAN_TTL_MS = 30 * 60 * 1_000;
const HANDLE_RE = /^[0-9A-F]+$/i;
const scans = new Map<string, ScanSession>();

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function finiteNumber(
  value: unknown,
  label: string,
  options: { min?: number; max?: number } = {},
): number {
  const number = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} phải là số hữu hạn`);
  if (options.min != null && number < options.min) {
    throw new Error(`${label} phải lớn hơn hoặc bằng ${options.min}`);
  }
  if (options.max != null && number > options.max) {
    throw new Error(`${label} phải nhỏ hơn hoặc bằng ${options.max}`);
  }
  return number;
}

function cleanHandles(value: unknown, required = false): string[] {
  if (value == null && !required) return [];
  if (!Array.isArray(value)) throw new Error("handles phải là mảng");
  if (value.length > MAX_HANDLES) throw new Error(`handles không được quá ${MAX_HANDLES}`);
  const output = [...new Set(value.map((item) => String(item).trim().toUpperCase()))];
  if (required && !output.length) throw new Error("Cần ít nhất một handle");
  if (output.some((handle) => !HANDLE_RE.test(handle))) {
    throw new Error("Handle AutoCAD không hợp lệ");
  }
  return output;
}

function cleanName(value: unknown, label: string, max = 255): string {
  const text = String(value ?? "").trim();
  if (!text) throw new Error(`${label} không được để trống`);
  if (text.length > max || /[\0\r\n\t]/.test(text)) {
    throw new Error(`${label} không hợp lệ`);
  }
  return text;
}

function lispString(value: unknown): string {
  const text = String(value ?? "");
  if (/[\0\r\n]/.test(text)) throw new Error("Chuỗi chứa ký tự không an toàn");
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function lispNumber(value: unknown, label: string): string {
  return String(finiteNumber(value, label));
}

function lispPoint(value: unknown): string {
  if (value == null || value === "") return "(list 0.0 0.0 0.0)";
  if (!Array.isArray(value) || value.length < 2) {
    throw new Error("basePoint phải là [x, y] hoặc [x, y, z]");
  }
  const x = finiteNumber(value[0], "basePoint.x");
  const y = finiteNumber(value[1], "basePoint.y");
  const z = value[2] == null ? 0 : finiteNumber(value[2], "basePoint.z");
  return `(list ${x} ${y} ${z})`;
}

function lispHandleList(handles: string[]): string {
  return `(list ${handles.map(lispString).join(" ")})`;
}

function allModelHandlesExpression(): string {
  return "(acadstd:selection-handles (acadstd:model-selection))";
}

function handlesExpression(handles: string[], all = false): string {
  return all ? allModelHandlesExpression() : lispHandleList(handles);
}

function numericColor(value: unknown): number {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "bylayer") return 256;
    if (normalized === "byblock") return 0;
    // RGB is intentionally not guessed into an ACI value.
    if (normalized.startsWith("rgb")) {
      throw new Error("MVP hiện nhận màu ACI 0..256, ByLayer hoặc ByBlock");
    }
  }
  return Math.trunc(finiteNumber(value, "color", { min: 0, max: 256 }));
}

function layerColor(value: unknown): number {
  const color = numericColor(value);
  return color === 256 || color === 0 ? 7 : color;
}

function lineweight(value: unknown): number {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "default") return -3;
    if (normalized === "byblock") return -2;
    if (normalized === "bylayer") return -1;
  }
  const number = finiteNumber(value, "lineweight", { min: -3, max: 211 });
  // UI stores millimeters; DXF group 370 stores hundredths of a millimeter.
  return number >= 0 && number <= 2.11 ? Math.round(number * 100) : Math.round(number);
}

function linearFormat(value: unknown): number {
  const normalized = String(value ?? "").trim().toLowerCase();
  const named: Record<string, number> = {
    scientific: 1,
    decimal: 2,
    engineering: 3,
    architectural: 4,
    fractional: 5,
  };
  if (named[normalized]) return named[normalized];
  return Math.trunc(finiteNumber(value, "linearFormat", { min: 1, max: 5 }));
}

function dimFit(value: unknown): number {
  const normalized = String(value ?? "").trim().toLowerCase();
  const named: Record<string, number> = {
    "text and arrows outside": 0,
    "arrows first": 1,
    "text first": 2,
    "best fit": 3,
  };
  if (named[normalized] != null) return named[normalized];
  return Math.trunc(finiteNumber(value, "fit", { min: 0, max: 3 }));
}

function dimVertical(value: unknown): number {
  const normalized = String(value ?? "").trim().toLowerCase();
  const named: Record<string, number> = {
    centered: 0,
    above: 1,
    outside: 2,
    jis: 3,
    below: 4,
  };
  if (named[normalized] != null) return named[normalized];
  return Math.trunc(finiteNumber(value, "textVertical", { min: 0, max: 4 }));
}

function dimHorizontal(value: unknown): number {
  const normalized = String(value ?? "").trim().toLowerCase();
  const named: Record<string, number> = {
    centered: 0,
    "at first extension line": 1,
    "at second extension line": 2,
    "above first extension line": 3,
    "above second extension line": 4,
  };
  if (named[normalized] != null) return named[normalized];
  return Math.trunc(finiteNumber(value, "textHorizontal", { min: 0, max: 4 }));
}

function arrowName(value: unknown): string {
  const text = String(value ?? "").trim();
  const named: Record<string, string> = {
    "closed filled": "",
    "architectural tick": "_ARCHTICK",
    dot: "_DOT",
    oblique: "_OBLIQUE",
    open: "_OPEN",
  };
  return named[text.toLowerCase()] ?? text;
}

function dimVariables(dimension: DimensionStandard): [string, string][] {
  const aligned = dimension.alignment.toLowerCase().includes("aligned");
  return [
    ["DIMDEC", String(Math.trunc(dimension.precision))],
    ["DIMLFAC", String(dimension.measurementScale)],
    ["DIMSCALE", String(dimension.overallScale)],
    ["DIMATFIT", String(dimFit(dimension.fit))],
    ["DIMTAD", String(dimVertical(dimension.textVertical))],
    ["DIMJUST", String(dimHorizontal(dimension.textHorizontal))],
    ["DIMANNO", dimension.annotative ? "1" : "0"],
    ["DIMTXT", String(
      dimension.annotative ? dimension.paperTextHeight : dimension.textHeight,
    )],
    ["DIMCLRT", String(numericColor(dimension.textColor))],
    ["DIMCLRD", String(numericColor(dimension.dimensionLineColor))],
    ["DIMCLRE", String(numericColor(dimension.extensionLineColor))],
    ["DIMEXE", String(dimension.extendBeyondDimLines)],
    ["DIMEXO", String(dimension.offsetFromOrigin)],
    ["DIMGAP", String(dimension.textGap)],
    ["DIMTIH", aligned ? "0" : "1"],
    ["DIMTOH", aligned ? "0" : "1"],
    ["DIMTMOVE", "0"],
    ["DIMTOFL", "1"],
    ["DIMBLK", lispString(arrowName(dimension.arrowhead))],
  ];
}

function configureDimensionExpression(dimension: DimensionStandard): string {
  const variables = dimVariables(dimension)
    .map(([name, value]) =>
      `(cons ${lispString(name)} ${name === "DIMBLK" ? value : value})`)
    .join(" ");
  return `(acadstd:configure-dimstyle ` +
    `${lispString(cleanName(dimension.styleName, "styleName"))} ` +
    `${lispString(cleanName(dimension.textStyle, "textStyle"))} ` +
    `${lispString(String(dimension.font || "txt.shx"))} ` +
    `${finiteNumber(dimension.widthFactor, "widthFactor", { min: 0.01 })} ` +
    `(list ${variables}))`;
}

function syncLayersExpression(layers: LayerStandard[]): string {
  const rows = layers.map((layer) =>
    `(list ${lispString(cleanName(layer.name, "layer.name"))} ` +
    `${layerColor(layer.color)} ${lispString(layer.linetype || "Continuous")} ` +
    `${lineweight(layer.lineweight)} ${layer.required ? "T" : "nil"})`);
  return `(acadstd:sync-layers (list ${rows.join(" ")}))`;
}

function setUnitsExpression(drawing: DrawingStandard): string {
  return `(acadstd:set-units ` +
    `${Math.trunc(finiteNumber(drawing.insunits, "INSUNITS", { min: 0, max: 24 }))} ` +
    `${linearFormat(drawing.linearFormat)} ` +
    `${Math.trunc(finiteNumber(drawing.precision, "precision", { min: 0, max: 8 }))})`;
}

function actionProgram(expression: string, options: { mutates?: boolean } = {}): string {
  const begin = options.mutates
    ? `(setq acadstd:outer-error *error*)
(setq *error*
  (lambda (message)
    (command "_.UNDO" "_End")
    (setq *error* acadstd:outer-error)
    (acadstd:outer-error message)))
(command "_.UNDO" "_Begin")
`
    : "";
  const end = options.mutates
    ? `(command "_.UNDO" "_End")
(setq *error* acadstd:outer-error)
(command "_.REGEN")
`
    : "";
  return `${readStandardsLib().trimEnd()}

${begin}(setq acadstd:action-result ${expression})
${end}(acad:write-result "ok"
  (strcat "result=" (acadstd:text acadstd:action-result)))
(princ)
`;
}

function scanOutputPath(prefix: string): string {
  const results = ensureBridgeLayout(resolveBridgeDir());
  return join(results, `${prefix}_${randomUUID().slice(0, 12)}.tsv`);
}

async function resolveDocument(target: unknown): Promise<{
  document: OpenDocument;
  exactTarget: string;
}> {
  if (!(await acadRunning())) throw new Error("AutoCAD chưa chạy");
  const open = await listOpenDocs(4_000);
  if (!open.alive) throw new Error("Plugin AcadBridge không phản hồi");
  const requested = String(target ?? "").trim();
  const document = requested
    ? open.docs.find((item) => item.title === requested || item.file === requested)
    : open.docs.find((item) => item.active);
  if (!document) {
    throw new Error(requested
      ? "Không thấy bản vẽ đang mở khớp chính xác target"
      : "Không thấy bản vẽ active");
  }
  const exactTarget = document.file || document.title;
  if (!exactTarget) throw new Error("Bản vẽ đích chưa có title/path");
  return { document, exactTarget };
}

function drawingRevision(snapshot: unknown): string {
  const root = asRecord(snapshot);
  const document = asRecord(root.document);
  return String(document.dbmod ?? "");
}

function cleanupScans(): void {
  const oldest = Date.now() - SCAN_TTL_MS;
  for (const [id, scan] of scans) {
    if (Date.parse(scan.scannedAt) < oldest) scans.delete(id);
  }
  while (scans.size > 30) {
    const oldestId = scans.keys().next().value;
    if (!oldestId) break;
    scans.delete(oldestId);
  }
}

function errorResponse(res: express.Response, error: unknown): express.Response {
  if (error instanceof StandardsConflictError) {
    return res.status(409).json({ ok: false, code: error.code, error: error.message });
  }
  if (error instanceof StandardsValidationError) {
    return res.status(400).json({ ok: false, code: error.code, error: error.message });
  }
  const message = error instanceof Error ? error.message : String(error);
  const status = /chưa chạy|không phản hồi|không thấy bản vẽ/i.test(message) ? 503 : 400;
  return res.status(status).json({ ok: false, error: message });
}

function actionName(issue: StandardsAuditIssue): string {
  const suggested = issue.suggestedAction;
  return typeof suggested === "string"
    ? suggested
    : String(asRecord(suggested).action ?? "");
}

function parseAreaTsv(raw: string): {
  objects: { handle: string; type: string; layer: string; drawingArea: number }[];
  drawingArea: number;
} {
  const objects: { handle: string; type: string; layer: string; drawingArea: number }[] = [];
  let drawingArea = 0;
  for (const line of raw.split(/\r?\n/)) {
    const cells = line.split("\t");
    if (cells[0] === "AREA" && cells[1]) {
      objects.push({
        handle: cells[1],
        type: cells[2] || "",
        layer: cells[3] || "",
        drawingArea: Number(cells[4]) || 0,
      });
    } else if (cells[0] === "TOTAL") {
      drawingArea = Number(cells[2]) || 0;
    }
  }
  return { objects, drawingArea };
}

function metersPerUnit(insunits: unknown): number | null {
  const factors: Record<number, number> = {
    1: 0.0254, // inch
    2: 0.3048, // foot
    4: 0.001,  // millimeter
    5: 0.01,   // centimeter
    6: 1,      // meter
  };
  return factors[Number(insunits)] ?? null;
}

function filterObjectsByMappingBounds(
  profile: DrawingStandardProfile,
  objects: StandardsObject[],
  settings: Record<string, string>,
): StandardsObject[] {
  const meterFactor = metersPerUnit(settings.INSUNITS ?? profile.drawing.insunits);
  const mappings = new Map(profile.mappings.map((mapping) => [mapping.id, mapping]));
  return objects.filter((object) => {
    const bounds = asRecord(mappings.get(object.mappingId)?.bounds);
    const minArea = bounds.minArea == null ? null : Number(bounds.minArea);
    const maxArea = bounds.maxArea == null ? null : Number(bounds.maxArea);
    if (!Number.isFinite(minArea) && !Number.isFinite(maxArea)) return true;
    const unit = String(bounds.areaUnit ?? "drawing-unit2").toLowerCase();
    let area = object.area;
    if ((unit === "m2" || unit === "m²") && meterFactor != null) {
      area *= meterFactor * meterFactor;
    } else if ((unit === "mm2" || unit === "mm²") && meterFactor != null) {
      area *= Math.pow(meterFactor / 0.001, 2);
    } else if ((unit === "cm2" || unit === "cm²") && meterFactor != null) {
      area *= Math.pow(meterFactor / 0.01, 2);
    }
    return (!Number.isFinite(minArea) || area >= Number(minArea)) &&
      (!Number.isFinite(maxArea) || area <= Number(maxArea));
  });
}

function displayObjects(
  objects: StandardsObject[],
  settings: Record<string, string>,
  fallbackInsunits: number,
): (StandardsObject & { drawingArea: number; areaUnit: string })[] {
  const meterFactor = metersPerUnit(settings.INSUNITS ?? fallbackInsunits);
  return objects.map((object) => ({
    ...object,
    drawingArea: object.area,
    area: meterFactor == null ? object.area : object.area * meterFactor * meterFactor,
    areaUnit: meterFactor == null ? "drawing-unit²" : "m²",
  }));
}

function latestFrame(target: string): StandardsObject | undefined {
  return [...scans.values()]
    .filter((scan) => scan.target === target || scan.exactTarget === target)
    .sort((left, right) => Date.parse(right.scannedAt) - Date.parse(left.scannedAt))
    .flatMap((scan) => scan.objects)
    .find((object) =>
      object.width > 0 && object.height > 0 &&
      /frame|sheet|title.?block|khung/i.test(`${object.kind} ${object.mappingId}`));
}

export function buildStandardsAction(
  action: string,
  handles: string[],
  params: JsonRecord,
  target: string,
  areaPath?: string,
): { lisp: string; mutates: boolean } {
  const all = params.all === true || handles.length === 0;
  const handleExpression = handlesExpression(handles, all);
  switch (action) {
    case "scale": {
      const factor = finiteNumber(params.factor, "factor", { min: 0.000001 });
      return {
        lisp: actionProgram(
          `(acadstd:scale ${lispHandleList(handles)} ${all ? "T" : "nil"} ` +
          `${factor} ${lispPoint(params.basePoint)})`,
          { mutates: true },
        ),
        mutates: true,
      };
    }
    case "rotate":
      return {
        lisp: actionProgram(
          `(acadstd:rotate ${handleExpression} ` +
          `${finiteNumber(params.angle, "angle")} ${lispPoint(params.basePoint)})`,
          { mutates: true },
        ),
        mutates: true,
      };
    case "color":
      return {
        lisp: actionProgram(
          `(acadstd:set-color ${handleExpression} ${numericColor(params.color)})`,
          { mutates: true },
        ),
        mutates: true,
      };
    case "layer":
      return {
        lisp: actionProgram(
          `(acadstd:assign-layer ${handleExpression} ` +
          `${lispString(cleanName(params.layer, "layer"))})`,
          { mutates: true },
        ),
        mutates: true,
      };
    case "area":
      if (!areaPath) throw new Error("Thiếu file kết quả diện tích");
      return {
        lisp: actionProgram(
          `(acadstd:measure ${lispString(areaPath)} ${handleExpression})`,
        ),
        mutates: false,
      };
    case "select":
      return {
        lisp: actionProgram(`(acadstd:select ${lispHandleList(handles)})`),
        mutates: false,
      };
    case "dimspace": {
      const baseHandle = cleanHandles([params.baseHandle], true)[0]!;
      const spacing = finiteNumber(params.rowSpacing ?? params.spacing, "rowSpacing", {
        min: 0,
      });
      return {
        lisp: actionProgram(
          `(acadstd:dimspace ${lispString(baseHandle)} ` +
          `${lispHandleList(handles.filter((handle) => handle !== baseHandle))} ${spacing})`,
          { mutates: true },
        ),
        mutates: true,
      };
    }
    case "apply-units": {
      const drawing = params as unknown as DrawingStandard;
      return {
        lisp: actionProgram(setUnitsExpression(drawing), { mutates: true }),
        mutates: true,
      };
    }
    case "apply-dimstyle": {
      const dimension = params as unknown as DimensionStandard;
      return {
        lisp: actionProgram(configureDimensionExpression(dimension), { mutates: true }),
        mutates: true,
      };
    }
    case "sync-layers": {
      if (!Array.isArray(params.layers)) throw new Error("layers phải là mảng");
      return {
        lisp: actionProgram(
          syncLayersExpression(params.layers as LayerStandard[]),
          { mutates: true },
        ),
        mutates: true,
      };
    }
    case "resize-frame": {
      const paper = asRecord(params.paper);
      const scale = finiteNumber(params.modelScale ?? 1, "modelScale", { min: 0.000001 });
      const frame = handles[0]
        ? { handle: handles[0] }
        : latestFrame(target);
      if (!frame?.handle) {
        throw new Error("Hãy quét bản vẽ để nhận diện một khung LWPOLYLINE trước");
      }
      let width =
        finiteNumber(params.width ?? paper.width, "paper.width", { min: 0.000001 }) * scale;
      let height =
        finiteNumber(params.height ?? paper.height, "paper.height", { min: 0.000001 }) * scale;
      if ("width" in frame && frame.width > 0 && frame.height > 0) {
        const normalError =
          Math.abs(frame.width - width) / width +
          Math.abs(frame.height - height) / height;
        const rotatedError =
          Math.abs(frame.width - height) / height +
          Math.abs(frame.height - width) / width;
        if (rotatedError < normalError) [width, height] = [height, width];
      }
      return {
        lisp: actionProgram(
          `(acadstd:resize-frame ${lispString(frame.handle)} ${width} ${height})`,
          { mutates: true },
        ),
        mutates: true,
      };
    }
    default:
      throw new Error(`action không được hỗ trợ: ${action}`);
  }
}

export function drawingStandardsRouter(): Router {
  const router = express.Router();

  router.get("/profiles", (_req, res) => {
    try {
      const state = loadStandardsState();
      return res.json({
        ok: true,
        activeProfileId: state.profiles[0]?.id ?? "",
        profiles: state.profiles,
      });
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  router.post("/profiles", (req, res) => {
    try {
      const profile = createProfile(
        cleanName(req.body?.name, "name", 160),
        req.body?.sourceId ? String(req.body.sourceId) : undefined,
      );
      return res.status(201).json({ ok: true, profile, profileId: profile.id });
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  router.put("/profiles/:id", (req, res) => {
    try {
      if (req.body?.id && String(req.body.id) !== req.params.id) {
        return res.status(400).json({ ok: false, error: "Profile id trong URL/body không khớp" });
      }
      const profile = upsertProfile(
        { ...req.body, id: req.params.id },
        req.get("if-match") || (req.body?.revision ? String(req.body.revision) : undefined),
      );
      return res.json({ ok: true, profile });
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  router.delete("/profiles/:id", (req, res) => {
    try {
      const removed = deleteProfile(req.params.id, req.get("if-match") || undefined);
      return res.status(removed ? 200 : 404).json({ ok: removed });
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  router.post("/scan", async (req, res) => {
    let output = "";
    try {
      cleanupScans();
      const profile = getProfile(String(req.body?.profileId ?? ""));
      if (!profile) return res.status(404).json({ ok: false, error: "Không tìm thấy profile" });
      const { document, exactTarget } = await resolveDocument(req.body?.target);
      const snapshot = await requestDrawingInfo(exactTarget, 10_000);
      if (!snapshot?.ok) throw new Error(snapshot?.error || "Không đọc được hồ sơ bản vẽ");

      output = scanOutputPath("standards_scan");
      const lisp = buildStandardsScanLisp(profile, output, MAX_SCAN_ITEMS);
      const job = await dispatchLiveJob(lisp, exactTarget, 25_000);
      if (job.state !== "done" || job.result?.status !== "ok") {
        throw new Error(job.result?.message || `Quét AutoCAD chưa hoàn tất (${job.state})`);
      }
      if (!existsSync(output)) throw new Error("AutoCAD không ghi file kết quả quét");
      const parsed: StandardsScan = parseStandardsScanTsv(readFileSync(output, "utf8"));
      parsed.objects = filterObjectsByMappingBounds(profile, parsed.objects, parsed.settings);
      const issues = auditStandards(profile, snapshot, parsed);
      const scanId = randomUUID();
      const scannedAt = new Date().toISOString();
      const session: ScanSession = {
        scanId,
        target: document.file || document.title,
        exactTarget,
        profileId: profile.id,
        profileRevision: profile.revision,
        drawingRevision: drawingRevision(snapshot),
        scannedAt,
        settings: parsed.settings,
        dimensions: parsed.dimensions,
        objects: displayObjects(parsed.objects, parsed.settings, profile.drawing.insunits),
        issues,
      };
      scans.set(scanId, session);
      return res.json({
        ok: true,
        scanId,
        target: session.target,
        profileId: profile.id,
        profileRevision: profile.revision,
        scannedAt,
        current: {
          settings: parsed.settings,
          document: snapshot.document,
        },
        issues,
        objects: parsed.objects,
        dimensions: parsed.dimensions,
      });
    } catch (error) {
      return errorResponse(res, error);
    } finally {
      if (output) rmSync(output, { force: true });
    }
  });

  router.post("/apply", async (req, res) => {
    try {
      cleanupScans();
      const scanId = String(req.body?.scanId ?? "");
      const session = scans.get(scanId);
      if (!session) {
        return res.status(409).json({
          ok: false,
          code: "scan_expired",
          error: "Lần quét đã hết hạn; hãy quét lại trước khi áp dụng",
        });
      }
      if (!Array.isArray(req.body?.issueIds) || !req.body.issueIds.length) {
        return res.status(400).json({ ok: false, error: "Cần chọn ít nhất một issue" });
      }
      const wantedIds = new Set(req.body.issueIds.map(String));
      const selected = session.issues.filter((issue) => wantedIds.has(issue.id));
      if (selected.length !== wantedIds.size) {
        return res.status(400).json({ ok: false, error: "Danh sách issue không thuộc lần quét" });
      }
      const profile = getProfile(session.profileId);
      if (!profile || profile.revision !== session.profileRevision) {
        return res.status(409).json({
          ok: false,
          code: "profile_stale",
          error: "Mẫu quy chuẩn đã đổi; hãy quét lại",
        });
      }
      const { exactTarget } = await resolveDocument(session.exactTarget);
      if (exactTarget !== session.exactTarget) {
        throw new Error("Bản vẽ đích không còn khớp lần quét");
      }
      const currentSnapshot = await requestDrawingInfo(exactTarget, 10_000);
      if (!currentSnapshot?.ok) throw new Error("Không đọc được trạng thái bản vẽ trước khi sửa");
      if (drawingRevision(currentSnapshot) !== session.drawingRevision) {
        return res.status(409).json({
          ok: false,
          code: "drawing_stale",
          error: "Bản vẽ đã thay đổi sau lần quét; hãy quét lại",
        });
      }

      const programs: string[] = [];
      const appliedActions: string[] = [];
      const skippedIssueIds: string[] = [];
      const selectedActions = new Set(selected.map(actionName));
      if (selectedActions.has("apply-units")) {
        programs.push(setUnitsExpression(profile.drawing));
        appliedActions.push("apply-units");
      }
      if (selectedActions.has("sync-layers")) {
        programs.push(syncLayersExpression(profile.layers));
        appliedActions.push("sync-layers");
      }
      if (selectedActions.has("apply-dimstyle")) {
        programs.push(configureDimensionExpression(profile.dimension));
        const dimStyleHandles = cleanHandles(
          selected
            .filter((issue) => actionName(issue) === "apply-dimstyle")
            .flatMap((issue) => issue.handles),
        );
        if (dimStyleHandles.length) {
          programs.push(
            `(acadstd:assign-dimstyle ${lispHandleList(dimStyleHandles)} ` +
            `${lispString(profile.dimension.styleName)})`,
          );
        }
        appliedActions.push("apply-dimstyle");
      }
      const dimensionIssues = selected.filter((issue) => actionName(issue) === "dimspace");
      if (dimensionIssues.length) {
        const baseHandle = cleanHandles([req.body?.dimBaseHandle], true)[0]!;
        const handles = cleanHandles(dimensionIssues.flatMap((issue) => issue.handles))
          .filter((handle) => handle !== baseHandle);
        if (!handles.length) throw new Error("Không có DIM cần căn ngoài DIM chuẩn");
        programs.push(
          `(acadstd:dimspace ${lispString(baseHandle)} ` +
          `${lispHandleList(handles)} ${profile.dimension.rowSpacing})`,
        );
        appliedActions.push("dimspace");
      }
      for (const issue of selected) {
        const suggested = asRecord(issue.suggestedAction);
        if (suggested.action === "resize-frame") {
          const handle = cleanHandles([suggested.handle || issue.handles[0]], true)[0]!;
          const width = finiteNumber(suggested.width, "frame.width", { min: 0.000001 });
          const height = finiteNumber(suggested.height, "frame.height", { min: 0.000001 });
          programs.push(`(acadstd:resize-frame ${lispString(handle)} ${width} ${height})`);
          appliedActions.push("resize-frame");
        } else if (!["apply-units", "sync-layers", "apply-dimstyle", "dimspace"].includes(
          String(suggested.action ?? ""),
        )) {
          skippedIssueIds.push(issue.id);
        }
      }
      if (!programs.length) {
        return res.status(400).json({
          ok: false,
          error: "Các issue đã chọn chỉ cần review, chưa có thao tác sửa tự động",
          skippedIssueIds,
        });
      }
      const lisp = actionProgram(
        `(progn ${programs.join("\n")} ${programs.length})`,
        { mutates: true },
      );
      const job = await dispatchLiveJob(lisp, exactTarget, 30_000);
      if (job.state !== "done" || job.result?.status !== "ok") {
        throw new Error(job.result?.message || `Áp dụng chưa hoàn tất (${job.state})`);
      }
      scans.delete(scanId);
      return res.json({
        ok: true,
        state: job.state,
        applied: appliedActions,
        skippedIssueIds,
        hint: `Đã áp dụng ${appliedActions.length} nhóm điều chỉnh. Hãy quét lại để kiểm tra.`,
      });
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  router.post("/action", async (req, res) => {
    let areaPath = "";
    try {
      const target = String(req.body?.target ?? "");
      const { exactTarget } = await resolveDocument(target);
      const action = String(req.body?.action ?? "").trim();
      const handles = cleanHandles(req.body?.handles);
      const params = asRecord(req.body?.params);
      if (["select", "dimspace"].includes(action) && !handles.length) {
        throw new Error(`${action} cần danh sách handles`);
      }
      if (action === "area") areaPath = scanOutputPath("standards_area");
      const program = buildStandardsAction(action, handles, params, target, areaPath || undefined);
      const job = await dispatchLiveJob(program.lisp, exactTarget, action === "area" ? 25_000 : 30_000);
      if (job.state !== "done" || job.result?.status !== "ok") {
        throw new Error(job.result?.message || `Thao tác chưa hoàn tất (${job.state})`);
      }
      if ((program.mutates || action === "select") &&
          /^result=0(?:\.0+)?$/i.test(job.result.message.trim())) {
        throw new Error("Không có đối tượng phù hợp được thay đổi");
      }
      if (action === "area") {
        if (!existsSync(areaPath)) throw new Error("AutoCAD không ghi kết quả diện tích");
        const area = parseAreaTsv(readFileSync(areaPath, "utf8"));
        const snapshot = await requestDrawingInfo(exactTarget, 8_000);
        const settings = asRecord(asRecord(snapshot?.drawing).settings);
        const factor = metersPerUnit(settings.INSUNITS);
        return res.json({
          ok: true,
          state: job.state,
          ...area,
          ...(factor == null ? {
            unit: "drawing-unit²",
            hint: "Đã tính diện tích; INSUNITS chưa đủ để quy đổi sang m².",
          } : {
            unit: "m²",
            total: area.drawingArea * factor * factor,
            objects: area.objects.map((object) => ({
              ...object,
              area: object.drawingArea * factor * factor,
            })),
            hint: `Tổng diện tích: ${(area.drawingArea * factor * factor).toLocaleString("vi-VN")} m²`,
          }),
        });
      }
      return res.json({
        ok: true,
        state: job.state,
        result: job.result,
        mutates: program.mutates,
        hint: action === "select"
          ? `Đã chọn ${handles.length} đối tượng trong AutoCAD.`
          : `Đã chạy ${action} trên bản vẽ.`,
      });
    } catch (error) {
      return errorResponse(res, error);
    } finally {
      if (areaPath) rmSync(areaPath, { force: true });
    }
  });

  return router;
}

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { acadLib } from "./acadBridge.js";
import type { DrawingStandardProfile } from "./standardsProfile.js";

type JsonRecord = Record<string, unknown>;

export type StandardsEngineProfile = DrawingStandardProfile;

export type StandardsDimension = {
  handle: string;
  layer: string;
  style: string;
  axis: string;
  row: number;
  rotation: number;
  measurement: number;
  text: string;
};

export type StandardsObject = {
  mappingId: string;
  label: string;
  kind: string;
  handle: string;
  type: string;
  layer: string;
  area: number;
  width: number;
  height: number;
  x: number;
  y: number;
  text: string;
};

export type StandardsScan = {
  settings: Record<string, string>;
  dimensions: StandardsDimension[];
  objects: StandardsObject[];
};

export type DimensionRowCandidate = StandardsDimension & {
  expectedRow: number;
  offset: number;
  deviation: number;
};

export type DimensionRowAnalysis = {
  axis: "H" | "V";
  anchor: StandardsDimension;
  candidates: DimensionRowCandidate[];
};

export type StandardsAuditIssue = {
  id: string;
  scope: string;
  severity: "error" | "warning" | "info";
  message: string;
  handles: string[];
  current?: unknown;
  expected?: unknown;
  suggestedAction?: unknown;
};

function asRecord(value: unknown): JsonRecord | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : undefined;
}

function records(value: unknown): JsonRecord[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((item): item is JsonRecord => Boolean(item))
    : [];
}

function finiteNumber(value: unknown): number | undefined {
  /* Chuỗi TOÀN KHOẢNG TRẮNG cũng là "không đặt". `Number("  ")` là `0` — một số
     hữu hạn — nên một cạnh chỉ chứa dấu cách sẽ thành **giới hạn bằng 0** trong
     chương trình LISP, tức đổi hẳn tập đối tượng lượt quét nhận vào, trong khi ô
     nhập trông y hệt ô trống. Không chỗ nào trong hồ sơ mà "một dấu cách" có
     nghĩa là số 0. */
  if (value === null || value === undefined) return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function numberOrZero(value: unknown): number {
  return finiteNumber(value) ?? 0;
}

function textList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value !== "string") return [];
  return value.split(",").map((item) => item.trim()).filter(Boolean);
}

function firstValue(record: JsonRecord | undefined, keys: string[]): unknown {
  if (!record) return undefined;
  for (const key of keys) {
    if (record[key] !== undefined) return record[key];
  }
  return undefined;
}

function lispString(value: unknown): string {
  const text = String(value ?? "");
  if (/[\0\r\n]/.test(text)) throw new Error("unsafe_lisp_string");
  return text.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function lispNumber(value: unknown): string {
  const number = finiteNumber(value);
  return number === undefined ? "nil" : String(number);
}

function profileMappings(profile: StandardsEngineProfile): JsonRecord[] {
  return records(profile.mappings);
}

function mappingBounds(mapping: JsonRecord): [unknown, unknown, unknown, unknown] {
  const bounds = asRecord(mapping.bounds);
  const min = Array.isArray(bounds?.min) ? bounds.min : [];
  const max = Array.isArray(bounds?.max) ? bounds.max : [];
  return [
    firstValue(bounds, ["minX", "xMin", "left"]) ?? min[0],
    firstValue(bounds, ["minY", "yMin", "bottom"]) ?? min[1],
    firstValue(bounds, ["maxX", "xMax", "right"]) ?? max[0],
    firstValue(bounds, ["maxY", "yMax", "top"]) ?? max[1],
  ];
}

/** standards_lib.lsp is deployed beside the active acad_lib/mep_lib file. */
export function standardsLibPath(): string {
  return join(dirname(acadLib()), "standards_lib.lsp");
}

export function readStandardsLib(): string {
  return readFileSync(standardsLibPath(), "utf8");
}

export function buildStandardsScanLisp(
  profile: StandardsEngineProfile,
  outputPath: string,
  maxItems = 500,
): string {
  if (!Number.isFinite(maxItems) || maxItems <= 0) {
    throw new Error("maxItems must be a positive number");
  }
  const mappings = profileMappings(profile).map((mapping, index) => {
    const bounds = mappingBounds(mapping);
    const id = firstValue(mapping, ["id"]) ?? `mapping-${index + 1}`;
    const label = firstValue(mapping, ["label", "name"]) ?? id;
    const kind = firstValue(mapping, ["kind", "role", "type"]) ?? "object";
    const fields = [
      id,
      label,
      kind,
      textList(firstValue(mapping, ["layerPatterns", "layers"])).join(","),
      textList(firstValue(mapping, ["blockPatterns", "blocks"])).join(","),
      textList(firstValue(mapping, ["textPatterns", "texts"])).join(","),
      textList(firstValue(mapping, ["entityTypes", "entities"])).join(","),
    ].map((value) => `"${lispString(value)}"`);
    return `  (${fields.join(" ")} ${bounds.map(lispNumber).join(" ")})`;
  });
  const mappingList = mappings.length ? `(\n${mappings.join("\n")}\n)` : "()";
  const output = lispString(outputPath);
  const limit = Math.max(1, Math.trunc(maxItems));

  return `${readStandardsLib().trimEnd()}

(setq acadstd:scan-output "${output}")
(setq acadstd:scan-mappings '${mappingList})
(setq acadstd:scan-count
  (acadstd:scan acadstd:scan-output acadstd:scan-mappings ${limit}))
(if (numberp acadstd:scan-count)
  (acad:write-result "ok"
    (strcat "standards_scan=" (itoa acadstd:scan-count)))
  (acad:write-result "error" "standards_scan_failed"))
(princ)
`;
}

function decodeAcadText(value: string): string {
  return value.replace(
    /\\U\+([0-9A-Fa-f]{4})/g,
    (_match, hex: string) => String.fromCodePoint(parseInt(hex, 16)),
  );
}

export function parseStandardsScanTsv(raw: string): StandardsScan {
  const result: StandardsScan = { settings: {}, dimensions: [], objects: [] };
  for (const sourceLine of raw.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (!sourceLine) continue;
    const columns = sourceLine.split("\t").map(decodeAcadText);
    if (columns[0] === "SETTING" && columns[1]) {
      result.settings[columns[1]] = columns.slice(2).join("\t");
    } else if (columns[0] === "DIM" && columns[1]) {
      result.dimensions.push({
        handle: columns[1],
        layer: columns[2] || "",
        style: columns[3] || "",
        axis: columns[4] || "",
        /* Thiếu số thì để `NaN` LỘ RA, không quy về `0`.
           `0` là một toạ độ hàng HỢP LỆ, nên quy về nó là bịa ra một DIM nằm
           đúng gốc toạ độ — rồi `analyzeDimensionRows()` thấy nó lệch hàng và
           dựng một phát hiện `dim-row` cho một cái không có thật, mà nay phát
           hiện đó BẤM SỬA ĐƯỢC: `DIMSPACE` sẽ dời các DIM thật theo một con số
           bịa. Bộ lọc `Number.isFinite(dimension.row)` ngay dưới kia vốn đã viết
           đúng từ đầu — nó chỉ chưa bao giờ chạy, vì tới đây không còn `NaN` nào.
           `rotation` giữ nguyên `numberOrZero`: không dòng mã nào đọc tới nó. */
        row: finiteNumber(columns[5]) ?? Number.NaN,
        rotation: numberOrZero(columns[6]),
        measurement: finiteNumber(columns[7]) ?? Number.NaN,
        text: columns.slice(8).join("\t"),
      });
    } else if (columns[0] === "OBJECT" && columns[4]) {
      result.objects.push({
        mappingId: columns[1] || "",
        label: columns[2] || "",
        kind: columns[3] || "",
        handle: columns[4],
        type: columns[5] || "",
        layer: columns[6] || "",
        area: numberOrZero(columns[7]),
        width: numberOrZero(columns[8]),
        height: numberOrZero(columns[9]),
        x: numberOrZero(columns[10]),
        y: numberOrZero(columns[11]),
        text: columns.slice(12).join("\t"),
      });
    }
  }
  return result;
}

export function analyzeDimensionRows(
  dimensions: readonly StandardsDimension[],
  rowSpacing: number,
  rowTolerance: number,
): DimensionRowAnalysis[] {
  if (!Number.isFinite(rowSpacing) || rowSpacing <= 0 ||
      !Number.isFinite(rowTolerance) || rowTolerance < 0) {
    return [];
  }

  const output: DimensionRowAnalysis[] = [];
  for (const axis of ["H", "V"] as const) {
    const rows = dimensions
      .filter((dimension) => dimension.axis.toUpperCase() === axis &&
        Number.isFinite(dimension.row))
      .slice()
      .sort((left, right) => left.row - right.row ||
        left.handle.localeCompare(right.handle));
    if (rows.length < 2) continue;

    let best = rows[0];
    let bestAligned = -1;
    let bestDeviation = Number.POSITIVE_INFINITY;
    for (const possible of rows) {
      let aligned = 0;
      let totalDeviation = 0;
      for (const dimension of rows) {
        const step = Math.round((dimension.row - possible.row) / rowSpacing);
        const deviation = Math.abs(
          dimension.row - (possible.row + step * rowSpacing),
        );
        if (deviation <= rowTolerance) aligned++;
        totalDeviation += deviation;
      }
      if (aligned > bestAligned ||
          (aligned === bestAligned && totalDeviation < bestDeviation)) {
        best = possible;
        bestAligned = aligned;
        bestDeviation = totalDeviation;
      }
    }

    const candidates = rows.flatMap((dimension): DimensionRowCandidate[] => {
      const step = Math.round((dimension.row - best.row) / rowSpacing);
      const expectedRow = best.row + step * rowSpacing;
      const offset = dimension.row - expectedRow;
      const deviation = Math.abs(offset);
      return deviation > rowTolerance
        ? [{ ...dimension, expectedRow, offset, deviation }]
        : [];
    });
    output.push({ axis, anchor: best, candidates });
  }
  return output;
}

function snapshotSettings(snapshot: unknown): JsonRecord {
  const root = asRecord(snapshot);
  const drawing = asRecord(root?.drawing);
  return asRecord(root?.settings) || asRecord(drawing?.settings) || {};
}

/** `kByColor` cua `AcCmEntityColor::ColorMethod` — layer dung mau that. */
const COLOR_METHOD_TRUE = 0xc2;

/**
 * Mau QUAN SAT DUOC cua mot dong bang layer: `#RRGGBB` neu layer dung mau that,
 * nguoc lai la chi so ACI.
 *
 * Doc `aci` cho moi truong hop la sai voi layer mau that: `colorIndex()` cua no
 * la mot chi so KHONG mang mau nguoi dung dat. Ho so ghi `#FF8000`, audit doc ra
 * mot so, va phep so LUC NAO CUNG lech — layer bao "chua dung mau" mai mai, moi
 * lan bam sua lai ap dung dung cai gia tri da co san. Loi kieu nay khong tu lo
 * ra: no trong het nhu mot ban ve thuc su sai chuan.
 */
function observedLayerColor(row: JsonRecord): unknown {
  const method = row.colorMethod;
  const rgb = row.rgb;
  const trueColor = typeof method === "number"
    ? method === COLOR_METHOD_TRUE
    /* Ban plugin cu khong phat `colorMethod`. Suy tu `rgb` thi mau that DEN
       TUYEN khong phan biet duoc voi layer ACI — diem mu nay khong go duoc o
       phia doc, va do la ly do `colorMethod` duoc them vao plugin. */
    : Array.isArray(rgb) && rgb.length >= 3
      && rgb.some((channel) => typeof channel === "number" && channel !== 0);
  if (!trueColor) return row.aci ?? row.color;
  const channels = Array.isArray(rgb) && rgb.length >= 3
    ? rgb.slice(0, 3).map((channel) =>
      typeof channel === "number" && Number.isInteger(channel)
        && channel >= 0 && channel <= 255
        ? channel
        : undefined)
    : [undefined];
  /* Layer dung mau that ma `rgb` khong doc duoc: mau quan sat duoc la KHONG
     BIET, va `undefined` la cach noi dieu do.
     Lui ve `aci` o day tung la mot duong BAO DAT SAI: ho so cho doi ACI 7, layer
     noi ro no dung mau that nhung `rgb` hong, `aci` tinh co bang 7 — audit bao
     dat chuan trong khi mau that su cua layer khong ai biet. Khong bieu dien
     duoc thi khong ket luan, ke ca ket luan "dung". */
  if (channels.some((channel) => channel === undefined)) return undefined;
  return `#${channels
    .map((channel) => (channel as number).toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

function snapshotLayers(snapshot: unknown): JsonRecord[] {
  const root = asRecord(snapshot);
  const tables = asRecord(root?.tables);
  const drawing = asRecord(root?.drawing);
  return records(tables?.layers ?? drawing?.layers ?? root?.layers);
}

function currentSetting(
  scan: StandardsScan,
  snapshot: unknown,
  key: string,
): unknown {
  return scan.settings[key] !== undefined
    ? scan.settings[key]
    : snapshotSettings(snapshot)[key];
}

function normalizedExpected(value: unknown, variable: string): unknown {
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value !== "string") return value;
  const normalized = value.trim().toLowerCase();
  if (variable === "LUNITS") {
    return {
      scientific: 1,
      decimal: 2,
      engineering: 3,
      architectural: 4,
      fractional: 5,
    }[normalized] ?? value;
  }
  if (variable === "lineweight") {
    if (normalized === "default") return -3;
    if (normalized === "byblock") return -2;
    if (normalized === "bylayer") return -1;
  }
  if (/COLOR$|^DIMCLR/.test(variable)) {
    if (normalized === "bylayer") return 256;
    if (normalized === "byblock") return 0;
  }
  if (variable === "DIMATFIT" && normalized === "best fit") return 3;
  if (variable === "DIMTAD") {
    return {
      centered: 0,
      above: 1,
      outside: 2,
      jis: 3,
      below: 4,
    }[normalized] ?? value;
  }
  if (variable === "DIMJUST") {
    return {
      centered: 0,
      "at first extension line": 1,
      "at second extension line": 2,
      "above first extension line": 3,
      "above second extension line": 4,
    }[normalized] ?? value;
  }
  if (variable === "DIMBLK") {
    return {
      "closed filled": "",
      "architectural tick": "_ARCHTICK",
      dot: "_DOT",
      oblique: "_OBLIQUE",
      open: "_OPEN",
    }[normalized] ?? value;
  }
  const numeric = finiteNumber(value);
  return numeric ?? value;
}

function sameValue(current: unknown, expected: unknown, variable = ""): boolean {
  const left = normalizedExpected(current, variable);
  const right = normalizedExpected(expected, variable);
  const leftNumber = finiteNumber(left);
  const rightNumber = finiteNumber(right);
  if (leftNumber !== undefined && rightNumber !== undefined) {
    if (variable === "lineweight") {
      const leftMillimeters = Math.abs(leftNumber) > 2.11 ? leftNumber / 100 : leftNumber;
      const rightMillimeters = Math.abs(rightNumber) > 2.11 ? rightNumber / 100 : rightNumber;
      return Math.abs(leftMillimeters - rightMillimeters) <= 1e-9;
    }
    return Math.abs(leftNumber - rightNumber) <= 1e-9;
  }
  return String(left ?? "").trim().toLowerCase() ===
    String(right ?? "").trim().toLowerCase();
}

function expectedUnits(profile: StandardsEngineProfile): JsonRecord | undefined {
  return asRecord(profile.drawing);
}

function expectedDimensionStyle(
  profile: StandardsEngineProfile,
): JsonRecord | undefined {
  return asRecord(profile.dimension);
}

function expectedDimensionVariables(style: JsonRecord): JsonRecord {
  const explicit = asRecord(style.variables);
  if (explicit) return explicit;
  const aliases: Record<string, string> = {
    precision: "DIMDEC",
    measurementScale: "DIMLFAC",
    overallScale: "DIMSCALE",
    fit: "DIMATFIT",
    textVertical: "DIMTAD",
    textHorizontal: "DIMJUST",
    annotative: "DIMANNO",
    textHeight: "DIMTXT",
    textStyle: "DIMTXSTY",
    textColor: "DIMCLRT",
    dimensionLineColor: "DIMCLRD",
    extensionLineColor: "DIMCLRE",
    extendBeyondDimLines: "DIMEXE",
    offsetFromOrigin: "DIMEXO",
    textGap: "DIMGAP",
  };
  const output: JsonRecord = {};
  for (const [field, variable] of Object.entries(aliases)) {
    if (style[field] !== undefined) output[variable] = style[field];
  }
  if (style.annotative === true && style.paperTextHeight !== undefined) {
    output.DIMTXT = style.paperTextHeight;
  }
  if (style.alignment !== undefined) {
    const aligned = String(style.alignment).toLowerCase().includes("aligned");
    output.DIMTIH = aligned ? 0 : 1;
    output.DIMTOH = aligned ? 0 : 1;
  }
  if (style.arrowhead !== undefined) output.DIMBLK = style.arrowhead;
  return output;
}

function dimensionRule(profile: StandardsEngineProfile): JsonRecord | undefined {
  return asRecord(profile.dimension);
}

function expectedSheet(profile: StandardsEngineProfile): JsonRecord | undefined {
  const drawing = asRecord(profile.drawing);
  const paper = asRecord(drawing?.paper);
  return paper ? {
    ...paper,
    modelScale: drawing?.modelScale,
    tolerancePercent: drawing?.frameTolerancePercent,
  } : undefined;
}

function issueIdPart(value: unknown): string {
  return String(value ?? "unknown").trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "unknown";
}

export function auditStandards(
  profile: StandardsEngineProfile,
  snapshot: unknown,
  scan: StandardsScan,
): StandardsAuditIssue[] {
  const issues: StandardsAuditIssue[] = [];

  const units = expectedUnits(profile);
  if (units) {
    const expected = {
      INSUNITS: firstValue(units, ["insunits", "insertionUnits"]),
      LUNITS: firstValue(units, ["linearFormat", "lunits"]),
      LUPREC: firstValue(units, ["precision", "luprec"]),
    };
    const current: JsonRecord = {};
    const wanted: JsonRecord = {};
    for (const [key, value] of Object.entries(expected)) {
      if (value === undefined) continue;
      current[key] = currentSetting(scan, snapshot, key) ?? null;
      wanted[key] = normalizedExpected(value, key);
    }
    if (Object.keys(wanted).some((key) => !sameValue(current[key], wanted[key], key))) {
      issues.push({
        id: "unit",
        scope: "unit",
        severity: "warning",
        message: "Đơn vị bản vẽ chưa khớp mẫu quy chuẩn.",
        handles: [],
        current,
        expected: wanted,
        suggestedAction: { action: "apply-units" },
      });
    }
  }

  const actualLayers = snapshotLayers(snapshot);
  const layersByName = new Map(actualLayers.map((layer) => [
    String(layer.name ?? "").toLowerCase(),
    layer,
  ]));
  for (const layer of records(profile.layers)) {
    const name = String(layer.name ?? "").trim();
    if (!name) continue;
    const actual = layersByName.get(name.toLowerCase());
    if (!actual) {
      if (layer.required !== false) {
        issues.push({
          id: `layer-missing-${issueIdPart(name)}`,
          scope: "layer",
          severity: "error",
          message: `Thiếu layer bắt buộc “${name}”.`,
          handles: [],
          current: null,
          expected: layer,
          suggestedAction: { action: "sync-layers", layer: name },
        });
      }
      continue;
    }
    const wanted: JsonRecord = {};
    const current: JsonRecord = {};
    const checks: [string, unknown, unknown][] = [
      ["color", firstValue(layer, ["aci", "color"]), observedLayerColor(actual)],
      ["linetype", layer.linetype, actual.linetype],
      ["lineweight", layer.lineweight, actual.lineweight],
    ];
    for (const [key, expected, observed] of checks) {
      if (expected === undefined || sameValue(observed, expected, key)) continue;
      wanted[key] = expected;
      current[key] = observed ?? null;
    }
    if (Object.keys(wanted).length) {
      issues.push({
        id: `layer-properties-${issueIdPart(name)}`,
        scope: "layer",
        severity: "warning",
        message: `Thuộc tính layer “${name}” chưa đúng mẫu.`,
        handles: [],
        current,
        expected: wanted,
        suggestedAction: { action: "sync-layers", layer: name },
      });
    }
  }

  const dimStyle = expectedDimensionStyle(profile);
  if (dimStyle) {
    const styleName = String(firstValue(dimStyle, ["name", "styleName"]) ?? "").trim();
    const currentName = String(currentSetting(scan, snapshot, "DIMSTYLE") ?? "");
    const variables = expectedDimensionVariables(dimStyle);
    const variableDifferences: JsonRecord = {};
    const currentVariables: JsonRecord = {};
    for (const [variable, expected] of Object.entries(variables)) {
      const current = currentSetting(scan, snapshot, variable);
      if (!sameValue(current, expected, variable)) {
        variableDifferences[variable] = expected;
        currentVariables[variable] = current ?? null;
      }
    }
    const wrongDimensions = styleName
      ? scan.dimensions.filter((dimension) =>
          dimension.style.toLowerCase() !== styleName.toLowerCase())
      : [];
    if ((styleName && currentName.toLowerCase() !== styleName.toLowerCase()) ||
        wrongDimensions.length || Object.keys(variableDifferences).length) {
      issues.push({
        id: "dimstyle",
        scope: "dimstyle",
        severity: "warning",
        message: "Dim style hiện tại hoặc các DIM chưa khớp mẫu.",
        handles: wrongDimensions.map((dimension) => dimension.handle),
        current: { name: currentName, variables: currentVariables },
        expected: { name: styleName, variables: variableDifferences },
        suggestedAction: { action: "apply-dimstyle", styleName },
      });
    }
  }

  const rule = dimensionRule(profile);
  const spacing = finiteNumber(firstValue(rule, ["rowSpacing", "spacing"]));
  const tolerance = finiteNumber(firstValue(rule, ["rowTolerance", "tolerance"])) ?? 0;
  if (spacing !== undefined && spacing > 0) {
    for (const analysis of analyzeDimensionRows(scan.dimensions, spacing, tolerance)) {
      if (!analysis.candidates.length) continue;
      issues.push({
        id: `dim-row-${analysis.axis.toLowerCase()}`,
        scope: "dim-row",
        severity: "warning",
        message: `${analysis.candidates.length} DIM ${analysis.axis} lệch hàng chuẩn.`,
        handles: analysis.candidates.map((candidate) => candidate.handle),
        current: analysis.candidates.map((candidate) => ({
          handle: candidate.handle,
          row: candidate.row,
          offset: candidate.offset,
        })),
        expected: { spacing, tolerance },
        suggestedAction: {
          action: "dimspace",
          axis: analysis.axis,
          baseHandle: analysis.anchor.handle,
          handles: analysis.candidates.map((candidate) => candidate.handle),
          spacing,
        },
      });
    }
  }

  const sheet = expectedSheet(profile);
  if (sheet) {
    const scale = finiteNumber(firstValue(sheet, ["modelScale", "scale"])) ?? 1;
    const width = (finiteNumber(firstValue(sheet, ["width", "paperWidth"])) ?? 0) * scale;
    const height = (finiteNumber(firstValue(sheet, ["height", "paperHeight"])) ?? 0) * scale;
    const tolerancePercent =
      finiteNumber(firstValue(sheet, ["tolerancePercent", "frameTolerancePercent"])) ?? 1;
    const frames = scan.objects.filter((object) =>
      /frame|sheet|title.?block|khung/i.test(`${object.kind} ${object.mappingId}`));
    if (width > 0 && height > 0) {
      for (const frame of frames) {
        if (frame.width <= 0 || frame.height <= 0) {
          issues.push({
            id: `frame-unmeasurable-${issueIdPart(frame.handle)}`,
            scope: "frame",
            severity: "info",
            message:
              `Đã nhận diện “${frame.label || frame.handle}” nhưng loại ${frame.type} ` +
              "chưa đo được kích thước tự động.",
            handles: [frame.handle],
            current: { width: frame.width, height: frame.height, type: frame.type },
            expected: { width, height, tolerancePercent },
            suggestedAction: { action: "review-mapping", handle: frame.handle },
          });
          continue;
        }
        const normalError =
          Math.abs(frame.width - width) / width +
          Math.abs(frame.height - height) / height;
        const rotatedError =
          Math.abs(frame.width - height) / height +
          Math.abs(frame.height - width) / width;
        const expectedWidth = rotatedError < normalError ? height : width;
        const expectedHeight = rotatedError < normalError ? width : height;
        const widthTolerance = Math.abs(expectedWidth) * tolerancePercent / 100;
        const heightTolerance = Math.abs(expectedHeight) * tolerancePercent / 100;
        if (Math.abs(frame.width - expectedWidth) <= widthTolerance &&
            Math.abs(frame.height - expectedHeight) <= heightTolerance) continue;
        issues.push({
          id: `frame-${issueIdPart(frame.handle)}`,
          scope: "frame",
          severity: "warning",
          message: `Kích thước khung “${frame.label || frame.handle}” chưa đúng mẫu.`,
          handles: [frame.handle],
          current: { width: frame.width, height: frame.height },
          expected: {
            width: expectedWidth,
            height: expectedHeight,
            tolerancePercent,
          },
          suggestedAction: {
            action: "resize-frame",
            handle: frame.handle,
            width: expectedWidth,
            height: expectedHeight,
          },
        });
      }
    }
  }

  for (const mapping of profileMappings(profile)) {
    if (mapping.required !== true) continue;
    const id = String(mapping.id ?? "").trim();
    if (!id || scan.objects.some((object) => object.mappingId === id)) continue;
    issues.push({
      id: `mapping-required-${issueIdPart(id)}`,
      scope: "mapping-required",
      severity: "error",
      message: `Không tìm thấy đối tượng bắt buộc “${mapping.label || id}”.`,
      handles: [],
      current: 0,
      expected: { mappingId: id, minimum: 1 },
      suggestedAction: { action: "review-mapping", mappingId: id },
    });
  }

  return issues;
}

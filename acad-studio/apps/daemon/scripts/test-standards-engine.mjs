import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
process.env.ACAD_PROJECT_ROOT = resolve(here, "../../../..");

const {
  analyzeDimensionRows,
  auditStandards,
  buildStandardsScanLisp,
  parseStandardsScanTsv,
  standardsLibPath,
} = await import("../src/standardsEngine.ts");

const raw = [
  "ACAD_STANDARDS\t1",
  "SETTING\tINSUNITS\t4",
  "SETTING\tDIMSTYLE\tISO-25",
  "DIM\tA1\tA-DIM\tISO-25\tH\t10\t0\t3000\t<>",
  "OBJECT\tliving\tPh\\U+00F2ng kh\\U+00E1ch\troom\tB2\tLWPOLYLINE\tA-ROOM\t24.5\t6\t4\t3\t2\tPh\\U+00F2ng kh\\U+00E1ch",
  "END\t1",
].join("\r\n");
const parsed = parseStandardsScanTsv(raw);
assert.deepEqual(parsed.settings, { INSUNITS: "4", DIMSTYLE: "ISO-25" });
assert.equal(parsed.dimensions.length, 1);
assert.equal(parsed.dimensions[0].measurement, 3000);
assert.equal(parsed.objects[0].label, "Phòng khách");
assert.equal(parsed.objects[0].text, "Phòng khách");
assert.equal(parsed.objects[0].area, 24.5);

const dimensions = [
  { handle: "H0", layer: "A-DIM", style: "ISO-25", axis: "H", row: 0,
    rotation: 0, measurement: 100, text: "" },
  { handle: "H1", layer: "A-DIM", style: "ISO-25", axis: "H", row: 10,
    rotation: 0, measurement: 100, text: "" },
  { handle: "H2", layer: "A-DIM", style: "ISO-25", axis: "H", row: 22,
    rotation: 0, measurement: 100, text: "" },
  { handle: "V0", layer: "A-DIM", style: "ISO-25", axis: "V", row: 5,
    rotation: Math.PI / 2, measurement: 100, text: "" },
  { handle: "V1", layer: "A-DIM", style: "ISO-25", axis: "V", row: 15.4,
    rotation: Math.PI / 2, measurement: 100, text: "" },
];
const dimensionRows = analyzeDimensionRows(dimensions, 10, 0.5);
const horizontal = dimensionRows.find((row) => row.axis === "H");
const vertical = dimensionRows.find((row) => row.axis === "V");
assert.equal(horizontal?.anchor.handle, "H0");
assert.deepEqual(horizontal?.candidates.map((row) => row.handle), ["H2"]);
assert.equal(horizontal?.candidates[0].expectedRow, 20);
assert.equal(vertical?.candidates.length, 0);
assert.deepEqual(analyzeDimensionRows(dimensions, 0, 1), []);

const profile = {
  id: "vn-a3",
  name: "VN A3",
  drawing: {
    unit: "mm",
    insunits: 4,
    linearFormat: "Decimal",
    precision: 0,
    modelScale: 1,
    paper: { name: "A3", width: 420, height: 297 },
    frameTolerancePercent: 1,
  },
  dimension: {
    styleName: "ISO-25",
    precision: 0,
    measurementScale: 1,
    overallScale: 1,
    fit: "Best fit",
    textVertical: "Above",
    textHorizontal: "Centered",
    annotative: false,
    textHeight: 2.5,
    textStyle: "STANDARD",
    textColor: "ByLayer",
    dimensionLineColor: "ByLayer",
    extensionLineColor: "ByLayer",
    extendBeyondDimLines: 1.25,
    offsetFromOrigin: 0.625,
    textGap: 0.625,
    rowSpacing: 10,
    rowTolerance: 0.5,
  },
  mappings: [
    {
      id: "frame-a3",
      label: 'Khung "A3"',
      kind: "frame",
      layerPatterns: ["FRAME*", "TITLE*"],
      blockPatterns: ["A3\\TITLE"],
      textPatterns: [],
      entityTypes: ["LWPOLYLINE"],
      required: true,
      bounds: { minX: 0, minY: 0, maxX: 1000, maxY: 800 },
    },
    {
      id: "living",
      label: "Phòng khách",
      kind: "room",
      layerPatterns: ["A-ROOM"],
      blockPatterns: [],
      textPatterns: ["*PHONG KHACH*"],
      entityTypes: ["LWPOLYLINE"],
      required: true,
    },
  ],
  layers: [
    { name: "A-WALL", color: 1, linetype: "Continuous", lineweight: 0.25, required: true },
    { name: "A-DIM", color: 2, linetype: "Continuous", lineweight: 0.18, required: true },
  ],
};

const lisp = buildStandardsScanLisp(profile, "/tmp/scan output.tsv", 123.9);
assert.match(standardsLibPath(), /standards_lib\.lsp$/);
assert.match(lisp, /\(defun acadstd:scan /);
assert.match(lisp, /\(acadstd:scan acadstd:scan-output acadstd:scan-mappings 123\)/);
assert.match(
  lisp,
  /\(acadstd:scan-map\s+stream mapping allSelection \(- maxItems count\)\)/,
  "mapping scans share one global object budget",
);
assert.ok(lisp.includes('"FRAME*,TITLE*"'));
assert.ok(lisp.includes('"Khung \\"A3\\""'));
assert.ok(lisp.includes('"A3\\\\TITLE"'));
assert.ok(lisp.includes("0 0 1000 800"));
assert.match(lisp, /\(acad:write-result "ok"/);
assert.throws(
  () => buildStandardsScanLisp(profile, "/tmp/bad\npath.tsv", 10),
  /unsafe_lisp_string/,
);

const auditScan = {
  settings: {
    INSUNITS: "1",
    LUNITS: "2",
    LUPREC: "2",
    DIMSTYLE: "BAD",
    DIMDEC: "2",
    DIMLFAC: "1",
  },
  dimensions: dimensions.map((dimension) => ({ ...dimension, style: "BAD" })),
  objects: [{
    mappingId: "frame-a3",
    label: "Khung A3",
    kind: "frame",
    handle: "F1",
    type: "LWPOLYLINE",
    layer: "FRAME",
    area: 0,
    width: 400,
    height: 297,
    x: 200,
    y: 148.5,
    text: "",
  }],
};
const snapshot = {
  settings: { INSUNITS: 1, LUNITS: 2, LUPREC: 2, DIMSTYLE: "BAD" },
  tables: {
    layers: [{
      name: "A-WALL",
      aci: 3,
      linetype: "Continuous",
      lineweight: 25,
    }],
    dimStyles: ["BAD"],
  },
};
const issues = auditStandards(profile, snapshot, auditScan);
for (const scope of [
  "unit",
  "layer",
  "dimstyle",
  "dim-row",
  "frame",
  "mapping-required",
]) {
  assert.ok(issues.some((issue) => issue.scope === scope), `audit emits ${scope}`);
}
for (const issue of issues) {
  assert.equal(typeof issue.id, "string");
  assert.equal(typeof issue.message, "string");
  assert.ok(Array.isArray(issue.handles));
  assert.ok(["error", "warning", "info"].includes(issue.severity));
}
assert.deepEqual(
  issues.find((issue) => issue.id === "layer-properties-a-wall")?.expected,
  { color: 1 },
  "ObjectARX lineweight 25 matches profile lineweight 0.25 mm",
);
assert.equal(
  issues.find((issue) => issue.scope === "dim-row")?.suggestedAction.baseHandle,
  "H0",
);
assert.deepEqual(
  issues.find((issue) => issue.id === "mapping-required-living")?.handles,
  [],
);

console.log("✓ standards engine: builder, parser, DIM rows and audit");

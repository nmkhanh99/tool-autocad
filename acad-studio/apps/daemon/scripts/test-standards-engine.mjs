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
/* Layer MAU THAT: audit phai lay mau quan sat duoc tu `colorMethod`/`rgb`, khong
   phai tu `aci`. Doc `aci` la so voi mot chi so KHONG mang mau nguoi dung dat,
   nen ho so `#FF8000` se lech MAI MAI — moi lan bam sua lai ap dung dung cai gia
   tri da co san, va loi nay khong tu lo ra vi no trong het nhu ban ve sai chuan. */
const trueColorProfile = {
  ...profile,
  layers: [{ name: "A-WALL", color: "#FF8000", linetype: "Continuous", lineweight: 0.25 }],
};
const trueColorSnapshot = (layer) => ({
  ...snapshot,
  tables: { ...snapshot.tables, layers: [layer] },
});
const layerIssue = (prof, layer) =>
  auditStandards(prof, trueColorSnapshot(layer), auditScan)
    .find((issue) => issue.id === "layer-properties-a-wall");

assert.equal(
  layerIssue(trueColorProfile, {
    name: "A-WALL", colorMethod: 0xc2, aci: 0, rgb: [255, 128, 0],
    linetype: "Continuous", lineweight: 25,
  }),
  undefined,
  "layer mau that khop ho so thi KHONG bao lech",
);
/* Hoa/thuong khong duoc thanh mot khac biet: `sameValue` ha thap ca hai ve, va
   test nay khoa dieu do lai. */
assert.equal(
  layerIssue({ ...trueColorProfile, layers: [{ ...trueColorProfile.layers[0], color: "#ff8000" }] }, {
    name: "A-WALL", colorMethod: 0xc2, aci: 0, rgb: [255, 128, 0],
    linetype: "Continuous", lineweight: 25,
  }),
  undefined,
  "so mau that khong phan biet hoa/thuong",
);
assert.deepEqual(
  layerIssue(trueColorProfile, {
    name: "A-WALL", colorMethod: 0xc2, aci: 0, rgb: [0, 0, 255],
    linetype: "Continuous", lineweight: 25,
  })?.current,
  { color: "#0000FF" },
  "mau that KHAC ho so thi van bao lech, kem ma mau doc duoc",
);
/* Ban plugin cu khong phat `colorMethod` — van suy duoc tu `rgb` khac 0. */
assert.equal(
  layerIssue(trueColorProfile, {
    name: "A-WALL", aci: 0, rgb: [255, 128, 0], linetype: "Continuous", lineweight: 25,
  }),
  undefined,
  "khong co colorMethod thi lui ve suy tu rgb",
);
/* Layer ACI binh thuong khong duoc di nham nhanh mau that. */
assert.deepEqual(
  layerIssue({ ...trueColorProfile, layers: [{ ...trueColorProfile.layers[0], color: 1 }] }, {
    name: "A-WALL", colorMethod: 0xc3, aci: 3, rgb: [0, 0, 0],
    linetype: "Continuous", lineweight: 25,
  })?.current,
  { color: 3 },
  "layer ACI van doc theo aci",
);
/* Layer noi ro no dung mau that ma `rgb` hong: mau quan sat duoc la KHONG BIET.
   Lui ve `aci` o day la mot duong BAO DAT SAI — ho so cho doi ACI 7, `aci` tinh
   co bang 7, va audit bao dat chuan trong khi mau that su khong ai biet. */
assert.deepEqual(
  layerIssue(trueColorProfile, {
    name: "A-WALL", colorMethod: 0xc2, aci: 3, rgb: [300, 0],
    linetype: "Continuous", lineweight: 25,
  })?.current,
  { color: null },
  "rgb hong thi bao khong biet, khong lui ve aci",
);
assert.deepEqual(
  layerIssue(
    { ...trueColorProfile, layers: [{ ...trueColorProfile.layers[0], color: 7 }] },
    { name: "A-WALL", colorMethod: 0xc2, aci: 7, rgb: [300, 0],
      linetype: "Continuous", lineweight: 25 },
  )?.current,
  { color: null },
  "aci trung voi ho so KHONG duoc thanh mot luot bao dat",
);
/* Thieu han `rgb` cung the — noi la mau that thi phai doc duoc mau that. */
assert.deepEqual(
  layerIssue(
    { ...trueColorProfile, layers: [{ ...trueColorProfile.layers[0], color: 7 }] },
    { name: "A-WALL", colorMethod: 0xc2, aci: 7, linetype: "Continuous", lineweight: 25 },
  )?.current,
  { color: null },
  "thieu rgb ma khai mau that thi cung la khong biet",
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

/* ------------------------------------------------------------------ *
 * Gioi han vung: chuoi TOAN KHOANG TRANG khong duoc thanh 0
 * ------------------------------------------------------------------ */
{
  /* `Number("  ")` la `0` — mot so HUU HAN. Nen mot canh chi chua dau cach se
     thanh gioi han bang 0 trong chuong trinh LISP, tuc doi han tap doi tuong
     luot quet nhan vao, trong khi o nhap trong y het o trong. */
  const boundsLine = (bounds) => {
    const program = buildStandardsScanLisp(
      {
        id: "p", revision: "r", version: 1,
        drawing: {}, layers: [], dimension: {},
        mappings: [{
          id: "m1", label: "m1", kind: "generic",
          layerPatterns: ["A-*"], blockPatterns: [], textPatterns: [], entityTypes: [],
          required: false, bounds,
        }],
      },
      "/tmp/out.tsv",
    );
    const line = program.split("\n").find((row) => row.includes('"m1"'));
    assert.ok(line, "khong tim thay dong anh xa trong chuong trinh");
    // Bon so cuoi dong la minX minY maxX maxY.
    return line.trim().replace(/\)$/, "").split(/\s+/).slice(-4).join(" ");
  };

  assert.equal(
    boundsLine({ minX: 0, minY: 0, maxX: 10, maxY: 10 }),
    "0 0 10 10",
    "gioi han that phai di nguyen vao chuong trinh",
  );
  assert.equal(
    boundsLine({ minX: "  ", minY: 0, maxX: 10, maxY: 10 }),
    "nil 0 10 10",
    "canh toan khoang trang phai la nil, KHONG phai 0",
  );
  assert.equal(
    boundsLine({ minX: "", minY: 0, maxX: 10, maxY: 10 }),
    "nil 0 10 10",
    "chuoi rong cung vay",
  );
}

console.log("✓ standards engine: khoang trang khong phai so 0");

/* ------------------------------------------------------------------ *
 * DIM thieu toa do: giu NaN, dung bia so 0
 * ------------------------------------------------------------------ */
{
  /* `0` la mot toa do hang HOP LE, nen quy thieu-truong ve `0` la bia ra mot DIM
     nam dung goc toa do. `analyzeDimensionRows()` roi thay no lech hang va dung
     mot phat hien `dim-row` cho mot cai KHONG CO THAT — ma nay phat hien do bam
     SUA duoc: DIMSPACE se doi cac DIM that theo mot con so bia. */
  const parsed = parseStandardsScanTsv([
    "DIM\tA1\tDIM-L\tStd\tH\t100\t0\t2500\t",
    "DIM\tB2\tDIM-L\tStd\tH\t\t0\t\t",
  ].join("\n"));
  assert.equal(parsed.dimensions.length, 2);
  assert.equal(parsed.dimensions[0].row, 100);
  assert.ok(Number.isNaN(parsed.dimensions[1].row), "thieu toa do hang phai la NaN");
  assert.ok(Number.isNaN(parsed.dimensions[1].measurement), "thieu so do phai la NaN");

  /* Bo loc `Number.isFinite(dimension.row)` trong `analyzeDimensionRows()` vien
     dung tu dau — no chi chua bao gio chay, vi toi day khong con `NaN` nao. */
  const analyses = analyzeDimensionRows(parsed.dimensions, 100, 1);
  for (const analysis of analyses) {
    for (const candidate of analysis.candidates) {
      assert.notEqual(candidate.handle, "B2", "DIM khong doc duoc hang khong duoc vao phat hien");
    }
    assert.notEqual(analysis.anchor.handle, "B2", "va cang khong duoc lam moc");
  }
}

console.log("✓ standards engine: DIM thieu toa do khong bi bia thanh 0");

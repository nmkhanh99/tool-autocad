import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
process.env.ACAD_PROJECT_ROOT = resolve(here, "../../../..");

const {
  buildStandardsAction,
  drawingStandardsRouter,
} = await import("../src/drawingStandards.ts");
const { DEFAULT_PROFILE } = await import("../src/standardsProfile.ts");

const scaleAll = buildStandardsAction(
  "scale",
  [],
  { all: true, factor: 2, basePoint: [10, 20] },
  "Drawing1.dwg",
);
assert.equal(scaleAll.mutates, true);
assert.match(scaleAll.lisp, /\(acadstd:scale \(list \) T 2 \(list 10 20 0\)\)/);
assert.match(scaleAll.lisp, /_\.UNDO" "_Begin/);
assert.match(scaleAll.lisp, /_\.UNDO" "_End/);

const rotate = buildStandardsAction(
  "rotate",
  ["A1", "B2"],
  { angle: 45, basePoint: [0, 0] },
  "Drawing1.dwg",
);
assert.match(rotate.lisp, /\(acadstd:rotate \(list "A1" "B2"\) 45/);

const color = buildStandardsAction(
  "color",
  ["A1"],
  { color: "ByLayer" },
  "Drawing1.dwg",
);
assert.match(color.lisp, /\(acadstd:set-color \(list "A1"\) 256\)/);

const units = buildStandardsAction(
  "apply-units",
  [],
  { ...DEFAULT_PROFILE.drawing },
  "Drawing1.dwg",
);
assert.match(units.lisp, /\(acadstd:set-units 4 2 0\)/);

const dimension = buildStandardsAction(
  "apply-dimstyle",
  [],
  { ...DEFAULT_PROFILE.dimension },
  "Drawing1.dwg",
);
assert.ok(dimension.lisp.includes('"DIMEXE"'));
assert.ok(dimension.lisp.includes('"DIMEXO"'));
assert.ok(dimension.lisp.includes('"DIMBLK"'));
assert.ok(dimension.lisp.includes('"ACAD-DIM"'));

const layers = buildStandardsAction(
  "sync-layers",
  [],
  { layers: DEFAULT_PROFILE.layers },
  "Drawing1.dwg",
);
assert.match(layers.lisp, /\(acadstd:sync-layers/);
assert.ok(layers.lisp.includes('"MAT-CAT"'));

const area = buildStandardsAction(
  "area",
  ["CAFE"],
  {},
  "Drawing1.dwg",
  "/tmp/area.tsv",
);
assert.equal(area.mutates, false);
assert.match(area.lisp, /\(acadstd:measure "\/tmp\/area\.tsv" \(list "CAFE"\)\)/);
assert.doesNotMatch(area.lisp, /_\.UNDO/);

assert.throws(
  () => buildStandardsAction("scale", [], { factor: 0 }, "Drawing1.dwg"),
  /factor/,
);
assert.throws(
  () => buildStandardsAction("color", ["A1"], { color: "RGB(1,2,3)" }, "Drawing1.dwg"),
  /ACI/,
);

const router = drawingStandardsRouter();
assert.equal(typeof router, "function");
const routePaths = router.stack
  .map((layer) => layer.route?.path)
  .filter(Boolean);
for (const path of ["/profiles", "/scan", "/apply", "/action"]) {
  assert.ok(routePaths.includes(path), `router includes ${path}`);
}

console.log("✓ drawing standards router: typed actions and routes");

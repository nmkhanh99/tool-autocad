import assert from "node:assert/strict";
import test from "node:test";

import {
  createDeterministicFixture,
  DEFAULT_CADWEB_LIMITS,
  type Matrix4,
  type Vec3,
} from "@acad/cadweb";

import {
  canTessellateBulges,
  counterclockwiseSweep,
  loadCadWeb,
  MAX_RENDER_VERTICES,
  multiplyMatrix4,
  reserveRenderVertices,
  transformPoint,
} from "../app/cadweb.worker.js";

function closeTo(actual: Vec3, expected: Vec3): void {
  for (let index = 0; index < 3; index += 1) {
    assert.ok(
      Math.abs(actual[index] - expected[index]) < 1e-10,
      `axis ${index}: expected ${expected[index]}, received ${actual[index]}`,
    );
  }
}

test("transforms a block point with AcGe row-major translation", () => {
  const translation: Matrix4 = [
    1, 0, 0, 10,
    0, 1, 0, 20,
    0, 0, 1, 30,
    0, 0, 0, 1,
  ];
  closeTo(transformPoint([1, 2, 3], translation), [11, 22, 33]);
});

test("composes parent and nested block transforms in parent-child order", () => {
  const parentTranslation: Matrix4 = [
    1, 0, 0, 10,
    0, 1, 0, 20,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const childScaleAndRotation: Matrix4 = [
    0, -2, 0, 0,
    3, 0, 0, 0,
    0, 0, 1, 0,
    0, 0, 0, 1,
  ];
  const nestedTransform = multiplyMatrix4(parentTranslation, childScaleAndRotation);
  closeTo(transformPoint([1, 2, 0], nestedTransform), [6, 23, 0]);
});

test("expands the contract fixture block into transferred render vertices", async () => {
  const fixture = await createDeterministicFixture();
  const response = await loadCadWeb({
    type: "load",
    requestId: 7,
    file: new File([Uint8Array.from(fixture)], "basic-v1.cadweb"),
  });
  assert.equal(response.type, "loaded");
  if (response.type !== "loaded") {
    return;
  }

  const layer = response.document.layers.find((candidate) => candidate.id === "layer:0");
  assert.ok(layer, "fixture layer 0 must exist");
  const values = layer.lineVertices;
  let foundTransformedBlockLine = false;
  for (let offset = 0; offset + 11 < values.length; offset += 12) {
    if (
      Math.abs(values[offset] - 12) < 1e-6 &&
      Math.abs(values[offset + 1] - 2) < 1e-6 &&
      Math.abs(values[offset + 6] - 13) < 1e-6 &&
      Math.abs(values[offset + 7] - 2) < 1e-6
    ) {
      foundTransformedBlockLine = true;
      break;
    }
  }
  assert.equal(foundTransformedBlockLine, true);
  assert.equal(response.document.renderedEntityCount, 7);
  assert.ok(response.document.warnings.some((warning) => warning.includes("attribute")));
});

test("rejects an oversized File before allocating its ArrayBuffer", async () => {
  let arrayBufferCalled = false;
  const oversized = {
    name: "oversized.cadweb",
    size: DEFAULT_CADWEB_LIMITS.maxArchiveBytes + 1,
    arrayBuffer: async () => {
      arrayBufferCalled = true;
      return new ArrayBuffer(0);
    },
  } as File;

  const response = await loadCadWeb({
    type: "load",
    requestId: 8,
    file: oversized,
  });
  assert.equal(response.type, "error");
  if (response.type === "error") assert.equal(response.code, "ZIP_LIMIT");
  assert.equal(arrayBufferCalled, false);
});

test("rejects extreme arc angles without entering an unbounded normalization loop", () => {
  assert.equal(counterclockwiseSweep(1e308, -1e308), null);
  assert.ok(Math.abs((counterclockwiseSweep(3 * Math.PI / 2, 0) ?? 0) - Math.PI / 2) < 1e-12);
});

test("only tessellates bulges in the supported XY/+Z orientation", () => {
  assert.equal(canTessellateBulges(undefined), true);
  assert.equal(canTessellateBulges([0, 0, 1]), true);
  assert.equal(canTessellateBulges([0, 0, -1]), false);
  assert.equal(canTessellateBulges([0, 1, 1]), false);
});

test("enforces a global vertex budget before growing render arrays", () => {
  const budget = { vertices: MAX_RENDER_VERTICES - 2, exhausted: false };
  assert.equal(reserveRenderVertices(budget, 2), true);
  assert.equal(budget.vertices, MAX_RENDER_VERTICES);
  assert.equal(reserveRenderVertices(budget, 1), false);
  assert.equal(budget.exhausted, true);
});

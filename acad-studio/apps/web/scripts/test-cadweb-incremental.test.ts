import assert from "node:assert/strict";
import test from "node:test";

import {
  BufferKind,
  EntityKind,
  PropertySourceMode,
  SpaceKind,
  type CadWebBlockDefinition,
  type CadWebDeltaDocument,
  type CadWebDeltaManifest,
  type CadWebDocument,
  type CadWebEntity,
  type CadWebExportReport,
  type CadWebFileDescriptor,
  type CadWebLayer,
  type Vec3,
} from "@acad/cadweb";

import {
  CadWebWorkerSession,
  type CadWebRenderLayer,
  type CadWebWorkerReaders,
  type CadWebWorkerResponse,
} from "../app/cadweb.worker.js";
import {
  revisionStateFromSnapshot,
  stageCadWebDelta,
} from "../app/cadweb-viewer-state.js";

const drawingId = "drawing-1";
const sourceFingerprint = "fingerprint-1";
const modelEpoch = "epoch-1";
const descriptor: CadWebFileDescriptor = {
  path: "unused",
  encoding: "json",
  size: 0,
  sha256: "0".repeat(64),
};

function entity(handle: string, layerId: string, points: Vec3[]): CadWebEntity {
  return {
    id: `entity:${handle}`,
    sourceHandle: handle,
    kind: EntityKind.Line,
    layerId,
    space: SpaceKind.Model,
    visible: true,
    colorArgb: 0xff_ffffff,
    transparency: 0,
    lineWeightMm: 0.25,
    linetype: "Continuous",
    colorSourceMode: PropertySourceMode.Explicit,
    transparencySourceMode: PropertySourceMode.Explicit,
    lineWeightSourceMode: PropertySourceMode.Explicit,
    linetypeSourceMode: PropertySourceMode.Explicit,
    drawOrder: 0,
    points,
    bulges: [],
    startWidths: [],
    endWidths: [],
    constantWidth: 0,
    closed: false,
    radius: 0,
    startAngle: 0,
    endAngle: 0,
    rotation: 0,
    height: 0,
    attributes: [],
  };
}

function blockReference(
  handle: string,
  layerId: string,
  blockDefinitionId: string,
  space: SpaceKind = SpaceKind.Model,
): CadWebEntity {
  return {
    ...entity(handle, layerId, []),
    kind: EntityKind.BlockReference,
    space,
    blockDefinitionId,
    transform: [
      1, 0, 0, 0,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ],
  };
}

function layer(handle: string, overrides: Partial<CadWebLayer> = {}): CadWebLayer {
  return {
    id: `layer:${handle}`,
    sourceHandle: handle,
    name: `LAYER-${handle}`,
    visible: true,
    frozen: false,
    locked: false,
    plot: true,
    colorArgb: 0xff_ffffff,
    ...overrides,
  };
}

function definition(handle: string, entities: CadWebEntity[]): CadWebBlockDefinition {
  return {
    id: `block:${handle}`,
    sourceHandle: handle,
    name: `BLOCK-${handle}`,
    entities,
  };
}

function assertLineColor(
  layer: CadWebRenderLayer,
  lineIndex: number,
  expected: readonly [number, number, number, number],
): void {
  const offset = lineIndex * 12 + 2;
  assert.ok(layer.lineVertices.length >= offset + 4, `line ${lineIndex} must exist`);
  for (let index = 0; index < 4; index += 1) {
    assert.ok(
      Math.abs(layer.lineVertices[offset + index]! - expected[index]!) < 1e-6,
      `line ${lineIndex} color channel ${index} differs`,
    );
  }
}

function report(): CadWebExportReport {
  return {
    schemaVersion: 1,
    status: "complete",
    counts: { exported: 0, skipped: 0, warnings: 0, errors: 0 },
    issues: [],
  };
}

interface SnapshotInput {
  baseRevision?: number;
  drawing?: string;
  epoch?: string;
  origin?: Vec3;
  layers?: CadWebLayer[];
  entities?: CadWebEntity[];
  blocks?: CadWebBlockDefinition[];
}

function snapshot(input: SnapshotInput = {}): CadWebDocument {
  const layers = input.layers ?? [layer("1"), layer("2")];
  const entities = input.entities ?? [
    entity("10", "layer:1", [[0, 0, 0], [1, 0, 0]]),
    entity("20", "layer:2", [[0, 10, 0], [1, 10, 0]]),
  ];
  const blocks = input.blocks ?? [];
  return {
    manifest: {
      format: "cadweb",
      formatVersion: { major: 1, minor: 1 },
      producer: {
        application: "AutoCAD",
        applicationVersion: "2027",
        pluginVersion: "test",
        platform: "test",
      },
      source: {
        fileName: "factory.dwg",
        dwgVersion: "AC1038",
        drawingFingerprint: sourceFingerprint,
      },
      units: { name: "millimeters", metersPerUnit: 0.001 },
      coordinateSystem: { space: "WCS", upAxis: "Z", origin: input.origin ?? [0, 0, 0] },
      extents: { min: [0, 0, 0], max: [1, 10, 0] },
      modelEmpty: false,
      syncBinding: {
        drawingId: input.drawing ?? drawingId,
        modelEpoch: input.epoch ?? modelEpoch,
        snapshotId: `snapshot-${input.baseRevision ?? 0}`,
        baseRevision: input.baseRevision ?? 0,
      },
      files: {
        layers: { ...descriptor, encoding: "json" },
        entities: {
          ...descriptor,
          encoding: "flatbuffers",
          schemaVersion: 1,
          byteOrder: "little-endian",
        },
        exportReport: { ...descriptor, encoding: "json" },
      },
    },
    layers: { schemaVersion: 1, layers },
    exportReport: report(),
    entities: { schemaVersion: 1, kind: BufferKind.Entities, entities, blocks: [] },
    ...(blocks.length === 0 ? {} : {
      blocks: { schemaVersion: 1, kind: BufferKind.Blocks, entities: [], blocks },
    }),
    entries: new Map(),
  };
}

interface DeltaInput {
  baseRevision: number;
  entityUpserts?: CadWebEntity[];
  blockUpserts?: CadWebBlockDefinition[];
  layerUpserts?: CadWebLayer[];
  tombstones?: string[];
  drawing?: string;
  epoch?: string;
  modelEmpty?: boolean;
  resultExtents?: { min: Vec3; max: Vec3 };
}

function delta(input: DeltaInput): CadWebDeltaDocument {
  const entityUpserts = input.entityUpserts ?? [];
  const blockUpserts = input.blockUpserts ?? [];
  const layerUpserts = input.layerUpserts ?? [];
  const tombstones = input.tombstones ?? [];
  const deletes = { entities: 0, blocks: 0, layers: 0 };
  for (const key of tombstones) {
    if (key.startsWith("entity:")) deletes.entities += 1;
    if (key.startsWith("block:")) deletes.blocks += 1;
    if (key.startsWith("layer:")) deletes.layers += 1;
  }
  const files: CadWebDeltaManifest["files"] = {
    exportReport: { ...descriptor, encoding: "json" },
    ...(entityUpserts.length === 0 ? {} : {
      entities: {
        ...descriptor,
        encoding: "flatbuffers",
        schemaVersion: 1,
        byteOrder: "little-endian",
      },
    }),
    ...(blockUpserts.length === 0 ? {} : {
      blocks: {
        ...descriptor,
        encoding: "flatbuffers",
        schemaVersion: 1,
        byteOrder: "little-endian",
      },
    }),
    ...(layerUpserts.length === 0 ? {} : {
      layers: { ...descriptor, encoding: "json" },
    }),
    ...(tombstones.length === 0 ? {} : {
      tombstones: { ...descriptor, encoding: "json" },
    }),
  };
  const modelEmpty = input.modelEmpty ?? false;
  return {
    change: {
      format: "cadweb-delta",
      formatVersion: { major: 1, minor: 0 },
      changeSetId: `change-${input.baseRevision}`,
      drawingId: input.drawing ?? drawingId,
      sourceFingerprint,
      modelEpoch: input.epoch ?? modelEpoch,
      baseRevision: input.baseRevision,
      trigger: { kind: "qsave", savedAt: "2026-08-09T10:15:30Z" },
      upserts: {
        entities: entityUpserts.length,
        blocks: blockUpserts.length,
        layers: layerUpserts.length,
      },
      deletes,
      modelEmpty,
      resultExtents: input.resultExtents ?? (
        modelEmpty
          ? { min: [0, 0, 0], max: [0, 0, 0] }
          : { min: [0, 0, 0], max: [10, 10, 0] }
      ),
      files,
    },
    exportReport: report(),
    ...(entityUpserts.length === 0 ? {} : {
      entities: {
        schemaVersion: 1,
        kind: BufferKind.Entities,
        entities: entityUpserts,
        blocks: [],
      },
    }),
    ...(blockUpserts.length === 0 ? {} : {
      blocks: {
        schemaVersion: 1,
        kind: BufferKind.Blocks,
        entities: [],
        blocks: blockUpserts,
      },
    }),
    ...(layerUpserts.length === 0 ? {} : {
      layers: { schemaVersion: 1, layers: layerUpserts },
    }),
    ...(tombstones.length === 0 ? {} : {
      tombstones: { schemaVersion: 1, keys: tombstones },
    }),
    entries: new Map(),
  };
}

function file(name: string): File {
  return new File([Uint8Array.of(0)], name);
}

function session(
  deltas: Array<CadWebDeltaDocument | Error>,
  snapshots: CadWebDocument[] = [snapshot()],
): CadWebWorkerSession {
  const queue = [...deltas];
  const snapshotQueue = [...snapshots];
  const readers: CadWebWorkerReaders = {
    readSnapshot: async () => {
      const value = snapshotQueue.shift();
      if (value === undefined) throw new Error("snapshot fixture queue exhausted");
      return value;
    },
    readDelta: async () => {
      const value = queue.shift();
      if (value === undefined) throw new Error("delta fixture queue exhausted");
      if (value instanceof Error) throw value;
      return value;
    },
  };
  return new CadWebWorkerSession(readers);
}

async function loadSnapshot(worker: CadWebWorkerSession): Promise<CadWebWorkerResponse> {
  return worker.handle({ type: "loadSnapshot", requestId: 1, revision: 1, file: file("base.cadweb") });
}

function loaded(response: CadWebWorkerResponse) {
  assert.equal(response.type, "loaded");
  if (response.type !== "loaded") throw new Error("expected loaded response");
  return response.document;
}

test("MOVE upsert advances one revision and rebuilds only the affected layer chunk", async () => {
  const move = delta({
    baseRevision: 1,
    entityUpserts: [entity("10", "layer:1", [[5, 0, 0], [6, 0, 0]])],
  });
  const worker = session([move]);
  const before = loaded(await loadSnapshot(worker));
  const beforeLayer1 = before.layers.find((candidate) => candidate.id === "layer:1")!;
  const beforeLayer2 = before.layers.find((candidate) => candidate.id === "layer:2")!;

  const after = loaded(await worker.handle({ type: "applyDelta", requestId: 2, file: file("move.cadwebdelta") }));
  const afterLayer1 = after.layers.find((candidate) => candidate.id === "layer:1")!;
  const afterLayer2 = after.layers.find((candidate) => candidate.id === "layer:2")!;
  assert.equal(after.revision, 2);
  assert.notEqual(afterLayer1.lineVertices, beforeLayer1.lineVertices);
  assert.equal(afterLayer2.lineVertices, beforeLayer2.lineVertices);
  assert.equal(afterLayer1.lineVertices[0], 5);
  assert.equal(afterLayer1.lineVertices[6], 6);
});

test("layer style delta updates ByLayer while preserving Explicit and root ByBlock fallbacks", async () => {
  const baseLayer = layer("1", {
    colorArgb: 0xff_ff0000,
    transparency: 0,
    lineWeightMm: 0.5,
    linetype: "Dashed",
  });
  const byLayer = {
    ...entity("10", "layer:1", [[0, 0, 0], [1, 0, 0]]),
    colorArgb: 0xff_00ff00,
    transparency: 10,
    colorSourceMode: PropertySourceMode.ByLayer,
    transparencySourceMode: PropertySourceMode.ByLayer,
    lineWeightSourceMode: PropertySourceMode.ByLayer,
    linetypeSourceMode: PropertySourceMode.ByLayer,
  };
  const explicit = {
    ...entity("11", "layer:1", [[0, 1, 0], [1, 1, 0]]),
    colorArgb: 0xff_0000ff,
    transparency: 32,
  };
  const rootByBlock = {
    ...entity("12", "layer:1", [[0, 2, 0], [1, 2, 0]]),
    colorArgb: 0xff_ffff00,
    transparency: 64,
    colorSourceMode: PropertySourceMode.ByBlock,
    transparencySourceMode: PropertySourceMode.ByBlock,
    lineWeightSourceMode: PropertySourceMode.ByBlock,
    linetypeSourceMode: PropertySourceMode.ByBlock,
  };
  const updatedLayer = layer("1", {
    colorArgb: 0xff_00ffff,
    transparency: 127,
    lineWeightMm: 0.7,
    linetype: "Center",
  });
  const worker = session(
    [delta({ baseRevision: 1, layerUpserts: [updatedLayer] })],
    [snapshot({
      layers: [baseLayer, layer("2")],
      entities: [
        byLayer,
        explicit,
        rootByBlock,
        entity("20", "layer:2", [[0, 10, 0], [1, 10, 0]]),
      ],
    })],
  );

  const before = loaded(await loadSnapshot(worker));
  const beforeLayer1 = before.layers.find((candidate) => candidate.id === "layer:1")!;
  const beforeLayer2 = before.layers.find((candidate) => candidate.id === "layer:2")!;
  assertLineColor(beforeLayer1, 0, [1, 0, 0, 1]);

  const after = loaded(await worker.handle({
    type: "applyDelta",
    requestId: 2,
    file: file("layer-style.cadwebdelta"),
  }));
  const afterLayer1 = after.layers.find((candidate) => candidate.id === "layer:1")!;
  const afterLayer2 = after.layers.find((candidate) => candidate.id === "layer:2")!;
  assertLineColor(afterLayer1, 0, [0, 1, 1, 128 / 255]);
  assertLineColor(afterLayer1, 1, [0, 0, 1, 223 / 255]);
  assertLineColor(afterLayer1, 2, [1, 1, 0, 191 / 255]);
  assert.notEqual(afterLayer2.lineVertices, beforeLayer2.lineVertices);
});

test("nested layer 0 resolves ByLayer from the insertion layer and ByBlock from references", async () => {
  const layerZeroLine = {
    ...entity("31", "layer:0", [[0, 0, 0], [1, 0, 0]]),
    space: SpaceKind.BlockDefinition,
    colorArgb: 0xff_ff0000,
    transparency: 1,
    colorSourceMode: PropertySourceMode.ByLayer,
    transparencySourceMode: PropertySourceMode.ByLayer,
    lineWeightSourceMode: PropertySourceMode.ByLayer,
    linetypeSourceMode: PropertySourceMode.ByLayer,
  };
  const nestedReference = {
    ...blockReference("32", "layer:0", "block:B", SpaceKind.BlockDefinition),
    colorArgb: 0xff_ffff00,
    transparency: 2,
    colorSourceMode: PropertySourceMode.ByBlock,
    transparencySourceMode: PropertySourceMode.ByBlock,
    lineWeightSourceMode: PropertySourceMode.ByBlock,
    linetypeSourceMode: PropertySourceMode.ByBlock,
  };
  const nestedLine = {
    ...entity("33", "layer:0", [[0, 1, 0], [1, 1, 0]]),
    space: SpaceKind.BlockDefinition,
    colorArgb: 0xff_00ffff,
    transparency: 3,
    colorSourceMode: PropertySourceMode.ByBlock,
    transparencySourceMode: PropertySourceMode.ByBlock,
    lineWeightSourceMode: PropertySourceMode.ByBlock,
    linetypeSourceMode: PropertySourceMode.ByBlock,
  };
  const topReference = {
    ...blockReference("30", "layer:2", "block:A"),
    colorArgb: 0xff_ff00ff,
    transparency: 51,
    lineWeightMm: 0.9,
    linetype: "Phantom",
  };
  const worker = session([], [snapshot({
    layers: [
      layer("0", {
        name: "0",
        colorArgb: 0xff_0000ff,
        transparency: 100,
        lineWeightMm: 0.1,
        linetype: "Continuous",
      }),
      layer("2", {
        colorArgb: 0xff_00ff00,
        transparency: 25,
        lineWeightMm: 0.7,
        linetype: "Center",
      }),
    ],
    entities: [topReference],
    blocks: [
      definition("A", [layerZeroLine, nestedReference]),
      definition("B", [nestedLine]),
    ],
  })]);

  const document = loaded(await loadSnapshot(worker));
  const insertionLayer = document.layers.find((candidate) => candidate.id === "layer:2")!;
  const zeroLayer = document.layers.find((candidate) => candidate.id === "layer:0")!;
  assertLineColor(insertionLayer, 0, [0, 1, 0, 230 / 255]);
  assertLineColor(insertionLayer, 1, [1, 0, 1, 204 / 255]);
  assert.equal(zeroLayer.lineVertices.length, 0);
  assert.deepEqual(document.warnings, []);
});

test("entity tombstone removes its layer geometry without reloading the snapshot", async () => {
  const worker = session([delta({
    baseRevision: 1,
    tombstones: ["entity:10"],
    resultExtents: { min: [0, 10, 0], max: [1, 10, 0] },
  })]);
  loaded(await loadSnapshot(worker));
  const after = loaded(await worker.handle({ type: "applyDelta", requestId: 2, file: file("erase.cadwebdelta") }));
  assert.equal(after.revision, 2);
  assert.equal(after.entityCount, 1);
  assert.equal(after.layers.find((candidate) => candidate.id === "layer:1")?.lineVertices.length, 0);
});

test("duplicate and out-of-order deltas request reset without rolling state back", async () => {
  const first = delta({
    baseRevision: 1,
    entityUpserts: [entity("10", "layer:1", [[2, 0, 0], [3, 0, 0]])],
  });
  const next = delta({
    baseRevision: 2,
    entityUpserts: [entity("10", "layer:1", [[4, 0, 0], [5, 0, 0]])],
  });
  const worker = session([first, first, next]);
  loaded(await loadSnapshot(worker));
  loaded(await worker.handle({ type: "applyDelta", requestId: 2, file: file("first.cadwebdelta") }));
  const duplicate = await worker.handle({ type: "applyDelta", requestId: 3, file: file("duplicate.cadwebdelta") });
  assert.equal(duplicate.type, "reset-needed");
  if (duplicate.type === "reset-needed") assert.equal(duplicate.currentRevision, 2);
  const recovered = loaded(await worker.handle({ type: "applyDelta", requestId: 4, file: file("next.cadwebdelta") }));
  assert.equal(recovered.revision, 3);
});

test("failed staged apply is atomic and a valid delta with the same base still succeeds", async () => {
  const invalid = delta({ baseRevision: 1, tombstones: ["layer:1"] });
  const valid = delta({
    baseRevision: 1,
    entityUpserts: [entity("10", "layer:1", [[7, 0, 0], [8, 0, 0]])],
  });
  const worker = session([invalid, valid]);
  loaded(await loadSnapshot(worker));
  const failed = await worker.handle({ type: "applyDelta", requestId: 2, file: file("invalid.cadwebdelta") });
  assert.equal(failed.type, "reset-needed");
  assert.equal(worker.currentRevision, 1);
  const after = loaded(await worker.handle({ type: "applyDelta", requestId: 3, file: file("valid.cadwebdelta") }));
  assert.equal(after.revision, 2);
  assert.equal(after.layers[0]?.lineVertices[0], 7);
});

test("gap, model epoch and drawing mismatch each emit snapshot fallback", async () => {
  const cases = [
    delta({ baseRevision: 3, entityUpserts: [entity("10", "layer:1", [[1, 0, 0], [2, 0, 0]])] }),
    delta({ baseRevision: 1, epoch: "epoch-2", entityUpserts: [entity("10", "layer:1", [[1, 0, 0], [2, 0, 0]])] }),
    delta({ baseRevision: 1, drawing: "drawing-2", entityUpserts: [entity("10", "layer:1", [[1, 0, 0], [2, 0, 0]])] }),
  ];
  for (const [index, change] of cases.entries()) {
    const worker = session([change]);
    loaded(await loadSnapshot(worker));
    const response = await worker.handle({
      type: "applyDelta",
      requestId: index + 2,
      file: file(`mismatch-${index}.cadwebdelta`),
    });
    assert.equal(response.type, "reset-needed");
    if (response.type === "reset-needed") assert.equal(response.code, "REVISION_MISMATCH");
    assert.equal(worker.currentRevision, 1);
  }
});

test("reset clears canonical state and applyDelta signals that a snapshot is required", async () => {
  const worker = session([]);
  loaded(await loadSnapshot(worker));
  const reset = await worker.handle({ type: "reset", requestId: 2 });
  assert.equal(reset.type, "reset");
  assert.equal(worker.currentRevision, undefined);
  const response = await worker.handle({ type: "applyDelta", requestId: 3, file: file("orphan.cadwebdelta") });
  assert.equal(response.type, "reset-needed");
});

test("canonical block indexes track nested dependencies for transitive invalidation", () => {
  const nestedReference = blockReference(
    "32",
    "layer:1",
    "block:B",
    SpaceKind.BlockDefinition,
  );
  const blockA: CadWebBlockDefinition = {
    id: "block:A",
    sourceHandle: "A",
    name: "A",
    entities: [nestedReference],
  };
  const blockB: CadWebBlockDefinition = {
    id: "block:B",
    sourceHandle: "B",
    name: "B",
    entities: [
      { ...entity("31", "layer:1", [[0, 0, 0], [1, 0, 0]]), space: SpaceKind.BlockDefinition },
    ],
  };
  const state = revisionStateFromSnapshot(snapshot({
    entities: [blockReference("30", "layer:2", "block:A")],
    blocks: [blockA, blockB],
  }), 1);

  assert.deepEqual([...state.blockReferencesByDefinitionId.get("block:A") ?? []], ["entity:30"]);
  assert.deepEqual([...state.blockReferencesByDefinitionId.get("block:B") ?? []], ["entity:32"]);
  assert.deepEqual([...state.blockDefinitionDependencies.get("block:A") ?? []], ["block:B"]);

  const updatedBlockB: CadWebBlockDefinition = {
    ...blockB,
    entities: [
      { ...entity("31", "layer:1", [[5, 0, 0], [6, 0, 0]]), space: SpaceKind.BlockDefinition },
    ],
  };
  const staged = stageCadWebDelta(state, delta({
    baseRevision: 1,
    blockUpserts: [updatedBlockB],
  }));
  assert.equal(staged.invalidation.rebuildAllLayers, true);
  assert.deepEqual([...staged.state.blockReferencesByDefinitionId.get("block:A") ?? []], ["entity:30"]);
  assert.deepEqual([...staged.state.blockDefinitionDependencies.get("block:A") ?? []], ["block:B"]);
});

test("block-cycle delta is rejected atomically and the same base accepts a valid update", async () => {
  const blockA = definition("A", [
    blockReference("32", "layer:1", "block:B", SpaceKind.BlockDefinition),
  ]);
  const blockB = definition("B", [
    {
      ...entity("33", "layer:1", [[0, 0, 0], [1, 0, 0]]),
      space: SpaceKind.BlockDefinition,
    },
  ]);
  const cyclicBlockB = definition("B", [
    blockReference("33", "layer:1", "block:A", SpaceKind.BlockDefinition),
  ]);
  const updatedBlockB = definition("B", [
    {
      ...entity("33", "layer:1", [[7, 0, 0], [8, 0, 0]]),
      space: SpaceKind.BlockDefinition,
    },
  ]);
  const worker = session(
    [
      delta({ baseRevision: 1, blockUpserts: [cyclicBlockB] }),
      delta({ baseRevision: 1, blockUpserts: [updatedBlockB] }),
    ],
    [snapshot({
      entities: [blockReference("30", "layer:2", "block:A")],
      blocks: [blockA, blockB],
    })],
  );
  loaded(await loadSnapshot(worker));

  const rejected = await worker.handle({
    type: "applyDelta",
    requestId: 2,
    file: file("block-cycle.cadwebdelta"),
  });
  assert.equal(rejected.type, "reset-needed");
  if (rejected.type === "reset-needed") {
    assert.equal(rejected.code, "GEOMETRY_INVALID");
    assert.match(rejected.message, /block reference cycle/);
  }
  assert.equal(worker.currentRevision, 1);

  const after = loaded(await worker.handle({
    type: "applyDelta",
    requestId: 3,
    file: file("valid-block-update.cadwebdelta"),
  }));
  assert.equal(after.revision, 2);
  assert.equal(after.layers.find((candidate) => candidate.id === "layer:1")?.lineVertices[0], 7);
});

test("nested A to B definition update rebuilds rendered geometry within traversal budgets", async () => {
  const blockA = definition("A", [
    blockReference("32", "layer:1", "block:B", SpaceKind.BlockDefinition),
  ]);
  const blockB = definition("B", [
    {
      ...entity("33", "layer:1", [[0, 0, 0], [1, 0, 0]]),
      space: SpaceKind.BlockDefinition,
    },
  ]);
  const updatedBlockB = definition("B", [
    {
      ...entity("33", "layer:1", [[5, 0, 0], [6, 0, 0]]),
      space: SpaceKind.BlockDefinition,
    },
  ]);
  const worker = session(
    [delta({ baseRevision: 1, blockUpserts: [updatedBlockB] })],
    [snapshot({
      entities: [blockReference("30", "layer:2", "block:A")],
      blocks: [blockA, blockB],
    })],
  );

  const before = loaded(await loadSnapshot(worker));
  const beforeLayer = before.layers.find((candidate) => candidate.id === "layer:1")!;
  assert.equal(beforeLayer.lineVertices[0], 0);
  assert.equal(beforeLayer.lineVertices[6], 1);

  const after = loaded(await worker.handle({
    type: "applyDelta",
    requestId: 2,
    file: file("nested-definition-update.cadwebdelta"),
  }));
  const afterLayer = after.layers.find((candidate) => candidate.id === "layer:1")!;
  assert.equal(after.revision, 2);
  assert.notEqual(afterLayer.lineVertices, beforeLayer.lineVertices);
  assert.equal(afterLayer.lineVertices[0], 5);
  assert.equal(afterLayer.lineVertices[6], 6);
  assert.equal(after.renderedEntityCount, 1);
  assert.deepEqual(after.warnings, []);
});

test("worker serializes overlapping delta reads before committing revisions", async () => {
  const first = delta({
    baseRevision: 1,
    entityUpserts: [entity("10", "layer:1", [[2, 0, 0], [3, 0, 0]])],
  });
  const second = delta({
    baseRevision: 2,
    entityUpserts: [entity("10", "layer:1", [[4, 0, 0], [5, 0, 0]])],
  });
  let releaseFirst!: () => void;
  const firstGate = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  let deltaReadCount = 0;
  const worker = new CadWebWorkerSession({
    readSnapshot: async () => snapshot(),
    readDelta: async () => {
      const index = deltaReadCount;
      deltaReadCount += 1;
      if (index === 0) await firstGate;
      return [first, second][index]!;
    },
  });
  loaded(await loadSnapshot(worker));

  const firstResponse = worker.handle({
    type: "applyDelta",
    requestId: 2,
    file: file("first.cadwebdelta"),
  });
  const secondResponse = worker.handle({
    type: "applyDelta",
    requestId: 3,
    file: file("second.cadwebdelta"),
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  assert.equal(deltaReadCount, 1);
  releaseFirst();

  assert.equal(loaded(await firstResponse).revision, 2);
  assert.equal(loaded(await secondResponse).revision, 3);
  assert.equal(worker.currentRevision, 3);
});

test("resetToSnapshot recovers a gap atomically and refuses stale or drifting baselines", async () => {
  const recoveredEntities = [
    entity("10", "layer:1", [[8, 0, 0], [9, 0, 0]]),
    entity("20", "layer:2", [[0, 10, 0], [1, 10, 0]]),
  ];
  const worker = session(
    [delta({ baseRevision: 3, entityUpserts: recoveredEntities.slice(0, 1) })],
    [
      snapshot(),
      snapshot({ baseRevision: 2, entities: recoveredEntities }),
      snapshot(),
      snapshot({ baseRevision: 3, origin: [1, 0, 0], entities: recoveredEntities }),
      snapshot({
        baseRevision: 3,
        epoch: "epoch-2",
        origin: [1, 0, 0],
        entities: recoveredEntities,
      }),
    ],
  );
  loaded(await loadSnapshot(worker));
  const gap = await worker.handle({
    type: "applyDelta",
    requestId: 2,
    file: file("gap.cadwebdelta"),
  });
  assert.equal(gap.type, "reset-needed");

  const recovered = loaded(await worker.handle({
    type: "resetToSnapshot",
    requestId: 3,
    revision: 3,
    file: file("recovery.cadweb"),
  }));
  assert.equal(recovered.revision, 3);
  assert.equal(recovered.layers[0]?.lineVertices[0], 8);

  const stale = await worker.handle({
    type: "resetToSnapshot",
    requestId: 4,
    revision: 1,
    file: file("stale.cadweb"),
  });
  assert.equal(stale.type, "reset-needed");
  assert.equal(worker.currentRevision, 3);

  const driftingOrigin = await worker.handle({
    type: "resetToSnapshot",
    requestId: 5,
    revision: 4,
    file: file("drifting-origin.cadweb"),
  });
  assert.equal(driftingOrigin.type, "reset-needed");
  assert.equal(worker.currentRevision, 3);

  const epochTransition = loaded(await worker.handle({
    type: "resetToSnapshot",
    requestId: 6,
    revision: 4,
    file: file("new-epoch.cadweb"),
  }));
  assert.equal(epochTransition.revision, 4);
  assert.equal(epochTransition.modelEpoch, "epoch-2");
  assert.deepEqual(epochTransition.origin, [1, 0, 0]);
});

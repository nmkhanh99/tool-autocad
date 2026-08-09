import assert from "node:assert/strict";
import test from "node:test";

import { unzipSync, zipSync, type Zippable } from "fflate";

import {
  BufferKind,
  CadWebError,
  EntityKind,
  PropertySourceMode,
  SpaceKind,
  applyCadWebDelta,
  buildGeometryBuffer,
  canonicalObjectKey,
  normalizeSourceHandle,
  readCadWebDelta,
  sha256Hex,
  type CadWebBlockDefinition,
  type CadWebDeltaManifest,
  type CadWebEntity,
  type CadWebExportReport,
  type CadWebFileDescriptor,
  type CadWebLayer,
  type CadWebRevisionState,
  type Vec3,
} from "../src/index";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const fixedZipDate = new Date(1980, 0, 1, 0, 0, 0);
const drawingId = "00000000-0000-4000-8000-000000000001";
const sourceFingerprint = "00000000-0000-4000-8000-000000000002";
const modelEpoch = "01HZZZZZZZZZZZZZZZZZZZZZZZ";

function hasCode(code: CadWebError["code"]): (error: unknown) => boolean {
  return (error) => error instanceof CadWebError && error.code === code;
}

function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

function pack(entries: Record<string, Uint8Array>): Uint8Array {
  const input: Zippable = {};
  for (const path of Object.keys(entries).sort()) {
    input[path] = [entries[path]!, { level: 0, mtime: fixedZipDate }];
  }
  return zipSync(input, { level: 0 });
}

function entity(handle: string, points: Vec3[] = [[0, 0, 0], [1, 0, 0]]): CadWebEntity {
  return {
    id: `entity:${handle}`,
    sourceHandle: handle,
    kind: EntityKind.Line,
    layerId: "layer:1",
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

function layer(handle = "1"): CadWebLayer {
  return {
    id: `layer:${handle}`,
    sourceHandle: handle,
    name: "0",
    visible: true,
    frozen: false,
    locked: false,
    plot: true,
    colorArgb: 0xff_ffffff,
  };
}

interface DeltaFixtureInput {
  baseRevision?: number;
  entities?: CadWebEntity[];
  blocks?: CadWebBlockDefinition[];
  layers?: CadWebLayer[];
  tombstones?: string[];
  modelEmpty?: boolean;
  resultExtents?: { min: Vec3; max: Vec3 };
}

async function descriptor(
  path: string,
  encoding: "json" | "flatbuffers",
  bytes: Uint8Array,
): Promise<CadWebFileDescriptor> {
  return {
    path,
    encoding,
    ...(encoding === "flatbuffers"
      ? { schemaVersion: 1, byteOrder: "little-endian" as const }
      : {}),
    size: bytes.byteLength,
    sha256: await sha256Hex(bytes),
  };
}

async function createDelta(input: DeltaFixtureInput): Promise<Uint8Array> {
  const entities = input.entities ?? [];
  const blocks = input.blocks ?? [];
  const layers = input.layers ?? [];
  const tombstones = input.tombstones ?? [];
  const entries: Record<string, Uint8Array> = {};
  const files: CadWebDeltaManifest["files"] = {
    exportReport: undefined as never,
  };

  if (entities.length > 0) {
    const bytes = buildGeometryBuffer({
      schemaVersion: 1,
      kind: BufferKind.Entities,
      entities,
      blocks: [],
    });
    entries["entities.bin"] = bytes;
    files.entities = await descriptor("entities.bin", "flatbuffers", bytes) as typeof files.entities;
  }
  if (blocks.length > 0) {
    const bytes = buildGeometryBuffer({
      schemaVersion: 1,
      kind: BufferKind.Blocks,
      entities: [],
      blocks,
    });
    entries["blocks.bin"] = bytes;
    files.blocks = await descriptor("blocks.bin", "flatbuffers", bytes) as typeof files.blocks;
  }
  if (layers.length > 0) {
    const bytes = jsonBytes({ schemaVersion: 1, layers });
    entries["layers.json"] = bytes;
    files.layers = await descriptor("layers.json", "json", bytes) as typeof files.layers;
  }
  if (tombstones.length > 0) {
    const bytes = jsonBytes({ schemaVersion: 1, keys: tombstones });
    entries["tombstones.json"] = bytes;
    files.tombstones = await descriptor("tombstones.json", "json", bytes) as typeof files.tombstones;
  }

  const report: CadWebExportReport = {
    schemaVersion: 1,
    status: "complete",
    counts: {
      exported: entities.length + blocks.length + layers.length,
      skipped: 0,
      warnings: 0,
      errors: 0,
    },
    issues: [],
  };
  const reportBytes = jsonBytes(report);
  entries["export-report.json"] = reportBytes;
  files.exportReport = await descriptor(
    "export-report.json",
    "json",
    reportBytes,
  ) as typeof files.exportReport;

  const deletes = { entities: 0, blocks: 0, layers: 0 };
  for (const key of tombstones) {
    if (key.startsWith("entity:")) deletes.entities += 1;
    if (key.startsWith("block:")) deletes.blocks += 1;
    if (key.startsWith("layer:")) deletes.layers += 1;
  }
  const modelEmptyValue = input.modelEmpty ?? entities.length === 0;
  const change: CadWebDeltaManifest = {
    format: "cadweb-delta",
    formatVersion: { major: 1, minor: 0 },
    changeSetId: `change-${input.baseRevision ?? 1}`,
    drawingId,
    sourceFingerprint,
    modelEpoch,
    baseRevision: input.baseRevision ?? 1,
    trigger: { kind: "qsave", savedAt: "2026-08-09T10:15:30Z" },
    upserts: { entities: entities.length, blocks: blocks.length, layers: layers.length },
    deletes,
    modelEmpty: modelEmptyValue,
    resultExtents: input.resultExtents ?? (
      modelEmptyValue
        ? { min: [0, 0, 0], max: [0, 0, 0] }
        : { min: [0, 0, 0], max: [1, 0, 0] }
    ),
    files,
  };
  entries["change.json"] = jsonBytes(change);
  return pack(entries);
}

function rewriteChange(
  archive: Uint8Array,
  update: (change: CadWebDeltaManifest) => void,
): Uint8Array {
  const entries: Record<string, Uint8Array> = { ...unzipSync(archive) };
  const change = JSON.parse(decoder.decode(entries["change.json"])) as CadWebDeltaManifest;
  update(change);
  entries["change.json"] = jsonBytes(change);
  return pack(entries);
}

function revisionState(
  revision: number,
  entities: CadWebEntity[] = [],
): CadWebRevisionState {
  return {
    drawingId,
    sourceFingerprint,
    modelEpoch,
    revision,
    modelEmpty: entities.length === 0,
    resultExtents: entities.length === 0
      ? { min: [0, 0, 0], max: [0, 0, 0] }
      : { min: [0, 0, 0], max: [1, 0, 0] },
    entities: new Map(entities.map((value) => [value.id, value])),
    blocks: new Map(),
    layers: new Map([["layer:1", layer()]]),
  };
}

test("reads a delta package with canonical entity upserts", async () => {
  const delta = await readCadWebDelta(await createDelta({ entities: [entity("10")] }));
  assert.equal(delta.change.format, "cadweb-delta");
  assert.equal(delta.change.baseRevision, 1);
  assert.equal("revision" in delta.change, false);
  assert.equal(delta.entities?.entities[0]?.id, "entity:10");
  assert.equal(delta.exportReport.status, "complete");
});

test("rejects duplicate keys and an upsert/tombstone conflict", async () => {
  const duplicateUpsert = await createDelta({ entities: [entity("10"), entity("10")] });
  await assert.rejects(readCadWebDelta(duplicateUpsert), hasCode("DELTA_INVALID"));

  const duplicateTombstone = await createDelta({
    tombstones: ["entity:10", "entity:10"],
    modelEmpty: true,
  });
  await assert.rejects(readCadWebDelta(duplicateTombstone), hasCode("DELTA_INVALID"));

  const conflict = await createDelta({
    entities: [entity("10")],
    tombstones: ["entity:10"],
    modelEmpty: false,
  });
  await assert.rejects(readCadWebDelta(conflict), hasCode("DELTA_INVALID"));

  const blockChild = entity("20");
  blockChild.space = SpaceKind.BlockDefinition;
  const containedConflict = await createDelta({
    blocks: [{
      id: "block:B",
      sourceHandle: "B",
      name: "BLOCK",
      basePoint: [0, 0, 0],
      entities: [blockChild],
    }],
    tombstones: ["entity:20"],
    modelEmpty: true,
  });
  await assert.rejects(readCadWebDelta(containedConflict), hasCode("DELTA_INVALID"));
});

test("rejects non-canonical handles and aggregate attribute ids", async () => {
  assert.equal(normalizeSourceHandle("0x00af"), "AF");
  assert.equal(canonicalObjectKey("entity", "0X00af"), "entity:AF");
  assert.throws(() => normalizeSourceHandle("000"), hasCode("DELTA_INVALID"));

  for (const invalid of [entity("0A"), entity("a")]) {
    await assert.rejects(
      readCadWebDelta(await createDelta({ entities: [invalid] })),
      hasCode("DELTA_INVALID"),
    );
  }

  const invalidAttribute = entity("10");
  invalidAttribute.attributes = [{ id: "attribute:11", tag: "TAG" }];
  await assert.rejects(
    readCadWebDelta(await createDelta({ entities: [invalidAttribute] })),
    hasCode("DELTA_INVALID"),
  );
});

test("rejects count, descriptor and payload mismatches", async () => {
  const valid = await createDelta({ entities: [entity("10")] });
  const wrongPayloadCount = rewriteChange(valid, (change) => {
    change.upserts.entities = 2;
  });
  await assert.rejects(readCadWebDelta(wrongPayloadCount), hasCode("DELTA_INVALID"));

  const missingDescriptor = rewriteChange(valid, (change) => {
    delete change.files.entities;
  });
  await assert.rejects(readCadWebDelta(missingDescriptor), hasCode("DELTA_INVALID"));

  const zeroCountWithDescriptor = rewriteChange(valid, (change) => {
    change.upserts.entities = 0;
  });
  await assert.rejects(readCadWebDelta(zeroCountWithDescriptor), hasCode("DELTA_INVALID"));

  const empty = await createDelta({ modelEmpty: true });
  await assert.rejects(readCadWebDelta(empty), hasCode("DELTA_INVALID"));

  const clientRevision = rewriteChange(valid, (change) => {
    change.revision = 2;
  });
  await assert.rejects(readCadWebDelta(clientRevision), hasCode("DELTA_INVALID"));
});

test("allows block definition upserts while the top-level model is empty", async () => {
  const block: CadWebBlockDefinition = {
    id: "block:B",
    sourceHandle: "B",
    name: "EMPTY_DEFINITION",
    basePoint: [0, 0, 0],
    entities: [],
  };
  const delta = await readCadWebDelta(await createDelta({ blocks: [block], modelEmpty: true }));
  const next = applyCadWebDelta(revisionState(1), delta);
  assert.equal(next.modelEmpty, true);
  assert.equal(next.blocks.get("block:B")?.name, "EMPTY_DEFINITION");
});

test("reducer applies append then erase atomically", async () => {
  const initial = revisionState(1);
  const appended = applyCadWebDelta(
    initial,
    await readCadWebDelta(await createDelta({ entities: [entity("10")] })),
  );
  assert.equal(appended.revision, 2);
  assert.equal(appended.entities.has("entity:10"), true);
  assert.equal(initial.entities.size, 0);

  const erased = applyCadWebDelta(
    appended,
    await readCadWebDelta(await createDelta({
      baseRevision: 2,
      tombstones: ["entity:10"],
      modelEmpty: true,
    })),
  );
  assert.equal(erased.revision, 3);
  assert.equal(erased.entities.size, 0);
  assert.equal(erased.modelEmpty, true);
  assert.deepEqual(erased.resultExtents, { min: [0, 0, 0], max: [0, 0, 0] });
});

test("reducer applies modify then erase", async () => {
  const original = entity("10");
  const initial = revisionState(1, [original]);
  const modifiedEntity = entity("10", [[2, 0, 0], [3, 0, 0]]);
  const modified = applyCadWebDelta(
    initial,
    await readCadWebDelta(await createDelta({ entities: [modifiedEntity] })),
  );
  assert.deepEqual(modified.entities.get("entity:10")?.points, modifiedEntity.points);
  assert.deepEqual(initial.entities.get("entity:10")?.points, original.points);

  const erased = applyCadWebDelta(
    modified,
    await readCadWebDelta(await createDelta({
      baseRevision: 2,
      tombstones: ["entity:10"],
      modelEmpty: true,
    })),
  );
  assert.equal(erased.entities.has("entity:10"), false);
});

test("reducer returns to the original semantic state after revert and unerase", async () => {
  const original = entity("10");
  const initial = revisionState(1, [original]);
  const modified = applyCadWebDelta(
    initial,
    await readCadWebDelta(await createDelta({
      entities: [entity("10", [[5, 0, 0], [6, 0, 0]])],
    })),
  );
  const reverted = applyCadWebDelta(
    modified,
    await readCadWebDelta(await createDelta({ baseRevision: 2, entities: [original] })),
  );
  assert.deepEqual(reverted.entities.get("entity:10"), original);

  const erased = applyCadWebDelta(
    initial,
    await readCadWebDelta(await createDelta({
      tombstones: ["entity:10"],
      modelEmpty: true,
    })),
  );
  const unerased = applyCadWebDelta(
    erased,
    await readCadWebDelta(await createDelta({ baseRevision: 2, entities: [original] })),
  );
  assert.deepEqual(unerased.entities.get("entity:10"), original);
});

test("reducer rejects base revision and model epoch mismatches", async () => {
  const current = revisionState(2, [entity("10")]);
  const stale = await readCadWebDelta(await createDelta({ entities: [entity("10")] }));
  assert.throws(() => applyCadWebDelta(current, stale), hasCode("REVISION_MISMATCH"));

  const wrongEpochArchive = rewriteChange(
    await createDelta({ baseRevision: 2, entities: [entity("10")] }),
    (change) => {
      change.modelEpoch = "different-epoch";
    },
  );
  const wrongEpoch = await readCadWebDelta(wrongEpochArchive);
  assert.throws(() => applyCadWebDelta(current, wrongEpoch), hasCode("REVISION_MISMATCH"));
});

test("modelEmpty requires canonical zero extents and the resulting model to be empty", async () => {
  const invalidExtents = await createDelta({
    tombstones: ["entity:10"],
    modelEmpty: true,
    resultExtents: { min: [0, 0, 0], max: [1, 0, 0] },
  });
  await assert.rejects(readCadWebDelta(invalidExtents), hasCode("DELTA_INVALID"));

  const lyingDelta = await readCadWebDelta(await createDelta({
    tombstones: ["entity:20"],
    modelEmpty: true,
  }));
  assert.throws(
    () => applyCadWebDelta(revisionState(1, [entity("10")]), lyingDelta),
    hasCode("DELTA_INVALID"),
  );
});

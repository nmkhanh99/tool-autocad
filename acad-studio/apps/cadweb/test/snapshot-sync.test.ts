import assert from "node:assert/strict";
import test from "node:test";

import { unzipSync, zipSync, type Zippable } from "fflate";

import {
  BufferKind,
  CadWebError,
  buildGeometryBuffer,
  createDeterministicFixture,
  normalizeSourceHandle,
  readCadWeb,
  sha256Hex,
  type CadWebEntity,
  type CadWebFileDescriptor,
  type CadWebManifest,
} from "../src/index";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const fixedZipDate = new Date(1980, 0, 1, 0, 0, 0);

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

async function createSyncSnapshot(): Promise<Uint8Array> {
  const legacy = await readCadWeb(await createDeterministicFixture());
  const layerIds = new Map<string, string>();
  const layers = legacy.layers.layers.map((layer, index) => {
    const sourceHandle = String(index + 1);
    const id = `layer:${sourceHandle}`;
    layerIds.set(layer.id, id);
    return { ...layer, id, sourceHandle };
  });
  const blockIds = new Map(
    (legacy.blocks?.blocks ?? []).map((block) => [
      block.id,
      `block:${normalizeSourceHandle(block.sourceHandle ?? "")}`,
    ]),
  );
  const canonicalEntity = (entity: CadWebEntity): CadWebEntity => ({
    ...entity,
    id: `entity:${normalizeSourceHandle(entity.sourceHandle ?? "")}`,
    layerId: layerIds.get(entity.layerId) ?? entity.layerId,
    ...(entity.blockDefinitionId === undefined
      ? {}
      : { blockDefinitionId: blockIds.get(entity.blockDefinitionId) ?? entity.blockDefinitionId }),
    attributes: entity.attributes.map((attribute) => ({
      ...attribute,
      id: `entity:${normalizeSourceHandle(attribute.id.split(":").at(-1) ?? "")}`,
    })),
  });
  const entities = legacy.entities.entities.map(canonicalEntity);
  const blocks = (legacy.blocks?.blocks ?? []).map((block) => ({
    ...block,
    id: blockIds.get(block.id)!,
    entities: block.entities.map(canonicalEntity),
  }));

  const entries: Record<string, Uint8Array> = {
    "layers.json": jsonBytes({ schemaVersion: 1, layers }),
    "entities.bin": buildGeometryBuffer({
      schemaVersion: 1,
      kind: BufferKind.Entities,
      entities,
      blocks: [],
    }),
    "blocks.bin": buildGeometryBuffer({
      schemaVersion: 1,
      kind: BufferKind.Blocks,
      entities: [],
      blocks,
    }),
    "export-report.json": jsonBytes(legacy.exportReport),
  };
  const files: CadWebManifest["files"] = {
    layers: await descriptor("layers.json", "json", entries["layers.json"]!) as CadWebManifest["files"]["layers"],
    entities: await descriptor("entities.bin", "flatbuffers", entries["entities.bin"]!) as CadWebManifest["files"]["entities"],
    blocks: await descriptor("blocks.bin", "flatbuffers", entries["blocks.bin"]!) as CadWebManifest["files"]["blocks"],
    exportReport: await descriptor("export-report.json", "json", entries["export-report.json"]!) as CadWebManifest["files"]["exportReport"],
  };
  const manifest: CadWebManifest = {
    ...legacy.manifest,
    formatVersion: { major: 1, minor: 1 },
    modelEmpty: false,
    syncBinding: {
      drawingId: "00000000-0000-4000-8000-000000000001",
      modelEpoch: "01HZZZZZZZZZZZZZZZZZZZZZZZ",
      snapshotId: "01HYYYYYYYYYYYYYYYYYYYYYYY",
      baseRevision: 0,
    },
    files,
  };
  entries["manifest.json"] = jsonBytes(manifest);
  return pack(entries);
}

function rewriteManifest(
  archive: Uint8Array,
  update: (manifest: CadWebManifest) => void,
): Uint8Array {
  const entries: Record<string, Uint8Array> = { ...unzipSync(archive) };
  const manifest = JSON.parse(decoder.decode(entries["manifest.json"])) as CadWebManifest;
  update(manifest);
  entries["manifest.json"] = jsonBytes(manifest);
  return pack(entries);
}

test("reads a revision-bound CADWeb 1.1 snapshot with canonical object ids", async () => {
  const snapshot = await readCadWeb(await createSyncSnapshot());
  assert.equal(snapshot.manifest.formatVersion.minor, 1);
  assert.equal(snapshot.manifest.syncBinding?.baseRevision, 0);
  assert.equal(snapshot.manifest.modelEmpty, false);
  assert.equal(snapshot.layers.layers[0]?.id, "layer:1");
  assert.equal(snapshot.layers.layers[0]?.sourceHandle, "1");
  assert.equal(snapshot.entities.entities[0]?.id, "entity:10");
  assert.equal(snapshot.blocks?.blocks[0]?.id, "block:1F");
});

test("rejects legacy ids, conflicting bindings and false empty metadata", async () => {
  const legacyWithBinding = rewriteManifest(
    await createDeterministicFixture(),
    (manifest) => {
      manifest.formatVersion.minor = 1;
      manifest.modelEmpty = false;
      manifest.syncBinding = {
        drawingId: "drawing",
        modelEpoch: "epoch",
        snapshotId: "snapshot",
        baseRevision: 0,
      };
    },
  );
  await assert.rejects(readCadWeb(legacyWithBinding), hasCode("GEOMETRY_INVALID"));

  const valid = await createSyncSnapshot();
  const bothBindings = rewriteManifest(valid, (manifest) => {
    manifest.checkpointBinding = {
      drawingId: "drawing",
      modelEpoch: "epoch",
      checkpointId: "checkpoint",
      revision: 1,
      stateHash: "0".repeat(64),
    };
  });
  await assert.rejects(readCadWeb(bothBindings), hasCode("MANIFEST_INVALID"));

  const lyingEmpty = rewriteManifest(valid, (manifest) => {
    manifest.modelEmpty = true;
    manifest.extents = { min: [0, 0, 0], max: [0, 0, 0] };
  });
  await assert.rejects(readCadWeb(lyingEmpty), hasCode("GEOMETRY_INVALID"));
});

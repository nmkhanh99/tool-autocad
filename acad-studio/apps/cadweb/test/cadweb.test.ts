import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { unzipSync, zipSync, type Zippable } from "fflate";
import { Builder } from "flatbuffers";

import {
  BufferKind,
  CadWebError,
  EntityKind,
  PropertySourceMode,
  SpaceKind,
  buildGeometryBuffer,
  createDeterministicFixture,
  inspectCadWebZip,
  parseGeometryBuffer,
  readCadWeb,
  sha256Hex,
  type CadWebManifest,
} from "../src/index";
import {
  GeometryBuffer,
  GeometryBufferT,
} from "../src/generated/cad-web/v1";
import generatedManifestSchema from "../src/generated/manifest.schema.json";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const fixedZipDate = new Date(1980, 0, 1, 0, 0, 0);

function hasCode(code: CadWebError["code"]): (error: unknown) => boolean {
  return (error) => error instanceof CadWebError && error.code === code;
}

function pack(entries: Record<string, Uint8Array>): Uint8Array {
  const input: Zippable = {};
  for (const path of Object.keys(entries).sort()) {
    input[path] = [entries[path]!, { level: 0, mtime: fixedZipDate }];
  }
  return zipSync(input, { level: 0 });
}

function unpack(archive: Uint8Array): Record<string, Uint8Array> {
  return { ...unzipSync(archive) };
}

function readManifest(entries: Record<string, Uint8Array>): CadWebManifest {
  return JSON.parse(decoder.decode(entries["manifest.json"])) as CadWebManifest;
}

function writeManifest(entries: Record<string, Uint8Array>, manifest: CadWebManifest): void {
  entries["manifest.json"] = encoder.encode(`${JSON.stringify(manifest, null, 2)}\n`);
}

async function replacePayload(
  archive: Uint8Array,
  role: "layers" | "entities" | "blocks" | "exportReport",
  bytes: Uint8Array,
): Promise<Uint8Array> {
  const entries = unpack(archive);
  const manifest = readManifest(entries);
  const descriptor = manifest.files[role];
  assert.ok(descriptor);
  entries[descriptor.path] = bytes;
  descriptor.size = bytes.byteLength;
  descriptor.sha256 = await sha256Hex(bytes);
  writeManifest(entries, manifest);
  return pack(entries);
}

function rewriteManifest(
  archive: Uint8Array,
  update: (manifest: CadWebManifest) => void,
): Uint8Array {
  const entries = unpack(archive);
  const manifest = readManifest(entries);
  update(manifest);
  writeManifest(entries, manifest);
  return pack(entries);
}

function rewriteManifestText(
  archive: Uint8Array,
  search: string,
  replacement: string,
): Uint8Array {
  const entries = unpack(archive);
  const source = decoder.decode(entries["manifest.json"]);
  const rewritten = source.replace(search, replacement);
  assert.notEqual(rewritten, source, `manifest fixture must contain ${JSON.stringify(search)}`);
  entries["manifest.json"] = encoder.encode(rewritten);
  return pack(entries);
}

function tableFieldPosition(bytes: Uint8Array, table: number, field: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const vtable = table - view.getInt32(table, true);
  const entry = 4 + field * 2;
  assert.ok(entry < view.getUint16(vtable, true));
  const relative = view.getUint16(vtable + entry, true);
  assert.ok(relative > 0);
  return table + relative;
}

function uoffsetTarget(bytes: Uint8Array, position: number): number {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return position + view.getUint32(position, true);
}

function mutateBytes(bytes: Uint8Array, update: (view: DataView, copy: Uint8Array) => void): Uint8Array {
  const copy = Uint8Array.from(bytes);
  update(new DataView(copy.buffer, copy.byteOffset, copy.byteLength), copy);
  return copy;
}

function forwardCompatibleGeometryBuffer(): Uint8Array {
  const bytes = new Uint8Array(68);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 24, true);
  bytes.set(encoder.encode("CWEB"), 4);

  view.setUint16(8, 14, true);
  view.setUint16(10, 40, true);
  view.setUint16(12, 4, true);
  view.setUint16(14, 8, true);
  view.setUint16(16, 12, true);
  view.setUint16(18, 0, true);
  view.setUint16(20, 36, true);

  view.setInt32(24, 16, true);
  view.setUint32(28, 1, true);
  view.setUint8(32, BufferKind.Entities);
  view.setUint32(36, 28, true);
  view.setUint32(60, 0x12345678, true);
  view.setUint32(64, 0, true);
  return bytes;
}

function renameEntry(archive: Uint8Array, from: string, to: string): Uint8Array {
  assert.equal(encoder.encode(from).byteLength, encoder.encode(to).byteLength);
  const result = Uint8Array.from(archive);
  const view = new DataView(result.buffer);
  const source = encoder.encode(from);
  const target = encoder.encode(to);
  let replacements = 0;
  for (let offset = 0; offset <= result.byteLength - 4; offset += 1) {
    const signature = view.getUint32(offset, true);
    let nameOffset: number;
    let nameLength: number;
    if (signature === 0x04034b50 && offset + 30 <= result.byteLength) {
      nameOffset = offset + 30;
      nameLength = view.getUint16(offset + 26, true);
    } else if (signature === 0x02014b50 && offset + 46 <= result.byteLength) {
      nameOffset = offset + 46;
      nameLength = view.getUint16(offset + 28, true);
    } else {
      continue;
    }
    if (nameLength !== source.byteLength || nameOffset + nameLength > result.byteLength) continue;
    if (source.every((byte, index) => result[nameOffset + index] === byte)) {
      result.set(target, nameOffset);
      replacements += 1;
    }
  }
  assert.equal(replacements, 2, "expected one local and one central filename replacement");
  return result;
}

test("golden fixture is deterministic and covers CADWeb v1 geometry", async () => {
  const generated = await createDeterministicFixture();
  const regenerated = await createDeterministicFixture();
  const golden = await readFile(new URL("./fixtures/basic-v1.cadweb", import.meta.url));
  assert.deepEqual(generated, regenerated);
  assert.deepEqual(generated, Uint8Array.from(golden));

  const document = await readCadWeb(generated);
  assert.equal(document.manifest.formatVersion.major, 1);
  assert.equal(document.layers.layers.length, 2);
  assert.deepEqual(
    document.entities.entities.map((entity) => entity.kind),
    [
      EntityKind.Line,
      EntityKind.Polyline,
      EntityKind.Arc,
      EntityKind.Circle,
      EntityKind.Text,
      EntityKind.BlockReference,
    ],
  );
  assert.equal(document.entities.entities[1]!.bulges[1], 0.41421356237309503);
  assert.equal(document.entities.entities[4]!.text, "Cửa Ø100");
  assert.equal(document.blocks?.blocks[0]?.name, "DOOR");
  assert.equal(document.entities.entities[5]!.attributes[0]?.text, "D-01");
  assert.equal(document.entities.entities[5]!.transform?.[3], 12);
  assert.equal(document.entities.entities[5]!.transform?.[7], 2);
  for (const entity of [
    ...document.entities.entities,
    ...(document.blocks?.blocks.flatMap((block) => block.entities) ?? []),
  ]) {
    assert.equal(entity.colorSourceMode, PropertySourceMode.Explicit);
    assert.equal(entity.transparencySourceMode, PropertySourceMode.Explicit);
    assert.equal(entity.lineWeightSourceMode, PropertySourceMode.Explicit);
    assert.equal(entity.linetypeSourceMode, PropertySourceMode.Explicit);
  }
});

test("packaged manifest schema matches the canonical contract", async () => {
  const canonical = JSON.parse(
    await readFile(
      new URL("../../../../cad-platform/schema/manifest.schema.json", import.meta.url),
      "utf8",
    ),
  ) as unknown;
  assert.deepEqual(generatedManifestSchema, canonical);
});

test("reads the checked C++ fixture with legally unaligned empty vectors", async () => {
  const archive = Uint8Array.from(
    await readFile(new URL("./fixtures/native-v1.cadweb", import.meta.url)),
  );
  const entries = unpack(archive);
  const entities = entries["entities.bin"]!;
  const view = new DataView(entities.buffer, entities.byteOffset, entities.byteLength);
  const root = view.getUint32(0, true);
  const entitiesVector = uoffsetTarget(entities, tableFieldPosition(entities, root, 2));
  const secondEntity = uoffsetTarget(entities, entitiesVector + 8);
  const emptyBulges = uoffsetTarget(entities, tableFieldPosition(entities, secondEntity, 12));
  assert.equal(view.getUint32(emptyBulges, true), 0);
  assert.notEqual((emptyBulges + 4) % 8, 0);

  const document = await readCadWeb(archive);
  assert.equal(document.entities.entities.length, 7);
  assert.equal(document.blocks?.blocks.length, 1);
  assert.equal(document.exportReport.status, "partial");
});

test("ignores appended optional FlatBuffers fields within schema version 1", () => {
  const geometry = parseGeometryBuffer(
    forwardCompatibleGeometryBuffer(),
    BufferKind.Entities,
  );
  assert.deepEqual(geometry.entities, []);
  assert.deepEqual(geometry.blocks, []);
});

test("rejects path traversal before decompression", () => {
  const archive = zipSync(
    { "../outside.txt": [encoder.encode("unsafe"), { level: 0, mtime: fixedZipDate }] },
    { level: 0 },
  );
  assert.throws(() => inspectCadWebZip(archive), hasCode("ZIP_PATH"));
});

test("rejects duplicate portable paths before decompression", () => {
  const archive = zipSync(
    {
      a: [encoder.encode("one"), { level: 0, mtime: fixedZipDate }],
      b: [encoder.encode("two"), { level: 0, mtime: fixedZipDate }],
    },
    { level: 0 },
  );
  assert.throws(() => inspectCadWebZip(renameEntry(archive, "b", "a")), hasCode("ZIP_DUPLICATE"));
});

test("rejects ZIP symlink entries", () => {
  const archive = zipSync(
    {
      link: [
        encoder.encode("target"),
        { level: 0, mtime: fixedZipDate, os: 3, attrs: (0o120777 << 16) >>> 0 },
      ],
    },
    { level: 0 },
  );
  assert.throws(() => inspectCadWebZip(archive), hasCode("ZIP_INVALID"));
});

test("rejects data descriptors and inconsistent ZIP CRC", async () => {
  const original = zipSync({ a: encoder.encode("crc") }, { level: 0, mtime: fixedZipDate });
  const descriptor = Uint8Array.from(original);
  const descriptorView = new DataView(descriptor.buffer);
  descriptorView.setUint16(6, descriptorView.getUint16(6, true) | 0x0008, true);
  const central = descriptor.findIndex(
    (_, offset) => offset + 4 <= descriptor.length && new DataView(descriptor.buffer).getUint32(offset, true) === 0x02014b50,
  );
  assert.ok(central >= 0);
  descriptorView.setUint16(central + 8, descriptorView.getUint16(central + 8, true) | 0x0008, true);
  assert.throws(() => inspectCadWebZip(descriptor), hasCode("ZIP_INVALID"));

  const badCrc = Uint8Array.from(original);
  const badCrcView = new DataView(badCrc.buffer);
  badCrcView.setUint32(14, badCrcView.getUint32(14, true) ^ 1, true);
  assert.throws(() => inspectCadWebZip(badCrc), hasCode("ZIP_INVALID"));

  const corruptData = Uint8Array.from(original);
  const corruptView = new DataView(corruptData.buffer);
  const dataOffset = 30 + corruptView.getUint16(26, true) + corruptView.getUint16(28, true);
  corruptData[dataOffset] ^= 1;
  await assert.rejects(readCadWeb(corruptData), hasCode("ZIP_INVALID"));
});

test("enforces entry, size, archive and compression-ratio limits", async () => {
  const fixture = await createDeterministicFixture();
  assert.throws(() => inspectCadWebZip(fixture, { maxEntries: 4 }), hasCode("ZIP_LIMIT"));
  assert.throws(
    () => inspectCadWebZip(fixture, { maxEntryUncompressedBytes: 100 }),
    hasCode("ZIP_LIMIT"),
  );
  assert.throws(
    () => inspectCadWebZip(fixture, { maxArchiveBytes: fixture.byteLength - 1 }),
    hasCode("ZIP_LIMIT"),
  );
  const compressed = zipSync(
    { "large.bin": new Uint8Array(50_000) },
    { level: 9, mtime: fixedZipDate },
  );
  assert.throws(
    () => inspectCadWebZip(compressed, { maxCompressionRatio: 2 }),
    hasCode("ZIP_LIMIT"),
  );
});

test("rejects a payload whose SHA-256 no longer matches", async () => {
  const fixture = await createDeterministicFixture();
  const entries = unpack(fixture);
  entries["layers.json"] = Uint8Array.from(entries["layers.json"]!);
  entries["layers.json"]![0] ^= 1;
  await assert.rejects(readCadWeb(pack(entries)), hasCode("INTEGRITY_ERROR"));
});

test("rejects unsupported manifest and geometry versions", async () => {
  const fixture = await createDeterministicFixture();
  const futureManifest = rewriteManifest(fixture, (manifest) => {
    manifest.formatVersion.major = 2;
  });
  await assert.rejects(readCadWeb(futureManifest), hasCode("VERSION_UNSUPPORTED"));

  const builder = new Builder();
  const root = new GeometryBufferT(2, BufferKind.Entities, [], []).pack(builder);
  GeometryBuffer.finishGeometryBufferBuffer(builder, root);
  const futureGeometry = await replacePayload(
    fixture,
    "entities",
    Uint8Array.from(builder.asUint8Array()),
  );
  await assert.rejects(readCadWeb(futureGeometry), hasCode("VERSION_UNSUPPORTED"));
});

test("rejects non-finite unit, origin and extent numbers in manifest JSON", async () => {
  const fixture = await createDeterministicFixture();
  const cases = [
    rewriteManifestText(fixture, '"metersPerUnit": 0.001', '"metersPerUnit": 1e400'),
    rewriteManifestText(fixture, '"origin": [\n      0,', '"origin": [\n      1e400,'),
    rewriteManifestText(fixture, '"max": [\n      13,', '"max": [\n      1e400,'),
  ];
  for (const archive of cases) {
    await assert.rejects(readCadWeb(archive), hasCode("MANIFEST_INVALID"));
  }
});

test("verifies FlatBuffers pointers, vtables, vectors and strings before generated access", async () => {
  const fixture = await createDeterministicFixture();
  const original = unpack(fixture)["entities.bin"]!;
  const sourceView = new DataView(original.buffer, original.byteOffset, original.byteLength);
  const root = sourceView.getUint32(0, true);
  const entitiesField = tableFieldPosition(original, root, 2);
  const entitiesVector = uoffsetTarget(original, entitiesField);
  const firstEntityOffset = entitiesVector + 4;
  const firstEntity = uoffsetTarget(original, firstEntityOffset);
  const idField = tableFieldPosition(original, firstEntity, 0);
  const idString = uoffsetTarget(original, idField);
  const idLength = sourceView.getUint32(idString, true);

  const malformed = [
    mutateBytes(original, (view) => view.setUint32(0, original.byteLength + 4, true)),
    mutateBytes(original, (view) => view.setUint32(0, root + 1, true)),
    mutateBytes(original, (view) => view.setInt32(firstEntity, 0, true)),
    mutateBytes(original, (view) => view.setUint32(idField, 0, true)),
    mutateBytes(original, (view) =>
      view.setUint32(
        entitiesField,
        view.getUint32(entitiesField, true) + 4,
        true,
      ),
    ),
    mutateBytes(original, (view) => view.setUint32(entitiesVector, 0xffffffff, true)),
    mutateBytes(original, (view) => view.setUint32(idString, original.byteLength, true)),
    mutateBytes(original, (_view, copy) => {
      copy[idString + 4 + idLength] = 1;
    }),
  ];

  for (const bytes of malformed) {
    assert.throws(
      () => parseGeometryBuffer(bytes, BufferKind.Entities),
      hasCode("GEOMETRY_INVALID"),
    );
  }
});

test("rejects malformed ZIP, JSON, payload schema and FlatBuffers", async () => {
  assert.throws(() => inspectCadWebZip(Uint8Array.of(1, 2, 3)), hasCode("ZIP_INVALID"));

  const fixture = await createDeterministicFixture();
  const badManifestEntries = unpack(fixture);
  badManifestEntries["manifest.json"] = encoder.encode("{");
  await assert.rejects(readCadWeb(pack(badManifestEntries)), hasCode("MANIFEST_INVALID"));

  const badLayers = encoder.encode(
    JSON.stringify({ schemaVersion: 1, layers: [{ id: "layer:broken" }] }),
  );
  await assert.rejects(
    readCadWeb(await replacePayload(fixture, "layers", badLayers)),
    hasCode("PAYLOAD_INVALID"),
  );

  const badGeometry = Uint8Array.from(unpack(fixture)["entities.bin"]!);
  badGeometry[4] = 0;
  await assert.rejects(
    readCadWeb(await replacePayload(fixture, "entities", badGeometry)),
    hasCode("GEOMETRY_INVALID"),
  );
});

test("rejects unlisted payloads, dangling block references and block cycles", async () => {
  const fixture = await createDeterministicFixture();
  const extraEntries = unpack(fixture);
  extraEntries["extra.txt"] = encoder.encode("not declared");
  await assert.rejects(readCadWeb(pack(extraEntries)), hasCode("MANIFEST_INVALID"));

  const document = await readCadWeb(fixture);
  const blockReference = document.entities.entities[5]!;
  const cyclicBlocks = buildGeometryBuffer({
    schemaVersion: 1,
    kind: BufferKind.Blocks,
    entities: [],
    blocks: [
      {
        id: "block:door",
        name: "DOOR",
        basePoint: [0, 0, 0],
        entities: [
          {
            ...blockReference,
            id: "entity:cycle",
            sourceHandle: "CYCLE",
            space: SpaceKind.BlockDefinition,
          },
        ],
      },
    ],
  });
  await assert.rejects(
    readCadWeb(await replacePayload(fixture, "blocks", cyclicBlocks)),
    hasCode("GEOMETRY_INVALID"),
  );

  const danglingEntities = buildGeometryBuffer({
    ...document.entities,
    entities: document.entities.entities.map((entity) =>
      entity.kind === EntityKind.BlockReference
        ? { ...entity, blockDefinitionId: "block:missing" }
        : entity,
    ),
  });
  await assert.rejects(
    readCadWeb(await replacePayload(fixture, "entities", danglingEntities)),
    hasCode("GEOMETRY_INVALID"),
  );
});

import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  BLOCK_LIBRARY_FILE_NAME,
  BlockLibraryConflictError,
  TECHNICAL_NAME_PATTERN,
  blockLibraryFilePath,
  createBlockDefinition,
  createLibrarySource,
  findBlockDuplicateGroups,
  loadBlockLibraryCatalog,
  mergeBlockDescription,
  parseBlockDescription,
  saveBlockLibraryCatalog,
  sanitizeBlockDefinition,
  slugifyTechnicalName,
  upsertBlockDefinition,
  upsertLibrarySource,
} from "../src/blockLibrary.ts";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "acad-block-library-"));
const storage = { dataDir: temporaryDirectory };

const baseBlock = {
  technicalName: "ghe_phong_khach",
  cadName: "Ghế Phòng Khách$A",
  displayName: "Ghế phòng khách",
  description: "Dùng cho mặt bằng nội thất.",
  category: "noi_that/ghe",
  tags: ["noi that", "ghe"],
  useCases: ["Mặt bằng nội thất"],
  type: "static",
  hasAttributes: true,
  attributeDefinitions: [{
    tag: "MA_GHE",
    prompt: "Mã ghế",
    defaultValue: "G-01",
    invisible: false,
    constant: false,
    preset: false,
    verify: false,
    lockPosition: true,
  }],
  basePoint: { x: 0, y: 0, z: 0 },
  units: "mm",
  defaultLayer: "NOI-THAT",
  allowedSpaces: ["model"],
  annotative: false,
  scales: [],
  sourcePath: "/library/noi-that.dwg",
  referenceCount: 3,
  sourceRevision: "dwg-revision-1",
  geometryFingerprint: "sha256:chair-v1",
  previewImage: "/library/images/ghe.png",
  toolPalettePath: "/library/palettes/noi-that.xtp",
  syncStatus: "synced",
  lastSyncedAt: "2026-07-27T00:00:00.000Z",
};

try {
  assert.equal(slugifyTechnicalName(" Ghế phòng khách Đẹp "), "ghe_phong_khach_dep");
  assert.equal(slugifyTechnicalName("***"), "block");
  assert.equal(TECHNICAL_NAME_PATTERN.test("A3-1_ghi.chu"), true);
  assert.equal(TECHNICAL_NAME_PATTERN.test("ghế phòng"), false);

  const markerId = "6ef2ab27-06b1-46ad-8b3f-9b1040859bf2";
  const mergedDescription = mergeBlockDescription("Mô tả của người dùng", markerId);
  assert.equal(
    mergedDescription,
    `Mô tả của người dùng\nACADLIB:v1;id=${markerId}`,
  );
  assert.deepEqual(parseBlockDescription(mergedDescription), {
    description: "Mô tả của người dùng",
    id: markerId,
  });
  const remapped = mergeBlockDescription(mergedDescription, "block-new");
  assert.equal(remapped, "Mô tả của người dùng\nACADLIB:v1;id=block-new");

  const source = createLibrarySource({
    kind: "dwg",
    displayName: "Thư viện nội thất",
    path: "/library/noi-that.dwg",
  }, "source-interior");
  const firstBlock = createBlockDefinition({
    ...baseBlock,
    sourceId: source.id,
  }, "block-chair-a");
  assert.equal(firstBlock.type, "static");
  assert.equal(firstBlock.hasAttributes, true, "attributes are independent from block type");
  assert.equal(firstBlock.cadName, "Ghế Phòng Khách$A", "CAD name must remain unchanged");
  assert.equal(firstBlock.referenceCount, 3);
  assert.equal(firstBlock.attributeDefinitions[0].tag, "MA_GHE");
  assert.equal(firstBlock.syncStatus, "synced");
  assert.throws(
    () => sanitizeBlockDefinition({ ...firstBlock, technicalName: "Ghế phòng khách" }),
    /technicalName.*ASCII/,
  );
  assert.throws(
    () => sanitizeBlockDefinition({ ...firstBlock, allowedSpaces: [] }),
    /allowedSpaces.*không rỗng/,
  );
  assert.throws(
    () => sanitizeBlockDefinition({ ...firstBlock, referenceCount: -1 }),
    /referenceCount.*không âm/,
  );

  const empty = loadBlockLibraryCatalog(storage);
  assert.equal(empty.schemaVersion, 1);
  assert.equal(empty.blocks.length, 0);
  assert.match(empty.revision, /^[a-f0-9]{64}$/);
  assert.equal(existsSync(join(temporaryDirectory, BLOCK_LIBRARY_FILE_NAME)), false);
  assert.equal(
    blockLibraryFilePath({ env: { ACAD_DATA_DIR: temporaryDirectory } }),
    join(temporaryDirectory, BLOCK_LIBRARY_FILE_NAME),
  );

  const saved = saveBlockLibraryCatalog({
    schemaVersion: 1,
    sources: [source],
    blocks: [firstBlock],
  }, empty.revision, storage);
  assert.equal(existsSync(join(temporaryDirectory, BLOCK_LIBRARY_FILE_NAME)), true);
  assert.equal(
    readdirSync(temporaryDirectory).some((name) => name.endsWith(".tmp")),
    false,
    "atomic save must not leave a temporary file",
  );
  const diskCatalog = JSON.parse(
    readFileSync(join(temporaryDirectory, BLOCK_LIBRARY_FILE_NAME), "utf8"),
  );
  assert.equal(diskCatalog.schemaVersion, 1);
  assert.equal(diskCatalog.blocks[0].id, "block-chair-a");

  const imageSource = createLibrarySource({
    kind: "image",
    displayName: "Ảnh preview nội thất",
    path: "/library/images",
  }, "source-images");
  const withImageSource = upsertLibrarySource(imageSource, saved.revision, storage);
  assert.equal(withImageSource.sources.length, 2);

  const secondBlock = createBlockDefinition({
    ...baseBlock,
    technicalName: "GHE_PHONG_KHACH",
    displayName: "Ghế phòng khách bản B",
    type: "dynamic",
    hasAttributes: false,
    allowedSpaces: ["model", "layout"],
    annotative: true,
    scales: ["1:50", "1:100"],
    sourceId: source.id,
  }, "block-chair-b");
  const updated = upsertBlockDefinition(secondBlock, withImageSource.revision, storage);
  assert.equal(updated.blocks.length, 2);
  assert.notEqual(updated.revision, saved.revision);
  assert.throws(
    () => upsertBlockDefinition({ ...secondBlock, displayName: "Stale edit" }, saved.revision, storage),
    BlockLibraryConflictError,
  );

  assert.deepEqual(findBlockDuplicateGroups(updated.blocks), [
    {
      reason: "geometry_fingerprint",
      key: "sha256:chair-v1",
      blockIds: ["block-chair-a", "block-chair-b"],
    },
    {
      reason: "name_collision",
      key: "ghe_phong_khach",
      blockIds: ["block-chair-a", "block-chair-b"],
    },
  ]);

  assert.throws(
    () => saveBlockLibraryCatalog({
      schemaVersion: 1,
      sources: [],
      blocks: [firstBlock],
    }, updated.revision, storage),
    /không tìm thấy nguồn/,
  );

  console.log("block library: ok");
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

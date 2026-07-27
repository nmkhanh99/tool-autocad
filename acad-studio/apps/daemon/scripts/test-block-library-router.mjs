import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  blockFromDrawingRow,
  blockLibraryRouter,
  mergeDrawingBlocksIntoCatalog,
} from "../src/blockLibraryRouter.ts";
import {
  createBlockDefinition,
  emptyBlockLibraryCatalog,
  saveBlockLibraryCatalog,
} from "../src/blockLibrary.ts";
import { blockMetadataPayload } from "../src/blockLibraryCad.ts";

const chair = createBlockDefinition({
  technicalName: "ghe_hop",
  cadName: "GHE_HOP",
  displayName: "Ghế họp",
  description: "Ghế họp bốn chân",
  category: "noi_that/ghe",
  tags: ["ghe"],
  useCases: ["Mặt bằng nội thất"],
  type: "static",
  hasAttributes: false,
  attributeDefinitions: [],
  basePoint: { x: 0, y: 0, z: 0 },
  units: "mm",
  defaultLayer: "A-FURN",
  allowedSpaces: ["model"],
  annotative: false,
  scales: [],
  syncStatus: "local_only",
}, "block-chair");

const chairRow = {
  name: "GHE_HOP",
  comments: "Ghế họp bốn chân\nACADLIB:v1;id=block-chair",
  origin: [0, 0, 0],
  insertUnits: 4,
  referenceCount: 7,
  acadlibMetadata: JSON.stringify(blockMetadataPayload(chair)),
};
const mappedChair = blockFromDrawingRow(chairRow, chair, chair.id, new Date("2026-01-01"));
assert.equal(mappedChair.syncStatus, "synced");
assert.equal(mappedChair.referenceCount, 7);
assert.equal(mappedChair.lastSyncedAt, "2026-01-01T00:00:00.000Z");

const baseCatalog = emptyBlockLibraryCatalog();
baseCatalog.blocks.push(chair);
const merged = mergeDrawingBlocksIntoCatalog(baseCatalog, {
  drawing: {
    blocks: [
      chairRow,
      {
        name: "KHUNG_TEN_A3",
        comments: "Khung tên A3",
        origin: [0, 0, 0],
        insertUnits: 4,
        hasAttributeDefinitions: true,
        attributeDefinitions: [{ tag: "SO_BV", prompt: "Số bản vẽ" }],
      },
      { name: "*U123", anonymous: true, dynamic: true },
    ],
  },
}, new Date("2026-01-01"));
assert.equal(merged.catalog.blocks.length, 2);
assert.equal(merged.report.updatedIds.includes("block-chair"), true);
assert.equal(merged.report.importedIds.length, 1);
const titleBlock = merged.catalog.blocks.find((block) => block.technicalName === "KHUNG_TEN_A3");
assert.ok(titleBlock);
assert.equal(titleBlock.hasAttributes, true);
assert.equal(titleBlock.syncStatus, "cad_only");

const conflictCatalog = emptyBlockLibraryCatalog();
conflictCatalog.blocks.push(chair);
const conflict = mergeDrawingBlocksIntoCatalog(conflictCatalog, {
  tables: {
    blocks: [{
      ...chairRow,
      acadlibMetadata: JSON.stringify({ id: "another-chair", key: "ghe_hop", revision: "old" }),
      comments: "Block khác\nACADLIB:v1;id=another-chair",
    }],
  },
});
assert.equal(conflict.catalog.blocks.length, 2);
assert.deepEqual(
  new Set(conflict.report.conflictIds),
  new Set(["block-chair", "another-chair"]),
);
assert.equal(conflict.catalog.blocks.every((block) => block.syncStatus === "conflict"), true);

const dataDir = mkdtempSync(join(tmpdir(), "acad-block-router-"));
const stored = saveBlockLibraryCatalog(emptyBlockLibraryCatalog(), undefined, { dataDir });
const router = blockLibraryRouter({
  storage: { dataDir },
  acadRunning: async () => true,
  listOpenDocs: async () => ({
    alive: true,
    docs: [{ title: "Drawing1.dwg", file: "/tmp/Drawing1.dwg", active: true }],
  }),
  requestDrawingInfo: async () => ({
    ok: true,
    drawing: { blocks: [chairRow] },
  }),
});
assert.equal(typeof router, "function");
const routeSignatures = router.stack
  .filter((layer) => layer.route)
  .flatMap((layer) => Object.keys(layer.route.methods)
    .map((method) => `${method.toUpperCase()} ${layer.route.path}`));
for (const signature of [
  "GET /",
  "GET /sources",
  "POST /sources",
  "PUT /:id",
  "POST /scan",
  "POST /create",
  "POST /sync",
  "POST /insert",
]) {
  assert.ok(routeSignatures.includes(signature), `router includes ${signature}`);
}

async function invokeOn(targetRouter, method, path, body = {}, params = {}) {
  const layer = targetRouter.stack.find((item) =>
    item.route?.path === path && item.route.methods[method.toLowerCase()]);
  assert.ok(layer, `${method} ${path} handler exists`);
  let status = 200;
  let payload;
  const response = {
    status(value) { status = value; return response; },
    json(value) { payload = value; return response; },
  };
  await layer.route.stack[0].handle({
    body,
    params,
    get() { return undefined; },
  }, response);
  return { status, payload };
}

const invoke = (method, path, body = {}, params = {}) =>
  invokeOn(router, method, path, body, params);

const openDocumentDeps = {
  acadRunning: async () => true,
  listOpenDocs: async () => ({
    alive: true,
    docs: [{ title: "Drawing1.dwg", file: "/tmp/Drawing1.dwg", active: true }],
  }),
};

function snapshotWithBlocks(blocks) {
  return {
    ok: true,
    source: { pluginVersion: "1.3.0" },
    drawing: { blocks },
  };
}

function saveSingleBlock(dataDir, block, sources = []) {
  const empty = saveBlockLibraryCatalog(emptyBlockLibraryCatalog(), undefined, { dataDir });
  return saveBlockLibraryCatalog({ ...empty, blocks: [block], sources }, empty.revision, { dataDir });
}

function testBlock(id, technicalName, description, extra = {}) {
  return createBlockDefinition({
    ...chair,
    technicalName,
    cadName: technicalName.toUpperCase(),
    displayName: technicalName,
    description,
    syncStatus: "outdated",
    lastSyncedAt: undefined,
    ...extra,
  }, id);
}

const scanResponse = await invoke("POST", "/scan", {
  target: "Drawing1.dwg",
  expectedRevision: stored.revision,
});
assert.equal(scanResponse.status, 200);
assert.equal(scanResponse.payload.ok, true);
assert.equal(scanResponse.payload.blocks.length, 1);
assert.equal(scanResponse.payload.report.importedIds.length, 1);

const syncedCatalog = {
  ...scanResponse.payload.catalog,
  blocks: scanResponse.payload.catalog.blocks.map((block) => ({
    ...block,
    syncStatus: "synced",
    lastSyncedAt: "2026-01-01T00:00:00.000Z",
  })),
};
const syncedStored = saveBlockLibraryCatalog(
  syncedCatalog,
  scanResponse.payload.revision,
  { dataDir },
);
const edited = { ...syncedStored.blocks[0], description: "Mô tả mới", syncStatus: "synced" };
const putResponse = await invoke("PUT", "/:id", {
  block: edited,
  expectedRevision: syncedStored.revision,
}, { id: edited.id });
assert.equal(putResponse.status, 200);
assert.equal(putResponse.payload.blocks[0].syncStatus, "outdated");
assert.equal(putResponse.payload.blocks[0].lastSyncedAt, undefined);

// Sync is app -> CAD: stale Comments/XRecord must never overwrite catalog metadata.
const syncDir = mkdtempSync(join(tmpdir(), "acad-block-sync-"));
const syncBlock = testBlock("block-sync", "ghe_sync", "NEW_APP");
const syncStored = saveSingleBlock(syncDir, syncBlock);
const staleSyncRow = {
  name: syncBlock.cadName,
  comments: `OLD_CAD\nACADLIB:v1;id=${syncBlock.id}`,
  referenceCount: 4,
  acadlibMetadata: JSON.stringify({
    ...blockMetadataPayload(syncBlock),
    revision: "stale-cad-revision",
  }),
};
let syncNativeBody = "";
const syncRouter = blockLibraryRouter({
  storage: { dataDir: syncDir },
  ...openDocumentDeps,
  requestDrawingInfo: async () => snapshotWithBlocks([staleSyncRow]),
  runNativeJob: async (body) => {
    syncNativeBody = body;
    return { ok: true, count: 1 };
  },
});
const syncResponse = await invokeOn(syncRouter, "POST", "/sync", {
  target: "Drawing1.dwg",
  blockId: syncBlock.id,
  expectedRevision: syncStored.revision,
});
assert.equal(syncResponse.status, 200);
assert.equal(syncResponse.payload.block.description, "NEW_APP");
assert.equal(syncResponse.payload.block.syncStatus, "synced");
const syncMetaCells = syncNativeBody.trim().split("\n")
  .find((line) => line.startsWith("BLOCKMETA\t"))
  .split("\t");
assert.equal(Buffer.from(syncMetaCells[2], "hex").toString("utf8"),
  `NEW_APP\nACADLIB:v1;id=${syncBlock.id}`);
assert.equal(
  JSON.parse(Buffer.from(syncMetaCells[3], "hex").toString("utf8")).revision,
  blockMetadataPayload(syncBlock).revision,
);

// A same-name definition with another stable ID is a conflict, never an adoption target.
const identityDir = mkdtempSync(join(tmpdir(), "acad-block-identity-"));
const identityBlock = testBlock("block-identity-a", "ghe_identity", "Catalog A");
const identityStored = saveSingleBlock(identityDir, identityBlock);
const mismatchedRow = {
  name: identityBlock.cadName,
  comments: "CAD B\nACADLIB:v1;id=block-identity-b",
  acadlibMetadata: JSON.stringify({
    ...blockMetadataPayload(identityBlock),
    id: "block-identity-b",
  }),
};
assert.throws(
  () => blockFromDrawingRow(mismatchedRow, identityBlock, identityBlock.id),
  /block-identity-b/,
);
let identityNativeCalls = 0;
const identityRouter = blockLibraryRouter({
  storage: { dataDir: identityDir },
  ...openDocumentDeps,
  requestDrawingInfo: async () => snapshotWithBlocks([mismatchedRow]),
  runNativeJob: async () => {
    identityNativeCalls += 1;
    return { ok: true, count: 1 };
  },
});
const identityResponse = await invokeOn(identityRouter, "POST", "/sync", {
  target: "Drawing1.dwg",
  blockId: identityBlock.id,
  expectedRevision: identityStored.revision,
});
assert.equal(identityResponse.status, 409);
assert.match(identityResponse.payload.error, /block-identity-b/);
assert.equal(identityNativeCalls, 0);

// Insert may use a stale existing definition, but it must stay outdated and preserve app metadata.
const staleInsertDir = mkdtempSync(join(tmpdir(), "acad-block-stale-insert-"));
const staleInsertBlock = testBlock("block-stale-insert", "ghe_stale_insert", "NEW_APP");
const staleInsertStored = saveSingleBlock(staleInsertDir, staleInsertBlock);
let staleInsertSnapshots = 0;
let staleInsertDispatches = 0;
let staleInsertNativeCalls = 0;
const staleInsertRouter = blockLibraryRouter({
  storage: { dataDir: staleInsertDir },
  ...openDocumentDeps,
  requestDrawingInfo: async () => {
    staleInsertSnapshots += 1;
    return snapshotWithBlocks([{
      name: staleInsertBlock.cadName,
      comments: `OLD_CAD\nACADLIB:v1;id=${staleInsertBlock.id}`,
      referenceCount: staleInsertSnapshots === 1 ? 1 : 2,
      acadlibMetadata: JSON.stringify({
        ...blockMetadataPayload(staleInsertBlock),
        revision: "stale-cad-revision",
      }),
    }]);
  },
  dispatchLiveJob: async () => {
    staleInsertDispatches += 1;
    return { jobId: "insert", state: "done", result: { status: "ok", message: "" } };
  },
  runNativeJob: async () => {
    staleInsertNativeCalls += 1;
    return { ok: true, count: 1 };
  },
});
const staleInsertResponse = await invokeOn(staleInsertRouter, "POST", "/insert", {
  target: "Drawing1.dwg",
  blockId: staleInsertBlock.id,
  expectedRevision: staleInsertStored.revision,
});
assert.equal(staleInsertResponse.status, 200);
assert.equal(staleInsertResponse.payload.block.description, "NEW_APP");
assert.equal(staleInsertResponse.payload.block.syncStatus, "outdated");
assert.equal(staleInsertResponse.payload.block.lastSyncedAt, undefined);
assert.equal(staleInsertResponse.payload.block.referenceCount, 2);
assert.match(staleInsertResponse.payload.hint, /cần review\/sync/);
assert.equal(staleInsertDispatches, 1);
assert.equal(staleInsertNativeCalls, 0);

// A linked sourceId owns the DWG path; stale denormalized sourcePath is ignored.
const sourceDir = mkdtempSync(join(tmpdir(), "acad-block-source-"));
const currentSourcePath = join(sourceDir, "source_current.dwg");
writeFileSync(currentSourcePath, "fixture");
const sourceBlock = testBlock("block-source", "source_current", "Current source", {
  sourceId: "source-current",
  sourcePath: "/tmp/stale_source_path.dwg",
  sourceBlockName: "SOURCE_CURRENT",
});
const sourceStored = saveSingleBlock(sourceDir, sourceBlock, [{
  id: "source-current",
  kind: "dwg",
  displayName: "Current",
  path: currentSourcePath,
}]);
let sourceSnapshots = 0;
let insertLisp = "";
const sourceRouter = blockLibraryRouter({
  storage: { dataDir: sourceDir },
  ...openDocumentDeps,
  requestDrawingInfo: async () => snapshotWithBlocks(sourceSnapshots++ === 0 ? [] : [{
    name: sourceBlock.technicalName,
    referenceCount: 1,
  }]),
  dispatchLiveJob: async (lisp) => {
    insertLisp = lisp;
    return { jobId: "source", state: "done", result: { status: "ok", message: "" } };
  },
  runNativeJob: async () => ({ ok: true, count: 1 }),
});
const sourceResponse = await invokeOn(sourceRouter, "POST", "/insert", {
  target: "Drawing1.dwg",
  blockId: sourceBlock.id,
  expectedRevision: sourceStored.revision,
});
assert.equal(sourceResponse.status, 200);
assert.ok(insertLisp.includes(currentSourcePath));
assert.equal(insertLisp.includes("stale_source_path.dwg"), false);

// Mutations are serialized before revision reads and CAD side effects.
const serializedDir = mkdtempSync(join(tmpdir(), "acad-block-serialized-"));
const serializedStored = saveBlockLibraryCatalog(
  emptyBlockLibraryCatalog(),
  undefined,
  { dataDir: serializedDir },
);
let releaseFirstScan;
const firstScanGate = new Promise((resolve) => {
  releaseFirstScan = resolve;
});
let signalFirstScan;
const firstScanStarted = new Promise((resolve) => {
  signalFirstScan = resolve;
});
let serializedDrawingCalls = 0;
const serializedRouter = blockLibraryRouter({
  storage: { dataDir: serializedDir },
  ...openDocumentDeps,
  requestDrawingInfo: async () => {
    serializedDrawingCalls += 1;
    signalFirstScan();
    await firstScanGate;
    return snapshotWithBlocks([chairRow]);
  },
});
const firstScan = invokeOn(serializedRouter, "POST", "/scan", {
  target: "Drawing1.dwg",
  expectedRevision: serializedStored.revision,
});
await firstScanStarted;
const secondScan = invokeOn(serializedRouter, "POST", "/scan", {
  target: "Drawing1.dwg",
  expectedRevision: serializedStored.revision,
});
await new Promise((resolve) => setTimeout(resolve, 20));
assert.equal(serializedDrawingCalls, 1);
releaseFirstScan();
const [firstScanResponse, secondScanResponse] = await Promise.all([firstScan, secondScan]);
assert.equal(firstScanResponse.status, 200);
assert.equal(secondScanResponse.status, 409);
assert.equal(serializedDrawingCalls, 1);

console.log("block library router: mapping, conflicts, sync direction and serialization ok");

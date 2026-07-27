import assert from "node:assert/strict";

import {
  attributesForRow,
  blockMetadataPayload,
  buildBlockMetadataNativeJob,
  buildCreateBlockLisp,
  buildInsertBlockLisp,
  buildWblockExportScript,
  drawingBlocks,
  metadataIdentity,
  technicalNameForCadName,
  unitName,
} from "../src/blockLibraryCad.ts";
import {
  createBlockDefinition,
  parseBlockDescription,
} from "../src/blockLibrary.ts";

const block = createBlockDefinition({
  technicalName: "ghe_hop",
  cadName: "GHE_HOP",
  displayName: "Ghế họp",
  description: "Ghế họp bốn chân",
  category: "noi_that/ghe",
  tags: ["ghe"],
  useCases: ["Mặt bằng nội thất"],
  type: "static",
  hasAttributes: true,
  attributeDefinitions: [],
  basePoint: { x: 0, y: 0, z: 0 },
  units: "mm",
  defaultLayer: "A-FURN",
  allowedSpaces: ["model"],
  annotative: false,
  scales: [],
  syncStatus: "local_only",
}, "block-chair");

const metadata = blockMetadataPayload(block);
assert.equal(metadata.id, "block-chair");
assert.match(metadata.revision, /^[a-f0-9]{64}$/);

const native = buildBlockMetadataNativeJob(block, "Drawing1.dwg", "tok123");
assert.match(native, /BLOCKMETA\tGHE_HOP\t[0-9a-f]+\t[0-9a-f]+/);
assert.match(native, /TOKEN\ttok123/);

const create = buildCreateBlockLisp(block);
assert.match(create, /\(cadr \(ssgetfirst\)\)/);
assert.match(create, /_\.-BLOCK/);
assert.match(create, /ACADLIB:v1;id=block-chair/);
assert.match(create, /selection_required/);

assert.throws(
  () => buildCreateBlockLisp({ ...block, type: "dynamic" }),
  /dynamic block.*Block Editor/,
);

const insert = buildInsertBlockLisp({
  definitionName: "GHE_HOP",
  insertSource: "/tmp/ghe_hop.dwg",
  defaultLayer: "A-FURN",
  allowedSpaces: ["model"],
  scale: 1,
  rotation: 0,
});
assert.match(insert, /_\.-INSERT/);
assert.match(insert, /getpoint/);
assert.match(insert, /setvar "ATTREQ" 0/);
assert.match(insert, /acadlib:restore/);
assert.match(insert, /space_not_allowed/);
assert.match(insert, /\/tmp\/ghe_hop\.dwg/);

const wblock = buildWblockExportScript("GHE_HOP", "/tmp/ghe_hop.dwg");
assert.match(wblock, /_\.-WBLOCK/);
assert.match(wblock, /ACADLIB_WBLOCK_OK/);

const rows = drawingBlocks({
  drawing: {
    blocks: [
      {
        name: "GHE_HOP",
        comments: "Ghế\nACADLIB:v1;id=block-chair",
        dynamic: true,
        hasAttributeDefinitions: true,
        origin: [1, 2, 0],
        referenceCount: 3,
        insertUnits: 4,
        acadlibMetadata: JSON.stringify({ id: "block-chair", revision: "rev-1" }),
        attributeDefinitions: [{ tag: "MA_GHE", prompt: "Mã ghế" }],
      },
      { name: "*U1", anonymous: true },
      { name: "*Model_Space", isLayout: true },
    ],
  },
});
assert.equal(rows.length, 1);
assert.equal(rows[0].dynamic, true);
assert.deepEqual(metadataIdentity(rows[0]), { id: "block-chair", revision: "rev-1" });
assert.equal(attributesForRow(rows[0])[0].tag, "MA_GHE");
assert.equal(unitName(rows[0].insertUnits), "mm");
assert.equal(technicalNameForCadName("Ghế Họp"), "ghe_hop");
assert.equal(technicalNameForCadName("GHE_HOP"), "GHE_HOP");

const inlineFallback = parseBlockDescription(
  "Ghế họp bốn chân | ACADLIB:v1;id=block-chair",
);
assert.deepEqual(inlineFallback, {
  description: "Ghế họp bốn chân",
  id: "block-chair",
});

console.log("block library CAD builders: ok");

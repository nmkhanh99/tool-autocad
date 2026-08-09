import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { PropertySourceMode, readCadWeb } from "../src/index";

const path = new URL(
  "../../../../cad-platform/tests/native/build/native-sample.cadweb",
  import.meta.url,
);
const document = await readCadWeb(await readFile(path));
assert.equal(document.entities.entities.length, 7);
assert.equal(document.blocks?.blocks.length, 1);
assert.equal(document.layers.layers.length, 2);
const entities = new Map(document.entities.entities.map((entity) => [entity.id, entity]));
assert.equal(entities.get("fixture:10")?.transparencySourceMode, PropertySourceMode.ByBlock);
assert.equal(entities.get("fixture:20")?.colorSourceMode, PropertySourceMode.ByLayer);
assert.equal(entities.get("fixture:30")?.lineWeightSourceMode, PropertySourceMode.ByLayer);
assert.equal(entities.get("fixture:40")?.linetypeSourceMode, PropertySourceMode.ByBlock);
console.log(
  JSON.stringify({
    entities: document.entities.entities.length,
    blocks: document.blocks?.blocks.length ?? 0,
    layers: document.layers.layers.length,
    status: document.exportReport.status,
  }),
);

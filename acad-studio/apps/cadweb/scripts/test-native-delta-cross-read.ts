import { readFile } from "node:fs/promises";

import { PropertySourceMode, readCadWebDelta } from "../src/index";

const inputPath = process.argv[2];
if (!inputPath) {
  throw new Error("usage: pnpm test:native-delta-cross-read <native-sample.cadwebdelta>");
}

const delta = await readCadWebDelta(Uint8Array.from(await readFile(inputPath)));
const entitiesById = new Map(delta.entities?.entities.map((entity) => [entity.id, entity]));
const provenance = entitiesById.get("entity:A");
if (
  provenance?.colorSourceMode !== PropertySourceMode.ByLayer ||
  provenance.transparencySourceMode !== PropertySourceMode.ByBlock ||
  provenance.lineWeightSourceMode !== PropertySourceMode.Explicit ||
  provenance.linetypeSourceMode !== PropertySourceMode.ByLayer
) {
  throw new Error("native delta property source modes did not cross-read");
}
process.stdout.write(
  `${JSON.stringify({
    drawingId: delta.change.drawingId,
    baseRevision: delta.change.baseRevision,
    entities: delta.entities?.entities.length ?? 0,
    blocks: delta.blocks?.blocks.length ?? 0,
    layers: delta.layers?.layers.length ?? 0,
    tombstones: delta.tombstones?.keys.length ?? 0,
    status: delta.exportReport.status,
  })}\n`,
);

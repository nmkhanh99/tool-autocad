import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const appDirectory = fileURLToPath(new URL("../app/", import.meta.url));
const [panel, worker] = await Promise.all([
  readFile(`${appDirectory}/CadWebViewerPanel.tsx`, "utf8"),
  readFile(`${appDirectory}/cadweb.worker.ts`, "utf8"),
]);

assert.match(
  panel,
  /new Worker\(new URL\("\.\/cadweb\.worker\.ts", import\.meta\.url\)/,
  "viewer must load the CADWeb reader as a module worker",
);
assert.match(panel, /getContext\("webgl2"/, "viewer must use a real WebGL2 context");
assert.match(panel, /gl\.drawArrays\(mode/, "viewer must issue GPU draw calls");
assert.match(panel, /gl\.LINES/, "viewer must render line primitives");
assert.match(panel, /gl\.POINTS/, "viewer must render text markers");
assert.match(panel, /hiddenLayerIds/, "viewer must apply layer visibility on the main thread");
assert.match(panel, /role="dialog"/, "viewer workspace must expose dialog semantics");
assert.match(panel, /event\.key === "Escape"/, "viewer workspace must close with Escape");
assert.match(panel, /if \(!open\)/, "viewer workspace must not render while closed");

assert.match(
  worker,
  /readCadWeb,[\s\S]*readCadWebDelta,[\s\S]*from "@acad\/cadweb"/,
  "worker must consume the shared snapshot and delta readers",
);
assert.match(worker, /readSnapshot: readCadWeb/, "worker must use the validated snapshot reader");
assert.match(worker, /readDelta: readCadWebDelta/, "worker must use the validated delta reader");
for (const requestType of ["load", "loadSnapshot", "applyDelta", "resetToSnapshot", "reset"]) {
  assert.match(worker, new RegExp(`type: "${requestType}"`), `worker must support ${requestType}`);
}
assert.match(worker, /type: "reset-needed"/, "delta failures must request snapshot fallback");
assert.match(worker, /stageCadWebDelta/, "worker must stage revision changes before commit");
assert.doesNotMatch(
  worker,
  /JSON\.parse/,
  "worker must not bypass the package with a JSON geometry path",
);
for (const kind of ["Line", "Polyline", "Arc", "Circle", "Text", "MText"]) {
  assert.match(worker, new RegExp(`EntityKind\\.${kind}`), `worker must handle ${kind}`);
}
assert.match(worker, /multiplyMatrix4\(parentTransform, entity\.transform\)/);
assert.match(worker, /MAX_BLOCK_DEPTH/, "block traversal must have a depth limit");
assert.match(worker, /MAX_EXPANDED_ENTITIES/, "block traversal must have an entity limit");
assert.match(worker, /MAX_RENDER_VERTICES/, "tessellation must have a vertex limit");
assert.match(
  worker,
  /postMessage\(response, transfer\)/,
  "worker must transfer geometry buffers instead of copying them",
);

console.log("CADWeb viewer worker/WebGL contract passed");

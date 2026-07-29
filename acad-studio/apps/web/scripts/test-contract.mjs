import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "../app");
const page = readFileSync(join(appDir, "page.tsx"), "utf8");
const functions = readFileSync(join(appDir, "functions.ts"), "utf8");
const standards = readFileSync(join(appDir, "DrawingStandardsPanel.tsx"), "utf8");

assert.match(
  page,
  /const results = Array\.isArray\(r\?\.results\) \? r\.results : null;/,
  "function results validate the API array before rendering",
);
for (const resultKind of ["index", "table", "files"]) {
  assert.match(
    page,
    new RegExp(`\\{results && fn\\.result === "${resultKind}"`),
    `${resultKind} rendering is gated by a validated results array`,
  );
}
assert.doesNotMatch(
  page,
  /r\.results\.(?:filter|map)\(/,
  "error objects cannot reach an unchecked results operation",
);

for (const titleOnlyTarget of [
  "__target: act.title",
  "(docs.find((d: any) => d.active) || docs[0]).title",
  "(docs.find((d: any) => d.active) || docs[0] || {}).title",
  "value={d.title}",
]) {
  assert.ok(
    !page.includes(titleOnlyTarget),
    `legacy requests do not use title-only target pattern: ${titleOnlyTarget}`,
  );
}
assert.match(
  page,
  /<option key=\{d\.file \|\| d\.title\} value=\{d\.file \|\| d\.title\}>/,
  "live document options use the exact path for identity and value",
);

assert.doesNotMatch(functions, /\/Users\//, "function defaults are portable");
assert.match(
  functions,
  /const fileField: Field = \{[^\n]*type: "file"/,
  "DWG inputs use the file picker",
);
assert.match(
  functions,
  /const outField: Field = \{[^\n]*type: "dir"/,
  "output directories use the folder picker",
);

assert.match(
  standards,
  /onPendingChange\(nextText !== serialized\);/,
  "bounds editor tracks uncommitted local JSON",
);
assert.match(
  standards,
  /!draft\?\.id \|\| !dirty \|\| profileBusy \|\| pendingBounds\.size > 0/,
  "profile save is disabled while bounds JSON is uncommitted or invalid",
);
assert.match(
  standards,
  /onChange\(commaList\(nextText\)\);/,
  "list editor updates the parent draft on each edit",
);

for (const panel of [
  "BlockLibraryPanel.tsx",
  "DrawingInfoPanel.tsx",
  "DrawingStandardsPanel.tsx",
  "LispLibraryPanel.tsx",
]) {
  const source = readFileSync(join(appDir, panel), "utf8");
  assert.match(source, /from "\.\/json";/, `${panel} uses the shared JSON record guard`);
  assert.doesNotMatch(source, /function asRecord\(/, `${panel} has no local asRecord copy`);
}

console.log("✓ web contract: safe result rendering, exact targets, portable pickers, dirty editors");

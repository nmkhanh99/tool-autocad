import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = join(dirname(fileURLToPath(import.meta.url)), "../app");
const page = readFileSync(join(appDir, "page.tsx"), "utf8");
const functions = readFileSync(join(appDir, "functions.ts"), "utf8");
const standards = readFileSync(join(appDir, "DrawingStandardsPanel.tsx"), "utf8");
const drawingInfo = readFileSync(join(appDir, "DrawingInfoPanel.tsx"), "utf8");
const preconstruction = readFileSync(join(appDir, "PreconstructionPanel.tsx"), "utf8");
const styles = readFileSync(join(appDir, "globals.css"), "utf8");

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
assert.match(
  standards,
  /const document = asRecord\(current\?\.document\);[\s\S]*?scope: \{ kind: "handles", handles \},[\s\S]*?catalogGuard: \{ instance, revision \}/,
  "standards scan handle selections are bound to the scanned document revision",
);

assert.match(
  drawingInfo,
  /selectionCatalogOf\(drawing\?\.selectionCatalog\)/,
  "drawing info reads the one-pass current-space object catalog",
);
assert.match(
  drawingInfo,
  /appendCatalogSubject\(index\.layerHandles, subject\.layerHandle[\s\S]*?appendCatalogSubject\(index\.blockHandles, subject\.blockHandle/,
  "catalog indexes layer and dynamic-block subjects once by stable table handles",
);
assert.match(
  drawingInfo,
  /function catalogRowsOf[\s\S]*?for \(const group of groups\)[\s\S]*?result\.push\([\s\S]*?selectableCount: group\.count/,
  "used catalog groups remain visible even when the plugin table is capped",
);
assert.match(
  drawingInfo,
  /scope: \{ kind: "handles", handles \},[\s\S]*?catalogGuard: picker\.catalogGuard,[\s\S]*?catalogScope:/,
  "the chooser binds its exact cached handle set to the catalog document revision",
);
assert.match(
  drawingInfo,
  /catalogScopeHandle[\s\S]*?catalogScopeConsistent[\s\S]*?selectedAll: picker\.complete && handles\.length === picker\.subjects\.length/,
  "cached handles retain their exact layer/block membership and all-vs-subset intent",
);
assert.match(
  drawingInfo,
  /plugin cũ cần kiểm tra[\s\S]*?scope: \{ kind, name, handle: String\(row\.handle \|\| ""\) \}/,
  "old plugins keep a visible compatibility action until AutoCAD can be restarted",
);
assert.match(
  drawingInfo,
  /catalogStale \|\| !selectionCatalog \|\| \(!selectionCatalog\.complete && !subjects\.length\)[\s\S]*?snapshot cũ, kiểm tra trực tiếp[\s\S]*?danh mục chưa đầy đủ, kiểm tra trực tiếp/,
  "stale and unknown rows remain usable through direct guarded resolution",
);
assert.match(
  drawingInfo,
  /!!selectionCatalog\?\.complete && rowCatalogSubjects\(kind, row\)\.length === 0/,
  "only an exact catalog disables rows that have no selectable subjects",
);
assert.match(
  drawingInfo,
  /!current\.complete \|\| current\.subjects\.length > CAD_SELECTION_MAX_SUBJECTS/,
  "select-all remains fail-closed for incomplete or oversized catalogs",
);
assert.match(
  drawingInfo,
  /const PICKER_PAGE_SIZE = 100;[\s\S]*?visiblePickerSubjects = filteredPickerSubjects\.slice/,
  "large object groups are searched and paged instead of fully rendered",
);
assert.match(
  drawingInfo,
  /prioritizeSelectable[\s\S]*?selectableCountOf\(right\)[\s\S]*?rowsWithObjects/,
  "layer and block rows with selectable objects are counted and shown first",
);
assert.match(
  drawingInfo,
  /selectableCountOf\(row\) === 0[\s\S]*?"Chưa xác định"/,
  "an incomplete catalog does not mislabel an unscanned row as zero objects",
);
assert.match(
  drawingInfo,
  /if \(loadedSnapshotKey\.current === requestKey\) return;/,
  "reopening the panel reuses its in-app snapshot",
);
assert.doesNotMatch(
  drawingInfo,
  /\[open, daemon, selectedTarget, refreshToken, reloadToken\]/,
  "generic AutoCAD change events do not trigger an automatic full scan",
);
assert.match(
  drawingInfo,
  /setCatalogStale\(true\);[\s\S]*?\}, \[refreshToken\]\);/,
  "AutoCAD change events mark the cached snapshot stale without fetching",
);
const refreshInvalidationStart = drawingInfo.indexOf(
  "if (seenRefreshToken.current === refreshToken) return;",
);
const refreshInvalidationEnd = drawingInfo.indexOf(
  "}, [refreshToken]);",
  refreshInvalidationStart,
);
const refreshInvalidationBlock = drawingInfo.slice(
  refreshInvalidationStart,
  refreshInvalidationEnd,
);
assert.ok(
  refreshInvalidationStart >= 0 && refreshInvalidationEnd > refreshInvalidationStart,
  "drawing-info refresh invalidation effect is present",
);
assert.doesNotMatch(
  refreshInvalidationBlock,
  /setObjectPicker\(null\)/,
  "a late AutoCAD event does not dismiss an already-open guarded picker",
);
assert.match(
  page,
  /setDrawingInfoRefreshEventAt\(\(current\) => Math\.max\(current, eventAt\)\)[\s\S]*?refreshEventAt=\{drawingInfoRefreshEventAt\}/,
  "drawing-info receives the timestamp of its latest invalidating AutoCAD event",
);
assert.match(
  drawingInfo,
  /body\.snapshotCollectedAt \?\? body\.collectedAt[\s\S]*?latestRefreshEventAt\.current < snapshotCollectedAt[\s\S]*?setCatalogStale\(eventDuringScan && !eventCoveredBySnapshot\)/,
  "only an event strictly older than the snapshot is considered covered",
);
const prepareCadActionStart = drawingInfo.indexOf("async function prepareCadAction(");
const prepareCadActionEnd = drawingInfo.indexOf(
  "async function applyPendingCadAction()",
  prepareCadActionStart,
);
assert.ok(
  prepareCadActionStart >= 0 && prepareCadActionEnd > prepareCadActionStart,
  "drawing-info prepare action block is present",
);
assert.doesNotMatch(
  drawingInfo.slice(prepareCadActionStart, prepareCadActionEnd),
  /setCatalogStale\(false\)/,
  "a prepared operation does not mark the global drawing snapshot fresh",
);
assert.match(
  drawingInfo,
  /Snapshot nền đã cũ; thao tác vừa được kiểm tra trực tiếp[\s\S]*?onClick=\{\(\) => void applyPendingCadAction\(\)\} disabled=\{!!cadActionBusy\}/,
  "a freshly resolved operation remains confirmable while the background snapshot is stale",
);
assert.match(
  drawingInfo,
  /Quét lại từ AutoCAD/,
  "the explicit one-way pull action is named Quét lại từ AutoCAD",
);
assert.match(
  drawingInfo,
  /function drawingInfoBusyCode[\s\S]*?document_not_quiescent[\s\S]*?const scanFailed = !response\.ok \|\| body\.ok === false \|\| !!busyCode \|\|[\s\S]*?sameTarget && !!catalogFailure/,
  "busy and non-quiescent responses cannot be committed as successful snapshots",
);
assert.match(
  drawingInfo,
  /function drawingInfoCatalogFailure[\s\S]*?selection_catalog_compat_failed[\s\S]*?sameTarget && !!catalogFailure/,
  "a failed compatibility enrichment cannot replace a good cached catalog",
);
assert.match(
  drawingInfo,
  /if \(sameTarget\) \{[\s\S]*?Giữ nguyên snapshot cũ vì lần quét mới chưa thành công[\s\S]*?\} else \{[\s\S]*?setData\(/,
  "a failed explicit rescan keeps the previous in-app snapshot",
);
assert.ok(
  drawingInfo.indexOf("if (scanFailed)") < drawingInfo.indexOf("loadedSnapshotKey.current = requestKey"),
  "only a successful scan is stored as the reusable snapshot",
);
assert.match(
  drawingInfo,
  /patchSelectionSummary\(asRecord\(result\.result\) \|\| \{\}\)/,
  "an app-originated selection patches the cached selection summary without a full scan",
);
assert.match(
  drawingInfo,
  /function RawJsonSection[\s\S]*?JSON\.stringify\(data, null, 2\)[\s\S]*?\{open && <div/,
  "the potentially large catalog JSON is formatted and mounted only when explicitly opened",
);
assert.match(
  drawingInfo,
  /window\.document\.addEventListener\("keydown", containFocus\)/,
  "the nested object chooser contains keyboard focus",
);
assert.match(
  styles,
  /\.drawing-object-picker-list \{[\s\S]*?overflow: auto;/,
  "the per-object chooser has a bounded scroll viewport",
);

assert.match(
  page,
  /<PreconstructionPanel[\s\S]*?initialCadTarget=\{drawTarget\}[\s\S]*?onOpenReview=/,
  "the preconstruction workspace is wired to the active CAD target and review workspace",
);
assert.match(
  page,
  /<button type="button" className="fnbtn quickfn" onClick=\{\(\) => openPreconstruction\("overview"\)\}/,
  "the preconstruction function-panel entry is keyboard accessible",
);
for (const view of [
  "overview",
  "takeoff",
  "estimating",
  "field",
  "integrations",
  "automation",
]) {
  assert.ok(preconstruction.includes(`"${view}"`), `preconstruction exposes the ${view} view`);
}
for (const capability of [
  "Diện tích",
  "Chiều dài",
  "Cung",
  "Mái dốc",
  "Thể tích",
  "Đếm",
  "Hao hụt",
  "Assembly",
  "Nhân công",
  "Overhead",
  "Markup",
  "Thuế",
  "Punch list",
  "Báo cáo ngày",
  "Procore",
  "Acumatica",
  "QuickBooks",
  "AutoCount",
  "AI Trade Takeoff",
  "Auto-naming",
  "Smart suggestions",
  "Template Library",
  "Auto-hyperlinking",
  "BUDGET VS ACTUAL",
  "Non-measured costs",
]) {
  assert.ok(
    preconstruction.includes(capability),
    `preconstruction surfaces the requested capability: ${capability}`,
  );
}
assert.match(
  preconstruction,
  /rateOverrides\[variant\][\s\S]*?\[variant\]: \{[\s\S]*?\[id\]: \{/,
  "alternate estimates keep independent per-variant rate overrides",
);
assert.match(
  preconstruction,
  /INITIAL_ESTIMATE_SETTINGS[\s\S]*?"Cơ sở"[\s\S]*?"Tối ưu chi phí"[\s\S]*?"Thi công nhanh"/,
  "the project contains three independently configured estimate alternatives",
);
assert.match(
  preconstruction,
  /function boundedNumber[\s\S]*?Math\.min\(max, Math\.max\(0, value\)\)/,
  "quantity and costing inputs share a non-negative bounded numeric guard",
);
assert.match(
  preconstruction,
  /URL\.createObjectURL\(file\)/,
  "uploaded drawings and photos retain local blob content",
);
assert.match(
  preconstruction,
  /URL\.revokeObjectURL\(url\)/,
  "local uploaded blob content is released on unmount",
);
for (const accessibilityState of ["aria-current", "aria-pressed", "aria-selected"]) {
  assert.ok(
    preconstruction.includes(accessibilityState),
    `preconstruction exposes ${accessibilityState} for keyboard and assistive technology users`,
  );
}
assert.doesNotMatch(
  preconstruction,
  /https?:\/\/(?:[^/\s]+\.)?(?:procore|acumatica|quickbooks)\b/i,
  "connector cards do not embed unreviewed external API endpoints",
);
assert.match(
  styles,
  /\.precon-backdrop \{[\s\S]*?\.precon-panel \{[\s\S]*?@media \(max-width: 640px\)/,
  "the preconstruction workspace has scoped desktop and mobile styling",
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

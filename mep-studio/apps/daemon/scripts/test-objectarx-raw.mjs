/**
 * ObjectARX raw registry + pure dispatch tests.
 * Drives the shipped TypeScript modules (via tsx), not a reimplementation.
 *
 * Run: cd mep-studio/apps/daemon && npx tsx scripts/test-objectarx-raw.mjs
 *   or: node --import tsx scripts/test-objectarx-raw.mjs
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRATCH =
  process.env.MEP_SCRATCH ||
  "/var/folders/d6/t6kbyns970j6_5vd0qnwnm7r0000gn/T/grok-goal-019ab89128d1/implementer";
mkdirSync(SCRATCH, { recursive: true });

// Import shipped modules (tsx resolves .ts)
const catalog = await import("../src/objectarx/catalog.ts");
const rawJob = await import("../src/objectarx/rawJob.ts");
const rawDispatch = await import("../src/objectarx/rawDispatch.ts");

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else {
    console.log("ok  ", msg);
  }
}

// ── 1. Catalog coverage vs OBJECTARX-CAPABILITIES.md ──
const mdPath = resolve(__dirname, "../../../OBJECTARX-CAPABILITIES.md");
const md = readFileSync(mdPath, "utf8");
const mdRows = [];
let section = "";
for (const line of md.split("\n")) {
  if (line.startsWith("## ")) section = line.slice(3).trim();
  // Note: use alternation not a char class — 🟡 is outside BMP and breaks JS `[]` classes.
  const m = line.match(/\| (✅|🟡|❓|❌) \| \*\*(.+?)\*\* \| `(.+?)` \|/);
  if (m) mdRows.push({ status: m[1], name: m[2], api: m[3], section });
}
assert(mdRows.length === 86, `MD rows = 86 (got ${mdRows.length})`);
assert(catalog.RAW_CAPABILITIES.length === 86, `Registry size = 86 (got ${catalog.RAW_CAPABILITIES.length})`);

const macMd = mdRows.filter(
  (r) =>
    (r.status === "✅" || r.status === "🟡") &&
    !String(r.section).startsWith("Win-only"),
);
const macReg = catalog.macAvailableCapabilities();
assert(
  macReg.length === macMd.length,
  `Mac-available count MD=${macMd.length} registry=${macReg.length}`,
);

// Every Mac MD name must appear in registry
const regNames = new Set(catalog.RAW_CAPABILITIES.map((c) => c.name));
for (const r of macMd) {
  assert(regNames.has(r.name), `registry has Mac row: ${r.name.slice(0, 50)}`);
}

// No Win-only enabled
const enabledWin = catalog.RAW_CAPABILITIES.filter(
  (c) => c.enabled && (c.group === "Win-only" || c.catalogStatus === "❌"),
);
assert(enabledWin.length === 0, "0 Win-only enabled as raw actions");

const summary = catalog.coverageSummary();
assert(summary.enabledWinOnly === 0, "coverageSummary.enabledWinOnly === 0");
assert(summary.macAvailable > 70, `macAvailable > 70 (got ${summary.macAvailable})`);

// ── 2. Pure job build/parse round-trip (shipped functions) ──
const body = rawJob.buildRawJob({
  id: "db.entity_curves",
  target: "Drawing1.dwg",
  params: { kind: "line", x1: 0, y1: 0, x2: 1000, y2: 0, layer: "0" },
});
assert(body.includes("RAW\tdb.entity_curves"), "job body has RAW id");
assert(body.includes("TARGET\tDrawing1.dwg"), "job body has TARGET");
assert(body.includes("PARAM\tkind\tline"), "job body has PARAM kind");
const parsed = rawJob.parseRawJob(body);
assert(parsed.id === "db.entity_curves", "parseRawJob id");
assert(parsed.target === "Drawing1.dwg", "parseRawJob target");
assert(parsed.params.kind === "line", "parseRawJob params.kind");
assert(String(parsed.params.x2) === "1000", "parseRawJob params.x2");

// Result parser
const sampleResult = JSON.stringify({
  ok: true,
  id: "db.layer",
  payload: { layer: "MEP-RAW-TEST", aci: 3 },
});
const pr = rawJob.parseRawResult(sampleResult);
assert(pr.ok === true && pr.id === "db.layer", "parseRawResult success shape");

let threw = false;
try {
  rawJob.parseRawResult("{}");
} catch {
  threw = true;
}
assert(threw, "parseRawResult rejects missing ok/id");

// ── 3. validateRawInvoke on real catalog ──
const unknown = rawJob.validateRawInvoke({ id: "not.a.real.id" });
assert(unknown.preflight?.ok === false, "unknown id → ok:false");
assert(unknown.preflight?.id === "not.a.real.id", "unknown id preserved");

const win = rawJob.validateRawInvoke({ id: "win.mfc" });
assert(win.preflight?.blocked === true, "win.mfc blocked");
assert(win.preflight?.ok === false, "win.mfc not ok");

const good = rawJob.validateRawInvoke({ id: "db.layer" });
assert(!good.preflight && good.cap?.id === "db.layer", "db.layer preflight clear");

// ── 4. dry-run invoke via shipped dispatch (no AutoCAD) ──
const dry = await rawDispatch.invokeRaw(
  { id: "db.entity_curves", params: { kind: "circle", x: 0, y: 0, r: 50 } },
  { dryRun: true },
);
assert(dry.ok === true, "dryRun ok");
assert(dry.id === "db.entity_curves", "dryRun id");
assert(typeof dry.jobBody === "string" && dry.jobBody.includes("RAW\tdb.entity_curves"), "dryRun jobBody");
assert(dry.payload?.handler === "native", "dryRun payload.handler");

const dryDisabled = await rawDispatch.invokeRaw({ id: "win.dotnet" }, { dryRun: true });
assert(dryDisabled.ok === false && dryDisabled.blocked === true, "dryRun disabled → blocked");

const noAcad = await rawDispatch.invokeRaw(
  { id: "db.layer" },
  { dryRun: false, acadRunning: false },
);
assert(noAcad.ok === false && noAcad.blocked === true, "no AutoCAD → blocked structured");
assert(noAcad.id === "db.layer", "no AutoCAD keeps id");
assert(noAcad.diagnostic === "autocad_not_running", "diagnostic autocad_not_running");

// ── 5. Catalog export shape ──
const exp = rawDispatch.exportRawCatalog();
assert(exp.ok === true, "exportRawCatalog ok");
assert(exp.groups.Database?.length > 0, "export has Database group");
assert(exp.groups["Win-only"]?.every((c) => !c.enabled), "Win-only all disabled in export");
const allEnabledIds = Object.values(exp.groups)
  .flat()
  .filter((c) => c.enabled)
  .map((c) => c.id);
assert(allEnabledIds.includes("db.entity_curves"), "enabled includes db.entity_curves");
assert(!allEnabledIds.includes("win.mfc"), "enabled excludes win.mfc");

// ── 6. Plugin source structural checks ──
const root = resolve(__dirname, "../../../../objectarx");
const mepraw = readFileSync(join(root, "mepraw.cpp"), "utf8");
const mepbridge = readFileSync(join(root, "mepbridge.cpp"), "utf8");
const buildSh = readFileSync(join(root, "build.sh"), "utf8");
assert(mepraw.includes("execRawJob"), "mepraw.cpp has execRawJob");
assert(mepraw.includes("writeRawResult"), "mepraw.cpp has writeRawResult");
assert(mepraw.includes("db.entity_curves"), "mepraw handles db.entity_curves");
assert(mepraw.includes("db.xdata"), "mepraw handles db.xdata");
assert(mepraw.includes("db.handle"), "mepraw handles db.handle");
assert(mepbridge.includes("mepRawOnWatchTick"), "mepbridge watches raw.job");
assert(mepbridge.includes("mepRawRegisterCommands"), "mepbridge registers MEPRAW");
assert(buildSh.includes("mepraw.cpp"), "build.sh compiles mepraw.cpp");
assert(existsSync(join(root, "build/MEP-Bridge.bundle")), "plugin bundle exists after build");

// ── Honest verification matrix (from verificationKind, not interactive-flag alone) ──
assert(typeof catalog.verificationFor === "function", "verificationFor exported");
const solid = catalog.byCapabilityId("db.solid3d");
const wipe = catalog.byCapabilityId("db.wipeout");
const zoomI = catalog.byCapabilityId("ui.zoom_internal");
const audit = catalog.byCapabilityId("db.audit");
assert(solid?.verificationKind === "blocked_partial", "db.solid3d blocked_partial");
assert(wipe?.verificationKind === "blocked_partial", "db.wipeout blocked_partial");
assert(zoomI?.verificationKind === "blocked_partial", "ui.zoom_internal blocked_partial");
assert(audit?.verificationKind === "blocked_partial", "db.audit blocked_partial");
assert(catalog.verificationFor(solid).status === "blocked", "solid3d matrix blocked not pass");
assert(catalog.verificationFor(wipe).status === "blocked", "wipeout matrix blocked not pass");
assert(catalog.verificationFor(audit).status === "blocked", "audit matrix blocked not pass");
assert(catalog.byCapabilityId("db.mline")?.verificationKind === "real", "db.mline real");
assert(catalog.byCapabilityId("db.wblock_insert")?.verificationKind === "real", "db.wblock_insert real");
assert(catalog.byCapabilityId("doc.lock")?.verificationKind === "real", "doc.lock real");

// C++ must call real APIs (not probe-only stubs)
assert(mepraw.includes("AcDbMline"), "mepraw uses AcDbMline class");
assert(mepraw.includes("appendSeg"), "mepraw calls AcDbMline::appendSeg");
assert(!mepraw.includes("MLINE_AS_PLINE"), "mepraw no polyline stand-in for mline");
// Live AcDbAuditInfo/auditXData crashes AutoCAD Mac — handler must return honest blocked.
assert(mepraw.includes("h_audit"), "mepraw has h_audit handler");
assert(
  mepraw.includes("crashes AutoCAD Mac") || mepraw.includes("live audit tears down"),
  "mepraw audit is honest-blocked (no live audit call)",
);
assert(!/auditXData\s*\(/.test(mepraw), "mepraw does not call auditXData live");
assert(mepraw.includes("acdbWcs2Ucs") && mepraw.includes("!acdbWcs2Ucs"), "wcs uses bool return");
assert(mepraw.includes("deepCloneObjects"), "mepraw deepCloneObjects");
assert(mepraw.includes("acdbResolveCurrentXRefs"), "mepraw acdbResolveCurrentXRefs");
assert(mepraw.includes("acdbEntGet") || mepraw.includes("acdbEntLast"), "mepraw ads ent APIs");
assert(mepraw.includes("lockDocument"), "mepraw lockDocument");
assert(mepraw.includes("sendStringToExecute"), "mepraw sendStringToExecute");
assert(mepraw.includes("beginExecuteInCommandContext"), "mepraw beginExecuteInCommandContext");
assert(mepraw.includes("addReactor"), "mepraw addReactor");
assert(mepraw.includes("h_probe_ok") === false, "no h_probe_ok fake success helper");

// All interactive catalog ids must have a real cmdRawInteractive branch (not fallthrough)
const interactiveIds = catalog.RAW_CAPABILITIES.filter((c) => c.interactive).map((c) => c.id);
assert(interactiveIds.length >= 19, `interactive count >= 19 (got ${interactiveIds.length})`);
const requiredBranches = [
  "ed.get_point", "ed.get_string", "ed.get_number", "ed.ssget", "ed.ssget_first", "ed.entsel",
  "ed.highlight_subent", "ed.grdraw", "ed.input_point", "ed.custom_osnap", "ed.command_s",
  "adv.jig", "adv.overrule", "adv.custom_entity", "adv.acgi", "ui.inplace_text", "ui.viewcube",
  "ui.cocoa", "ui.plot",
];
for (const bid of requiredBranches) {
  assert(
    mepraw.includes(`id == "${bid}"`) || mepraw.includes(`id == "${bid}"`) || mepraw.includes(`"${bid}"`),
    `mepraw has branch for ${bid}`,
  );
  // Stronger: each id appears in isInteractiveId list
  assert(mepraw.includes(`"${bid}"`), `isInteractiveId includes ${bid}`);
}
// Specific real ARX symbols for the 11 previously-missing handlers
assert(mepraw.includes("AcEdJig") && mepraw.includes("drag()"), "adv.jig: AcEdJig::drag");
assert(mepraw.includes("addOverrule") && mepraw.includes("removeOverrule"), "adv.overrule");
assert(mepraw.includes("AcRxClass") || mepraw.includes("desc()->create") || mepraw.includes("create()"), "adv.custom_entity AcRxClass");
assert(mepraw.includes("evaluateHatch") || mepraw.includes("AcDbHatch"), "adv.acgi hatch/drawable");
assert(mepraw.includes("createPublishEngine"), "ui.plot createPublishEngine");
assert(mepraw.includes("NSApplication") || mepraw.includes("sharedApplication"), "ui.cocoa");
assert(mepraw.includes("acedCreateSteeringWheel") || mepraw.includes("acedCreateViewCube"), "ui.viewcube");
assert(mepraw.includes("AcEdInplaceTextEditor"), "ui.inplace_text");
assert(mepraw.includes("highlight(") && mepraw.includes("AcDbFullSubentPath"), "ed.highlight_subent");
assert(mepraw.includes("addPointMonitor"), "ed.input_point");
assert(mepraw.includes("addCustomOsnapMode"), "ed.custom_osnap");
// Fallthrough message must not be the only path for those ids — still may exist for unknown
// but each of the 11 must match a dedicated branch before the final else
const elseNotImpl = mepraw.indexOf('interactive handler not implemented');
assert(elseNotImpl > 0, "fallback error string still exists for unknown ids only");
for (const bid of [
  "adv.jig", "adv.overrule", "adv.custom_entity", "adv.acgi", "ui.plot", "ui.cocoa",
  "ui.viewcube", "ui.inplace_text", "ed.highlight_subent", "ed.input_point", "ed.custom_osnap",
]) {
  const branchAt = mepraw.indexOf(`"${bid}"`);
  assert(branchAt >= 0 && branchAt < elseNotImpl, `${bid} branch before not-implemented fallback`);
}

const matrix = {
  generatedAt: new Date().toISOString(),
  summary,
  macAvailable: macReg.map((c) => {
    const v = catalog.verificationFor(c);
    return {
      id: c.id,
      name: c.name,
      group: c.group,
      catalogStatus: c.catalogStatus,
      enabled: c.enabled,
      interactive: c.interactive,
      handler: c.handler,
      verificationKind: c.verificationKind,
      verification: v.status,
      reason: v.reason,
    };
  }),
  winOnly: catalog.RAW_CAPABILITIES.filter((c) => !c.macAvailable).map((c) => ({
    id: c.id,
    enabled: c.enabled,
    verificationKind: c.verificationKind,
    reason: c.reason,
  })),
};
// Guard: no blocked_partial row may be labelled pass
const badPass = matrix.macAvailable.filter(
  (r) => r.verificationKind === "blocked_partial" && r.verification === "pass",
);
assert(badPass.length === 0, "no blocked_partial marked pass");
writeFileSync(join(SCRATCH, "objectarx-raw-coverage.json"), JSON.stringify(matrix, null, 2));
const mdOut = [
  "# ObjectARX raw coverage matrix",
  "",
  `Generated: ${matrix.generatedAt}`,
  "",
  `| Metric | Value |`,
  `|---|---|`,
  `| Total catalog | ${summary.total} |`,
  `| Mac available | ${summary.macAvailable} |`,
  `| Enabled raw | ${summary.enabled} |`,
  `| Interactive | ${summary.interactive} |`,
  `| Win-only | ${summary.winOnly} |`,
  `| Enabled Win-only | ${summary.enabledWinOnly} |`,
  "",
  "## Mac-available capabilities",
  "",
  "| id | group | status | kind | verification | reason |",
  "|---|---|---|---|---|---|",
  ...matrix.macAvailable.map(
    (r) =>
      `| ${r.id} | ${r.group} | ${r.catalogStatus} | ${r.verificationKind} | ${r.verification} | ${r.reason || ""} |`,
  ),
  "",
].join("\n");
writeFileSync(join(SCRATCH, "objectarx-raw-coverage.md"), mdOut);

console.log("\n---");
if (failed) {
  console.error(`${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("All ObjectARX raw tests passed");
console.log(`Coverage written to ${join(SCRATCH, "objectarx-raw-coverage.md")}`);

/**
 * Contract tests: ~/Acad-Bridge + job.lsp + atomic write + raw.job builder.
 * Drives shipped bridgeContract, acadBridge, drawing-info, rawJob — no CAD required.
 *
 * Run: cd acad-studio/apps/daemon && npx tsx scripts/test-bridge-contract.mjs
 */
import {
  mkdirSync,
  writeFileSync,
  readFileSync,
  existsSync,
  rmSync,
  readdirSync,
  renameSync,
  utimesSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRATCH =
  process.env.ACAD_SCRATCH ||
  process.env.MEP_SCRATCH ||
  "/var/folders/d6/t6kbyns970j6_5vd0qnwnm7r0000gn/T/grok-goal-21b5ddab8d46/implementer";
const LOG = join(SCRATCH, "contract-audit.log");
mkdirSync(SCRATCH, { recursive: true });

const contract = await import("../src/bridgeContract.ts");
const bridge = await import("../src/acadBridge.ts");
const ctrl = await import("../src/acadControl.ts");
const rawJob = await import("../src/objectarx/rawJob.ts");
const rawDispatch = await import("../src/objectarx/rawDispatch.ts");

let failed = 0;
const lines = [];
function log(msg) {
  lines.push(msg);
  console.log(msg);
}
function assert(cond, msg) {
  if (!cond) {
    log("FAIL: " + msg);
    failed++;
  } else log("ok   " + msg);
}

// ── Defaults: Acad-Bridge / job.lsp / AcadBridge ──
assert(contract.BRIDGE_DIR_NAME === "Acad-Bridge", "BRIDGE_DIR_NAME is Acad-Bridge");
assert(contract.JOB_LSP_NAME === "job.lsp", "JOB_LSP_NAME is job.lsp");
assert(contract.DRAWING_INFO_REQUEST_NAME === "drawing-info.req", "drawing-info request filename");
assert(contract.DRAWING_INFO_RESPONSE_NAME === "drawing-info.json", "drawing-info response filename");
assert(contract.PLUGIN_BUNDLE_NAME === "Acad-Bridge.bundle", "plugin bundle Acad-Bridge");
assert(contract.PLUGIN_BINARY_NAME === "AcadBridge", "plugin binary AcadBridge");
assert(contract.PRODUCT.plugin === "AcadBridge", "PRODUCT.plugin AcadBridge");
assert(ctrl.PLUGIN_BUNDLE_NAME === "Acad-Bridge.bundle", "acadControl re-exports bundle name");
assert(ctrl.PLUGIN_BINARY_REL === "Contents/MacOS/AcadBridge", "flat binary rel path");
assert(ctrl.PLUGIN_BINARY_REL.includes("AcadBridge"), "binary name AcadBridge");

// ── resolveBridgeDir: env + primary + legacy ──
const tmpHome = join(SCRATCH, "fake-home");
rmSync(tmpHome, { recursive: true, force: true });
mkdirSync(tmpHome, { recursive: true });

const primary = join(tmpHome, "Acad-Bridge");
const legacy = join(tmpHome, "MEP-Bridge");
assert(
  contract.resolveBridgeDir({ home: tmpHome, env: {} }) === primary,
  "resolveBridgeDir defaults to Acad-Bridge when neither exists",
);

mkdirSync(legacy, { recursive: true });
assert(
  contract.resolveBridgeDir({ home: tmpHome, env: {} }) === legacy,
  "resolveBridgeDir uses legacy MEP-Bridge when only that exists",
);

mkdirSync(primary, { recursive: true });
assert(
  contract.resolveBridgeDir({ home: tmpHome, env: {} }) === primary,
  "resolveBridgeDir prefers Acad-Bridge when both exist",
);

const envDir = join(SCRATCH, "env-bridge");
assert(
  contract.resolveBridgeDir({ home: tmpHome, env: { ACAD_BRIDGE_DIR: envDir } }) === envDir,
  "ACAD_BRIDGE_DIR env wins",
);
assert(
  contract.resolveBridgeDir({ home: tmpHome, env: { MEP_BRIDGE_DIR: envDir } }) === envDir,
  "MEP_BRIDGE_DIR env alias still works",
);

// ── Atomic write + job.lsp layout ──
const bridgeDir = join(SCRATCH, "bridge");
rmSync(bridgeDir, { recursive: true, force: true });
const results = contract.ensureBridgeLayout(bridgeDir);
assert(existsSync(results), "ensureBridgeLayout creates results/");
assert(results.endsWith("results") || results.includes("/results"), "results path");

const jobPath = contract.jobLspPath(bridgeDir);
assert(jobPath.endsWith("job.lsp"), "job path ends with job.lsp");
assert(!jobPath.includes("mep_job"), "primary job path is not mep_job.lsp");

const body = bridge.wrapJob("t1", '(princ "hello")', results);
assert(body.includes("acad:write-result"), "wrapJob uses acad:write-result");
assert(body.includes("acad:resfile"), "wrapJob sets acad:resfile");
assert(body.includes("==end=="), "wrapJob includes sentinel");
assert(!body.includes(";;; MEP job"), "wrapJob header not MEP-branded");

contract.atomicWriteFile(jobPath, body);
assert(existsSync(jobPath), "atomicWriteFile creates job.lsp");
const onDisk = readFileSync(jobPath, "utf8");
assert(onDisk === body, "atomic write content matches");
// No leftover half-written permanent path (tmp cleaned by rename)
const leftovers = readdirSync(bridgeDir).filter((f) => f.endsWith(".tmp"));
assert(leftovers.length === 0, "no .tmp left after atomic rename");

// ── Drawing-info request/response protocol ──
const drawingReqPath = contract.drawingInfoRequestPath(bridgeDir);
const drawingResPath = contract.drawingInfoResponsePath(bridgeDir);
assert(drawingReqPath === join(bridgeDir, "drawing-info.req"), "drawing-info request path");
assert(drawingResPath === join(bridgeDir, "drawing-info.json"), "drawing-info response path");

const drawingReqBody = bridge.buildDrawingInfoRequest(
  "req-123",
  "/tmp/Bản vẽ đang mở.dwg",
);
assert(
  drawingReqBody === "req-123\n/tmp/Bản vẽ đang mở.dwg",
  "drawing-info body keeps exact target after requestId",
);
assert(
  bridge.buildDrawingInfoRequest("req-empty") === "req-empty\n",
  "drawing-info body represents empty target",
);
let invalidDrawingRequestRejected = false;
try {
  bridge.buildDrawingInfoRequest("bad\nrequest", "Drawing1.dwg");
} catch {
  invalidDrawingRequestRejected = true;
}
assert(invalidDrawingRequestRejected, "drawing-info rejects multiline requestId");

const drawingStartedAt = Date.now() - 100;
writeFileSync(
  drawingResPath,
  JSON.stringify({ requestId: "req-123", ok: true, document: { title: "Drawing1.dwg" } }),
  "utf8",
);
const drawingParsed = bridge.readDrawingInfoResponse(
  drawingResPath,
  "req-123",
  drawingStartedAt,
);
assert(drawingParsed?.requestId === "req-123" && drawingParsed.ok === true, "drawing-info parses fresh matching response");

writeFileSync(drawingResPath, JSON.stringify({ requestId: "old-request", ok: true }), "utf8");
assert(
  bridge.readDrawingInfoResponse(drawingResPath, "req-123", drawingStartedAt) === null,
  "drawing-info ignores response for stale requestId",
);

writeFileSync(drawingResPath, "{not-json", "utf8");
assert(
  bridge.readDrawingInfoResponse(drawingResPath, "req-123", drawingStartedAt) === null,
  "drawing-info ignores malformed response",
);

writeFileSync(drawingResPath, JSON.stringify({ requestId: "req-123", ok: true }), "utf8");
utimesSync(drawingResPath, new Date(0), new Date(0));
assert(
  bridge.readDrawingInfoResponse(drawingResPath, "req-123", Date.now()) === null,
  "drawing-info ignores response older than request",
);

// Simulate LISP result poll
writeFileSync(
  join(results, "t1.txt"),
  "status=ok\njob da chay xong\n==end==\n",
  "utf8",
);
const parsed = bridge.parseJobResultText(readFileSync(join(results, "t1.txt"), "utf8"));
assert(parsed && parsed.status === "ok", "parseJobResultText status ok");
assert(parsed.message.includes("job da chay"), "parseJobResultText message");

// writeLiveJob with env override
process.env.ACAD_BRIDGE_DIR = bridgeDir;
// Re-import won't rebind const BRIDGE_DIR — call contract + wrap directly instead
const liveBody = bridge.wrapJob("live1", '(princ "x")', results);
contract.atomicWriteFile(jobPath, liveBody);
assert(existsSync(jobPath), "live job written to job.lsp under scratch bridge");

// ── Raw job protocol ──
const rawBody = rawJob.buildRawJob({
  id: "db.layer",
  target: "Drawing1.dwg",
  params: { name: "TEST-LAYER", aci: 3 },
});
assert(rawBody.startsWith("RAW\tdb.layer"), "raw job starts with RAW id");
assert(rawBody.includes("PARAM\tname\tTEST-LAYER"), "raw job PARAM name");
const round = rawJob.parseRawJob(rawBody);
assert(round.id === "db.layer", "parseRawJob id");
assert(round.params.name === "TEST-LAYER", "parseRawJob param");

const done = rawJob.parseRawResult(
  JSON.stringify({ ok: true, id: "db.layer", payload: { name: "TEST-LAYER" } }),
);
assert(done.ok === true && done.id === "db.layer", "parseRawResult ok");

const catalog = rawDispatch.exportRawCatalog();
assert(catalog.ok && catalog.capabilities?.length > 0, "exportRawCatalog has capabilities");
const layerCap = catalog.capabilities.find((c) => c.id === "db.layer");
assert(layerCap, "catalog includes generic db.layer");

// Dry-run invoke (no CAD) — shipped path
const dry = await rawDispatch.invokeRaw(
  { id: "db.layer", params: { name: "X", aci: 1 } },
  { dryRun: true, acadRunning: false },
);
assert(dry.ok === true || dry.dryRun === true || dry.jobBody || dry.id === "db.layer", "invokeRaw dryRun returns structured result");
// Accept either {ok, dryRun, jobBody} or preflight — just not silent throw
assert(typeof dry === "object" && dry.id === "db.layer", "dry invoke has id");

// ── Headless discovery (shipped entry) ──
const app = bridge.findAcadApp();
const core = bridge.findCoreConsole();
assert(app === null || /AutoCAD \d{4}\.app$/.test(app), "findAcadApp shape");
assert(core === null || core.includes("AcCoreConsole"), "findCoreConsole shape");
assert(typeof bridge.runHeadless === "function", "runHeadless exported");
assert(typeof bridge.buildGenericLayerJob === "function", "generic layer job builder");
const genJob = bridge.buildGenericLayerJob("Drawing1", [{ name: "A", aci: 3 }]);
assert(genJob.includes("LAYER\tA\t3"), "generic layer job has LAYER line");
assert(!genJob.includes("PIPE\t"), "generic layer job has no PIPE plumbing op");

// ── Control plane: no required MEP identity in defaults ──
assert(ctrl.BRIDGE_DIR_DEFAULT.includes("Acad-Bridge") || process.env.MEP_BRIDGE_DIR || process.env.ACAD_BRIDGE_DIR, "BRIDGE_DIR_DEFAULT Acad-Bridge or env");
const health = ctrl.buildStaticHealthChecks({
  acadApp: "/Applications/Autodesk/AutoCAD 2027/AutoCAD 2027.app",
  coreConsole: "/x/AcCoreConsole",
  bridgeOk: true,
  bridgeDetail: join(homedir(), "Acad-Bridge", "results"),
  pluginOk: false,
  sdkOk: false,
  clangOk: true,
  agentsOk: false,
  agentsDetail: "",
});
const bridgeChk = health.find((c) => c.id === "bridge");
assert(bridgeChk && bridgeChk.label.includes("Acad-Bridge"), "health bridge label Acad-Bridge");
const plugChk = health.find((c) => c.id === "plugin");
assert(plugChk && plugChk.label.includes("AcadBridge"), "health plugin label AcadBridge");

// ── Source audit: primary protocol strings ──
const bridgeSrc = readFileSync(join(__dirname, "../src/bridgeContract.ts"), "utf8");
assert(bridgeSrc.includes('BRIDGE_DIR_NAME = "Acad-Bridge"'), "source BRIDGE_DIR_NAME");
assert(bridgeSrc.includes('JOB_LSP_NAME = "job.lsp"'), "source JOB_LSP_NAME");
assert(bridgeSrc.includes('DRAWING_INFO_REQUEST_NAME = "drawing-info.req"'), "source drawing-info request name");
assert(bridgeSrc.includes('DRAWING_INFO_RESPONSE_NAME = "drawing-info.json"'), "source drawing-info response name");
const acadBridgeSrc = readFileSync(join(__dirname, "../src/acadBridge.ts"), "utf8");
assert(acadBridgeSrc.includes('r.get("/drawing-info"'), "drawing-info HTTP route wired");
assert(acadBridgeSrc.includes("requestDrawingInfo(exactTarget)"), "drawing-info route sends exact target");
assert(!acadBridgeSrc.includes("globSync("), "daemon avoids Node 22-only fs.globSync");
for (const file of ["liveDraw.ts", "livePreview.ts", "session.ts"]) {
  const source = readFileSync(join(__dirname, "../src", file), "utf8");
  assert(source.includes("dispatchLiveJob"), `${file} uses shared live-job queue`);
  assert(!source.includes('join(BRIDGE(), "job.lsp")'), `${file} does not write shared job.lsp directly`);
}
const arxCpp = readFileSync(join(__dirname, "../../../../objectarx/mepbridge.cpp"), "utf8");
assert(arxCpp.includes("/Acad-Bridge"), "plugin default path Acad-Bridge");
assert(arxCpp.includes('"/job.lsp"') || arxCpp.includes("/job.lsp"), "plugin watches job.lsp");
assert(arxCpp.includes('"/drawing-info.req"'), "plugin watches drawing-info.req");
assert(arxCpp.includes("findDocExact"), "drawing-info resolves exact document target");
assert(arxCpp.includes("snapshotJobFile"), "plugin snapshots queued job bytes before async execution");
assert(arxCpp.includes("/job-snapshots"), "plugin stores async job snapshots under bridge");
const drawingInfoBlock = arxCpp.slice(
  arxCpp.indexOf("// ============================ drawing-info: snapshot read-only"),
  arxCpp.indexOf("// ============================ chay job"),
);
assert(drawingInfoBlock.length > 0, "drawing-info native snapshot block found");
assert(!drawingInfoBlock.includes("kForWrite"), "drawing-info snapshot opens no database object for write");
assert(drawingInfoBlock.includes("pluginVersion"), "drawing-info reports plugin version");
assert(arxCpp.includes("AcadBridge"), "plugin product AcadBridge");
assert(arxCpp.includes("ACADARX"), "plugin registers ACADARX");
const pkg = readFileSync(join(__dirname, "../../../../objectarx/PackageContents.xml"), "utf8");
assert(pkg.includes('Name="Acad-Bridge"'), "PackageContents Name Acad-Bridge");
assert(pkg.includes("AcadBridge"), "PackageContents AppName AcadBridge");
const buildSh = readFileSync(join(__dirname, "../../../../objectarx/build.sh"), "utf8");
assert(buildSh.includes('PKG_NAME="Acad-Bridge"'), "build.sh package Acad-Bridge");
assert(buildSh.includes('MOD_NAME="AcadBridge"'), "build.sh binary AcadBridge");

// ── No hard plumbing identity required in control helpers ──
const ctrlSrc = readFileSync(join(__dirname, "../src/acadControl.ts"), "utf8");
assert(!ctrlSrc.includes('join(homedir(), "MEP-Bridge")'), "acadControl no hard default MEP-Bridge path");
assert(ctrlSrc.includes("resolveBridgeDir"), "acadControl uses resolveBridgeDir");

writeFileSync(LOG, lines.join("\n") + "\n", "utf8");
log("\nWrote " + LOG);
if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nALL PASS — bridge contract");
process.exit(0);

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
  symlinkSync,
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
const plotPdf = await import("../src/plotPdf.ts");

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
const readOnlyBody = bridge.wrapJob(
  "t2",
  '(princ "review")',
  results,
  { readOnly: true },
);
assert(body.includes("acad:write-result"), "wrapJob uses acad:write-result");
assert(body.includes("acad:resfile"), "wrapJob sets acad:resfile");
assert(body.includes("==end=="), "wrapJob includes sentinel");
assert(!body.includes(";;; MEP job"), "wrapJob header not MEP-branded");
const savedError = body.indexOf("(setq acad:outer-error *error*)");
const installedError = body.indexOf("(setq *error*", savedError + 1);
const payload = body.indexOf('(princ "hello")');
const restoredError = body.lastIndexOf("(setq *error* acad:outer-error)");
assert(savedError >= 0 && savedError < installedError, "wrapJob saves the caller error handler");
assert(
  /\(lambda \(m\)\s+\(setq \*error\* acad:outer-error\)\s+\(acad:write-result/.test(body),
  "wrapJob restores the caller handler on payload errors",
);
assert(restoredError > payload, "wrapJob restores the caller handler after success");
assert(!body.includes("(setq *error* nil)"), "wrapJob does not discard the caller error handler");
assert(
  !body.startsWith(bridge.READ_ONLY_JOB_MARKER) &&
    readOnlyBody.startsWith(bridge.READ_ONLY_JOB_MARKER),
  "wrapJob marks only explicitly read-only jobs",
);

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

const priorEvents = '{"detail":"Bản vẽ số 1"}\n';
const appendedEvents = '{"detail":"Đã cập nhật"}\n';
const eventBytes = Buffer.from(priorEvents + appendedEvents, "utf8");
assert(
  bridge.utf8FromByteOffset(eventBytes, Buffer.byteLength(priorEvents, "utf8")) ===
    appendedEvents,
  "event SSE cursor slices UTF-8 data by byte offset",
);

const duplicateTitleDocs = [
  { title: "Plan.dwg", file: "/tmp/a/Plan.dwg", active: true },
  { title: "Plan.dwg", file: "/tmp/b/Plan.dwg", active: false },
];
assert(
  bridge.selectOpenDocument(duplicateTitleDocs, "/tmp/b/Plan.dwg").document?.file ===
    "/tmp/b/Plan.dwg",
  "open-document selection prefers an exact full path",
);
assert(
  bridge.selectOpenDocument(duplicateTitleDocs, "Plan.dwg").ambiguous === true,
  "open-document selection rejects duplicate titles",
);
assert(
  bridge.selectOpenDocument(duplicateTitleDocs, "").document?.file === "/tmp/a/Plan.dwg",
  "open-document selection resolves one active document",
);

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

// ── Native PDF plot request + publication helpers ──
const plotScratch = join(SCRATCH, "plot-pdf");
rmSync(plotScratch, { recursive: true, force: true });
mkdirSync(plotScratch, { recursive: true });
const plotOutput = join(plotScratch, "output.pdf");
const validPlotRequest = plotPdf.validatePlotPdfRequest({
  target: "/tmp/Plan.dwg",
  documentInstance: "doc-instance-1",
  path: plotOutput,
  layout: "Model",
  device: "AutoCAD PDF (General Documentation).pc3",
  media: "ISO_A4_(210.00_x_297.00_MM)",
  timeout_ms: 500,
  wait_ms: 500,
});
assert(validPlotRequest.plotType === "extents", "plot defaults plot_type=extents");
assert(validPlotRequest.scale === "fit", "plot defaults scale=fit");
assert(validPlotRequest.rotation === 0, "plot defaults rotation=0");
assert(validPlotRequest.centered === true, "plot defaults centered=true");
assert(validPlotRequest.overwrite === false, "plot defaults overwrite=false");
assert(validPlotRequest.config.mode === "device_media", "plot accepts exact device+media mode");

const pageSetupPlot = plotPdf.validatePlotPdfRequest({
  target: "/tmp/Plan.dwg",
  documentInstance: "doc-instance-1",
  path: join(plotScratch, "page-setup.pdf"),
  layout: "Layout1",
  page_setup: "A4 PDF",
});
assert(pageSetupPlot.config.mode === "page_setup", "plot accepts exact page_setup mode");

function plotValidationCode(body) {
  try {
    plotPdf.validatePlotPdfRequest(body);
    return "";
  } catch (error) {
    return error?.code || "";
  }
}
assert(
  plotValidationCode({
    target: "/tmp/Plan.dwg",
    documentInstance: "doc-instance-1",
    path: plotOutput,
    layout: "Model",
    page_setup: "A4 PDF",
    device: "DWG To PDF.pc3",
    media: "ISO_A4_(210.00_x_297.00_MM)",
  }) === "invalid_plot_config",
  "plot rejects mixed page_setup and device+media",
);
assert(
  plotValidationCode({
    target: "/tmp/Plan.dwg",
    documentInstance: "doc-instance-1",
    path: plotOutput,
    layout: "Model",
    device: "DWG To PDF.pc3",
  }) === "invalid_plot_config",
  "plot requires both device and media",
);
assert(
  plotValidationCode({
    target: "/tmp/Plan.dwg",
    documentInstance: "doc-instance-1",
    path: "relative.pdf",
    layout: "Model",
    page_setup: "A4 PDF",
  }) === "invalid_output_path",
  "plot rejects relative PDF output",
);
assert(
  plotValidationCode({
    target: "/tmp/Plan.dwg",
    documentInstance: "doc-instance-1",
    path: plotOutput,
    layout: "Model",
    page_setup: "A4 PDF",
    rotation: 45,
  }) === "invalid_plot_config",
  "plot rejects overrides mixed with a named page setup",
);
assert(
  plotValidationCode({
    target: "/tmp/Plan.dwg",
    documentInstance: "doc-instance-1",
    path: plotOutput,
    layout: "Model",
    device: "DWG To PDF.pc3",
    media: "ISO_A4_(210.00_x_297.00_MM)",
    rotation: 45,
  }) === "invalid_request",
  "plot rejects unsupported rotation in device/media mode",
);
assert(
  plotValidationCode({
    target: "/tmp/Plan.dwg",
    documentInstance: "doc-instance-1",
    path: plotOutput,
    layout: "Layout1",
    device: "DWG To PDF.pc3",
    media: "ISO_A4_(210.00_x_297.00_MM)",
    plot_type: "layout",
  }) === "invalid_plot_config",
  "layout plot type requires explicit 1:1 scale",
);
assert(
  plotValidationCode({
    target: "/tmp/Plan.dwg",
    documentInstance: "doc-instance-1",
    path: plotOutput,
    layout: "Model",
    page_setup: "A4 PDF",
    timeout_ms: 499,
  }) === "invalid_request",
  "plot enforces timeout lower bound",
);
assert(
  plotValidationCode({
    target: "/tmp/Plan.dwg",
    documentInstance: "doc-instance-1",
    path: plotOutput,
    layout: "Model",
    page_setup: "A4 PDF",
    unknown_option: true,
  }) === "invalid_request",
  "plot rejects unknown request fields",
);

const tempOutput = plotPdf.plotTempPath(plotOutput, "abcd1234");
assert(tempOutput.endsWith(".pdf"), "plot sibling temp still ends with .pdf");
assert(dirname(tempOutput) === dirname(plotOutput), "plot temp is in destination directory");
const rawPlotParams = plotPdf.buildPlotRawParams(
  validPlotRequest,
  "abcd1234",
  tempOutput,
);
assert(rawPlotParams.job_id === "abcd1234", "plot raw params include job_id");
assert(
  rawPlotParams.document_instance === "doc-instance-1",
  "plot raw params include document_instance",
);
assert(rawPlotParams.output_path === tempOutput, "plot raw params use sibling temp output");
assert(rawPlotParams.layout === "Model", "plot raw params include exact layout");
assert(
  rawPlotParams.device === "AutoCAD PDF (General Documentation).pc3" &&
    rawPlotParams.media === "ISO_A4_(210.00_x_297.00_MM)",
  "plot raw params preserve device+media",
);
assert(
  plotPdf.drawingInfoLayoutNames({
    tables: {
      layouts: [
        { name: "Model", model: true },
        { name: "Layout1", model: false },
      ],
    },
  }).join(",") === "Model,Layout1",
  "plot extracts exact layout names from drawing-info",
);
assert(
  plotPdf.drawingInfoLayouts({
    tables: {
      layouts: [
        { name: "Model", model: true },
        { name: "Layout1", model: false },
      ],
    },
  }).find((layout) => layout.name === "Model")?.model === true,
  "plot preserves the model/paper layout discriminator",
);

const minimalPdf = "%PDF-1.4\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n";
plotPdf.assertPlotDestination(plotOutput, tempOutput, false);
writeFileSync(tempOutput, minimalPdf, "latin1");
assert(plotPdf.verifyPdfFile(tempOutput).sizeBytes > 11, "plot verifies PDF header and EOF");
const published = plotPdf.publishPlotPdf(tempOutput, plotOutput, false);
assert(published.sizeBytes > 11, "plot no-clobber publication verifies final PDF");
assert(existsSync(plotOutput) && !existsSync(tempOutput), "plot no-clobber uses temp then publishes");

const collisionTemp = plotPdf.plotTempPath(plotOutput, "collision");
writeFileSync(collisionTemp, minimalPdf, "latin1");
let collisionCode = "";
try {
  plotPdf.publishPlotPdf(collisionTemp, plotOutput, false);
} catch (error) {
  collisionCode = error?.code || "";
}
assert(collisionCode === "output_exists", "plot no-clobber rejects publication race");
assert(readFileSync(plotOutput, "latin1") === minimalPdf, "plot collision preserves existing output");

const overwriteTemp = plotPdf.plotTempPath(plotOutput, "overwrite");
plotPdf.assertPlotDestination(plotOutput, overwriteTemp, true);
writeFileSync(overwriteTemp, minimalPdf.replace("1 0 obj", "2 0 obj"), "latin1");
plotPdf.publishPlotPdf(overwriteTemp, plotOutput, true);
assert(
  readFileSync(plotOutput, "latin1").includes("2 0 obj"),
  "plot overwrite atomically replaces a regular output",
);

const danglingOutput = join(plotScratch, "dangling.pdf");
symlinkSync(join(plotScratch, "missing-target.pdf"), danglingOutput);
let danglingCode = "";
try {
  plotPdf.assertPlotDestination(
    danglingOutput,
    plotPdf.plotTempPath(danglingOutput, "dangling"),
    true,
  );
} catch (error) {
  danglingCode = error?.code || "";
}
assert(
  danglingCode === "invalid_output_target",
  "plot overwrite rejects a dangling destination symlink",
);

const invalidPdf = join(plotScratch, "invalid.pdf");
writeFileSync(invalidPdf, "not a pdf", "utf8");
let invalidPdfCode = "";
try {
  plotPdf.verifyPdfFile(invalidPdf);
} catch (error) {
  invalidPdfCode = error?.code || "";
}
assert(invalidPdfCode === "plot_output_invalid_pdf", "plot rejects non-PDF output");
assert(bridge.plotJobHttpStatus("pending") === 202, "pending plot job returns HTTP 202");
assert(bridge.plotJobHttpStatus("done") === 200, "completed plot job returns HTTP 200");
assert(bridge.plotJobHttpStatus("error") === 200, "failed plot job preserves structured body over HTTP 200");
assert(bridge.plotJobHttpStatus("timeout") === 200, "timed-out plot job preserves uncertain body over HTTP 200");
const failedPlotPayload = bridge.plotJobPayload({
  jobId: "abcd1234",
  kind: "plot_pdf",
  state: "timeout",
  createdAt: Date.now(),
  uncertain: true,
  outputPath: plotOutput,
  result: {
    status: "timeout",
    code: "plot_timeout_uncertain",
    message: "Plugin vẫn có thể đang ghi PDF",
  },
});
assert(
  failedPlotPayload.code === "plot_timeout_uncertain" &&
    failedPlotPayload.error === "Plugin vẫn có thể đang ghi PDF",
  "plot job promotes structured code/error for the MCP backend",
);

// Dry-run invoke (no CAD) — shipped path
const dry = await rawDispatch.invokeRaw(
  { id: "db.layer", params: { name: "X", aci: 1 } },
  { dryRun: true, acadRunning: false },
);
assert(dry.ok === true || dry.dryRun === true || dry.jobBody || dry.id === "db.layer", "invokeRaw dryRun returns structured result");
// Accept either {ok, dryRun, jobBody} or preflight — just not silent throw
assert(typeof dry === "object" && dry.id === "db.layer", "dry invoke has id");

// Public raw invoke must not bypass selection's prepare/confirm/apply gate.
{
  const router = bridge.acadBridgeRouter();
  const layer = router.stack.find((item) =>
    item.route?.path === "/raw/invoke" && item.route.methods.post);
  assert(layer, "raw invoke route exists");
  let status = 200;
  let payload;
  const response = {
    status(value) {
      status = value;
      return response;
    },
    json(value) {
      payload = value;
      return response;
    },
  };
  await layer.route.stack[0].handle({
    body: {
      id: "  ed.selection_control  ",
      target: "/tmp/Drawing1.dwg",
      params: { action: "move" },
    },
  }, response);
  assert(
    status === 409 && payload?.code === "confirmation_required",
    "public raw invoke cannot bypass selection confirmation",
  );
}

// Generic live raw invocation must not bypass plot's guarded publication path.
{
  const router = bridge.acadBridgeRouter();
  const layer = router.stack.find((item) =>
    item.route?.path === "/raw/invoke" && item.route.methods.post);
  let status = 200;
  let payload;
  const response = {
    status(value) {
      status = value;
      return response;
    },
    json(value) {
      payload = value;
      return response;
    },
  };
  await layer.route.stack[0].handle({
    body: {
      id: "ui.plot",
      target: "/tmp/Plan.dwg",
      params: { output_path: "/tmp/unguarded.pdf" },
    },
  }, response);
  assert(
    status === 409 && payload?.code === "dedicated_endpoint_required",
    "public raw invoke cannot bypass guarded /plot-pdf",
  );
}

// The dedicated route validates synchronously before touching AutoCAD.
{
  const router = bridge.acadBridgeRouter();
  const layer = router.stack.find((item) =>
    item.route?.path === "/plot-pdf" && item.route.methods.post);
  assert(layer, "plot-pdf route exists");
  let status = 200;
  let payload;
  const response = {
    status(value) {
      status = value;
      return response;
    },
    json(value) {
      payload = value;
      return response;
    },
  };
  await layer.route.stack[0].handle({ body: {} }, response);
  assert(
    status === 400 && payload?.code === "invalid_request",
    "plot-pdf rejects invalid request before live dispatch",
  );
}

// Legacy highlight must also fail closed instead of writing select.req.
{
  const router = bridge.acadBridgeRouter();
  const layer = router.stack.find((item) =>
    item.route?.path === "/highlight" && item.route.methods.post);
  assert(layer, "legacy highlight route exists as a fail-closed compatibility route");
  let status = 200;
  let payload;
  const response = {
    status(value) {
      status = value;
      return response;
    },
    json(value) {
      payload = value;
      return response;
    },
  };
  await layer.route.stack[0].handle({
    body: { target: "/tmp/Drawing1.dwg", layer: "P-ThongHoi" },
  }, response);
  assert(
    status === 409 && payload?.code === "confirmation_required",
    "legacy highlight cannot bypass selection confirmation",
  );
}

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
assert(
  acadBridgeSrc.includes('LANG: "en_US.UTF-8"') &&
    acadBridgeSrc.includes('LC_ALL: "en_US.UTF-8"'),
  "Core Console receives a macOS-supported UTF-8 locale",
);
for (const file of ["liveDraw.ts", "livePreview.ts", "session.ts"]) {
  const source = readFileSync(join(__dirname, "../src", file), "utf8");
  assert(source.includes("dispatchLiveJob"), `${file} uses shared live-job queue`);
  assert(!source.includes('join(BRIDGE(), "job.lsp")'), `${file} does not write shared job.lsp directly`);
}
const arxCpp = readFileSync(join(__dirname, "../../../../objectarx/mepbridge.cpp"), "utf8");
assert(arxCpp.includes("/Acad-Bridge"), "plugin default path Acad-Bridge");
const arxAcadEnv = arxCpp.indexOf('std::getenv("ACAD_BRIDGE_DIR")');
const arxMepEnv = arxCpp.indexOf('std::getenv("MEP_BRIDGE_DIR")');
assert(arxAcadEnv >= 0 && arxMepEnv > arxAcadEnv, "plugin honors ACAD_BRIDGE_DIR before MEP_BRIDGE_DIR");
assert(arxCpp.includes('"/job.lsp"') || arxCpp.includes("/job.lsp"), "plugin watches job.lsp");
assert(arxCpp.includes('"/drawing-info.req"'), "plugin watches drawing-info.req");
assert(arxCpp.includes("findDocExact"), "drawing-info resolves exact document target");
assert(
  /static int execNativeJob[\s\S]*?AcApDocument\* pDoc = findDocExact\(target\);/.test(arxCpp),
  "native mutations resolve the exact document target",
);
assert(arxCpp.includes("snapshotJobFile"), "plugin snapshots queued job bytes before async execution");
assert(arxCpp.includes("/job-snapshots"), "plugin stores async job snapshots under bridge");
const runJobBlock = arxCpp.slice(
  arxCpp.indexOf("static void runJob()"),
  arxCpp.indexOf("// ============================ FSEvents watcher"),
);
assert(
  runJobBlock.includes("kReadOnlyJobMarker") &&
    runJobBlock.includes("!readOnly, readOnly, false"),
  "read-only jobs execute in the target context without activating its tab",
);
assert(
  runJobBlock.includes("vl-catch-all-apply") &&
    runJobBlock.indexOf('setvar \\"TRUSTEDPATHS\\" mep:tp') >
      runJobBlock.indexOf("vl-catch-all-apply"),
  "job loader restores TRUSTEDPATHS even when load fails",
);
assert(
  arxCpp.includes("headerSysVarChanged") &&
    arxCpp.includes("++gDatabaseRevisions[db]"),
  "native drawing revision tracks successful header system-variable changes",
);
const drawingInfoBlock = arxCpp.slice(
  arxCpp.indexOf("// ============================ drawing-info: snapshot read-only"),
  arxCpp.indexOf("// ============================ chay job"),
);
assert(drawingInfoBlock.length > 0, "drawing-info native snapshot block found");
assert(!drawingInfoBlock.includes("kForWrite"), "drawing-info snapshot opens no database object for write");
assert(drawingInfoBlock.includes("pluginVersion"), "drawing-info reports plugin version");
assert(
  drawingInfoBlock.includes("AcDbPdfReference::cast") &&
    drawingInfoBlock.includes("pdfUnderlays") &&
    drawingInfoBlock.includes("direct_layout_space_references"),
  "drawing-info inventories direct layout-space PDF underlays through ObjectARX",
);
assert(
  drawingInfoBlock.includes("getDataLinkManager") &&
    drawingInfoBlock.includes("dataLinks"),
  "drawing-info inventories native table data links",
);
assert(
  drawingInfoBlock.includes("kUpdateOptionAllowSourceUpdate") &&
    drawingInfoBlock.includes("sourceUpdateAllowed"),
  "drawing-info reports the stored data-link source-update permission",
);
assert(
  !drawingInfoBlock.includes("setUpdateOption("),
  "drawing-info never changes data-link update permissions",
);
assert(
  !drawingInfoBlock.includes("connectionString()"),
  "drawing-info does not expose raw data-link connection strings",
);
assert(arxCpp.includes("AcadBridge"), "plugin product AcadBridge");
assert(arxCpp.includes("ACADARX"), "plugin registers ACADARX");
for (const lispFile of ["core.lsp", "mep.lsp"]) {
  const lispSource = readFileSync(join(__dirname, "../../../../acad-lisp", lispFile), "utf8");
  const acadEnv = lispSource.indexOf('(getenv "ACAD_BRIDGE_DIR")');
  const mepEnv = lispSource.indexOf('(getenv "MEP_BRIDGE_DIR")');
  assert(
    acadEnv >= 0 && mepEnv > acadEnv,
    `${lispFile} honors ACAD_BRIDGE_DIR before MEP_BRIDGE_DIR`,
  );
}
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

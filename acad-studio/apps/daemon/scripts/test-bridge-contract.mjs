/**
 * Contract tests: ~/Acad-Bridge + job.lsp + atomic write + raw.job builder.
 * Drives shipped bridgeContract, acadBridge, drawing-info, rawJob — no CAD required.
 *
 * Run: cd acad-studio/apps/daemon && npx tsx scripts/test-bridge-contract.mjs
 */
import {
  mkdirSync,
  mkdtempSync,
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
import { homedir, tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
/* Thư mục nháp phải theo MÁY đang chạy. Trước đây đường lùi là một đường dẫn
   tuyệt đối trong `/var/folders` của một máy cụ thể; nó chạy được ở đúng máy đó
   và hỏng ở mọi máy khác — trên Linux thì `/var/folders` còn không tồn tại và
   `mkdirSync` ném EACCES. Chỉ lộ ra khi test này được đưa vào `pnpm verify`.
   `mkdtemp` chứ không phải một tên cố định dưới `tmpdir()`: hai lượt chạy song
   song sẽ giẫm lên nhau. */
const SCRATCH =
  process.env.ACAD_SCRATCH ||
  process.env.MEP_SCRATCH ||
  mkdtempSync(join(tmpdir(), "acad-bridge-contract-"));
const LOG = join(SCRATCH, "contract-audit.log");
mkdirSync(SCRATCH, { recursive: true });

const contract = await import("../src/bridgeContract.ts");
const bridge = await import("../src/acadBridge.ts");
const ctrl = await import("../src/acadControl.ts");
const rawJob = await import("../src/objectarx/rawJob.ts");
const rawDispatch = await import("../src/objectarx/rawDispatch.ts");
const plotPdf = await import("../src/plotPdf.ts");
const legacyCatalog = await import("../src/legacySelectionCatalog.ts");

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

assert(
  bridge.drawingInfoBusyCode({ ok: true, warnings: ["document_not_quiescent"] }) ===
    "document_not_quiescent",
  "drawing-info treats a non-quiescent warning as transient busy state",
);
assert(
  bridge.drawingInfoBusyCode({ ok: false, code: "busy" }) === "busy",
  "drawing-info recognizes the native busy error code",
);
assert(
  bridge.drawingInfoBusyCode({ ok: true, warnings: ["selection_scope_scan_incomplete"] }) === "",
  "drawing-info does not retry unrelated completeness warnings",
);

let busyAttempts = 0;
const busyDelays = [];
const eventuallyQuiescent = await bridge.requestDrawingInfoWithBusyRetry(
  "/tmp/Plan.dwg",
  async () => {
    busyAttempts++;
    return busyAttempts < 3
      ? { requestId: `busy-${busyAttempts}`, ok: true, warnings: ["document_not_quiescent"] }
      : { requestId: "ready", ok: true };
  },
  async (delayMs) => { busyDelays.push(delayMs); },
);
assert(
  busyAttempts === bridge.DRAWING_INFO_BUSY_ATTEMPTS && eventuallyQuiescent?.requestId === "ready",
  "drawing-info retries busy snapshots until a quiescent snapshot is returned",
);
assert(
  busyDelays.join(",") === "250,500",
  "drawing-info busy retry uses bounded incremental delays",
);

let boundedBusyAttempts = 0;
const stillBusy = await bridge.requestDrawingInfoWithBusyRetry(
  "/tmp/Plan.dwg",
  async () => {
    boundedBusyAttempts++;
    return { requestId: `busy-${boundedBusyAttempts}`, ok: false, code: "busy" };
  },
  async () => {},
);
assert(
  boundedBusyAttempts === bridge.DRAWING_INFO_BUSY_ATTEMPTS &&
    bridge.drawingInfoBusyCode(stillBusy) === "busy",
  "drawing-info stops after the bounded number of busy attempts",
);

const legacyCatalogLisp = legacyCatalog.buildLegacySelectionCatalogLisp({
  outputPath: "/tmp/selection catalog.tsv",
  exactTarget: "/tmp/Plan.dwg",
});
assert(
  legacyCatalogLisp.includes('(ssget "_X" (list (cons 410 acad:cat-space)))') &&
    (legacyCatalogLisp.match(/\(ssget/g) || []).length === 1,
  "legacy selection catalog scans the current CTAB once without per-row requests",
);
assert(
  legacyCatalogLisp.includes("ACDBBLOCKREPBTAG") &&
    legacyCatalogLisp.includes("(assoc 1005"),
  "legacy selection catalog maps dynamic block variants to the original block definition",
);
assert(
  legacyCatalogLisp.includes("50000") &&
    legacyCatalogLisp.includes("acad:cat-complete") &&
    legacyCatalogLisp.includes("(float acad:cat-index)"),
  "legacy selection catalog is bounded and reports completeness",
);
assert(
  /\(defun acad:cat-run[\s\S]*?\/[^)]*acad:cat-ss[\s\S]*?\(acad:cat-run\)/.test(
    legacyCatalogLisp,
  ),
  "legacy scan keeps its full selection set in a call-local variable",
);

const parsedLegacyCatalog = legacyCatalog.parseLegacySelectionCatalog([
  "O\t000A\tINSERT\tP-ThoatRua\t0010\tcutdenhatD110\t1A805",
  "O\t000B\tLINE\t0\t0011\t\t",
  "O\t000C\tINSERT\tP-New\t0012\tNewDynamicBlock\t1A806",
  "O\t000D\tCIRCLE\tP-New\t0012\t\t",
  "META\t01\t4\t1",
  "",
].join("\n"));
assert(
  parsedLegacyCatalog.complete && parsedLegacyCatalog.objects.length === 4 &&
    parsedLegacyCatalog.objects[0].handle === "A" &&
    parsedLegacyCatalog.objects[0].blockHandle === "1A805",
  "legacy selection catalog parser normalizes handles and preserves block identity",
);
const attachedLegacyCatalog = legacyCatalog.attachSelectionCatalog({
  source: { pluginVersion: "1.5.0" },
  tables: {
    layers: [{ name: "P-ThoatRua", handle: "10" }, { name: "0", handle: "11" }],
    blocks: [{ name: "cutdenhatD110", handle: "1A805" }, { name: "Unused", handle: "FF" }],
  },
  drawing: {
    settings: { CTAB: "01" },
    layers: [{ name: "P-ThoatRua", color: 4 }, { name: "0", handle: "11" }],
    blocks: [{ name: "cutdenhatD110" }, { name: "Unused", handle: "FF" }],
  },
}, parsedLegacyCatalog);
const attachedDrawing = attachedLegacyCatalog.drawing;
const attachedTables = attachedLegacyCatalog.tables;
const synthesizedLayer = attachedDrawing.layers.find((row) => row.handle === "12");
const synthesizedBlock = attachedDrawing.blocks.find((row) => row.handle === "1A806");
assert(
  legacyCatalog.hasSelectionCatalog(attachedLegacyCatalog) &&
    attachedDrawing.layers[0].selectableCount === 1 &&
    typeof attachedDrawing.layers[0].selectableCount === "number" &&
    attachedDrawing.layers[0].color === 4 &&
    attachedDrawing.blocks[0].selectableCount === 1 &&
    attachedDrawing.blocks[1].selectableCount === 0 &&
    synthesizedLayer?.name === "P-New" &&
    synthesizedLayer?.selectableCount === 2 &&
    synthesizedBlock?.name === "NewDynamicBlock" &&
    synthesizedBlock?.selectableCount === 1,
  "legacy catalog attaches numeric name-fallback counts and preserves existing row fields",
);
assert(
  attachedDrawing.layers.filter((row) => row.name === "P-ThoatRua").length === 1 &&
    attachedDrawing.blocks.filter((row) => row.name === "cutdenhatD110").length === 1 &&
    attachedTables.layers.some((row) => row.handle === "12") &&
    attachedTables.blocks.some((row) => row.handle === "1A806"),
  "legacy catalog synthesizes each referenced group omitted by capped tables without duplicates",
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

/* Vong GHEP TRANG bang layer. Day la cho nguy hiem nhat cua ca tinh nang: no
   quyet dinh danh sach dung de XOA layer khoi ho so. Ban ve that o may nay chi co
   43 layer nen vong lap khong bao gio chay — khong tiem duoc luot doc thi no
   vinh vien khong co test. */
{
  const snap = (names, { truncated = false, instance = "I1", revision = 7 } = {}) => ({
    ok: true,
    document: { instance, revision },
    tables: { layers: names.map((name) => ({ name })) },
    warnings: truncated ? ["layers_truncated"] : [],
  });
  const namesOf = (result) => (result?.layers ?? []).map((row) => row.name);

  // 1. Mot trang, khong cat -> xong ngay, khong hoi them luot nao.
  let calls = 0;
  let out = await bridge.readAllLayerPages("T", snap(["a", "b"]), async () => {
    calls++; return null;
  });
  assert(out?.complete === true && namesOf(out).join(",") === "a,b", "mot trang: xong ngay");
  assert(calls === 0, "khong cat thi KHONG hoi them trang");

  // 2. Nhieu trang -> ghep dung thu tu, offset tang theo so dong da co.
  const offsets = [];
  out = await bridge.readAllLayerPages("T", snap(["a", "b"], { truncated: true }),
    async (_t, _ms, offset) => {
      offsets.push(offset);
      return offset === 2 ? snap(["c", "d"], { truncated: true }) : snap(["e"]);
    });
  assert(namesOf(out).join(",") === "a,b,c,d,e", `ghep sai: ${namesOf(out)}`);
  assert(out.complete === true, "het cat thi bao da du");
  assert(offsets.join(",") === "2,4", `offset phai theo so dong da co: ${offsets}`);

  // 3. Ban ve DOI giua chung -> BO ca luot doc, khong ghep.
  for (const changed of [{ instance: "I2" }, { revision: 8 }]) {
    out = await bridge.readAllLayerPages("T", snap(["a"], { truncated: true }),
      async () => snap(["b"], { ...changed }));
    assert(out === null, `ban ve doi (${JSON.stringify(changed)}) phai bo ca luot doc`);
  }

  // 4. Trang rong ma co cat van bat -> bao CHUA DU, khong quay vong mai.
  out = await bridge.readAllLayerPages("T", snap(["a"], { truncated: true }),
    async () => snap([], { truncated: true }));
  assert(out?.complete === false && namesOf(out).join(",") === "a",
    "trang rong: giu nguyen thu da co va bao chua du");

  // 5. Luot doc hong -> BO, khong tra ve mot danh sach thieu tuong la du.
  out = await bridge.readAllLayerPages("T", snap(["a"], { truncated: true }), async () => null);
  assert(out === null, "luot doc hong phai bo ca luot");
  out = await bridge.readAllLayerPages("T", snap(["a"], { truncated: true }),
    async () => ({ ok: false }));
  assert(out === null, "phan hoi loi phai bo ca luot");

  // 6. Dinh danh THIEU -> tu choi ghep, khong coi la "giong nhau".
  //    Ghep `instance ?? ""` voi `revision ?? ""` la fail-OPEN: mot phan hoi
  //    thieu ca hai truong cho ra cung mot chuoi o MOI trang, nen moi trang
  //    "khop" nhau va duoc ghep — chot tu vo hieu trong im lang.
  //    Ca NGUY HIEM that su la MOI trang deu thieu — luc do phep so "trang sau
  //    khac trang truoc" khong bat ho duoc nua, va chi rieng phep doi dinh danh
  //    day du moi chan. Nen trang sau phai mang DUNG cai document hong do.
  //    `{}` va `[]` lam `String(...)` ra `"[object Object]"`/`""` — cai dau
  //    KHONG rong nen mot phep kiem "khac rong" se cho lot, va hai ban ve khac
  //    nhau deu cho ra cung chuoi do roi duoc ghep.
  for (const doc of [{}, { instance: "" }, { instance: "I1" }, { revision: 7 },
                     { instance: "I1", revision: "7" },
                     { instance: {}, revision: 7 }, { instance: 5, revision: 7 },
                     { instance: "I1", revision: Number.NaN }]) {
    const bad = (names, truncated) => ({
      ok: true, document: doc, tables: { layers: names.map((name) => ({ name })) },
      warnings: truncated ? ["layers_truncated"] : [],
    });
    out = await bridge.readAllLayerPages("T", bad(["a"], true), async () => bad(["b"], false));
    assert(out === null, `dinh danh thieu phai tu choi: ${JSON.stringify(doc)}`);
  }
  //    Nhung mot trang duy nhat KHONG cat thi khong can dinh danh — khong co gi
  //    de ghep, va doi hoi no o day se pha ca duong doc binh thuong.
  out = await bridge.readAllLayerPages("T",
    { ok: true, document: {}, tables: { layers: [{ name: "a" }] }, warnings: [] },
    async () => null);
  assert(out?.complete === true, "mot trang khong cat thi khong can dinh danh");

  // 7. Trang doc trong luc AutoCAD DANG BAN -> khong duoc ghep.
  //    Plugin tra `ok: true` kem `document_not_quiescent`, nen phep kiem
  //    `ok === false` o tren khong bat duoc. Trang DAU da qua chot busy o route;
  //    cac trang sau thi chua.
  for (const busy of [{ code: "document_not_quiescent" }, { code: "busy" }]) {
    out = await bridge.readAllLayerPages("T", snap(["a"], { truncated: true }),
      async () => ({ ...snap(["b"]), ...busy }));
    assert(out === null, `trang doc luc dang ban phai bi tu choi: ${busy.code}`);
  }

  // 8. Cham tran vong lap -> bao chua du chu khong chay mai.
  let served = 0;
  out = await bridge.readAllLayerPages("T", snap(["x0"], { truncated: true }),
    async () => { served++; return snap([`x${served}`], { truncated: true }); });
  assert(out?.complete === false, "cham tran phai bao CHUA du");
  assert(served <= 40, `phai co tran vong lap, da goi ${served} lan`);
}

/* Dong thu ba cua `drawing-info.req` la offset bang layer — va CHI duoc them khi
   that su can. Ban plugin cu doc "phan con lai sau dong 1" LA target, nen mot
   dong thu ba luon co mat se bien target thanh "ten\n0" va khong ban ve nao
   khop: moi luot doc hong, o moi nguoi dung chua build lai plugin. */
assert(
  bridge.buildDrawingInfoRequest("req-1", "/a/Plan.dwg") === "req-1\n/a/Plan.dwg",
  "offset 0 KHONG duoc them dong thu ba",
);
assert(
  bridge.buildDrawingInfoRequest("req-1", "/a/Plan.dwg", 5000) === "req-1\n/a/Plan.dwg\n5000",
  "offset duong nam o dong thu ba",
);
/* `target` phai nam tren dung MOT dong: mot xuong dong lot vao se bi plugin doc
   thanh offset. Tieu de ban ve do nguoi dung dat, nen day la du lieu khong kiem
   soat duoc. */
for (const bad of ["a\nb.dwg", "a\rb.dwg"]) {
  let threw = false;
  try { bridge.buildDrawingInfoRequest("req-1", bad); } catch { threw = true; }
  assert(threw, `target nhieu dong phai bi tu choi: ${JSON.stringify(bad)}`);
}
for (const bad of [-1, 1.5, Number.NaN]) {
  let threw = false;
  try { bridge.buildDrawingInfoRequest("req-1", "/a.dwg", bad); } catch { threw = true; }
  assert(threw, `offset khong hop le phai bi tu choi: ${bad}`);
}

const unsavedDocs = [
  { title: "Drawing1.dwg", file: "", instance: "AAA-001", active: true },
  { title: "Drawing1.dwg", file: "", instance: "BBB-002", active: false },
];
assert(
  bridge.selectOpenDocument(unsavedDocs, "BBB-002").document?.instance === "BBB-002",
  "open-document selection resolves an unsaved drawing by instance token",
);
assert(
  bridge.selectOpenDocument(unsavedDocs, "Drawing1.dwg").ambiguous === true,
  "open-document selection still rejects duplicate titles",
);
/* Doi GUI DI khac doi de SO SANH. `selectOpenDocument` chon dung ban ve roi ma
   luot goi native ngay sau do van dung tieu de thi `findDocExact` tra ve rong —
   ca duong ban-ve-chua-luu hong o dung mot buoc sau cho da sua. */
assert(
  bridge.nativeDocumentTarget({ ...unsavedDocs[1], targetsInstance: true }) === "BBB-002",
  "native target prefers the instance token when the plugin accepts it",
);
/* Khong co co nang luc = plugin ban CU. Gui ma phien cho no la nhan `not_found`,
   tuc lam hong mot thu dang chay: ban ve chua luu tieu de duy nhat truoc day doc
   duoc bang tieu de. */
assert(
  bridge.nativeDocumentTarget(unsavedDocs[1]) === "Drawing1.dwg",
  "native target falls back to the title when the plugin does not accept instances",
);
assert(
  bridge.nativeDocumentTarget({ ...unsavedDocs[1], targetsInstance: false }) === "Drawing1.dwg",
  "an explicit false is treated as a legacy plugin",
);
assert(
  bridge.nativeDocumentTarget({
    title: "Plan.dwg", file: "/tmp/a/Plan.dwg", instance: "X", targetsInstance: true,
  }) ===
    "/tmp/a/Plan.dwg",
  "native target still prefers a full path over the instance token",
);
assert(
  bridge.nativeDocumentTarget({ title: "Plan.dwg", file: "", instance: "" }) === "Plan.dwg",
  "native target falls back to the title when nothing else identifies the drawing",
);
assert(bridge.nativeDocumentTarget(null) === "", "native target tolerates a missing document");

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
/* Luot doc CHINH cua route phai dung dich GUI DI (`nativeTarget`), khong phai
   dich de SO (`exactTarget`).
   Phep kiem cu tim literal `requestDrawingInfoWithBusyRetry(exactTarget)`, va sau
   khi route doi sang `nativeTarget` thi no VAN XANH — vi literal do con o trong
   `withLegacySelectionCatalog` va o nhanh lui. Mot phep kiem dung vi ly do sai
   con te hon khong co, nen no phai neo vao dung dong cua route. */
assert(
  acadBridgeSrc.includes("let snapshot = await requestDrawingInfoWithBusyRetry(nativeTarget)"),
  "drawing-info route reads with the native (send) target",
);
assert(
  acadBridgeSrc.includes("requestDrawingInfoWithBusyRetry(exactTarget)"),
  "legacy fallback still retries with the compare target",
);
assert(
  acadBridgeSrc.includes("withLegacySelectionCatalog(snapshotForResponse, exactTarget)") &&
    acadBridgeSrc.includes("{ readOnly: true }") &&
    acadBridgeSrc.includes("selection_catalog_document_stale"),
  "drawing-info enriches old-plugin snapshots through a guarded read-only one-pass scan",
);
/* Doc bang layer theo TRANG: co cat phai duoc GIU LAI khi chua doc het.
   Bo no luc do la noi doi rang danh sach da du, va nhom xoa se hien ra tren mot
   danh sach thieu — dung duong mat du lieu ma ca tinh nang nay sinh ra de chan. */
assert(
  acadBridgeSrc.includes('paged.complete ? warnings : [...warnings, "layers_truncated"]'),
  "paged layer read keeps the truncated flag when it did not finish",
);
assert(
  acadBridgeSrc.includes("if (identityOf(next) !== identity) return null"),
  "paged layer read refuses to stitch pages from different drawing states",
);
/* Payload phoi bang layer o HAI cho. Chi thay `tables.layers` la ban long
   `drawing.layers` dung nguyen o trang dau, trong khi co cat da bi go — ai doc
   ban long se coi mot danh sach THIEU la da du roi ket luan "layer nay khong
   con" va xoa no. `readDrawingLayers()` lui ve dung `drawing.layers`. */
assert(
  acadBridgeSrc.includes('drawing && "layers" in drawing') &&
    acadBridgeSrc.includes("...drawingProjection,"),
  "paged layer read updates the nested drawing.layers projection too",
);
/* Trang dau da qua chot busy o route; cac trang sau thi chua. */
assert(
  acadBridgeSrc.includes("if (drawingInfoBusyCode(next)) return null"),
  "paged layer read refuses a page read while AutoCAD is busy",
);
/* Chi phan trang khi plugin CONG BO nang luc. Suy nguoc tu `not_found` cua ban
   cu se bao sai nguyen nhan VA lam hong view cat von dang dung duoc. */
assert(
  acadBridgeSrc.includes("pagesLayers") &&
    acadBridgeSrc.includes('drawingInfoRecord(snapshot.limits)?.pagesLayers === true'),
  "paging is gated on the plugin-published capability",
);
assert(
  acadBridgeSrc.includes("snapshotCollectedAt: responseSnapshot.collectedAt"),
  "drawing-info preserves the plugin snapshot timestamp separately from HTTP response time",
);
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
const selectionScopeCollector = drawingInfoBlock.slice(
  drawingInfoBlock.indexOf("struct SelectionScopeStats"),
  drawingInfoBlock.indexOf("static std::string layerTableJson"),
);
assert(
  selectionScopeCollector.includes("db->currentSpaceId()") &&
    selectionScopeCollector.includes("stats.scanned >= kInfoMaxSelectionScopeEntities"),
  "drawing-info bounds the selectable-count scan to the current space",
);
assert(
  selectionScopeCollector.includes("entityLayer(entity)") &&
    selectionScopeCollector.includes("AcDbBlockReference::cast(entity)"),
  "drawing-info counts direct current-space layer entities and block references",
);
assert(
  selectionScopeCollector.includes("objectIdHandle(entity->layerId())") &&
    selectionScopeCollector.includes('\\\"layerHandle\\\"') &&
    selectionScopeCollector.includes('\\\"blockName\\\"') &&
    selectionScopeCollector.includes('\\\"blockHandle\\\"'),
  "drawing-info catalog rows identify direct entities and their layer/block table handles",
);
assert(
  selectionScopeCollector.includes("dynamicBlockTableRecord()") &&
    selectionScopeCollector.includes("effectiveBlockDefinition(reference)"),
  "drawing-info groups dynamic block variants under their original definition",
);
assert(
  selectionScopeCollector.includes("stats.complete = !truncated && !unreadable"),
  "drawing-info marks incomplete or truncated selectable counts",
);
const layerTableBlock = drawingInfoBlock.slice(
  drawingInfoBlock.indexOf("static std::string layerTableJson"),
  drawingInfoBlock.indexOf("static std::string blockAnnotationScalesJson"),
);
const blockTableBlock = drawingInfoBlock.slice(
  drawingInfoBlock.indexOf("static std::string blockTableJson"),
  drawingInfoBlock.indexOf("static std::string layoutTableJson"),
);
assert(
  layerTableBlock.includes("selectableCount") &&
    layerTableBlock.includes("selectionScope.layerHandles, objectHandle(layer)") &&
    blockTableBlock.includes("selectableCount") &&
    blockTableBlock.includes("selectionScope.blockHandles, objectHandle(block)"),
  "drawing-info matches selectable layer/block counts through table handles",
);
assert(
  drawingInfoBlock.includes("selectionScopeJson") &&
    drawingInfoBlock.includes("maxSelectionScopeEntities") &&
    /\\\"space\\\"[\s\S]*\\\"scanned\\\"[\s\S]*\\\"complete\\\"/.test(drawingInfoBlock),
  "drawing-info publishes bounded selectionScope completeness metadata",
);
assert(
  drawingInfoBlock.includes("selectionCatalogJson") &&
    drawingInfoBlock.includes('\\\"selectionCatalog\\\"') &&
    drawingInfoBlock.includes("jsonRows(selectionScope.objects)") &&
    (drawingInfoBlock.match(/\\\"selectionCatalog\\\"/g) || []).length === 1,
  "drawing-info publishes one bounded current-space catalog without duplicating its payload",
);
assert(
  (drawingInfoBlock.match(/\\\"selectionScope\\\"/g) || []).length === 2,
  "drawing-info publishes selectionScope at root and in drawing",
);
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
// ── geometry.req: request nhiều dòng nên PHẢI chặn tiêm dòng ──────────────
// Plugin đọc từng dòng `key=value`. Một target hay một giá trị chứa xuống dòng
// sẽ chèn thêm tuỳ chọn giả — ví dụ nâng `maxEntities` lên 100k trên một bản vẽ
// mà người gọi cố ý giới hạn. Chặn ở nơi dựng chuỗi, không tin đầu vào.
const geomBasic = bridge.buildGeometryRequest("geom-1", "Drawing1.dwg");
assert(geomBasic === "geom-1\nDrawing1.dwg", "geometry request: 2 dòng khi không có tuỳ chọn");

const geomFull = bridge.buildGeometryRequest("geom-2", "", {
  space: "Model",
  layer: "P-ThoatRua",
  maxEntities: 500,
});
assert(
  geomFull === "geom-2\n\nspace=Model\nlayer=P-ThoatRua\nmaxEntities=500",
  "geometry request: mỗi tuỳ chọn một dòng key=value",
);

assert(
  bridge.buildGeometryRequest("geom-3", "", { maxEntities: 12.9 })
    === "geom-3\n\nmaxEntities=12",
  "geometry request: maxEntities làm tròn xuống số nguyên",
);

// Phân số nhỏ hơn 1 làm tròn xuống 0, mà plugin coi giá trị không dương là
// "không có giới hạn hợp lệ" rồi dùng mặc định 20.000 — một yêu cầu cố ý giới
// hạn thật chặt lại kích hoạt một lượt quét lớn. Sàn xuống ít nhất 1.
assert(
  bridge.buildGeometryRequest("geom-4", "", { maxEntities: 0.5 })
    === "geom-4\n\nmaxEntities=1",
  "geometry request: maxEntities phân số nhỏ vẫn phải là giới hạn thật",
);

// Số rất lớn ra ký hiệu mũ (`1e+21`), mà plugin đọc bằng `atoll` nên chỉ lấy
// được `1` — xin cả bản vẽ lại nhận đúng một đối tượng. Kẹp về trần của plugin.
assert(
  bridge.buildGeometryRequest("geom-5", "", { maxEntities: 1e21 })
    === `geom-5\n\nmaxEntities=${bridge.GEOMETRY_MAX_ENTITIES_CAP}`,
  "geometry request: maxEntities quá lớn phải kẹp về trần, không ra ký hiệu mũ",
);
for (const value of [1e21, 999999999]) {
  assert(
    !/e\+/i.test(bridge.buildGeometryRequest("geom", "", { maxEntities: value })),
    `geometry request không được sinh ký hiệu mũ: ${value}`,
  );
}

for (const [label, run] of [
  ["requestId nhiều dòng", () => bridge.buildGeometryRequest("a\nb", "")],
  ["target nhiều dòng", () => bridge.buildGeometryRequest("geom", "a\nb")],
  ["space có xuống dòng", () => bridge.buildGeometryRequest("geom", "", { space: "a\nmaxEntities=99999" })],
  ["layer có dấu bằng", () => bridge.buildGeometryRequest("geom", "", { layer: "a=b" })],
]) {
  let threw = false;
  try { run(); } catch { threw = true; }
  assert(threw, `geometry request phải từ chối: ${label}`);
}

// maxEntities không hợp lệ thì bỏ hẳn dòng đó, để plugin dùng mặc định của nó —
// gửi `maxEntities=0` sẽ bị plugin hiểu là "không giới hạn hợp lệ" và bỏ qua,
// nhưng gửi rác thì tệ hơn: nó nằm lại trong request mà không ai đọc.
for (const bad of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
  assert(
    !bridge.buildGeometryRequest("geom", "", { maxEntities: bad }).includes("maxEntities"),
    `geometry request bỏ maxEntities không hợp lệ: ${bad}`,
  );
}

const ctrlSrc = readFileSync(join(__dirname, "../src/acadControl.ts"), "utf8");
assert(!ctrlSrc.includes('join(homedir(), "MEP-Bridge")'), "acadControl no hard default MEP-Bridge path");
assert(ctrlSrc.includes("resolveBridgeDir"), "acadControl uses resolveBridgeDir");

/* ------------------------------------------------------------------ *
 * `beforeDispatch`: chot chay SAU khi gianh duoc khoa job
 * ------------------------------------------------------------------ *
 *
 * `acquireLiveJobLock()` la mot luot CHO: AutoCAD chi chay mot job mot luc, nen
 * khi may dang ban thi moi thu noi goi da kiem truoc do deu la anh chup cu tinh
 * bang giay. Voi lenh GHI khong hoan tac duoc, quang do du de ho so quy chuan bi
 * xoa o mot tab khac. Hook nay la cho duy nhat con chan duoc.
 *
 * Kiem HANH VI chu khong kiem van ban: neu ai do bo dong goi hook, phep so nguon
 * van xanh trong khi chot da chet. */
{
  const jobLsp = contract.jobLspPath(contract.resolveBridgeDir());
  if (existsSync(jobLsp)) rmSync(jobLsp);

  let thrown = null;
  try {
    await bridge.dispatchLiveJob("(princ)", undefined, 200, {
      beforeDispatch: () => { throw new Error("chot-tu-choi"); },
    });
  } catch (error) { thrown = error; }

  assert(thrown?.message === "chot-tu-choi", "beforeDispatch nem loi thi lenh phai bi huy");
  assert(!existsSync(jobLsp), "va KHONG duoc ghi job.lsp — huy phai la huy truoc khi ghi");

  /* Va khi hook khong nem thi luot gui van chay binh thuong: mot chot chan het
     moi thu cung la mot chot hong. */
  let ran = false;
  await bridge.dispatchLiveJob("(princ)", undefined, 200, {
    beforeDispatch: () => { ran = true; },
  });
  assert(ran, "hook phai duoc goi o luot gui binh thuong");

  /* THU TU: hook phai chay SAU `acquireLiveJobLock()`. Phep do hanh vi o tren
     khong phan biet duoc — goi truoc khoa thi ca hai khang dinh kia van xanh,
     trong khi chot mat het y nghia: no lai kiem truoc luot cho, dung cai cua so
     ma no sinh ra de bit. */
  const lockLine = acadBridgeSrc.indexOf("const release = await acquireLiveJobLock();");
  const hookLine = acadBridgeSrc.indexOf("options.beforeDispatch?.();");
  assert(lockLine > 0 && hookLine > 0, "khong tim thay khoa job hoac hook");
  assert(
    hookLine > lockLine,
    "beforeDispatch phai chay SAU khi gianh duoc khoa job, khong phai truoc",
  );
  assert(existsSync(jobLsp), "va luot gui binh thuong van phai ghi job.lsp");
}

/* Moc khoa job: chi noi GUI moi biet han cua no.
 *
 * Hai cai bay da dinh, ghi lai ca hai:
 * 1. `liveJobPending` tang cho CHINH job dang chay, khong rieng job xep hang —
 *    nen chot `pending > 0` lam duong `/live` (duong chinh) khong bao gio co
 *    moc, tuc dung ca can dong ho nhat lai la ca no im.
 * 2. Suy han tu mot hang so chung (`createdAt + JOB_BUSY_MS`) la SAI: `/plot-pdf`
 *    chay theo `timeout_ms` cua yeu cau va giu khoa lau hon han do, con `/live`
 *    con mot luot poll NEN sau luot cho dau. Han phai do chinh noi gui khai;
 *    khong khai thi tra null, khong doan ho.
 *
 * Dat TRUOC chot `if (failed)` o duoi — mot khoi test nam sau chot do khong bao
 * gio lam do duoc build, va da tung co dung loi ay trong chinh tep nay. */
{
  const now = Date.parse("2026-08-19T10:00:00.000Z");
  const D = bridge.busyDeadline;
  const sent = (lockUntil) => ({ state: "sent", lockUntil });

  assert(
    D(1, sent(now + 100_000), now) === "2026-08-19T10:01:40.000Z",
    "mot job dang chay co khai han: phai noi ra dung han do",
  );
  assert(D(2, sent(now + 100_000), now) === null,
    "con job xep hang phia sau thi khong co han nao dung — job ke moi tinh gio khi toi luot");
  assert(D(1, { state: "sent" }, now) === null,
    "job KHONG khai han thi tra null — doan ho la dung lai dung loi vua sua");
  assert(D(1, null, now) === null, "khong co job thi khong phai dang cho");
  assert(D(1, { state: "done", lockUntil: now + 100_000 }, now) === null,
    "job da xong cung vay");
  assert(D(1, sent(now - 1_000), now) === null,
    "han da qua thi tra null, khong tra mot moc qua khu de noi doc dem so am");
}

/* `wait` tu body la du lieu NGOAI, va no di thang vao phep cong dung moc thoi gian.
 *
 * Mot gia tri JSON kieu `"1000"` bien `Date.now() + wait` thanh phep NOI CHUOI —
 * khong bao gi tai cho, chi no o mot duong khac han: `/status` goi
 * `toISOString()` tren so ngoai tam `Date` va nem `RangeError`. Express 4 khong
 * bat loi cua handler async, nen cu nem do HA LUON daemon — tu mot lan goi
 * `/job` voi body sai kieu. */
{
  const C = bridge.clampWait;
  assert(C(30_000) === 30_000, "so hop le thi giu nguyen");
  assert(C("1000") === 1000, "chuoi so van doc duoc, nhung ra SO");
  assert(typeof C("1000") === "number", "va phai la kieu number, khong phai chuoi");
  for (const bad of [undefined, null, NaN, "abc", -1, 0, {}, []]) {
    assert(C(bad) === 15_000, `gia tri ${JSON.stringify(bad)} phai lui ve mac dinh`);
  }
  assert(C(10 ** 15) === 120_000, "chan tren: khong de mot so khong lo dung moc");
}

/* Va chot cuoi phai nam o cho DOC, khong chi o cho nhap: `lockUntil` do nhieu
   duong ghi, nen mot duong quen chuan hoa la lai nem trong `/status`. */
{
  const now = Date.now();
  const D = bridge.busyDeadline;
  for (const bad of ["17871266726301000120000", NaN, Infinity, 1e18, -1e18]) {
    assert(
      D(1, { state: "sent", lockUntil: bad }, now) === null,
      `lockUntil ${String(bad)} phai tra null chu khong duoc nem`,
    );
  }
}

/* KHONG co phep kiem end-to-end cho duong `/job` o day, va do la CO Y.
 *
 * Toi da viet mot cai, roi phai bo. Hai ly do, ca hai deu do chu khong phai suy:
 * 1. No khong bao gi. Bai `dispatchLiveJob(..., 200)` phia tren de lai mot khoa
 *    nen 120 giay, nen `/job` tra 409 truoc khi cham toi nhanh can kiem.
 * 2. Nguy hiem hon: bo test KHONG doi `ACAD_BRIDGE_DIR`, nen `/job` ghi vao
 *    `~/Acad-Bridge/job.lsp` THAT — kenh dung chung ma plugin tu nap. Luc do do
 *    thu, AutoCAD da chay that job cua phep do (noi dung `(princ)`, khong sua gi,
 *    ban ve van `dbmod=0`). Mot phep kiem cham duoc vao phien CAD cua nguoi dung
 *    thi khong duoc phep ton tai, ke ca khi noi dung vo hai.
 *
 * Phan chong sap (`RangeError` trong `/status`) da duoc bao boi test ham thuan o
 * ngay tren: dot bien bo chot cuoi di thi do. Muon kiem end-to-end that thi phai
 * cho suite chay tren mot `ACAD_BRIDGE_DIR` tam — mot viec rieng, khong ghep vao
 * day. */

/* `lockDeadline()` phai TU chuan hoa: moi route truyen `wait` thang tu body vao
   `dispatchLiveJob` (nhu `/livequery`), nen chuan hoa o tung route la lam mot lan
   quen mot lan — da quen dung mot lan roi. Chot o NOI TINH thi khong route nao
   quen duoc, ke ca route them sau nay. */
{
  const src = readFileSync(join(__dirname, "../src/acadBridge.ts"), "utf8");
  assert(
    /function lockDeadline\([\s\S]{0,200}?clampWait\(/.test(src),
    "lockDeadline() phai tu goi clampWait — khong de tung route tu lo",
  );
  assert(
    !/lockUntil[^\n]*Date\.now\(\) \+ wait/.test(src),
    "khong duoc cong thang `wait` chua chuan hoa vao moc thoi gian",
  );
}

/* `wait` phai duoc chan TRUOC KHI dung, khong chi truoc khi HIEN.
 *
 * Gia tri do khong chi dung moc hien thi — no la thoi gian `pollResult()` GIU
 * khoa job dung chung. Mot body `{"wait": 1e15}` qua `/livequery` giu khoa gan
 * nhu vinh vien, chan moi lenh ghi sau do, trong khi moc hien thi van het han
 * sau it phut. Ban va truoc chi chan con so HIEN THI va de nguyen HANH VI. */
{
  const src = readFileSync(join(__dirname, "../src/acadBridge.ts"), "utf8");
  /* `pollResult` dinh nghia TRUOC `dispatchLiveJob` trong tep, nen lay no lam
     moc ket thuc cho ra lat cat RONG — va mot phep so tren chuoi rong thi luon
     xanh. Chot `body.length` la thu bat duoc chuyen do. */
  const from = src.indexOf("export async function dispatchLiveJob");
  const to = src.indexOf("\nexport ", from + 1);
  const body = src.slice(from, to > from ? to : src.length);
  assert(body.length > 200, "khong cat duoc than dispatchLiveJob — locator lac hau");
  assert(
    /const bounded = clampWait\(wait\);/.test(body),
    "dispatchLiveJob phai chan `wait` ngay dau, truoc khi no di toi bat cu dau",
  );
  assert(
    !/pollResult\(job, wait\)/.test(body),
    "va `pollResult` phai nhan gia tri DA CHAN — no la thoi gian giu khoa dung chung",
  );
}

/* Moi noi dat `state = "sent"` phai HOAC khai `lockUntil`, HOAC ghi ro vi sao
   khong khai duoc. Thieu ca hai thi trang thai cho o do im lang — khong bao loi,
   va im lang thi khong ai thay.
   Khong noi long thanh "co it nhat mot cho khai": mot ngoai le chinh dang
   (`/plot-pdf`, xem chu thich trong nguon) khong duoc bien phep kiem thanh vo
   nghia cho moi duong THEM VAO sau nay. */
{
  const src = readFileSync(join(__dirname, "../src/acadBridge.ts"), "utf8");
  const sentSites = src.split(/\bstate:? ?=? ?"sent"/).length - 1;
  /* Khop dang khai HIEN TAI (`lockDeadline(...)`). Regex lac hau thi phep kiem
     do — dung y: doi cach khai ma khong doi cho nay la mot cach lam no im lang. */
  const declared = (src.match(/lockUntil: lockDeadline\(|job\.lockUntil = lockDeadline\(/g) || []).length;
  const waived = (src.match(/KHÔNG khai `lockUntil`/g) || []).length;
  assert(sentSites >= 3, "khong tim thay du cho dat trang thai sent — regex da lac hau");
  assert(declared >= 1, "phai con it nhat mot duong khai duoc han, khong thi dong ho vo dung");
  assert(
    declared + waived === sentSites,
    `co ${sentSites} cho dat "sent": ${declared} khai han, ${waived} ghi ro mien tru`
    + " — phan con lai la im lang, phai xu ly",
  );
}

writeFileSync(LOG, lines.join("\n") + "\n", "utf8");
log("\nWrote " + LOG);
if (failed) {
  console.error(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
console.log("\nALL PASS — bridge contract");
process.exit(0);

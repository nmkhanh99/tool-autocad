import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
process.env.ACAD_PROJECT_ROOT = resolve(here, "../../../..");
/* Thư mục bridge RIÊNG cho test: chốt độ tươi mới đọc `events.jsonl` thật, và
   test không được ghi vào nhật ký của AutoCAD đang chạy trên máy người dùng. */
const bridgeDir = mkdtempSync(join(tmpdir(), "acad-standards-test-"));
process.env.ACAD_BRIDGE_DIR = bridgeDir;

const {
  buildStandardsAction,
  drawingRevision,
  drawingStandardsRouter,
  isIncompleteSnapshotWarning,
} = await import("../src/drawingStandards.ts");
const { DEFAULT_PROFILE } = await import("../src/standardsProfile.ts");

const scaleAll = buildStandardsAction(
  "scale",
  [],
  { all: true, factor: 2, basePoint: [10, 20] },
  "Drawing1.dwg",
);
assert.equal(scaleAll.mutates, true);
assert.match(scaleAll.lisp, /\(acadstd:scale \(list \) T 2 \(list 10 20 0\)\)/);
assert.match(scaleAll.lisp, /_\.UNDO" "_Begin/);
assert.match(scaleAll.lisp, /_\.UNDO" "_End/);

const rotate = buildStandardsAction(
  "rotate",
  ["A1", "B2"],
  { angle: 45, basePoint: [0, 0] },
  "Drawing1.dwg",
);
assert.match(rotate.lisp, /\(acadstd:rotate \(list "A1" "B2"\) 45/);

const color = buildStandardsAction(
  "color",
  ["A1"],
  { color: "ByLayer" },
  "Drawing1.dwg",
);
assert.match(color.lisp, /\(acadstd:set-color \(list "A1"\) 256\)/);

const units = buildStandardsAction(
  "apply-units",
  [],
  { ...DEFAULT_PROFILE.drawing },
  "Drawing1.dwg",
);
assert.match(units.lisp, /\(acadstd:set-units 4 2 0\)/);

const dimension = buildStandardsAction(
  "apply-dimstyle",
  [],
  { ...DEFAULT_PROFILE.dimension },
  "Drawing1.dwg",
);
assert.ok(dimension.lisp.includes('"DIMEXE"'));
assert.ok(dimension.lisp.includes('"DIMEXO"'));
assert.ok(dimension.lisp.includes('"DIMBLK"'));
assert.ok(dimension.lisp.includes('"ACAD-DIM"'));

const layers = buildStandardsAction(
  "sync-layers",
  [],
  { layers: DEFAULT_PROFILE.layers },
  "Drawing1.dwg",
);
assert.match(layers.lisp, /\(acadstd:sync-layers/);
assert.ok(layers.lisp.includes('"MAT-CAT"'));

/* Ho so chi dung ACI: truong thu 6 phai la `nil` cho TUNG dong. Con sot lai mot
   group 420 nao do trong ban ve la mau ACI vua ghi khong co tac dung — AutoCAD
   cho 420 thang 62 — va nguoi dung thay lenh chay xong ma mau khong doi. */
const layerRows = (lisp) => {
  const rows = lisp.match(/\(list "[^"]*" (?:nil|-?\d+) "[^"]*" -?\d+ (?:T|nil) (?:nil|\d+)\)/g);
  assert.ok(rows && rows.length, `khong doc duoc dong layer nao: ${lisp}`);
  return rows;
};
for (const row of layerRows(layers.lisp)) {
  assert.ok(row.endsWith(" nil)"), `ACI phai ket thuc bang nil: ${row}`);
}
assert.equal(layerRows(layers.lisp).length, DEFAULT_PROFILE.layers.length);

/* Dat mau ACI phai GIU DAU cua group 62 — dau am nghia la layer dang TAT, mot
   trang thai NGUOI DUNG dat ma ho so tieu chuan khong mang cot nao de ghi de.
   `subst` thang mot so duong vao do se BAT layer len: ap ho so mau sac lai lam
   hien ra thu ho da co y tat, tren duong ghi mot pha khong hoan tac duoc.

   Day la BAT BIEN VAN BAN, khong phai phep kiem hanh vi: du an khong co harness
   chay AutoLISP, nen cho nay chi chan duoc viec ai do "don gian hoa" no tro lai.
   Kiem that phai lam tren AutoCAD that. */
const ensureLayerBody = (() => {
  const start = layers.lisp.indexOf("(defun acadstd:ensure-layer-rgb");
  assert.ok(start >= 0, "khong thay acadstd:ensure-layer-rgb trong chuong trinh");
  const next = layers.lisp.indexOf("\n(defun ", start + 1);
  return layers.lisp.slice(start, next > 0 ? next : undefined);
})();
assert.ok(
  /\(minusp \(cdr \(assoc 62 data\)\)\)/.test(ensureLayerBody),
  "ensure-layer-rgb phai giu dau cua group 62",
);
/* Chi soi trong than ham LAYER. `acadstd:set-color` cung ghi group 62 nhung no
   lam viec tren DOI TUONG, ma voi doi tuong thi 62 am khong mang nghia tat. */
assert.ok(
  !/\(subst \(cons 62 color\)/.test(ensureLayerBody),
  "khong duoc ghi thang mot so duong vao group 62 cua layer",
);

/* Mau that: truong 2 (ACI) phai la `nil` va truong 6 phai la so 24-bit.
   `nil` o truong 2 la co y — LISP se KHONG dung toi group 62, giu nguyen gia tri
   san co lan DAU cua no (62 am nghia la layer dang TAT). */
const trueColorLayers = buildStandardsAction(
  "sync-layers",
  [],
  {
    layers: [
      { name: "MAU-THAT", color: "#FF8000", linetype: "Continuous", lineweight: 0.35, required: true },
      { name: "DEN-TUYEN", color: "#000000", linetype: "Continuous", lineweight: 0.35, required: false },
    ],
  },
  "Drawing1.dwg",
);
assert.ok(
  trueColorLayers.lisp.includes('(list "MAU-THAT" nil "Continuous" 35 T 16744448)'),
  trueColorLayers.lisp,
);
/* `#000000` la `0`, va `0` phai di duoc qua `?? nil` — `0 ?? x` la `0`, nhung
   mot phep kiem `|| nil` hay `? :` theo do that se bien mau den thanh khong co
   mau that, tuc layer den tuyen quay ve ACI. */
assert.ok(
  trueColorLayers.lisp.includes('(list "DEN-TUYEN" nil "Continuous" 35 nil 0)'),
  trueColorLayers.lisp,
);

const area = buildStandardsAction(
  "area",
  ["CAFE"],
  {},
  "Drawing1.dwg",
  "/tmp/area.tsv",
);
assert.equal(area.mutates, false);
assert.match(area.lisp, /\(acadstd:measure "\/tmp\/area\.tsv" \(list "CAFE"\)\)/);
assert.doesNotMatch(area.lisp, /_\.UNDO/);

assert.throws(
  () => buildStandardsAction("scale", [], { factor: 0 }, "Drawing1.dwg"),
  /factor/,
);
assert.throws(
  () => buildStandardsAction("color", ["A1"], { color: "RGB(1,2,3)" }, "Drawing1.dwg"),
  /ACI/,
);

const firstRevision = drawingRevision({
  document: { instance: "doc-1", revision: 7, dbmod: 0 },
});
assert.equal(
  firstRevision,
  drawingRevision({ document: { instance: "doc-1", revision: 7, dbmod: 9 } }),
);
assert.notEqual(
  firstRevision,
  drawingRevision({ document: { instance: "doc-1", revision: 8, dbmod: 0 } }),
);
assert.notEqual(
  firstRevision,
  drawingRevision({ document: { instance: "doc-2", revision: 7, dbmod: 0 } }),
);
assert.equal(drawingRevision({ document: { dbmod: 4 } }), null);
assert.equal(drawingRevision({ document: { instance: "doc-1", dbmod: 4 } }), null);
assert.equal(drawingRevision({ document: { revision: 7, dbmod: 4 } }), null);
assert.equal(drawingRevision({ document: {} }), null);
for (const warning of [
  "entity_scan_truncated",
  "entity_iterator_unavailable",
  "layers_unavailable",
  "data_link_open_failed",
  "application_system_variables_incomplete",
]) {
  assert.equal(isIncompleteSnapshotWarning(warning), true, warning);
}
assert.equal(isIncompleteSnapshotWarning("document_not_quiescent"), false);

const router = drawingStandardsRouter();
assert.equal(typeof router, "function");
const routePaths = router.stack
  .map((layer) => layer.route?.path)
  .filter(Boolean);
for (const path of ["/profiles", "/scan", "/apply", "/action"]) {
  assert.ok(routePaths.includes(path), `router includes ${path}`);
}

async function invokeRoute(testRouter, path, body) {
  const layer = testRouter.stack.find((item) => item.route?.path === path);
  const handler = layer?.route?.stack?.[0]?.handle;
  assert.equal(typeof handler, "function", `handler exists for ${path}`);
  let status = 200;
  let payload;
  const response = {
    status(code) {
      status = code;
      return this;
    },
    json(value) {
      payload = value;
      return this;
    },
  };
  await handler({
    body,
    params: {},
    get: () => undefined,
  }, response);
  return { status, payload };
}

const activeDocument = {
  title: "Review.dwg",
  file: "/tmp/Review.dwg",
  active: true,
};
const baseDependencies = {
  acadRunning: async () => true,
  listOpenDocs: async () => ({
    running: true,
    alive: true,
    docs: [activeDocument],
  }),
};
const snapshot = (revision, warnings = []) => ({
  ok: true,
  source: { channel: "objectarx", pluginVersion: "1.6.0" },
  document: {
    ...activeDocument,
    quiescent: true,
    instance: "review-document",
    revision,
  },
  settings: {},
  tables: { layers: [] },
  warnings,
});
const writeScanResult = (lisp) => {
  const match = lisp.match(/\(setq acadstd:scan-output "([^"]+)"\)/);
  assert.ok(match, "standards scan output path is present");
  writeFileSync(
    match[1],
    [
      "ACAD_STANDARDS\t1",
      "SETTING\tINSUNITS\t4",
      "SETTING\tLUNITS\t2",
      "SETTING\tLUPREC\t0",
      "END\t0",
    ].join("\n"),
    "utf8",
  );
};

let rejectedDispatches = 0;
const inactiveResult = await invokeRoute(
  drawingStandardsRouter({
    ...baseDependencies,
    listOpenDocs: async () => ({
      running: true,
      alive: true,
      docs: [{ ...activeDocument, active: false }],
    }),
    requestDrawingInfo: async () => {
      throw new Error("inactive scan must not request a snapshot");
    },
    dispatchLiveJob: async () => {
      rejectedDispatches++;
      throw new Error("inactive scan must not dispatch");
    },
  }),
  "/scan",
  {
    target: activeDocument.file,
    profileId: DEFAULT_PROFILE.id,
    readOnly: true,
  },
);
assert.equal(inactiveResult.status, 409);
assert.equal(inactiveResult.payload.code, "drawing_not_active");

const busyResult = await invokeRoute(
  drawingStandardsRouter({
    ...baseDependencies,
    requestDrawingInfo: async () => ({
      ...snapshot(1),
      document: { ...snapshot(1).document, quiescent: false },
    }),
    dispatchLiveJob: async () => {
      rejectedDispatches++;
      throw new Error("busy scan must not dispatch");
    },
  }),
  "/scan",
  {
    target: activeDocument.file,
    profileId: DEFAULT_PROFILE.id,
    readOnly: true,
  },
);
assert.equal(busyResult.status, 409);
assert.equal(busyResult.payload.code, "drawing_busy");

const missingRevisionResult = await invokeRoute(
  drawingStandardsRouter({
    ...baseDependencies,
    requestDrawingInfo: async () => ({
      ...snapshot(1),
      document: {
        ...activeDocument,
        quiescent: true,
      },
    }),
    dispatchLiveJob: async () => {
      rejectedDispatches++;
      throw new Error("revision-less scan must not dispatch");
    },
  }),
  "/scan",
  {
    target: activeDocument.file,
    profileId: DEFAULT_PROFILE.id,
    readOnly: true,
  },
);
assert.equal(missingRevisionResult.status, 409);
assert.equal(
  missingRevisionResult.payload.code,
  "drawing_revision_unavailable",
);
assert.equal(rejectedDispatches, 0);

/* Bản vẽ bị sửa TRONG LÚC quét → từ chối kết quả.
 *
 * Chốt này từng so bộ đếm revision trước/sau lượt quét, và nó SAI: chính lượt
 * quét làm bộ đếm nhảy (AutoCAD dựng lại viewport khi `ssget "_X"` quét toàn
 * bộ — đo thật 16 → 24), nên endpoint tự loại bỏ kết quả của mình, lần nào cũng
 * vậy.
 *
 * Nay chốt đọc sự kiện `drawingModified`, thứ chỉ bắn khi một LỆNH kết thúc và
 * bản vẽ bẩn — tức người dùng thật sự sửa. Đọc bản vẽ không kết thúc lệnh nào.
 */
const eventsFile = join(bridgeDir, "events.jsonl");
writeFileSync(eventsFile, "");
const staleResult = await invokeRoute(
  drawingStandardsRouter({
    ...baseDependencies,
    requestDrawingInfo: async () => snapshot(7),
    dispatchLiveJob: async (lisp, _target, _wait, options) => {
      assert.equal(options?.readOnly, true);
      writeScanResult(lisp);
      // Người dùng sửa bản vẽ ngay giữa lượt quét.
      appendFileSync(eventsFile, JSON.stringify({
        t: Math.floor(Date.now() / 1000),
        type: "drawingModified",
        detail: "",
        activeDoc: activeDocument.title,
      }) + "\n");
      return { state: "done", result: { status: "ok" } };
    },
  }),
  "/scan",
  {
    target: activeDocument.file,
    profileId: DEFAULT_PROFILE.id,
    readOnly: true,
  },
);
assert.equal(staleResult.status, 409, JSON.stringify(staleResult.payload));
assert.equal(staleResult.payload.code, "drawing_stale");

/* Và một lượt quét SẠCH phải đi qua. Không có test này thì một chốt "luôn từ
   chối" cũng làm test trên xanh — đúng lỗi vừa sửa. */
const cleanResult = await invokeRoute(
  drawingStandardsRouter({
    ...baseDependencies,
    /* Revision NHẢY giữa hai lượt đọc — đúng như AutoCAD làm khi dựng lại
       viewport. Lượt quét sạch vẫn phải đi qua: đó là cả điểm của việc bỏ phép
       so bộ đếm. */
    requestDrawingInfo: (() => {
      let index = 0;
      const snaps = [snapshot(11), snapshot(19)];
      return async () => snaps[Math.min(index++, snaps.length - 1)];
    })(),
    dispatchLiveJob: async (lisp, _target, _wait, options) => {
      assert.equal(options?.readOnly, true);
      writeScanResult(lisp);
      // Chỉ nhiễu của AutoCAD, không phải lệnh nào kết thúc.
      appendFileSync(eventsFile, JSON.stringify({
        t: Math.floor(Date.now() / 1000),
        type: "commandStart",
        detail: "ZOOM",
        activeDoc: activeDocument.title,
      }) + "\n");
      return { state: "done", result: { status: "ok" } };
    },
  }),
  "/scan",
  {
    target: activeDocument.file,
    profileId: DEFAULT_PROFILE.id,
    readOnly: true,
  },
);
assert.equal(cleanResult.status, 200, JSON.stringify(cleanResult.payload));
assert.equal(cleanResult.payload.ok, true);

let incompleteSnapshotIndex = 0;
const incompleteSnapshots = [
  snapshot(9, ["layers_unavailable"]),
  snapshot(9, ["layers_unavailable"]),
];
const incompleteResult = await invokeRoute(
  drawingStandardsRouter({
    ...baseDependencies,
    requestDrawingInfo: async () =>
      incompleteSnapshots[
        Math.min(incompleteSnapshotIndex++, incompleteSnapshots.length - 1)
      ],
    dispatchLiveJob: async (lisp, _target, _wait, options) => {
      assert.equal(options?.readOnly, true);
      writeScanResult(lisp);
      return { state: "done", result: { status: "ok" } };
    },
  }),
  "/scan",
  {
    target: activeDocument.file,
    profileId: DEFAULT_PROFILE.id,
    readOnly: true,
  },
);
assert.equal(incompleteResult.status, 200, JSON.stringify(incompleteResult));
assert.equal(incompleteResult.payload.evidence.completeness.complete, false);
assert.ok(
  incompleteResult.payload.evidence.completeness.reasons.includes(
    "layers_unavailable",
  ),
);

const routerSource = readFileSync(
  fileURLToPath(new URL("../src/drawingStandards.ts", import.meta.url)),
  "utf8",
);
assert.match(routerSource, /snapshotDocument\.quiescent !== true/);
assert.match(routerSource, /drawing_revision_unavailable/);
assert.match(routerSource, /reviewOnly/);
/* Chốt độ tươi phải đọc SỰ KIỆN, không so bộ đếm revision. Khoá bằng mã nguồn
   vì đây là thứ dễ "sửa lại cho gọn" nhất: so hai con số trông hợp lý hơn hẳn
   đọc một nhật ký — mà nó sai, và sai theo kiểu endpoint luôn tự loại bỏ kết
   quả của chính mình. */
assert.match(routerSource, /drawingChangedSince\(eventMark/);
assert.doesNotMatch(routerSource, /verifiedDrawingRevision !== expectedDrawingRevision/);
assert.match(routerSource, /completeness:\s*\{/);

console.log("✓ drawing standards router: typed actions and routes");

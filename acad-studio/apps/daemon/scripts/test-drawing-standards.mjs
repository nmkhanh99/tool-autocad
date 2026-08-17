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
/* Kho hồ sơ RIÊNG cho test. Không đặt thì `resolveStandardsDataDir()` lùi về
   `~/Library/Application Support/acad-studio` — tức test đọc và có thể GHI vào
   hồ sơ quy chuẩn thật của người dùng. Ngày 2026-08-17 một script đo hành vi xoá
   đã xoá đúng kho đó, và test này hỏng theo vì hồ sơ mặc định biến mất: một test
   phụ thuộc dữ liệu người dùng thì vừa không đáng tin vừa nguy hiểm. */
process.env.ACAD_DATA_DIR = mkdtempSync(join(tmpdir(), "acad-standards-data-"));

const {
  buildStandardsAction,
  documentGuardLisp,
  drawingRevision,
  drawingStandardsRouter,
  dimspaceRejection,
  filterObjectsByMappingBounds,
  isIncompleteSnapshotWarning,
} = await import("../src/drawingStandards.ts");
const { DEFAULT_PROFILE } = await import("../src/standardsProfile.ts");

/* Chot CUOI CUNG cua job ghi: chuong trinh tu tu choi neu no khong chay tren
   dung ban ve. Moi chot phia tren deu doc trang thai TRUOC khi AutoCAD thuc su
   chay lenh, va giua hai moc do nguoi dung doi tab duoc.

   Uu tien MA PHIEN. Chot theo TEN khong phan biet duoc hai ban ve CHUA LUU trung
   tieu de — ca hai cho ra cung mot `DWGNAME` — nen tren dung nhom ban ve can no
   nhat thi no khong bao ve gi ca. */
{
  const named = documentGuardLisp("/a/Plan.dwg");
  assert.ok(named.includes('(getvar "DWGNAME")'), "khong co ma phien thi so theo ten");
  assert.ok(!named.includes("acad:doc-instance"), "khong co ma phien thi khong nhac toi no");
  assert.ok(named.includes("wrong_document"));

  const byInstance = documentGuardLisp("Drawing1.dwg", "AAA-001");
  assert.ok(
    byInstance.includes("acad:doc-instance"),
    "co ma phien thi phai so bang no",
  );
  assert.ok(byInstance.includes('"AAA-001"'), "ma phien mong doi phai nam trong chuong trinh");
  /* Co ma phien thi KHONG so ten nua: ma phien da xac dinh dung mot ban ve, con
     so them ten chi tao ra mot duong tu choi SAI — "Save As" giua chung doi
     `DWGNAME` ma van la dung ban ve do. Nhung nhanh ten phai CON LAI lam duong
     lui cho ban plugin cu (`acad:doc-instance` la `nil`). */
  assert.ok(
    byInstance.includes("(= (type acad:doc-instance) 'STR)"),
    "phai kiem KIEU truoc: ban plugin cu tra nil, va nil khong duoc coi la lech",
  );
  assert.ok(
    byInstance.includes('(getvar "DWGNAME")'),
    "nhanh lui theo ten phai con lai cho ban plugin cu",
  );

  /* Chuoi phai duoc trich dan dung. Mot tieu de chua dau nhay se dong som chuoi
     LISP va pha vo ca chuong trinh — tren duong GHI khong hoan tac duoc. */
  const quoted = documentGuardLisp('a"b.dwg', 'i"j');
  const instanceLine = quoted
    .split("\n")
    .find((line) => line.includes("acad:doc-instance") && line.includes("/="));
  assert.ok(instanceLine, "phai co dong so ma phien");
  assert.ok(
    instanceLine.includes('"i\\"j"'),
    `dau nhay phai duoc escape, nhan duoc: ${instanceLine}`,
  );
  assert.ok(
    quoted.includes('"a\\"b.dwg"'),
    "dau nhay trong TEN cung phai duoc escape",
  );
}

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
/* "Ho so BI XOA" phai tach khoi "ho so da sua". Gop vao `profile_stale` la bao
   nguoi dung "quet lai" — ma quet lai bang chinh ho so do thi khong the, no
   khong con ton tai. Hai tinh huong, hai viec phai lam.
   Khoa bang van ban vi `check:guards` khong thay duoc: ma `profile_not_found`
   van con duoc duong `/scan` phat, nen go no khoi duong `/apply` khong tao ra
   entry mo coi nao. */
assert.match(
  routerSource,
  /if \(!profile\) \{\s*return res\.status\(409\)\.json\(\{\s*ok: false,\s*code: "profile_not_found"/,
  "duong /apply phai phan biet ho so BI XOA voi ho so da sua",
);
/* Chot CUOI: doc lai ho so NGAY TRUOC khi ghi.
   Phep kiem o dau handler cach cho ghi hai luot `await` — `resolveDocument()` va
   `requestDrawingInfo()` — va trong quang do mot tab khac xoa duoc ho so. Ghi
   tiep la ap mot ho so KHONG CON TON TAI vao ban ve, tren duong mot pha khong
   hoan tac duoc. Moi thu doc truoc mot luot `await` chi la anh chup. */
assert.match(
  routerSource,
  /const stillThere = getProfile\(session\.profileId\);[\s\S]{0,600}?const job = await dependencies\.dispatchLiveJob/,
  "phai doc lai ho so ngay truoc dispatchLiveJob, khong duoc tin anh chup dau handler",
);
assert.match(routerSource, /reviewOnly/);
/* Chốt độ tươi phải đọc SỰ KIỆN, không so bộ đếm revision. Khoá bằng mã nguồn
   vì đây là thứ dễ "sửa lại cho gọn" nhất: so hai con số trông hợp lý hơn hẳn
   đọc một nhật ký — mà nó sai, và sai theo kiểu endpoint luôn tự loại bỏ kết
   quả của chính mình. */
assert.match(routerSource, /drawingChangedSince\(eventMark/);
assert.doesNotMatch(routerSource, /verifiedDrawingRevision !== expectedDrawingRevision/);
assert.match(routerSource, /completeness:\s*\{/);

console.log("✓ drawing standards router: typed actions and routes");

/* ------------------------------------------------------------------ *
 * Căn hàng dimension: một lô — một trục — một mốc cùng trục
 * ------------------------------------------------------------------ */
{
  const issue = (axis) => ({
    id: `dim-row-${axis}`, scope: "dim-row", severity: "warning", message: "",
    handles: ["A1"], current: null, expected: null,
    suggestedAction: { action: "dimspace", axis },
  });
  const dims = [
    { handle: "A1", layer: "", style: "", axis: "H", row: 0, rotation: 0, measurement: 0, text: "" },
    { handle: "B2", layer: "", style: "", axis: "V", row: 0, rotation: 0, measurement: 0, text: "" },
  ];

  assert.equal(dimspaceRejection([issue("H")], dims, "A1"), null, "cung truc thi chay duoc");

  /* Hai truc trong mot lo: `acadstd:dimspace` nhan DUNG MOT moc, nen cac DIM doc
     se bi can theo mot DIM ngang. Lenh chay em, AutoCAD khong bao gi, va cac DIM
     chi don gian nam sai cho — tren duong ghi MOT PHA khong hoan tac duoc. */
  assert.equal(
    dimspaceRejection([issue("H"), issue("V")], dims, "A1")?.code,
    "dim_axis_mixed",
  );
  assert.equal(
    dimspaceRejection([issue("H")], dims, "B2")?.code,
    "dim_base_axis_mismatch",
    "moc truc doc khong can duoc lo truc ngang",
  );
  /* Handle con sot tu mot luot quet truoc, hoac bang dimension da bi cat mat dong
     do. Gui di la hong GIUA CHUNG — luc ay vai lenh khac trong lo da ghi xong. */
  assert.equal(
    dimspaceRejection([issue("H")], dims, "ZZZ")?.code,
    "dim_base_unknown",
  );
}

/* ------------------------------------------------------------------ *
 * Gioi han dien tich: chuoi RONG la "khong dat", khong phai 0
 * ------------------------------------------------------------------ */
{
  const withBounds = (bounds) => ({
    ...DEFAULT_PROFILE,
    mappings: [{
      id: "m1", label: "m1", kind: "generic",
      layerPatterns: ["A-*"], blockPatterns: [], textPatterns: [], entityTypes: [],
      required: false, bounds,
    }],
  });
  const objects = [
    { mappingId: "m1", handle: "A1", kind: "generic", layer: "A-WALL", block: "",
      text: "", area: 12, width: 1, height: 1, x: 0, y: 0 },
  ];
  const settings = { INSUNITS: "6" };

  /* `Number("")` la `0`, va `0` la mot so HUU HAN — nen mot `maxArea: ""` bo quen
     trong ho so tung co nghia "dien tich <= 0", tuc loc sach moi doi tuong. Giao
     dien hien o trong, va nguoi dung tim mai khong ra vi sao bang boc tach rong
     tron. `finiteNumber()` ben engine da doc chuoi rong dung nhu vay tu dau. */
  assert.equal(
    filterObjectsByMappingBounds(withBounds({ maxArea: "" }), objects, settings).length,
    1,
    "maxArea rong = khong dat, khong phai <= 0",
  );
  assert.equal(
    filterObjectsByMappingBounds(withBounds({ minArea: "   " }), objects, settings).length,
    1,
    "chuoi toan khoang trang cung vay",
  );
  // Gioi han THAT thi van phai loc.
  assert.equal(
    filterObjectsByMappingBounds(withBounds({ maxArea: 5 }), objects, settings).length,
    0,
  );
  assert.equal(
    filterObjectsByMappingBounds(withBounds({ maxArea: "20" }), objects, settings).length,
    1,
    "chuoi so van la mot bo loc dang chay",
  );
}

/* ------------------------------------------------------------------ *
 * Don vi dien tich: khoang trang khong duoc lam hong phep quy doi
 * ------------------------------------------------------------------ */
{
  /* Giao dien CAT khoang trang truoc khi so, nen `" m2 "` hien len la "m²".
     Cho nay khong cat thi roi ve don vi ban ve — nguoi dung dat nguong theo met
     ma may chu so theo don vi ban ve, va khong co gi noi ra dieu do. */
  const profile = (bounds) => ({
    ...DEFAULT_PROFILE,
    mappings: [{
      id: "m1", label: "m1", kind: "generic",
      layerPatterns: ["A-*"], blockPatterns: [], textPatterns: [], entityTypes: [],
      required: false, bounds,
    }],
  });
  // INSUNITS 4 = milimet. 1.000.000 mm² = 1 m².
  const mm = { INSUNITS: "4" };
  const objects = [
    { mappingId: "m1", handle: "A1", kind: "generic", layer: "A-WALL", block: "",
      text: "", area: 1_000_000, width: 1, height: 1, x: 0, y: 0 },
  ];

  for (const unit of ["m2", " m2 ", "m²", " M² "]) {
    assert.equal(
      filterObjectsByMappingBounds(profile({ maxArea: 2, areaUnit: unit }), objects, mm).length,
      1,
      `don vi ${JSON.stringify(unit)} phai quy doi duoc: 1 m² <= 2 m²`,
    );
  }
  /* Don vi may chu THAT SU khong hieu thi van phai so theo don vi ban ve —
     1.000.000 > 2, nen doi tuong bi loai. Day la duong lui dung. */
  assert.equal(
    filterObjectsByMappingBounds(profile({ maxArea: 2, areaUnit: "ft2" }), objects, mm).length,
    0,
  );
}

/* ------------------------------------------------------------------ *
 * Handle chu thuong van phai tra ra
 * ------------------------------------------------------------------ */
{
  /* `cleanHandles()` viet HOA handle cua yeu cau, con `parseStandardsScanTsv()`
     giu nguyen cach viet doc duoc tu ban ve. So thang la nguoi dung nhan
     `dim_base_unknown` cho dung cai DIM ho vua bam trong bang. */
  const issue = {
    id: "dim-row-h", scope: "dim-row", severity: "warning", message: "",
    handles: ["a1"], current: null, expected: null,
    suggestedAction: { action: "dimspace", axis: "H" },
  };
  const lower = [
    { handle: "a1", layer: "", style: "", axis: "H", row: 0, rotation: 0, measurement: 0, text: "" },
  ];
  assert.equal(dimspaceRejection([issue], lower, "A1"), null, "hoa/thuong khong duoc lam lech");
}

/* ------------------------------------------------------------------ *
 * Duong CU khong con can hang dimension duoc
 * ------------------------------------------------------------------ */
{
  /* `/action` nhan handle TRAN, khong gan voi luot quet nao, nen no khong co
     cach nao biet handle nao thuoc truc nao — ma `acadstd:dimspace` lay dung mot
     moc va chi can duoc cac DIM cung truc. Panel cu goi vao day voi mot o tha
     xuong liet ke DIM cua CA HAI truc, tuc dung luot ghi ma `/standards/apply`
     nay tu choi. Ghi mot pha, khong hoan tac duoc, va sai mot cach IM LANG.
     Chan han thay vi kiem nua voi — du lieu de kiem khong ton tai o day. */
  const actionRouter = drawingStandardsRouter({
    ...baseDependencies,
    dispatchLiveJob: async () => {
      throw new Error("KHONG duoc dispatch: lenh can hang phai bi chan truoc do");
    },
  });
  const rejected = await invokeRoute(actionRouter, "/action", {
    target: activeDocument.file,
    action: "dimspace",
    handles: ["A1", "B2"],
    params: { baseHandle: "A1", rowSpacing: 10 },
  });
  assert.equal(rejected.status, 409, JSON.stringify(rejected));
  assert.equal(rejected.payload.code, "dimspace_needs_scan");
  /* Cau tra loi phai chi duong: nguoi dung dang co lam mot viec HOP LE, chi la
     o sai cho. Tu choi khong kem loi chi duong la mot ngo cut. */
  assert.match(String(rejected.payload.hint ?? ""), /review|Kiem tra|Kiểm tra/i);
}

/* ------------------------------------------------------------------ *
 * KHONG BIET thi TU CHOI, dung cho qua
 * ------------------------------------------------------------------ */
{
  /* Mot dong quet co `axis` rong lam phep so truc bi BO QUA hoan toan — tuc chot
     duy nhat con lai tu tat dung luc du lieu dang ngo nhat. Cung loi voi
     `observedLayerColor()` tung lui ve ACI khi khong doc duoc rgb. */
  const issue = {
    id: "dim-row-h", scope: "dim-row", severity: "warning", message: "",
    handles: ["A1"], current: null, expected: null,
    suggestedAction: { action: "dimspace", axis: "H" },
  };
  const row = (handle, axis, rowValue) => ({
    handle, layer: "", style: "", axis, row: rowValue,
    rotation: 0, measurement: 0, text: "",
  });

  assert.equal(
    dimspaceRejection([issue], [row("A1", "", 0)], "A1")?.code,
    "dim_base_axis_unknown",
    "khong biet truc thi tu choi",
  );
  assert.equal(
    dimspaceRejection([issue], [row("A1", "H", Number.NaN)], "A1")?.code,
    "dim_base_row_unknown",
    "khong biet toa do hang thi tu choi: DIMSPACE can THEO chinh so do",
  );
  assert.equal(dimspaceRejection([issue], [row("A1", "H", 0)], "A1"), null,
    "toa do hang bang 0 la HOP LE — chi thieu moi la khong");
}

/* ------------------------------------------------------------------ *
 * Xoa ho so DOI If-Match, va rong khong phai la "khong gui"
 * ------------------------------------------------------------------ */
{
  /* `req.get(...) || undefined` bien chuoi RONG thanh `undefined`, va
     `deleteProfile()` khi do BO QUA phep so revision hoan toan — tuc xoa mot ban
     minh chua tung thay. Mot ho so thieu `revision` (payload cu, hoac du lieu
     meo) vi the mo toang chot tranh chap tren dung duong khong lay lai duoc. */
  const deleteRouter = drawingStandardsRouter(baseDependencies);
  /* Chon theo METHOD: `/profiles/:id` co CA `PUT` lan `DELETE`, va `find` theo
     path se bat nham cai dau tien. */
  const layer = deleteRouter.stack.find(
    (item) => item.route?.path === "/profiles/:id" && item.route?.methods?.delete,
  );
  const handler = layer?.route?.stack?.[0]?.handle;
  assert.equal(typeof handler, "function", "khong tim thay handler DELETE");

  const call = async (header) => {
    let status = 200;
    let payload;
    const res = {
      status(code) { status = code; return this; },
      json(value) { payload = value; return this; },
    };
    await handler(
      { params: { id: "khong-co-that" }, body: {}, get: () => header },
      res,
    );
    return { status, payload };
  };

  for (const header of [undefined, "", "   "]) {
    const result = await call(header);
    assert.equal(result.status, 428, `If-Match ${JSON.stringify(header)} phai bi tu choi`);
    assert.equal(result.payload.code, "if_match_required");
  }
  /* Co token that thi di tiep binh thuong — 404 vi id khong ton tai, khong phai
     428. Mot chot chan het moi thu cung la mot chot hong. */
  const withToken = await call("revision-nao-do");
  assert.equal(withToken.status, 404, JSON.stringify(withToken));
}

console.log("✓ drawing standards: dimspace axis guard + area bounds (rong, don vi)");

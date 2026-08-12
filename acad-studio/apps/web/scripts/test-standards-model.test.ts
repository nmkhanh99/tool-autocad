/** Đọc hiểu API tiêu chuẩn — phần dễ sai nhất là RÀNG BUỘC GIỮA HAI MÀN HÌNH.
 *
 * `/standards` sửa hồ sơ, `/review` quét theo hồ sơ đó. Máy chủ buộc một lượt
 * quét vào phiên bản hồ sơ lúc quét và trả 409 khi lệch — mà panel legacy không
 * bao giờ gặp, vì nó khoá nút quét khi hồ sơ còn thay đổi chưa lưu. Tách hai
 * màn hình là mở ra đúng khe đó, nên nó được khoá bằng test chứ không bằng trí
 * nhớ.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  applyBlockedReason,
  applyProfileEdits,
  applySummary,
  filterIssues,
  normalizeIssue,
  normalizeProfile,
  normalizeScan,
  profileDriftNote,
  scanBlockedReason,
  severityCounts,
  severityLabel,
  severityOf,
  profileSaveBlockedReason,
  targetOf,
  unsupportedFixReason,
  LINEAR_FORMATS,
  LINEWEIGHTS,
  groupObjectsByMapping,
  layerRowErrors,
  mappingRowErrors,
  type Issue,
  type LayerRule,
  type MappingRule,
  type Scan,
  type StandardsProfile,
} from "../features/standards/model";

const profile = (over: Partial<StandardsProfile> = {}): StandardsProfile => ({
  ...normalizeProfile({ id: "p1", name: "Mẫu", revision: "hash-a" }),
  ...over,
});

const scan = (over: Partial<Scan> = {}): Scan => ({
  scanId: "scan_1",
  target: "/x.dwg",
  profileId: "p1",
  profileRevision: "hash-a",
  profileVersion: 0,
  scannedAt: "",
  issues: [],
  objects: [],
  objectsTruncated: false,
  maxObjects: 2000,
  ...over,
});

test("gom mọi tên mức độ của máy chủ về ba nhóm", () => {
  /* Máy chủ dùng nhiều tên cho cùng một mức. Gộp sai thì bộ lọc "Lỗi" bỏ sót
     đúng những mục nghiêm trọng nhất — người dùng lọc ra 0 lỗi rồi yên tâm. */
  assert.equal(severityOf("error"), "error");
  assert.equal(severityOf("CRITICAL"), "error");
  assert.equal(severityOf("fatal"), "error");
  assert.equal(severityOf("info"), "info");
  assert.equal(severityOf("suggestion"), "info");

  /* Không rõ thì về "cảnh báo", KHÔNG về "gợi ý": hạ một mức chưa biết xuống
     mức nhẹ nhất là cách làm nó biến mất khỏi tầm mắt. */
  assert.equal(severityOf("bogus"), "warning");
  assert.equal(severityOf(undefined), "warning");
  assert.equal(severityLabel("info"), "Gợi ý");
});

test("revision là HASH nội dung, giữ nguyên chuỗi", () => {
  /* Đọc nó như một con số cho ra `NaN`, và mọi phép so đều sai — đã sập đúng
     một lần ở đây. Nó cũng là giá trị gửi trong `If-Match` khi ghi. */
  assert.equal(normalizeProfile({ id: "p", revision: "f304e8e7" }).revision, "f304e8e7");
  assert.equal(normalizeProfile({ id: "p" }).revision, "");
  assert.equal(normalizeProfile(null).revision, "");

  /* `required` của layer: thiếu trường = BẮT BUỘC. Coi một layer bắt buộc là
     tuỳ chọn thì lượt quét bỏ qua đúng thứ hồ sơ sinh ra để ép. */
  const layers = normalizeProfile({ layers: [{ name: "A" }, { name: "B", required: false }] });
  assert.equal(layers.layers[0].required, true);
  assert.equal(layers.layers[1].required, false);
});

test("bắt được hồ sơ đã sửa sau lượt quét", () => {
  /* ĐÂY là ràng buộc mà việc tách hai màn hình làm lộ ra: quét ở `/review`,
     sang `/standards` sửa một dòng, quay lại bấm sửa → máy chủ trả 409. */
  assert.equal(profileDriftNote(scan(), profile()), "");
  assert.match(profileDriftNote(scan(), profile({ revision: "hash-b" })), /đã đổi/);

  /* Đổi sang hồ sơ KHÁC cũng vậy, nhưng phải nói đúng lý do — người dùng xử lý
     hai chuyện đó khác nhau. */
  assert.match(
    profileDriftNote(scan(), profile({ id: "p2" })),
    /không phải hồ sơ đã dùng để quét/,
  );

  /* Chưa đọc được hồ sơ thì KHÔNG kết luận: "chưa biết" không phải "đã đổi",
     và một cảnh báo sai ở đây khoá mất nút sửa. */
  assert.equal(profileDriftNote(scan(), null), "");
  assert.equal(profileDriftNote(null, profile()), "");

  /* Một vế RỖNG cũng là "chưa biết": máy chủ bản cũ không phát `profileRevision`
     trong kết quả quét. Cảnh báo sai ở đây khoá mất nút sửa mà không có đường
     gỡ nào ngoài việc quét lại vô ích. */
  assert.equal(profileDriftNote(scan({ profileRevision: "" }), profile()), "");
  assert.equal(profileDriftNote(scan(), profile({ revision: "" })), "");
});

test("nói trước vì sao chưa quét hoặc chưa sửa được", () => {
  const ok = {
    target: "/x.dwg", activeTarget: "/x.dwg", profileId: "p1",
    docsAlive: true, busy: false,
  };
  assert.equal(scanBlockedReason(ok), "");
  assert.match(scanBlockedReason({ ...ok, docsAlive: false }), /chưa phản hồi/);
  assert.match(scanBlockedReason({ ...ok, target: "" }), /Chưa chọn bản vẽ/);
  assert.match(scanBlockedReason({ ...ok, profileId: "" }), /hồ sơ quy tắc/);

  /* Quét một bản vẽ KHÔNG hoạt động làm daemon kích hoạt nó — đổi tab AutoCAD
     sau lưng người dùng, và họ chỉ biết khi ngẩng lên thấy bản vẽ khác. */
  assert.match(
    scanBlockedReason({ ...ok, target: "/khac.dwg" }),
    /Chỉ quét được bản vẽ đang mở/,
  );

  const apply = {
    scan: scan({ scanId: "s" }), target: "/x.dwg", activeTarget: "/x.dwg",
    selected: 2, driftNote: "", drawingChanged: false, busy: false,
  };
  assert.equal(applyBlockedReason(apply), "");
  assert.match(applyBlockedReason({ ...apply, scan: null }), /Chưa có lượt quét/);
  assert.match(applyBlockedReason({ ...apply, selected: 0 }), /Chưa chọn phát hiện/);
  assert.match(applyBlockedReason({ ...apply, drawingChanged: true }), /Quét lại/);

  /* Lệch hồ sơ được trả NGUYÊN VĂN, và xét TRƯỚC số lượng: chọn 0 mục trên một
     lượt quét đã chết thì cái cần nói là lượt quét đã chết. */
  const drift = applyBlockedReason({ ...apply, selected: 0, driftNote: "Hồ sơ đã đổi." });
  assert.equal(drift, "Hồ sơ đã đổi.");

  /* Lượt sửa gửi đi CHỈ có `scanId`, nên máy chủ dùng đích đã lưu trong phiên
     quét — không phải đích đang hiện trên màn hình. Quét bản vẽ A rồi đổi ô
     chọn sang B mà vẫn bấm sửa là GHI VÀO A trong khi màn hình nói B. */
  assert.match(
    applyBlockedReason({ ...apply, target: "/b.dwg" }),
    /thuộc một bản vẽ khác/,
  );

  /* Và bản vẽ đã quét phải ĐANG HOẠT ĐỘNG: `/standards/apply` dispatch một job
     KHÔNG read-only, nên nó tự kích hoạt bản vẽ đã lưu trong phiên quét rồi ghi
     vào đó. Người dùng đang nhìn B mà AutoCAD nhảy về A và sửa A. */
  assert.match(
    applyBlockedReason({ ...apply, activeTarget: "/b.dwg" }),
    /AutoCAD đang mở một bản vẽ khác/,
  );
});

test("lọc phát hiện theo mức độ và từ khoá tiếng Việt", () => {
  const issues: Issue[] = [
    normalizeIssue({ id: "i1", severity: "error", message: "Sai đơn vị" }, 0),
    normalizeIssue({ id: "i2", severity: "warning", message: "Layer thiếu" }, 1),
    normalizeIssue({ id: "i3", severity: "info", message: "Gợi ý tỷ lệ" }, 2),
  ];
  assert.deepEqual(severityCounts(issues), { all: 3, error: 1, warning: 1, info: 1 });
  assert.equal(filterIssues(issues, "error", "").length, 1);
  assert.equal(filterIssues(issues, "all", "layer").length, 1);

  /* Chữ hoa/thường tiếng Việt: người dùng gõ "ĐƠN VỊ" phải khớp "đơn vị". */
  assert.equal(filterIssues(issues, "all", "ĐƠN VỊ").length, 1);
  assert.equal(filterIssues(issues, "all", "không có gì khớp").length, 0);
});

test("câu tóm tắt nói rõ sẽ chạm vào bao nhiêu đối tượng", () => {
  const withHandles = [
    normalizeIssue({ id: "a", handles: ["1", "2"] }, 0),
    normalizeIssue({ id: "b", handles: ["2", "3"] }, 1),
  ];
  /* Handle trùng chỉ đếm MỘT: nói "4 đối tượng" cho 3 đối tượng là phóng đại
     đúng con số người dùng dựa vào để quyết định có bấm hay không. */
  assert.match(applySummary(withHandles), /3 đối tượng/);

  /* Không có handle nào = sửa thiết lập bản vẽ, không phải sửa 0 đối tượng. */
  assert.match(applySummary([normalizeIssue({ id: "c" }, 0)]), /thiết lập bản vẽ/);

  /* Ba hành động đổi thứ áp cho CẢ BẢN VẼ. Chỉ đếm số đối tượng là nói ít hơn
     sự thật ở đúng chỗ người dùng đọc để quyết định bấm một lệnh không hoàn tác
     được — `apply-dimstyle` chạy `configureDimensionExpression` trên toàn bộ
     dimstyle, không chỉ trên mấy DIM được liệt kê. */
  const wide = applySummary([
    normalizeIssue({ id: "u", suggestedAction: "apply-dimstyle", handles: ["1"] }, 0),
  ]);
  assert.match(wide, /1 đối tượng/);
  assert.match(wide, /kiểu kích thước dùng chung/);
  assert.match(
    applySummary([normalizeIssue({ id: "v", suggestedAction: "apply-units" }, 0)]),
    /đơn vị của cả bản vẽ/,
  );
  assert.equal(applySummary([]), "");
});

test("đích thao tác là đường dẫn tệp, không phải tiêu đề", () => {
  /* Hai bản vẽ cùng tên mở cùng lúc là chuyện thường trong một bộ hồ sơ. */
  assert.equal(targetOf({ file: "/a/x.dwg", title: "x.dwg" }), "/a/x.dwg");
  /* Bản vẽ CHƯA LƯU không có đường dẫn — lùi về tiêu đề là thứ duy nhất còn. */
  assert.equal(targetOf({ file: "", title: "Drawing1.dwg" }), "Drawing1.dwg");
  assert.equal(targetOf({}), "");
});

test("chuẩn hoá lượt quét giữ lại phiên bản hồ sơ", () => {
  const parsed = normalizeScan(
    { scanId: "s1", profileId: "p1", profileRevision: "7", issues: [{ id: "x" }] },
    "/fallback.dwg",
  );
  assert.equal(parsed.profileRevision, "7");
  assert.equal(parsed.issues.length, 1);
  /* Thiếu `target` thì lùi về đích đã gửi đi — không để rỗng, vì mọi lệnh sửa
     sau đó đều nhắm theo nó. */
  assert.equal(parsed.target, "/fallback.dwg");
});

test("lưu hồ sơ KHÔNG được xoá những trường form chưa mô hình hoá", () => {
  /* Bản nháp trong giao diện là hình dạng PHẲNG do màn hình tự đặt cho dễ dựng
     form. Máy chủ lưu dạng LỒNG, với `dimension` hơn 20 trường mà form chưa
     đụng tới. Gửi thẳng bản nháp là ghi đè hết bằng mặc định — không lỗi nào
     báo, không test nào đỏ, và lượt quét sau đó bắt lỗi hàng loạt theo một quy
     tắc người dùng chưa từng đặt. */
  const source = {
    id: "p1",
    name: "Mẫu",
    revision: "hash-a",
    description: "ghi chú của người dùng",
    drawing: { unit: "mm", insunits: 4, precision: 0, paper: { name: "A3", width: 420, height: 297 } },
    dimension: {
      styleName: "ACAD", textHeight: 2.5, overallScale: 1,
      arrowhead: "ClosedFilled", fit: "best", textVertical: "above",
      extendBeyondDimLines: 1.25,
    },
    layers: [{ name: "A", color: 3, linetype: "HIDDEN", lineweight: 0.35, required: false }],
    mappings: [{ id: "m1", bounds: { minX: 0 } }],
  };
  const edited = { ...normalizeProfile(source), dimTextHeight: 3.5 };
  const payload = applyProfileEdits(edited) as Record<string, any>;

  // Trường đã sửa đi đúng chỗ lồng của nó.
  assert.equal(payload.dimension.textHeight, 3.5);

  // Những trường form KHÔNG đụng tới phải còn nguyên.
  assert.equal(payload.dimension.arrowhead, "ClosedFilled");
  assert.equal(payload.dimension.fit, "best");
  assert.equal(payload.dimension.extendBeyondDimLines, 1.25);
  assert.equal(payload.description, "ghi chú của người dùng");

  /* Layer đi trọn năm trường — đúng bằng `LayerStandard` của daemon, không hơn
     không kém. Sửa được ở giao diện nên KHÔNG chép nguyên bản gốc nữa, nhưng
     dòng nào không đụng tới thì phải giống hệt lúc nạp về. */
  assert.deepEqual(payload.layers, [
    { name: "A", color: 3, linetype: "HIDDEN", lineweight: 0.35, required: false },
  ]);

  /* Mapping thì NGƯỢC LẠI: `ObjectMapping` có `bounds` tuỳ chọn mà form không mô
     hình hoá, nên bản gửi đi phải vá lên bản ghi gốc theo `id`. Dựng lại từ bản
     đã chuẩn hoá là xoá mất khung giới hạn của một quy tắc bóc tách. */
  assert.equal(payload.mappings[0].bounds.minX, 0);
  assert.equal(payload.mappings[0].id, "m1");

  /* Xoá trắng một ô là CỐ Ý — phải ghi thành `undefined` thật, không phải bị bỏ
     qua rồi giữ lại giá trị cũ. */
  const cleared = applyProfileEdits({ ...normalizeProfile(source), precision: undefined });
  assert.equal((cleared as any).drawing.precision, undefined);
  assert.ok("precision" in (cleared as any).drawing);
});

test("chỉ cho tích những mục máy chủ THẬT SỰ sửa được", () => {
  /* Danh sách CHO PHÉP, không phải danh sách cấm — đúng năm nhánh
     `drawingStandards.ts` dựng chương trình LISP. Viết theo kiểu cấm thì mỗi
     hành động mới máy chủ thêm vào mặc định được coi là sửa được, và người dùng
     phát hiện ra bằng một lỗi 400. */
  for (const action of ["apply-units", "sync-layers", "apply-dimstyle", "resize-frame"]) {
    assert.equal(
      unsupportedFixReason(normalizeIssue({ id: action, suggestedAction: action }, 0)),
      "",
      action,
    );
  }

  /* `dimspace` máy chủ chạy được, nhưng nó đòi `dimBaseHandle` mà màn hình chưa
     hỏi được — thiếu là 400. */
  assert.match(
    unsupportedFixReason(normalizeIssue({ id: "d1", suggestedAction: "dimspace" }, 0)),
    /chưa hỏi được/,
  );

  /* Ngoài danh sách → máy chủ IM LẶNG bỏ qua và trả `skippedIssueIds`. Trộn một
     mục như vậy vào lô sửa được là để người dùng tưởng đã sửa xong. */
  assert.match(
    unsupportedFixReason(normalizeIssue({ id: "r", suggestedAction: "review-mapping" }, 0)),
    /chỉ để xem/,
  );
  assert.ok(unsupportedFixReason(normalizeIssue({ id: "y" }, 0)));

  /* Dạng object cũng phải đọc ra được — máy chủ trả cả hai kiểu. */
  const nested = normalizeIssue({ id: "d2", suggestedAction: { action: "apply-units" } }, 0);
  assert.equal(nested.action, "apply-units");
  assert.equal(unsupportedFixReason(nested), "");
});

test("ô số của hồ sơ là BẮT BUỘC, không phải 'trống = không ràng buộc'", () => {
  /* `sanitizeDrawing`/`sanitizeDimension` gọi `numberValue()`, và hàm đó trả
     400 cho bất cứ thứ gì không phải số hữu hạn. Tôi từng viết trên giao diện
     rằng ô trống nghĩa là không ràng buộc — SAI, và người dùng chỉ phát hiện ra
     bằng một lỗi 400 sau khi đã gõ xong cả form. */
  const full = normalizeProfile({
    id: "p", name: "M", revision: "h",
    drawing: {
      unit: "mm", linearFormat: "Decimal", insunits: 4, precision: 0, modelScale: 1,
      frameTolerancePercent: 1,
      paper: { name: "A3", width: 420, height: 297 },
    },
    dimension: { styleName: "ACAD", textHeight: 2.5, overallScale: 1 },
  });
  assert.equal(profileSaveBlockedReason(full), "");

  /* `0` là HỢP LỆ và không được coi là thiếu — đó là cả lý do dùng `undefined`
     làm dấu hiệu trống thay vì dùng số 0. */
  assert.equal(profileSaveBlockedReason({ ...full, precision: 0 }), "");

  /* Thiếu thì phải NÓI RA TÊN Ô, không nói chung chung: form có bảy ô số. */
  const missing = profileSaveBlockedReason({ ...full, paperWidth: undefined });
  assert.match(missing, /Rộng khổ/);
  assert.match(profileSaveBlockedReason({ ...full, dimTextHeight: undefined }), /Cao chữ/);
  assert.match(profileSaveBlockedReason({ ...full, name: "  " }), /Tên hồ sơ/);

  /* Trường CHUỖI cũng bắt buộc — `stringValue()` từ chối chuỗi rỗng y như
     `numberValue()` từ chối `undefined`. Bỏ sót chúng là để người dùng gõ xong
     rồi ăn 400 cho một ô mà giao diện đã có thể nói trước. */
  assert.match(profileSaveBlockedReason({ ...full, unit: "" }), /Đơn vị/);
  assert.match(profileSaveBlockedReason({ ...full, paperName: " " }), /Tên khổ/);
  assert.match(profileSaveBlockedReason({ ...full, dimStyleName: "" }), /Tên dimstyle/);

  /* Khoảng giá trị lấy đúng từ daemon: lệch khỏi nó là hứa một thứ máy chủ sẽ
     từ chối, hoặc chặn một thứ nó chấp nhận. */
  assert.match(profileSaveBlockedReason({ ...full, insunits: 99 }), /nhỏ hơn hoặc bằng 24/);
  assert.match(profileSaveBlockedReason({ ...full, precision: 2.5 }), /số nguyên/);
  assert.match(profileSaveBlockedReason({ ...full, modelScale: 0 }), /lớn hơn hoặc bằng/);

  /* Khoảng lấy ĐÚNG từ daemon, không phải một khoảng "hợp lý" tự đoán. Đoán sai
     sinh ra hai loại lỗi cùng lúc: chặn hồ sơ máy chủ chấp nhận, và cho qua hồ
     sơ máy chủ từ chối. */
  assert.match(profileSaveBlockedReason({ ...full, paperWidth: 0.0005 }), /Rộng khổ/);
  assert.equal(profileSaveBlockedReason({ ...full, paperWidth: 0.001 }), "");
  /* Cao chữ = 0 là HỢP LỆ — dimstyle annotative lấy chiều cao từ style. */
  assert.equal(profileSaveBlockedReason({ ...full, dimTextHeight: 0 }), "");
});

test("bề dày nét: milimét 0–2.11, ba tên là CHUỖI", () => {
  /* Tôi từng dựng bảng này bằng mã DXF group 370 (1/100 mm, ba giá trị âm) —
     SAI. `standardLineweight()` của daemon chỉ nhận số trong `0…2.11`, nên mọi
     bề dày từ 0.05 trở lên sẽ ăn 400 lúc lưu, và ba giá trị âm cũng vậy. Việc
     đổi sang mã âm là của `lineweight()` ở bước áp dụng, không phải của kho. */
  const numeric = LINEWEIGHTS.filter((item) => typeof item.value === "number")
    .map((item) => item.value as number);
  assert.ok(numeric.length > 0);
  for (const value of numeric) {
    assert.ok(value >= 0 && value <= 2.11, `${value} ngoài khoảng daemon nhận`);
  }
  /* Ba tên phải là chuỗi, không phải số âm. */
  assert.deepEqual(
    LINEWEIGHTS.filter((item) => typeof item.value === "string").map((item) => item.value),
    ["Default", "ByLayer", "ByBlock"],
  );
});

test("bảng layer chặn đúng những gì daemon sẽ từ chối", () => {
  const rows = (over: Partial<LayerRule>[] = []): LayerRule[] => over.map((item) => ({
    name: "A", color: 7, linetype: "Continuous", lineweight: "Default", required: true,
    ...item,
  }));

  assert.deepEqual(layerRowErrors(rows([{ name: "TRUC" }])), [null]);

  /* Tên rỗng: `stringValue()` từ chối chuỗi rỗng. */
  assert.match(layerRowErrors(rows([{ name: " " }]))[0] ?? "", /không được để trống/);

  /* Trùng tên KHÔNG gây lỗi ở máy chủ — nó chỉ khiến một trong hai quy tắc
     không bao giờ có tác dụng, im lặng. So không phân biệt hoa thường vì
     AutoCAD cũng vậy. */
  const dup = layerRowErrors(rows([{ name: "Truc" }, { name: "TRUC" }]));
  assert.equal(dup[0], null);
  assert.match(dup[1] ?? "", /Trùng tên/);

  /* Màu ACI: số nguyên 0–256. */
  assert.match(layerRowErrors(rows([{ color: 300 }]))[0] ?? "", /0 đến 256/);
  assert.match(layerRowErrors(rows([{ color: 2.5 }]))[0] ?? "", /số nguyên/);
  assert.equal(layerRowErrors(rows([{ color: 256 }]))[0], null);
  /* Bề dày số: khoảng milimét, không phải mã 1/100 mm. */
  assert.equal(layerRowErrors(rows([{ lineweight: 0.35 }]))[0], null);
  assert.equal(layerRowErrors(rows([{ lineweight: 0 }]))[0], null);
  assert.match(layerRowErrors(rows([{ lineweight: 35 }]))[0] ?? "", /2\.11 mm/);

  /* Bề dày dạng chữ: ba tên hợp lệ… */
  for (const name of ["Default", "ByLayer", "ByBlock", "bylayer"]) {
    assert.equal(layerRowErrors(rows([{ lineweight: name }]))[0], null, name);
  }
  /* …và cả CHUỖI SỐ. `lineweight()` lúc áp dụng ép kiểu bằng `Number(value)` rồi
     nhận khoảng -3…211, nên `"0.35"` và `"35"` đều chạy được. Chặn chúng là
     chặn một hồ sơ đang hoạt động — và vì phép kiểm chạy cho MỌI dòng, hồ sơ đó
     sẽ không sửa được gì nữa, kể cả thứ chẳng liên quan. */
  assert.equal(layerRowErrors(rows([{ lineweight: "0.35" }]))[0], null);
  assert.equal(layerRowErrors(rows([{ lineweight: "35" }]))[0], null);
  /* Chuỗi KHÔNG hiểu được thì mới chặn — nó lưu êm rồi ném lỗi ở bước áp dụng. */
  assert.match(layerRowErrors(rows([{ lineweight: "Mỏng" }]))[0] ?? "", /không hiểu/);
  assert.match(layerRowErrors(rows([{ lineweight: " " }]))[0] ?? "", /không được để trống/);

  /* Màu dạng chữ: `numericColor()` hiểu ByLayer/ByBlock và chuỗi số, nhưng NÉM
     LỖI cho `RGB(...)`. Cho qua là để hồ sơ lưu được mà không áp dụng được. */
  assert.equal(layerRowErrors(rows([{ color: "ByLayer" }]))[0], null);
  assert.equal(layerRowErrors(rows([{ color: "7" }]))[0], null);
  assert.match(layerRowErrors(rows([{ color: "RGB(255,0,0)" }]))[0] ?? "", /không hiểu/);
});

test("bảng ánh xạ chặn đúng những gì daemon VÀ chương trình LISP từ chối", () => {
  const rows = (over: Partial<MappingRule>[]): MappingRule[] => over.map((item) => ({
    id: "m1", sourceId: "m1", label: "Tường", kind: "object",
    layerPatterns: ["A-*"], blockPatterns: [], textPatterns: [], entityTypes: [],
    required: false,
    ...item,
  }));

  assert.deepEqual(mappingRowErrors(rows([{}])), [null]);
  assert.match(mappingRowErrors(rows([{ id: "" }]))[0] ?? "", /không được để trống/);

  /* `PROFILE_ID_PATTERN` của daemon: bắt đầu bằng chữ/số, rồi chữ số . _ -
     Không kiểm ở đây là để người dùng gõ `foo/bar` rồi ăn 400. */
  assert.match(mappingRowErrors(rows([{ id: "foo/bar" }]))[0] ?? "", /chỉ được gồm/);
  assert.match(mappingRowErrors(rows([{ id: "-mo-dau" }]))[0] ?? "", /bắt đầu bằng/);
  assert.equal(mappingRowErrors(rows([{ id: "living-room.2_x" }]))[0], null);

  /* `assertUnique()` VIẾT HOA trước khi so, nên `A` và `a` là trùng với máy chủ
     dù nhìn khác nhau. So phân biệt hoa thường là cho qua một hồ sơ sẽ bị 400. */
  const dup = mappingRowErrors(rows([{ id: "abc" }, { id: "ABC" }]));
  assert.equal(dup[0], null);
  assert.match(dup[1] ?? "", /Trùng mã/);

  // `stringValue()` từ chối nhãn rỗng.
  assert.match(mappingRowErrors(rows([{ label: " " }]))[0] ?? "", /Nhãn không được/);

  /* `acadstd:pattern-p` trả TRUE cho mẫu rỗng, và `map-entity-p` coi "layer
     rỗng VÀ block rỗng" là khớp mọi thứ. Đây KHÔNG phải "không khớp gì" như tôi
     viết lúc đầu — nó ngược lại, và ngược đúng hướng nguy hiểm. */
  assert.match(
    mappingRowErrors(rows([{ layerPatterns: [] }]))[0] ?? "",
    /khớp MỌI đối tượng/,
  );

  /* Ba thứ thu hẹp được: mẫu layer, mẫu block, loại đối tượng. Mẫu CHỮ không
     nằm trong đó — `map-entity-p` không đọc nó. */
  assert.equal(
    mappingRowErrors(rows([{ layerPatterns: [], blockPatterns: ["WC-*"] }]))[0],
    null,
  );
  assert.equal(
    mappingRowErrors(rows([{ layerPatterns: [], entityTypes: ["LWPOLYLINE"] }]))[0],
    null,
  );

  /* Mẫu chữ ở loại KHÔNG phải `room` nằm im — `acadstd:scan-map` chỉ rẽ nhánh
     trên "ROOM". Để im lặng là hứa một cách khớp không tồn tại. */
  assert.match(
    mappingRowErrors(rows([{ kind: "object", textPatterns: ["WC*"] }]))[0] ?? "",
    /chỉ có tác dụng với loại/,
  );
  assert.equal(
    mappingRowErrors(rows([{ kind: "room", textPatterns: ["WC*"] }]))[0],
    null,
  );
  // Hoa/thường của `kind` không quan trọng: LISP so bằng `strcase`.
  assert.equal(
    mappingRowErrors(rows([{ kind: "ROOM", textPatterns: ["WC*"] }]))[0],
    null,
  );

  /* Quy tắc `room` CHỈ có mẫu chữ là hợp lệ — và tôi từng chặn nhầm nó.
     `acadstd:scan-room` tự thu hẹp bằng cấu trúc: nó chỉ nhận đường bao KÍN có
     một dòng TEXT/MTEXT nằm trong, và dùng chính mẫu chữ để chọn dòng đó. Lọc
     phòng theo nhãn là cách dùng thường gặp nhất của loại này. */
  assert.equal(
    mappingRowErrors(rows([{
      kind: "room", layerPatterns: [], blockPatterns: [], entityTypes: [],
      textPatterns: ["*PHÒNG*"],
    }]))[0],
    null,
  );
  /* Và một quy tắc `room` trống trơn cũng không bị chặn: "mọi đường bao kín có
     nhãn" là thứ diễn đạt được, khác hẳn "mọi đối tượng trong bản vẽ". */
  assert.equal(
    mappingRowErrors(rows([{
      kind: "room", layerPatterns: [], blockPatterns: [], entityTypes: [],
      textPatterns: [],
    }]))[0],
    null,
  );
});

test("dòng bảng hỏng thì CHẶN LƯU, kèm số dòng", () => {
  /* Hai bảng này không đi qua `numberValue()` như các ô số, nên nếu
     `profileSaveBlockedReason` bỏ qua chúng thì một layer trùng tên hay một ánh
     xạ không mẫu nào sẽ lưu êm — rồi hỏng ở màn Kiểm tra. */
  const base = normalizeProfile({
    id: "p", name: "M", revision: "h",
    drawing: {
      unit: "mm", linearFormat: "Decimal", insunits: 4, precision: 0, modelScale: 1,
      frameTolerancePercent: 1,
      paper: { name: "A3", width: 420, height: 297 },
    },
    dimension: { styleName: "ACAD", textHeight: 2.5, overallScale: 1 },
  });
  assert.equal(profileSaveBlockedReason(base), "");

  const badLayer = profileSaveBlockedReason({
    ...base,
    layers: [{ name: "", color: 7, linetype: "Continuous", lineweight: "Default", required: true }],
  });
  assert.match(badLayer, /[Ll]ayer/);
  assert.match(badLayer, /1/);

  const badMapping = profileSaveBlockedReason({
    ...base,
    mappings: [{
      id: "m1", sourceId: "m1", label: "", kind: "object",
      layerPatterns: [], blockPatterns: [], textPatterns: [], entityTypes: [],
      required: false,
    }],
  });
  assert.match(badMapping, /nh xạ/);
});

test("lưu layer và ánh xạ đã sửa THẬT SỰ đi vào bản gửi", () => {
  /* Cả hai bảng trước đây chỉ đọc, và `applyProfileEdits` chép nguyên từ bản
     gốc. Bê chúng thành sửa được mà quên bước ghi ngược là người dùng gõ xong,
     bấm Lưu, thấy báo thành công — và không có gì đổi. */
  const source = {
    id: "p1", name: "Mẫu", revision: "hash-a",
    drawing: { unit: "mm", insunits: 4, precision: 0, paper: { name: "A3", width: 420, height: 297 } },
    dimension: { styleName: "ACAD", textHeight: 2.5, overallScale: 1, arrowhead: "Closed" },
    layers: [{ name: "A", color: 7, linetype: "Continuous", lineweight: "Default", required: true }],
    mappings: [{
      id: "m1", label: "Tường", kind: "object", layerPatterns: ["A-*"],
      blockPatterns: [], textPatterns: [], entityTypes: [], required: true,
      bounds: { minX: 0 },
    }],
  };
  const loaded = normalizeProfile(source);
  const payload = applyProfileEdits({
    ...loaded,
    layers: [
      ...loaded.layers,
      { name: "DIM", color: 2, linetype: "HIDDEN", lineweight: 0.18, required: false },
    ],
    mappings: loaded.mappings.map((item) => ({ ...item, layerPatterns: ["A-*", "W-*"] })),
    dimensionExtras: { ...loaded.dimensionExtras, arrowhead: "Oblique" },
  }) as Record<string, any>;

  assert.equal(payload.layers.length, 2);
  assert.deepEqual(payload.layers[1], {
    name: "DIM", color: 2, linetype: "HIDDEN", lineweight: 0.18, required: false,
  });
  assert.deepEqual(payload.mappings[0].layerPatterns, ["A-*", "W-*"]);
  /* `bounds` không nằm trong form nhưng phải sống sót qua lượt sửa. */
  assert.equal(payload.mappings[0].bounds.minX, 0);
  /* Trường dimension nâng cao sửa qua bảng cũng phải tới nơi. */
  assert.equal(payload.dimension.arrowhead, "Oblique");
  /* …và ba ô có form riêng vẫn ở đúng chỗ của chúng. */
  assert.equal(payload.dimension.textHeight, 2.5);
});

test("chip phiên bản của lượt quét chụp lúc quét, không đọc lại sau", () => {
  /* Máy chủ trả `profileVersion` cùng lượt quét. Nếu màn hình đọc bộ đếm HIỆN
     TẠI của hồ sơ để hiển thị thì một lượt quét cũ sẽ tự khoác số mới — đúng
     thứ mà chip này sinh ra để bác bỏ. */
  const parsed = normalizeScan(
    { scanId: "s1", profileId: "p1", profileRevision: "hash-a", profileVersion: 7 },
    "/x.dwg",
  );
  assert.equal(parsed.profileVersion, 7);
  /* Máy chủ bản cũ chưa phát trường này — `0` để giao diện biết mà im, thay vì
     hiện "phiên bản NaN". */
  assert.equal(normalizeScan({ scanId: "s2" }, "/x.dwg").profileVersion, 0);

  /* Có đủ hai số thì lời cảnh báo nói bằng SỐ. */
  const note = profileDriftNote(
    scan({ profileRevision: "hash-a", profileVersion: 7 }),
    profile({ revision: "hash-b", version: 9 }),
  );
  assert.match(note, /phiên bản 7/);
  assert.match(note, /phiên bản 9/);

  /* Thiếu một vế thì KHÔNG bịa số — vẫn cảnh báo, nhưng không nói "phiên bản 0". */
  const silent = profileDriftNote(
    scan({ profileRevision: "hash-a", profileVersion: 0 }),
    profile({ revision: "hash-b", version: 9 }),
  );
  assert.doesNotMatch(silent, /phiên bản/);
  assert.match(silent, /đã đổi sau lượt quét/);
});

test("đổi mã ánh xạ KHÔNG được làm mất bounds", () => {
  /* Ô mã sửa được, và một lỗi gõ là thứ người ta sẽ sửa. Nếu `applyProfileEdits`
     tìm bản ghi gốc theo mã ĐANG HIỆN thì phép tìm trượt ngay lúc đó, và
     `bounds` — khung giới hạn diện tích của quy tắc bóc tách — biến mất không
     một lời báo. Tìm theo `sourceId` (mã lúc nạp về) mới đúng. */
  const source = {
    id: "p1", name: "Mẫu", revision: "hash-a",
    drawing: { unit: "mm", insunits: 4, precision: 0, paper: { name: "A3", width: 420, height: 297 } },
    dimension: { styleName: "ACAD", textHeight: 2.5, overallScale: 1 },
    mappings: [{
      id: "living-romm", label: "Phòng khách", kind: "room",
      layerPatterns: ["PHONG"], blockPatterns: [], textPatterns: [], entityTypes: [],
      required: false, bounds: { minArea: 6, maxArea: 80 },
    }],
  };
  const loaded = normalizeProfile(source);
  assert.equal(loaded.mappings[0].sourceId, "living-romm");

  // Chữa lỗi gõ trong mã.
  const renamed = applyProfileEdits({
    ...loaded,
    mappings: [{ ...loaded.mappings[0], id: "living-room" }],
  }) as Record<string, any>;
  assert.equal(renamed.mappings[0].id, "living-room");
  assert.deepEqual(renamed.mappings[0].bounds, { minArea: 6, maxArea: 80 });

  /* Dòng THÊM MỚI ở giao diện có `sourceId` rỗng — không được vơ lấy bản ghi
     nào cả, kể cả khi mã của nó tình cờ trùng một bản ghi đang có. */
  const added = applyProfileEdits({
    ...loaded,
    mappings: [
      loaded.mappings[0],
      {
        id: "living-romm", sourceId: "", label: "Trùng mã", kind: "object",
        layerPatterns: ["X"], blockPatterns: [], textPatterns: [], entityTypes: [],
        required: false,
      },
    ],
  }) as Record<string, any>;
  assert.deepEqual(added.mappings[0].bounds, { minArea: 6, maxArea: 80 });
  assert.equal(added.mappings[1].bounds, undefined);
});

test("bảng kích thước nâng cao không được đổi KIỂU của trường", () => {
  /* Bảng này là ô chữ tự do trên dữ liệu có kiểu. `numberValue()` của daemon từ
     chối thẳng một chuỗi — kể cả `"2"` — nên gõ chữ vào một trường số phải bị
     chặn TẠI ĐÂY, chứ không phải bằng một lỗi 400 không chỉ ra ô nào. */
  const saved = normalizeProfile({
    id: "p", name: "M", revision: "h",
    drawing: {
      unit: "mm", linearFormat: "Decimal", insunits: 4, precision: 0, modelScale: 1,
      frameTolerancePercent: 1,
      paper: { name: "A3", width: 420, height: 297 },
    },
    dimension: {
      styleName: "ACAD", textHeight: 2.5, overallScale: 1,
      textGap: 0.625, annotative: false, fit: "Best fit",
    },
  });
  assert.equal(profileSaveBlockedReason(saved, saved), "");

  /* Xoá trắng một trường số rồi gõ lại là đường sinh ra chuỗi — đúng ca đã hỏng
     khi kiểu được suy từ giá trị đang gõ thay vì từ bản đã lưu. */
  const asText = {
    ...saved,
    dimensionExtras: { ...saved.dimensionExtras, textGap: "0.7" },
  };
  assert.match(profileSaveBlockedReason(asText, saved), /textGap/);
  assert.match(profileSaveBlockedReason(asText, saved), /phải là một số/);

  /* Trường boolean cũng vậy: "false" là một chuỗi, và nó trông đúng nhất khi
     nhìn — `booleanValue()` từ chối. */
  const asBoolText = {
    ...saved,
    dimensionExtras: { ...saved.dimensionExtras, annotative: "false" },
  };
  assert.match(profileSaveBlockedReason(asBoolText, saved), /annotative/);
  assert.match(profileSaveBlockedReason(asBoolText, saved), /có\/không/);

  // Sửa đúng kiểu thì qua.
  assert.equal(profileSaveBlockedReason(
    { ...saved, dimensionExtras: { ...saved.dimensionExtras, textGap: 0.7, annotative: true } },
    saved,
  ), "");

  /* Trường chuỗi vẫn tự do — `fit` là prose, không phải số. */
  assert.equal(profileSaveBlockedReason(
    { ...saved, dimensionExtras: { ...saved.dimensionExtras, fit: "Text only" } },
    saved,
  ), "");

  /* Không có bản đã lưu để đối chiếu thì KHÔNG kết luận: đoán kiểu từ bản nháp
     là đoán từ chính cái giá trị hỏng cần bắt. */
  assert.equal(profileSaveBlockedReason(asText), "");
});

test("hai trường drawing panel cũ sửa được phải đi tới nơi", () => {
  /* `linearFormat` và `frameTolerancePercent` từng vô hình ở màn mới: chúng sống
     sót qua mỗi lượt lưu nhờ phép vá `...drawing`, nên không ai mất dữ liệu và
     cũng không ai biết chúng tồn tại. Đúng loại lỗi với 20 trường dimension,
     chỉ nhỏ hơn — và chỉ lộ ra khi rà lại panel cũ trước lúc xoá nó. */
  const source = {
    id: "p", name: "M", revision: "h",
    drawing: {
      unit: "mm", linearFormat: "Decimal", insunits: 4, precision: 0, modelScale: 1,
      frameTolerancePercent: 1,
      paper: { name: "A3", width: 420, height: 297 },
    },
    dimension: { styleName: "ACAD", textHeight: 2.5, overallScale: 1 },
  };
  const loaded = normalizeProfile(source);
  assert.equal(loaded.linearFormat, "Decimal");
  assert.equal(loaded.frameTolerancePercent, 1);

  const payload = applyProfileEdits({
    ...loaded, linearFormat: "Architectural", frameTolerancePercent: 2.5,
  }) as Record<string, any>;
  assert.equal(payload.drawing.linearFormat, "Architectural");
  assert.equal(payload.drawing.frameTolerancePercent, 2.5);

  /* Cả hai đều BẮT BUỘC ở daemon: `stringValue()` từ chối chuỗi rỗng,
     `numberValue()` từ chối `undefined`, và dung sai phải nằm trong 0–100. */
  assert.equal(profileSaveBlockedReason(loaded, loaded), "");
  assert.match(profileSaveBlockedReason({ ...loaded, linearFormat: " " }, loaded), /Kiểu ghi số/);
  assert.match(
    profileSaveBlockedReason({ ...loaded, frameTolerancePercent: undefined }, loaded),
    /Dung sai khung/,
  );
  assert.match(
    profileSaveBlockedReason({ ...loaded, frameTolerancePercent: 101 }, loaded),
    /nhỏ hơn hoặc bằng 100/,
  );
  assert.equal(profileSaveBlockedReason({ ...loaded, frameTolerancePercent: 0 }, loaded), "");
});

test("kiểu ghi số phải là thứ bước áp dụng hiểu được", () => {
  /* Cùng cái bẫy với màu `RGB(...)` và bề dày dạng chữ lạ: `stringValue()` lúc
     lưu cho qua mọi chuỗi, `linearFormat()` lúc áp dụng chỉ hiểu năm tên hoặc
     số 1–5. Không chặn ở đây là để hồ sơ lưu êm rồi chết ở `apply-units`. */
  const base = normalizeProfile({
    id: "p", name: "M", revision: "h",
    drawing: {
      unit: "mm", linearFormat: "Decimal", insunits: 4, precision: 0, modelScale: 1,
      frameTolerancePercent: 1,
      paper: { name: "A3", width: 420, height: 297 },
    },
    dimension: { styleName: "ACAD", textHeight: 2.5, overallScale: 1 },
  });
  assert.equal(profileSaveBlockedReason(base, base), "");

  for (const name of LINEAR_FORMATS) {
    assert.equal(profileSaveBlockedReason({ ...base, linearFormat: name }, base), "", name);
  }
  // Hoa/thường không quan trọng — daemon so sau khi hạ chữ.
  assert.equal(profileSaveBlockedReason({ ...base, linearFormat: "decimal" }, base), "");
  // Số 1–5 cũng hợp lệ.
  for (const value of ["1", "5"]) {
    assert.equal(profileSaveBlockedReason({ ...base, linearFormat: value }, base), "", value);
  }
  assert.match(profileSaveBlockedReason({ ...base, linearFormat: "6" }, base), /không hiểu/);
  assert.match(profileSaveBlockedReason({ ...base, linearFormat: "foo" }, base), /không hiểu/);
});

test("giới hạn độ dài chữ lấy đúng từ daemon", () => {
  /* `stringValue(..., {maxLength})` của daemon từ chối chuỗi dài — và các ô này
     gõ tự do nên dán một đoạn dài là chạm tới ngay. Ô Loại vừa được mở thành gõ
     tự do ở chính lượt này, nên giới hạn 64 của nó mới trở nên với tới được. */
  const layers = (over: Partial<LayerRule>): LayerRule[] => [{
    name: "A", color: 7, linetype: "Continuous", lineweight: "Default", required: true,
    ...over,
  }];
  const maps = (over: Partial<MappingRule>): MappingRule[] => [{
    id: "m1", sourceId: "m1", label: "Tường", kind: "object",
    layerPatterns: ["A-*"], blockPatterns: [], textPatterns: [], entityTypes: [],
    required: false,
    ...over,
  }];

  assert.equal(layerRowErrors(layers({ name: "x".repeat(255) }))[0], null);
  assert.match(layerRowErrors(layers({ name: "x".repeat(256) }))[0] ?? "", /255 ký tự/);
  assert.match(
    layerRowErrors(layers({ linetype: "x".repeat(256) }))[0] ?? "",
    /Kiểu nét dài quá/,
  );

  assert.equal(mappingRowErrors(maps({ kind: "k".repeat(64) }))[0], null);
  assert.match(mappingRowErrors(maps({ kind: "k".repeat(65) }))[0] ?? "", /64 ký tự/);
  assert.equal(mappingRowErrors(maps({ label: "L".repeat(160) }))[0], null);
  assert.match(mappingRowErrors(maps({ label: "L".repeat(161) }))[0] ?? "", /160 ký tự/);

  /* Đo trên chuỗi ĐÃ TRIM: `stringValue()` gọi `value.trim()` rồi mới so với
     `maxLength`, nên một dấu cách thừa ở cuối KHÔNG được làm hồ sơ bị chặn —
     máy chủ sẽ nhận nó bình thường. */
  assert.equal(mappingRowErrors(maps({ kind: " " + "k".repeat(64) + " " }))[0], null);
  assert.equal(mappingRowErrors(maps({ label: "L".repeat(160) + "  " }))[0], null);
  assert.equal(layerRowErrors(layers({ linetype: "x".repeat(255) + " " }))[0], null);
});

test("gom đối tượng theo ánh xạ — quy tắc bắt 0 KHÔNG được biến mất", () => {
  /* Đây là vòng phản hồi duy nhất cho câu "ánh xạ của tôi có đúng không": máy
     chủ không có dry-run, nên cách kiểm duy nhất là lưu → quét → nhìn số đối
     tượng. Một quy tắc bắt 0 vắng mặt hoàn toàn khỏi `scan.objects`, mà đấy lại
     là dấu hiệu quy tắc sai rõ nhất — nên phải lấy danh sách ánh xạ từ HỒ SƠ. */
  const mapping = (id: string, label: string): MappingRule => ({
    id, sourceId: id, label, kind: "object",
    layerPatterns: ["X"], blockPatterns: [], textPatterns: [], entityTypes: [],
    required: false,
  });
  const object = (mappingId: string, area?: number): any => ({
    mappingId, handle: "H" + mappingId, type: "LWPOLYLINE", layer: "A",
    width: 4800, height: 5200, area, areaUnit: area === undefined ? "" : "m²",
  });

  const parsed = normalizeScan({
    scanId: "s1",
    objects: [object("tuong", 24.96), object("tuong", 7.68), object("phong", 214.8)],
    evidence: { standardsScan: { objectsTruncated: true, maxObjects: 2000 } },
  }, "/x.dwg");

  assert.equal(parsed.objects.length, 3);
  assert.equal(parsed.objects[0].areaUnit, "m²");
  /* Cờ cắt đọc từ bằng chứng của máy chủ, KHÔNG cộng tay từ các nhóm: máy chủ
     tính nó trên số đối tượng TRƯỚC bộ lọc diện tích. */
  assert.equal(parsed.objectsTruncated, true);
  assert.equal(parsed.maxObjects, 2000);
  assert.equal(normalizeScan({ scanId: "s2" }, "/x.dwg").objectsTruncated, false);

  const groups = groupObjectsByMapping(parsed.objects, [
    mapping("tuong", "Tường"), mapping("phong", "Phòng"), mapping("khung", "Khung tên"),
  ]);
  assert.deepEqual(groups.map((g) => [g.id, g.count]), [
    ["tuong", 2], ["phong", 1], ["khung", 0],
  ]);
  assert.equal(groups[0].label, "Tường");
  assert.ok(Math.abs((groups[0].area ?? 0) - 32.64) < 1e-9);
  assert.equal(groups[0].areaUnit, "m²");

  /* Thứ tự theo HỒ SƠ, và mã chỉ có trong kết quả (hồ sơ đã đổi sau lượt quét)
     vẫn hiện, xếp sau. */
  const drifted = groupObjectsByMapping(parsed.objects, [mapping("phong", "Phòng")]);
  assert.deepEqual(drifted.map((g) => g.id), ["phong", "tuong"]);

  /* Không đối tượng nào ĐO ĐƯỢC diện tích thì tổng là `undefined`, không phải
     `0` — hiện "0,00 m²" là nói bản vẽ có vùng rỗng, trong khi sự thật là chưa
     đo được cái nào. */
  const unmeasured = normalizeScan(
    { scanId: "s3", objects: [object("tuong"), object("tuong")] }, "/x.dwg",
  );
  assert.equal(groupObjectsByMapping(unmeasured.objects, [mapping("tuong", "T")])[0].area, undefined);

  /* `0` cũng là CHƯA ĐO ĐƯỢC, không phải diện tích bằng không — chương trình
     LISP trả 0 cho thứ nó không đo nổi. Đo trên bản vẽ thật: 8 đối tượng khung
     tên, cả 8 đều `area: 0, width: 0, height: 0`, và chính bộ máy gọi đó là
     "chưa đo được kích thước tự động". Cộng chúng lại thành "0,00 m²" là bịa ra
     tám vùng rỗng ngay tại con số dùng để bóc tách. */
  const zeroArea = normalizeScan({
    scanId: "s4",
    objects: [
      { mappingId: "khung", handle: "1FC17", type: "INSERT", layer: "0",
        width: 0, height: 0, area: 0, areaUnit: "m²" },
      { mappingId: "khung", handle: "1FC18", type: "INSERT", layer: "0",
        width: 0, height: 0, area: 0, areaUnit: "m²" },
    ],
  }, "/x.dwg");
  const khung = groupObjectsByMapping(zeroArea.objects, [mapping("khung", "Khung tên")])[0];
  assert.equal(khung.count, 2, "vẫn đếm đủ đối tượng");
  assert.equal(khung.area, undefined, "nhưng KHÔNG cộng ra 0");

  /* Trộn đo được với chưa đo được thì chỉ cộng phần đo được. */
  const mixed = normalizeScan({
    scanId: "s5",
    objects: [object("tuong", 10), object("tuong", 0), object("tuong", 5)],
  }, "/x.dwg");
  assert.equal(groupObjectsByMapping(mixed.objects, [mapping("tuong", "T")])[0].area, 15);
});

test("ánh xạ bắt 0 chỉ đáng báo động khi BẮT BUỘC", () => {
  /* Hồ sơ mặc định có hai ánh xạ `required: false` (`living-room`,
     `section-plane`). Phiên bản đầu của bảng gắn "gần như chắc chắn sai" cho
     đúng hai dòng hoàn toàn lành — trên chính bản vẽ tôi đem ra làm bằng chứng
     là bảng chạy đúng. Một ánh xạ tuỳ chọn bắt 0 chỉ có nghĩa là bản vẽ này
     không có loại đó. */
  const mapping = (id: string, required: boolean): MappingRule => ({
    id, sourceId: id, label: id, kind: "object",
    layerPatterns: ["X"], blockPatterns: [], textPatterns: [], entityTypes: [],
    required,
  });
  const groups = groupObjectsByMapping([], [
    mapping("bat-buoc", true), mapping("tuy-chon", false),
  ]);
  assert.deepEqual(groups.map((g) => [g.id, g.count, g.required]), [
    ["bat-buoc", 0, true], ["tuy-chon", 0, false],
  ]);

  /* Mã chỉ có trong kết quả — hồ sơ đã đổi sau lượt quét — thì không biết nó có
     bắt buộc hay không, nên coi là KHÔNG. Chiều im lặng: báo động sai làm người
     dùng thôi tin cả bảng. */
  const drifted = groupObjectsByMapping(
    [{ mappingId: "la", label: "", kind: "", handle: "h", type: "", layer: "",
       width: undefined, height: undefined, area: undefined, areaUnit: "" }],
    [],
  );
  assert.equal(drifted[0].required, false);
});

test("hồ sơ đã đổi sau lượt quét thì KHÔNG dựng dòng bắt 0 từ hồ sơ mới", () => {
  /* Cùng một khuôn đã ám cả tính năng này: hai nguồn đọc ở hai thời điểm sẽ
     lệch. Kết quả quét là của hồ sơ phiên bản N; `profile.mappings` đã là N+1.
     Gom số liệu cũ theo danh sách mới thì một quy tắc VỪA THÊM hiện ra như "bắt
     0" dù nó chưa từng được quét, và một quy tắc vừa đổi tên dán nhãn mới lên
     số liệu cũ.

     Giao diện xử lý bằng cách truyền danh sách RỖNG khi lệch. Test này khoá
     hành vi của `groupObjectsByMapping` ở đúng ca đó: chỉ còn thứ thật sự tìm
     được, và nhãn lấy từ chính đối tượng — nhãn máy chủ gắn LÚC QUÉT. */
  const objects = [{
    mappingId: "tuong", label: "Tường (tên lúc quét)", kind: "object",
    handle: "h1", type: "LWPOLYLINE", layer: "A",
    width: 10, height: 10, area: 24.96, areaUnit: "m²",
  }];
  const parsed = normalizeScan({ scanId: "s1", objects }, "/x.dwg");

  const stale = groupObjectsByMapping(parsed.objects, []);
  assert.equal(stale.length, 1, "chỉ còn nhóm THẬT SỰ tìm được");
  assert.equal(stale[0].label, "Tường (tên lúc quét)", "nhãn lấy từ đối tượng");
  assert.equal(stale[0].required, false, "không suy 'bắt buộc' từ hồ sơ đã lệch");

  /* Đối chiếu: cùng dữ liệu ấy gom theo hồ sơ MỚI sẽ đẻ thêm một dòng bắt 0 cho
     quy tắc chưa từng được quét — đúng thứ phải tránh. */
  const withNew = groupObjectsByMapping(parsed.objects, [{
    id: "vua-them", sourceId: "", label: "Vừa thêm", kind: "object",
    layerPatterns: ["Z"], blockPatterns: [], textPatterns: [], entityTypes: [],
    required: true,
  }]);
  assert.equal(withNew.length, 2);
  assert.equal(withNew[0].count, 0);
});

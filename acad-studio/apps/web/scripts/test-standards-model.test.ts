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
  type Issue,
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
  scannedAt: "",
  issues: [],
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
    layers: [{ name: "A", bounds: { x: 1 } }],
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

  /* Layer và mapping đi NGUYÊN từ bản gốc, kể cả `bounds` mà bước chuẩn hoá đã
     bỏ đi — gửi bản đã chuẩn hoá là làm mất chúng. */
  assert.deepEqual(payload.layers, source.layers);
  assert.deepEqual(payload.mappings, source.mappings);

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
      unit: "mm", insunits: 4, precision: 0, modelScale: 1,
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

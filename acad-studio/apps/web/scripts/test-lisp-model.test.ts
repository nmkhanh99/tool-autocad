import assert from "node:assert/strict";
import test from "node:test";
import {
  coverageIsComplete,
  coverageLabel,
  formatBytes,
  kindLabel,
  loadBlockLabel,
  normalizeResource,
  normalizeRoot,
  resourceMatches,
  reviewLabel,
  warningLabel,
} from "../features/lisp/model";

test("mã lạ được trả lại nguyên văn, không nuốt thành ô trống", () => {
  // Một nhãn xấu còn tra được trong code; một ô trống thì không.
  assert.equal(reviewLabel("mot_trang_thai_moi"), "mot_trang_thai_moi");
  assert.equal(kindLabel("dinh-dang-la"), "dinh-dang-la");
  assert.equal(warningLabel("canh_bao_moi_cua_daemon"), "canh_bao_moi_cua_daemon");
  assert.equal(loadBlockLabel("ly_do_moi"), "ly_do_moi");
});

test("đủ nhãn cho cả ba trạng thái duyệt", () => {
  for (const status of ["approved", "stale", "unreviewed"] as const) {
    assert.notEqual(reviewLabel(status), status, `thiếu nhãn tiếng Việt cho ${status}`);
  }
});

test("đủ nhãn cho mọi mã cảnh báo daemon đang phát", () => {
  /* Danh sách lấy từ `grep 'warnings.push' apps/daemon/src/lispLibrary.ts`.
     Thêm mã mới ở daemon mà quên nhãn thì test này đỏ, thay vì để người dùng
     nhìn thấy `manifest_dependency_or_source_changed` trên màn hình. */
  for (const code of [
    "manifest_inferred_unreviewed",
    "compiled_source_not_readable",
    "vlx_windows_only",
    "manifest_dependency_or_source_changed",
    "staged_support_paths_added_to_autocad_session",
  ]) {
    assert.notEqual(warningLabel(code), code, `thiếu nhãn tiếng Việt cho ${code}`);
  }
});

test("đủ nhãn cho mọi lý do chặn nạp", () => {
  for (const reason of [
    "vlx_windows_only",
    "dcl_requires_load_dialog",
    "scr_catalog_only",
    "unsupported",
  ]) {
    assert.notEqual(loadBlockLabel(reason), reason, `thiếu nhãn tiếng Việt cho ${reason}`);
  }
});

test("normalizeResource bỏ bản ghi không có id", () => {
  assert.equal(normalizeResource(null), null);
  assert.equal(normalizeResource({ name: "khong-co-id" }), null);
  assert.equal(normalizeResource({ id: "   " }), null);
});

test("reviewStatus lạ rơi về unreviewed, không rơi về approved", () => {
  // Fail-closed: một trạng thái không hiểu được không bao giờ được thành "đã duyệt".
  assert.equal(normalizeResource({ id: "a", reviewStatus: "gi-do" })?.reviewStatus, "unreviewed");
  assert.equal(normalizeResource({ id: "a" })?.reviewStatus, "unreviewed");
  assert.equal(normalizeResource({ id: "a", reviewStatus: "approved" })?.reviewStatus, "approved");
});

test("readable/loadable chỉ true khi đúng boolean true", () => {
  // Fail-closed: chuỗi "false" hay 1 không được thành true.
  assert.equal(normalizeResource({ id: "a", readable: "true" })?.readable, false);
  assert.equal(normalizeResource({ id: "a", readable: 1 })?.readable, false);
  assert.equal(normalizeResource({ id: "a", readable: true })?.readable, true);
});

test("danh sách chuỗi lọc bỏ phần tử không phải chuỗi", () => {
  const resource = normalizeResource({ id: "a", commands: ["CTY-FIX", 42, null, "CTY-SET"] });
  assert.deepEqual(resource?.commands, ["CTY-FIX", "CTY-SET"]);
});

test("normalizeRoot bỏ bản ghi không có id, và lùi về id khi thiếu nhãn", () => {
  assert.equal(normalizeRoot({ path: "/a" }), null);
  assert.equal(normalizeRoot({ id: "r1", path: "/a" })?.label, "r1");
  assert.equal(normalizeRoot({ id: "r1", name: "Thư viện" })?.label, "Thư viện");
});

test("tìm kiếm khớp cả tên lệnh, không chỉ tên file", () => {
  const resource = normalizeResource({
    id: "LSP-01",
    name: "Gán layer",
    pathLabel: "cty/layer.lsp",
    commands: ["CTY-LAYERFIX"],
    functions: ["c:cty-layerfix"],
  })!;
  assert.equal(resourceMatches(resource, "layerfix"), true, "phải khớp theo tên lệnh");
  assert.equal(resourceMatches(resource, "cty/layer"), true, "phải khớp theo đường dẫn");
  assert.equal(resourceMatches(resource, ""), true, "từ khoá rỗng khớp tất cả");
  assert.equal(resourceMatches(resource, "khong-co"), false);
});

test("formatBytes đổi đơn vị đúng mốc", () => {
  assert.equal(formatBytes(512), "512 B");
  assert.equal(formatBytes(2048), "2.0 KB");
  assert.equal(formatBytes(3 * 1024 * 1024), "3.0 MB");
});

test("bằng chứng duyệt chỉ đọc khi manifest.review.status là approved", () => {
  // Manifest có review nhưng chưa duyệt thì KHÔNG được coi là có bằng chứng.
  assert.equal(normalizeResource({ id: "a", manifest: null })?.review, null);
  assert.equal(normalizeResource({ id: "a", manifest: {} })?.review, null);
  assert.equal(
    normalizeResource({ id: "a", manifest: { review: { status: "unreviewed" } } })?.review,
    null,
  );
  assert.notEqual(
    normalizeResource({ id: "a", manifest: { review: { status: "approved" } } })?.review,
    null,
  );
});

test("bản duyệt không ghi phạm vi rơi về manual-review, không rơi về full-source", () => {
  /* Đây là chỗ dễ nói dối nhất: thiếu dữ liệu mà mặc định "đọc hết source" sẽ
     biến một bản duyệt không kiểm chứng được thành một bản duyệt đáng tin. */
  const review = normalizeResource({
    id: "a", manifest: { review: { status: "approved" } },
  })?.review;
  assert.equal(review?.analysisCoverage, "manual-review");
  assert.equal(coverageIsComplete("manual-review"), false);
  assert.equal(coverageIsComplete("metadata-only"), false);
  assert.equal(coverageIsComplete("partial-source"), false);
  assert.equal(coverageIsComplete("full-source"), true);
});

test("acknowledgedIncomplete chỉ true khi đúng boolean true", () => {
  const of = (value: unknown) => normalizeResource({
    id: "a",
    manifest: { review: { status: "approved", acknowledgedIncompleteAnalysis: value } },
  })?.review?.acknowledgedIncomplete;
  assert.equal(of("true"), false);
  assert.equal(of(1), false);
  assert.equal(of(true), true);
});

test("đủ nhãn cho mọi giá trị analysisCoverage máy chủ ghi ra", () => {
  for (const coverage of ["full-source", "partial-source", "metadata-only", "manual-review"]) {
    assert.notEqual(coverageLabel(coverage), coverage, `thiếu nhãn cho ${coverage}`);
  }
  assert.equal(coverageLabel("pham-vi-moi"), "pham-vi-moi");
});

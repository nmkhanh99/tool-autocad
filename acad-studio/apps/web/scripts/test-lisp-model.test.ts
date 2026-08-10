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
import { lispFailureText } from "../features/lisp/actions";
import { DaemonError } from "../lib/daemon/client";

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
    "source_too_large",
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

/* ── Giải mã lỗi của luồng nạp ──────────────────────────────────────────────
   Vài mã của daemon mang tham số sau dấu hai chấm, nên `guards.ts` (tra theo mã
   trần) không khớp được. Không dịch thì người dùng đọc đúng chuỗi thô kiểu
   `dependency_review_required:LSP-07:cty/common.lsp`. */

test("mã lỗi mang tham số được dịch, không lộ chuỗi thô", () => {
  const of = (code: string) => lispFailureText(new DaemonError(code, code, 409));

  const review = of("review_required:stale");
  assert.match(review, /Bản duyệt đã cũ/, "phải dịch cả trạng thái trong mã");
  assert.doesNotMatch(review, /review_required:/, "không được lộ mã thô");

  const dependency = of("dependency_review_required:LSP-07:cty/common.lsp");
  assert.match(dependency, /cty\/common\.lsp/, "phải nói rõ phụ thuộc nào");
  assert.doesNotMatch(dependency, /LSP-07:/, "không được lộ mã thô");

  const unresolved = of("dependency_unresolved:cty/missing.lsp");
  assert.match(unresolved, /cty\/missing\.lsp/);
  assert.doesNotMatch(unresolved, /dependency_unresolved/);
});

test("tham chiếu phụ thuộc chứa dấu hai chấm không bị cắt mất", () => {
  // `split(":")` ngây thơ sẽ cắt mất phần sau dấu hai chấm thứ ba.
  const text = lispFailureText(
    new DaemonError("x", "dependency_review_required:LSP-07:C:/lisp/common.lsp", 409),
  );
  assert.match(text, /C:\/lisp\/common\.lsp/);
});

test("mã không tham số vẫn dùng câu chữ dùng chung của guards", () => {
  const text = lispFailureText(new DaemonError("revision_conflict", "revision_conflict", 409));
  assert.doesNotMatch(text, /^revision_conflict$/, "phải có câu giải thích, không phải mã trần");
  assert.ok(text.length > 20, "guard phải cho ra một câu đủ nghĩa");
});

test("mã lạ hoàn toàn vẫn ra được thông điệp của daemon", () => {
  const text = lispFailureText(new DaemonError("Máy chủ nói gì đó", "mot_ma_moi_tinh", 500));
  assert.ok(text.length > 0);
});

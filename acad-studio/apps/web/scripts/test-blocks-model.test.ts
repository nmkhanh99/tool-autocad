/** Chuẩn hoá dữ liệu block.
 *
 * Đây là lớp quyết định người dùng NHÌN THẤY trạng thái đồng bộ nào. Sai ở đây
 * không gây lỗi — nó chỉ hiển thị sai, và người dùng chèn một block họ tưởng đã
 * khớp thư viện. Panel legacy và route mới dùng chung file này, nên test cũng
 * bảo vệ cả hai.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  blockMatches,
  emptyBlock,
  validateBlockDraft,
  localDuplicateGroups,
  normalizeBlock,
  normalizeSource,
  slugifyTechnicalName,
  syncLabel,
  type BlockDefinition,
} from "../features/blocks/model";

const base = { id: "b1", technicalName: "VAN-CONG-DN80" };

test("giữ đủ 5 trạng thái đồng bộ của backend", () => {
  // Bộ mẫu thiết kế chỉ vẽ 3. Ép xuống 3 sẽ nuốt mất `conflict` — trạng thái
  // duy nhất người dùng buộc phải xử lý tay.
  const states = ["local_only", "cad_only", "synced", "outdated", "conflict"] as const;
  for (const state of states) {
    assert.equal(normalizeBlock({ ...base, syncStatus: state })?.syncStatus, state);
  }
  assert.equal(new Set(states.map(syncLabel)).size, 5, "5 trạng thái phải có 5 nhãn khác nhau");
});

test("trạng thái lạ lùi về local_only, không lùi về synced", () => {
  // Lùi sai hướng là nói với người dùng rằng block đã khớp thư viện.
  assert.equal(normalizeBlock({ ...base, syncStatus: "gì đó" })?.syncStatus, "local_only");
  assert.equal(normalizeBlock({ ...base })?.syncStatus, "local_only");
});

test("bỏ bản ghi thiếu id hoặc tên kỹ thuật", () => {
  assert.equal(normalizeBlock({ technicalName: "X" }), null);
  assert.equal(normalizeBlock({ id: "b1" }), null);
  assert.equal(normalizeBlock({ id: "  ", technicalName: "  " }), null);
  assert.equal(normalizeBlock(null), null);
});

test("chỉ nhận không gian hợp lệ", () => {
  const block = normalizeBlock({ ...base, allowedSpaces: ["model", "paper", "layout"] });
  assert.deepEqual(block?.allowedSpaces, ["model", "layout"]);
});

test("điểm chèn không hợp lệ về 0 thay vì NaN", () => {
  const block = normalizeBlock({ ...base, basePoint: { x: "abc", y: 5, z: null } });
  assert.deepEqual(block?.basePoint, { x: 0, y: 5, z: 0 });
});

test("tên kỹ thuật bỏ dấu tiếng Việt và về chữ thường, gạch dưới", () => {
  // Tên block đi vào AutoCAD nên phải là ASCII. Đặc biệt `đ`/`Đ` không có dạng
  // tổ hợp dấu nên `normalize("NFD")` không xử lý được — phải thay riêng.
  assert.equal(slugifyTechnicalName("Van cổng DN80"), "van_cong_dn80");
  assert.equal(slugifyTechnicalName("Đường ống"), "duong_ong");
  assert.equal(slugifyTechnicalName("  nhiều   khoảng  trắng "), "nhieu_khoang_trang");
  // Không bao giờ trả rỗng: AutoCAD cần một tên block hợp lệ, nên có lùi về
  // "block" thay vì để người dùng gửi lên một tên trống.
  assert.equal(slugifyTechnicalName("---"), "block");
  assert.equal(slugifyTechnicalName(""), "block");
});

test("tìm kiếm khớp cả tên hiển thị, tên kỹ thuật và thẻ", () => {
  const block = normalizeBlock({
    ...base, displayName: "Van cổng", tags: ["cấp nước", "DN80"],
  }) as BlockDefinition;
  assert.ok(blockMatches(block, ""));
  assert.ok(blockMatches(block, "van cổng"));
  assert.ok(blockMatches(block, "dn80"));
  assert.ok(!blockMatches(block, "không có gì khớp"));
});

test("nguồn thư viện lạ bị loại", () => {
  assert.ok(normalizeSource({ id: "s1", kind: "dwg", path: "/a.dwg" }));
  assert.equal(normalizeSource({ kind: "dwg", path: "/a.dwg" }), null);
  assert.equal(normalizeSource(null), null);
});

test("phát hiện trùng tên kỹ thuật trong danh sách hiện tại", () => {
  const blocks = [
    normalizeBlock({ id: "a", technicalName: "VAN-DN80" }),
    normalizeBlock({ id: "b", technicalName: "VAN-DN80" }),
    normalizeBlock({ id: "c", technicalName: "VAN-DN100" }),
  ].filter(Boolean) as BlockDefinition[];

  const groups = localDuplicateGroups(blocks);
  assert.equal(groups.length, 1, "chỉ một nhóm trùng");
  assert.deepEqual([...groups[0].blockIds].sort(), ["a", "b"]);
});


test("tên kỹ thuật chỉ nhận ASCII an toàn", () => {
  const ok = (name: string) => validateBlockDraft({ ...emptyBlock(), id: "b", displayName: "X", technicalName: name });
  assert.equal(ok("VAN_CONG-DN80.v2"), "", "chữ, số, chấm, gạch dưới, gạch ngang đều hợp lệ");
  assert.match(ok("Van cổng"), /ASCII/, "dấu tiếng Việt và khoảng trắng bị chặn");
  assert.match(ok("van cong"), /ASCII/, "khoảng trắng bị chặn");
  assert.match(ok("-batdau"), /ASCII/, "không được bắt đầu bằng dấu");
  assert.match(ok(""), /ASCII/);
  assert.equal(ok("a".repeat(128)), "", "128 ký tự là giới hạn trên");
  assert.match(ok("a".repeat(129)), /ASCII/, "vượt 128 bị chặn");
});

test("các trường bắt buộc đều được kiểm", () => {
  const base = { ...emptyBlock(), id: "b", technicalName: "VAN", displayName: "Van" };
  assert.equal(validateBlockDraft(base), "");
  assert.match(validateBlockDraft({ ...base, displayName: "  " }), /Tên hiển thị/);
  assert.match(validateBlockDraft({ ...base, defaultLayer: "" }), /Layer mặc định/);
  assert.match(validateBlockDraft({ ...base, units: "" }), /Đơn vị/);
  assert.match(validateBlockDraft({ ...base, allowedSpaces: [] }), /Model hoặc Layout/);
  assert.match(validateBlockDraft(null), /Chưa có block/);
});

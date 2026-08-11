/** Đọc hiểu hồ sơ bản vẽ.
 *
 * Màn hình này chỉ đọc, nên sai ở đây không hỏng bản vẽ — nó in ra một con số
 * SAI mà kỹ sư dùng để quyết định. Ba con số dễ nhầm nhất được test dày nhất:
 * `dbmod` là cờ bit chứ không phải số đếm, `approxObjects` không phải số đối
 * tượng, và `extents` trộn các không gian.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  actionLabel,
  activateBlockedReason,
  activeDocFile,
  actionSubjectNote,
  entityTotals,
  insUnitsLabel,
  isModified,
  layerColor,
  layerFlags,
  layerRows,
  lineweightLabel,
  normalize,
  operationTarget,
  prepareBlockedReason,
  scopeValues,
  selectedCount,
  selectionScopeNote,
  staleDrawingNote,
  typeBars,
  usableExtents,
} from "../features/drawing-info/model";

/* ---------------- Con số dễ đọc sai ---------------- */

test("dbmod là CỜ BIT, khác 0 là đã sửa", () => {
  /* Bản vẽ as-built thật có `dbmod: 24`. Kiểm bằng `=== 1` sẽ báo là sạch, và
     người dùng đóng AutoCAD mất thay đổi mà app đã bảo là không có gì. */
  assert.equal(isModified({ document: { dbmod: 24 } }), true);
  assert.equal(isModified({ document: { dbmod: 1 } }), true);
  assert.equal(isModified({ document: { dbmod: 0 } }), false);
  assert.equal(isModified({}), false);
});

test("approxObjects KHÔNG phải số đối tượng", () => {
  /* 26.246 object trong database so với 259 đối tượng vẽ được — chênh 100 lần.
     Trộn hai con số là in ra một bản vẽ to gấp trăm lần thực tế. */
  const totals = entityTotals({
    counts: {
      approxObjects: 26246, entities: 259, modelEntities: 224,
      paperEntities: 35, blockReferences: 127,
    },
  });
  assert.equal(totals.entities, 259);
  assert.equal(totals.approxObjects, 26246);
  assert.equal(totals.model + totals.paper, totals.entities);
});

test("extents trộn không gian thì KHÔNG dùng được", () => {
  /* `min` từ Model (toạ độ trắc địa), `max` từ layout (mm trên giấy) — ra một
     khung rộng 3,8 triệu đơn vị không mô tả cái gì có thật. */
  const mixed = {
    extents: { min: [-3812288.96, -1129889.51], max: [920.99, 1036.83] },
    counts: { bySpace: { Model: 224, "01": 10 } },
  };
  assert.equal(usableExtents(mixed), null);
});

test("bản vẽ một không gian thì extents vẫn dùng được", () => {
  const single = {
    extents: { min: [0, 0], max: [100, 50] },
    counts: { bySpace: { Model: 224, "01": 0 } },
  };
  assert.deepEqual(usableExtents(single), { min: [0, 0], max: [100, 50] });
  assert.equal(usableExtents({ extents: { min: [0] } }), null);
});

test("đọc được CẢ dạng lồng trong `drawing`", () => {
  /* Daemon chỉ bù `tables.layers`/`blocks` từ dạng lồng; `counts`, `settings`,
     `extents` ở gốc là chép thẳng từ plugin. Một plugin chỉ phát dạng lồng sẽ
     cho ra màn hình 0 đối tượng và bảng layer không có số — mà không lỗi gì
     cả, nên không ai biết. */
  const nestedOnly = {
    drawing: {
      settings: { INSUNITS: 4 },
      layers: [{ name: "A" }],
      entitiesByType: { INSERT: 5 },
      entitiesByLayer: { A: 5 },
      entitiesBySpace: { Model: 5 },
      extents: { min: [0, 0], max: [10, 10] },
      selection: { count: 3 },
      selectionScope: { space: "Model", scanned: 5, complete: true },
      styles: { text: [{ name: "Standard" }] },
    },
    counts: { entities: 5 },
  };
  assert.deepEqual(typeBars(nestedOnly).map((b) => b.type), ["INSERT"]);
  assert.equal(layerRows(nestedOnly)[0].count, 5);
  assert.equal(selectedCount(nestedOnly), 3);
  assert.deepEqual(usableExtents(nestedOnly), { min: [0, 0], max: [10, 10] });
  assert.match(selectionScopeNote(nestedOnly), /Model/);
  assert.equal(normalize(nestedOnly).settings, nestedOnly.drawing.settings);
});

test("dạng gốc thắng dạng lồng khi có cả hai", () => {
  /* Plugin 1.6 phát cả hai. Ưu tiên gốc vì đó là dạng daemon đã xử lý (bù danh
     mục đối tượng vào `tables.layers`). */
  const both = {
    counts: { byType: { LINE: 9 } },
    drawing: { entitiesByType: { INSERT: 1 } },
  };
  assert.deepEqual(typeBars(both).map((b) => b.type), ["LINE"]);
});

/* ---------------- Bảng layer ---------------- */

test("số đối tượng của layer lấy từ counts.byLayer, không phải hai nguồn", () => {
  /* Hai con số khác nhau cho cùng một layer trên cùng một màn hình là lỗi tin
     cậy, không phải chi tiết nhỏ. */
  const rows = layerRows({
    tables: { layers: [{ name: "A", selectableCount: 3 }] },
    counts: { byLayer: { A: 7 } },
  });
  assert.equal(rows[0].count, 7);
});

test("thiếu rgb thì KHÔNG đoán màu", () => {
  /* Một ô màu sai cạnh tên layer tệ hơn không có ô màu nào — người dùng đối
     chiếu màu để tìm nhầm lẫn về layer. */
  const [withRgb, without] = layerRows({
    tables: { layers: [{ name: "A", rgb: [255, 0, 0] }, { name: "B", aci: 2 }] },
  });
  assert.equal(layerColor(withRgb), "rgb(255 0 0)");
  assert.equal(layerColor(without), null);
});

test("cờ trạng thái layer", () => {
  const [row] = layerRows({
    tables: { layers: [{ name: "A", off: true, locked: true, plottable: false }] },
  });
  assert.deepEqual(layerFlags(row), ["tắt", "khoá", "không in"]);
  const [clean] = layerRows({ tables: { layers: [{ name: "B", inUse: true }] } });
  assert.deepEqual(layerFlags(clean), []);
});

test("bề dày nét đổi từ đơn vị 1/100 mm", () => {
  assert.equal(lineweightLabel(-3), "Default");
  assert.equal(lineweightLabel(-2), "ByBlock");
  assert.equal(lineweightLabel(-1), "ByLayer");
  assert.equal(lineweightLabel(35), "0.35 mm");
});

/* ---------------- Biểu đồ kiểu ---------------- */

test("thanh chia theo GIÁ TRỊ LỚN NHẤT, không theo tổng", () => {
  /* Chia theo tổng thì CIRCLE (1/258) ra thanh dài 0,4% — không nhìn thấy gì,
     và bảng mất luôn ý nghĩa so sánh. */
  const bars = typeBars({ counts: { byType: { INSERT: 127, CIRCLE: 1, HATCH: 0 } } });
  assert.deepEqual(bars.map((b) => b.type), ["INSERT", "CIRCLE"]);
  assert.equal(bars[0].share, 1);
  assert.ok(bars[1].share > 0.007, String(bars[1].share));
});

test("đơn vị INSUNITS theo bảng của AutoCAD", () => {
  assert.equal(insUnitsLabel(4), "milimét");
  assert.equal(insUnitsLabel(6), "mét");
  assert.equal(insUnitsLabel(0), "không đặt");
  assert.equal(insUnitsLabel(99), "không rõ");
});

/* ---------------- Bộ tạo chọn ---------------- */

test("chỉ liệt kê phạm vi và thao tác backend THẬT SỰ nhận", () => {
  /* Bộ mẫu có "theo kiểu đối tượng" và "đặt màu theo layer"; `cleanScope()` của
     daemon chỉ nhận layer/block/handles và không có action set-color. Dựng một ô
     chọn rồi để nó ném lỗi là tệ hơn không dựng. */
  /* Nhãn phải nói TẬP mà thao tác chạy trên đó — hai thao tác chạy trên hai tập
     khác nhau, và đó là chỗ dễ gây ghi nhầm nhất của màn hình. */
  assert.match(actionLabel("select"), /phạm vi/);
  assert.match(actionLabel("move-to-layer"), /bộ chọn/i);
});

test("bỏ block layout và block ẩn danh khỏi danh sách chọn", () => {
  /* Không ai chèn `*Model_Space`, nên chọn theo tên nó là chọn được số không. */
  const names = scopeValues(
    { tables: { blocks: [{ name: "*Model_Space" }, { name: "*U12" }, { name: "CUA-DI" }] } },
    "block",
  );
  assert.deepEqual(names, ["CUA-DI"]);
});

const base = {
  tables: { layers: [{ name: "A" }, { name: "KHOA", locked: true }] },
  counts: { byLayer: { A: 3, KHOA: 1 }, selected: 5 },
};
const ask = (over: Record<string, unknown>) => prepareBlockedReason({
  payload: base, scope: "layer", value: "A", action: "select", targetLayer: "", ...over,
} as Parameters<typeof prepareBlockedReason>[0]);

test("nói trước vì sao chưa chuẩn bị được thao tác", () => {
  assert.match(ask({ payload: null }), /Chưa đọc/);
  assert.match(ask({ value: "" }), /Chưa chọn giá trị/);
  assert.equal(ask({}), "");
  assert.match(ask({ action: "move-to-layer" }), /layer đích/i);
  assert.match(ask({ action: "move-to-layer", targetLayer: "KHOA" }), /khoá/);
});

test("gán layer chạy trên BỘ CHỌN của AutoCAD, không theo phạm vi", () => {
  /* Daemon gọi `captureCurrent()` cho `move-to-layer` và bỏ qua hẳn `scope`.
     Không có gì đang chọn thì thao tác chạm vào số không — nói trước, đừng để
     người dùng chuẩn bị rồi mới biết. */
  const empty = { ...base, counts: { ...base.counts, selected: 0 } };
  assert.match(
    prepareBlockedReason({ payload: empty, scope: "layer", value: "A", action: "move-to-layer", targetLayer: "KHOA" }),
    /chưa chọn đối tượng nào[\s\S]*Đọc lại/,
  );
  assert.equal(selectedCount(base), 5);
  assert.equal(selectedCount(null), 0);
  assert.match(actionSubjectNote("move-to-layer", base), /5 đối tượng/);
  /* Nói rõ con số là ảnh chụp, không phải trạng thái sống. */
  assert.match(actionSubjectNote("move-to-layer", base), /lúc đọc hồ sơ/);
  assert.match(actionSubjectNote("move-to-layer", base), /không áp dụng/);
  assert.match(actionSubjectNote("select", base), /phạm vi/);
});

test("bản vẽ chỉ đọc VẪN chọn được, chỉ chặn ghi", () => {
  /* Daemon chỉ chặn chỉ-đọc cho `move-to-layer`. Chặn cả hai là tự tay bỏ một
     tính năng backend cho phép. */
  const readOnly = { ...base, document: { readOnly: true } };
  assert.equal(
    prepareBlockedReason({ payload: readOnly, scope: "layer", value: "A", action: "select", targetLayer: "" }),
    "",
  );
  assert.match(
    prepareBlockedReason({ payload: readOnly, scope: "layer", value: "A", action: "move-to-layer", targetLayer: "A" }),
    /chỉ đọc/,
  );
});

test("bản vẽ hoạt động lấy từ DANH SÁCH, không từ hồ sơ", () => {
  /* Hai nguồn đọc ở hai thời điểm: hồ sơ là ảnh chụp nặng đọc một lần, danh
     sách bản vẽ nhẹ và mới hơn. Lấy từ hồ sơ thì ô chọn hiện bản vẽ cũ sau khi
     người dùng đổi tab trong AutoCAD. */
  assert.equal(activeDocFile([{ file: "/a.dwg" }, { file: "/b.dwg", active: true }]), "/b.dwg");
  assert.equal(activeDocFile([{ title: "Drawing1.dwg", active: true }]), "Drawing1.dwg");
  assert.equal(activeDocFile([]), "");
});

test("nói ra khi hồ sơ đang mô tả một bản vẽ KHÁC bản vẽ đang mở", () => {
  /* Không nói ra thì người dùng chuẩn bị thao tác dựa trên bảng layer của bản
     vẽ A và ghi vào bản vẽ B. */
  const payload = { document: { file: "/a/kien-truc.dwg" } };
  const note = staleDrawingNote(payload, [{ file: "/a/ket-cau.dwg", active: true }]);
  assert.match(note, /kien-truc\.dwg/);
  assert.match(note, /ket-cau\.dwg/);
  assert.equal(staleDrawingNote(payload, [{ file: "/a/kien-truc.dwg", active: true }]), "");
  /* Chưa biết bản vẽ nào đang hoạt động thì ĐỪNG báo động: danh sách chưa tải
     xong là chuyện bình thường lúc mở trang. */
  assert.equal(staleDrawingNote(payload, []), "");
});

test("đổi bản vẽ hoạt động: nói trước vì sao chưa đổi được", () => {
  /* Đổi bản vẽ là lệnh GHI theo backend dù không sửa đối tượng nào — nó đổi thứ
     mà mọi lệnh ghi sau đó nhắm vào. */
  const ok = { target: "/a/b.dwg", activeFile: "/a/c.dwg", alive: true };
  assert.equal(activateBlockedReason(ok), "");
  assert.match(activateBlockedReason({ ...ok, alive: false }), /chưa phản hồi/);
  assert.match(activateBlockedReason({ ...ok, target: "" }), /Chưa chọn bản vẽ/);
  assert.match(
    activateBlockedReason({ ...ok, target: "/a/c.dwg" }),
    /đang là bản vẽ hoạt động/,
  );
});

test("bản vẽ chưa lưu vẫn có đích: lùi về tiêu đề", () => {
  /* Đích rỗng thì daemon tự phân giải sang bản vẽ ĐANG HOẠT ĐỘNG — có thể là
     một bản vẽ khác hẳn nếu người dùng chuyển tab AutoCAD sau khi trang đã tải.
     Ghi nhầm bản vẽ là loại lỗi không có đường lùi. */
  assert.equal(operationTarget({ document: { file: "/a/b.dwg", title: "b.dwg" } }), "/a/b.dwg");
  assert.equal(operationTarget({ document: { file: "", title: "Drawing1.dwg" } }), "Drawing1.dwg");
  assert.equal(operationTarget({ document: { title: "Drawing1.dwg" } }), "Drawing1.dwg");
  assert.equal(operationTarget(null), "");
});

test("nói rõ bộ tạo chọn chỉ với tới không gian hiện hành", () => {
  /* Không nói ra thì người dùng chuẩn bị "gán cả layer sang layer khác" và
     tưởng nó chạm tới cả 125 đối tượng, trong khi 115 cái nằm ở Model và không
     hề bị đụng tới. */
  const note = selectionScopeNote({ selectionScope: { space: "01", scanned: 10, complete: true } });
  assert.match(note, /10 đối tượng/);
  assert.match(note, /01/);
  assert.equal(selectionScopeNote(null), "");
  assert.match(
    selectionScopeNote({ selectionScope: { space: "Model", scanned: 5, complete: false } }),
    /chưa quét hết/,
  );
});

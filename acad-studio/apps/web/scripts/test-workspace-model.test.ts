/** Đọc hiểu hình học bản vẽ.
 *
 * Sai ở đây không ném lỗi — nó vẽ ra một hình SAI mà trông vẫn hợp lý, rồi kỹ
 * sư đọc kích thước từ đó. Ba nhóm dễ sai nhất, và cũng là ba nhóm được test
 * dày nhất:
 *
 *  1. `bounds` là [minX,minY,maxX,maxY], không phải [x,y,rộng,cao].
 *  2. Trục Y lật ngược giữa AutoCAD và SVG.
 *  3. `bulge` bị bỏ qua thì ống cong thành ống thẳng.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  arcPath,
  clientToViewBox,
  collectedAtLabel,
  countFidelity,
  countOutsideBounds,
  degrees,
  effectiveLayer,
  entityExtent,
  fidelityNote,
  fidelityOf,
  kindLabel,
  fitViewBox,
  ellipsePath,
  layersOf,
  pathDataOf,
  polylinePath,
  shapeLabel,
  spaceOrder,
  unionExtent,
  viewBoxToString,
  zoomPercent,
  zoomViewBox,
  type GeomEntity,
} from "../features/workspace/model";

const entity = (over: Partial<GeomEntity>): GeomEntity => ({
  h: "1", t: "LINE", l: "0", sp: "Model", k: "line", ...over,
});

/* ---------------- Độ trung thực ---------------- */

test("INSERT vẽ được hay không là do CÓ ĐỊNH NGHĨA, không do cờ a", () => {
  /* Hai bẫy chồng lên nhau. Một: `a:1` của plugin chỉ nói "hình bị chiếu sai",
     không nói "hình chưa được xuất" — đọc mỗi `a` thì 127 block của bản vẽ
     as-built được tính là hình thật dù chỉ vẽ ra một cái dấu. Hai: cùng một
     INSERT đổi hẳn kết luận khi payload có `blocks` — đó mới là thứ quyết định
     khung xem vẽ được nội dung block hay không. */
  const insert = entity({ k: "insert", t: "INSERT", name: "B_MBT2" });
  assert.equal(insert.a, undefined);
  assert.equal(fidelityOf(insert), "placeholder");
  assert.equal(fidelityOf(insert, { B_MBT2: [entity({ k: "line" })] }), "exact");
});

test("định nghĩa block RỖNG vẫn là chưa có hình", () => {
  /* Block rỗng thật sự tồn tại trong bản vẽ (`_DOT`, `_ArchTick` có lúc rỗng).
     Coi khoá có mặt là đủ sẽ báo "hình thật" cho một chỗ không vẽ được gì. */
  const insert = entity({ k: "insert", name: "RONG" });
  assert.equal(fidelityOf(insert, { RONG: [] }), "placeholder");
  assert.equal(fidelityOf(entity({ k: "insert" }), { X: [entity({})] }), "placeholder");
});

test("phân biệt chưa-có-hình với hình-thiếu", () => {
  assert.equal(fidelityOf(entity({ k: "box", aw: "bounding-box" })), "placeholder");
  assert.equal(fidelityOf(entity({ k: "poly", a: 1, aw: "mline-centerline" })), "reduced");
  assert.equal(fidelityOf(entity({ k: "poly", a: 1 })), "reduced");
  assert.equal(fidelityOf(entity({ k: "poly" })), "exact");
});

test("đếm đúng tỉ lệ của bản vẽ as-built thật, trước và sau khi có nội dung block", () => {
  const entities = [
    ...Array.from({ length: 127 }, (_, i) => entity({ k: "insert", name: i < 123 ? "CO" : "RONG" })),
    ...Array.from({ length: 62 }, () => entity({ k: "box", a: 1, aw: "bounding-box" })),
    ...Array.from({ length: 41 }, () => entity({ k: "poly", a: 1, aw: "mline-centerline" })),
    ...Array.from({ length: 28 }, () => entity({ k: "poly" })),
  ];
  assert.deepEqual(countFidelity(entities), { exact: 28, placeholder: 189, reduced: 41 });
  assert.deepEqual(
    countFidelity(entities, { CO: [entity({ k: "line" })], RONG: [] }),
    { exact: 151, placeholder: 66, reduced: 41 },
  );
});

test("block có nội dung thì không còn câu cảnh báo chưa-có-hình", () => {
  const insert = entity({ k: "insert", name: "CO" });
  assert.notEqual(fidelityNote(insert), "");
  assert.equal(fidelityNote(insert, { CO: [entity({ k: "line" })] }), "");
});

/* ---------------- Không gian ---------------- */

test("Model đứng đầu, layout theo thứ tự bản vẽ", () => {
  const order = spaceOrder({
    spaces: { "03": 12, Model: 224, "01": 10, KL: 2 },
    layouts: ["Model", "01", "03", "KL"],
  });
  assert.deepEqual(order, ["Model", "01", "03", "KL"]);
});

test("bỏ không gian rỗng — chọn vào chỉ thấy màn hình trắng", () => {
  assert.deepEqual(spaceOrder({ spaces: { Model: 5, "01": 0 }, layouts: ["Model", "01"] }), ["Model"]);
});

test("layout không có trong danh sách layouts xuống cuối, không lên đầu", () => {
  /* `indexOf` trả -1; đem so trực tiếp là đẩy nó lên trước mọi layout có thật. */
  const order = spaceOrder({ spaces: { A: 1, "01": 1, "02": 1 }, layouts: ["01", "02"] });
  assert.deepEqual(order, ["01", "02", "A"]);
});

/* ---------------- Khung nhìn ---------------- */

test("bounds là [minX,minY,maxX,maxY] và trục Y bị lật", () => {
  const box = fitViewBox([0, 0, 100, 50], 0);
  assert.deepEqual(box, { x: 0, y: -50, w: 100, h: 50 });
  /* Đọc nhầm thành [x,y,rộng,cao] sẽ cho w=100 h=50 mà y=0 — hình lệch nguyên
     một chiều cao và nằm ngoài khung. */
});

test("toạ độ trắc địa hàng triệu đơn vị vẫn ra khung hữu hạn", () => {
  const box = fitViewBox([-3812288.96056, -1129889.50937, -3713743.62339, -1037489.50937], 0);
  assert.ok(Math.abs(box!.w - 98545.33717) < 1e-4);
  assert.ok(Math.abs(box!.h - 92400) < 1e-4);
  assert.ok(Math.abs(box!.y - 1037489.50937) < 1e-4);
});

test("khung dẹt hoặc một điểm không cho ra chia-cho-0", () => {
  const point = fitViewBox([10, 10, 10, 10], 0);
  assert.ok(point && point.w > 0 && point.h > 0);
  const flat = fitViewBox([0, 5, 100, 5], 0);
  assert.ok(flat && flat.w === 100 && flat.h === 100);
});

test("bounds thiếu, sai chiều hoặc không hữu hạn thì trả null", () => {
  assert.equal(fitViewBox(undefined), null);
  assert.equal(fitViewBox([1, 2, 3]), null);
  assert.equal(fitViewBox([100, 0, 0, 50]), null);
  assert.equal(fitViewBox([0, 0, Number.NaN, 5]), null);
});

test("nới lề theo tỉ lệ mỗi phía", () => {
  const box = fitViewBox([0, 0, 100, 100], 0.1);
  assert.deepEqual(box, { x: -10, y: -110, w: 120, h: 120 });
});

test("phóng to giữ nguyên điểm dưới con trỏ", () => {
  const home = { x: 0, y: 0, w: 100, h: 100 };
  const zoomed = zoomViewBox(home, 25, 25, 2, home);
  assert.equal(zoomed.w, 50);
  /* Điểm (25,25) phải vẫn ở đúng chỗ tương đối trong khung mới. */
  assert.equal((25 - zoomed.x) / zoomed.w, (25 - home.x) / home.w);
});

test("có trần thu phóng hai đầu", () => {
  const home = { x: 0, y: 0, w: 100, h: 100 };
  assert.equal(zoomViewBox(home, 0, 0, 1e9, home).w, home.w / 4000);
  assert.equal(zoomViewBox(home, 0, 0, 1e-9, home).w, home.w * 8);
});

test("100% là vừa khít màn hình", () => {
  const home = { x: 0, y: 0, w: 100, h: 100 };
  assert.equal(zoomPercent(home, home), 100);
  assert.equal(zoomPercent({ ...home, w: 50 }, home), 200);
});

test("viewBox in ra đúng thứ tự bốn số", () => {
  assert.equal(viewBoxToString({ x: 1, y: -2, w: 3, h: 4 }), "1 -2 3 4");
});

test("đổi toạ độ con trỏ có tính dải thừa của preserveAspectRatio", () => {
  /* Khung 200×100 px cho một viewBox vuông 100×100: SVG lấy tỉ lệ 1 và căn
     giữa, thừa 50 px mỗi bên. Chia thẳng px/rộng-phần-tử là lệch nửa màn hình,
     và thu phóng bằng con lăn sẽ trôi mỗi lần lăn. */
  const box = { x: 0, y: 0, w: 100, h: 100 };
  const rect = { left: 0, top: 0, width: 200, height: 100 };
  assert.deepEqual(clientToViewBox(box, rect, 100, 50), { x: 50, y: 50 });
  assert.deepEqual(clientToViewBox(box, rect, 50, 0), { x: 0, y: 0 });
});

test("khung chưa có kích thước thì trả góc khung, không trả NaN", () => {
  const box = { x: 7, y: -3, w: 100, h: 100 };
  const zero = { left: 0, top: 0, width: 0, height: 0 };
  assert.deepEqual(clientToViewBox(box, zero, 10, 10), { x: 7, y: -3 });
});

test("đếm đối tượng bị vẽ ra ngoài khung bounds", () => {
  /* Bản vẽ as-built thật có 5 block đặt lạc cách bản vẽ hàng triệu đơn vị mà
     `bounds` không chứa — plugin gom khung từ `getGeomExtents()`, block rỗng
     thì hàm đó báo không hợp lệ. Không đếm thì thanh trạng thái ghi "224/224
     đang hiện" trong khi 5 cái nằm ngoài màn hình. */
  const entities = [
    entity({ k: "insert", p: [50, 50] }),
    entity({ k: "insert", p: [-5717177, 2281157] }),
    entity({ k: "box", b: [10, 10, 20, 20] }),
  ];
  assert.equal(countOutsideBounds(entities, [0, 0, 100, 100]), 1);
  assert.equal(countOutsideBounds(entities, undefined), 0);
});

test("đối tượng nằm đúng trên mép không bị tính là ở ngoài", () => {
  const edge = [entity({ k: "insert", p: [100, 100] })];
  assert.equal(countOutsideBounds(edge, [0, 0, 100, 100]), 0);
});

test("khung bao tính đúng cho từng loại hình", () => {
  assert.deepEqual(entityExtent(entity({ k: "circle", c: [0, 0], r: 5 })), [-5, -5, 5, 5]);
  assert.deepEqual(entityExtent(entity({ k: "poly", p: [1, 2, 9, 4] })), [1, 2, 9, 4]);
  /* `b` của plugin đã là [minX,minY,maxX,maxY], nhưng chuẩn hoá lại phòng khi
     một đối tượng cho ra khung ngược chiều. */
  assert.deepEqual(entityExtent(entity({ k: "box", b: [9, 4, 1, 2] })), [1, 2, 9, 4]);
  /* Một điểm vẫn ĐƯỢC VẼ, nên phải có khung suy biến chứ không phải null. */
  assert.deepEqual(entityExtent(entity({ k: "text", p: [3, 7] })), [3, 7, 3, 7]);
  assert.equal(entityExtent(entity({ k: "point" })), null);
});

test("khung bao của lần chèn phải gồm hình BÊN TRONG block", () => {
  /* Lần chèn chỉ có `p` là điểm chèn; hình thật trải rộng quanh nó. Bỏ qua
     `blocks` thì "thu hết bản vẽ" cắt cụt gần hết hình, và số đối tượng nằm
     ngoài khung đếm ra 0 trong khi có cả mảng bản vẽ ở ngoài. */
  const insert = entity({ k: "insert", name: "B", p: [100, 100], m: [1, 0, 0, 1, 100, 100] });
  const blocks = { B: [entity({ h: "a", k: "poly", p: [0, 0, 10, 20] })] };
  assert.deepEqual(entityExtent(insert), [100, 100, 100, 100]);
  assert.deepEqual(entityExtent(insert, blocks), [100, 100, 110, 120]);
  assert.equal(countOutsideBounds([insert], [0, 0, 105, 105]), 0);
  assert.equal(countOutsideBounds([insert], [0, 0, 105, 105], blocks), 1);
});

test("khung bao đưa cả BỐN góc qua phép biến đổi", () => {
  /* Block xoay 90°: chỉ biến đổi hai góc đối diện cho ra khung nhỏ hơn hình
     thật, và "thu hết" vẫn cắt mất mép. m = xoay 90° CCW. */
  const insert = entity({ k: "insert", name: "B", m: [0, 1, -1, 0, 0, 0] });
  const blocks = { B: [entity({ h: "a", k: "poly", p: [0, 0, 10, 4] })] };
  assert.deepEqual(entityExtent(insert, blocks), [-4, 0, 0, 10]);
});

test("khung bao của block lồng vòng tròn không treo", () => {
  const insert = entity({ k: "insert", name: "A", m: [1, 0, 0, 1, 0, 0] });
  const blocks = {
    A: [entity({ h: "x", k: "insert", name: "B", m: [1, 0, 0, 1, 5, 5] })],
    B: [entity({ h: "y", k: "insert", name: "A", m: [1, 0, 0, 1, 5, 5] }),
        entity({ h: "z", k: "poly", p: [0, 0, 2, 2] })],
  };
  const ext = entityExtent(insert, blocks);
  assert.ok(ext && ext.every((n) => Number.isFinite(n)), String(ext));
});

test("khung bao bỏ qua layer đang bị tắt, kể cả bên trong block", () => {
  /* Phải khớp CHÍNH XÁC với canvas. Lệch nhau thì "Thu hết" phóng ra ôm cả thứ
     đang bị ẩn, và thanh trạng thái đếm hình không được vẽ là "nằm ngoài khung". */
  const insert = entity({ k: "insert", l: "TRUC", name: "B", p: [0, 0], m: [1, 0, 0, 1, 0, 0] });
  const blocks = { B: [entity({ h: "a", k: "poly", l: "AN", p: [0, 0, 500, 500] })] };
  assert.deepEqual(entityExtent(insert, blocks), [0, 0, 500, 500]);
  /* Ẩn layer bên trong: canvas không vẽ gì, nên khung bao cũng phải không có gì
     — KHÔNG được lùi về điểm chèn, vì không có cái dấu nào được vẽ ra. */
  assert.equal(entityExtent(insert, blocks, new Set(["AN"])), null);
  /* Ẩn layer của chính lần chèn cũng vậy. */
  assert.equal(entityExtent(insert, blocks, new Set(["TRUC"])), null);
  assert.equal(countOutsideBounds([insert], [0, 0, 10, 10], blocks, new Set(["AN"])), 0);
  assert.equal(countOutsideBounds([insert], [0, 0, 10, 10], blocks), 1);
  assert.equal(unionExtent([insert], blocks, new Set(["AN"])), null);
});

test("layer 0 trong block theo layer lần chèn khi tính khung bao", () => {
  const insert = entity({ k: "insert", l: "A-WALL", name: "B", m: [1, 0, 0, 1, 0, 0] });
  const blocks = { B: [entity({ h: "a", k: "poly", l: "0", p: [0, 0, 9, 9] })] };
  assert.deepEqual(entityExtent(insert, blocks), [0, 0, 9, 9]);
  /* Tắt "A-WALL" phải ẩn cả con trên layer `0`; tắt "0" thì không. */
  assert.equal(entityExtent(insert, blocks, new Set(["A-WALL"])), null);
  assert.deepEqual(entityExtent(insert, blocks, new Set(["0"])), [0, 0, 9, 9]);
});

test("block rỗng thì khung bao lùi về điểm chèn", () => {
  const insert = entity({ k: "insert", name: "RONG", p: [7, 9], m: [1, 0, 0, 1, 7, 9] });
  assert.deepEqual(entityExtent(insert, { RONG: [] }), [7, 9, 7, 9]);
});

test("gộp khung bao bỏ qua đối tượng không có toạ độ", () => {
  const box = unionExtent([
    entity({ k: "poly", p: [0, 0, 10, 10] }),
    entity({ k: "point" }),
    entity({ k: "circle", c: [100, 100], r: 1 }),
  ]);
  assert.deepEqual(box, [0, 0, 101, 101]);
  assert.equal(unionExtent([entity({ k: "point" })]), null);
});

/* ---------------- Dựng hình ---------------- */

test("polyline không bulge là các đoạn thẳng", () => {
  assert.equal(polylinePath([0, 0, 10, 0, 10, 10], undefined, false), "M0 0L10 0L10 10");
});

test("khép kín thêm đoạn cuối và Z", () => {
  const path = polylinePath([0, 0, 10, 0, 10, 10], undefined, true);
  assert.equal(path, "M0 0L10 0L10 10L0 0Z");
});

test("bulge thành cung tròn, không phải đoạn thẳng", () => {
  /* Ống cong vẽ thành ống thẳng là sai hình mà trông vẫn hợp lý — kiểu sai tệ
     nhất, vì không ai nghi ngờ nó. */
  const path = polylinePath([0, 0, 10, 0], [1], false);
  assert.ok(path.includes("A"), path);
  assert.ok(!path.includes("L"), path);
  /* bulge=1 là nửa đường tròn: R = (10/2)/sin(90°) = 5. */
  assert.match(path, /A5 5 0 0 0 10 0/);
});

test("bulge âm đảo chiều cung", () => {
  assert.match(polylinePath([0, 0, 10, 0], [-1], false), /A5 5 0 0 1 10 0/);
  assert.match(polylinePath([0, 0, 10, 0], [1], false), /A5 5 0 0 0 10 0/);
});

test("bulge lớn hơn nửa vòng bật cờ large-arc", () => {
  /* bulge = tan(θ/4); θ > 180° khi bulge > tan(45°) = 1. */
  assert.match(polylinePath([0, 0, 10, 0], [2], false), /A[\d.]+ [\d.]+ 0 1 0 10 0/);
});

test("hai đỉnh trùng nhau vẫn ra đường vẽ được", () => {
  /* Bán kính vô cực; sinh `d` hỏng là trình duyệt bỏ qua CẢ đường, mất luôn
     những đoạn vẽ đúng phía sau. */
  const path = polylinePath([0, 0, 0, 0, 10, 0], [0.5, 0], false);
  assert.ok(path.startsWith("M0 0L0 0"), path);
  assert.ok(path.endsWith("L10 0"), path);
});

test("dưới hai đỉnh thì không vẽ gì", () => {
  assert.equal(polylinePath([1, 2], undefined, false), "");
  assert.equal(polylinePath([], undefined, true), "");
});

test("cung tròn đi ngược chiều kim đồng hồ theo quy ước AutoCAD", () => {
  const path = arcPath(0, 0, 10, 0, Math.PI / 2);
  assert.match(path, /^M10 0A10 10 0 0 0 /);
});

test("cung vượt qua góc 0 vẫn tính đúng độ lớn", () => {
  /* a1 < a0 nghĩa là đã vòng qua 0 — trừ thẳng ra số âm và cờ large-arc sai. */
  const path = arcPath(0, 0, 10, (3 * Math.PI) / 2, Math.PI);
  assert.match(path, /A10 10 0 1 0 /);
});

test("elip trọn vòng phải tách đôi cung", () => {
  /* Một cung elip đi từ điểm về CHÍNH NÓ là lệnh rỗng với SVG — cả đường biến
     mất. 1847 elip của bản vẽ as-built phần lớn là vòng kín. */
  const full = ellipsePath(0, 0, 10, 5, 0, 0, Math.PI * 2);
  assert.equal((full.match(/A/g) ?? []).length, 2, full);
  assert.ok(full.endsWith("Z"), full);
  /* `endAngle` của AutoCAD hay là 6.28318530717959 chứ không đúng 2π. */
  assert.equal((ellipsePath(0, 0, 10, 5, 0, 0, 6.28318530717959).match(/A/g) ?? []).length, 2);
});

test("cung elip một phần chỉ một lệnh cung, có cờ large-arc đúng", () => {
  assert.equal((ellipsePath(0, 0, 10, 5, 0, 0, Math.PI / 2).match(/A/g) ?? []).length, 1);
  assert.match(ellipsePath(0, 0, 10, 5, 0, 0, Math.PI / 2), /A10 5 0 0 0 /);
  /* Quá nửa vòng thì large-arc = 1. */
  assert.match(ellipsePath(0, 0, 10, 5, 0, 0, (3 * Math.PI) / 2), /A10 5 0 1 0 /);
});

test("góc nghiêng elip đổi sang độ cho SVG", () => {
  /* `rot` là radian như mọi góc khác của plugin; tham số xoay của cung elip
     trong SVG tính bằng độ. */
  assert.match(ellipsePath(0, 0, 10, 5, Math.PI / 2, 0, Math.PI / 2), /A10 5 90 /);
});

test("a0/a1 của elip là THAM SỐ, không phải góc thật", () => {
  /* P(t) = C + rx·cos(t)·u + ry·sin(t)·v. Với elip dẹt, t = π/2 nằm ở đỉnh
     trục nhỏ (0, ry) — không phải ở góc 90° hình học. */
  const path = ellipsePath(0, 0, 100, 1, 0, 0, Math.PI / 2);
  assert.ok(path.startsWith("M100 0"), path);
  assert.ok(path.includes(" 0 1") || /A100 1 0 0 0 [\d.e-]+ 1$/.test(path), path);
});

test("gộp nét nối nhiều hình vào một chuỗi d", () => {
  /* Đây là thứ đưa bản vẽ as-built từ 11.304 node xuống 1.468. */
  const d = pathDataOf(
    { ...entity({ k: "multi" }), g: [
      entity({ k: "line", p: [0, 0, 1, 1] }),
      entity({ k: "line", p: [2, 2, 3, 3] }),
    ] },
    1,
  );
  assert.equal(d, "M0 0L1 1M2 2L3 3");
});

test("chữ và block không gộp được — nơi gọi phải tự dựng phần tử riêng", () => {
  assert.equal(pathDataOf(entity({ k: "text", p: [0, 0], txt: "x" }), 1), "");
  assert.equal(pathDataOf(entity({ k: "mtext", p: [0, 0] }), 1), "");
  assert.equal(pathDataOf(entity({ k: "insert", p: [0, 0] }), 1), "");
});

test("chữ nhiều dòng vẫn có khung bao và vẫn đếm được layer", () => {
  /* `mtext` không có hình học nào ngoài điểm neo — nhưng nó VẼ RA, nên phải
     nằm trong khung bao và trong bảng layer như mọi thứ khác. */
  const mt = { ...entity({ k: "mtext", l: "0-TEXT", p: [5, 7] }), lines: ["a", "b"] };
  assert.deepEqual(entityExtent(mt), [5, 7, 5, 7]);
  assert.deepEqual(layersOf([mt]), [{ name: "0-TEXT", count: 1 }]);
});

test("khối chữ đã bung không được gọi là vùng gạch", () => {
  /* MTEXT đi qua `explodeFragments` ra `k:"multi"` — cùng kiểu với HATCH. Gọi
     chung một tên là inspector mô tả sai chính thứ người dùng vừa bấm. */
  const mtext = { ...entity({ k: "multi", t: "MTEXT", p: [0, 0] }), lines: ["GHI CHÚ"] };
  const hatch = { ...entity({ k: "multi", t: "HATCH" }), g: [entity({ k: "line", p: [0, 0, 1, 1] })] };
  const captured = entity({ k: "multi", t: "MULTILEADER", a: 1, aw: "worlddraw" });
  assert.equal(shapeLabel(mtext), "Chữ nhiều dòng");
  assert.equal(shapeLabel(hatch), "Vùng gạch");
  assert.equal(shapeLabel(captured), "Hình do AutoCAD vẽ");
  assert.equal(shapeLabel(entity({ k: "circle" })), kindLabel("circle"));
  /* Và phải có điểm để phóng tới. */
  assert.deepEqual(entityExtent(mtext), [0, 0, 0, 0]);
});

test("VIEWPORT là một hình chữ nhật thật, không phải hình bao", () => {
  /* Cái nhìn thấy trên giấy LÀ khung của viewport. Đánh dấu gần đúng chỉ khi
     nó bị cắt theo một hình không phải chữ nhật. */
  const vp = entity({ k: "poly", t: "VIEWPORT", p: [0, 0, 10, 0, 10, 5, 0, 5], closed: true });
  assert.equal(fidelityOf(vp), "exact");
  assert.equal(fidelityOf({ ...vp, a: 1, aw: "viewport-clipped" }), "reduced");
  assert.match(fidelityNote({ ...vp, a: 1, aw: "viewport-clipped" }), /biên ngoài/);
});

test("đường tròn thành path phải khép kín thành vòng", () => {
  const d = pathDataOf(entity({ k: "circle", c: [0, 0], r: 5 }), 1);
  assert.equal((d.match(/A/g) ?? []).length, 2, d);
  assert.ok(d.endsWith("Z"), d);
});

test("khung bao của HATCH lấy từ các hình con", () => {
  /* `multi` không có toạ độ của riêng nó. Bỏ qua thì vùng gạch — một trong
     những thứ to nhất trên bản vẽ — biến mất khỏi "thu hết" và khỏi phép đếm. */
  const hatch = { ...entity({ k: "multi" }), g: [
    entity({ k: "line", p: [0, 0, 10, 0] }),
    entity({ k: "line", p: [0, 0, 0, 20] }),
  ] };
  assert.deepEqual(entityExtent(hatch), [0, 0, 10, 20]);
});

test("multi trộn nét với chữ: chữ không lọt vào path, nét không mất", () => {
  /* MULTILEADER bắt qua `worldDraw` ra cả đường dẫn lẫn ghi chú
     ("WP-uPVC-D90;I=1%"). Nếu `pathDataOf` nuốt luôn chữ thì mất chữ; nếu nó bỏ
     cả cụm vì có chữ thì mất đường dẫn. */
  const leader = { ...entity({ k: "multi" }), g: [
    entity({ k: "poly", p: [0, 0, 10, 10] }),
    { ...entity({ k: "text", p: [10, 10] }), th: 2, txt: "WP-uPVC-D90;I=1%" },
  ] };
  assert.equal(pathDataOf(leader, 1), "M0 0L10 10");
  assert.deepEqual(entityExtent(leader), [0, 0, 10, 10]);
});

test("chữ trong cụm gần đúng cũng phải là gần đúng", () => {
  /* Chữ đến từ cùng một lượt bắt với các nét quanh nó. Để nó ra màu "hình
     thật" cạnh những nét "hình thiếu" là nói rằng chữ đáng tin hơn hình. */
  const child = entity({ k: "text", p: [0, 0], txt: "WP-uPVC-D90" });
  assert.equal(fidelityOf(child), "exact");
  assert.equal(fidelityOf({ ...child, a: 1, aw: "worlddraw" }), "reduced");
});

test("hình bắt qua worldDraw luôn là hình thiếu, không phải hình thật", () => {
  /* Đó là hình AutoCAD VẼ RA: cung tròn đã thành đoạn thẳng, độ mịn do mình
     chọn. Nhìn thì giống, đo thì không được — màn hình phải nói ra. */
  const captured = { ...entity({ k: "multi", a: 1, aw: "worlddraw" }), g: [] };
  assert.equal(fidelityOf(captured), "reduced");
  assert.match(fidelityNote(captured), /đừng đo/);
  assert.match(fidelityNote({ ...captured, aw: "worlddraw-truncated" }), /một phần/);
});

test("khung bao elip dùng bán trục lớn hơn — khung phải CHỨA hình", () => {
  const el = entity({ k: "ellipse", c: [0, 0], rx: 10, ry: 3 });
  assert.deepEqual(entityExtent(el), [-10, -10, 10, 10]);
});

/* ---------------- Layer ---------------- */

test("đếm layer từ đối tượng đã tải, không từ bảng layer bản vẽ", () => {
  /* Lấy số của bản vẽ sẽ thành một bộ lọc tắt đi mà chẳng thấy gì biến mất. */
  const rows = layersOf([
    entity({ l: "P-ThoatRua" }),
    entity({ l: "P-ThoatRua" }),
    entity({ l: "0" }),
  ]);
  assert.deepEqual(rows, [{ name: "0", count: 1 }, { name: "P-ThoatRua", count: 2 }]);
});

test("bảng layer phải bung nội dung block", () => {
  /* 97% hình nằm trong định nghĩa block. Chỉ đếm cấp trên cùng thì những layer
     chỉ xuất hiện bên trong block biến mất khỏi bảng, và tắt một layer có mặt ở
     cả hai nơi chỉ ẩn được phần ở cấp trên. */
  const rows = layersOf(
    [entity({ h: "1", k: "insert", l: "TRUC", name: "TICK" })],
    { TICK: [entity({ h: "a", l: "NET-MANH" }), entity({ h: "b", l: "NET-MANH" })] },
  );
  assert.deepEqual(rows, [{ name: "NET-MANH", count: 2 }]);
});

test("layer 0 trong block kế thừa layer của lần chèn", () => {
  /* Quy tắc của AutoCAD, không phải quy ước của app. Bỏ qua nó thì bảng layer
     đếm một đống "0" không có thật, và tắt layer "0" ẩn nhầm nửa bản vẽ. */
  const rows = layersOf(
    [entity({ h: "1", k: "insert", l: "A-WALL", name: "CUA" })],
    { CUA: [entity({ h: "a", l: "0" }), entity({ h: "b", l: "A-DOOR" })] },
  );
  assert.deepEqual(rows, [{ name: "A-WALL", count: 1 }, { name: "A-DOOR", count: 1 }].sort(
    (l, r) => l.name.localeCompare(r.name),
  ));
  assert.equal(effectiveLayer(entity({ l: "0" }), "A-WALL"), "A-WALL");
  assert.equal(effectiveLayer(entity({ l: "A-DOOR" }), "A-WALL"), "A-DOOR");
  /* Cấp trên cùng không có layer cha — "0" ở đó là layer 0 thật. */
  assert.equal(effectiveLayer(entity({ l: "0" }), ""), "0");
});

test("block lồng vòng tròn không làm treo phép đếm", () => {
  /* Bản vẽ hỏng: A chèn B, B chèn lại A. Không chặn thì đệ quy vô hạn. */
  const rows = layersOf(
    [entity({ h: "1", k: "insert", l: "L", name: "A" })],
    {
      A: [entity({ h: "a", k: "insert", l: "L", name: "B" })],
      B: [entity({ h: "b", k: "insert", l: "L", name: "A" })],
    },
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, "L");
});

test("lần chèn không có định nghĩa vẫn được đếm — nó vẫn vẽ ra một cái dấu", () => {
  const rows = layersOf([entity({ k: "insert", l: "X", name: "KHONG-CO" })], {});
  assert.deepEqual(rows, [{ name: "X", count: 1 }]);
});

test("radian sang độ — SVG không nhận radian", () => {
  /* Truyền thẳng radian thì nhãn xoay 90° chỉ nghiêng 1,57°: sai mà trông như
     "chữ hơi lệch", nên rất dễ lọt qua mắt. */
  assert.equal(degrees(Math.PI / 2), 90);
  assert.equal(degrees(Math.PI), 180);
  assert.equal(degrees(0), 0);
  assert.equal(degrees(undefined), 0);
});

/* ---------------- Câu chữ ---------------- */

test("collectedAt tính bằng GIÂY Unix", () => {
  /* Quên nhân 1000 là lệch 56 năm, mà nhãn vẫn hiện ra một giờ trông hợp lý. */
  const label = collectedAtLabel(1786357379);
  assert.equal(label, new Date(1786357379000).toLocaleTimeString("vi-VN"));
  assert.equal(collectedAtLabel(undefined), "");
  assert.equal(collectedAtLabel(Number.NaN), "");
});

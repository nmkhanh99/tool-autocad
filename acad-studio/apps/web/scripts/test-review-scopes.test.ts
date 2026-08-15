import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  REVIEW_SCOPES,
  chipKey,
  filterByScope,
  scopeChips,
  scopeLabel,
} from "../features/review/scopes";

const issue = (scope: string) => ({ scope });

test("nhóm LẠ không được làm phát hiện biến mất", () => {
  /* Đây là lý do cả bảng này tồn tại. Panel cũ lọc nhóm bằng regex, nên máy chủ
     đổi một chữ trong tên nhóm là phát hiện biến mất khỏi màn hình mà không báo
     gì. Thay regex bằng một danh sách CHO PHÉP là dựng lại đúng lỗi đó, chỉ khác
     cơ chế — nên phép lọc phải so BẰNG NHAU, không tra bảng. */
  const list = [issue("layer"), issue("scope-may-chu-vua-them"), issue("layer")];

  assert.equal(filterByScope(list, null).length, 3, "null = không lọc");
  assert.equal(filterByScope(list, "scope-may-chu-vua-them").length, 1,
    "nhóm ngoài bảng vẫn phải lọc được bằng chính chip của nó");
  assert.equal(filterByScope(list, "layer").length, 2);

  /* `normalizeIssue()` có đường lùi riêng: `scope` THIẾU hoặc không phải chuỗi
     → `"drawing"`, một giá trị không nhóm nào của engine phát ra. (Chuỗi RỖNG
     thì KHÔNG rơi vào đường lùi đó — `typeof "" === "string"` nên `str()` trả
     nguyên nó; xem test cuối tệp.) Giá trị ngoài bảng vì thế là chuyện CÓ THẬT,
     không phải giả định. */
  assert.equal(filterByScope([issue("drawing")], "drawing").length, 1);
});

test("tổng các chip nhóm luôn bằng chip Tất cả", () => {
  /* Bất biến NHÌN THẤY ĐƯỢC của cái lỗi trên: thiếu một phát hiện thì hai con số
     trên màn hình lệch nhau, và người dùng thấy ngay mà không cần đọc mã. */
  const list = [
    issue("unit"), issue("layer"), issue("layer"),
    issue("dim-row"), issue("nhom-la"), issue("nhom-la"), issue("drawing"),
  ];
  const chips = scopeChips(list);
  const all = chips.find((chip) => chip.scope === null);
  const rest = chips.filter((chip) => chip.scope !== null);

  assert.equal(all?.count, list.length);
  assert.equal(rest.reduce((sum, chip) => sum + chip.count, 0), list.length);
});

test("sáu nhóm đã biết hiện kể cả khi đếm 0; nhóm lạ chỉ hiện khi có thật", () => {
  /* Số 0 ở một nhóm đã biết là một CÂU TRẢ LỜI — "bản vẽ không có vấn đề layer
     nào" — chứ không phải một chỗ trống. Còn một chip trống mang tên máy móc thì
     chỉ là nhiễu, nên nhóm lạ phải có ít nhất một phát hiện mới hiện. */
  const chips = scopeChips([issue("layer")]);
  for (const scope of REVIEW_SCOPES) {
    assert.ok(chips.some((chip) => chip.scope === scope.id), `thiếu chip ${scope.id}`);
  }
  assert.equal(chips.find((chip) => chip.scope === "layer")?.count, 1);
  assert.equal(chips.find((chip) => chip.scope === "frame")?.count, 0);
  assert.equal(chips.length, 1 + REVIEW_SCOPES.length, "chưa có nhóm lạ nào");

  const withUnknown = scopeChips([issue("la-hoac")]);
  const strange = withUnknown.find((chip) => chip.scope === "la-hoac");
  assert.equal(strange?.count, 1);
  assert.equal(strange?.known, false, "phải đánh dấu là ngoài bảng");
});

test("nhãn của nhóm lạ là chính tên thô, không phải “Khác”", () => {
  /* Gộp mọi nhóm chưa biết vào một nhãn "Khác" giấu mất việc bảng đã lạc hậu, và
     người dùng thì cần đọc đúng chuỗi máy chủ phát ra để đi hỏi. */
  assert.equal(scopeLabel("layer"), "Layer");
  assert.equal(scopeLabel("mapping-required"), "Ánh xạ bắt buộc");
  assert.equal(scopeLabel("nhom-chua-co-nhan"), "nhom-chua-co-nhan");
  assert.equal(scopeLabel(""), "");
});

test("bảng không có mã trùng", () => {
  /* Trùng mã là một chip vĩnh viễn rỗng và một nhãn không bao giờ được dùng —
     `Map` giữ mục cuối. Rẻ để kiểm, im lặng nếu không kiểm. */
  const ids = REVIEW_SCOPES.map((scope) => scope.id);
  assert.equal(new Set(ids).size, ids.length, `mã trùng trong bảng: ${ids}`);
  for (const scope of REVIEW_SCOPES) {
    assert.ok(scope.label.trim(), `${scope.id} thiếu nhãn`);
    assert.ok(scope.hint.trim(), `${scope.id} thiếu câu giải thích`);
  }
});

test("một `scope` tên “all” hay RỖNG vẫn phải lọc được", () => {
  /* Mọi giá trị chuỗi đều có thể là một `scope` thật. Lấy chuỗi `"all"` làm cờ
     "không lọc" là biến đúng những nhóm đó thành thứ không lọc được — bấm chip
     của chúng lại ra toàn bộ danh sách, im lặng và ngược hẳn ý người dùng.

     Chuỗi rỗng KHÔNG phải giả định: `str(value, "drawing")` trả nguyên chuỗi rỗng
     chứ không rơi về mặc định, vì `typeof "" === "string"`. */
  const list = [{ scope: "all" }, { scope: "" }, { scope: "layer" }];

  assert.equal(filterByScope(list, null).length, 3);
  assert.equal(filterByScope(list, "all").length, 1, "“all” là một nhóm, không phải cờ");
  assert.equal(filterByScope(list, "").length, 1, "nhóm rỗng cũng lọc được");

  const chips = scopeChips(list);
  assert.equal(chips.filter((chip) => chip.scope === null).length, 1, "đúng một chip Tất cả");
  assert.equal(chips.find((chip) => chip.scope === "all")?.count, 1);
  assert.equal(chips.find((chip) => chip.scope === "")?.label, "(không có nhóm)",
    "chip không chữ thì không bấm được và không đọc được");

  // Khoá React phải duy nhất, kể cả khi có nhóm rỗng và chip Tất cả cạnh nhau.
  const keys = chips.map(chipKey);
  assert.equal(new Set(keys).size, keys.length, `khoá trùng: ${keys}`);
});

test("bất biến #7 phải CÒN trong test-contract.mjs", () => {
  /* Một guardrail không tự kiểm được sự tồn tại của chính nó: xoá phép so lệch
     bảng ↔ engine thì chẳng có gì đỏ, vì nó chỉ nói khi hai bên thật sự lệch.

     Không phải lo xa. Hôm nay tôi đã tự xoá đúng nó một lần: trong lúc kiểm đột
     biến, tôi khôi phục `test-contract.mjs` bằng `git checkout --` thay vì bằng
     bản sao — mà file đó CHƯA commit, nên lệnh đó đưa nó về HEAD và cuốn theo
     bất biến vừa viết. Không test nào đỏ; Codex mới là thứ bắt được.

     Phép kiểm chéo từ MỘT tệp khác thì thoát được vòng lặp đó. */
  const here = dirname(fileURLToPath(import.meta.url));
  const contract = readFileSync(join(here, "test-contract.mjs"), "utf8");
  assert.match(contract, /Bất biến #7/,
    "test-contract.mjs mất phép so bảng nhóm ↔ standardsEngine.ts");
  assert.match(contract, /standardsEngine\.ts/,
    "phép so phải ĐỌC standardsEngine.ts, không chép cứng danh sách scope");
  assert.match(contract, /features\/review\/scopes\.ts/,
    "và phải đọc chính bảng nhãn, không chép cứng nó");
});

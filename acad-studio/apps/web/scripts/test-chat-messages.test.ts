/** Sửa message theo ID thay vì theo vị trí.
 *
 * Chat là phần duy nhất của app chưa có test nào, và cũng là phần sắp bị di
 * chuyển sang route riêng. Test này khoá đúng bất biến mà việc di chuyển dễ làm
 * mất: kết quả của một thao tác phải rơi vào ĐÚNG message đã mở cho nó, kể cả
 * khi có message khác chen vào giữa lúc chờ mạng.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { newMessageId, patchById } from "../features/assistant/messages";

type Msg = { id: string; role: string; text: string; result?: string };

const msg = (text: string): Msg => ({ id: newMessageId(), role: "assistant", text });

test("sửa đúng message dù có message khác chen vào sau đó", () => {
  const placeholder = msg("đang chạy…");
  let list: Msg[] = [msg("câu hỏi"), placeholder];

  // Người dùng gõ tiếp trong lúc chờ mạng.
  list = [...list, msg("người dùng gõ tiếp")];

  // Kết quả về sau đó — phải rơi vào placeholder, không phải message cuối.
  list = patchById(list, placeholder.id, (draft) => { draft.result = "xong"; });

  assert.equal(list[1].result, "xong", "kết quả phải vào đúng message đã mở cho nó");
  assert.equal(list[2].result, undefined, "message chen vào không được bị ghi đè");
});

test("sửa theo vị trí cuối là sai trong đúng tình huống trên", () => {
  // Ghi lại vì sao bất biến này tồn tại: đây là hành vi của bản cũ.
  const placeholder = msg("đang chạy…");
  const list: Msg[] = [placeholder, msg("người dùng gõ tiếp")];

  const patchedLast = [...list];
  patchedLast[patchedLast.length - 1] = { ...patchedLast[1], result: "xong" };

  assert.equal(patchedLast[0].result, undefined);
  assert.equal(
    patchedLast[1].result,
    "xong",
    "patch-theo-cuối đặt kết quả vào message của người dùng — đây chính là lỗi cần tránh",
  );
});

test("message không đụng tới giữ nguyên identity", () => {
  const first = msg("một");
  const second = msg("hai");
  const list = [first, second];

  const next = patchById(list, second.id, (draft) => { draft.result = "xong"; });

  assert.equal(next[0], first, "React dựa vào identity để bỏ qua re-render");
  assert.notEqual(next[1], second, "message bị sửa phải là object mới");
  assert.equal(second.result, undefined, "không được sửa tại chỗ message gốc");
});

test("ID không còn trong danh sách thì trả nguyên danh sách cũ", () => {
  const list = [msg("một"), msg("hai")];
  const next = patchById(list, "msg-không-tồn-tại", (draft) => { draft.result = "xong"; });

  assert.equal(next, list, "hội thoại đã đổi là chuyện bình thường, không phải lỗi");
  assert.ok(list.every((item) => item.result === undefined));
});

test("không sửa mảng đầu vào", () => {
  const target = msg("một");
  const list = [target];
  const snapshot = [...list];

  patchById(list, target.id, (draft) => { draft.result = "xong"; });

  assert.deepEqual(list, snapshot);
  assert.equal(target.result, undefined);
});

test("ID duy nhất kể cả khi tạo liên tiếp trong cùng mili giây", () => {
  const ids = Array.from({ length: 500 }, () => newMessageId());
  assert.equal(new Set(ids).size, ids.length);
});

test("hai thao tác song song điền vào hai message riêng", () => {
  const first = msg("thao tác A");
  const second = msg("thao tác B");
  let list = [first, second];

  // B xong trước A — thứ tự trả về không theo thứ tự gửi đi.
  list = patchById(list, second.id, (draft) => { draft.result = "B"; });
  list = patchById(list, first.id, (draft) => { draft.result = "A"; });

  assert.deepEqual(list.map((item) => item.result), ["A", "B"]);
});

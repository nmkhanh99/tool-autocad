/** Sửa một message trong danh sách hội thoại theo ID, không theo vị trí.
 *
 * Vì sao điều này quan trọng: mọi handler của chat đều có dạng
 *
 *     thêm một message chỗ giữ chỗ
 *     await một lời gọi mạng 0,2–120 giây
 *     điền kết quả vào message đó
 *
 * Bước cuối trước đây dùng `patchLast` — sửa phần tử CUỐI mảng. Giả định ngầm
 * là không có message nào chen vào giữa lúc `await`. Giả định đó sai bất cứ khi
 * nào người dùng gõ tiếp, một sự kiện AutoCAD chèn thông báo, hay hai chức năng
 * chạy song song. Hậu quả không phải crash mà là kết quả rơi vào NHẦM message —
 * người dùng thấy kết quả của thao tác này nằm dưới nhãn của thao tác khác.
 *
 * Sửa theo ID thì không có giả định nào cả.
 */

let sequence = 0;

/** ID duy nhất trong một phiên. Kèm thời gian để dễ đọc khi debug, kèm số đếm
 * để hai lời gọi trong cùng một mili giây không trùng nhau. */
export function newMessageId(): string {
  sequence += 1;
  return `msg-${Date.now().toString(36)}-${sequence.toString(36)}`;
}

/** Trả về danh sách MỚI với đúng một message được sửa.
 *
 * Message không đụng tới giữ nguyên identity — React dựa vào đó để bỏ qua
 * re-render, nên sao chép cả mảng sẽ làm mất lợi ích đó.
 *
 * ID không còn trong danh sách (hội thoại đã đổi, message đã bị xoá) là chuyện
 * bình thường: trả lại danh sách cũ nguyên vẹn thay vì ném lỗi.
 */
export function patchById<T extends { id: string }>(
  list: readonly T[],
  id: string,
  patch: (draft: T) => void,
): T[] {
  let found = false;
  const next = list.map((item) => {
    if (item.id !== id) return item;
    found = true;
    const draft = { ...item };
    patch(draft);
    return draft;
  });
  return found ? next : (list as T[]);
}

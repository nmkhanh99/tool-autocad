/** Đích của bộ vẽ — thứ `/draw/stage` ghi vào.
 *
 * ## Vì sao nó là một khái niệm RIÊNG
 *
 * Daemon giữ **hai** đích khác nhau: bản vẽ đang hoạt động của AutoCAD, và đích
 * của bộ vẽ. Kích hoạt một bản vẽ **không** tự đổi cái thứ hai. Nên một lượt
 * `activate-document` chạy xong mà không đặt lại đích vẽ sẽ để lệnh vẽ tiếp theo
 * ghi vào **bản vẽ cũ** — hoặc vào tệp `.work` mặc định.
 *
 * Màn hình cũ (`app/page.tsx`) đã làm đúng việc này từ lâu; `/changes` thì không,
 * cho tới khi review chỉ ra — và thẻ xác nhận ở đó lại **hứa** rằng mọi lệnh ghi
 * sau đó nhắm vào bản vẽ mới. Một lời hứa mã không giữ.
 */
import { daemonRecord, asRecord } from "./client";
import { endpoints } from "./endpoints";

/** Đặt đích vẽ, trả về đích máy chủ THẬT SỰ ghi nhận.
 *
 * Trả về thứ máy chủ xác nhận chứ không phải thứ vừa gửi: máy chủ có thể giải
 * đích khác đi (hoặc từ chối), và tin vào giá trị mình gửi là bày ra một đích
 * không đúng thực tế. */
export async function setDrawTarget(base: string, file: string): Promise<string> {
  const body = await daemonRecord(await fetch(endpoints.drawTarget(base), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(file ? { file } : {}),
  }));
  const target = asRecord(body.target) || {};
  /* `kind: "live"` = một bản vẽ đang mở. Kiểu khác nghĩa là máy chủ đang trỏ vào
     tệp `.work` chứ không phải bản vẽ nào — trả rỗng để nơi gọi thấy được điều
     đó thay vì tưởng đã đặt xong. */
  if (target.kind !== "live") return "";
  return String(target.file || target.title || "");
}

/** MÃ của những bản xem trước bộ vẽ đang chờ trong AutoCAD, đã sắp xếp.
 *
 * Trả **mã** chứ không phải số đếm. Đếm không phải là danh tính: một tab khác bỏ
 * một bản xem trước rồi dựng một cái mới thì con số y nguyên, trong khi thứ sắp
 * bị xoá đã là thứ khác — người dùng đồng ý với A rồi mất B.
 *
 * `undefined` = **không đọc được**, không phải danh sách rỗng. `POST /draw/target`
 * gửi lệnh reject vào AutoCAD cho mọi bản xem trước còn `staged` — tức xoá hình
 * đã vẽ, không hoàn tác được. Đọc hỏng mà báo "không có gì" là hứa một điều mã
 * không giữ, nên nơi gọi phải CHẶN chứ không được đi tiếp: hỏng thì người dùng
 * thử lại, còn đi liều thì mất hình.
 */
export async function stagedDrawPreviews(base: string): Promise<string[] | undefined> {
  const body = await daemonRecord(await fetch(endpoints.drawOps(base), { cache: "no-store" }));
  if (!Array.isArray(body.ops)) return undefined;
  return body.ops
    .map((op) => asRecord(op) || {})
    .filter((op) => op.state === "staged")
    .map((op) => String(op.opId || ""))
    .filter(Boolean)
    .sort();
}

/** Có bản xem trước nào ĐANG chờ mà người dùng CHƯA được cảnh báo không.
 *
 * So theo tập mã, không theo số lượng. Tập hiện tại là **con** của tập đã cảnh
 * báo thì đi tiếp được: mất ít hơn thứ người dùng đã đồng ý mất. Xuất hiện một
 * mã lạ thì dừng — câu họ đã đồng ý không còn nói đúng về thứ sắp bị xoá. */
export function unwarnedPreviews(warned: readonly string[], current: readonly string[]): string[] {
  const known = new Set(warned);
  return current.filter((id) => !known.has(id));
}

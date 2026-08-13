/** Đọc danh sách bản vẽ AutoCAD đang mở.
 *
 * Trước đây ba màn hình tự fetch `/api/acad/docs` và tự bóc payload. Ba bản đó
 * đọc giống nhau — nhưng cái đi kèm thì KHÔNG: mỗi màn hình suy "đích đang
 * chọn" theo một quy tắc riêng.
 *
 *   · Thư viện LISP        ưu tiên `initialTarget`, không có thì lấy bản vẽ active.
 *   · Hồ sơ tiêu chuẩn     kiểm `current` còn hợp lệ TRƯỚC, giữ nguyên nếu còn.
 *   · Màn hình legacy      không suy đích, trả payload cho nơi gọi dùng inline.
 *
 * Gộp luôn cả phần suy đích sẽ làm đích vẽ nhảy sang bản vẽ khác trong im lặng
 * — trên một app mà mọi lệnh ghi đều không hoàn tác được. Nên module này CHỈ
 * lo việc đọc; quy tắc suy đích ở lại với màn hình sở hữu nó.
 */
import { daemonJson } from "./client";
import { endpoints } from "./endpoints";

export type AcadDocument = {
  title?: string;
  file?: string;
  active?: boolean;
  /** Mã phiên của bản vẽ trong tiến trình AutoCAD này. So `revision` giữa hai
   * nguồn chỉ có nghĩa khi CÙNG một `instance`: bộ đếm revision là của một
   * database cụ thể, hai bản vẽ khác nhau có thể cùng đứng ở số 7. */
  instance?: string;
  /** Plugin đang chạy có nhận `instance` **làm đích** không.
   *
   * Khác hẳn "payload có `instance`": trường đó có từ lâu, còn `findDocExact`
   * mới biết nhận nó — không suy được cái sau từ cái trước. Thiếu trường = plugin
   * bản cũ; lúc đó bản vẽ chưa lưu trùng tiêu đề phải bị loại khỏi ô chọn như
   * trước, vì gửi mã phiên sẽ nhận `not_found` mà lùi về tiêu đề thì mơ hồ. */
  targetsInstance?: boolean;
  /** Tên không gian AutoCAD đang mở cho bản vẽ này (Model, hoặc tên layout).
   *
   * Cần nó vì danh mục đối tượng chỉ quét **một** không gian. Đo trên máy thật:
   * đổi tab CÓ làm `revision` nhảy (0 → 121 khi lần đầu kích hoạt layout) vì
   * AutoCAD phải dựng lại viewport — nên `revision` cũng bắt được, nhưng nó bắt
   * **nhầm lý do**: người dùng đọc "bản vẽ đã thay đổi" trong khi họ không sửa
   * gì. Trường này nói đúng chuyện gì đã xảy ra.
   *
   * Thiếu trường = plugin bản cũ. Không suy ra được gì, và phải im. */
  space?: string;
  /** Revision của bản vẽ, do plugin cấp. Không phải revision snapshot CadWeb
   * và không phải content-hash hồ sơ — bốn thứ này không so sánh được với nhau. */
  revision?: number;
  /** 1 = có thay đổi chưa lưu, 0 = sạch, **thiếu = không biết**.
   *
   * Plugin bản cũ không phát trường này. "Không biết" phải hiển thị khác "đã
   * lưu": một chấm xanh sai trên bản vẽ chưa lưu là đúng thứ dẫn tới mất dữ
   * liệu khi người dùng khởi động lại AutoCAD. */
  dbmod?: number;
};

export type DocsSnapshot = {
  /** Plugin có đang phản hồi không. `false` nghĩa là danh sách rỗng vì không
   * đọc được, khác hẳn với "AutoCAD không mở bản vẽ nào". */
  alive: boolean;
  docs: AcadDocument[];
};

export async function fetchDocs(base: string, signal?: AbortSignal): Promise<DocsSnapshot> {
  const body = await daemonJson<{ alive?: boolean; docs?: AcadDocument[] }>(
    await fetch(endpoints.docs(base), { cache: "no-store", signal }),
  );
  return {
    alive: body.alive === true,
    docs: Array.isArray(body.docs) ? body.docs : [],
  };
}

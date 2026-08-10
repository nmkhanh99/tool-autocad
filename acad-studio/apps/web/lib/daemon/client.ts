/** Một cách đọc phản hồi daemon cho toàn app.
 *
 * Trước giai đoạn 2A có bốn bản gần giống nhau (`responseJson` ×3,
 * `responseRecord` ×1) nằm trong bốn panel. Ba bản ném `Error` trần, nên mã lỗi
 * có kiểu của daemon bị vứt đi ngay tại chỗ nhận và UI chỉ còn một chuỗi để
 * hiển thị — không phân biệt được "bản vẽ đã đổi từ lúc chuẩn bị" với "AutoCAD
 * chưa chạy". Bản gộp này lấy theo bản MẠNH nhất: giữ `code` và `status`.
 */
export type JsonRecord = Record<string, unknown>;

export function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : null;
}

/** Lỗi từ daemon, giữ nguyên mã có kiểu để `guards[code]` chọn đúng câu chữ. */
export class DaemonError extends Error {
  constructor(
    message: string,
    readonly code = "",
    readonly status = 0,
  ) {
    super(message);
    this.name = "DaemonError";
  }
}

/** Backend phát cả `ambiguous_target` lẫn `target_ambiguous` cho cùng một tình
 * huống, và báo "không khớp đối tượng nào" bằng `selection_empty`. Chuẩn hoá ở
 * biên nhận để phần còn lại của app chỉ biết một tên. */
const CODE_ALIASES: Record<string, string> = {
  ambiguous_target: "target_ambiguous",
  autocad_not_running: "not_running",
};

export function normalizeCode(code: string): string {
  return CODE_ALIASES[code] || code;
}

/** Chỉ nhận giá trị nguyên thuỷ làm thông điệp. Nếu daemon trả `error` là một
 * object, `String()` sẽ cho ra "[object Object]" — vô nghĩa với người đọc, và
 * tệ hơn cả việc hiện mã HTTP. */
function messageOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return "";
}

function failureOf(response: Response, record: JsonRecord): DaemonError {
  return new DaemonError(
    messageOf(record.error) || messageOf(record.message) || `HTTP ${response.status}`,
    normalizeCode(messageOf(record.code)),
    response.status,
  );
}

/** Phản hồi dạng object. Ném `DaemonError` khi HTTP lỗi hoặc `ok: false`. */
export async function daemonRecord(response: Response): Promise<JsonRecord> {
  const body = await response.json().catch(() => ({}));
  const record = asRecord(body) || {};
  if (!response.ok || record.ok === false) throw failureOf(response, record);
  return record;
}

/** Như trên nhưng trả nguyên body — dùng khi phản hồi không phải object,
 * hoặc khi nơi gọi đã có type riêng cho payload. */
export async function daemonJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => ({}));
  const record = asRecord(body);
  if (!response.ok || record?.ok === false) throw failureOf(response, record || {});
  return body as T;
}

/** Câu chữ cho người dùng khi một lời gọi daemon hỏng.
 *
 * `fetch` ném `TypeError` khi không nối được — và trình duyệt cho ra đúng chuỗi
 * "Failed to fetch", thứ không nói gì với người đang dùng app. Ba nguyên nhân
 * thực tế đều có lối thoát cụ thể, nên nói ra chúng thay vì để người dùng đoán.
 */
export function daemonFailureText(error: unknown): string {
  if (error instanceof DaemonError) return error.message;
  if (error instanceof TypeError) {
    return "Không nối được tới daemon. Kiểm tra: daemon đã chạy chưa " +
      "(pnpm --filter @acad/daemon start), cổng có đúng 8788 không, và app có " +
      "được mở qua localhost thay vì file:// không.";
  }
  return error instanceof Error ? error.message : String(error);
}

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

function failureOf(response: Response, record: JsonRecord): DaemonError {
  return new DaemonError(
    String(record.error || record.message || `HTTP ${response.status}`),
    normalizeCode(String(record.code || "")),
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

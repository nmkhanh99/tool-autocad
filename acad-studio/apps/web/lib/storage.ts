/** Bốn khoá lưu trữ của app, khai một chỗ.
 *
 * App hiện dùng **0** khoá — mọi thứ mất khi tải lại trang. Shell mới cần nhớ
 * vài thứ, nhưng chỉ những thứ mất đi thì phiền chứ không sai:
 *
 *   · hàng chờ thao tác — mất là người dùng tưởng đã chuẩn bị xong rồi;
 *   · trạng thái thu/mở rail — mất là nháy giao diện mỗi lần tải;
 *   · agent đang chọn — mất là phải chọn lại;
 *   · ngữ cảnh bàn giao sang trợ lý — chỉ sống trong một tab.
 *
 * Không khoá nào là nguồn sự thật về bản vẽ. Trạng thái AutoCAD luôn đọc lại từ
 * daemon, vì bản vẽ có thể đã đổi trong lúc tab này đóng.
 *
 * Mọi truy cập bọc try/catch: Safari chế độ riêng tư ném ngay khi ĐỌC
 * `localStorage`, và một app CAD không được chết vì không nhớ được bề rộng
 * thanh điều hướng.
 */
export const STORAGE_KEYS = {
  /** Thao tác đã chuẩn bị, chờ người xác nhận. */
  staged: "acad.staged.v1",
  /** "expanded" | "collapsed" — lựa chọn của người dùng, thắng mặc định theo bề rộng. */
  rail: "acad.rail.v1",
  /** CLI agent đang chọn. */
  agent: "acad.agent.v1",
  /** Ngữ cảnh bàn giao từ Khung bản vẽ sang Trợ lý. sessionStorage: chỉ một tab. */
  askContext: "acad.askContext",
} as const;

type Store = "local" | "session";

function store(kind: Store): Storage | null {
  try {
    return kind === "local" ? window.localStorage : window.sessionStorage;
  } catch {
    return null; // chế độ riêng tư, hoặc đang chạy phía máy chủ
  }
}

export function readText(key: string, kind: Store = "local"): string | null {
  try {
    return store(kind)?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

export function writeText(key: string, value: string, kind: Store = "local"): void {
  try {
    store(kind)?.setItem(key, value);
  } catch {
    /* hết quota hoặc chế độ riêng tư — trạng thái chỉ sống trong phiên này */
  }
}

export function removeText(key: string, kind: Store = "local"): void {
  try {
    store(kind)?.removeItem(key);
  } catch {
    /* không xoá được thì cũng không có gì để làm thêm */
  }
}

/** Đọc JSON. Dữ liệu hỏng được coi như không có: một khoá localStorage hỏng
 * không được làm app không mở lên được. */
export function readJson<T>(key: string, fallback: T, kind: Store = "local"): T {
  const raw = readText(key, kind);
  if (raw === null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function writeJson(key: string, value: unknown, kind: Store = "local"): void {
  try {
    writeText(key, JSON.stringify(value), kind);
  } catch {
    /* có vòng lặp tham chiếu — lỗi lập trình, nhưng không đáng để sập app */
  }
}

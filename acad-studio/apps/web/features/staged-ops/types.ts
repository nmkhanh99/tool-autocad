/** Một thao tác ghi đã được chuẩn bị và đang chờ người xác nhận.
 *
 * Mọi đường ghi vào bản vẽ đều đi qua đây: daemon chuẩn bị (chưa chạm bản vẽ),
 * người xác nhận, rồi mới ghi. Không có hoàn tác — không journal, không
 * inverse-op, không endpoint. Cách duy nhất quay lại là gõ UNDO trong AutoCAD.
 */

/** Thao tác `/api/acad/selection/prepare` chấp nhận. Backend chỉ nhận đúng ba
 * giá trị này; mọi thứ khác trả 400. */
export type StagedAction = "activate-document" | "select" | "move-to-layer";

/** Màn hình đã tạo ra thao tác. Cần cho `/changes` ở giai đoạn 7: người dùng
 * phải quay được về đúng chỗ đã chuẩn bị để chuẩn bị lại. */
export type StagedSource =
  | "drawing-info"
  | "review"
  | "standards"
  | "workspace"
  | "assistant"
  | "lisp";

export type StagedOp = {
  /** Id do daemon cấp. Apply là one-shot — hỏng thì phải chuẩn bị lại, không
   * bao giờ retry cùng id. */
  id: string;
  /** Revision của bản vẽ lúc chuẩn bị. Daemon so lại lúc apply; lệch là từ chối. */
  revision: string;
  action: StagedAction;
  /** Đích ghi, dạng đường dẫn tệp đầy đủ chứ không phải title. */
  target: string;
  /** Số đối tượng thao tác chạm tới, nếu daemon đếm được. */
  count?: number;
  /** Với `activate-document`: bản vẽ sẽ thành active sau khi apply. */
  nextTarget?: string;
};

/** Payload gửi lên `/prepare`. Hình dạng do backend quyết định, không ép kiểu
 * chặt ở đây để tránh phải sửa hai chỗ mỗi lần backend thêm một scope. */
export type PrepareRequest = Record<string, unknown>;

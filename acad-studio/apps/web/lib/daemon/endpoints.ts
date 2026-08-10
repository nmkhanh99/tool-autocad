/** Mọi đường dẫn API của daemon, khai đúng một chỗ.
 *
 * Hôm nay `app/page.tsx` legacy còn 32 đường dẫn rải rác trong thân hàm. Đổi
 * một endpoint nghĩa là grep cả repo và hy vọng không sót. Code mới trong
 * `features/` và `components/` bị `scripts/check-import-boundaries.mjs` cấm
 * chứa chuỗi "/api/" — nó phải đi qua đây.
 */

/** Địa chỉ daemon, khai ĐÚNG MỘT LẦN cho toàn app.
 *
 * `scripts/package.mjs` set biến này lúc build bản đóng gói. Đặt tên khác ở một
 * màn hình nào đó nghĩa là màn hình đó trỏ sai địa chỉ trong bản đóng gói mà
 * mọi thứ khác vẫn chạy — kiểu lỗi chỉ lộ ra sau khi giao hàng.
 */
export const DAEMON_BASE = process.env.NEXT_PUBLIC_DAEMON_URL || "http://127.0.0.1:8788";

/** Daemon base có thể đến từ env hoặc từ props, có hoặc không có dấu / cuối. */
function trim(base: string): string {
  return base.replace(/\/+$/, "");
}

export const endpoints = {
  /** Chuẩn bị một thao tác ghi. Trả về operation chờ xác nhận, chưa chạm bản vẽ. */
  selectionPrepare: (base: string) => `${trim(base)}/api/acad/selection/prepare`,

  /** Xác nhận và ghi. One-shot: hỏng thì phải chuẩn bị lại, không retry cùng id. */
  selectionOperationApply: (base: string, id: string) =>
    `${trim(base)}/api/acad/selection/operations/${encodeURIComponent(id)}/apply`,

  /** Bỏ thao tác đã chuẩn bị. Best-effort — không có nó thì op cũng tự hết hạn. */
  selectionOperationReject: (base: string, id: string) =>
    `${trim(base)}/api/acad/selection/operations/${encodeURIComponent(id)}/reject`,

  /** Bản vẽ AutoCAD ĐANG MỞ. Không phải danh sách tệp mở gần đây. */
  docs: (base: string) => `${trim(base)}/api/acad/docs`,

  /** SSE sự kiện reactor từ plugin. Chỉ `features/acad-connection/events.ts`
   * được mở kết nối này — xem lý do ở đó. */
  acadEvents: (base: string) => `${trim(base)}/api/acad/events`,

  /** AutoCAD đã cài chưa, đang chạy chưa, có job nào đang chiếm phiên không. */
  acadStatus: (base: string) => `${trim(base)}/api/acad/status`,

  /** Danh mục block: định nghĩa trong thư viện + đối chiếu với bản vẽ đang mở. */
  blocks: (base: string) => `${trim(base)}/api/acad/blocks`,
  /** Thư mục nguồn mà thư viện quét để tìm định nghĩa block. */
  blockSources: (base: string) => `${trim(base)}/api/acad/blocks/sources`,
  /** Lệnh GHI của thư viện block. Một pha: gọi là AutoCAD làm ngay, không có
   * bước chuẩn bị và không đi qua hàng chờ Thay đổi. */
  blockAction: (base: string, action: "insert" | "sync") =>
    `${trim(base)}/api/acad/blocks/${action}`,
} as const;

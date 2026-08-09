/** Route giàn giáo của giai đoạn 0 — chưa có nội dung sản phẩm.
 *
 * Nó tồn tại để `scripts/test-route-serving.mjs` chứng minh được rằng bản đóng
 * gói phục vụ ĐÚNG route con: không có `trailingSlash: true`, request /changes/
 * rơi vào catch-all của daemon và trả HTTP 200 với nội dung route "/".
 *
 * KHÔNG tạo `app/(shell)/page.tsx` chừng nào `app/page.tsx` legacy còn sống:
 * cả hai cùng resolve về "/" và Next 16 âm thầm bỏ file trong route group,
 * không một dòng cảnh báo nào. Màn Tổng quan chỉ được tạo trong cùng commit với
 * việc dời `app/page.tsx` sang `app/legacy/page.tsx` (giai đoạn 8).
 */
export default function ChangesPage() {
  return <div data-screen="changes">Thay đổi chờ duyệt — chưa dựng.</div>;
}

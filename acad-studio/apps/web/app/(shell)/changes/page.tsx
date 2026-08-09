"use client";

import { useEffect } from "react";

/** Route giàn giáo của giai đoạn 0 — chưa có nội dung sản phẩm.
 *
 * Nó tồn tại để `scripts/test-route-serving.mjs` chứng minh được rằng bản đóng
 * gói phục vụ ĐÚNG route con: không có `trailingSlash: true`, request /changes/
 * rơi vào catch-all của daemon và trả HTTP 200 với nội dung route "/".
 *
 * Từ giai đoạn 1 nó còn là chỗ duy nhất chứng minh `design-system.css` thật sự
 * áp được: nếu gate `body[data-ds]` sai, trang này mất nền sáng ngay.
 * Giai đoạn 3 sẽ thay bằng `AppShell` và việc đặt attribute chuyển về đó.
 *
 * KHÔNG tạo `app/(shell)/page.tsx` chừng nào `app/page.tsx` legacy còn sống:
 * cả hai cùng resolve về "/" và Next 16 âm thầm bỏ file trong route group,
 * không một dòng cảnh báo nào. Màn Tổng quan chỉ được tạo trong cùng commit với
 * việc dời `app/page.tsx` sang `app/legacy/page.tsx` (giai đoạn 8).
 */
export default function ChangesPage() {
  useEffect(() => {
    document.body.dataset.ds = "1";
    return () => { delete document.body.dataset.ds; };
  }, []);

  return (
    <div data-screen="changes" className="pad stack">
      <h1>Thay đổi chờ duyệt</h1>
      <p className="hint">Màn hình chưa được dựng — xem ROADMAP.md, giai đoạn 7.</p>
    </div>
  );
}

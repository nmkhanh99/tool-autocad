"use client";

import { AppShell } from "../../../components/shell/AppShell";

/** Màn "Thay đổi chờ duyệt" chưa được dựng — nó là trục xoay của sản phẩm và
 * thuộc giai đoạn 7, sau khi có `ConfirmSheet` và bảng diff.
 *
 * Route này tồn tại từ giai đoạn 0 để `scripts/test-route-serving.mjs` chứng
 * minh bản đóng gói phục vụ đúng route con; từ giai đoạn 3 nó còn là nơi duy
 * nhất `AppShell` thật sự chạy, nên mọi lỗi của shell lộ ra ở đây trước.
 *
 * KHÔNG tạo `app/(shell)/page.tsx` chừng nào `app/page.tsx` legacy còn sống:
 * cả hai cùng resolve về "/" và Next 16 âm thầm bỏ file trong route group,
 * không một dòng cảnh báo nào.
 */
export default function ChangesPage() {
  return (
    <AppShell
      screen="changes"
      title="Thay đổi chờ duyệt"
      sub="Mọi lệnh ghi vào bản vẽ dừng ở đây chờ người xác nhận"
    >
      <div className="pad stack">
        <div className="statebox">
          <p>Màn hình này chưa được dựng.</p>
          <p className="hint">
            Nó thuộc giai đoạn 7 của kế hoạch chuyển giao diện — xem
            {" "}<code>ROADMAP.md</code>. Hàng chờ hiện sống trong trình duyệt;
            máy chủ không lưu thao tác đã chuẩn bị và không có API liệt kê chúng.
          </p>
        </div>
      </div>
    </AppShell>
  );
}

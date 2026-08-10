"use client";

/** Thanh trạng thái chỉ mang những giá trị daemon thật sự báo về.
 *
 * Mẫu cố ý KHÔNG có ô "tỷ lệ 1:100": AutoCAD không có tỷ lệ ở cấp bản vẽ, chỉ
 * có ở cấp viewport/layout. Một ô như vậy sẽ luôn hiển thị một con số bịa.
 */
import { ACAD_STATE_LABEL, type AcadState } from "../../features/acad-connection/useAcadState";

export function Statusbar({ acadState, status }: { acadState: AcadState; status?: string }) {
  return (
    <footer className="statusbar">
      <span>AutoCAD <b>{ACAD_STATE_LABEL[acadState].short}</b></span>
      <span className="sep" />
      <span data-status-slot>{status || "Sẵn sàng"}</span>
      <span className="right">
        {/* Phiên bản plugin và INSUNITS cần một lời gọi mà shell chưa có chỗ
            gắn; thêm khi màn Kết nối AutoCAD được dựng (giai đoạn 7). */}
        <span className="hint">Nhật ký hoạt động ở thanh trên</span>
      </span>
    </footer>
  );
}

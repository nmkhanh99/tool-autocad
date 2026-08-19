"use client";

/** Thanh tiêu đề: tab bản vẽ đang mở, ô tìm ⌘K, chip thay đổi chờ duyệt, và
 * pill trạng thái kết nối.
 *
 * Danh sách tab là các bản vẽ AutoCAD **đang mở** — không phải danh sách tệp mở
 * gần đây. App không có kho bản vẽ, và không đọc được gì từ tệp chưa mở.
 *
 * Chấm "đã lưu / chưa lưu" có **ba** trạng thái, không phải hai. Plugin bản cũ
 * không phát `dbmod`, và một chấm xanh sai trên bản vẽ chưa lưu là đúng thứ dẫn
 * tới mất dữ liệu khi người dùng khởi động lại AutoCAD. Không biết thì nói
 * không biết.
 */
import Link from "next/link";
import { Button } from "../ui/Button";
import { Icon } from "../ui/icons";
import { isRouteBuilt } from "./nav";
import { pendingBadge } from "../../features/staged-ops/queue";
import { ACAD_STATE_LABEL, type AcadState } from "../../features/acad-connection/useAcadState";
import type { AcadDocument } from "../../lib/daemon/docs";

export function Titlebar({
  docs, acadState, pending, pendingStale, railLocked, railExpanded, onToggleRail, onOpenPalette, onOpenDrawer,
}: {
  docs: AcadDocument[];
  acadState: AcadState;
  /** Số thao tác đang chờ, hoặc `undefined` khi CHƯA đọc được. Hai thứ khác
   * nhau: `0` là "không có gì chờ", còn `undefined` là "chưa biết" — và hiện
   * `0` cho cái sau là nói dối ở đúng chỗ nhắc người dùng đừng quên lệnh ghi. */
  pending: number | undefined;
  /** Số đang hiện là của lượt đọc TRƯỚC (lượt gần nhất hỏng). */
  pendingStale?: boolean;
  railLocked: boolean;
  railExpanded: boolean;
  onToggleRail: () => void;
  onOpenPalette: () => void;
  onOpenDrawer: () => void;
}) {
  const conn = ACAD_STATE_LABEL[acadState];
  // Pill kết nối và chip thay đổi đều là liên kết. Route chưa tồn tại thì
  // chúng phải hiện dạng tĩnh kèm lý do — dẫn người dùng tới 404 tệ hơn hẳn.
  const settingsBuilt = isRouteBuilt("/settings");
  const badge = pendingBadge(pending, !!pendingStale);
  const changesBuilt = isRouteBuilt("/changes");

  return (
    <header className="titlebar">
      <div className="wdots" aria-hidden="true"><i /><i /><i /></div>

      <Button
        variant="quiet"
        icon
        onClick={onToggleRail}
        disabled={railLocked}
        aria-expanded={railExpanded}
        title={railLocked
          ? "Màn hình quá hẹp để mở rộng thanh điều hướng"
          : railExpanded ? "Thu gọn thanh điều hướng (⌘B)" : "Mở rộng thanh điều hướng (⌘B)"}
        data-od-id="rail-toggle"
      >
        <Icon name="sidebar" />
      </Button>

      <div className="doctabs" aria-label="Bản vẽ đang mở" data-od-id="open-documents">
        {docs.map((doc, index) => {
          const name = doc.title || doc.file || "(không tên)";
          const saved = doc.dbmod === undefined ? "unknown" : doc.dbmod ? "false" : "true";
          const savedLabel = saved === "unknown"
            ? "Không đọc được trạng thái lưu — plugin AcadBridge cần cập nhật"
            : saved === "true" ? "Đã lưu" : "Có thay đổi chưa lưu";
          return (
            // KHÔNG phải nút. Đổi bản vẽ hiện hành là một lệnh GHI
            // (`activate-document`) và phải đi qua chuẩn bị → xác nhận như mọi
            // lệnh ghi khác. Cho tới khi luồng đó có màn hình, đây là chỉ báo
            // đọc-thôi: một "tab" bấm không phản ứng luôn bị hiểu là app hỏng.
            <span
              key={doc.file || doc.title || index}
              className="doctab"
              aria-current={doc.active === true ? "true" : undefined}
              title={`${doc.file || name} — ${savedLabel}. Đổi bản vẽ hiện hành trong AutoCAD.`}
              data-od-id={`doc-tab-${index + 1}`}
            >
              <span className="dot" data-saved={saved} aria-label={savedLabel} />
              <span className="name">{name}</span>
            </span>
          );
        })}
        {docs.length === 0 ? <span className="hint" style={{ padding: "0 8px" }}>Chưa mở bản vẽ nào</span> : null}
      </div>

      <div className="right">
        <button type="button" className="searchbtn" onClick={onOpenPalette} data-od-id="global-search">
          <Icon name="search" />
          <span>Tìm màn hình, hồ sơ, block…</span>
          <kbd>⌘K</kbd>
        </button>

        {changesBuilt ? (
          <Link
            className="stagedchip"
            href="/changes"
            data-tone={badge.tone}
            aria-label={badge.aria}
            title={badge.title || undefined}
            data-od-id="staged-changes"
          >
            <Icon name="changes" />
            Chờ duyệt<span className="n">{badge.text}</span>
          </Link>
        ) : (
          <span
            className="stagedchip"
            data-tone={badge.tone}
            aria-label={`${badge.aria} — màn hình Thay đổi chưa được dựng`}
            title="Màn hình Thay đổi chưa được dựng"
            data-od-id="staged-changes"
          >
            <Icon name="changes" />
            Chờ duyệt<span className="n">{badge.text}</span>
          </span>
        )}

        <Button variant="quiet" icon onClick={onOpenDrawer} title="Nhật ký hoạt động" data-od-id="activity-log">
          <Icon name="activity" />
        </Button>

        {settingsBuilt ? (
          <Link className="conn" href="/settings" data-state={acadState} data-od-id="acad-connection">
            <span className="beacon" />
            {conn.label}
          </Link>
        ) : (
          <span
            className="conn"
            data-state={acadState}
            title="Màn hình Kết nối AutoCAD chưa được dựng"
            data-od-id="acad-connection"
          >
            <span className="beacon" />
            {conn.label}
          </span>
        )}
      </div>
    </header>
  );
}

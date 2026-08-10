"use client";

/** Thanh điều hướng chính.
 *
 * `title` và `aria-label` được đặt trên mọi mục vì chúng phải sống sót qua
 * trạng thái thu gọn — lúc đó nhãn nhìn thấy bị ẩn và chỉ còn lại biểu tượng.
 *
 * Mục chưa dựng màn hình hiện dạng vô hiệu hoá kèm lý do, thay vì là một liên
 * kết dẫn tới trang trống. Người dùng bấm vào một mục và không thấy gì sẽ cho
 * là app hỏng, chứ không cho là tính năng chưa làm.
 */
import Link from "next/link";
import { NAV } from "./nav";
import { Icon } from "../ui/icons";

export function Rail({ screen, pending }: { screen: string; pending: number }) {
  return (
    <nav className="rail" aria-label="Điều hướng chính">
      {NAV.map((group) => (
        <div key={group.group}>
          <div className="rail-group eyebrow">{group.group}</div>
          {group.items.map((item) => {
            const badge = item.staged && pending > 0
              ? <span className="count">{pending}</span>
              : null;
            const body = (
              <>
                <Icon name={item.icon} />
                <span>{item.label}</span>
                {badge}
              </>
            );
            return item.built ? (
              <Link
                key={item.id}
                className="rail-link"
                href={item.href}
                aria-current={item.id === screen ? "page" : undefined}
                title={item.label}
                aria-label={item.label}
                data-od-id={`nav-${item.id}`}
              >
                {body}
              </Link>
            ) : (
              <span
                key={item.id}
                className="rail-link"
                aria-disabled="true"
                title={`${item.label} — màn hình chưa được dựng`}
                aria-label={`${item.label} — màn hình chưa được dựng`}
                data-od-id={`nav-${item.id}`}
                data-unbuilt="true"
              >
                {body}
              </span>
            );
          })}
        </div>
      ))}

      <div className="rail-foot">
        {/* Đường về màn hình cũ. Xoá ở giai đoạn 8 cùng với chính màn hình đó. */}
        <Link className="rail-link" href="/" title="Màn hình cũ" aria-label="Màn hình cũ">
          <Icon name="external" /><span>Màn hình cũ</span>
        </Link>
        <div className="eyebrow" style={{ marginBottom: 6, marginTop: "var(--s3)" }}>Cầu nối</div>
        <div className="mono" style={{ fontSize: 11, color: "var(--muted)", lineHeight: 1.6 }}>
          ~/Acad-Bridge<br />plugin nhịp 2,1 s
        </div>
      </div>
    </nav>
  );
}

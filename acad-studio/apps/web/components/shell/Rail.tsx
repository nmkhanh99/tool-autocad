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
import { pendingBadge } from "../../features/staged-ops/queue";

export function Rail({ screen, pending, pendingStale }: {
  screen: string;
  /** `undefined` = chưa đọc được lần nào. Xem `pendingBadge()` — chữ và câu giải
   * thích cho cả ba trạng thái nằm ở đó, dùng chung với thanh trên. */
  pending: number | undefined;
  /** Lượt đọc gần nhất HỎNG. Khi đó `0` KHÔNG chứng minh hàng chờ rỗng — một
   * thao tác chuẩn bị ngay trước lúc mạng trục trặc sẽ bị giấu mất nếu huy hiệu
   * im lặng, nên trạng thái này luôn hiện huy hiệu. */
  pendingStale?: boolean;
}) {
  /* Cùng một phép suy với thanh trên — dùng chung hàm, vì hai góc màn hình nói
     hai điều khác nhau về cùng một hàng chờ là chuyện đã xảy ra: chỗ này từng
     hiện `?` kèm câu "chưa chắc hàng chờ rỗng" ngay cả khi chưa đọc được lần
     nào, tức là nói về một con số chưa từng có. */
  const badge = pendingBadge(pending, !!pendingStale);
  /* Chỉ ẩn khi hàng chờ CHẮC CHẮN rỗng. Mọi trạng thái khác — kể cả lượt đọc đầu
     chưa xong — phải hiện, vì ở đây "không có huy hiệu" đọc y hệt "không có gì
     chờ". Bản trước suy từ `pending`/`pendingStale`, nên lượt đọc ĐẦU (chưa có
     số, chưa hỏng) bị ẩn trong khi thanh trên hiện `—`: hai thanh nói hai điều
     khác nhau về cùng một hàng chờ, đúng thứ `pendingBadge()` sinh ra để dẹp. */
  const showBadge = badge.tone !== "empty";

  return (
    <nav className="rail" aria-label="Điều hướng chính">
      {NAV.map((group) => (
        <div key={group.group}>
          <div className="rail-group eyebrow">{group.group}</div>
          {group.items.map((item) => {
            const mark = item.staged && showBadge
              ? <span className="count" title={badge.title || undefined}>{badge.text}</span>
              : null;
            const body = (
              <>
                <Icon name={item.icon} />
                <span>{item.label}</span>
                {mark}
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

/** Nhãn trạng thái nhỏ. Trạng thái mã hoá bằng HÌNH DẠNG và ĐỘ ĐẬM chứ không
 * chỉ bằng màu — bản vẽ kỹ thuật thường được xem trên màn hình hiệu chuẩn kém,
 * in đen trắng, hoặc bởi người không phân biệt được màu. */
import type { ReactNode } from "react";

export function Tag({ quiet = false, mono = false, children }: {
  quiet?: boolean;
  mono?: boolean;
  children: ReactNode;
}) {
  return (
    <span className={["tag", quiet ? "tag--quiet" : "", mono ? "mono" : ""].filter(Boolean).join(" ")}>
      {children}
    </span>
  );
}

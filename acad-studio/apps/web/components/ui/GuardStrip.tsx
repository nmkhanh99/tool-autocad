/** Điều kiện cần trước khi một thao tác chạy được, hiện NGAY CẠNH nút.
 *
 * Nguyên tắc: chặn trước, không báo lỗi sau. Cho bấm rồi mới trả 409 nghĩa là
 * người dùng đã tin thao tác sẽ chạy — và với lệnh ghi không hoàn tác được thì
 * cái tin đó tốn kém. Danh sách này tính từ dữ liệu thật, không viết cứng.
 */
import type { ReactNode } from "react";

export type GuardCondition = {
  label: string;
  met: boolean;
  /** Chưa đạt thì làm gì. Bỏ trống khi nhãn đã tự nói rõ. */
  hint?: string;
};

export function GuardStrip({ conditions, children }: {
  conditions: GuardCondition[];
  children?: ReactNode;
}) {
  if (!conditions.length) return null;
  const blocked = conditions.filter((condition) => !condition.met);
  return (
    <div className="guardstrip" data-blocked={blocked.length > 0 ? "true" : "false"}>
      <ul>
        {conditions.map((condition) => (
          <li key={condition.label} data-met={condition.met ? "true" : "false"}>
            <span>{condition.label}</span>
            {!condition.met && condition.hint ? <em>{condition.hint}</em> : null}
          </li>
        ))}
      </ul>
      {children}
    </div>
  );
}

/** Nhãn cho nút chính: khi chưa đủ điều kiện, nút phải NÓI vì sao thay vì chỉ
 * mờ đi. */
export function guardedLabel(ready: boolean, ready_label: string, blocked_label: string): string {
  return ready ? ready_label : blocked_label;
}

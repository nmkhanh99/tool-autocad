/** Trạng thái kết nối AutoCAD — kiểu và nhãn dùng chung.
 *
 * Nằm ở `lib/` chứ không ở `features/acad-connection/` vì đây là HẠ TẦNG:
 * primitive UI (`WriteButton`) cần nó, mà `components/ui/*` bị cấm import
 * `features/*` — nếu không, một nút bấm sẽ kéo theo cả tầng kết nối.
 *
 * Cách ĐỌC trạng thái (polling, SSE, heuristic phân biệt no-plugin với mute)
 * vẫn ở `features/acad-connection/useAcadState.ts`. Đây chỉ là từ vựng.
 */

export type AcadState = "on" | "busy" | "off" | "missing" | "no-plugin" | "mute";

/** Nhãn dài cho pill ở titlebar, nhãn ngắn cho thanh trạng thái. Câu chữ lấy
 * nguyên từ mẫu để hai bên không lệch nhau. */
export const ACAD_STATE_LABEL: Record<AcadState, { label: string; short: string }> = {
  on: { label: "AutoCAD 2027 · đã nối", short: "đã nối" },
  /* KHÔNG phải "AutoCAD đang bận" — đó là một chẩn đoán daemon không làm được.
     Nó chỉ biết: đã gửi job, chưa nhận `acad:write-result`. Job chạy thật và job
     CHẾT giữa chừng (LISP lỗi, người dùng đóng hộp thoại) cho ra cùng một trạng
     thái, và ca thứ hai thì AutoCAD đang rảnh — câu cũ nói sai nguyên nhân và
     người dùng đi tìm nhầm chỗ. Xem `busyText()` cho câu có kèm thời gian. */
  busy: { label: "Đang chờ AutoCAD trả kết quả", short: "chờ kết quả" },
  off: { label: "AutoCAD chưa chạy", short: "chưa chạy" },
  missing: { label: "Chưa cài AutoCAD", short: "chưa cài" },
  "no-plugin": { label: "Chưa cài plugin AcadBridge", short: "thiếu plugin" },
  mute: { label: "Plugin không phản hồi", short: "plugin câm" },
};

/** Ghi được vào bản vẽ hay không. Chỉ `on` mới ghi được — `busy` cũng không,
 * vì AutoCAD đang chiếm bởi một lệnh khác. */
export function canWrite(state: AcadState): boolean {
  return state === "on";
}

/** Câu giải thích cho trạng thái chờ, kèm thời gian còn lại nếu biết.
 *
 * Điều daemon biết chắc là khoá **tự rụng** sau một mốc. Nói ra mốc đó là khác
 * biệt giữa "app hỏng rồi" và "chờ thêm 40 giây nữa": cùng một màn hình, hai kết
 * luận trái ngược ở người đang nhìn.
 *
 * `busyUntil` rỗng hoặc đọc không ra thì KHÔNG bịa một con số — trả câu không có
 * thời gian. Đoán bừa ở đây là hứa một cái hạn có thể không tới.
 */
export function busyText(busyUntil: string | undefined, now: number): string {
  const base = "Đã gửi lệnh cho AutoCAD và chưa nhận kết quả. Có thể AutoCAD đang "
    + "chạy nó, cũng có thể lệnh đã hỏng giữa chừng — app không phân biệt được.";
  /* Chốt này trông thừa về HÀNH VI — `Date.parse("")` ra `NaN` nên chốt dưới đã
     bao trọn, và đột biến bỏ nó đi không làm đỏ test nào. Nhưng nó là thứ thu hẹp
     `string | undefined` xuống `string` cho `Date.parse`: bỏ đi thì `check:types`
     đỏ. Ghi lại vì phép đo đột biến chỉ chạy test, không chạy typecheck — "không
     test nào đỏ" chưa phải là "không ai cần". */
  if (!busyUntil) return base;
  const left = Date.parse(busyUntil) - now;
  if (!Number.isFinite(left) || left <= 0) return base;
  /* "CHẬM NHẤT" chứ không phải "sau đúng": mốc là cận TRÊN do nơi gửi khai, và
     job xong sớm thì khoá nhả sớm. Nói cận trên mà máy hết bận sớm hơn là chuyện
     tốt; nói một con số chính xác rồi vượt qua nó mới là nói dối. */
  return `${base} Khoá tự hết chậm nhất sau ${Math.ceil(left / 1000)} giây.`;
}

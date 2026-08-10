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
  busy: { label: "AutoCAD đang bận", short: "bận" },
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

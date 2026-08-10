/** Bộ glyph của shell — sinh từ `mau-thiet-ke/js/app.js` @ 82f5232.
 *
 * Chép tay 27 đường path SVG là 27 cơ hội sai một toạ độ mà không ai phát hiện
 * cho tới khi nhìn thấy icon méo. File này được sinh ra, và khi mẫu đổi thì
 * sinh lại chứ không sửa tay.
 *
 * Mọi glyph vẽ trên lưới 24, nét `currentColor`, không tô — nên chúng thừa
 * hưởng màu chữ của chỗ đặt và tự đúng trong cả hai theme.
 */
export const ICONS = {
  sidebar: "<rect x=\"3\" y=\"5\" width=\"18\" height=\"14\" rx=\"2\"/><path d=\"M10 5v14\"/>",
  home: "<path d=\"M4 10.5 12 4l8 6.5V19a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z\"/>",
  plan: "<path d=\"M3 5h18v14H3z\"/><path d=\"M3 10h6v9M15 5v9h6\"/>",
  info: "<circle cx=\"12\" cy=\"12\" r=\"8.5\"/><path d=\"M12 11v5.5M12 7.8v.6\"/>",
  chat: "<path d=\"M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4z\"/><path d=\"M8 9h8M8 12h5\"/>",
  changes: "<path d=\"M4 7h9M4 7 7 4M4 7l3 3\"/><path d=\"M20 17h-9m9 0-3-3m3 3-3 3\"/>",
  check: "<path d=\"M4 5h16v14H4z\"/><path d=\"m8 12 3 3 5-6\"/>",
  takeoff: "<path d=\"M4 4h16v16H4z\"/><path d=\"M4 9h16M9 9v11M14 9v11\"/>",
  publish: "<path d=\"M7 9V4h10v5\"/><path d=\"M5 9h14a2 2 0 0 1 2 2v5h-4v4H7v-4H3v-5a2 2 0 0 1 2-2z\"/>",
  batch: "<path d=\"M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z\"/><path d=\"M8 13h8\"/>",
  library: "<path d=\"M4 4h6v16H4zM14 4h6v6h-6zM14 14h6v6h-6z\"/>",
  lisp: "<path d=\"m9 8-4 4 4 4M15 8l4 4-4 4\"/>",
  ruler: "<path d=\"m3 15 6-6 6 6-6 6z\" transform=\"translate(1 -3)\"/><path d=\"M13 5h8v8\"/>",
  sync: "<path d=\"M20 12a8 8 0 1 1-2.4-5.7\"/><path d=\"M20 4v5h-5\"/>",
  gear: "<circle cx=\"12\" cy=\"12\" r=\"3\"/><path d=\"M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6l1.4 1.4m10 10 1.4 1.4m0-12.8-1.4 1.4m-10 10L5.6 18.4\"/>",
  search: "<circle cx=\"11\" cy=\"11\" r=\"6\"/><path d=\"m20 20-3.5-3.5\"/>",
  plus: "<path d=\"M12 5v14M5 12h14\"/>",
  tick: "<path d=\"m5 12 5 5L19 7\"/>",
  close: "<path d=\"m6 6 12 12M18 6 6 18\"/>",
  chevron: "<path d=\"m9 6 6 6-6 6\"/>",
  activity: "<path d=\"M3 12h4l2.5-6 4 12L16 12h5\"/>",
  alert: "<path d=\"M12 4.5 21 19H3z\"/><path d=\"M12 10v4m0 2.2v.4\"/>",
  zoomin: "<circle cx=\"11\" cy=\"11\" r=\"6\"/><path d=\"M11 9v4M9 11h4M20 20l-3.5-3.5\"/>",
  zoomout: "<circle cx=\"11\" cy=\"11\" r=\"6\"/><path d=\"M9 11h4M20 20l-3.5-3.5\"/>",
  fit: "<path d=\"M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5\"/>",
  hand: "<path d=\"M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V12m0-1a1.5 1.5 0 0 1 3 0v5a5 5 0 0 1-5 5h-1.5a5 5 0 0 1-4.4-2.6L6 15a1.6 1.6 0 0 1 2.6-1.8L9 14\"/>",
  external: "<path d=\"M14 4h6v6\"/><path d=\"M20 4 11 13\"/><path d=\"M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5\"/>",
} as const;

export type IconName = keyof typeof ICONS;

export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: ICONS[name] }}
    />
  );
}

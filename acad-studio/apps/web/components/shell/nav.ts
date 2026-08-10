/** Điều hướng của shell — sinh từ NAV và COMMANDS của
 * `mau-thiet-ke/js/app.js` @ 82f5232, đổi `*.html` sang route thật.
 *
 * Nhóm theo VIỆC người dùng đang làm, không theo endpoint nào phục vụ nó.
 * "Thay đổi" đứng đầu nhóm Quy trình vì mọi lệnh ghi trong sản phẩm đều đi qua
 * đó.
 *
 * `built` nghĩa là **route tồn tại và điều hướng tới được** — kể cả khi trang
 * đó mới chỉ nói "màn hình chưa được dựng". Mục chưa có route hiện dạng vô hiệu
 * hoá kèm lý do: bấm vào một mục rồi không thấy gì xảy ra luôn bị hiểu là app
 * hỏng, chứ không phải tính năng chưa làm.
 */
import type { IconName } from "../ui/icons";

export type NavItem = {
  id: string;
  href: string;
  icon: IconName;
  label: string;
  /** Mục này mang huy hiệu số thao tác chờ duyệt. */
  staged?: boolean;
  /** Màn hình đã dựng chưa. Xem ROADMAP.md để biết giai đoạn nào dựng gì. */
  built: boolean;
};

export type NavGroup = { group: string; items: NavItem[] };

/** Route đã tồn tại. Thêm vào đây trong CÙNG commit với việc tạo route —
 * danh sách này lệch là rail nói dối. */
const BUILT = new Set<string>([
  "/changes", "/drawing-info", "/library/blocks", "/library/lisp", "/workspace",
]);

export const NAV: NavGroup[] = [
  {
    group: "Bản vẽ",
    items: [
      { id: "home", href: "/", icon: "home", label: "Tổng quan", built: BUILT.has("/") },
      { id: "workspace", href: "/workspace", icon: "plan", label: "Khung bản vẽ", built: BUILT.has("/workspace") },
      { id: "info", href: "/drawing-info", icon: "info", label: "Thông tin bản vẽ", built: BUILT.has("/drawing-info") },
      { id: "assistant", href: "/assistant", icon: "chat", label: "Trợ lý AI", built: BUILT.has("/assistant") },
    ],
  },
  {
    group: "Quy trình",
    items: [
      { id: "changes", href: "/changes", icon: "changes", label: "Thay đổi", staged: true, built: BUILT.has("/changes") },
      { id: "review", href: "/review", icon: "check", label: "Kiểm tra", built: BUILT.has("/review") },
      { id: "takeoff", href: "/takeoff", icon: "takeoff", label: "Bóc tách", built: BUILT.has("/takeoff") },
      { id: "publish", href: "/publish", icon: "publish", label: "Xuất bản PDF", built: BUILT.has("/publish") },
    ],
  },
  {
    group: "Hàng loạt",
    items: [
      { id: "batch", href: "/batch", icon: "batch", label: "Xử lý thư mục", built: BUILT.has("/batch") },
    ],
  },
  {
    group: "Tài nguyên",
    items: [
      { id: "blocks", href: "/library/blocks", icon: "library", label: "Thư viện block", built: BUILT.has("/library/blocks") },
      { id: "lisp", href: "/library/lisp", icon: "lisp", label: "Thư viện LISP", built: BUILT.has("/library/lisp") },
      { id: "standards", href: "/standards", icon: "ruler", label: "Hồ sơ tiêu chuẩn", built: BUILT.has("/standards") },
    ],
  },
  {
    group: "Hệ thống",
    items: [
      { id: "settings", href: "/settings", icon: "gear", label: "Kết nối AutoCAD", built: BUILT.has("/settings") },
      { id: "cadweb", href: "/cadweb", icon: "sync", label: "Đồng bộ CadWeb", built: BUILT.has("/cadweb") },
    ],
  },
];

export type Command = {
  label: string;
  /** Mã ngắn hiện bên phải, để người dùng nhớ mặt lệnh. */
  cmd: string;
  href?: string;
  /** Lệnh mở nhật ký hoạt động thay vì điều hướng. */
  drawer?: boolean;
};

/** Bảng lệnh ⌘K chỉ điều hướng và CHUẨN BỊ. Không lệnh nào ghi thẳng vào bản
 * vẽ — một lệnh ghi luôn phải dừng ở Thay đổi chờ duyệt trước. */
export const COMMANDS: Command[] = [
  { label: "Tổng quan", cmd: "HOME", href: "/" },
  { label: "Khung bản vẽ", cmd: "WORKSPACE", href: "/workspace" },
  { label: "Thông tin bản vẽ hiện hành", cmd: "DWGINFO", href: "/drawing-info" },
  { label: "Thay đổi chờ duyệt", cmd: "CHANGES", href: "/changes" },
  { label: "Hỏi trợ lý AI về bản vẽ này", cmd: "ASK", href: "/assistant" },
  { label: "Quét tiêu chuẩn bản vẽ hiện hành", cmd: "SCAN", href: "/review" },
  { label: "Bóc tách khối lượng (livebom)", cmd: "TAKEOFF", href: "/takeoff" },
  { label: "Xuất bản PDF", cmd: "PLOT", href: "/publish" },
  { label: "Xử lý hàng loạt thư mục", cmd: "BATCH", href: "/batch" },
  { label: "Thư viện block", cmd: "BLOCKS", href: "/library/blocks" },
  { label: "Thư viện script LISP", cmd: "LISP", href: "/library/lisp" },
  { label: "Hồ sơ tiêu chuẩn", cmd: "PROFILES", href: "/standards" },
  { label: "Nhật ký hoạt động", cmd: "LOG", drawer: true },
  { label: "Kết nối AutoCAD & chẩn đoán", cmd: "HEALTH", href: "/settings" },
  { label: "Đồng bộ CadWeb", cmd: "CADWEB", href: "/cadweb" },
];

/** Route đã tồn tại chưa. Mọi chỗ trong shell dẫn người dùng đi đâu đó — rail,
 * bảng lệnh, pill kết nối, chip thay đổi — đều phải hỏi hàm này. Một liên kết
 * dẫn tới 404 tệ hơn hẳn một liên kết mờ đi kèm lý do. */
export function isRouteBuilt(href: string): boolean {
  return BUILT.has(href);
}

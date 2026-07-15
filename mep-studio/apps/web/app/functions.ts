// Catalog chức năng MEP hiển thị thành nút bấm trong UI.
// Mỗi chức năng gọi POST /api/acad/mep/<endpoint> (hoặc /api/acad/<endpoint>).
export type Field = {
  name: string;
  label: string;
  type: "text" | "number" | "select" | "dir" | "file" | "textarea";
  default?: string;
  options?: string[];
  placeholder?: string;
};
export type Fn = {
  id: string;
  label: string;
  group: string;
  icon: string;
  desc: string;
  endpoint: string; // dưới /api/acad/mep/  (hoặc recipe cho /preview khi preview=true)
  fields: Field[];
  result: "table" | "index" | "text" | "files";
  modifies?: boolean;
  preview?: boolean; // dùng luồng session→preview→accept/reject thay vì ghi thẳng
  live?: boolean;    // sinh job LISP để vẽ THẲNG vào AutoCAD đang mở (gõ MEP-RUN)
  liveRecipe?: string; // recipe /api/acad/live tương ứng (mặc định "drawpipes")
  native?: boolean;    // vẽ qua /api/acad/native (plugin C++ thuần) thay vì job LISP
};

const DEFAULT_DIR = "/Users/khanhnm/Desktop/tool-autocad/As-built drawing";
const SAMPLE = DEFAULT_DIR + "/ABD_He thong thong hoi tang 8_04052026_V.00.dwg";
const dirField: Field = { name: "dir", label: "Thư mục bản vẽ", type: "dir", default: DEFAULT_DIR };
const fileField: Field = { name: "file", label: "File bản vẽ (.dwg)", type: "text", default: SAMPLE };
const outField: Field = { name: "outDir", label: "Thư mục xuất", type: "text", default: "/tmp/mep-out" };

export const FUNCTIONS: Fn[] = [
  // ─── Vẽ & hỗ trợ (có XEM TRƯỚC + chấp nhận/bỏ) ───
  { id: "drawpipes", label: "Vẽ ống từ toạ độ", group: "Vẽ & hỗ trợ", icon: "📐",
    desc: "Vẽ ống theo bảng toạ độ — preview trực tiếp trên AutoCAD (layer MEP-PREVIEW), chỉ commit khi Chấp nhận.",
    endpoint: "drawpipes", result: "files", modifies: true, preview: true,
    fields: [fileField, { name: "pipes", label: "Bảng ống (mỗi dòng 1 tuyến)", type: "textarea",
      placeholder: "thoatxi 90 0,0 5000,0 5000,3000\nthonghoi 60 0,500 4000,500" }] },
  { id: "tagpipes", label: "Gắn nhãn ống (hệ + DN)", group: "Vẽ & hỗ trợ", icon: "🏷",
    desc: "Ghi nhãn 'HỆ DNxx' tại giữa mỗi ống — xem trước rồi áp dụng.",
    endpoint: "tagpipes", fields: [fileField], result: "files", modifies: true, preview: true },
  { id: "numberpipes", label: "Đánh số ống", group: "Vẽ & hỗ trợ", icon: "🔢",
    desc: "Đánh số tuần tự theo hệ (SX-01…) + XDATA + nhãn — xem trước rồi áp dụng.",
    endpoint: "numberpipes", fields: [fileField], result: "files", modifies: true, preview: true },
  { id: "stdlayers", label: "Tạo layer chuẩn MEP", group: "Vẽ & hỗ trợ", icon: "🗂",
    desc: "Tạo 6 layer chuẩn đúng màu — xem trước rồi áp dụng.",
    endpoint: "stdlayers", fields: [fileField], result: "files", modifies: true, preview: true },
  { id: "livedraw", label: "Vẽ ống LIVE (AutoCAD đang mở)", group: "Vẽ & hỗ trợ", icon: "🖊",
    desc: "Vẽ polyline + gắn DN/hệ (XDATA) THẲNG vào bản vẽ đang mở bằng C++ native — nhanh, chính xác, không cần MEP-RUN.",
    endpoint: "livedraw", liveRecipe: "drawpipes", native: true, result: "text", live: true,
    fields: [{ name: "pipes", label: "Bảng ống (mỗi dòng 1 tuyến)", type: "textarea",
      placeholder: "thoatxi 90 0,0 5000,0 5000,3000\nthonghoi 60 0,500 4000,500" }] },
  { id: "copyfloor", label: "Copy tầng điển hình", group: "Vẽ & hỗ trợ", icon: "🏢",
    desc: "Copy toàn bộ đối tượng MEP (layer P-*/DCCD*/MEP*) sang vị trí mới, lặp N lần — dựng nhanh các tầng.",
    endpoint: "copyfloor", liveRecipe: "copyfloor", result: "text", live: true,
    fields: [
      { name: "dx", label: "Lệch X mỗi tầng (mm)", type: "text", default: "0" },
      { name: "dy", label: "Lệch Y mỗi tầng (mm)", type: "text", default: "10000" },
      { name: "times", label: "Số tầng copy", type: "text", default: "3" }] },
  { id: "tagmeta", label: "Gắn metadata (hệ/DN/vật liệu)", group: "Vẽ & hỗ trợ", icon: "🏷",
    desc: "Gắn dữ liệu MEP (XDATA) vào các đối tượng ĐANG CHỌN trong AutoCAD — để bóc khối lượng/truy vết 2 chiều.",
    endpoint: "tagmeta", liveRecipe: "tagmeta", result: "text", live: true,
    fields: [
      { name: "sys", label: "Hệ thống", type: "select", default: "thoatxi", options: ["thoatxi", "thoatrua", "thonghoi", "capnuoc"] },
      { name: "dn", label: "Đường kính DN", type: "text", placeholder: "vd 90" },
      { name: "mat", label: "Vật liệu", type: "select", default: "uPVC", options: ["uPVC", "PPR", "PVC", "Thép", "Đồng"] }] },

  // ─── Tính toán & bóc tách ───
  { id: "bompipe2", label: "Bóc BOM ống (theo DN)", group: "Tính toán", icon: "📏",
    desc: "Chiều dài ống (m) theo hệ thống × đường kính DN (từ MLINE), tự tính cung.",
    endpoint: "bompipe2", fields: [dirField], result: "table" },
  { id: "bomfit", label: "Bóc BOM phụ kiện", group: "Tính toán", icon: "🔩",
    desc: "Đếm phụ kiện theo tên block (top-level; BOM đầy đủ nested đang hoàn thiện).",
    endpoint: "bomfit", fields: [dirField], result: "table" },
  { id: "stats", label: "Thống kê bản vẽ", group: "Tính toán", icon: "📊",
    desc: "Đếm entity theo loại (line, text, dim, block…).",
    endpoint: "stats", fields: [dirField], result: "table" },

  // ─── Quản lý & xuất bản ───
  { id: "titlerows", label: "Mục lục bản vẽ", group: "Quản lý", icon: "📑",
    desc: "Đọc khung tên cả bộ (đúng cả file nhiều khung tên) → bảng mã hiệu, tên, ngày, người vẽ.",
    endpoint: "titlerows", fields: [dirField], result: "table" },
  { id: "layers", label: "Danh sách layer", group: "Quản lý", icon: "🗂",
    desc: "Liệt kê layer + màu + trạng thái mỗi file.",
    endpoint: "layers", fields: [dirField], result: "table" },
  { id: "qa", label: "Dọn & sửa lỗi (QA)", group: "Quản lý", icon: "🧹",
    desc: "AUDIT + PURGE + OVERKILL → giảm mạnh dung lượng, lưu bản mới.",
    endpoint: "qa", fields: [dirField, outField], result: "files", modifies: true },
  { id: "titlefix", label: "Sửa khung tên hàng loạt", group: "Quản lý", icon: "✏️",
    desc: "Điền/sửa mã hiệu (KHBV), ngày… cho cả bộ, lưu bản mới.",
    endpoint: "titlefix", fields: [dirField, outField,
      { name: "KHBV", label: "Mã hiệu (KHBV)", type: "text", placeholder: "vd ME-TH-T08" },
      { name: "DD/MM/YYYY", label: "Ngày", type: "text", placeholder: "vd 11/07/2026" }],
    result: "files", modifies: true },
  { id: "convert", label: "Đổi version DWG", group: "Quản lý", icon: "🔁",
    desc: "Lưu cả bộ về version DWG khác (cho CAD cũ).",
    endpoint: "convert", fields: [dirField, outField,
      { name: "version", label: "Version", type: "select", default: "2013", options: ["2010", "2013", "2018"] }],
    result: "files", modifies: true },
  { id: "dxfout", label: "Xuất DXF", group: "Quản lý", icon: "📤",
    desc: "Xuất DXF cả bộ (cầu nối xử lý offline).",
    endpoint: "dxfout", fields: [dirField, outField], result: "files", modifies: true },
];

export const GROUPS = [...new Set(FUNCTIONS.map((f) => f.group))];
export const byId = (id: string) => FUNCTIONS.find((f) => f.id === id);

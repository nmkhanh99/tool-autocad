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
  menu?: boolean;      // false = giữ action cho tương thích nhưng không hiện trong menu chính
};

const DEFAULT_DIR = "/Users/khanhnm/Desktop/tool-autocad/As-built drawing";
const SAMPLE = DEFAULT_DIR + "/ABD_He thong thong hoi tang 8_04052026_V.00.dwg";
const dirField: Field = { name: "dir", label: "Thư mục bản vẽ", type: "dir", default: DEFAULT_DIR };
const fileField: Field = { name: "file", label: "File bản vẽ (.dwg)", type: "text", default: SAMPLE };
const outField: Field = { name: "outDir", label: "Thư mục xuất", type: "text", default: "/tmp/mep-out" };

export const FUNCTIONS: Fn[] = [
  // ─── Thiết kế & dữ liệu MEP ───
  { id: "drawpipes", label: "Vẽ ống theo tọa độ", group: "Thiết kế & dữ liệu MEP", icon: "📐",
    desc: "Nhập bảng tuyến ống, xem trước trong AutoCAD và chỉ ghi khi Chấp nhận.",
    endpoint: "drawpipes", result: "files", modifies: true, preview: true,
    fields: [fileField, { name: "pipes", label: "Bảng ống (mỗi dòng 1 tuyến)", type: "textarea",
      placeholder: "thoatxi 90 0,0 5000,0 5000,3000\nthonghoi 60 0,500 4000,500" }] },
  { id: "copyfloor", label: "Sao chép tầng điển hình", group: "Thiết kế & dữ liệu MEP", icon: "🏢",
    desc: "Sao chép đối tượng MEP sang vị trí mới và lặp theo số tầng.",
    endpoint: "copyfloor", liveRecipe: "copyfloor", result: "text", live: true,
    fields: [
      { name: "dx", label: "Lệch X mỗi tầng (mm)", type: "text", default: "0" },
      { name: "dy", label: "Lệch Y mỗi tầng (mm)", type: "text", default: "10000" },
      { name: "times", label: "Số tầng copy", type: "text", default: "3" }] },

  // Hai action MLINE cũ được giữ cho API tương thích, nhưng không còn là workflow chính.
  { id: "tagpipes", label: "Gắn nhãn hệ + DN", group: "Dữ liệu & ký hiệu", icon: "🏷",
    desc: "Ghi nhãn “HỆ DNxx” tại giữa mỗi ống, xem trước rồi áp dụng.",
    endpoint: "tagpipes", fields: [fileField], result: "files", modifies: true, preview: true, menu: false },
  { id: "numberpipes", label: "Đánh số tuyến ống", group: "Dữ liệu & ký hiệu", icon: "🔢",
    desc: "Đánh số tuần tự theo hệ, đồng thời gắn XDATA và nhãn.",
    endpoint: "numberpipes", fields: [fileField], result: "files", modifies: true, preview: true, menu: false },
  { id: "tagmeta", label: "Gắn thông tin MEP", group: "Thiết kế & dữ liệu MEP", icon: "🔖",
    desc: "Gắn hệ, DN và vật liệu vào các đối tượng đang chọn trong AutoCAD.",
    endpoint: "tagmeta", liveRecipe: "tagmeta", result: "text", live: true,
    fields: [
      { name: "sys", label: "Hệ thống", type: "select", default: "thoatxi", options: ["thoatxi", "thoatrua", "thonghoi", "capnuoc"] },
      { name: "dn", label: "Đường kính DN", type: "text", placeholder: "vd 90" },
      { name: "mat", label: "Vật liệu", type: "select", default: "uPVC", options: ["uPVC", "PPR", "PVC", "Thép", "Đồng"] }] },

  // ─── Bóc tách & thống kê ───
  { id: "bompipe2", label: "Bóc khối lượng ống — cả bộ", group: "Bóc tách & thống kê", icon: "📏",
    desc: "Tổng hợp chiều dài theo hệ và DN trong cả thư mục; bản vẽ được giả định dùng mm.",
    endpoint: "bompipe2", fields: [dirField], result: "table" },
  { id: "bomfit", label: "Thống kê block — cả bộ", group: "Bóc tách & thống kê", icon: "🔩",
    desc: "Đếm block cấp ngoài theo tên trong cả thư mục; chưa phân loại BOM phụ kiện lồng nhau.",
    endpoint: "bomfit", fields: [dirField], result: "table" },
  { id: "stats", label: "Thống kê entity — cả bộ", group: "Bóc tách & thống kê", icon: "📊",
    desc: "Đếm line, text, dim, block và các loại đối tượng theo từng file.",
    endpoint: "stats", fields: [dirField], result: "table" },

  // ─── Hồ sơ & QA ───
  { id: "titlerows", label: "Mục lục bản vẽ — cả bộ", group: "Hồ sơ & QA", icon: "📑",
    desc: "Đọc các khung tên để lập bảng mã hiệu, tên, ngày và người vẽ.",
    endpoint: "titlerows", fields: [dirField], result: "table" },
  { id: "titlefix", label: "Sửa khung tên — cả bộ", group: "Hồ sơ & QA", icon: "✏️",
    desc: "Điền mã hiệu, ngày và thuộc tính khung tên cho cả bộ, lưu sang thư mục mới.",
    endpoint: "titlefix", fields: [dirField, outField,
      { name: "KHBV", label: "Mã hiệu (KHBV)", type: "text", placeholder: "vd ME-TH-T08" },
      { name: "DD/MM/YYYY", label: "Ngày", type: "text", placeholder: "vd 11/07/2026" }],
    result: "files", modifies: true },
  { id: "qa", label: "Kiểm tra & dọn bản vẽ", group: "Hồ sơ & QA", icon: "🧹",
    desc: "Chạy AUDIT, PURGE và OVERKILL cho cả bộ, lưu sang thư mục mới.",
    endpoint: "qa", fields: [dirField, outField], result: "files", modifies: true },

  // ─── Xuất & tương thích ───
  { id: "convert", label: "Lưu về phiên bản DWG", group: "Xuất & tương thích", icon: "🔁",
    desc: "Lưu cả bộ về phiên bản DWG tương thích với AutoCAD cũ.",
    endpoint: "convert", fields: [dirField, outField,
      { name: "version", label: "Version", type: "select", default: "2013", options: ["2010", "2013", "2018"] }],
    result: "files", modifies: true },
  { id: "dxfout", label: "Xuất DXF — cả bộ", group: "Xuất & tương thích", icon: "📤",
    desc: "Xuất toàn bộ DWG sang DXF trong thư mục đích.",
    endpoint: "dxfout", fields: [dirField, outField], result: "files", modifies: true },

  // Các action dưới đây vẫn được luồng chat/API dùng nhưng đã có nơi thay thế rõ hơn trong UI.
  { id: "stdlayers", label: "Tạo layer chuẩn MEP", group: "Thiết lập", icon: "🗂",
    desc: "Preset layer MEP cũ; dùng Chuẩn hóa → Layer cho cấu hình mới.",
    endpoint: "stdlayers", fields: [fileField], result: "files", modifies: true, preview: true, menu: false },
  { id: "livedraw", label: "Vẽ ống trực tiếp", group: "Thiết kế & dữ liệu MEP", icon: "🖊",
    desc: "Ghi trực tiếp bằng C++ native, không qua bước xem trước.",
    endpoint: "livedraw", liveRecipe: "drawpipes", native: true, result: "text", live: true, menu: false,
    fields: [{ name: "pipes", label: "Bảng ống (mỗi dòng 1 tuyến)", type: "textarea",
      placeholder: "thoatxi 90 0,0 5000,0 5000,3000\nthonghoi 60 0,500 4000,500" }] },
  { id: "layers", label: "Kiểm kê layer — cả bộ", group: "Bóc tách & thống kê", icon: "🗂",
    desc: "Liệt kê tên, màu và trạng thái layer theo từng file trong thư mục.",
    endpoint: "layers", fields: [dirField], result: "table" },
];

export const MENU_FUNCTIONS = FUNCTIONS.filter((f) => f.menu !== false);
export const GROUPS = [...new Set(MENU_FUNCTIONS.map((f) => f.group))];
export const byId = (id: string) => FUNCTIONS.find((f) => f.id === id);

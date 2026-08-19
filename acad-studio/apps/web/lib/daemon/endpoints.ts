/** Mọi đường dẫn API của daemon, khai đúng một chỗ.
 *
 * Hôm nay `app/page.tsx` legacy còn 32 đường dẫn rải rác trong thân hàm. Đổi
 * một endpoint nghĩa là grep cả repo và hy vọng không sót. Code mới trong
 * `features/` và `components/` bị `scripts/check-import-boundaries.mjs` cấm
 * chứa chuỗi "/api/" — nó phải đi qua đây.
 */

/** Địa chỉ daemon, khai ĐÚNG MỘT LẦN cho toàn app.
 *
 * `scripts/package.mjs` set biến này lúc build bản đóng gói. Đặt tên khác ở một
 * màn hình nào đó nghĩa là màn hình đó trỏ sai địa chỉ trong bản đóng gói mà
 * mọi thứ khác vẫn chạy — kiểu lỗi chỉ lộ ra sau khi giao hàng.
 */
export const DAEMON_BASE = process.env.NEXT_PUBLIC_DAEMON_URL || "http://127.0.0.1:8788";

/** Daemon base có thể đến từ env hoặc từ props, có hoặc không có dấu / cuối. */
function trim(base: string): string {
  return base.replace(/\/+$/, "");
}

export const endpoints = {
  /** Chuẩn bị một thao tác ghi. Trả về operation chờ xác nhận, chưa chạm bản vẽ. */
  selectionPrepare: (base: string) => `${trim(base)}/api/acad/selection/prepare`,

  /** Liệt kê thao tác đã chuẩn bị. Trục xoay của màn "Thay đổi chờ duyệt".
   *
   * Hàng chờ sống trong BỘ NHỚ của daemon: khởi động lại daemon là mất sạch, và
   * không có thao tác nào được ghi. Đó là hành vi đúng — nhưng màn hình phải nói
   * ra, vì người dùng không có cách nào đoán được điều đó. */
  selectionOperations: (base: string) => `${trim(base)}/api/acad/selection/operations`,

  /** Xác nhận và ghi. One-shot: hỏng thì phải chuẩn bị lại, không retry cùng id. */
  selectionOperationApply: (base: string, id: string) =>
    `${trim(base)}/api/acad/selection/operations/${encodeURIComponent(id)}/apply`,

  /** Bỏ thao tác đã chuẩn bị. Best-effort — không có nó thì op cũng tự hết hạn. */
  selectionOperationReject: (base: string, id: string) =>
    `${trim(base)}/api/acad/selection/operations/${encodeURIComponent(id)}/reject`,

  /** Đích của bộ vẽ (`/draw/stage`). **Tách khỏi bản vẽ đang hoạt động** của
   * AutoCAD: kích hoạt một bản vẽ KHÔNG tự đổi đích này, nên sau mỗi lượt
   * `activate-document` phải đặt lại nó — nếu không, lệnh vẽ tiếp theo ghi vào
   * bản vẽ cũ hoặc vào tệp `.work` mặc định. */
  drawTarget: (base: string) => `${trim(base)}/api/acad/draw/target`,

  /** Hàng chờ của BỘ VẼ — hoàn toàn tách khỏi hàng chờ `/selection/operations`
   * mà màn hình `/changes` bày ra. Cần đọc được vì `POST /draw/target` **huỷ**
   * mọi bản xem trước còn `staged` trước khi đổi đích: một lượt xác nhận
   * `activate-document` ở `/changes` do đó xoá luôn hình đang chờ trong AutoCAD,
   * ở một hàng chờ màn hình đó không hề hiện. */
  drawOps: (base: string) => `${trim(base)}/api/acad/draw/ops`,

  /** Bản vẽ AutoCAD ĐANG MỞ. Không phải danh sách tệp mở gần đây. */
  docs: (base: string) => `${trim(base)}/api/acad/docs`,
  /** Bảng màu ACI 256 mã, lấy từ chính AutoCAD. Tĩnh trong cả phiên. */
  aciPalette: (base: string) => `${trim(base)}/api/acad/aci-palette`,

  /** SSE sự kiện reactor từ plugin. Chỉ `features/acad-connection/events.ts`
   * được mở kết nối này — xem lý do ở đó. */
  acadEvents: (base: string) => `${trim(base)}/api/acad/events`,

  /** AutoCAD đã cài chưa, đang chạy chưa, có job nào đang chiếm phiên không. */
  acadStatus: (base: string) => `${trim(base)}/api/acad/status`,

  /** Danh mục block: định nghĩa trong thư viện + đối chiếu với bản vẽ đang mở. */
  blocks: (base: string) => `${trim(base)}/api/acad/blocks`,
  /** Thư mục nguồn mà thư viện quét để tìm định nghĩa block. */
  blockSources: (base: string) => `${trim(base)}/api/acad/blocks/sources`,
  /** Lệnh GHI của thư viện block. Một pha: gọi là AutoCAD làm ngay, không có
   * bước chuẩn bị và không đi qua hàng chờ Thay đổi. */
  blockAction: (base: string, action: "insert" | "sync") =>
    `${trim(base)}/api/acad/blocks/${action}`,
  /** Sửa metadata một định nghĩa. Ghi vào THƯ VIỆN, không vào bản vẽ. */
  block: (base: string, id: string) =>
    `${trim(base)}/api/acad/blocks/${encodeURIComponent(id)}`,
  /** Tạo định nghĩa từ bộ chọn đang có trong AutoCAD. Ghi vào CẢ HAI: chạy
   * `-BLOCK` trên bản vẽ rồi lưu định nghĩa vào thư viện. */
  blockCreate: (base: string) => `${trim(base)}/api/acad/blocks/create`,

  /** Danh mục AutoLISP: tài nguyên + thư mục gốc + số đếm. */
  lispCatalog: (base: string) => `${trim(base)}/api/acad/lisp`,
  /** Chi tiết một tài nguyên. Cần nó để lấy `manifestRevision` — danh mục không
   * trả trường đó, mà mọi lệnh ghi đều đòi nó làm `baseRevision`. */
  lispResource: (base: string, id: string) =>
    `${trim(base)}/api/acad/lisp/${encodeURIComponent(id)}`,
  /** Nạp resource vào PHIÊN AutoCAD đang chạy. Không ghi vào bản vẽ, nhưng đổi
   * support path và `TRUSTEDPATHS` của phiên, và **thực thi** mã ngay. */
  lispLoad: (base: string, id: string) =>
    `${trim(base)}/api/acad/lisp/${encodeURIComponent(id)}/load`,
  /** Xin token duyệt. Đòi chữ ký Ed25519 của app desktop; token sống 2 phút,
   * dùng một lần. */
  lispApprovalChallenge: (base: string, id: string) =>
    `${trim(base)}/api/acad/lisp/${encodeURIComponent(id)}/approval-challenge`,
  /** Ghi manifest. Khi `approved: true` thì phải kèm token ở trên. */
  lispManifest: (base: string, id: string) =>
    `${trim(base)}/api/acad/lisp/${encodeURIComponent(id)}/manifest`,
  /** Mở AutoCAD (và tuỳ chọn một bản vẽ, hoặc một bản vẽ trống mới).
   *
   * Không ghi vào bản vẽ nào — nhưng nó KHỞI CHẠY một ứng dụng, nên vẫn là
   * hành động có hệ quả nhìn thấy được. */
  acadOpen: (base: string) => `${trim(base)}/api/acad/open`,

  /** Danh sách hồ sơ quy tắc. GET đọc, POST tạo. */
  standardsProfiles: (base: string) => `${trim(base)}/api/acad/standards/profiles`,

  /** Sửa một hồ sơ. Mỗi lần ghi là tăng `revision`, và **mọi lượt quét gắn với
   * revision cũ lập tức hết giá trị** — `/standards/apply` trả 409. Đó là ràng
   * buộc nối `/standards` với `/review`; xem `profileDriftNote()`. */
  standardsProfile: (base: string, id: string) =>
    `${trim(base)}/api/acad/standards/profiles/${encodeURIComponent(id)}`,

  /** Quét bản vẽ theo một hồ sơ. Trả `scanId` + `profileRevision` — cả hai đều
   * cần cho lượt sửa sau đó. Phiên quét HẾT HẠN được. */
  standardsScan: (base: string) => `${trim(base)}/api/acad/standards/scan`,

  /** Sửa các phát hiện đã chọn.
   *
   * **Ghi MỘT PHA.** Khác `/selection/prepare`, endpoint này dispatch LISP
   * thẳng vào AutoCAD: không có bước chuẩn bị, không có id để huỷ, và app không
   * hoàn tác được. Xác nhận là ghi. */
  standardsApply: (base: string) => `${trim(base)}/api/acad/standards/apply`,

  /** Hồ sơ đầy đủ của bản vẽ đang mở: bảng layer/block/layout/style, biến hệ
   * thống, từ điển, xref, khung bao.
   *
   * Lượt đọc **nặng nhất** của app — 350 KB trên bản vẽ as-built của dự án, và
   * nó quét toàn bộ bảng ký hiệu. Đừng gọi theo nhịp. */
  drawingInfo: (base: string) => `${trim(base)}/api/acad/drawing-info`,

  /** Hình học của bản vẽ đang mở — toạ độ thật, đọc trực tiếp từ plugin.
   *
   * Đây là một lượt QUÉT trên main thread của AutoCAD, không phải một endpoint
   * rẻ: bản vẽ lớn làm AutoCAD đứng hình trong lúc chạy. Đừng gọi theo nhịp,
   * đừng gọi trong `useEffect` phụ thuộc thứ hay đổi. Chỉ gọi khi người dùng
   * yêu cầu, hoặc đúng một lần lúc mở màn hình.
   *
   * `space` và `layer` **không được chứa `=` hay xuống dòng** — request đi qua
   * một tệp nhiều dòng dạng `key=value`; daemon trả 400 nếu vi phạm. */
  geometry: (base: string, query: { space?: string; layer?: string; maxEntities?: number } = {}) => {
    const params = new URLSearchParams();
    if (query.space) params.set("space", query.space);
    if (query.layer) params.set("layer", query.layer);
    if (query.maxEntities != null) params.set("maxEntities", String(query.maxEntities));
    const search = params.toString();
    return `${trim(base)}/api/acad/geometry${search ? `?${search}` : ""}`;
  },

  /** Thư mục gốc được quản lý. */
  lispRoots: (base: string) => `${trim(base)}/api/acad/lisp/roots`,
  /** Đọc Support File Search Path của AutoCAD đang chạy rồi thêm làm thư mục gốc. */
  lispRootsImport: (base: string) => `${trim(base)}/api/acad/lisp/roots/import-autocad`,
} as const;

/** Đọc hiểu API `/api/acad/standards/*`.
 *
 * Thuần tính toán, không React, không fetch.
 *
 * ## Vì sao hai màn hình, không phải một
 *
 * `DrawingStandardsPanel` legacy gộp hai việc khác hẳn nhau vào một hộp thoại
 * 2.411 dòng: **soạn hồ sơ quy tắc** và **quét bản vẽ rồi sửa theo phát hiện**.
 * Chúng khác nhau ở thứ quan trọng nhất — cái đầu không chạm vào bản vẽ, cái
 * sau ghi thẳng và không hoàn tác được.
 *
 * ## Ràng buộc mà việc tách làm lộ ra
 *
 * Một lượt quét bị buộc vào **phiên bản hồ sơ** lúc quét: `/standards/apply` từ
 * chối với 409 nếu `profile.revision` đã đổi. Trong panel cũ ràng buộc đó ẩn đi,
 * vì nút quét bị khoá khi hồ sơ còn thay đổi chưa lưu — cùng một màn hình nên
 * không thể lệch. Tách ra thì người dùng quét ở `/review`, sang `/standards`
 * sửa một dòng, quay lại bấm sửa, và ăn một lỗi từ máy chủ.
 *
 * `profileDriftNote()` bắt đúng chuyện đó ở phía giao diện, để lỗi không phải
 * là thứ dạy người dùng bài học này.
 */

export type JsonRecord = Record<string, unknown>;

function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}
function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
function num(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
function stringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

/* ------------------------------------------------------------------ *
 * Hồ sơ quy tắc
 * ------------------------------------------------------------------ */

export type LayerRule = {
  name: string;
  color: string | number;
  linetype: string;
  lineweight: string | number;
  /** `false` chỉ khi payload nói rõ — thiếu trường thì coi là bắt buộc. */
  required: boolean;
};

export type MappingRule = {
  id: string;
  label: string;
  kind: string;
  layerPatterns: string[];
  blockPatterns: string[];
  textPatterns: string[];
  entityTypes: string[];
  required: boolean;
};

export type StandardsProfile = {
  /** Bản ghi GỐC từ máy chủ, giữ nguyên vẹn.
   *
   * Màn hình soạn hồ sơ chỉ mô hình hoá vài trường; riêng `dimension` có hơn 20
   * trường mà giao diện chưa đụng tới. Ghi đè bằng hình dạng phẳng ở dưới là
   * **xoá sạch** những gì nó không hiểu — và người dùng chỉ phát hiện ra khi
   * lượt quét sau đó bắt lỗi hàng loạt theo một quy tắc họ chưa từng đặt.
   *
   * `applyProfileEdits()` vá lên bản gốc này thay vì dựng lại từ đầu. */
  raw: JsonRecord;
  id: string;
  name: string;
  /** Phiên bản hồ sơ — **hash nội dung**, không phải bộ đếm.
   *
   * Hệ quả quan trọng: lưu một hồ sơ mà nội dung không đổi thì hash y nguyên,
   * nên lượt quét đang mở VẪN dùng được. Chỉ thay đổi thật mới giết nó. Đọc nó
   * như một con số (`Number(...)`) cho ra `NaN` và mọi phép so đều sai — đã sập
   * đúng một lần ở đây.
   *
   * Cũng là giá trị gửi trong `If-Match` khi ghi. */
  revision: string;
  /** Bộ đếm phiên bản, tăng 1 mỗi lần nội dung THẬT SỰ đổi. Dành cho con người
   * — `f304e8e7` không nói gì với ai, "phiên bản 7" thì có. Nó KHÔNG thay
   * `revision` ở vai trò chốt. `0` = máy chủ bản cũ chưa phát. */
  version: number;
  unit: string;
  insunits: number | undefined;
  precision: number | undefined;
  modelScale: number | undefined;
  paperName: string;
  paperWidth: number | undefined;
  paperHeight: number | undefined;
  dimStyleName: string;
  dimTextHeight: number | undefined;
  dimOverallScale: number | undefined;
  layers: LayerRule[];
  mappings: MappingRule[];
};

export function normalizeProfile(value: unknown): StandardsProfile {
  const source = record(value);
  const drawing = record(source.drawing);
  const paper = record(drawing.paper);
  const dimension = record(source.dimension);
  return {
    raw: source,
    id: str(source.id),
    name: str(source.name, "Hồ sơ chưa đặt tên"),
    /* Giữ NGUYÊN chuỗi. Thiếu thì để rỗng — và `profileDriftNote` im khi một vế
       rỗng, vì "không biết" không phải "đã đổi". */
    revision: str(source.revision),
    version: num(source.version) ?? 0,
    unit: str(drawing.unit),
    insunits: num(drawing.insunits),
    precision: num(drawing.precision),
    modelScale: num(drawing.modelScale),
    paperName: str(paper.name),
    paperWidth: num(paper.width),
    paperHeight: num(paper.height),
    dimStyleName: str(dimension.styleName),
    dimTextHeight: num(dimension.textHeight),
    dimOverallScale: num(dimension.overallScale),
    layers: (Array.isArray(source.layers) ? source.layers : []).map((item) => {
      const layer = record(item);
      return {
        name: str(layer.name),
        color: typeof layer.color === "number" ? layer.color : str(layer.color, "7"),
        linetype: str(layer.linetype, "Continuous"),
        lineweight: typeof layer.lineweight === "number"
          ? layer.lineweight
          : str(layer.lineweight, "Default"),
        required: layer.required !== false,
      };
    }),
    mappings: (Array.isArray(source.mappings) ? source.mappings : []).map((item, index) => {
      const mapping = record(item);
      return {
        id: str(mapping.id, `mapping-${index + 1}`),
        label: str(mapping.label),
        kind: str(mapping.kind, "object"),
        layerPatterns: stringList(mapping.layerPatterns),
        blockPatterns: stringList(mapping.blockPatterns),
        textPatterns: stringList(mapping.textPatterns),
        entityTypes: stringList(mapping.entityTypes),
        required: mapping.required === true,
      };
    }),
  };
}

/** Vá các trường đã sửa lên bản ghi GỐC, giữ nguyên mọi thứ khác.
 *
 * Đây là hàm quan trọng nhất của màn soạn hồ sơ, và lý do nó tồn tại đáng ghi
 * lại: bản nháp trong giao diện là một hình dạng **phẳng** do màn hình tự đặt
 * ra cho dễ dựng form. Máy chủ thì lưu dạng **lồng**, với `dimension` hơn 20
 * trường (fit, textVertical, arrowhead, extendBeyondDimLines…) mà form chưa
 * đụng tới.
 *
 * Gửi thẳng bản nháp đi là ghi đè cả những trường đó bằng mặc định. Không có
 * lỗi nào báo, không có test nào đỏ — và lượt quét sau đó bắt lỗi hàng loạt
 * theo một quy tắc người dùng chưa từng đặt.
 *
 * `undefined` nghĩa là **xoá ràng buộc**, nên nó được ghi thành `undefined`
 * thật chứ không bị bỏ qua: người dùng xoá trắng ô "Số lẻ" là cố ý.
 */
export function applyProfileEdits(profile: StandardsProfile): JsonRecord {
  const raw = profile.raw;
  const drawing = record(raw.drawing);
  const paper = record(drawing.paper);
  const dimension = record(raw.dimension);
  return {
    ...raw,
    id: profile.id,
    name: profile.name,
    drawing: {
      ...drawing,
      unit: profile.unit,
      insunits: profile.insunits,
      precision: profile.precision,
      modelScale: profile.modelScale,
      paper: {
        ...paper,
        name: profile.paperName,
        width: profile.paperWidth,
        height: profile.paperHeight,
      },
    },
    dimension: {
      ...dimension,
      styleName: profile.dimStyleName,
      textHeight: profile.dimTextHeight,
      overallScale: profile.dimOverallScale,
    },
    /* Layer và mapping đi NGUYÊN từ bản gốc: form chưa sửa được chúng, nên gửi
       bản đã chuẩn hoá là làm mất những trường chuẩn hoá đã bỏ đi (`bounds` của
       mapping chẳng hạn). */
    layers: raw.layers,
    mappings: raw.mappings,
  };
}

/* ------------------------------------------------------------------ *
 * Lượt quét và phát hiện
 * ------------------------------------------------------------------ */

export type Severity = "error" | "warning" | "info";

export type Issue = {
  id: string;
  scope: string;
  severity: Severity;
  message: string;
  handles: string[];
  current: unknown;
  expected: unknown;
  /** Máy chủ có gợi ý cách sửa tự động không. Không có nghĩa là mục này chỉ
   * đọc được, không sửa được bằng một cú bấm. */
  suggestedAction: unknown;
  /** Tên hành động máy chủ sẽ chạy khi sửa mục này. Rỗng = không có cách sửa
   * tự động. Cần lộ ra vì vài hành động đòi thêm tham số giao diện chưa hỏi
   * được — xem `unsupportedFixReason()`. */
  action: string;
};

export type Scan = {
  scanId: string;
  target: string;
  profileId: string;
  /** Phiên bản hồ sơ LÚC QUÉT — hash, không phải số. Đây là thứ máy chủ so khi
   * áp dụng, và lệch là 409. */
  profileRevision: string;
  scannedAt: string;
  issues: Issue[];
};

/** Chuẩn hoá mức độ. Máy chủ dùng nhiều tên cho cùng một mức, và gộp sai thì
 * bộ lọc "Lỗi" bỏ sót đúng những mục nghiêm trọng nhất. */
export function severityOf(value: unknown): Severity {
  const raw = str(value).toLowerCase();
  if (raw === "error" || raw === "critical" || raw === "fatal") return "error";
  if (raw === "info" || raw === "hint" || raw === "suggestion") return "info";
  return "warning";
}

export function severityLabel(severity: Severity): string {
  if (severity === "error") return "Lỗi";
  if (severity === "info") return "Gợi ý";
  return "Cảnh báo";
}

export function normalizeIssue(value: unknown, index: number): Issue {
  const issue = record(value);
  return {
    id: str(issue.id, `issue-${index + 1}`),
    scope: str(issue.scope, "drawing"),
    severity: severityOf(issue.severity),
    message: str(issue.message, "Sai khác so với hồ sơ quy tắc"),
    handles: stringList(issue.handles),
    current: issue.current,
    expected: issue.expected,
    suggestedAction: issue.suggestedAction,
    action: typeof issue.suggestedAction === "string"
      ? issue.suggestedAction
      : str(record(issue.suggestedAction).action),
  };
}

/** Những hành động `/standards/apply` THẬT SỰ chạy được.
 *
 * Danh sách CHO PHÉP, không phải danh sách cấm. Máy chủ bỏ qua mọi hành động
 * ngoài danh sách này (`skippedIssueIds`) và trả 400 nếu không còn gì để chạy.
 * Viết theo kiểu cấm thì mỗi hành động mới máy chủ thêm vào sẽ mặc định được
 * coi là sửa được — và người dùng phát hiện ra bằng một lỗi 400.
 *
 * Đối chiếu với `drawingStandards.ts`: đây là đúng năm nhánh nó dựng chương
 * trình LISP.
 */
const FIXABLE_ACTIONS: readonly string[] = [
  "apply-units", "sync-layers", "apply-dimstyle", "dimspace", "resize-frame",
];

/** Vì sao mục này CHƯA sửa được từ màn hình — hoặc rỗng nếu sửa được.
 *
 * Để người dùng tích rồi ăn 400 là bắt họ trả giá cho thứ màn hình biết trước.
 * Tệ hơn: trộn một mục không sửa được vào một lô sửa được thì máy chủ **im lặng
 * bỏ qua** nó và trả về `skippedIssueIds` — người dùng tưởng đã sửa xong.
 */
export function unsupportedFixReason(issue: Issue): string {
  if (issue.action === "dimspace") {
    /* `dimspace` có trong danh sách máy chủ chạy được, nhưng nó đòi
       `dimBaseHandle` — một DIM làm chuẩn để những cái khác căn theo — mà màn
       hình chưa có chỗ hỏi. Thiếu là 400. */
    return "Căn hàng dimension cần chọn một DIM làm chuẩn — màn hình này chưa "
      + "hỏi được, dùng màn hình cũ.";
  }
  if (!FIXABLE_ACTIONS.includes(issue.action)) {
    return "Mục này chỉ để xem — máy chủ chưa có cách sửa tự động.";
  }
  return "";
}

export function normalizeScan(value: unknown, fallbackTarget: string): Scan {
  const body = record(value);
  return {
    scanId: str(body.scanId),
    target: str(body.target, fallbackTarget),
    profileId: str(body.profileId),
    profileRevision: str(body.profileRevision),
    scannedAt: str(body.scannedAt),
    issues: (Array.isArray(body.issues) ? body.issues : []).map(normalizeIssue),
  };
}

/** Đếm theo mức độ, cho thanh lọc. */
export function severityCounts(issues: readonly Issue[]): {
  all: number; error: number; warning: number; info: number;
} {
  return {
    all: issues.length,
    error: issues.filter((issue) => issue.severity === "error").length,
    warning: issues.filter((issue) => issue.severity === "warning").length,
    info: issues.filter((issue) => issue.severity === "info").length,
  };
}

/** Lọc theo mức độ và từ khoá. So chữ thường theo `vi` — mô tả phát hiện là
 * tiếng Việt có dấu, và `toLowerCase()` mặc định không khớp cách người dùng gõ. */
export function filterIssues(
  issues: readonly Issue[],
  severity: Severity | "all",
  query: string,
): Issue[] {
  const needle = query.trim().toLocaleLowerCase("vi");
  return issues.filter((issue) => {
    if (severity !== "all" && issue.severity !== severity) return false;
    if (!needle) return true;
    return `${issue.id} ${issue.scope} ${issue.message}`
      .toLocaleLowerCase("vi").includes(needle);
  });
}

/* ------------------------------------------------------------------ *
 * Lý do chặn
 * ------------------------------------------------------------------ */

/** Vì sao chưa quét được — hoặc rỗng nếu quét được. */
export function scanBlockedReason(input: {
  target: string;
  /** Bản vẽ AutoCAD đang hoạt động. */
  activeTarget: string;
  profileId: string;
  docsAlive: boolean;
  busy: boolean;
}): string {
  if (!input.docsAlive) return "Plugin AcadBridge chưa phản hồi.";
  if (!input.target) return "Chưa chọn bản vẽ để quét.";
  /* Quét một bản vẽ KHÔNG hoạt động sẽ làm daemon kích hoạt nó — tức đổi tab
     AutoCAD sau lưng người dùng, và họ chỉ biết khi ngẩng lên thấy bản vẽ khác.
     Đổi tab là việc của họ, không phải của một nút "Quét". */
  if (input.target !== input.activeTarget) {
    return "Chỉ quét được bản vẽ đang mở trong AutoCAD. Chuyển sang tab bản vẽ "
      + "đó rồi quét.";
  }
  if (!input.profileId) return "Chưa chọn hồ sơ quy tắc.";
  if (input.busy) return "Đang quét…";
  return "";
}

/** Hồ sơ đã đổi kể từ lượt quét chưa — hoặc rỗng nếu chưa.
 *
 * Đây là ràng buộc mà việc tách hai màn hình làm lộ ra. `/standards/apply` so
 * `profile.revision` với `session.profileRevision` và trả 409 khi lệch. Panel
 * cũ không bao giờ gặp vì nó khoá nút quét khi hồ sơ còn thay đổi chưa lưu —
 * hai việc ở chung một chỗ nên không thể lệch.
 *
 * `profile` là `null` khi màn hình chưa đọc được danh sách hồ sơ: lúc đó **không
 * kết luận**, vì "chưa biết" không phải "đã đổi".
 */
export function profileDriftNote(
  scan: Scan | null,
  profile: StandardsProfile | null,
): string {
  if (!scan || !profile) return "";
  if (scan.profileId !== profile.id) {
    return "Hồ sơ đang chọn không phải hồ sơ đã dùng để quét. Quét lại trước khi sửa.";
  }
  /* Một vế rỗng = không biết. Không kết luận: cảnh báo sai ở đây khoá mất nút
     sửa, mà người dùng không có cách nào gỡ ngoài việc quét lại vô ích. */
  if (!scan.profileRevision || !profile.revision) return "";
  if (scan.profileRevision === profile.revision) return "";
  return "Nội dung hồ sơ quy tắc đã đổi sau lượt quét này, nên các phát hiện "
    + "bên dưới không còn khớp. Quét lại trước khi sửa.";
}

/** Vì sao chưa áp dụng được tập đã chọn — hoặc rỗng nếu áp dụng được. */
export function applyBlockedReason(input: {
  scan: Scan | null;
  /** Bản vẽ AutoCAD ĐANG hoạt động. */
  activeTarget: string;
  /** Bản vẽ đang chọn trên màn hình. Lượt sửa gửi đi CHỈ có `scanId`, nên máy
   * chủ dùng đích đã lưu trong phiên quét — không phải đích đang hiện. Quét bản
   * vẽ A rồi đổi ô chọn sang B mà vẫn bấm sửa là ghi vào A trong khi màn hình
   * nói B. */
  target: string;
  selected: number;
  driftNote: string;
  drawingChanged: boolean;
  busy: boolean;
}): string {
  if (!input.scan?.scanId) return "Chưa có lượt quét nào.";
  if (input.target && input.scan.target && input.target !== input.scan.target) {
    return "Lượt quét này thuộc một bản vẽ khác bản vẽ đang chọn. Quét lại.";
  }
  /* Bản vẽ đã quét phải ĐANG HOẠT ĐỘNG trong AutoCAD. Lượt sửa gửi đi chỉ có
     `scanId`, và `/standards/apply` dispatch một job KHÔNG read-only — nó sẽ tự
     kích hoạt bản vẽ đã lưu trong phiên quét rồi ghi vào đó. Người dùng đang
     nhìn bản vẽ B mà AutoCAD nhảy về A và sửa A. */
  if (!input.activeTarget) {
    /* KHÔNG biết bản vẽ nào đang hoạt động thì không được ghi. Cho qua ở đây là
       để máy chủ tự kích hoạt bản vẽ đã lưu trong phiên quét — đúng thứ chốt
       này sinh ra để chặn. */
    return "Chưa biết AutoCAD đang mở bản vẽ nào. Đọc lại danh sách bản vẽ rồi thử lại.";
  }
  if (input.scan.target && input.activeTarget !== input.scan.target) {
    return "AutoCAD đang mở một bản vẽ khác. Chuyển về đúng bản vẽ đã quét, "
      + "hoặc quét lại bản vẽ đang mở.";
  }
  if (input.driftNote) return input.driftNote;
  if (input.drawingChanged) {
    return "Bản vẽ đã thay đổi sau lượt quét này. Quét lại trước khi sửa.";
  }
  if (!input.selected) return "Chưa chọn phát hiện nào.";
  if (input.busy) return "Đang gửi lệnh sửa…";
  return "";
}

/** Câu mô tả những gì sắp bị ghi, dùng cho thẻ xác nhận.
 *
 * Nói rõ **một pha**: `/standards/apply` dispatch LISP thẳng vào AutoCAD, không
 * đi qua hàng chờ hai pha của `/selection/prepare`. Không có bước nào sau khi
 * bấm, và app không hoàn tác được.
 */
export function applySummary(issues: readonly Issue[]): string {
  if (!issues.length) return "";
  const handles = new Set<string>();
  for (const issue of issues) for (const handle of issue.handles) handles.add(handle);

  /* Ba hành động này đổi thứ áp cho CẢ BẢN VẼ, không chỉ những đối tượng được
     liệt kê: `apply-units` đặt lại biến đơn vị, `apply-dimstyle` chạy
     `configureDimensionExpression` trên toàn bộ dimstyle, `sync-layers` sửa
     bảng layer. Đếm riêng số đối tượng là **nói ít hơn sự thật** ở đúng chỗ
     người dùng đọc để quyết định có bấm một lệnh không hoàn tác được hay không. */
  const wide = new Set(issues.map((issue) => issue.action)
    .filter((action) => ["apply-units", "apply-dimstyle", "sync-layers"].includes(action)));

  const parts: string[] = [];
  if (handles.size) parts.push(`${handles.size} đối tượng`);
  if (wide.has("apply-units")) parts.push("đơn vị của cả bản vẽ");
  if (wide.has("apply-dimstyle")) parts.push("kiểu kích thước dùng chung");
  if (wide.has("sync-layers")) parts.push("bảng layer");
  if (!parts.length) parts.push("các thiết lập bản vẽ");

  return `Sửa ${issues.length} phát hiện, chạm tới ${parts.join(" · ")}.`;
}

/** Vì sao chưa lưu được hồ sơ — hoặc rỗng nếu lưu được.
 *
 * Các trường số của hồ sơ là **BẮT BUỘC**: `sanitizeDrawing`/`sanitizeDimension`
 * gọi `numberValue()`, và hàm đó trả lỗi 400 cho bất cứ thứ gì không phải số
 * hữu hạn. Tôi từng viết trên giao diện rằng "ô trống = không ràng buộc" — điều
 * đó SAI, và người dùng chỉ phát hiện ra bằng một lỗi 400 sau khi đã gõ xong cả
 * form.
 */
export function profileSaveBlockedReason(profile: StandardsProfile): string {
  /* Khoảng giá trị lấy đúng từ `sanitizeDrawing`/`sanitizePaper`/
     `sanitizeDimension` của daemon. Lệch khỏi nó là hứa một thứ máy chủ sẽ từ
     chối — hoặc chặn một thứ nó chấp nhận. */
  const numbers = [
    { label: "INSUNITS", value: profile.insunits, min: 0, max: 24, integer: true },
    { label: "Số lẻ", value: profile.precision, min: 0, max: 8, integer: true },
    { label: "Tỷ lệ model", value: profile.modelScale, min: 0.000001, max: 1_000_000_000 },
    /* Khổ giấy: `sanitizePaper` đòi >= 0.001, KHÔNG phải 0.000001 như các
       trường khác. Đoán một khoảng "hợp lý" thay vì đọc mã daemon là cách sinh
       ra hai loại lỗi cùng lúc: chặn hồ sơ máy chủ chấp nhận, và cho qua hồ sơ
       máy chủ từ chối. */
    { label: "Rộng khổ", value: profile.paperWidth, min: 0.001, max: 1_000_000 },
    { label: "Cao khổ", value: profile.paperHeight, min: 0.001, max: 1_000_000 },
    /* Cao chữ cho phép 0 — dimstyle annotative lấy chiều cao từ style. */
    { label: "Cao chữ", value: profile.dimTextHeight, min: 0, max: 1_000_000 },
    { label: "Tỷ lệ tổng", value: profile.dimOverallScale, min: 0.000001, max: 1_000_000_000 },
  ] as const;

  const missing = numbers.filter((f) => f.value === undefined).map((f) => f.label);
  if (missing.length) {
    return `Máy chủ đòi số cho mọi ô này, không nhận ô trống: ${missing.join(", ")}.`;
  }
  for (const field of numbers) {
    const value = field.value as number;
    if ("integer" in field && field.integer && !Number.isInteger(value)) {
      return `${field.label} phải là số nguyên.`;
    }
    if (value < field.min) return `${field.label} phải lớn hơn hoặc bằng ${field.min}.`;
    if ("max" in field && field.max !== undefined && value > field.max) {
      return `${field.label} phải nhỏ hơn hoặc bằng ${field.max}.`;
    }
  }

  /* Trường chuỗi cũng bắt buộc — `stringValue()` của daemon từ chối chuỗi rỗng
     y như `numberValue()` từ chối `undefined`. */
  const texts = [
    ["Tên hồ sơ", profile.name],
    ["Đơn vị", profile.unit],
    ["Tên khổ", profile.paperName],
    ["Tên dimstyle", profile.dimStyleName],
  ] as const;
  const blank = texts.filter(([, value]) => !value.trim()).map(([label]) => label);
  if (blank.length) return `Không được để trống: ${blank.join(", ")}.`;
  return "";
}

/** Đích thao tác: ĐƯỜNG DẪN TỆP, không phải tiêu đề — hai bản vẽ cùng tên mở
 * cùng lúc là chuyện thường trong một bộ hồ sơ. */
export function targetOf(doc: { file?: string; title?: string }): string {
  return (doc.file || "").trim() || (doc.title || "").trim();
}

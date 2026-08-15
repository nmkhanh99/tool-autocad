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
/** Đọc một số, hoặc `undefined` khi **không có số nào ở đó**.
 *
 * `Number()` trần biến `null`, `""`, `"  "`, `[]` và `false` thành `0` — một số
 * hữu hạn, không phân biệt được với số 0 người dùng thật sự đặt. Trong đợt này
 * riêng cái bẫy đó gây ra BA lỗi: `maxArea: ""` lọc sạch mọi đối tượng, một cạnh
 * chỉ có dấu cách thành giới hạn 0, và `row: null` (chính là `NaN` của máy chủ
 * sau khi qua JSON) thành một DIM nằm ở gốc toạ độ.
 *
 * Nên chỉ có MỘT hàm đọc số trong tệp này. Ba lần cùng một hình dạng nghĩa là
 * chỗ hỏng không phải từng chỗ gọi. */
function num(value: unknown): number | undefined {
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "number" && typeof value !== "string") return undefined;
  if (typeof value === "string" && value.trim() === "") return undefined;
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
  /** `id` LÚC NẠP VỀ, để `applyProfileEdits()` tìm lại bản ghi gốc.
   *
   * Không có nó thì sửa `id` — kể cả chỉ để chữa một lỗi gõ — làm phép tìm theo
   * id mới trượt, và `bounds` của quy tắc đó biến mất không một lời báo. Rỗng =
   * dòng mới thêm ở giao diện, chưa có bản ghi gốc nào để giữ. */
  sourceId: string;
  label: string;
  kind: string;
  layerPatterns: string[];
  blockPatterns: string[];
  textPatterns: string[];
  entityTypes: string[];
  required: boolean;
  /** Giới hạn nhận diện, giữ **nguyên dạng thô**.
   *
   * Không mô hình hoá thành các trường phẳng: daemon nhận `bounds` là một object
   * JSON bất kỳ (`sanitizeJson`, không kiểm từng khoá), nên một hồ sơ có thể mang
   * khoá mà giao diện chưa biết. Dựng lại từ hình dạng phẳng là **xoá** chúng —
   * đúng lỗi đã xảy ra với 20 trường `dimension` và hai trường `drawing`.
   * Các hàm `readRegionBounds`/`readAreaBounds`/`writeBounds` đọc và ghi có chọn
   * lọc, phần còn lại đi qua nguyên vẹn. */
  bounds?: JsonRecord;
};

/** Bốn số của **giới hạn vùng**, đọc từ mọi cách viết mà máy chủ chấp nhận.
 *
 * `mappingBounds()` của engine nhận ba tên cho mỗi cạnh (`minX`/`xMin`/`left`…)
 * **và** dạng mảng `min[0]`/`max[1]`. Chỉ đọc `minX` là một hồ sơ viết theo cách
 * khác sẽ hiện ra ô trống, rồi người dùng gõ đè lên và tưởng mình vừa đặt mới. */
export function readRegionBounds(bounds: unknown): {
  minX?: number; minY?: number; maxX?: number; maxY?: number;
} {
  const raw = rawRegionBounds(bounds);
  return {
    minX: num(raw.minX),
    minY: num(raw.minY),
    maxX: num(raw.maxX),
    maxY: num(raw.maxY),
  };
}

/** Cùng bốn cạnh, nhưng **chưa phân tích** — kèm tên khoá thật đã tra ra.
 *
 * Ô nhập phải hiển thị THỨ ĐANG LƯU chứ không phải thứ đã qua `Number()`: nếu
 * cha trả về giá trị đã phân tích, thì lúc người dùng xoá `-1` để gõ lại, ký tự
 * `-` đầu tiên phân tích ra `undefined`, giá trị ngoài thành rỗng, và ô tự xoá
 * ngay trước phím kế — **không gõ được số âm** trừ khi dán.
 *
 * Trả cả `key` vì lỗi phải chỉ đúng khoá người dùng sẽ thấy trong hồ sơ: báo
 * "minX" cho một hồ sơ viết `left` là chỉ sai chỗ. */
export function rawRegionBounds(bounds: unknown): {
  minX?: unknown; minY?: unknown; maxX?: unknown; maxY?: unknown;
  keys: Partial<Record<"minX" | "minY" | "maxX" | "maxY", string>>;
} {
  const source = record(bounds);
  const min = Array.isArray(source.min) ? source.min : [];
  const max = Array.isArray(source.max) ? source.max : [];
  const keys: Record<string, string> = {};
  /* Cùng thứ tự tra của `mappingBounds()` bên engine, kể cả các góc tối của nó.
     `firstValue()` lấy khoá ĐẦU TIÊN CÓ MẶT, không phải khoá đầu tiên đọc ra số:
     `{minX: "abc", xMin: 5}` ở engine là **tắt lọc**, không phải dùng `5`. Rồi
     `?? min[0]` mới lùi về dạng mảng khi giá trị vừa tra là `null`.
     Một hàm tra DUY NHẤT cho cả hiển thị, phép đếm và phép kiểm: ba bản chép tay
     sẽ lệch nhau, và bản kiểm lệch là một giới hạn hỏng lọt qua nút Lưu. */
  const pick = (canonical: string, names: string[], fallback: unknown, fallbackKey: string) => {
    let chosen: unknown;
    let chosenKey = "";
    for (const name of names) {
      if (source[name] === undefined) continue;
      chosen = source[name];
      chosenKey = name;
      break;
    }
    if (chosen === null || chosen === undefined) {
      if (fallback !== undefined) {
        keys[canonical] = fallbackKey;
        return fallback;
      }
    }
    if (chosenKey) keys[canonical] = chosenKey;
    return chosen;
  };
  return {
    minX: pick("minX", ["minX", "xMin", "left"], min[0], "min[0]"),
    minY: pick("minY", ["minY", "yMin", "bottom"], min[1], "min[1]"),
    maxX: pick("maxX", ["maxX", "xMax", "right"], max[0], "max[0]"),
    maxY: pick("maxY", ["maxY", "yMax", "top"], max[1], "max[1]"),
    keys,
  };
}

/** Đơn vị diện tích daemon THẬT SỰ quy đổi. Mọi giá trị khác = đơn vị bản vẽ. */
export const AREA_UNITS: readonly { value: string; label: string }[] = [
  { value: "drawing-unit2", label: "đơn vị bản vẽ²" },
  { value: "m2", label: "m²" },
  { value: "cm2", label: "cm²" },
  { value: "mm2", label: "mm²" },
];

/** Cách viết khác mà daemon cũng quy đổi, quy về đúng một giá trị của ô chọn.
 *
 * `filterObjectsByMappingBounds()` nhận CẢ `m²` lẫn `m2` (và hai đơn vị kia).
 * Chỉ nhận dạng ASCII là một hồ sơ viết `m²` hiện lên ô chọn thành "đơn vị bản
 * vẽ²", trong khi máy chủ vẫn đang quy đổi theo mét — người dùng chỉnh ngưỡng
 * trên một tỉ lệ khác hẳn tỉ lệ đang chạy, và màn hình không hé một lời. */
const AREA_UNIT_ALIASES: Record<string, string> = {
  "m²": "m2", "cm²": "cm2", "mm²": "mm2",
};

/** Hai số và đơn vị của **giới hạn diện tích**. */
export function readAreaBounds(bounds: unknown): {
  minArea?: number; maxArea?: number; areaUnit: string;
} {
  const source = record(bounds);
  const raw = String(source.areaUnit ?? "").trim().toLowerCase();
  const unit = AREA_UNIT_ALIASES[raw] ?? raw;
  return {
    /* Cùng lý do như giới hạn vùng: daemon làm `Number(bounds.minArea)`, nên
       chuỗi số vẫn là một bộ lọc đang chạy. */
    minArea: num(source.minArea),
    maxArea: num(source.maxArea),
    /* Daemon so bằng chuỗi đã hạ thấp và chỉ hiểu bốn dạng; thứ khác rơi về đơn
       vị bản vẽ. Chuẩn hoá ở đây để ô chọn không bao giờ hiện một giá trị mà
       máy chủ sẽ lặng lẽ bỏ qua. */
    areaUnit: AREA_UNITS.some((item) => item.value === unit) ? unit : "drawing-unit2",
  };
}

/** Ô nhập có phải nạp lại từ giá trị ngoài không.
 *
 * Ô giữ NGUYÊN VĂN thứ đang gõ, nên nó phải phân biệt "giá trị thật đổi" với
 * "văn bản của tôi vừa được cha phân tích rồi trả về". Với ô SỐ, `"2."` và `"2"`
 * là cùng một giá trị — nạp lại là xoá dấu chấm ngay khi vừa gõ, và không cách
 * nào nhập `2.5`. Với ô CHỮ thì không: `"2."` và `"2"` là hai chuỗi khác nhau,
 * và bỏ qua chênh lệch đó là giữ nguyên văn bản CŨ sau khi đã đổi hồ sơ — rồi
 * một lần sửa sẽ ghi giá trị của hồ sơ cũ sang hồ sơ mới.
 *
 * Tách khỏi component vì đây là chỗ đã hỏng hai lần; trong component thì không
 * khoá được bằng test.
 */
export function shouldSyncField(text: string, shown: string, numeric: boolean): boolean {
  if (shown === text) return false;
  if (!numeric) return true;
  const typed = Number(text);
  const outer = Number(shown);
  const same = text.trim() !== "" && shown !== ""
    && Number.isFinite(typed) && Number.isFinite(outer) && typed === outer;
  return !same;
}

/** Khoá `bounds` mà **không ai đọc**, theo đúng thứ tự xuất hiện.
 *
 * `width`/`height`/`tolerancePercent`/`unit` có trong hồ sơ mặc định ở ánh xạ
 * `drawing-frame`, nên gần như hồ sơ nào cũng mang chúng — nhưng không một dòng
 * mã nào đọc tới. Việc so khung với khổ giấy lấy số từ `drawing.paper`.
 */
const DEAD_BOUNDS_KEYS = ["width", "height", "tolerancePercent", "unit"];
export function deadBoundsKeys(bounds: unknown): string[] {
  const source = record(bounds);
  return DEAD_BOUNDS_KEYS.filter((key) => source[key] !== undefined);
}

/** Ghi đè một nhóm khoá, GIỮ mọi khoá khác.
 *
 * `undefined` = xoá khoá đó. Ghi khoá chuẩn thì cũng dọn luôn các tên đồng nghĩa
 * và dạng mảng: để lại chúng là hồ sơ mang hai nguồn sự thật cho cùng một cạnh,
 * và người sửa sau sẽ không biết cái nào đang có tác dụng.
 */
export function writeBounds(
  bounds: unknown,
  patch: Record<string, number | string | undefined>,
): JsonRecord | undefined {
  const next: JsonRecord = { ...record(bounds) };
  const ALIASES: Record<string, string[]> = {
    minX: ["xMin", "left"], minY: ["yMin", "bottom"],
    maxX: ["xMax", "right"], maxY: ["yMax", "top"],
  };
  for (const [key, value] of Object.entries(patch)) {
    /* Chuỗi TOÀN KHOẢNG TRẮNG bị xoá như chuỗi rỗng. Giữ lại là ghi xuống hồ sơ
       một giá trị mà chính giao diện đọc là "không đặt" — rồi `Number("  ")` cho
       ra `0`, và cạnh đó thành một giới hạn bằng 0 đang chạy thật trong AutoCAD.
       Không ghi thứ mình đọc ngược với người sẽ dùng nó. */
    if (value === undefined || (typeof value === "string" && value.trim() === "")) {
      delete next[key];
    } else next[key] = value;
    for (const alias of ALIASES[key] ?? []) delete next[alias];
  }
  /* Chạm vào MỘT cạnh thì phải chuyển NỐT ba cạnh kia sang khoá chuẩn trước khi
     bỏ dạng mảng. Xoá `min`/`max` mà không chép sang là còn lại một hình chữ
     nhật THIẾU SỐ — và thiếu một số thì `acadstd:map-in-bounds-p` bỏ lọc HOÀN
     TOÀN. Người dùng sửa một cạnh và vô tình tắt cả bộ lọc, không một lời báo. */
  if (Object.keys(patch).some((key) => key in ALIASES)) {
    const before = readRegionBounds(bounds);
    for (const key of ["minX", "minY", "maxX", "maxY"] as const) {
      if (key in patch) continue;
      /* `== null`, KHÔNG `=== undefined`. Một hồ sơ viết `{minX: null, min: [1,2]}`
         có `minX` đang thật sự bằng `1` — engine làm `firstValue(...) ?? min[0]`,
         nên `null` rơi xuống dạng mảng. Bỏ qua vì "khoá đã có mặt" là để lại
         `minX: null` sau khi xoá mảng, tức cạnh đó biến mất và giới hạn vùng
         TẮT HOÀN TOÀN — đúng cái mà cả đoạn migrate này sinh ra để tránh. */
      if (next[key] == null && before[key] !== undefined) next[key] = before[key];
    }
    delete next.min;
    delete next.max;
  }
  return Object.keys(next).length ? next : undefined;
}



/** Ba giá trị bề dày nét mang ý nghĩa thay vì con số. Lưu dạng **chuỗi**.
 *
 * `standardLineweight()` của daemon chỉ nhận số trong `0…2.11`, nên gửi −3/−1/−2
 * (mã DXF của chính ba thứ này) là ăn 400 ngay lúc lưu. Việc đổi sang mã âm là
 * của `lineweight()` ở bước áp dụng, không phải của kho hồ sơ. */
export const LINEWEIGHT_NAMES = ["Default", "ByLayer", "ByBlock"] as const;

/** Bề dày nét cho một layer, đúng dạng daemon lưu.
 *
 * Đơn vị là **milimét** (`0…2.11`), KHÔNG phải mã 1/100 mm của DXF. Nhầm hai
 * thang này là mọi giá trị từ 0.05 trở lên bị máy chủ từ chối — và tôi đã nhầm
 * đúng một lần ở đây. Bước áp dụng nhân 100 để ra group 370. */
export const LINEWEIGHTS: readonly { value: string | number; label: string }[] = [
  ...LINEWEIGHT_NAMES.map((value) => ({ value: value as string | number, label: value })),
  ...[0, 0.05, 0.09, 0.13, 0.15, 0.18, 0.2, 0.25, 0.3, 0.35, 0.4, 0.5, 0.53, 0.6,
    0.7, 0.8, 0.9, 1, 1.06, 1.2, 1.4, 1.58, 2, 2.11].map((value) => ({
    value: value as string | number,
    label: `${value.toFixed(2)} mm`,
  })),
];

/** Bảng màu ACI có TÊN — bảy màu đầu là quy ước chung của AutoCAD, và người
 * dùng gọi chúng bằng tên chứ không bằng số. */
/** Bảng màu ACI đọc từ máy chủ: 256 mục, chỉ số = chỉ số ACI.
 *
 * Mục `0` luôn rỗng — ByBlock không phải một màu. `256` (ByLayer) không có trong
 * bảng vì cùng lý do.
 */
export type AciPalette = readonly string[];

/** Bảng màu hợp lệ, hoặc `null` nếu payload không dùng được.
 *
 * Kiểm TỪNG mục chứ không chỉ kiểm mảng. Một mục hỏng lọt qua sẽ thành một ô màu
 * SAI cạnh tên layer — mà người dùng dựa vào đúng ô đó để tìm nhầm lẫn, nên sai
 * còn tệ hơn để trống. Đây cũng là lý do cả tính năng này tồn tại: lấy bảng thật
 * từ AutoCAD thay vì đoán bằng công thức.
 */
export function readAciPalette(body: unknown): AciPalette | null {
  const colors = record(body).colors;
  if (!Array.isArray(colors) || colors.length !== 256) return null;
  const ok = colors.every((value, index) =>
    typeof value === "string"
    && (index === 0 ? value === "" : /^#[0-9a-f]{6}$/i.test(value)));
  return ok ? (colors as string[]) : null;
}

/** Chín màu ACI có quy ước cố định — đường lùi khi chưa có bảng từ AutoCAD. */
const ACI_FALLBACK: Record<number, string> = {
  1: "#FF0000", 2: "#FFFF00", 3: "#00FF00", 4: "#00FFFF",
  5: "#0000FF", 6: "#FF00FF", 7: "#FFFFFF", 8: "#808080", 9: "#C0C0C0",
};

/** Mã màu của một chỉ số ACI, hoặc `null` nếu không biết chắc.
 *
 * `null` là câu trả lời thật khi chưa có bảng từ AutoCAD và chỉ số nằm ngoài
 * 1–9: giao diện hiện số thay vì bịa màu.
 *
 * `0` (ByBlock) và `256` (ByLayer) không có màu — chúng là chỉ dẫn kế thừa, và
 * một layer thì không kế thừa màu từ chính nó.
 */
export function aciHex(value: number, palette?: AciPalette | null): string | null {
  if (!Number.isInteger(value) || value < 1 || value > 255) return null;
  const fromPalette = palette?.[value];
  return fromPalette || ACI_FALLBACK[value] || null;
}

export const ACI_NAMED: readonly { value: number; label: string }[] = [
  { value: 1, label: "Đỏ" }, { value: 2, label: "Vàng" }, { value: 3, label: "Lục" },
  { value: 4, label: "Lơ" }, { value: 5, label: "Lam" }, { value: 6, label: "Tím" },
  { value: 7, label: "Trắng/Đen" }, { value: 8, label: "Xám đậm" }, { value: 9, label: "Xám nhạt" },
];

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
  /** Kiểu ghi số dài của AutoCAD (LUNITS). `linearFormat()` của daemon hiểu năm
   * TÊN (`Decimal`, `Scientific`, `Engineering`, `Architectural`, `Fractional`)
   * hoặc số 1–5. Trường này panel cũ sửa được còn màn mới thì không — nó chỉ
   * sống sót nhờ phép vá, và người dùng không biết nó tồn tại. */
  linearFormat: string;
  precision: number | undefined;
  modelScale: number | undefined;
  paperName: string;
  paperWidth: number | undefined;
  paperHeight: number | undefined;
  /** Dung sai khi so khung tên với khổ giấy, theo phần trăm (`0…100`). Lượt quét
   * dùng nó để quyết một khung lệch bao nhiêu thì bị báo lỗi. */
  frameTolerancePercent: number | undefined;
  dimStyleName: string;
  dimTextHeight: number | undefined;
  dimOverallScale: number | undefined;
  layers: LayerRule[];
  mappings: MappingRule[];
  /** Những trường `dimension` mà form KHÔNG có ô riêng — 20 trong 23 trường.
   *
   * Lộ ra thay vì giấu: giấu chúng đi thì người dùng không biết chúng tồn tại,
   * và một quy tắc họ chưa từng đặt vẫn bắt lỗi bản vẽ của họ. Bảng dựng từ
   * chính dữ liệu, nên máy chủ thêm trường mới là nó tự xuất hiện — kể cả
   * trường giao diện chưa biết cách trình bày. */
  dimensionExtras: Record<string, unknown>;
};

/** Ba trường `dimension` form có ô riêng. Mọi trường khác vào bảng nâng cao. */
const DIMENSION_IN_FORM = ["styleName", "textHeight", "overallScale"] as const;

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
    linearFormat: str(drawing.linearFormat),
    insunits: num(drawing.insunits),
    precision: num(drawing.precision),
    modelScale: num(drawing.modelScale),
    paperName: str(paper.name),
    paperWidth: num(paper.width),
    paperHeight: num(paper.height),
    frameTolerancePercent: num(drawing.frameTolerancePercent),
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
    dimensionExtras: Object.fromEntries(
      Object.entries(dimension).filter(
        ([key]) => !(DIMENSION_IN_FORM as readonly string[]).includes(key),
      ),
    ),
    mappings: (Array.isArray(source.mappings) ? source.mappings : []).map((item, index) => {
      const mapping = record(item);
      return {
        id: str(mapping.id, `mapping-${index + 1}`),
        /* Id THẬT của bản ghi gốc — rỗng khi máy chủ không phát, vì lúc đó
           không có gì để tìm lại và một id bịa ra sẽ khớp nhầm bản ghi khác. */
        sourceId: str(mapping.id),
        label: str(mapping.label),
        kind: str(mapping.kind, "object"),
        layerPatterns: stringList(mapping.layerPatterns),
        blockPatterns: stringList(mapping.blockPatterns),
        textPatterns: stringList(mapping.textPatterns),
        entityTypes: stringList(mapping.entityTypes),
        required: mapping.required === true,
        /* Giữ NGUYÊN DẠNG THÔ. Bước chuẩn hoá này từng bỏ hẳn `bounds`, và
           `applyProfileEdits` phải cứu nó bằng cách vá lên bản ghi gốc. Nay nó
           sửa được nên phải đi vào bản nháp — nhưng vẫn ở dạng thô, để khoá nào
           giao diện chưa biết cũng không bị bước này ăn mất. */
        ...(record(item).bounds === undefined
          ? {}
          : { bounds: record(record(item).bounds) }),
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
      linearFormat: profile.linearFormat,
      insunits: profile.insunits,
      precision: profile.precision,
      modelScale: profile.modelScale,
      frameTolerancePercent: profile.frameTolerancePercent,
      paper: {
        ...paper,
        name: profile.paperName,
        width: profile.paperWidth,
        height: profile.paperHeight,
      },
    },
    dimension: {
      ...dimension,
      /* Trường nâng cao ghi ĐÈ lên bản gốc — người dùng sửa được chúng qua bảng
         key-value. Trải sau `...dimension` để giá trị đã sửa thắng. */
      ...profile.dimensionExtras,
      styleName: profile.dimStyleName,
      textHeight: profile.dimTextHeight,
      overallScale: profile.dimOverallScale,
    },
    layers: profile.layers.map((layer) => ({
      name: layer.name,
      color: layer.color,
      linetype: layer.linetype,
      lineweight: layer.lineweight,
      required: layer.required,
    })),
    /* Mapping GHÉP lên bản ghi gốc, không dựng lại từ đầu: bước chuẩn hoá bỏ
       mất `bounds` (khung giới hạn diện tích), và dựng lại là xoá nó.
       Tìm theo `sourceId` chứ KHÔNG theo `id` đang hiện — người dùng sửa được ô
       id, và tìm theo giá trị mới thì vừa chữa một lỗi gõ là mất `bounds`. */
    mappings: profile.mappings.map((mapping) => {
      const original = mapping.sourceId
        ? (Array.isArray(raw.mappings) ? raw.mappings : [])
          .map(record)
          .find((item) => str(item.id) === mapping.sourceId) ?? {}
        : {};
      const merged: JsonRecord = {
        ...original,
        id: mapping.id,
        label: mapping.label,
        kind: mapping.kind,
        layerPatterns: mapping.layerPatterns,
        blockPatterns: mapping.blockPatterns,
        textPatterns: mapping.textPatterns,
        entityTypes: mapping.entityTypes,
        required: mapping.required,
        /* `bounds` nay SỬA ĐƯỢC nên phải ghi từ bản nháp, không để `...original`
           quyết. Nhưng `undefined` là "không có giới hạn nào" chứ không phải
           "giữ nguyên bản cũ" — nên phải XOÁ khoá khỏi bản ghi, chứ gán
           `undefined` thì `JSON.stringify` bỏ trường và máy chủ giữ giá trị cũ,
           tức người dùng xoá hết ô mà giới hạn vẫn còn nguyên. */
        ...(mapping.bounds === undefined ? {} : { bounds: mapping.bounds }),
      };
      if (mapping.bounds === undefined) delete (merged as JsonRecord).bounds;
      return merged;
    }),
  };
}

/** Giới hạn độ dài của từng trường chữ, lấy đúng từ `stringValue(..., {maxLength})`
 * của daemon. Vượt là 400 — và vì các ô này gõ tự do, dán một đoạn dài là chạm
 * tới ngay. Gom một chỗ để khi daemon đổi số thì chỉ phải sửa ở đây.
 *
 * `unit` 64 · `styleName` 255 · `profile.name` 160 — xem `standardsProfile.ts`. */
export const MAX_LENGTHS = {
  layerName: 255,
  linetype: 255,
  mappingLabel: 160,
  mappingKind: 64,
} as const;

/** Vì sao bảng layer chưa hợp lệ — theo từng dòng. Rỗng nghĩa là dòng đó ổn.
 *
 * Trả về theo CHỈ SỐ DÒNG chứ không phải một câu chung: người dùng phải biết
 * sửa ô nào, và bảng có thể dài hàng chục dòng. */
export function layerRowErrors(layers: readonly LayerRule[]): (string | null)[] {
  const seen = new Set<string>();
  return layers.map((layer) => {
    const name = layer.name.trim();
    if (!name) return "Tên layer không được để trống.";
    /* Hoa/thường theo `en-US` — ĐÚNG cái `assertUnique()` của daemon dùng. Dùng
       locale khác là mở khe cho một cặp tên mà giao diện cho qua còn máy chủ
       gọi là trùng. */
    const key = name.toLocaleUpperCase("en-US");
    if (seen.has(key)) return "Trùng tên với một layer phía trên.";
    seen.add(key);

    if (name.length > MAX_LENGTHS.layerName) {
      return `Tên layer dài quá ${MAX_LENGTHS.layerName} ký tự.`;
    }
    /* Đo trên chuỗi ĐÃ TRIM — `stringValue()` của daemon gọi `value.trim()` rồi
       mới so với `maxLength`. Đo chuỗi thô là chặn một hồ sơ máy chủ chấp nhận,
       chỉ vì một dấu cách thừa ở cuối. */
    if (String(layer.linetype).trim().length > MAX_LENGTHS.linetype) {
      return `Kiểu nét dài quá ${MAX_LENGTHS.linetype} ký tự.`;
    }

    const color = colorProblem(layer.color);
    if (color) return color;

    const weight = lineweightProblem(layer.lineweight);
    if (weight) return weight;
    return null;
  });
}

/** Màu ACI hỏng ở chỗ nào, hoặc rỗng nếu dùng được.
 *
 * Hai tầng, và **cả hai** phải qua: `standardColor()` lúc lưu nhận số `0…256`
 * hoặc bất kỳ chuỗi nào ≤64 ký tự; `numericColor()` lúc áp dụng chỉ hiểu
 * `ByLayer`/`ByBlock`/chuỗi số và **ném lỗi** cho `RGB(...)`. Chỉ kiểm tầng lưu
 * là để hồ sơ lưu êm rồi chết ở màn Kiểm tra.
 */
/** Màu thật `#RRGGBB` — đường áp dụng ghi nó thành DXF group 420.
 *
 * Đúng **6** chữ số hex. `#abc` là cú pháp CSS chứ không phải cú pháp DXF, và
 * đoán nó thành `#aabbcc` là tự chọn thay người dùng một màu họ không gõ.
 */
export function isHexColor(value: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(value.trim());
}

function colorProblem(color: string | number): string | null {
  if (typeof color === "number") {
    /* `standardColor` gọi `numberValue(..., { integer: true })`, nên số lẻ bị từ
       chối thẳng chứ không làm tròn. */
    if (!Number.isInteger(color) || color < 0 || color > 256) {
      return "Màu ACI phải là số nguyên từ 0 đến 256.";
    }
    return null;
  }
  const text = color.trim();
  if (!text) return "Màu không được để trống.";
  if (/^(bylayer|byblock)$/i.test(text)) return null;
  if (isHexColor(text)) return null;
  const parsed = Number(text);
  if (Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 0 && parsed <= 256) {
    return null;
  }
  return `Màu “${text}” lưu được nhưng lượt áp dụng không hiểu — `
    + "chỉ nhận số 0–256, #RRGGBB, ByLayer hoặc ByBlock.";
}

/** Bề dày nét hỏng ở chỗ nào, hoặc rỗng nếu dùng được.
 *
 * Chuỗi SỐ là hợp lệ, không chỉ ba cái tên: `standardLineweight()` cho chuỗi
 * qua, và `lineweight()` lúc áp dụng ép kiểu bằng `Number(value)` rồi nhận
 * khoảng `-3…211`. Chặn `"0.35"` là chặn một hồ sơ chạy được — và vì phép kiểm
 * chạy cho MỌI dòng, một hồ sơ cũ như thế sẽ không sửa được gì nữa.
 */
function lineweightProblem(weight: string | number): string | null {
  if (typeof weight === "number") {
    /* Số: `standardLineweight()` chỉ nhận `0…2.11` (milimét), KHÔNG phải mã
       1/100 mm của DXF. */
    if (!Number.isFinite(weight) || weight < 0 || weight > 2.11) {
      return "Bề dày nét phải từ 0 đến 2.11 mm.";
    }
    return null;
  }
  const text = weight.trim();
  if (!text) return "Bề dày nét không được để trống.";
  if (LINEWEIGHT_NAMES.some((name) => name.toLowerCase() === text.toLowerCase())) return null;
  const parsed = Number(text);
  if (Number.isFinite(parsed) && parsed >= -3 && parsed <= 211) return null;
  return `Bề dày “${text}” lưu được nhưng lượt áp dụng không hiểu — `
    + `chỉ nhận ${LINEWEIGHT_NAMES.join(", ")} hoặc một con số.`;
}

/** `kind` duy nhất mà chương trình LISP xử lý KHÁC đi.
 *
 * `acadstd:scan-map` chỉ rẽ nhánh trên `"ROOM"` (không phân biệt hoa thường);
 * mọi giá trị khác chạy chung một đường. Vì vậy `mẫu chữ` chỉ có tác dụng ở
 * đúng loại này — xem `mappingRowErrors()`. */
export const ROOM_KIND = "room";

/** Năm tên `linearFormat()` của daemon hiểu. Ngoài ra nó nhận số 1–5.
 *
 * `stringValue()` lúc lưu cho qua MỌI chuỗi ≤64 ký tự, nên `"6"` hay `"foo"` lưu
 * êm rồi ném lỗi ở bước `apply-units` — cùng một cái bẫy với màu `RGB(...)` và
 * bề dày dạng chữ lạ. */
export const LINEAR_FORMATS = [
  "Decimal", "Scientific", "Engineering", "Architectural", "Fractional",
] as const;

/** Vì sao bảng ánh xạ chưa hợp lệ — theo từng dòng.
 *
 * Ràng buộc lấy từ `sanitizeMapping()` + `assertUnique()` của daemon và từ
 * `acadstd:map-entity-p` trong `standards_lib.lsp`. Bỏ sót một cái là để người
 * dùng gõ xong rồi ăn 400 — hoặc tệ hơn: lưu êm rồi bóc tách sai.
 */
export function mappingRowErrors(mappings: readonly MappingRule[]): (string | null)[] {
  const seen = new Set<string>();
  return mappings.map((mapping) => {
    const id = mapping.id.trim();
    if (!id) return "Mã ánh xạ không được để trống.";
    /* Đúng `PROFILE_ID_PATTERN` của daemon: bắt đầu bằng chữ hoặc số, rồi chữ,
       số, chấm, gạch dưới, gạch ngang — tối đa 96 ký tự. */
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(id)) {
      return "Mã chỉ được gồm chữ, số, chấm, gạch dưới, gạch ngang — và phải "
        + "bắt đầu bằng chữ hoặc số.";
    }
    /* `assertUnique()` viết hoa theo `en-US` trước khi so, nên `A` và `a` là
       TRÙNG với máy chủ dù nhìn khác nhau. */
    const key = id.toLocaleUpperCase("en-US");
    if (seen.has(key)) return "Trùng mã với một ánh xạ phía trên (không phân biệt hoa thường).";
    seen.add(key);

    // `stringValue()` từ chối chuỗi rỗng y như với mọi trường chữ khác.
    if (!mapping.label.trim()) return "Nhãn không được để trống.";
    if (mapping.label.trim().length > MAX_LENGTHS.mappingLabel) {
      return `Nhãn dài quá ${MAX_LENGTHS.mappingLabel} ký tự.`;
    }
    if (!mapping.kind.trim()) return "Loại không được để trống.";

    /* Giới hạn phải là SỐ. Daemon nhận `bounds` là JSON bất kỳ nên `"abc"` lưu
       êm, rồi `finiteNumber()` trả `undefined` và bộ lọc **tắt trong im lặng** —
       người dùng thấy một giới hạn trên màn hình mà lượt quét không hề áp. Chặn
       ở nút Lưu là chỗ duy nhất còn kịp nói. */
    /* Kiểm trên giá trị ĐÃ TRA, không trên sáu khoá chuẩn ở tầng ngoài: hồ sơ
       viết `xMin`/`left` hay dạng mảng `min: [ ]` là chuyện engine chấp nhận, nên
       một giá trị hỏng ở đó cũng tắt lọc y hệt — mà phép kiểm cũ không nhìn tới
       và nút Lưu cho qua. */
    const region = rawRegionBounds(mapping.bounds);
    const areaSource = record(mapping.bounds);
    const badBound = ([
      ["minX", region.minX], ["minY", region.minY],
      ["maxX", region.maxX], ["maxY", region.maxY],
      ["minArea", areaSource.minArea], ["maxArea", areaSource.maxArea],
    ] as const).find(([, value]) => {
      if (value === undefined || value === null) return false;
      if (typeof value === "string" && value.trim() === "") return false;
      if (typeof value !== "number" && typeof value !== "string") return true;
      return !Number.isFinite(Number(value));
    });
    if (badBound) {
      /* Gọi đúng tên khoá trong hồ sơ. Báo "minX" cho một hồ sơ viết `left` là
         chỉ người dùng đi tìm một khoá không tồn tại. */
      const shown = region.keys[badBound[0] as "minX" | "minY" | "maxX" | "maxY"]
        ?? badBound[0];
      return `Giới hạn “${shown}” phải là một số — giá trị hiện tại sẽ làm bộ `
        + "lọc bị bỏ qua mà không báo gì.";
    }

    /* Cận dưới lớn hơn cận trên là một khoảng RỖNG. `acadstd:map-in-bounds-p`
       đòi cả hai bất đẳng thức, phép lọc diện tích cũng vậy — nên không đối
       tượng nào lọt qua được, và bảng bóc tách trống trơn mà không một dòng nào
       nói vì sao. Đây không phải cấu hình chặt; đây là cấu hình không dùng được. */
    const parsed = readRegionBounds(mapping.bounds);
    const area = readAreaBounds(mapping.bounds);
    const inverted = ([
      ["X", parsed.minX, parsed.maxX, region.keys.minX ?? "minX", region.keys.maxX ?? "maxX"],
      ["Y", parsed.minY, parsed.maxY, region.keys.minY ?? "minY", region.keys.maxY ?? "maxY"],
      ["diện tích", area.minArea, area.maxArea, "minArea", "maxArea"],
    ] as const).find(([, low, high]) =>
      low !== undefined && high !== undefined && low > high);
    if (inverted) {
      const [axis, low, high, lowKey, highKey] = inverted;
      return `Giới hạn ${axis} ngược nhau: “${lowKey}” (${low}) lớn hơn “${highKey}” `
        + `(${high}), nên quy tắc này sẽ không bắt được đối tượng nào.`;
    }
    /* Ô Loại vừa được mở thành gõ tự do ở lượt này, nên giới hạn 64 ký tự của
       daemon trở nên chạm tới được — dán một đoạn dài là ăn 400. */
    if (mapping.kind.trim().length > MAX_LENGTHS.mappingKind) {
      return `Loại dài quá ${MAX_LENGTHS.mappingKind} ký tự.`;
    }

    const isRoom = mapping.kind.trim().toLowerCase() === ROOM_KIND;

    /* Mẫu chữ chỉ được đọc trong `acadstd:scan-room`. Ở loại khác nó nằm im —
       để im lặng là hứa một cách khớp không tồn tại. */
    if (!isRoom && mapping.textPatterns.length) {
      return `Mẫu chữ chỉ có tác dụng với loại “${ROOM_KIND}” — ở loại `
        + `“${mapping.kind.trim()}” lượt quét bỏ qua nó.`;
    }

    /* KHÔNG xét độ rộng cho `room`: đường `scan-room` tự thu hẹp bằng cấu trúc
       — nó chỉ nhận đường bao KÍN có một dòng TEXT/MTEXT nằm trong. Một quy tắc
       room chỉ có mẫu chữ là cấu hình HỢP LỆ và thường gặp: lọc phòng theo nhãn.
       Tôi từng chặn nó vì đếm độ rộng bằng cùng một công thức cho cả hai đường.

       Đường còn lại thì khác hẳn: `acadstd:pattern-p` trả TRUE cho mẫu rỗng, và
       `map-entity-p` coi "layer rỗng VÀ block rỗng" là khớp mọi thứ. Không còn
       bộ lọc nào thì quy tắc vơ cả bản vẽ vào bảng bóc tách — im lặng, và trông
       như đã cấu hình xong. */
    if (isRoom) return null;

    const narrows = mapping.layerPatterns.length + mapping.blockPatterns.length
      + mapping.entityTypes.length;
    if (!narrows) {
      return "Chưa có mẫu layer/block hay loại đối tượng — quy tắc này sẽ khớp "
        + "MỌI đối tượng trong bản vẽ.";
    }
    return null;
  });
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
  /** Mã phiên của bản vẽ đã quét. Rỗng = máy chủ/plugin không cấp, và phép so
   * lùi về `target` — thứ không phân biệt được hai bản vẽ chưa lưu trùng tiêu đề. */
  documentInstance: string;
  /** Chốt để CHỌN đối tượng theo handle, hoặc `null` nếu lượt quét không kèm.
   *
   * Phải lấy từ `current.document` của **chính lượt quét này** — đợt đọc đã sinh
   * ra các handle. Ghép handle của lượt này với chốt đọc mới ở lượt khác là mở ra
   * đúng khoảng thời gian giữa hai lượt: bản vẽ đổi trong quãng đó thì handle trỏ
   * sang đối tượng khác trong khi chốt vẫn hợp lệ, và người dùng chọn nhầm thứ họ
   * không nhìn thấy. */
  selectGuard: { instance: string; revision: number } | null;
  /** Dimension đọc từ lượt quét. Máy chủ vẫn trả về, `/review` từng vứt đi. */
  dimensions: ScanDimension[];
  /** Danh sách dimension bị cắt ở `MAX_SCAN_ITEMS`. Một bảng cụt mà trông như đủ
   * là cách tệ nhất để sai — nhất là khi người dùng chọn DIM chuẩn từ nó. */
  dimensionsTruncated: boolean;
  /** Không gian AutoCAD đang hiện hành LÚC QUÉT (Model, hoặc tên layout).
   *
   * Lượt quét dùng `ssget "_X"` nên nó gom đối tượng của **mọi** không gian,
   * trong khi lệnh chọn chỉ chọn được đối tượng thuộc không gian **hiện hành**.
   * Một phát hiện thuộc layout khác vì thế sẽ bị từ chối lúc chuẩn bị — an toàn,
   * nhưng người dùng cần biết phải chuyển về đâu. Rỗng = không đọc được. */
  scannedSpace: string;
  profileId: string;
  /** Phiên bản hồ sơ LÚC QUÉT — hash, không phải số. Đây là thứ máy chủ so khi
   * áp dụng, và lệch là 409. */
  profileRevision: string;
  /** Bộ đếm phiên bản LÚC QUÉT, để hiển thị. Máy chủ chụp lại tại thời điểm
   * quét chứ không tính khi trả lời, nên nó vẫn đúng sau khi hồ sơ đã đổi —
   * đó là điều làm nó dùng được để nói "lượt quét này theo phiên bản 7, hồ sơ
   * giờ là 9". `0` = máy chủ bản cũ chưa phát. */
  profileVersion: number;
  scannedAt: string;
  issues: Issue[];
  /** Đối tượng các ánh xạ bắt được. Đây là vòng phản hồi DUY NHẤT cho câu "ánh
   * xạ của tôi có đúng không" — máy chủ không có đường thử một quy tắc chưa
   * lưu, nên cách kiểm duy nhất là lưu → quét → nhìn số đối tượng. */
  objects: MappedObject[];
  /** Danh sách đối tượng đã bị cắt ở `maxObjects` chưa. Đọc từ máy chủ, KHÔNG
   * cộng tay từ các nhóm: máy chủ tính cờ trên số đối tượng thu được **trước**
   * bộ lọc diện tích của ánh xạ, còn tổng các nhóm là số **sau** khi lọc. Hai
   * đại lượng khác nhau, và cộng tay sẽ bỏ sót cờ khi bộ lọc cắt nhiều. */
  objectsTruncated: boolean;
  /** Ngưỡng cắt của máy chủ, để nói ra con số thay vì "đã bị cắt". */
  maxObjects: number;
};

/** Một đối tượng lượt quét nhận diện được qua ánh xạ. */
export type MappedObject = {
  mappingId: string;
  label: string;
  kind: string;
  handle: string;
  type: string;
  layer: string;
  width: number | undefined;
  height: number | undefined;
  /** Diện tích ĐÃ QUY ĐỔI theo `areaUnit`, không phải số thô của bản vẽ. */
  area: number | undefined;
  /** Đơn vị của `area`. **Không phải lúc nào cũng `m²`**: daemon chỉ quy đổi
   * được INSUNITS 1/2/4/5/6 (inch, foot, mm, cm, m); mọi giá trị khác — kể cả
   * `0` (không đơn vị), rất thường gặp ở bản vẽ cũ — giữ số thô và gắn nhãn
   * `drawing-unit²`. Ghim cứng "m²" là sai với đúng những bản vẽ đó. */
  areaUnit: string;
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
  /* `dimspace` KHÔNG còn bị chặn ở đây (2026-08-15): bảng dimension đã có chỗ
     chọn DIM chuẩn, nên `dimBaseHandle` hỏi được. Việc "chưa chọn chuẩn" là một
     trạng thái nhất thời của màn hình, không phải năng lực thiếu — nó thuộc về
     `applyBlockedReason`, chỗ nói vì sao nút Sửa đang khoá. */
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
    /* Định danh bản vẽ của lượt quét. Rỗng = máy chủ không phát (bản cũ) hoặc
       plugin không cấp — lúc đó phép so lùi về tên, và tên thì không phân biệt
       được hai bản vẽ chưa lưu trùng tiêu đề. */
    documentInstance: str(body.documentInstance),
    profileId: str(body.profileId),
    profileRevision: str(body.profileRevision),
    profileVersion: num(body.profileVersion) ?? 0,
    scannedAt: str(body.scannedAt),
    issues: (Array.isArray(body.issues) ? body.issues : []).map(normalizeIssue),
    objects: (Array.isArray(body.objects) ? body.objects : []).map(normalizeMappedObject),
    /* Cờ cắt đọc từ BẰNG CHỨNG của máy chủ. Cộng tay từ các nhóm cho ra một đại
       lượng khác — xem chú thích ở `Scan.objectsTruncated`. */
    objectsTruncated: record(record(body.evidence).standardsScan).objectsTruncated === true,
    maxObjects: num(record(record(body.evidence).standardsScan).maxObjects) ?? 0,
    selectGuard: readSelectGuard(body),
    /* Không gian đọc từ `current.settings.CTAB`, KHÔNG từ `current.document`:
       khối `document` của `drawing-info` không hề có trường `space` (đã đối chiếu
       nguồn plugin), nên bản trước luôn trả rỗng và câu gợi ý không bao giờ hiện. */
    scannedSpace: str(record(record(record(body).current).settings).CTAB),
    dimensions: (Array.isArray(body.dimensions) ? body.dimensions : [])
      .map(normalizeScanDimension)
      .filter((dimension) => dimension.handle),
    /* Cùng nguồn với `objectsTruncated`: máy chủ đã phát sẵn cờ này ngay cạnh
       nó. Cộng tay từ độ dài mảng cho ra một đại lượng khác — mảng đã lọc bỏ
       dòng thiếu handle, nên nó nhỏ hơn số máy chủ thật sự thu được. */
    dimensionsTruncated:
      record(record(body.evidence).standardsScan).dimensionsTruncated === true,
  };
}

/** Một dòng dimension của lượt quét. */
export type ScanDimension = {
  handle: string;
  layer: string;
  style: string;
  /** `H` hoặc `V` — trục mà chương trình LISP suy ra từ góc xoay. */
  axis: string;
  /** Toạ độ hàng: X với DIM dọc, Y với DIM ngang. Đây là thứ `DIMSPACE` căn. */
  row: number;
  measurement: number;
  text: string;
};

function normalizeScanDimension(value: unknown): ScanDimension {
  const source = record(value);
  return {
    handle: str(source.handle),
    layer: str(source.layer),
    style: str(source.style),
    axis: str(source.axis),
    /* `num()` gọi `Number()` rồi kiểm hữu hạn; `row` thiếu thì để `NaN` lộ ra
       thay vì hoá `0` — `0` là một toạ độ hàng HỢP LỆ, nên quy về nó là bịa ra
       một DIM nằm đúng gốc toạ độ. */
    row: num(source.row) ?? Number.NaN,
    measurement: num(source.measurement) ?? Number.NaN,
    text: str(source.text),
  };
}

/** Chốt chọn lấy từ `current.document` của lượt quét, hoặc `null`.
 *
 * Kiểm KIỂU chứ không `Number(...)`: `Number(null)` là `0`, và `0` là một
 * revision **hợp lệ** — nên một lượt quét thiếu trường sẽ đi tiếp với chốt `0`,
 * máy chủ so thấy lệch rồi từ chối, và người dùng nhận một lỗi không giải thích
 * được thay vì câu "lượt quét này không chọn được, hãy quét lại".
 */
function readSelectGuard(body: unknown): Scan["selectGuard"] {
  const document = record(record(record(body).current).document);
  const instance = document.instance;
  const revision = document.revision;
  if (typeof instance !== "string" || !instance.trim()) return null;
  if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) {
    return null;
  }
  return { instance: instance.trim(), revision };
}

function normalizeMappedObject(value: unknown): MappedObject {
  const source = record(value);
  return {
    mappingId: str(source.mappingId),
    label: str(source.label),
    kind: str(source.kind),
    handle: str(source.handle),
    type: str(source.type),
    layer: str(source.layer),
    width: num(source.width),
    height: num(source.height),
    area: num(source.area),
    /* Rỗng khi máy chủ không phát — giao diện phải im chứ không được đoán "m²".
       Đoán sai ở đây là sai gấp một triệu lần với bản vẽ mm. */
    areaUnit: str(source.areaUnit),
  };
}

/** Gom đối tượng theo ánh xạ đã bắt được chúng.
 *
 * Câu hỏi người dùng thật sự hỏi không phải "có những đối tượng nào" mà là **"quy
 * tắc của tôi bắt đúng không"** — nên số đếm mỗi nhóm mới là câu trả lời, danh
 * sách chi tiết chỉ để kiểm chứng.
 *
 * Ánh xạ bắt được **0 đối tượng** vẫn phải có mặt, và đó là lý do hàm này nhận
 * cả danh sách ánh xạ của hồ sơ chứ không chỉ gom những gì có trong kết quả: một
 * quy tắc không khớp gì sẽ vắng mặt hoàn toàn khỏi `scan.objects`, mà đấy lại là
 * dấu hiệu quy tắc sai rõ nhất.
 */
export function groupObjectsByMapping(
  objects: readonly MappedObject[],
  mappings: readonly MappingRule[],
): { id: string; label: string; kind: string; count: number; required: boolean;
     area: number | undefined; areaUnit: string; objects: MappedObject[] }[] {
  const buckets = new Map<string, MappedObject[]>();
  for (const object of objects) {
    const list = buckets.get(object.mappingId);
    if (list) list.push(object); else buckets.set(object.mappingId, [object]);
  }
  /* Ánh xạ của hồ sơ trước — giữ đúng thứ tự người dùng thấy ở màn Hồ sơ — rồi
     mới tới những mã chỉ xuất hiện trong kết quả (hồ sơ đã đổi sau lượt quét). */
  const ids = [
    ...mappings.map((mapping) => mapping.id),
    ...[...buckets.keys()].filter((id) => !mappings.some((m) => m.id === id)),
  ];
  return ids.map((id) => {
    const list = buckets.get(id) ?? [];
    const mapping = mappings.find((item) => item.id === id);
    /* "Đo được" nghĩa là diện tích DƯƠNG, không phải "có trường area".
       Chương trình LISP trả `0` cho những gì nó không đo được — một INSERT
       khung tên chẳng hạn — và chính bộ máy gọi đó là "chưa đo được kích thước
       tự động" (`frame-unmeasurable`), chứ không phải diện tích bằng không.
       Đo trên máy thật: 8 đối tượng khung tên, cả 8 đều `area: 0, width: 0,
       height: 0`. Cộng chúng lại rồi hiện "0,00 m²" là nói bản vẽ có tám vùng
       rỗng. */
    const measured = list.filter((item) => item.area !== undefined && item.area > 0);
    return {
      id,
      label: mapping?.label || list[0]?.label || id,
      kind: mapping?.kind || list[0]?.kind || "",
      count: list.length,
      /* Ánh xạ TUỲ CHỌN bắt 0 đối tượng là chuyện bình thường — bản vẽ này chỉ
         không có loại đó. Chỉ ánh xạ BẮT BUỘC mới đáng báo động. Mã chỉ có
         trong kết quả (hồ sơ đã đổi sau lượt quét) thì không biết, coi là không
         bắt buộc — chiều im lặng. */
      required: mapping?.required === true,
      /* `undefined` khi KHÔNG đối tượng nào đo được diện tích — khác hẳn `0`.
         Cộng ra 0 rồi hiện "0,00 m²" là nói bản vẽ có vùng rỗng, trong khi sự
         thật là chưa đo được cái nào. */
      area: measured.length
        ? measured.reduce((sum, item) => sum + (item.area ?? 0), 0)
        : undefined,
      areaUnit: measured[0]?.areaUnit ?? "",
      objects: list,
    };
  });
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

/** Vì sao chưa CHỌN đối tượng được — hoặc rỗng nếu chọn được.
 *
 * Một định nghĩa cho **mọi** cửa vào: nút, thẻ xác nhận, và cả hai hàm xử lý.
 * Trước đây mỗi cửa tự kiểm lấy, và sáu vòng review liên tiếp đều ra cùng một
 * dạng lỗi — chặn được cửa này thì hở cửa kia (nút tắt nhưng thẻ vẫn bấm được;
 * `cancelPick` chặn nhưng hiệu ứng huỷ-theo-scanId thì không). Ma trận
 * "ba cửa vào × bốn nguồn vô hiệu" không giữ đúng bằng tay được.
 *
 * KHÔNG gồm trạng thái bận nhất thời (`pickBusy`) và cũng không gồm "đang có
 * một thao tác chờ xác nhận": hai thứ đó là chuyện của riêng từng cửa — thẻ xác
 * nhận sinh ra chính là để xác nhận thao tác đang chờ.
 */
export function pickBlockedReason(input: {
  scan: Scan | null;
  /** Một lượt quét MỚI đang chạy. Lượt cũ còn trên màn hình nhưng sắp bị thay,
   * nên mọi thứ chuẩn bị theo nó đều đang đua với nó. */
  scanBusy: boolean;
  /** Bản vẽ đã đổi kể từ lượt quét — handle không còn chỉ đúng đối tượng. */
  drawingChanged: boolean;
  /** Mã phiên của bản vẽ AutoCAD ĐANG hoạt động. Rỗng = không biết.
   *
   * `/selection/prepare` đòi bản vẽ đích phải đang hoạt động. Không so ở đây thì
   * người dùng chuyển sang tab khác rồi bấm Chọn, nhận `target_not_active`, và
   * phải tự đoán ra là mình cần quay về tab cũ. */
  activeInstance: string;
  /** Danh sách bản vẽ còn SỐNG không. `false` = plugin không phản hồi.
   *
   * Tách khỏi nội dung danh sách: một lượt đọc hỏng giữ lại danh sách cũ (đúng),
   * nhưng nếu chỉ nhìn nội dung thì mã phiên cũ vẫn khớp và nút vẫn sáng — rồi
   * yêu cầu chết với một lỗi kết nối thô thay vì câu chỉ đường của trang. */
  docsAlive: boolean;
}): string {
  if (!input.scan?.scanId) return "Chưa có lượt quét nào.";
  if (!input.docsAlive) return "Plugin AcadBridge chưa phản hồi.";
  if (input.scanBusy) return "Đang quét lại; chọn lại sau khi có kết quả mới.";
  if (input.drawingChanged) {
    return "Bản vẽ đã đổi kể từ lượt quét, nên handle của lượt này không còn chỉ "
      + "đúng đối tượng. Quét lại rồi chọn.";
  }
  /* So bằng ĐỊNH DANH, và chỉ khi biết cả hai. Không biết bản vẽ nào đang hoạt
     động thì không kết luận — chặn oan cũng là một kiểu sai, và máy chủ vẫn là
     chốt cuối. */
  const scanned = input.scan.documentInstance;
  if (scanned && input.activeInstance && scanned !== input.activeInstance) {
    return "Bản vẽ đã quét không còn là bản vẽ đang mở trong AutoCAD. Chuyển về "
      + "đúng tab rồi chọn.";
  }
  if (!input.scan.selectGuard) {
    return "Lượt quét này không kèm định danh bản vẽ nên không chọn an toàn được. "
      + "Quét lại rồi thử.";
  }
  return "";
}

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
  /* Nói bằng SỐ khi có số. "Quét theo phiên bản 7, hồ sơ giờ là 9" trả lời được
     câu người dùng thật sự hỏi — đã lỡ mất bao nhiêu lần sửa. Chỉ một vế có số
     thì im, vì "phiên bản 7 → phiên bản 0" là câu vô nghĩa. */
  const numbered = scan.profileVersion > 0 && profile.version > 0
    ? `Lượt quét theo phiên bản ${scan.profileVersion}; hồ sơ giờ là phiên bản `
      + `${profile.version}. `
    : "";
  return numbered
    + "Nội dung hồ sơ quy tắc đã đổi sau lượt quét này, nên các phát hiện "
    + "bên dưới không còn khớp. Quét lại trước khi sửa.";
}

/** Vì sao chưa áp dụng được tập đã chọn — hoặc rỗng nếu áp dụng được. */
/** Trục mà một phát hiện `dimspace` sẽ căn — `H`, `V`, hoặc rỗng.
 *
 * Máy chủ dựng MỘT phát hiện cho mỗi trục (`dim-row-h`, `dim-row-v`) và ghi trục
 * ngay trong `suggestedAction`. */
export function issueAxis(issue: Issue): string {
  return String(record(issue.suggestedAction).axis ?? "").trim().toUpperCase();
}

/** Vì sao lô căn hàng dimension chưa gửi được — hoặc rỗng nếu gửi được.
 *
 * `DIMSPACE` căn các DIM **cùng một trục** theo một DIM mốc. Máy chủ gộp MỌI
 * phát hiện `dimspace` đã chọn vào **một** lệnh với **một** handle chuẩn, nên:
 *
 * - Chọn cả hai trục cùng lúc là ném DIM dọc vào một lệnh lấy mốc là DIM ngang.
 * - Chọn chuẩn ở trục này rồi tích phát hiện của trục kia cũng vậy.
 *
 * Cả hai đều là một lượt ghi MỘT PHA không hoàn tác được từ app, và cả hai đều
 * KHÔNG tự lộ ra: lệnh chạy xong, AutoCAD không báo lỗi, các DIM chỉ đơn giản
 * nằm sai chỗ. Chặn ở đây là chỗ cuối còn nói được trước khi bấm.
 */
export function dimspaceBlockedReason(input: {
  selected: readonly Issue[];
  dimensions: readonly ScanDimension[];
  baseHandle: string;
}): string {
  const batch = input.selected.filter((issue) => issue.action === "dimspace");
  if (!batch.length) return "";

  const axes = [...new Set(batch.map(issueAxis).filter(Boolean))];
  if (axes.length > 1) {
    return "Lô đang có DIM lệch hàng ở CẢ hai trục, mà lệnh căn hàng chỉ căn "
      + "được một trục theo một DIM chuẩn. Bỏ tích một trục, sửa xong rồi làm trục kia.";
  }
  if (!input.baseHandle) {
    return "Trong lô có mục căn hàng dimension. Chọn một DIM làm chuẩn ở bảng "
      + "dimension bên dưới rồi sửa.";
  }
  const wanted = input.baseHandle.trim().toUpperCase();
  const base = input.dimensions.find((row) => row.handle.trim().toUpperCase() === wanted);
  /* Chuẩn không có trong lượt quét này: bảng đã bị cắt, hoặc handle còn sót từ
     một lượt trước. Gửi đi là máy chủ tra không ra rồi hỏng giữa chừng — mà lúc
     đó vài lệnh khác trong lô đã ghi xong. */
  if (!base) {
    return "DIM chuẩn đang chọn không có trong lượt quét này. Chọn lại một DIM "
      + "trong bảng bên dưới.";
  }
  /* KHÔNG BIẾT thì TỪ CHỐI. Một dòng quét có `axis` rỗng làm phép so trục ở dưới
     bị bỏ qua hoàn toàn — chốt duy nhất còn lại tự tắt đúng lúc dữ liệu đáng ngờ
     nhất. Máy chủ cũng từ chối; ở đây nói trước để không phải bấm rồi mới biết. */
  const baseAxis = base.axis.trim().toUpperCase();
  if (!baseAxis) {
    return "Lượt quét không đọc được trục của DIM chuẩn đang chọn. Chọn một DIM "
      + "khác, hoặc quét lại sau khi build lại plugin AcadBridge.";
  }
  /* `DIMSPACE` căn THEO toạ độ hàng của mốc. Không có nó thì mốc không định nghĩa
     được — mà lệnh vẫn chạy. Bảng hiện “—” ở cột Hàng cho đúng những dòng này. */
  if (!Number.isFinite(base.row)) {
    return "DIM chuẩn đang chọn không có toạ độ hàng đọc được (cột Hàng hiện “—”). "
      + "Chọn một DIM khác làm chuẩn.";
  }
  if (axes.length === 1 && baseAxis !== axes[0]) {
    return `DIM chuẩn đang chọn thuộc trục ${baseAxis === "V" ? "dọc" : "ngang"}`
      + `, còn lô cần căn trục ${axes[0] === "V" ? "dọc" : "ngang"}. `
      + "Chọn một DIM chuẩn cùng trục với lô.";
  }
  /* Mốc không tự căn theo chính nó. Máy chủ lọc `baseHandle` ra khỏi danh sách
     cần dời, nên chọn đúng cái DIM DUY NHẤT của lô làm mốc là còn lại rỗng — và
     người dùng ăn 400 sau khi đã bấm một nút ghi. Không tự chọn hộ một mốc khác:
     mốc quyết định các DIM khác dời đi đâu, và đó là lượt ghi không hoàn tác
     được — nút chọn nằm TRONG bảng chính là để người dùng tự quyết. */
  const movable = new Set(batch
    .flatMap((issue) => issue.handles)
    .map((handle) => handle.trim().toUpperCase()));
  movable.delete(wanted);
  if (!movable.size) {
    return "DIM chuẩn đang chọn cũng là DIM duy nhất cần căn trong lô, nên không "
      + "còn gì để dời. Chọn một DIM đã đúng hàng làm chuẩn, hoặc tích thêm phát hiện.";
  }
  return "";
}

export function applyBlockedReason(input: {
  scan: Scan | null;
  /** Bản vẽ AutoCAD ĐANG hoạt động, **dạng `targetOf()`**. */
  activeTarget: string;
  /** Mã phiên của bản vẽ đang hoạt động. Rỗng = không biết, và phép so lùi về
   * tên — thứ không phân biệt được hai bản vẽ chưa lưu trùng tiêu đề. */
  activeInstance: string;
  /** Bản vẽ đang chọn trên màn hình, **dạng `targetOf()`**. Lượt sửa gửi đi CHỈ
   * có `scanId`, nên máy chủ dùng đích đã lưu trong phiên quét — không phải đích
   * đang hiện. Quét bản vẽ A rồi đổi ô chọn sang B mà vẫn bấm sửa là ghi vào A
   * trong khi màn hình nói B.
   *
   * CẢ HAI trường phải ở dạng `targetOf()` (`file || title`) chứ không phải dạng
   * `sendTarget()`, vì cả hai chỉ dùng để SO với `scan.target` — thứ daemon đặt
   * bằng `file || title` của bản vẽ nó giải quyết được, bất kể ta gửi đích nào.
   * Trộn hai dạng là chặn VĨNH VIỄN mọi bản vẽ chưa lưu: phép so không bao giờ
   * khớp, và nút sửa không bao giờ bật. */
  target: string;
  selected: number;
  /** Vì sao lô căn hàng dimension chưa gửi được — từ `dimspaceBlockedReason()`.
   * Rỗng = lô không có `dimspace`, hoặc đã đủ điều kiện. */
  dimNote: string;
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
  /* So bằng ĐỊNH DANH khi có: hai bản vẽ chưa lưu trùng tiêu đề cho ra cùng một
     `scan.target`, nên so bằng tên sẽ bật nút Sửa cho bản vẽ SAI và người dùng
     chỉ biết khi máy chủ từ chối. Không có định danh (máy chủ bản cũ, hoặc plugin
     không cấp) thì lùi về tên — kém hơn, nhưng vẫn là chốt đang có. */
  const mismatch = input.scan.documentInstance && input.activeInstance
    ? input.activeInstance !== input.scan.documentInstance
    : !!input.scan.target && input.activeTarget !== input.scan.target;
  if (mismatch) {
    return "AutoCAD đang mở một bản vẽ khác. Chuyển về đúng bản vẽ đã quét, "
      + "hoặc quét lại bản vẽ đang mở.";
  }
  if (input.dimNote) return input.dimNote;
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
export function profileSaveBlockedReason(
  profile: StandardsProfile,
  /** Hồ sơ **đã lưu**, để biết KIỂU của từng trường kích thước nâng cao. Bỏ
   * trống thì bỏ qua phép kiểm đó — không đoán kiểu từ thứ đang gõ dở. */
  baseline?: StandardsProfile | null,
): string {
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
    { label: "Dung sai khung", value: profile.frameTolerancePercent, min: 0, max: 100 },
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
    ["Kiểu ghi số", profile.linearFormat],
    ["Tên dimstyle", profile.dimStyleName],
  ] as const;
  const blank = texts.filter(([, value]) => !value.trim()).map(([label]) => label);
  if (blank.length) return `Không được để trống: ${blank.join(", ")}.`;

  /* Kiểu ghi số: kho hồ sơ nhận mọi chuỗi, `linearFormat()` lúc áp dụng chỉ hiểu
     năm tên hoặc số 1–5. Chặn ở đây để lỗi hiện ra nơi sửa được. */
  const format = profile.linearFormat.trim();
  const formatNumber = Number(format);
  const formatOk = LINEAR_FORMATS.some((name) => name.toLowerCase() === format.toLowerCase())
    || (Number.isInteger(formatNumber) && formatNumber >= 1 && formatNumber <= 5);
  if (!formatOk) {
    return `Kiểu ghi số “${format}” lưu được nhưng lượt áp dụng không hiểu — `
      + `chỉ nhận ${LINEAR_FORMATS.join(", ")} hoặc số 1–5.`;
  }

  /* `MAX_LAYERS`/`MAX_MAPPINGS` của daemon đều là 500. Không kiểm ở đây thì một
     lượt nhập layer từ bản vẽ lớn sẽ báo "đã nhận vào bản nháp" rồi để lượt PUT
     sau đó ăn 400 — người dùng không biết vì sao. */
  if (profile.layers.length > 500) {
    return `Hồ sơ không được quá 500 layer; đang có ${profile.layers.length}.`;
  }
  if (profile.mappings.length > 500) {
    return `Hồ sơ không được quá 500 ánh xạ; đang có ${profile.mappings.length}.`;
  }

  const layerError = layerRowErrors(profile.layers).findIndex(Boolean);
  if (layerError >= 0) {
    return `Layer dòng ${layerError + 1}: ${layerRowErrors(profile.layers)[layerError]}`;
  }
  const mapError = mappingRowErrors(profile.mappings).findIndex(Boolean);
  if (mapError >= 0) {
    return `Ánh xạ dòng ${mapError + 1}: ${mappingRowErrors(profile.mappings)[mapError]}`;
  }

  /* Bảng kích thước nâng cao là ô chữ tự do trên dữ liệu có kiểu. `numberValue()`
     của daemon từ chối THẲNG một chuỗi — kể cả `"2"` — nên gõ chữ vào một trường
     số sẽ ăn 400 kèm một lời báo không chỉ ra ô nào. Kiểu lấy từ bản đã lưu, vì
     bản nháp có thể đang giữ chính cái giá trị hỏng cần bắt. */
  if (baseline) {
    for (const key of Object.keys(profile.dimensionExtras).sort()) {
      const want = typeof baseline.dimensionExtras[key];
      const got = profile.dimensionExtras[key];
      if (want === "number" && typeof got !== "number") {
        return `Thiết lập kích thước “${key}” phải là một số.`;
      }
      if (want === "boolean" && typeof got !== "boolean") {
        return `Thiết lập kích thước “${key}” phải là có/không.`;
      }
    }
  }
  return "";
}


/* ------------------------------------------------------------------ *
 * Nhập layer từ bản vẽ
 * ------------------------------------------------------------------ */

/** Một dòng của bảng layer đọc từ bản vẽ (`/drawing-info` → `tables.layers`). */
export type DrawingLayer = {
  name: string;
  /** Chỉ số ACI `0…256`, hoặc `#RRGGBB` khi layer dùng màu thật. */
  color: number | string | undefined;
  linetype: string;
  /** Bề dày **theo mã DXF group 370**, chưa quy đổi. */
  lineweight370: number | undefined;
};

/** Đổi bề dày từ mã DXF group 370 sang dạng kho hồ sơ nhận.
 *
 * Plugin gửi thẳng `(int)layer->lineWeight()`, tức **luôn là group 370**: ba giá
 * trị âm mang ý nghĩa, phần còn lại là 1/100 mm. Kho hồ sơ thì nhận ba **tên**
 * và số **milimét** `0…2.11`. Bỏ bước đổi này là mọi layer nhập vào đều bị máy
 * chủ từ chối từng dòng một.
 *
 * Chia thẳng cho 100, không dùng ngưỡng đoán. Bộ mẫu đoán bằng
 * `n > 2.11 ? n/100 : n` — trên bản vẽ thật hai cách cho cùng kết quả (giá trị
 * hợp lệ duy nhất ≤ 2.11 là `0`, mà `0/100` cũng là `0`), nhưng ngưỡng ấy sẽ
 * đọc một giá trị lạ như `2` thành *2 mm* thay vì *0.02 mm*. Nguồn đã chắc chắn
 * là group 370 thì không có gì để đoán.
 *
 * Đo trên bản vẽ thật, 43 layer: `-3 · 0 · 5 · 9 · 13 · 15 · 18 · 30 · 35 · 40`
 * — tất cả đều là giá trị hợp lệ của `AcDb::LineWeight`.
 */
export function lineweightFromDxf(raw: number | undefined): string | number {
  if (raw === undefined || !Number.isFinite(raw)) return "Default";
  if (raw === -3) return "Default";
  if (raw === -2) return "ByBlock";
  if (raw === -1) return "ByLayer";
  if (raw < 0) return "Default";
  /* Làm tròn hai chữ số: `13/100` trong dấu phẩy động là `0.13000000000000003`,
     và một giá trị như thế không khớp mục nào trong ô chọn — dòng vừa nhập vào
     sẽ hiện ra như một giá trị lạ. */
  return Math.round(raw) / 100;
}

/** `kByColor` của `AcCmEntityColor::ColorMethod` — layer dùng màu thật. */
const COLOR_METHOD_TRUE = 0xc2;

/**
 * Layer có dùng màu thật (true color) không?
 *
 * Bản plugin có phát `colorMethod` thì câu trả lời là chắc chắn. Bản cũ không
 * phát thì phải suy từ `rgb`, và chỗ suy đó có một điểm mù không gỡ được: màu
 * thật ĐEN TUYỀN cũng là `rgb: [0,0,0]`, không phân biệt được với một layer ACI.
 * Đó chính là lý do `colorMethod` được thêm vào plugin — để không phải đoán.
 */
export function isTrueColor(row: JsonRecord): boolean {
  const method = row.colorMethod;
  if (typeof method === "number") return method === COLOR_METHOD_TRUE;
  const rgb = row.rgb;
  return Array.isArray(rgb) && rgb.length >= 3
    && rgb.some((channel) => typeof channel === "number" && channel !== 0);
}

/** `[r, g, b]` → `#RRGGBB`, hoặc `undefined` nếu payload không dùng được. */
export function hexColor(value: unknown): string | undefined {
  if (!Array.isArray(value) || value.length < 3) return undefined;
  const channels = value.slice(0, 3).map((channel) =>
    typeof channel === "number" && Number.isInteger(channel)
      && channel >= 0 && channel <= 255
      ? channel
      : undefined);
  if (channels.some((channel) => channel === undefined)) return undefined;
  return `#${channels
    .map((channel) => (channel as number).toString(16).padStart(2, "0"))
    .join("")}`.toUpperCase();
}

/** Bảng layer đọc từ phản hồi `/drawing-info`, kèm cờ danh sách bị cắt.
 *
 * Hợp đồng có bảng layer ở **ba chỗ** tuỳ phiên bản plugin. Chỉ đọc
 * `tables.layers` là một bản phản hồi lồng cũ sẽ bị báo "không có bảng layer
 * nào" trong khi nó có đủ — panel cũ đã lùi qua cả ba, và bỏ đường lùi đó là
 * một bước lùi tương thích.
 *
 * `layers_truncated` quan trọng hơn nó trông: plugin cắt bảng layer ở
 * `limits.maxLayerItems`, và một danh sách cụt **không đủ** để kết luận "layer
 * này không còn trong bản vẽ" — nó có thể chỉ nằm ngoài phần được trả về. Kết
 * luận sai ở đó dẫn thẳng tới xoá một layer thật khỏi hồ sơ.
 *
 * `limit` lấy TỪ payload chứ không gõ cứng. Ngưỡng này đã đổi một lần (500 →
 * 5.000) và câu thông báo gõ cứng con số cũ thành ra nói sai với người dùng đúng
 * lúc họ cần tin nó nhất. Bản plugin cũ không phát nó thì trả `undefined`, và
 * câu thông báo bỏ luôn con số thay vì đoán.
 */
export function readDrawingLayers(body: unknown): {
  layers: DrawingLayer[];
  truncated: boolean;
  /** Ngưỡng cắt plugin công bố, hoặc `undefined` nếu bản plugin không phát. */
  limit: number | undefined;
  /** Số dòng bị bỏ vì KHÔNG mang thuộc tính layer nào. */
  skipped: number;
  /** Plugin nói thẳng là nó không đọc được bảng layer. Khác hẳn "bản vẽ không có
   * layer nào" — cái sau không tồn tại, mọi bản vẽ đều có ít nhất layer `0`. */
  unavailable: boolean;
} {
  const source = record(body);
  const rows = record(source.tables).layers
    ?? record(source.drawing).layers
    ?? source.layers;
  const warnings = Array.isArray(source.warnings) ? source.warnings.map(String) : [];
  const all = Array.isArray(rows) ? rows.map(record) : [];
  /* Dòng chỉ có `name` (và có thể `handle`) KHÔNG phải một dòng bảng layer —
     plugin luôn phát đủ `aci`, `linetype`, `lineweight` cho mỗi layer. Nhận nó
     rồi điền `7`/`Continuous`/`Default` là **bịa ra thuộc tính** rồi trình bày
     như thể đọc được từ bản vẽ, ngay trong một tính năng mà cả điểm của nó là
     "lấy đúng giá trị bản vẽ đang dùng".

     Đòi ĐỦ CẢ BA, không phải "có ít nhất một". Bản trước dùng `||`, nên một dòng
     `{name, aci}` vẫn lọt và hai thuộc tính còn lại vẫn bị bịa — sửa nửa vời còn
     khó thấy hơn không sửa. */
  /* Kiểm KIỂU chứ không chỉ kiểm "có mặt". `Number(null)` là `0` và
     `Number("")` cũng là `0`, nên một dòng `{aci: null, linetype: null,
     lineweight: null}` lọt qua phép kiểm `!== undefined` rồi chuẩn hoá thành
     màu `0`, `Continuous`, bề dày `0` — vẫn là bịa dữ liệu, chỉ khó thấy hơn.
     Đây là lần thứ ba tôi siết bộ lọc này; hai lần trước đều siết nửa vời. */
  const isNumber = (value: unknown): value is number =>
    typeof value === "number" && Number.isFinite(value);
  /* Màu phải ĐỌC ĐƯỢC, không chỉ "có mặt".
     - Màu thật mà `rgb` hỏng → `hexColor` trả `undefined`, dòng vẫn lọt, rồi
       `reconcileLayers` làm `source.color ?? 7` biến nó thành ACI 7. Layer nhập
       vào đổi màu mà không ai báo.
     - ACI `0` (ByBlock) và `256` (ByLayer) KHÔNG phải màu hợp lệ của một layer:
       layer không kế thừa màu từ chính nó. `layerColor()` của daemon lặng lẽ đổi
       cả hai thành `7` lúc áp dụng — lại là đổi màu không ai báo.
     Cả hai đều rơi vào `skipped`, đúng nguyên tắc dùng cho dòng thiếu thuộc
     tính: không biểu diễn được thì không bịa. */
  const readableColor = (row: JsonRecord) => {
    if (isTrueColor(row)) return hexColor(row.rgb) !== undefined;
    const index = isNumber(row.aci) ? row.aci
      : (isNumber(row.color) ? row.color : undefined);
    return index !== undefined && index > 0 && index < 256;
  };
  const usable = all.filter((row) =>
    readableColor(row)
    && typeof row.linetype === "string" && row.linetype.trim() !== ""
    && isNumber(row.lineweight));
  return {
    layers: normalizeDrawingLayers(usable),
    truncated: warnings.includes("layers_truncated"),
    limit: (() => {
      const limits = record(record(body).limits);
      const value = limits.maxLayerItems ?? limits.maxTableItems;
      return typeof value === "number" && Number.isInteger(value) && value > 0
        ? value
        : undefined;
    })(),
    skipped: all.filter((row) => str(row.name)).length
      - usable.filter((row) => str(row.name)).length,
    unavailable: warnings.includes("layers_unavailable")
      || warnings.includes("layers_iterator_unavailable"),
  };
}

export function normalizeDrawingLayers(value: unknown): DrawingLayer[] {
  const rows = Array.isArray(value) ? value : [];
  return rows.map(record).map((row) => ({
    name: str(row.name),
    /* `aci` là chỉ số màu; `color` của payload cũng là số nhưng `aci` mới là
       trường daemon dùng khi so sánh layer.
       Chọn theo KIỂU, không theo `??`: `num()` gọi `Number()` rồi kiểm hữu hạn,
       mà `Number(null)` là `0` và `Number(false)` cũng là `0` — nên `aci: null`
       cho ra `0` và đường lùi `color` không bao giờ chạy. Layer nhập vào sẽ mang
       màu 0 thay vì màu thật của nó. */
    /* Màu thật đi trước: với layer đó `aci` là `colorIndex()`, một chỉ số
       KHÔNG mang màu người dùng đặt. Đọc nó trước là lặng lẽ đổi màu layer. */
    color: isTrueColor(row)
      ? hexColor(row.rgb)
      : (typeof row.aci === "number" && Number.isFinite(row.aci)
        ? row.aci
        : (typeof row.color === "number" && Number.isFinite(row.color)
          ? row.color
          : undefined)),
    linetype: str(row.linetype, "Continuous"),
    lineweight370: num(row.lineweight),
  })).filter((layer) => layer.name);
}

/** Một dòng khác biệt giữa hồ sơ và bản vẽ. */
export type LayerDiffField = { label: string; from: string; to: string };

export type LayerReconcile = {
  /** Có trong bản vẽ, chưa có trong hồ sơ. */
  add: LayerRule[];
  /** Có ở cả hai nhưng khác thuộc tính. */
  differ: { name: string; incoming: LayerRule; fields: LayerDiffField[] }[];
  /** Có trong hồ sơ, không còn trong bản vẽ. */
  gone: LayerRule[];
};

/** Đối chiếu bảng layer của bản vẽ với hồ sơ — KHÔNG thay thế.
 *
 * Panel cũ hỏi một câu rồi **thay sạch** danh sách: ai đã tinh chỉnh cột "bắt
 * buộc" và bề dày cho 40 layer sẽ mất hết trong một cú bấm. Hàm này chỉ mô tả
 * khác biệt; việc áp dụng do người dùng tích từng dòng.
 *
 * So tên **không phân biệt hoa thường**, đúng `assertUnique()` của daemon.
 */
export function reconcileLayers(
  profileLayers: readonly LayerRule[],
  drawingLayers: readonly DrawingLayer[],
): LayerReconcile {
  const key = (name: string) => name.trim().toLocaleUpperCase("en-US");
  const inProfile = new Map(profileLayers.map((layer) => [key(layer.name), layer]));
  const seen = new Set<string>();

  const add: LayerRule[] = [];
  const differ: LayerReconcile["differ"] = [];

  for (const source of drawingLayers) {
    seen.add(key(source.name));
    const incoming: LayerRule = {
      name: source.name,
      color: source.color ?? 7,
      linetype: source.linetype,
      lineweight: lineweightFromDxf(source.lineweight370),
      /* Layer nhập từ bản vẽ mặc định BẮT BUỘC — đó là lý do người ta lấy một
         bản vẽ đã chuẩn làm gốc. Sửa lại từng dòng vẫn được sau khi nhận. */
      required: true,
    };
    const current = inProfile.get(key(source.name));
    if (!current) { add.push(incoming); continue; }

    const fields: LayerDiffField[] = [];
    /* So màu KHÔNG phân biệt hoa/thường: `hexColor()` sinh ra `#FF8000`, còn
       người dùng gõ tay thường ra `#ff8000`. Cùng một màu mà so thô thì dòng đó
       nằm mãi trong nhóm "khác thuộc tính", và nhận bao nhiêu lần cũng không hết
       — một khác biệt không bao giờ đóng lại được. `ByLayer`/`byblock` cũng vậy. */
    const colorKey = (value: string | number) =>
      String(value).trim().toLocaleUpperCase("en-US");
    if (colorKey(current.color) !== colorKey(incoming.color)) {
      fields.push({ label: "Màu", from: String(current.color), to: String(incoming.color) });
    }
    if (current.linetype !== incoming.linetype) {
      fields.push({ label: "Nét", from: current.linetype, to: incoming.linetype });
    }
    if (String(current.lineweight) !== String(incoming.lineweight)) {
      fields.push({
        label: "Bề dày",
        from: String(current.lineweight),
        to: String(incoming.lineweight),
      });
    }
    /* KHÔNG so `required`: nó là quyết định của người lập hồ sơ, không phải
       thuộc tính đọc được từ bản vẽ. Đưa nó vào danh sách khác biệt là mời người
       dùng ghi đè chính lựa chọn của mình bằng một mặc định. */
    if (fields.length) differ.push({ name: current.name, incoming, fields });
  }

  const gone = profileLayers.filter((layer) => layer.name && !seen.has(key(layer.name)));
  return { add, differ, gone };
}

/** Áp các dòng đã tích vào danh sách layer. Trả về danh sách MỚI.
 *
 * `picks` là tập khoá `"add:TÊN"` / `"diff:TÊN"` / `"gone:TÊN"` — cùng tên với
 * khoá hộp thoại dùng, để không có bước ánh xạ nào ở giữa làm lệch.
 */
export function applyLayerReconcile(
  profileLayers: readonly LayerRule[],
  plan: LayerReconcile,
  picks: ReadonlySet<string>,
): LayerRule[] {
  const key = (name: string) => name.trim().toLocaleUpperCase("en-US");
  const removing = new Set(
    plan.gone.filter((layer) => picks.has(`gone:${layer.name}`)).map((l) => key(l.name)),
  );
  const updates = new Map(
    plan.differ
      .filter((row) => picks.has(`diff:${row.name}`))
      .map((row) => [key(row.name), row.incoming]),
  );

  const kept = profileLayers
    .filter((layer) => !removing.has(key(layer.name)))
    .map((layer) => {
      const update = updates.get(key(layer.name));
      /* Giữ `required` của hồ sơ, chỉ nhận ba thuộc tính đọc được từ bản vẽ —
         đúng những gì đã hiện trong danh sách khác biệt. */
      return update
        ? { ...layer, color: update.color, linetype: update.linetype,
            lineweight: update.lineweight }
        : layer;
    });

  const added = plan.add.filter((layer) => picks.has(`add:${layer.name}`));
  return [...kept, ...added];
}

/** Đếm số thay đổi đã tích — cho nhãn nút. */
export function countLayerPicks(plan: LayerReconcile, picks: ReadonlySet<string>): number {
  return plan.add.filter((l) => picks.has(`add:${l.name}`)).length
    + plan.differ.filter((r) => picks.has(`diff:${r.name}`)).length
    + plan.gone.filter((l) => picks.has(`gone:${l.name}`)).length;
}

/** Đích thao tác: ĐƯỜNG DẪN TỆP, không phải tiêu đề — hai bản vẽ cùng tên mở
 * cùng lúc là chuyện thường trong một bộ hồ sơ. */
export function targetOf(doc: { file?: string; title?: string }): string {
  return (doc.file || "").trim() || (doc.title || "").trim();
}

/** Phần của một bản vẽ đang mở mà phép chỉ đích danh cần tới. */
export type TargetableDoc = {
  file?: string;
  title?: string;
  instance?: string;
  targetsInstance?: boolean;
};

/** Đích để GỬI ĐI trong một yêu cầu — không phải để so sánh.
 *
 * Khác `targetOf()` ở chỗ ưu tiên `instance` cho bản vẽ chưa lưu. Hai hàm phải
 * tách nhau vì chúng trả lời hai câu khác nhau:
 *
 * · `targetOf()` = "máy chủ gọi bản vẽ này là gì" — dùng để **so** với
 *   `scan.target`, thứ daemon đặt bằng `document.file || document.title`. Đổi nó
 *   sang `instance` là làm mọi phép so ở `/review` trượt.
 * · hàm này = "chỉ đích danh bản vẽ này cách nào chắc chắn nhất" — dùng để
 *   **gửi**. Bản vẽ chưa lưu không có đường dẫn, nên tiêu đề là thứ duy nhất còn
 *   lại, và hai bản vẽ chưa lưu trùng tiêu đề thì mọi lượt đọc đều bị từ chối vì
 *   mơ hồ. Mã phiên gỡ đúng chỗ đó.
 *
 * Cả plugin (`findDocExact`) lẫn daemon (`selectOpenDocument`) đều nhận mã phiên
 * làm đích. Token có dạng `%016llX-%016llX` nên không thể trùng một path hay
 * title thật.
 */
export function requestTargetOf(
  doc: { file?: string; title?: string; instance?: string },
): string {
  const file = (doc.file || "").trim();
  if (file) return file;
  const instance = (doc.instance || "").trim();
  if (instance) return instance;
  return (doc.title || "").trim();
}

/** Chuỗi gửi lên máy chủ để chỉ đích danh bản vẽ này.
 *
 * `requestTargetOf()` ưu tiên mã phiên, nhưng chỉ được phép làm vậy khi plugin
 * nhận mã phiên làm đích. Với plugin cũ, gửi mã phiên là nhận `not_found` —
 * daemon có lùi về tiêu đề, nhưng lùi được thì đằng nào tiêu đề cũng đủ, còn
 * không lùi được thì đích đó vốn đã mơ hồ. Nên đơn giản là đừng gửi.
 */
export function sendTarget(doc: TargetableDoc): string {
  return doc.targetsInstance === true
    ? requestTargetOf(doc)
    : ((doc.file || "").trim() || (doc.title || "").trim());
}

export function pickable<T extends TargetableDoc>(docs: readonly T[]): T[] {
  return docs.filter((doc) => {
    if ((doc.file || "").trim()) return true;
    if (doc.targetsInstance === true && (doc.instance || "").trim()) return true;
    return docs.filter((other) =>
      (other.title || "").trim() === (doc.title || "").trim()).length <= 1;
  });
}

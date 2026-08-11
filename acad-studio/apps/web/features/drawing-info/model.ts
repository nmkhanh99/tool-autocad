/** Đọc hiểu hồ sơ bản vẽ của `GET /api/acad/drawing-info`.
 *
 * Thuần tính toán, không React, không fetch.
 *
 * ## Ba chỗ payload này dễ bị đọc sai
 *
 * **`extents` trộn các không gian.** `min` lấy từ Model (toạ độ trắc địa, hàng
 * triệu đơn vị) còn `max` có thể đến từ một layout (mm trên giấy) — trên bản vẽ
 * as-built của dự án ra một khung rộng 3,8 **triệu** đơn vị. In thẳng ra như một
 * cặp toạ độ là mời kỹ sư đọc một con số vô nghĩa.
 *
 * **`counts.approxObjects` không phải số đối tượng.** Nó là ước lượng số
 * *object* trong database, gồm cả bảng ký hiệu, từ điển, bản ghi mở rộng —
 * 26.246 trên một bản vẽ có 259 đối tượng. Số đối tượng là `counts.entities`.
 *
 * **`selectionScope` chỉ nói về KHÔNG GIAN HIỆN HÀNH.** `scanned: 10` không có
 * nghĩa bản vẽ có 10 đối tượng; nó là số đối tượng quét được trong không gian
 * AutoCAD đang mở. Bộ tạo chọn dựa trên đó, nên nó cũng chỉ với tới không gian
 * ấy — và màn hình phải nói ra.
 */

export type JsonRecord = Record<string, unknown>;

export type LayerRow = {
  name: string;
  /** Số đối tượng CHỌN ĐƯỢC trên layer, trong không gian hiện hành. */
  count: number;
  /** `false` chỉ khi payload nói rõ. Thiếu trường = coi như đang dùng. */
  inUse: boolean;
  aci: number;
  rgb: number[] | null;
  linetype: string;
  /** Đơn vị 1/100 mm. `-3` = ByLayer mặc định, `-2` = ByBlock, `-1` = ByLayer. */
  lineweight: number;
  off: boolean;
  frozen: boolean;
  locked: boolean;
  plottable: boolean;
};

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}
function num(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
function bool(value: unknown): boolean {
  return value === true;
}
export function record(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}
function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Đưa hai dạng phản hồi về MỘT hình dạng.
 *
 * `drawing-info` trả về cả hai: các khoá ở gốc (`settings`, `tables`, `counts`,
 * `extents`) **và** một khối `drawing` lồng bên trong với tên khoá khác
 * (`layers`, `entitiesByType`, `entitiesByLayer`…). Plugin 1.6 phát cả hai, nên
 * đọc mỗi dạng gốc vẫn chạy — hôm nay.
 *
 * Nhưng daemon chỉ **bù** đúng `tables.layers` và `tables.blocks` từ dạng lồng
 * (`legacySelectionCatalog.ts`); `counts`, `settings`, `extents` ở gốc là chép
 * thẳng từ snapshot của plugin. Một plugin chỉ phát dạng lồng sẽ cho ra màn hình
 * 0 đối tượng, bảng layer không có số, đơn vị trống — mà không lỗi gì cả, nên
 * không ai biết. Chuẩn hoá ở đây, một chỗ, thay vì rải `??` khắp nơi.
 */
export function normalize(payload: JsonRecord | null): JsonRecord {
  if (!payload) return {};
  const nested = record(payload.drawing);
  if (!Object.keys(nested).length) return payload;

  const tables = record(payload.tables);
  const counts = record(payload.counts);
  const nestedCounts = record(nested.counts);
  const selection = record(payload.selection).count != null
    ? record(payload.selection)
    : record(nested.selection);

  return {
    ...payload,
    settings: Object.keys(record(payload.settings)).length
      ? payload.settings
      : nested.settings ?? nested.variables ?? {},
    extents: Object.keys(record(payload.extents)).length ? payload.extents : nested.extents ?? {},
    dictionaries: Array.isArray(payload.dictionaries) ? payload.dictionaries : nested.dictionaries ?? [],
    xrefs: Array.isArray(payload.xrefs) ? payload.xrefs : nested.xrefs ?? [],
    selection,
    selectionScope: Object.keys(record(payload.selectionScope)).length
      ? payload.selectionScope
      : nested.selectionScope ?? {},
    tables: {
      ...tables,
      layers: tables.layers ?? nested.layers ?? [],
      blocks: tables.blocks ?? nested.blocks ?? [],
      layouts: tables.layouts ?? nested.layouts ?? [],
      registeredApps: tables.registeredApps ?? nested.registeredApps ?? [],
      /* Tên khoá của dạng lồng là `text` / `dimension` / `linetypes` — đã đối
         chiếu với phản hồi thật, không đoán. Đoán `dim`/`linetype` cho ra hai
         bảng đếm bằng 0 mà không lỗi gì. */
      textStyles: tables.textStyles ?? record(nested.styles).text ?? [],
      dimStyles: tables.dimStyles ?? record(nested.styles).dimension ?? [],
      linetypes: tables.linetypes ?? record(nested.styles).linetypes ?? [],
    },
    counts: {
      ...nestedCounts,
      ...counts,
      byType: counts.byType ?? nested.entitiesByType ?? nestedCounts.byType ?? {},
      byLayer: counts.byLayer ?? nested.entitiesByLayer ?? nestedCounts.byLayer ?? {},
      bySpace: counts.bySpace ?? nested.entitiesBySpace ?? nestedCounts.bySpace ?? {},
      /* Số đối tượng đang chọn cũng có hai đường: `counts.selected` ở gốc, hoặc
         `selection.count` ở khối lồng. */
      selected: counts.selected ?? record(selection).count ?? 0,
    },
  };
}

export function layerRows(raw: JsonRecord): LayerRow[] {
  const payload = normalize(raw);
  const tables = record(payload.tables);
  const byLayer = record(record(payload.counts).byLayer);
  return list(tables.layers).map((raw) => {
    const row = record(raw);
    const name = str(row.name);
    return {
      name,
      /* `selectableCount` của bảng layer chỉ đếm trong không gian hiện hành,
         giống `counts.byLayer`. Lấy `byLayer` trước vì nó là cùng một phép đếm
         mà `counts` dùng cho mọi chỗ khác — hai con số khác nhau cho cùng một
         layer trên cùng một màn hình là lỗi tin cậy, không phải chi tiết nhỏ. */
      count: num(byLayer[name], num(row.selectableCount)),
      aci: num(row.aci, num(row.color)),
      rgb: Array.isArray(row.rgb) && row.rgb.length >= 3
        ? row.rgb.map((c) => num(c))
        : null,
      linetype: str(row.linetype),
      lineweight: num(row.lineweight, -3),
      off: bool(row.off),
      frozen: bool(row.frozen),
      locked: bool(row.locked),
      plottable: row.plottable !== false,
      /* Thiếu trường thì coi là ĐANG DÙNG. Gắn nhãn "không dùng" cho một layer
         chỉ vì payload không nói gì là một lời khai không có căn cứ — và người
         dùng dọn bản vẽ dựa trên đúng nhãn đó. Cùng lối với `plottable`. */
      inUse: row.inUse !== false,
    };
  });
}

/** Màu CSS của một layer. `rgb` là màu thật; `aci` chỉ là chỉ số trong bảng màu
 * AutoCAD nên không dựng lại được nếu thiếu `rgb`.
 *
 * Trả `null` thay vì đoán một màu: một ô màu SAI cạnh tên layer tệ hơn không có
 * ô màu nào — người dùng đối chiếu màu để tìm nhầm lẫn về layer. */
export function layerColor(row: LayerRow): string | null {
  if (!row.rgb) return null;
  const [r, g, b] = row.rgb;
  return `rgb(${r} ${g} ${b})`;
}

/** Trạng thái của layer, dạng nhãn ngắn. Rỗng nghĩa là bình thường. */
export function layerFlags(row: LayerRow): string[] {
  const flags: string[] = [];
  if (row.off) flags.push("tắt");
  if (row.frozen) flags.push("đóng băng");
  if (row.locked) flags.push("khoá");
  if (!row.plottable) flags.push("không in");
  if (!row.inUse) flags.push("không dùng");
  return flags;
}

/** Bề dày nét, đổi từ đơn vị 1/100 mm của AutoCAD. */
export function lineweightLabel(value: number): string {
  if (value === -3) return "Default";
  if (value === -2) return "ByBlock";
  if (value === -1) return "ByLayer";
  if (value < 0) return "—";
  return `${(value / 100).toFixed(2)} mm`;
}

export type TypeBar = { type: string; count: number; share: number };

/** Số đối tượng theo kiểu, đã sắp giảm dần và kèm tỉ lệ để vẽ thanh. */
export function typeBars(raw: JsonRecord): TypeBar[] {
  const byType = record(record(normalize(raw).counts).byType);
  const rows = Object.entries(byType)
    .map(([type, value]) => ({ type, count: num(value) }))
    .filter((row) => row.count > 0)
    .sort((left, right) => right.count - left.count);
  const top = rows[0]?.count ?? 0;
  /* Tỉ lệ theo GIÁ TRỊ LỚN NHẤT, không theo tổng: một bản vẽ có 127 INSERT và
     1 CIRCLE thì chia theo tổng sẽ cho CIRCLE một thanh dài 0,4% — không nhìn
     thấy gì, và bảng mất luôn ý nghĩa so sánh. */
  return rows.map((row) => ({ ...row, share: top ? row.count / top : 0 }));
}

/** Đơn vị của `INSUNITS`. Bảng của AutoCAD, không phải quy ước của app. */
export function insUnitsLabel(value: number): string {
  const names: Record<number, string> = {
    0: "không đặt", 1: "inch", 2: "foot", 3: "mile", 4: "milimét",
    5: "centimét", 6: "mét", 7: "kilômét", 8: "microinch", 9: "mil",
    10: "yard", 11: "ångström", 12: "nanomét", 13: "micron", 14: "decimét",
    15: "decamét", 16: "hectomét", 17: "gigamét", 18: "đơn vị thiên văn",
    19: "năm ánh sáng", 20: "parsec",
  };
  return names[value] ?? "không rõ";
}

/** Bản vẽ có thay đổi chưa lưu không.
 *
 * `dbmod` là cờ bit, **khác 0 là đã sửa**. Đọc nó như một con số đếm (kiểu
 * `dbmod === 1`) sẽ bỏ sót mọi loại sửa khác — trên bản vẽ as-built giá trị là
 * 24, tức đã sửa mà kiểm bằng `=== 1` sẽ báo là sạch.
 */
export function isModified(raw: JsonRecord): boolean {
  return num(record(normalize(raw).document).dbmod) !== 0;
}

/** Khung bao của bản vẽ, **hoặc `null` nếu nó trộn các không gian**.
 *
 * `extents` của `drawing-info` gộp mọi không gian vào một cặp min/max. Model ở
 * toạ độ trắc địa còn layout tính bằng mm trên giấy, nên khi bản vẽ có cả hai
 * thì cặp số ấy không mô tả cái gì có thật. Trả `null` để màn hình nói "không
 * dùng được" thay vì in ra một khung rộng 3,8 triệu đơn vị.
 */
export function usableExtents(raw: JsonRecord): { min: number[]; max: number[] } | null {
  const payload = normalize(raw);
  const ext = record(payload.extents);
  const min = list(ext.min).map((v) => num(v));
  const max = list(ext.max).map((v) => num(v));
  if (min.length < 2 || max.length < 2) return null;
  const spaces = record(record(payload.counts).bySpace);
  const used = Object.entries(spaces).filter(([, v]) => num(v) > 0).length;
  /* Nhiều hơn một không gian có đối tượng → khung đã bị trộn. Đây là điều kiện
     đủ chặt: một bản vẽ chỉ có Model, hoặc chỉ có một layout, thì khung vẫn
     đúng. */
  return used > 1 ? null : { min, max };
}

/** Số đối tượng THẬT của bản vẽ, và các con số hay bị nhầm với nó. */
export function entityTotals(raw: JsonRecord): {
  entities: number;
  model: number;
  paper: number;
  blockRefs: number;
  /** Ước lượng số *object* trong database — gồm cả bảng ký hiệu và từ điển.
   * KHÔNG phải số đối tượng vẽ được. */
  approxObjects: number;
} {
  const counts = record(normalize(raw).counts);
  return {
    entities: num(counts.entities),
    model: num(counts.modelEntities),
    paper: num(counts.paperEntities),
    blockRefs: num(counts.blockReferences),
    approxObjects: num(counts.approxObjects),
  };
}

/* ------------------------------------------------------------------ *
 * Bộ tạo chọn
 * ------------------------------------------------------------------ */

/** Phạm vi mà `/selection/prepare` **thật sự** nhận.
 *
 * Bộ mẫu có thêm "theo kiểu đối tượng"; `cleanScope()` của daemon chỉ nhận
 * `layer`, `block`, `handles` và trả 400 cho mọi thứ khác. Dựng một ô chọn rồi
 * để nó ném lỗi là tệ hơn không dựng. */
export const SELECTION_SCOPES = ["layer", "block"] as const;
export type SelectionScopeKind = (typeof SELECTION_SCOPES)[number];

/** Thao tác `/selection/prepare` nhận. Bộ mẫu có "đặt màu theo layer" — backend
 * không có, và sẽ không có cho tới khi ai đó viết nó.
 *
 * `activate-document` KHÔNG nằm ở đây: nó không thao tác trên đối tượng nào cả
 * mà đổi **bản vẽ đang hoạt động**, nên nó có ô riêng ở đầu màn hình chứ không
 * chung một danh sách với hai thao tác kia. Gộp chung là mời người dùng chọn
 * "phạm vi: layer A" rồi bấm một nút đổi cả bản vẽ. */
export const SELECTION_ACTIONS = ["select", "move-to-layer"] as const;
export type SelectionActionKind = (typeof SELECTION_ACTIONS)[number];

export function scopeLabel(kind: SelectionScopeKind): string {
  return kind === "layer" ? "Theo layer" : "Theo tên block";
}

export function actionLabel(kind: SelectionActionKind): string {
  return kind === "select"
    ? "Chọn trong AutoCAD (theo phạm vi)"
    : "Gán bộ chọn sang layer khác";
}

/** Thao tác này chạy trên cái gì. Hiện thẳng lên màn hình, vì hai thao tác chạy
 * trên hai tập khác nhau và không có gì trên giao diện gợi ý điều đó. */
export function actionSubjectNote(kind: SelectionActionKind, payload: JsonRecord | null): string {
  if (kind === "select") {
    return "Chạy trên phạm vi bạn chọn bên trên.";
  }
  const count = selectedCount(payload);
  return `Chạy trên bộ chọn của AutoCAD — ${count} đối tượng lúc đọc hồ sơ. `
    + "Phạm vi ở trên không áp dụng cho thao tác này.";
}

/** Giá trị chọn được cho một phạm vi. */
export function scopeValues(raw: JsonRecord, kind: SelectionScopeKind): string[] {
  const payload = normalize(raw);
  const tables = record(payload.tables);
  if (kind === "layer") {
    return layerRows(payload).map((row) => row.name).sort((a, b) => a.localeCompare(b));
  }
  return list(tables.blocks)
    .map((raw) => str(record(raw).name))
    /* Bỏ block của layout (`*Model_Space`, `*Paper_Space`) và block ẩn danh:
       không ai chèn chúng, nên chọn theo tên chúng là chọn được số không. */
    .filter((name) => name && !name.startsWith("*"))
    .sort((a, b) => a.localeCompare(b));
}

/** Đích của một thao tác ghi: **đường dẫn tệp, hoặc tiêu đề nếu chưa lưu**.
 *
 * Bản vẽ chưa từng lưu không có đường dẫn — `document.file` rỗng, chỉ có
 * `title` như `Drawing1.dwg`. Gửi đích rỗng thì daemon tự phân giải sang **bản
 * vẽ đang hoạt động**, mà đó có thể là một bản vẽ KHÁC nếu người dùng chuyển
 * tab AutoCAD sau khi trang đã tải. Ghi nhầm bản vẽ là loại lỗi không có đường
 * lùi.
 *
 * Đúng thứ tự `file || title` mà daemon dùng để phân giải.
 */
export function operationTarget(payload: JsonRecord | null): string {
  const doc = record(normalize(payload).document);
  const file = typeof doc.file === "string" ? doc.file.trim() : "";
  if (file) return file;
  return typeof doc.title === "string" ? doc.title.trim() : "";
}

/** Số đối tượng ĐANG ĐƯỢC CHỌN trong AutoCAD, **tại thời điểm đọc hồ sơ**.
 *
 * Không phải chi tiết phụ: `move-to-layer` chạy trên đúng tập này.
 *
 * Đã kiểm trên máy thật: chọn một đối tượng trong AutoCAD rồi đọc lại thì
 * `counts.selected` ra `1` kèm `selection.objects` đúng handle. Nhưng nó là ảnh
 * chụp — chọn thêm trong AutoCAD SAU khi trang đã tải thì con số này vẫn là con
 * số cũ, nên chỗ nào chặn theo nó cũng phải chỉ đường "Đọc lại".
 */
export function selectedCount(payload: JsonRecord | null): number {
  return num(record(normalize(payload).counts).selected);
}

/** Vì sao chưa chuẩn bị được thao tác — hoặc chuỗi rỗng nếu chuẩn bị được.
 *
 * ⚠️ Hai thao tác chạy trên hai TẬP KHÁC NHAU, và đây là chỗ dễ gây ghi nhầm
 * nhất của cả màn hình:
 *
 *  - `select` chạy trên **phạm vi** (layer / block) người dùng chọn ở đây.
 *  - `move-to-layer` **bỏ qua phạm vi hoàn toàn** — daemon gọi `captureCurrent()`
 *    và ghi lên **bộ chọn hiện tại của AutoCAD**. Gửi kèm một `scope` rồi ghi
 *    "gán layer P-ThoatXi sang X" lên thẻ xác nhận là mô tả một việc KHÁC hẳn
 *    việc sắp xảy ra.
 */
export function prepareBlockedReason(input: {
  payload: JsonRecord | null;
  scope: SelectionScopeKind;
  value: string;
  action: SelectionActionKind;
  targetLayer: string;
}): string {
  if (!input.payload) return "Chưa đọc được hồ sơ bản vẽ.";
  const payload = normalize(input.payload);

  if (input.action === "select") {
    if (!input.value) return "Chưa chọn giá trị cho phạm vi.";
    /* Bản vẽ chỉ đọc VẪN chọn được: daemon chỉ chặn chỉ-đọc cho `move-to-layer`.
       Chặn cả hai là tự tay bỏ một tính năng backend cho phép. */
    return "";
  }

  if (record(payload.document).readOnly === true) {
    return "Bản vẽ đang mở ở chế độ chỉ đọc.";
  }
  if (!selectedCount(payload)) {
    /* Con số này là ẢNH CHỤP lúc đọc hồ sơ. Không chỉ đường "Đọc lại" thì người
       dùng chọn tay trong AutoCAD xong quay lại đây, thấy nút vẫn khoá, và
       không có gì trên màn hình nói cho họ biết vì sao. */
    return "Lúc đọc hồ sơ, AutoCAD chưa chọn đối tượng nào. Chọn trong AutoCAD "
      + "(hoặc dùng thao tác “Chọn” ở trên) rồi bấm “Đọc lại”.";
  }
  if (!input.targetLayer) return "Chưa chọn layer đích.";
  const target = layerRows(payload).find((row) => row.name === input.targetLayer);
  /* Máy chủ cũng từ chối, nhưng nói trước thì người dùng đổi được ngay thay vì
     đọc một mã lỗi sau khi đã bấm. */
  if (target?.locked) return `Layer đích ${input.targetLayer} đang khoá.`;
  if (target?.frozen) return `Layer đích ${input.targetLayer} đang đóng băng.`;
  return "";
}

/** Bản vẽ AutoCAD đang hoạt động, theo **danh sách bản vẽ** — không theo hồ sơ.
 *
 * Hai nguồn này đọc ở hai thời điểm khác nhau: hồ sơ là ảnh chụp nặng đọc một
 * lần, còn danh sách bản vẽ nhẹ và mới hơn. Người dùng đổi tab trong AutoCAD
 * sau khi trang tải thì hai nguồn lệch nhau, và nguồn MỚI HƠN mới là sự thật.
 */
export function activeDocFile(docs: readonly { file?: string; title?: string; active?: boolean }[]): string {
  const active = docs.find((doc) => doc.active === true);
  return (active?.file || active?.title || "").trim();
}

/** Hồ sơ trên màn hình có còn nói về bản vẽ AutoCAD đang mở không.
 *
 * Rỗng nghĩa là khớp. Khác rỗng là cả trang — bảng layer, số đếm, bộ tạo thao
 * tác — đang mô tả một bản vẽ KHÁC với bản vẽ AutoCAD đang ở. Không nói ra thì
 * người dùng chuẩn bị một thao tác dựa trên bảng layer của bản vẽ A và ghi vào
 * bản vẽ B.
 */
export function staleDrawingNote(
  payload: JsonRecord | null,
  docs: readonly { file?: string; title?: string; active?: boolean }[],
): string {
  const shown = operationTarget(payload);
  const active = activeDocFile(docs);
  if (!shown || !active || shown === active) return "";
  const name = (s: string) => s.split("/").pop() || s;
  return `Hồ sơ dưới đây đọc từ ${name(shown)}, nhưng AutoCAD đang ở `
    + `${name(active)}. Bấm “Đọc lại” để đọc bản vẽ đang mở.`;
}

/** Vì sao chưa đổi được sang bản vẽ này — hoặc chuỗi rỗng nếu đổi được.
 *
 * Đổi bản vẽ hoạt động là **lệnh ghi** theo backend (`activate-document` đi qua
 * `/selection/prepare`), dù nó không sửa đối tượng nào. Lý do: nó đổi thứ mà
 * MỌI lệnh ghi sau đó nhắm vào — chọn nhầm ở đây là mọi thứ sau đó ghi nhầm bản
 * vẽ.
 */
export function activateBlockedReason(input: {
  target: string;
  activeFile: string;
  alive: boolean;
}): string {
  if (!input.alive) return "Plugin AcadBridge chưa phản hồi.";
  if (!input.target) return "Chưa chọn bản vẽ.";
  if (input.target === input.activeFile) return "Bản vẽ này đang là bản vẽ hoạt động.";
  return "";
}

/** Câu mô tả phạm vi mà bộ tạo chọn với tới được.
 *
 * Danh mục đối tượng của daemon chỉ quét **không gian hiện hành**, nên thao tác
 * cũng chỉ chạm tới không gian đó. Không nói ra thì người dùng chuẩn bị một
 * thao tác "gán cả layer P-ThoatRua sang layer khác" và tưởng nó chạm tới cả
 * 125 đối tượng, trong khi 115 cái nằm ở Model và không hề bị đụng tới.
 */
export function selectionScopeNote(payload: JsonRecord | null): string {
  const scope = record(normalize(payload).selectionScope);
  const space = str(scope.space);
  if (!space) return "";
  const scanned = num(scope.scanned);
  const complete = scope.complete !== false;
  return `Chỉ chạm tới ${scanned} đối tượng trong không gian ${space} — không gian `
    + `AutoCAD đang mở.${complete ? "" : " Danh mục còn chưa quét hết."}`;
}

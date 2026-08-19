import { createHash, randomUUID } from "node:crypto";
import express, { type Router } from "express";
import {
  listOpenDocs,
  nativeDocumentTarget,
  requestDrawingInfo,
  selectOpenDocument,
  type OpenAcadDocument,
  type DrawingInfoPluginSnapshot,
} from "./acadBridge.js";
import { invokeRaw } from "./objectarx/rawDispatch.js";
import type { RawParams } from "./objectarx/rawJob.js";

export const CAD_SELECTION_CAPABILITY = "ed.selection_control";
export const CAD_SELECTION_TTL_MS = 5 * 60 * 1_000;
export const CAD_SELECTION_MAX_SUBJECTS = 5_000;

const HANDLE_RE = /^[0-9A-F]+$/;
const SUBJECT_PREVIEW_LIMIT = 100;
const MAX_OPERATIONS = 200;

// `dbmod` và `space` cố ý ở ngoài `Required`: plugin bản cũ không phát chúng, và
// thiếu nghĩa là KHÔNG BIẾT chứ không phải dữ liệu hỏng. Bốn trường còn lại vẫn
// bắt buộc — thiếu chúng là phản hồi plugin không hợp lệ.
//
// `Required<Omit<...>>` là một cái bẫy: mọi trường tuỳ chọn THÊM VÀO
// `OpenAcadDocument` sau này đều tự động thành bắt buộc ở đây, và lỗi chỉ hiện
// ra ở `completeDocument()` chứ không ở chỗ vừa sửa. Đã sập đúng một lần khi
// thêm `space`.
/* `dbmod`, `space`, `targetsInstance` ở lại dạng TUỲ CHỌN: cả ba vắng mặt trên
   bản plugin cũ, và ép chúng thành bắt buộc là biến "plugin không nói gì" thành
   một giá trị bịa. */
type OpenDocument =
  Required<Omit<OpenAcadDocument, "dbmod" | "space" | "targetsInstance">>
  & Pick<OpenAcadDocument, "dbmod" | "space" | "targetsInstance">;

type DocumentGuard = {
  instance: string;
  revision: number;
  activeInstance: string;
  /** Không gian hiện hành LÚC CHUẨN BỊ (Model, hoặc tên layout).
   *
   * Đổi tab Model/Layout không sửa đối tượng nào, nên `revision` KHÔNG hứa bắt
   * được nó — trên máy thật nó có nhảy khi AutoCAD dựng lại viewport, nhưng đó
   * là tác dụng phụ chứ không phải bảo đảm, và quay lại một layout đã kích hoạt
   * trước đó thì không còn gì để dựng.
   *
   * Vì sao phải ở ĐÂY chứ không chỉ ở giao diện: màn hình phát hiện đổi tab qua
   * sự kiện SSE, mà luồng đó đứt được. Chốt duy nhất không phụ thuộc vào một
   * kênh có thể chết là chốt do chính daemon chụp lúc chuẩn bị và so lại lúc
   * ghi.
   *
   * `undefined` khi plugin bản cũ không phát `space` — lúc đó không so, vì so
   * với "không biết" thì mọi thao tác đều bị từ chối. */
  space?: string;
};

type CatalogGuard = {
  instance: string;
  revision: number;
};

type CatalogScope = {
  kind: "layer" | "block";
  name: string;
  handle: string;
  selectedAll: boolean;
};

export type SelectionSubject = {
  handle: string;
  type: string;
  layer: string;
  layerHandle: string;
  ownerHandle: string;
};

export type SelectionScope =
  | { kind: "layer"; name: string; handle?: string }
  | { kind: "block"; name: string; handle?: string }
  | { kind: "handles"; handles: string[] };

export type SelectionAction =
  | "activate-document"
  | "select"
  | "move-to-layer";

type OperationState =
  | "pending"
  | "applying"
  | "applied"
  | "rejected"
  | "failed"
  | "expired";

type OperationSummary = {
  count?: number;
  fromLayers?: string[];
  toLayer?: string;
  scopeKind?: SelectionScope["kind"];
  scopeName?: string;
};

type SelectionOperation = {
  id: string;
  revision: string;
  action: SelectionAction;
  state: OperationState;
  target: string;
  document: OpenDocument;
  scope?: SelectionScope;
  catalogScope?: CatalogScope;
  params?: { layer: string; handle: string };
  summary: OperationSummary;
  subjects: SelectionSubject[];
  selectionBefore: SelectionSubject[];
  subjectCount: number;
  guard: DocumentGuard;
  createdAt: string;
  expiresAt: string;
  error?: string;
};

export type SelectionNativeAction =
  | "activate"
  | "capture"
  | "resolve"
  | "select"
  | "move";

export type SelectionNativeCommand = {
  action: SelectionNativeAction;
  token: string;
  exactTarget: string;
  params: RawParams;
};

export type SelectionNativeResult = {
  ok: boolean;
  token?: string;
  action?: string;
  target?: string;
  count?: number;
  changed?: number;
  subjects?: unknown;
  code?: string;
  error?: string;
};

export type CadSelectionDependencies = {
  listOpenDocs: typeof listOpenDocs;
  requestDrawingInfo: typeof requestDrawingInfo;
  invokeSelectionControl: (
    command: SelectionNativeCommand,
  ) => Promise<SelectionNativeResult>;
  now: () => number;
  randomId: () => string;
};

class SelectionApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function rows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(record) : [];
}

function cleanText(value: unknown, label: string, max = 255): string {
  const text = String(value ?? "").trim();
  if (!text || text.length > max || /[\0\r\n\t]/.test(text)) {
    throw new SelectionApiError("invalid_request", `${label} không hợp lệ`);
  }
  return text;
}

function cleanHandle(value: unknown): string {
  const handle = String(value ?? "").trim().toUpperCase();
  if (!handle || handle.length > 16 || !HANDLE_RE.test(handle)) {
    throw new SelectionApiError("invalid_scope", "Handle AutoCAD không hợp lệ");
  }
  return handle.replace(/^0+(?=[0-9A-F])/, "");
}

function cleanHandles(value: unknown, singular?: unknown): string[] {
  const source = [
    ...(singular == null || singular === "" ? [] : [singular]),
    ...(Array.isArray(value) ? value : value == null ? [] : [value]),
  ];
  const handles = [...new Set(source.map(cleanHandle))];
  if (!handles.length) {
    throw new SelectionApiError(
      "selection_empty",
      "Cần ít nhất một handle để tạo selection",
      409,
    );
  }
  if (handles.length > CAD_SELECTION_MAX_SUBJECTS) {
    throw new SelectionApiError(
      "selection_too_large",
      `Selection vượt quá ${CAD_SELECTION_MAX_SUBJECTS} đối tượng`,
      409,
    );
  }
  return handles;
}

function cleanScope(value: unknown): SelectionScope {
  const scope = record(value);
  const kind = String(scope.kind ?? "");
  if (kind === "layer" || kind === "block") {
    return {
      kind,
      name: cleanText(
        scope.name,
        kind === "layer" ? "Tên layer" : "Tên block",
      ),
      ...(scope.handle == null || scope.handle === ""
        ? {}
        : { handle: cleanHandle(scope.handle) }),
    };
  }
  if (kind === "handles") {
    return {
      kind,
      handles: cleanHandles(scope.handles, scope.handle),
    };
  }
  throw new SelectionApiError(
    "invalid_scope",
    "scope.kind phải là layer, block hoặc handles",
  );
}

function cleanCatalogGuard(value: unknown): CatalogGuard {
  const guard = record(value);
  if (typeof guard.instance !== "string") {
    throw new SelectionApiError(
      "invalid_request",
      "catalogGuard.instance không hợp lệ",
    );
  }
  const instance = cleanText(
    guard.instance,
    "catalogGuard.instance",
    128,
  );
  if (
    typeof guard.revision !== "number" ||
    !Number.isSafeInteger(guard.revision) ||
    guard.revision < 0
  ) {
    throw new SelectionApiError(
      "invalid_request",
      "catalogGuard.revision không hợp lệ",
    );
  }
  return { instance, revision: guard.revision };
}

function cleanCatalogScope(value: unknown): CatalogScope {
  const scope = record(value);
  const kind = String(scope.kind ?? "");
  if (kind !== "layer" && kind !== "block") {
    throw new SelectionApiError(
      "invalid_request",
      "catalogScope.kind phải là layer hoặc block",
    );
  }
  if (typeof scope.selectedAll !== "boolean") {
    throw new SelectionApiError(
      "invalid_request",
      "catalogScope.selectedAll không hợp lệ",
    );
  }
  return {
    kind,
    name: cleanText(
      scope.name,
      kind === "layer" ? "Tên layer gốc" : "Tên block gốc",
    ),
    handle: cleanHandle(scope.handle),
    selectedAll: scope.selectedAll,
  };
}

function utf8Hex(value: string): string {
  return Buffer.from(value, "utf8").toString("hex");
}

function exactCount(value: unknown): number {
  const count = Number(value);
  if (!Number.isInteger(count) || count < 0) {
    throw new SelectionApiError(
      "native_response_invalid",
      "Plugin trả số lượng selection không hợp lệ",
      502,
    );
  }
  return count;
}

function nativeText(value: unknown, label: string, max = 255): string {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || text.length > max || /[\0\r\n\t]/.test(text)) {
    throw new SelectionApiError(
      "native_response_invalid",
      `Plugin trả ${label} không hợp lệ`,
      502,
    );
  }
  return text;
}

function nativeHandle(value: unknown, label: string): string {
  const handle = typeof value === "string"
    ? value.trim().toUpperCase()
    : "";
  if (!handle || handle.length > 16 || !HANDLE_RE.test(handle)) {
    throw new SelectionApiError(
      "native_response_invalid",
      `Plugin trả ${label} không hợp lệ`,
      502,
    );
  }
  return handle.replace(/^0+(?=[0-9A-F])/, "");
}

function nativeSubject(value: unknown, requireGuards = true): SelectionSubject {
  const subject = record(value);
  const handle = nativeHandle(subject.handle, "handle đối tượng");
  const type = nativeText(subject.type, "loại đối tượng");
  const layer = nativeText(subject.layer, "layer đối tượng");
  const layerHandle = requireGuards
    ? nativeHandle(subject.layerHandle, "layerHandle")
    : String(subject.layerHandle ?? "").trim().toUpperCase();
  const ownerHandle = requireGuards
    ? nativeHandle(subject.ownerHandle, "ownerHandle")
    : String(subject.ownerHandle ?? "").trim().toUpperCase();
  return {
    handle,
    type,
    layer,
    layerHandle,
    ownerHandle,
  };
}

function normalizeNativeSubjects(
  result: SelectionNativeResult,
  options: { allowEmpty?: boolean; requireGuards?: boolean } = {},
): SelectionSubject[] {
  const count = exactCount(result.count);
  const source = Array.isArray(result.subjects) ? result.subjects : [];
  if (source.length !== count) {
    throw new SelectionApiError(
      "native_response_invalid",
      "Plugin trả count không khớp danh sách đối tượng",
      502,
    );
  }
  if (!options.allowEmpty && count === 0) {
    throw new SelectionApiError(
      "selection_empty",
      "AutoCAD hiện không có đối tượng nào trong Pickfirst selection",
      409,
    );
  }
  if (count > CAD_SELECTION_MAX_SUBJECTS) {
    throw new SelectionApiError(
      "selection_too_large",
      `Selection vượt quá ${CAD_SELECTION_MAX_SUBJECTS} đối tượng`,
      409,
    );
  }
  const subjects = source.map((item) =>
    nativeSubject(item, options.requireGuards !== false));
  if (new Set(subjects.map((item) => item.handle)).size !== subjects.length) {
    throw new SelectionApiError(
      "native_response_invalid",
      "Plugin trả handle selection bị trùng",
      502,
    );
  }
  return subjects;
}

function snapshotRows(
  snapshot: DrawingInfoPluginSnapshot,
  key: "layers" | "blocks",
): Record<string, unknown>[] {
  const root = record(snapshot);
  const tables = record(root.tables);
  const drawing = record(root.drawing);
  return rows(tables[key] ?? drawing[key] ?? root[key]);
}

function snapshotDocument(
  snapshot: DrawingInfoPluginSnapshot,
): Record<string, unknown> {
  return record(record(snapshot).document);
}

function documentRevision(value: unknown, label: string): number {
  const revision = Number(value);
  if (!Number.isSafeInteger(revision) || revision < 0) {
    throw new SelectionApiError(
      "plugin_update_required",
      `${label} không có revision hợp lệ; cần reload AcadBridge 1.4.0`,
      502,
    );
  }
  return revision;
}

function completeDocument(value: OpenAcadDocument, label: string): OpenDocument {
  const title = nativeText(value.title, `${label}.title`, 512);
  const file = typeof value.file === "string" ? value.file.trim() : "";
  if (file.length > 4096 || /[\0\r\n\t]/.test(file)) {
    throw new SelectionApiError(
      "native_response_invalid",
      `Plugin trả ${label}.file không hợp lệ`,
      502,
    );
  }
  return {
    title,
    file,
    active: value.active === true,
    instance: nativeText(value.instance, `${label}.instance`, 128),
    revision: documentRevision(value.revision, label),
    /* GIỮ `space` lại. Bỏ nó ở đây làm mọi chốt không gian phía dưới thành
       no-op trong im lặng — `guard.space` luôn `undefined` nên phép so luôn bị
       bỏ qua, và nhìn từ ngoài thì trông hệt như đã có chốt. Đã sập đúng một
       lần: chốt viết xong, verify xanh, nhưng nó không bao giờ chạy.
       `dbmod` KHÔNG cần giữ vì không chốt nào dùng tới nó.

       Phân biệt HAI thứ mà cả hai đều "rỗng":
         · thiếu hẳn trường  → plugin bản cũ, không có gì để so → `undefined`
         · trường rỗng       → plugin CÓ trả lời nhưng không mở được BTR của
                               không gian hiện hành, tức không biết mình đang ở
                               đâu → giữ nguyên `""` để chốt phía dưới TỪ CHỐI
       Gộp hai cái làm một là biến một lần đọc hỏng thành giấy phép đi qua. */
    space: typeof value.space === "string" ? value.space.trim().slice(0, 256) : undefined,
    /* GIỮ `targetsInstance` lại — cùng lý do với `space`, và tôi vừa sập đúng
       vào cái bẫy mà đoạn trên cảnh báo.
       Bỏ nó ở đây làm `nativeDocumentTarget()` phía dưới thấy `undefined`, tức
       "plugin không nhận mã phiên", nên nó lùi về TIÊU ĐỀ. Hai bản vẽ chưa lưu
       trùng tiêu đề vừa được `selectOpenDocument` chọn đúng bằng mã phiên sẽ lại
       chết ở `target_ambiguous` ngay bước sau — chốt viết xong, verify xanh, mà
       cả đường vẫn hỏng. */
    targetsInstance: value.targetsInstance === true ? true : undefined,
  };
}

/** Vì sao hai không gian không dùng chung được — hoặc `null` nếu dùng được.
 *
 * `undefined` ở một trong hai vế = plugin bản cũ không phát `space`; không có
 * gì để so nên cho qua, giống mọi trường tuỳ chọn khác.
 *
 * Chuỗi RỖNG thì ngược lại: plugin có trả lời nhưng không đọc được không gian
 * hiện hành. Cho qua lúc đó là để một lệnh ghi chạy mà không ai biết nó chạm
 * vào không gian nào — đúng thứ chốt này sinh ra để chặn.
 */
export function spaceMismatchReason(
  prepared: string | undefined,
  current: string | undefined,
): string | null {
  /* Luật BẤT ĐỐI XỨNG, và sự bất đối xứng đó là cả vấn đề:

     `prepared === undefined` → chưa từng biết không gian nào để mà so. Hai
     đường tới đây, cả hai đều hợp lệ: plugin bản cũ không phát `space` trong
     `/docs` (nhưng VẪN phát `selectionCatalog.space`, nên vế kia có giá trị —
     đây chính là ca nâng cấp daemon mà chưa nâng plugin), và tài liệu nền mà
     plugin cố ý bỏ trường. Chặn ở đây là làm hỏng mọi thao tác trên một cấu
     hình hợp lệ.

     `current === undefined` trong khi `prepared` CÓ giá trị → ta từng biết, giờ
     không. Đó là một lần đọc hỏng, hoặc plugin bị hạ cấp giữa lúc chuẩn bị và
     lúc ghi — và plugin cũ thì cũng không tự kiểm. Cho qua lúc đó là để lệnh
     ghi chạy mà không ai xác nhận nó chạm vào đâu. */
  if (prepared === undefined) return null;
  if (current === undefined) {
    return "không xác định được không gian hiện hành của bản vẽ";
  }
  /* Có trường nhưng rỗng: plugin trả lời được nhưng không mở được BTR của không
     gian hiện hành, tức AutoCAD không biết mình đang ở đâu. */
  if (!prepared || !current) {
    return "không đọc được không gian hiện hành của bản vẽ";
  }
  if (prepared === current) return null;
  return `AutoCAD đang ở không gian ${current}, còn thao tác chuẩn bị cho `
    + `không gian ${prepared}`;
}

/** Không gian mà lượt quét `drawing-info` ĐÃ quét. Hai đường vì payload plugin
 *  phát cả dạng gốc lẫn dạng lồng — xem `normalize()` phía web. */
function snapshotScannedSpace(
  snapshot: DrawingInfoPluginSnapshot,
): string | undefined {
  const root = record(snapshot);
  const nested = record(root.drawing);
  for (const source of [root.selectionCatalog, root.selectionScope,
    nested.selectionCatalog, nested.selectionScope]) {
    const space = record(source).space;
    /* Trả CẢ chuỗi rỗng. Đây là chỗ thứ ba trong cùng một lượt tôi suýt gộp
       "plugin không đọc được" vào "plugin bản cũ" — bỏ qua rỗng ở đây làm
       `snapshotGuard` nhận một ảnh chụp mà chính plugin không biết nó thuộc
       không gian nào. `undefined` chỉ dành cho trường hợp KHÔNG NGUỒN NÀO có
       khoá `space`. */
    if (typeof space === "string") return space.trim();
  }
  return undefined;
}

function snapshotGuard(
  snapshot: DrawingInfoPluginSnapshot,
  document: OpenDocument,
  activeDocument: OpenDocument,
): DocumentGuard {
  const current = snapshotDocument(snapshot);
  const instance = nativeText(
    current.instance,
    "document.instance",
    128,
  );
  const revision = documentRevision(current.revision, "document");
  if (instance !== document.instance) {
    throw new SelectionApiError(
      "document_stale",
      "Phiên bản vẽ đã thay đổi trong lúc chuẩn bị thao tác",
      409,
    );
  }

  /* Ảnh chụp và `/docs` đọc ở hai thời điểm.  Đổi tab giữa hai lượt đó không
     làm revision nhúc nhích khi layout đã được kích hoạt trước đó, nên hai phép
     so trên đều lọt — mà `subjects` thì đã lấy từ không gian MỚI trong khi
     chốt mang không gian CŨ.  Quay về tab cũ trước khi ghi là chốt lúc apply
     cũng lọt nốt, và thao tác chạy trên một tập đối tượng không ai nhìn thấy.
     Bỏ qua khi một trong hai vế không biết (plugin bản cũ không phát). */
  /* Không gian của ảnh chụp nằm ở `selectionCatalog`/`selectionScope`, KHÔNG ở
     `document` — đã đối chiếu với phản hồi thật: `document.space` luôn `null`
     trong `drawing-info`. Đọc nhầm chỗ thì chốt này không bao giờ bắn, và không
     có gì báo cho biết. */
  const snapshotSpace = snapshotScannedSpace(snapshot);
  /* Không gian xét TRƯỚC revision — cùng lý do như ở nhánh apply: đổi tab
     thường kéo revision nhảy theo, nên để revision chạy trước là báo "nội dung
     bản vẽ đã thay đổi" cho một cú bấm sang tab khác, và người dùng đi tìm một
     thay đổi không có thật. Hai nhánh phải nói CÙNG một câu cho cùng một việc. */
  /* CHỈ xét khi đích là tài liệu đang hoạt động. `activate-document` cố ý nhắm
     vào một tài liệu NỀN — mà plugin cố ý không phát `space` cho tài liệu nền
     (đọc database không-current phải lock). So hai thứ đó là từ chối đúng cái
     lệnh dùng để ĐỔI sang bản vẽ đang cần, tức bịt đường phục hồi. */
  const snapshotDrift = document.active
    ? spaceMismatchReason(document.space, snapshotSpace)
    : null;
  if (snapshotDrift) {
    throw new SelectionApiError(
      "space_changed",
      `${snapshotDrift}; hãy quét lại`,
      409,
    );
  }
  if (revision !== document.revision) {
    throw new SelectionApiError(
      "drawing_stale",
      "Nội dung bản vẽ đã thay đổi trong lúc chuẩn bị thao tác",
      409,
    );
  }
  return {
    instance,
    revision,
    activeInstance: activeDocument.instance,
    space: document.space,
  };
}

/**
 * A listOpenDocs response already carries the document instance/revision
 * guards.  Handles scopes do not need the large drawing-info snapshot just to
 * validate a layer/block table entry; the native resolve/select call still
 * re-checks these guards and each subject identity.
 */
function listDocumentGuard(
  document: OpenDocument,
  activeDocument: OpenDocument,
): DocumentGuard {
  return {
    instance: document.instance,
    revision: document.revision,
    activeInstance: activeDocument.instance,
    space: document.space,
  };
}

function findSnapshotEntry(
  snapshot: DrawingInfoPluginSnapshot,
  key: "layers" | "blocks",
  requested: string,
): { name: string; handle: string } | null {
  const wanted = requested.toLocaleUpperCase("en-US");
  for (const item of snapshotRows(snapshot, key)) {
    const candidates = key === "layers"
      ? [item.name]
      : [item.name, item.cadName, item.technicalName];
    const found = candidates.find((candidate) =>
      String(candidate ?? "").toLocaleUpperCase("en-US") === wanted);
    if (found != null) {
      return {
        name: String(found),
        handle: String(item.handle ?? "").trim().toUpperCase(),
      };
    }
  }
  return null;
}

function operationRevision(
  value: Omit<SelectionOperation, "revision" | "state" | "error">,
): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Bản GỌN cho lượt liệt kê — bỏ những mảng chỉ có nghĩa khi xem MỘT thao tác.
 *
 * `operationView()` kèm cả `scope.handles` (tới 5.000 phần tử) và bản xem trước
 * `subjects`. Đường `/operations` bị hỏi **mỗi 5 giây** ở mọi màn hình có thanh
 * trên, trong khi bảng chỉ cần vài trường tóm tắt — trả bản đầy đủ là serialize,
 * truyền và parse hàng nghìn phần tử mỗi lượt cho không ai đọc.
 *
 * GIỮ `scope.kind` + `scope.name`: giao diện dùng chúng để nói "chọn layer
 * A-WALL" ở thẻ xác nhận. Bỏ chúng thì hai đề xuất trên cùng một bản vẽ trông y
 * hệt nhau.
 */
/** Số đối tượng này có ĐÁNG TIN không.
 *
 * Tách riêng vì cả bản đầy đủ lẫn bản gọn đều phải trả lời giống hệt nhau: web
 * phân biệt `0` ("không chạm đối tượng nào") với trường THIẾU ("không biết"),
 * và hai câu đó dẫn tới hai quyết định khác nhau ở người sắp bấm một nút ghi
 * không hoàn tác được. Hai bản trả lời lệch nhau thì cùng một thao tác đọc ở
 * bảng hàng chờ và ở thẻ xác nhận lại ra hai con số.
 */
function subjectCountKnown(operation: SelectionOperation): boolean {
  return (
    operation.action === "move-to-layer" ||
    (operation.action === "select" &&
      (operation.scope?.kind === "handles" || operation.subjectCount > 0))
  );
}

/** Bản gọn cho đường liệt kê — dựng bằng danh sách CHO PHÉP, không phải bằng
 * cách trừ bớt `operationView()`.
 *
 * Đường này bị hỏi **mỗi 5 giây** ở mọi màn hình có thanh trên, nên mọi trường
 * không giới hạn độ dài đều là chi phí nhân với nhịp đó: `subjects` (bản xem
 * trước), `scope.handles` (tới 5.000 phần tử), `summary.fromLayers` (mọi layer
 * nguồn), `params`, `catalogScope`.
 *
 * Bản đầu tiên tôi viết liệt kê những trường cần BỎ. Nó bỏ sót `fromLayers`
 * ngay lượt review kế tiếp — và sẽ bỏ sót y như vậy với mọi trường thêm sau
 * này, vì trường mới mặc định được đi kèm. Danh sách CHO PHÉP thì hỏng theo
 * chiều ngược lại: quên khai một trường thì màn hình thiếu dữ liệu và thấy
 * ngay, thay vì âm thầm phình payload.
 *
 * Danh sách này phải khớp đúng phần `normalizeQueuedOp()` bên web đọc tới. */
function operationListView(operation: SelectionOperation) {
  const summary = operation.summary || {};
  const scope = operation.scope;
  return {
    id: operation.id,
    revision: operation.revision,
    action: operation.action,
    state: operation.state,
    target: operation.target,
    document: operation.document,
    summary: {
      ...(summary.count === undefined ? {} : { count: summary.count }),
      ...(summary.toLayer === undefined ? {} : { toLayer: summary.toLayer }),
      ...(summary.scopeKind === undefined ? {} : { scopeKind: summary.scopeKind }),
      ...(summary.scopeName === undefined ? {} : { scopeName: summary.scopeName }),
    },
    expiresAt: operation.expiresAt,
    ...(subjectCountKnown(operation) ? { subjectCount: operation.subjectCount } : {}),
    /* Tách theo biến thể chứ không ép kiểu: `handles` KHÔNG có `name`, và nếu
       sau này thêm một biến thể mang trường dài thì trình biên dịch bắt được ở
       đây thay vì để nó lọt vào nhịp 5 giây. */
    ...(scope
      ? { scope: scope.kind === "handles" ? { kind: scope.kind } : { kind: scope.kind, name: scope.name } }
      : {}),
    ...(operation.error ? { error: operation.error } : {}),
  };
}

function operationView(operation: SelectionOperation) {
  const preview = operation.subjects.slice(0, SUBJECT_PREVIEW_LIMIT);
  return {
    id: operation.id,
    revision: operation.revision,
    action: operation.action,
    state: operation.state,
    target: operation.target,
    document: operation.document,
    summary: operation.summary,
    expiresAt: operation.expiresAt,
    ...(subjectCountKnown(operation) ? { subjectCount: operation.subjectCount } : {}),
    ...(operation.scope ? { scope: operation.scope } : {}),
    ...(operation.catalogScope ? { catalogScope: operation.catalogScope } : {}),
    ...(operation.params ? { params: operation.params } : {}),
    ...(preview.length ? { subjects: preview } : {}),
    subjectsTruncated: operation.subjects.length > preview.length,
    ...(operation.error ? { error: operation.error } : {}),
  };
}

function buildExpectedSubjects(subjects: SelectionSubject[]): string {
  return subjects.map((subject) => [
    subject.handle,
    utf8Hex(subject.type),
    subject.layerHandle,
    subject.ownerHandle,
  ].join(",")).join(";");
}

export function buildSelectionControlParams(input: {
  action: SelectionNativeAction;
  token: string;
  exactTarget: string;
  guard: DocumentGuard;
  scope?: SelectionScope;
  catalogScope?: CatalogScope;
  subjects?: SelectionSubject[];
  selectionBefore?: SelectionSubject[];
  destLayer?: string;
  destLayerHandle?: string;
}): RawParams {
  const params: RawParams = {
    token: input.token,
    action: input.action,
    exactTargetHex: utf8Hex(input.exactTarget),
    documentInstance: input.guard.instance,
    databaseRevision: input.guard.revision,
    activeDocumentInstance: input.guard.activeInstance,
  };
  /* Không gian phải đi CÙNG lệnh, không dừng ở daemon.  Giữa lúc daemon đọc
     `/docs` và lúc AutoCAD thật sự chạy lệnh đã xếp hàng còn một quãng nữa —
     đổi tab đúng trong quãng đó thì mọi chốt phía trên đều đã qua. Plugin so
     lại ngay trước khi chạy; thiếu tham số này thì plugin bỏ qua, nên daemon
     mới vẫn chạy được với plugin cũ. */
  /* Giao thức raw chỉ có chuỗi, và `param()` bên plugin trả "" cho khoá thiếu —
     nên giá trị rỗng KHÔNG phân biệt được với không gửi. Gửi kèm một cờ hiện
     diện riêng: có cờ = daemon đòi kiểm, và lúc đó chuỗi rỗng nghĩa là "không
     đọc được", tức phải TỪ CHỐI chứ không phải bỏ qua. */
  if (input.guard.space !== undefined) {
    params.spaceKnown = "1";
    params.currentSpace = input.guard.space;
  }
  if (input.scope) {
    params.scopeKind = input.scope.kind;
    if (input.scope.kind === "layer" || input.scope.kind === "block") {
      params.scopeNameHex = utf8Hex(input.scope.name);
      if (input.scope.handle) params.scopeHandle = input.scope.handle;
    } else {
      params.scopeHandle = input.scope.handles[0] ?? "";
      params.handles = input.scope.handles.join(",");
    }
  }
  if (input.catalogScope) {
    params.catalogScopeKind = input.catalogScope.kind;
    params.catalogScopeNameHex = utf8Hex(input.catalogScope.name);
    params.catalogScopeHandle = input.catalogScope.handle;
    params.catalogScopeSelectedAll = input.catalogScope.selectedAll ? 1 : 0;
  }
  if (input.subjects) {
    params.handles = input.subjects.map((item) => item.handle).join(",");
    params.expected = buildExpectedSubjects(input.subjects);
  }
  if (input.selectionBefore) {
    params.expectedSelection = buildExpectedSubjects(input.selectionBefore);
    params.expectedSelectionCount = input.selectionBefore.length;
  }
  if (input.destLayer != null) {
    params.destLayerHex = utf8Hex(input.destLayer);
    if (input.destLayerHandle) {
      params.destLayerHandle = input.destLayerHandle;
    }
  }
  return params;
}

async function defaultInvokeSelectionControl(
  command: SelectionNativeCommand,
): Promise<SelectionNativeResult> {
  const result = await invokeRaw({
    id: CAD_SELECTION_CAPABILITY,
    target: command.exactTarget,
    params: command.params,
  }, {
    waitMs: 20_000,
  });
  const payload = record(result.payload);
  return {
    ok: result.ok,
    token: typeof payload.token === "string" ? payload.token : undefined,
    action: typeof payload.action === "string" ? payload.action : undefined,
    target: typeof payload.target === "string" ? payload.target : undefined,
    count: typeof payload.count === "number" ? payload.count : Number(payload.count),
    changed: typeof payload.changed === "number"
      ? payload.changed
      : payload.changed == null ? undefined : Number(payload.changed),
    subjects: payload.subjects,
    code: typeof payload.code === "string"
      ? payload.code
      : result.diagnostic,
    error: result.error || (typeof payload.error === "string" ? payload.error : undefined),
  };
}

let selectionNativeTail: Promise<void> = Promise.resolve();

async function serializedNativeInvoke<T>(run: () => Promise<T>): Promise<T> {
  const previous = selectionNativeTail;
  let release = () => {};
  selectionNativeTail = new Promise<void>((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await run();
  } finally {
    release();
  }
}

const DEFAULT_DEPENDENCIES: CadSelectionDependencies = {
  listOpenDocs,
  requestDrawingInfo,
  invokeSelectionControl: defaultInvokeSelectionControl,
  now: Date.now,
  randomId: randomUUID,
};

async function nativeCall(
  dependencies: CadSelectionDependencies,
  exactTarget: string,
  action: SelectionNativeAction,
  token: string,
  params: RawParams,
): Promise<SelectionNativeResult> {
  const result = await serializedNativeInvoke(() =>
    dependencies.invokeSelectionControl({
      action,
      token,
      exactTarget,
      params,
    }));
  if (result.token !== token || result.action !== action) {
    throw new SelectionApiError(
      "native_response_mismatch",
      "Plugin trả token/action không khớp yêu cầu",
      502,
    );
  }
  if (!result.ok) {
    const message = result.error || "Plugin không thực hiện được thao tác selection";
    const diagnostic = `${result.code ?? ""} ${message}`;
    if (/selection_too_large|too many (?:selected )?objects/i.test(diagnostic)) {
      throw new SelectionApiError(
        "selection_too_large",
        `Selection vượt quá ${CAD_SELECTION_MAX_SUBJECTS} đối tượng`,
        409,
      );
    }
    if (/selection_empty|no_matching_objects|current selection (?:is )?empty/i.test(
      diagnostic,
    )) {
      throw new SelectionApiError(
        "selection_empty",
        "AutoCAD không tìm thấy đối tượng phù hợp",
        409,
      );
    }
    if (/target_not_active|document (?:is )?not active/i.test(diagnostic)) {
      throw new SelectionApiError(
        "target_not_active",
        "Bản vẽ đích không còn active",
        409,
      );
    }
    if (/document_stale/i.test(diagnostic)) {
      throw new SelectionApiError(
        "document_stale",
        "Phiên bản vẽ hoặc bản vẽ active đã thay đổi; hãy tạo thao tác lại",
        409,
      );
    }
    /* Chốt cuối của plugin, chạy ngay trước khi chạm vào bản vẽ. Phải xét TRƯỚC
       `drawing_stale`: hai chuỗi không giao nhau, nhưng đặt sau một regex rộng
       hơn là cách một mã lỗi âm thầm biến mất khi ai đó nới regex kia. */
    if (/space_changed/i.test(diagnostic)) {
      throw new SelectionApiError(
        "space_changed",
        "AutoCAD đã chuyển sang không gian khác; hãy tạo thao tác lại",
        409,
      );
    }
    if (/drawing_stale|database revision changed/i.test(diagnostic)) {
      throw new SelectionApiError(
        "drawing_stale",
        "Nội dung bản vẽ đã thay đổi; hãy tạo thao tác lại",
        409,
      );
    }
    if (/(?:source|destination)_layer_(?:locked|frozen|off)|layer (?:is )?(?:locked|frozen|off)/i.test(
      diagnostic,
    )) {
      throw new SelectionApiError(
        "layer_unavailable",
        "Layer nguồn hoặc layer đích hiện không cho phép chỉnh sửa",
        409,
      );
    }
    const stale =
      /stale|expected|missing|erased|changed|precondition|does not resolve|no longer|handle mismatch/i
        .test(diagnostic);
    throw new SelectionApiError(
      stale ? "selection_stale" : "native_failed",
      stale
        ? "Selection đã thay đổi; hãy đọc và tạo thao tác lại"
        : message,
      stale ? 409 : 502,
    );
  }
  if (result.target !== exactTarget) {
    throw new SelectionApiError(
      "target_mismatch",
      "Plugin phản hồi từ bản vẽ khác với target đã xác nhận",
      502,
    );
  }
  return result;
}

function routeError(
  response: express.Response,
  error: unknown,
): express.Response {
  if (error instanceof SelectionApiError) {
    return response.status(error.status).json({
      ok: false,
      code: error.code,
      error: error.message,
    });
  }
  const message = error instanceof Error ? error.message : String(error);
  return response.status(500).json({
    ok: false,
    code: "selection_internal_error",
    error: message,
  });
}

export function cadSelectionRouter(
  overrides: Partial<CadSelectionDependencies> = {},
): Router {
  const dependencies: CadSelectionDependencies = {
    ...DEFAULT_DEPENDENCIES,
    ...overrides,
  };
  const operations = new Map<string, SelectionOperation>();

  function expireOperations(): void {
    const now = dependencies.now();
    for (const operation of operations.values()) {
      if (
        operation.state === "pending" &&
        Date.parse(operation.expiresAt) <= now
      ) {
        operation.state = "expired";
      }
    }
    while (operations.size > MAX_OPERATIONS) {
      const removable = [...operations.entries()].find(([, operation]) =>
        operation.state !== "pending" && operation.state !== "applying");
      const id = removable?.[0] ?? operations.keys().next().value;
      if (!id) break;
      operations.delete(id);
    }
  }

  async function resolveDocument(
    target: unknown,
    requireActive = false,
  ): Promise<{
    document: OpenDocument;
    activeDocument: OpenDocument;
    exactTarget: string;
  }> {
    const open = await dependencies.listOpenDocs(4_000);
    if (!open.alive) {
      throw new SelectionApiError(
        "plugin_unavailable",
        "Plugin AcadBridge không phản hồi",
        503,
      );
    }
    const requested = String(target ?? "").trim();
    /* Dùng CHÍNH `selectOpenDocument` chứ không chép lại phép khớp.
       Bản chép tay ở đây chỉ khớp `file` rồi `title`, nên khi
       `selectOpenDocument` học thêm nhánh mã phiên thì bản chép này ở lại phía
       sau — khách gửi mã phiên là nhận `target_not_found`, và cả đường bản vẽ
       chưa lưu chết ở đây dù mọi tầng khác đã sửa. Một phép khớp, một chỗ định
       nghĩa. */
    const selected = selectOpenDocument(open.docs, requested);
    if (selected.ambiguous) {
      throw new SelectionApiError(
        "target_ambiguous",
        "Có nhiều bản vẽ khớp target; hãy chọn bằng full file path",
        409,
      );
    }
    const rawDocument = selected.document;
    if (!rawDocument) {
      throw new SelectionApiError(
        "target_not_found",
        requested
          ? "Không thấy bản vẽ đang mở khớp chính xác target"
          : "Không thấy bản vẽ active",
        404,
      );
    }
    const activeMatches = open.docs.filter((item) => item.active);
    if (activeMatches.length !== 1) {
      throw new SelectionApiError(
        "active_document_ambiguous",
        "Plugin không xác định được duy nhất bản vẽ active",
        409,
      );
    }
    const document = completeDocument(rawDocument, "document");
    const activeDocument = completeDocument(
      activeMatches[0],
      "activeDocument",
    );
    /* `file || instance || title`. Bản vẽ CHƯA LƯU không có đường dẫn, nên mã
       phiên là thứ duy nhất chỉ đích danh được khi hai bản vẽ trùng tiêu đề.
       Chuỗi này đi tới `selection_control.cpp`, nơi plugin tự so lại nó với
       title/file/mã phiên của bản vẽ đang hoạt động — và plugin CÒN chốt riêng
       bằng `documentInstance`, một phép kiểm chặt hơn hẳn so tiêu đề. Nó cũng
       được phản hồi nguyên văn về (`result.target`) nên phép so ở dưới vẫn đúng. */
    const exactTarget = nativeDocumentTarget(document);
    if (!exactTarget) {
      throw new SelectionApiError(
        "invalid_target",
        "Bản vẽ đích chưa có title/path",
      );
    }
    if (
      requireActive &&
      (!document.active || document.instance !== activeDocument.instance)
    ) {
      throw new SelectionApiError(
        "target_not_active",
        "Bản vẽ đích phải đang active để đọc Pickfirst selection",
        409,
      );
    }
    return {
      document,
      activeDocument,
      exactTarget,
    };
  }

  async function drawingSnapshot(
    exactTarget: string,
  ): Promise<DrawingInfoPluginSnapshot> {
    const snapshot = await dependencies.requestDrawingInfo(exactTarget, 10_000);
    if (!snapshot) {
      throw new SelectionApiError(
        "snapshot_timeout",
        "Plugin không trả trạng thái bản vẽ",
        504,
      );
    }
    if (snapshot.ok === false) {
      throw new SelectionApiError(
        String(snapshot.code || "snapshot_failed"),
        snapshot.error || "Không đọc được trạng thái bản vẽ",
        String(snapshot.code) === "busy" ? 409 : 502,
      );
    }
    return snapshot;
  }

  function addOperation(input: Omit<
    SelectionOperation,
    "id" | "revision" | "state" | "createdAt" | "expiresAt"
  >): SelectionOperation {
    expireOperations();
    const now = dependencies.now();
    const id = dependencies.randomId().replaceAll("-", "");
    const base = {
      id,
      action: input.action,
      target: input.target,
      document: input.document,
      ...(input.scope ? { scope: input.scope } : {}),
      ...(input.catalogScope ? { catalogScope: input.catalogScope } : {}),
      ...(input.params ? { params: input.params } : {}),
      summary: input.summary,
      subjects: input.subjects,
      selectionBefore: input.selectionBefore,
      subjectCount: input.subjectCount,
      guard: input.guard,
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + CAD_SELECTION_TTL_MS).toISOString(),
    };
    const operation: SelectionOperation = {
      ...base,
      revision: operationRevision(base),
      state: "pending",
    };
    operations.set(operation.id, operation);
    return operation;
  }

  function decisionOperation(
    id: unknown,
    revision: unknown,
    allowedStates: OperationState[],
  ): SelectionOperation {
    expireOperations();
    const operation = operations.get(String(id ?? ""));
    if (!operation) {
      throw new SelectionApiError(
        "operation_not_found",
        "Không tìm thấy thao tác chờ xác nhận",
        404,
      );
    }
    if (!revision || String(revision) !== operation.revision) {
      throw new SelectionApiError(
        "operation_revision_mismatch",
        "Thao tác đã thay đổi hoặc revision không hợp lệ",
        409,
      );
    }
    if (operation.state === "expired") {
      throw new SelectionApiError(
        "operation_expired",
        "Thao tác đã hết hạn; hãy tạo lại",
        409,
      );
    }
    if (!allowedStates.includes(operation.state)) {
      throw new SelectionApiError(
        "operation_not_pending",
        `Thao tác đã ở trạng thái ${operation.state}`,
        409,
      );
    }
    return operation;
  }

  function pendingOperation(id: unknown, revision: unknown): SelectionOperation {
    return decisionOperation(id, revision, ["pending"]);
  }

  async function validateScope(
    snapshot: DrawingInfoPluginSnapshot,
    scope: SelectionScope,
  ): Promise<SelectionScope> {
    if (scope.kind === "handles") return scope;
    const table = scope.kind === "layer" ? "layers" : "blocks";
    const entry = findSnapshotEntry(snapshot, table, scope.name);
    if (!entry) {
      throw new SelectionApiError(
        scope.handle ? "scope_stale" : "scope_not_found",
        scope.kind === "layer"
          ? `Không thấy layer “${scope.name}” đúng với proposal`
          : `Không thấy block “${scope.name}” đúng với proposal`,
        scope.handle ? 409 : 404,
      );
    }
    if (!HANDLE_RE.test(entry.handle)) {
      throw new SelectionApiError(
        "snapshot_incomplete",
        `Snapshot không có handle của ${scope.kind} “${entry.name}”`,
        502,
      );
    }
    if (scope.handle && scope.handle !== entry.handle) {
      throw new SelectionApiError(
        "scope_stale",
        `${scope.kind === "layer" ? "Layer" : "Block"} đã bị thay thế sau khi tạo proposal`,
        409,
      );
    }
    return {
      kind: scope.kind,
      name: entry.name,
      handle: entry.handle,
    };
  }

  async function captureCurrent(
    document: OpenDocument,
    exactTarget: string,
    guard: DocumentGuard,
    allowEmpty: boolean,
  ): Promise<SelectionSubject[]> {
    const token = dependencies.randomId().replaceAll("-", "");
    const params = buildSelectionControlParams({
      action: "capture",
      token,
      exactTarget,
      guard,
    });
    const result = await nativeCall(
      dependencies,
      exactTarget,
      "capture",
      token,
      params,
    );
    const subjects = normalizeNativeSubjects(result, { allowEmpty });
    if (!document.active) {
      throw new SelectionApiError(
        "target_not_active",
        "Bản vẽ đích không còn active sau khi đọc selection",
        409,
      );
    }
    return subjects;
  }

  async function resolveSelectionScope(
    exactTarget: string,
    guard: DocumentGuard,
    scope: SelectionScope,
    catalogScope?: CatalogScope,
  ): Promise<SelectionSubject[]> {
    const token = dependencies.randomId().replaceAll("-", "");
    const params = buildSelectionControlParams({
      action: "resolve",
      token,
      exactTarget,
      guard,
      scope,
      catalogScope,
    });
    const result = await nativeCall(
      dependencies,
      exactTarget,
      "resolve",
      token,
      params,
    );
    return normalizeNativeSubjects(result);
  }

  const router = express.Router();

  /** Liệt kê thao tác đã chuẩn bị — trục xoay của màn "Thay đổi chờ duyệt".
   *
   * Trước đây `/prepare` trả về id và **chỉ nơi gọi đó** biết id ấy. Một thao
   * tác chuẩn bị ở màn Kiểm tra bản vẽ rồi chuyển sang màn khác là biến mất khỏi
   * tầm mắt: nó vẫn nằm trong hàng chờ của daemon, vẫn sẽ ghi vào bản vẽ khi ai
   * đó xác nhận, nhưng không màn hình nào liệt kê được. Một hàng chờ không nhìn
   * thấy được trên đường ghi KHÔNG HOÀN TÁC ĐƯỢC là chỗ tệ nhất để giấu thông tin.
   *
   * Trả về **mọi** trạng thái, không chỉ `pending`: người dùng cần thấy cả cái
   * vừa hỏng (`failed`) và cái vừa hết hạn (`expired`) — đó là câu trả lời cho
   * "tôi vừa bấm xong, sao không thấy gì xảy ra". Giao diện tự lọc.
   *
   * Gọi `expireOperations()` trước: trạng thái `expired` được tính khi ĐỌC chứ
   * không có bộ đếm giờ chạy nền, nên không gọi là danh sách bày ra những thao
   * tác `pending` đã chết từ lâu.
   */
  router.get("/operations", (_request, response) => {
    expireOperations();
    /* `.reverse()` TRƯỚC khi sắp, và dựa vào phép sắp ỔN ĐỊNH của JS: hai thao
       tác chuẩn bị trong cùng một mili-giây có `createdAt` bằng nhau, và khi đó
       thứ tự phải là thứ tự chèn ĐẢO — cái vừa tạo nằm trên. Sắp không thôi sẽ
       để nguyên thứ tự chèn, tức cái CŨ nhất lên đầu ở đúng ca hay gặp nhất
       (bấm hai lần liên tiếp). */
    const list = [...operations.values()]
      .reverse()
      .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
      .map(operationListView);
    return response.json({ ok: true, operations: list });
  });

  router.get("/current", async (request, response) => {
    try {
      const { document, activeDocument, exactTarget } = await resolveDocument(
        request.query.target,
        true,
      );
      const guard: DocumentGuard = {
        instance: document.instance,
        revision: document.revision,
        activeInstance: activeDocument.instance,
        space: document.space,
      };
      const subjects = await captureCurrent(
        document,
        exactTarget,
        guard,
        true,
      );
      const selectionRevision = createHash("sha256").update(JSON.stringify({
        target: exactTarget,
        subjects,
      })).digest("hex");
      return response.json({
        ok: true,
        target: exactTarget,
        document,
        count: subjects.length,
        subjects,
        selectionRevision,
      });
    } catch (error) {
      return routeError(response, error);
    }
  });

  router.post("/prepare", async (request, response) => {
    try {
      const action = String(request.body?.action ?? "") as SelectionAction;
      if (!["activate-document", "select", "move-to-layer"].includes(action)) {
        throw new SelectionApiError(
          "invalid_action",
          "action phải là activate-document, select hoặc move-to-layer",
        );
      }
      const requireActive = action !== "activate-document";
      const { document, activeDocument, exactTarget } = await resolveDocument(
        request.body?.target,
        requireActive,
      );
      // A handles scope is already an exact, client-selected set.  Resolve it
      // natively below, but avoid a full drawing-info scan; listOpenDocs gives
      // us the same instance/revision guard needed for the proposal.
      const requestedScope = action === "select"
        ? cleanScope(request.body?.scope)
        : undefined;
      const handlesFastPath = requestedScope?.kind === "handles";
      const catalogGuard = handlesFastPath
        ? cleanCatalogGuard(request.body?.catalogGuard)
        : undefined;
      const catalogScope = handlesFastPath && request.body?.catalogScope != null
        ? cleanCatalogScope(request.body.catalogScope)
        : undefined;
      if (catalogGuard && catalogGuard.instance !== document.instance) {
        throw new SelectionApiError(
          "document_stale",
          "Danh mục đối tượng thuộc phiên bản vẽ cũ; hãy quét lại từ AutoCAD",
          409,
        );
      }
      if (catalogGuard && catalogGuard.revision !== document.revision) {
        throw new SelectionApiError(
          "drawing_stale",
          "Danh mục đối tượng đã cũ; hãy quét lại từ AutoCAD",
          409,
        );
      }
      const snapshot = handlesFastPath
        ? undefined
        : await drawingSnapshot(exactTarget);
      const guard = snapshot
        ? snapshotGuard(snapshot, document, activeDocument)
        : listDocumentGuard(document, activeDocument);

      if (action === "activate-document") {
        const operation = addOperation({
          action,
          target: exactTarget,
          document,
          summary: { count: 1 },
          subjects: [],
          selectionBefore: [],
          subjectCount: 0,
          guard,
        });
        return response.status(201).json({
          ok: true,
          operation: operationView(operation),
        });
      }

      if (action === "select") {
        const scope = handlesFastPath
          ? requestedScope!
          : await validateScope(snapshot!, requestedScope!);
        const selectionBefore = await captureCurrent(
          document,
          exactTarget,
          guard,
          true,
        );
        const subjects = await resolveSelectionScope(
          exactTarget,
          guard,
          scope,
          catalogScope,
        );
        const operation = addOperation({
          action,
          target: exactTarget,
          document,
          scope,
          catalogScope,
          summary: {
            count: subjects.length,
            scopeKind: scope.kind,
            ...(scope.kind === "layer" || scope.kind === "block"
              ? { scopeName: scope.name }
              : {}),
          },
          subjects,
          selectionBefore,
          subjectCount: subjects.length,
          guard,
        });
        return response.status(201).json({
          ok: true,
          operation: operationView(operation),
        });
      }

      const requestedLayer = cleanText(
        record(request.body?.params).layer,
        "Layer đích",
      );
      if (snapshotDocument(snapshot!).readOnly === true) {
        throw new SelectionApiError(
          "drawing_read_only",
          "Bản vẽ đang ở chế độ chỉ đọc",
          409,
        );
      }
      const destinationEntry = findSnapshotEntry(
        snapshot!,
        "layers",
        requestedLayer,
      );
      if (!destinationEntry) {
        throw new SelectionApiError(
          "layer_not_found",
          `Không thấy layer đích “${requestedLayer}”; thao tác này không tự tạo layer`,
          404,
        );
      }
      if (!HANDLE_RE.test(destinationEntry.handle)) {
        throw new SelectionApiError(
          "snapshot_incomplete",
          `Snapshot không có handle của layer đích “${destinationEntry.name}”`,
          502,
        );
      }
      const destinationLayer = destinationEntry.name;
      const subjects = await captureCurrent(
        document,
        exactTarget,
        guard,
        false,
      );
      if (subjects.every((subject) =>
        subject.layer.toLocaleUpperCase("en-US") ===
        destinationLayer.toLocaleUpperCase("en-US"))) {
        throw new SelectionApiError(
          "no_change",
          "Tất cả đối tượng đã ở layer đích",
        );
      }
      const fromLayers = [...new Set(subjects.map((subject) => subject.layer))];
      const operation = addOperation({
        action,
        target: exactTarget,
        document,
        params: {
          layer: destinationLayer,
          handle: destinationEntry.handle,
        },
        summary: {
          count: subjects.length,
          fromLayers,
          toLayer: destinationLayer,
        },
        subjects,
        selectionBefore: subjects,
        subjectCount: subjects.length,
        guard,
      });
      return response.status(201).json({
        ok: true,
        operation: operationView(operation),
      });
    } catch (error) {
      return routeError(response, error);
    }
  });

  router.post("/operations/:id/apply", async (request, response) => {
    let operation: SelectionOperation | undefined;
    try {
      if (request.body?.confirmed !== true) {
        throw new SelectionApiError(
          "confirmation_required",
          "Cần xác nhận rõ ràng trước khi áp dụng thao tác",
        );
      }
      operation = pendingOperation(
        request.params.id,
        request.body?.revision,
      );
      operation.state = "applying";

      const { document, activeDocument, exactTarget } = await resolveDocument(
        operation.target,
        operation.action !== "activate-document",
      );
      if (exactTarget !== operation.target) {
        throw new SelectionApiError(
          "target_mismatch",
          "Bản vẽ đích không còn khớp thao tác đã chuẩn bị",
          409,
        );
      }
      if (
        document.instance !== operation.guard.instance ||
        activeDocument.instance !== operation.guard.activeInstance
      ) {
        throw new SelectionApiError(
          "document_stale",
          "Phiên bản vẽ hoặc bản vẽ active đã thay đổi; thao tác đã tự hủy",
          409,
        );
      }
      // Không gian xét TRƯỚC revision.  Cả hai đều từ chối thao tác, nên thứ tự
      // không đổi tính an toàn — nó đổi CÂU TRẢ LỜI.  Đổi tab thường kéo theo
      // revision nhảy (AutoCAD dựng lại viewport), nên để revision chạy trước
      // là người dùng đọc "nội dung bản vẽ đã thay đổi" rồi đi tìm một thay đổi
      // không có thật, trong khi việc họ vừa làm là bấm sang tab khác.
      const spaceDrift = document.active
        ? spaceMismatchReason(operation.guard.space, document.space)
        : null;
      if (spaceDrift) {
        throw new SelectionApiError(
          "space_changed",
          `${spaceDrift}; thao tác đã tự hủy`,
          409,
        );
      }
      if (document.revision !== operation.guard.revision) {
        throw new SelectionApiError(
          "drawing_stale",
          "Nội dung bản vẽ đã thay đổi; thao tác đã tự hủy",
          409,
        );
      }
      // Handles are already frozen in the operation and guarded by the
      // document metadata above.  Keep the native call as the final
      // subject-identity check, but do not pay for another full snapshot.
      const handlesFastPath =
        operation.action === "select" && operation.scope?.kind === "handles";
      let snapshot: DrawingInfoPluginSnapshot | undefined;
      if (!handlesFastPath) {
        snapshot = await drawingSnapshot(exactTarget);
        const currentGuard = snapshotGuard(
          snapshot,
          document,
          activeDocument,
        );
        if (
          currentGuard.instance !== operation.guard.instance ||
          currentGuard.revision !== operation.guard.revision ||
          currentGuard.activeInstance !== operation.guard.activeInstance
        ) {
          throw new SelectionApiError(
            "drawing_stale",
            "Trạng thái bản vẽ đã thay đổi; thao tác đã tự hủy",
            409,
          );
        }
      }

      let nativeAction: SelectionNativeAction;
      let params: RawParams;
      const token = dependencies.randomId().replaceAll("-", "");
      if (operation.action === "activate-document") {
        nativeAction = "activate";
        params = buildSelectionControlParams({
          action: nativeAction,
          token,
          exactTarget,
          guard: operation.guard,
        });
      } else if (operation.action === "select") {
        const scope = handlesFastPath
          ? operation.scope!
          : await validateScope(snapshot!, operation.scope!);
        nativeAction = "select";
        params = buildSelectionControlParams({
          action: nativeAction,
          token,
          exactTarget,
          guard: operation.guard,
          scope,
          catalogScope: operation.catalogScope,
          subjects: operation.subjects,
          selectionBefore: operation.selectionBefore,
        });
      } else {
        if (snapshotDocument(snapshot!).readOnly === true) {
          throw new SelectionApiError(
            "drawing_read_only",
            "Bản vẽ đang ở chế độ chỉ đọc",
            409,
          );
        }
        const destination = findSnapshotEntry(
          snapshot!,
          "layers",
          operation.params!.layer,
        );
        if (!destination) {
          throw new SelectionApiError(
            "layer_not_found",
            "Layer đích không còn tồn tại; hãy tạo thao tác lại",
            409,
          );
        }
        if (
          !HANDLE_RE.test(destination.handle) ||
          destination.handle !== operation.params!.handle
        ) {
          throw new SelectionApiError(
            "destination_stale",
            "Layer đích đã bị thay thế sau khi tạo proposal",
            409,
          );
        }
        nativeAction = "move";
        params = buildSelectionControlParams({
          action: nativeAction,
          token,
          exactTarget,
          guard: operation.guard,
          subjects: operation.subjects,
          destLayer: destination.name,
          destLayerHandle: destination.handle,
        });
      }

      const result = await nativeCall(
        dependencies,
        exactTarget,
        nativeAction,
        token,
        params,
      );

      let subjects: SelectionSubject[] = [];
      let changed = Number(result.changed ?? 0);
      if (operation.action === "activate-document") {
        exactCount(result.count ?? 0);
      } else {
        subjects = normalizeNativeSubjects(result);
        if (operation.action === "select") {
          const expectedSubjects = new Map(
            operation.subjects.map((subject) => [subject.handle, subject]),
          );
          if (
            subjects.length !== operation.subjectCount ||
            subjects.some((subject) => {
              const expected = expectedSubjects.get(subject.handle);
              return !expected ||
                subject.type !== expected.type ||
                subject.layerHandle !== expected.layerHandle ||
                subject.ownerHandle !== expected.ownerHandle;
            })
          ) {
            throw new SelectionApiError(
              "selection_stale",
              "Tập đối tượng đã thay đổi; hãy tạo selection lại",
              409,
            );
          }
          changed = subjects.length;
        } else {
          const expectedHandles = new Set(
            operation.subjects.map((subject) => subject.handle),
          );
          const toLayer = operation.params!.layer.toLocaleUpperCase("en-US");
          const expectedChanged = operation.subjects.filter((subject) =>
            subject.layer.toLocaleUpperCase("en-US") !== toLayer).length;
          if (
            changed !== expectedChanged ||
            subjects.length !== operation.subjectCount ||
            subjects.some((subject) =>
              !expectedHandles.has(subject.handle) ||
              subject.layer.toLocaleUpperCase("en-US") !== toLayer)
          ) {
            throw new SelectionApiError(
              "apply_result_mismatch",
              "Kết quả đổi layer không khớp proposal đã xác nhận",
              502,
            );
          }
        }
      }

      operation.state = "applied";
      operation.subjects = subjects.length ? subjects : operation.subjects;
      operation.subjectCount = subjects.length || operation.subjectCount;
      return response.json({
        ok: true,
        operation: operationView(operation),
        result: {
          action: operation.action,
          count: subjects.length || Number(result.count ?? 0),
          changed,
          subjects,
        },
        hint: operation.action === "move-to-layer"
          ? `Đã chuyển ${changed} đối tượng sang layer ${operation.params!.layer}.`
          : operation.action === "select"
            ? `Đã chọn ${subjects.length} đối tượng trong AutoCAD.`
            : `Đã kích hoạt bản vẽ ${document.title || exactTarget}.`,
      });
    } catch (error) {
      if (operation?.state === "applying") {
        operation.state = "failed";
        operation.error = error instanceof Error ? error.message : String(error);
      }
      return routeError(response, error);
    }
  });

  router.post("/operations/:id/reject", (request, response) => {
    try {
      const operation = decisionOperation(
        request.params.id,
        request.body?.revision,
        ["pending", "failed"],
      );
      const priorState = operation.state;
      operation.state = "rejected";
      return response.json({
        ok: true,
        operation: operationView(operation),
        hint: priorState === "failed"
          ? "Đã đóng thao tác lỗi; không gửi thêm lệnh tới AutoCAD."
          : "Đã từ chối thao tác; AutoCAD không bị thay đổi.",
      });
    } catch (error) {
      return routeError(response, error);
    }
  });

  return router;
}

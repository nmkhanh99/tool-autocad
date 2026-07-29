import { createHash, randomUUID } from "node:crypto";
import express, { type Router } from "express";
import {
  listOpenDocs,
  requestDrawingInfo,
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

type OpenDocument = Required<OpenAcadDocument>;

type DocumentGuard = {
  instance: string;
  revision: number;
  activeInstance: string;
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
  };
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

function operationView(operation: SelectionOperation) {
  const preview = operation.subjects.slice(0, SUBJECT_PREVIEW_LIMIT);
  const subjectCountKnown =
    operation.action === "move-to-layer" ||
    (operation.action === "select" &&
      (operation.scope?.kind === "handles" || operation.subjectCount > 0));
  return {
    id: operation.id,
    revision: operation.revision,
    action: operation.action,
    state: operation.state,
    target: operation.target,
    document: operation.document,
    summary: operation.summary,
    expiresAt: operation.expiresAt,
    ...(subjectCountKnown ? { subjectCount: operation.subjectCount } : {}),
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
    const matches = requested
      ? (() => {
          const fileMatches = open.docs.filter((item) =>
            item.file === requested);
          return fileMatches.length
            ? fileMatches
            : open.docs.filter((item) => item.title === requested);
        })()
      : open.docs.filter((item) => item.active);
    if (matches.length > 1) {
      throw new SelectionApiError(
        "target_ambiguous",
        "Có nhiều bản vẽ khớp target; hãy chọn bằng full file path",
        409,
      );
    }
    const [rawDocument] = matches;
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
    const exactTarget = document.file || document.title;
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
    return { document, activeDocument, exactTarget };
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

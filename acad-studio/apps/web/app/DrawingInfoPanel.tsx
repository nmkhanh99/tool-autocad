"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { asRecord, type JsonRecord } from "../lib/daemon/client";
import {
  applyStagedOp,
  isStale,
  prepareStagedOp,
  rejectStagedOp,
  stagedErrorText,
} from "../features/staged-ops/prepareApplyReject";

type DocumentInfo = JsonRecord & {
  title?: string;
  file?: string;
  active?: boolean;
};

type DrawingData = {
  variables?: unknown;
  settings?: unknown;
  counts?: unknown;
  extents?: unknown;
  entitiesByType?: unknown;
  entitiesByLayer?: unknown;
  entitiesBySpace?: unknown;
  layers?: unknown;
  blocks?: unknown;
  layouts?: unknown;
  styles?: {
    text?: unknown;
    dimension?: unknown;
    linetypes?: unknown;
  } | null;
  registeredApps?: unknown;
  xrefs?: unknown;
  dictionaries?: unknown;
  selection?: unknown;
  selectionScope?: unknown;
  selectionCatalog?: unknown;
};

type DrawingInfoResponse = {
  ok?: boolean;
  status?: string;
  code?: string;
  snapshotCollectedAt?: string | number;
  running?: boolean;
  alive?: boolean;
  collectedAt?: string | number;
  documents?: DocumentInfo[];
  document?: DocumentInfo | null;
  file?: JsonRecord | null;
  application?: JsonRecord | null;
  source?: JsonRecord | null;
  summary?: JsonRecord | null;
  limits?: JsonRecord | null;
  drawing?: DrawingData | null;
  selectionScope?: unknown;
  selectionCatalogError?: string;
  warnings?: unknown[];
  error?: string;
  hint?: string;
};

type PendingCadAction = {
  id: string;
  revision: string;
  action: "activate-document" | "select";
  target: string;
  targetLabel: string;
  scopeLabel: string;
  count?: number;
  nextTarget?: string;
};

type CatalogSubject = JsonRecord & {
  handle: string;
  type: string;
  layer: string;
  layerHandle?: string;
  blockName?: string;
  blockHandle?: string;
};

type SelectionCatalog = {
  space: string;
  scanned: number;
  complete: boolean;
  objects: CatalogSubject[];
};

type SelectionCatalogIndex = {
  layerHandles: Map<string, CatalogSubject[]>;
  layerNames: Map<string, CatalogSubject[]>;
  blockHandles: Map<string, CatalogSubject[]>;
  blockNames: Map<string, CatalogSubject[]>;
};

type ObjectPicker = {
  kind: "layer" | "block";
  name: string;
  rowKey: string;
  subjects: CatalogSubject[];
  complete: boolean;
  catalogGuard: {
    instance: string;
    revision: number;
  };
  catalogScope: {
    kind: "layer" | "block";
    name: string;
    handle: string;
  };
  selectedHandles: Set<string>;
};

const CAD_SELECTION_MAX_SUBJECTS = 5_000;
const PICKER_PAGE_SIZE = 100;
const SELECTION_PREVIEW_LIMIT = 200;

type CadActionFeedback = {
  tone: "loading" | "error" | "success";
  text: string;
};

export type DrawingInfoPanelProps = {
  open: boolean;
  daemon: string;
  initialTarget?: string;
  refreshToken?: number;
  refreshEventAt?: number;
  onClose: () => void;
  onOpenAutoCAD?: () => void;
};

const FIELD_LABELS: Record<string, string> = {
  active: "Đang active",
  alive: "Plugin",
  application: "Ứng dụng",
  blockCount: "Block",
  blocks: "Block",
  color: "Màu",
  count: "Số lượng",
  createdAt: "Ngày tạo",
  currentLayer: "Layer hiện hành",
  databaseVersion: "Phiên bản DWG",
  dimension: "Kiểu kích thước",
  directory: "Thư mục",
  entities: "Đối tượng",
  entityCount: "Đối tượng",
  file: "Đường dẫn",
  fileName: "Tên file",
  frozen: "Đóng băng",
  handle: "Handle",
  layer: "Layer",
  layerCount: "Layer",
  layers: "Layer",
  layoutCount: "Layout",
  layouts: "Layout",
  linetype: "Kiểu nét",
  locked: "Khoá",
  modified: "Đã thay đổi",
  name: "Tên",
  objectCount: "Đối tượng",
  path: "Đường dẫn",
  plottable: "Cho phép in",
  readOnly: "Chỉ đọc",
  references: "Tham chiếu",
  referenceCount: "Tham chiếu toàn bản vẽ",
  selected: "Đang chọn",
  selectableCount: "Có thể chọn",
  selectableCountExact: "Số lượng chính xác",
  selectionScope: "Phạm vi chọn",
  selectionCount: "Đang chọn",
  size: "Kích thước",
  sizeBytes: "Dung lượng (byte)",
  status: "Trạng thái",
  title: "Tên bản vẽ",
  totalEntities: "Đối tượng",
  type: "Loại",
  units: "Đơn vị",
  value: "Giá trị",
  xrefCount: "Xref",
};

const STATUS_LABELS: Record<string, string> = {
  ready: "Sẵn sàng",
  ok: "Sẵn sàng",
  offline: "AutoCAD chưa chạy",
  autocad_offline: "AutoCAD chưa chạy",
  not_running: "AutoCAD chưa chạy",
  plugin_offline: "Plugin chưa phản hồi",
  plugin_unavailable: "Plugin chưa phản hồi",
  no_document: "Chưa mở bản vẽ",
  no_doc: "Chưa mở bản vẽ",
  active_document_not_found: "Chưa có bản vẽ active",
  not_found: "Không tìm thấy bản vẽ",
  timeout: "Hết thời gian chờ",
  busy: "AutoCAD đang bận",
  invalid_target: "Bản vẽ đích không hợp lệ",
  error: "Có lỗi",
};

const TABLE_COLUMNS: Record<string, string[]> = {
  entityTypes: ["type", "name", "count"],
  entityLayers: ["layer", "name", "count"],
  layers: ["name", "selectableCount", "color", "linetype", "objectCount", "on", "frozen", "locked", "plottable"],
  blocks: ["name", "selectableCount", "referenceCount", "isXref", "isLayout", "anonymous"],
  layouts: ["name", "tabOrder", "model", "entityCount", "viewportCount"],
  selection: ["type", "layer", "handle", "name"],
  variables: ["name", "value", "type"],
};

function humanize(key: string): string {
  if (FIELD_LABELS[key]) return FIELD_LABELS[key];
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (c) => c.toUpperCase());
}

function plainValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (typeof value === "number") return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 6 }).format(value);
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function warningLabel(value: unknown): string {
  const warning = String(value ?? "");
  if (warning === "selection_catalog_compat_failed") {
    return "Chưa tạo được danh mục đối tượng một lượt; có thể kiểm tra trực tiếp từng layer/block rồi quét lại.";
  }
  return plainValue(value);
}

function drawingInfoCatalogFailure(value: DrawingInfoResponse): string {
  const detail = String(value.selectionCatalogError || "").trim();
  if (detail) return detail;
  return (Array.isArray(value.warnings) ? value.warnings : []).some(
    (warning) => String(warning).trim() === "selection_catalog_compat_failed",
  ) ? "selection_catalog_compat_failed" : "";
}

function drawingInfoBusyCode(value: DrawingInfoResponse): string {
  const code = String(value.code || "").trim().toLocaleLowerCase("en");
  const status = String(value.status || "").trim().toLocaleLowerCase("en");
  if (code === "busy" || status === "busy") return "busy";
  if (code === "document_not_quiescent" || status === "document_not_quiescent") {
    return "document_not_quiescent";
  }
  return (Array.isArray(value.warnings) ? value.warnings : []).some(
    (warning) => String(warning).trim().toLocaleLowerCase("en") === "document_not_quiescent",
  ) ? "document_not_quiescent" : "";
}

function shownValue(value: unknown): ReactNode {
  if (typeof value === "boolean") {
    return <span className={"drawing-bool " + (value ? "yes" : "no")}>{value ? "Có" : "Không"}</span>;
  }
  return plainValue(value);
}

function normalizeRows(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) {
    return value.map((item, index) => {
      const row = asRecord(item);
      return row || { index: index + 1, value: item };
    });
  }
  const record = asRecord(value);
  if (!record) return value == null ? [] : [{ value }];

  for (const key of ["items", "rows", "entities", "objects", "results"]) {
    if (Array.isArray(record[key])) return normalizeRows(record[key]);
  }

  return Object.entries(record).map(([name, item]) => {
    const row = asRecord(item);
    return row ? { name, ...row } : { name, value: item };
  });
}

function targetOf(doc: DocumentInfo | null | undefined): string {
  // Full paths are unique across open documents; titles are not.
  return String(doc?.file || doc?.title || "");
}

function firstValue(source: JsonRecord | null | undefined, keys: string[]): unknown {
  for (const key of keys) {
    const value = source?.[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function firstNumber(source: JsonRecord | null | undefined, keys: string[], fallback: number): number {
  const value = Number(firstValue(source, keys));
  return Number.isFinite(value) ? value : fallback;
}

function countFrom(value: unknown): number {
  if (Array.isArray(value)) return value.length;
  const record = asRecord(value);
  if (!record) return 0;
  const explicit = Number(firstValue(record, ["total", "count", "length"]));
  if (Number.isFinite(explicit)) return explicit;
  return Object.keys(record).length;
}

function sumCounts(value: unknown): number {
  return normalizeRows(value).reduce((sum, row) => {
    const n = Number(firstValue(row, ["count", "entities", "objectCount", "value"]));
    return sum + (Number.isFinite(n) ? n : 0);
  }, 0);
}

function selectableCountOf(row: JsonRecord): number | undefined {
  if (row.selectableCount == null || row.selectableCount === "") return undefined;
  const count = Number(row.selectableCount);
  return Number.isInteger(count) && count >= 0 ? count : undefined;
}

function selectionRowKey(kind: "layer" | "block", row: JsonRecord): string {
  return `${kind}:${String(row.handle || row.name || "")}`;
}

function normalizedHandle(value: unknown): string {
  const handle = String(value ?? "").trim().toUpperCase();
  return /^[0-9A-F]{1,16}$/.test(handle) ? handle.replace(/^0+(?=[0-9A-F])/, "") : "";
}

function catalogObjectRows(value: unknown): unknown[] {
  const catalog = asRecord(value);
  if (!catalog) return [];
  for (const key of ["objects", "subjects", "entities", "items", "rows"]) {
    if (Array.isArray(catalog[key])) return catalog[key];
  }
  return [];
}

function catalogSubject(value: unknown): CatalogSubject | null {
  const row = asRecord(value);
  if (!row) return null;
  const handle = normalizedHandle(row.handle);
  const type = String(firstValue(row, ["type", "entityType", "dxfType"]) || "").trim();
  const layer = String(firstValue(row, ["layer", "layerName"]) || "").trim();
  if (!handle || !type || !layer) return null;
  const layerHandle = normalizedHandle(row.layerHandle);
  const blockName = String(firstValue(row, ["blockName", "effectiveBlockName"]) || "").trim();
  const blockHandle = normalizedHandle(firstValue(row, ["blockHandle", "effectiveBlockHandle"]));
  return {
    ...row,
    handle,
    type,
    layer,
    ...(layerHandle ? { layerHandle } : {}),
    ...(blockName ? { blockName } : {}),
    ...(blockHandle ? { blockHandle } : {}),
  };
}

function selectionCatalogOf(value: unknown): SelectionCatalog | null {
  const catalog = asRecord(value);
  if (!catalog) return null;
  const objects: CatalogSubject[] = [];
  const seen = new Set<string>();
  for (const item of catalogObjectRows(catalog)) {
    const subject = catalogSubject(item);
    if (!subject || seen.has(subject.handle)) continue;
    seen.add(subject.handle);
    objects.push(subject);
  }
  const scanned = Number(catalog.scanned);
  return {
    space: String(catalog.space || ""),
    scanned: Number.isFinite(scanned) && scanned >= 0 ? scanned : objects.length,
    complete: catalog.complete === true && objects.length === scanned,
    objects,
  };
}

function appendCatalogSubject(
  groups: Map<string, CatalogSubject[]>,
  key: string,
  subject: CatalogSubject,
) {
  if (!key) return;
  const current = groups.get(key);
  if (current) current.push(subject);
  else groups.set(key, [subject]);
}

function selectionCatalogIndexOf(catalog: SelectionCatalog | null): SelectionCatalogIndex {
  const index: SelectionCatalogIndex = {
    layerHandles: new Map(),
    layerNames: new Map(),
    blockHandles: new Map(),
    blockNames: new Map(),
  };
  for (const subject of catalog?.objects || []) {
    appendCatalogSubject(index.layerHandles, subject.layerHandle || "", subject);
    appendCatalogSubject(
      index.layerNames,
      subject.layer.toLocaleUpperCase("en-US"),
      subject,
    );
    if (subject.blockName) {
      appendCatalogSubject(index.blockHandles, subject.blockHandle || "", subject);
      appendCatalogSubject(
        index.blockNames,
        subject.blockName.toLocaleUpperCase("en-US"),
        subject,
      );
    }
  }
  return index;
}

function catalogRowsOf(
  value: unknown,
  catalog: SelectionCatalog | null,
  kind: "layer" | "block",
): JsonRecord[] {
  const sourceRows = normalizeRows(value);
  if (!catalog) return sourceRows;
  type Group = { name: string; handle: string; count: number };
  const groups: Group[] = [];
  const byHandle = new Map<string, Group>();
  const byName = new Map<string, Group>();
  for (const subject of catalog.objects) {
    const name = kind === "layer" ? subject.layer : String(subject.blockName || "");
    const handle = normalizedHandle(
      kind === "layer" ? subject.layerHandle : subject.blockHandle,
    );
    const nameKey = name.trim().toLocaleUpperCase("en-US");
    if (!nameKey) continue;
    let group = (handle ? byHandle.get(handle) : undefined) || byName.get(nameKey);
    if (!group) {
      group = { name, handle, count: 0 };
      groups.push(group);
    }
    group.count += 1;
    if (!group.handle && handle) group.handle = handle;
    if (handle) byHandle.set(handle, group);
    byName.set(nameKey, group);
  }

  const included = new Set<Group>();
  const result: JsonRecord[] = sourceRows.map((row) => {
    const handle = normalizedHandle(row.handle);
    const nameKey = String(row.name || "").trim().toLocaleUpperCase("en-US");
    const group = (handle ? byHandle.get(handle) : undefined) || byName.get(nameKey);
    if (group) included.add(group);
    return {
      ...row,
      selectableCount: group?.count || 0,
      selectableCountExact: catalog.complete,
    };
  });
  for (const group of groups) {
    if (included.has(group)) continue;
    result.push({
      name: group.name,
      ...(group.handle ? { handle: group.handle } : {}),
      selectableCount: group.count,
      selectableCountExact: catalog.complete,
    });
  }
  return result;
}

function catalogGroupSubjects(
  index: SelectionCatalogIndex,
  kind: "layer" | "block",
  row: JsonRecord,
): CatalogSubject[] {
  const rowName = String(row.name || "").trim().toLocaleUpperCase("en-US");
  const rowHandle = normalizedHandle(row.handle);
  if (kind === "layer") {
    return (rowHandle && index.layerHandles.get(rowHandle)) ||
      index.layerNames.get(rowName) || [];
  }
  return (rowHandle && index.blockHandles.get(rowHandle)) ||
    index.blockNames.get(rowName) || [];
}

function subjectSearchText(subject: CatalogSubject): string {
  return [
    subject.handle,
    subject.type,
    subject.layer,
    subject.blockName,
    subject.blockHandle,
    subject.position,
  ].filter(Boolean).join(" ").toLocaleLowerCase("vi");
}

function formatCollectedAt(value: string | number | undefined): string {
  if (value == null || value === "") return "Chưa rõ thời điểm";
  const numeric = Number(value);
  const date = new Date(Number.isFinite(numeric) && numeric > 0 && numeric < 1_000_000_000_000
    ? numeric * 1_000
    : value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "medium" });
}

function collectedAtSeconds(value: string | number | undefined): number {
  if (value == null || value === "") return 0;
  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > 0) {
    return numeric >= 1_000_000_000_000 ? numeric / 1_000 : numeric;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed / 1_000 : 0;
}

function matchesFilter(row: JsonRecord, filter: string): boolean {
  if (!filter) return true;
  return Object.entries(row).some(([key, value]) =>
    `${humanize(key)} ${plainValue(value)}`.toLocaleLowerCase("vi").includes(filter));
}

function KeyValueGrid({ data, filter = "" }: { data: unknown; filter?: string }) {
  const record = asRecord(data);
  if (!record || !Object.keys(record).length) return <EmptyValue />;
  const items = Object.entries(record).filter(([key, value]) =>
    !filter || `${humanize(key)} ${plainValue(value)}`.toLocaleLowerCase("vi").includes(filter));
  if (!items.length) return <EmptyValue filtered />;
  return (
    <dl className="drawing-kv-grid">
      {items.map(([key, value]) => (
        <div className="drawing-kv" key={key}>
          <dt>{humanize(key)}</dt>
          <dd title={plainValue(value)}>{shownValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

function EmptyValue({ filtered = false }: { filtered?: boolean }) {
  return <div className="drawing-empty-value">{filtered ? "Không có mục khớp bộ lọc." : "(không có dữ liệu)"}</div>;
}

function DataTable({
  data,
  filter,
  preferred = [],
  rowAction,
  selectionCountExact,
  prioritizeSelectable = false,
}: {
  data: unknown;
  filter: string;
  preferred?: string[];
  rowAction?: {
    label: string | ((row: JsonRecord) => string);
    disabled?: boolean | ((row: JsonRecord) => boolean);
    busy?: (row: JsonRecord) => boolean;
    title?: (row: JsonRecord) => string | undefined;
    onClick: (row: JsonRecord) => void;
  };
  selectionCountExact?: boolean;
  prioritizeSelectable?: boolean;
}) {
  const allRows = useMemo(() => normalizeRows(data), [data]);
  const rows = useMemo(() => {
    const filtered = allRows.filter((row) => matchesFilter(row, filter));
    if (!prioritizeSelectable) return filtered;
    return [...filtered].sort((left, right) =>
      (selectableCountOf(right) ?? -1) - (selectableCountOf(left) ?? -1));
  }, [allRows, filter, prioritizeSelectable]);
  const rowsWithObjects = useMemo(
    () => allRows.filter((row) => (selectableCountOf(row) || 0) > 0).length,
    [allRows],
  );
  const columns = useMemo(() => {
    const keys = Array.from(new Set(allRows.flatMap((row) => Object.keys(row))));
    return [...preferred.filter((key) => keys.includes(key)), ...keys.filter((key) => !preferred.includes(key))];
  }, [allRows, preferred]);

  if (!allRows.length) return <EmptyValue />;
  if (!rows.length) return <EmptyValue filtered />;
  return (
    <>
      <div className="drawing-table-count">
        {filter && rows.length !== allRows.length ? `${rows.length}/${allRows.length} mục` : `${allRows.length} mục`}
        {prioritizeSelectable && (
          <> · {rowsWithObjects} {selectionCountExact === false ? "đã thấy có đối tượng" : "có đối tượng"}</>
        )}
      </div>
      <div className="drawing-table-wrap">
        <table className="drawing-table">
          <thead>
            <tr>
              {columns.map((key) => <th key={key}>{humanize(key)}</th>)}
              {rowAction && <th className="drawing-table-action">Thao tác</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={String(firstValue(row, ["id", "handle", "name", "title"]) || rowIndex)}>
                {columns.map((key) => (
                  <td key={key} className={typeof row[key] === "object" && row[key] !== null ? "json" : undefined}
                    title={plainValue(row[key])}>
                    {key === "selectableCount" && selectableCountOf(row) !== undefined &&
                      (typeof row.selectableCountExact === "boolean"
                        ? row.selectableCountExact !== true
                        : selectionCountExact === false)
                      ? selectableCountOf(row) === 0
                        ? "Chưa xác định"
                        : `≥ ${plainValue(selectableCountOf(row))}`
                      : shownValue(row[key])}
                  </td>
                ))}
                {rowAction && (
                  <td className="drawing-table-action">
                    <button type="button" className="standards-link-button"
                      disabled={typeof rowAction.disabled === "function"
                        ? rowAction.disabled(row)
                        : rowAction.disabled}
                      title={rowAction.title?.(row)}
                      onClick={() => rowAction.onClick(row)}>
                      {rowAction.busy?.(row) && <span className="drawing-action-spinner" aria-hidden="true" />}
                      {rowAction.busy?.(row)
                        ? "Đang kiểm tra…"
                        : typeof rowAction.label === "function" ? rowAction.label(row) : rowAction.label}
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Section({
  title,
  count,
  open = false,
  children,
}: {
  title: string;
  count?: number;
  open?: boolean;
  children: ReactNode;
}) {
  return (
    <details className="drawing-section" open={open}>
      <summary>
        <span>{title}</span>
        {count !== undefined && <span className="drawing-section-count">{count}</span>}
      </summary>
      <div className="drawing-section-body">{children}</div>
    </details>
  );
}

function RawJsonSection({ data }: { data: DrawingInfoResponse }) {
  const [open, setOpen] = useState(false);
  const formatted = useMemo(() => open ? JSON.stringify(data, null, 2) : "", [data, open]);
  return (
    <details className="drawing-section" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary><span>Dữ liệu thô (JSON)</span></summary>
      {open && <div className="drawing-section-body"><pre className="drawing-raw-json">{formatted}</pre></div>}
    </details>
  );
}

function EmptyState({
  kind,
  message,
  hint,
  onRetry,
  onOpenAutoCAD,
}: {
  kind: "offline" | "plugin" | "document" | "error";
  message: string;
  hint?: string;
  onRetry: () => void;
  onOpenAutoCAD?: () => void;
}) {
  const icon = kind === "offline" ? "A" : kind === "plugin" ? "⛓" : kind === "document" ? "DWG" : "!";
  return (
    <div className="drawing-state">
      <div className={"drawing-state-icon " + kind}>{icon}</div>
      <h3>{message}</h3>
      {hint && <p>{hint}</p>}
      <div className="drawing-state-actions">
        {(kind === "offline" || kind === "document") && onOpenAutoCAD && (
          <button type="button" className="drawing-primary" onClick={onOpenAutoCAD}>Mở AutoCAD</button>
        )}
        <button type="button" onClick={onRetry}>↻ Kiểm tra lại</button>
      </div>
    </div>
  );
}

function Metric({ label, value, tone }: { label: string; value: unknown; tone?: string }) {
  return (
    <div className={"drawing-metric " + (tone || "")}>
      <span>{label}</span>
      <strong>{plainValue(value)}</strong>
    </div>
  );
}

export default function DrawingInfoPanel({
  open,
  daemon,
  initialTarget,
  refreshToken,
  refreshEventAt = 0,
  onClose,
  onOpenAutoCAD,
}: DrawingInfoPanelProps) {
  const [selectedTarget, setSelectedTarget] = useState(initialTarget?.trim() || "");
  const [data, setData] = useState<DrawingInfoResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [filter, setFilter] = useState("");
  const [reloadToken, setReloadToken] = useState(0);
  const [pendingCadAction, setPendingCadAction] = useState<PendingCadAction | null>(null);
  const [cadActionBusy, setCadActionBusy] = useState("");
  const [preparingRow, setPreparingRow] = useState("");
  const [cadActionFeedback, setCadActionFeedback] = useState<CadActionFeedback | null>(null);
  const [catalogStale, setCatalogStale] = useState(false);
  const [objectPicker, setObjectPicker] = useState<ObjectPicker | null>(null);
  const [pickerFilter, setPickerFilter] = useState("");
  const [pickerPage, setPickerPage] = useState(0);
  const seenRefreshToken = useRef(refreshToken);
  const latestRefreshToken = useRef(refreshToken);
  const latestRefreshEventAt = useRef(refreshEventAt);
  const loadedSnapshotKey = useRef("");
  const displayedTargetKey = useRef("");
  const targetSyncPending = useRef<string | null>(null);
  const pickerDialogRef = useRef<HTMLDivElement | null>(null);
  const pickerReturnFocusRef = useRef<HTMLElement | null>(null);
  const pickerWasOpen = useRef(false);
  latestRefreshToken.current = refreshToken;
  latestRefreshEventAt.current = refreshEventAt;

  useEffect(() => {
    const requestedTarget = initialTarget?.trim() || "";
    if (selectedTarget !== requestedTarget) {
      targetSyncPending.current = requestedTarget;
      setSelectedTarget(requestedTarget);
    }
    if (!open) return;
    setFilter("");
    setPendingCadAction(null);
    setPreparingRow("");
    setCadActionFeedback(null);
    setObjectPicker(null);
    setPickerFilter("");
    setPickerPage(0);
  }, [open, initialTarget]);

  useEffect(() => {
    if (seenRefreshToken.current === refreshToken) return;
    seenRefreshToken.current = refreshToken;
    // Keep an already opened picker/proposal usable. Its catalogGuard and
    // catalogScope are verified by the backend at prepare and again at Apply.
    setCatalogStale(true);
  }, [refreshToken]);

  useEffect(() => {
    if (!open) return;
    if (targetSyncPending.current !== null) {
      if (selectedTarget !== targetSyncPending.current) return;
      targetSyncPending.current = null;
    }
    const targetKey = `${daemon.replace(/\/+$/, "")}|${selectedTarget}`;
    const requestKey = `${targetKey}|${reloadToken}`;
    // The panel stays mounted while hidden. Reopening the same drawing reuses
    // the last snapshot; only target changes and the explicit scan button read
    // the full drawing again.
    if (loadedSnapshotKey.current === requestKey) return;
    const sameTarget = displayedTargetKey.current === targetKey;
    const controller = new AbortController();
    const refreshTokenAtStart = latestRefreshToken.current;
    const load = async () => {
      setLoading(true);
      setRequestError("");
      if (!sameTarget) setData(null);
      const base = daemon.replace(/\/+$/, "");
      const query = selectedTarget ? `?target=${encodeURIComponent(selectedTarget)}` : "";
      try {
        const response = await fetch(`${base}/api/acad/drawing-info${query}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const body = await response.json() as DrawingInfoResponse;
        const busyCode = drawingInfoBusyCode(body);
        const catalogFailure = drawingInfoCatalogFailure(body);
        const scanFailed = !response.ok || body.ok === false || !!busyCode ||
          (sameTarget && !!catalogFailure);
        if (scanFailed) {
          const message = body.error || (busyCode
            ? "AutoCAD đang thực thi lệnh hoặc chưa sẵn sàng. Hãy hoàn tất/nhấn Esc trong AutoCAD rồi quét lại."
            : catalogFailure
              ? "Không tạo được danh mục đối tượng từ lần quét mới."
            : `Không quét được hồ sơ từ AutoCAD (HTTP ${response.status}).`);
          if (sameTarget) {
            setCatalogStale(true);
            setCadActionFeedback({
              tone: "error",
              text: `Giữ nguyên snapshot cũ vì lần quét mới chưa thành công: ${message}`,
            });
          } else {
            setData({
              ...body,
              ok: false,
              status: busyCode || body.status || "error",
              error: message,
            });
          }
          return;
        }
        setData(body);
        displayedTargetKey.current = targetKey;
        loadedSnapshotKey.current = requestKey;
        // An AutoCAD event may arrive while a long scan is running. Keep the
        // freshly returned snapshot marked stale in that race instead of
        // claiming that it includes a later change.
        const eventDuringScan = latestRefreshToken.current !== refreshTokenAtStart;
        const snapshotCollectedAt = collectedAtSeconds(
          body.snapshotCollectedAt ?? body.collectedAt,
        );
        const eventCoveredBySnapshot = latestRefreshEventAt.current > 0 &&
          snapshotCollectedAt > 0 && latestRefreshEventAt.current < snapshotCollectedAt;
        setCatalogStale(eventDuringScan && !eventCoveredBySnapshot);
        setObjectPicker(null);
        setPickerFilter("");
        setPickerPage(0);
        setCadActionFeedback(null);
      } catch (error) {
        if (!controller.signal.aborted) {
          const message = error instanceof Error ? error.message : String(error);
          if (sameTarget) {
            setCadActionFeedback({
              tone: "error",
              text: `Không quét lại được từ AutoCAD: ${message}`,
            });
          } else {
            setRequestError(message);
          }
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [open, daemon, selectedTarget, reloadToken]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (pendingCadAction) {
        void rejectPendingCadAction();
        return;
      }
      if (objectPicker) {
        setObjectPicker(null);
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose, pendingCadAction, objectPicker]);

  useEffect(() => {
    if (!objectPicker) {
      if (!pickerWasOpen.current) return;
      pickerWasOpen.current = false;
      const returnTarget = pickerReturnFocusRef.current;
      pickerReturnFocusRef.current = null;
      requestAnimationFrame(() => returnTarget?.focus());
      return;
    }
    pickerWasOpen.current = true;
    const dialog = pickerDialogRef.current;
    if (!dialog) return;
    const containFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusable = [...dialog.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
      )].filter((element) => !element.hidden);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && window.document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && window.document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.document.addEventListener("keydown", containFocus);
    return () => window.document.removeEventListener("keydown", containFocus);
  }, [objectPicker]);

  const documents = Array.isArray(data?.documents) ? data.documents : [];
  const document = data?.document || null;
  const drawing = data?.drawing || null;
  const summary = data?.summary || null;
  const normalizedFilter = filter.trim().toLocaleLowerCase("vi");
  const selectedMatches = documents.filter((doc) =>
    doc.file === selectedTarget || doc.title === selectedTarget);
  const selectedDocument = selectedMatches.find((doc) => doc.active) || selectedMatches[0];
  const viewedTarget = targetOf(selectedDocument) || selectedTarget ||
    targetOf(document) || targetOf(documents.find((doc) => doc.active));
  const activeDocumentTarget =
    targetOf(documents.find((doc) => doc.active)) || viewedTarget;
  const documentTitle = String(firstValue(document, ["title", "name", "fileName"]) || viewedTarget || "Bản vẽ AutoCAD");
  const documentPath = String(firstValue(document, ["file", "path", "fullPath"]) || "");

  const entityCount = firstNumber(summary, ["totalEntities", "entityCount", "entities"],
    sumCounts(drawing?.entitiesByType));
  const layerCount = firstNumber(summary, ["layerCount", "layers"], countFrom(drawing?.layers));
  const blockCount = firstNumber(summary, ["blockCount", "blocks", "blockReferences"], countFrom(drawing?.blocks));
  const layoutCount = firstNumber(summary, ["layoutCount", "layouts"], countFrom(drawing?.layouts));
  const selectionRecord = asRecord(drawing?.selection);
  const selectionRows = firstValue(selectionRecord, ["entities", "items", "objects", "rows"]) ?? drawing?.selection;
  const selectionCount = firstNumber(summary, ["selectionCount", "selected"],
    firstNumber(selectionRecord, ["count", "total"], countFrom(selectionRows)));
  const xrefCount = firstNumber(summary, ["xrefCount", "xrefs"], countFrom(drawing?.xrefs));
  const documentModified = document?.modified === true || Number(document?.dbmod) > 0;
  const drawingSettings = asRecord(drawing?.settings);
  const selectionScope = asRecord(drawing?.selectionScope) || asRecord(data?.selectionScope);
  const selectionScopeComplete = selectionScope?.complete === true;
  const selectionScopeSpace = String(selectionScope?.space || drawingSettings?.CTAB || "");
  const selectionScopeLabel = selectionScopeSpace
    ? `không gian “${selectionScopeSpace}” hiện hành`
    : "layout hiện hành";
  const selectionCatalog = useMemo(
    () => selectionCatalogOf(drawing?.selectionCatalog),
    [drawing?.selectionCatalog],
  );
  const selectionCatalogIndex = useMemo(
    () => selectionCatalogIndexOf(selectionCatalog),
    [selectionCatalog],
  );
  const catalogLayerRows = useMemo(
    () => catalogRowsOf(drawing?.layers, selectionCatalog, "layer"),
    [drawing?.layers, selectionCatalog],
  );
  const catalogBlockRows = useMemo(
    () => catalogRowsOf(drawing?.blocks, selectionCatalog, "block"),
    [drawing?.blocks, selectionCatalog],
  );
  const selectionCatalogLabel = selectionCatalog?.space
    ? `không gian “${selectionCatalog.space}” hiện hành`
    : selectionScopeLabel;
  const catalogSubjectsForRow = useMemo(() => {
    const map = new Map<string, CatalogSubject[]>();
    for (const kind of ["layer", "block"] as const) {
      for (const row of kind === "layer" ? catalogLayerRows : catalogBlockRows) {
        map.set(selectionRowKey(kind, row), catalogGroupSubjects(selectionCatalogIndex, kind, row));
      }
    }
    return map;
  }, [catalogBlockRows, catalogLayerRows, selectionCatalogIndex]);
  const pickerSubjects = objectPicker?.subjects || [];
  const normalizedPickerFilter = pickerFilter.trim().toLocaleLowerCase("vi");
  const filteredPickerSubjects = useMemo(() => {
    if (!normalizedPickerFilter) return pickerSubjects;
    return pickerSubjects.filter((subject) => subjectSearchText(subject).includes(normalizedPickerFilter));
  }, [normalizedPickerFilter, pickerSubjects]);
  const pickerPageCount = Math.max(1, Math.ceil(filteredPickerSubjects.length / PICKER_PAGE_SIZE));
  const safePickerPage = Math.min(pickerPage, pickerPageCount - 1);
  const visiblePickerSubjects = filteredPickerSubjects.slice(
    safePickerPage * PICKER_PAGE_SIZE,
    (safePickerPage + 1) * PICKER_PAGE_SIZE,
  );
  const pickerSelectedCount = objectPicker?.selectedHandles.size || 0;
  const pickerCanSelectAll = !!objectPicker && objectPicker.complete &&
    objectPicker.subjects.length <= CAD_SELECTION_MAX_SUBJECTS;
  const applicationInfo = {
    ...(data?.application || {}),
    pluginVersion: data?.source?.pluginVersion,
    protocol: data?.source?.protocol,
    AutoCAD: drawingSettings?.PRODUCT,
    version: drawingSettings?.ACADVER,
    platform: drawingSettings?.PLATFORM,
    locale: drawingSettings?.LOCALE,
  };

  const status = String(data?.status || (data?.ok ? "ready" : "error")).toLocaleLowerCase("en");
  const noDocument = status === "no_document" || status === "no_doc" ||
    (!!data && data.running !== false && data.alive !== false && !document && documents.length === 0);
  const pluginOffline = status === "plugin_offline" ||
    (!!data && data.running !== false && data.alive === false);
  const autoCadOffline = status === "offline" || status === "autocad_offline" || data?.running === false;
  const responseError = data?.error || (!data?.ok && !autoCadOffline && !pluginOffline && !noDocument ? data?.hint : "");

  const refresh = () => {
    if (cadActionBusy || pendingCadAction) return;
    setCatalogStale(true);
    setObjectPicker(null);
    setPickerFilter("");
    setPickerPage(0);
    setReloadToken((token) => token + 1);
  };

  function patchSelectionSummary(applied: JsonRecord) {
    const allSubjects = Array.isArray(applied.subjects) ? applied.subjects : null;
    const subjects = allSubjects?.slice(0, SELECTION_PREVIEW_LIMIT) || null;
    const nextCount = Number(applied.count);
    if (!Number.isFinite(nextCount) || !data) return;
    setData((previous) => {
      if (!previous) return previous;
      const previousDrawing = asRecord(previous.drawing) || {};
      const previousSelection = asRecord(previousDrawing.selection) || {};
      const nextSelection = {
        ...previousSelection,
        count: nextCount,
        total: nextCount,
        ...(subjects ? {
          entities: subjects,
          truncated: allSubjects!.length > subjects.length,
        } : {}),
      };
      return {
        ...previous,
        summary: {
          ...(previous.summary || {}),
          selectionCount: nextCount,
          selected: nextCount,
        },
        drawing: {
          ...previousDrawing,
          selection: nextSelection,
        },
      };
    });
  }

  async function prepareCadAction(
    request: JsonRecord,
    display: Omit<PendingCadAction, "id" | "revision" | "action" | "target"> & {
      action: PendingCadAction["action"];
      target: string;
    },
    rowKey = "",
  ) {
    if (cadActionBusy || pendingCadAction) return;
    setCadActionBusy("prepare");
    setPreparingRow(rowKey);
    setCadActionFeedback({
      tone: "loading",
      text: `Đang kiểm tra ${display.scopeLabel}…`,
    });
    try {
      const op = await prepareStagedOp(daemon, request, {
        action: display.action,
        fallbackCount: display.count,
      });
      setPendingCadAction({
        ...display,
        id: op.id,
        revision: op.revision,
        action: display.action,
        target: op.target || display.target,
        nextTarget: display.action === "activate-document"
          ? (op.nextTarget || display.nextTarget || display.target)
          : display.nextTarget,
        count: op.count ?? display.count,
      });
      setCadActionFeedback(null);
    } catch (error) {
      if (isStale(error)) {
        setCatalogStale(true);
        setObjectPicker(null);
      }
      setCadActionFeedback({
        tone: "error",
        text: `${display.scopeLabel}: ${stagedErrorText(error)}`,
      });
    } finally {
      setPreparingRow("");
      setCadActionBusy("");
    }
  }

  async function applyPendingCadAction() {
    const pending = pendingCadAction;
    if (!pending || cadActionBusy) return;
    setCadActionBusy("apply");
    setCadActionFeedback(null);
    try {
      const result = await applyStagedOp(daemon, pending);
      setPendingCadAction(null);
      setCadActionFeedback({
        tone: "success",
        text: String(result.hint || (pending.action === "select"
          ? `Đã chọn ${pending.count ?? 0} đối tượng trong AutoCAD.`
          : `Đã kích hoạt bản vẽ ${pending.targetLabel}.`)),
      });
      if (pending.nextTarget) {
        setData(null);
        setSelectedTarget(pending.nextTarget);
      } else if (pending.action === "select") {
        patchSelectionSummary(asRecord(result.result) || {});
      } else {
        setCatalogStale(true);
      }
    } catch (error) {
      // Apply is one-shot server-side. Force a fresh prepare instead of
      // offering a retry against an operation that may already be terminal.
      setPendingCadAction(null);
      if (isStale(error)) {
        setCatalogStale(true);
        setObjectPicker(null);
      }
      setCadActionFeedback({ tone: "error", text: stagedErrorText(error) });
    } finally {
      setCadActionBusy("");
    }
  }

  async function rejectPendingCadAction() {
    const pending = pendingCadAction;
    if (!pending || cadActionBusy) return;
    setPendingCadAction(null);
    setCadActionFeedback(null);
    setCadActionBusy("reject");
    try {
      await rejectStagedOp(daemon, pending);
    } finally {
      setCadActionBusy("");
    }
  }

  function selectTarget(target: string) {
    if (!target || target === activeDocumentTarget) return;
    const selectedDocument = documents.find((doc) => targetOf(doc) === target);
    void prepareCadAction(
      { target, action: "activate-document" },
      {
        action: "activate-document",
        target,
        targetLabel: String(selectedDocument?.title || selectedDocument?.file || target),
        scopeLabel: "Chuyển bản vẽ đang active trong AutoCAD",
        nextTarget: target,
      },
    );
  }

  function openObjectPicker(kind: "layer" | "block", row: JsonRecord) {
    const name = String(row.name || "");
    if (!name) return;
    if (cadActionBusy || pendingCadAction) return;
    const scopeLabel = `${kind === "layer" ? "Layer" : "Block"} “${name}” trong ${selectionCatalogLabel}`;
    const rowKey = selectionRowKey(kind, row);
    const subjects = catalogSubjectsForRow.get(rowKey) || [];
    if (catalogStale || !selectionCatalog || (!selectionCatalog.complete && !subjects.length)) {
      // Compatibility path for a plugin that predates selectionCatalog. It
      // also keeps stale/unscanned rows usable through a fresh guarded resolve.
      const rowCount = selectableCountOf(row);
      const exactTarget = documentPath || viewedTarget;
      const directReason = catalogStale
        ? "snapshot cũ, kiểm tra trực tiếp"
        : selectionCatalog
          ? "danh mục chưa đầy đủ, kiểm tra trực tiếp"
          : "plugin cũ cần kiểm tra";
      void prepareCadAction(
        {
          target: exactTarget,
          action: "select",
          scope: { kind, name, handle: String(row.handle || "") },
        },
        {
          action: "select",
          target: exactTarget,
          targetLabel: documentTitle,
          scopeLabel: `${scopeLabel} · ${directReason}`,
          ...(!catalogStale && !selectionCatalog && rowCount !== undefined ? { count: rowCount } : {}),
        },
        rowKey,
      );
      return;
    }
    if (!subjects.length) {
      setCadActionFeedback({ tone: "error", text: `${scopeLabel}: 0 đối tượng có thể chọn.` });
      return;
    }
    const catalogInstance = String(document?.instance || "").trim();
    const catalogRevision = Number(document?.revision);
    if (!catalogInstance || !Number.isSafeInteger(catalogRevision) || catalogRevision < 0) {
      setCatalogStale(true);
      setCadActionFeedback({
        tone: "error",
        text: `${scopeLabel}: snapshot thiếu định danh phiên bản; hãy bấm “Quét lại từ AutoCAD”.`,
      });
      return;
    }
    const catalogScopeHandle = normalizedHandle(
      kind === "layer" ? subjects[0]?.layerHandle : subjects[0]?.blockHandle,
    );
    const catalogScopeConsistent = !!catalogScopeHandle && subjects.every((subject) =>
      normalizedHandle(kind === "layer" ? subject.layerHandle : subject.blockHandle) ===
        catalogScopeHandle);
    if (!catalogScopeConsistent) {
      setCatalogStale(true);
      setCadActionFeedback({
        tone: "error",
        text: `${scopeLabel}: catalog thiếu định danh ${kind === "layer" ? "layer" : "block"}; hãy quét lại.`,
      });
      return;
    }
    const defaultAll = selectionCatalog.complete && subjects.length <= CAD_SELECTION_MAX_SUBJECTS;
    pickerReturnFocusRef.current = window.document.activeElement instanceof HTMLElement
      ? window.document.activeElement
      : null;
    setObjectPicker({
      kind,
      name,
      rowKey,
      subjects,
      complete: selectionCatalog.complete,
      catalogGuard: {
        instance: catalogInstance,
        revision: catalogRevision,
      },
      catalogScope: {
        kind,
        name,
        handle: catalogScopeHandle,
      },
      selectedHandles: new Set(defaultAll ? subjects.map((subject) => subject.handle) : []),
    });
    setPickerFilter("");
    setPickerPage(0);
    setCadActionFeedback(null);
  }

  function setPickerSubjectChecked(handle: string, checked: boolean) {
    setObjectPicker((current) => {
      if (!current) return current;
      const next = new Set(current.selectedHandles);
      if (checked) {
        if (next.size >= CAD_SELECTION_MAX_SUBJECTS) return current;
        next.add(handle);
      } else {
        next.delete(handle);
      }
      return { ...current, selectedHandles: next };
    });
  }

  function setPickerSelectAll(checked: boolean) {
    setObjectPicker((current) => {
      if (!current || !current.complete || current.subjects.length > CAD_SELECTION_MAX_SUBJECTS) {
        return current;
      }
      return {
        ...current,
        selectedHandles: checked
          ? new Set(current.subjects.map((subject) => subject.handle))
          : new Set<string>(),
      };
    });
  }

  function submitObjectPicker() {
    const picker = objectPicker;
    if (!picker) return;
    const handles = [...picker.selectedHandles];
    const scopeLabel = `${picker.kind === "layer" ? "Layer" : "Block"} “${picker.name}” trong ${selectionCatalogLabel}`;
    if (!handles.length) {
      setCadActionFeedback({ tone: "error", text: `${scopeLabel}: hãy chọn ít nhất một đối tượng.` });
      return;
    }
    if (handles.length > CAD_SELECTION_MAX_SUBJECTS) {
      setCadActionFeedback({ tone: "error", text: `${scopeLabel}: tối đa ${CAD_SELECTION_MAX_SUBJECTS.toLocaleString("vi-VN")} đối tượng mỗi lần.` });
      return;
    }
    const exactTarget = documentPath || viewedTarget;
    setObjectPicker(null);
    void prepareCadAction(
      {
        target: exactTarget,
        action: "select",
        scope: { kind: "handles", handles },
        catalogGuard: picker.catalogGuard,
        catalogScope: {
          ...picker.catalogScope,
          selectedAll: picker.complete && handles.length === picker.subjects.length,
        },
      },
      {
        action: "select",
        target: exactTarget,
        targetLabel: documentTitle,
        scopeLabel: `${scopeLabel} · ${handles.length}/${picker.subjects.length} đối tượng`,
        count: handles.length,
      },
      picker.rowKey,
    );
  }

  function rowCatalogSubjects(kind: "layer" | "block", row: JsonRecord): CatalogSubject[] {
    return catalogSubjectsForRow.get(selectionRowKey(kind, row)) || [];
  }

  function rowCatalogLabel(kind: "layer" | "block", row: JsonRecord): string {
    const subjects = rowCatalogSubjects(kind, row);
    if (catalogStale) return "Kiểm tra & chọn";
    if (!selectionCatalog) {
      return selectionScopeComplete && selectableCountOf(row) === 0
        ? "0 đối tượng"
        : "Kiểm tra & chọn";
    }
    if (!subjects.length) return selectionCatalog.complete ? "0 đối tượng" : "Kiểm tra & chọn";
    if (!selectionCatalog.complete) return `Chọn ≥${subjects.length}`;
    if (subjects.length > CAD_SELECTION_MAX_SUBJECTS) return `Chọn từng (${subjects.length})`;
    return `Chọn ${subjects.length}`;
  }

  function rowCatalogDisabled(kind: "layer" | "block", row: JsonRecord): boolean {
    return !!cadActionBusy || !!pendingCadAction || (!catalogStale && (
      (!selectionCatalog && selectionScopeComplete && selectableCountOf(row) === 0) ||
      (!!selectionCatalog?.complete && rowCatalogSubjects(kind, row).length === 0)
    ));
  }

  function rowCatalogTitle(kind: "layer" | "block", row: JsonRecord): string {
    const subjects = rowCatalogSubjects(kind, row);
    const label = kind === "layer" ? "layer" : "block";
    if (catalogStale) {
      return "Snapshot đã cũ; bấm để kiểm tra trực tiếp trên AutoCAD hoặc quét lại để cập nhật danh mục.";
    }
    if (!selectionCatalog) {
      if (selectionScopeComplete && selectableCountOf(row) === 0) {
        return `${label} này không có đối tượng trong ${selectionScopeLabel}.`;
      }
      return "Plugin cũ: daemon sẽ kiểm tra layer/block khi bấm; nạp bản mới để chọn từ snapshot.";
    }
    if (!subjects.length) {
      return selectionCatalog.complete
        ? `${label} này không có đối tượng trong ${selectionCatalogLabel}.`
        : `Chưa thấy đối tượng của ${label} này trong phần danh mục đã quét; bấm để kiểm tra trực tiếp.`;
    }
    if (!selectionCatalog.complete) return `Chỉ có ${subjects.length} đối tượng đã quét; có thể còn đối tượng khác.`;
    if (subjects.length > CAD_SELECTION_MAX_SUBJECTS) return `Nhóm có ${subjects.length} đối tượng; chọn từng nhóm tối đa ${CAD_SELECTION_MAX_SUBJECTS}.`;
    return `Mở danh sách ${subjects.length} đối tượng để chọn tất cả hoặc chọn từng đối tượng.`;
  }

  if (!open) return null;

  return (
    <div className="drawing-info-backdrop" onMouseDown={(event) => {
      if (event.target !== event.currentTarget) return;
      if (pendingCadAction) {
        void rejectPendingCadAction();
      } else {
        onClose();
      }
    }}>
      <section className="drawing-info-panel" role="dialog" aria-modal="true"
        aria-hidden={objectPicker ? true : undefined} inert={objectPicker ? true : undefined}
        aria-labelledby="drawing-info-title">
        <header className="drawing-info-head">
          <div className="drawing-info-identity">
            <div className="drawing-info-mark" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M5 3.5h9l5 5v12H5z" />
                <path d="M14 3.5v5h5M8 15l2.2-4 2.2 4 2.2-4L17 15" />
              </svg>
            </div>
            <div>
              <div className="drawing-info-kicker">AutoCAD · bản vẽ đang thao tác</div>
              <h2 id="drawing-info-title">{documentTitle}</h2>
              <div className="drawing-info-path" title={documentPath}>{documentPath || "Chưa có đường dẫn file"}</div>
            </div>
          </div>

          <div className="drawing-info-actions">
            <label className="drawing-doc-select">
              <span className="drawing-sr-only">Chọn bản vẽ</span>
              <select value={activeDocumentTarget} onChange={(event) => selectTarget(event.target.value)}
                disabled={loading && !data || !documents.length || !!cadActionBusy || !!pendingCadAction}>
                {!documents.length && <option value={activeDocumentTarget}>{documentTitle}</option>}
                {documents.map((doc, index) => {
                  const target = targetOf(doc);
                  return (
                    <option key={target || index} value={target}>
                      {doc.active ? "● " : ""}{String(doc.title || doc.file || `Bản vẽ ${index + 1}`)}
                    </option>
                  );
                })}
              </select>
            </label>
            <button type="button" className="drawing-icon-btn close" onClick={() => {
              if (pendingCadAction) {
                void rejectPendingCadAction();
              } else {
                onClose();
              }
            }}
              title="Đóng" aria-label="Đóng">×</button>
          </div>
        </header>

        <div className="drawing-info-toolbar">
          <div className="drawing-status-line">
            <span className={"drawing-status " + (data?.ok ? "ready" : status)}>
              <i /> {STATUS_LABELS[status] || data?.status || (loading ? "Đang tải" : "Chưa sẵn sàng")}
            </span>
            {document?.active === true && <span className="drawing-tag active">Đang active</span>}
            {documentModified && <span className="drawing-tag modified">Chưa lưu</span>}
            {document?.readOnly === true && <span className="drawing-tag readonly">Chỉ đọc</span>}
            <span className="drawing-collected" title="Thời điểm snapshot được quét từ AutoCAD">
              Snapshot: {formatCollectedAt(data?.snapshotCollectedAt ?? data?.collectedAt)}
            </span>
          </div>
          <label className="drawing-filter">
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="8.5" cy="8.5" r="5.5" />
              <path d="m12.5 12.5 4 4" />
            </svg>
            <span className="drawing-sr-only">Lọc dữ liệu</span>
            <input value={filter} onChange={(event) => setFilter(event.target.value)}
              placeholder="Lọc layer, block, kiểu đối tượng…" />
            {filter && <button type="button" onClick={() => setFilter("")} aria-label="Xoá bộ lọc">×</button>}
          </label>
          <button type="button" className="drawing-catalog-refresh" onClick={refresh}
            disabled={loading || !!cadActionBusy || !!pendingCadAction}
            title="Quét lại toàn bộ hồ sơ và danh mục từ AutoCAD">
            {loading ? "Đang quét hồ sơ…" : "Quét lại từ AutoCAD"}
          </button>
        </div>

        <div className="drawing-info-body">
          {loading && !data && !requestError && (
            <div className="drawing-loading" role="status">
              <span className="drawing-loader" />
              <strong>Đang đọc bản vẽ active…</strong>
              <small>AutoCAD đang tổng hợp document, database và selection.</small>
            </div>
          )}

          {requestError && (
            <EmptyState kind="error" message="Không kết nối được Acad Studio daemon"
              hint={requestError} onRetry={refresh} />
          )}

          {!requestError && data && autoCadOffline && (
            <EmptyState kind="offline" message="AutoCAD chưa chạy"
              hint={data.hint || "Mở AutoCAD và một file DWG, sau đó kiểm tra lại."}
              onRetry={refresh} onOpenAutoCAD={onOpenAutoCAD} />
          )}

          {!requestError && data && !autoCadOffline && pluginOffline && (
            <EmptyState kind="plugin" message="Plugin AcadBridge chưa phản hồi"
              hint={data.hint || "AutoCAD đang chạy nhưng app chưa đọc được bản vẽ. Hãy nạp hoặc khởi động lại plugin."}
              onRetry={refresh} />
          )}

          {!requestError && data && !autoCadOffline && !pluginOffline && noDocument && (
            <EmptyState kind="document" message="AutoCAD chưa mở bản vẽ nào"
              hint={data.hint || "Mở một file DWG để xem toàn bộ thông tin bản vẽ."}
              onRetry={refresh} onOpenAutoCAD={onOpenAutoCAD} />
          )}

          {!requestError && data && !autoCadOffline && !pluginOffline && !noDocument && responseError && (
            <EmptyState kind="error" message="Không đọc được thông tin bản vẽ"
              hint={String(responseError)} onRetry={refresh} />
          )}

          {!requestError && data && !autoCadOffline && !pluginOffline && !noDocument && !responseError && (
            <>
              {loading && <div className="drawing-refreshing"><span className="drawing-spin">↻</span> Đang cập nhật…</div>}

              {catalogStale && (
                <div className="drawing-catalog-state stale" role="status">
                  <strong>Bản vẽ đã thay đổi trong AutoCAD.</strong>
                  <span>Dữ liệu trên app là snapshot lúc {formatCollectedAt(data.collectedAt)}. Bấm “Quét lại từ AutoCAD” khi cần cập nhật.</span>
                </div>
              )}

              {!selectionCatalog && (
                <div className="drawing-catalog-state unsupported" role="status">
                  <strong>Lần quét này chưa có danh mục đối tượng.</strong>
                  <span>Hoàn tất lệnh đang chạy hoặc nhấn Esc trong AutoCAD, rồi bấm “Quét lại từ AutoCAD”. App sẽ quét một lượt bằng cả plugin mới và đường tương thích.</span>
                </div>
              )}

              <div className="drawing-metrics">
                <Metric label="Đối tượng" value={entityCount} tone="blue" />
                <Metric label="Layer" value={layerCount} tone="violet" />
                <Metric label="Block" value={blockCount} tone="amber" />
                <Metric label="Layout" value={layoutCount} tone="green" />
                <Metric label="Xref" value={xrefCount} tone="cyan" />
                <Metric label="Đang chọn" value={selectionCount} />
              </div>

              {!!data.warnings?.length && (
                <div className="drawing-warnings">
                  <strong>⚠ Lưu ý khi thu thập dữ liệu</strong>
                  <ul>{data.warnings.map((warning, index) => <li key={index}>{warningLabel(warning)}</li>)}</ul>
                </div>
              )}

              <div className="drawing-overview-grid">
                <Section title="Tài liệu" open>
                  <KeyValueGrid data={{ ...(document || {}), ...(data.file || {}) }}
                    filter={normalizedFilter} />
                </Section>
                <Section title="Ứng dụng AutoCAD" open>
                  <KeyValueGrid data={applicationInfo} filter={normalizedFilter} />
                </Section>
              </div>

              <Section title="Tóm tắt bản vẽ" open>
                <KeyValueGrid data={summary} filter={normalizedFilter} />
              </Section>

              <div className="drawing-overview-grid">
                <Section title="Biến hệ thống / Database" count={countFrom(drawing?.variables)} open>
                  <DataTable data={drawing?.variables} filter={normalizedFilter}
                    preferred={TABLE_COLUMNS.variables} />
                </Section>
                <Section title="Giới hạn hình học / Extents" open>
                  <KeyValueGrid data={drawing?.extents} filter={normalizedFilter} />
                </Section>
              </div>

              <div className="drawing-overview-grid">
                <Section title="Đối tượng theo loại" count={countFrom(drawing?.entitiesByType)} open>
                  <DataTable data={drawing?.entitiesByType} filter={normalizedFilter}
                    preferred={TABLE_COLUMNS.entityTypes} />
                </Section>
                <Section title="Đối tượng theo layer" count={countFrom(drawing?.entitiesByLayer)} open>
                  <DataTable data={drawing?.entitiesByLayer} filter={normalizedFilter}
                    preferred={TABLE_COLUMNS.entityLayers} />
                </Section>
              </div>

              <Section title="Đối tượng theo Model / Layout" count={countFrom(drawing?.entitiesBySpace)}>
                <DataTable data={drawing?.entitiesBySpace} filter={normalizedFilter}
                  preferred={["space", "name", "count"]} />
              </Section>

              <Section title="Layer" count={catalogLayerRows.length}>
                <div className={"drawing-selection-scope " + (selectionCatalog?.complete && !catalogStale ? "exact" : "partial")}>
                  Danh mục: <strong>{selectionCatalogLabel}</strong>
                  {selectionCatalog && <> · Đã quét {plainValue(selectionCatalog.scanned)} đối tượng</>}
                  {selectionCatalog
                    ? selectionCatalog.complete
                      ? " · Danh mục đầy đủ"
                      : " · Danh mục chưa đầy đủ; chỉ chọn được các đối tượng đã quét"
                    : " · Plugin cũ: hàng sẽ kiểm tra trực tiếp; nạp bản mới để dùng snapshot"}
                  {catalogStale && " · Có thay đổi mới; cần quét lại"}
                </div>
                <DataTable data={catalogLayerRows} filter={normalizedFilter}
                  preferred={TABLE_COLUMNS.layers}
                  selectionCountExact={selectionCatalog?.complete ?? selectionScopeComplete}
                  prioritizeSelectable={!!selectionCatalog}
                  rowAction={{
                    label: (row) => rowCatalogLabel("layer", row),
                    disabled: (row) => rowCatalogDisabled("layer", row),
                    busy: (row) => preparingRow === selectionRowKey("layer", row),
                    title: (row) => rowCatalogTitle("layer", row),
                    onClick: (row) => openObjectPicker("layer", row),
                  }} />
              </Section>

              <Section title="Block" count={catalogBlockRows.length}>
                <div className={"drawing-selection-scope " + (selectionCatalog?.complete && !catalogStale ? "exact" : "partial")}>
                  Danh mục: <strong>{selectionCatalogLabel}</strong>
                  {selectionCatalog && <> · Đã quét {plainValue(selectionCatalog.scanned)} đối tượng</>}
                  {selectionCatalog
                    ? selectionCatalog.complete
                      ? " · Danh mục đầy đủ"
                      : " · Danh mục chưa đầy đủ; chỉ chọn được các đối tượng đã quét"
                    : " · Plugin cũ: hàng sẽ kiểm tra trực tiếp; nạp bản mới để dùng snapshot"}
                  {catalogStale && " · Có thay đổi mới; cần quét lại"}
                </div>
                <DataTable data={catalogBlockRows} filter={normalizedFilter}
                  preferred={TABLE_COLUMNS.blocks}
                  selectionCountExact={selectionCatalog?.complete ?? selectionScopeComplete}
                  prioritizeSelectable={!!selectionCatalog}
                  rowAction={{
                    label: (row) => rowCatalogLabel("block", row),
                    disabled: (row) => rowCatalogDisabled("block", row),
                    busy: (row) => preparingRow === selectionRowKey("block", row),
                    title: (row) => rowCatalogTitle("block", row),
                    onClick: (row) => openObjectPicker("block", row),
                  }} />
              </Section>

              <Section title="Layout và viewport" count={countFrom(drawing?.layouts)}>
                <DataTable data={drawing?.layouts} filter={normalizedFilter}
                  preferred={TABLE_COLUMNS.layouts} />
              </Section>

              <Section title="External references (Xref)" count={countFrom(drawing?.xrefs)}>
                <DataTable data={drawing?.xrefs} filter={normalizedFilter}
                  preferred={["name", "path", "status", "overlay", "unloaded"]} />
              </Section>

              <Section title="Styles">
                <div className="drawing-style-grid">
                  <div><h4>Text style</h4><DataTable data={drawing?.styles?.text} filter={normalizedFilter} /></div>
                  <div><h4>Dimension style</h4><DataTable data={drawing?.styles?.dimension} filter={normalizedFilter} /></div>
                  <div><h4>Linetype</h4><DataTable data={drawing?.styles?.linetypes} filter={normalizedFilter} /></div>
                </div>
              </Section>

              <div className="drawing-overview-grid">
                <Section title="Registered applications" count={countFrom(drawing?.registeredApps)}>
                  <DataTable data={drawing?.registeredApps} filter={normalizedFilter} />
                </Section>
                <Section title="Named dictionaries" count={countFrom(drawing?.dictionaries)}>
                  <DataTable data={drawing?.dictionaries} filter={normalizedFilter} />
                </Section>
              </div>

              <Section title="Selection hiện tại" count={selectionCount}>
                {selectionRecord && <KeyValueGrid data={Object.fromEntries(
                  Object.entries(selectionRecord).filter(([, value]) => !Array.isArray(value)),
                )} filter={normalizedFilter} />}
                <DataTable data={selectionRows} filter={normalizedFilter}
                  preferred={TABLE_COLUMNS.selection} />
              </Section>

              <Section title="Phạm vi thu thập">
                <KeyValueGrid data={data.limits} filter={normalizedFilter} />
              </Section>

              <RawJsonSection data={data} />
            </>
          )}
        </div>
      </section>

      {objectPicker && (
        <div className="drawing-object-picker-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setObjectPicker(null);
        }}>
          <div className="drawing-object-picker" role="dialog" aria-modal="true" ref={pickerDialogRef}
            aria-labelledby="drawing-object-picker-title" onMouseDown={(event) => event.stopPropagation()}>
            <div className="drawing-object-picker-head">
              <div>
                <div className="drawing-info-kicker">Danh mục đã quét từ AutoCAD</div>
                <h3 id="drawing-object-picker-title">
                  {objectPicker.kind === "layer" ? "Layer" : "Block"} “{objectPicker.name}”
                </h3>
              </div>
              <button type="button" className="drawing-object-picker-close"
                onClick={() => setObjectPicker(null)} aria-label="Đóng danh sách">×</button>
            </div>
            <div className="drawing-object-picker-meta">
              <span>{objectPicker.subjects.length.toLocaleString("vi-VN")} đối tượng trong {selectionCatalogLabel}</span>
              <strong>{pickerSelectedCount.toLocaleString("vi-VN")} đã chọn</strong>
            </div>
            <label className="drawing-object-picker-all">
              <input type="checkbox" checked={pickerCanSelectAll && pickerSelectedCount === objectPicker.subjects.length}
                disabled={!pickerCanSelectAll}
                onChange={(event) => setPickerSelectAll(event.target.checked)} />
              <span>
                {pickerCanSelectAll
                  ? `Chọn tất cả ${objectPicker.subjects.length.toLocaleString("vi-VN")} đối tượng`
                  : objectPicker.complete
                    ? `Chọn tất cả không khả dụng (tối đa ${CAD_SELECTION_MAX_SUBJECTS.toLocaleString("vi-VN")})`
                    : "Chọn tất cả không khả dụng khi danh mục chưa đầy đủ"}
              </span>
            </label>
            {!objectPicker.complete && (
              <p className="drawing-object-picker-note">
                Chỉ các đối tượng đã quét được liệt kê; hãy quét lại để có danh mục đầy đủ trước khi chọn tất cả.
              </p>
            )}
            {objectPicker.subjects.length > CAD_SELECTION_MAX_SUBJECTS && (
              <p className="drawing-object-picker-note warning">
                Nhóm này vượt giới hạn {CAD_SELECTION_MAX_SUBJECTS.toLocaleString("vi-VN")}; bạn vẫn có thể chọn một tập con.
              </p>
            )}
            <label className="drawing-object-picker-search">
              <span className="drawing-sr-only">Lọc đối tượng</span>
              <input value={pickerFilter} onChange={(event) => {
                setPickerFilter(event.target.value);
                setPickerPage(0);
              }} placeholder="Tìm handle, loại, layer…" autoFocus />
            </label>
            <div className="drawing-object-picker-list" role="group" aria-label="Danh sách đối tượng">
              {visiblePickerSubjects.map((subject, index) => {
                const checked = objectPicker.selectedHandles.has(subject.handle);
                const ordinal = safePickerPage * PICKER_PAGE_SIZE + index + 1;
                return (
                  <label className="drawing-object-picker-row" key={subject.handle}>
                    <input type="checkbox" checked={checked}
                      disabled={!checked && pickerSelectedCount >= CAD_SELECTION_MAX_SUBJECTS}
                      onChange={(event) => setPickerSubjectChecked(subject.handle, event.target.checked)} />
                    <span className="drawing-object-picker-ordinal">{ordinal}</span>
                    <span className="drawing-object-picker-type">{subject.type}</span>
                    <code>{subject.handle}</code>
                    <span>{subject.layer}</span>
                    {subject.blockName && <span>{subject.blockName}</span>}
                  </label>
                );
              })}
              {!visiblePickerSubjects.length && <div className="drawing-empty-value">Không có đối tượng khớp bộ lọc.</div>}
            </div>
            <div className="drawing-object-picker-page">
              <button type="button" onClick={() => setPickerPage(Math.max(0, safePickerPage - 1))}
                disabled={safePickerPage === 0}>‹ Trước</button>
              <span>Trang {safePickerPage + 1}/{pickerPageCount} · {filteredPickerSubjects.length.toLocaleString("vi-VN")} kết quả</span>
              <button type="button" onClick={() => setPickerPage(Math.min(pickerPageCount - 1, safePickerPage + 1))}
                disabled={safePickerPage >= pickerPageCount - 1}>Sau ›</button>
            </div>
            <div className="drawing-object-picker-actions">
              <button type="button" onClick={() => setObjectPicker(null)}>Hủy</button>
              <button type="button" className="primary" onClick={submitObjectPicker}
                disabled={!pickerSelectedCount || pickerSelectedCount > CAD_SELECTION_MAX_SUBJECTS}>
                Chọn {pickerSelectedCount.toLocaleString("vi-VN")} trong AutoCAD
              </button>
            </div>
          </div>
        </div>
      )}

      {cadActionFeedback && !pendingCadAction && (
        <div className={`drawing-cad-feedback ${cadActionFeedback.tone}`}
          role={cadActionFeedback.tone === "error" ? "alert" : "status"} aria-live="polite">
          {cadActionFeedback.tone === "loading"
            ? <span className="drawing-action-spinner" aria-hidden="true" />
            : <span aria-hidden="true">{cadActionFeedback.tone === "success" ? "✓" : "!"}</span>}
          <strong>{cadActionFeedback.text}</strong>
          {cadActionFeedback.tone !== "loading" && (
            <button type="button" onClick={() => setCadActionFeedback(null)} aria-label="Đóng thông báo">×</button>
          )}
        </div>
      )}

      {pendingCadAction && (
        <div className="standards-confirm-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) void rejectPendingCadAction();
        }}>
          <div className="standards-confirm" role="alertdialog" aria-modal="true"
            aria-labelledby="drawing-cad-confirm-title">
            <div className="standards-confirm-icon">!</div>
            <h3 id="drawing-cad-confirm-title">
              {pendingCadAction.action === "activate-document"
                ? "Chuyển bản vẽ trong AutoCAD?"
                : "Chọn đối tượng trong AutoCAD?"}
            </h3>
            <p>Bản vẽ: <strong>{pendingCadAction.targetLabel}</strong>.</p>
            <p>Phạm vi: <strong>{pendingCadAction.scopeLabel}</strong>.</p>
            {pendingCadAction.count !== undefined && (
              <p>Số đối tượng: <strong>{pendingCadAction.count}</strong>.</p>
            )}
            {catalogStale && (
              <p className="drawing-confirm-stale">Snapshot nền đã cũ; thao tác vừa được kiểm tra trực tiếp và backend sẽ xác minh revision lần nữa khi áp dụng.</p>
            )}
            <div className="standards-confirm-actions">
              <button type="button" onClick={() => void rejectPendingCadAction()}
                disabled={!!cadActionBusy} autoFocus>
                {cadActionBusy === "reject" ? "Đang hủy…" : "Hủy"}
              </button>
              <button type="button" className="primary"
                onClick={() => void applyPendingCadAction()} disabled={!!cadActionBusy}>
                {cadActionBusy === "apply" ? "Đang áp dụng…" : "Xác nhận"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

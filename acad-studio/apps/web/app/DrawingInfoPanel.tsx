"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { asRecord, type JsonRecord } from "./json";

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
};

type DrawingInfoResponse = {
  ok?: boolean;
  status?: string;
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

export type DrawingInfoPanelProps = {
  open: boolean;
  daemon: string;
  initialTarget?: string;
  refreshToken?: number;
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
  selected: "Đang chọn",
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
  layers: ["name", "color", "linetype", "objectCount", "on", "frozen", "locked", "plottable"],
  blocks: ["name", "references", "count", "isXref", "isLayout", "anonymous"],
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

function formatCollectedAt(value: string | number | undefined): string {
  if (value == null || value === "") return "Chưa rõ thời điểm";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "medium" });
}

function matchesFilter(row: JsonRecord, filter: string): boolean {
  if (!filter) return true;
  return Object.entries(row).some(([key, value]) =>
    `${humanize(key)} ${plainValue(value)}`.toLocaleLowerCase("vi").includes(filter));
}

async function responseRecord(response: Response): Promise<JsonRecord> {
  const body = await response.json().catch(() => ({}));
  const record = asRecord(body) || {};
  if (!response.ok || record.ok === false) {
    throw new Error(String(record.error || record.message || `HTTP ${response.status}`));
  }
  return record;
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
}: {
  data: unknown;
  filter: string;
  preferred?: string[];
  rowAction?: {
    label: string;
    disabled?: boolean;
    onClick: (row: JsonRecord) => void;
  };
}) {
  const allRows = useMemo(() => normalizeRows(data), [data]);
  const rows = useMemo(() => allRows.filter((row) => matchesFilter(row, filter)), [allRows, filter]);
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
      </div>
      <div className="drawing-table-wrap">
        <table className="drawing-table">
          <thead>
            <tr>
              {columns.map((key) => <th key={key}>{humanize(key)}</th>)}
              {rowAction && <th>Thao tác</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, rowIndex) => (
              <tr key={String(firstValue(row, ["id", "handle", "name", "title"]) || rowIndex)}>
                {columns.map((key) => (
                  <td key={key} className={typeof row[key] === "object" && row[key] !== null ? "json" : undefined}
                    title={plainValue(row[key])}>
                    {shownValue(row[key])}
                  </td>
                ))}
                {rowAction && (
                  <td>
                    <button type="button" className="standards-link-button"
                      disabled={rowAction.disabled}
                      onClick={() => rowAction.onClick(row)}>
                      {rowAction.label}
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
  const [cadActionError, setCadActionError] = useState("");

  useEffect(() => {
    if (!open) return;
    setSelectedTarget(initialTarget?.trim() || "");
    setFilter("");
    setPendingCadAction(null);
    setCadActionError("");
  }, [open, initialTarget]);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const load = async () => {
      setLoading(true);
      setRequestError("");
      const base = daemon.replace(/\/+$/, "");
      const query = selectedTarget ? `?target=${encodeURIComponent(selectedTarget)}` : "";
      try {
        const response = await fetch(`${base}/api/acad/drawing-info${query}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const body = await response.json() as DrawingInfoResponse;
        if (!response.ok && !body.error) body.error = `HTTP ${response.status}`;
        setData(body);
      } catch (error) {
        if (!controller.signal.aborted) {
          setData(null);
          setRequestError(error instanceof Error ? error.message : String(error));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    };
    void load();
    return () => controller.abort();
  }, [open, daemon, selectedTarget, refreshToken, reloadToken]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (pendingCadAction) {
        void rejectPendingCadAction();
        return;
      }
      onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, onClose, pendingCadAction]);

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

  const refresh = () => setReloadToken((token) => token + 1);

  async function prepareCadAction(
    request: JsonRecord,
    display: Omit<PendingCadAction, "id" | "revision" | "action" | "target"> & {
      action: PendingCadAction["action"];
      target: string;
    },
  ) {
    if (cadActionBusy || pendingCadAction) return;
    setCadActionBusy("prepare");
    setCadActionError("");
    try {
      const body = await responseRecord(await fetch(
        `${daemon.replace(/\/+$/, "")}/api/acad/selection/prepare`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(request),
        },
      ));
      const operation = asRecord(body.operation) || {};
      const id = String(operation.id || body.operationId || "");
      if (!id) throw new Error("Daemon không trả operation id để xác nhận.");
      const summary = asRecord(operation.summary) || {};
      const subjects = Array.isArray(operation.subjects) ? operation.subjects : [];
      const rawCount = operation.subjectCount ?? operation.count ??
        summary.count ?? summary.subjectCount ??
        (subjects.length ? subjects.length : display.count);
      const count = Number(rawCount);
      setPendingCadAction({
        ...display,
        id,
        revision: String(operation.revision || body.revision || ""),
        action: display.action,
        target: String(operation.target || display.target),
        nextTarget: display.action === "activate-document"
          ? String(operation.target || display.nextTarget || display.target)
          : display.nextTarget,
        count: Number.isFinite(count) ? count : display.count,
      });
    } catch (error) {
      setCadActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setCadActionBusy("");
    }
  }

  async function applyPendingCadAction() {
    const pending = pendingCadAction;
    if (!pending || cadActionBusy) return;
    setCadActionBusy("apply");
    setCadActionError("");
    try {
      await responseRecord(await fetch(
        `${daemon.replace(/\/+$/, "")}/api/acad/selection/operations/` +
          `${encodeURIComponent(pending.id)}/apply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: pending.revision, confirmed: true }),
        },
      ));
      setPendingCadAction(null);
      if (pending.nextTarget) {
        setData(null);
        setSelectedTarget(pending.nextTarget);
      } else {
        refresh();
      }
    } catch (error) {
      // Apply is one-shot server-side. Force a fresh prepare instead of
      // offering a retry against an operation that may already be terminal.
      setPendingCadAction(null);
      setCadActionError(error instanceof Error ? error.message : String(error));
    } finally {
      setCadActionBusy("");
    }
  }

  async function rejectPendingCadAction() {
    const pending = pendingCadAction;
    if (!pending || cadActionBusy) return;
    setPendingCadAction(null);
    setCadActionBusy("reject");
    try {
      await fetch(
        `${daemon.replace(/\/+$/, "")}/api/acad/selection/operations/` +
          `${encodeURIComponent(pending.id)}/reject`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ revision: pending.revision }),
        },
      );
    } catch {
      // Best effort: the staged operation expires server-side and no CAD change is applied.
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

  function selectTableRow(kind: "layer" | "block", row: JsonRecord) {
    const name = String(row.name || "");
    if (!name) return;
    const exactTarget = documentPath || viewedTarget;
    const handle = String(row.handle || "");
    void prepareCadAction(
      {
        target: exactTarget,
        action: "select",
        scope: { kind, name, handle },
      },
      {
        action: "select",
        target: exactTarget,
        targetLabel: documentTitle,
        scopeLabel:
          `${kind === "layer" ? "Layer" : "Block"} “${name}” trong layout hiện hành`,
      },
    );
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
      <section className="drawing-info-panel" role="dialog" aria-modal="true" aria-labelledby="drawing-info-title">
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
            <button type="button" className="drawing-icon-btn" onClick={refresh} disabled={loading}
              title="Nạp lại toàn bộ thông tin" aria-label="Nạp lại toàn bộ thông tin">
              <span className={loading ? "drawing-spin" : ""}>↻</span>
            </button>
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
            <span className="drawing-collected">{formatCollectedAt(data?.collectedAt)}</span>
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
        </div>

        <div className="drawing-info-body">
          {cadActionError && (
            <div className="drawing-warnings">
              <strong>⚠ Không thực hiện được thao tác AutoCAD</strong>
              <div>{cadActionError}</div>
            </div>
          )}

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
                  <ul>{data.warnings.map((warning, index) => <li key={index}>{plainValue(warning)}</li>)}</ul>
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

              <Section title="Layer" count={countFrom(drawing?.layers)}>
                <DataTable data={drawing?.layers} filter={normalizedFilter}
                  preferred={TABLE_COLUMNS.layers}
                  rowAction={{
                    label: "Chọn trong AutoCAD",
                    disabled: !!cadActionBusy || !!pendingCadAction,
                    onClick: (row) => selectTableRow("layer", row),
                  }} />
              </Section>

              <Section title="Block" count={countFrom(drawing?.blocks)}>
                <DataTable data={drawing?.blocks} filter={normalizedFilter}
                  preferred={TABLE_COLUMNS.blocks}
                  rowAction={{
                    label: "Chọn trong AutoCAD",
                    disabled: !!cadActionBusy || !!pendingCadAction,
                    onClick: (row) => selectTableRow("block", row),
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

              <Section title="Dữ liệu thô (JSON)">
                <pre className="drawing-raw-json">{JSON.stringify(data, null, 2)}</pre>
              </Section>
            </>
          )}
        </div>
      </section>

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
            {cadActionError && <p>{cadActionError}</p>}
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

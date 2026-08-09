"use client";

import {
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { asRecord, daemonJson, type JsonRecord } from "../lib/daemon/client";
import { fetchDocs } from "../lib/daemon/docs";
import {
  applyStagedOp,
  prepareStagedOp,
  rejectStagedOp,
  stagedErrorText,
} from "../features/staged-ops/prepareApplyReject";

type AcadDocument = {
  title?: string;
  file?: string;
  active?: boolean;
};

type PaperStandard = {
  name: string;
  width: number;
  height: number;
};

type DrawingStandard = {
  unit: string;
  insunits: number;
  linearFormat: string;
  precision: number;
  modelScale: number;
  paper: PaperStandard;
  frameTolerancePercent: number;
};

type DimensionStandard = {
  styleName: string;
  precision: number;
  measurementScale: number;
  overallScale: number;
  fit: string;
  textVertical: string;
  textHorizontal: string;
  annotative: boolean;
  textHeight: number;
  font: string;
  textStyle: string;
  paperTextHeight: number;
  widthFactor: number;
  textColor: string | number;
  alignment: string;
  arrowhead: string;
  dimensionLineColor: string | number;
  extensionLineColor: string | number;
  extendBeyondDimLines: number;
  offsetFromOrigin: number;
  textGap: number;
  rowSpacing: number;
  rowTolerance: number;
};

type LayerStandard = {
  name: string;
  color: string | number;
  linetype: string;
  lineweight: string | number;
  required: boolean;
};

type ObjectMapping = {
  id: string;
  label: string;
  kind: string;
  layerPatterns: string[];
  blockPatterns: string[];
  textPatterns: string[];
  entityTypes: string[];
  required: boolean;
  bounds?: JsonRecord;
};

export type StandardsProfile = {
  id: string;
  name: string;
  drawing: DrawingStandard;
  dimension: DimensionStandard;
  layers: LayerStandard[];
  mappings: ObjectMapping[];
};

type StandardsIssue = {
  id: string;
  scope: string;
  severity: string;
  message: string;
  handles: string[];
  current?: unknown;
  expected?: unknown;
  suggestedAction?: unknown;
};

type MappedObject = {
  mappingId: string;
  label: string;
  kind: string;
  handle: string;
  type: string;
  layer: string;
  area?: number;
  areaUnit?: string;
  width?: number;
  height?: number;
};

type StandardsScan = {
  scanId: string;
  target: string;
  scannedAt?: string | number;
  current?: unknown;
  issues: StandardsIssue[];
  objects: MappedObject[];
  dimensions?: unknown;
};

type SelectionObject = {
  handle: string;
  type: string;
  layer: string;
};

type Notice = {
  tone: "ok" | "error" | "info" | "warn";
  text: string;
};

type PendingSelectionAction = {
  id: string;
  revision: string;
  action: "activate-document" | "select" | "move-to-layer";
  target: string;
  scopeLabel: string;
  count?: number;
  nextTarget?: string;
};

type TabId =
  | "overview"
  | "frame"
  | "units"
  | "objects"
  | "dimension"
  | "layers";

type StandardAction =
  | "scale"
  | "rotate"
  | "color"
  | "layer"
  | "area"
  | "dimspace"
  | "apply-units"
  | "apply-dimstyle"
  | "sync-layers"
  | "resize-frame"
  | "select";

export type DrawingStandardsPanelProps = {
  open: boolean;
  daemon: string;
  initialTarget?: string;
  refreshToken?: number;
  onClose: () => void;
  onOpenAutoCAD?: () => void;
};

const DEFAULT_DRAWING: DrawingStandard = {
  unit: "mm",
  insunits: 4,
  linearFormat: "Decimal",
  precision: 0,
  modelScale: 1,
  paper: { name: "A3", width: 420, height: 297 },
  frameTolerancePercent: 1,
};

const DEFAULT_DIMENSION: DimensionStandard = {
  styleName: "STANDARD",
  precision: 0,
  measurementScale: 1,
  overallScale: 1,
  fit: "Best fit",
  textVertical: "Above",
  textHorizontal: "Centered",
  annotative: false,
  textHeight: 2.5,
  font: "",
  textStyle: "STANDARD",
  paperTextHeight: 2.5,
  widthFactor: 1,
  textColor: "ByLayer",
  alignment: "Aligned with dimension line",
  arrowhead: "Closed filled",
  dimensionLineColor: "ByLayer",
  extensionLineColor: "ByLayer",
  extendBeyondDimLines: 1.25,
  offsetFromOrigin: 0.625,
  textGap: 0.625,
  rowSpacing: 10,
  rowTolerance: 1,
};

const EMPTY_PROFILE: StandardsProfile = {
  id: "",
  name: "Mẫu quy chuẩn mới",
  drawing: DEFAULT_DRAWING,
  dimension: DEFAULT_DIMENSION,
  layers: [],
  mappings: [],
};

const TABS: { id: TabId; label: string; icon: string }[] = [
  { id: "overview", label: "Tổng quan", icon: "✓" },
  { id: "frame", label: "Khung & tỷ lệ", icon: "▱" },
  { id: "units", label: "Đơn vị", icon: "↔" },
  { id: "objects", label: "Đối tượng", icon: "◇" },
  { id: "dimension", label: "Dimension", icon: "↕" },
  { id: "layers", label: "Layer", icon: "▤" },
];

const MUTATING_ACTIONS = new Set<StandardAction>([
  "scale",
  "rotate",
  "color",
  "layer",
  "dimspace",
  "apply-units",
  "apply-dimstyle",
  "sync-layers",
  "resize-frame",
]);

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean);
}

function commaList(value: string): string[] {
  return value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function shownValue(value: unknown): string {
  if (value == null || value === "") return "—";
  if (typeof value === "boolean") return value ? "Có" : "Không";
  if (typeof value === "number") {
    return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 6 }).format(value);
  }
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function shownDate(value: string | number | undefined): string {
  if (value == null || value === "") return "Chưa quét";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("vi-VN", { dateStyle: "short", timeStyle: "medium" });
}

function targetOf(document: AcadDocument): string {
  return String(document.file || document.title || "");
}

function normalizeProfile(value: unknown): StandardsProfile {
  const source = asRecord(value) || {};
  const drawingSource = asRecord(source.drawing) || {};
  const paperSource = asRecord(drawingSource.paper) || {};
  const dimensionSource = asRecord(source.dimension) || {};
  const layers = Array.isArray(source.layers)
    ? source.layers.map((item) => {
        const layer = asRecord(item) || {};
        return {
          name: String(layer.name || ""),
          color: typeof layer.color === "number" ? layer.color : String(layer.color ?? "7"),
          linetype: String(layer.linetype || "Continuous"),
          lineweight: typeof layer.lineweight === "number"
            ? layer.lineweight
            : String(layer.lineweight ?? "Default"),
          required: layer.required !== false,
        };
      })
    : [];
  const mappings = Array.isArray(source.mappings)
    ? source.mappings.map((item, index) => {
        const mapping = asRecord(item) || {};
        return {
          id: String(mapping.id || `mapping-${index + 1}`),
          label: String(mapping.label || ""),
          kind: String(mapping.kind || "object"),
          layerPatterns: stringList(mapping.layerPatterns),
          blockPatterns: stringList(mapping.blockPatterns),
          textPatterns: stringList(mapping.textPatterns),
          entityTypes: stringList(mapping.entityTypes),
          required: mapping.required === true,
          bounds: asRecord(mapping.bounds) || undefined,
        };
      })
    : [];
  return {
    id: String(source.id || ""),
    name: String(source.name || "Mẫu quy chuẩn"),
    drawing: {
      ...DEFAULT_DRAWING,
      ...drawingSource,
      paper: { ...DEFAULT_DRAWING.paper, ...paperSource },
    } as DrawingStandard,
    dimension: {
      ...DEFAULT_DIMENSION,
      ...dimensionSource,
    } as DimensionStandard,
    layers,
    mappings,
  };
}

function normalizeIssue(value: unknown, index: number): StandardsIssue {
  const issue = asRecord(value) || {};
  return {
    id: String(issue.id || `issue-${index + 1}`),
    scope: String(issue.scope || "drawing"),
    severity: String(issue.severity || "warning").toLowerCase(),
    message: String(issue.message || "Sai khác so với mẫu quy chuẩn"),
    handles: stringList(issue.handles),
    current: issue.current,
    expected: issue.expected,
    suggestedAction: issue.suggestedAction,
  };
}

function normalizeObject(value: unknown): MappedObject {
  const object = asRecord(value) || {};
  const optionalNumber = (key: string): number | undefined => {
    const number = Number(object[key]);
    return Number.isFinite(number) ? number : undefined;
  };
  return {
    mappingId: String(object.mappingId || ""),
    label: String(object.label || ""),
    kind: String(object.kind || ""),
    handle: String(object.handle || ""),
    type: String(object.type || ""),
    layer: String(object.layer || ""),
    area: optionalNumber("area"),
    areaUnit: String(object.areaUnit || ""),
    width: optionalNumber("width"),
    height: optionalNumber("height"),
  };
}

function recordRows(value: unknown): JsonRecord[] {
  if (Array.isArray(value)) {
    return value.map((item) => asRecord(item) || { value: item });
  }
  const record = asRecord(value);
  if (!record) return [];
  for (const key of ["items", "rows", "objects", "dimensions", "results"]) {
    if (Array.isArray(record[key])) return recordRows(record[key]);
  }
  return Object.entries(record).map(([key, item]) => ({
    id: key,
    ...(asRecord(item) || { value: item }),
  }));
}

function dimensionHandle(row: JsonRecord): string {
  return String(row.handle || row.id || "");
}

function dimensionLabel(row: JsonRecord): string {
  const handle = dimensionHandle(row);
  const style = String(row.style || row.dimstyle || row.styleName || "");
  const measurement = row.measurement ?? row.value ?? "";
  return [handle, style, measurement === "" ? "" : shownValue(measurement)]
    .filter(Boolean)
    .join(" · ");
}

function scopeMatches(tab: TabId, scope: string): boolean {
  if (tab === "overview") return true;
  const normalized = scope.toLowerCase();
  if (tab === "frame") return /frame|paper|scale|khung|tỷ lệ|ty le/.test(normalized);
  if (tab === "units") return /unit|đơn vị|don vi/.test(normalized);
  if (tab === "objects") return /object|mapping|area|đối tượng|doi tuong/.test(normalized);
  if (tab === "dimension") return /dim|dimension/.test(normalized);
  return /layer/.test(normalized);
}

function severityLabel(severity: string): string {
  if (severity === "error" || severity === "critical") return "Lỗi";
  if (severity === "info") return "Thông tin";
  return "Cảnh báo";
}

function Section({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="standards-section">
      <header>
        <div>
          <h3>{title}</h3>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="standards-section-actions">{actions}</div>}
      </header>
      <div className="standards-section-body">{children}</div>
    </section>
  );
}

function Field({
  label,
  hint,
  className = "",
  children,
}: {
  label: string;
  hint?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`standards-field ${className}`.trim()}>
      <span className="standards-field-label">{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}

function Metric({
  label,
  value,
  tone = "",
}: {
  label: string;
  value: unknown;
  tone?: string;
}) {
  return (
    <div className={`standards-metric ${tone}`.trim()}>
      <span>{label}</span>
      <strong>{shownValue(value)}</strong>
    </div>
  );
}

function EmptyState({
  title,
  text,
  children,
}: {
  title: string;
  text: string;
  children?: ReactNode;
}) {
  return (
    <div className="standards-empty">
      <div className="standards-empty-icon">✓</div>
      <h3>{title}</h3>
      <p>{text}</p>
      {children && <div className="standards-empty-actions">{children}</div>}
    </div>
  );
}

function IssueTable({
  issues,
  selected,
  disabled,
  onToggle,
  onSelectObject,
}: {
  issues: StandardsIssue[];
  selected: Set<string>;
  disabled: boolean;
  onToggle: (issueId: string) => void;
  onSelectObject: (issue: StandardsIssue) => void;
}) {
  if (!issues.length) {
    return <div className="standards-no-rows">Không có lỗi thuộc nhóm này.</div>;
  }
  return (
    <div className="standards-table-wrap">
      <table className="standards-table standards-issues-table">
        <thead>
          <tr>
            <th className="check" aria-label="Chọn" />
            <th>Mức độ</th>
            <th>Nội dung</th>
            <th>Hiện tại</th>
            <th>Yêu cầu</th>
            <th>Đối tượng</th>
          </tr>
        </thead>
        <tbody>
          {issues.map((issue) => (
            <tr key={issue.id} className={selected.has(issue.id) ? "selected" : ""}>
              <td className="check">
                <input
                  type="checkbox"
                  checked={selected.has(issue.id)}
                  onChange={() => onToggle(issue.id)}
                  disabled={disabled}
                  aria-label={`Chọn lỗi ${issue.message}`}
                />
              </td>
              <td>
                <span className={`standards-severity ${issue.severity}`}>
                  {severityLabel(issue.severity)}
                </span>
              </td>
              <td>
                <strong>{issue.message}</strong>
                <small>{issue.scope}</small>
                {issue.suggestedAction != null && (
                  <em>Gợi ý: {shownValue(issue.suggestedAction)}</em>
                )}
              </td>
              <td title={shownValue(issue.current)}>{shownValue(issue.current)}</td>
              <td title={shownValue(issue.expected)}>{shownValue(issue.expected)}</td>
              <td>
                {issue.handles.length ? (
                  <button
                    type="button"
                    className="standards-link-button"
                    onClick={() => onSelectObject(issue)}
                    disabled={disabled}
                    title="Chọn và zoom các đối tượng trong AutoCAD"
                  >
                    {issue.handles.length} handle
                  </button>
                ) : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BoundsEditor({
  mapping,
  onChange,
  onPendingChange,
  onError,
}: {
  mapping: ObjectMapping;
  onChange: (bounds: JsonRecord | undefined) => void;
  onPendingChange: (pending: boolean) => void;
  onError: (message: string) => void;
}) {
  const serialized = mapping.bounds ? JSON.stringify(mapping.bounds, null, 2) : "";
  const [text, setText] = useState(serialized);

  useEffect(() => setText(serialized), [mapping.id, serialized]);

  const commit = () => {
    if (text === serialized) {
      onPendingChange(false);
      return;
    }
    const trimmed = text.trim();
    if (!trimmed) {
      onChange(undefined);
      onPendingChange(false);
      return;
    }
    try {
      const parsed = JSON.parse(trimmed);
      const record = asRecord(parsed);
      if (!record) throw new Error("Bounds phải là một JSON object.");
      onChange(record);
      onPendingChange(false);
    } catch (error) {
      onPendingChange(true);
      onError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Field label="Giới hạn nhận diện (JSON)" className="wide"
      hint='Ví dụ: {"minArea":12,"maxArea":60,"minWidth":2500}'>
      <textarea
        rows={3}
        value={text}
        onChange={(event) => {
          const nextText = event.target.value;
          setText(nextText);
          onPendingChange(nextText !== serialized);
        }}
        onBlur={commit}
        placeholder='{"minArea": 12, "maxArea": 60}'
      />
    </Field>
  );
}

function ListEditor({
  ownerId,
  label,
  values,
  placeholder,
  onChange,
}: {
  ownerId: string;
  label: string;
  values: string[];
  placeholder?: string;
  onChange: (values: string[]) => void;
}) {
  const serialized = values.join(", ");
  const [text, setText] = useState(serialized);

  useEffect(() => setText(serialized), [ownerId, serialized]);

  return (
    <Field label={label} className="wide">
      <input
        value={text}
        placeholder={placeholder}
        onChange={(event) => {
          const nextText = event.target.value;
          setText(nextText);
          onChange(commaList(nextText));
        }}
      />
    </Field>
  );
}

export default function DrawingStandardsPanel({
  open,
  daemon,
  initialTarget,
  refreshToken = 0,
  onClose,
  onOpenAutoCAD,
}: DrawingStandardsPanelProps) {
  const baseUrl = useMemo(() => daemon.replace(/\/+$/, ""), [daemon]);
  const [tab, setTab] = useState<TabId>("overview");
  const [documents, setDocuments] = useState<AcadDocument[]>([]);
  const [docsAlive, setDocsAlive] = useState<boolean | null>(null);
  const [target, setTarget] = useState(initialTarget?.trim() || "");
  const [profiles, setProfiles] = useState<StandardsProfile[]>([]);
  const [activeProfileId, setActiveProfileId] = useState("");
  const [profileId, setProfileId] = useState("");
  const [draft, setDraft] = useState<StandardsProfile | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pendingBounds, setPendingBounds] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const [profileBusy, setProfileBusy] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState("");
  const [applyBusy, setApplyBusy] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [scan, setScan] = useState<StandardsScan | null>(null);
  const [scanStale, setScanStale] = useState(false);
  const [selectedIssueIds, setSelectedIssueIds] = useState<string[]>([]);
  const [dimBaseHandle, setDimBaseHandle] = useState("");
  const [confirmApplyOpen, setConfirmApplyOpen] = useState(false);
  const [selection, setSelection] = useState<SelectionObject[]>([]);
  const [selectionBusy, setSelectionBusy] = useState(false);
  const [pendingSelectionAction, setPendingSelectionAction] =
    useState<PendingSelectionAction | null>(null);
  const [layerImportBusy, setLayerImportBusy] = useState(false);
  const [directScope, setDirectScope] = useState<"selection" | "drawing">("selection");
  const [directFactor, setDirectFactor] = useState("1");
  const [directAngle, setDirectAngle] = useState("0");
  const [directBase, setDirectBase] = useState("");
  const [directColor, setDirectColor] = useState("ByLayer");
  const [directLayer, setDirectLayer] = useState("");
  const [actionResult, setActionResult] = useState<unknown>(null);
  const activeDocument = documents.find((document) => document.active);
  const activeDocumentTarget = activeDocument ? targetOf(activeDocument) : "";
  const hasUnsavedChanges = dirty || pendingBounds.size > 0;

  const selectedIssues = useMemo(
    () => new Set(selectedIssueIds),
    [selectedIssueIds],
  );
  const visibleIssues = useMemo(
    () => (scan?.issues || []).filter((issue) => scopeMatches(tab, issue.scope)),
    [scan, tab],
  );
  const dimensionRows = useMemo(
    () => recordRows(scan?.dimensions),
    [scan?.dimensions],
  );
  const selectedDimensionHandles = useMemo(() => {
    const handles = (scan?.issues || [])
      .filter((issue) => selectedIssues.has(issue.id) && scopeMatches("dimension", issue.scope))
      .flatMap((issue) => issue.handles);
    return Array.from(new Set(handles));
  }, [scan, selectedIssues]);

  async function loadDocuments(signal?: AbortSignal) {
    try {
      const { alive, docs } = await fetchDocs(baseUrl, signal);
      setDocuments(docs);
      setDocsAlive(alive);
      setTarget((current) => {
        if (current && docs.some((doc) => targetOf(doc) === current)) return current;
        const desired = initialTarget?.trim() || current;
        const matching = docs.find((doc) =>
          doc.title === desired || doc.file === desired);
        if (matching) return targetOf(matching);
        const active = docs.find((doc) => doc.active) || docs[0];
        return active ? targetOf(active) : desired;
      });
    } catch (error) {
      if (signal?.aborted) return;
      setDocuments([]);
      setDocsAlive(false);
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function loadProfiles(preferredId?: string, signal?: AbortSignal) {
    try {
      const body = await daemonJson<{
        activeProfileId?: string;
        profiles?: unknown[];
      }>(await fetch(`${baseUrl}/api/acad/standards/profiles`, {
        cache: "no-store",
        signal,
      }));
      const nextProfiles = Array.isArray(body.profiles)
        ? body.profiles.map(normalizeProfile)
        : [];
      const serverActive = String(body.activeProfileId || "");
      const wanted = preferredId && nextProfiles.some((profile) => profile.id === preferredId)
        ? preferredId
        : nextProfiles.some((profile) => profile.id === profileId)
          ? profileId
          : nextProfiles.some((profile) => profile.id === serverActive)
            ? serverActive
            : nextProfiles[0]?.id || "";
      setProfiles(nextProfiles);
      setActiveProfileId(serverActive);
      setProfileId(wanted);
      setDraft(nextProfiles.find((profile) => profile.id === wanted) || null);
      setDirty(false);
      setPendingBounds(new Set());
    } catch (error) {
      if (signal?.aborted) return;
      setProfiles([]);
      setProfileId("");
      setDraft(null);
      setPendingBounds(new Set());
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    }
  }

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setLoading(true);
    setTab("overview");
    setNotice(null);
    setScan(null);
    setScanStale(false);
    setSelectedIssueIds([]);
    setDimBaseHandle("");
    setSelection([]);
    setPendingSelectionAction(null);
    setActionResult(null);
    setPendingBounds(new Set());
    void Promise.all([
      loadDocuments(controller.signal),
      loadProfiles(undefined, controller.signal),
    ]).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
    // Opening a panel creates a fresh view. Further target changes are handled below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, baseUrl]);

  useEffect(() => {
    if (!open || !initialTarget?.trim()) return;
    setTarget(initialTarget.trim());
    setScan(null);
    setSelectedIssueIds([]);
    setDimBaseHandle("");
    setScanStale(false);
    setSelection([]);
    setActionResult(null);
  }, [open, initialTarget]);

  useEffect(() => {
    if (!open || refreshToken === 0) return;
    const controller = new AbortController();
    void loadDocuments(controller.signal);
    if (scan) setScanStale(true);
    return () => controller.abort();
    // refreshToken is an external invalidation signal from AutoCAD events.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, refreshToken]);

  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (pendingSelectionAction) {
        void rejectPendingSelectionAction();
        return;
      }
      if (confirmApplyOpen) {
        setConfirmApplyOpen(false);
        return;
      }
      requestClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [open, confirmApplyOpen, pendingSelectionAction, hasUnsavedChanges, onClose]);

  if (!open) return null;

  function requestClose() {
    if (hasUnsavedChanges && !window.confirm("Mẫu quy chuẩn có thay đổi chưa lưu. Đóng và bỏ thay đổi?")) {
      return;
    }
    onClose();
  }

  function changeProfile(nextId: string) {
    if (nextId === profileId) return;
    if (hasUnsavedChanges && !window.confirm("Bỏ các thay đổi chưa lưu của mẫu hiện tại?")) return;
    const profile = profiles.find((item) => item.id === nextId) || null;
    setProfileId(nextId);
    setDraft(profile);
    setDirty(false);
    setPendingBounds(new Set());
    setScan(null);
    setSelectedIssueIds([]);
    setDimBaseHandle("");
    setScanStale(false);
    setActionResult(null);
  }

  function updateDraft(updater: (profile: StandardsProfile) => StandardsProfile) {
    setDraft((current) => current ? updater(current) : current);
    setDirty(true);
  }

  function updatePendingBounds(mappingId: string, pending: boolean) {
    setPendingBounds((current) => {
      if (current.has(mappingId) === pending) return current;
      const next = new Set(current);
      if (pending) next.add(mappingId);
      else next.delete(mappingId);
      return next;
    });
  }

  function updateDrawing<K extends keyof DrawingStandard>(
    key: K,
    value: DrawingStandard[K],
  ) {
    updateDraft((profile) => ({
      ...profile,
      drawing: { ...profile.drawing, [key]: value },
    }));
  }

  function updatePaper<K extends keyof PaperStandard>(
    key: K,
    value: PaperStandard[K],
  ) {
    updateDraft((profile) => ({
      ...profile,
      drawing: {
        ...profile.drawing,
        paper: { ...profile.drawing.paper, [key]: value },
      },
    }));
  }

  function updateDimension<K extends keyof DimensionStandard>(
    key: K,
    value: DimensionStandard[K],
  ) {
    updateDraft((profile) => ({
      ...profile,
      dimension: { ...profile.dimension, [key]: value },
    }));
  }

  function updateLayer(index: number, patch: Partial<LayerStandard>) {
    updateDraft((profile) => ({
      ...profile,
      layers: profile.layers.map((layer, row) =>
        row === index ? { ...layer, ...patch } : layer),
    }));
  }

  function removeLayer(index: number) {
    updateDraft((profile) => ({
      ...profile,
      layers: profile.layers.filter((_, row) => row !== index),
    }));
  }

  function addLayer() {
    updateDraft((profile) => ({
      ...profile,
      layers: [
        ...profile.layers,
        { name: "", color: "7", linetype: "Continuous", lineweight: "Default", required: true },
      ],
    }));
  }

  function updateMapping(index: number, patch: Partial<ObjectMapping>) {
    updateDraft((profile) => ({
      ...profile,
      mappings: profile.mappings.map((mapping, row) =>
        row === index ? { ...mapping, ...patch } : mapping),
    }));
  }

  function removeMapping(index: number) {
    const mappingId = draft?.mappings[index]?.id;
    if (mappingId) updatePendingBounds(mappingId, false);
    updateDraft((profile) => ({
      ...profile,
      mappings: profile.mappings.filter((_, row) => row !== index),
    }));
  }

  function addMapping() {
    updateDraft((profile) => ({
      ...profile,
      mappings: [
        ...profile.mappings,
        {
          id: `mapping-${Date.now().toString(36)}`,
          label: "",
          kind: "room",
          layerPatterns: [],
          blockPatterns: [],
          textPatterns: [],
          entityTypes: [],
          required: false,
        },
      ],
    }));
  }

  async function saveProfile() {
    if (!draft?.id || pendingBounds.size > 0) return;
    setProfileBusy(true);
    setNotice(null);
    try {
      await daemonJson(await fetch(
        `${baseUrl}/api/acad/standards/profiles/${encodeURIComponent(draft.id)}`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(draft),
        },
      ));
      await loadProfiles(draft.id);
      setNotice({ tone: "ok", text: `Đã lưu mẫu “${draft.name}”.` });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setProfileBusy(false);
    }
  }

  async function duplicateProfile() {
    const name = draft ? `${draft.name} (bản sao)` : EMPTY_PROFILE.name;
    setProfileBusy(true);
    setNotice(null);
    try {
      const body = await daemonJson<JsonRecord>(await fetch(
        `${baseUrl}/api/acad/standards/profiles`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name,
            ...(draft?.id ? { sourceId: draft.id } : {}),
          }),
        },
      ));
      const created = asRecord(body.profile);
      const createdId = String(created?.id || body.profileId || body.id || "");
      await loadProfiles(createdId || undefined);
      setNotice({ tone: "ok", text: `Đã tạo mẫu “${name}”.` });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setProfileBusy(false);
    }
  }

  async function runScan() {
    if (!target || !profileId || hasUnsavedChanges) return;
    setScanBusy(true);
    setNotice(null);
    setActionResult(null);
    try {
      const body = await daemonJson<JsonRecord>(await fetch(
        `${baseUrl}/api/acad/standards/scan`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ target, profileId }),
        },
      ));
      const issues = Array.isArray(body.issues)
        ? body.issues.map(normalizeIssue)
        : [];
      const objects = Array.isArray(body.objects)
        ? body.objects.map(normalizeObject)
        : [];
      const nextScan: StandardsScan = {
        scanId: String(body.scanId || ""),
        target: String(body.target || target),
        scannedAt: body.scannedAt as string | number | undefined,
        current: body.current,
        issues,
        objects,
        dimensions: body.dimensions,
      };
      if (!nextScan.scanId) throw new Error("Kết quả quét thiếu scanId.");
      setScan(nextScan);
      setSelectedIssueIds(issues.map((issue) => issue.id));
      setScanStale(false);
      const firstDimension = recordRows(body.dimensions)
        .map(dimensionHandle)
        .find(Boolean);
      setDimBaseHandle(firstDimension || "");
      setNotice({
        tone: issues.length ? "warn" : "ok",
        text: issues.length
          ? `Đã quét xong: tìm thấy ${issues.length} mục cần kiểm tra.`
          : "Bản vẽ đang khớp mẫu quy chuẩn.",
      });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setScanBusy(false);
    }
  }

  function toggleIssue(issueId: string) {
    setSelectedIssueIds((current) =>
      current.includes(issueId)
        ? current.filter((id) => id !== issueId)
        : [...current, issueId],
    );
  }

  function toggleVisibleIssues() {
    const visibleIds = visibleIssues.map((issue) => issue.id);
    const allSelected = visibleIds.length > 0 &&
      visibleIds.every((id) => selectedIssues.has(id));
    setSelectedIssueIds((current) => {
      if (allSelected) return current.filter((id) => !visibleIds.includes(id));
      return Array.from(new Set([...current, ...visibleIds]));
    });
  }

  async function applySelectedIssues() {
    if (!scan?.scanId || !selectedIssueIds.length) return;
    setApplyBusy(true);
    setNotice(null);
    try {
      const body = await daemonJson<JsonRecord>(await fetch(
        `${baseUrl}/api/acad/standards/apply`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scanId: scan.scanId,
            issueIds: selectedIssueIds,
            ...(dimBaseHandle ? { dimBaseHandle } : {}),
          }),
        },
      ));
      setConfirmApplyOpen(false);
      setSelectedIssueIds([]);
      setScanStale(true);
      setNotice({
        tone: "ok",
        text: String(body.hint || body.message ||
          `Đã áp dụng ${selectedIssueIds.length} điều chỉnh.`),
      });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setApplyBusy(false);
    }
  }

  async function prepareSelectionAction(
    request: JsonRecord,
    action: PendingSelectionAction["action"],
    scopeLabel: string,
    fallbackCount?: number,
  ) {
    const requestedTarget = String(request.target || target);
    if (!requestedTarget || actionBusy || pendingSelectionAction) return;
    setActionBusy(action);
    setNotice(null);
    try {
      const op = await prepareStagedOp(baseUrl, request, {
        action,
        fallbackCount,
      });
      setPendingSelectionAction({
        id: op.id,
        revision: op.revision,
        action,
        target: op.target || requestedTarget,
        scopeLabel,
        count: op.count ?? fallbackCount,
        ...(action === "activate-document"
          ? { nextTarget: op.nextTarget || requestedTarget }
          : {}),
      });
    } catch (error) {
      setNotice({ tone: "error", text: stagedErrorText(error) });
    } finally {
      setActionBusy("");
    }
  }

  async function applyPendingSelectionAction() {
    const pending = pendingSelectionAction;
    if (!pending || actionBusy) return;
    setActionBusy("selection-apply");
    setNotice(null);
    try {
      const body = await applyStagedOp(baseUrl, pending);
      setPendingSelectionAction(null);
      if (pending.action === "activate-document") {
        await loadDocuments();
        setTarget(pending.nextTarget || pending.target);
        setScan(null);
        setSelectedIssueIds([]);
        setDimBaseHandle("");
        setScanStale(false);
        setSelection([]);
        setActionResult(null);
      } else {
        if (pending.action === "move-to-layer") setScanStale(!!scan);
        const result = asRecord(body.result);
        const resultSubjects = recordRows(result?.subjects);
        if (!resultSubjects.length) {
          throw new Error(
            "AutoCAD đã xử lý thao tác nhưng daemon không trả selection để đồng bộ app.",
          );
        }
        setSelection(resultSubjects.map((object) => ({
          handle: String(object.handle || object.id || ""),
          type: String(object.type || object.name || ""),
          layer: String(object.layer || ""),
        })).filter((object) => object.handle));
      }
      setNotice({
        tone: "ok",
        text: String(body.hint || body.message ||
          (pending.action === "activate-document"
            ? "Đã kích hoạt bản vẽ trong AutoCAD."
            : pending.action === "select"
              ? "Đã chọn đối tượng trong AutoCAD."
              : "Đã chuyển layer cho selection.")),
      });
    } catch (error) {
      // Apply is one-shot. A retry must start from a new capture/proposal.
      setPendingSelectionAction(null);
      setNotice({ tone: "error", text: stagedErrorText(error) });
    } finally {
      setActionBusy("");
    }
  }

  async function rejectPendingSelectionAction() {
    const pending = pendingSelectionAction;
    if (!pending || actionBusy) return;
    setPendingSelectionAction(null);
    setActionBusy("selection-reject");
    try {
      await rejectStagedOp(baseUrl, pending);
    } finally {
      setActionBusy("");
    }
  }

  async function runAction(
    action: StandardAction,
    params: JsonRecord = {},
    handles?: string[],
    confirmation?: string,
  ) {
    if (!target) return;
    if (
      MUTATING_ACTIONS.has(action) &&
      confirmation &&
      !window.confirm(confirmation)
    ) {
      return;
    }
    setActionBusy(action);
    setNotice(null);
    try {
      const body = await daemonJson<JsonRecord>(await fetch(
        `${baseUrl}/api/acad/standards/action`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            target,
            action,
            ...(handles ? { handles } : {}),
            params,
          }),
        },
      ));
      setActionResult(body);
      if (MUTATING_ACTIONS.has(action)) setScanStale(!!scan);
      setNotice({
        tone: "ok",
        text: String(body.hint || body.message || `Đã chạy “${action}”.`),
      });
      return body;
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      setActionBusy("");
    }
  }

  async function prepareHandleSelection(handles: string[], scopeLabel: string) {
    if (!handles.length) return;
    const current = asRecord(scan?.current);
    const document = asRecord(current?.document);
    const instance = String(document?.instance || "").trim();
    const revision = Number(document?.revision);
    if (!instance || !Number.isSafeInteger(revision) || revision < 0) {
      setScanStale(true);
      setNotice({
        tone: "error",
        text: "Kết quả quét thiếu định danh phiên bản bản vẽ; hãy quét lại trước khi chọn đối tượng.",
      });
      return;
    }
    await prepareSelectionAction(
      {
        target,
        action: "select",
        scope: { kind: "handles", handles },
        catalogGuard: { instance, revision },
      },
      "select",
      scopeLabel,
      handles.length,
    );
  }

  async function prepareTargetActivation(nextTarget: string) {
    if (!nextTarget || nextTarget === activeDocumentTarget) return;
    const document = documents.find((item) => targetOf(item) === nextTarget);
    await prepareSelectionAction(
      { target: nextTarget, action: "activate-document" },
      "activate-document",
      `Kích hoạt bản vẽ “${document?.title || nextTarget}”`,
      1,
    );
  }

  async function selectIssueObjects(issue: StandardsIssue) {
    await prepareHandleSelection(
      issue.handles,
      `${issue.handles.length} handle của lỗi “${issue.message}”`,
    );
  }

  async function importCurrentSelection(silent = false) {
    if (!target) return;
    setSelectionBusy(true);
    if (!silent) setNotice(null);
    try {
      const query = `?target=${encodeURIComponent(target)}`;
      const body = await daemonJson<JsonRecord>(await fetch(
        `${baseUrl}/api/acad/selection/current${query}`,
        { cache: "no-store" },
      ));
      const rawSelection = asRecord(body.selection) || body;
      const rawObjects = rawSelection?.objects ?? rawSelection?.entities ??
        rawSelection?.items ?? rawSelection?.rows ?? body.subjects;
      const objects = recordRows(rawObjects).map((object) => ({
        handle: String(object.handle || object.id || ""),
        type: String(object.type || object.name || ""),
        layer: String(object.layer || ""),
      })).filter((object) => object.handle);
      setSelection(objects);
      if (!silent) {
        const rawCount = Number(body.count ?? rawSelection?.count);
        const count = Number.isFinite(rawCount) ? rawCount : objects.length;
        setNotice({
          tone: count ? "ok" : "info",
          text: count
            ? `Đã lấy ${count} đối tượng đang chọn trong AutoCAD.`
            : "AutoCAD hiện không có đối tượng nào trong Pickfirst selection.",
        });
      }
      return objects;
    } catch (error) {
      if (!silent) {
        setNotice({
          tone: "error",
          text: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      setSelectionBusy(false);
    }
  }

  async function importCurrentLayers() {
    if (!target) return;
    if (
      draft?.layers.length &&
      !window.confirm("Thay danh sách layer trong mẫu bằng các layer của bản vẽ hiện tại?")
    ) {
      return;
    }
    setLayerImportBusy(true);
    setNotice(null);
    try {
      const query = `?target=${encodeURIComponent(target)}`;
      const body = await daemonJson<JsonRecord>(await fetch(
        `${baseUrl}/api/acad/drawing-info${query}`,
        { cache: "no-store" },
      ));
      const drawing = asRecord(body.drawing);
      const tables = asRecord(body.tables);
      const rows = recordRows(tables?.layers ?? drawing?.layers ?? body.layers);
      const layers: LayerStandard[] = rows.map((row) => {
        const rawWeight = Number(row.lineweight);
        const normalizedWeight: string | number = Number.isFinite(rawWeight)
          ? rawWeight === -3
            ? "Default"
            : rawWeight === -2
              ? "ByBlock"
              : rawWeight === -1
                ? "ByLayer"
                : Math.abs(rawWeight) > 2.11
                  ? rawWeight / 100
                  : rawWeight
          : "Default";
        return {
          name: String(row.name || ""),
          color: Number.isFinite(Number(row.aci ?? row.color))
            ? Number(row.aci ?? row.color)
            : "7",
          linetype: String(row.linetype || "Continuous"),
          lineweight: normalizedWeight,
          required: true,
        };
      }).filter((layer) => layer.name);
      if (!layers.length) throw new Error("Hồ sơ bản vẽ không trả danh sách layer.");
      updateDraft((profile) => ({ ...profile, layers }));
      setNotice({
        tone: "ok",
        text: `Đã lấy ${layers.length} layer; hãy chỉnh lại rồi bấm “Lưu mẫu”.`,
      });
    } catch (error) {
      setNotice({
        tone: "error",
        text: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setLayerImportBusy(false);
    }
  }

  function directHandles(): string[] | undefined {
    return directScope === "selection"
      ? selection.map((object) => object.handle)
      : undefined;
  }

  function parsedBasePoint(): [number, number] | undefined {
    if (!directBase.trim()) return undefined;
    const values = directBase.split(",").map(Number);
    return values.length >= 2 && values.every(Number.isFinite)
      ? [values[0], values[1]]
      : undefined;
  }

  async function runDirect(action: "scale" | "rotate" | "color" | "layer" | "area") {
    if (action === "layer" && directScope === "drawing") {
      setNotice({
        tone: "warn",
        text: "Chuyển layer cần một selection đã được đọc từ AutoCAD; không áp dụng toàn bộ bản vẽ.",
      });
      return;
    }
    const handles = directHandles();
    if (directScope === "selection" && !handles?.length) {
      setNotice({ tone: "warn", text: "Hãy lấy selection hiện tại từ AutoCAD trước." });
      return;
    }
    let params: JsonRecord = {};
    const basePoint = parsedBasePoint();
    if (
      (action === "scale" || action === "rotate") &&
      directBase.trim() &&
      !basePoint
    ) {
      setNotice({ tone: "error", text: "Base point phải có dạng X,Y." });
      return;
    }
    if (action === "scale") {
      const factor = Number(directFactor);
      if (!Number.isFinite(factor) || factor <= 0) {
        setNotice({ tone: "error", text: "Hệ số scale phải lớn hơn 0." });
        return;
      }
      params = {
        factor,
        ...(basePoint ? { basePoint } : {}),
        ...(directScope === "drawing" ? { all: true } : {}),
      };
    } else if (action === "rotate") {
      const angle = Number(directAngle);
      if (!Number.isFinite(angle)) {
        setNotice({ tone: "error", text: "Góc xoay không hợp lệ." });
        return;
      }
      params = {
        angle,
        ...(basePoint ? { basePoint } : {}),
      };
    } else if (action === "color") {
      params = { color: directColor.trim() || "ByLayer" };
    } else if (action === "layer") {
      if (!directLayer.trim()) {
        setNotice({ tone: "error", text: "Hãy nhập layer đích." });
        return;
      }
      params = { layer: directLayer.trim() };
    }
    const subject = directScope === "selection"
      ? `${handles?.length || 0} đối tượng đang chọn`
      : "toàn bộ bản vẽ";
    if (action === "layer") {
      await prepareSelectionAction(
        {
          target,
          action: "move-to-layer",
          params: { layer: directLayer.trim() },
        },
        "move-to-layer",
        `${subject} → layer “${directLayer.trim()}”`,
        handles?.length,
      );
      return;
    }
    await runAction(
      action,
      params,
      handles,
      action === "area" ? undefined : `Chạy “${action}” cho ${subject}?`,
    );
  }

  const issueCount = scan?.issues.length || 0;
  const errorCount = scan?.issues.filter((issue) =>
    issue.severity === "error" || issue.severity === "critical").length || 0;
  const warningCount = issueCount - errorCount;
  const selectedVisible = visibleIssues.filter((issue) =>
    selectedIssues.has(issue.id)).length;

  return (
    <div className="standards-backdrop" onMouseDown={(event) => {
      if (event.target !== event.currentTarget) return;
      if (pendingSelectionAction) {
        void rejectPendingSelectionAction();
      } else {
        requestClose();
      }
    }}>
      <section className="standards-panel" role="dialog" aria-modal="true"
        aria-labelledby="standards-title">
        <header className="standards-head">
          <div className="standards-identity">
            <div className="standards-mark" aria-hidden="true">✓</div>
            <div>
              <div className="standards-kicker">Kiểm tra · cấu hình · điều chỉnh</div>
              <h2 id="standards-title">Chuẩn hóa bản vẽ</h2>
              <p>
                {documents.find((doc) => targetOf(doc) === target)?.title ||
                  target || "Chưa chọn bản vẽ"}
              </p>
            </div>
          </div>
          <div className="standards-head-actions">
            <button type="button" onClick={() => {
              if (hasUnsavedChanges && !window.confirm("Nạp lại và bỏ các thay đổi chưa lưu?")) return;
              setLoading(true);
              void Promise.all([loadDocuments(), loadProfiles(profileId)])
                .finally(() => setLoading(false));
            }} disabled={loading} title="Nạp lại dữ liệu">
              <span className={loading ? "standards-spin" : ""}>↻</span>
            </button>
            <button type="button" className="close" onClick={() => {
              if (pendingSelectionAction) {
                void rejectPendingSelectionAction();
              } else {
                requestClose();
              }
            }}
              title="Đóng" aria-label="Đóng">×</button>
          </div>
        </header>

        <div className="standards-toolbar">
          <Field label="Bản vẽ đích">
            <select value={activeDocumentTarget || target}
              onChange={(event) => void prepareTargetActivation(event.target.value)}
              disabled={!documents.length || !!actionBusy || !!pendingSelectionAction}>
              {!documents.length && (
                <option value={target}>
                  {docsAlive === false ? "Plugin chưa phản hồi" : "Chưa có bản vẽ"}
                </option>
              )}
              {documents.map((document, index) => {
                const value = targetOf(document);
                return (
                  <option key={value || index} value={value}>
                    {document.active ? "● " : ""}
                    {document.title || document.file || `Bản vẽ ${index + 1}`}
                  </option>
                );
              })}
            </select>
          </Field>
          <Field label="Mẫu quy chuẩn">
            <select value={profileId} onChange={(event) => changeProfile(event.target.value)}
              disabled={!profiles.length || profileBusy}>
              {!profiles.length && <option value="">Chưa có mẫu</option>}
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.id === activeProfileId ? "★ " : ""}{profile.name}
                </option>
              ))}
            </select>
          </Field>
          <div className="standards-toolbar-buttons">
            {docsAlive === false && onOpenAutoCAD && (
              <button type="button" onClick={onOpenAutoCAD}>Mở AutoCAD</button>
            )}
            <button type="button" onClick={duplicateProfile} disabled={profileBusy || hasUnsavedChanges}>
              ＋ {draft ? "Nhân bản" : "Tạo mẫu"}
            </button>
            <button type="button" onClick={saveProfile}
              disabled={!draft?.id || !dirty || profileBusy || pendingBounds.size > 0}
              className={hasUnsavedChanges ? "changed" : ""}>
              {profileBusy ? "Đang lưu…" : "Lưu mẫu"}
            </button>
            <button type="button" className="primary" onClick={runScan}
              disabled={!target || !profileId || hasUnsavedChanges || scanBusy}>
              {scanBusy ? "Đang quét…" : "Quét bản vẽ"}
            </button>
          </div>
          {hasUnsavedChanges && (
            <div className="standards-dirty-hint">
              Lưu mẫu trước khi quét.
            </div>
          )}
        </div>

        {notice && (
          <div className={`standards-notice ${notice.tone}`}>
            <span>{notice.text}</span>
            <button type="button" onClick={() => setNotice(null)}
              aria-label="Đóng thông báo">×</button>
          </div>
        )}
        {scanStale && scan && (
          <div className="standards-stale">
            Kết quả quét đã cũ vì bản vẽ vừa thay đổi.
            <button type="button" onClick={runScan} disabled={scanBusy || hasUnsavedChanges}>
              Quét lại
            </button>
          </div>
        )}

        <div className="standards-workspace">
          <nav className="standards-nav" aria-label="Nhóm chuẩn hóa">
            {TABS.map((item) => {
              const count = scan?.issues.filter((issue) =>
                scopeMatches(item.id, issue.scope)).length || 0;
              return (
                <button key={item.id} type="button"
                  className={tab === item.id ? "active" : ""}
                  onClick={() => setTab(item.id)}>
                  <span>{item.icon}</span>
                  <b>{item.label}</b>
                  {!!count && <em>{count}</em>}
                </button>
              );
            })}
            <div className="standards-nav-status">
              <span className={docsAlive ? "online" : ""} />
              {docsAlive === null ? "Đang kiểm tra…" :
                docsAlive ? "AutoCAD sẵn sàng" : "Plugin chưa phản hồi"}
            </div>
          </nav>

          <main className="standards-content">
            {loading && !draft && (
              <div className="standards-loading">
                <span className="standards-loader" />
                <strong>Đang tải mẫu và bản vẽ…</strong>
              </div>
            )}

            {!loading && !draft && (
              <EmptyState title="Chưa có mẫu quy chuẩn"
                text="Tạo mẫu đầu tiên, cấu hình layer/dimension rồi quét bản vẽ.">
                <button type="button" className="primary" onClick={duplicateProfile}>
                  Tạo mẫu
                </button>
              </EmptyState>
            )}

            {draft && tab === "overview" && (
              <>
                <div className="standards-metrics">
                  <Metric label="Tổng sai khác" value={issueCount} tone="blue" />
                  <Metric label="Lỗi" value={errorCount} tone="red" />
                  <Metric label="Cảnh báo" value={warningCount} tone="amber" />
                  <Metric label="Đang chọn" value={selectedIssueIds.length} tone="violet" />
                  <Metric label="Đối tượng mapping" value={scan?.objects.length || 0} tone="cyan" />
                  <Metric label="Layer trong mẫu" value={draft.layers.length} tone="green" />
                </div>

                <Section title="Thông tin mẫu"
                  description="Tên hiển thị của bộ quy chuẩn đang chỉnh.">
                  <div className="standards-form-grid">
                    <Field label="Tên mẫu" className="wide">
                      <input value={draft.name} onChange={(event) =>
                        updateDraft((profile) => ({ ...profile, name: event.target.value }))} />
                    </Field>
                    <Field label="Mã mẫu">
                      <input value={draft.id} readOnly />
                    </Field>
                    <Field label="Lần quét gần nhất">
                      <input value={shownDate(scan?.scannedAt)} readOnly />
                    </Field>
                  </div>
                </Section>

                <Section title="Kết quả kiểm tra"
                  description={scan
                    ? `${scan.issues.length} sai khác trên “${scan.target}”.`
                    : "Quét bản vẽ để đối chiếu với mẫu hiện tại."}
                  actions={scan && (
                    <>
                      <button type="button" onClick={toggleVisibleIssues}
                        disabled={!visibleIssues.length || applyBusy}>
                        {selectedVisible === visibleIssues.length && visibleIssues.length
                          ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                      </button>
                    </>
                  )}>
                  {scan ? (
                    <IssueTable issues={visibleIssues} selected={selectedIssues}
                      disabled={applyBusy || !!actionBusy}
                      onToggle={toggleIssue} onSelectObject={selectIssueObjects} />
                  ) : (
                    <EmptyState title="Chưa có kết quả quét"
                      text="Chọn bản vẽ, lưu mẫu nếu có thay đổi, rồi bấm “Quét bản vẽ”." />
                  )}
                </Section>

                {scan?.current != null && (
                  <Section title="Cấu hình hiện tại được đọc từ bản vẽ">
                    <pre className="standards-json">{JSON.stringify(scan.current, null, 2)}</pre>
                  </Section>
                )}
              </>
            )}

            {draft && tab === "frame" && (
              <>
                <Section title="Khung giấy và tỷ lệ"
                  description="Kích thước theo đơn vị giấy; modelScale là hệ số mô hình chuẩn.">
                  <div className="standards-form-grid">
                    <Field label="Khổ giấy">
                      <input value={draft.drawing.paper.name}
                        onChange={(event) => updatePaper("name", event.target.value)} />
                    </Field>
                    <Field label="Rộng giấy">
                      <input type="number" step="0.01" value={draft.drawing.paper.width}
                        onChange={(event) => updatePaper("width", Number(event.target.value))} />
                    </Field>
                    <Field label="Cao giấy">
                      <input type="number" step="0.01" value={draft.drawing.paper.height}
                        onChange={(event) => updatePaper("height", Number(event.target.value))} />
                    </Field>
                    <Field label="Tỷ lệ model">
                      <input type="number" step="0.001" value={draft.drawing.modelScale}
                        onChange={(event) => updateDrawing("modelScale", Number(event.target.value))} />
                    </Field>
                    <Field label="Dung sai khung (%)">
                      <input type="number" step="0.1"
                        value={draft.drawing.frameTolerancePercent}
                        onChange={(event) =>
                          updateDrawing("frameTolerancePercent", Number(event.target.value))} />
                    </Field>
                  </div>
                  <div className="standards-inline-actions">
                    <button type="button" className="primary"
                      disabled={!!actionBusy || hasUnsavedChanges}
                      onClick={() => runAction(
                        "resize-frame",
                        {
                          paper: draft.drawing.paper,
                          frameTolerancePercent: draft.drawing.frameTolerancePercent,
                          modelScale: draft.drawing.modelScale,
                        },
                        undefined,
                        `Chỉnh khung bản vẽ theo ${draft.drawing.paper.name}?`,
                      )}>
                      {actionBusy === "resize-frame" ? "Đang chỉnh…" : "Chỉnh khung theo mẫu"}
                    </button>
                  </div>
                </Section>
                <Section title="Sai khác khung và tỷ lệ">
                  {scan ? (
                    <IssueTable issues={visibleIssues} selected={selectedIssues}
                      disabled={applyBusy || !!actionBusy}
                      onToggle={toggleIssue} onSelectObject={selectIssueObjects} />
                  ) : <div className="standards-no-rows">Chưa quét bản vẽ.</div>}
                </Section>
              </>
            )}

            {draft && tab === "units" && (
              <>
                <Section title="Đơn vị bản vẽ"
                  description="Mapping đơn vị hiển thị trên app sang header variables của DWG.">
                  <div className="standards-form-grid">
                    <Field label="Đơn vị">
                      <select value={draft.drawing.unit}
                        onChange={(event) => updateDrawing("unit", event.target.value)}>
                        <option value="mm">Millimeter (mm)</option>
                        <option value="cm">Centimeter (cm)</option>
                        <option value="m">Meter (m)</option>
                        <option value="inch">Inch</option>
                        <option value="feet">Feet</option>
                      </select>
                    </Field>
                    <Field label="INSUNITS">
                      <input type="number" value={draft.drawing.insunits}
                        onChange={(event) => updateDrawing("insunits", Number(event.target.value))} />
                    </Field>
                    <Field label="Linear format">
                      <input value={draft.drawing.linearFormat}
                        onChange={(event) => updateDrawing("linearFormat", event.target.value)} />
                    </Field>
                    <Field label="Precision">
                      <input type="number" min="0" max="8" value={draft.drawing.precision}
                        onChange={(event) => updateDrawing("precision", Number(event.target.value))} />
                    </Field>
                  </div>
                  <div className="standards-inline-actions">
                    <button type="button" className="primary"
                      disabled={!!actionBusy || hasUnsavedChanges}
                      onClick={() => runAction(
                        "apply-units",
                        { ...draft.drawing },
                        undefined,
                        `Áp dụng đơn vị ${draft.drawing.unit} cho bản vẽ?`,
                      )}>
                      {actionBusy === "apply-units" ? "Đang áp dụng…" : "Áp dụng đơn vị"}
                    </button>
                  </div>
                </Section>
                <Section title="Sai khác đơn vị">
                  {scan ? (
                    <IssueTable issues={visibleIssues} selected={selectedIssues}
                      disabled={applyBusy || !!actionBusy}
                      onToggle={toggleIssue} onSelectObject={selectIssueObjects} />
                  ) : <div className="standards-no-rows">Chưa quét bản vẽ.</div>}
                </Section>
              </>
            )}

            {draft && tab === "objects" && (
              <>
                <Section title="Thao tác trực tiếp trên đối tượng"
                  description="Lấy Pickfirst selection từ AutoCAD hoặc áp dụng cho toàn bản vẽ.">
                  <div className="standards-selection-head">
                    <Field label="Phạm vi">
                      <select value={directScope} onChange={(event) =>
                        setDirectScope(event.target.value as "selection" | "drawing")}>
                        <option value="selection">Selection hiện tại</option>
                        <option value="drawing">Toàn bộ bản vẽ</option>
                      </select>
                    </Field>
                    <button type="button" onClick={() => void importCurrentSelection()}
                      disabled={selectionBusy || !target}>
                      {selectionBusy ? "Đang đọc…" : "↻ Lấy selection AutoCAD"}
                    </button>
                    <span>{selection.length} đối tượng</span>
                  </div>
                  {!!selection.length && (
                    <div className="standards-selection-list">
                      {selection.slice(0, 18).map((object) => (
                        <span key={object.handle} title={`${object.type} · ${object.layer}`}>
                          {object.handle}
                        </span>
                      ))}
                      {selection.length > 18 && <em>+{selection.length - 18}</em>}
                    </div>
                  )}
                  <div className="standards-tools-grid">
                    <div>
                      <h4>Scale</h4>
                      <Field label="Hệ số">
                        <input type="number" min="0.000001" step="0.01"
                          value={directFactor}
                          onChange={(event) => setDirectFactor(event.target.value)} />
                      </Field>
                      <Field label="Base X,Y" hint="Để trống nếu backend dùng base mặc định.">
                        <input value={directBase} placeholder="0,0"
                          onChange={(event) => setDirectBase(event.target.value)} />
                      </Field>
                      <button type="button" onClick={() => runDirect("scale")}
                        disabled={!!actionBusy}>Scale</button>
                    </div>
                    <div>
                      <h4>Xoay</h4>
                      <Field label="Góc (độ)">
                        <input type="number" step="0.1" value={directAngle}
                          onChange={(event) => setDirectAngle(event.target.value)} />
                      </Field>
                      <Field label="Base X,Y">
                        <input value={directBase} placeholder="0,0"
                          onChange={(event) => setDirectBase(event.target.value)} />
                      </Field>
                      <button type="button" onClick={() => runDirect("rotate")}
                        disabled={!!actionBusy}>Xoay</button>
                    </div>
                    <div>
                      <h4>Màu</h4>
                      <Field label="ACI / ByLayer / RGB">
                        <input value={directColor}
                          onChange={(event) => setDirectColor(event.target.value)} />
                      </Field>
                      <button type="button" onClick={() => runDirect("color")}
                        disabled={!!actionBusy}>Đổi màu</button>
                    </div>
                    <div>
                      <h4>Layer</h4>
                      <Field label="Layer đích">
                        <input value={directLayer} list="standards-layer-names"
                          onChange={(event) => setDirectLayer(event.target.value)} />
                      </Field>
                      <datalist id="standards-layer-names">
                        {draft.layers.map((layer) => (
                          <option key={layer.name} value={layer.name} />
                        ))}
                      </datalist>
                      <button type="button" onClick={() => runDirect("layer")}
                        disabled={!!actionBusy}>Chuyển layer</button>
                    </div>
                    <div>
                      <h4>Diện tích</h4>
                      <p>Tính diện tích LWPOLYLINE kín và CIRCLE trong phạm vi đã chọn.</p>
                      <button type="button" onClick={() => runDirect("area")}
                        disabled={!!actionBusy}>Tính diện tích</button>
                    </div>
                  </div>
                  {actionResult != null && (
                    <pre className="standards-action-result">
                      {JSON.stringify(actionResult, null, 2)}
                    </pre>
                  )}
                </Section>

                <Section title="Mapping nhận diện đối tượng"
                  description="Ví dụ: Phòng khách, khung vẽ, mặt phẳng cắt."
                  actions={<button type="button" onClick={addMapping}>＋ Thêm mapping</button>}>
                  {!draft.mappings.length && (
                    <div className="standards-no-rows">Chưa có mapping.</div>
                  )}
                  <div className="standards-mapping-list">
                    {draft.mappings.map((mapping, index) => (
                      <details key={mapping.id} className="standards-mapping" open={index === 0}>
                        <summary>
                          <span>{mapping.label || "Mapping chưa đặt tên"}</span>
                          <em>{mapping.kind}</em>
                        </summary>
                        <div className="standards-mapping-body">
                          <div className="standards-form-grid">
                            <Field label="Mã mapping">
                              <input value={mapping.id} onChange={(event) =>
                                updateMapping(index, { id: event.target.value })} />
                            </Field>
                            <Field label="Tên hiển thị">
                              <input value={mapping.label} onChange={(event) =>
                                updateMapping(index, { label: event.target.value })} />
                            </Field>
                            <Field label="Loại">
                              <input value={mapping.kind} onChange={(event) =>
                                updateMapping(index, { kind: event.target.value })} />
                            </Field>
                            <Field label="Bắt buộc">
                              <span className="standards-check">
                                <input type="checkbox" checked={mapping.required}
                                  onChange={(event) =>
                                    updateMapping(index, { required: event.target.checked })} />
                                Phải có trong bản vẽ
                              </span>
                            </Field>
                            <ListEditor ownerId={mapping.id} label="Layer patterns"
                              values={mapping.layerPatterns}
                              onChange={(layerPatterns) =>
                                updateMapping(index, { layerPatterns })} />
                            <ListEditor ownerId={mapping.id} label="Block patterns"
                              values={mapping.blockPatterns}
                              onChange={(blockPatterns) =>
                                updateMapping(index, { blockPatterns })} />
                            <ListEditor ownerId={mapping.id} label="Text patterns"
                              values={mapping.textPatterns}
                              onChange={(textPatterns) =>
                                updateMapping(index, { textPatterns })} />
                            <ListEditor ownerId={mapping.id} label="Entity types"
                              values={mapping.entityTypes}
                              placeholder="LWPOLYLINE, INSERT, TEXT"
                              onChange={(entityTypes) =>
                                updateMapping(index, { entityTypes })} />
                            <BoundsEditor mapping={mapping}
                              onPendingChange={(pending) =>
                                updatePendingBounds(mapping.id, pending)}
                              onChange={(bounds) => updateMapping(index, { bounds })}
                              onError={(text) => setNotice({ tone: "error", text })} />
                          </div>
                          <button type="button" className="danger"
                            onClick={() => removeMapping(index)}>Xóa mapping</button>
                        </div>
                      </details>
                    ))}
                  </div>
                </Section>

                <Section title="Đối tượng đã nhận diện">
                  {!scan?.objects.length ? (
                    <div className="standards-no-rows">Chưa có đối tượng mapping từ lần quét.</div>
                  ) : (
                    <div className="standards-table-wrap">
                      <table className="standards-table">
                        <thead><tr>
                          <th>Tên</th><th>Loại</th><th>Handle</th><th>Layer</th>
                          <th>Rộng</th><th>Cao</th><th>Diện tích</th>
                        </tr></thead>
                        <tbody>{scan.objects.map((object, index) => (
                          <tr key={`${object.handle}-${index}`}>
                            <td>{object.label || object.mappingId}</td>
                            <td>{object.kind || object.type}</td>
                            <td>{object.handle ? (
                              <button type="button" className="standards-link-button"
                                disabled={!!actionBusy}
                                onClick={() => void prepareHandleSelection(
                                  [object.handle],
                                  `Đối tượng “${object.label || object.mappingId || object.handle}”`,
                                )}>
                                {object.handle}
                              </button>
                            ) : "—"}</td>
                            <td>{object.layer || "—"}</td>
                            <td>{shownValue(object.width)}</td>
                            <td>{shownValue(object.height)}</td>
                            <td>
                              {shownValue(object.area)}
                              {object.area != null && object.areaUnit ? ` ${object.areaUnit}` : ""}
                            </td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                </Section>

                <Section title="Sai khác đối tượng và mapping"
                  actions={scan && (
                    <button type="button" onClick={toggleVisibleIssues}>
                      {selectedVisible === visibleIssues.length && visibleIssues.length
                        ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                    </button>
                  )}>
                  {scan ? (
                    <IssueTable issues={visibleIssues} selected={selectedIssues}
                      disabled={applyBusy || !!actionBusy}
                      onToggle={toggleIssue} onSelectObject={selectIssueObjects} />
                  ) : <div className="standards-no-rows">Chưa quét bản vẽ.</div>}
                </Section>
              </>
            )}

            {draft && tab === "dimension" && (
              <>
                <Section title="Cấu hình Dimension Style"
                  description="Các giá trị kỳ vọng dùng để quét và đồng bộ dim.">
                  <div className="standards-form-grid">
                    <Field label="Style name">
                      <input value={draft.dimension.styleName}
                        onChange={(event) => updateDimension("styleName", event.target.value)} />
                    </Field>
                    <Field label="Precision">
                      <input type="number" min="0" max="8" value={draft.dimension.precision}
                        onChange={(event) =>
                          updateDimension("precision", Number(event.target.value))} />
                    </Field>
                    <Field label="Measurement scale">
                      <input type="number" step="0.001"
                        value={draft.dimension.measurementScale}
                        onChange={(event) =>
                          updateDimension("measurementScale", Number(event.target.value))} />
                    </Field>
                    <Field label="Overall scale">
                      <input type="number" step="0.001" value={draft.dimension.overallScale}
                        onChange={(event) =>
                          updateDimension("overallScale", Number(event.target.value))} />
                    </Field>
                    <Field label="Fit">
                      <input value={draft.dimension.fit}
                        onChange={(event) => updateDimension("fit", event.target.value)} />
                    </Field>
                    <Field label="Text vertical">
                      <input value={draft.dimension.textVertical}
                        onChange={(event) =>
                          updateDimension("textVertical", event.target.value)} />
                    </Field>
                    <Field label="Text horizontal">
                      <input value={draft.dimension.textHorizontal}
                        onChange={(event) =>
                          updateDimension("textHorizontal", event.target.value)} />
                    </Field>
                    <Field label="Annotative">
                      <span className="standards-check">
                        <input type="checkbox" checked={draft.dimension.annotative}
                          onChange={(event) =>
                            updateDimension("annotative", event.target.checked)} />
                        Bật annotative
                      </span>
                    </Field>
                    <Field label="Text height">
                      <input type="number" step="0.01" value={draft.dimension.textHeight}
                        onChange={(event) =>
                          updateDimension("textHeight", Number(event.target.value))} />
                    </Field>
                    <Field label="Font">
                      <input value={draft.dimension.font}
                        onChange={(event) => updateDimension("font", event.target.value)} />
                    </Field>
                    <Field label="Text style">
                      <input value={draft.dimension.textStyle}
                        onChange={(event) => updateDimension("textStyle", event.target.value)} />
                    </Field>
                    <Field label="Paper text height">
                      <input type="number" step="0.01"
                        value={draft.dimension.paperTextHeight}
                        onChange={(event) =>
                          updateDimension("paperTextHeight", Number(event.target.value))} />
                    </Field>
                    <Field label="Width factor">
                      <input type="number" step="0.01" value={draft.dimension.widthFactor}
                        onChange={(event) =>
                          updateDimension("widthFactor", Number(event.target.value))} />
                    </Field>
                    <Field label="Text color">
                      <input value={String(draft.dimension.textColor)}
                        onChange={(event) => updateDimension("textColor", event.target.value)} />
                    </Field>
                    <Field label="Alignment">
                      <input value={draft.dimension.alignment}
                        onChange={(event) =>
                          updateDimension("alignment", event.target.value)} />
                    </Field>
                    <Field label="Arrowhead">
                      <input value={draft.dimension.arrowhead}
                        onChange={(event) =>
                          updateDimension("arrowhead", event.target.value)} />
                    </Field>
                    <Field label="Dimension line color">
                      <input value={String(draft.dimension.dimensionLineColor)}
                        onChange={(event) =>
                          updateDimension("dimensionLineColor", event.target.value)} />
                    </Field>
                    <Field label="Extension line color">
                      <input value={String(draft.dimension.extensionLineColor)}
                        onChange={(event) =>
                          updateDimension("extensionLineColor", event.target.value)} />
                    </Field>
                    <Field label="Extend beyond dim lines">
                      <input type="number" step="0.01"
                        value={draft.dimension.extendBeyondDimLines}
                        onChange={(event) => updateDimension(
                          "extendBeyondDimLines", Number(event.target.value))} />
                    </Field>
                    <Field label="Offset from origin">
                      <input type="number" step="0.01"
                        value={draft.dimension.offsetFromOrigin}
                        onChange={(event) =>
                          updateDimension("offsetFromOrigin", Number(event.target.value))} />
                    </Field>
                    <Field label="Khoảng đường dim đến text">
                      <input type="number" step="0.01" value={draft.dimension.textGap}
                        onChange={(event) =>
                          updateDimension("textGap", Number(event.target.value))} />
                    </Field>
                    <Field label="Khoảng cách hàng dim">
                      <input type="number" step="0.01" value={draft.dimension.rowSpacing}
                        onChange={(event) =>
                          updateDimension("rowSpacing", Number(event.target.value))} />
                    </Field>
                    <Field label="Dung sai lệch hàng">
                      <input type="number" step="0.01" value={draft.dimension.rowTolerance}
                        onChange={(event) =>
                          updateDimension("rowTolerance", Number(event.target.value))} />
                    </Field>
                  </div>
                  <div className="standards-inline-actions">
                    <button type="button" className="primary"
                      disabled={!!actionBusy || hasUnsavedChanges}
                      onClick={() => runAction(
                        "apply-dimstyle",
                        { ...draft.dimension },
                        undefined,
                        `Đồng bộ Dimension Style “${draft.dimension.styleName}”?`,
                      )}>
                      {actionBusy === "apply-dimstyle" ? "Đang đồng bộ…" : "Đồng bộ Dim Style"}
                    </button>
                  </div>
                </Section>

                <Section title="Căn đều các hàng dim"
                  description="Chọn một dim làm chuẩn; các dim lỗi đang tick sẽ được DIMSPACE.">
                  <div className="standards-dimspace">
                    <Field label="Dimension làm chuẩn">
                      <select value={dimBaseHandle}
                        onChange={(event) => setDimBaseHandle(event.target.value)}>
                        <option value="">— Chọn dim chuẩn —</option>
                        {dimensionRows.map((row, index) => {
                          const handle = dimensionHandle(row);
                          return handle ? (
                            <option key={`${handle}-${index}`} value={handle}>
                              {dimensionLabel(row)}
                            </option>
                          ) : null;
                        })}
                      </select>
                    </Field>
                    <span>{selectedDimensionHandles.length} dim cần căn</span>
                    <button type="button" className="primary"
                      disabled={!dimBaseHandle || !selectedDimensionHandles.length || !!actionBusy}
                      onClick={() => runAction(
                        "dimspace",
                        {
                          baseHandle: dimBaseHandle,
                          rowSpacing: draft.dimension.rowSpacing,
                        },
                        selectedDimensionHandles,
                        `Căn đều ${selectedDimensionHandles.length} dim theo handle ${dimBaseHandle}?`,
                      )}>
                      {actionBusy === "dimspace" ? "Đang căn…" : "Căn đều DIMSPACE"}
                    </button>
                  </div>
                </Section>

                <Section title="Dimension có thể sai lệch"
                  actions={scan && (
                    <button type="button" onClick={toggleVisibleIssues}>
                      {selectedVisible === visibleIssues.length && visibleIssues.length
                        ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                    </button>
                  )}>
                  {scan ? (
                    <IssueTable issues={visibleIssues} selected={selectedIssues}
                      disabled={applyBusy || !!actionBusy}
                      onToggle={toggleIssue} onSelectObject={selectIssueObjects} />
                  ) : <div className="standards-no-rows">Chưa quét bản vẽ.</div>}
                </Section>
              </>
            )}

            {draft && tab === "layers" && (
              <>
                <Section title="Mẫu layer bắt buộc"
                  description="Danh sách này được dùng để quét tên, màu, kiểu nét và lineweight."
                  actions={(
                    <div className="standards-inline-actions">
                      <button type="button" onClick={importCurrentLayers}
                        disabled={layerImportBusy || !target}>
                        {layerImportBusy ? "Đang lấy…" : "↥ Lấy layer hiện tại"}
                      </button>
                      <button type="button" onClick={addLayer}>＋ Thêm layer</button>
                    </div>
                  )}>
                  {!draft.layers.length ? (
                    <div className="standards-no-rows">Mẫu chưa có layer nào.</div>
                  ) : (
                    <div className="standards-table-wrap">
                      <table className="standards-table standards-layer-table">
                        <thead><tr>
                          <th>Tên riêng</th><th>Màu</th><th>Kiểu nét</th>
                          <th>Lineweight</th><th>Bắt buộc</th><th />
                        </tr></thead>
                        <tbody>{draft.layers.map((layer, index) => (
                          <tr key={`${index}-${layer.name}`}>
                            <td><input value={layer.name} onChange={(event) =>
                              updateLayer(index, { name: event.target.value })} /></td>
                            <td><input value={String(layer.color)} onChange={(event) =>
                              updateLayer(index, { color: event.target.value })} /></td>
                            <td><input value={layer.linetype} onChange={(event) =>
                              updateLayer(index, { linetype: event.target.value })} /></td>
                            <td><input value={String(layer.lineweight)}
                              onChange={(event) =>
                                updateLayer(index, { lineweight: event.target.value })} /></td>
                            <td className="center"><input type="checkbox"
                              checked={layer.required} onChange={(event) =>
                                updateLayer(index, { required: event.target.checked })} /></td>
                            <td><button type="button" className="icon danger"
                              onClick={() => removeLayer(index)}
                              aria-label={`Xóa layer ${layer.name}`}>×</button></td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  )}
                  <div className="standards-inline-actions">
                    <button type="button" className="primary"
                      disabled={!!actionBusy || hasUnsavedChanges || !draft.layers.length}
                      onClick={() => runAction(
                        "sync-layers",
                        { layers: draft.layers },
                        undefined,
                        `Đồng bộ ${draft.layers.length} layer theo mẫu?`,
                      )}>
                      {actionBusy === "sync-layers" ? "Đang đồng bộ…" : "Đồng bộ layer"}
                    </button>
                  </div>
                </Section>
                <Section title="Sai khác layer"
                  actions={scan && (
                    <button type="button" onClick={toggleVisibleIssues}>
                      {selectedVisible === visibleIssues.length && visibleIssues.length
                        ? "Bỏ chọn tất cả" : "Chọn tất cả"}
                    </button>
                  )}>
                  {scan ? (
                    <IssueTable issues={visibleIssues} selected={selectedIssues}
                      disabled={applyBusy || !!actionBusy}
                      onToggle={toggleIssue} onSelectObject={selectIssueObjects} />
                  ) : <div className="standards-no-rows">Chưa quét bản vẽ.</div>}
                </Section>
              </>
            )}
          </main>
        </div>

        <footer className="standards-footer">
          <div>
            <strong>{selectedIssueIds.length}</strong> mục được chọn
            {dimBaseHandle && <span> · Dim chuẩn <code>{dimBaseHandle}</code></span>}
          </div>
          <div>
            <button type="button" onClick={() => setSelectedIssueIds([])}
              disabled={!selectedIssueIds.length || applyBusy}>Bỏ chọn</button>
            <button type="button" className="primary"
              disabled={!scan?.scanId || !selectedIssueIds.length || scanStale || applyBusy}
              onClick={() => setConfirmApplyOpen(true)}>
              Áp dụng {selectedIssueIds.length || ""} điều chỉnh
            </button>
          </div>
        </footer>
      </section>

      {pendingSelectionAction && (
        <div className="standards-confirm-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) void rejectPendingSelectionAction();
        }}>
          <div className="standards-confirm" role="alertdialog" aria-modal="true"
            aria-labelledby="standards-selection-confirm-title">
            <div className="standards-confirm-icon">!</div>
            <h3 id="standards-selection-confirm-title">
              {pendingSelectionAction.action === "activate-document"
                ? "Chuyển bản vẽ trong AutoCAD?"
                : pendingSelectionAction.action === "select"
                  ? "Chọn đối tượng trong AutoCAD?"
                  : "Chuyển layer cho selection?"}
            </h3>
            <p>
              Bản vẽ: <strong>
                {documents.find((doc) => targetOf(doc) === pendingSelectionAction.target)?.title ||
                  pendingSelectionAction.target}
              </strong>.
            </p>
            <p>Phạm vi: <strong>{pendingSelectionAction.scopeLabel}</strong>.</p>
            {pendingSelectionAction.count !== undefined && (
              <p>Số đối tượng: <strong>{pendingSelectionAction.count}</strong>.</p>
            )}
            {notice?.tone === "error" && <p>{notice.text}</p>}
            <div className="standards-confirm-actions">
              <button type="button" onClick={() => void rejectPendingSelectionAction()}
                disabled={!!actionBusy} autoFocus>
                {actionBusy === "selection-reject" ? "Đang hủy…" : "Hủy"}
              </button>
              <button type="button" className="primary"
                onClick={() => void applyPendingSelectionAction()} disabled={!!actionBusy}>
                {actionBusy === "selection-apply" ? "Đang áp dụng…" : "Xác nhận áp dụng"}
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmApplyOpen && (
        <div className="standards-confirm-backdrop" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setConfirmApplyOpen(false);
        }}>
          <div className="standards-confirm" role="alertdialog" aria-modal="true"
            aria-labelledby="standards-confirm-title">
            <div className="standards-confirm-icon">!</div>
            <h3 id="standards-confirm-title">Áp dụng điều chỉnh vào bản vẽ?</h3>
            <p>
              Acad Studio sẽ áp dụng <strong>{selectedIssueIds.length}</strong> mục đã chọn
              vào <strong>{documents.find((doc) => targetOf(doc) === target)?.title || target}</strong>.
            </p>
            {dimBaseHandle && (
              <p>Dimension làm chuẩn: <code>{dimBaseHandle}</code>.</p>
            )}
            <div className="standards-confirm-actions">
              <button type="button" onClick={() => setConfirmApplyOpen(false)}
                disabled={applyBusy}>Hủy</button>
              <button type="button" className="primary" onClick={applySelectedIssues}
                disabled={applyBusy}>
                {applyBusy ? "Đang áp dụng…" : "Xác nhận áp dụng"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

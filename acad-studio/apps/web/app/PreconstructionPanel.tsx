"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
} from "react";

export type PreconstructionView =
  | "overview"
  | "takeoff"
  | "estimating"
  | "field"
  | "integrations"
  | "automation";

type TakeoffKind = "area" | "linear" | "arc" | "pitched" | "volume" | "count";
type FieldView = "issues" | "punch" | "daily";
type Notice = { tone: "info" | "ok" | "warn"; text: string };
type LocalAsset = { name: string; type: string; url?: string };

type TakeoffItem = {
  id: string;
  name: string;
  kind: TakeoffKind;
  quantity: number;
  unit: string;
  waste: number;
  materialRate: number;
  laborRate: number;
  assembly: string;
  source: string;
  confidence?: number;
};

type Issue = {
  id: string;
  title: string;
  location: string;
  owner: string;
  status: "Mở" | "Đang xử lý" | "Đã đóng";
  photos: LocalAsset[];
  tone: "high" | "medium" | "low";
};

type PunchItem = { id: string; title: string; location: string; owner: string; done: boolean };
type EstimateSettings = {
  factor: number;
  overhead: number;
  markup: number;
  tax: number;
  taxRegion: string;
  nonMeasured: number;
};
type Action = {
  title: string;
  description: string;
  steps: string[];
  connector?: string;
  connectorId?: string;
};

export function fileNameFromPath(value: string): string {
  return value.split(/[\\/]/).pop() || value;
}

export function uniqueDrawingNames(
  fileNames: readonly string[],
  existingNames: readonly string[],
): string[] {
  const used = new Set(existingNames);
  return fileNames.map((fileName) => {
    if (!used.has(fileName)) {
      used.add(fileName);
      return fileName;
    }

    const extensionIndex = fileName.lastIndexOf(".");
    const hasExtension = extensionIndex > 0;
    const stem = hasExtension ? fileName.slice(0, extensionIndex) : fileName;
    const extension = hasExtension ? fileName.slice(extensionIndex) : "";
    let sequence = 2;
    let candidate = `${stem} (${sequence})${extension}`;
    while (used.has(candidate)) {
      sequence += 1;
      candidate = `${stem} (${sequence})${extension}`;
    }
    used.add(candidate);
    return candidate;
  });
}

export type PreconstructionPanelProps = {
  open: boolean;
  initialView?: PreconstructionView;
  initialCadTarget?: string;
  onClose: () => void;
  onOpenReview: (view: "documents" | "markup" | "measure") => void;
  onOpenAutoCAD?: () => void;
};

const NAV_ITEMS: { id: PreconstructionView; label: string; icon: string; hint: string }[] = [
  { id: "overview", label: "Tổng quan", icon: "⌂", hint: "Project health" },
  { id: "takeoff", label: "Bóc khối lượng", icon: "⌁", hint: "Digital Takeoff" },
  { id: "estimating", label: "Lập dự toán", icon: "₫", hint: "Estimating" },
  { id: "field", label: "Hiện trường", icon: "⚑", hint: "Field Management" },
  { id: "integrations", label: "Tích hợp", icon: "↗", hint: "Connectors" },
  { id: "automation", label: "AI & Automation", icon: "✦", hint: "Human reviewed" },
];

const TAKEOFF_TOOLS: { id: "select" | TakeoffKind; label: string; icon: string; unit: string }[] = [
  { id: "select", label: "Chọn", icon: "⌖", unit: "" },
  { id: "area", label: "Diện tích", icon: "▱", unit: "m²" },
  { id: "linear", label: "Chiều dài", icon: "↔", unit: "m" },
  { id: "arc", label: "Cung", icon: "⌒", unit: "m" },
  { id: "pitched", label: "Mái dốc", icon: "⌃", unit: "m²" },
  { id: "volume", label: "Thể tích", icon: "▥", unit: "m³" },
  { id: "count", label: "Đếm", icon: "●", unit: "cái" },
];

const INITIAL_TAKEOFFS: TakeoffItem[] = [
  { id: "TO-101", name: "Vách thạch cao 2 mặt", kind: "area", quantity: 428.6, unit: "m²", waste: 8,
    materialRate: 286000, laborRate: 79000, assembly: "ASM-VACH-01", source: "A-101 · Tầng 01" },
  { id: "TO-102", name: "Ống cấp nước PPR DN25", kind: "linear", quantity: 184.2, unit: "m", waste: 5,
    materialRate: 176000, laborRate: 89000, assembly: "ASM-PPR-25", source: "P-201 · Cấp nước" },
  { id: "TO-103", name: "Gạch porcelain 600×600", kind: "area", quantity: 312.4, unit: "m²", waste: 10,
    materialRate: 412000, laborRate: 133000, assembly: "ASM-FLR-02", source: "A-103 · Hoàn thiện" },
  { id: "TO-104", name: "Cửa đi D1", kind: "count", quantity: 42, unit: "cái", waste: 2,
    materialRate: 2980000, laborRate: 470000, assembly: "ASM-DOOR-01", source: "AutoCount · A-101", confidence: 94 },
  { id: "TO-105", name: "Mái ngói dốc 30°", kind: "pitched", quantity: 215.8, unit: "m²", waste: 12,
    materialRate: 590000, laborRate: 190000, assembly: "ASM-ROOF-01", source: "A-501 · Mái" },
  { id: "TO-106", name: "Đào đất móng", kind: "volume", quantity: 126.5, unit: "m³", waste: 0,
    materialRate: 0, laborRate: 185000, assembly: "ASM-EARTH-01", source: "S-101 · Móng" },
  { id: "TO-107", name: "Len chân tường cong", kind: "arc", quantity: 36.8, unit: "m", waste: 7,
    materialRate: 98000, laborRate: 47000, assembly: "ASM-ARC-01", source: "A-104 · Chi tiết" },
];

const ASSEMBLIES = [
  ["ASM-VACH-01", "Vách thạch cao", "Khung + tấm + bông + nhân công"],
  ["ASM-FLR-02", "Lát gạch porcelain", "Gạch + keo + ron + nhân công"],
  ["ASM-PPR-25", "Ống PPR DN25", "Ống + phụ kiện + treo đỡ + lắp đặt"],
  ["ASM-DOOR-01", "Cửa đi hoàn chỉnh", "Khung + cánh + phụ kiện + lắp đặt"],
  ["ASM-ROOF-01", "Mái ngói dốc", "Ngói + mè + chống thấm + nhân công"],
  ["ASM-EARTH-01", "Đào đất móng", "Máy đào + nhân công hoàn thiện"],
  ["ASM-ARC-01", "Len chân tường", "Vật tư + cắt uốn + lắp đặt"],
];

const MATERIALS = [
  ["VL-001", "Tấm thạch cao 9 mm", "98.000 ₫/tấm"],
  ["VL-018", "Gạch porcelain 600×600", "412.000 ₫/m²"],
  ["VL-033", "Ống PPR DN25", "176.000 ₫/m"],
  ["VL-041", "Cửa đi D1", "2.980.000 ₫/bộ"],
];

const CONNECTORS = [
  { id: "procore", name: "Procore", mark: "P", purpose: "Dự án & tài liệu",
    detail: "Đồng bộ project, drawing set, issue và trạng thái RFI." },
  { id: "acumatica", name: "Acumatica", mark: "A", purpose: "Kế toán & tài chính",
    detail: "Ánh xạ cost code, budget, commitment và chi phí thực tế." },
  { id: "quickbooks", name: "QuickBooks", mark: "Q", purpose: "Hạch toán chi phí",
    detail: "Đẩy estimate, vendor và theo dõi job cost theo hạng mục." },
];

const AI_FEATURES: Action[] = [
  { title: "AutoCount", description: "Nhận diện ký hiệu lặp lại và đề xuất số lượng theo trang.",
    steps: ["Chọn mẫu ký hiệu", "Chọn phạm vi bản vẽ", "Kiểm tra độ tin cậy", "Duyệt vào takeoff"] },
  { title: "AI Trade Takeoff", description: "Tạo bản nháp takeoff theo kiến trúc, kết cấu hoặc MEP.",
    steps: ["Chọn chuyên ngành", "Chọn bộ bản vẽ", "Chạy phân tích", "Kỹ sư duyệt kết quả"] },
  { title: "Auto-naming", description: "Đề xuất tên hạng mục nhất quán từ legend và ngữ cảnh.",
    steps: ["Quét legend", "Ghép ký hiệu", "Xem trước tên", "Duyệt thay đổi"] },
  { title: "Smart suggestions", description: "Gợi ý Assembly phù hợp với phép đo và bộ môn.",
    steps: ["Đọc thuộc tính", "Đối chiếu thư viện", "Xếp hạng gợi ý", "Người lập giá duyệt"] },
];

const INITIAL_ESTIMATE_SETTINGS: Record<string, EstimateSettings> = {
  "Cơ sở": { factor: 1, overhead: 7.5, markup: 12, tax: 8, taxRegion: "Mặc định dự án", nonMeasured: 85000000 },
  "Tối ưu chi phí": { factor: .94, overhead: 6.5, markup: 10, tax: 8, taxRegion: "Mặc định dự án", nonMeasured: 72000000 },
  "Thi công nhanh": { factor: 1.08, overhead: 9, markup: 14, tax: 8, taxRegion: "Mặc định dự án", nonMeasured: 112000000 },
};

const KIND_META: Record<TakeoffKind, { label: string; unit: string; quantity: number }> = {
  area: { label: "Diện tích mới", unit: "m²", quantity: 24.8 },
  linear: { label: "Chiều dài mới", unit: "m", quantity: 18.6 },
  arc: { label: "Cung mới", unit: "m", quantity: 7.4 },
  pitched: { label: "Mái dốc mới", unit: "m²", quantity: 32.5 },
  volume: { label: "Thể tích mới", unit: "m³", quantity: 14.2 },
  count: { label: "Đếm ký hiệu mới", unit: "cái", quantity: 12 },
};

const SUGGESTED_ASSEMBLY: Record<TakeoffKind, string> = {
  area: "ASM-VACH-01",
  linear: "ASM-PPR-25",
  arc: "ASM-ARC-01",
  pitched: "ASM-ROOF-01",
  volume: "ASM-EARTH-01",
  count: "ASM-DOOR-01",
};

const money = new Intl.NumberFormat("vi-VN", {
  style: "currency",
  currency: "VND",
  maximumFractionDigits: 0,
});
const metric = new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 });

function boundedNumber(raw: string, max = Number.MAX_SAFE_INTEGER): number {
  const value = Number(raw);
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(0, value));
}

function PlanPreview() {
  return (
    <svg className="precon-plan" viewBox="0 0 820 510" aria-hidden="true">
      <rect x="28" y="26" width="764" height="456" rx="3" />
      <path d="M68 70H752V438H68ZM68 210H752M260 70V438M520 70V438M635 210V438" />
      <path d="M260 210h260v228H260zM92 95h140v88H92zM548 94h170v88H548z" />
      <path className="thin" d="M90 235h140v168H90M288 238h200v78H288M288 340h200v68H288" />
      <path className="door" d="M260 142a46 46 0 0 0 46 46M520 282a42 42 0 0 1-42 42M635 330a42 42 0 0 0 42 42" />
      <circle cx="160" cy="294" r="34" /><circle cx="693" cy="280" r="26" />
      <text x="130" y="135">P. 1.01</text><text x="345" y="285">SẢNH</text>
      <text x="590" y="135">P. 1.03</text><text x="653" y="420">A-101</text>
    </svg>
  );
}

function ViewHeading({
  eyebrow,
  title,
  copy,
  actions,
}: {
  eyebrow: string;
  title: string;
  copy: string;
  actions?: React.ReactNode;
}) {
  return (
    <div className="precon-view-head">
      <div><span>{eyebrow}</span><h3>{title}</h3><p>{copy}</p></div>
      {actions && <div className="precon-view-actions">{actions}</div>}
    </div>
  );
}

export default function PreconstructionPanel({
  open,
  initialView = "overview",
  initialCadTarget = "",
  onClose,
  onOpenReview,
  onOpenAutoCAD,
}: PreconstructionPanelProps) {
  const [view, setView] = useState<PreconstructionView>(initialView);
  const [takeoffs, setTakeoffs] = useState<TakeoffItem[]>(INITIAL_TAKEOFFS);
  const [activeTool, setActiveTool] = useState<"select" | TakeoffKind>("select");
  const [canvasZoom, setCanvasZoom] = useState(86);
  const [selectedTakeoffId, setSelectedTakeoffId] = useState("TO-104");
  const [drawings, setDrawings] = useState(["A-101 · Mặt bằng tầng 01.pdf", "P-201 · Cấp nước.pdf", "S-101 · Móng.dwg"]);
  const [activeDrawing, setActiveDrawing] = useState("A-101 · Mặt bằng tầng 01.pdf");
  const [variant, setVariant] = useState("Cơ sở");
  const [estimateSettings, setEstimateSettings] =
    useState<Record<string, EstimateSettings>>(INITIAL_ESTIMATE_SETTINGS);
  const [rateOverrides, setRateOverrides] = useState<Record<
    string,
    Record<string, { materialRate: number; laborRate: number }>
  >>({});
  const [fieldView, setFieldView] = useState<FieldView>("issues");
  const [issues, setIssues] = useState<Issue[]>([
    { id: "ISS-024", title: "Ống gió xung đột dầm D3", location: "Tầng 02 · C–D/4–5", owner: "Quốc Bảo", status: "Đang xử lý",
      photos: [{ name: "hien-truong-024-1.jpg", type: "image/jpeg" }, { name: "hien-truong-024-2.jpg", type: "image/jpeg" }, { name: "hien-truong-024-3.jpg", type: "image/jpeg" }], tone: "high" },
    { id: "ISS-019", title: "Thiếu sleeve xuyên tường", location: "Tầng 01 · B/7", owner: "Minh Anh", status: "Mở",
      photos: [{ name: "sleeve-019-1.jpg", type: "image/jpeg" }, { name: "sleeve-019-2.jpg", type: "image/jpeg" }], tone: "medium" },
    { id: "ISS-011", title: "Cập nhật cao độ trần sảnh", location: "Tầng 01 · Sảnh", owner: "Lan Chi", status: "Đã đóng",
      photos: [{ name: "tran-sanh-011.jpg", type: "image/jpeg" }], tone: "low" },
  ]);
  const [punch, setPunch] = useState<PunchItem[]>([
    { id: "PL-031", title: "Trám khe chân khung cửa D1", location: "Tầng 01 · P.1.03", owner: "Tổ hoàn thiện", done: false },
    { id: "PL-028", title: "Sơn dặm tường hành lang", location: "Tầng 02 · Trục 2–5", owner: "Nhà thầu Sơn Hà", done: true },
    { id: "PL-022", title: "Gắn nắp hộp điện", location: "Tầng 01 · P.1.06", owner: "Đội điện", done: false },
  ]);
  const [dailyNotes, setDailyNotes] = useState("Thi công vách khu A; nghiệm thu tuyến ống PPR tầng 01.");
  const [dailyDate, setDailyDate] = useState("2026-07-30");
  const [dailyLabor, setDailyLabor] = useState(48);
  const [dailyWeather, setDailyWeather] = useState("Nắng");
  const [dailyShift, setDailyShift] = useState("Ca ngày");
  const [dailySafetyHours, setDailySafetyHours] = useState(384);
  const [dailyPhotos, setDailyPhotos] = useState<LocalAsset[]>([]);
  const [reports, setReports] = useState(["30/07/2026 · 48 nhân công · Không có sự cố", "29/07/2026 · 42 nhân công · Mưa nhẹ"]);
  const [connectorDrafts, setConnectorDrafts] = useState<Record<string, boolean>>({});
  const [drawingAssets, setDrawingAssets] = useState<Record<string, LocalAsset>>({});
  const [selectedIssueId, setSelectedIssueId] = useState("ISS-024");
  const [suggestions, setSuggestions] = useState([
    { id: "AI-18", item: "Cửa đi D1 · A-101", suggestion: "ASM-DOOR-01", confidence: 94, approved: false },
    { id: "AI-17", item: "Vách WC · A-102", suggestion: "ASM-VACH-01", confidence: 89, approved: false },
    { id: "AI-12", item: "Ống PPR DN25 · P-201", suggestion: "ASM-PPR-25", confidence: 96, approved: true },
  ]);
  const [jobs, setJobs] = useState<string[]>([]);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const uploadRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const actionDialogRef = useRef<HTMLDivElement>(null);
  const takeoffSequenceRef = useRef(107);
  const actionOpenRef = useRef(false);
  const objectUrlsRef = useRef<string[]>([]);
  actionOpenRef.current = action !== null;

  useEffect(() => {
    if (!open) return;
    setView(initialView);
  }, [open, initialView]);

  useEffect(() => {
    if (!open) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (actionOpenRef.current) setAction(null);
        else onClose();
        return;
      }
      if (event.key !== "Tab" || actionOpenRef.current) return;
      const elements = Array.from(panelRef.current?.querySelectorAll<HTMLElement>(
        "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
      ) || []).filter((element) => element.offsetParent !== null);
      if (!elements.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("keydown", handleKey);
      previousFocus?.focus();
    };
  }, [open, onClose]);

  useEffect(() => {
    if (!action) return;
    const dialog = actionDialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])",
    ));
    focusable()[0]?.focus();
    const containFocus = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (!elements.length) return;
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", containFocus);
    return () => {
      document.removeEventListener("keydown", containFocus);
      previousFocus?.focus();
    };
  }, [action]);

  useEffect(() => () => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const settings = estimateSettings[variant];
  const estimateRows = useMemo(() => takeoffs.map((item) => {
    const override = rateOverrides[variant]?.[item.id];
    const materialRate = override?.materialRate ?? item.materialRate;
    const laborRate = override?.laborRate ?? item.laborRate;
    const effectiveQuantity = item.quantity * (1 + item.waste / 100);
    const amount = effectiveQuantity * (materialRate + laborRate) * settings.factor;
    return { ...item, materialRate, laborRate, effectiveQuantity, amount };
  }), [takeoffs, rateOverrides, settings.factor, variant]);
  const measuredCost = estimateRows.reduce((sum, row) => sum + row.amount, 0);
  const directCost = measuredCost + settings.nonMeasured;
  const overheadCost = directCost * settings.overhead / 100;
  const markupCost = (directCost + overheadCost) * settings.markup / 100;
  const beforeTax = directCost + overheadCost + markupCost;
  const taxCost = beforeTax * settings.tax / 100;
  const grandTotal = beforeTax + taxCost;
  const budget = 1250000000;
  const actual = 912000000;
  const selectedTakeoff = takeoffs.find((item) => item.id === selectedTakeoffId);
  const suggestedAssembly = selectedTakeoff
    ? selectedTakeoff.assembly || SUGGESTED_ASSEMBLY[selectedTakeoff.kind]
    : "";
  const openIssues = issues.filter((issue) => issue.status !== "Đã đóng").length;
  const unassignedAssemblyCount = takeoffs.filter((item) => !item.assembly).length;
  const activeDrawingAsset = drawingAssets[activeDrawing];
  const selectedIssue = issues.find((issue) => issue.id === selectedIssueId) || issues[0];

  if (!open) return null;

  function showNotice(text: string, tone: Notice["tone"] = "info") {
    setNotice({ text, tone });
  }

  function updateTakeoff(id: string, patch: Partial<TakeoffItem>) {
    setTakeoffs((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  }

  function updateEstimateSettings(patch: Partial<EstimateSettings>) {
    setEstimateSettings((current) => ({
      ...current,
      [variant]: { ...current[variant], ...patch },
    }));
  }

  function updateVariantRate(
    id: string,
    field: "materialRate" | "laborRate",
    value: number,
  ) {
    const row = takeoffs.find((item) => item.id === id);
    if (!row) return;
    setRateOverrides((current) => ({
      ...current,
      [variant]: {
        ...(current[variant] || {}),
        [id]: {
          materialRate: current[variant]?.[id]?.materialRate ?? row.materialRate,
          laborRate: current[variant]?.[id]?.laborRate ?? row.laborRate,
          [field]: value,
        },
      },
    }));
  }

  function retainFiles(files: File[], names: readonly string[] = files.map((file) => file.name)): LocalAsset[] {
    return files.map((file, index) => {
      const url = URL.createObjectURL(file);
      objectUrlsRef.current.push(url);
      return { name: names[index] || file.name, type: file.type, url };
    });
  }

  function addMeasurement() {
    if (activeTool === "select") {
      showNotice("Chọn một công cụ đo trước khi đặt lên bản vẽ.", "warn");
      return;
    }
    const meta = KIND_META[activeTool];
    takeoffSequenceRef.current += 1;
    const item: TakeoffItem = {
      id: `TO-${String(takeoffSequenceRef.current).padStart(3, "0")}`,
      name: meta.label,
      kind: activeTool,
      quantity: meta.quantity,
      unit: meta.unit,
      waste: activeTool === "count" ? 2 : 5,
      materialRate: 0,
      laborRate: 0,
      assembly: "",
      source: activeDrawing || drawings[0] || "Bản vẽ mới",
    };
    setTakeoffs((current) => [...current, item]);
    setSelectedTakeoffId(item.id);
    setActiveTool("select");
    showNotice(`${item.name} đã được thêm vào takeoff.`, "ok");
  }

  function handleDrawingUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const names = uniqueDrawingNames(files.map((file) => file.name), drawings);
    const assets = retainFiles(files, names);
    setDrawings((current) => [...names, ...current]);
    setDrawingAssets((current) => ({
      ...current,
      ...Object.fromEntries(assets.map((asset) => [asset.name, asset])),
    }));
    setActiveDrawing(names[0]);
    showNotice(
      `Đã giữ ${files.length} file trong phiên. Ảnh/PDF có thể xem ngay; DWG và định dạng kỹ thuật cần daemon chuyển đổi.`,
      "ok",
    );
    event.target.value = "";
  }

  function queueAction() {
    if (!action) return;
    if (action.connectorId) {
      setConnectorDrafts((current) => ({ ...current, [action.connectorId!]: true }));
    }
    setJobs((current) => [action.title, ...current.filter((job) => job !== action.title)].slice(0, 5));
    showNotice(
      action.connector
        ? `Đã lưu cấu hình nháp; cần xác thực ${action.connector} trước khi đồng bộ.`
        : `${action.title} đã vào hàng đợi cục bộ và chờ người dùng duyệt.`,
      action.connector ? "warn" : "ok",
    );
    setAction(null);
  }

  return (
    <div className="precon-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section ref={panelRef} className="precon-panel" role="dialog" aria-modal={action ? undefined : true}
        aria-labelledby="precon-title" tabIndex={-1}>
        <header className="precon-head">
          <div className="precon-identity">
            <div className="precon-mark">P</div>
            <div><span>PRECONSTRUCTION CONTROL CENTER</span>
              <h2 id="precon-title">Tiền thi công</h2>
              <p>Bóc khối lượng · Dự toán · Hiện trường · Tự động hóa</p></div>
          </div>
          <div className="precon-head-actions">
            <span className="precon-local"><i /> Dữ liệu dự án cục bộ</span>
            {jobs.length > 0 && <span className="precon-job-count">⚡ {jobs.length} tác vụ chờ</span>}
            <button type="button" onClick={() => {
              if (initialCadTarget) showNotice(`Đã map với ${fileNameFromPath(initialCadTarget)}.`, "ok");
              else if (onOpenAutoCAD) onOpenAutoCAD();
            }}>{initialCadTarget ? "A · Đã map AutoCAD" : "A · Kết nối AutoCAD"}</button>
            <button type="button" className="precon-close" onClick={onClose} aria-label="Đóng">×</button>
          </div>
        </header>

        <div className="precon-body">
          <aside className="precon-sidebar">
            <div className="precon-project">
              <span>DỰ ÁN ĐANG LÀM</span>
              <strong>Trung tâm thương mại An Phú</strong>
              <small>Gói thầu tổng hợp · REV P03</small>
              <div><i style={{ "--value": "72%" } as CSSProperties} /><b>72% hồ sơ dự thầu</b></div>
            </div>
            <nav className="precon-nav" aria-label="Nhóm chức năng tiền thi công">
              {NAV_ITEMS.map((item) => (
                <button key={item.id} type="button" className={view === item.id ? "active" : ""}
                  aria-current={view === item.id ? "page" : undefined}
                  onClick={() => setView(item.id)}>
                  <i>{item.icon}</i><span><b>{item.label}</b><small>{item.hint}</small></span>
                  {item.id === "field" && openIssues > 0 && <em>{openIssues}</em>}
                </button>
              ))}
            </nav>
            <div className="precon-sidebar-foot">
              <span>PHẠM VI</span>
              <p><b>{drawings.length}</b> bản vẽ · <b>{takeoffs.length}</b> hạng mục</p>
              <small>Dữ liệu demo lưu trong phiên ứng dụng; chưa đồng bộ cloud.</small>
            </div>
          </aside>

          <main className="precon-main">
            {view === "overview" && (
              <div className="precon-scroll">
                <section className="precon-hero">
                  <div>
                    <span className="precon-kicker">BID DUE · 06/08/2026</span>
                    <h3>Từ bản vẽ đến giá thầu<br />trong một luồng kiểm soát.</h3>
                    <p>Khối lượng có cấu trúc đi thẳng vào dự toán; thay đổi tại hiện trường được truy vết về bản vẽ và chi phí.</p>
                    <div><button type="button" className="primary" onClick={() => setView("takeoff")}>Tiếp tục bóc khối lượng</button>
                      <button type="button" onClick={() => onOpenReview("documents")}>Mở bộ bản vẽ</button></div>
                  </div>
                  <div className="precon-hero-score"><span>Độ sẵn sàng hồ sơ</span><strong>72<small>%</small></strong>
                    <div><i /></div><p>3 cảnh báo cần xử lý trước chốt giá.</p></div>
                </section>

                <section className="precon-metrics">
                  <article><span>KHỐI LƯỢNG</span><strong>{takeoffs.length}</strong><small>hạng mục đã cấu trúc</small><em>↗ 2 mới hôm nay</em></article>
                  <article><span>DỰ TOÁN HIỆN TẠI</span><strong>{money.format(grandTotal)}</strong><small>{variant}</small>
                    <em className={grandTotal <= budget ? "ok" : "warn"}>
                      {grandTotal <= budget ? "↓" : "↑"} {metric.format(Math.abs(1 - grandTotal / budget) * 100)}% {grandTotal <= budget ? "dưới" : "vượt"} ngân sách
                    </em></article>
                  <article><span>ISSUE HIỆN TRƯỜNG</span><strong>{openIssues}</strong><small>đang mở / xử lý</small><em className="warn">1 ưu tiên cao</em></article>
                  <article><span>AI CHỜ DUYỆT</span><strong>{suggestions.filter((item) => !item.approved).length}</strong><small>gợi ý assembly</small><em>Không tự động áp dụng</em></article>
                </section>

                <section className="precon-workflow">
                  <div className="precon-section-title"><span>LUỒNG TIỀN THI CÔNG</span><b>5 giai đoạn liên kết</b></div>
                  <div className="precon-workflow-grid">
                    {[
                      ["01", "Bản vẽ", `${drawings.length} tài liệu`, "takeoff"],
                      ["02", "Takeoff", `${takeoffs.length} hạng mục`, "takeoff"],
                      ["03", "Estimate", money.format(grandTotal), "estimating"],
                      ["04", "Bid review", "72% sẵn sàng", "estimating"],
                      ["05", "Field", `${openIssues} issue mở`, "field"],
                    ].map(([number, label, value, target]) => (
                      <button key={number} type="button" onClick={() => setView(target as PreconstructionView)}>
                        <i>{number}</i><span><b>{label}</b><small>{value}</small></span><em>→</em>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="precon-overview-grid">
                  <div className="precon-card">
                    <div className="precon-section-title"><span>CẦN CHÚ Ý</span><b>Trước chốt giá</b></div>
                    {[
                      ["!", unassignedAssemblyCount
                        ? `${unassignedAssemblyCount} hạng mục chưa gán Assembly`
                        : `${takeoffs.length} hạng mục đã gán Assembly`, "Rà soát Smart suggestions", "automation"],
                      ["₫", "Đơn giá cửa D1 thay đổi 6,2%", "Kiểm tra dự toán", "estimating"],
                      ["⚑", "Issue ISS-024 ảnh hưởng tuyến ống", "Mở hiện trường", "field"],
                    ].map(([icon, title, hint, target]) => (
                      <button className="precon-alert-row" key={title} type="button"
                        onClick={() => setView(target as PreconstructionView)}>
                        <i>{icon}</i><span><b>{title}</b><small>{hint}</small></span><em>›</em>
                      </button>
                    ))}
                  </div>
                  <div className="precon-card">
                    <div className="precon-section-title"><span>HOẠT ĐỘNG GẦN ĐÂY</span><b>Hôm nay</b></div>
                    <ol className="precon-activity">
                      <li><i /><span><b>AutoCount</b> đề xuất 42 cửa D1<small>09:42 · Minh Anh đã duyệt</small></span></li>
                      <li><i /><span><b>Estimate Cơ sở</b> cập nhật hao hụt gạch<small>09:18 · Quốc Bảo</small></span></li>
                      <li><i /><span><b>Daily report</b> ngày 30/07 được lưu nháp<small>08:55 · Lan Chi</small></span></li>
                    </ol>
                  </div>
                </section>
              </div>
            )}

            {view === "takeoff" && (
              <div className="precon-scroll">
                <ViewHeading eyebrow="DIGITAL TAKEOFF" title="Bóc khối lượng từ bản vẽ"
                  copy="PDF, DWG và ảnh · hiệu chỉnh tỉ lệ · template · hệ số hao hụt"
                  actions={<>
                    <input ref={uploadRef} hidden type="file" multiple
                      accept=".pdf,.dwg,.dxf,.rvt,.ifc,.doc,.docx,.xls,.xlsx,image/*"
                      onChange={handleDrawingUpload} />
                    <button type="button" onClick={() => uploadRef.current?.click()}>＋ Tải bản vẽ</button>
                    <button type="button" onClick={() => setAction(AI_FEATURES[0])}>✦ AutoCount</button>
                    <button type="button" className="primary" onClick={() => onOpenReview("measure")}>Mở bàn đo toàn màn hình</button>
                  </>} />
                <div className="precon-takeoff-workspace">
                  <aside className="precon-toolbox">
                    <span>CÔNG CỤ ĐO</span>
                    {TAKEOFF_TOOLS.map((tool) => (
                      <button key={tool.id} type="button" className={activeTool === tool.id ? "active" : ""}
                        aria-pressed={activeTool === tool.id}
                        onClick={() => {
                          setActiveTool(tool.id);
                          if (tool.id !== "select") showNotice(`Đã chọn ${tool.label}. Bấm lên bản vẽ để đặt.`);
                        }}>
                        <i>{tool.icon}</i><b>{tool.label}</b>
                      </button>
                    ))}
                    <div className="precon-toolbox-divider" />
                    <button type="button" onClick={() => setAction({
                      title: "Template Library",
                      description: "Lưu và tái sử dụng bộ công cụ, màu, Assembly và Hao hụt mặc định.",
                      steps: ["Đặt tên template", "Chọn công cụ", "Gán assembly", "Lưu thư viện"],
                    })}><i>▦</i><b>Template Library</b></button>
                    <button type="button" onClick={() => setAction({
                      title: "Auto-hyperlinking",
                      description: "Tạo liên kết điều hướng từ callout và mã bản vẽ.",
                      steps: ["Quét mã hiệu", "Ghép trang", "Xem trước link", "Duyệt áp dụng"],
                    })}><i>↗</i><b>Auto-hyperlinking</b></button>
                  </aside>
                  <div className="precon-canvas">
                    <div className="precon-canvas-bar">
                      <select aria-label="Bản vẽ đang bóc" value={activeDrawing}
                        onChange={(event) => setActiveDrawing(event.target.value)}>
                        {drawings.map((drawing) => <option key={drawing}>{drawing}</option>)}
                      </select>
                      <span>Tỉ lệ 1:100 · mm ↔ m</span>
                      <button type="button" aria-label="Thu nhỏ bản vẽ"
                        onClick={() => setCanvasZoom((value) => Math.max(55, value - 10))}>−</button>
                      <b>{canvasZoom}%</b>
                      <button type="button" aria-label="Phóng to bản vẽ"
                        onClick={() => setCanvasZoom((value) => Math.min(96, value + 10))}>＋</button>
                    </div>
                    <div className={`precon-sheet ${activeTool !== "select" ? "measuring" : ""}`}
                      style={{ "--precon-sheet-width": `${canvasZoom}%` } as CSSProperties}>
                      {activeDrawingAsset?.url && activeDrawingAsset.type.startsWith("image/") ? (
                        <img className="precon-uploaded-drawing" src={activeDrawingAsset.url}
                          alt={`Bản vẽ ${activeDrawingAsset.name}`} />
                      ) : activeDrawingAsset?.url &&
                        (activeDrawingAsset.type === "application/pdf" || activeDrawingAsset.name.toLowerCase().endsWith(".pdf")) ? (
                        <object className="precon-uploaded-drawing" data={activeDrawingAsset.url}
                          type="application/pdf" aria-label={`Bản vẽ ${activeDrawingAsset.name}`}>
                          <PlanPreview />
                        </object>
                      ) : <PlanPreview />}
                      <span className="precon-measure-shape area">428,6 m²</span>
                      <span className="precon-measure-shape line">184,2 m</span>
                      <span className="precon-measure-shape count">42</span>
                      {activeTool !== "select" && <em className="precon-cursor-hint">Bấm để đặt {KIND_META[activeTool].label.toLowerCase()}</em>}
                      <button type="button" className="precon-sheet-hit" onClick={addMeasurement}
                        aria-label="Đặt phép đo lên bản vẽ" />
                    </div>
                  </div>
                  <aside className="precon-takeoff-insight">
                    <span>SMART CONTEXT</span>
                    {selectedTakeoff ? <>
                      <strong>{selectedTakeoff.name}</strong><small>{selectedTakeoff.id} · {selectedTakeoff.source}</small>
                      <div className="precon-quantity"><b>{metric.format(selectedTakeoff.quantity)}</b><em>{selectedTakeoff.unit}</em></div>
                      <label>Hao hụt<input type="number" min="0" max="100" value={selectedTakeoff.waste}
                        onChange={(event) => updateTakeoff(selectedTakeoff.id, {
                          waste: boundedNumber(event.target.value, 100),
                        })} /><i>%</i></label>
                      <div className="precon-suggestion"><span>✦ Smart suggestions</span>
                        <b>{suggestedAssembly}</b>
                        <small>Đề xuất theo loại phép đo và bộ môn</small>
                        <button type="button" onClick={() => {
                          updateTakeoff(selectedTakeoff.id, { assembly: suggestedAssembly });
                          showNotice("Assembly đề xuất đã được duyệt.", "ok");
                        }}>Duyệt gợi ý</button></div>
                      {selectedTakeoff.confidence && <p>AutoCount confidence <b>{selectedTakeoff.confidence}%</b> · đã được người dùng duyệt.</p>}
                    </> : <p>Chọn một hạng mục để xem thuộc tính.</p>}
                  </aside>
                </div>
                <div className="precon-table-card">
                  <div className="precon-section-title"><span>TAKEOFF ITEMS</span><b>{takeoffs.length} hạng mục · Auto-naming sẵn sàng</b></div>
                  <div className="precon-table-scroll">
                    <table className="precon-table">
                      <thead><tr><th>Hạng mục</th><th>Phép đo</th><th>Nguồn</th><th>Khối lượng</th><th>Hao hụt</th><th>Assembly</th><th /></tr></thead>
                      <tbody>{takeoffs.map((item) => (
                        <tr key={item.id} className={selectedTakeoffId === item.id ? "selected" : ""}>
                          <td><button type="button" onClick={() => setSelectedTakeoffId(item.id)}><i className={item.kind} />{item.name}<small>{item.id}{item.confidence ? ` · AI ${item.confidence}%` : ""}</small></button></td>
                          <td>{KIND_META[item.kind].label.replace(" mới", "")}</td><td>{item.source}</td>
                          <td><input aria-label={`Khối lượng ${item.name}`} type="number" min="0" step="0.1" value={item.quantity}
                            onChange={(event) => updateTakeoff(item.id, {
                              quantity: boundedNumber(event.target.value),
                            })} /><b>{item.unit}</b></td>
                          <td><input aria-label={`Hao hụt ${item.name}`} type="number" min="0" max="100" value={item.waste}
                            onChange={(event) => updateTakeoff(item.id, {
                              waste: boundedNumber(event.target.value, 100),
                            })} /><b>%</b></td>
                          <td><select aria-label={`Assembly cho ${item.name}`} value={item.assembly}
                            onChange={(event) => updateTakeoff(item.id, { assembly: event.target.value })}>
                            <option value="">Chưa gán</option>{ASSEMBLIES.map(([id, label]) => <option key={id} value={id}>{id} · {label}</option>)}
                          </select></td>
                          <td><button type="button" className="precon-delete" aria-label={`Xóa ${item.name}`} onClick={() =>
                            setTakeoffs((current) => current.filter((row) => row.id !== item.id))}>×</button></td>
                        </tr>
                      ))}</tbody>
                    </table>
                  </div>
                </div>
              </div>
            )}

            {view === "estimating" && (
              <div className="precon-scroll">
                <ViewHeading eyebrow="ESTIMATING" title="Lập dự toán có liên kết khối lượng"
                  copy="Vật tư + Nhân công + chi phí khác · nhiều phương án · Budget vs Actual"
                  actions={<>
                    <label className="precon-inline-select">Phương án<select value={variant} onChange={(event) => setVariant(event.target.value)}>
                      <option>Cơ sở</option><option>Tối ưu chi phí</option><option>Thi công nhanh</option>
                    </select></label>
                    <button type="button" onClick={() =>
                      updateEstimateSettings({ nonMeasured: settings.nonMeasured + 5000000 })}>＋ Chi phí khác</button>
                    <button type="button" className="primary" onClick={() =>
                      showNotice(`Phương án “${variant}” đã được lưu độc lập trong phiên cục bộ.`, "ok")}>Lưu phương án</button>
                  </>} />
                <div className="precon-estimate-layout">
                  <div className="precon-table-card">
                    <div className="precon-section-title"><span>ESTIMATE LINES</span><b>{variant} · {estimateRows.length} dòng</b></div>
                    <div className="precon-table-scroll">
                      <table className="precon-table estimate">
                        <thead><tr><th>Hạng mục / Assembly</th><th>KL + hao hụt</th><th>Vật tư</th><th>Nhân công</th><th>Thành tiền</th></tr></thead>
                        <tbody>{estimateRows.map((row) => (
                          <tr key={row.id}>
                            <td><strong>{row.name}</strong><small>{row.assembly || "Chưa gán Assembly"}</small></td>
                            <td>{metric.format(row.effectiveQuantity)} {row.unit}<small>+{row.waste}% Hao hụt</small></td>
                            <td><input aria-label={`Đơn giá vật tư ${row.name}`} type="number" value={row.materialRate}
                              min="0" onChange={(event) =>
                                updateVariantRate(row.id, "materialRate", boundedNumber(event.target.value))} /></td>
                            <td><input aria-label={`Đơn giá nhân công ${row.name}`} type="number" value={row.laborRate}
                              min="0" onChange={(event) =>
                                updateVariantRate(row.id, "laborRate", boundedNumber(event.target.value))} /></td>
                            <td><strong>{money.format(row.amount)}</strong></td>
                          </tr>
                        ))}</tbody>
                      </table>
                    </div>
                  </div>
                  <aside className="precon-cost-summary">
                    <span>TÓM TẮT GIÁ THẦU</span><h4>{variant}</h4>
                    <label className="precon-tax-region">Vùng thuế<select value={settings.taxRegion} onChange={(event) => {
                      const region = event.target.value;
                      updateEstimateSettings({
                        taxRegion: region,
                        ...(region === "Miễn thuế" ? { tax: 0 } : {}),
                        ...(region === "Mặc định dự án" ? { tax: 8 } : {}),
                      });
                    }}><option>Mặc định dự án</option><option>Miễn thuế</option><option>Tùy chỉnh</option></select></label>
                    <dl>
                      <div><dt>Chi phí đo được</dt><dd>{money.format(measuredCost)}</dd></div>
                      <div><dt>Non-measured costs</dt><dd><input aria-label="Chi phí khác" type="number"
                        min="0" value={settings.nonMeasured} onChange={(event) =>
                          updateEstimateSettings({ nonMeasured: boundedNumber(event.target.value) })} /></dd></div>
                      <div><dt>Overhead <input aria-label="Tỷ lệ overhead" type="number" min="0" max="100"
                        value={settings.overhead} onChange={(event) =>
                          updateEstimateSettings({ overhead: boundedNumber(event.target.value, 100) })} />%</dt><dd>{money.format(overheadCost)}</dd></div>
                      <div><dt>Markup <input aria-label="Tỷ lệ markup" type="number" min="0" max="100"
                        value={settings.markup} onChange={(event) =>
                          updateEstimateSettings({ markup: boundedNumber(event.target.value, 100) })} />%</dt><dd>{money.format(markupCost)}</dd></div>
                      <div><dt>Thuế <input aria-label="Tỷ lệ thuế" type="number" min="0" max="100"
                        value={settings.tax} onChange={(event) => updateEstimateSettings({
                          tax: boundedNumber(event.target.value, 100),
                          taxRegion: "Tùy chỉnh",
                        })} />%</dt><dd>{money.format(taxCost)}</dd></div>
                    </dl>
                    <div className="precon-grand-total"><span>GIÁ DỰ THẦU</span><strong>{money.format(grandTotal)}</strong><small>Đã gồm thuế · phương án {variant}</small></div>
                    <button type="button" className="primary" onClick={() => showNotice("Đã đánh dấu phương án để review giá.", "ok")}>Gửi duyệt giá</button>
                  </aside>
                </div>
                <section className="precon-budget-card">
                  <div className="precon-section-title"><span>BUDGET VS ACTUAL</span><b>Ngân sách & actual minh họa trong phiên cục bộ</b></div>
                  <div className="precon-budget-stats">
                    <div><span>Ngân sách</span><strong>{money.format(budget)}</strong><i><em style={{ width: "100%" }} /></i></div>
                    <div><span>Dự toán</span><strong>{money.format(grandTotal)}</strong><i><em style={{ width: `${Math.min(100, grandTotal / budget * 100)}%` }} /></i></div>
                    <div><span>Chi phí thực tế</span><strong>{money.format(actual)}</strong><i><em style={{ width: `${actual / budget * 100}%` }} /></i></div>
                    <b className={grandTotal <= budget ? "ok" : "warn"}>{money.format(Math.abs(budget - grandTotal))} {grandTotal <= budget ? "còn lại" : "vượt ngân sách"}</b>
                  </div>
                </section>
                <section className="precon-library-grid">
                  <div className="precon-card">
                    <div className="precon-section-title"><span>ASSEMBLY LIBRARY</span><button type="button" onClick={() => setAction({
                      title: "Assembly Library",
                      description: "Quản lý cụm vật tư, nhân công và quy tắc áp dụng cho dự toán.",
                      steps: ["Chọn assembly", "Cập nhật thành phần", "Kiểm tra đơn vị", "Lưu phiên bản"],
                    })}>Quản lý thư viện →</button></div>
                    {ASSEMBLIES.slice(0, 4).map(([id, label, detail]) => <div className="precon-library-row" key={id}>
                      <i>▦</i><span><b>{label}</b><small>{id} · {detail}</small></span><em>›</em></div>)}
                  </div>
                  <div className="precon-card">
                    <div className="precon-section-title"><span>MATERIAL CATALOG</span><button type="button" onClick={() => setAction({
                      title: "Cập nhật Material Catalog",
                      description: "Chuẩn bị bảng đơn giá vật tư trước khi đưa vào phương án dự toán đang chọn.",
                      steps: ["Chọn nguồn giá", "Đối chiếu mã vật tư", "Xem thay đổi", "Duyệt cập nhật"],
                    })}>Cập nhật đơn giá →</button></div>
                    {MATERIALS.map(([id, label, rate]) => <div className="precon-library-row" key={id}>
                      <i>◇</i><span><b>{label}</b><small>{id}</small></span><em>{rate}</em></div>)}
                  </div>
                </section>
              </div>
            )}

            {view === "field" && (
              <div className="precon-scroll">
                <ViewHeading eyebrow="FIELD MANAGEMENT" title="Quản lý hiện trường từ bản vẽ"
                  copy="Issue có ảnh · Punch list · Báo cáo ngày · markup tại vị trí thi công"
                  actions={<>
                    <button type="button" onClick={() => onOpenReview("markup")}>✎ Xem & markup bản vẽ</button>
                    <button type="button" className="primary" onClick={() => {
                      const issue: Issue = { id: `ISS-${String(issues.length + 25).padStart(3, "0")}`, title: "Issue hiện trường mới",
                        location: "Chưa ghim lên bản vẽ", owner: "Chưa phân công", status: "Mở", photos: [], tone: "medium" };
                      setIssues((current) => [issue, ...current]);
                      setSelectedIssueId(issue.id);
                      showNotice("Đã tạo issue nháp.", "ok");
                    }}>＋ Tạo issue</button>
                  </>} />
                <section className="precon-field-metrics">
                  <article><i className="high">!</i><span><b>{openIssues}</b><small>Issue đang mở</small></span></article>
                  <article><i>✓</i><span><b>{punch.filter((item) => !item.done).length}</b><small>Punch chưa xong</small></span></article>
                  <article><i>▧</i><span><b>{issues.reduce((sum, issue) => sum + issue.photos.length, 0)}</b><small>Ảnh hiện trường</small></span></article>
                  <article><i>▤</i><span><b>{reports.length}</b><small>Báo cáo ngày</small></span></article>
                </section>
                <nav className="precon-subtabs" aria-label="Nghiệp vụ hiện trường" role="tablist">
                  <button type="button" role="tab" aria-selected={fieldView === "issues"}
                    className={fieldView === "issues" ? "active" : ""} onClick={() => setFieldView("issues")}>Issue tracking <b>{issues.length}</b></button>
                  <button type="button" role="tab" aria-selected={fieldView === "punch"}
                    className={fieldView === "punch" ? "active" : ""} onClick={() => setFieldView("punch")}>Punch list <b>{punch.length}</b></button>
                  <button type="button" role="tab" aria-selected={fieldView === "daily"}
                    className={fieldView === "daily" ? "active" : ""} onClick={() => setFieldView("daily")}>Báo cáo ngày <b>{reports.length}</b></button>
                </nav>
                {fieldView === "issues" && (
                  <div className="precon-field-layout">
                    <div className="precon-card">
                      <div className="precon-section-title"><span>ISSUES</span><b>Đính kèm ảnh trực tiếp lên bản vẽ</b></div>
                      {issues.map((issue) => <article className={`precon-issue${selectedIssueId === issue.id ? " selected" : ""}`} key={issue.id}>
                        <i className={issue.tone}>{issue.tone === "high" ? "!" : issue.photos.length ? "▧" : "○"}</i>
                        <button type="button" className="precon-issue-main" onClick={() => setSelectedIssueId(issue.id)}>
                          <strong>{issue.title}</strong><small>{issue.id} · {issue.location}</small>
                          <em>{issue.owner} · {issue.photos.length} ảnh</em>
                        </button>
                        <label className="precon-issue-photo">＋ Ảnh<input type="file" accept="image/*" multiple
                          onChange={(event) => {
                            const files = Array.from(event.target.files || []);
                            if (files.length) {
                              const photos = retainFiles(files);
                              setIssues((current) => current.map((row) =>
                                row.id === issue.id ? { ...row, photos: [...row.photos, ...photos] } : row));
                              setSelectedIssueId(issue.id);
                              showNotice(`Đã giữ ${files.length} ảnh trong ${issue.id} cho phiên cục bộ.`, "ok");
                            }
                            event.target.value = "";
                          }} /></label>
                        <select aria-label={`Trạng thái ${issue.id}`} value={issue.status}
                          onChange={(event) => setIssues((current) => current.map((row) =>
                          row.id === issue.id ? { ...row, status: event.target.value as Issue["status"] } : row))}>
                          <option>Mở</option><option>Đang xử lý</option><option>Đã đóng</option>
                        </select>
                      </article>)}
                    </div>
                    <div className="precon-field-plan">
                      <div><span>A-101 · TẦNG 01</span><button type="button" onClick={() => onOpenReview("markup")}>Mở bản vẽ ↗</button></div>
                      <div className="precon-field-sheet"><PlanPreview />
                        {issues.slice(0, 3).map((issue, index) => (
                          <button type="button" key={issue.id} className={`pin ${["one", "two", "three"][index]}${selectedIssueId === issue.id ? " active" : ""}`}
                            aria-label={`Chọn ${issue.id}`} onClick={() => setSelectedIssueId(issue.id)}>{index + 1}</button>
                        ))}</div>
                      <p><b>{selectedIssue?.id} · {selectedIssue?.title}</b>
                        <span>{selectedIssue?.location} · {selectedIssue?.owner}</span></p>
                      <div className="precon-field-photos">
                        {selectedIssue?.photos.length ? selectedIssue.photos.map((photo, index) =>
                          photo.url ? <img key={`${photo.name}-${index}`} src={photo.url} alt={photo.name} />
                            : <span key={`${photo.name}-${index}`} title={photo.name}>▧<small>{photo.name}</small></span>)
                          : <em>Chưa có ảnh trong issue này.</em>}
                      </div>
                    </div>
                  </div>
                )}
                {fieldView === "punch" && (
                  <div className="precon-card precon-punch-list">
                    <div className="precon-section-title"><span>PUNCH LIST</span><button type="button" onClick={() =>
                      setPunch((current) => [...current, { id: `PL-${current.length + 32}`, title: "Hạng mục cần hoàn thiện",
                        location: "Chưa xác định", owner: "Chưa phân công", done: false }])}>＋ Thêm hạng mục</button></div>
                    {punch.map((item) => <label key={item.id} className={item.done ? "done" : ""}>
                      <input type="checkbox" checked={item.done} onChange={() => setPunch((current) =>
                        current.map((row) => row.id === item.id ? { ...row, done: !row.done } : row))} />
                      <i>{item.done ? "✓" : ""}</i><span><strong>{item.title}</strong><small>{item.id} · {item.location}</small></span>
                      <em>{item.owner}</em>
                    </label>)}
                  </div>
                )}
                {fieldView === "daily" && (
                  <div className="precon-daily-layout">
                    <div className="precon-card precon-daily-form">
                      <div className="precon-section-title"><span>BÁO CÁO NGÀY</span><b>Nháp cục bộ</b></div>
                      <div className="precon-form-grid">
                        <label>Ngày<input type="date" value={dailyDate} onChange={(event) => setDailyDate(event.target.value)} /></label>
                        <label>Nhân lực<input type="number" min="0" value={dailyLabor}
                          onChange={(event) => setDailyLabor(boundedNumber(event.target.value))} /></label>
                        <label>Thời tiết<select value={dailyWeather} onChange={(event) => setDailyWeather(event.target.value)}>
                          <option>Nắng</option><option>Mưa nhẹ</option><option>Mưa lớn</option></select></label>
                        <label>Ca làm<select value={dailyShift} onChange={(event) => setDailyShift(event.target.value)}>
                          <option>Ca ngày</option><option>Ca đêm</option></select></label>
                        <label>Giờ an toàn<input type="number" min="0" value={dailySafetyHours}
                          onChange={(event) => setDailySafetyHours(boundedNumber(event.target.value))} /></label>
                      </div>
                      <label>Công việc & ghi chú<textarea rows={6} value={dailyNotes}
                        onChange={(event) => setDailyNotes(event.target.value)} /></label>
                      <div><label className="precon-daily-photo">▧ Đính kèm ảnh{dailyPhotos.length ? ` (${dailyPhotos.length})` : ""}
                        <input type="file" accept="image/*" multiple onChange={(event) => {
                          const files = Array.from(event.target.files || []);
                          if (files.length) setDailyPhotos((current) => [...current, ...retainFiles(files)]);
                          event.target.value = "";
                        }} /></label><button type="button" className="primary" onClick={() => {
                        const dateLabel = dailyDate.split("-").reverse().join("/");
                        setReports((current) => [
                          `${dateLabel} · ${dailyLabor} nhân công · ${dailyWeather} · ${dailyShift} · ${dailySafetyHours} giờ an toàn · ${dailyPhotos.length} ảnh · ${dailyNotes}`,
                          ...current,
                        ]);
                        showNotice("Báo cáo ngày đã được lưu trong phiên.", "ok");
                      }}>Lưu báo cáo</button></div>
                    </div>
                    <div className="precon-card">
                      <div className="precon-section-title"><span>LỊCH SỬ BÁO CÁO</span><b>{reports.length} bản</b></div>
                      {reports.map((report, index) => <div className="precon-report-row" key={`${report}-${index}`}>
                        <i>▤</i><span><b>{report.split(" · ")[0]}</b><small>{report}</small></span><em>›</em></div>)}
                    </div>
                  </div>
                )}
              </div>
            )}

            {view === "integrations" && (
              <div className="precon-scroll">
                <ViewHeading eyebrow="INTEGRATIONS" title="Kết nối hệ sinh thái dự án"
                  copy="Xác thực và ánh xạ dữ liệu qua daemon; không lưu token ở ứng dụng web tĩnh." />
                <div className="precon-connector-note"><i>i</i><span><b>Chưa có connector nào được xác thực.</b>
                  <small>Các nút dưới đây chỉ lưu cấu hình nháp, không gửi dữ liệu hoặc tuyên bố kết nối thành công.</small></span></div>
                <section className="precon-connectors">
                  {CONNECTORS.map((connector) => (
                    <article key={connector.id} className={connectorDrafts[connector.id] ? "draft" : ""}>
                      <div className={`precon-connector-mark ${connector.id}`}>{connector.mark}</div>
                      <span className="precon-connector-status"><i />{connectorDrafts[connector.id] ? "Cấu hình nháp" : "Chưa kết nối"}</span>
                      <h4>{connector.name}</h4><b>{connector.purpose}</b><p>{connector.detail}</p>
                      <ul>{connector.id === "procore"
                        ? <><li>Project & drawing set</li><li>Issue / RFI status</li><li>Document revision</li></>
                        : connector.id === "acumatica"
                        ? <><li>Cost code & budget</li><li>Commitment</li><li>Actual cost</li></>
                        : <><li>Estimate & vendor</li><li>Job cost</li><li>Invoice mapping</li></>}</ul>
                      <button type="button" onClick={() => {
                        setAction({ title: `Thiết lập ${connector.name}`, connector: connector.name, connectorId: connector.id,
                          description: `Cấu hình ánh xạ cho ${connector.purpose.toLowerCase()}; xác thực OAuth phải chạy phía daemon.`,
                          steps: ["Chọn tổ chức", "Ánh xạ project", "Chọn dữ liệu đồng bộ", "Quản trị viên xác thực"] });
                      }}>{connectorDrafts[connector.id] ? "Tiếp tục cấu hình" : "Thiết lập kết nối"} →</button>
                    </article>
                  ))}
                </section>
                <section className="precon-mapping-flow">
                  <div className="precon-section-title"><span>DATA MAPPING</span><b>Luồng có kiểm soát</b></div>
                  <div><span><i>⌁</i><b>Takeoff</b><small>Quantity + source</small></span><em>→</em>
                    <span><i>₫</i><b>Estimate</b><small>Cost code + amount</small></span><em>→</em>
                    <span><i>◇</i><b>Daemon</b><small>Auth + audit log</small></span><em>→</em>
                    <span><i>↗</i><b>External system</b><small>Chỉ sau xác nhận</small></span></div>
                </section>
              </div>
            )}

            {view === "automation" && (
              <div className="precon-scroll">
                <ViewHeading eyebrow="AI & AUTOMATION" title="Tự động hóa có kỹ sư kiểm soát"
                  copy="AI tạo đề xuất; mọi số lượng, tên và Assembly phải được duyệt trước khi vào dự toán."
                  actions={<button type="button" className="primary" onClick={() => setAction(AI_FEATURES[1])}>✦ Tạo takeoff theo chuyên ngành</button>} />
                <section className="precon-ai-summary">
                  <div><span>18</span><small>Ký hiệu đã nhận diện</small></div>
                  <div><span>92%</span><small>Độ tin cậy trung bình</small></div>
                  <div><span>{suggestions.filter((item) => !item.approved).length}</span><small>Đề xuất chờ duyệt</small></div>
                  <p><i>✓</i><span><b>Human approval gate đang bật</b><small>Không có thay đổi AI nào tự động ghi vào takeoff hoặc dự toán.</small></span></p>
                </section>
                <section className="precon-ai-grid">
                  {AI_FEATURES.map((feature, index) => (
                    <button type="button" key={feature.title} onClick={() => setAction(feature)}>
                      <i>{index === 0 ? "◎" : index === 1 ? "⌁" : index === 2 ? "T" : "▦"}</i>
                      <span><em>{index === 0 ? "COMPUTER VISION" : index === 1 ? "TRADE MODEL" : index === 2 ? "NAMING" : "ESTIMATING"}</em>
                        <strong>{feature.title}</strong><small>{feature.description}</small></span><b>Cấu hình →</b>
                    </button>
                  ))}
                </section>
                <section className="precon-table-card">
                  <div className="precon-section-title"><span>APPROVAL QUEUE</span><b>{suggestions.filter((item) => !item.approved).length} cần xem</b></div>
                  <table className="precon-table precon-ai-table">
                    <thead><tr><th>Phát hiện</th><th>Gợi ý Assembly</th><th>Độ tin cậy</th><th>Trạng thái</th><th /></tr></thead>
                    <tbody>{suggestions.map((item) => <tr key={item.id}>
                      <td><strong>{item.item}</strong><small>{item.id}</small></td><td>{item.suggestion}</td>
                      <td><span className="precon-confidence"><i style={{ width: `${item.confidence}%` }} /></span><b>{item.confidence}%</b></td>
                      <td><span className={item.approved ? "precon-approved" : "precon-pending"}>{item.approved ? "Đã duyệt" : "Chờ duyệt"}</span></td>
                      <td>{item.approved ? <button type="button" onClick={() => setSuggestions((current) => current.map((row) =>
                        row.id === item.id ? { ...row, approved: false } : row))}>Hoàn tác</button>
                        : <button type="button" className="primary" onClick={() => setSuggestions((current) => current.map((row) =>
                          row.id === item.id ? { ...row, approved: true } : row))}>Duyệt</button>}</td>
                    </tr>)}</tbody>
                  </table>
                </section>
              </div>
            )}
          </main>
        </div>

        <footer className="precon-footer">
          <span><i /> Phiên cục bộ · Chưa đồng bộ cloud</span>
          <span>{initialCadTarget ? `AutoCAD: ${fileNameFromPath(initialCadTarget)}` : "Chưa map bản vẽ AutoCAD"}</span>
          <span>Cập nhật vừa xong</span>
        </footer>

        {notice && <div className={`precon-notice ${notice.tone}`} role="status">
          <i>{notice.tone === "ok" ? "✓" : notice.tone === "warn" ? "!" : "i"}</i><p>{notice.text}</p>
          <button type="button" onClick={() => setNotice(null)} aria-label="Đóng thông báo">×</button>
        </div>}

        {action && (
          <div className="precon-action-backdrop" onMouseDown={(event) => {
            if (event.target === event.currentTarget) setAction(null);
          }}>
            <div ref={actionDialogRef} className="precon-action-dialog" role="dialog" aria-modal="true"
              aria-labelledby="precon-action-title">
              <div className="precon-action-icon">{action.connector ? "↗" : "✦"}</div>
              <span>{action.connector ? "CONNECTOR SETUP" : "REVIEWED WORKFLOW"}</span>
              <h3 id="precon-action-title">{action.title}</h3><p>{action.description}</p>
              <ol>{action.steps.map((step, index) => <li key={step}><b>{index + 1}</b><span>{step}</span></li>)}</ol>
              <div><button type="button" onClick={() => setAction(null)}>Hủy</button>
                <button type="button" className="primary" onClick={queueAction}>
                  {action.connector ? "Lưu cấu hình nháp" : "Thêm vào hàng đợi"}
                </button></div>
              <small>{action.connector
                ? "Chưa gửi dữ liệu ra hệ thống ngoài; bước xác thực cần backend daemon và quyền quản trị."
                : "Tác vụ chỉ tạo kết quả đề xuất. Người dùng phải kiểm tra và duyệt trước khi áp dụng."}</small>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

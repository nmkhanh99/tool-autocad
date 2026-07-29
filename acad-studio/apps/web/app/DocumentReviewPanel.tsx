"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";

export type ReviewWorkspaceView =
  | "documents"
  | "markup"
  | "measure"
  | "compare"
  | "automate"
  | "ai";

type ReviewDocument = {
  id: string;
  name: string;
  discipline: string;
  revision: string;
  pages: number;
  size: string;
  status: "current" | "review" | "superseded";
  source: "sample" | "upload" | "autocad";
  url?: string;
};

type MarkupStatus = "Mở" | "Đang xử lý" | "Đã duyệt";

type Markup = {
  id: string;
  tool: string;
  label: string;
  author: string;
  createdAt: string;
  status: MarkupStatus;
  page: number;
  x: number;
  y: number;
  color: string;
  value?: string;
  zone: string;
  trade: string;
};

type Notice = {
  tone: "info" | "ok" | "warn";
  text: string;
};

type WorkspaceAction = {
  title: string;
  description: string;
  connector?: string;
  steps: string[];
};

type ToolItem = {
  id: string;
  label: string;
  icon: string;
};

export type DocumentReviewPanelProps = {
  open: boolean;
  daemon: string;
  initialView?: ReviewWorkspaceView;
  initialCadTarget?: string;
  onClose: () => void;
  onOpenAutoCAD?: () => void;
};

const SAMPLE_DOCUMENTS: ReviewDocument[] = [
  {
    id: "a101",
    name: "A-101 · Mặt bằng tầng 01.pdf",
    discipline: "Kiến trúc",
    revision: "P03",
    pages: 12,
    size: "18,4 MB",
    status: "current",
    source: "sample",
  },
  {
    id: "s201",
    name: "S-201 · Kết cấu sàn tầng 01.pdf",
    discipline: "Kết cấu",
    revision: "P02",
    pages: 8,
    size: "11,2 MB",
    status: "review",
    source: "sample",
  },
  {
    id: "m301",
    name: "M-301 · Điều hòa thông gió.pdf",
    discipline: "Cơ điện",
    revision: "P01",
    pages: 16,
    size: "24,7 MB",
    status: "review",
    source: "sample",
  },
  {
    id: "e401",
    name: "E-401 · Chiếu sáng tầng 01.pdf",
    discipline: "Điện",
    revision: "P02",
    pages: 9,
    size: "9,8 MB",
    status: "superseded",
    source: "sample",
  },
];

const INITIAL_MARKUPS: Markup[] = [
  {
    id: "M-104",
    tool: "callout",
    label: "Kiểm tra cao độ trần tại sảnh",
    author: "Minh Anh",
    createdAt: "29/07/2026 · 09:42",
    status: "Mở",
    page: 1,
    x: 64,
    y: 28,
    color: "#ffb84d",
    zone: "Sảnh chính",
    trade: "Kiến trúc",
  },
  {
    id: "M-103",
    tool: "cloud",
    label: "Xung đột ống gió và dầm D3",
    author: "Quốc Bảo",
    createdAt: "29/07/2026 · 09:18",
    status: "Đang xử lý",
    page: 1,
    x: 44,
    y: 53,
    color: "#ff6577",
    zone: "Trục C–D / 4–5",
    trade: "Phối hợp",
  },
  {
    id: "M-102",
    tool: "stamp",
    label: "FOR REVIEW",
    author: "Lan Chi",
    createdAt: "28/07/2026 · 16:03",
    status: "Đã duyệt",
    page: 1,
    x: 73,
    y: 76,
    color: "#4bd49b",
    zone: "Toàn trang",
    trade: "QA/QC",
  },
  {
    id: "Q-018",
    tool: "area",
    label: "Diện tích hoàn thiện sàn",
    author: "Bạn",
    createdAt: "Hôm nay · 08:55",
    status: "Mở",
    page: 1,
    x: 25,
    y: 68,
    color: "#58a6ff",
    value: "18,60 m²",
    zone: "Phòng 1.06",
    trade: "Khối lượng",
  },
];

const VIEW_TABS: { id: ReviewWorkspaceView; label: string; icon: string }[] = [
  { id: "documents", label: "Tài liệu", icon: "▤" },
  { id: "markup", label: "Markup", icon: "✎" },
  { id: "measure", label: "Đo lường", icon: "⌁" },
  { id: "compare", label: "So sánh", icon: "◫" },
  { id: "automate", label: "Tự động hóa", icon: "⚡" },
  { id: "ai", label: "AI Review", icon: "✦" },
];

const MARKUP_TOOLS: ToolItem[] = [
  { id: "select", label: "Chọn", icon: "⌖" },
  { id: "text", label: "Văn bản", icon: "T" },
  { id: "callout", label: "Callout", icon: "◰" },
  { id: "note", label: "Ghi chú", icon: "▣" },
  { id: "highlight", label: "Highlight", icon: "▰" },
  { id: "line", label: "Đường", icon: "╱" },
  { id: "polygon", label: "Đa giác", icon: "⬠" },
  { id: "arrow", label: "Mũi tên", icon: "➜" },
  { id: "cloud", label: "Đám mây", icon: "☁" },
  { id: "stamp", label: "Con dấu", icon: "✓" },
  { id: "media", label: "Ảnh / video", icon: "▧" },
  { id: "link", label: "Hyperlink", icon: "↗" },
];

const MEASURE_TOOLS: ToolItem[] = [
  { id: "select", label: "Chọn", icon: "⌖" },
  { id: "length", label: "Chiều dài", icon: "↔" },
  { id: "area", label: "Diện tích", icon: "▱" },
  { id: "perimeter", label: "Chu vi", icon: "⬡" },
  { id: "volume", label: "Thể tích", icon: "▥" },
  { id: "count", label: "Đếm", icon: "●" },
  { id: "arc", label: "Cung", icon: "⌒" },
  { id: "angle", label: "Góc", icon: "∠" },
  { id: "fill", label: "Dynamic Fill", icon: "◩" },
];

const DOCUMENT_ACTIONS: WorkspaceAction[] = [
  {
    title: "Tạo PDF",
    description: "Nhận Word, Excel, DWG, DXF, Revit hoặc bản vẽ đang mở trong AutoCAD.",
    connector: "Bộ chuyển đổi tài liệu / AutoCAD",
    steps: ["Chọn nguồn", "Cấu hình trang", "Kiểm tra đầu ra", "Tạo PDF"],
  },
  {
    title: "Sắp xếp trang",
    description: "Thêm, xóa, xoay và đổi thứ tự trang trong bộ hồ sơ.",
    steps: ["Chọn tài liệu", "Kéo thả trang", "Kiểm tra bookmark", "Lưu phiên bản mới"],
  },
  {
    title: "Hợp nhất PDF",
    description: "Gộp các tài liệu đang chọn thành một bộ phát hành.",
    steps: ["Chọn tài liệu", "Xếp thứ tự", "Đồng bộ bookmark", "Xuất bộ PDF"],
  },
  {
    title: "Tách tài liệu",
    description: "Tách theo trang, bookmark hoặc mã bản vẽ.",
    steps: ["Chọn phạm vi", "Đặt quy tắc tên", "Kiểm tra kết quả", "Xuất file"],
  },
  {
    title: "OCR & tìm kiếm",
    description: "Lập chỉ mục toàn văn cho PDF scan và tìm theo ký hiệu kỹ thuật.",
    connector: "OCR engine",
    steps: ["Nhận dạng trang scan", "Chuẩn hóa tiếng Việt", "Lập chỉ mục", "Kiểm tra độ tin cậy"],
  },
  {
    title: "Bảo mật",
    description: "Mật khẩu, phân quyền in/sửa, chứng thư và chữ ký số.",
    connector: "Kho chứng thư số",
    steps: ["Chọn chính sách", "Chọn chứng thư", "Ký tài liệu", "Xác minh chữ ký"],
  },
];

const AUTOMATIONS: WorkspaceAction[] = [
  {
    title: "Batch Link",
    description: "Tạo hyperlink từ mã hiệu bản vẽ và vùng tham chiếu.",
    steps: ["Quét mã hiệu", "Đối chiếu trang", "Xem trước liên kết", "Áp dụng"],
  },
  {
    title: "Batch Slip Sheet",
    description: "Thay trang revision mới và chuyển tiếp markup cũ.",
    steps: ["Ghép cặp revision", "Căn chỉnh trang", "Chuyển markup", "Xác nhận"],
  },
  {
    title: "Batch Signatures",
    description: "Ký và đóng dấu hàng loạt theo vùng đã cấu hình.",
    connector: "Kho chứng thư số",
    steps: ["Chọn bộ hồ sơ", "Chọn chứng thư", "Đặt vùng ký", "Ký hàng loạt"],
  },
  {
    title: "Batch Compare",
    description: "So sánh các cặp revision và tô nổi phần thay đổi.",
    steps: ["Ghép cặp trang", "Căn chỉnh", "Phân tích khác biệt", "Xuất báo cáo"],
  },
  {
    title: "Overlay",
    description: "Chồng hai bản vẽ với màu phân biệt để kiểm tra thay đổi.",
    steps: ["Chọn hai revision", "Chọn điểm căn", "Đặt màu", "Xuất overlay"],
  },
  {
    title: "Scripting",
    description: "Chuỗi thao tác lặp lại có tham số và nhật ký chạy.",
    steps: ["Chọn trigger", "Xếp bước", "Chạy thử", "Xuất bản workflow"],
  },
  {
    title: "AutoMark",
    description: "Tự động đánh dấu trang theo mã, discipline và trạng thái.",
    steps: ["Đặt điều kiện", "Chọn con dấu", "Xem trước", "Áp dụng"],
  },
];

const AI_FEATURES: WorkspaceAction[] = [
  {
    title: "AI Drawing Review",
    description: "Rà ghi chú, kích thước, ký hiệu và xung đột có khả năng xảy ra.",
    connector: "Bluebeam Max / AI review provider",
    steps: ["Chọn discipline", "Đặt rule review", "Chạy phân tích", "Duyệt phát hiện"],
  },
  {
    title: "AI Drawing Compare",
    description: "Nhận diện thay đổi có ý nghĩa thay vì chỉ so pixel.",
    connector: "Bluebeam Max / AI compare provider",
    steps: ["Ghép revision", "Phân loại thay đổi", "Đánh giá tác động", "Xuất tóm tắt"],
  },
  {
    title: "Multi-view Stitching",
    description: "Ghép các góc nhìn liên quan thành một vùng review thống nhất.",
    connector: "Bluebeam Max",
    steps: ["Chọn viewport", "Đặt điểm khớp", "Ghép hình", "Kiểm tra sai lệch"],
  },
  {
    title: "Magic Markups",
    description: "Duplicate as, Convert to và Offset từ markup đang chọn.",
    connector: "Bluebeam Max",
    steps: ["Chọn markup", "Chọn phép biến đổi", "Xem trước", "Áp dụng"],
  },
];

const TOOL_LABELS: Record<string, string> = {
  text: "Ghi chú văn bản",
  callout: "Callout mới",
  note: "Sticky note",
  highlight: "Vùng highlight",
  line: "Đường kiểm tra",
  polygon: "Đa giác đánh dấu",
  arrow: "Mũi tên chỉ dẫn",
  cloud: "Revision cloud",
  stamp: "FOR REVIEW",
  media: "Ảnh / video hiện trường",
  link: "Liên kết tài liệu",
  length: "Đo chiều dài",
  area: "Đo diện tích",
  perimeter: "Đo chu vi",
  volume: "Đo thể tích",
  count: "Đếm thiết bị",
  arc: "Đo chiều dài cung",
  angle: "Đo góc",
  fill: "Dynamic Fill",
};

const MEASURE_VALUES: Record<string, string> = {
  length: "4,25 m",
  area: "18,60 m²",
  perimeter: "17,40 m",
  volume: "55,80 m³",
  count: "1 thiết bị",
  arc: "2,80 m",
  angle: "90°",
  fill: "18,60 m²",
};

function fileSize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toLocaleString("vi-VN", { maximumFractionDigits: 1 })} MB`;
}

function csvCell(value: string | number): string {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function measurementNumber(value?: string): number {
  const matched = value?.match(/[\d.,]+/)?.[0];
  if (!matched) return 0;
  const normalized = matched.includes(",")
    ? matched.replaceAll(".", "").replace(",", ".")
    : matched;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : 0;
}

function metricNumber(value: number): string {
  return value.toLocaleString("vi-VN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function downloadCsv(name: string, rows: (string | number)[][]): void {
  const csv = "\uFEFF" + rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function documentStatusLabel(status: ReviewDocument["status"]): string {
  if (status === "current") return "Hiện hành";
  if (status === "review") return "Đang review";
  return "Đã thay thế";
}

function documentPageLabel(document: ReviewDocument): string {
  return document.source === "upload"
    ? "Chưa lập chỉ mục trang"
    : `${document.pages} trang`;
}

function TechnicalSheet() {
  return (
    <svg className="review-blueprint" viewBox="0 0 1000 690" aria-label="Bản vẽ kỹ thuật mẫu">
      <defs>
        <pattern id="review-grid-small" width="10" height="10" patternUnits="userSpaceOnUse">
          <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#dce4eb" strokeWidth=".45" />
        </pattern>
        <pattern id="review-grid" width="50" height="50" patternUnits="userSpaceOnUse">
          <rect width="50" height="50" fill="url(#review-grid-small)" />
          <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#c2ced8" strokeWidth=".75" />
        </pattern>
      </defs>
      <rect width="1000" height="690" fill="#fbfcfd" />
      <rect x="28" y="28" width="944" height="634" fill="url(#review-grid)" stroke="#526575" strokeWidth="2" />
      <g className="review-plan-walls" fill="none" stroke="#243746">
        <path strokeWidth="8" d="M120 115H825V548H120Z M315 115V548 M596 115V548 M120 350H825" />
        <path strokeWidth="3" d="M135 132H300V335H135Z M331 132H580V335H331Z M612 132H810V335H612Z" />
        <path strokeWidth="3" d="M135 367H300V530H135Z M331 367H580V530H331Z M612 367H810V530H612Z" />
        <path strokeWidth="2" d="M315 280a70 70 0 0 1 70 70 M596 442a75 75 0 0 0 75-75" />
      </g>
      <g fill="none" stroke="#5b7080" strokeWidth="1.4">
        <path d="M160 172h92v54h-92z M375 170h148v94H375z M659 166h92v106h-92z" />
        <path d="M158 401h96v78h-96z M376 399h154v88H376z M655 407h104v72H655z" />
        <path d="M405 203h86 M405 217h86 M405 231h86" />
      </g>
      <g className="review-plan-services" fill="none" strokeLinecap="round">
        <path d="M160 310H275L348 235H535L635 305H770" stroke="#2f86c7" strokeWidth="5" />
        <path d="M180 498V390H460V306H718V190" stroke="#cf5353" strokeWidth="3" strokeDasharray="12 7" />
        <path d="M208 146V315M451 142V319M718 146V319" stroke="#52a66d" strokeWidth="2" />
      </g>
      <g fill="#334b5e" fontFamily="Arial, sans-serif" fontSize="15">
        <text x="176" y="252">P. 1.01</text>
        <text x="422" y="294">SẢNH CHÍNH</text>
        <text x="674" y="296">P. 1.03</text>
        <text x="176" y="509">P. 1.04</text>
        <text x="423" y="516">P. 1.06</text>
        <text x="675" y="507">P. 1.08</text>
      </g>
      <g fill="#fff" stroke="#4d6172" strokeWidth="1.5">
        {[120, 315, 596, 825].map((x, index) => (
          <g key={`grid-x-${x}`}>
            <circle cx={x} cy="82" r="16" />
            <text x={x} y="87" textAnchor="middle" fill="#344b5c" stroke="none" fontSize="14">
              {String.fromCharCode(65 + index)}
            </text>
          </g>
        ))}
        {[115, 350, 548].map((y, index) => (
          <g key={`grid-y-${y}`}>
            <circle cx="88" cy={y} r="16" />
            <text x="88" y={y + 5} textAnchor="middle" fill="#344b5c" stroke="none" fontSize="14">
              {index + 1}
            </text>
          </g>
        ))}
      </g>
      <g transform="translate(746 574)">
        <rect width="196" height="66" fill="#fff" stroke="#42596a" strokeWidth="1.5" />
        <path d="M0 28h196M70 28v38M142 28v38" stroke="#647887" />
        <text x="8" y="19" fill="#263e50" fontSize="13" fontWeight="700">MẶT BẰNG TẦNG 01</text>
        <text x="8" y="47" fill="#536979" fontSize="9">TỶ LỆ</text>
        <text x="8" y="60" fill="#263e50" fontSize="11">1:100</text>
        <text x="78" y="47" fill="#536979" fontSize="9">BẢN VẼ</text>
        <text x="78" y="60" fill="#263e50" fontSize="11">A-101</text>
        <text x="150" y="47" fill="#536979" fontSize="9">REV</text>
        <text x="150" y="60" fill="#263e50" fontSize="11">P03</text>
      </g>
    </svg>
  );
}

function MarkupShape({
  markup,
  selected,
  onSelect,
}: {
  markup: Markup;
  selected: boolean;
  onSelect: () => void;
}) {
  const style = {
    left: `${markup.x}%`,
    top: `${markup.y}%`,
    "--markup-color": markup.color,
  } as React.CSSProperties;
  const className = `review-markup-shape ${markup.tool}${selected ? " selected" : ""}`;

  if (["line", "arrow", "length", "arc", "angle"].includes(markup.tool)) {
    return (
      <button type="button" className={className} style={style}
        aria-label={`${markup.id}: ${markup.label}`} onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}>
        <svg viewBox="0 0 120 42" aria-hidden="true">
          {markup.tool === "arc" ? (
            <path d="M8 35 Q58 -10 112 35" />
          ) : markup.tool === "angle" ? (
            <path d="M12 34H62L96 8 M50 34A24 24 0 0 1 67 18" />
          ) : (
            <path d="M8 32L108 10 M95 6L108 10L100 21" />
          )}
        </svg>
        {markup.value && <span>{markup.value}</span>}
      </button>
    );
  }

  if (["area", "perimeter", "volume", "fill", "polygon"].includes(markup.tool)) {
    return (
      <button type="button" className={className} style={style}
        aria-label={`${markup.id}: ${markup.label}`} onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}>
        <svg viewBox="0 0 110 78" aria-hidden="true">
          <path d="M12 60L30 12L92 22L101 65L48 72Z" />
        </svg>
        {markup.value && <span>{markup.value}</span>}
      </button>
    );
  }

  return (
    <button type="button" className={className} style={style}
      aria-label={`${markup.id}: ${markup.label}`} onClick={(event) => {
      event.stopPropagation();
      onSelect();
    }}>
      {markup.tool === "cloud" && <span className="review-cloud-ring" />}
      {markup.tool === "highlight" && <span className="review-highlight-block" />}
      {markup.tool === "count" && <strong>1</strong>}
      {markup.tool === "media" && <strong>▶ Ảnh / video</strong>}
      {markup.tool === "link" && <strong>↗ A-201</strong>}
      {!["cloud", "highlight", "count", "media", "link"].includes(markup.tool) && (
        <strong>{markup.tool === "stamp" ? "FOR REVIEW" : markup.label}</strong>
      )}
      {markup.value && <small>{markup.value}</small>}
    </button>
  );
}

function ActionCard({
  action,
  tone,
  onClick,
}: {
  action: WorkspaceAction;
  tone: "automation" | "ai";
  onClick: () => void;
}) {
  return (
    <button type="button" className={`review-action-card ${tone}`} onClick={onClick}>
      <span className="review-action-icon">{tone === "ai" ? "✦" : "⚡"}</span>
      <span>
        <strong>{action.title}</strong>
        <small>{action.description}</small>
      </span>
      <em>{action.connector ? "Cần kết nối" : "Sẵn sàng cấu hình"} →</em>
    </button>
  );
}

export default function DocumentReviewPanel({
  open,
  daemon,
  initialView = "documents",
  initialCadTarget = "",
  onClose,
  onOpenAutoCAD,
}: DocumentReviewPanelProps) {
  const [view, setView] = useState<ReviewWorkspaceView>(initialView);
  const [documents, setDocuments] = useState<ReviewDocument[]>(SAMPLE_DOCUMENTS);
  const [activeDocumentId, setActiveDocumentId] = useState("a101");
  const [documentQuery, setDocumentQuery] = useState("");
  const [markups, setMarkups] = useState<Markup[]>(INITIAL_MARKUPS);
  const [activeTool, setActiveTool] = useState("select");
  const [selectedMarkupId, setSelectedMarkupId] = useState("M-103");
  const [statusFilter, setStatusFilter] = useState<"Tất cả" | MarkupStatus>("Tất cả");
  const [markupQuery, setMarkupQuery] = useState("");
  const [notice, setNotice] = useState<Notice | null>(null);
  const [pendingAction, setPendingAction] = useState<WorkspaceAction | null>(null);
  const [jobs, setJobs] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState(86);
  const [bookmarked, setBookmarked] = useState(true);
  const [layersOpen, setLayersOpen] = useState(false);
  const [multiView, setMultiView] = useState<1 | 2 | 4 | 16>(1);
  const [thumbnailsOpen, setThumbnailsOpen] = useState(false);
  const [compareMode, setCompareMode] = useState<"side" | "overlay">("overlay");
  const [overlay, setOverlay] = useState(54);
  const [scale, setScale] = useState("1:100");
  const [cadUnit, setCadUnit] = useState("mm");
  const [depth, setDepth] = useState("3");
  const [detailsOpen, setDetailsOpen] = useState(true);
  const uploadRef = useRef<HTMLInputElement>(null);
  const workspaceRef = useRef<HTMLElement>(null);
  const actionDialogRef = useRef<HTMLDivElement>(null);
  const actionOpenRef = useRef(false);
  const objectUrlsRef = useRef<string[]>([]);
  actionOpenRef.current = pendingAction !== null;

  useEffect(() => {
    if (!open) return;
    setView(initialView);
    setDetailsOpen(window.innerWidth >= 980);
  }, [open, initialView]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (pendingAction) setPendingAction(null);
        else onClose();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, onClose, pendingAction]);

  useEffect(() => {
    if (!open) return;
    const workspace = workspaceRef.current;
    if (!workspace) return;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    workspace.focus();
    const focusable = () => Array.from(workspace.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]",
    )).filter((element) => element.offsetParent !== null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || actionOpenRef.current) return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open || !initialCadTarget) return;
    const controller = new AbortController();
    const loadCadUnits = async () => {
      try {
        const response = await fetch(
          `${daemon.replace(/\/+$/, "")}/api/acad/drawing-info?target=${encodeURIComponent(initialCadTarget)}`,
          { signal: controller.signal, cache: "no-store" },
        );
        const body = await response.json() as {
          drawing?: { settings?: Record<string, unknown> };
        };
        const rawInsunits = body.drawing?.settings?.INSUNITS ?? body.drawing?.settings?.insunits;
        const unitByInsunits: Record<number, string> = {
          1: "in", 2: "ft", 4: "mm", 5: "cm", 6: "m",
        };
        const mapped = unitByInsunits[Number(rawInsunits)];
        if (mapped) setCadUnit(mapped);
      } catch {
        // Workspace vẫn dùng mm mặc định khi AutoCAD/plugin không sẵn sàng.
      }
    };
    void loadCadUnits();
    return () => controller.abort();
  }, [open, daemon, initialCadTarget]);

  useEffect(() => {
    if (!pendingAction) return;
    const dialog = actionDialogRef.current;
    if (!dialog) return;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(
      "button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [href]",
    ));
    focusable()[0]?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus();
    };
  }, [pendingAction]);

  useEffect(() => () => {
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const activeDocument =
    documents.find((document) => document.id === activeDocumentId) || documents[0];
  const selectedMarkup = markups.find((markup) => markup.id === selectedMarkupId);
  const filteredDocuments = useMemo(() => {
    const query = documentQuery.trim().toLocaleLowerCase("vi");
    return documents.filter((document) =>
      !query ||
      document.name.toLocaleLowerCase("vi").includes(query) ||
      document.discipline.toLocaleLowerCase("vi").includes(query));
  }, [documents, documentQuery]);
  const filteredMarkups = useMemo(() => {
    const query = markupQuery.trim().toLocaleLowerCase("vi");
    return markups.filter((markup) =>
      (statusFilter === "Tất cả" || markup.status === statusFilter) &&
      (!query ||
        markup.label.toLocaleLowerCase("vi").includes(query) ||
        markup.id.toLocaleLowerCase("vi").includes(query) ||
        markup.author.toLocaleLowerCase("vi").includes(query)));
  }, [markups, markupQuery, statusFilter]);
  const quantityMarkups = markups.filter((markup) => markup.value);
  const totalArea = quantityMarkups
    .filter((markup) => markup.tool === "area" || markup.tool === "fill")
    .reduce((total, markup) => total + measurementNumber(markup.value), 0);
  const totalLength = quantityMarkups
    .filter((markup) => markup.tool === "length" || markup.tool === "arc")
    .reduce((total, markup) => total + measurementNumber(markup.value), 0);

  if (!open) return null;

  function showNotice(text: string, tone: Notice["tone"] = "info") {
    setNotice({ text, tone });
  }

  function handleUpload(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    const incoming = files.map((file, index): ReviewDocument => {
      const url = URL.createObjectURL(file);
      objectUrlsRef.current.push(url);
      return {
        id: `upload-${Date.now()}-${index}`,
        name: file.name,
        discipline: file.name.toLocaleLowerCase("vi").endsWith(".pdf")
          ? "Tài liệu PDF"
          : "Chờ chuyển đổi",
        revision: "Mới",
        pages: 1,
        size: fileSize(file.size),
        status: "review",
        source: "upload",
        url,
      };
    });
    setDocuments((current) => [...incoming, ...current]);
    setActiveDocumentId(incoming[0].id);
    setPage(1);
    showNotice(`Đã thêm ${incoming.length} tài liệu vào workspace.`, "ok");
    event.target.value = "";
  }

  function pickTool(tool: ToolItem) {
    setActiveTool(tool.id);
    if (tool.id === "select") {
      showNotice("Chế độ chọn markup.");
    } else {
      showNotice(`Đã chọn ${tool.label}. Bấm lên bản vẽ để đặt.`);
    }
  }

  function addMarkup(event: ReactMouseEvent<HTMLDivElement>) {
    if (!["markup", "measure"].includes(view) || activeTool === "select") return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = Math.max(6, Math.min(88, ((event.clientX - bounds.left) / bounds.width) * 100));
    const y = Math.max(6, Math.min(88, ((event.clientY - bounds.top) / bounds.height) * 100));
    const isMeasure = MEASURE_VALUES[activeTool] !== undefined;
    const id = `${isMeasure ? "Q" : "M"}-${String(markups.length + 105).padStart(3, "0")}`;
    const markup: Markup = {
      id,
      tool: activeTool,
      label: TOOL_LABELS[activeTool] || "Markup mới",
      author: "Bạn",
      createdAt: "Vừa xong",
      status: "Mở",
      page,
      x,
      y,
      color: isMeasure ? "#3182ce" : activeTool === "stamp" ? "#20a66a" : "#f09b2e",
      value: MEASURE_VALUES[activeTool],
      zone: "Chưa phân loại",
      trade: isMeasure ? "Khối lượng" : "Review",
    };
    setMarkups((current) => [markup, ...current]);
    setSelectedMarkupId(id);
    setActiveTool("select");
    showNotice(`${markup.label}${markup.value ? ` · ${markup.value}` : ""} đã được thêm.`, "ok");
  }

  function updateMarkupStatus(status: MarkupStatus) {
    if (!selectedMarkupId) return;
    setMarkups((current) =>
      current.map((markup) => markup.id === selectedMarkupId ? { ...markup, status } : markup));
    showNotice(`Đã cập nhật trạng thái thành “${status}”.`, "ok");
  }

  function deleteSelectedMarkup() {
    if (!selectedMarkupId) return;
    setMarkups((current) => current.filter((markup) => markup.id !== selectedMarkupId));
    setSelectedMarkupId("");
    showNotice("Đã xóa markup khỏi phiên làm việc.", "warn");
  }

  function exportMarkups() {
    downloadCsv("markups-list.csv", [
      ["ID", "Nội dung", "Tác giả", "Ngày", "Trạng thái", "Trang", "Khu vực", "Hạng mục", "Giá trị"],
      ...filteredMarkups.map((markup) => [
        markup.id,
        markup.label,
        markup.author,
        markup.createdAt,
        markup.status,
        markup.page,
        markup.zone,
        markup.trade,
        markup.value || "",
      ]),
    ]);
    showNotice(`Đã xuất ${filteredMarkups.length} markup ra CSV.`, "ok");
  }

  function exportQuantities() {
    downloadCsv("quantity-link.csv", [
      ["Markup ID", "Hạng mục", "Khu vực", "Giá trị", "Trạng thái", "Nguồn"],
      ...quantityMarkups.map((markup) => [
        markup.id,
        markup.label,
        markup.zone,
        markup.value || "",
        markup.status,
        activeDocument?.name || "",
      ]),
    ]);
    showNotice("Đã xuất bảng khối lượng tương thích Excel. Đồng bộ hai chiều cần Excel connector.", "ok");
  }

  function queueAction(action: WorkspaceAction) {
    setJobs((current) => [action.title, ...current.filter((job) => job !== action.title)].slice(0, 4));
    setPendingAction(null);
    showNotice(
      action.connector
        ? `${action.title} đã được cấu hình; cần kết nối ${action.connector} trước khi chạy.`
        : `${action.title} đã được thêm vào hàng đợi workflow.`,
      action.connector ? "warn" : "ok",
    );
  }

  const activeTools = view === "measure" ? MEASURE_TOOLS : MARKUP_TOOLS;

  return (
    <div className="review-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section ref={workspaceRef} className="review-panel" role="dialog" aria-modal="true"
        aria-labelledby="review-workspace-title" tabIndex={-1}>
        <header className="review-head">
          <div className="review-identity">
            <div className="review-mark">R</div>
            <div>
              <span>AEC DOCUMENT CONTROL</span>
              <h2 id="review-workspace-title">PDF & Review Workspace</h2>
              <p>Quản lý hồ sơ · Markup bản vẽ · Đo bóc khối lượng</p>
            </div>
          </div>
          <div className="review-head-status">
            <div className="review-presence" title="Phiên cộng tác cục bộ; chưa kết nối collaboration server">
              <span>MA</span><span>QB</span><span>LC</span><b>3</b>
            </div>
            <button type="button" className="review-session" onClick={() =>
              showNotice("Cộng tác realtime cần collaboration server, tài khoản và quyền project; phiên hiện tại đang ở chế độ cục bộ.", "warn")}>
              <i /> Phiên cục bộ
            </button>
            <button type="button" onClick={() => {
              if (initialCadTarget) {
                showNotice(`Đã map workspace với ${initialCadTarget.split("/").pop()}.`, "ok");
              } else if (onOpenAutoCAD) {
                onOpenAutoCAD();
                showNotice("Đang mở AutoCAD để thiết lập nguồn bản vẽ.", "info");
              }
            }}>
              <span className="review-cad-logo">A</span>
              {initialCadTarget ? "Đã map AutoCAD" : "Kết nối AutoCAD"}
            </button>
            <button type="button" className="review-head-close" onClick={onClose} aria-label="Đóng">×</button>
          </div>
        </header>

        <nav className="review-tabs" aria-label="Nhóm chức năng PDF và review">
          {VIEW_TABS.map((tab) => (
            <button key={tab.id} type="button" className={view === tab.id ? "active" : ""}
              onClick={() => {
                setView(tab.id);
                setActiveTool("select");
              }}>
              <span>{tab.icon}</span>{tab.label}
              {tab.id === "markup" && <small>{markups.length}</small>}
              {tab.id === "ai" && <em>MAX</em>}
            </button>
          ))}
          <div className="review-tabs-spacer" />
          <button type="button" className="review-view-control" onClick={() =>
            setMultiView((current) => current === 1 ? 2 : current === 2 ? 4 : current === 4 ? 16 : 1)}
            title="MultiView — chia đồng bộ tối đa 16 ô">
            ◫ {multiView === 1 ? "Một trang" : `${multiView} ô`}
          </button>
          <button type="button" className={layersOpen ? "review-view-control active" : "review-view-control"}
            onClick={() => setLayersOpen((current) => !current)}>☷ Layers</button>
          <button type="button" className="review-mobile-markups"
            onClick={() => setDetailsOpen(true)}>✎ Markups</button>
        </nav>

        <div className={`review-body${detailsOpen ? "" : " inspector-collapsed"}`}>
          <aside className="review-documents">
            <div className="review-project">
              <span>DỰ ÁN</span>
              <strong>Hồ sơ kỹ thuật AEC</strong>
              <small>4 bộ môn · 45 trang</small>
            </div>
            <label className="review-search">
              <span>⌕</span>
              <input value={documentQuery} onChange={(event) => setDocumentQuery(event.target.value)}
                placeholder="Tìm tài liệu, bộ môn…" />
            </label>
            <div className="review-doc-head">
              <span>Tài liệu</span>
              <button type="button" onClick={() => uploadRef.current?.click()}>＋</button>
            </div>
            <div className="review-doc-list">
              {filteredDocuments.map((document) => (
                <button key={document.id} type="button"
                  className={document.id === activeDocumentId ? "review-doc active" : "review-doc"}
                  onClick={() => {
                    setActiveDocumentId(document.id);
                    setPage(1);
                  }}>
                  <span className={`review-file-icon ${document.source}`}>PDF</span>
                  <span className="review-doc-copy">
                    <strong>{document.name}</strong>
                    <small>{document.discipline} · {documentPageLabel(document)} · {document.size}</small>
                    <em className={document.status}>{documentStatusLabel(document.status)}</em>
                  </span>
                  <b>{document.revision}</b>
                </button>
              ))}
            </div>
            <button type="button" className="review-upload" onClick={() => uploadRef.current?.click()}>
              <span>＋</span>
              <strong>Thêm tài liệu</strong>
              <small>PDF, DWG, DXF, Revit, Office</small>
            </button>
              <input ref={uploadRef} className="review-hidden-input" type="file" multiple
              accept=".pdf,.dwg,.dxf,.rvt,.doc,.docx,.xls,.xlsx,image/*" onChange={handleUpload} />
            <div className="review-integrations">
              <span>TÍCH HỢP</span>
              <button type="button" onClick={exportQuantities}>
                <i className="excel">X</i><b>Microsoft Excel</b><em>CSV sẵn sàng</em>
              </button>
              <button type="button" onClick={() => {
                if (initialCadTarget) showNotice(`AutoCAD đang map: ${initialCadTarget}`, "ok");
                else showNotice("Chưa có bản vẽ AutoCAD đích.", "warn");
              }}>
                <i className="autocad">A</i><b>AutoCAD</b><em>{initialCadTarget ? "Đã map" : "Chưa kết nối"}</em>
              </button>
            </div>
          </aside>

          <main className="review-workspace">
            {view === "documents" && (
              <div className="review-context-toolbar document-actions">
                {DOCUMENT_ACTIONS.map((action) => (
                  <button key={action.title} type="button" onClick={() => setPendingAction(action)}>
                    <span>{
                      action.title === "Tạo PDF" ? "＋" :
                      action.title === "Sắp xếp trang" ? "▦" :
                      action.title === "Hợp nhất PDF" ? "⊞" :
                      action.title === "Tách tài liệu" ? "⊟" :
                      action.title.startsWith("OCR") ? "⌕" : "◇"
                    }</span>
                    <small>{action.title}</small>
                  </button>
                ))}
                <div className="review-toolbar-divider" />
                <button type="button" onClick={() => setThumbnailsOpen((current) => !current)}
                  className={thumbnailsOpen ? "active" : ""}><span>▦</span><small>Thumbnails</small></button>
                <button type="button" onClick={() => setBookmarked((current) => !current)}
                  className={bookmarked ? "active" : ""}><span>◆</span><small>Bookmarks</small></button>
                <button type="button" onClick={() => setLayersOpen((current) => !current)}
                  className={layersOpen ? "active" : ""}><span>☷</span><small>Layers</small></button>
              </div>
            )}

            {(view === "markup" || view === "measure") && (
              <div className="review-context-toolbar tool-actions">
                <div className="review-tool-chest">
                  <span>{view === "measure" ? "MEASUREMENT" : "TOOL CHEST"}</span>
                  <strong>{view === "measure" ? "Bóc khối lượng AEC" : "Review tiêu chuẩn"}</strong>
                </div>
                <div className="review-toolbar-divider" />
                <div className="review-tool-scroll">
                  {activeTools.map((tool) => (
                    <button key={tool.id} type="button" className={activeTool === tool.id ? "active" : ""}
                      title={tool.label} onClick={() => pickTool(tool)}>
                      <span>{tool.icon}</span><small>{tool.label}</small>
                    </button>
                  ))}
                </div>
                {view === "measure" && (
                  <>
                    <div className="review-toolbar-divider" />
                    <button type="button" className="review-quantity-link" onClick={exportQuantities}>
                      <span>X</span><small>Quantity Link</small>
                    </button>
                    <button type="button" onClick={() => setPendingAction({
                      title: "Batch Measurements",
                      description: "Áp dụng bộ công cụ đo cho nhiều trang hoặc nhiều tài liệu.",
                      steps: ["Chọn phạm vi", "Chọn Tool Chest", "Kiểm tra tỉ lệ", "Chạy hàng loạt"],
                    })}><span>▦</span><small>Batch</small></button>
                  </>
                )}
              </div>
            )}

            {view === "compare" && (
              <div className="review-context-toolbar compare-tools">
                <button type="button" className={compareMode === "side" ? "active" : ""}
                  onClick={() => setCompareMode("side")}><span>◫</span><small>Side-by-side</small></button>
                <button type="button" className={compareMode === "overlay" ? "active" : ""}
                  onClick={() => setCompareMode("overlay")}><span>◉</span><small>Overlay</small></button>
                <div className="review-toolbar-divider" />
                <label>Revision gốc <select defaultValue="P02"><option>P02</option><option>P01</option></select></label>
                <span>→</span>
                <label>Revision mới <select defaultValue="P03"><option>P03</option><option>P02</option></select></label>
                <button type="button" onClick={() => setPendingAction(AUTOMATIONS[3])}
                  className="review-primary-action">So sánh bản vẽ</button>
              </div>
            )}

            {view === "automate" && (
              <div className="review-board">
                <div className="review-board-head">
                  <div><span>WORKFLOW AUTOMATION</span><h3>Tự động hóa hồ sơ phát hành</h3>
                    <p>Cấu hình batch job, kiểm tra trước khi chạy và lưu nhật ký theo tài liệu.</p></div>
                  <b>{jobs.length} tác vụ trong hàng đợi</b>
                </div>
                <div className="review-action-grid">
                  {AUTOMATIONS.map((action) => (
                    <ActionCard key={action.title} action={action} tone="automation"
                      onClick={() => setPendingAction(action)} />
                  ))}
                </div>
              </div>
            )}

            {view === "ai" && (
              <div className="review-board ai">
                <div className="review-board-head">
                  <div><span>BLUEBEAM MAX · AI LAYER</span><h3>Trợ lý review bản vẽ</h3>
                    <p>AI chỉ đề xuất; kỹ sư duyệt phát hiện trước khi tạo markup hoặc thay đổi hồ sơ.</p></div>
                  <b className="max">MAX</b>
                </div>
                <div className="review-ai-summary">
                  <div><span>12</span><small>Phát hiện cần xem</small></div>
                  <div><span>3</span><small>Xung đột ưu tiên cao</small></div>
                  <div><span>87%</span><small>Độ phủ bản vẽ</small></div>
                  <button type="button" onClick={() => setPendingAction(AI_FEATURES[0])}>✦ Chạy AI Review</button>
                </div>
                <div className="review-action-grid">
                  {AI_FEATURES.map((action) => (
                    <ActionCard key={action.title} action={action} tone="ai"
                      onClick={() => setPendingAction(action)} />
                  ))}
                </div>
              </div>
            )}

            {!["automate", "ai"].includes(view) && (
                <div className={`review-canvas-area ${compareMode === "side" && view === "compare" ? "side" : ""}`}>
                {thumbnailsOpen && (
                  <div className="review-thumbnails">
                    <div><strong>Thumbnails</strong><button type="button" onClick={() => setThumbnailsOpen(false)}>×</button></div>
                    {Array.from({ length: Math.min(activeDocument?.pages || 1, 8) }).map((_, index) => (
                      <button key={`thumb-${index + 1}`} type="button"
                        className={page === index + 1 ? "active" : ""}
                        onClick={() => setPage(index + 1)}>
                        <span><TechnicalSheet /></span><small>Trang {index + 1}</small>
                      </button>
                    ))}
                  </div>
                )}
                {view === "measure" && (
                  <div className="review-scale-bar">
                    <span>Đơn vị AutoCAD</span>
                    <select value={cadUnit} onChange={(event) => setCadUnit(event.target.value)}>
                      <option value="mm">mm · INSUNITS 4</option>
                      <option value="cm">cm · INSUNITS 5</option>
                      <option value="m">m · INSUNITS 6</option>
                      <option value="in">inch · INSUNITS 1</option>
                      <option value="ft">feet · INSUNITS 2</option>
                    </select>
                    <span>Tỉ lệ bản vẽ</span>
                    <select value={scale} onChange={(event) => setScale(event.target.value)}>
                      <option>1:50</option><option>1:100</option><option>1:200</option><option>Tự hiệu chỉnh</option>
                    </select>
                    <span>Chiều sâu</span>
                    <label><input value={depth} onChange={(event) => setDepth(event.target.value)} /> m</label>
                    <em>PDF m ↔ DWG {cadUnit} · {scale}</em>
                  </div>
                )}

                <div className="review-canvas-scroll">
                  <div className={`review-sheet-grid views-${
                    view === "compare" && compareMode === "side" ? 2 : multiView
                  }`}>
                    {Array.from({
                      length: view === "compare" && compareMode === "side" ? 2 : multiView,
                    }).map((_, index) => (
                      <div key={`sheet-${index}`} className="review-sheet-wrap"
                        style={{ "--review-zoom": `${zoom / 100}` } as React.CSSProperties}>
                        {view === "compare" && compareMode === "side" && (
                          <span className="review-revision-label">{index === 0 ? "REV P02" : "REV P03"}</span>
                        )}
                        <div className={`review-sheet ${view === "compare" ? `compare-${compareMode}` : ""}`}
                          onClick={addMarkup}>
                          {activeDocument?.url ? (
                            <object data={activeDocument.url} type="application/pdf" aria-label={activeDocument.name}>
                              <TechnicalSheet />
                            </object>
                          ) : (
                            <TechnicalSheet />
                          )}
                          {view === "compare" && (
                            <div className="review-compare-layer"
                              style={{ opacity: compareMode === "overlay" ? overlay / 100 : 0.55 }}>
                              <span className="change one" /><span className="change two" />
                              <span className="change three" /><b>3 thay đổi</b>
                            </div>
                          )}
                          {index === 0 && markups.filter((markup) => markup.page === page).map((markup) => (
                            <MarkupShape key={markup.id} markup={markup}
                              selected={selectedMarkupId === markup.id}
                              onSelect={() => {
                                setSelectedMarkupId(markup.id);
                                setDetailsOpen(true);
                              }} />
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {view === "compare" && compareMode === "overlay" && (
                  <label className="review-overlay-slider">
                    <span>P02</span>
                    <input type="range" min="0" max="100" value={overlay}
                      onChange={(event) => setOverlay(Number(event.target.value))} />
                    <span>P03</span><b>{overlay}%</b>
                  </label>
                )}

                <div className="review-canvas-status">
                  <span>Trang {page} / {activeDocument?.pages || 1}</span>
                  <button type="button" onClick={() => setPage((current) => Math.max(1, current - 1))}>‹</button>
                  <button type="button" onClick={() =>
                    setPage((current) => Math.min(activeDocument?.pages || 1, current + 1))}>›</button>
                  <i />
                  <button type="button" className={bookmarked ? "active" : ""}
                    onClick={() => setBookmarked((current) => !current)}>◆ Bookmark</button>
                  <i />
                  <button type="button" onClick={() => setZoom((current) => Math.max(35, current - 10))}>−</button>
                  <b>{zoom}%</b>
                  <button type="button" onClick={() => setZoom((current) => Math.min(160, current + 10))}>＋</button>
                  <button type="button" onClick={() => setZoom(86)}>Vừa trang</button>
                </div>
              </div>
            )}
          </main>

          <aside className={`review-inspector ${detailsOpen ? "" : "collapsed"}`}>
            <div className="review-inspector-head">
              <div><span>MARKUPS LIST</span><strong>{filteredMarkups.length} / {markups.length}</strong></div>
              <button type="button" onClick={() => setDetailsOpen((current) => !current)}>
                {detailsOpen ? "›" : "‹"}
              </button>
            </div>
            {detailsOpen && (
              <>
                <div className="review-markup-filters">
                  <label><span>⌕</span><input value={markupQuery}
                    onChange={(event) => setMarkupQuery(event.target.value)} placeholder="Tìm markup…" /></label>
                  <select value={statusFilter} onChange={(event) =>
                    setStatusFilter(event.target.value as "Tất cả" | MarkupStatus)}>
                    <option>Tất cả</option><option>Mở</option><option>Đang xử lý</option><option>Đã duyệt</option>
                  </select>
                  <button type="button" onClick={exportMarkups}>⇩ Xuất</button>
                </div>
                <div className="review-custom-columns">
                  <span>Cột: Tác giả · Trạng thái · Khu vực · Hạng mục</span>
                  <button type="button" onClick={() => showNotice(
                    "Custom Columns đang dùng: Khu vực và Hạng mục. Có thể mở rộng khi lưu vào project database.",
                  )}>⚙</button>
                </div>
                <div className="review-markup-list">
                  {filteredMarkups.map((markup) => (
                    <button key={markup.id} type="button"
                      className={selectedMarkupId === markup.id ? "active" : ""}
                      onClick={() => setSelectedMarkupId(markup.id)}>
                      <i style={{ background: markup.color }}>{markup.tool === "stamp" ? "✓" :
                        markup.value ? "⌁" : markup.tool === "cloud" ? "☁" : "✎"}</i>
                      <span><strong>{markup.label}</strong>
                        <small>{markup.id} · Trang {markup.page} · {markup.author}</small>
                        <em>{markup.zone}</em>
                      </span>
                      <b className={markup.status === "Đã duyệt" ? "approved" :
                        markup.status === "Đang xử lý" ? "progress" : "open"}>{markup.status}</b>
                    </button>
                  ))}
                </div>
                {selectedMarkup && (
                  <div className="review-properties">
                    <div><span>THUỘC TÍNH MARKUP</span><b>{selectedMarkup.id}</b></div>
                    <label>Nội dung<input value={selectedMarkup.label} onChange={(event) => {
                      const label = event.target.value;
                      setMarkups((current) => current.map((markup) =>
                        markup.id === selectedMarkup.id ? { ...markup, label } : markup));
                    }} /></label>
                    <div className="review-property-grid">
                      <label>Tác giả<input value={selectedMarkup.author} readOnly /></label>
                      <label>Trạng thái<select value={selectedMarkup.status}
                        onChange={(event) => updateMarkupStatus(event.target.value as MarkupStatus)}>
                        <option>Mở</option><option>Đang xử lý</option><option>Đã duyệt</option>
                      </select></label>
                      <label>Khu vực<input value={selectedMarkup.zone} onChange={(event) => {
                        const zone = event.target.value;
                        setMarkups((current) => current.map((markup) =>
                          markup.id === selectedMarkup.id ? { ...markup, zone } : markup));
                      }} /></label>
                      <label>Hạng mục<input value={selectedMarkup.trade} onChange={(event) => {
                        const trade = event.target.value;
                        setMarkups((current) => current.map((markup) =>
                          markup.id === selectedMarkup.id ? { ...markup, trade } : markup));
                      }} /></label>
                    </div>
                    <small>Tạo: {selectedMarkup.createdAt} · Trang {selectedMarkup.page}</small>
                    {selectedMarkup.value && <strong className="review-measure-value">{selectedMarkup.value}</strong>}
                    <button type="button" className="review-delete-markup" onClick={deleteSelectedMarkup}>Xóa markup</button>
                  </div>
                )}
                <div className="review-quantity-summary">
                  <div><span>QUANTITY LINK</span><b>{quantityMarkups.length} phép đo</b></div>
                  <p>Tổng diện tích <strong>{metricNumber(totalArea)} m²</strong></p>
                  <p>Tổng chiều dài <strong>{metricNumber(totalLength)} m</strong></p>
                  <button type="button" onClick={exportQuantities}><i>X</i> Xuất bảng cho Excel</button>
                  <small>Đồng bộ hai chiều cần Excel connector.</small>
                </div>
              </>
            )}
          </aside>
        </div>

        {layersOpen && (
          <div className="review-layers-popover">
            <div><strong>Layers</strong><button type="button" onClick={() => setLayersOpen(false)}>×</button></div>
            {[
              ["Kiến trúc", "#253d50", true],
              ["Kết cấu", "#586878", true],
              ["HVAC", "#2f86c7", true],
              ["Điện", "#cf5353", true],
              ["Markup", "#f09b2e", true],
              ["Đo lường", "#3182ce", true],
            ].map(([label, color, checked]) => (
              <label key={String(label)}><input type="checkbox" defaultChecked={Boolean(checked)} />
                <i style={{ background: String(color) }} />{label}</label>
            ))}
          </div>
        )}

        {notice && (
          <div className={`review-notice ${notice.tone}`} role="status">
            <span>{notice.tone === "ok" ? "✓" : notice.tone === "warn" ? "!" : "i"}</span>
            <p>{notice.text}</p>
            <button type="button" onClick={() => setNotice(null)}>×</button>
          </div>
        )}

        {pendingAction && (
          <div className="review-action-backdrop" onMouseDown={(event) => {
            if (event.target === event.currentTarget) setPendingAction(null);
          }}>
            <div ref={actionDialogRef} className="review-action-dialog" role="dialog" aria-modal="true"
              aria-labelledby="review-action-title" aria-describedby="review-action-description">
              <div className="review-action-dialog-icon">{pendingAction.connector ? "↗" : "⚡"}</div>
              <span>{pendingAction.connector ? "TÍCH HỢP NGHIỆP VỤ" : "WORKFLOW"}</span>
              <h3 id="review-action-title">{pendingAction.title}</h3>
              <p id="review-action-description">{pendingAction.description}</p>
              <ol>
                {pendingAction.steps.map((step, index) => (
                  <li key={step}><b>{index + 1}</b><span>{step}</span></li>
                ))}
              </ol>
              {pendingAction.connector && (
                <div className="review-connector-note">
                  <strong>Cần kết nối: {pendingAction.connector}</strong>
                  <small>Workspace chỉ lưu cấu hình; chưa gửi dữ liệu ra dịch vụ ngoài.</small>
                </div>
              )}
              <div className="review-action-dialog-actions">
                <button type="button" onClick={() => setPendingAction(null)}>Hủy</button>
                <button type="button" className="primary" onClick={() => queueAction(pendingAction)}>
                  {pendingAction.connector ? "Lưu cấu hình" : "Thêm vào hàng đợi"}
                </button>
              </div>
            </div>
          </div>
        )}

        <footer className="review-footer">
          <span><i className="ready" /> Workspace sẵn sàng</span>
          <span>Daemon: {daemon.replace(/^https?:\/\//, "")}</span>
          <span>{initialCadTarget ? `AutoCAD: ${initialCadTarget.split("/").pop()}` : "AutoCAD: chưa map"}</span>
          <i />
          <span>{jobs.length ? `${jobs.length} workflow đã cấu hình` : "Không có tác vụ đang chạy"}</span>
          <span>Đơn vị: DWG {cadUnit} ↔ PDF m</span>
        </footer>
      </section>
    </div>
  );
}

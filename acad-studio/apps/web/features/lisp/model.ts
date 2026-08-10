/** Mô hình thư viện AutoLISP, tách khỏi giao diện.
 *
 * Daemon trả về **mã**, không trả câu chữ: `reviewStatus`, `kind`,
 * `warnings[]`, `loadBlockReason`. Chỗ này là nơi duy nhất dịch chúng sang
 * tiếng người. Để mỗi màn hình tự dịch nghĩa là hai màn hình gọi cùng một
 * trạng thái bằng hai cái tên — trên một thư viện mà "đã duyệt" hay chưa quyết
 * định script có được nạp vào AutoCAD hay không.
 *
 * Mã lạ **không** bị nuốt: hàm dịch trả lại chính mã đó. Một nhãn xấu còn tra
 * được trong code; một ô trống thì không.
 */
import { asRecord, type JsonRecord } from "../../lib/daemon/client";

/** `approved` = manifest đã qua duyệt có chữ ký. `stale` = đã duyệt nhưng source
 * hoặc dependency đổi từ sau đó, nên bản duyệt cũ không còn nói về file này
 * nữa. `unreviewed` = chưa ai duyệt. */
export type LispReviewStatus = "approved" | "stale" | "unreviewed";

export type LispResource = {
  id: string;
  name: string;
  extension: string;
  kind: string;
  pathLabel: string;
  rootId: string;
  sizeBytes: number;
  modifiedAt: string;
  sourceHash: string;
  /** Đọc được source hay không. `.fas`/`.vlx` là mã đã biên dịch — không đọc
   * được, nên không phân tích được, nên không duyệt có cơ sở được. */
  readable: boolean;
  loadable: boolean;
  loadBlockReason: string | null;
  commands: string[];
  functions: string[];
  dependencies: string[];
  reviewStatus: LispReviewStatus;
  manifest: JsonRecord | null;
  /** Rỗng khi manifest chưa có hoặc chưa từng được duyệt. */
  review: LispReviewEvidence | null;
  warnings: string[];
};

/** Bằng chứng của lượt duyệt, lấy từ `manifest.review` — daemon ghi nó ở
 * `saveManifest()`. Đây là thứ biến "Đã duyệt" từ một cái nhãn thành một câu
 * kiểm chứng được: **ai** duyệt, **đọc được bao nhiêu** source lúc duyệt, và
 * duyệt trên **hash nào**. */
export type LispReviewEvidence = {
  /** `full-source` | `partial-source` | `metadata-only`, hoặc `manual-review`
   * khi bản duyệt cũ không ghi lại bằng chứng. */
  analysisCoverage: string;
  acknowledgedIncomplete: boolean;
  reviewedAt: string;
  reviewedBy: string;
  /** Hash của source **lúc duyệt**. Khác `sourceHash` hiện tại nghĩa là file đã
   * đổi từ sau đó. */
  approvedSourceHash: string;
};

export type LispRoot = {
  id: string;
  label: string;
  path: string;
};

export type LispCounts = {
  total: number;
  readable: number;
  loadable: number;
  reviewed: number;
  needsReview: number;
};

const REVIEW_LABELS: Record<LispReviewStatus, string> = {
  approved: "Đã duyệt",
  stale: "Bản duyệt đã cũ",
  unreviewed: "Chưa duyệt",
};

export function reviewLabel(status: LispReviewStatus | string): string {
  return REVIEW_LABELS[status as LispReviewStatus] || status;
}

const KIND_LABELS: Record<string, string> = {
  "autolisp-source": "AutoLISP (mã nguồn)",
  "menu-lisp": "Menu LISP",
  "compiled-autolisp": "AutoLISP đã biên dịch",
  "visual-lisp-application": "Visual LISP application",
  dialog: "Hộp thoại DCL",
  script: "Script AutoCAD",
  unknown: "Không nhận dạng được",
};

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] || kind;
}

/** Cảnh báo của daemon. Mỗi mã nói một điều khác nhau về mức tin cậy của bản
 * duyệt, nên không được gộp thành một câu chung chung. */
const WARNING_LABELS: Record<string, string> = {
  manifest_inferred_unreviewed:
    "Manifest do máy suy ra, chưa ai duyệt — mô tả có thể không đúng việc script làm.",
  compiled_source_not_readable:
    "Mã đã biên dịch, không đọc được source. Không phân tích được thì không duyệt có cơ sở được.",
  vlx_windows_only:
    "Định dạng .vlx chỉ chạy trên AutoCAD Windows; trên máy này không nạp được.",
  manifest_dependency_or_source_changed:
    "Source hoặc dependency đã đổi từ sau lần duyệt — phải phân tích và duyệt lại.",
  staged_support_paths_added_to_autocad_session:
    "Đã thêm support path vào phiên AutoCAD đang chạy.",
};

export function warningLabel(code: string): string {
  return WARNING_LABELS[code] || code;
}

/** Vì sao không nạp được. Khác `warnings`: đây là lý do **chặn**, không phải
 * lưu ý. */
const LOAD_BLOCK_LABELS: Record<string, string> = {
  vlx_windows_only: "Chỉ chạy trên AutoCAD Windows.",
  dcl_requires_load_dialog: "File DCL phải được script gọi bằng load_dialog, không nạp thẳng.",
  scr_catalog_only: "File .scr chỉ được liệt kê để tra cứu, app không chạy nó.",
  unsupported: "Đuôi file không được hỗ trợ.",
};

export function loadBlockLabel(reason: string): string {
  return LOAD_BLOCK_LABELS[reason] || reason;
}

/** Phạm vi source người duyệt thật sự đọc được. Đây là thứ quyết định một chữ
 * ký duyệt đáng tin tới đâu, nên không được giấu sau chữ "Đã duyệt". */
const COVERAGE_LABELS: Record<string, string> = {
  "full-source": "Đọc toàn bộ source",
  "partial-source": "Chỉ đọc được một phần source",
  "metadata-only": "Chỉ đọc metadata, không đọc source",
  "manual-review": "Bản duyệt cũ — không ghi lại phạm vi đã đọc",
};

export function coverageLabel(coverage: string): string {
  return COVERAGE_LABELS[coverage] || coverage;
}

/** Bản duyệt có dựa trên việc đọc hết source không. Mọi giá trị khác
 * `full-source` đều KHÔNG — kể cả `manual-review`, vì không ghi lại nghĩa là
 * không kiểm chứng được. */
export function coverageIsComplete(coverage: string): boolean {
  return coverage === "full-source";
}

const textValue = (value: unknown): string => (typeof value === "string" ? value : "");

const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

export function normalizeResource(value: unknown): LispResource | null {
  const source = asRecord(value);
  if (!source) return null;
  const id = textValue(source.id).trim();
  if (!id) return null;
  const status = source.reviewStatus;
  return {
    id,
    name: textValue(source.name) || id,
    extension: textValue(source.extension),
    kind: textValue(source.kind) || "unknown",
    pathLabel: textValue(source.pathLabel),
    rootId: textValue(source.rootId),
    sizeBytes: Number.isFinite(Number(source.sizeBytes)) ? Number(source.sizeBytes) : 0,
    modifiedAt: textValue(source.modifiedAt),
    sourceHash: textValue(source.sourceHash),
    readable: source.readable === true,
    loadable: source.loadable === true,
    loadBlockReason: textValue(source.loadBlockReason) || null,
    commands: stringList(source.commands),
    functions: stringList(source.functions),
    dependencies: stringList(source.dependencies),
    reviewStatus:
      status === "approved" || status === "stale" ? status : "unreviewed",
    manifest: asRecord(source.manifest),
    review: normalizeReview(asRecord(source.manifest)),
    warnings: stringList(source.warnings),
  };
}

function normalizeReview(manifest: JsonRecord | null): LispReviewEvidence | null {
  const review = asRecord(manifest?.review);
  if (!review || review.status !== "approved") return null;
  return {
    analysisCoverage: textValue(review.analysisCoverage) || "manual-review",
    acknowledgedIncomplete: review.acknowledgedIncompleteAnalysis === true,
    reviewedAt: textValue(review.reviewedAt),
    reviewedBy: textValue(review.reviewedBy),
    approvedSourceHash: textValue(review.approvedSourceHash),
  };
}

export function normalizeRoot(value: unknown): LispRoot | null {
  const source = asRecord(value);
  if (!source) return null;
  const id = textValue(source.id).trim();
  if (!id) return null;
  return {
    id,
    label: textValue(source.label) || textValue(source.name) || id,
    path: textValue(source.path),
  };
}

/** Khớp cả tên, đường dẫn, lệnh và hàm. Người dùng nhớ **tên lệnh** (`CTY-...`)
 * nhiều hơn nhớ tên file, nên bỏ `commands` ra khỏi phép tìm là bỏ đúng thứ họ
 * hay gõ nhất. */
export function resourceMatches(resource: LispResource, needle: string): boolean {
  if (!needle) return true;
  const hay = [
    resource.name,
    resource.pathLabel,
    ...resource.commands,
    ...resource.functions,
  ].join(" ").toLocaleLowerCase("vi");
  return hay.includes(needle);
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

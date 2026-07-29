import {
  closeSync,
  fstatSync,
  linkSync,
  lstatSync,
  openSync,
  readSync,
  renameSync,
  statSync,
  unlinkSync,
} from "node:fs";
import { basename, dirname, extname, isAbsolute, join } from "node:path";

export const PLOT_MIN_WAIT_MS = 500;
export const PLOT_MAX_WAIT_MS = 600_000;
export const PLOT_DEFAULT_TIMEOUT_MS = 120_000;
export const PLOT_DEFAULT_WAIT_MS = 15_000;

const PLOT_REQUEST_FIELDS = new Set([
  "target",
  "documentInstance",
  "path",
  "layout",
  "page_setup",
  "device",
  "media",
  "plot_type",
  "scale",
  "rotation",
  "centered",
  "style_sheet",
  "overwrite",
  "wait_ms",
  "timeout_ms",
]);

export type PlotPdfConfig =
  | { mode: "page_setup"; pageSetup: string }
  | { mode: "device_media"; device: string; media: string };

export type PlotPdfRequest = {
  target: string;
  documentInstance: string;
  outputPath: string;
  layout: string;
  config: PlotPdfConfig;
  plotType: "extents" | "layout";
  scale: "fit" | "1:1";
  rotation: 0 | 90 | 180 | 270;
  centered: boolean;
  styleSheet?: string;
  overwrite: boolean;
  waitMs: number;
  timeoutMs: number;
};

export class PlotPdfValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = "PlotPdfValidationError";
  }
}

export class PlotPdfFileError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status = 502,
  ) {
    super(message);
    this.name = "PlotPdfFileError";
  }
}

function requestObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new PlotPdfValidationError("invalid_request", "Body phải là một JSON object");
  }
  return value as Record<string, unknown>;
}

function requiredText(
  value: unknown,
  field: string,
  maxLength = 512,
): string {
  if (typeof value !== "string") {
    throw new PlotPdfValidationError("invalid_request", `${field} phải là chuỗi`);
  }
  const text = value.trim();
  if (!text) {
    throw new PlotPdfValidationError("invalid_request", `${field} không được để trống`);
  }
  if (text.length > maxLength || /[\0\t\r\n]/.test(text)) {
    throw new PlotPdfValidationError("invalid_request", `${field} không hợp lệ`);
  }
  return text;
}

function boundedMilliseconds(
  value: unknown,
  field: string,
  fallback: number,
): number {
  if (value === undefined) return fallback;
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < PLOT_MIN_WAIT_MS ||
    value > PLOT_MAX_WAIT_MS
  ) {
    throw new PlotPdfValidationError(
      "invalid_request",
      `${field} phải là số nguyên từ ${PLOT_MIN_WAIT_MS} đến ${PLOT_MAX_WAIT_MS}`,
    );
  }
  return value;
}

/** Validate and normalize the public POST /plot-pdf request. */
export function validatePlotPdfRequest(value: unknown): PlotPdfRequest {
  const body = requestObject(value);
  const unknownField = Object.keys(body).find(
    (field) => !PLOT_REQUEST_FIELDS.has(field),
  );
  if (unknownField) {
    throw new PlotPdfValidationError(
      "invalid_request",
      `Field không được hỗ trợ: ${unknownField}`,
    );
  }
  const target = requiredText(body.target, "target", 4096);
  if (!isAbsolute(target)) {
    throw new PlotPdfValidationError(
      "invalid_target",
      "target phải là đường dẫn tuyệt đối của bản vẽ đang mở",
    );
  }

  const documentInstance = requiredText(
    body.documentInstance,
    "documentInstance",
    256,
  );
  const outputPath = requiredText(body.path, "path", 4096);
  if (!isAbsolute(outputPath) || extname(outputPath).toLowerCase() !== ".pdf") {
    throw new PlotPdfValidationError(
      "invalid_output_path",
      "path phải là đường dẫn tuyệt đối kết thúc bằng .pdf",
    );
  }
  const layout = requiredText(body.layout, "layout");

  const hasPageSetup = body.page_setup !== undefined;
  const hasDevice = body.device !== undefined;
  const hasMedia = body.media !== undefined;
  if (hasPageSetup && (hasDevice || hasMedia)) {
    throw new PlotPdfValidationError(
      "invalid_plot_config",
      "Chỉ được dùng page_setup hoặc cặp device+media, không được trộn hai mode",
    );
  }
  const overrideFields = [
    "plot_type",
    "scale",
    "rotation",
    "centered",
    "style_sheet",
  ];
  if (
    hasPageSetup &&
    overrideFields.some((field) => body[field] !== undefined)
  ) {
    throw new PlotPdfValidationError(
      "invalid_plot_config",
      "Named page_setup đã chứa plot settings; không được truyền plot_type, scale, rotation, centered hoặc style_sheet",
    );
  }

  let config: PlotPdfConfig;
  if (hasPageSetup) {
    config = {
      mode: "page_setup",
      pageSetup: requiredText(body.page_setup, "page_setup"),
    };
  } else {
    if (!hasDevice || !hasMedia) {
      throw new PlotPdfValidationError(
        "invalid_plot_config",
        "Phải cung cấp đúng một mode: page_setup hoặc đầy đủ device+media",
      );
    }
    config = {
      mode: "device_media",
      device: requiredText(body.device, "device"),
      media: requiredText(body.media, "media"),
    };
  }

  const plotType = body.plot_type === undefined ? "extents" : body.plot_type;
  if (plotType !== "extents" && plotType !== "layout") {
    throw new PlotPdfValidationError(
      "invalid_request",
      "plot_type phải là extents hoặc layout",
    );
  }
  const scale = body.scale === undefined ? "fit" : body.scale;
  if (scale !== "fit" && scale !== "1:1") {
    throw new PlotPdfValidationError(
      "invalid_request",
      "scale phải là fit hoặc 1:1",
    );
  }
  if (!hasPageSetup && plotType === "layout" && scale !== "1:1") {
    throw new PlotPdfValidationError(
      "invalid_plot_config",
      'plot_type="layout" yêu cầu scale="1:1"',
    );
  }
  const rotation = body.rotation === undefined ? 0 : body.rotation;
  if (
    rotation !== 0 &&
    rotation !== 90 &&
    rotation !== 180 &&
    rotation !== 270
  ) {
    throw new PlotPdfValidationError(
      "invalid_request",
      "rotation phải là 0, 90, 180 hoặc 270",
    );
  }
  const centered = body.centered === undefined ? true : body.centered;
  if (typeof centered !== "boolean") {
    throw new PlotPdfValidationError("invalid_request", "centered phải là boolean");
  }
  const overwrite = body.overwrite === undefined ? false : body.overwrite;
  if (typeof overwrite !== "boolean") {
    throw new PlotPdfValidationError("invalid_request", "overwrite phải là boolean");
  }

  const timeoutMs = boundedMilliseconds(
    body.timeout_ms,
    "timeout_ms",
    PLOT_DEFAULT_TIMEOUT_MS,
  );
  const waitMs = boundedMilliseconds(
    body.wait_ms,
    "wait_ms",
    Math.min(PLOT_DEFAULT_WAIT_MS, timeoutMs),
  );

  return {
    target,
    documentInstance,
    outputPath,
    layout,
    config,
    plotType,
    scale,
    rotation,
    centered,
    styleSheet:
      body.style_sheet === undefined
        ? undefined
        : requiredText(body.style_sheet, "style_sheet"),
    overwrite,
    waitMs,
    timeoutMs,
  };
}

/** A collision-resistant sibling path that still ends in .pdf for the PDF driver. */
export function plotTempPath(outputPath: string, jobId: string): string {
  if (!/^[a-zA-Z0-9_-]{4,64}$/.test(jobId)) {
    throw new PlotPdfValidationError("invalid_job_id", "jobId plot không hợp lệ");
  }
  return join(
    dirname(outputPath),
    `.${basename(outputPath)}.${jobId}.tmp.pdf`,
  );
}

/** Map the public request to the exact TAB-protocol keys consumed by ui.plot. */
export function buildPlotRawParams(
  request: PlotPdfRequest,
  jobId: string,
  tempPath: string,
): Record<string, string | number | boolean> {
  return {
    job_id: jobId,
    document_instance: request.documentInstance,
    output_path: tempPath,
    layout: request.layout,
    ...(request.config.mode === "page_setup"
      ? { page_setup: request.config.pageSetup }
      : {
          device: request.config.device,
          media: request.config.media,
          plot_type: request.plotType,
          scale: request.scale,
          rotation: request.rotation,
          centered: request.centered,
          ...(request.styleSheet
            ? { style_sheet: request.styleSheet }
            : {}),
        }),
  };
}

/** Fail before invoking AutoCAD when publication cannot be performed safely. */
export function assertPlotDestination(
  outputPath: string,
  tempPath: string,
  overwrite: boolean,
): void {
  let parent;
  try {
    parent = statSync(dirname(outputPath));
  } catch {
    throw new PlotPdfValidationError(
      "output_parent_not_found",
      "Thư mục chứa PDF không tồn tại",
    );
  }
  if (!parent.isDirectory()) {
    throw new PlotPdfValidationError(
      "invalid_output_parent",
      "Thư mục chứa PDF không hợp lệ",
    );
  }

  let tempExists = false;
  try {
    lstatSync(tempPath);
    tempExists = true;
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";
    if (code !== "ENOENT") {
      throw new PlotPdfValidationError(
        "plot_temp_stat_failed",
        error instanceof Error
          ? error.message
          : "Không thể kiểm tra file tạm plot",
        409,
      );
    }
  }
  if (tempExists) {
    throw new PlotPdfValidationError(
      "plot_temp_exists",
      "File tạm của plot job đã tồn tại; từ chối ghi đè",
      409,
    );
  }

  let destination: ReturnType<typeof lstatSync>;
  try {
    destination = lstatSync(outputPath);
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";
    if (code === "ENOENT") return;
    throw new PlotPdfValidationError(
      "output_stat_failed",
      error instanceof Error
        ? error.message
        : "Không thể kiểm tra PDF đích",
      409,
    );
  }
  if (!overwrite) {
    throw new PlotPdfValidationError(
      "output_exists",
      "PDF đích đã tồn tại; đặt overwrite=true nếu muốn thay thế",
      409,
    );
  }
  if (!destination.isFile() || destination.isSymbolicLink()) {
    throw new PlotPdfValidationError(
      "invalid_output_target",
      "Chỉ được overwrite một regular file, không được thay symlink hoặc thư mục",
      409,
    );
  }
}

export type PdfVerification = {
  ok: true;
  sizeBytes: number;
};

/** Verify a regular PDF without loading the whole file into daemon memory. */
export function verifyPdfFile(path: string): PdfVerification {
  let fd: number | null = null;
  try {
    const entry = lstatSync(path);
    if (!entry.isFile() || entry.isSymbolicLink()) {
      throw new PlotPdfFileError(
        "plot_output_not_regular",
        "Plot output không phải regular file",
      );
    }
    fd = openSync(path, "r");
    const st = fstatSync(fd);
    if (!st.isFile() || st.size < 11) {
      throw new PlotPdfFileError(
        "plot_output_invalid_pdf",
        "Plot output quá nhỏ để là PDF hợp lệ",
      );
    }

    const header = Buffer.alloc(5);
    if (readSync(fd, header, 0, header.length, 0) !== header.length ||
        header.toString("ascii") !== "%PDF-") {
      throw new PlotPdfFileError(
        "plot_output_invalid_pdf",
        "Plot output thiếu PDF header",
      );
    }

    const tailSize = Math.min(st.size, 4096);
    const tail = Buffer.alloc(tailSize);
    readSync(fd, tail, 0, tailSize, st.size - tailSize);
    if (!/%%EOF[\x00\t\r\n ]*$/.test(tail.toString("latin1"))) {
      throw new PlotPdfFileError(
        "plot_output_invalid_pdf",
        "Plot output thiếu PDF EOF marker",
      );
    }
    return { ok: true, sizeBytes: st.size };
  } catch (error) {
    if (error instanceof PlotPdfFileError) throw error;
    throw new PlotPdfFileError(
      "plot_output_missing",
      error instanceof Error ? error.message : "Không đọc được plot output",
    );
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/**
 * Publish a verified sibling temp atomically.
 * No-overwrite uses link+unlink so an output created by a racing process wins.
 */
export function publishPlotPdf(
  tempPath: string,
  outputPath: string,
  overwrite: boolean,
): PdfVerification {
  verifyPdfFile(tempPath);
  try {
    if (overwrite) {
      renameSync(tempPath, outputPath);
    } else {
      linkSync(tempPath, outputPath);
      unlinkSync(tempPath);
    }
  } catch (error) {
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: unknown }).code ?? "")
        : "";
    if (!overwrite && code === "EEXIST") {
      throw new PlotPdfFileError(
        "output_exists",
        "PDF đích xuất hiện trong lúc plot; không ghi đè",
        409,
      );
    }
    throw new PlotPdfFileError(
      "plot_publish_failed",
      error instanceof Error ? error.message : "Không publish được PDF",
    );
  }
  return verifyPdfFile(outputPath);
}

export type DrawingInfoLayout = {
  name: string;
  model?: boolean;
};

/** Extract exact layout rows from the native drawing-info response. */
export function drawingInfoLayouts(snapshot: unknown): DrawingInfoLayout[] {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    return [];
  }
  const root = snapshot as Record<string, unknown>;
  const candidates = [
    (root.tables as Record<string, unknown> | undefined)?.layouts,
    (root.drawing as Record<string, unknown> | undefined)?.layouts,
  ];
  for (const candidate of candidates) {
    if (!Array.isArray(candidate)) continue;
    return candidate
      .map((layout): DrawingInfoLayout | undefined => {
        if (!layout || typeof layout !== "object" || Array.isArray(layout)) {
          return undefined;
        }
        const row = layout as Record<string, unknown>;
        if (typeof row.name !== "string") return undefined;
        return {
          name: row.name,
          ...(typeof row.model === "boolean" ? { model: row.model } : {}),
        };
      })
      .filter((layout): layout is DrawingInfoLayout => layout !== undefined);
  }
  return [];
}

/** Extract exact layout names from the native drawing-info response. */
export function drawingInfoLayoutNames(snapshot: unknown): string[] {
  return drawingInfoLayouts(snapshot).map((layout) => layout.name);
}

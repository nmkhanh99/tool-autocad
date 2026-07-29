import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MAX_SCREENSHOT_BYTES = 20 * 1024 * 1024;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FRAMEWORK_PYTHON =
  "/Library/Frameworks/Python.framework/Versions/Current/bin/python3";

const WINDOW_LIST_SCRIPT = String.raw`
import json
import Quartz

options = (
    Quartz.kCGWindowListOptionOnScreenOnly
    | Quartz.kCGWindowListExcludeDesktopElements
)
windows = []
for item in Quartz.CGWindowListCopyWindowInfo(options, Quartz.kCGNullWindowID):
    owner = str(item.get("kCGWindowOwnerName", ""))
    if not owner.lower().startswith("autocad"):
        continue
    bounds = item.get("kCGWindowBounds", {}) or {}
    windows.append({
        "id": int(item.get("kCGWindowNumber", 0)),
        "owner": owner,
        "title": str(item.get("kCGWindowName", "")),
        "layer": int(item.get("kCGWindowLayer", 0)),
        "alpha": float(item.get("kCGWindowAlpha", 1)),
        "x": int(bounds.get("X", 0)),
        "y": int(bounds.get("Y", 0)),
        "width": int(bounds.get("Width", 0)),
        "height": int(bounds.get("Height", 0)),
    })
print(json.dumps(windows))
`.trim();

export type AutoCADWindow = {
  id: number;
  owner: string;
  title: string;
  layer: number;
  alpha: number;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ScreenshotPayload = {
  mimeType: "image/png";
  data: string;
  sizeBytes: number;
  windowId: number;
  title: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  capturedAt: string;
};

export class ScreenshotError extends Error {
  readonly code: string;
  readonly hint?: string;

  constructor(code: string, message: string, hint?: string) {
    super(message);
    this.name = "ScreenshotError";
    this.code = code;
    this.hint = hint;
  }
}

function errorOutput(error: unknown): string {
  if (!error || typeof error !== "object") return String(error);
  const row = error as { message?: unknown; stderr?: unknown; stdout?: unknown };
  return [row.message, row.stderr, row.stdout]
    .filter((value) => value !== undefined && value !== "")
    .map(String)
    .join("\n");
}

function normalizeTargetTitle(target: string | undefined): string {
  if (!target) return "";
  return basename(target.trim()).toLowerCase();
}

function windowTitleHasDocument(title: string, documentTitle: string): boolean {
  const normalized = title.toLowerCase();
  const start = normalized.lastIndexOf(documentTitle);
  if (start < 0) return false;
  const before = normalized[start - 1] || "";
  const after = normalized[start + documentTitle.length] || "";
  const isBoundary = (value: string) =>
    !value || /[\s\-–—:|()[\]{}*]/u.test(value);
  return isBoundary(before) && isBoundary(after);
}

export function matchingAutoCADWindows(
  windows: readonly AutoCADWindow[],
  target?: string,
): AutoCADWindow[] {
  const candidates = windows.filter((window) =>
    Number.isInteger(window.id) &&
    window.id > 0 &&
    window.layer === 0 &&
    window.alpha > 0 &&
    window.width >= 300 &&
    window.height >= 200 &&
    window.owner.toLowerCase().startsWith("autocad"));
  const expectedTitle = normalizeTargetTitle(target);
  return expectedTitle
    ? candidates.filter((window) =>
      windowTitleHasDocument(window.title, expectedTitle))
    : candidates;
}

export function selectAutoCADWindow(
  windows: readonly AutoCADWindow[],
  target?: string,
): AutoCADWindow | undefined {
  const matching = matchingAutoCADWindows(windows, target);
  if (target && matching.length !== 1) return undefined;
  // CGWindowListCopyWindowInfo is ordered front-to-back. Preserve that order:
  // the largest AutoCAD window is not necessarily the active/frontmost one.
  return matching[0];
}

export function hasPngSignature(value: Uint8Array): boolean {
  return value.length >= PNG_SIGNATURE.length &&
    PNG_SIGNATURE.every((byte, index) => value[index] === byte);
}

async function listAutoCADWindows(): Promise<AutoCADWindow[]> {
  if (process.platform !== "darwin") {
    throw new ScreenshotError(
      "screenshot_unsupported_platform",
      `Chụp cửa sổ AutoCAD hiện chỉ được triển khai cho macOS; platform=${process.platform}.`,
    );
  }
  const python = process.env.ACAD_SCREENSHOT_PYTHON ||
    (existsSync(FRAMEWORK_PYTHON) ? FRAMEWORK_PYTHON : "python3");
  let stdout: string;
  try {
    const result = await execFileAsync(python, ["-c", WINDOW_LIST_SCRIPT], {
      encoding: "utf8",
      maxBuffer: 1024 * 1024,
      timeout: 10_000,
    });
    stdout = result.stdout;
  } catch (error) {
    throw new ScreenshotError(
      "quartz_unavailable",
      `Không đọc được danh sách cửa sổ AutoCAD qua Quartz: ${errorOutput(error)}`,
      "Cài PyObjC Quartz cho ACAD_SCREENSHOT_PYTHON, hoặc trỏ biến này tới Python đã import được Quartz.",
    );
  }

  try {
    const parsed: unknown = JSON.parse(stdout);
    if (!Array.isArray(parsed)) throw new Error("Quartz output is not an array");
    return parsed as AutoCADWindow[];
  } catch (error) {
    throw new ScreenshotError(
      "window_list_invalid",
      `Quartz trả dữ liệu cửa sổ không hợp lệ: ${errorOutput(error)}`,
    );
  }
}

export async function captureAutoCADWindow(
  target?: string,
): Promise<ScreenshotPayload> {
  const windows = await listAutoCADWindows();
  const matching = matchingAutoCADWindows(windows, target);
  const targetTitle = normalizeTargetTitle(target);
  if (targetTitle && matching.length > 1) {
    throw new ScreenshotError(
      "autocad_window_ambiguous",
      `Có nhiều cửa sổ AutoCAD đang hiển thị bản vẽ '${targetTitle}'.`,
      "Đưa đúng AutoCAD instance ra trước và ẩn/thu nhỏ instance còn lại rồi thử lại.",
    );
  }
  const window = matching[0];
  if (!window) {
    throw new ScreenshotError(
      targetTitle ? "target_not_active" : "autocad_window_not_found",
      targetTitle
        ? `Bản vẽ '${targetTitle}' không phải cửa sổ AutoCAD đang hiển thị.`
        : "Không tìm thấy cửa sổ chính AutoCAD đang hiển thị.",
      targetTitle
        ? "Kích hoạt tab bản vẽ cần chụp trong AutoCAD rồi thử lại."
        : "Mở AutoCAD và bảo đảm cửa sổ không bị thu nhỏ hoàn toàn.",
    );
  }

  const captureDir = await mkdtemp(join(tmpdir(), "acad-mcp-screenshot-"));
  const imagePath = join(captureDir, "autocad.png");
  try {
    try {
      await execFileAsync(
        "/usr/sbin/screencapture",
        ["-x", "-o", "-l", String(window.id), imagePath],
        {
          encoding: "utf8",
          maxBuffer: 1024 * 1024,
          timeout: 20_000,
        },
      );
    } catch (error) {
      throw new ScreenshotError(
        "screencapture_failed",
        `macOS không chụp được cửa sổ AutoCAD: ${errorOutput(error)}`,
        "Cho phép ứng dụng chạy MCP trong System Settings > Privacy & Security > Screen & System Audio Recording.",
      );
    }

    let image: Buffer;
    try {
      image = await readFile(imagePath);
    } catch (error) {
      throw new ScreenshotError(
        "screenshot_missing",
        `screencapture không tạo file PNG: ${errorOutput(error)}`,
        "Kiểm tra quyền Screen & System Audio Recording của ứng dụng chạy MCP.",
      );
    }
    if (!hasPngSignature(image)) {
      throw new ScreenshotError(
        "invalid_screenshot",
        "screencapture không trả về file PNG hợp lệ.",
      );
    }
    if (image.length > MAX_SCREENSHOT_BYTES) {
      throw new ScreenshotError(
        "screenshot_too_large",
        `Ảnh chụp ${image.length} bytes vượt giới hạn ${MAX_SCREENSHOT_BYTES} bytes.`,
      );
    }
    return {
      mimeType: "image/png",
      data: image.toString("base64"),
      sizeBytes: image.length,
      windowId: window.id,
      title: window.title,
      bounds: {
        x: window.x,
        y: window.y,
        width: window.width,
        height: window.height,
      },
      capturedAt: new Date().toISOString(),
    };
  } finally {
    await rm(captureDir, { recursive: true, force: true }).catch(() => undefined);
  }
}

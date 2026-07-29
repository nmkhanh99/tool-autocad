import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, extname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildLispOperation, lispString, type LispBuildResult } from "./lisp.js";
import {
  captureAutoCADWindow,
  ScreenshotError,
} from "./screenshot.js";

export const TOOL_NAMES = [
  "drawing",
  "entity",
  "layer",
  "block",
  "annotation",
  "pid",
  "view",
  "review",
  "system",
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];

export type ToolInput = {
  operation: string;
  data?: Record<string, unknown>;
  target?: string;
  include_screenshot?: boolean;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
  points?: number[][];
  layer?: string;
  entity_id?: string;
  [key: string]: unknown;
};

export type ToolResponse = {
  ok: boolean;
  supported: boolean;
  tool: ToolName;
  operation: string;
  backend: "acad-studio-daemon";
  payload?: unknown;
  error?: string;
  code?: string;
  hint?: string;
  warnings?: string[];
};

export interface AcadMcpBackend {
  call(tool: ToolName, input: ToolInput): Promise<ToolResponse>;
}

export const BASE_OPERATIONS: Record<ToolName, readonly string[]> = {
  drawing: [
    "create", "open", "info", "save", "save_as_dxf", "plot_pdf", "purge",
    "get_variables", "undo", "redo",
  ],
  entity: [
    "create_line", "create_circle", "create_polyline", "create_rectangle",
    "create_arc", "create_ellipse", "create_mtext", "create_hatch", "list",
    "count", "get", "copy", "move", "rotate", "scale", "mirror", "offset",
    "array", "fillet", "chamfer", "erase",
  ],
  layer: [
    "list", "create", "set_current", "set_properties", "freeze", "thaw",
    "lock", "unlock",
  ],
  block: [
    "list", "insert", "insert_with_attributes", "get_attributes",
    "update_attribute", "define",
  ],
  annotation: [
    "create_text", "create_dimension_linear", "create_dimension_aligned",
    "create_dimension_angular", "create_dimension_radius", "create_leader",
  ],
  pid: [
    "setup_layers", "insert_symbol", "list_symbols", "draw_process_line",
    "connect_equipment", "add_flow_arrow", "add_equipment_tag",
    "add_line_number", "insert_valve", "insert_instrument", "insert_pump",
    "insert_tank",
  ],
  view: ["zoom_extents", "zoom_window", "get_screenshot"],
  review: ["capabilities", "snapshot", "profiles", "run_standards"],
  system: [
    "status", "health", "get_backend", "runtime", "init", "execute_lisp",
  ],
};

const EXPLICITLY_UNSUPPORTED: Partial<
  Record<ToolName, Record<string, string>>
> = {};

const PID_SYMBOLS: Record<string, readonly string[]> = {
  ACTUATORS: [
    "ACT-BELLOWS_SPRING", "ACT-MOTOR", "ACT-SOLENOID",
    "ACT-SPRING_DIAPHRAGM",
  ],
  ANNOTATION: [
    "ANNOT-EQUIP_TAG", "ANNOT-EQUIP_DESCR", "ANNOT-FLOWARROW",
    "ANNOT-LINE_NUMBER",
  ],
  EQUIPMENT: [
    "EQUIP-CLARIFIER", "EQUIP-FILTER", "EQUIP-FILTER_PRESS",
    "EQUIP-HEAT_EXCH-GENERIC", "EQUIP-MOTOR", "EQUIP-SCREENBAR",
  ],
  "PUMPS-BLOWERS": [
    "PUMP-CENTRIF1", "PUMP-CENTRIF2", "PUMP-DIAPHRAGM",
    "PUMP-METERING", "PUMP-PROGRESSIVE_CAVITY", "PUMP-SUBMERSIBLE",
  ],
  TANKS: [
    "TANK-VERTICAL_OPEN", "TANK-VERTICAL_DOME", "TANK-HORIZONTAL",
    "TANK-CONE_BOTTOM_DOME",
  ],
  VALVES: [
    "VA-GATE", "VA-GLOBE", "VA-CHECK", "VA-BALL", "VA-BUTTERFLY",
    "VA-KNIFEGATE",
  ],
};

const READ_ONLY_OPERATIONS: Partial<Record<ToolName, ReadonlySet<string>>> = {
  drawing: new Set(["info", "get_variables"]),
  entity: new Set(["list", "count", "get"]),
  layer: new Set(["list"]),
  block: new Set(["list", "get_attributes"]),
  pid: new Set(["list_symbols"]),
  view: new Set(["get_screenshot"]),
  review: new Set(["capabilities", "snapshot", "profiles", "run_standards"]),
  system: new Set(["status", "health", "get_backend", "runtime"]),
};

const REVIEW_CAPABILITIES = {
  contractVersion: 1,
  mode: "evidence_only",
  aiReview: {
    implemented: true,
    reasoningProvider: "mcp_client_model",
    serverSideAiConnectorRequired: false,
    deterministicChecks: [
      "drawing units and precision",
      "required layer properties",
      "dimension style and row spacing",
      "drawing frame dimensions",
      "required mapped objects",
    ],
    workflow: [
      "review.snapshot",
      "review.profiles",
      "review.run_standards",
      "model interprets evidence and proposes findings",
    ],
    mutationBoundary:
      "Review never calls standards apply/action. Any later CAD mutation must use a separate guarded tool.",
    guards: {
      exactTargetMustBeActive: true,
      quiescentBeforeAndAfterScan: true,
      nativeRevisionRequired: true,
      persistentTrustPathChange: false,
    },
  },
  pdf: {
    plotPdf: {
      implemented: true,
      operation: "drawing.plot_pdf",
      api: "AcPlPlotEngine / AcDbPlotSettingsValidator",
      runtime: "AutoCAD 2027 Mac GUI + AcadBridge",
    },
    underlayInventory: {
      implemented: true,
      snapshotField: "pdfUnderlays",
      scope: "direct_layout_space_references",
      api: "AcDbPdfReference / AcDbPdfDefinition",
      requiresPluginVersion: "1.6.0",
    },
    importObjects: {
      implemented: false,
      nativeAvailable: true,
      api: "-PDFIMPORT command (no public ObjectARX converter class)",
    },
    multiSheetPublish: {
      implemented: false,
      nativeAvailable: true,
      api: "AcPlPlotEngine multi-page document",
    },
    mergeSplitReorder: {
      implemented: false,
      nativeAvailable: false,
      reason: "Not an AutoCAD/ObjectARX document-editing capability.",
    },
  },
  excel: {
    dataLinkInventory: {
      implemented: true,
      snapshotField: "dataLinks",
      sourceUpdatePermissionField: "dataLinks[].sourceUpdateAllowed",
      api: "AcDbDataLinkManager / AcDbDataLink / AcDbTable",
      requiresPluginVersion: "1.6.0",
    },
    bidirectionalUpdate: {
      implemented: false,
      nativeAvailable: true,
      api: "AcDbDataLink update / DATALINKUPDATE",
      requirements: [
        "Microsoft Excel installed for Excel data links",
        "explicit source-write permission before CAD-to-workbook update",
      ],
    },
    workbookCellRead: {
      implemented: false,
      nativeAvailable: false,
      reason:
        "Workbook parsing is a separate bounded file connector, not an ObjectARX drawing snapshot.",
    },
  },
  excluded: ["ocr", "digital_signatures", "storage", "realtime_collaboration"],
} as const;

class DaemonRequestError extends Error {
  readonly status: number;
  readonly code: string;
  readonly payload: unknown;

  constructor(status: number, code: string, message: string, payload?: unknown) {
    super(message);
    this.name = "DaemonRequestError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

type RequestOptions = {
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
  allowAutostart?: boolean;
};

const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, "");
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function versionAtLeast(value: unknown, minimum: string): boolean {
  const actual = String(value ?? "").split(".").map(Number);
  const required = minimum.split(".").map(Number);
  if (
    actual.length < 2 ||
    actual.some((part) => !Number.isInteger(part) || part < 0)
  ) {
    return false;
  }
  for (let index = 0; index < Math.max(actual.length, required.length); index++) {
    const left = actual[index] || 0;
    const right = required[index] || 0;
    if (left !== right) return left > right;
  }
  return true;
}

function errorText(value: unknown): string {
  if (value instanceof Error) return value.message;
  return String(value);
}

function canonicalExistingPath(value: string): string {
  try {
    return realpathSync.native(value);
  } catch {
    return value;
  }
}

type PlotPdfData = {
  path: string;
  layout: string;
  page_setup?: string;
  device?: string;
  media?: string;
  plot_type?: "extents" | "layout";
  scale?: "fit" | "1:1";
  rotation?: 0 | 90 | 180 | 270;
  centered?: boolean;
  style_sheet?: string;
  overwrite: boolean;
  timeout_ms: number;
};

type PlotPdfValidation =
  | { ok: true; value: PlotPdfData }
  | { ok: false; error: string };

function nonEmptyPlotString(
  data: Record<string, unknown>,
  key: string,
): string | undefined | null {
  if (data[key] === undefined) return undefined;
  if (typeof data[key] !== "string" || !data[key].trim()) return null;
  return data[key].trim();
}

function validatePlotPdfData(
  source: Record<string, unknown> | undefined,
): PlotPdfValidation {
  const data = source || {};
  const path = data.path;
  if (
    typeof path !== "string" ||
    !path ||
    /[\0\r\n]/.test(path) ||
    !isAbsolute(path) ||
    extname(path).toLowerCase() !== ".pdf"
  ) {
    return {
      ok: false,
      error: "plot_pdf cần data.path là đường dẫn tuyệt đối kết thúc bằng .pdf.",
    };
  }

  const layout = nonEmptyPlotString(data, "layout");
  if (!layout) {
    return {
      ok: false,
      error: "plot_pdf cần data.layout là tên layout chính xác, không rỗng.",
    };
  }

  const pageSetup = nonEmptyPlotString(data, "page_setup");
  const device = nonEmptyPlotString(data, "device");
  const media = nonEmptyPlotString(data, "media");
  if (pageSetup === null || device === null || media === null) {
    return {
      ok: false,
      error: "page_setup, device và media phải là chuỗi không rỗng khi được truyền.",
    };
  }
  if (pageSetup && (device !== undefined || media !== undefined)) {
    return {
      ok: false,
      error: "Không được kết hợp data.page_setup với cấu hình data.device/data.media.",
    };
  }
  if (!pageSetup && (!device || !media)) {
    return {
      ok: false,
      error:
        "plot_pdf cần đúng một chế độ cấu hình: page_setup, hoặc đồng thời device và media.",
    };
  }

  const overrideKeys = [
    "plot_type",
    "scale",
    "rotation",
    "centered",
    "style_sheet",
  ];
  if (pageSetup && overrideKeys.some((key) => data[key] !== undefined)) {
    return {
      ok: false,
      error:
        "Named page_setup đã chứa plot settings; không được truyền plot_type, scale, rotation, centered hoặc style_sheet.",
    };
  }

  const plotType = data.plot_type === undefined ? "extents" : data.plot_type;
  if (plotType !== "extents" && plotType !== "layout") {
    return {
      ok: false,
      error: "data.plot_type phải là extents hoặc layout.",
    };
  }
  const scale = data.scale === undefined ? "fit" : data.scale;
  if (scale !== "fit" && scale !== "1:1") {
    return {
      ok: false,
      error: "data.scale phải là fit hoặc 1:1.",
    };
  }
  if (!pageSetup && plotType === "layout" && scale !== "1:1") {
    return {
      ok: false,
      error: 'data.plot_type="layout" yêu cầu data.scale="1:1".',
    };
  }
  const rotation = data.rotation === undefined ? 0 : data.rotation;
  if (rotation !== 0 && rotation !== 90 && rotation !== 180 && rotation !== 270) {
    return {
      ok: false,
      error: "data.rotation phải là 0, 90, 180 hoặc 270.",
    };
  }
  const centered = data.centered === undefined ? true : data.centered;
  if (typeof centered !== "boolean") {
    return {
      ok: false,
      error: "data.centered phải là boolean.",
    };
  }
  const styleSheet = nonEmptyPlotString(data, "style_sheet");
  if (styleSheet === null) {
    return {
      ok: false,
      error: "data.style_sheet phải là chuỗi không rỗng khi được truyền.",
    };
  }
  const overwrite = data.overwrite === undefined ? false : data.overwrite;
  if (typeof overwrite !== "boolean") {
    return {
      ok: false,
      error: "data.overwrite phải là boolean.",
    };
  }
  const timeoutMs = data.timeout_ms === undefined ? 120_000 : data.timeout_ms;
  if (
    typeof timeoutMs !== "number" ||
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 500 ||
    timeoutMs > 600_000
  ) {
    return {
      ok: false,
      error: "data.timeout_ms phải là số nguyên từ 500 đến 600000.",
    };
  }

  return {
    ok: true,
    value: {
      path,
      layout,
      page_setup: pageSetup,
      device,
      media,
      ...(pageSetup
        ? {}
        : {
            plot_type: plotType,
            scale,
            rotation,
            centered,
            style_sheet: styleSheet,
          }),
      overwrite,
      timeout_ms: timeoutMs,
    },
  };
}

function responseError(payload: unknown, fallback: string): string {
  const row = objectValue(payload);
  return typeof row.error === "string" && row.error.trim()
    ? row.error
    : fallback;
}

function responseCode(payload: unknown, fallback: string): string {
  const row = objectValue(payload);
  return typeof row.code === "string" && row.code.trim()
    ? row.code
    : fallback;
}

class AcadDaemonClient {
  readonly baseUrl: string;
  readonly autostart: boolean;
  private readonly projectRoot?: string;
  private child: ChildProcess | null = null;
  private startPromise: Promise<boolean> | null = null;

  constructor(opts?: {
    baseUrl?: string;
    autostart?: boolean;
    projectRoot?: string;
  }) {
    this.baseUrl = normalizeBaseUrl(
      opts?.baseUrl || process.env.ACAD_DAEMON_URL || "http://127.0.0.1:8788",
    );
    this.autostart = opts?.autostart ??
      process.env.ACAD_MCP_AUTOSTART_DAEMON !== "0";
    this.projectRoot = opts?.projectRoot;
  }

  async request(path: string, options: RequestOptions = {}): Promise<unknown> {
    try {
      return await this.fetchOnce(path, options);
    } catch (error) {
      if (
        options.allowAutostart !== false &&
        this.autostart &&
        this.isConnectionError(error) &&
        await this.startDaemon()
      ) {
        return this.fetchOnce(path, { ...options, allowAutostart: false });
      }
      throw error;
    }
  }

  private async fetchOnce(path: string, options: RequestOptions): Promise<unknown> {
    const controller = new AbortController();
    const timeoutMs = options.timeoutMs ?? 15_000;
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method: options.method || (options.body === undefined ? "GET" : "POST"),
        headers: options.body === undefined
          ? undefined
          : { "content-type": "application/json" },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal,
      });
      const text = await response.text();
      let payload: unknown = {};
      if (text) {
        try {
          payload = JSON.parse(text);
        } catch {
          payload = { error: text.slice(0, 2_000) };
        }
      }
      if (!response.ok) {
        throw new DaemonRequestError(
          response.status,
          responseCode(payload, `http_${response.status}`),
          responseError(payload, `Acad Studio daemon trả HTTP ${response.status}`),
          payload,
        );
      }
      return payload;
    } catch (error) {
      if (error instanceof DaemonRequestError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new DaemonRequestError(
          504,
          "daemon_timeout",
          `Acad Studio daemon không phản hồi trong ${timeoutMs} ms`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private isConnectionError(error: unknown): boolean {
    if (error instanceof DaemonRequestError) return false;
    const message = errorText(error).toLowerCase();
    return /fetch failed|econnrefused|connection refused|socket/.test(message);
  }

  private startDaemon(): Promise<boolean> {
    if (!this.baseUrl.startsWith("http://127.0.0.1:") &&
        !this.baseUrl.startsWith("http://localhost:")) {
      return Promise.resolve(false);
    }
    if (this.startPromise) return this.startPromise;
    const attempt = this.spawnAndWait();
    this.startPromise = attempt;
    void attempt.finally(() => {
      if (this.startPromise === attempt) this.startPromise = null;
    });
    return attempt;
  }

  private async spawnAndWait(): Promise<boolean> {
    const moduleDir = dirname(fileURLToPath(import.meta.url));
    const daemonDir = resolve(moduleDir, "../../daemon");
    const tsx = join(daemonDir, "node_modules/.bin/tsx");
    const entry = join(daemonDir, "src/server.ts");
    const wasm = join(daemonDir, "node_modules/sql.js/dist/sql-wasm.wasm");
    if (!existsSync(tsx) || !existsSync(entry) || !existsSync(wasm)) return false;

    let daemonPort = "8788";
    try {
      daemonPort = new URL(this.baseUrl).port || "80";
    } catch {
      return false;
    }

    this.child = spawn(tsx, [entry], {
      cwd: daemonDir,
      env: {
        ...process.env,
        ACAD_SQLJS_WASM: wasm,
        MEP_SQLJS_WASM: wasm,
        ACAD_DAEMON_PORT: daemonPort,
        ACAD_PROJECT_ROOT: this.projectRoot || process.env.ACAD_PROJECT_ROOT,
      },
      detached: true,
      stdio: "ignore",
    });
    this.child.unref();
    this.child.once("error", () => {
      this.child = null;
    });
    this.child.once("exit", () => {
      this.child = null;
    });

    for (let attempt = 0; attempt < 50; attempt++) {
      await sleep(100);
      try {
        await this.fetchOnce("/api/health", {
          timeoutMs: 500,
          allowAutostart: false,
        });
        return true;
      } catch {
        if (!this.child) {
          // Another daemon may have won the port race; keep probing briefly.
          if (attempt > 10) return false;
        }
      }
    }
    return false;
  }
}

function capabilityMatrix(): Record<ToolName, Record<string, {
  supported: boolean;
  reason?: string;
}>> {
  return Object.fromEntries(
    TOOL_NAMES.map((tool) => [
      tool,
      Object.fromEntries(
        BASE_OPERATIONS[tool].map((operation) => {
          const reason = EXPLICITLY_UNSUPPORTED[tool]?.[operation];
          return [operation, reason
            ? { supported: false, reason }
            : { supported: true }];
        }),
      ),
    ]),
  ) as Record<ToolName, Record<string, { supported: boolean; reason?: string }>>;
}

function parseJobMessage(
  message: string,
  mode: Extract<LispBuildResult, { supported: true }>["parse"],
): unknown {
  if (mode === "json") {
    try {
      return JSON.parse(message);
    } catch {
      return { raw: message, parseError: "invalid_json" };
    }
  }
  if (mode === "tsv") {
    const table = message
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.split("\t"));
    const [headers = [], ...rows] = table;
    return {
      headers,
      rows: rows.map((values) => Object.fromEntries(
        headers.map((header, index) => [header, values[index] ?? ""]),
      )),
      count: rows.length,
    };
  }
  return { message };
}

export class DaemonAutoCADBackend implements AcadMcpBackend {
  private readonly daemon: AcadDaemonClient;
  private readonly projectRoot: string;

  constructor(opts?: {
    daemonUrl?: string;
    autostartDaemon?: boolean;
    projectRoot?: string;
  }) {
    this.projectRoot = opts?.projectRoot ||
      process.env.ACAD_PROJECT_ROOT ||
      resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
    this.daemon = new AcadDaemonClient({
      baseUrl: opts?.daemonUrl,
      autostart: opts?.autostartDaemon,
      projectRoot: this.projectRoot,
    });
  }

  async call(tool: ToolName, input: ToolInput): Promise<ToolResponse> {
    const operation = String(input.operation || "").trim();
    if (!operation) {
      return this.failure(tool, operation, "invalid_input", "Thiếu operation.");
    }
    if (!BASE_OPERATIONS[tool].includes(operation)) {
      return this.failure(
        tool,
        operation,
        "unknown_operation",
        `Operation '${operation}' không thuộc tool '${tool}'.`,
        `Các operation hợp lệ: ${BASE_OPERATIONS[tool].join(", ")}`,
        false,
      );
    }
    const normalizedInput = operation === input.operation
      ? input
      : { ...input, operation };
    const unsupportedReason = EXPLICITLY_UNSUPPORTED[tool]?.[operation];
    if (unsupportedReason) {
      return this.failure(
        tool,
        operation,
        "unsupported",
        unsupportedReason,
        undefined,
        false,
      );
    }

    try {
      let response: ToolResponse;
      switch (tool) {
        case "system":
          response = await this.system(normalizedInput);
          break;
        case "drawing":
          response = await this.drawing(normalizedInput);
          break;
        case "entity":
          response = await this.entity(normalizedInput);
          break;
        case "layer":
          response = await this.layer(normalizedInput);
          break;
        case "block":
          response = await this.block(normalizedInput);
          break;
        case "pid":
          response = await this.pid(normalizedInput);
          break;
        case "annotation":
          response = await this.runBuiltOperation(tool, normalizedInput);
          break;
        case "view":
          response = await this.view(normalizedInput);
          break;
        case "review":
          response = await this.review(normalizedInput);
          break;
        default:
          return this.failure(
            tool, operation, "unsupported_tool", `Tool '${String(tool)}' không hợp lệ.`,
            undefined,
            false,
          );
      }
      if (
        response.ok &&
        normalizedInput.include_screenshot &&
        objectValue(response.payload).completed !== false &&
        !(tool === "view" && operation === "get_screenshot")
      ) {
        return this.attachScreenshot(response, normalizedInput);
      }
      return response;
    } catch (error) {
      if (error instanceof DaemonRequestError) {
        return this.failure(
          tool,
          operation,
          error.code,
          error.message,
          error.status === 503
            ? "Mở AutoCAD/AcadBridge hoặc kiểm tra `system(operation=\"health\")`."
            : undefined,
        );
      }
      const unavailable = /fetch failed|econnrefused|connection refused/i.test(errorText(error));
      return this.failure(
        tool,
        operation,
        unavailable ? "daemon_unavailable" : "backend_error",
        unavailable
          ? `Không kết nối được Acad Studio daemon tại ${this.daemon.baseUrl}.`
          : errorText(error),
        unavailable
          ? "Chạy `pnpm daemon` trong acad-studio, hoặc bật ACAD_MCP_AUTOSTART_DAEMON."
          : undefined,
      );
    }
  }

  private async system(input: ToolInput): Promise<ToolResponse> {
    const operation = input.operation;
    if (operation === "runtime") {
      return this.success("system", input, {
        process: {
          pid: process.pid,
          platform: process.platform,
          arch: process.arch,
          node: process.version,
          cwd: process.cwd(),
        },
        adapter: {
          transport: "stdio",
          daemonUrl: this.daemon.baseUrl,
          autostartDaemon: this.daemon.autostart,
          projectRoot: this.projectRoot,
        },
        capabilities: capabilityMatrix(),
      });
    }
    if (operation === "status") {
      const jobId = String(input.data?.job_id || "").trim();
      if (jobId && !/^[a-f0-9]{8}$/i.test(jobId)) {
        return this.failure(
          "system",
          operation,
          "invalid_input",
          "data.job_id phải là ID 8 ký tự hex do một MCP job pending trả về.",
        );
      }
      const [status, documents, coverage, job] = await Promise.all([
        this.daemon.request("/api/acad/status"),
        this.daemon.request("/api/acad/docs"),
        this.daemon.request("/api/acad/raw/coverage"),
        jobId
          ? this.daemon.request(`/api/acad/job/${encodeURIComponent(jobId)}`)
          : Promise.resolve(undefined),
      ]);
      return this.success("system", input, {
        status,
        documents,
        objectarx: coverage,
        job,
        capabilities: capabilityMatrix(),
      });
    }
    if (operation === "health" || operation === "init") {
      const health = await this.daemon.request("/api/acad/health", {
        timeoutMs: 30_000,
      });
      const healthRow = objectValue(health);
      if (healthRow.ok !== true) {
        return this.failure(
          "system",
          operation,
          "health_failed",
          responseError(health, "AutoCAD control plane chưa sẵn sàng."),
        );
      }
      return this.success("system", input, {
        ...healthRow,
        initialized: operation === "init",
        note: operation === "init"
          ? "Adapter không giữ backend singleton; health check đã xác nhận control plane."
          : undefined,
      });
    }
    if (operation === "get_backend") {
      const [status, health] = await Promise.all([
        this.daemon.request("/api/acad/status"),
        this.daemon.request("/api/acad/health", { timeoutMs: 30_000 }),
      ]);
      if (objectValue(health).ok !== true) {
        return this.failure(
          "system",
          operation,
          "health_failed",
          responseError(health, "AutoCAD control plane chưa sẵn sàng."),
        );
      }
      return this.success("system", input, {
        name: "acad-studio-daemon",
        platform: "macOS",
        transport: "loopback-http -> AcadBridge/AcCoreConsole",
        status,
        health,
        capabilities: capabilityMatrix(),
      });
    }
    if (operation === "execute_lisp") {
      const prepared = await this.prepareTarget("system", input, true);
      if (prepared.error) return prepared.error;
      const code = String(input.data?.code || "");
      if (!code.trim()) {
        return this.failure(
          "system", operation, "invalid_input", "execute_lisp cần data.code.",
        );
      }
      return this.runJob("system", prepared.input, {
        supported: true,
        lisp: code,
        parse: "text",
      });
    }
    return this.failure("system", operation, "unknown_operation", "Operation không hợp lệ.");
  }

  private async drawing(input: ToolInput): Promise<ToolResponse> {
    const operation = input.operation;
    if (operation === "info") {
      const target = String(input.target || "");
      const suffix = target ? `?target=${encodeURIComponent(target)}` : "";
      const snapshot = await this.daemon.request(`/api/acad/drawing-info${suffix}`, {
        timeoutMs: 20_000,
      });
      return this.success("drawing", input, snapshot);
    }
    if (operation === "open") {
      const path = String(input.data?.path || "");
      if (!path || !isAbsolute(path)) {
        return this.failure(
          "drawing", operation, "invalid_input",
          "open cần data.path là đường dẫn tuyệt đối tới file DWG.",
        );
      }
      if (!existsSync(path)) {
        return this.failure(
          "drawing", operation, "not_found", `Không thấy file: ${path}`,
        );
      }
      const canonicalPath = canonicalExistingPath(path);
      const opened = await this.daemon.request("/api/acad/open", {
        method: "POST",
        body: { path: canonicalPath },
        timeoutMs: 30_000,
      });
      if (objectValue(opened).ok !== true) {
        return this.failure(
          "drawing",
          operation,
          "open_failed",
          responseError(opened, `AutoCAD không mở được bản vẽ: ${canonicalPath}`),
        );
      }
      const document = await this.waitForOpenDocument(
        canonicalPath,
        this.operationTimeout(input, 30_000),
      );
      if (!document) {
        return this.failure(
          "drawing",
          operation,
          "open_not_confirmed",
          `LaunchServices đã nhận yêu cầu nhưng AcadBridge không xác nhận bản vẽ đã mở: ${canonicalPath}`,
          "Kiểm tra hộp thoại/cảnh báo trong AutoCAD rồi gọi system(operation=\"status\").",
        );
      }
      return this.success("drawing", input, { handoff: opened, document });
    }
    if (operation === "create") return this.createDrawing(input);
    if (operation === "plot_pdf") return this.plotPdf(input);
    return this.runBuiltOperation("drawing", input);
  }

  private async plotPdf(input: ToolInput): Promise<ToolResponse> {
    const prepared = await this.prepareTarget("drawing", input, true);
    if (prepared.error) return prepared.error;

    const validated = validatePlotPdfData(input.data);
    if (!validated.ok) {
      return this.failure(
        "drawing",
        "plot_pdf",
        "invalid_input",
        validated.error,
      );
    }
    const plot = validated.value;
    if (!plot.overwrite && existsSync(plot.path)) {
      return this.failure(
        "drawing",
        "plot_pdf",
        "file_exists",
        `Từ chối ghi đè PDF đã có: ${plot.path}`,
        "Đặt data.overwrite=true chỉ khi muốn thay file sau khi PDF mới được xác minh.",
      );
    }

    const document = objectValue(prepared.document);
    const documentInstance = String(document.instance || "").trim();
    if (!documentInstance) {
      return this.failure(
        "drawing",
        "plot_pdf",
        "target_instance_unavailable",
        "AcadBridge không cung cấp document instance để khóa target plot.",
        "Cập nhật/nạp lại plugin rồi gọi system(operation=\"status\").",
      );
    }

    const raw = await this.daemon.request("/api/acad/plot-pdf", {
      method: "POST",
      body: {
        target: prepared.input.target,
        documentInstance,
        ...plot,
      },
      // Daemon performs two guarded native snapshots (up to 5s + 10s)
      // before it creates a correlated job. Keep the HTTP client alive long
      // enough to receive either the preflight error or the jobId.
      timeoutMs: plot.timeout_ms + 30_000,
    });
    const row = objectValue(raw);
    const state = String(row.state || "");
    const pending = state === "sent" || state === "pending";
    if (pending && row.ok !== false) {
      const jobId = String(row.jobId || "");
      const accepted = this.success("drawing", prepared.input, {
        jobId: jobId || null,
        state,
        accepted: true,
        completed: false,
        result: null,
      });
      return {
        ...accepted,
        warnings: [
          "AutoCAD đã nhận job plot nhưng chưa trả kết quả; không gửi lại operation vì job có thể vẫn đang ghi PDF.",
          jobId
            ? `Theo dõi bằng system(operation="status", data={"job_id":"${jobId}"}).`
            : "Kiểm tra system(operation=\"status\") trước khi plot tiếp.",
        ],
      };
    }

    if (
      state === "done" &&
      row.ok === true &&
      row.result !== undefined &&
      row.result !== null
    ) {
      return this.success("drawing", prepared.input, {
        jobId: row.jobId || null,
        state,
        accepted: true,
        completed: true,
        result: row.result,
      });
    }

    const result = objectValue(row.result);
    const error = typeof row.error === "string" && row.error.trim()
      ? row.error
      : typeof result.error === "string" && result.error.trim()
        ? result.error
        : typeof result.message === "string" && result.message.trim()
          ? result.message
          : `Plot job kết thúc với state=${state || "unknown"}.`;
    const code = typeof row.code === "string" && row.code.trim()
      ? row.code
      : typeof result.code === "string" && result.code.trim()
        ? result.code
        : state === "done"
          ? "invalid_daemon_response"
          : "plot_failed";
    return {
      ...this.failure("drawing", "plot_pdf", code, error),
      payload: {
        jobId: row.jobId || null,
        state: state || "unknown",
        uncertain: row.uncertain === true,
        path: row.path || plot.path,
        result: row.result ?? null,
      },
    };
  }

  private async createDrawing(input: ToolInput): Promise<ToolResponse> {
    const requestedPath = String(input.data?.path || "");
    let path: string;
    if (requestedPath) {
      if (!isAbsolute(requestedPath)) {
        return this.failure(
          "drawing", "create", "invalid_input",
          "data.path phải là đường dẫn tuyệt đối.",
        );
      }
      path = requestedPath;
    } else {
      const rawName = String(input.data?.name || `MCP-${randomUUID().slice(0, 8)}`);
      const safeName = rawName
        .replace(/\.dwg$/i, "")
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/^-+|-+$/g, "") || `MCP-${randomUUID().slice(0, 8)}`;
      path = join(this.projectRoot, "acad-studio", ".work", `${safeName}.dwg`);
      mkdirSync(dirname(path), { recursive: true });
    }
    if (existsSync(path)) {
      return this.failure(
        "drawing", "create", "file_exists",
        `Từ chối ghi đè bản vẽ đã có: ${path}`,
        "Chọn data.path/name khác; MCP create không tự xóa DWG.",
      );
    }

    const script = [
      `(setvar "CMDECHO" 0)`,
      `(setvar "FILEDIA" 0)`,
      `(setvar "CMDDIA" 0)`,
      `(setvar "INSUNITS" 4)`,
      `(command "_.SAVEAS" "2018" ${lispString(path)})`,
      `(princ)`,
    ].join("\n");
    const created = await this.daemon.request("/api/acad/headless", {
      method: "POST",
      body: { script, timeoutMs: 120_000 },
      timeoutMs: 135_000,
    });
    const row = objectValue(created);
    const fileCreated = existsSync(path);
    if (row.ok !== true || !fileCreated) {
      if (fileCreated) {
        return this.failure(
          "drawing",
          "create",
          "create_uncertain",
          `AcCoreConsole không thoát sạch nhưng đã để lại DWG tại: ${path}`,
          "Không retry cùng path. Kiểm tra file trước; xóa/đổi tên thủ công nếu không dùng.",
        );
      }
      return this.failure(
        "drawing", "create", "create_failed",
        responseError(created, "AcCoreConsole không tạo được DWG."),
      );
    }
    path = canonicalExistingPath(path);

    let opened: unknown = null;
    let document: Record<string, unknown> | null = null;
    if (input.data?.open !== false) {
      opened = await this.daemon.request("/api/acad/open", {
        method: "POST",
        body: { path },
        timeoutMs: 30_000,
      });
      if (objectValue(opened).ok !== true) {
        return this.failure(
          "drawing",
          "create",
          "open_failed",
          responseError(opened, `Đã tạo nhưng AutoCAD không mở được bản vẽ: ${path}`),
          `DWG đã được tạo tại ${path}.`,
        );
      }
      document = await this.waitForOpenDocument(
        path,
        this.operationTimeout(input, 30_000),
      );
      if (!document) {
        return this.failure(
          "drawing",
          "create",
          "open_not_confirmed",
          `Đã tạo DWG nhưng AcadBridge không xác nhận bản vẽ đã mở: ${path}`,
          `DWG vẫn nằm tại ${path}. Kiểm tra AutoCAD rồi gọi drawing(operation="open").`,
        );
      }
    }
    return this.success("drawing", input, { path, created, opened, document });
  }

  private async entity(input: ToolInput): Promise<ToolResponse> {
    if (input.operation === "count") {
      const target = String(input.target || "");
      const suffix = target ? `?target=${encodeURIComponent(target)}` : "";
      const snapshot = objectValue(await this.daemon.request(
        `/api/acad/drawing-info${suffix}`,
        { timeoutMs: 20_000 },
      ));
      const drawing = objectValue(snapshot.drawing);
      const counts = objectValue(snapshot.counts || drawing.counts);
      const byLayer = objectValue(counts.byLayer);
      const layer = String(input.layer || input.data?.layer || "");
      const count = layer
        ? Number(byLayer[layer] || 0)
        : Number(counts.entities || counts.modelEntities || 0);
      return this.success("entity", input, { count, layer: layer || null, counts });
    }
    return this.runBuiltOperation("entity", input);
  }

  private async layer(input: ToolInput): Promise<ToolResponse> {
    if (input.operation === "list") {
      const snapshot = await this.drawingSnapshot(input.target);
      const row = objectValue(snapshot);
      const tables = objectValue(row.tables);
      const drawing = objectValue(row.drawing);
      const layers = tables.layers || drawing.layers || [];
      return this.success("layer", input, {
        layers,
        count: Array.isArray(layers) ? layers.length : 0,
        document: row.document,
      });
    }
    return this.runBuiltOperation("layer", input);
  }

  private async block(input: ToolInput): Promise<ToolResponse> {
    if (input.operation === "list") {
      const snapshot = await this.drawingSnapshot(input.target);
      const row = objectValue(snapshot);
      const tables = objectValue(row.tables);
      const drawing = objectValue(row.drawing);
      const blocks = tables.blocks || drawing.blocks || [];
      return this.success("block", input, {
        blocks,
        count: Array.isArray(blocks) ? blocks.length : 0,
        document: row.document,
      });
    }
    return this.runBuiltOperation("block", input);
  }

  private async pid(input: ToolInput): Promise<ToolResponse> {
    if (input.operation === "list_symbols") {
      const category = String(input.data?.category || "").toUpperCase();
      if (category && !PID_SYMBOLS[category]) {
        return this.failure(
          "pid", input.operation, "unknown_category",
          `Không có category '${category}'.`,
          `Categories: ${Object.keys(PID_SYMBOLS).join(", ")}`,
        );
      }
      return this.success("pid", input, {
        category: category || null,
        categories: category ? undefined : Object.keys(PID_SYMBOLS),
        symbols: category ? PID_SYMBOLS[category] : PID_SYMBOLS,
        source: "built-in fallback catalog",
        representation:
          "Các insert operation hiện tạo ký hiệu hình học generic/placeholder, không giả nhận block CTO thật.",
      });
    }
    return this.runBuiltOperation("pid", input);
  }

  private async view(input: ToolInput): Promise<ToolResponse> {
    if (input.operation !== "get_screenshot") {
      return this.runBuiltOperation("view", input);
    }
    const prepared = await this.prepareTarget("view", input, false);
    if (prepared.error) return prepared.error;
    if (prepared.input.target && prepared.document?.active !== true) {
      return this.failure(
        "view",
        input.operation,
        "target_not_active",
        `Bản vẽ target không phải tab AutoCAD đang hiển thị: ${String(prepared.input.target)}`,
        "Kích hoạt đúng tab bản vẽ trong AutoCAD rồi thử lại.",
      );
    }
    try {
      const screenshot = await captureAutoCADWindow(prepared.input.target);
      return this.success("view", prepared.input, screenshot);
    } catch (error) {
      if (error instanceof ScreenshotError) {
        return this.failure(
          "view",
          input.operation,
          error.code,
          error.message,
          error.hint,
        );
      }
      throw error;
    }
  }

  private async review(input: ToolInput): Promise<ToolResponse> {
    const operation = input.operation;
    if (operation === "capabilities") {
      return this.success("review", input, REVIEW_CAPABILITIES);
    }
    if (operation === "profiles") {
      const profiles = await this.daemon.request("/api/acad/standards/profiles", {
        timeoutMs: 20_000,
      });
      return this.success("review", input, profiles);
    }

    const target = String(input.target || "").trim();
    if (!target) {
      return this.failure(
        "review",
        operation,
        "target_required",
        `review.${operation} cần target là title hoặc full path của bản vẽ đang mở.`,
        "Gọi system(operation=\"status\") để lấy document target chính xác.",
      );
    }
    if (operation === "snapshot") {
      const snapshot = objectValue(await this.drawingSnapshot(target));
      const source = objectValue(snapshot.source);
      const limits = objectValue(snapshot.limits);
      const dataLinks = Array.isArray(snapshot.dataLinks)
        ? snapshot.dataLinks.map(objectValue)
        : null;
      if (
        snapshot.ok !== true ||
        source.channel !== "objectarx" ||
        source.protocol !== 1 ||
        !versionAtLeast(source.pluginVersion, "1.6.0") ||
        !Array.isArray(snapshot.pdfUnderlays) ||
        limits.pdfUnderlayScope !== "direct_layout_space_references" ||
        !dataLinks ||
        dataLinks.some((link) =>
          typeof link.sourceUpdateAllowed !== "boolean" ||
          !Number.isInteger(link.updateOption))
      ) {
        return this.failure(
          "review",
          operation,
          "snapshot_contract_mismatch",
          "Snapshot review cần AcadBridge 1.6.0+ với PDF/Data Link metadata đầy đủ.",
          "Build, cài và nạp lại AcadBridge rồi gọi review.snapshot lần nữa.",
        );
      }
      return this.success("review", { ...input, target }, snapshot);
    }
    if (operation === "run_standards") {
      const profileId = String(input.data?.profile_id || "").trim();
      if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/.test(profileId)) {
        return this.failure(
          "review",
          operation,
          "invalid_input",
          "run_standards cần data.profile_id hợp lệ; hãy gọi review.profiles và chọn rõ profile.",
        );
      }
      const raw = objectValue(await this.daemon.request(
        "/api/acad/standards/scan",
        {
          method: "POST",
          body: { target, profileId, readOnly: true },
          timeoutMs: 70_000,
        },
      ));
      const evidence = objectValue(raw.evidence);
      const completeness = objectValue(evidence.completeness);
      const issues = Array.isArray(raw.issues) ? raw.issues : null;
      if (
        raw.ok !== true ||
        raw.profileId !== profileId ||
        typeof raw.target !== "string" ||
        typeof raw.profileRevision !== "string" ||
        typeof raw.scannedAt !== "string" ||
        typeof evidence.drawingRevision !== "string" ||
        typeof completeness.complete !== "boolean" ||
        !issues ||
        !Array.isArray(raw.objects) ||
        !Array.isArray(raw.dimensions)
      ) {
        return this.failure(
          "review",
          operation,
          "invalid_daemon_response",
          "Standards scan không trả đúng profile/evidence contract đã yêu cầu.",
        );
      }
      const bySeverity: Record<string, number> = {};
      const byScope: Record<string, number> = {};
      for (const issueValue of issues) {
        const issue = objectValue(issueValue);
        const severity = String(issue.severity || "unknown");
        const scope = String(issue.scope || "unknown");
        bySeverity[severity] = (bySeverity[severity] || 0) + 1;
        byScope[scope] = (byScope[scope] || 0) + 1;
      }
      return this.success("review", { ...input, target }, {
        target: raw.target,
        profileId: raw.profileId,
        profileRevision: raw.profileRevision,
        scannedAt: raw.scannedAt,
        current: raw.current,
        evidence: raw.evidence,
        summary: {
          issueCount: issues.length,
          bySeverity,
          byScope,
        },
        issues,
        objects: raw.objects,
        dimensions: raw.dimensions,
      });
    }
    return this.failure(
      "review",
      operation,
      "unknown_operation",
      "Operation review không hợp lệ.",
    );
  }

  private async attachScreenshot(
    response: ToolResponse,
    input: ToolInput,
  ): Promise<ToolResponse> {
    try {
      const screenshot = await captureAutoCADWindow(
        input.target ? String(input.target) : undefined,
      );
      return {
        ...response,
        payload: {
          result: response.payload,
          screenshot,
        },
      };
    } catch (error) {
      const message = error instanceof ScreenshotError
        ? `${error.code}: ${error.message}`
        : errorText(error);
      return {
        ...response,
        warnings: [
          ...(response.warnings || []),
          `Operation đã thành công nhưng không đính kèm được screenshot: ${message}`,
        ],
      };
    }
  }

  private async drawingSnapshot(targetValue: unknown): Promise<unknown> {
    const target = String(targetValue || "");
    const suffix = target ? `?target=${encodeURIComponent(target)}` : "";
    return this.daemon.request(`/api/acad/drawing-info${suffix}`, {
      timeoutMs: 20_000,
    });
  }

  private operationTimeout(input: ToolInput, fallback: number): number {
    const value = Number(input.data?.timeout_ms ?? fallback);
    return Number.isFinite(value)
      ? Math.min(120_000, Math.max(500, value))
      : fallback;
  }

  private async waitForOpenDocument(
    path: string,
    timeoutMs: number,
  ): Promise<Record<string, unknown> | null> {
    const canonicalPath = canonicalExistingPath(path);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const payload = objectValue(await this.daemon.request("/api/acad/docs", {
        timeoutMs: Math.min(5_000, Math.max(500, deadline - Date.now())),
      }));
      const documents = Array.isArray(payload.docs)
        ? payload.docs.map(objectValue)
        : [];
      const match = documents.find((document) =>
        canonicalExistingPath(String(document.file || "")) === canonicalPath);
      if (match) return match;
      await sleep(Math.min(500, Math.max(1, deadline - Date.now())));
    }
    return null;
  }

  private async runBuiltOperation(
    tool: Exclude<ToolName, "system">,
    input: ToolInput,
  ): Promise<ToolResponse> {
    const targetRequired = !READ_ONLY_OPERATIONS[tool]?.has(input.operation);
    const prepared = await this.prepareTarget(tool, input, targetRequired);
    if (prepared.error) return prepared.error;
    const routedInput = prepared.input;
    let built: LispBuildResult;
    try {
      built = buildLispOperation(tool, routedInput);
    } catch (error) {
      return this.failure(
        tool, input.operation, "invalid_input", errorText(error),
      );
    }
    if (!built.supported) {
      const code = built.code || "unsupported";
      const operationSupported =
        code === "invalid_input" || code === "ambiguous_operation";
      return this.failure(
        tool,
        input.operation,
        code,
        built.reason,
        undefined,
        operationSupported,
      );
    }
    return this.runJob(tool, routedInput, built);
  }

  private async runJob(
    tool: ToolName,
    input: ToolInput,
    built: Extract<LispBuildResult, { supported: true }>,
  ): Promise<ToolResponse> {
    const wait = Math.max(1_000, this.operationTimeout(input, 60_000));
    const raw = await this.daemon.request("/api/acad/job", {
      method: "POST",
      body: {
        lisp: built.lisp,
        target: input.target || undefined,
        wait,
      },
      timeoutMs: wait + 10_000,
    });
    const row = objectValue(raw);
    const result = objectValue(row.result);
    const state = String(row.state || "");
    const status = String(result.status || "");
    const pending = state === "sent" || state === "pending";
    if (pending) {
      const jobId = String(row.jobId || "");
      const accepted = this.success(tool, input, {
        jobId: jobId || null,
        state,
        accepted: true,
        completed: false,
        result: null,
      });
      return {
        ...accepted,
        warnings: [
          "AutoCAD đã nhận job nhưng chưa trả kết quả; không gửi lại operation vì job có thể vẫn đang ghi bản vẽ.",
          jobId
            ? `Theo dõi bằng system(operation="status", data={"job_id":"${jobId}"}).`
            : "Kiểm tra system(operation=\"status\") trước khi thực hiện thao tác khác.",
        ],
      };
    }
    if (state !== "done" || status !== "ok") {
      return this.failure(
        tool,
        input.operation,
        "job_failed",
        String(result.message || row.error || `Job state=${state || "unknown"}`),
      );
    }
    const message = String(result.message || "");
    return this.success(tool, input, {
      jobId: row.jobId,
      state,
      result: parseJobMessage(message, built.parse),
    });
  }

  private async prepareTarget(
    tool: ToolName,
    input: ToolInput,
    required: boolean,
  ): Promise<{
    input: ToolInput;
    document?: Record<string, unknown>;
    error?: undefined;
  } | {
    input?: undefined;
    document?: undefined;
    error: ToolResponse;
  }> {
    const requested = String(input.target || "").trim();
    if (!requested) {
      if (!required) return { input: { ...input, target: undefined } };
      return {
        error: this.failure(
          tool,
          input.operation,
          "target_required",
          "Thao tác ghi cần target là title hoặc full path của bản vẽ đang mở.",
          "Gọi system(operation=\"status\") để lấy documents, rồi truyền full file path khi có tên trùng.",
        ),
      };
    }

    const payload = objectValue(await this.daemon.request("/api/acad/docs", {
      timeoutMs: 5_000,
    }));
    if (payload.alive !== true) {
      return {
        error: this.failure(
          tool,
          input.operation,
          "plugin_unavailable",
          "AcadBridge chưa phản hồi danh sách bản vẽ đang mở.",
        ),
      };
    }
    const documents = Array.isArray(payload.docs)
      ? payload.docs.map(objectValue)
      : [];
    const canonicalRequested = isAbsolute(requested) && existsSync(requested)
      ? canonicalExistingPath(requested)
      : requested;
    const fileMatches = documents.filter((document) =>
      canonicalExistingPath(String(document.file || "")) === canonicalRequested);
    const matches = fileMatches.length
      ? fileMatches
      : documents.filter((document) => String(document.title || "") === requested);
    if (matches.length === 0) {
      return {
        error: this.failure(
          tool,
          input.operation,
          "target_not_found",
          `Bản vẽ target chưa mở trong AutoCAD: ${requested}`,
        ),
      };
    }
    if (matches.length > 1) {
      return {
        error: this.failure(
          tool,
          input.operation,
          "target_ambiguous",
          `Có nhiều bản vẽ cùng title '${requested}'.`,
          "Dùng full path từ system(operation=\"status\").",
        ),
      };
    }
    const document = matches[0];
    const canonical = String(document.file || document.title || requested);
    return { input: { ...input, target: canonical }, document };
  }

  private success(
    tool: ToolName,
    input: ToolInput,
    payload: unknown,
  ): ToolResponse {
    return {
      ok: true,
      supported: true,
      tool,
      operation: input.operation,
      backend: "acad-studio-daemon",
      payload,
    };
  }

  private failure(
    tool: ToolName,
    operation: string,
    code: string,
    error: string,
    hint?: string,
    supported = true,
  ): ToolResponse {
    return {
      ok: false,
      supported,
      tool,
      operation,
      backend: "acad-studio-daemon",
      code,
      error,
      hint,
    };
  }
}

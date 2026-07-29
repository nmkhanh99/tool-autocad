import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
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
  system: [
    "status", "health", "get_backend", "runtime", "init", "execute_lisp",
  ],
};

const EXPLICITLY_UNSUPPORTED: Partial<
  Record<ToolName, Record<string, string>>
> = {
  drawing: {
    plot_pdf:
      "Cần cấu hình page setup/plotter theo bản vẽ; project chưa có hợp đồng PDF tổng quát an toàn.",
  },
};

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
  system: new Set(["status", "health", "get_backend", "runtime"]),
};

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
    return this.runBuiltOperation("drawing", input);
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

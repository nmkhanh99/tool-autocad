import { createHash, randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const STANDARDS_SCHEMA_VERSION = 1 as const;
export const STANDARDS_FILE_NAME = "drawing-standards.v1.json";

export type StandardColor = string | number;
export type StandardLineweight = string | number;
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export type PaperStandard = {
  name: string;
  width: number;
  height: number;
};

export type DrawingStandard = {
  unit: string;
  insunits: number;
  linearFormat: string;
  precision: number;
  modelScale: number;
  paper: PaperStandard;
  frameTolerancePercent: number;
};

export type DimensionStandard = {
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
  textColor: StandardColor;
  alignment: string;
  arrowhead: string;
  dimensionLineColor: StandardColor;
  extensionLineColor: StandardColor;
  extendBeyondDimLines: number;
  offsetFromOrigin: number;
  textGap: number;
  rowSpacing: number;
  rowTolerance: number;
};

export type LayerStandard = {
  name: string;
  color: StandardColor;
  linetype: string;
  lineweight: StandardLineweight;
  required: boolean;
};

export type ObjectMapping = {
  id: string;
  label: string;
  kind: string;
  layerPatterns: string[];
  blockPatterns: string[];
  textPatterns: string[];
  entityTypes: string[];
  required: boolean;
  bounds?: Record<string, JsonValue>;
};

export type DrawingStandardProfile = {
  id: string;
  name: string;
  description?: string;
  createdAt: string;
  updatedAt: string;
  /** Hash NỘI DUNG. Là token so sánh của `If-Match` và của chốt lượt quét —
   *  chính xác theo nghĩa "nội dung có khác không", nhưng không đọc được. */
  revision: string;
  /** Bộ đếm phiên bản, tăng 1 mỗi lần nội dung THẬT SỰ đổi.
   *
   * Dành cho con người: `f304e8e7` không nói gì với ai, còn "phiên bản 7" thì
   * có. Nó KHÔNG thay `revision` ở vai trò chốt — lưu lại một nội dung y hệt
   * không tăng số này, nên lượt quét đang mở vẫn sống, và đó là hành vi đúng.
   *
   * Cố ý nằm NGOÀI phép tính hash: đưa vào là tự tham chiếu. */
  version: number;
  drawing: DrawingStandard;
  dimension: DimensionStandard;
  layers: LayerStandard[];
  mappings: ObjectMapping[];
};

export type StandardsState = {
  schemaVersion: typeof STANDARDS_SCHEMA_VERSION;
  profiles: DrawingStandardProfile[];
};

export type StandardsStorageOptions = {
  dataDir?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
};

type JsonRecord = Record<string, unknown>;

const MAX_PROFILES = 100;
const MAX_LAYERS = 500;
const MAX_MAPPINGS = 500;
const MAX_PATTERNS = 100;
const MAX_JSON_DEPTH = 6;
const MAX_JSON_ITEMS = 200;
const PROFILE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
const UNSAFE_JSON_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export class StandardsValidationError extends Error {
  readonly code = "standards_validation_error";

  constructor(message: string) {
    super(message);
    this.name = "StandardsValidationError";
  }
}

export class StandardsConflictError extends Error {
  readonly code = "standards_revision_conflict";

  constructor(message: string) {
    super(message);
    this.name = "StandardsConflictError";
  }
}

function validationError(path: string, message: string): never {
  throw new StandardsValidationError(`${path}: ${message}`);
}

function recordValue(value: unknown, path: string): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return validationError(path, "phải là object");
  }
  return value as JsonRecord;
}

function stringValue(
  value: unknown,
  path: string,
  options: { allowEmpty?: boolean; maxLength?: number } = {},
): string {
  if (typeof value !== "string") {
    return validationError(path, "phải là chuỗi");
  }
  const result = value.trim();
  if (!options.allowEmpty && !result) {
    return validationError(path, "không được để trống");
  }
  if (result.length > (options.maxLength ?? 160)) {
    return validationError(path, `không được dài quá ${options.maxLength ?? 160} ký tự`);
  }
  return result;
}

function optionalString(value: unknown, path: string, maxLength: number): string | undefined {
  if (value == null || value === "") return undefined;
  return stringValue(value, path, { maxLength });
}

function numberValue(
  value: unknown,
  path: string,
  options: { min?: number; max?: number; integer?: boolean } = {},
): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return validationError(path, "phải là số hữu hạn");
  }
  if (options.integer && !Number.isInteger(value)) {
    return validationError(path, "phải là số nguyên");
  }
  if (options.min != null && value < options.min) {
    return validationError(path, `phải lớn hơn hoặc bằng ${options.min}`);
  }
  if (options.max != null && value > options.max) {
    return validationError(path, `phải nhỏ hơn hoặc bằng ${options.max}`);
  }
  return value;
}

function booleanValue(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") {
    return validationError(path, "phải là boolean");
  }
  return value;
}

function standardColor(value: unknown, path: string): StandardColor {
  if (typeof value === "number") {
    return numberValue(value, path, { min: 0, max: 256, integer: true });
  }
  return stringValue(value, path, { maxLength: 64 });
}

function standardLineweight(value: unknown, path: string): StandardLineweight {
  if (typeof value === "number") {
    return numberValue(value, path, { min: 0, max: 2.11 });
  }
  return stringValue(value, path, { maxLength: 64 });
}

function isoDate(value: unknown, path: string, fallback: string): string {
  if (value == null || value === "") return fallback;
  const raw = stringValue(value, path, { maxLength: 64 });
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    return validationError(path, "không phải ngày ISO hợp lệ");
  }
  return date.toISOString();
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    return validationError(path, "phải là mảng");
  }
  if (value.length > MAX_PATTERNS) {
    return validationError(path, `không được quá ${MAX_PATTERNS} phần tử`);
  }
  return value.map((item, index) =>
    stringValue(item, `${path}[${index}]`, { maxLength: 160 }));
}

function sanitizeJson(value: unknown, path: string, depth = 0): JsonValue {
  if (depth > MAX_JSON_DEPTH) {
    return validationError(path, `không được sâu quá ${MAX_JSON_DEPTH} cấp`);
  }
  if (
    value === null
    || typeof value === "string"
    || typeof value === "boolean"
  ) {
    if (typeof value === "string" && value.length > 500) {
      return validationError(path, "chuỗi không được dài quá 500 ký tự");
    }
    return value;
  }
  if (typeof value === "number") {
    return numberValue(value, path);
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_JSON_ITEMS) {
      return validationError(path, `không được quá ${MAX_JSON_ITEMS} phần tử`);
    }
    return value.map((item, index) => sanitizeJson(item, `${path}[${index}]`, depth + 1));
  }
  const source = recordValue(value, path);
  const entries = Object.entries(source);
  if (entries.length > MAX_JSON_ITEMS) {
    return validationError(path, `không được quá ${MAX_JSON_ITEMS} thuộc tính`);
  }
  const result: Record<string, JsonValue> = {};
  for (const [key, item] of entries) {
    if (UNSAFE_JSON_KEYS.has(key)) {
      return validationError(`${path}.${key}`, "tên thuộc tính không an toàn");
    }
    const safeKey = stringValue(key, `${path} key`, { maxLength: 80 });
    result[safeKey] = sanitizeJson(item, `${path}.${safeKey}`, depth + 1);
  }
  return result;
}

function sanitizePaper(value: unknown, path: string): PaperStandard {
  const source = recordValue(value, path);
  return {
    name: stringValue(source.name, `${path}.name`, { maxLength: 64 }),
    width: numberValue(source.width, `${path}.width`, { min: 0.001, max: 1_000_000 }),
    height: numberValue(source.height, `${path}.height`, { min: 0.001, max: 1_000_000 }),
  };
}

function sanitizeDrawing(value: unknown, path: string): DrawingStandard {
  const source = recordValue(value, path);
  return {
    unit: stringValue(source.unit, `${path}.unit`, { maxLength: 24 }),
    insunits: numberValue(source.insunits, `${path}.insunits`, {
      min: 0,
      max: 24,
      integer: true,
    }),
    linearFormat: stringValue(source.linearFormat, `${path}.linearFormat`, { maxLength: 64 }),
    precision: numberValue(source.precision, `${path}.precision`, {
      min: 0,
      max: 8,
      integer: true,
    }),
    modelScale: numberValue(source.modelScale, `${path}.modelScale`, {
      min: 0.000001,
      max: 1_000_000_000,
    }),
    paper: sanitizePaper(source.paper, `${path}.paper`),
    frameTolerancePercent: numberValue(
      source.frameTolerancePercent,
      `${path}.frameTolerancePercent`,
      { min: 0, max: 100 },
    ),
  };
}

function sanitizeDimension(value: unknown, path: string): DimensionStandard {
  const source = recordValue(value, path);
  return {
    styleName: stringValue(source.styleName, `${path}.styleName`, { maxLength: 255 }),
    precision: numberValue(source.precision, `${path}.precision`, {
      min: 0,
      max: 8,
      integer: true,
    }),
    measurementScale: numberValue(source.measurementScale, `${path}.measurementScale`, {
      min: 0.000001,
      max: 1_000_000_000,
    }),
    overallScale: numberValue(source.overallScale, `${path}.overallScale`, {
      min: 0.000001,
      max: 1_000_000_000,
    }),
    fit: stringValue(source.fit, `${path}.fit`, { maxLength: 120 }),
    textVertical: stringValue(source.textVertical, `${path}.textVertical`, { maxLength: 120 }),
    textHorizontal: stringValue(source.textHorizontal, `${path}.textHorizontal`, {
      maxLength: 120,
    }),
    annotative: booleanValue(source.annotative, `${path}.annotative`),
    textHeight: numberValue(source.textHeight, `${path}.textHeight`, {
      min: 0,
      max: 1_000_000,
    }),
    font: stringValue(source.font, `${path}.font`, { allowEmpty: true, maxLength: 255 }),
    textStyle: stringValue(source.textStyle, `${path}.textStyle`, { maxLength: 255 }),
    paperTextHeight: numberValue(source.paperTextHeight, `${path}.paperTextHeight`, {
      min: 0,
      max: 1_000_000,
    }),
    widthFactor: numberValue(source.widthFactor, `${path}.widthFactor`, {
      min: 0.01,
      max: 100,
    }),
    textColor: standardColor(source.textColor, `${path}.textColor`),
    alignment: stringValue(source.alignment, `${path}.alignment`, { maxLength: 120 }),
    arrowhead: stringValue(source.arrowhead, `${path}.arrowhead`, { maxLength: 120 }),
    dimensionLineColor: standardColor(
      source.dimensionLineColor,
      `${path}.dimensionLineColor`,
    ),
    extensionLineColor: standardColor(
      source.extensionLineColor,
      `${path}.extensionLineColor`,
    ),
    extendBeyondDimLines: numberValue(
      source.extendBeyondDimLines,
      `${path}.extendBeyondDimLines`,
      { min: 0, max: 1_000_000 },
    ),
    offsetFromOrigin: numberValue(source.offsetFromOrigin, `${path}.offsetFromOrigin`, {
      min: 0,
      max: 1_000_000,
    }),
    textGap: numberValue(source.textGap, `${path}.textGap`, {
      min: 0,
      max: 1_000_000,
    }),
    rowSpacing: numberValue(source.rowSpacing, `${path}.rowSpacing`, {
      min: 0,
      max: 1_000_000,
    }),
    rowTolerance: numberValue(source.rowTolerance, `${path}.rowTolerance`, {
      min: 0,
      max: 1_000_000,
    }),
  };
}

function sanitizeLayer(value: unknown, path: string): LayerStandard {
  const source = recordValue(value, path);
  return {
    name: stringValue(source.name, `${path}.name`, { maxLength: 255 }),
    color: standardColor(source.color, `${path}.color`),
    linetype: stringValue(source.linetype, `${path}.linetype`, { maxLength: 255 }),
    lineweight: standardLineweight(source.lineweight, `${path}.lineweight`),
    required: booleanValue(source.required, `${path}.required`),
  };
}

function sanitizeMapping(value: unknown, path: string): ObjectMapping {
  const source = recordValue(value, path);
  const id = stringValue(source.id, `${path}.id`, { maxLength: 96 });
  if (!PROFILE_ID_PATTERN.test(id)) {
    return validationError(`${path}.id`, "chỉ được gồm chữ, số, dấu chấm, gạch dưới và gạch ngang");
  }
  const boundsValue = source.bounds == null
    ? undefined
    : sanitizeJson(source.bounds, `${path}.bounds`);
  if (boundsValue != null && (Array.isArray(boundsValue) || typeof boundsValue !== "object")) {
    return validationError(`${path}.bounds`, "phải là object JSON");
  }
  return {
    id,
    label: stringValue(source.label, `${path}.label`, { maxLength: 160 }),
    kind: stringValue(source.kind, `${path}.kind`, { maxLength: 64 }),
    layerPatterns: stringArray(source.layerPatterns, `${path}.layerPatterns`),
    blockPatterns: stringArray(source.blockPatterns, `${path}.blockPatterns`),
    textPatterns: stringArray(source.textPatterns, `${path}.textPatterns`),
    entityTypes: stringArray(source.entityTypes, `${path}.entityTypes`),
    required: booleanValue(source.required, `${path}.required`),
    ...(boundsValue == null
      ? {}
      : { bounds: boundsValue as Record<string, JsonValue> }),
  };
}

function assertUnique(
  values: string[],
  path: string,
  normalize: (value: string) => string = (value) => value.toLocaleUpperCase("en-US"),
): void {
  const seen = new Set<string>();
  for (const value of values) {
    const key = normalize(value);
    if (seen.has(key)) {
      validationError(path, `giá trị trùng lặp: ${value}`);
    }
    seen.add(key);
  }
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      result[key] = canonicalize(source[key]);
    }
    return result;
  }
  return value;
}

export function calculateProfileRevision(
  profile: Omit<DrawingStandardProfile, "revision" | "version"> | DrawingStandardProfile,
): string {
  const {
    revision: _revision,
    version: _version,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    ...revisionSource
  } = profile as DrawingStandardProfile;
  return createHash("sha256")
    .update(JSON.stringify(canonicalize(revisionSource)))
    .digest("hex");
}

export function sanitizeProfile(value: unknown): DrawingStandardProfile {
  const source = recordValue(value, "profile");
  const now = new Date().toISOString();
  const id = stringValue(source.id, "profile.id", { maxLength: 96 });
  if (!PROFILE_ID_PATTERN.test(id)) {
    return validationError(
      "profile.id",
      "chỉ được gồm chữ, số, dấu chấm, gạch dưới và gạch ngang",
    );
  }
  if (!Array.isArray(source.layers)) {
    return validationError("profile.layers", "phải là mảng");
  }
  if (source.layers.length > MAX_LAYERS) {
    return validationError("profile.layers", `không được quá ${MAX_LAYERS} phần tử`);
  }
  if (!Array.isArray(source.mappings)) {
    return validationError("profile.mappings", "phải là mảng");
  }
  if (source.mappings.length > MAX_MAPPINGS) {
    return validationError("profile.mappings", `không được quá ${MAX_MAPPINGS} phần tử`);
  }
  const layers = source.layers.map((item, index) =>
    sanitizeLayer(item, `profile.layers[${index}]`));
  const mappings = source.mappings.map((item, index) =>
    sanitizeMapping(item, `profile.mappings[${index}]`));
  assertUnique(layers.map((layer) => layer.name), "profile.layers.name");
  assertUnique(mappings.map((mapping) => mapping.id), "profile.mappings.id");

  const createdAt = isoDate(source.createdAt, "profile.createdAt", now);
  const withoutRevision: Omit<DrawingStandardProfile, "revision" | "version"> = {
    id,
    name: stringValue(source.name, "profile.name", { maxLength: 160 }),
    ...(optionalString(source.description, "profile.description", 1_000) == null
      ? {}
      : { description: optionalString(source.description, "profile.description", 1_000) }),
    createdAt,
    updatedAt: isoDate(source.updatedAt, "profile.updatedAt", createdAt),
    drawing: sanitizeDrawing(source.drawing, "profile.drawing"),
    dimension: sanitizeDimension(source.dimension, "profile.dimension"),
    layers,
    mappings,
  };
  /* `version` do NƠI GỌI quyết định, không tính ở đây: chỉ `upsertProfile` mới
     biết bản trước đó là gì để so nội dung và tăng số. `sanitizeProfile` chạy
     cả ở đường tạo mới lẫn đường đọc từ đĩa. */
  const version = Number.isSafeInteger(Number(source.version))
      && Number(source.version) >= 1
    ? Number(source.version)
    : 1;
  return {
    ...withoutRevision,
    revision: calculateProfileRevision(withoutRevision),
    version,
  };
}

const DEFAULT_PROFILE_SOURCE = {
  id: "default-a3-mm",
  name: "Quy chuẩn A3 — mm",
  description: "Mẫu chung cho bản vẽ hệ mét, khổ A3 nằm ngang.",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  drawing: {
    unit: "mm",
    insunits: 4,
    linearFormat: "Decimal",
    precision: 0,
    modelScale: 1,
    paper: {
      name: "A3",
      width: 420,
      height: 297,
    },
    frameTolerancePercent: 1,
  },
  dimension: {
    styleName: "ACAD-STANDARD",
    precision: 0,
    measurementScale: 1,
    overallScale: 1,
    fit: "Best fit",
    textVertical: "Above",
    textHorizontal: "Centered",
    annotative: false,
    textHeight: 2.5,
    font: "txt.shx",
    textStyle: "ACAD-DIM",
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
  },
  layers: [
    {
      name: "0",
      color: 7,
      linetype: "Continuous",
      lineweight: "Default",
      required: true,
    },
    {
      name: "KHUNG",
      color: 7,
      linetype: "Continuous",
      lineweight: 0.35,
      required: true,
    },
    {
      name: "DIM",
      color: 2,
      linetype: "Continuous",
      lineweight: 0.18,
      required: true,
    },
    {
      name: "TEXT",
      color: 7,
      linetype: "Continuous",
      lineweight: 0.18,
      required: true,
    },
    {
      name: "MAT-CAT",
      color: 1,
      linetype: "Continuous",
      lineweight: 0.5,
      required: false,
    },
  ],
  mappings: [
    {
      id: "drawing-frame",
      label: "Khung vẽ",
      kind: "frame",
      layerPatterns: ["KHUNG", "KHUNG-*", "*FRAME*"],
      blockPatterns: ["*A3*", "*KHUNG*", "*FRAME*"],
      textPatterns: [],
      entityTypes: ["INSERT", "LWPOLYLINE", "POLYLINE"],
      required: true,
      bounds: {
        width: 420,
        height: 297,
        tolerancePercent: 1,
        unit: "mm",
      },
    },
    {
      id: "living-room",
      label: "Phòng khách",
      kind: "room",
      layerPatterns: ["PHONG", "ROOM", "A-ROOM", "TEXT"],
      blockPatterns: ["*PHONG_KHACH*", "*LIVING*"],
      textPatterns: ["*PHÒNG KHÁCH*", "*PHONG KHACH*"],
      entityTypes: ["LWPOLYLINE", "POLYLINE", "HATCH", "TEXT", "MTEXT", "INSERT"],
      required: false,
      bounds: {
        minArea: 6,
        maxArea: 80,
        areaUnit: "m2",
      },
    },
    {
      id: "section-plane",
      label: "Mặt phẳng cắt",
      kind: "cut-plane",
      layerPatterns: ["MAT-CAT", "*CUT*", "*SECTION*"],
      blockPatterns: ["*MAT_CAT*", "*SECTION*"],
      textPatterns: [],
      entityTypes: ["LINE", "LWPOLYLINE", "INSERT"],
      required: false,
    },
  ],
};

export const DEFAULT_PROFILE: DrawingStandardProfile = sanitizeProfile(DEFAULT_PROFILE_SOURCE);

const STORAGE_OPTION_KEYS = new Set(["dataDir", "env", "homeDir"]);

export function resolveStandardsDataDir(
  options: StandardsStorageOptions = {},
): string {
  /* Khoá lạ = LỖI, không phải "bỏ qua".
   *
   * Hàm này lùi về kho THẬT của người dùng khi không có `dataDir`. Một script
   * kiểm thử gõ nhầm tên khoá (`dir` thay vì `dataDir`) vì thế không hỏng, không
   * báo gì — nó lặng lẽ đọc và GHI vào hồ sơ thật. Đúng chuyện đã xảy ra ngày
   * 2026-08-17: một script đo hành vi xoá đã xoá hồ sơ thật của người dùng, và
   * không có bản sao nào để lấy lại.
   *
   * TypeScript chặn được ca này ở `.ts`, nhưng mọi script kiểm thử của dự án là
   * `.mjs` — tức đúng những nơi hay truyền tuỳ chọn kho nhất thì không có kiểu.
   * Chốt phải nằm ở lúc chạy. */
  for (const key of Object.keys(options)) {
    if (!STORAGE_OPTION_KEYS.has(key)) {
      throw new StandardsValidationError(
        `Tuỳ chọn kho không hợp lệ: "${key}". Chỉ nhận ${[...STORAGE_OPTION_KEYS].join(", ")}.`
        + " Gõ nhầm tên khoá sẽ ghi vào kho hồ sơ THẬT của người dùng.",
      );
    }
  }
  if (options.dataDir?.trim()) return options.dataDir.trim();
  const env = options.env ?? process.env;
  const configured = env.ACAD_DATA_DIR?.trim() || env.MEP_DATA_DIR?.trim();
  if (configured) return configured;
  return join(
    options.homeDir ?? homedir(),
    "Library",
    "Application Support",
    "acad-studio",
  );
}

export function standardsFilePath(options: StandardsStorageOptions = {}): string {
  return join(resolveStandardsDataDir(options), STANDARDS_FILE_NAME);
}

function sanitizeState(value: unknown): StandardsState {
  const source = recordValue(value, "standards");
  if (
    source.schemaVersion != null
    && source.schemaVersion !== STANDARDS_SCHEMA_VERSION
  ) {
    return validationError(
      "standards.schemaVersion",
      `chỉ hỗ trợ phiên bản ${STANDARDS_SCHEMA_VERSION}`,
    );
  }
  if (!Array.isArray(source.profiles)) {
    return validationError("standards.profiles", "phải là mảng");
  }
  if (source.profiles.length > MAX_PROFILES) {
    return validationError("standards.profiles", `không được quá ${MAX_PROFILES} phần tử`);
  }
  const profiles = source.profiles.map((profile) => sanitizeProfile(profile));
  assertUnique(profiles.map((profile) => profile.id), "standards.profiles.id", (id) => id);
  return {
    schemaVersion: STANDARDS_SCHEMA_VERSION,
    profiles,
  };
}

function writeStateAtomic(state: StandardsState, options: StandardsStorageOptions): void {
  const dataDir = resolveStandardsDataDir(options);
  const filePath = join(dataDir, STANDARDS_FILE_NAME);
  const temporaryPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  mkdirSync(dataDir, { recursive: true });
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    renameSync(temporaryPath, filePath);
  } catch (error) {
    if (existsSync(temporaryPath)) {
      try {
        unlinkSync(temporaryPath);
      } catch {
        // Preserve the original persistence error.
      }
    }
    throw error;
  }
}

export function loadStandardsState(
  options: StandardsStorageOptions = {},
): StandardsState {
  const filePath = standardsFilePath(options);
  if (!existsSync(filePath)) {
    return sanitizeState({
      schemaVersion: STANDARDS_SCHEMA_VERSION,
      profiles: [DEFAULT_PROFILE],
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(filePath, "utf8")) as unknown;
  } catch (error) {
    throw new StandardsValidationError(
      `Không đọc được ${STANDARDS_FILE_NAME}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return sanitizeState(parsed);
}

export function saveStandardsState(
  state: StandardsState,
  options: StandardsStorageOptions = {},
): StandardsState {
  const sanitized = sanitizeState(state);
  writeStateAtomic(sanitized, options);
  return sanitized;
}

export function loadProfiles(
  options: StandardsStorageOptions = {},
): DrawingStandardProfile[] {
  return loadStandardsState(options).profiles;
}

export function saveProfiles(
  profiles: DrawingStandardProfile[],
  options: StandardsStorageOptions = {},
): DrawingStandardProfile[] {
  return saveStandardsState({
    schemaVersion: STANDARDS_SCHEMA_VERSION,
    profiles,
  }, options).profiles;
}

export function getProfile(
  id?: string,
  options: StandardsStorageOptions = {},
): DrawingStandardProfile | undefined {
  const profiles = loadStandardsState(options).profiles;
  if (!id) return profiles[0];
  return profiles.find((profile) => profile.id === id);
}

export function upsertProfile(
  value: unknown,
  expectedRevision?: string,
  options: StandardsStorageOptions = {},
): DrawingStandardProfile {
  const state = loadStandardsState(options);
  const source = recordValue(value, "profile");
  const id = stringValue(source.id, "profile.id", { maxLength: 96 });
  const index = state.profiles.findIndex((profile) => profile.id === id);
  const existing = index >= 0 ? state.profiles[index] : undefined;
  if (expectedRevision != null && existing?.revision !== expectedRevision) {
    throw new StandardsConflictError(`Profile ${id} đã thay đổi; hãy tải lại trước khi lưu.`);
  }
  const now = new Date().toISOString();
  /* Dựng một lần để BIẾT nội dung mới, rồi mới quyết `version`. Tăng số theo
     mỗi lần bấm Lưu là sai: lưu lại một nội dung y hệt sẽ giết mọi lượt quét
     đang mở mà chẳng có gì thay đổi. */
  const draft = sanitizeProfile({
    ...source,
    id,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    version: existing?.version ?? 1,
  });
  const contentChanged = !existing || existing.revision !== draft.revision;
  const profile: DrawingStandardProfile = contentChanged
    ? { ...draft, version: (existing?.version ?? 0) + 1 }
    : draft;
  if (index >= 0) state.profiles[index] = profile;
  else state.profiles.push(profile);
  saveStandardsState(state, options);
  return profile;
}

function slugifyProfileId(name: string): string {
  const slug = name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/gi, "d")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || "profile";
}

export function createProfile(
  name: string,
  sourceId?: string,
  options: StandardsStorageOptions = {},
): DrawingStandardProfile {
  const cleanName = stringValue(name, "name", { maxLength: 160 });
  const state = loadStandardsState(options);
  const source = sourceId
    ? state.profiles.find((profile) => profile.id === sourceId)
    : DEFAULT_PROFILE;
  if (!source) {
    throw new StandardsValidationError(`Không tìm thấy profile nguồn: ${sourceId}`);
  }
  const baseId = slugifyProfileId(cleanName);
  let id = baseId;
  while (state.profiles.some((profile) => profile.id === id)) {
    id = `${baseId.slice(0, 78)}-${randomUUID().slice(0, 8)}`;
  }
  const now = new Date().toISOString();
  const profile = sanitizeProfile({
    ...source,
    id,
    name: cleanName,
    createdAt: now,
    updatedAt: now,
    /* Hồ sơ MỚI luôn bắt đầu từ 1, kể cả khi chép từ một bản đang ở v7. Thừa kế
       số của nguồn làm lần sửa đầu tiên của nó thành v8 — một lịch sử không có
       thật, và người dùng đọc "phiên bản 8" cho một hồ sơ vừa tạo. */
    version: 1,
  });
  state.profiles.push(profile);
  saveStandardsState(state, options);
  return profile;
}

export function duplicateProfile(
  sourceId: string,
  name?: string,
  options: StandardsStorageOptions = {},
): DrawingStandardProfile {
  const source = getProfile(sourceId, options);
  if (!source) {
    throw new StandardsValidationError(`Không tìm thấy profile nguồn: ${sourceId}`);
  }
  return createProfile(name?.trim() || `${source.name} (bản sao)`, sourceId, options);
}

export function deleteProfile(
  id: string,
  expectedRevision?: string,
  options: StandardsStorageOptions = {},
): boolean {
  const state = loadStandardsState(options);
  const index = state.profiles.findIndex((profile) => profile.id === id);
  if (index < 0) return false;
  if (expectedRevision != null && state.profiles[index]?.revision !== expectedRevision) {
    throw new StandardsConflictError(`Profile ${id} đã thay đổi; hãy tải lại trước khi xóa.`);
  }
  state.profiles.splice(index, 1);
  saveStandardsState(state, options);
  return true;
}

export const layersSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["schemaVersion", "layers"],
  properties: {
    schemaVersion: { const: 1 },
    layers: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name", "visible", "frozen", "locked", "plot", "colorArgb"],
        properties: {
          id: { type: "string", minLength: 1 },
          sourceHandle: { type: "string", minLength: 1 },
          name: { type: "string" },
          visible: { type: "boolean" },
          frozen: { type: "boolean" },
          locked: { type: "boolean" },
          plot: { type: "boolean" },
          colorArgb: { type: "integer", minimum: 0, maximum: 4_294_967_295 },
          transparency: { type: "integer", minimum: 0, maximum: 255 },
          lineWeightMm: { type: "number", minimum: 0 },
          linetype: { type: "string" },
        },
        additionalProperties: true,
      },
    },
  },
  additionalProperties: true,
} as const;

export const exportReportSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["schemaVersion", "status", "counts", "issues"],
  properties: {
    schemaVersion: { const: 1 },
    status: { enum: ["complete", "partial", "failed"] },
    counts: {
      type: "object",
      required: ["exported", "skipped", "warnings", "errors"],
      properties: {
        exported: { type: "integer", minimum: 0 },
        skipped: { type: "integer", minimum: 0 },
        warnings: { type: "integer", minimum: 0 },
        errors: { type: "integer", minimum: 0 },
      },
      additionalProperties: true,
    },
    issues: {
      type: "array",
      items: {
        type: "object",
        required: ["severity", "code", "message"],
        properties: {
          severity: { enum: ["warning", "error"] },
          code: { type: "string", minLength: 1 },
          message: { type: "string", minLength: 1 },
          entityKind: { type: "string", minLength: 1 },
          sourceHandle: { type: "string", minLength: 1 },
        },
        additionalProperties: true,
      },
    },
  },
  additionalProperties: true,
} as const;

const deltaCountsSchema = {
  type: "object",
  required: ["entities", "blocks", "layers"],
  properties: {
    entities: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    blocks: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    layers: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
  },
  additionalProperties: false,
} as const;

const deltaFileSchema = {
  type: "object",
  required: ["path", "encoding", "size", "sha256"],
  properties: {
    path: {
      type: "string",
      minLength: 1,
      pattern: "^(?!/)(?![A-Za-z]:)(?!.*\\\\)(?!\\.\\.?$)(?!\\.\\.?/)(?!.*\\/\\.\\.?/)(?!.*\\/\\.\\.?$)(?!.*//)(?!.*\\/$).+$",
    },
    encoding: { type: "string", minLength: 1 },
    size: { type: "integer", minimum: 0, maximum: Number.MAX_SAFE_INTEGER },
    sha256: { type: "string", pattern: "^[0-9a-f]{64}$" },
    schemaVersion: { type: "integer", minimum: 1 },
    byteOrder: { enum: ["little-endian"] },
  },
  additionalProperties: true,
} as const;

const deltaJsonFileSchema = {
  allOf: [
    deltaFileSchema,
    { properties: { encoding: { const: "json" } } },
  ],
} as const;

const deltaFlatBuffersFileSchema = {
  allOf: [
    deltaFileSchema,
    {
      required: ["schemaVersion", "byteOrder"],
      properties: {
        encoding: { const: "flatbuffers" },
        schemaVersion: { const: 1 },
        byteOrder: { const: "little-endian" },
      },
    },
  ],
} as const;

export const deltaManifestSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: [
    "format",
    "formatVersion",
    "changeSetId",
    "drawingId",
    "sourceFingerprint",
    "modelEpoch",
    "baseRevision",
    "trigger",
    "upserts",
    "deletes",
    "modelEmpty",
    "resultExtents",
    "files",
  ],
  properties: {
    format: { const: "cadweb-delta" },
    formatVersion: {
      type: "object",
      required: ["major", "minor"],
      properties: {
        major: { type: "integer", minimum: 1 },
        minor: { type: "integer", minimum: 0 },
      },
      additionalProperties: true,
    },
    changeSetId: { type: "string", minLength: 1 },
    drawingId: { type: "string", minLength: 1 },
    sourceFingerprint: { type: "string", minLength: 1 },
    modelEpoch: { type: "string", minLength: 1 },
    baseRevision: { type: "integer", minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
    trigger: {
      type: "object",
      required: ["kind", "savedAt"],
      properties: {
        kind: { type: "string", minLength: 1 },
        savedAt: { type: "string", minLength: 1 },
      },
      additionalProperties: true,
    },
    upserts: deltaCountsSchema,
    deletes: deltaCountsSchema,
    modelEmpty: { type: "boolean" },
    resultExtents: {
      type: "object",
      required: ["min", "max"],
      properties: {
        min: {
          type: "array",
          items: [{ type: "number" }, { type: "number" }, { type: "number" }],
          additionalItems: false,
          minItems: 3,
          maxItems: 3,
        },
        max: {
          type: "array",
          items: [{ type: "number" }, { type: "number" }, { type: "number" }],
          additionalItems: false,
          minItems: 3,
          maxItems: 3,
        },
      },
      additionalProperties: true,
    },
    files: {
      type: "object",
      required: ["exportReport"],
      properties: {
        entities: deltaFlatBuffersFileSchema,
        blocks: deltaFlatBuffersFileSchema,
        layers: deltaJsonFileSchema,
        tombstones: deltaJsonFileSchema,
        exportReport: deltaJsonFileSchema,
      },
      additionalProperties: false,
    },
    revision: false,
  },
  additionalProperties: true,
} as const;

export const tombstonesSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["schemaVersion", "keys"],
  properties: {
    schemaVersion: { const: 1 },
    keys: {
      type: "array",
      items: { type: "string", minLength: 1 },
    },
  },
  additionalProperties: true,
} as const;

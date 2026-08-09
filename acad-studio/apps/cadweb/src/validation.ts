import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";
import manifestSchema from "./generated/manifest.schema.json";

import { CadWebError } from "./errors";
import { exportReportSchema, layersSchema } from "./schemas";
import type { CadWebExportReport, CadWebLayers, CadWebManifest } from "./types";

const ajv = new Ajv({ allErrors: true, strict: false });
const manifestValidator = ajv.compile(manifestSchema);
const layersValidator = ajv.compile(layersSchema);
const reportValidator = ajv.compile(exportReportSchema);
const utf8 = new TextDecoder("utf-8", { fatal: true });

function describeErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
}

function containsNonFiniteNumber(value: unknown): boolean {
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    const current = pending.pop();
    if (typeof current === "number" && !Number.isFinite(current)) return true;
    if (Array.isArray(current)) {
      for (const item of current) pending.push(item);
    } else if (current !== null && typeof current === "object") {
      for (const item of Object.values(current)) pending.push(item);
    }
  }
  return false;
}

function validate<T>(
  value: unknown,
  validator: ValidateFunction,
  label: string,
): asserts value is T {
  if (!validator(value)) {
    throw new CadWebError(
      label === "manifest.json" ? "MANIFEST_INVALID" : "PAYLOAD_INVALID",
      `${label} does not match the CADWeb v1 schema: ${describeErrors(validator.errors)}`,
    );
  }
}

export function parseJson(bytes: Uint8Array, label: string): unknown {
  try {
    return JSON.parse(utf8.decode(bytes));
  } catch (cause) {
    throw new CadWebError("PAYLOAD_INVALID", `${label} is not valid UTF-8 JSON`, { cause });
  }
}

export function validateManifest(value: unknown): CadWebManifest {
  validate<CadWebManifest>(value, manifestValidator, "manifest.json");
  if (value.formatVersion.major !== 1) {
    throw new CadWebError(
      "VERSION_UNSUPPORTED",
      `CADWeb major version ${value.formatVersion.major} is not supported`,
    );
  }
  if (containsNonFiniteNumber(value)) {
    throw new CadWebError(
      "MANIFEST_INVALID",
      "manifest must contain only finite numbers",
    );
  }
  for (let axis = 0; axis < 3; axis += 1) {
    if (value.extents.min[axis] > value.extents.max[axis]) {
      throw new CadWebError("MANIFEST_INVALID", "manifest extents min must not exceed max");
    }
  }
  const revisionBound = value.syncBinding !== undefined || value.checkpointBinding !== undefined;
  if (value.modelEmpty !== undefined && !revisionBound) {
    throw new CadWebError(
      "MANIFEST_INVALID",
      "modelEmpty is only valid for a revision-bound snapshot",
    );
  }
  if (revisionBound) {
    if (value.formatVersion.minor < 1 || value.modelEmpty === undefined) {
      throw new CadWebError(
        "MANIFEST_INVALID",
        "revision-bound snapshots require CADWeb 1.1 and modelEmpty",
      );
    }
    const revision = value.syncBinding?.baseRevision ?? value.checkpointBinding?.revision;
    if (!Number.isSafeInteger(revision)) {
      throw new CadWebError(
        "MANIFEST_INVALID",
        "snapshot binding revision must be a safe integer",
      );
    }
    if (value.modelEmpty) {
      const coordinates = [...value.extents.min, ...value.extents.max];
      if (!coordinates.every((coordinate) => Object.is(coordinate, 0))) {
        throw new CadWebError(
          "MANIFEST_INVALID",
          "an empty sync model must use canonical positive-zero extents",
        );
      }
    }
  }
  return value;
}

export function validateLayers(value: unknown): CadWebLayers {
  validate<CadWebLayers>(value, layersValidator, "layers.json");
  const ids = new Set<string>();
  for (const layer of value.layers) {
    if (ids.has(layer.id)) {
      throw new CadWebError("PAYLOAD_INVALID", `layers.json contains duplicate id ${layer.id}`);
    }
    ids.add(layer.id);
  }
  return value;
}

export function validateExportReport(value: unknown): CadWebExportReport {
  validate<CadWebExportReport>(value, reportValidator, "export-report.json");
  const warnings = value.issues.filter((issue) => issue.severity === "warning").length;
  const errors = value.issues.filter((issue) => issue.severity === "error").length;
  if (warnings !== value.counts.warnings || errors !== value.counts.errors) {
    throw new CadWebError(
      "PAYLOAD_INVALID",
      "export-report.json issue totals do not match counts",
    );
  }
  return value;
}

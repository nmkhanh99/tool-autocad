import Ajv, { type ErrorObject, type ValidateFunction } from "ajv";

import { CadWebError } from "./errors";
import { deltaManifestSchema, tombstonesSchema } from "./schemas";
import type {
  CadWebDeltaDocument,
  CadWebDeltaManifest,
  CadWebObjectKind,
  CadWebTombstones,
} from "./types";

const ajv = new Ajv({ allErrors: true, strict: false });
const deltaManifestValidator = ajv.compile(deltaManifestSchema);
const tombstonesValidator = ajv.compile(tombstonesSchema);
const canonicalKeyPattern = /^(entity|block|layer):([1-9A-F][0-9A-F]*)$/;

function describeErrors(errors: ErrorObject[] | null | undefined): string {
  return (errors ?? [])
    .map((error) => `${error.instancePath || "/"} ${error.message ?? "is invalid"}`)
    .join("; ");
}

function assertSchema<T>(
  value: unknown,
  validator: ValidateFunction,
  label: string,
): asserts value is T {
  if (!validator(value)) {
    throw new CadWebError(
      "DELTA_INVALID",
      `${label} does not match the CADWeb delta v1 schema: ${describeErrors(validator.errors)}`,
    );
  }
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

function isPositiveZero(value: number): boolean {
  return Object.is(value, 0);
}

export interface CanonicalObjectKey {
  kind: CadWebObjectKind;
  sourceHandle: string;
}

export function normalizeSourceHandle(sourceHandle: string): string {
  const match = /^(?:0[xX])?([0-9a-fA-F]+)$/.exec(sourceHandle);
  if (!match) {
    throw new CadWebError("DELTA_INVALID", "source handle must contain only hexadecimal digits");
  }
  const normalized = match[1]!.replace(/^0+/, "").toUpperCase();
  if (normalized.length === 0) {
    throw new CadWebError("DELTA_INVALID", "source handle must not be zero");
  }
  return normalized;
}

export function canonicalObjectKey(
  kind: CadWebObjectKind,
  sourceHandle: string,
): string {
  return `${kind}:${normalizeSourceHandle(sourceHandle)}`;
}

export function parseCanonicalObjectKey(key: string, label = "object key"): CanonicalObjectKey {
  const match = canonicalKeyPattern.exec(key);
  if (!match) {
    throw new CadWebError(
      "DELTA_INVALID",
      `${label} must use kind:UPPERCASE_HEX_HANDLE canonical form without leading zeros`,
    );
  }
  return {
    kind: match[1] as CadWebObjectKind,
    sourceHandle: match[2]!,
  };
}

function validateDescriptorPresence(change: CadWebDeltaManifest): void {
  for (const role of ["entities", "blocks", "layers"] as const) {
    const count = change.upserts[role];
    const present = change.files[role] !== undefined;
    if ((count > 0) !== present) {
      throw new CadWebError(
        "DELTA_INVALID",
        `upserts.${role} must be positive if and only if files.${role} is present`,
      );
    }
  }
  const deleteCount =
    change.deletes.entities + change.deletes.blocks + change.deletes.layers;
  if ((deleteCount > 0) !== (change.files.tombstones !== undefined)) {
    throw new CadWebError(
      "DELTA_INVALID",
      "delete count must be positive if and only if files.tombstones is present",
    );
  }
  const upsertCount =
    change.upserts.entities + change.upserts.blocks + change.upserts.layers;
  if (upsertCount + deleteCount === 0) {
    throw new CadWebError("DELTA_INVALID", "change set must contain at least one operation");
  }
}

export function validateDeltaManifest(value: unknown): CadWebDeltaManifest {
  assertSchema<CadWebDeltaManifest>(value, deltaManifestValidator, "change.json");
  if (value.formatVersion.major !== 1) {
    throw new CadWebError(
      "VERSION_UNSUPPORTED",
      `CADWeb delta major version ${value.formatVersion.major} is not supported`,
    );
  }
  if (containsNonFiniteNumber(value)) {
    throw new CadWebError("DELTA_INVALID", "change.json must contain only finite numbers");
  }
  for (let axis = 0; axis < 3; axis += 1) {
    if (value.resultExtents.min[axis] > value.resultExtents.max[axis]) {
      throw new CadWebError("DELTA_INVALID", "resultExtents min must not exceed max");
    }
  }
  if (value.modelEmpty) {
    if (
      !value.resultExtents.min.every(isPositiveZero) ||
      !value.resultExtents.max.every(isPositiveZero)
    ) {
      throw new CadWebError(
        "DELTA_INVALID",
        "an empty model must use the canonical positive-zero resultExtents",
      );
    }
    if (value.upserts.entities !== 0) {
      throw new CadWebError("DELTA_INVALID", "an empty model cannot upsert top-level entities");
    }
  }
  validateDescriptorPresence(value);
  return value;
}

export function validateTombstones(value: unknown): CadWebTombstones {
  assertSchema<CadWebTombstones>(value, tombstonesValidator, "tombstones.json");
  let previous: string | undefined;
  for (const [index, key] of value.keys.entries()) {
    parseCanonicalObjectKey(key, `tombstones.keys[${index}]`);
    if (previous !== undefined && previous >= key) {
      throw new CadWebError(
        "DELTA_INVALID",
        "tombstones.json keys must be unique and sorted lexicographically",
      );
    }
    previous = key;
  }
  return value;
}

function assertSourceHandle(
  key: string,
  sourceHandle: string | undefined,
  expectedKind: CadWebObjectKind,
  label: string,
): void {
  const canonical = parseCanonicalObjectKey(key, `${label}.id`);
  if (canonical.kind !== expectedKind) {
    throw new CadWebError(
      "DELTA_INVALID",
      `${label}.id must use the ${expectedKind} namespace`,
    );
  }
  if (sourceHandle !== canonical.sourceHandle) {
    throw new CadWebError(
      "DELTA_INVALID",
      `${label}.sourceHandle must match its canonical id`,
    );
  }
}

type DeltaPayloads = Pick<
  CadWebDeltaDocument,
  "entities" | "blocks" | "layers" | "tombstones"
>;

export function validateDeltaPayloads(
  change: CadWebDeltaManifest,
  payloads: DeltaPayloads,
): void {
  const entities = payloads.entities?.entities ?? [];
  const blocks = payloads.blocks?.blocks ?? [];
  const layers = payloads.layers?.layers ?? [];
  const tombstones = payloads.tombstones?.keys ?? [];

  if (payloads.entities && payloads.entities.blocks.length !== 0) {
    throw new CadWebError("DELTA_INVALID", "entities.bin cannot contain block definitions");
  }
  if (payloads.blocks && payloads.blocks.entities.length !== 0) {
    throw new CadWebError("DELTA_INVALID", "blocks.bin cannot contain top-level entities");
  }
  for (const [actual, expected, label] of [
    [entities.length, change.upserts.entities, "entities.bin"],
    [blocks.length, change.upserts.blocks, "blocks.bin"],
    [layers.length, change.upserts.layers, "layers.json"],
  ] as const) {
    if (actual !== expected) {
      throw new CadWebError(
        "DELTA_INVALID",
        `${label} item count ${actual} does not match change.json count ${expected}`,
      );
    }
  }

  const upsertKeys = new Set<string>();
  const objectIds = new Set<string>();
  const addObjectId = (id: string, label: string): void => {
    if (objectIds.has(id)) {
      throw new CadWebError("DELTA_INVALID", `duplicate object id ${id} in ${label}`);
    }
    objectIds.add(id);
  };
  const addUpsert = (key: string, label: string): void => {
    if (upsertKeys.has(key)) {
      throw new CadWebError("DELTA_INVALID", `duplicate upsert key ${key} in ${label}`);
    }
    upsertKeys.add(key);
  };

  for (const [index, entity] of entities.entries()) {
    const label = `entities.bin entities[${index}]`;
    assertSourceHandle(entity.id, entity.sourceHandle, "entity", label);
    if (parseCanonicalObjectKey(entity.layerId, `${label}.layerId`).kind !== "layer") {
      throw new CadWebError("DELTA_INVALID", `${label}.layerId must be a layer key`);
    }
    if (entity.blockDefinitionId !== undefined) {
      const definition = parseCanonicalObjectKey(
        entity.blockDefinitionId,
        `${label}.blockDefinitionId`,
      );
      if (definition.kind !== "block") {
        throw new CadWebError("DELTA_INVALID", `${label}.blockDefinitionId must be a block key`);
      }
    }
    addUpsert(entity.id, label);
    addObjectId(entity.id, label);
    for (const attribute of entity.attributes) {
      if (parseCanonicalObjectKey(attribute.id, `${label} attribute id`).kind !== "entity") {
        throw new CadWebError("DELTA_INVALID", `${label} attribute id must be an entity key`);
      }
      addObjectId(attribute.id, label);
    }
  }
  for (const [blockIndex, block] of blocks.entries()) {
    const label = `blocks.bin blocks[${blockIndex}]`;
    assertSourceHandle(block.id, block.sourceHandle, "block", label);
    addUpsert(block.id, label);
    for (const [entityIndex, entity] of block.entities.entries()) {
      const entityLabel = `${label}.entities[${entityIndex}]`;
      assertSourceHandle(entity.id, entity.sourceHandle, "entity", entityLabel);
      if (parseCanonicalObjectKey(entity.layerId, `${entityLabel}.layerId`).kind !== "layer") {
        throw new CadWebError("DELTA_INVALID", `${entityLabel}.layerId must be a layer key`);
      }
      if (entity.blockDefinitionId !== undefined) {
        const definition = parseCanonicalObjectKey(
          entity.blockDefinitionId,
          `${entityLabel}.blockDefinitionId`,
        );
        if (definition.kind !== "block") {
          throw new CadWebError(
            "DELTA_INVALID",
            `${entityLabel}.blockDefinitionId must be a block key`,
          );
        }
      }
      addObjectId(entity.id, entityLabel);
      for (const attribute of entity.attributes) {
        if (
          parseCanonicalObjectKey(attribute.id, `${entityLabel} attribute id`).kind !== "entity"
        ) {
          throw new CadWebError(
            "DELTA_INVALID",
            `${entityLabel} attribute id must be an entity key`,
          );
        }
        addObjectId(attribute.id, entityLabel);
      }
    }
  }
  for (const [index, layer] of layers.entries()) {
    const label = `layers.json layers[${index}]`;
    assertSourceHandle(layer.id, layer.sourceHandle, "layer", label);
    addUpsert(layer.id, label);
  }

  const deletedCounts = { entities: 0, blocks: 0, layers: 0 };
  for (const key of tombstones) {
    const { kind } = parseCanonicalObjectKey(key);
    const role = kind === "entity" ? "entities" : `${kind}s` as "blocks" | "layers";
    deletedCounts[role] += 1;
    if (upsertKeys.has(key) || objectIds.has(key)) {
      throw new CadWebError(
        "DELTA_INVALID",
        `canonical key ${key} cannot be contained in an upsert and a tombstone`,
      );
    }
  }
  for (const role of ["entities", "blocks", "layers"] as const) {
    if (deletedCounts[role] !== change.deletes[role]) {
      throw new CadWebError(
        "DELTA_INVALID",
        `tombstone ${role} count ${deletedCounts[role]} does not match change.json count ${change.deletes[role]}`,
      );
    }
  }
}

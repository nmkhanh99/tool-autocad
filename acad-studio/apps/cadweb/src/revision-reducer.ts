import { EntityKind, SpaceKind } from "./generated/cad-web/v1";

import { parseCanonicalObjectKey } from "./delta-validation";
import { CadWebError } from "./errors";
import type {
  CadWebBlockDefinition,
  CadWebDeltaDocument,
  CadWebEntity,
  CadWebLayer,
  CadWebRevisionState,
  Vec3,
} from "./types";

function revisionMismatch(message: string): never {
  throw new CadWebError("REVISION_MISMATCH", message);
}

function assertCanonicalSource(
  id: string,
  sourceHandle: string | undefined,
  expectedKind: "entity" | "block" | "layer",
  label: string,
): void {
  const canonical = parseCanonicalObjectKey(id, label);
  if (canonical.kind !== expectedKind || canonical.sourceHandle !== sourceHandle) {
    throw new CadWebError(
      "GEOMETRY_INVALID",
      `${label} does not match its ${expectedKind} sourceHandle`,
    );
  }
}

function validateCanonicalMap<T extends { id: string; sourceHandle?: string }>(
  values: ReadonlyMap<string, T>,
  kind: "entity" | "block" | "layer",
): void {
  for (const [key, value] of values) {
    if (key !== value.id) {
      throw new CadWebError("GEOMETRY_INVALID", `${kind} map key ${key} does not match value id`);
    }
    assertCanonicalSource(value.id, value.sourceHandle, kind, `${kind} id ${value.id}`);
  }
}

function validateReferences(
  entities: ReadonlyMap<string, CadWebEntity>,
  blocks: ReadonlyMap<string, CadWebBlockDefinition>,
  layers: ReadonlyMap<string, CadWebLayer>,
): void {
  validateCanonicalMap(entities, "entity");
  validateCanonicalMap(blocks, "block");
  validateCanonicalMap(layers, "layer");

  const objectIds = new Set<string>();
  const validateEntities = (values: Iterable<CadWebEntity>, insideBlock: boolean): void => {
    for (const entity of values) {
      assertCanonicalSource(entity.id, entity.sourceHandle, "entity", `entity ${entity.id}`);
      if (objectIds.has(entity.id)) {
        throw new CadWebError("GEOMETRY_INVALID", `duplicate entity id ${entity.id}`);
      }
      objectIds.add(entity.id);
      for (const attribute of entity.attributes) {
        if (parseCanonicalObjectKey(attribute.id, `attribute ${attribute.id}`).kind !== "entity") {
          throw new CadWebError(
            "GEOMETRY_INVALID",
            `attribute ${attribute.id} must use the entity namespace`,
          );
        }
        if (objectIds.has(attribute.id)) {
          throw new CadWebError("GEOMETRY_INVALID", `duplicate object id ${attribute.id}`);
        }
        objectIds.add(attribute.id);
      }
      if (!layers.has(entity.layerId)) {
        throw new CadWebError(
          "GEOMETRY_INVALID",
          `entity ${entity.id} references missing layer ${entity.layerId}`,
        );
      }
      if (insideBlock && entity.space !== SpaceKind.BlockDefinition) {
        throw new CadWebError(
          "GEOMETRY_INVALID",
          `block entity ${entity.id} must use BlockDefinition space`,
        );
      }
      if (!insideBlock && entity.space === SpaceKind.BlockDefinition) {
        throw new CadWebError(
          "GEOMETRY_INVALID",
          `top-level entity ${entity.id} cannot use BlockDefinition space`,
        );
      }
      if (
        entity.kind === EntityKind.BlockReference &&
        !blocks.has(entity.blockDefinitionId ?? "")
      ) {
        throw new CadWebError(
          "GEOMETRY_INVALID",
          `entity ${entity.id} references missing block ${entity.blockDefinitionId ?? ""}`,
        );
      }
    }
  };
  validateEntities(entities.values(), false);
  for (const block of blocks.values()) validateEntities(block.entities, true);

  const graph = new Map<string, string[]>();
  for (const block of blocks.values()) {
    graph.set(
      block.id,
      block.entities
        .filter((entity) => entity.kind === EntityKind.BlockReference)
        .map((entity) => entity.blockDefinitionId!),
    );
  }
  const state = new Map<string, 1 | 2>();
  for (const start of graph.keys()) {
    if (state.has(start)) continue;
    state.set(start, 1);
    const stack: Array<{ id: string; childIndex: number }> = [{ id: start, childIndex: 0 }];
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      const children = graph.get(frame.id) ?? [];
      if (frame.childIndex >= children.length) {
        state.set(frame.id, 2);
        stack.pop();
        continue;
      }
      const child = children[frame.childIndex++]!;
      if (state.get(child) === 1) {
        throw new CadWebError("GEOMETRY_INVALID", `block reference cycle includes ${child}`);
      }
      if (!state.has(child)) {
        state.set(child, 1);
        stack.push({ id: child, childIndex: 0 });
      }
    }
  }
}

function copyVec3(value: Vec3): Vec3 {
  return [value[0], value[1], value[2]];
}

export function applyCadWebDelta(
  current: CadWebRevisionState,
  delta: CadWebDeltaDocument,
): CadWebRevisionState {
  const { change } = delta;
  if (change.drawingId !== current.drawingId) {
    revisionMismatch(
      `delta drawing ${change.drawingId} does not match current drawing ${current.drawingId}`,
    );
  }
  if (change.sourceFingerprint !== current.sourceFingerprint) {
    revisionMismatch("delta source fingerprint does not match the current drawing binding");
  }
  if (change.modelEpoch !== current.modelEpoch) {
    revisionMismatch(
      `delta model epoch ${change.modelEpoch} does not match current epoch ${current.modelEpoch}`,
    );
  }
  if (change.baseRevision !== current.revision) {
    revisionMismatch(
      `delta base revision ${change.baseRevision} does not match current revision ${current.revision}`,
    );
  }
  if (!Number.isSafeInteger(current.revision) || current.revision < 0) {
    revisionMismatch("current revision must be a non-negative safe integer");
  }
  if (current.revision === Number.MAX_SAFE_INTEGER) {
    revisionMismatch("current revision cannot be incremented safely");
  }

  const entities = new Map(current.entities);
  const blocks = new Map(current.blocks);
  const layers = new Map(current.layers);
  for (const key of delta.tombstones?.keys ?? []) {
    switch (parseCanonicalObjectKey(key).kind) {
      case "entity":
        entities.delete(key);
        break;
      case "block":
        blocks.delete(key);
        break;
      case "layer":
        layers.delete(key);
        break;
    }
  }
  for (const entity of delta.entities?.entities ?? []) entities.set(entity.id, entity);
  for (const block of delta.blocks?.blocks ?? []) blocks.set(block.id, block);
  for (const layer of delta.layers?.layers ?? []) layers.set(layer.id, layer);

  const actualModelEmpty = entities.size === 0;
  if (change.modelEmpty !== actualModelEmpty) {
    throw new CadWebError(
      "DELTA_INVALID",
      `modelEmpty=${change.modelEmpty} does not match resulting entity count ${entities.size}`,
    );
  }
  validateReferences(entities, blocks, layers);

  return {
    drawingId: current.drawingId,
    sourceFingerprint: current.sourceFingerprint,
    modelEpoch: current.modelEpoch,
    revision: current.revision + 1,
    modelEmpty: change.modelEmpty,
    resultExtents: {
      min: copyVec3(change.resultExtents.min),
      max: copyVec3(change.resultExtents.max),
    },
    entities,
    blocks,
    layers,
  };
}

import {
  CadWebError,
  EntityKind,
  applyCadWebDelta,
  parseCanonicalObjectKey,
  type CadWebDeltaDocument,
  type CadWebBlockDefinition,
  type CadWebDocument,
  type CadWebEntity,
  type CadWebLayer,
  type CadWebRevisionState,
} from "@acad/cadweb";

export type CadWebRenderInvalidation = {
  rebuildAllLayers: boolean;
  layerIds: ReadonlySet<string>;
};

export type CadWebCanonicalMaps = {
  entitiesById: ReadonlyMap<string, CadWebEntity>;
  blocksById: ReadonlyMap<string, CadWebBlockDefinition>;
  layersById: ReadonlyMap<string, CadWebLayer>;
  blockReferencesByDefinitionId: ReadonlyMap<string, ReadonlySet<string>>;
  blockDefinitionDependencies: ReadonlyMap<string, ReadonlySet<string>>;
};

export type CadWebViewerRevisionState = CadWebRevisionState & CadWebCanonicalMaps;

export type CadWebStagedRevision = {
  state: CadWebViewerRevisionState;
  invalidation: CadWebRenderInvalidation;
};

function addIndexValue(
  index: Map<string, Set<string>>,
  key: string,
  value: string,
): void {
  const values = index.get(key);
  if (values === undefined) {
    index.set(key, new Set([value]));
  } else {
    values.add(value);
  }
}

export function canonicalMapsFromRevision(
  state: CadWebRevisionState,
): CadWebCanonicalMaps {
  const blockReferencesByDefinitionId = new Map<string, Set<string>>();
  const blockDefinitionDependencies = new Map<string, Set<string>>();
  for (const blockId of state.blocks.keys()) {
    blockReferencesByDefinitionId.set(blockId, new Set());
    blockDefinitionDependencies.set(blockId, new Set());
  }

  const indexReference = (entity: CadWebEntity, ownerBlockId?: string): void => {
    if (entity.kind !== EntityKind.BlockReference || entity.blockDefinitionId === undefined) {
      return;
    }
    addIndexValue(blockReferencesByDefinitionId, entity.blockDefinitionId, entity.id);
    if (ownerBlockId !== undefined) {
      addIndexValue(blockDefinitionDependencies, ownerBlockId, entity.blockDefinitionId);
    }
  };
  for (const entity of state.entities.values()) indexReference(entity);
  for (const block of state.blocks.values()) {
    for (const entity of block.entities) indexReference(entity, block.id);
  }

  return {
    entitiesById: state.entities,
    blocksById: state.blocks,
    layersById: state.layers,
    blockReferencesByDefinitionId,
    blockDefinitionDependencies,
  };
}

function withCanonicalMaps(state: CadWebRevisionState): CadWebViewerRevisionState {
  return { ...state, ...canonicalMapsFromRevision(state) };
}

export function revisionStateFromSnapshot(
  snapshot: CadWebDocument,
  revision: number,
): CadWebViewerRevisionState {
  if (!Number.isSafeInteger(revision) || revision < 1) {
    throw new CadWebError("REVISION_MISMATCH", "snapshot revision must be a positive safe integer");
  }
  const syncBinding = snapshot.manifest.syncBinding;
  const checkpointBinding = snapshot.manifest.checkpointBinding;
  if (syncBinding === undefined && checkpointBinding === undefined) {
    throw new CadWebError(
      "REVISION_MISMATCH",
      "incremental viewing requires a revision-bound CADWeb 1.1 snapshot",
    );
  }
  const expectedRevision = checkpointBinding?.revision ?? (syncBinding!.baseRevision + 1);
  if (revision !== expectedRevision) {
    throw new CadWebError(
      "REVISION_MISMATCH",
      `snapshot revision ${revision} does not match binding revision ${expectedRevision}`,
    );
  }
  const binding = checkpointBinding ?? syncBinding!;
  const modelEmpty = snapshot.manifest.modelEmpty;
  if (modelEmpty === undefined) {
    throw new CadWebError("REVISION_MISMATCH", "revision-bound snapshot is missing modelEmpty");
  }
  return withCanonicalMaps({
    drawingId: binding.drawingId,
    sourceFingerprint: snapshot.manifest.source.drawingFingerprint,
    modelEpoch: binding.modelEpoch,
    revision,
    modelEmpty,
    resultExtents: {
      min: [...snapshot.manifest.extents.min],
      max: [...snapshot.manifest.extents.max],
    },
    entities: new Map(snapshot.entities.entities.map((entity) => [entity.id, entity])),
    blocks: new Map((snapshot.blocks?.blocks ?? []).map((block) => [block.id, block])),
    layers: new Map(snapshot.layers.layers.map((layer) => [layer.id, layer])),
  });
}

function allLayerIds(
  current: CadWebRevisionState,
  next: CadWebRevisionState,
): Set<string> {
  return new Set([...current.layers.keys(), ...next.layers.keys()]);
}

export function stageCadWebDelta(
  current: CadWebViewerRevisionState,
  delta: CadWebDeltaDocument,
): CadWebStagedRevision {
  const next = withCanonicalMaps(applyCadWebDelta(current, delta));
  let rebuildAllLayers = (delta.blocks?.blocks.length ?? 0) > 0;
  const layerIds = new Set<string>();

  for (const entity of delta.entities?.entities ?? []) {
    const previous = current.entities.get(entity.id);
    if (entity.kind === EntityKind.BlockReference || previous?.kind === EntityKind.BlockReference) {
      rebuildAllLayers = true;
    } else {
      if (previous !== undefined) layerIds.add(previous.layerId);
      layerIds.add(entity.layerId);
    }
  }
  for (const layer of delta.layers?.layers ?? []) {
    rebuildAllLayers = true;
    layerIds.add(layer.id);
  }
  for (const key of delta.tombstones?.keys ?? []) {
    switch (parseCanonicalObjectKey(key).kind) {
      case "entity": {
        const entity = current.entities.get(key);
        if (entity?.kind === EntityKind.BlockReference) {
          rebuildAllLayers = true;
        } else if (entity !== undefined) {
          layerIds.add(entity.layerId);
        }
        break;
      }
      case "block":
        rebuildAllLayers = true;
        break;
      case "layer":
        rebuildAllLayers = true;
        layerIds.add(key);
        break;
    }
  }

  return {
    state: next,
    invalidation: {
      rebuildAllLayers,
      layerIds: rebuildAllLayers ? allLayerIds(current, next) : layerIds,
    },
  };
}

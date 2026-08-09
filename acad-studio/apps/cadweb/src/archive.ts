import { BufferKind, EntityKind, SpaceKind } from "./generated/cad-web/v1";

import { CadWebError } from "./errors";
import { parseGeometryBuffer } from "./geometry";
import type {
  CadWebDocument,
  CadWebEntity,
  CadWebFileDescriptor,
  CadWebManifest,
} from "./types";
import { parseJson, validateExportReport, validateLayers, validateManifest } from "./validation";
import {
  decompressCadWebZip,
  type CadWebReadLimits,
} from "./zip";

export interface CadWebReaderOptions {
  limits?: Partial<CadWebReadLimits>;
}

function requiredEntry(entries: Map<string, Uint8Array>, path: string): Uint8Array {
  const entry = entries.get(path);
  if (!entry) throw new CadWebError("MANIFEST_INVALID", `manifest references missing file ${path}`);
  return entry;
}

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new CadWebError("INTEGRITY_ERROR", "Web Crypto SHA-256 is unavailable in this runtime");
  }
  const copy = Uint8Array.from(bytes);
  const digest = await subtle.digest("SHA-256", copy.buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function descriptors(manifest: CadWebManifest): Array<[string, CadWebFileDescriptor]> {
  return Object.entries(manifest.files).filter(
    (entry): entry is [string, CadWebFileDescriptor] => entry[1] !== undefined,
  );
}

async function validateIntegrity(
  manifest: CadWebManifest,
  entries: Map<string, Uint8Array>,
): Promise<void> {
  const paths = new Set<string>();
  const portablePaths = new Set<string>();
  for (const [role, descriptor] of descriptors(manifest)) {
    if (descriptor.path === "manifest.json") {
      throw new CadWebError("MANIFEST_INVALID", `${role} cannot point to manifest.json`);
    }
    const portablePath = descriptor.path.toLocaleLowerCase("en-US");
    if (paths.has(descriptor.path) || portablePaths.has(portablePath)) {
      throw new CadWebError("MANIFEST_INVALID", `manifest contains duplicate path ${descriptor.path}`);
    }
    paths.add(descriptor.path);
    portablePaths.add(portablePath);
    const bytes = requiredEntry(entries, descriptor.path);
    if (bytes.byteLength !== descriptor.size) {
      throw new CadWebError("INTEGRITY_ERROR", `${descriptor.path} size does not match manifest`);
    }
    const actualHash = await sha256Hex(bytes);
    if (actualHash !== descriptor.sha256) {
      throw new CadWebError("INTEGRITY_ERROR", `${descriptor.path} SHA-256 does not match manifest`);
    }
  }
  for (const path of entries.keys()) {
    if (path !== "manifest.json" && !paths.has(path)) {
      throw new CadWebError("MANIFEST_INVALID", `archive contains unlisted payload ${path}`);
    }
  }
}

function validateReferences(document: Omit<CadWebDocument, "entries" | "properties">): void {
  const revisionBound =
    document.manifest.syncBinding !== undefined ||
    document.manifest.checkpointBinding !== undefined;
  const assertCanonicalSource = (
    id: string,
    sourceHandle: string | undefined,
    expectedKind: "entity" | "block" | "layer",
    label: string,
  ): void => {
    if (!revisionBound) return;
    const match = /^(entity|block|layer):([1-9A-F][0-9A-F]*)$/.exec(id);
    if (match?.[1] !== expectedKind || match[2] !== sourceHandle) {
      throw new CadWebError(
        "GEOMETRY_INVALID",
        `${label} does not match its ${expectedKind} sourceHandle`,
      );
    }
  };

  if (
    revisionBound &&
    document.manifest.modelEmpty !== (document.entities.entities.length === 0)
  ) {
    throw new CadWebError(
      "GEOMETRY_INVALID",
      "manifest modelEmpty does not match the top-level entity set",
    );
  }

  for (const layer of document.layers.layers) {
    assertCanonicalSource(layer.id, layer.sourceHandle, "layer", `layer ${layer.id}`);
  }
  const layerIds = new Set(document.layers.layers.map((layer) => layer.id));
  const blockIds = new Set<string>();
  for (const block of document.blocks?.blocks ?? []) {
    assertCanonicalSource(block.id, block.sourceHandle, "block", `block ${block.id}`);
    if (blockIds.has(block.id)) {
      throw new CadWebError("GEOMETRY_INVALID", `duplicate block definition id ${block.id}`);
    }
    blockIds.add(block.id);
  }

  const entityIds = new Set<string>();
  const validateEntities = (entities: CadWebEntity[], insideBlock: boolean): void => {
    for (const entity of entities) {
      assertCanonicalSource(entity.id, entity.sourceHandle, "entity", `entity ${entity.id}`);
      if (entityIds.has(entity.id)) {
        throw new CadWebError("GEOMETRY_INVALID", `duplicate entity id ${entity.id}`);
      }
      entityIds.add(entity.id);
      for (const attribute of entity.attributes) {
        if (
          revisionBound &&
          !/^entity:[1-9A-F][0-9A-F]*$/.test(attribute.id)
        ) {
          throw new CadWebError(
            "GEOMETRY_INVALID",
            `attribute ${attribute.id} must use the entity namespace`,
          );
        }
        if (entityIds.has(attribute.id)) {
          throw new CadWebError("GEOMETRY_INVALID", `duplicate object id ${attribute.id}`);
        }
        entityIds.add(attribute.id);
      }
      if (!layerIds.has(entity.layerId)) {
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
        !blockIds.has(entity.blockDefinitionId ?? "")
      ) {
        throw new CadWebError(
          "GEOMETRY_INVALID",
          `entity ${entity.id} references missing block ${entity.blockDefinitionId ?? ""}`,
        );
      }
    }
  };
  validateEntities(document.entities.entities, false);
  for (const block of document.blocks?.blocks ?? []) validateEntities(block.entities, true);

  const graph = new Map<string, string[]>();
  for (const block of document.blocks?.blocks ?? []) {
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

export async function readCadWeb(
  input: Uint8Array | ArrayBuffer,
  options: CadWebReaderOptions = {},
): Promise<CadWebDocument> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const { entries, limits } = decompressCadWebZip(bytes, options.limits);
  const manifestBytes = requiredEntry(entries, "manifest.json");
  if (manifestBytes.byteLength > limits.maxManifestBytes) {
    throw new CadWebError("ZIP_LIMIT", "manifest.json exceeds maxManifestBytes");
  }
  let manifestValue: unknown;
  try {
    manifestValue = parseJson(manifestBytes, "manifest.json");
  } catch (cause) {
    if (cause instanceof CadWebError) {
      throw new CadWebError("MANIFEST_INVALID", cause.message, { cause });
    }
    throw cause;
  }
  const manifest = validateManifest(manifestValue);
  await validateIntegrity(manifest, entries);

  const parseJsonEntry = (descriptor: CadWebFileDescriptor): unknown => {
    const value = requiredEntry(entries, descriptor.path);
    if (value.byteLength > limits.maxJsonPayloadBytes) {
      throw new CadWebError("ZIP_LIMIT", `${descriptor.path} exceeds maxJsonPayloadBytes`);
    }
    return parseJson(value, descriptor.path);
  };

  const layers = validateLayers(parseJsonEntry(manifest.files.layers));
  const exportReport = validateExportReport(parseJsonEntry(manifest.files.exportReport));
  const entities = parseGeometryBuffer(
    requiredEntry(entries, manifest.files.entities.path),
    BufferKind.Entities,
  );
  const blocks = manifest.files.blocks
    ? parseGeometryBuffer(requiredEntry(entries, manifest.files.blocks.path), BufferKind.Blocks)
    : undefined;
  const properties = manifest.files.properties
    ? parseJsonEntry(manifest.files.properties)
    : undefined;
  const document = { manifest, layers, exportReport, entities, blocks };
  validateReferences(document);
  return {
    ...document,
    ...(properties === undefined ? {} : { properties }),
    entries,
  };
}

import {
  type CadWebBlockDefinition,
  type CadWebDeltaDocument,
  type CadWebDocument,
  type CadWebEntity,
  type CadWebLayer,
} from "@acad/cadweb";

import { isSha256, sha256 } from "./crypto";
import { SyncError } from "./errors";
import { buildNativeBlockBuffer, buildNativeEntityBuffer } from "./native-geometry";
import type {
  ArtifactSemanticChange,
  RevisionExtents,
} from "./types";

const encoder = new TextEncoder();
const stateHashPrefix = Uint8Array.from([
  0x43, 0x41, 0x44, 0x57, 0x45, 0x42, 0x2d,
  0x53, 0x54, 0x41, 0x54, 0x45, 0x00, 0x01,
]);
const canonicalObjectKey = /^(entity|block|layer):[1-9A-F][0-9A-F]*$/;

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function invalid(message: string): never {
  throw new SyncError("artifact_invalid", 422, message);
}

function entityContentHash(entity: CadWebEntity): string {
  return sha256(buildNativeEntityBuffer(entity));
}

function blockContentHash(block: CadWebBlockDefinition): string {
  return sha256(buildNativeBlockBuffer(block));
}

function layerNumber(layer: CadWebLayer, field: string, fallback?: number): number {
  const value = layer[field];
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return invalid(`layer ${layer.id} has invalid ${field}`);
  }
  return value;
}

function layerString(layer: CadWebLayer, field: string, fallback?: string): string {
  const value = layer[field];
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "string") return invalid(`layer ${layer.id} has invalid ${field}`);
  return value;
}

function jsonNumber(value: number): string {
  return Object.is(value, -0) ? "-0" : String(value);
}

function layerContentHash(layer: CadWebLayer): string {
  const sourceHandle = layerString(layer, "sourceHandle");
  const transparency = layerNumber(layer, "transparency", 0);
  const lineWeightMm = layerNumber(layer, "lineWeightMm", 0);
  const linetype = layerString(layer, "linetype", "");
  const json = `{"schemaVersion":1,"layers":[{"id":${JSON.stringify(layer.id)}`
    + `,"sourceHandle":${JSON.stringify(sourceHandle)}`
    + `,"name":${JSON.stringify(layer.name)}`
    + `,"visible":${String(layer.visible)}`
    + `,"frozen":${String(layer.frozen)}`
    + `,"locked":${String(layer.locked)}`
    + `,"plot":${String(layer.plot)}`
    + `,"colorArgb":${String(layer.colorArgb)}`
    + `,"transparency":${String(transparency)}`
    + `,"lineWeightMm":${jsonNumber(lineWeightMm)}`
    + `,"linetype":${JSON.stringify(linetype)}}]}\n`;
  return sha256(encoder.encode(json));
}

function addObjectHash(
  output: Record<string, string>,
  objectKey: string,
  contentHash: string,
): void {
  if (!canonicalObjectKey.test(objectKey)) invalid(`invalid canonical object key ${objectKey}`);
  if (output[objectKey] !== undefined) invalid(`duplicate canonical object key ${objectKey}`);
  output[objectKey] = contentHash;
}

function objectHashes(
  entities: readonly CadWebEntity[],
  blocks: readonly CadWebBlockDefinition[],
  layers: readonly CadWebLayer[],
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entity of entities) addObjectHash(result, entity.id, entityContentHash(entity));
  for (const block of blocks) addObjectHash(result, block.id, blockContentHash(block));
  for (const layer of layers) addObjectHash(result, layer.id, layerContentHash(layer));
  return result;
}

function extents(min: readonly number[], max: readonly number[]): RevisionExtents {
  if (
    min.length !== 3 || max.length !== 3 ||
    [...min, ...max].some((value) => !Number.isFinite(value))
  ) {
    return invalid("revision extents must contain six finite coordinates");
  }
  return {
    min: [min[0]!, min[1]!, min[2]!],
    max: [max[0]!, max[1]!, max[2]!],
  };
}

export function snapshotSemanticChange(document: CadWebDocument): ArtifactSemanticChange {
  return {
    replacesState: true,
    modelEmpty: document.manifest.modelEmpty ?? document.entities.entities.length === 0,
    resultExtents: extents(document.manifest.extents.min, document.manifest.extents.max),
    objectUpserts: objectHashes(
      document.entities.entities,
      document.blocks?.blocks ?? [],
      document.layers.layers,
    ),
    tombstones: [],
  };
}

export function deltaSemanticChange(document: CadWebDeltaDocument): ArtifactSemanticChange {
  return {
    replacesState: false,
    modelEmpty: document.change.modelEmpty,
    resultExtents: extents(document.change.resultExtents.min, document.change.resultExtents.max),
    objectUpserts: objectHashes(
      document.entities?.entities ?? [],
      document.blocks?.blocks ?? [],
      document.layers?.layers ?? [],
    ),
    tombstones: [...(document.tombstones?.keys ?? [])],
  };
}

function appendUint32(parts: Uint8Array[], value: number): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 0xffff_ffff) {
    invalid("state hash collection exceeds the version 1 limit");
  }
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, value, false);
  parts.push(bytes);
}

function appendFrame(parts: Uint8Array[], value: string): void {
  const bytes = encoder.encode(value);
  appendUint32(parts, bytes.byteLength);
  parts.push(bytes);
}

function appendDouble(parts: Uint8Array[], value: number): void {
  if (!Number.isFinite(value)) invalid("state hash extents must be finite");
  const bytes = new Uint8Array(8);
  new DataView(bytes.buffer).setFloat64(0, value === 0 ? 0 : value, false);
  parts.push(bytes);
}

function flatten(parts: readonly Uint8Array[]): Uint8Array {
  const length = parts.reduce((sum, part) => sum + part.byteLength, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  return bytes;
}

export function computeStateHash(
  drawingId: string,
  modelEpoch: string,
  modelEmpty: boolean,
  resultExtents: RevisionExtents,
  hashes: Readonly<Record<string, string>>,
): string {
  if (!drawingId || !modelEpoch) invalid("state hash drawing/model identity is incomplete");
  const entries = Object.entries(hashes).sort(([left], [right]) => lexicalCompare(left, right));
  const parts: Uint8Array[] = [stateHashPrefix];
  appendFrame(parts, drawingId);
  appendFrame(parts, modelEpoch);
  parts.push(Uint8Array.of(modelEmpty ? 1 : 0));
  for (const value of [...resultExtents.min, ...resultExtents.max]) appendDouble(parts, value);
  appendUint32(parts, entries.length);
  for (const [objectKey, contentHash] of entries) {
    if (!canonicalObjectKey.test(objectKey)) invalid(`invalid canonical object key ${objectKey}`);
    if (!isSha256(contentHash)) invalid(`invalid content hash for ${objectKey}`);
    appendFrame(parts, objectKey);
    parts.push(Uint8Array.from(Buffer.from(contentHash, "hex")));
  }
  return sha256(flatten(parts));
}

export function applySemanticChange(
  drawingId: string,
  modelEpoch: string,
  currentHashes: Readonly<Record<string, string>>,
  change: ArtifactSemanticChange,
): { objectHashes: Record<string, string>; stateHash: string } {
  const hashes: Record<string, string> = change.replacesState ? {} : { ...currentHashes };
  for (const key of change.tombstones) delete hashes[key];
  for (const [key, contentHash] of Object.entries(change.objectUpserts)) {
    hashes[key] = contentHash;
  }
  return {
    objectHashes: hashes,
    stateHash: computeStateHash(
      drawingId,
      modelEpoch,
      change.modelEmpty,
      change.resultExtents,
      hashes,
    ),
  };
}

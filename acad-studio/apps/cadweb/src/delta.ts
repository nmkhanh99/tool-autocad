import { BufferKind } from "./generated/cad-web/v1";

import { sha256Hex } from "./archive";
import {
  validateDeltaManifest,
  validateDeltaPayloads,
  validateTombstones,
} from "./delta-validation";
import { CadWebError } from "./errors";
import { parseGeometryBuffer } from "./geometry";
import type {
  CadWebDeltaDocument,
  CadWebDeltaManifest,
  CadWebFileDescriptor,
} from "./types";
import { parseJson, validateExportReport, validateLayers } from "./validation";
import { decompressCadWebZip, type CadWebReadLimits } from "./zip";

export interface CadWebDeltaReaderOptions {
  limits?: Partial<CadWebReadLimits>;
}

function requiredEntry(entries: Map<string, Uint8Array>, path: string): Uint8Array {
  const entry = entries.get(path);
  if (!entry) {
    throw new CadWebError("DELTA_INVALID", `change.json references missing file ${path}`);
  }
  return entry;
}

function descriptors(change: CadWebDeltaManifest): Array<[string, CadWebFileDescriptor]> {
  return (Object.entries(change.files) as Array<[string, CadWebFileDescriptor | undefined]>).filter(
    (entry): entry is [string, CadWebFileDescriptor] => entry[1] !== undefined,
  );
}

async function validateIntegrity(
  change: CadWebDeltaManifest,
  entries: Map<string, Uint8Array>,
): Promise<void> {
  const paths = new Set<string>();
  const portablePaths = new Set<string>();
  for (const [role, descriptor] of descriptors(change)) {
    if (descriptor.path === "change.json") {
      throw new CadWebError("DELTA_INVALID", `${role} cannot point to change.json`);
    }
    const portablePath = descriptor.path.toLocaleLowerCase("en-US");
    if (paths.has(descriptor.path) || portablePaths.has(portablePath)) {
      throw new CadWebError("DELTA_INVALID", `change.json contains duplicate path ${descriptor.path}`);
    }
    paths.add(descriptor.path);
    portablePaths.add(portablePath);
    const bytes = requiredEntry(entries, descriptor.path);
    if (bytes.byteLength !== descriptor.size) {
      throw new CadWebError("INTEGRITY_ERROR", `${descriptor.path} size does not match change.json`);
    }
    const actualHash = await sha256Hex(bytes);
    if (actualHash !== descriptor.sha256) {
      throw new CadWebError("INTEGRITY_ERROR", `${descriptor.path} SHA-256 does not match change.json`);
    }
  }
  for (const path of entries.keys()) {
    if (path !== "change.json" && !paths.has(path)) {
      throw new CadWebError("DELTA_INVALID", `archive contains unlisted payload ${path}`);
    }
  }
}

export async function readCadWebDelta(
  input: Uint8Array | ArrayBuffer,
  options: CadWebDeltaReaderOptions = {},
): Promise<CadWebDeltaDocument> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input);
  const { entries, limits } = decompressCadWebZip(bytes, options.limits);
  const changeBytes = requiredEntry(entries, "change.json");
  if (changeBytes.byteLength > limits.maxManifestBytes) {
    throw new CadWebError("ZIP_LIMIT", "change.json exceeds maxManifestBytes");
  }

  let changeValue: unknown;
  try {
    changeValue = parseJson(changeBytes, "change.json");
  } catch (cause) {
    if (cause instanceof CadWebError) {
      throw new CadWebError("DELTA_INVALID", cause.message, { cause });
    }
    throw cause;
  }
  const change = validateDeltaManifest(changeValue);
  await validateIntegrity(change, entries);

  const parseJsonEntry = (descriptor: CadWebFileDescriptor): unknown => {
    const value = requiredEntry(entries, descriptor.path);
    if (value.byteLength > limits.maxJsonPayloadBytes) {
      throw new CadWebError("ZIP_LIMIT", `${descriptor.path} exceeds maxJsonPayloadBytes`);
    }
    return parseJson(value, descriptor.path);
  };

  const exportReport = validateExportReport(parseJsonEntry(change.files.exportReport));
  const entities = change.files.entities
    ? parseGeometryBuffer(requiredEntry(entries, change.files.entities.path), BufferKind.Entities)
    : undefined;
  const blocks = change.files.blocks
    ? parseGeometryBuffer(requiredEntry(entries, change.files.blocks.path), BufferKind.Blocks)
    : undefined;
  const layers = change.files.layers
    ? validateLayers(parseJsonEntry(change.files.layers))
    : undefined;
  const tombstones = change.files.tombstones
    ? validateTombstones(parseJsonEntry(change.files.tombstones))
    : undefined;
  const payloads = { entities, blocks, layers, tombstones };
  validateDeltaPayloads(change, payloads);

  return {
    change,
    exportReport,
    ...(entities === undefined ? {} : { entities }),
    ...(blocks === undefined ? {} : { blocks }),
    ...(layers === undefined ? {} : { layers }),
    ...(tombstones === undefined ? {} : { tombstones }),
    entries,
  };
}

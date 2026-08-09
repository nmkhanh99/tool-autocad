import { zipSync, type Zippable } from "fflate";

import {
  BufferKind,
  EntityKind,
  PropertySourceMode,
  SpaceKind,
  buildGeometryBuffer,
  sha256Hex,
  type CadWebDeltaManifest,
  type CadWebEntity,
  type CadWebExportReport,
  type CadWebFileDescriptor,
  type CadWebLayer,
  type CadWebManifest,
  type Vec3,
} from "@acad/cadweb";

const encoder = new TextEncoder();
const fixedZipDate = new Date(1980, 0, 1, 0, 0, 0);

export const drawingId = "drawing-a";
export const modelEpoch = "epoch-a";
export const sourceFingerprint = "fixture-fingerprint";
export const nativeEntityHash = "4033383fdb952e8f77461adb7a38f123042d19407aea4522072ccd8e3b4fef84";
export const nativePropertyModeEntityHash = "d8c85806c41abb017b996c08db9f583cb074f3aa305ec3b87f242b150edfada0";
export const nativeLayerHash = "3b3ae20730534466b0536edabbc629cd521532afedbcd785cf18242941d9f546";
export const nativeInitialStateHash = "f5fc04d81093232c1131517ea5a46f3164219828cd81ef2c7f74b3d3059de62a";

function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value)}\n`);
}

function pack(entries: Readonly<Record<string, Uint8Array>>): Uint8Array {
  const input: Zippable = {};
  for (const path of Object.keys(entries).sort()) {
    input[path] = [entries[path]!, { level: 0, mtime: fixedZipDate }];
  }
  return zipSync(input, { level: 0 });
}

async function descriptor(
  path: string,
  encoding: "json" | "flatbuffers",
  bytes: Uint8Array,
): Promise<CadWebFileDescriptor> {
  return {
    path,
    encoding,
    ...(encoding === "flatbuffers"
      ? { schemaVersion: 1, byteOrder: "little-endian" as const }
      : {}),
    size: bytes.byteLength,
    sha256: await sha256Hex(bytes),
  };
}

export function line(end: Vec3 = [12, 4, 0]): CadWebEntity {
  return {
    id: "entity:A",
    sourceHandle: "A",
    kind: EntityKind.Line,
    layerId: "layer:1",
    space: SpaceKind.Model,
    visible: true,
    colorArgb: 0xff_ffffff,
    transparency: 0,
    lineWeightMm: 0,
    linetype: "Continuous",
    colorSourceMode: PropertySourceMode.Explicit,
    transparencySourceMode: PropertySourceMode.Explicit,
    lineWeightSourceMode: PropertySourceMode.Explicit,
    linetypeSourceMode: PropertySourceMode.Explicit,
    drawOrder: 0,
    points: [[0, 0, 0], end],
    bulges: [],
    startWidths: [],
    endWidths: [],
    constantWidth: 0,
    closed: false,
    radius: 0,
    startAngle: 0,
    endAngle: 0,
    rotation: 0,
    height: 0,
    attributes: [],
  };
}

export function layer(): CadWebLayer {
  return {
    id: "layer:1",
    sourceHandle: "1",
    name: "Geometry",
    visible: true,
    frozen: false,
    locked: false,
    plot: true,
    colorArgb: 0xff_ffffff,
    transparency: 0,
    lineWeightMm: 0,
    linetype: "Continuous",
  };
}

interface SnapshotOptions {
  snapshotId?: string;
  baseRevision?: number;
  modelEpoch?: string;
  sourceFingerprint?: string;
  producerPlatform?: string;
  checkpoint?: { checkpointId: string; revision: number; stateHash: string };
}

export async function createSnapshot(options: SnapshotOptions = {}): Promise<Uint8Array> {
  const entitiesBytes = buildGeometryBuffer({
    schemaVersion: 1,
    kind: BufferKind.Entities,
    entities: [line()],
    blocks: [],
  });
  const layersBytes = jsonBytes({ schemaVersion: 1, layers: [layer()] });
  const report: CadWebExportReport = {
    schemaVersion: 1,
    status: "complete",
    counts: { exported: 2, skipped: 0, warnings: 0, errors: 0 },
    issues: [],
  };
  const reportBytes = jsonBytes(report);
  const files: CadWebManifest["files"] = {
    layers: await descriptor("layers.json", "json", layersBytes) as CadWebManifest["files"]["layers"],
    entities: await descriptor("entities.bin", "flatbuffers", entitiesBytes) as CadWebManifest["files"]["entities"],
    exportReport: await descriptor("export-report.json", "json", reportBytes) as CadWebManifest["files"]["exportReport"],
  };
  const manifest: CadWebManifest = {
    format: "cadweb",
    formatVersion: { major: 1, minor: 2 },
    producer: {
      application: "AutoCAD",
      applicationVersion: "2027",
      pluginVersion: "0.2.0",
      platform: options.producerPlatform ?? "test",
    },
    source: {
      fileName: "factory.dwg",
      dwgVersion: "AC1038",
      drawingFingerprint: options.sourceFingerprint ?? sourceFingerprint,
    },
    units: { name: "millimeters", metersPerUnit: 0.001 },
    coordinateSystem: { space: "WCS", upAxis: "Z", origin: [0, 0, 0] },
    extents: { min: [0, 0, 0], max: [12, 4, 0] },
    modelEmpty: false,
    ...(options.checkpoint
      ? {
          checkpointBinding: {
            drawingId,
            modelEpoch: options.modelEpoch ?? modelEpoch,
            checkpointId: options.checkpoint.checkpointId,
            revision: options.checkpoint.revision,
            stateHash: options.checkpoint.stateHash,
          },
        }
      : {
          syncBinding: {
            drawingId,
            modelEpoch: options.modelEpoch ?? modelEpoch,
            snapshotId: options.snapshotId ?? "snapshot-a",
            baseRevision: options.baseRevision ?? 0,
          },
        }),
    files,
  };
  return pack({
    "manifest.json": jsonBytes(manifest),
    "layers.json": layersBytes,
    "entities.bin": entitiesBytes,
    "export-report.json": reportBytes,
  });
}

interface DeltaOptions {
  changeSetId?: string;
  baseRevision?: number;
  end?: Vec3;
}

export async function createDelta(options: DeltaOptions = {}): Promise<Uint8Array> {
  const entity = line(options.end ?? [15, 4, 0]);
  const entitiesBytes = buildGeometryBuffer({
    schemaVersion: 1,
    kind: BufferKind.Entities,
    entities: [entity],
    blocks: [],
  });
  const report: CadWebExportReport = {
    schemaVersion: 1,
    status: "complete",
    counts: { exported: 1, skipped: 0, warnings: 0, errors: 0 },
    issues: [],
  };
  const reportBytes = jsonBytes(report);
  const files: CadWebDeltaManifest["files"] = {
    entities: await descriptor("entities.bin", "flatbuffers", entitiesBytes) as CadWebDeltaManifest["files"]["entities"],
    exportReport: await descriptor("export-report.json", "json", reportBytes) as CadWebDeltaManifest["files"]["exportReport"],
  };
  const change: CadWebDeltaManifest = {
    format: "cadweb-delta",
    formatVersion: { major: 1, minor: 1 },
    changeSetId: options.changeSetId ?? "change-a",
    drawingId,
    sourceFingerprint,
    modelEpoch,
    baseRevision: options.baseRevision ?? 1,
    trigger: { kind: "qsave", savedAt: "2026-08-09T10:15:30Z" },
    upserts: { entities: 1, blocks: 0, layers: 0 },
    deletes: { entities: 0, blocks: 0, layers: 0 },
    modelEmpty: false,
    resultExtents: { min: [0, 0, 0], max: options.end ?? [15, 4, 0] },
    files,
  };
  return pack({
    "change.json": jsonBytes(change),
    "entities.bin": entitiesBytes,
    "export-report.json": reportBytes,
  });
}

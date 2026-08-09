import type {
  BufferKind,
  EntityKind,
  PropertySourceMode,
  SpaceKind,
} from "./generated/cad-web/v1";

export type Vec3 = readonly [number, number, number];

/** Row-major m[row][column], applied to homogeneous column vectors. */
export type Matrix4 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

export interface CadWebFileDescriptor {
  path: string;
  encoding: string;
  size: number;
  sha256: string;
  schemaVersion?: number;
  byteOrder?: "little-endian";
  [key: string]: unknown;
}

export interface CadWebJsonFileDescriptor extends CadWebFileDescriptor {
  encoding: "json";
}

export interface CadWebFlatBuffersFileDescriptor extends CadWebFileDescriptor {
  encoding: "flatbuffers";
  schemaVersion: 1;
  byteOrder: "little-endian";
}

export interface CadWebSyncBinding {
  drawingId: string;
  modelEpoch: string;
  snapshotId: string;
  baseRevision: number;
  [key: string]: unknown;
}

export interface CadWebCheckpointBinding {
  drawingId: string;
  modelEpoch: string;
  checkpointId: string;
  revision: number;
  stateHash: string;
  [key: string]: unknown;
}

export interface CadWebManifest {
  format: "cadweb";
  formatVersion: {
    major: number;
    minor: number;
    [key: string]: unknown;
  };
  producer: {
    application: string;
    applicationVersion: string;
    pluginVersion: string;
    platform: string;
    [key: string]: unknown;
  };
  source: {
    fileName: string;
    dwgVersion: string;
    drawingFingerprint: string;
    [key: string]: unknown;
  };
  units: {
    name: string;
    metersPerUnit: number | null;
    [key: string]: unknown;
  };
  coordinateSystem: {
    space: "WCS";
    upAxis: "Z";
    origin: Vec3;
    [key: string]: unknown;
  };
  extents: {
    min: Vec3;
    max: Vec3;
    [key: string]: unknown;
  };
  modelEmpty?: boolean;
  syncBinding?: CadWebSyncBinding;
  checkpointBinding?: CadWebCheckpointBinding;
  files: {
    layers: CadWebJsonFileDescriptor;
    entities: CadWebFlatBuffersFileDescriptor;
    blocks?: CadWebFlatBuffersFileDescriptor;
    properties?: CadWebJsonFileDescriptor;
    exportReport: CadWebJsonFileDescriptor;
    [key: string]: CadWebFileDescriptor | undefined;
  };
  [key: string]: unknown;
}

export interface CadWebLayer {
  id: string;
  sourceHandle?: string;
  name: string;
  visible: boolean;
  frozen: boolean;
  locked: boolean;
  plot: boolean;
  colorArgb: number;
  transparency?: number;
  lineWeightMm?: number;
  linetype?: string;
  [key: string]: unknown;
}

export interface CadWebLayers {
  schemaVersion: 1;
  layers: CadWebLayer[];
  [key: string]: unknown;
}

export interface CadWebExportIssue {
  severity: "warning" | "error";
  code: string;
  message: string;
  entityKind?: string;
  sourceHandle?: string;
  [key: string]: unknown;
}

export interface CadWebExportReport {
  schemaVersion: 1;
  status: "complete" | "partial" | "failed";
  counts: {
    exported: number;
    skipped: number;
    warnings: number;
    errors: number;
    [key: string]: unknown;
  };
  issues: CadWebExportIssue[];
  [key: string]: unknown;
}

export interface CadWebAttribute {
  id: string;
  tag: string;
  text?: string;
  position?: Vec3;
  rotation?: number;
  height?: number;
}

export interface CadWebEntity {
  id: string;
  sourceHandle?: string;
  kind: EntityKind;
  layerId: string;
  space: SpaceKind;
  visible: boolean;
  colorArgb: number;
  transparency: number;
  lineWeightMm: number;
  linetype?: string;
  colorSourceMode: PropertySourceMode;
  transparencySourceMode: PropertySourceMode;
  lineWeightSourceMode: PropertySourceMode;
  linetypeSourceMode: PropertySourceMode;
  drawOrder: number;
  points: Vec3[];
  bulges: number[];
  startWidths: number[];
  endWidths: number[];
  constantWidth: number;
  closed: boolean;
  center?: Vec3;
  radius: number;
  startAngle: number;
  endAngle: number;
  normal?: Vec3;
  text?: string;
  position?: Vec3;
  rotation: number;
  height: number;
  blockDefinitionId?: string;
  transform?: Matrix4;
  attributes: CadWebAttribute[];
}

export interface CadWebBlockDefinition {
  id: string;
  sourceHandle?: string;
  name: string;
  basePoint?: Vec3;
  entities: CadWebEntity[];
}

export interface CadWebGeometry {
  schemaVersion: 1;
  kind: BufferKind;
  entities: CadWebEntity[];
  blocks: CadWebBlockDefinition[];
}

export interface CadWebDocument {
  manifest: CadWebManifest;
  layers: CadWebLayers;
  exportReport: CadWebExportReport;
  entities: CadWebGeometry;
  blocks?: CadWebGeometry;
  properties?: unknown;
  entries: ReadonlyMap<string, Uint8Array>;
}

export type CadWebObjectKind = "entity" | "block" | "layer";

export interface CadWebDeltaCounts {
  entities: number;
  blocks: number;
  layers: number;
}

export interface CadWebDeltaManifest {
  format: "cadweb-delta";
  formatVersion: {
    major: number;
    minor: number;
    [key: string]: unknown;
  };
  changeSetId: string;
  drawingId: string;
  sourceFingerprint: string;
  modelEpoch: string;
  baseRevision: number;
  trigger: {
    kind: string;
    savedAt: string;
    [key: string]: unknown;
  };
  upserts: CadWebDeltaCounts;
  deletes: CadWebDeltaCounts;
  modelEmpty: boolean;
  resultExtents: {
    min: Vec3;
    max: Vec3;
    [key: string]: unknown;
  };
  files: {
    entities?: CadWebFlatBuffersFileDescriptor;
    blocks?: CadWebFlatBuffersFileDescriptor;
    layers?: CadWebJsonFileDescriptor;
    tombstones?: CadWebJsonFileDescriptor;
    exportReport: CadWebJsonFileDescriptor;
  };
  [key: string]: unknown;
}

export interface CadWebTombstones {
  schemaVersion: 1;
  keys: string[];
  [key: string]: unknown;
}

export interface CadWebDeltaDocument {
  change: CadWebDeltaManifest;
  exportReport: CadWebExportReport;
  entities?: CadWebGeometry;
  blocks?: CadWebGeometry;
  layers?: CadWebLayers;
  tombstones?: CadWebTombstones;
  entries: ReadonlyMap<string, Uint8Array>;
}

export interface CadWebRevisionState {
  drawingId: string;
  sourceFingerprint: string;
  modelEpoch: string;
  revision: number;
  modelEmpty: boolean;
  resultExtents: {
    min: Vec3;
    max: Vec3;
  };
  entities: ReadonlyMap<string, CadWebEntity>;
  blocks: ReadonlyMap<string, CadWebBlockDefinition>;
  layers: ReadonlyMap<string, CadWebLayer>;
}

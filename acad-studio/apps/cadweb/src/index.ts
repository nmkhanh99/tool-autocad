export { readCadWeb, sha256Hex, type CadWebReaderOptions } from "./archive";
export { readCadWebDelta, type CadWebDeltaReaderOptions } from "./delta";
export {
  canonicalObjectKey,
  normalizeSourceHandle,
  parseCanonicalObjectKey,
  type CanonicalObjectKey,
} from "./delta-validation";
export { CadWebError, type CadWebErrorCode } from "./errors";
export { createDeterministicFixture } from "./fixture";
export { buildGeometryBuffer, parseGeometryBuffer } from "./geometry";
export {
  BufferKind,
  EntityKind,
  PropertySourceMode,
  SpaceKind,
} from "./generated/cad-web/v1";
export { applyCadWebDelta } from "./revision-reducer";
export type {
  CadWebAttribute,
  CadWebBlockDefinition,
  CadWebCheckpointBinding,
  CadWebDeltaCounts,
  CadWebDeltaDocument,
  CadWebDeltaManifest,
  CadWebDocument,
  CadWebEntity,
  CadWebExportIssue,
  CadWebExportReport,
  CadWebFileDescriptor,
  CadWebFlatBuffersFileDescriptor,
  CadWebGeometry,
  CadWebJsonFileDescriptor,
  CadWebLayer,
  CadWebLayers,
  CadWebManifest,
  CadWebObjectKind,
  CadWebRevisionState,
  CadWebSyncBinding,
  CadWebTombstones,
  Matrix4,
  Vec3,
} from "./types";
export {
  DEFAULT_CADWEB_LIMITS,
  inspectCadWebZip,
  type CadWebReadLimits,
  type InspectedZip,
  type ZipEntryInfo,
} from "./zip";

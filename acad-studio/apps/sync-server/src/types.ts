export interface DrawingScope {
  tenantId: string;
  projectId: string;
  drawingId: string;
}

export interface Principal {
  id: string;
}

export type AuthorizationAction =
  | "writer-session:acquire"
  | "writer-session:renew"
  | "artifact:publish"
  | "checkpoint:attach"
  | "drawing:read";

export interface AuthorizationRequest extends DrawingScope {
  principal: Principal;
  action: AuthorizationAction;
}

export interface Authorizer {
  authorize(request: AuthorizationRequest): Promise<boolean>;
}

export interface Authenticator {
  authenticate(request: Request): Promise<Principal | null>;
}

export type ArtifactMode = "snapshot" | "delta";

export type Vec3 = readonly [number, number, number];

export interface RevisionExtents {
  min: Vec3;
  max: Vec3;
}

export interface ArtifactSemanticChange {
  replacesState: boolean;
  modelEmpty: boolean;
  resultExtents: RevisionExtents;
  objectUpserts: Record<string, string>;
  tombstones: string[];
}

export interface ValidatedWriterArtifact {
  mode: ArtifactMode;
  artifactId: string;
  drawingId: string;
  modelEpoch: string;
  sourceFingerprint: string;
  baseRevision: number;
  semanticChange: ArtifactSemanticChange;
}

export interface ValidatedCheckpoint {
  checkpointId: string;
  drawingId: string;
  modelEpoch: string;
  revision: number;
  stateHash: string;
  computedStateHash: string;
}

export interface ArtifactValidator {
  validateSnapshot(bytes: Uint8Array): Promise<ValidatedWriterArtifact>;
  validateChangeset(bytes: Uint8Array): Promise<ValidatedWriterArtifact>;
  validateCheckpoint(bytes: Uint8Array): Promise<ValidatedCheckpoint>;
}

export interface WriterSession {
  writerSessionId: string;
  principalId: string;
  acquiredAt: string;
  leaseExpiresAt: string;
}

export interface CheckpointAttachment {
  checkpointId: string;
  blobHash: string;
  blobSize: number;
  modelEpoch: string;
  stateHash: string;
  attachedAt: string;
  attachedBy: string;
  requestDigest: string;
}

export interface RevisionRecord {
  revision: number;
  baseRevision: number;
  mode: ArtifactMode;
  artifactId: string;
  writerSessionId: string;
  modelEpoch: string;
  sourceFingerprint: string;
  stateHash: string;
  modelEmpty: boolean;
  resultExtents: RevisionExtents;
  blobHash: string;
  blobSize: number;
  requestDigest: string;
  createdAt: string;
  eventPublishedAt?: string;
  checkpoints: Record<string, CheckpointAttachment>;
}

export interface IdempotencyRecord {
  requestDigest: string;
  revision: number;
}

export interface CheckpointIdempotencyRecord {
  requestDigest: string;
  revision: number;
  checkpointId: string;
}

export interface WriterSessionAuditEntry {
  event: "acquired" | "renewed" | "expired-and-replaced";
  writerSessionId: string;
  principalId: string;
  at: string;
  leaseExpiresAt: string;
}

export interface DrawingRecord extends DrawingScope {
  headRevision: number;
  modelEpoch?: string;
  sourceFingerprint?: string;
  activeWriter?: WriterSession;
  revisions: Record<string, RevisionRecord>;
  idempotency: Record<string, IdempotencyRecord>;
  checkpointIdempotency: Record<string, CheckpointIdempotencyRecord>;
  objectHashes: Record<string, string>;
  writerAudit: WriterSessionAuditEntry[];
}

export interface MetadataState {
  version: 1;
  drawings: Record<string, DrawingRecord>;
}

export interface TransactionOutcome<T> {
  value: T;
  commit: boolean;
}

export interface RevisionMetadataStore {
  transaction<T>(
    operation: (draft: MetadataState) => Promise<TransactionOutcome<T>> | TransactionOutcome<T>,
  ): Promise<T>;
  read<T>(operation: (state: Readonly<MetadataState>) => T): Promise<T>;
}

export interface ImmutableBlobStore {
  put(bytes: Uint8Array, expectedHash: string): Promise<{ hash: string; size: number }>;
  get(hash: string): Promise<Uint8Array>;
  has(hash: string): Promise<boolean>;
}

export interface RevisionAvailableEvent {
  type: "cadweb.revision.available";
  tenantId: string;
  projectId: string;
  drawingId: string;
  baseRevision: number;
  revision: number;
  mode: ArtifactMode;
  artifactId: string;
}

export interface RevisionEventPublisher {
  publish(event: RevisionAvailableEvent): Promise<void>;
}

export interface PublishArtifactRequest {
  scope: DrawingScope;
  principal: Principal;
  writerSessionId: string;
  stateHash: string;
  bytes: Uint8Array;
}

export interface AttachCheckpointRequest {
  scope: DrawingScope;
  principal: Principal;
  bytes: Uint8Array;
  expectedRevision?: number;
}

export interface PublishResult {
  revision: RevisionRecord;
  idempotent: boolean;
}

export interface CheckpointResult {
  checkpoint: CheckpointAttachment;
  revision: number;
  idempotent: boolean;
}

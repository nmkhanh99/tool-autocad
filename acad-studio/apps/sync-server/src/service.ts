import { randomUUID } from "node:crypto";

import { equalDigest, isSha256, sha256 } from "./crypto";
import { SyncError } from "./errors";
import { resolveCadWebArtifactByteLimit } from "./limits";
import { applySemanticChange } from "./semantic-state";
import type {
  ArtifactMode,
  ArtifactValidator,
  AttachCheckpointRequest,
  Authorizer,
  CheckpointAttachment,
  CheckpointResult,
  DrawingRecord,
  DrawingScope,
  ImmutableBlobStore,
  MetadataState,
  Principal,
  PublishArtifactRequest,
  PublishResult,
  RevisionAvailableEvent,
  RevisionEventPublisher,
  RevisionMetadataStore,
  RevisionRecord,
  ValidatedWriterArtifact,
  WriterSession,
} from "./types";

const DEFAULT_LEASE_SECONDS = 5 * 60;
const MAX_LEASE_SECONDS = 60 * 60;

function drawingKey(scope: DrawingScope): string {
  return JSON.stringify([scope.tenantId, scope.projectId, scope.drawingId]);
}

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function requireNonEmpty(value: string, label: string): void {
  if (value.length === 0) throw new SyncError("invalid_request", 400, `${label} is required`);
}

function validateScope(scope: DrawingScope): void {
  requireNonEmpty(scope.tenantId, "tenantId");
  requireNonEmpty(scope.projectId, "projectId");
  requireNonEmpty(scope.drawingId, "drawingId");
}

function validateRevision(value: number, label: string, allowZero = true): void {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new SyncError("invalid_request", 400, `${label} is invalid`);
  }
}

function revisionConflict(drawing: DrawingRecord, baseRevision: number): SyncError {
  return new SyncError("revision_conflict", 409, "base revision does not match drawing head", {
    requestedBaseRevision: baseRevision,
    headRevision: drawing.headRevision,
    modelEpoch: drawing.modelEpoch,
    writerSessionId: drawing.activeWriter?.writerSessionId,
  });
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

interface ServiceOptions {
  authorizer: Authorizer;
  validator: ArtifactValidator;
  metadata: RevisionMetadataStore;
  blobs: ImmutableBlobStore;
  publisher: RevisionEventPublisher;
  clock?: () => Date;
  idGenerator?: () => string;
  maxArtifactBytes?: number;
}

interface EventFlight {
  promise: Promise<void>;
}

export interface DrawingHead {
  tenantId: string;
  projectId: string;
  drawingId: string;
  revision: number;
  modelEpoch?: string;
  sourceFingerprint?: string;
  activeWriter?: WriterSession;
}

export class SyncRevisionService {
  private readonly authorizer: Authorizer;
  private readonly validator: ArtifactValidator;
  private readonly metadata: RevisionMetadataStore;
  private readonly blobs: ImmutableBlobStore;
  private readonly publisher: RevisionEventPublisher;
  private readonly clock: () => Date;
  private readonly idGenerator: () => string;
  private readonly maxArtifactBytes: number;
  private readonly eventFlights = new Map<string, EventFlight>();

  constructor(options: ServiceOptions) {
    this.authorizer = options.authorizer;
    this.validator = options.validator;
    this.metadata = options.metadata;
    this.blobs = options.blobs;
    this.publisher = options.publisher;
    this.clock = options.clock ?? (() => new Date());
    this.idGenerator = options.idGenerator ?? randomUUID;
    this.maxArtifactBytes = resolveCadWebArtifactByteLimit(options.maxArtifactBytes);
  }

  async acquireWriterSession(
    scope: DrawingScope,
    principal: Principal,
    leaseSeconds = DEFAULT_LEASE_SECONDS,
  ): Promise<WriterSession> {
    await this.authorize(scope, principal, "writer-session:acquire");
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > MAX_LEASE_SECONDS) {
      throw new SyncError("invalid_request", 400, "leaseSeconds must be between 1 and 3600");
    }
    const now = this.clock();
    const session: WriterSession = {
      writerSessionId: this.idGenerator(),
      principalId: principal.id,
      acquiredAt: now.toISOString(),
      leaseExpiresAt: new Date(now.getTime() + leaseSeconds * 1000).toISOString(),
    };

    return this.metadata.transaction((draft) => {
      const key = drawingKey(scope);
      let drawing = draft.drawings[key];
      if (!drawing) {
        drawing = {
          ...scope,
          headRevision: 0,
          revisions: {},
          idempotency: {},
          checkpointIdempotency: {},
          objectHashes: {},
          writerAudit: [],
        };
        draft.drawings[key] = drawing;
      }
      const active = drawing.activeWriter;
      if (active && Date.parse(active.leaseExpiresAt) > now.getTime()) {
        throw new SyncError("writer_session_conflict", 409, "drawing already has an active writer", {
          writerSessionId: active.writerSessionId,
          leaseExpiresAt: active.leaseExpiresAt,
          manualResolve: true,
        });
      }
      drawing.activeWriter = session;
      drawing.writerAudit.push({
        event: active ? "expired-and-replaced" : "acquired",
        writerSessionId: session.writerSessionId,
        principalId: principal.id,
        at: now.toISOString(),
        leaseExpiresAt: session.leaseExpiresAt,
      });
      return { value: clone(session), commit: true };
    });
  }

  async renewWriterSession(
    scope: DrawingScope,
    principal: Principal,
    writerSessionId: string,
    leaseSeconds = DEFAULT_LEASE_SECONDS,
  ): Promise<WriterSession> {
    await this.authorize(scope, principal, "writer-session:renew");
    if (!Number.isInteger(leaseSeconds) || leaseSeconds < 1 || leaseSeconds > MAX_LEASE_SECONDS) {
      throw new SyncError("invalid_request", 400, "leaseSeconds must be between 1 and 3600");
    }
    const now = this.clock();
    return this.metadata.transaction((draft) => {
      const drawing = this.requireDrawing(draft, scope);
      const active = drawing.activeWriter;
      if (!active || active.writerSessionId !== writerSessionId) {
        throw this.foreignWriter(drawing);
      }
      if (active.principalId !== principal.id) throw this.foreignWriter(drawing);
      if (Date.parse(active.leaseExpiresAt) <= now.getTime()) {
        throw new SyncError("writer_lease_expired", 409, "writer lease has expired", {
          writerSessionId,
          manualResolve: true,
        });
      }
      active.leaseExpiresAt = new Date(now.getTime() + leaseSeconds * 1000).toISOString();
      drawing.writerAudit.push({
        event: "renewed",
        writerSessionId,
        principalId: principal.id,
        at: now.toISOString(),
        leaseExpiresAt: active.leaseExpiresAt,
      });
      return { value: clone(active), commit: true };
    });
  }

  publishSnapshot(request: PublishArtifactRequest): Promise<PublishResult> {
    return this.publishWriterArtifact("snapshot", request);
  }

  publishChangeset(request: PublishArtifactRequest): Promise<PublishResult> {
    return this.publishWriterArtifact("delta", request);
  }

  async attachCheckpoint(request: AttachCheckpointRequest): Promise<CheckpointResult> {
    await this.authorize(request.scope, request.principal, "checkpoint:attach");
    this.validateUpload(request.bytes);
    const checkpoint = await this.validator.validateCheckpoint(request.bytes);
    if (checkpoint.drawingId !== request.scope.drawingId) {
      throw new SyncError("artifact_invalid", 422, "checkpoint drawingId does not match route");
    }
    validateRevision(checkpoint.revision, "checkpoint revision", false);
    if (
      request.expectedRevision !== undefined &&
      checkpoint.revision !== request.expectedRevision
    ) {
      throw new SyncError("artifact_invalid", 422, "checkpoint revision does not match route");
    }
    if (!isSha256(checkpoint.stateHash)) {
      throw new SyncError("artifact_invalid", 422, "checkpoint stateHash must be lowercase SHA-256");
    }
    if (!equalDigest(checkpoint.stateHash, checkpoint.computedStateHash)) {
      throw new SyncError(
        "checkpoint_state_mismatch",
        409,
        "checkpoint package does not reconstruct its claimed semantic state",
        { revision: checkpoint.revision },
      );
    }
    const blobHash = sha256(request.bytes);
    const requestDigest = this.checkpointDigest(request.scope, checkpoint, blobHash);
    const now = this.clock().toISOString();

    return this.metadata.transaction<CheckpointResult>(async (draft) => {
      const drawing = this.requireDrawing(draft, request.scope);
      const accepted = drawing.checkpointIdempotency[checkpoint.checkpointId];
      if (accepted) {
        if (!equalDigest(accepted.requestDigest, requestDigest)) {
          throw new SyncError(
            "idempotency_key_reused",
            409,
            "checkpointId was already used with a different request",
          );
        }
        const existing = drawing.revisions[String(accepted.revision)]
          ?.checkpoints[accepted.checkpointId];
        if (!existing) throw new Error("checkpoint idempotency record is inconsistent");
        return {
          value: { checkpoint: clone(existing), revision: accepted.revision, idempotent: true },
          commit: false,
        };
      }

      const revision = drawing.revisions[String(checkpoint.revision)];
      if (!revision) throw new SyncError("not_found", 404, "revision not found");
      if (revision.modelEpoch !== checkpoint.modelEpoch || revision.stateHash !== checkpoint.stateHash) {
        throw new SyncError(
          "checkpoint_state_mismatch",
          409,
          "checkpoint binding does not match revision semantic state",
          { revision: checkpoint.revision },
        );
      }
      const stored = await this.blobs.put(request.bytes, blobHash);
      const attachment: CheckpointAttachment = {
        checkpointId: checkpoint.checkpointId,
        blobHash: stored.hash,
        blobSize: stored.size,
        modelEpoch: checkpoint.modelEpoch,
        stateHash: checkpoint.stateHash,
        attachedAt: now,
        attachedBy: request.principal.id,
        requestDigest,
      };
      revision.checkpoints[checkpoint.checkpointId] = attachment;
      drawing.checkpointIdempotency[checkpoint.checkpointId] = {
        requestDigest,
        revision: checkpoint.revision,
        checkpointId: checkpoint.checkpointId,
      };
      return {
        value: { checkpoint: clone(attachment), revision: checkpoint.revision, idempotent: false },
        commit: true,
      };
    });
  }

  async getHead(scope: DrawingScope, principal: Principal): Promise<DrawingHead> {
    await this.authorize(scope, principal, "drawing:read");
    return this.metadata.read((state) => {
      const drawing = this.requireDrawing(state, scope);
      return {
        tenantId: drawing.tenantId,
        projectId: drawing.projectId,
        drawingId: drawing.drawingId,
        revision: drawing.headRevision,
        ...(drawing.modelEpoch === undefined ? {} : { modelEpoch: drawing.modelEpoch }),
        ...(drawing.sourceFingerprint === undefined
          ? {}
          : { sourceFingerprint: drawing.sourceFingerprint }),
        ...(drawing.activeWriter === undefined
          ? {}
          : { activeWriter: clone(drawing.activeWriter) }),
      };
    });
  }

  async getRevision(
    scope: DrawingScope,
    principal: Principal,
    revision: number,
  ): Promise<RevisionRecord> {
    await this.authorize(scope, principal, "drawing:read");
    validateRevision(revision, "revision", false);
    return this.metadata.read((state) => clone(this.requireRevision(state, scope, revision)));
  }

  async getRevisionBlob(
    scope: DrawingScope,
    principal: Principal,
    revision: number,
    checkpointId?: string,
  ): Promise<{ bytes: Uint8Array; hash: string; mode: ArtifactMode | "checkpoint" }> {
    await this.authorize(scope, principal, "drawing:read");
    validateRevision(revision, "revision", false);
    const artifact = await this.metadata.read((state) => {
      const record = this.requireRevision(state, scope, revision);
      if (!checkpointId) return { hash: record.blobHash, mode: record.mode as ArtifactMode };
      const checkpoint = record.checkpoints[checkpointId];
      if (!checkpoint) throw new SyncError("not_found", 404, "checkpoint not found");
      return { hash: checkpoint.blobHash, mode: "checkpoint" as const };
    });
    return { ...artifact, bytes: await this.blobs.get(artifact.hash) };
  }

  async getChangesAfter(
    scope: DrawingScope,
    principal: Principal,
    after: number,
    limit = 100,
  ): Promise<RevisionRecord[]> {
    await this.authorize(scope, principal, "drawing:read");
    validateRevision(after, "after");
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000) {
      throw new SyncError("invalid_request", 400, "limit must be between 1 and 1000");
    }
    return this.metadata.read((state) => {
      const drawing = this.requireDrawing(state, scope);
      const result: RevisionRecord[] = [];
      for (let revision = after + 1; revision <= drawing.headRevision && result.length < limit; revision += 1) {
        const record = drawing.revisions[String(revision)];
        if (!record) throw new Error(`missing revision metadata ${revision}`);
        result.push(clone(record));
      }
      return result;
    });
  }

  async recoverUnpublishedEvents(): Promise<number> {
    const pending = await this.metadata.read((state) => {
      const result: Array<{ scope: DrawingScope; revision: number }> = [];
      for (const drawing of Object.values(state.drawings)) {
        for (let revision = 1; revision <= drawing.headRevision; revision += 1) {
          const record = drawing.revisions[String(revision)];
          if (!record) throw new Error(`missing revision metadata ${revision}`);
          if (!record.eventPublishedAt) {
            result.push({
              scope: {
                tenantId: drawing.tenantId,
                projectId: drawing.projectId,
                drawingId: drawing.drawingId,
              },
              revision,
            });
          }
        }
      }
      return result;
    });
    pending.sort((left, right) =>
      lexicalCompare(drawingKey(left.scope), drawingKey(right.scope)) ||
      left.revision - right.revision);
    for (const item of pending) {
      await this.ensureRevisionEventPublished(item.scope, item.revision);
    }
    return pending.length;
  }

  private async publishWriterArtifact(
    expectedMode: ArtifactMode,
    request: PublishArtifactRequest,
  ): Promise<PublishResult> {
    await this.authorize(request.scope, request.principal, "artifact:publish");
    this.validateUpload(request.bytes);
    requireNonEmpty(request.writerSessionId, "writerSessionId");
    if (!isSha256(request.stateHash)) {
      throw new SyncError("invalid_request", 400, "stateHash must be lowercase SHA-256");
    }
    const artifact = expectedMode === "snapshot"
      ? await this.validator.validateSnapshot(request.bytes)
      : await this.validator.validateChangeset(request.bytes);
    this.validateArtifactEnvelope(expectedMode, request.scope, artifact);
    const blobHash = sha256(request.bytes);
    const requestDigest = this.writerDigest(request.scope, request, artifact, blobHash);
    const now = this.clock();

    const result = await this.metadata.transaction<PublishResult>(async (draft) => {
      const drawing = this.requireDrawing(draft, request.scope);
      const accepted = drawing.idempotency[artifact.artifactId];
      if (accepted) {
        if (!equalDigest(accepted.requestDigest, requestDigest)) {
          throw new SyncError(
            "idempotency_key_reused",
            409,
            "artifact id was already used with a different request",
          );
        }
        const revision = drawing.revisions[String(accepted.revision)];
        if (!revision) throw new Error("artifact idempotency record is inconsistent");
        return { value: { revision: clone(revision), idempotent: true }, commit: false };
      }
      this.requireActiveWriter(drawing, request.writerSessionId, request.principal.id, now);
      if (artifact.baseRevision !== drawing.headRevision) {
        throw revisionConflict(drawing, artifact.baseRevision);
      }
      if (artifact.mode === "delta" && drawing.headRevision === 0) {
        throw new SyncError("revision_conflict", 409, "initial publish must be a snapshot");
      }
      if (drawing.headRevision > 0) {
        if (artifact.mode === "delta" && artifact.modelEpoch !== drawing.modelEpoch) {
          throw new SyncError("model_epoch_conflict", 409, "delta modelEpoch does not match head", {
            headRevision: drawing.headRevision,
            modelEpoch: drawing.modelEpoch,
          });
        }
        if (
          artifact.modelEpoch === drawing.modelEpoch &&
          artifact.sourceFingerprint !== drawing.sourceFingerprint
        ) {
          throw new SyncError(
            "source_fingerprint_conflict",
            409,
            "source fingerprint changed without a snapshot epoch transition",
          );
        }
      }

      const semanticState = applySemanticChange(
        artifact.drawingId,
        artifact.modelEpoch,
        drawing.objectHashes,
        artifact.semanticChange,
      );
      if (!equalDigest(semanticState.stateHash, request.stateHash)) {
        throw new SyncError(
          "artifact_invalid",
          422,
          "stateHash does not match the canonical artifact result",
        );
      }

      const stored = await this.blobs.put(request.bytes, blobHash);
      const revisionNumber = drawing.headRevision + 1;
      if (!Number.isSafeInteger(revisionNumber)) throw new Error("revision exhausted safe integer range");
      const revision: RevisionRecord = {
        revision: revisionNumber,
        baseRevision: artifact.baseRevision,
        mode: artifact.mode,
        artifactId: artifact.artifactId,
        writerSessionId: request.writerSessionId,
        modelEpoch: artifact.modelEpoch,
        sourceFingerprint: artifact.sourceFingerprint,
        stateHash: semanticState.stateHash,
        modelEmpty: artifact.semanticChange.modelEmpty,
        resultExtents: clone(artifact.semanticChange.resultExtents),
        blobHash: stored.hash,
        blobSize: stored.size,
        requestDigest,
        createdAt: now.toISOString(),
        checkpoints: {},
      };
      drawing.revisions[String(revisionNumber)] = revision;
      drawing.idempotency[artifact.artifactId] = { requestDigest, revision: revisionNumber };
      drawing.headRevision = revisionNumber;
      drawing.modelEpoch = artifact.modelEpoch;
      drawing.sourceFingerprint = artifact.sourceFingerprint;
      drawing.objectHashes = semanticState.objectHashes;
      return { value: { revision: clone(revision), idempotent: false }, commit: true };
    });

    await this.ensureRevisionEventPublished(request.scope, result.revision.revision);
    const current = await this.metadata.read((state) =>
      clone(this.requireRevision(state, request.scope, result.revision.revision)));
    return { revision: current, idempotent: result.idempotent };
  }

  private async ensureRevisionEventPublished(scope: DrawingScope, revisionNumber: number): Promise<void> {
    const key = `${drawingKey(scope)}:${revisionNumber}`;
    const existing = this.eventFlights.get(key);
    if (existing) return existing.promise;
    const promise = this.publishRevisionEvent(scope, revisionNumber).finally(() => {
      this.eventFlights.delete(key);
    });
    this.eventFlights.set(key, { promise });
    return promise;
  }

  private async publishRevisionEvent(scope: DrawingScope, revisionNumber: number): Promise<void> {
    const event = await this.metadata.read((state): RevisionAvailableEvent | undefined => {
      const revision = this.requireRevision(state, scope, revisionNumber);
      if (revision.eventPublishedAt) return undefined;
      return {
        type: "cadweb.revision.available",
        ...scope,
        baseRevision: revision.baseRevision,
        revision: revision.revision,
        mode: revision.mode,
        artifactId: revision.artifactId,
      };
    });
    if (!event) return;
    await this.publisher.publish(event);
    const publishedAt = this.clock().toISOString();
    await this.metadata.transaction((draft) => {
      const revision = this.requireRevision(draft, scope, revisionNumber);
      if (!revision.eventPublishedAt) revision.eventPublishedAt = publishedAt;
      return { value: undefined, commit: true };
    });
  }

  private async authorize(
    scope: DrawingScope,
    principal: Principal,
    action: Parameters<Authorizer["authorize"]>[0]["action"],
  ): Promise<void> {
    validateScope(scope);
    requireNonEmpty(principal.id, "principal.id");
    if (!await this.authorizer.authorize({ ...scope, principal, action })) {
      throw new SyncError("forbidden", 403, "access denied");
    }
  }

  private requireDrawing(
    state: Readonly<MetadataState> | MetadataState,
    scope: DrawingScope,
  ): DrawingRecord {
    const drawing = state.drawings[drawingKey(scope)];
    if (!drawing) throw new SyncError("not_found", 404, "drawing not found");
    return drawing;
  }

  private requireRevision(
    state: Readonly<MetadataState> | MetadataState,
    scope: DrawingScope,
    revision: number,
  ): RevisionRecord {
    const drawing = this.requireDrawing(state, scope);
    const record = drawing.revisions[String(revision)];
    if (!record) throw new SyncError("not_found", 404, "revision not found");
    return record;
  }

  private requireActiveWriter(
    drawing: DrawingRecord,
    sessionId: string,
    principalId: string,
    now: Date,
  ): void {
    const active = drawing.activeWriter;
    if (
      !active || active.writerSessionId !== sessionId ||
      active.principalId !== principalId
    ) throw this.foreignWriter(drawing);
    if (Date.parse(active.leaseExpiresAt) <= now.getTime()) {
      throw new SyncError("writer_lease_expired", 409, "writer lease has expired", {
        writerSessionId: sessionId,
        headRevision: drawing.headRevision,
        manualResolve: true,
      });
    }
  }

  private foreignWriter(drawing: DrawingRecord): SyncError {
    return new SyncError(
      "writer_session_conflict",
      409,
      "request does not own the active writer lease",
      {
        writerSessionId: drawing.activeWriter?.writerSessionId,
        headRevision: drawing.headRevision,
        modelEpoch: drawing.modelEpoch,
        manualResolve: true,
      },
    );
  }

  private validateUpload(bytes: Uint8Array): void {
    if (bytes.byteLength === 0) throw new SyncError("artifact_invalid", 422, "artifact is empty");
    if (bytes.byteLength > this.maxArtifactBytes) {
      throw new SyncError("upload_too_large", 413, "artifact exceeds upload limit", {
        maxArtifactBytes: this.maxArtifactBytes,
      });
    }
  }

  private validateArtifactEnvelope(
    expectedMode: ArtifactMode,
    scope: DrawingScope,
    artifact: ValidatedWriterArtifact,
  ): void {
    if (artifact.mode !== expectedMode) {
      throw new SyncError("artifact_invalid", 422, `expected ${expectedMode} artifact`);
    }
    requireNonEmpty(artifact.artifactId, "artifactId");
    requireNonEmpty(artifact.modelEpoch, "modelEpoch");
    requireNonEmpty(artifact.sourceFingerprint, "sourceFingerprint");
    validateRevision(artifact.baseRevision, "baseRevision");
    if (artifact.drawingId !== scope.drawingId) {
      throw new SyncError("artifact_invalid", 422, "artifact drawingId does not match route");
    }
  }

  private writerDigest(
    scope: DrawingScope,
    request: PublishArtifactRequest,
    artifact: ValidatedWriterArtifact,
    blobHash: string,
  ): string {
    return sha256(JSON.stringify([
      1,
      "writer-artifact",
      artifact.mode,
      scope.tenantId,
      scope.projectId,
      scope.drawingId,
      artifact.artifactId,
      request.writerSessionId,
      artifact.baseRevision,
      artifact.modelEpoch,
      artifact.sourceFingerprint,
      request.stateHash,
      blobHash,
    ]));
  }

  private checkpointDigest(
    scope: DrawingScope,
    checkpoint: Awaited<ReturnType<ArtifactValidator["validateCheckpoint"]>>,
    blobHash: string,
  ): string {
    return sha256(JSON.stringify([
      1,
      "checkpoint",
      scope.tenantId,
      scope.projectId,
      scope.drawingId,
      checkpoint.checkpointId,
      checkpoint.revision,
      checkpoint.modelEpoch,
      checkpoint.stateHash,
      blobHash,
    ]));
  }
}

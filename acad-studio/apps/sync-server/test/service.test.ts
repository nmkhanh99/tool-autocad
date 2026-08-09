import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { CadWebArtifactValidator } from "../src/cadweb-validator";
import { createFileBackedSyncService } from "../src/factory";
import { InMemoryRevisionMetadataStore } from "../src/metadata-store";
import { MAX_CADWEB_ARTIFACT_BYTES } from "../src/limits";
import { applySemanticChange } from "../src/semantic-state";
import { SyncRevisionService } from "../src/service";
import { SyncError } from "../src/errors";
import { sha256 } from "../src/crypto";
import type {
  ArtifactValidator,
  Authorizer,
  DrawingScope,
  ImmutableBlobStore,
  MetadataState,
  Principal,
  RevisionAvailableEvent,
  RevisionEventPublisher,
  RevisionMetadataStore,
  TransactionOutcome,
} from "../src/types";
import {
  createDelta,
  createSnapshot,
  drawingId,
  modelEpoch,
  nativeInitialStateHash,
} from "./fixtures";

const scope: DrawingScope = { tenantId: "tenant-a", projectId: "project-a", drawingId };
const principal: Principal = { id: "writer-a" };

class MemoryBlobStore implements ImmutableBlobStore {
  readonly values = new Map<string, Uint8Array>();
  putCalls = 0;

  async put(bytes: Uint8Array, expectedHash: string): Promise<{ hash: string; size: number }> {
    this.putCalls += 1;
    assert.equal(sha256(bytes), expectedHash);
    const existing = this.values.get(expectedHash);
    if (existing) assert.deepEqual(existing, bytes);
    else this.values.set(expectedHash, Uint8Array.from(bytes));
    return { hash: expectedHash, size: bytes.byteLength };
  }

  async get(hash: string): Promise<Uint8Array> {
    const value = this.values.get(hash);
    if (!value) throw new Error("missing blob");
    return Uint8Array.from(value);
  }

  async has(hash: string): Promise<boolean> {
    return this.values.has(hash);
  }
}

class CrashBeforeCommitStore implements RevisionMetadataStore {
  readonly inner = new InMemoryRevisionMetadataStore();
  crashNextCommit = false;

  transaction<T>(
    operation: (draft: MetadataState) => Promise<TransactionOutcome<T>> | TransactionOutcome<T>,
  ): Promise<T> {
    if (!this.crashNextCommit) return this.inner.transaction(operation);
    this.crashNextCommit = false;
    return this.inner.transaction(async (draft) => {
      await operation(draft);
      throw new Error("simulated process death before metadata commit");
    });
  }

  read<T>(operation: (state: Readonly<MetadataState>) => T): Promise<T> {
    return this.inner.read(operation);
  }
}

interface HarnessOptions {
  metadata?: RevisionMetadataStore;
  blobs?: MemoryBlobStore;
  validator?: ArtifactValidator;
  publisher?: RevisionEventPublisher;
  authorizer?: Authorizer;
}

function harness(options: HarnessOptions = {}) {
  const blobs = options.blobs ?? new MemoryBlobStore();
  const events: RevisionAvailableEvent[] = [];
  const publisher = options.publisher ?? {
    async publish(event: RevisionAvailableEvent) {
      events.push(event);
    },
  };
  const authorizer = options.authorizer ?? {
    async authorize() {
      return true;
    },
  };
  let now = new Date("2026-08-09T10:00:00.000Z");
  let nextId = 0;
  const service = new SyncRevisionService({
    authorizer,
    validator: options.validator ?? new CadWebArtifactValidator(),
    metadata: options.metadata ?? new InMemoryRevisionMetadataStore(),
    blobs,
    publisher,
    clock: () => new Date(now),
    idGenerator: () => `session-${++nextId}`,
  });
  return {
    service,
    blobs,
    events,
    setNow(value: string) {
      now = new Date(value);
    },
  };
}

function hasCode(code: SyncError["code"]): (error: unknown) => boolean {
  return (error) => error instanceof SyncError && error.code === code;
}

async function deltaStateHash(bytes: Uint8Array): Promise<string> {
  const validator = new CadWebArtifactValidator();
  const snapshot = await validator.validateSnapshot(await createSnapshot());
  const initial = applySemanticChange(drawingId, modelEpoch, {}, snapshot.semanticChange);
  const delta = await validator.validateChangeset(bytes);
  return applySemanticChange(
    drawingId,
    modelEpoch,
    initial.objectHashes,
    delta.semanticChange,
  ).stateHash;
}

test("service default upload limit matches the 256 MiB archive limit", async () => {
  const { service } = harness();
  await assert.rejects(
    service.publishSnapshot({
      scope,
      principal,
      writerSessionId: "unused",
      stateHash: nativeInitialStateHash,
      bytes: { byteLength: MAX_CADWEB_ARTIFACT_BYTES + 1 } as Uint8Array,
    }),
    (error) => error instanceof SyncError &&
      error.code === "upload_too_large" &&
      error.details?.maxArtifactBytes === MAX_CADWEB_ARTIFACT_BYTES,
  );
});

test("ten identical concurrent snapshot uploads create one revision and one event", async () => {
  const { service, blobs, events } = harness();
  const session = await service.acquireWriterSession(scope, principal);
  const bytes = await createSnapshot();
  const request = {
    scope,
    principal,
    writerSessionId: session.writerSessionId,
    stateHash: nativeInitialStateHash,
    bytes,
  };
  const results = await Promise.all(Array.from({ length: 10 }, () => service.publishSnapshot(request)));

  assert.equal(results.filter((result) => !result.idempotent).length, 1);
  assert.equal(results.filter((result) => result.idempotent).length, 9);
  assert.deepEqual(new Set(results.map((result) => result.revision.revision)), new Set([1]));
  assert.equal((await service.getHead(scope, principal)).revision, 1);
  assert.equal(blobs.putCalls, 1);
  assert.equal(events.length, 1);
});

test("ten identical concurrent changeset uploads create one revision and one event", async () => {
  const { service, blobs, events } = harness();
  const session = await service.acquireWriterSession(scope, principal);
  await service.publishSnapshot({
    scope,
    principal,
    writerSessionId: session.writerSessionId,
    stateHash: nativeInitialStateHash,
    bytes: await createSnapshot(),
  });
  const bytes = await createDelta();
  const request = {
    scope,
    principal,
    writerSessionId: session.writerSessionId,
    stateHash: await deltaStateHash(bytes),
    bytes,
  };
  const results = await Promise.all(Array.from({ length: 10 }, () => service.publishChangeset(request)));

  assert.equal(results.filter((result) => !result.idempotent).length, 1);
  assert.equal(results.filter((result) => result.idempotent).length, 9);
  assert.deepEqual(new Set(results.map((result) => result.revision.revision)), new Set([2]));
  assert.equal((await service.getHead(scope, principal)).revision, 2);
  assert.equal(blobs.putCalls, 2);
  assert.equal(events.length, 2);
});

test("artifact id reuse, stale CAS and a false state hash never mutate head", async () => {
  const { service } = harness();
  const session = await service.acquireWriterSession(scope, principal);
  const initial = {
    scope,
    principal,
    writerSessionId: session.writerSessionId,
    stateHash: nativeInitialStateHash,
    bytes: await createSnapshot(),
  };
  await service.publishSnapshot(initial);

  await assert.rejects(
    service.publishSnapshot({
      ...initial,
      bytes: await createSnapshot({ producerPlatform: "different-valid-bytes" }),
    }),
    hasCode("idempotency_key_reused"),
  );
  await assert.rejects(
    service.publishSnapshot({
      ...initial,
      bytes: await createSnapshot({ baseRevision: 1 }),
    }),
    hasCode("idempotency_key_reused"),
  );
  await assert.rejects(
    service.publishSnapshot({
      ...initial,
      bytes: await createSnapshot({ modelEpoch: "epoch-reused" }),
    }),
    hasCode("idempotency_key_reused"),
  );
  await assert.rejects(
    service.publishSnapshot({
      ...initial,
      bytes: await createSnapshot({ snapshotId: "snapshot-stale", baseRevision: 0 }),
    }),
    hasCode("revision_conflict"),
  );
  const deltaBytes = await createDelta();
  await assert.rejects(
    service.publishChangeset({
      ...initial,
      bytes: deltaBytes,
      stateHash: "0".repeat(64),
    }),
    hasCode("artifact_invalid"),
  );
  assert.equal((await service.getHead(scope, principal)).revision, 1);
});

test("only one distinct changeset wins a concurrent compare-and-swap", async () => {
  const { service } = harness();
  const session = await service.acquireWriterSession(scope, principal);
  await service.publishSnapshot({
    scope,
    principal,
    writerSessionId: session.writerSessionId,
    stateHash: nativeInitialStateHash,
    bytes: await createSnapshot(),
  });
  const leftBytes = await createDelta({ changeSetId: "change-left", end: [15, 4, 0] });
  const rightBytes = await createDelta({ changeSetId: "change-right", end: [18, 4, 0] });
  const settled = await Promise.allSettled([
    service.publishChangeset({
      scope,
      principal,
      writerSessionId: session.writerSessionId,
      stateHash: await deltaStateHash(leftBytes),
      bytes: leftBytes,
    }),
    service.publishChangeset({
      scope,
      principal,
      writerSessionId: session.writerSessionId,
      stateHash: await deltaStateHash(rightBytes),
      bytes: rightBytes,
    }),
  ]);

  assert.equal(settled.filter((result) => result.status === "fulfilled").length, 1);
  const rejected = settled.find((result) => result.status === "rejected") as PromiseRejectedResult;
  assert.ok(hasCode("revision_conflict")(rejected.reason));
  assert.equal((await service.getHead(scope, principal)).revision, 2);
});

test("writer lease is bound to its principal and foreign-session recovery is manual", async () => {
  const { service, setNow } = harness();
  const first = await service.acquireWriterSession(scope, principal, 1);
  const stolen = { id: "writer-b" };
  await assert.rejects(
    service.publishSnapshot({
      scope,
      principal: stolen,
      writerSessionId: first.writerSessionId,
      stateHash: nativeInitialStateHash,
      bytes: await createSnapshot(),
    }),
    hasCode("writer_session_conflict"),
  );

  setNow("2026-08-09T10:00:02.000Z");
  const second = await service.acquireWriterSession(scope, stolen);
  assert.notEqual(second.writerSessionId, first.writerSessionId);
  await assert.rejects(
    service.publishSnapshot({
      scope,
      principal,
      writerSessionId: first.writerSessionId,
      stateHash: nativeInitialStateHash,
      bytes: await createSnapshot(),
    }),
    hasCode("writer_session_conflict"),
  );
  assert.equal((await service.getHead(scope, stolen)).revision, 0);
});

test("authorization runs before artifact validation and idempotency lookup", async () => {
  let validatorCalls = 0;
  const validator: ArtifactValidator = {
    async validateSnapshot() {
      validatorCalls += 1;
      throw new Error("must not be reached");
    },
    async validateChangeset() {
      validatorCalls += 1;
      throw new Error("must not be reached");
    },
    async validateCheckpoint() {
      validatorCalls += 1;
      throw new Error("must not be reached");
    },
  };
  const { service } = harness({
    validator,
    authorizer: { async authorize() { return false; } },
  });
  await assert.rejects(
    service.publishSnapshot({
      scope,
      principal,
      writerSessionId: "unknown",
      stateHash: nativeInitialStateHash,
      bytes: Uint8Array.of(1),
    }),
    hasCode("forbidden"),
  );
  assert.equal(validatorCalls, 0);
});

test("lost ACK after commit is recovered by an idempotent retry", async () => {
  let failEvent = true;
  const events: RevisionAvailableEvent[] = [];
  const { service } = harness({
    publisher: {
      async publish(event) {
        if (failEvent) throw new Error("simulated event transport crash");
        events.push(event);
      },
    },
  });
  const session = await service.acquireWriterSession(scope, principal);
  const request = {
    scope,
    principal,
    writerSessionId: session.writerSessionId,
    stateHash: nativeInitialStateHash,
    bytes: await createSnapshot(),
  };
  await assert.rejects(service.publishSnapshot(request), /simulated event transport crash/);
  assert.equal((await service.getHead(scope, principal)).revision, 1);

  failEvent = false;
  const retry = await service.publishSnapshot(request);
  assert.equal(retry.idempotent, true);
  assert.equal(retry.revision.revision, 1);
  assert.ok(retry.revision.eventPublishedAt);
  assert.equal(events.length, 1);
});

test("lost ACK remains idempotent after the writer lease expires or is replaced", async () => {
  const { service, events, setNow } = harness();
  const firstWriter = await service.acquireWriterSession(scope, principal, 1);
  const bytes = await createSnapshot();
  const request = {
    scope,
    principal,
    writerSessionId: firstWriter.writerSessionId,
    stateHash: nativeInitialStateHash,
    bytes,
  };
  await service.publishSnapshot(request);

  setNow("2026-08-09T10:00:02.000Z");
  assert.equal((await service.publishSnapshot(request)).idempotent, true);

  await service.acquireWriterSession(scope, { id: "writer-b" });
  const afterReplacement = await service.publishSnapshot(request);
  assert.equal(afterReplacement.idempotent, true);
  assert.equal(afterReplacement.revision.revision, 1);
  assert.equal((await service.getHead(scope, principal)).revision, 1);
  assert.equal(events.length, 1);

  await assert.rejects(
    service.publishSnapshot({
      ...request,
      bytes: await createSnapshot({ producerPlatform: "id-reuse-after-replacement" }),
    }),
    hasCode("idempotency_key_reused"),
  );
});

test("a crash before metadata commit leaves at most an orphan blob and retry succeeds", async () => {
  const metadata = new CrashBeforeCommitStore();
  const blobs = new MemoryBlobStore();
  const { service } = harness({ metadata, blobs });
  const session = await service.acquireWriterSession(scope, principal);
  const request = {
    scope,
    principal,
    writerSessionId: session.writerSessionId,
    stateHash: nativeInitialStateHash,
    bytes: await createSnapshot(),
  };
  metadata.crashNextCommit = true;
  await assert.rejects(service.publishSnapshot(request), /simulated process death/);
  assert.equal((await service.getHead(scope, principal)).revision, 0);
  assert.equal(blobs.values.size, 1);

  const retry = await service.publishSnapshot(request);
  assert.equal(retry.revision.revision, 1);
  assert.equal((await service.getHead(scope, principal)).revision, 1);
});

test("checkpoint attach is idempotent, verifies semantic state and never advances head", async () => {
  const { service, events } = harness();
  const session = await service.acquireWriterSession(scope, principal);
  await service.publishSnapshot({
    scope,
    principal,
    writerSessionId: session.writerSessionId,
    stateHash: nativeInitialStateHash,
    bytes: await createSnapshot(),
  });
  const checkpointBytes = await createSnapshot({
    checkpoint: { checkpointId: "checkpoint-1", revision: 1, stateHash: nativeInitialStateHash },
  });
  const first = await service.attachCheckpoint({ scope, principal, bytes: checkpointBytes });
  const retry = await service.attachCheckpoint({ scope, principal, bytes: checkpointBytes });
  assert.equal(first.idempotent, false);
  assert.equal(retry.idempotent, true);
  assert.equal((await service.getHead(scope, principal)).revision, 1);
  assert.equal(events.length, 1);

  const falseCheckpoint = await createSnapshot({
    checkpoint: { checkpointId: "checkpoint-false", revision: 1, stateHash: "0".repeat(64) },
  });
  await assert.rejects(
    service.attachCheckpoint({ scope, principal, bytes: falseCheckpoint }),
    hasCode("checkpoint_state_mismatch"),
  );
});

test("file-backed restart recovers a committed blob/head and an unpublished event", async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), "cadweb-sync-server-"));
  const authorizer: Authorizer = { async authorize() { return true; } };
  const fixedClock = () => new Date("2026-08-09T10:00:00.000Z");
  try {
    const first = await createFileBackedSyncService({
      dataDirectory,
      authorizer,
      publisher: { async publish() { throw new Error("publisher crashed"); } },
      clock: fixedClock,
      idGenerator: () => "durable-session",
    });
    const session = await first.acquireWriterSession(scope, principal);
    const bytes = await createSnapshot();
    const request = {
      scope,
      principal,
      writerSessionId: session.writerSessionId,
      stateHash: nativeInitialStateHash,
      bytes,
    };
    await assert.rejects(first.publishSnapshot(request), /publisher crashed/);

    const recoveredEvents: RevisionAvailableEvent[] = [];
    const restarted = await createFileBackedSyncService({
      dataDirectory,
      authorizer,
      publisher: { async publish(event) { recoveredEvents.push(event); } },
      clock: fixedClock,
    });
    assert.equal(recoveredEvents.length, 1);
    assert.equal((await restarted.getHead(scope, principal)).revision, 1);
    assert.deepEqual(
      Buffer.from((await restarted.getRevisionBlob(scope, principal, 1)).bytes),
      Buffer.from(bytes),
    );
    assert.equal((await restarted.publishSnapshot(request)).idempotent, true);
    assert.equal(recoveredEvents.length, 1);
  } finally {
    await rm(dataDirectory, { recursive: true, force: true });
  }
});

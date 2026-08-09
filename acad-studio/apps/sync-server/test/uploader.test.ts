import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { sha256 } from "../src/crypto";
import { MAX_CADWEB_ARTIFACT_BYTES } from "../src/limits";
import { FileReadyOutboxStore, LocalOutboxError, type ReadyOutboxManifest } from "../src/local-outbox";
import {
  FetchRevisionPublishClient,
  LocalOutboxUploader,
  RevisionPublishError,
  type RemotePublishAcknowledgement,
  type RevisionPublishClient,
} from "../src/uploader";

const stateHash = "a".repeat(64);
const outboxScope = { tenantId: "tenant-a", projectId: "project-a" };

interface ReadyOptions {
  artifactId?: string;
  drawingId?: string;
  artifactKind?: "snapshot" | "delta";
  baseRevision?: number;
  bytes?: Uint8Array;
  payloadSize?: number;
  publishReady?: boolean;
}

async function writeReady(root: string, options: ReadyOptions = {}): Promise<ReadyOutboxManifest> {
  const artifactId = options.artifactId ?? "change-a";
  const artifactKind = options.artifactKind ?? "delta";
  const bytes = options.bytes ?? Uint8Array.from([1, 2, 3, 4]);
  const itemsDirectory = join(root, "outbox", "items");
  await mkdir(itemsDirectory, { recursive: true });
  const stagingName = `${artifactId}.staged`;
  const stagingPath = join(itemsDirectory, stagingName);
  await mkdir(stagingPath);
  const fileName = artifactKind === "snapshot" ? "payload.cadweb" : "payload.cadwebdelta";
  const manifest: ReadyOutboxManifest = {
    schemaVersion: 1,
    artifactKind,
    artifactId,
    saveToken: `save-${artifactId}`,
    drawingId: options.drawingId ?? "drawing-a",
    modelEpoch: "epoch-a",
    writerSessionId: "session-a",
    baseRevision: options.baseRevision ?? (artifactKind === "snapshot" ? 0 : 1),
    resultStateHash: stateHash,
    payload: { fileName, size: options.payloadSize ?? bytes.byteLength, sha256: sha256(bytes) },
  };
  await writeFile(join(stagingPath, "item.json"), `${JSON.stringify(manifest)}\n`);
  await writeFile(join(stagingPath, fileName), bytes);
  if (options.publishReady !== false) {
    await rename(stagingPath, join(itemsDirectory, `${artifactId}.ready`));
  }
  return manifest;
}

async function temporaryRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), "cadweb-uploader-"));
}

class SequenceClient implements RevisionPublishClient {
  calls = 0;
  readonly responses: Array<RemotePublishAcknowledgement | Error>;

  constructor(responses: Array<RemotePublishAcknowledgement | Error>) {
    this.responses = responses;
  }

  async publish(): Promise<RemotePublishAcknowledgement> {
    const response = this.responses[Math.min(this.calls, this.responses.length - 1)];
    this.calls += 1;
    if (!response) throw new Error("missing fake response");
    if (response instanceof Error) throw response;
    return response;
  }
}

test("only atomically published .ready directories become visible", async () => {
  const root = await temporaryRoot();
  try {
    await writeReady(root, { artifactId: "still-staging", publishReady: false });
    await writeReady(root, { artifactId: "ready-item" });
    const entries = await new FileReadyOutboxStore(root, outboxScope).list();
    assert.deepEqual(entries.map((entry) => entry.manifest.artifactId), ["ready-item"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("default outbox payload limit matches the 256 MiB archive limit", async () => {
  const acceptedRoot = await temporaryRoot();
  const rejectedRoot = await temporaryRoot();
  try {
    assert.throws(
      () => new FileReadyOutboxStore(
        acceptedRoot,
        outboxScope,
        MAX_CADWEB_ARTIFACT_BYTES + 1,
      ),
      RangeError,
    );
    await writeReady(acceptedRoot, { payloadSize: MAX_CADWEB_ARTIFACT_BYTES });
    const [accepted] = await new FileReadyOutboxStore(acceptedRoot, outboxScope).list();
    assert.equal(accepted?.manifest.payload.size, MAX_CADWEB_ARTIFACT_BYTES);

    await writeReady(rejectedRoot, { payloadSize: MAX_CADWEB_ARTIFACT_BYTES + 1 });
    await assert.rejects(
      new FileReadyOutboxStore(rejectedRoot, outboxScope).list(),
      (error) => error instanceof LocalOutboxError && error.code === "payload_too_large",
    );
  } finally {
    await rm(acceptedRoot, { recursive: true, force: true });
    await rm(rejectedRoot, { recursive: true, force: true });
  }
});

test("scope marker survives same-scope restart and a mismatch never uploads", async () => {
  const root = await temporaryRoot();
  try {
    await writeReady(root);
    await new FileReadyOutboxStore(root, outboxScope).list();
    assert.deepEqual(JSON.parse(await readFile(join(root, "scope.json"), "utf8")), {
      schemaVersion: 1,
      ...outboxScope,
    });
    assert.equal(
      (await new FileReadyOutboxStore(root, outboxScope).list()).length,
      1,
      "same tenant/project can reopen the durable root",
    );

    const client = new SequenceClient([
      { artifactId: "change-a", revision: 2, stateHash, idempotent: false },
    ]);
    const mismatchedStore = new FileReadyOutboxStore(root, {
      tenantId: outboxScope.tenantId,
      projectId: "project-b",
    });
    await assert.rejects(
      new LocalOutboxUploader({ store: mismatchedStore, client }).runOnce(),
      (error) => error instanceof LocalOutboxError && error.code === "scope_mismatch",
    );
    assert.equal(client.calls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid scope marker fails closed before upload", async () => {
  const root = await temporaryRoot();
  try {
    await writeReady(root);
    await writeFile(join(root, "scope.json"), "{}\n");
    const client = new SequenceClient([
      { artifactId: "change-a", revision: 2, stateHash, idempotent: false },
    ]);
    await assert.rejects(
      new LocalOutboxUploader({
        store: new FileReadyOutboxStore(root, outboxScope),
        client,
      }).runOnce(),
      (error) => error instanceof LocalOutboxError && error.code === "scope_invalid",
    );
    assert.equal(client.calls, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent first use claims one tenant/project without overwriting", async () => {
  const root = await temporaryRoot();
  const otherScope = { tenantId: "tenant-b", projectId: "project-b" };
  try {
    const results = await Promise.allSettled([
      new FileReadyOutboxStore(root, outboxScope).list(),
      new FileReadyOutboxStore(root, otherScope).list(),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
    const marker = JSON.parse(await readFile(join(root, "scope.json"), "utf8")) as {
      tenantId: string;
      projectId: string;
    };
    const winningScope = marker.tenantId === outboxScope.tenantId ? outboxScope : otherScope;
    const losingScope = winningScope === outboxScope ? otherScope : outboxScope;
    await new FileReadyOutboxStore(root, winningScope).list();
    await assert.rejects(
      new FileReadyOutboxStore(root, losingScope).list(),
      (error) => error instanceof LocalOutboxError && error.code === "scope_mismatch",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("network loss persists exponential retry and restart resumes idempotently", async () => {
  const root = await temporaryRoot();
  let now = new Date("2026-08-09T10:00:00.000Z");
  try {
    await writeReady(root);
    const store = new FileReadyOutboxStore(root, outboxScope);
    const client = new SequenceClient([
      new RevisionPublishError("network_error", "ACK was lost"),
      { artifactId: "change-a", revision: 2, stateHash, idempotent: true },
    ]);
    const first = new LocalOutboxUploader({
      store,
      client,
      clock: () => new Date(now),
      initialRetryDelayMs: 1_000,
    });
    assert.deepEqual((await first.runOnce()).retryScheduled, ["change-a"]);
    let [entry] = await store.list();
    assert.equal(entry?.delivery?.status, "retry-wait");
    assert.equal(entry?.delivery?.attemptCount, 1);
    assert.equal(entry?.delivery?.nextAttemptAt, "2026-08-09T10:00:01.000Z");

    const restarted = new LocalOutboxUploader({
      store: new FileReadyOutboxStore(root, outboxScope),
      client,
      clock: () => new Date(now),
      initialRetryDelayMs: 1_000,
    });
    assert.deepEqual((await restarted.runOnce()).skipped, ["change-a"]);
    assert.equal(client.calls, 1);

    assert.deepEqual(
      (await restarted.runOnce({ forceRetryWait: true })).acknowledged,
      ["change-a"],
    );
    [entry] = await store.list();
    assert.equal(entry?.acknowledgement?.revision, 2);
    assert.equal(entry?.acknowledgement?.stateHash, stateHash);
    assert.equal(client.calls, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("concurrent poll ticks share one upload flight", async () => {
  const root = await temporaryRoot();
  try {
    await writeReady(root);
    let calls = 0;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const client: RevisionPublishClient = {
      async publish() {
        calls += 1;
        await gate;
        return { artifactId: "change-a", revision: 2, stateHash, idempotent: false };
      },
    };
    const uploader = new LocalOutboxUploader({
      store: new FileReadyOutboxStore(root, outboxScope),
      client,
    });
    const left = uploader.runOnce();
    const right = uploader.runOnce();
    assert.equal(left, right);
    release();
    const [leftResult, rightResult] = await Promise.all([left, right]);
    assert.deepEqual(leftResult, rightResult);
    assert.equal(calls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("payload corruption is blocked locally and never reaches the network", async () => {
  const root = await temporaryRoot();
  try {
    const manifest = await writeReady(root);
    await writeFile(
      join(root, "outbox", "items", `${manifest.artifactId}.ready`, manifest.payload.fileName),
      Uint8Array.from([9, 9, 9, 9]),
    );
    const client = new SequenceClient([
      { artifactId: manifest.artifactId, revision: 2, stateHash, idempotent: false },
    ]);
    const store = new FileReadyOutboxStore(root, outboxScope);
    const result = await new LocalOutboxUploader({ store, client }).runOnce();
    assert.deepEqual(result.blocked, [manifest.artifactId]);
    assert.equal(client.calls, 0);
    assert.equal((await store.list())[0]?.delivery?.status, "invalid");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("ACK must assign exactly the next authoritative revision", async () => {
  const remoteRoot = await temporaryRoot();
  const durableRoot = await temporaryRoot();
  try {
    await writeReady(remoteRoot, { baseRevision: 1 });
    const client = new SequenceClient([
      { artifactId: "change-a", revision: 3, stateHash, idempotent: false },
    ]);
    const remoteStore = new FileReadyOutboxStore(remoteRoot, outboxScope);
    const result = await new LocalOutboxUploader({
      store: remoteStore,
      client,
    }).runOnce();
    assert.deepEqual(result.blocked, ["change-a"]);
    assert.equal((await remoteStore.list())[0]?.delivery?.status, "invalid");
    assert.equal((await remoteStore.list())[0]?.acknowledgement, undefined);

    const manifest = await writeReady(durableRoot, { baseRevision: 1 });
    const readyDirectory = join(
      durableRoot,
      "outbox",
      "items",
      `${manifest.artifactId}.ready`,
    );
    await writeFile(join(readyDirectory, "ack.json"), `${JSON.stringify({
      schemaVersion: 1,
      artifactId: manifest.artifactId,
      saveToken: manifest.saveToken,
      revision: 3,
      stateHash,
      acknowledgedAt: "2026-08-09T12:00:00.000Z",
    })}\n`);
    await assert.rejects(
      new FileReadyOutboxStore(durableRoot, outboxScope).list(),
      (error) => error instanceof LocalOutboxError && error.code === "ack_invalid",
    );
  } finally {
    await rm(remoteRoot, { recursive: true, force: true });
    await rm(durableRoot, { recursive: true, force: true });
  }
});

test("same-session conflict requests snapshot recovery; foreign session requires manual resolve", async () => {
  for (const [writerSessionId, expected] of [
    ["session-a", "snapshot-required"],
    ["session-foreign", "manual-resolve"],
  ] as const) {
    const root = await temporaryRoot();
    try {
      await writeReady(root);
      const client = new SequenceClient([
        new RevisionPublishError(
          "revision_conflict",
          "stale base",
          409,
          { writerSessionId, headRevision: 2 },
        ),
      ]);
      const store = new FileReadyOutboxStore(root, outboxScope);
      const uploader = new LocalOutboxUploader({ store, client });
      const result = await uploader.runOnce();
      assert.deepEqual(result.blocked, ["change-a"]);
      assert.equal((await store.list())[0]?.delivery?.status, expected);
      assert.deepEqual(
        (await uploader.runOnce({ forceRetryWait: true })).blocked,
        ["change-a"],
      );
      assert.equal(client.calls, 1);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test("multiple unacknowledged artifacts for one drawing fail closed without upload", async () => {
  const root = await temporaryRoot();
  try {
    await writeReady(root, { artifactId: "change-a" });
    await writeReady(root, { artifactId: "change-b" });
    const client = new SequenceClient([
      { artifactId: "change-a", revision: 2, stateHash, idempotent: false },
    ]);
    const store = new FileReadyOutboxStore(root, outboxScope);
    const result = await new LocalOutboxUploader({ store, client }).runOnce();
    assert.deepEqual(result.blocked.sort(), ["change-a", "change-b"]);
    assert.equal(client.calls, 0);
    assert.ok((await store.list()).every((entry) => entry.delivery?.status === "snapshot-required"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("item.json symlinks are rejected instead of followed", async () => {
  const root = await temporaryRoot();
  try {
    const manifest = await writeReady(root);
    const directory = join(root, "outbox", "items", `${manifest.artifactId}.ready`);
    const target = join(root, "outside.json");
    await writeFile(target, `${JSON.stringify(manifest)}\n`);
    await rm(join(directory, "item.json"));
    await symlink(target, join(directory, "item.json"));
    await assert.rejects(
      new FileReadyOutboxStore(root, outboxScope).list(),
      (error) => error instanceof LocalOutboxError && error.code === "manifest_invalid",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("fetch client uses the scoped endpoint and immutable outbox headers", async () => {
  let capturedUrl = "";
  let capturedHeaders: Headers | undefined;
  const client = new FetchRevisionPublishClient({
    baseUrl: "https://sync.example.test/",
    tenantId: "tenant a",
    projectId: "project/a",
    headers: { authorization: "Bearer token" },
    fetch: async (input, init) => {
      capturedUrl = String(input);
      capturedHeaders = new Headers(init?.headers);
      return Response.json({
        revision: { artifactId: "change-a", revision: 2, stateHash },
        idempotent: false,
      }, { status: 201 });
    },
  });
  const manifest: ReadyOutboxManifest = {
    schemaVersion: 1,
    artifactKind: "delta",
    artifactId: "change-a",
    saveToken: "save-a",
    drawingId: "drawing/a",
    modelEpoch: "epoch-a",
    writerSessionId: "session-a",
    baseRevision: 1,
    resultStateHash: stateHash,
    payload: { fileName: "payload.cadwebdelta", size: 1, sha256: sha256(Uint8Array.of(1)) },
  };
  const result = await client.publish(manifest, Uint8Array.of(1));

  assert.equal(
    capturedUrl,
    "https://sync.example.test/v1/tenants/tenant%20a/projects/project%2Fa/drawings/drawing%2Fa/changesets",
  );
  assert.equal(capturedHeaders?.get("authorization"), "Bearer token");
  assert.equal(capturedHeaders?.get("x-cadweb-writer-session-id"), "session-a");
  assert.equal(capturedHeaders?.get("x-cadweb-state-hash"), stateHash);
  assert.deepEqual(result, { artifactId: "change-a", revision: 2, stateHash, idempotent: false });
});

test("item.json remains immutable when delivery and ACK files are written", async () => {
  const root = await temporaryRoot();
  try {
    const manifest = await writeReady(root);
    const itemPath = join(root, "outbox", "items", `${manifest.artifactId}.ready`, "item.json");
    const before = await readFile(itemPath, "utf8");
    const client = new SequenceClient([
      { artifactId: manifest.artifactId, revision: 2, stateHash, idempotent: false },
    ]);
    await new LocalOutboxUploader({
      store: new FileReadyOutboxStore(root, outboxScope),
      client,
    }).runOnce();
    assert.equal(await readFile(itemPath, "utf8"), before);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

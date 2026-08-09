import assert from "node:assert/strict";
import test from "node:test";

import { CadWebArtifactValidator } from "../src/cadweb-validator";
import { sha256 } from "../src/crypto";
import { createSyncHttpHandler } from "../src/http";
import { MAX_CADWEB_ARTIFACT_BYTES } from "../src/limits";
import { InMemoryRevisionMetadataStore } from "../src/metadata-store";
import { SyncRevisionService } from "../src/service";
import type { ImmutableBlobStore } from "../src/types";
import { createSnapshot, nativeInitialStateHash } from "./fixtures";

class MemoryBlobs implements ImmutableBlobStore {
  readonly values = new Map<string, Uint8Array>();

  async put(bytes: Uint8Array, expectedHash: string): Promise<{ hash: string; size: number }> {
    assert.equal(sha256(bytes), expectedHash);
    this.values.set(expectedHash, Uint8Array.from(bytes));
    return { hash: expectedHash, size: bytes.byteLength };
  }

  async get(hash: string): Promise<Uint8Array> {
    const bytes = this.values.get(hash);
    if (!bytes) throw new Error("blob missing");
    return Uint8Array.from(bytes);
  }

  async has(hash: string): Promise<boolean> {
    return this.values.has(hash);
  }
}

function handler() {
  const service = new SyncRevisionService({
    authorizer: {
      async authorize(request) {
        return request.tenantId === "tenant-a" &&
          request.projectId === "project-a" && request.principal.id === "principal-a";
      },
    },
    validator: new CadWebArtifactValidator(),
    metadata: new InMemoryRevisionMetadataStore(),
    blobs: new MemoryBlobs(),
    publisher: { async publish() {} },
    clock: () => new Date("2026-08-09T10:00:00.000Z"),
    idGenerator: () => "session-http",
  });
  return createSyncHttpHandler({
    service,
    authenticator: {
      async authenticate(request) {
        return request.headers.get("authorization") === "Bearer test"
          ? { id: "principal-a" }
          : null;
      },
    },
  });
}

const base = "http://sync.test/v1/tenants/tenant-a/projects/project-a/drawings/drawing-a";
const auth = { authorization: "Bearer test" };

test("HTTP contract publishes idempotently and exposes head, chain, metadata and raw blob", async () => {
  const dispatch = handler();
  const sessionResponse = await dispatch(new Request(`${base}/writer-sessions`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify({ leaseSeconds: 60 }),
  }));
  assert.equal(sessionResponse.status, 201);
  const session = await sessionResponse.json() as { writerSessionId: string };
  assert.equal(session.writerSessionId, "session-http");

  const bytes = await createSnapshot();
  const publish = () => dispatch(new Request(`${base}/snapshots`, {
    method: "POST",
    headers: {
      ...auth,
      "content-type": "application/vnd.cadweb+zip",
      "x-cadweb-writer-session-id": session.writerSessionId,
      "x-cadweb-state-hash": nativeInitialStateHash,
    },
    body: Buffer.from(bytes),
  }));
  const first = await publish();
  const retry = await publish();
  assert.equal(first.status, 201);
  assert.equal(retry.status, 200);
  assert.equal((await retry.json() as { idempotent: boolean }).idempotent, true);

  const head = await dispatch(new Request(`${base}/head`, { headers: auth }));
  assert.equal(head.status, 200);
  assert.equal((await head.json() as { revision: number }).revision, 1);

  const changes = await dispatch(new Request(`${base}/changes?after=0`, { headers: auth }));
  const changeBody = await changes.json() as { changes: Array<{ revision: number; stateHash: string }> };
  assert.equal(changeBody.changes.length, 1);
  assert.equal(changeBody.changes[0]?.stateHash, nativeInitialStateHash);

  const metadata = await dispatch(new Request(`${base}/revisions/1`, { headers: auth }));
  assert.equal((await metadata.json() as { artifactId: string }).artifactId, "snapshot-a");

  const blob = await dispatch(new Request(`${base}/revisions/1/blob`, { headers: auth }));
  assert.equal(blob.status, 200);
  assert.equal(blob.headers.get("content-type"), "application/vnd.cadweb+zip");
  assert.equal(blob.headers.get("x-content-sha256"), sha256(bytes));
  assert.deepEqual(Buffer.from(await blob.arrayBuffer()), Buffer.from(bytes));
});

test("authentication and drawing ACL fail before upload/idempotency handling", async () => {
  const dispatch = handler();
  const unauthenticated = await dispatch(new Request(`${base}/snapshots`, {
    method: "POST",
    body: Buffer.from([1, 2, 3]),
  }));
  assert.equal(unauthenticated.status, 401);

  const foreign = await dispatch(new Request(
    "http://sync.test/v1/tenants/tenant-a/projects/project-b/drawings/drawing-a/snapshots",
    {
      method: "POST",
      headers: {
        ...auth,
        "x-cadweb-writer-session-id": "guessed-session",
        "x-cadweb-state-hash": nativeInitialStateHash,
      },
      body: Buffer.from([1, 2, 3]),
    },
  ));
  assert.equal(foreign.status, 403);
  assert.equal((await foreign.json() as { error: { code: string } }).error.code, "forbidden");
});

test("upload limit rejects Content-Length and streaming overflow before package decode", async () => {
  let serviceCalls = 0;
  const fakeService = {
    async publishSnapshot() {
      serviceCalls += 1;
      throw new Error("must not be reached");
    },
  } as unknown as SyncRevisionService;
  const dispatch = createSyncHttpHandler({
    service: fakeService,
    authenticator: { async authenticate() { return { id: "principal-a" }; } },
    maxArtifactBytes: 3,
  });
  const headers = {
    "content-length": "4",
    "x-cadweb-writer-session-id": "session",
    "x-cadweb-state-hash": nativeInitialStateHash,
  };
  const lengthRejected = await dispatch(new Request(`${base}/snapshots`, {
    method: "POST",
    headers,
    body: Buffer.from([1, 2, 3, 4]),
  }));
  assert.equal(lengthRejected.status, 413);

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.from([1, 2]));
      controller.enqueue(Uint8Array.from([3, 4]));
      controller.close();
    },
  });
  const streamed = await dispatch(new Request(`${base}/snapshots`, {
    method: "POST",
    headers: {
      "x-cadweb-writer-session-id": "session",
      "x-cadweb-state-hash": nativeInitialStateHash,
    },
    body: stream,
    duplex: "half",
  } as RequestInit & { duplex: "half" }));
  assert.equal(streamed.status, 413);
  assert.equal(serviceCalls, 0);

  const defaultDispatch = createSyncHttpHandler({
    service: fakeService,
    authenticator: { async authenticate() { return { id: "principal-a" }; } },
  });
  const defaultRejected = await defaultDispatch(new Request(`${base}/snapshots`, {
    method: "POST",
    headers: {
      "content-length": String(MAX_CADWEB_ARTIFACT_BYTES + 1),
      "x-cadweb-writer-session-id": "session",
      "x-cadweb-state-hash": nativeInitialStateHash,
    },
    body: Buffer.from([1]),
  }));
  assert.equal(defaultRejected.status, 413);
  assert.equal(
    (await defaultRejected.json() as { error: { details: { maxArtifactBytes: number } } })
      .error.details.maxArtifactBytes,
    MAX_CADWEB_ARTIFACT_BYTES,
  );
  assert.equal(serviceCalls, 0);
});

test("malformed route encoding is a client error, not an internal error", async () => {
  const response = await handler()(new Request(
    "http://sync.test/v1/tenants/tenant-a/projects/project-a/drawings/%ZZ/head",
    { headers: auth },
  ));
  assert.equal(response.status, 400);
  assert.equal((await response.json() as { error: { code: string } }).error.code, "invalid_request");
});

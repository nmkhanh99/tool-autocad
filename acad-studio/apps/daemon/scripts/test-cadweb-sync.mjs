import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  CadWebSyncRuntime,
  cadWebSyncConfiguration,
  cadWebSyncRouter,
  createCadWebSyncControl,
} from "../src/cadwebSync.ts";

function enabledEnv(root, overrides = {}) {
  return {
    CADWEB_SYNC_ENABLED: "1",
    CADWEB_SYNC_ROOT: root,
    CADWEB_SYNC_BASE_URL: "https://sync.example.test",
    CADWEB_SYNC_TENANT_ID: "tenant-secret",
    CADWEB_SYNC_PROJECT_ID: "project-secret",
    CADWEB_SYNC_ACCESS_TOKEN: "token-secret",
    ...overrides,
  };
}

function readyItem(root, options = {}) {
  const artifactId = options.artifactId ?? "artifact-a";
  const payload = options.payload ?? Buffer.from("immutable-cadweb-delta");
  const directory = join(root, "outbox", "items", `${artifactId}.ready`);
  mkdirSync(directory, { recursive: true });
  const manifest = {
    schemaVersion: 1,
    artifactKind: "delta",
    artifactId,
    saveToken: `save-${artifactId}`,
    drawingId: options.drawingId ?? "drawing-secret",
    modelEpoch: "epoch-a",
    writerSessionId: "writer-session-secret",
    baseRevision: 1,
    resultStateHash: "a".repeat(64),
    payload: {
      fileName: "payload.cadwebdelta",
      size: payload.byteLength,
      sha256: createHash("sha256").update(payload).digest("hex"),
    },
  };
  writeFileSync(join(directory, "item.json"), `${JSON.stringify(manifest)}\n`);
  writeFileSync(join(directory, manifest.payload.fileName), payload);
  if (options.delivery) {
    writeFileSync(
      join(directory, "delivery.json"),
      `${JSON.stringify({ schemaVersion: 1, artifactId, ...options.delivery })}\n`,
    );
  }
  return { directory, manifest };
}

async function invoke(router, method, path) {
  const layer = router.stack.find((item) =>
    item.route?.path === path && item.route.methods[method.toLowerCase()]);
  assert.ok(layer, `${method} ${path} exists`);
  let status = 200;
  let payload;
  const response = {
    status(value) {
      status = value;
      return response;
    },
    json(value) {
      payload = value;
      return response;
    },
  };
  await layer.route.stack[0].handle({}, response);
  return { status, payload };
}

assert.deepEqual(cadWebSyncConfiguration({}), { mode: "disabled" });
assert.equal(
  cadWebSyncConfiguration(enabledEnv("/tmp/cadweb-sync"), "darwin").mode,
  "enabled",
);
assert.equal(
  cadWebSyncConfiguration(enabledEnv("relative-root"), "darwin").issue,
  "sync_root_not_absolute",
);
assert.deepEqual(
  cadWebSyncConfiguration({
    CADWEB_SYNC_ENABLED: "1",
    CADWEB_SYNC_BASE_URL: "https://sync.example.test",
    CADWEB_SYNC_TENANT_ID: "tenant",
    CADWEB_SYNC_PROJECT_ID: "project",
    HOME: "/Users/tester",
  }, "darwin").root,
  "/Users/tester/Library/Application Support/AcadStudio/CadWebSync",
);
assert.deepEqual(
  cadWebSyncConfiguration({
    CADWEB_SYNC_ENABLED: "1",
    CADWEB_SYNC_BASE_URL: "https://sync.example.test",
    CADWEB_SYNC_TENANT_ID: "tenant",
    CADWEB_SYNC_PROJECT_ID: "project",
    LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local",
  }, "win32").root,
  "C:\\Users\\tester\\AppData\\Local\\AcadStudio\\CadWebSync",
);
assert.equal(
  cadWebSyncConfiguration(enabledEnv("/tmp/cadweb-sync", {
    CADWEB_SYNC_BASE_URL: "http://remote.example.test",
  })).issue,
  "base_url_insecure",
);

const scheduled = [];
const cleared = [];
const scheduler = {
  set(callback, delayMs) {
    const timer = {
      callback,
      delayMs,
      unrefCalled: false,
      unref() { this.unrefCalled = true; },
    };
    scheduled.push(timer);
    return timer;
  },
  clear(timer) {
    cleared.push(timer);
  },
};
const timerCalls = [];
const timerRuntime = new CadWebSyncRuntime({
  store: { async list() { return []; } },
  uploader: {
    async runOnce(options) {
      timerCalls.push(options);
      return { acknowledged: [], retryScheduled: [], blocked: [], skipped: [] };
    },
  },
  pollIntervalMs: 1_234,
  scheduler,
});
timerRuntime.start();
timerRuntime.start();
assert.equal(scheduled.length, 1, "start is idempotent");
assert.equal(scheduled[0].delayMs, 0, "startup schedules an immediate poll");
assert.equal(scheduled[0].unrefCalled, true, "poll timer is unref'ed");
timerRuntime.stop();
assert.deepEqual(cleared, [scheduled[0]], "stop clears the pending timer");
assert.equal(timerCalls.length, 0, "stopped timer never ran");
await timerRuntime.retryNow();
assert.deepEqual(timerCalls, [{ forceRetryWait: true }], "manual retry only requests retry-wait override");

const sensitiveStatusRuntime = new CadWebSyncRuntime({
  store: {
    async list() {
      return [{
        directoryName: "artifact-secret.ready",
        directoryPath: "/private/secret/outbox/artifact-secret.ready",
        manifest: {
          schemaVersion: 1,
          artifactKind: "delta",
          artifactId: "artifact-secret",
          saveToken: "save-token-secret",
          drawingId: "drawing-secret",
          modelEpoch: "epoch-secret",
          writerSessionId: "writer-secret",
          baseRevision: 1,
          resultStateHash: "b".repeat(64),
          payload: { fileName: "payload.cadwebdelta", size: 1, sha256: "c".repeat(64) },
        },
        delivery: {
          schemaVersion: 1,
          artifactId: "artifact-secret",
          status: "manual-resolve",
          attemptCount: 1,
          updatedAt: "2026-08-09T00:00:00.000Z",
          errorCode: "writer_session_conflict",
          errorMessage: "server-path-and-token-secret",
        },
      }];
    },
  },
  uploader: {
    async runOnce() {
      return { acknowledged: [], retryScheduled: [], blocked: ["artifact-secret"], skipped: [] };
    },
  },
  pollIntervalMs: 5_000,
});
const sensitiveStatus = await sensitiveStatusRuntime.status();
assert.equal(sensitiveStatus.state, "blocked");
assert.equal(sensitiveStatus.queue.manualResolve, 1);
const serializedStatus = JSON.stringify(sensitiveStatus);
for (const secret of [
  "/private/secret",
  "artifact-secret",
  "save-token-secret",
  "drawing-secret",
  "writer-secret",
  "server-path-and-token-secret",
]) {
  assert.equal(serializedStatus.includes(secret), false, `status hides ${secret}`);
}

const disabledRouter = cadWebSyncRouter(createCadWebSyncControl({ env: {} }));
assert.equal((await invoke(disabledRouter, "GET", "/status")).payload.sync.state, "disabled");
const disabledRetry = await invoke(disabledRouter, "POST", "/retry");
assert.equal(disabledRetry.status, 409);
assert.equal(disabledRetry.payload.code, "sync_disabled");

const root = mkdtempSync(join(tmpdir(), "cadweb-daemon-sync-"));
try {
  const { directory, manifest } = readyItem(root, {
    delivery: {
      status: "retry-wait",
      attemptCount: 1,
      updatedAt: "2026-08-09T00:00:00.000Z",
      nextAttemptAt: "2099-01-01T00:00:00.000Z",
      errorCode: "network_error",
      errorMessage: "offline",
    },
  });
  let fetchCalls = 0;
  let authorization = "";
  const control = createCadWebSyncControl({
    env: enabledEnv(root),
    fetch: async (_input, init) => {
      fetchCalls += 1;
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return Response.json({
        revision: {
          artifactId: manifest.artifactId,
          revision: 2,
          stateHash: manifest.resultStateHash,
        },
        idempotent: false,
      }, { status: 201 });
    },
  });
  const router = cadWebSyncRouter(control);
  const retry = await invoke(router, "POST", "/retry");
  assert.equal(retry.status, 200);
  assert.equal(retry.payload.run.acknowledged, 1, "manual endpoint forces a future retry-wait item");
  assert.equal(fetchCalls, 1);
  assert.equal(authorization, "Bearer token-secret", "auth provider supplies the publish header");
  assert.equal(JSON.parse(readFileSync(join(directory, "ack.json"), "utf8")).revision, 2);

  const statusResponse = await invoke(router, "GET", "/status");
  assert.equal(statusResponse.payload.sync.queue.acknowledgedAwaitingCad, 1);
  const wireStatus = JSON.stringify(statusResponse.payload);
  for (const secret of [
    root,
    "token-secret",
    "sync.example.test",
    "tenant-secret",
    "project-secret",
    "writer-session-secret",
  ]) {
    assert.equal(wireStatus.includes(secret), false, `loopback status hides ${secret}`);
  }

  const restarted = createCadWebSyncControl({
    env: enabledEnv(root),
    fetch: async () => {
      throw new Error("same-scope status restart must not upload");
    },
  });
  assert.equal(
    (await restarted.status()).queue.acknowledgedAwaitingCad,
    1,
    "same tenant/project can reopen the durable sync root",
  );

  let mismatchedFetchCalls = 0;
  const mismatched = createCadWebSyncControl({
    env: enabledEnv(root, { CADWEB_SYNC_PROJECT_ID: "project-other" }),
    fetch: async () => {
      mismatchedFetchCalls += 1;
      throw new Error("scope mismatch must fail before upload");
    },
  });
  const mismatchedRetry = await invoke(cadWebSyncRouter(mismatched), "POST", "/retry");
  assert.equal(mismatchedRetry.status, 503);
  assert.equal(mismatchedRetry.payload.sync.lastError.code, "scope_mismatch");
  assert.equal(mismatchedFetchCalls, 0, "tenant/project mismatch never reaches fetch");
} finally {
  rmSync(root, { recursive: true, force: true });
}

const blockedRoot = mkdtempSync(join(tmpdir(), "cadweb-daemon-blocked-"));
try {
  readyItem(blockedRoot, {
    delivery: {
      status: "manual-resolve",
      attemptCount: 1,
      updatedAt: "2026-08-09T00:00:00.000Z",
      errorCode: "writer_session_conflict",
      errorMessage: "manual action required",
    },
  });
  let fetchCalls = 0;
  const control = createCadWebSyncControl({
    env: enabledEnv(blockedRoot),
    fetch: async () => {
      fetchCalls += 1;
      throw new Error("blocked item must not reach fetch");
    },
  });
  const retried = await invoke(cadWebSyncRouter(control), "POST", "/retry");
  assert.equal(retried.status, 200);
  assert.equal(retried.payload.run.blocked, 1);
  assert.equal(fetchCalls, 0, "manual retry never unblocks manual-resolve");
} finally {
  rmSync(blockedRoot, { recursive: true, force: true });
}

console.log("CADWeb daemon sync wiring: all checks passed");

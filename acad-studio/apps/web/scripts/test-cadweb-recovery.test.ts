import assert from "node:assert/strict";
import test from "node:test";

import {
  CadWebRevisionRecoveryCoordinator,
  planCadWebDeltaChain,
  type CadWebRecoverySnapshot,
  type CadWebRemoteRevision,
  type CadWebRevisionCursor,
  type CadWebRevisionHead,
  type CadWebRevisionSource,
  type CadWebRevisionTarget,
} from "../app/cadweb-revision-recovery.js";

const drawingId = "drawing-1";
const modelEpoch = "epoch-1";

function cursor(revision: number): CadWebRevisionCursor {
  return { drawingId, modelEpoch, revision };
}

function remote(revision: number, mode: "snapshot" | "delta" = "delta"): CadWebRemoteRevision {
  return { revision, baseRevision: revision - 1, mode, modelEpoch };
}

class FakeSource implements CadWebRevisionSource<string> {
  head: CadWebRevisionHead = cursor(1);
  changes: CadWebRemoteRevision[] = [];
  snapshot: CadWebRecoverySnapshot<string> = { ...cursor(1), artifact: "snapshot-1" };
  headReads = 0;
  artifactReads: number[] = [];

  async getHead(): Promise<CadWebRevisionHead> {
    this.headReads += 1;
    return { ...this.head };
  }

  async getChangesAfter(
    revision: number,
    throughRevision: number,
  ): Promise<readonly CadWebRemoteRevision[]> {
    return this.changes.filter(
      (change) => change.revision > revision && change.revision <= throughRevision,
    );
  }

  async getArtifact(revision: CadWebRemoteRevision): Promise<string> {
    this.artifactReads.push(revision.revision);
    return `delta-${revision.revision}`;
  }

  async getSnapshot(): Promise<CadWebRecoverySnapshot<string>> {
    return { ...this.snapshot };
  }
}

class FakeTarget implements CadWebRevisionTarget<string> {
  state: CadWebRevisionCursor | undefined;
  applied: number[] = [];
  resets: number[] = [];
  failRevision: number | undefined;

  constructor(initial?: CadWebRevisionCursor) {
    this.state = initial === undefined ? undefined : { ...initial };
  }

  current(): CadWebRevisionCursor | undefined {
    return this.state === undefined ? undefined : { ...this.state };
  }

  async applyDelta(_artifact: string, revision: CadWebRemoteRevision): Promise<void> {
    if (revision.revision === this.failRevision) throw new Error("synthetic apply failure");
    assert.equal(this.state?.revision, revision.baseRevision);
    this.applied.push(revision.revision);
    this.state = { drawingId, modelEpoch: revision.modelEpoch, revision: revision.revision };
  }

  async resetToSnapshot(snapshot: CadWebRecoverySnapshot<string>): Promise<void> {
    this.resets.push(snapshot.revision);
    this.state = {
      drawingId: snapshot.drawingId,
      modelEpoch: snapshot.modelEpoch,
      revision: snapshot.revision,
    };
  }
}

test("reconnect applies a contiguous delta chain and reconciles duplicate push from head", async () => {
  const source = new FakeSource();
  source.head = cursor(3);
  source.changes = [remote(2), remote(3)];
  const target = new FakeTarget(cursor(1));
  const coordinator = new CadWebRevisionRecoveryCoordinator(source, target);

  const reconnected = await coordinator.reconnect();
  assert.deepEqual(reconnected, {
    trigger: "reconnect",
    strategy: "delta-chain",
    revision: 3,
    appliedDeltas: 2,
  });
  assert.deepEqual(target.applied, [2, 3]);

  const duplicate = await coordinator.revisionAvailable({
    drawingId,
    baseRevision: 1,
    revision: 2,
  });
  assert.equal(duplicate.strategy, "current");
  assert.equal(target.state?.revision, 3);
  assert.deepEqual(target.applied, [2, 3]);
  assert.equal(source.headReads, 2);
});

test("out-of-order push is only an invalidation and follows the authoritative head chain", async () => {
  const source = new FakeSource();
  source.head = cursor(3);
  source.changes = [remote(2), remote(3)];
  const target = new FakeTarget(cursor(1));
  const coordinator = new CadWebRevisionRecoveryCoordinator(source, target);

  const result = await coordinator.revisionAvailable({
    drawingId,
    baseRevision: 99,
    revision: 100,
  });
  assert.equal(result.strategy, "delta-chain");
  assert.deepEqual(target.applied, [2, 3]);
  assert.equal(target.state?.revision, 3);
});

test("a missing revision or an overlong chain falls back to a snapshot", async () => {
  for (const testCase of [
    { changes: [remote(3)], maxDeltaChain: 100, reason: "revision-gap" },
    { changes: [remote(2), remote(3)], maxDeltaChain: 1, reason: "chain-too-long" },
  ] as const) {
    const source = new FakeSource();
    source.head = cursor(3);
    source.changes = [...testCase.changes];
    source.snapshot = { ...cursor(3), artifact: "snapshot-3" };
    const target = new FakeTarget(cursor(1));
    const coordinator = new CadWebRevisionRecoveryCoordinator(
      source,
      target,
      testCase.maxDeltaChain,
    );

    const result = await coordinator.reconnect();
    assert.equal(result.strategy, "snapshot");
    assert.equal(result.snapshotReason, testCase.reason);
    assert.deepEqual(target.resets, [3]);
    assert.deepEqual(target.applied, []);
    assert.equal(target.state?.revision, 3);
  }
});

test("a failed delta apply discards that revision and recovers from the head snapshot", async () => {
  const source = new FakeSource();
  source.head = cursor(3);
  source.changes = [remote(2), remote(3)];
  source.snapshot = { ...cursor(3), artifact: "snapshot-3" };
  const target = new FakeTarget(cursor(1));
  target.failRevision = 2;
  const coordinator = new CadWebRevisionRecoveryCoordinator(source, target);

  const result = await coordinator.reconnect();
  assert.equal(result.strategy, "snapshot");
  assert.equal(result.snapshotReason, "delta-apply-failed");
  assert.deepEqual(target.applied, []);
  assert.deepEqual(target.resets, [3]);
  assert.equal(target.state?.revision, 3);
});

test("recovery never rolls a partially advanced viewer back to an older snapshot", async () => {
  const source = new FakeSource();
  source.head = cursor(3);
  source.changes = [remote(2), remote(3)];
  source.snapshot = { ...cursor(1), artifact: "snapshot-1" };
  const target = new FakeTarget(cursor(1));
  target.failRevision = 3;
  const coordinator = new CadWebRevisionRecoveryCoordinator(source, target);

  await assert.rejects(coordinator.reconnect(), /not a baseline for the requested head/);
  assert.deepEqual(target.applied, [2]);
  assert.deepEqual(target.resets, []);
  assert.equal(target.state?.revision, 2);
});

test("snapshot recovery can apply a contiguous tail to reach head", async () => {
  const source = new FakeSource();
  source.head = cursor(4);
  source.changes = [remote(3), remote(4)];
  source.snapshot = { ...cursor(2), artifact: "checkpoint-2" };
  const target = new FakeTarget();
  const coordinator = new CadWebRevisionRecoveryCoordinator(source, target);

  const result = await coordinator.reconnect();
  assert.equal(result.strategy, "snapshot");
  assert.equal(result.snapshotReason, "missing-baseline");
  assert.equal(result.appliedDeltas, 2);
  assert.deepEqual(target.resets, [2]);
  assert.deepEqual(target.applied, [3, 4]);
  assert.equal(target.state?.revision, 4);
});

test("chain planner never rolls back and rejects snapshot records in a delta tail", () => {
  assert.throws(
    () => planCadWebDeltaChain(cursor(4), cursor(3), [], 100),
    /behind current revision/,
  );
  assert.deepEqual(
    planCadWebDeltaChain(cursor(1), cursor(2), [remote(2, "snapshot")], 100),
    { strategy: "snapshot", reason: "snapshot-in-chain" },
  );
});

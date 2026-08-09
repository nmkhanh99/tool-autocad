import { CadWebError } from "@acad/cadweb";

export type CadWebRevisionCursor = {
  drawingId: string;
  modelEpoch: string;
  revision: number;
};

export type CadWebRevisionHead = {
  drawingId: string;
  revision: number;
  modelEpoch?: string;
};

export type CadWebRemoteRevision = {
  revision: number;
  baseRevision: number;
  mode: "snapshot" | "delta";
  modelEpoch: string;
};

export type CadWebRecoverySnapshot<TArtifact> = CadWebRevisionCursor & {
  artifact: TArtifact;
};

export type CadWebRevisionAvailable = {
  drawingId: string;
  baseRevision: number;
  revision: number;
};

export type CadWebSnapshotReason =
  | "missing-baseline"
  | "drawing-changed"
  | "model-epoch-changed"
  | "revision-gap"
  | "chain-too-long"
  | "snapshot-in-chain"
  | "delta-apply-failed";

export type CadWebDeltaChainPlan =
  | { strategy: "current" }
  | { strategy: "delta"; revisions: readonly CadWebRemoteRevision[] }
  | { strategy: "snapshot"; reason: CadWebSnapshotReason };

export interface CadWebRevisionSource<TArtifact> {
  getHead(): Promise<CadWebRevisionHead>;
  getChangesAfter(
    revision: number,
    throughRevision: number,
  ): Promise<readonly CadWebRemoteRevision[]>;
  getArtifact(revision: CadWebRemoteRevision): Promise<TArtifact>;
  getSnapshot(
    head: CadWebRevisionCursor,
    minimumRevision: number,
  ): Promise<CadWebRecoverySnapshot<TArtifact>>;
}

export interface CadWebRevisionTarget<TArtifact> {
  current(): CadWebRevisionCursor | undefined;
  applyDelta(artifact: TArtifact, revision: CadWebRemoteRevision): Promise<void>;
  resetToSnapshot(snapshot: CadWebRecoverySnapshot<TArtifact>): Promise<void>;
}

export type CadWebRecoveryResult = {
  trigger: "push" | "reconnect" | "manual";
  strategy: "current" | "delta-chain" | "snapshot";
  revision: number;
  appliedDeltas: number;
  snapshotReason?: CadWebSnapshotReason;
};

function assertRevision(value: number, label: string, allowZero: boolean): void {
  if (!Number.isSafeInteger(value) || value < (allowZero ? 0 : 1)) {
    throw new CadWebError(
      "REVISION_MISMATCH",
      `${label} must be a ${allowZero ? "non-negative" : "positive"} safe integer`,
    );
  }
}

function assertHead(head: CadWebRevisionHead): void {
  assertRevision(head.revision, "head revision", true);
  if (head.drawingId.length === 0) {
    throw new CadWebError("REVISION_MISMATCH", "head drawingId must not be empty");
  }
  if (head.revision > 0 && !head.modelEpoch) {
    throw new CadWebError(
      "REVISION_MISMATCH",
      "a non-empty revision head must include modelEpoch",
    );
  }
}

export function planCadWebDeltaChain(
  current: CadWebRevisionCursor | undefined,
  head: CadWebRevisionHead,
  revisions: readonly CadWebRemoteRevision[],
  maxDeltaChain: number,
): CadWebDeltaChainPlan {
  assertHead(head);
  if (!Number.isSafeInteger(maxDeltaChain) || maxDeltaChain < 1) {
    throw new RangeError("maxDeltaChain must be a positive safe integer");
  }
  if (head.revision === 0) {
    if (current === undefined) return { strategy: "current" };
    throw new CadWebError(
      "REVISION_MISMATCH",
      `empty head cannot replace current revision ${current.revision}`,
    );
  }
  const headModelEpoch = head.modelEpoch!;
  if (current === undefined) return { strategy: "snapshot", reason: "missing-baseline" };
  assertRevision(current.revision, "current revision", false);
  if (current.drawingId !== head.drawingId) {
    return { strategy: "snapshot", reason: "drawing-changed" };
  }
  if (current.revision > head.revision) {
    throw new CadWebError(
      "REVISION_MISMATCH",
      `head revision ${head.revision} is behind current revision ${current.revision}`,
    );
  }
  if (current.revision === head.revision) {
    if (current.modelEpoch !== headModelEpoch) {
      throw new CadWebError(
        "REVISION_MISMATCH",
        "model epoch changed without advancing the revision",
      );
    }
    return { strategy: "current" };
  }
  if (current.modelEpoch !== headModelEpoch) {
    return { strategy: "snapshot", reason: "model-epoch-changed" };
  }
  if (head.revision - current.revision > maxDeltaChain || revisions.length > maxDeltaChain) {
    return { strategy: "snapshot", reason: "chain-too-long" };
  }

  let expectedBase = current.revision;
  for (const revision of revisions) {
    assertRevision(revision.baseRevision, "remote base revision", true);
    assertRevision(revision.revision, "remote revision", false);
    if (
      revision.baseRevision !== expectedBase ||
      revision.revision !== expectedBase + 1 ||
      revision.revision > head.revision
    ) {
      return { strategy: "snapshot", reason: "revision-gap" };
    }
    if (revision.mode !== "delta") {
      return { strategy: "snapshot", reason: "snapshot-in-chain" };
    }
    if (revision.modelEpoch !== current.modelEpoch) {
      return { strategy: "snapshot", reason: "model-epoch-changed" };
    }
    expectedBase = revision.revision;
  }
  if (expectedBase !== head.revision) {
    return { strategy: "snapshot", reason: "revision-gap" };
  }
  return { strategy: "delta", revisions: [...revisions] };
}

function sameCursor(
  actual: CadWebRevisionCursor | undefined,
  expected: CadWebRevisionCursor,
): boolean {
  return actual?.drawingId === expected.drawingId &&
    actual.modelEpoch === expected.modelEpoch &&
    actual.revision === expected.revision;
}

export class CadWebRevisionRecoveryCoordinator<TArtifact> {
  private tail: Promise<void> = Promise.resolve();

  constructor(
    private readonly source: CadWebRevisionSource<TArtifact>,
    private readonly target: CadWebRevisionTarget<TArtifact>,
    private readonly maxDeltaChain = 100,
  ) {
    if (!Number.isSafeInteger(maxDeltaChain) || maxDeltaChain < 1) {
      throw new RangeError("maxDeltaChain must be a positive safe integer");
    }
  }

  reconcile(
    trigger: CadWebRecoveryResult["trigger"] = "manual",
  ): Promise<CadWebRecoveryResult> {
    const result = this.tail.then(() => this.reconcileOnce(trigger));
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  revisionAvailable(event: CadWebRevisionAvailable): Promise<CadWebRecoveryResult> {
    if (!event.drawingId) {
      return Promise.reject(
        new CadWebError("REVISION_MISMATCH", "revision event drawingId must not be empty"),
      );
    }
    assertRevision(event.baseRevision, "event base revision", true);
    assertRevision(event.revision, "event revision", false);
    return this.reconcile("push");
  }

  reconnect(): Promise<CadWebRecoveryResult> {
    return this.reconcile("reconnect");
  }

  private async reconcileOnce(
    trigger: CadWebRecoveryResult["trigger"],
  ): Promise<CadWebRecoveryResult> {
    const head = await this.source.getHead();
    assertHead(head);
    const current = this.target.current();
    if (head.revision === 0) {
      if (current !== undefined) {
        throw new CadWebError(
          "REVISION_MISMATCH",
          `empty head cannot replace current revision ${current.revision}`,
        );
      }
      return { trigger, strategy: "current", revision: 0, appliedDeltas: 0 };
    }
    const boundHead: CadWebRevisionCursor = {
      drawingId: head.drawingId,
      modelEpoch: head.modelEpoch!,
      revision: head.revision,
    };

    let revisions: readonly CadWebRemoteRevision[] = [];
    if (
      current !== undefined &&
      current.drawingId === head.drawingId &&
      current.modelEpoch === boundHead.modelEpoch &&
      current.revision < boundHead.revision &&
      boundHead.revision - current.revision <= this.maxDeltaChain
    ) {
      revisions = await this.source.getChangesAfter(current.revision, boundHead.revision);
    }
    const plan = planCadWebDeltaChain(current, boundHead, revisions, this.maxDeltaChain);
    if (plan.strategy === "current") {
      return { trigger, strategy: "current", revision: boundHead.revision, appliedDeltas: 0 };
    }
    if (plan.strategy === "delta") {
      try {
        await this.applyDeltaChain(boundHead, plan.revisions);
        return {
          trigger,
          strategy: "delta-chain",
          revision: boundHead.revision,
          appliedDeltas: plan.revisions.length,
        };
      } catch (cause) {
        return this.recoverSnapshot(boundHead, trigger, "delta-apply-failed", cause);
      }
    }
    return this.recoverSnapshot(boundHead, trigger, plan.reason);
  }

  private async applyDeltaChain(
    head: CadWebRevisionCursor,
    revisions: readonly CadWebRemoteRevision[],
  ): Promise<void> {
    for (const revision of revisions) {
      const artifact = await this.source.getArtifact(revision);
      await this.target.applyDelta(artifact, revision);
      const expected = {
        drawingId: head.drawingId,
        modelEpoch: revision.modelEpoch,
        revision: revision.revision,
      };
      if (!sameCursor(this.target.current(), expected)) {
        throw new CadWebError(
          "REVISION_MISMATCH",
          `delta apply did not commit expected revision ${revision.revision}`,
        );
      }
    }
  }

  private async recoverSnapshot(
    head: CadWebRevisionCursor,
    trigger: CadWebRecoveryResult["trigger"],
    reason: CadWebSnapshotReason,
    cause?: unknown,
  ): Promise<CadWebRecoveryResult> {
    const current = this.target.current();
    const minimumRevision =
      current?.drawingId === head.drawingId && current.modelEpoch === head.modelEpoch
        ? current.revision
        : 1;
    const snapshot = await this.source.getSnapshot(head, minimumRevision);
    assertRevision(snapshot.revision, "recovery snapshot revision", false);
    if (
      snapshot.drawingId !== head.drawingId ||
      snapshot.modelEpoch !== head.modelEpoch ||
      snapshot.revision < minimumRevision ||
      snapshot.revision > head.revision
    ) {
      throw new CadWebError(
        "REVISION_MISMATCH",
        "recovery snapshot is not a baseline for the requested head",
        cause === undefined ? undefined : { cause },
      );
    }
    await this.target.resetToSnapshot(snapshot);
    if (!sameCursor(this.target.current(), snapshot)) {
      throw new CadWebError(
        "REVISION_MISMATCH",
        `snapshot reset did not commit expected revision ${snapshot.revision}`,
      );
    }

    let appliedDeltas = 0;
    if (snapshot.revision < head.revision) {
      const revisions = await this.source.getChangesAfter(snapshot.revision, head.revision);
      const tailPlan = planCadWebDeltaChain(snapshot, head, revisions, this.maxDeltaChain);
      if (tailPlan.strategy !== "delta") {
        throw new CadWebError(
          "REVISION_MISMATCH",
          `recovery snapshot tail is not contiguous (${tailPlan.strategy === "snapshot" ? tailPlan.reason : "unexpected current state"})`,
          cause === undefined ? undefined : { cause },
        );
      }
      await this.applyDeltaChain(head, tailPlan.revisions);
      appliedDeltas = tailPlan.revisions.length;
    }
    return {
      trigger,
      strategy: "snapshot",
      revision: head.revision,
      appliedDeltas,
      snapshotReason: reason,
    };
  }
}

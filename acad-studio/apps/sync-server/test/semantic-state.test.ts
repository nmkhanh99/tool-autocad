import assert from "node:assert/strict";
import test from "node:test";

import {
  EntityKind,
  PropertySourceMode,
  SpaceKind,
  type CadWebEntity,
} from "@acad/cadweb";

import { CadWebArtifactValidator } from "../src/cadweb-validator";
import { sha256 } from "../src/crypto";
import { buildNativeBlockBuffer, buildNativeEntityBuffer } from "../src/native-geometry";
import { applySemanticChange } from "../src/semantic-state";
import {
  createDelta,
  createSnapshot,
  drawingId,
  line,
  modelEpoch,
  nativeEntityHash,
  nativeInitialStateHash,
  nativeLayerHash,
  nativePropertyModeEntityHash,
} from "./fixtures";

test("recomputes the same canonical object and state hashes as the native writer", async () => {
  const validator = new CadWebArtifactValidator();
  const artifact = await validator.validateSnapshot(await createSnapshot());

  assert.equal(artifact.semanticChange.objectUpserts["entity:A"], nativeEntityHash);
  assert.equal(artifact.semanticChange.objectUpserts["layer:1"], nativeLayerHash);
  const result = applySemanticChange(
    drawingId,
    modelEpoch,
    {},
    artifact.semanticChange,
  );
  assert.equal(result.stateHash, nativeInitialStateHash);
});

test("matches native hashes for block children, transforms and sorted attributes", () => {
  const blockChild: CadWebEntity = {
    ...line([2, 3, 0]),
    id: "entity:B",
    sourceHandle: "B",
    space: SpaceKind.BlockDefinition,
  };
  const block = {
    id: "block:20",
    sourceHandle: "20",
    name: "Pump",
    basePoint: [1, 2, 0] as const,
    entities: [blockChild],
  };
  const reference: CadWebEntity = {
    ...line(),
    id: "entity:C",
    sourceHandle: "C",
    kind: EntityKind.BlockReference,
    points: [],
    blockDefinitionId: "block:20",
    transform: [
      1, 0, 0, 5,
      0, 1, 0, 0,
      0, 0, 1, 0,
      0, 0, 0, 1,
    ],
    attributes: [
      { id: "entity:E", tag: "SECOND", text: "B", position: [6, 2, 0], rotation: 0.5, height: 2 },
      { id: "entity:D", tag: "FIRST", text: "A", position: [5, 2, 0], rotation: 0, height: 1 },
    ],
  };

  assert.equal(
    sha256(buildNativeBlockBuffer(block)),
    "3a8e5b2ac814df1e3b50124e2355d57ed6b7e87663a79e7a3888180a9715ba46",
  );
  assert.equal(
    sha256(buildNativeEntityBuffer(reference)),
    "f28a6f80f5e185da60f338e93721474f9bca9ad53922ff44fce6b9de0de9dd7a",
  );
});

test("matches the native hash when only property source modes are non-default", () => {
  const entity = line();
  entity.colorSourceMode = PropertySourceMode.ByLayer;
  entity.transparencySourceMode = PropertySourceMode.ByBlock;
  entity.lineWeightSourceMode = PropertySourceMode.Explicit;
  entity.linetypeSourceMode = PropertySourceMode.ByLayer;

  assert.equal(sha256(buildNativeEntityBuffer(entity)), nativePropertyModeEntityHash);
  assert.notEqual(nativePropertyModeEntityHash, nativeEntityHash);
});

test("applies delta hashes over the verified head without trusting a client state hash", async () => {
  const validator = new CadWebArtifactValidator();
  const snapshot = await validator.validateSnapshot(await createSnapshot());
  const initial = applySemanticChange(drawingId, modelEpoch, {}, snapshot.semanticChange);
  const delta = await validator.validateChangeset(await createDelta());
  const changed = applySemanticChange(
    drawingId,
    modelEpoch,
    initial.objectHashes,
    delta.semanticChange,
  );

  assert.equal(changed.objectHashes["layer:1"], nativeLayerHash);
  assert.notEqual(changed.objectHashes["entity:A"], nativeEntityHash);
  assert.notEqual(changed.stateHash, nativeInitialStateHash);
  assert.match(changed.stateHash, /^[0-9a-f]{64}$/);
});

test("reconstructs checkpoint stateHash from the full checkpoint package", async () => {
  const validator = new CadWebArtifactValidator();
  const checkpoint = await validator.validateCheckpoint(await createSnapshot({
    checkpoint: {
      checkpointId: "checkpoint-1",
      revision: 1,
      stateHash: nativeInitialStateHash,
    },
  }));

  assert.equal(checkpoint.stateHash, nativeInitialStateHash);
  assert.equal(checkpoint.computedStateHash, nativeInitialStateHash);
});

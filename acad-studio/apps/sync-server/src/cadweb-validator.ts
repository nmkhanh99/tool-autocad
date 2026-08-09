import { CadWebError, readCadWeb, readCadWebDelta } from "@acad/cadweb";

import { SyncError } from "./errors";
import {
  applySemanticChange,
  deltaSemanticChange,
  snapshotSemanticChange,
} from "./semantic-state";
import type {
  ArtifactValidator,
  ValidatedCheckpoint,
  ValidatedWriterArtifact,
} from "./types";

function invalid(message: string, cause?: unknown): SyncError {
  return new SyncError("artifact_invalid", 422, message, cause instanceof CadWebError
    ? { cadwebCode: cause.code }
    : undefined);
}

export class CadWebArtifactValidator implements ArtifactValidator {
  async validateSnapshot(bytes: Uint8Array): Promise<ValidatedWriterArtifact> {
    try {
      const document = await readCadWeb(bytes);
      const binding = document.manifest.syncBinding;
      if (!binding) throw invalid("snapshot must contain syncBinding");
      return {
        mode: "snapshot",
        artifactId: binding.snapshotId,
        drawingId: binding.drawingId,
        modelEpoch: binding.modelEpoch,
        sourceFingerprint: document.manifest.source.drawingFingerprint,
        baseRevision: binding.baseRevision,
        semanticChange: snapshotSemanticChange(document),
      };
    } catch (error) {
      if (error instanceof SyncError) throw error;
      throw invalid("invalid .cadweb writer snapshot", error);
    }
  }

  async validateChangeset(bytes: Uint8Array): Promise<ValidatedWriterArtifact> {
    try {
      const document = await readCadWebDelta(bytes);
      return {
        mode: "delta",
        artifactId: document.change.changeSetId,
        drawingId: document.change.drawingId,
        modelEpoch: document.change.modelEpoch,
        sourceFingerprint: document.change.sourceFingerprint,
        baseRevision: document.change.baseRevision,
        semanticChange: deltaSemanticChange(document),
      };
    } catch (error) {
      throw invalid("invalid .cadwebdelta changeset", error);
    }
  }

  async validateCheckpoint(bytes: Uint8Array): Promise<ValidatedCheckpoint> {
    try {
      const document = await readCadWeb(bytes);
      const binding = document.manifest.checkpointBinding;
      if (!binding) throw invalid("checkpoint must contain checkpointBinding");
      const semantic = snapshotSemanticChange(document);
      const computedStateHash = applySemanticChange(
        binding.drawingId,
        binding.modelEpoch,
        {},
        semantic,
      ).stateHash;
      return {
        checkpointId: binding.checkpointId,
        drawingId: binding.drawingId,
        modelEpoch: binding.modelEpoch,
        revision: binding.revision,
        stateHash: binding.stateHash,
        computedStateHash,
      };
    } catch (error) {
      if (error instanceof SyncError) throw error;
      throw invalid("invalid checkpoint .cadweb package", error);
    }
  }
}

#pragma once

#include "cadweb/CadWebChangeTracker.h"

#include <cstdint>
#include <optional>
#include <set>
#include <string>
#include <variant>
#include <vector>

namespace cadweb {

struct SavedFileEvidence {
  std::string actualTarget;
  std::string sourceFingerprint;
  std::string dwgVersion;
  std::string versionToken;

  bool operator==(const SavedFileEvidence& other) const noexcept;
};

struct TrustedBaseline {
  std::string drawingId;
  std::string modelEpoch;
  std::uint64_t revision = 0U;
  std::string stateHash;
  SavedFileEvidence fileEvidence;
};

enum class SaveJournalPhase : std::uint8_t {
  Begun = 1,
  CapturePending = 2,
  VerifiedNoop = 3,
  SealedPublishRequired = 4,
  ServerAcknowledged = 5,
  Aborted = 6,
  Ineligible = 7,
  RebindRequired = 8,
  RecoveryRequired = 9,
};

const char* saveJournalPhaseName(SaveJournalPhase phase) noexcept;

struct SaveJournalRecord {
  std::string saveToken;
  std::string drawingId;
  std::string modelEpoch;
  std::uint64_t baseRevision = 0U;
  std::string intendedTarget;
  SaveJournalPhase phase = SaveJournalPhase::Begun;
  std::optional<SavedFileEvidence> savedFileEvidence;
  std::string capturedStateHash;
  std::string artifactId;
};

enum class OutboxArtifactKind : std::uint8_t {
  Delta = 1,
  Snapshot = 2,
};

const char* outboxArtifactKindName(OutboxArtifactKind kind) noexcept;

struct OutboxItem {
  std::string saveToken;
  OutboxArtifactKind artifactKind = OutboxArtifactKind::Delta;
  std::string artifactId;
  std::string drawingId;
  std::string modelEpoch;
  std::string writerSessionId;
  std::uint64_t baseRevision = 0U;
  std::string resultStateHash;
  std::string payloadPath;
  std::string payloadSha256;
  std::uint64_t payloadSize = 0U;
  bool payloadIsDurable = false;
  bool acknowledged = false;
};

struct SaveSyncState {
  std::optional<TrustedBaseline> acknowledgedBaseline;
  std::vector<SaveJournalRecord> journals;
  std::vector<OutboxItem> outbox;
  std::set<FullSnapshotReason> fallbackReasons;

  bool requiresFullSnapshot() const noexcept {
    return !fallbackReasons.empty();
  }
};

struct BeginSaveEvent {
  std::string saveToken;
  std::string drawingId;
  std::string modelEpoch;
  std::uint64_t baseRevision = 0U;
  std::string intendedTarget;
  SaveClassification classification;
};

struct SaveCompletedEvent {
  std::string saveToken;
  SavedFileEvidence evidence;
};

struct VerifyNoopEvent {
  std::string saveToken;
  std::string capturedStateHash;
};

struct SealPublishEvent {
  std::string saveToken;
  OutboxItem item;
};

struct AcknowledgePublishEvent {
  std::string saveToken;
  std::string artifactId;
  std::uint64_t serverRevision = 0U;
  std::string serverStateHash;
};

struct AbortSaveEvent {
  std::string saveToken;
};

struct MarkIneligibleEvent {
  std::string saveToken;
};

struct RequireRebindEvent {
  std::string saveToken;
};

struct RequireRecoveryEvent {
  std::string saveToken;
};

using SaveJournalEvent =
    std::variant<BeginSaveEvent, SaveCompletedEvent, VerifyNoopEvent,
                 SealPublishEvent, AcknowledgePublishEvent, AbortSaveEvent,
                 MarkIneligibleEvent, RequireRebindEvent,
                 RequireRecoveryEvent>;

struct JournalReduceResult {
  SaveSyncState state;
  bool accepted = false;
  std::string error;
};

// Pure reducer. The persistence adapter must atomically replace its durable
// aggregate with result.state before performing any follow-up work. A rejected
// result can add a mandatory fallback reason and must not be discarded.
JournalReduceResult reduceSaveJournal(const SaveSyncState& current,
                                      const SaveJournalEvent& event);

bool hasPendingAcknowledgement(const SaveSyncState& state) noexcept;

enum class RecoveryAction : std::uint8_t {
  Clean = 1,
  ResumeUpload = 2,
  RequireFullSnapshot = 3,
  RequireRebind = 4,
};

struct RecoveryContext {
  bool requireTrustedBaseline = true;
  bool manualDiscardDetected = false;
  std::optional<SavedFileEvidence> currentFileEvidence;
};

struct RecoveryDecision {
  RecoveryAction action = RecoveryAction::RequireFullSnapshot;
  std::optional<FullSnapshotReason> reason;
  std::vector<std::string> resumeArtifactIds;
};

RecoveryDecision recoverSaveSync(const SaveSyncState& state,
                                 const RecoveryContext& context);

// Bounds terminal local history without removing an open/rebind/sealed token.
// A no-op evidence marker is retained only when it is newer than the latest
// ACK journal; otherwise the ACKed baseline already carries newer evidence.
void compactSaveSyncHistory(SaveSyncState& state);

}  // namespace cadweb

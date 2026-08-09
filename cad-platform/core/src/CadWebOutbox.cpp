#include "cadweb/CadWebOutbox.h"

#include <algorithm>
#include <cstdint>
#include <type_traits>
#include <utility>

namespace cadweb {
namespace {

constexpr std::uint64_t kMaxJsonSafeInteger = 9007199254740991ULL;

SaveJournalRecord* findJournal(SaveSyncState& state,
                               const std::string& saveToken) {
  const auto found = std::find_if(
      state.journals.begin(), state.journals.end(),
      [&saveToken](const SaveJournalRecord& record) {
        return record.saveToken == saveToken;
      });
  return found == state.journals.end() ? nullptr : &*found;
}

const SaveJournalRecord* findJournal(const SaveSyncState& state,
                                     const std::string& saveToken) {
  const auto found = std::find_if(
      state.journals.begin(), state.journals.end(),
      [&saveToken](const SaveJournalRecord& record) {
        return record.saveToken == saveToken;
      });
  return found == state.journals.end() ? nullptr : &*found;
}

OutboxItem* findOutboxItem(SaveSyncState& state,
                           const std::string& artifactId) {
  const auto found = std::find_if(
      state.outbox.begin(), state.outbox.end(),
      [&artifactId](const OutboxItem& item) {
        return item.artifactId == artifactId;
      });
  return found == state.outbox.end() ? nullptr : &*found;
}

const OutboxItem* findOutboxItem(const SaveSyncState& state,
                                 const SaveJournalRecord& journal) {
  const auto found = std::find_if(
      state.outbox.begin(), state.outbox.end(),
      [&journal](const OutboxItem& item) {
        return !item.acknowledged && item.saveToken == journal.saveToken &&
               item.artifactId == journal.artifactId;
      });
  return found == state.outbox.end() ? nullptr : &*found;
}

JournalReduceResult accepted(SaveSyncState state) {
  return {std::move(state), true, {}};
}

JournalReduceResult rejected(SaveSyncState state, std::string error,
                             std::optional<FullSnapshotReason> reason =
                                 FullSnapshotReason::InvalidJournalTransition) {
  if (reason) {
    state.fallbackReasons.insert(*reason);
  }
  return {std::move(state), false, std::move(error)};
}

bool hasOpenSave(const SaveSyncState& state) {
  return std::any_of(state.journals.begin(), state.journals.end(),
                     [](const SaveJournalRecord& record) {
                       return record.phase == SaveJournalPhase::Begun ||
                              record.phase == SaveJournalPhase::CapturePending;
                     });
}

bool validEvidence(const SavedFileEvidence& evidence) {
  return !evidence.actualTarget.empty() &&
         !evidence.sourceFingerprint.empty() && !evidence.dwgVersion.empty() &&
         !evidence.versionToken.empty();
}

bool validBaseline(const TrustedBaseline& baseline) {
  return !baseline.drawingId.empty() && !baseline.modelEpoch.empty() &&
         baseline.revision != 0U && !baseline.stateHash.empty() &&
         validEvidence(baseline.fileEvidence);
}

bool matchesJournal(const OutboxItem& item,
                    const SaveJournalRecord& journal) {
  const bool knownKind = item.artifactKind == OutboxArtifactKind::Delta ||
                         item.artifactKind == OutboxArtifactKind::Snapshot;
  return item.saveToken == journal.saveToken &&
         item.drawingId == journal.drawingId &&
         item.modelEpoch == journal.modelEpoch &&
         item.baseRevision == journal.baseRevision &&
         knownKind &&
         !item.writerSessionId.empty() && !item.artifactId.empty() &&
         !item.resultStateHash.empty() && item.payloadSize != 0U &&
         !item.payloadPath.empty() && !item.payloadSha256.empty() &&
         item.payloadIsDurable && !item.acknowledged;
}

JournalReduceResult reduceOne(const SaveSyncState& current,
                              const BeginSaveEvent& event) {
  SaveSyncState state = current;
  if (event.saveToken.empty() || event.drawingId.empty() ||
      event.modelEpoch.empty() || event.intendedTarget.empty()) {
    return rejected(std::move(state), "begin-save identity is incomplete");
  }
  if (findJournal(state, event.saveToken) != nullptr) {
    return rejected(std::move(state), "save token already exists");
  }
  if (hasOpenSave(state)) {
    return rejected(std::move(state), "another save token is still open");
  }

  SaveJournalRecord record;
  record.saveToken = event.saveToken;
  record.drawingId = event.drawingId;
  record.modelEpoch = event.modelEpoch;
  record.baseRevision = event.baseRevision;
  record.intendedTarget = event.intendedTarget;

  switch (event.classification.disposition) {
    case SaveDisposition::PublishDelta:
      if (!state.acknowledgedBaseline ||
          state.acknowledgedBaseline->drawingId != event.drawingId ||
          state.acknowledgedBaseline->modelEpoch != event.modelEpoch ||
          state.acknowledgedBaseline->revision != event.baseRevision) {
        return rejected(std::move(state),
                        "delta save has no matching trusted baseline",
                        FullSnapshotReason::MissingTrustedBaseline);
      }
      record.phase = SaveJournalPhase::Begun;
      break;
    case SaveDisposition::PublishInitialSnapshot:
      if (event.baseRevision != 0U) {
        return rejected(std::move(state),
                        "initial snapshot must use base revision zero");
      }
      record.phase = SaveJournalPhase::Begun;
      break;
    case SaveDisposition::DoNotPublish:
      record.phase = SaveJournalPhase::Ineligible;
      break;
    case SaveDisposition::RebindRequired:
      record.phase = SaveJournalPhase::RebindRequired;
      break;
  }

  state.journals.push_back(std::move(record));
  return accepted(std::move(state));
}

JournalReduceResult reduceOne(const SaveSyncState& current,
                              const SaveCompletedEvent& event) {
  SaveSyncState state = current;
  auto* journal = findJournal(state, event.saveToken);
  if (journal == nullptr || journal->phase != SaveJournalPhase::Begun) {
    return rejected(std::move(state),
                    "save-complete requires a begun journal token");
  }
  if (!validEvidence(event.evidence)) {
    return rejected(std::move(state), "saved file evidence is incomplete");
  }
  journal->savedFileEvidence = event.evidence;
  journal->phase = SaveJournalPhase::CapturePending;
  return accepted(std::move(state));
}

JournalReduceResult reduceOne(const SaveSyncState& current,
                              const VerifyNoopEvent& event) {
  SaveSyncState state = current;
  auto* journal = findJournal(state, event.saveToken);
  if (journal == nullptr ||
      journal->phase != SaveJournalPhase::CapturePending ||
      !journal->savedFileEvidence) {
    return rejected(std::move(state),
                    "verified no-op requires capture-pending evidence");
  }
  if (hasPendingAcknowledgement(state)) {
    return rejected(std::move(state),
                    "no-op is forbidden while a publish awaits ACK",
                    FullSnapshotReason::PendingAcknowledgement);
  }
  if (!state.acknowledgedBaseline ||
      state.acknowledgedBaseline->drawingId != journal->drawingId ||
      state.acknowledgedBaseline->modelEpoch != journal->modelEpoch ||
      state.acknowledgedBaseline->revision != journal->baseRevision) {
    return rejected(std::move(state), "no-op baseline is not trusted",
                    FullSnapshotReason::MissingTrustedBaseline);
  }
  if (event.capturedStateHash.empty() ||
      event.capturedStateHash != state.acknowledgedBaseline->stateHash) {
    return rejected(std::move(state),
                    "captured state differs from the ACKed baseline",
                    std::nullopt);
  }

  journal->capturedStateHash = event.capturedStateHash;
  journal->phase = SaveJournalPhase::VerifiedNoop;
  return accepted(std::move(state));
}

JournalReduceResult reduceOne(const SaveSyncState& current,
                              const SealPublishEvent& event) {
  SaveSyncState state = current;
  auto* journal = findJournal(state, event.saveToken);
  if (journal == nullptr ||
      journal->phase != SaveJournalPhase::CapturePending ||
      !journal->savedFileEvidence) {
    return rejected(std::move(state),
                    "seal requires capture-pending evidence");
  }
  if (hasPendingAcknowledgement(state)) {
    return rejected(std::move(state),
                    "only one unacknowledged publish is allowed",
                    FullSnapshotReason::PendingAcknowledgement);
  }
  if (!matchesJournal(event.item, *journal)) {
    return rejected(std::move(state),
                    "sealed outbox item does not match its journal token");
  }
  if (findOutboxItem(state, event.item.artifactId) != nullptr) {
    return rejected(std::move(state), "outbox artifact already exists");
  }

  journal->capturedStateHash = event.item.resultStateHash;
  journal->artifactId = event.item.artifactId;
  journal->phase = SaveJournalPhase::SealedPublishRequired;
  state.outbox.push_back(event.item);
  return accepted(std::move(state));
}

JournalReduceResult reduceOne(const SaveSyncState& current,
                              const AcknowledgePublishEvent& event) {
  SaveSyncState state = current;
  auto* journal = findJournal(state, event.saveToken);
  if (journal == nullptr ||
      journal->phase != SaveJournalPhase::SealedPublishRequired ||
      journal->artifactId != event.artifactId ||
      !journal->savedFileEvidence) {
    return rejected(std::move(state),
                    "ACK does not match a sealed journal token");
  }
  auto* item = findOutboxItem(state, event.artifactId);
  const bool baselineMatches =
      journal->baseRevision == 0U
          ? !state.acknowledgedBaseline
          : state.acknowledgedBaseline &&
                state.acknowledgedBaseline->drawingId == journal->drawingId &&
                state.acknowledgedBaseline->modelEpoch == journal->modelEpoch &&
                state.acknowledgedBaseline->revision == journal->baseRevision;
  if (item == nullptr || item->acknowledged ||
      item->saveToken != event.saveToken ||
      item->resultStateHash != event.serverStateHash ||
      event.serverStateHash != journal->capturedStateHash ||
      journal->baseRevision >= kMaxJsonSafeInteger ||
      event.serverRevision != journal->baseRevision + 1U ||
      !matchesJournal(*item, *journal) || !baselineMatches) {
    return rejected(std::move(state),
                    "server ACK does not match the sealed outbox item");
  }

  item->acknowledged = true;
  journal->phase = SaveJournalPhase::ServerAcknowledged;
  state.acknowledgedBaseline = TrustedBaseline{
      journal->drawingId, journal->modelEpoch, event.serverRevision,
      event.serverStateHash, *journal->savedFileEvidence};
  if (item->artifactKind == OutboxArtifactKind::Snapshot) {
    state.fallbackReasons.clear();
  }
  return accepted(std::move(state));
}

JournalReduceResult reduceOne(const SaveSyncState& current,
                              const AbortSaveEvent& event) {
  SaveSyncState state = current;
  auto* journal = findJournal(state, event.saveToken);
  if (journal == nullptr || journal->phase != SaveJournalPhase::Begun) {
    return rejected(std::move(state),
                    "abort requires a begun journal token");
  }
  journal->phase = SaveJournalPhase::Aborted;
  return accepted(std::move(state));
}

JournalReduceResult reduceOne(const SaveSyncState& current,
                              const MarkIneligibleEvent& event) {
  SaveSyncState state = current;
  auto* journal = findJournal(state, event.saveToken);
  if (journal == nullptr || journal->phase != SaveJournalPhase::Begun) {
    return rejected(std::move(state),
                    "ineligible requires a begun journal token");
  }
  journal->phase = SaveJournalPhase::Ineligible;
  return accepted(std::move(state));
}

JournalReduceResult reduceOne(const SaveSyncState& current,
                              const RequireRebindEvent& event) {
  SaveSyncState state = current;
  auto* journal = findJournal(state, event.saveToken);
  if (journal == nullptr ||
      (journal->phase != SaveJournalPhase::Begun &&
       journal->phase != SaveJournalPhase::CapturePending)) {
    return rejected(std::move(state),
                    "rebind requires a begun or capture-pending token");
  }
  journal->phase = SaveJournalPhase::RebindRequired;
  return accepted(std::move(state));
}

JournalReduceResult reduceOne(const SaveSyncState& current,
                              const RequireRecoveryEvent& event) {
  SaveSyncState state = current;
  auto* journal = findJournal(state, event.saveToken);
  if (journal == nullptr ||
      (journal->phase != SaveJournalPhase::Begun &&
       journal->phase != SaveJournalPhase::CapturePending)) {
    return rejected(std::move(state),
                    "recovery requires an interrupted save token");
  }
  journal->phase = SaveJournalPhase::RecoveryRequired;
  state.fallbackReasons.insert(FullSnapshotReason::JournalCrashGap);
  return accepted(std::move(state));
}

RecoveryDecision fullSnapshot(FullSnapshotReason reason) {
  return {RecoveryAction::RequireFullSnapshot, reason, {}};
}

}  // namespace

bool SavedFileEvidence::operator==(
    const SavedFileEvidence& other) const noexcept {
  return actualTarget == other.actualTarget &&
         sourceFingerprint == other.sourceFingerprint &&
         dwgVersion == other.dwgVersion &&
         versionToken == other.versionToken;
}

const char* saveJournalPhaseName(SaveJournalPhase phase) noexcept {
  switch (phase) {
    case SaveJournalPhase::Begun:
      return "begun";
    case SaveJournalPhase::CapturePending:
      return "capture-pending";
    case SaveJournalPhase::VerifiedNoop:
      return "verified-noop";
    case SaveJournalPhase::SealedPublishRequired:
      return "sealed-publish-required";
    case SaveJournalPhase::ServerAcknowledged:
      return "server-acknowledged";
    case SaveJournalPhase::Aborted:
      return "aborted";
    case SaveJournalPhase::Ineligible:
      return "ineligible";
    case SaveJournalPhase::RebindRequired:
      return "rebind-required";
    case SaveJournalPhase::RecoveryRequired:
      return "recovery-required";
  }
  return "unknown";
}

const char* outboxArtifactKindName(OutboxArtifactKind kind) noexcept {
  switch (kind) {
    case OutboxArtifactKind::Delta:
      return "delta";
    case OutboxArtifactKind::Snapshot:
      return "snapshot";
  }
  return "unknown";
}

JournalReduceResult reduceSaveJournal(const SaveSyncState& current,
                                      const SaveJournalEvent& event) {
  return std::visit(
      [&current](const auto& value) { return reduceOne(current, value); }, event);
}

bool hasPendingAcknowledgement(const SaveSyncState& state) noexcept {
  return std::any_of(state.outbox.begin(), state.outbox.end(),
                     [](const OutboxItem& item) {
                       return item.payloadIsDurable && !item.acknowledged;
                     });
}

RecoveryDecision recoverSaveSync(const SaveSyncState& state,
                                 const RecoveryContext& context) {
  if (context.manualDiscardDetected) {
    return fullSnapshot(FullSnapshotReason::ManualDiscard);
  }
  if (!state.fallbackReasons.empty()) {
    return fullSnapshot(*state.fallbackReasons.begin());
  }
  if (state.acknowledgedBaseline &&
      !validBaseline(*state.acknowledgedBaseline)) {
    return fullSnapshot(FullSnapshotReason::MissingTrustedBaseline);
  }

  std::set<std::string> saveTokens;
  for (const auto& journal : state.journals) {
    if (journal.saveToken.empty() || !saveTokens.insert(journal.saveToken).second) {
      return fullSnapshot(FullSnapshotReason::JournalCrashGap);
    }
  }
  std::set<std::string> artifactIds;
  for (const auto& item : state.outbox) {
    if (item.artifactId.empty() ||
        !artifactIds.insert(item.artifactId).second) {
      return fullSnapshot(FullSnapshotReason::MissingSealedOutbox);
    }
  }

  const auto pendingCount = static_cast<std::size_t>(std::count_if(
      state.outbox.begin(), state.outbox.end(), [](const OutboxItem& item) {
        return item.payloadIsDurable && !item.acknowledged;
      }));
  if (pendingCount > 1U) {
    return fullSnapshot(FullSnapshotReason::PendingAcknowledgement);
  }

  const SaveJournalRecord* latestTerminalSaved = nullptr;
  for (auto journal = state.journals.rbegin();
       journal != state.journals.rend(); ++journal) {
    if (journal->phase == SaveJournalPhase::VerifiedNoop ||
        journal->phase == SaveJournalPhase::ServerAcknowledged) {
      latestTerminalSaved = &*journal;
      break;
    }
  }

  const SaveJournalRecord* pendingJournal = nullptr;
  for (const auto& journal : state.journals) {
    switch (journal.phase) {
      case SaveJournalPhase::Begun:
      case SaveJournalPhase::CapturePending:
        return fullSnapshot(FullSnapshotReason::JournalCrashGap);
      case SaveJournalPhase::RebindRequired:
        return {RecoveryAction::RequireRebind, std::nullopt, {}};
      case SaveJournalPhase::RecoveryRequired:
        break;
      case SaveJournalPhase::SealedPublishRequired: {
        const auto* item = findOutboxItem(state, journal);
        if (!journal.savedFileEvidence ||
            !validEvidence(*journal.savedFileEvidence) || item == nullptr ||
            !matchesJournal(*item, journal) ||
            item->resultStateHash != journal.capturedStateHash) {
          return fullSnapshot(FullSnapshotReason::MissingSealedOutbox);
        }
        if (pendingJournal != nullptr) {
          return fullSnapshot(FullSnapshotReason::PendingAcknowledgement);
        }
        pendingJournal = &journal;
        break;
      }
      case SaveJournalPhase::VerifiedNoop:
        if (pendingCount != 0U) {
          return fullSnapshot(FullSnapshotReason::PendingAcknowledgement);
        }
        if (!state.acknowledgedBaseline || !journal.savedFileEvidence ||
            !validEvidence(*journal.savedFileEvidence) ||
            journal.capturedStateHash.empty()) {
          return fullSnapshot(FullSnapshotReason::MissingTrustedBaseline);
        }
        if (latestTerminalSaved == &journal &&
            (journal.drawingId != state.acknowledgedBaseline->drawingId ||
             journal.modelEpoch != state.acknowledgedBaseline->modelEpoch ||
             journal.baseRevision != state.acknowledgedBaseline->revision ||
             journal.capturedStateHash !=
                 state.acknowledgedBaseline->stateHash)) {
          return fullSnapshot(FullSnapshotReason::MissingTrustedBaseline);
        }
        break;
      case SaveJournalPhase::ServerAcknowledged:
      case SaveJournalPhase::Aborted:
      case SaveJournalPhase::Ineligible:
        break;
    }
  }

  for (const auto& item : state.outbox) {
    if (!item.acknowledged) {
      const auto journal = findJournal(state, item.saveToken);
      if (journal == nullptr ||
          journal->phase != SaveJournalPhase::SealedPublishRequired ||
          journal->artifactId != item.artifactId) {
        return fullSnapshot(FullSnapshotReason::MissingSealedOutbox);
      }
    }
  }

  if (context.requireTrustedBaseline && !state.acknowledgedBaseline &&
      pendingJournal == nullptr) {
    return fullSnapshot(FullSnapshotReason::MissingTrustedBaseline);
  }

  if (context.currentFileEvidence) {
    const SavedFileEvidence* expected = nullptr;
    if (pendingJournal != nullptr && pendingJournal->savedFileEvidence) {
      expected = &*pendingJournal->savedFileEvidence;
    } else if (latestTerminalSaved != nullptr &&
               latestTerminalSaved->phase ==
                   SaveJournalPhase::VerifiedNoop &&
               latestTerminalSaved->savedFileEvidence) {
      expected = &*latestTerminalSaved->savedFileEvidence;
    } else if (state.acknowledgedBaseline) {
      expected = &state.acknowledgedBaseline->fileEvidence;
    }
    if (expected == nullptr || !(*expected == *context.currentFileEvidence)) {
      return fullSnapshot(FullSnapshotReason::FileEvidenceMismatch);
    }
  }

  if (pendingJournal != nullptr) {
    return {RecoveryAction::ResumeUpload, std::nullopt,
            {pendingJournal->artifactId}};
  }
  return {RecoveryAction::Clean, std::nullopt, {}};
}

void compactSaveSyncHistory(SaveSyncState& state) {
  std::optional<std::size_t> latestNoop;
  std::optional<std::size_t> latestAcknowledgement;
  for (std::size_t index = 0U; index < state.journals.size(); ++index) {
    if (state.journals[index].phase == SaveJournalPhase::VerifiedNoop) {
      latestNoop = index;
    } else if (state.journals[index].phase ==
               SaveJournalPhase::ServerAcknowledged) {
      latestAcknowledgement = index;
    }
  }
  const bool keepLatestNoop =
      latestNoop &&
      (!latestAcknowledgement || *latestNoop > *latestAcknowledgement);

  std::vector<SaveJournalRecord> retained;
  retained.reserve(state.journals.size());
  for (std::size_t index = 0U; index < state.journals.size(); ++index) {
    const auto phase = state.journals[index].phase;
    const bool removable =
        phase == SaveJournalPhase::ServerAcknowledged ||
        phase == SaveJournalPhase::Aborted ||
        phase == SaveJournalPhase::Ineligible ||
        phase == SaveJournalPhase::RecoveryRequired ||
        (phase == SaveJournalPhase::VerifiedNoop &&
         (!keepLatestNoop || index != *latestNoop));
    if (!removable) retained.push_back(state.journals[index]);
  }
  state.journals = std::move(retained);
}

}  // namespace cadweb

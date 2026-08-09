#include "cadweb/CadWebChangeTracker.h"
#include "cadweb/CadWebDurableStore.h"
#include "cadweb/CadWebOutbox.h"

#include <algorithm>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

void expect(bool condition, const std::string& message) {
  if (!condition) {
    throw std::runtime_error(message);
  }
}

cadweb::SavedFileEvidence evidence(std::string token = "file-v1") {
  return {"/drawings/factory.dwg", "fingerprint-a", "AC1038",
          std::move(token)};
}

cadweb::TrustedBaseline baseline() {
  return {"drawing-a", "epoch-a", 127U, "state-127", evidence()};
}

cadweb::BeginSaveEvent begin(std::string token) {
  return {std::move(token),
          "drawing-a",
          "epoch-a",
          127U,
          "/drawings/factory.dwg",
          {cadweb::SaveDisposition::PublishDelta,
           cadweb::SaveIneligibilityReason::None}};
}

cadweb::OutboxItem outbox(std::string token, std::string changeSet,
                          std::string stateHash = "state-128") {
  cadweb::OutboxItem item;
  item.saveToken = std::move(token);
  item.artifactKind = cadweb::OutboxArtifactKind::Delta;
  item.artifactId = std::move(changeSet);
  item.drawingId = "drawing-a";
  item.modelEpoch = "epoch-a";
  item.writerSessionId = "writer-a";
  item.baseRevision = 127U;
  item.resultStateHash = std::move(stateHash);
  item.payloadPath = "/outbox/change.cadwebdelta";
  item.payloadSha256 = std::string(64U, 'a');
  item.payloadSize = 1024U;
  item.payloadIsDurable = true;
  return item;
}

cadweb::SaveSyncState reduce(cadweb::SaveSyncState state,
                             cadweb::SaveJournalEvent event) {
  auto result = cadweb::reduceSaveJournal(state, event);
  expect(result.accepted, result.error);
  return std::move(result.state);
}

void testCandidateFenceKeepsBothGenerations() {
  cadweb::CadWebChangeTracker tracker;
  expect(tracker.recordCandidate(cadweb::ChangeCandidateKind::Entity, "54AF"),
         "candidate before fence should be recorded");
  tracker.requireFullSnapshot(cadweb::FullSnapshotReason::UndoRedo);
  const auto frozenId = tracker.freeze();

  expect(tracker.frozen() && tracker.frozen()->id == frozenId,
         "freeze should retain the old generation");
  expect(tracker.frozen()->candidates.size() == 1U,
         "frozen generation should contain the old candidate");
  expect(tracker.frozen()->requiresFullSnapshot(),
         "fallback before fence should be frozen");

  expect(tracker.recordCandidate(cadweb::ChangeCandidateKind::Entity, "54AF",
                                 {}, cadweb::CandidateStateHint::Erased),
         "same handle after fence should be recorded independently");
  expect(tracker.active().candidates.size() == 1U,
         "active generation should retain same-handle post-fence callback");
  tracker.requireFullSnapshot(cadweb::FullSnapshotReason::UnknownObject);

  tracker.releaseFrozen();
  expect(tracker.active().candidates.size() == 1U,
         "releasing frozen generation must not clear active callbacks");
  expect(tracker.active().fallbackReasons.count(
             cadweb::FullSnapshotReason::UnknownObject) == 1U,
         "post-fence fallback must remain active");
}

void testCandidateAbortRestoresFrozen() {
  cadweb::CadWebChangeTracker tracker;
  tracker.recordCandidate(cadweb::ChangeCandidateKind::Entity, "10");
  tracker.freeze();
  tracker.recordCandidate(cadweb::ChangeCandidateKind::Entity, "20");
  tracker.restoreFrozen();
  expect(tracker.active().candidates.size() == 2U,
         "abort should merge frozen candidates back into active generation");
  expect(!tracker.frozen(), "restored generation should no longer be frozen");

  expect(!tracker.recordCandidate(cadweb::ChangeCandidateKind::Entity, ""),
         "empty handle should fail closed");
  expect(tracker.active().fallbackReasons.count(
             cadweb::FullSnapshotReason::UnresolvedObject) == 1U,
         "empty handle should require full snapshot");

  tracker.recordCandidate(cadweb::ChangeCandidateKind::Unknown, "99");
  expect(tracker.active().fallbackReasons.count(
             cadweb::FullSnapshotReason::UnknownObject) == 1U,
         "unknown candidate kind should fail closed");
}

void testCandidateNormalizationAndLimit() {
  cadweb::CadWebChangeTracker tracker(2U);
  expect(tracker.recordCandidate(cadweb::ChangeCandidateKind::Entity,
                                 "0x00aF", "000b"),
         "valid non-canonical handles should normalize at the callback edge");
  const auto& candidate = tracker.active().candidates.begin()->second;
  expect(candidate.key.sourceHandle == "AF" &&
             candidate.ownerSourceHandle == "B",
         "candidate and owner handles should be uppercase without prefixes");
  expect(tracker.recordCandidate(cadweb::ChangeCandidateKind::Entity, "10"),
         "candidate below the cap should be retained");
  expect(!tracker.recordCandidate(cadweb::ChangeCandidateKind::Entity, "11"),
         "candidate over the callback bookkeeping cap should be rejected");
  expect(tracker.active().fallbackReasons.count(
             cadweb::FullSnapshotReason::CandidateLimitExceeded) == 1U,
         "candidate overflow should force a full-snapshot fallback");
  expect(!tracker.recordCandidate(cadweb::ChangeCandidateKind::Entity, "0x0"),
         "the zero handle should fail closed");
}

void testCommandRouterKeepsMdiOwnership() {
  cadweb::CadWebCommandRouter router;
  expect(router.begin(101U, "MOVE") == 1U,
         "first document command should have depth one");
  expect(router.begin(202U, "REDO") == 1U,
         "second document command should have its own depth");

  const auto first = router.finish("MOVE");
  expect(first && first->documentKey == 101U &&
             first->documentDepth == 0U,
         "completion must route to the document remembered at command start");
  expect(router.pendingCount() == 1U,
         "finishing one MDI document must not consume another command");

  const auto second = router.finish("REDO");
  expect(second && second->documentKey == 202U &&
             second->documentDepth == 0U && router.pendingCount() == 0U,
         "the other MDI document should finish independently");

  router.begin(101U, "ZOOM");
  router.begin(202U, "ZOOM");
  const auto latestSameName = router.finish("ZOOM");
  const auto earlierSameName = router.finish("ZOOM");
  expect(latestSameName && latestSameName->documentKey == 202U &&
             earlierSameName && earlierSameName->documentKey == 101U,
         "same-name nested callbacks should route in start-order LIFO");
}

void testCommandRouterHandlesNestedCancelledAndFailed() {
  cadweb::CadWebCommandRouter router;
  expect(router.begin(101U, "QSAVE") == 1U &&
             router.begin(101U, "ZOOM") == 2U &&
             router.begin(202U, "UNDO") == 1U,
         "nested depth must be counted per document");

  const auto cancelled = router.finish("ZOOM");
  expect(cancelled && cancelled->documentKey == 101U &&
             cancelled->documentDepth == 1U,
         "a cancelled nested command should leave its outer command active");
  const auto failed = router.finish("UNDO");
  expect(failed && failed->documentKey == 202U &&
             failed->documentDepth == 0U,
         "a failed command should close the document where it started");
  const auto ended = router.finish("QSAVE");
  expect(ended && ended->documentKey == 101U &&
             ended->documentDepth == 0U,
         "ending the outer command should clear its document depth");

  router.begin(303U, "MOVE");
  expect(!router.finish("ROTATE") && router.pendingCount() == 1U,
         "an unmatched callback must not consume another command frame");
  router.forgetDocument(303U);
  expect(router.pendingCount() == 0U && !router.finish("MOVE"),
         "detaching a document must discard its remembered command frames");

  expect(cadweb::isUndoRedoCommand("U") &&
             cadweb::isUndoRedoCommand("UNDO") &&
             cadweb::isUndoRedoCommand("REDO") &&
             !cadweb::isUndoRedoCommand("MREDO"),
         "only U/UNDO/REDO should force the conservative undo fallback");
}

void testSaveClassifier() {
  using cadweb::SaveDisposition;
  using cadweb::SaveFacts;
  using cadweb::SaveProvenance;

  expect(cadweb::classifySave(
             {SaveProvenance::QuickSave, true, "FACTORY.DWG", {}})
             .disposition == SaveDisposition::PublishDelta,
         "bound QSAVE DWG should publish a delta");
  expect(cadweb::classifySave(
             {SaveProvenance::FirstSave, false, "new.dwg", {}})
             .disposition == SaveDisposition::PublishInitialSnapshot,
         "first DWG save should publish an initial snapshot");
  expect(cadweb::classifySave(
             {SaveProvenance::SaveAs, true, "fork.dwg", {}})
             .disposition == SaveDisposition::RebindRequired,
         "SAVEAS DWG should require rebind");
  expect(cadweb::classifySave(
             {SaveProvenance::SaveCopy, true, "copy.dwg", {}})
             .disposition == SaveDisposition::DoNotPublish,
         "SAVE-copy should not publish");
  expect(cadweb::classifySave(
             {SaveProvenance::QuickSave, true, "factory.dxf", {}})
             .disposition == SaveDisposition::DoNotPublish,
         "non-DWG target should not publish");
  const auto autosave = cadweb::classifySave(
      SaveFacts{SaveProvenance::QuickSave, true, "factory.sv$", {}});
  expect(autosave.reason == cadweb::SaveIneligibilityReason::AutoSave,
         "SV$ target should be classified as AutoSave");
}

void testVerifiedNoopAndTerminalStates() {
  cadweb::SaveSyncState state;
  state.acknowledgedBaseline = baseline();
  state = reduce(std::move(state), begin("noop"));
  expect(state.journals.back().phase == cadweb::SaveJournalPhase::Begun,
         "eligible begin should persist begun state");
  state = reduce(std::move(state),
                 cadweb::SaveCompletedEvent{"noop", evidence("file-v2")});
  expect(state.journals.back().phase ==
             cadweb::SaveJournalPhase::CapturePending,
         "saveComplete should persist capture-pending");
  state = reduce(std::move(state),
                 cadweb::VerifyNoopEvent{"noop", "state-127"});
  expect(state.journals.back().phase ==
             cadweb::SaveJournalPhase::VerifiedNoop,
         "matching trusted hash should persist verified-noop");
  expect(state.outbox.empty(), "verified no-op must not create outbox data");
  expect(state.acknowledgedBaseline->revision == 127U,
         "verified no-op must not advance ACKed revision");

  state = reduce(std::move(state), begin("abort"));
  state = reduce(std::move(state), cadweb::AbortSaveEvent{"abort"});
  expect(state.journals.back().phase == cadweb::SaveJournalPhase::Aborted,
         "abort must close the journal explicitly");

  state = reduce(std::move(state), begin("late-ineligible"));
  state = reduce(std::move(state),
                 cadweb::MarkIneligibleEvent{"late-ineligible"});
  expect(state.journals.back().phase == cadweb::SaveJournalPhase::Ineligible,
         "late provenance classification should close as ineligible");

  state = reduce(std::move(state), begin("late-rebind"));
  state = reduce(std::move(state),
                 cadweb::RequireRebindEvent{"late-rebind"});
  expect(state.journals.back().phase ==
             cadweb::SaveJournalPhase::RebindRequired,
         "actual SAVEAS target should close as rebind-required");

  cadweb::BeginSaveEvent ineligible = begin("ineligible");
  ineligible.classification = {cadweb::SaveDisposition::DoNotPublish,
                               cadweb::SaveIneligibilityReason::SaveCopy};
  state = reduce(std::move(state), std::move(ineligible));
  expect(state.journals.back().phase == cadweb::SaveJournalPhase::Ineligible,
         "classifier should create an ineligible terminal record");

  cadweb::BeginSaveEvent rebind = begin("rebind");
  rebind.classification = {cadweb::SaveDisposition::RebindRequired,
                           cadweb::SaveIneligibilityReason::None};
  state = reduce(std::move(state), std::move(rebind));
  expect(state.journals.back().phase ==
             cadweb::SaveJournalPhase::RebindRequired,
         "SAVEAS should create a rebind terminal record");
}

void testSealAckAndRecovery() {
  cadweb::SaveSyncState state;
  state.acknowledgedBaseline = baseline();
  state = reduce(std::move(state), begin("publish"));
  state = reduce(std::move(state),
                 cadweb::SaveCompletedEvent{"publish", evidence("file-v2")});
  state = reduce(std::move(state),
                 cadweb::SealPublishEvent{
                     "publish", outbox("publish", "change-128")});

  expect(state.journals.back().phase ==
             cadweb::SaveJournalPhase::SealedPublishRequired,
         "durable item should seal publish-required state");
  expect(cadweb::hasPendingAcknowledgement(state),
         "sealed item should await server ACK");
  const auto recovery = cadweb::recoverSaveSync(state, {});
  expect(recovery.action == cadweb::RecoveryAction::ResumeUpload &&
             recovery.resumeArtifactIds.size() == 1U &&
             recovery.resumeArtifactIds.front() == "change-128",
         "matching sealed item should resume upload after restart");

  const std::vector<cadweb::AcknowledgePublishEvent> invalidAcks{
      {"other-save", "change-128", 128U, "state-128"},
      {"publish", "other-artifact", 128U, "state-128"},
      {"publish", "change-128", 127U, "state-128"},
      {"publish", "change-128", 129U, "state-128"},
      {"publish", "change-128", 128U, "other-state"},
  };
  for (const auto& invalidAck : invalidAcks) {
    const auto rejected = cadweb::reduceSaveJournal(state, invalidAck);
    expect(!rejected.accepted &&
               rejected.state.acknowledgedBaseline->revision == 127U &&
               !rejected.state.outbox.back().acknowledged &&
               rejected.state.journals.back().phase ==
                   cadweb::SaveJournalPhase::SealedPublishRequired,
           "wrong, stale, or skipped ACK must not mutate the trusted state");
  }

  state = reduce(std::move(state),
                 cadweb::AcknowledgePublishEvent{
                     "publish", "change-128", 128U, "state-128"});
  expect(state.journals.back().phase ==
             cadweb::SaveJournalPhase::ServerAcknowledged,
         "matching ACK should close publish state");
  expect(!cadweb::hasPendingAcknowledgement(state),
         "ACKed item should no longer be pending");
  expect(state.acknowledgedBaseline->revision == 128U &&
             state.acknowledgedBaseline->stateHash == "state-128",
         "matching ACK should advance trusted baseline");
}

void testInitialSnapshotAck() {
  cadweb::SaveSyncState state;
  cadweb::BeginSaveEvent initial{
      "initial",
      "drawing-a",
      "epoch-a",
      0U,
      "/drawings/factory.dwg",
      {cadweb::SaveDisposition::PublishInitialSnapshot,
       cadweb::SaveIneligibilityReason::None}};
  state = reduce(std::move(state), std::move(initial));
  state = reduce(std::move(state),
                 cadweb::SaveCompletedEvent{"initial", evidence()});

  auto initialItem = outbox("initial", "change-1", "state-1");
  initialItem.artifactKind = cadweb::OutboxArtifactKind::Snapshot;
  initialItem.baseRevision = 0U;
  state = reduce(std::move(state),
                 cadweb::SealPublishEvent{"initial", initialItem});
  state.fallbackReasons.insert(
      cadweb::FullSnapshotReason::MissingTrustedBaseline);

  auto conflictingBaseline = state;
  conflictingBaseline.acknowledgedBaseline = baseline();
  const auto rejected = cadweb::reduceSaveJournal(
      conflictingBaseline,
      cadweb::AcknowledgePublishEvent{"initial", "change-1", 1U,
                                      "state-1"});
  expect(!rejected.accepted,
         "initial ACK must reject a pre-existing or mismatched baseline");

  state = reduce(std::move(state),
                 cadweb::AcknowledgePublishEvent{
                     "initial", "change-1", 1U, "state-1"});
  expect(state.journals.back().phase ==
             cadweb::SaveJournalPhase::ServerAcknowledged,
         "initial snapshot ACK should close without a previous baseline");
  expect(state.acknowledgedBaseline &&
             state.acknowledgedBaseline->revision == 1U &&
             state.acknowledgedBaseline->stateHash == "state-1",
         "initial snapshot ACK should establish revision-one baseline");
  expect(state.fallbackReasons.empty(),
         "trusted snapshot ACK should clear recovery reasons it resolved");

  auto next = begin("after-snapshot");
  next.baseRevision = 1U;
  auto nextBegin = cadweb::reduceSaveJournal(state, std::move(next));
  expect(nextBegin.accepted &&
             nextBegin.state.journals.back().phase ==
                 cadweb::SaveJournalPhase::Begun,
         "save after snapshot ACK should re-enter the delta lifecycle");
}

void testNoopForbiddenWithPendingAck() {
  cadweb::SaveSyncState state;
  state.acknowledgedBaseline = baseline();
  state = reduce(std::move(state), begin("first"));
  state = reduce(std::move(state),
                 cadweb::SaveCompletedEvent{"first", evidence("file-v2")});
  state = reduce(std::move(state),
                 cadweb::SealPublishEvent{"first",
                                          outbox("first", "change-128")});
  state = reduce(std::move(state), begin("second"));
  state = reduce(std::move(state),
                 cadweb::SaveCompletedEvent{"second", evidence("file-v3")});

  auto result = cadweb::reduceSaveJournal(
      state, cadweb::VerifyNoopEvent{"second", "state-127"});
  expect(!result.accepted,
         "no-op must be rejected while an older publish awaits ACK");
  expect(result.state.fallbackReasons.count(
             cadweb::FullSnapshotReason::PendingAcknowledgement) == 1U,
         "rejected no-op should fail closed to snapshot/rebase");
}

void testCrashGapsFailClosed() {
  cadweb::SaveSyncState begun;
  begun.acknowledgedBaseline = baseline();
  begun = reduce(std::move(begun), begin("gap"));
  expect(cadweb::recoverSaveSync(begun, {}).action ==
             cadweb::RecoveryAction::RequireFullSnapshot,
         "crash after begun must require full snapshot");

  auto capture = reduce(
      std::move(begun),
      cadweb::SaveCompletedEvent{"gap", evidence("file-v2")});
  expect(cadweb::recoverSaveSync(capture, {}).reason ==
             cadweb::FullSnapshotReason::JournalCrashGap,
         "crash during capture must be identified as journal gap");
  auto recoverable = cadweb::reduceSaveJournal(
      capture, cadweb::RequireRecoveryEvent{"gap"});
  expect(recoverable.accepted &&
             recoverable.state.journals.back().phase ==
                 cadweb::SaveJournalPhase::RecoveryRequired,
         "interrupted token should be durably superseded by recovery");
  auto nextRecoverySave = cadweb::reduceSaveJournal(
      recoverable.state, begin("recovery-snapshot"));
  expect(nextRecoverySave.accepted,
         "superseded crash token must not permanently block recovery Save");

  auto missingOutbox = capture;
  missingOutbox.journals.back().phase =
      cadweb::SaveJournalPhase::SealedPublishRequired;
  missingOutbox.journals.back().artifactId = "lost-change";
  missingOutbox.journals.back().capturedStateHash = "state-128";
  const auto missing = cadweb::recoverSaveSync(missingOutbox, {});
  expect(missing.action == cadweb::RecoveryAction::RequireFullSnapshot &&
             missing.reason ==
                 cadweb::FullSnapshotReason::MissingSealedOutbox,
         "publish marker without sealed item must fail closed");

  cadweb::SaveSyncState rebound;
  rebound.acknowledgedBaseline = baseline();
  auto rebind = begin("fork");
  rebind.classification = {cadweb::SaveDisposition::RebindRequired,
                           cadweb::SaveIneligibilityReason::None};
  rebound = reduce(std::move(rebound), std::move(rebind));
  expect(cadweb::recoverSaveSync(rebound, {}).action ==
             cadweb::RecoveryAction::RequireRebind,
         "rebind marker must survive restart");
}

void testRecoveryEvidenceAndManualDiscard() {
  cadweb::SaveSyncState clean;
  clean.acknowledgedBaseline = baseline();
  expect(cadweb::recoverSaveSync(clean, {}).action ==
             cadweb::RecoveryAction::Clean,
         "trusted baseline with no open token should recover cleanly");

  cadweb::RecoveryContext changedFile;
  changedFile.currentFileEvidence = evidence("foreign-version");
  const auto mismatch = cadweb::recoverSaveSync(clean, changedFile);
  expect(mismatch.reason == cadweb::FullSnapshotReason::FileEvidenceMismatch,
         "unexplained file evidence change must fail closed");

  cadweb::RecoveryContext discarded;
  discarded.manualDiscardDetected = true;
  const auto manual = cadweb::recoverSaveSync(clean, discarded);
  expect(manual.reason == cadweb::FullSnapshotReason::ManualDiscard,
         "manual discard must force recovery snapshot");

  cadweb::SaveSyncState unattached;
  expect(cadweb::recoverSaveSync(unattached, {}).reason ==
             cadweb::FullSnapshotReason::MissingTrustedBaseline,
         "attach without trusted baseline must fail closed");
}

void testRecoveryUsesNewestTerminalSavedEvidence() {
  cadweb::SaveSyncState state;
  state.acknowledgedBaseline = baseline();
  state = reduce(std::move(state), begin("old-noop"));
  state = reduce(std::move(state),
                 cadweb::SaveCompletedEvent{"old-noop", evidence("file-v2")});
  state = reduce(std::move(state),
                 cadweb::VerifyNoopEvent{"old-noop", "state-127"});

  state = reduce(std::move(state), begin("new-publish"));
  state = reduce(
      std::move(state),
      cadweb::SaveCompletedEvent{"new-publish", evidence("file-v3")});
  state = reduce(std::move(state),
                 cadweb::SealPublishEvent{
                     "new-publish", outbox("new-publish", "change-128")});
  state = reduce(std::move(state),
                 cadweb::AcknowledgePublishEvent{
                     "new-publish", "change-128", 128U, "state-128"});

  cadweb::RecoveryContext restart;
  restart.currentFileEvidence = evidence("file-v3");
  expect(cadweb::recoverSaveSync(state, restart).action ==
             cadweb::RecoveryAction::Clean,
         "recovery should use newer ACKed evidence, not an older no-op");
  cadweb::compactSaveSyncHistory(state);
  expect(state.journals.empty() &&
             cadweb::recoverSaveSync(state, restart).action ==
                 cadweb::RecoveryAction::Clean,
         "compaction should drop no-op evidence superseded by a newer ACK");
}

std::filesystem::path durableTestRoot() {
  return std::filesystem::path("build") / "save-sync-durable-test";
}

void writeBytes(const std::filesystem::path& path,
                const std::string& bytes) {
  std::filesystem::create_directories(path.parent_path());
  std::ofstream stream(path, std::ios::binary | std::ios::trunc);
  stream.write(bytes.data(), static_cast<std::streamsize>(bytes.size()));
  expect(stream.good(), "test fixture write should succeed");
}

std::string acknowledgementJson(
    const std::string& artifactId, const std::string& saveToken,
    const std::string& revision, const std::string& stateHash,
    const std::string& acknowledgedAt = "2026-08-09T12:00:00Z",
    const std::string& schemaVersion = "1") {
  return "{\"schemaVersion\":" + schemaVersion +
         ",\"artifactId\":\"" + artifactId +
         "\",\"saveToken\":\"" + saveToken + "\",\"revision\":" +
         revision + ",\"stateHash\":\"" + stateHash +
         "\",\"acknowledgedAt\":\"" + acknowledgedAt + "\"}\n";
}

void expectAcknowledgementRejected(
    const cadweb::CadWebDurableStore& store, const cadweb::OutboxItem& item,
    const std::filesystem::path& path, const std::string& json,
    const std::string& message) {
  writeBytes(path, json);
  bool rejected = false;
  try {
    static_cast<void>(store.readAcknowledgement(item));
  } catch (const std::runtime_error&) {
    rejected = true;
  }
  expect(rejected, message);
}

cadweb::DurableDocumentSyncState durableState() {
  cadweb::DurableDocumentSyncState state;
  state.binding = {"drawing-a", "fingerprint-a", "epoch-a", "writer-a"};
  state.saveSync.acknowledgedBaseline = baseline();
  cadweb::CadRevisionIndex index;
  index.drawingId = "drawing-a";
  index.sourceFingerprint = "fingerprint-a";
  index.modelEpoch = "epoch-a";
  index.revision = 127U;
  index.units.name = "millimetres";
  index.units.metersPerUnit = 0.001;
  index.origin = {1.0, 2.0, 3.0};
  index.resultExtents = {{1.0, 2.0, 3.0}, {4.0, 5.0, 6.0}};
  index.objectHashes.emplace("entity:AF", std::string(64U, 'a'));
  index.stateHash = "state-127";
  state.acknowledgedIndex = std::move(index);
  return state;
}

cadweb::OutboxItem durableItem(std::string artifactId) {
  cadweb::OutboxItem item;
  item.saveToken = "save-128";
  item.artifactKind = cadweb::OutboxArtifactKind::Delta;
  item.artifactId = std::move(artifactId);
  item.drawingId = "drawing-a";
  item.modelEpoch = "epoch-a";
  item.writerSessionId = "writer-a";
  item.baseRevision = 127U;
  item.resultStateHash = std::string(64U, 'b');
  return item;
}

void testDurableStateAndBindingRoundTrip() {
  expect(cadweb::DurableOutboxLimits{}.maxPayloadBytes ==
             cadweb::limits::kMaxArchiveBytes,
         "durable payload and CadWeb archive limits must stay aligned");
  const auto root = durableTestRoot();
  bool oversizedLimitRejected = false;
  try {
    (void)cadweb::CadWebDurableStore(
        root / "invalid-limit",
        cadweb::DurableOutboxLimits{
            1U, cadweb::limits::kMaxArchiveBytes + 1U,
            cadweb::limits::kMaxArchiveBytes + 1U});
  } catch (const std::runtime_error&) {
    oversizedLimitRejected = true;
  }
  expect(oversizedLimitRejected,
         "durable payload limit must not exceed the archive limit");
  std::filesystem::remove_all(root);
  cadweb::CadWebDurableStore store(root);
  const cadweb::ProvisionedWriterBinding binding{
      "drawing-a", "{ABC-123}", "epoch-a", "writer-a"};
  store.writeProvisionedBindingAtomically(binding);
  const auto loadedBinding = store.loadProvisionedBinding("{abc-123}");
  expect(loadedBinding && loadedBinding->drawingId == "drawing-a" &&
             loadedBinding->sourceFingerprint == "{ABC-123}",
         "atomic provisioning manifest should load by canonical fingerprint");

  auto state = durableState();
  store.saveDocumentStateAtomically(state);
  const auto loaded = store.loadDocumentState("FINGERPRINT-A");
  expect(loaded && loaded->binding.writerSessionId == "writer-a" &&
             loaded->acknowledgedIndex &&
             loaded->acknowledgedIndex->objectHashes.at("entity:AF") ==
                 std::string(64U, 'a') &&
             loaded->saveSync.acknowledgedBaseline->revision == 127U,
         "binary journal should round-trip binding, baseline, and hash index");
}

void testAtomicReadyOutboxContract() {
  const auto root = durableTestRoot() / "outbox-case";
  std::filesystem::remove_all(root);
  const cadweb::DurableOutboxLimits limits{1U, 1024U, 1024U};
  cadweb::CadWebDurableStore store(root, limits);
  const auto prepared = root / "prepared.cadwebdelta";
  writeBytes(prepared, "immutable-delta-bytes");

  auto preparedItem =
      store.prepareOutboxItem(durableItem("artifact-128"), prepared);
  expect(preparedItem.payloadIsDurable &&
             store.listReadyItemDirectories().empty(),
         "durable staging must remain invisible before journal commit");

  auto durable = durableState();
  durable.saveSync = reduce(std::move(durable.saveSync), begin("save-128"));
  durable.saveSync = reduce(
      std::move(durable.saveSync),
      cadweb::SaveCompletedEvent{"save-128", evidence("file-v2")});
  durable.saveSync = reduce(
      std::move(durable.saveSync),
      cadweb::SealPublishEvent{"save-128", preparedItem});
  durable.pendingIndex = durable.acknowledgedIndex;
  durable.pendingIndex->stateHash = std::string(64U, 'b');
  durable.pendingArtifactId = "artifact-128";
  store.saveDocumentStateAtomically(durable);
  expect(store.listReadyItemDirectories().empty(),
         "persisted sealed journal must precede the uploader-visible marker");

  cadweb::CadWebDurableStore afterSealedRestart(root, limits);
  const auto recoveredPending =
      afterSealedRestart.loadDocumentState("fingerprint-a");
  expect(recoveredPending && recoveredPending->pendingIndex &&
             recoveredPending->pendingArtifactId == "artifact-128" &&
             cadweb::recoverSaveSync(recoveredPending->saveSync, {}).action ==
                 cadweb::RecoveryAction::ResumeUpload,
         "restart after journal commit must recover the exact pending index");
  auto resumedPrepared = afterSealedRestart.prepareOutboxItem(
      durableItem("artifact-128"), prepared);
  auto sealed =
      afterSealedRestart.publishPreparedOutboxItem(resumedPrepared);
  expect(sealed.item.payloadIsDurable &&
             sealed.readyDirectory.filename() == "artifact-128.ready" &&
             sealed.payloadPath.filename() == "payload.cadwebdelta" &&
             std::filesystem::exists(sealed.manifestPath),
         "seal should expose one fixed-name payload and immutable manifest");
  const auto ready = afterSealedRestart.listReadyItemDirectories();
  expect(ready.size() == 1U && ready.front() == sealed.readyDirectory,
         "pollers should see only atomically renamed ready directories");

  std::filesystem::create_directory(root / "outbox" / "items" /
                                    "ignored.staging-99");
  expect(afterSealedRestart.listReadyItemDirectories().size() == 1U,
         "pollers must ignore incomplete staging directories");

  auto retryPrepared = afterSealedRestart.prepareOutboxItem(
      durableItem("artifact-128"), prepared);
  auto retry = afterSealedRestart.publishPreparedOutboxItem(retryPrepared);
  expect(retry.payloadPath == sealed.payloadPath,
         "same immutable artifact should seal idempotently");

  bool quotaRejected = false;
  try {
    afterSealedRestart.prepareOutboxItem(durableItem("artifact-129"), prepared);
  } catch (const std::runtime_error&) {
    quotaRejected = true;
  }
  expect(quotaRejected, "bounded ready-item quota should reject a second item");

  const auto ackPath = sealed.readyDirectory / "ack.json";
  const auto expectedStateHash = std::string(64U, 'b');
  const auto validAckJson = acknowledgementJson(
      "artifact-128", "save-128", "128", expectedStateHash);
  auto missingClosingBrace = validAckJson;
  missingClosingBrace.erase(missingClosingBrace.rfind('}'), 1U);
  expectAcknowledgementRejected(afterSealedRestart, sealed.item, ackPath,
                                "not-json\n",
                                "malformed durable ACK must be rejected");
  expectAcknowledgementRejected(
      afterSealedRestart, sealed.item, ackPath, "{\"schemaVersion\":1}\n",
      "partial durable ACK must be rejected");
  expectAcknowledgementRejected(
      afterSealedRestart, sealed.item, ackPath,
      acknowledgementJson("artifact-128", "save-128", "128",
                          expectedStateHash, "2026-08-09T12:00:00Z", "2"),
      "durable ACK with an unsupported schema must be rejected");
  expectAcknowledgementRejected(
      afterSealedRestart, sealed.item, ackPath,
      std::string(64U * 1024U + 1U, 'x'),
      "oversized durable ACK must be rejected before parsing");
  expectAcknowledgementRejected(
      afterSealedRestart, sealed.item, ackPath, validAckJson.substr(1U),
      "durable ACK without an opening object brace must be rejected");
  expectAcknowledgementRejected(
      afterSealedRestart, sealed.item, ackPath, missingClosingBrace,
      "durable ACK without a closing object brace must be rejected");
  expectAcknowledgementRejected(
      afterSealedRestart, sealed.item, ackPath, validAckJson + "trailing",
      "durable ACK with bytes after its object must be rejected");
  expectAcknowledgementRejected(
      afterSealedRestart, sealed.item, ackPath,
      acknowledgementJson("other-artifact", "save-128", "128",
                          expectedStateHash),
      "durable ACK with the wrong artifact must be rejected");
  expectAcknowledgementRejected(
      afterSealedRestart, sealed.item, ackPath,
      acknowledgementJson("artifact-128", "other-save", "128",
                          expectedStateHash),
      "durable ACK with the wrong save token must be rejected");
  expectAcknowledgementRejected(
      afterSealedRestart, sealed.item, ackPath,
      acknowledgementJson("artifact-128", "save-128", "127",
                          expectedStateHash),
      "stale durable ACK revision must be rejected");
  expectAcknowledgementRejected(
      afterSealedRestart, sealed.item, ackPath,
      acknowledgementJson("artifact-128", "save-128", "129",
                          expectedStateHash),
      "durable ACK must not skip the next authoritative server revision");
  expectAcknowledgementRejected(
      afterSealedRestart, sealed.item, ackPath,
      acknowledgementJson("artifact-128", "save-128", "128",
                          std::string(64U, 'c')),
      "durable ACK with the wrong state hash must be rejected");
  expectAcknowledgementRejected(
      afterSealedRestart, sealed.item, ackPath,
      acknowledgementJson("artifact-128", "save-128", "128",
                          expectedStateHash, ""),
      "durable ACK without acknowledgement time must be rejected");
  expectAcknowledgementRejected(
      afterSealedRestart, sealed.item, ackPath,
      acknowledgementJson("artifact-128", "save-128", "128garbage",
                          expectedStateHash),
      "durable ACK revision with trailing garbage must be rejected");
  expectAcknowledgementRejected(
      afterSealedRestart, sealed.item, ackPath,
      "{\"schemaVersion\":1,\"artifactId\":\"artifact-128\"garbage,"
      "\"saveToken\":\"save-128\",\"revision\":128,\"stateHash\":\"" +
          expectedStateHash +
          "\",\"acknowledgedAt\":\"2026-08-09T12:00:00Z\"}\n",
      "durable ACK string with trailing garbage must be rejected");

  writeBytes(ackPath, validAckJson);
  cadweb::CadWebDurableStore afterAckFileRestart(root, limits);
  const auto ackPending =
      afterAckFileRestart.loadDocumentState("fingerprint-a");
  expect(ackPending && ackPending->pendingIndex &&
             ackPending->pendingArtifactId == "artifact-128",
         "restart with an ACK file must retain the pending semantic index");
  const auto acknowledgement =
      afterAckFileRestart.readAcknowledgement(sealed.item);
  expect(acknowledgement && acknowledgement->revision == 128U &&
             acknowledgement->artifactId == "artifact-128",
         "matching atomic ACK should be accepted for baseline advancement");

  bool prematureCleanupRejected = false;
  try {
    afterSealedRestart.removeAcknowledgedOutboxItem(sealed.item);
  } catch (const std::runtime_error&) {
    prematureCleanupRejected = true;
  }
  expect(prematureCleanupRejected &&
             std::filesystem::exists(sealed.readyDirectory),
         "payload cleanup must be forbidden before durable ACK state");

  auto acknowledgedState = *ackPending;
  acknowledgedState.saveSync = reduce(
      std::move(acknowledgedState.saveSync),
      cadweb::AcknowledgePublishEvent{"save-128", "artifact-128", 128U,
                                      expectedStateHash});
  acknowledgedState.acknowledgedIndex = acknowledgedState.pendingIndex;
  acknowledgedState.acknowledgedIndex->revision = 128U;
  acknowledgedState.pendingIndex.reset();
  acknowledgedState.pendingArtifactId.clear();
  afterAckFileRestart.saveDocumentStateAtomically(acknowledgedState);

  cadweb::CadWebDurableStore afterBaselineRestart(root, limits);
  auto persistedBaseline =
      afterBaselineRestart.loadDocumentState("fingerprint-a");
  expect(persistedBaseline && persistedBaseline->acknowledgedIndex &&
             persistedBaseline->acknowledgedIndex->revision == 128U &&
             persistedBaseline->saveSync.acknowledgedBaseline->revision ==
                 128U &&
             cadweb::recoverSaveSync(persistedBaseline->saveSync, {}).action ==
                 cadweb::RecoveryAction::Clean &&
             std::filesystem::exists(sealed.readyDirectory),
         "restart before GC must load the new baseline while payload remains");
  const auto acknowledgedItem = std::find_if(
      persistedBaseline->saveSync.outbox.begin(),
      persistedBaseline->saveSync.outbox.end(),
      [](const cadweb::OutboxItem& item) { return item.acknowledged; });
  expect(acknowledgedItem != persistedBaseline->saveSync.outbox.end(),
         "ACK transition should mark the matching durable item");
  afterBaselineRestart.removeAcknowledgedOutboxItem(*acknowledgedItem);
  expect(!std::filesystem::exists(sealed.readyDirectory),
         "payload may be collected only after ACK baseline is durable");

  cadweb::CadWebDurableStore afterDeleteRestart(root, limits);
  auto cleanupPending =
      afterDeleteRestart.loadDocumentState("fingerprint-a");
  expect(cleanupPending.has_value(),
         "restart after payload delete must reload durable state");
  const auto cleanupItem = std::find_if(
      cleanupPending->saveSync.outbox.begin(),
      cleanupPending->saveSync.outbox.end(),
      [](const cadweb::OutboxItem& item) { return item.acknowledged; });
  expect(cleanupItem != cleanupPending->saveSync.outbox.end(),
         "restart after payload delete must retain cleanup work in state");
  afterDeleteRestart.removeAcknowledgedOutboxItem(*cleanupItem);
  cleanupPending->saveSync.outbox.erase(cleanupItem);
  afterDeleteRestart.saveDocumentStateAtomically(*cleanupPending);

  cadweb::CadWebDurableStore beforeCompactionRestart(root, limits);
  auto uncompacted =
      beforeCompactionRestart.loadDocumentState("fingerprint-a");
  expect(uncompacted && uncompacted->saveSync.outbox.empty() &&
             !uncompacted->saveSync.journals.empty() &&
             cadweb::recoverSaveSync(uncompacted->saveSync, {}).action ==
                 cadweb::RecoveryAction::Clean,
         "restart after GC but before compaction must remain recoverably clean");
  cadweb::compactSaveSyncHistory(uncompacted->saveSync);
  beforeCompactionRestart.saveDocumentStateAtomically(*uncompacted);

  cadweb::CadWebDurableStore afterCompactionRestart(root, limits);
  const auto compacted =
      afterCompactionRestart.loadDocumentState("fingerprint-a");
  expect(compacted && compacted->saveSync.journals.empty() &&
             cadweb::recoverSaveSync(compacted->saveSync, {}).action ==
                 cadweb::RecoveryAction::Clean,
         "compaction retry must preserve the persisted ACKed baseline");

  auto nextPrepared = afterCompactionRestart.prepareOutboxItem(
      durableItem("artifact-129"), prepared);
  expect(nextPrepared.payloadIsDurable &&
             afterCompactionRestart.listReadyItemDirectories().empty() &&
             std::filesystem::exists(root / "outbox" / "items" /
                                     "artifact-129.staged"),
         "next staged item must remain invisible across restart");
  cadweb::CadWebDurableStore stagedRestart(root, limits);
  auto resumedNext =
      stagedRestart.prepareOutboxItem(durableItem("artifact-129"), prepared);
  auto nextReady = stagedRestart.publishPreparedOutboxItem(resumedNext);
  expect(std::filesystem::exists(nextReady.readyDirectory),
         "ACK cleanup should release bounded quota for the next revision");
  const auto repeatedReady =
      stagedRestart.publishPreparedOutboxItem(resumedNext);
  expect(repeatedReady.readyDirectory == nextReady.readyDirectory,
         "staged and ready recovery operations must be idempotent");
}

}  // namespace

int main() {
  try {
    testCandidateFenceKeepsBothGenerations();
    testCandidateAbortRestoresFrozen();
    testCandidateNormalizationAndLimit();
    testCommandRouterKeepsMdiOwnership();
    testCommandRouterHandlesNestedCancelledAndFailed();
    testSaveClassifier();
    testVerifiedNoopAndTerminalStates();
    testSealAckAndRecovery();
    testInitialSnapshotAck();
    testNoopForbiddenWithPendingAck();
    testCrashGapsFailClosed();
    testRecoveryEvidenceAndManualDiscard();
    testRecoveryUsesNewestTerminalSavedEvidence();
    testDurableStateAndBindingRoundTrip();
    testAtomicReadyOutboxContract();
    std::cout << "cadweb save sync pure tests passed\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "cadweb save sync pure tests failed: " << error.what() << '\n';
    return 1;
  }
}

#pragma once

#include <cstddef>
#include <cstdint>
#include <map>
#include <optional>
#include <set>
#include <string>
#include <vector>

namespace cadweb {

enum class FullSnapshotReason : std::uint8_t {
  UndoRedo = 1,
  UnknownObject = 2,
  UnsupportedOwner = 3,
  UnresolvedObject = 4,
  MissingTrustedBaseline = 5,
  JournalCrashGap = 6,
  MissingSealedOutbox = 7,
  FileEvidenceMismatch = 8,
  ManualDiscard = 9,
  PendingAcknowledgement = 10,
  InvalidJournalTransition = 11,
  UnsupportedMetadata = 12,
  CandidateLimitExceeded = 13,
};

const char* fullSnapshotReasonName(FullSnapshotReason reason) noexcept;

bool isUndoRedoCommand(const std::string& canonicalCommand) noexcept;

struct CommandRoute {
  std::uint64_t documentKey = 0U;
  std::size_t documentDepth = 0U;
};

// AcEditorReactor completion callbacks do not carry a document pointer. Record
// the owner at commandWillStart so MDI document switches cannot close another
// document's command state. Command names are expected to be canonicalized at
// the ObjectARX boundary.
class CadWebCommandRouter {
 public:
  std::size_t begin(std::uint64_t documentKey, std::string canonicalCommand);
  std::optional<CommandRoute> finish(const std::string& canonicalCommand);
  void forgetDocument(std::uint64_t documentKey);

  std::size_t pendingCount() const noexcept { return pending_.size(); }

 private:
  struct PendingCommand {
    std::uint64_t documentKey = 0U;
    std::string canonicalCommand;
  };

  std::vector<PendingCommand> pending_;
};

enum class ChangeCandidateKind : std::uint8_t {
  Entity = 1,
  BlockDefinition = 2,
  Layer = 3,
  Metadata = 4,
  Layout = 5,
  Xref = 6,
  Unknown = 255,
};

enum class CandidateStateHint : std::uint8_t {
  Unknown = 0,
  Present = 1,
  Erased = 2,
};

struct ChangeCandidateKey {
  ChangeCandidateKind kind = ChangeCandidateKind::Unknown;
  std::string sourceHandle;

  bool operator<(const ChangeCandidateKey& other) const noexcept;
  bool operator==(const ChangeCandidateKey& other) const noexcept;
};

// Hints are never treated as a replayable change log. The safe-boundary
// reconciler must resolve the key and compare the final semantic state.
struct ChangeCandidate {
  ChangeCandidateKey key;
  std::string ownerSourceHandle;
  CandidateStateHint stateHint = CandidateStateHint::Unknown;
};

struct CandidateGeneration {
  std::uint64_t id = 0U;
  std::map<ChangeCandidateKey, ChangeCandidate> candidates;
  std::set<FullSnapshotReason> fallbackReasons;

  bool requiresFullSnapshot() const noexcept {
    return !fallbackReasons.empty();
  }
};

// One instance belongs to exactly one document/database. freeze() creates a
// save fence: callbacks after the fence always write to a new active generation,
// including callbacks for a handle already present in the frozen generation.
class CadWebChangeTracker {
 public:
  explicit CadWebChangeTracker(std::size_t maxCandidates = 100000U);

  bool recordCandidate(ChangeCandidateKind kind, std::string sourceHandle,
                       std::string ownerSourceHandle = {},
                       CandidateStateHint stateHint =
                           CandidateStateHint::Unknown);
  void requireFullSnapshot(FullSnapshotReason reason);

  std::uint64_t freeze();
  void releaseFrozen();
  void restoreFrozen();

  const CandidateGeneration& active() const noexcept { return active_; }
  const std::optional<CandidateGeneration>& frozen() const noexcept {
    return frozen_;
  }

 private:
  std::size_t maxCandidates_ = 0U;
  std::uint64_t nextGenerationId_ = 1U;
  CandidateGeneration active_;
  std::optional<CandidateGeneration> frozen_;
};

enum class SaveProvenance : std::uint8_t {
  QuickSave = 1,
  FirstSave = 2,
  SaveCopy = 3,
  SaveAs = 4,
  AutoSave = 5,
  ApiDriven = 6,
  Unknown = 255,
};

struct SaveFacts {
  SaveProvenance provenance = SaveProvenance::Unknown;
  bool drawingIsBound = false;
  std::string intendedTarget;
  std::string actualTarget;
};

enum class SaveDisposition : std::uint8_t {
  PublishDelta = 1,
  PublishInitialSnapshot = 2,
  DoNotPublish = 3,
  RebindRequired = 4,
};

enum class SaveIneligibilityReason : std::uint8_t {
  None = 0,
  AutoSave = 1,
  SaveCopy = 2,
  NonDwgTarget = 3,
  ApiDriven = 4,
  UnknownProvenance = 5,
  UnboundDrawing = 6,
  InvalidFacts = 7,
};

struct SaveClassification {
  SaveDisposition disposition = SaveDisposition::DoNotPublish;
  SaveIneligibilityReason reason = SaveIneligibilityReason::UnknownProvenance;

  bool publishEligible() const noexcept {
    return disposition == SaveDisposition::PublishDelta ||
           disposition == SaveDisposition::PublishInitialSnapshot;
  }
};

SaveClassification classifySave(const SaveFacts& facts);

}  // namespace cadweb

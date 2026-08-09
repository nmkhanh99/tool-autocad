#include "cadweb/CadWebChangeTracker.h"

#include <algorithm>
#include <cctype>
#include <stdexcept>
#include <utility>

namespace cadweb {
namespace {

std::string lowercaseExtension(const std::string& path) {
  const auto separator = path.find_last_of("/\\");
  const auto dot = path.find_last_of('.');
  if (dot == std::string::npos ||
      (separator != std::string::npos && dot < separator)) {
    return {};
  }

  std::string extension = path.substr(dot);
  std::transform(extension.begin(), extension.end(), extension.begin(),
                 [](unsigned char value) {
                   return static_cast<char>(std::tolower(value));
                 });
  return extension;
}

std::optional<std::string> canonicalHandle(std::string handle) {
  if (handle.size() >= 2U && handle[0] == '0' &&
      (handle[1] == 'x' || handle[1] == 'X')) {
    handle.erase(0U, 2U);
  }
  const auto firstNonzero = handle.find_first_not_of('0');
  if (firstNonzero == std::string::npos || handle.size() > 32U) {
    return std::nullopt;
  }
  handle.erase(0U, firstNonzero);
  for (auto& value : handle) {
    const bool decimal = value >= '0' && value <= '9';
    const bool lowercase = value >= 'a' && value <= 'f';
    const bool uppercase = value >= 'A' && value <= 'F';
    if (!decimal && !lowercase && !uppercase) {
      return std::nullopt;
    }
    if (lowercase) value = static_cast<char>(value - 'a' + 'A');
  }
  return handle;
}

}  // namespace

const char* fullSnapshotReasonName(FullSnapshotReason reason) noexcept {
  switch (reason) {
    case FullSnapshotReason::UndoRedo:
      return "undo-redo";
    case FullSnapshotReason::UnknownObject:
      return "unknown-object";
    case FullSnapshotReason::UnsupportedOwner:
      return "unsupported-owner";
    case FullSnapshotReason::UnresolvedObject:
      return "unresolved-object";
    case FullSnapshotReason::MissingTrustedBaseline:
      return "missing-trusted-baseline";
    case FullSnapshotReason::JournalCrashGap:
      return "journal-crash-gap";
    case FullSnapshotReason::MissingSealedOutbox:
      return "missing-sealed-outbox";
    case FullSnapshotReason::FileEvidenceMismatch:
      return "file-evidence-mismatch";
    case FullSnapshotReason::ManualDiscard:
      return "manual-discard";
    case FullSnapshotReason::PendingAcknowledgement:
      return "pending-acknowledgement";
    case FullSnapshotReason::InvalidJournalTransition:
      return "invalid-journal-transition";
    case FullSnapshotReason::UnsupportedMetadata:
      return "unsupported-metadata";
    case FullSnapshotReason::CandidateLimitExceeded:
      return "candidate-limit-exceeded";
  }
  return "unknown";
}

bool isUndoRedoCommand(const std::string& canonicalCommand) noexcept {
  return canonicalCommand == "U" || canonicalCommand == "UNDO" ||
         canonicalCommand == "REDO";
}

std::size_t CadWebCommandRouter::begin(
    std::uint64_t documentKey, std::string canonicalCommand) {
  pending_.push_back({documentKey, std::move(canonicalCommand)});
  return static_cast<std::size_t>(std::count_if(
      pending_.begin(), pending_.end(),
      [documentKey](const PendingCommand& command) {
        return command.documentKey == documentKey;
      }));
}

std::optional<CommandRoute> CadWebCommandRouter::finish(
    const std::string& canonicalCommand) {
  for (std::size_t index = pending_.size(); index > 0U; --index) {
    if (pending_[index - 1U].canonicalCommand != canonicalCommand) continue;
    const auto documentKey = pending_[index - 1U].documentKey;
    pending_.erase(pending_.begin() +
                   static_cast<std::ptrdiff_t>(index - 1U));
    const auto depth = static_cast<std::size_t>(std::count_if(
        pending_.begin(), pending_.end(),
        [documentKey](const PendingCommand& command) {
          return command.documentKey == documentKey;
        }));
    return CommandRoute{documentKey, depth};
  }
  return std::nullopt;
}

void CadWebCommandRouter::forgetDocument(std::uint64_t documentKey) {
  pending_.erase(
      std::remove_if(pending_.begin(), pending_.end(),
                     [documentKey](const PendingCommand& command) {
                       return command.documentKey == documentKey;
                     }),
      pending_.end());
}

bool ChangeCandidateKey::operator<(
    const ChangeCandidateKey& other) const noexcept {
  if (kind != other.kind) {
    return kind < other.kind;
  }
  return sourceHandle < other.sourceHandle;
}

bool ChangeCandidateKey::operator==(
    const ChangeCandidateKey& other) const noexcept {
  return kind == other.kind && sourceHandle == other.sourceHandle;
}

CadWebChangeTracker::CadWebChangeTracker(std::size_t maxCandidates)
    : maxCandidates_(maxCandidates) {
  if (maxCandidates_ == 0U) {
    throw std::invalid_argument("candidate limit must be positive");
  }
  active_.id = nextGenerationId_++;
}

bool CadWebChangeTracker::recordCandidate(ChangeCandidateKind kind,
                                          std::string sourceHandle,
                                          std::string ownerSourceHandle,
                                          CandidateStateHint stateHint) {
  const auto normalizedSource = canonicalHandle(std::move(sourceHandle));
  if (!normalizedSource) {
    requireFullSnapshot(FullSnapshotReason::UnresolvedObject);
    return false;
  }

  if (!ownerSourceHandle.empty()) {
    const auto normalizedOwner = canonicalHandle(std::move(ownerSourceHandle));
    if (!normalizedOwner) {
      requireFullSnapshot(FullSnapshotReason::UnsupportedOwner);
      ownerSourceHandle.clear();
    } else {
      ownerSourceHandle = *normalizedOwner;
    }
  }

  ChangeCandidate candidate;
  candidate.key = {kind, *normalizedSource};
  candidate.ownerSourceHandle = std::move(ownerSourceHandle);
  candidate.stateHint = stateHint;
  const auto found = active_.candidates.find(candidate.key);
  if (found == active_.candidates.end()) {
    if (active_.candidates.size() >= maxCandidates_) {
      requireFullSnapshot(FullSnapshotReason::CandidateLimitExceeded);
      return false;
    }
    active_.candidates.emplace(candidate.key, std::move(candidate));
  } else {
    if (!candidate.ownerSourceHandle.empty()) {
      found->second.ownerSourceHandle = std::move(candidate.ownerSourceHandle);
    }
    if (candidate.stateHint != CandidateStateHint::Unknown) {
      found->second.stateHint = candidate.stateHint;
    }
  }
  if (kind == ChangeCandidateKind::Unknown) {
    requireFullSnapshot(FullSnapshotReason::UnknownObject);
  }
  return true;
}

void CadWebChangeTracker::requireFullSnapshot(FullSnapshotReason reason) {
  active_.fallbackReasons.insert(reason);
}

std::uint64_t CadWebChangeTracker::freeze() {
  if (frozen_) {
    throw std::logic_error("a candidate generation is already frozen");
  }

  frozen_ = std::move(active_);
  active_ = CandidateGeneration{};
  active_.id = nextGenerationId_++;
  return frozen_->id;
}

void CadWebChangeTracker::releaseFrozen() {
  if (!frozen_) {
    throw std::logic_error("no candidate generation is frozen");
  }
  frozen_.reset();
}

void CadWebChangeTracker::restoreFrozen() {
  if (!frozen_) {
    throw std::logic_error("no candidate generation is frozen");
  }

  for (const auto& entry : frozen_->candidates) {
    active_.candidates.emplace(entry.first, entry.second);
  }
  active_.fallbackReasons.insert(frozen_->fallbackReasons.begin(),
                                 frozen_->fallbackReasons.end());
  frozen_.reset();
}

SaveClassification classifySave(const SaveFacts& facts) {
  const std::string& target =
      facts.actualTarget.empty() ? facts.intendedTarget : facts.actualTarget;
  const auto extension = lowercaseExtension(target);

  if (facts.provenance == SaveProvenance::AutoSave || extension == ".sv$") {
    return {SaveDisposition::DoNotPublish,
            SaveIneligibilityReason::AutoSave};
  }
  if (extension != ".dwg") {
    return {SaveDisposition::DoNotPublish,
            SaveIneligibilityReason::NonDwgTarget};
  }

  switch (facts.provenance) {
    case SaveProvenance::QuickSave:
      if (!facts.drawingIsBound) {
        return {SaveDisposition::DoNotPublish,
                SaveIneligibilityReason::UnboundDrawing};
      }
      return {SaveDisposition::PublishDelta, SaveIneligibilityReason::None};
    case SaveProvenance::FirstSave:
      if (facts.drawingIsBound) {
        return {SaveDisposition::DoNotPublish,
                SaveIneligibilityReason::InvalidFacts};
      }
      return {SaveDisposition::PublishInitialSnapshot,
              SaveIneligibilityReason::None};
    case SaveProvenance::SaveCopy:
      return {SaveDisposition::DoNotPublish,
              SaveIneligibilityReason::SaveCopy};
    case SaveProvenance::SaveAs:
      return {SaveDisposition::RebindRequired,
              SaveIneligibilityReason::None};
    case SaveProvenance::ApiDriven:
      return {SaveDisposition::DoNotPublish,
              SaveIneligibilityReason::ApiDriven};
    case SaveProvenance::Unknown:
      return {SaveDisposition::DoNotPublish,
              SaveIneligibilityReason::UnknownProvenance};
    case SaveProvenance::AutoSave:
      break;
  }
  return {SaveDisposition::DoNotPublish,
          SaveIneligibilityReason::UnknownProvenance};
}

}  // namespace cadweb

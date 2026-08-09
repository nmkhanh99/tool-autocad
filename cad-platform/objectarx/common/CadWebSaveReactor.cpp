#include "windef.h"

#include "CadWebSaveReactor.h"

#include "CadWebAcDbAdapter.h"

#include "cadweb/CadWebChangeTracker.h"
#include "cadweb/CadDeltaWriter.h"
#include "cadweb/CadWebDurableStore.h"
#include "cadweb/CadWebRevisionPlanner.h"
#include "cadweb/CadWebWriter.h"

#include <AcString.h>
#include <aced.h>
#include <acdocman.h>
#include <acutads.h>
#include <dbents.h>
#include <dbmain.h>
#include <dbsymtb.h>

#include <algorithm>
#include <cctype>
#include <chrono>
#include <cstdint>
#include <cstdlib>
#include <ctime>
#include <filesystem>
#include <iomanip>
#include <map>
#include <memory>
#include <optional>
#include <sstream>
#include <stdexcept>
#include <string>
#include <system_error>
#include <utility>
#include <vector>

namespace {

using cadweb::CandidateStateHint;
using cadweb::ChangeCandidateKind;
using cadweb::FullSnapshotReason;

std::string utf8(const ACHAR* value) {
  return value ? AcString(value).utf8Str() : std::string{};
}

std::string handleOf(AcDbObjectId id) {
  if (id.isNull()) return {};
  ACHAR buffer[32] = {};
  if (!id.handle().getIntoAsciiBuffer(buffer)) return {};
  return utf8(buffer);
}

std::string handleOf(const AcDbObject* object) {
  if (!object) return {};
  AcDbHandle handle;
  object->getAcDbHandle(handle);
  ACHAR buffer[32] = {};
  if (!handle.getIntoAsciiBuffer(buffer)) return {};
  return utf8(buffer);
}

std::string canonicalCommand(const ACHAR* command) {
  std::string result = utf8(command);
  while (!result.empty() &&
         (result.front() == '_' || result.front() == '.' ||
          result.front() == '\'' ||
          std::isspace(static_cast<unsigned char>(result.front())))) {
    result.erase(result.begin());
  }
  std::transform(result.begin(), result.end(), result.begin(),
                 [](unsigned char value) {
                   return static_cast<char>(std::toupper(value));
                 });
  return result;
}

bool hasDwgExtension(const std::string& path) {
  if (path.size() < 4U) return false;
  std::string extension = path.substr(path.size() - 4U);
  std::transform(extension.begin(), extension.end(), extension.begin(),
                 [](unsigned char value) {
                   return static_cast<char>(std::tolower(value));
                 });
  return extension == ".dwg";
}

std::string databaseFingerprint(AcDbDatabase* database) {
  if (!database) return {};
  AcString value;
  return database->getFingerprintGuid(value) == Acad::eOk
             ? std::string(value.utf8Str())
             : std::string{};
}

std::string databaseVersionToken(AcDbDatabase* database) {
  if (!database) return {};
  AcString value;
  return database->getVersionGuid(value) == Acad::eOk
             ? std::string(value.utf8Str())
             : std::string{};
}

std::string utcTimestamp() {
  const auto now = std::chrono::system_clock::now();
  const std::time_t value = std::chrono::system_clock::to_time_t(now);
  std::tm utc{};
#ifdef _WIN32
  gmtime_s(&utc, &value);
#else
  gmtime_r(&value, &utc);
#endif
  std::ostringstream output;
  output << std::put_time(&utc, "%Y-%m-%dT%H:%M:%SZ");
  return output.str();
}

std::filesystem::path defaultSyncRoot() {
  if (const char* overrideRoot = std::getenv("CADWEB_SYNC_ROOT");
      overrideRoot && *overrideRoot) {
    return std::filesystem::path(overrideRoot);
  }
#ifdef _WIN32
  if (const char* localData = std::getenv("LOCALAPPDATA");
      localData && *localData) {
    return std::filesystem::path(localData) / "AcadStudio" / "CadWebSync";
  }
#else
  if (const char* userDirectory = std::getenv("HOME");
      userDirectory && *userDirectory) {
    return std::filesystem::path(userDirectory) / "Library" /
           "Application Support" / "AcadStudio" / "CadWebSync";
  }
#endif
  return {};
}

void printError(const char* prefix, const std::exception& error) {
  const AcString prefixText(prefix, AcString::Utf8);
  const AcString message(error.what(), AcString::Utf8);
  acutPrintf(L"\n[CadWeb Sync] %ls: %ls", prefixText.kwszPtr(),
             message.kwszPtr());
}

struct SaveObservation {
  std::string token;
  std::string artifactId;
  std::string intendedTarget;
  std::string actualTarget;
  cadweb::SaveProvenance provenance = cadweb::SaveProvenance::Unknown;
  cadweb::SaveClassification classification;
  std::string phase = "begun";
  bool generationFrozen = false;
};

struct DocumentState;

class DatabaseReactor final : public AcDbDatabaseReactor {
 public:
  explicit DatabaseReactor(DocumentState& state) : state_(state) {}

  void objectAppended(const AcDbDatabase*, const AcDbObject*) override;
  void objectUnAppended(const AcDbDatabase*, const AcDbObject*) override;
  void objectReAppended(const AcDbDatabase*, const AcDbObject*) override;
  void objectModified(const AcDbDatabase*, const AcDbObject*) override;
  void objectErased(const AcDbDatabase*, const AcDbObject*, bool) override;
  void headerSysVarChanged(const AcDbDatabase*, const ACHAR*, bool) override;
  void goodbye(const AcDbDatabase*) override;

 private:
  void record(const AcDbObject*, CandidateStateHint);

  DocumentState& state_;
};

struct DocumentState {
  AcApDocument* document = nullptr;
  AcDbDatabase* database = nullptr;
  std::uint64_t commandDocumentKey = 0U;
  cadweb::CadWebChangeTracker tracker;
  std::unique_ptr<DatabaseReactor> reactor;
  bool databaseAlive = true;
  std::size_t commandDepth = 0U;
  std::string outerCommand;
  bool namedAtCommandStart = false;
  std::optional<SaveObservation> save;
  std::optional<cadweb::DurableDocumentSyncState> durable;
  std::string durableStatus = "unbound";
};

ChangeCandidateKind candidateKind(const AcDbObject* object) {
  if (!object) return ChangeCandidateKind::Unknown;
  if (object->isKindOf(AcDbLayerTableRecord::desc())) {
    return ChangeCandidateKind::Layer;
  }
  if (object->isKindOf(AcDbBlockTableRecord::desc())) {
    return ChangeCandidateKind::BlockDefinition;
  }
  if (object->isKindOf(AcDbEntity::desc())) {
    return ChangeCandidateKind::Entity;
  }
  return ChangeCandidateKind::Unknown;
}

void DatabaseReactor::record(const AcDbObject* object,
                             CandidateStateHint stateHint) {
  if (!object) {
    state_.tracker.requireFullSnapshot(FullSnapshotReason::UnresolvedObject);
    return;
  }

  std::string sourceHandle = handleOf(object);
  std::string ownerHandle = handleOf(object->ownerId());
  ChangeCandidateKind kind = candidateKind(object);

  // Attributes are represented by their owning block-reference aggregate.
  if (object->isKindOf(AcDbAttribute::desc())) {
    if (ownerHandle.empty()) {
      state_.tracker.requireFullSnapshot(FullSnapshotReason::UnsupportedOwner);
      return;
    }
    sourceHandle = ownerHandle;
    ownerHandle.clear();
    kind = ChangeCandidateKind::Entity;
  }

  state_.tracker.recordCandidate(kind, std::move(sourceHandle),
                                 std::move(ownerHandle), stateHint);
}

void DatabaseReactor::objectAppended(const AcDbDatabase*,
                                     const AcDbObject* object) {
  record(object, CandidateStateHint::Present);
}

void DatabaseReactor::objectUnAppended(const AcDbDatabase*,
                                       const AcDbObject* object) {
  record(object, CandidateStateHint::Erased);
}

void DatabaseReactor::objectReAppended(const AcDbDatabase*,
                                       const AcDbObject* object) {
  record(object, CandidateStateHint::Present);
}

void DatabaseReactor::objectModified(const AcDbDatabase*,
                                     const AcDbObject* object) {
  record(object, CandidateStateHint::Present);
}

void DatabaseReactor::objectErased(const AcDbDatabase*,
                                   const AcDbObject* object, bool erased) {
  record(object, erased ? CandidateStateHint::Erased
                        : CandidateStateHint::Present);
}

void DatabaseReactor::headerSysVarChanged(const AcDbDatabase*, const ACHAR*,
                                          bool succeeded) {
  if (succeeded) {
    state_.tracker.requireFullSnapshot(FullSnapshotReason::UnsupportedMetadata);
  }
}

void DatabaseReactor::goodbye(const AcDbDatabase*) {
  // Do not remove the reactor here: the database is already in destruction.
  // documentToBeDestroyed is the normal detach boundary.
  state_.databaseAlive = false;
}

class SaveSyncManager final : public AcApDocManagerReactor,
                              public AcEditorReactor {
 public:
  void start();
  void stop();
  void printStatus();

  void documentCreated(AcApDocument* document) override;
  void documentToBeDestroyed(AcApDocument* document) override;
  void commandWillStart(const ACHAR* command) override;
  void commandEnded(const ACHAR*) override;
  void commandCancelled(const ACHAR*) override;
  void commandFailed(const ACHAR*) override;
  void beginSave(AcDbDatabase* database, const ACHAR* intendedName) override;
  void saveComplete(AcDbDatabase* database, const ACHAR* actualName) override;
  void abortSave(AcDbDatabase* database) override;

 private:
  void attach(AcApDocument* document);
  void detach(AcApDocument* document);
  DocumentState* stateFor(AcDbDatabase* database);
  DocumentState* stateForCommandDocument(std::uint64_t documentKey);
  DocumentState* currentState();
  void commandFinished(const ACHAR* command);
  cadweb::SaveProvenance saveProvenance(const DocumentState& state,
                                        const std::string& target) const;
  cadweb::SaveClassification classifySave(
      const DocumentState& state, cadweb::SaveProvenance provenance,
      const std::string& intendedTarget,
      const std::string& actualTarget = {}) const;
  std::string nextIdentifier(const char* prefix);
  cadweb::SavedFileEvidence savedEvidence(
      AcDbDatabase* database, const std::string& actualTarget) const;
  bool persist(DocumentState& state);
  bool applyJournalEvent(DocumentState& state,
                         cadweb::SaveJournalEvent event);
  void loadDurableState(DocumentState& state);
  void promotePendingOutbox(DocumentState& state);
  void processAcknowledgement(DocumentState& state);
  void cleanupAcknowledgedOutbox(DocumentState& state);
  void compactTerminalHistory(DocumentState& state);
  void captureAndSeal(DocumentState& state);
  void restoreFence(DocumentState& state);
  void releaseFence(DocumentState& state);

  bool started_ = false;
  std::uint64_t nextIdentifier_ = 1U;
  std::uint64_t nextCommandDocumentKey_ = 1U;
  cadweb::CadWebCommandRouter commandRouter_;
  std::unique_ptr<cadweb::CadWebDurableStore> store_;
  std::map<AcDbDatabase*, std::unique_ptr<DocumentState>> states_;
};

DocumentState* SaveSyncManager::stateFor(AcDbDatabase* database) {
  const auto found = states_.find(database);
  return found == states_.end() ? nullptr : found->second.get();
}

DocumentState* SaveSyncManager::stateForCommandDocument(
    std::uint64_t documentKey) {
  const auto found = std::find_if(
      states_.begin(), states_.end(),
      [documentKey](const auto& entry) {
        return entry.second->commandDocumentKey == documentKey;
      });
  return found == states_.end() ? nullptr : found->second.get();
}

DocumentState* SaveSyncManager::currentState() {
  if (!acDocManager) return nullptr;
  AcApDocument* document = acDocManager->curDocument();
  return document ? stateFor(document->database()) : nullptr;
}

std::string SaveSyncManager::nextIdentifier(const char* prefix) {
  const auto ticks = static_cast<unsigned long long>(
      std::chrono::system_clock::now().time_since_epoch().count());
  std::ostringstream value;
  value << prefix << '-' << std::hex << std::uppercase << ticks << '-'
        << nextIdentifier_++;
  return value.str();
}

cadweb::SavedFileEvidence SaveSyncManager::savedEvidence(
    AcDbDatabase* database, const std::string& actualTarget) const {
  cadweb::SavedFileEvidence evidence;
  evidence.actualTarget = actualTarget;
  evidence.sourceFingerprint = databaseFingerprint(database);
  evidence.dwgVersion =
      std::to_string(static_cast<int>(database->lastSavedAsVersion()));
  evidence.versionToken = databaseVersionToken(database);
  return evidence;
}

bool SaveSyncManager::persist(DocumentState& state) {
  if (!store_ || !state.durable) return false;
  try {
    store_->saveDocumentStateAtomically(*state.durable);
    return true;
  } catch (const std::exception& error) {
    state.tracker.requireFullSnapshot(FullSnapshotReason::JournalCrashGap);
    state.durableStatus = "journal-write-failed";
    printError("journal persistence failed", error);
    return false;
  }
}

bool SaveSyncManager::applyJournalEvent(DocumentState& state,
                                        cadweb::SaveJournalEvent event) {
  if (!state.durable) return false;
  const auto previous = state.durable->saveSync;
  auto reduced =
      cadweb::reduceSaveJournal(state.durable->saveSync, std::move(event));
  state.durable->saveSync = std::move(reduced.state);
  if (!reduced.accepted) {
    state.tracker.requireFullSnapshot(
        FullSnapshotReason::InvalidJournalTransition);
    state.durableStatus = reduced.error;
  }
  if (!persist(state)) {
    state.durable->saveSync = previous;
    return false;
  }
  return reduced.accepted;
}

void SaveSyncManager::promotePendingOutbox(DocumentState& state) {
  if (!store_ || !state.durable ||
      state.durable->pendingArtifactId.empty()) {
    return;
  }
  auto& durable = *state.durable;
  const auto found = std::find_if(
      durable.saveSync.outbox.begin(), durable.saveSync.outbox.end(),
      [&durable](const cadweb::OutboxItem& item) {
        return !item.acknowledged &&
               item.artifactId == durable.pendingArtifactId;
      });
  if (found == durable.saveSync.outbox.end()) {
    durable.saveSync.fallbackReasons.insert(
        FullSnapshotReason::MissingSealedOutbox);
    state.tracker.requireFullSnapshot(
        FullSnapshotReason::MissingSealedOutbox);
    state.durableStatus = "pending-index-without-outbox";
    persist(state);
    return;
  }
  try {
    store_->publishPreparedOutboxItem(*found);
  } catch (const std::exception& error) {
    durable.saveSync.fallbackReasons.insert(
        FullSnapshotReason::MissingSealedOutbox);
    state.tracker.requireFullSnapshot(
        FullSnapshotReason::MissingSealedOutbox);
    state.durableStatus = "sealed-item-not-promotable";
    persist(state);
    printError("sealed outbox recovery failed", error);
  }
}

void SaveSyncManager::cleanupAcknowledgedOutbox(DocumentState& state) {
  if (!store_ || !state.durable) return;
  auto& sync = state.durable->saveSync;
  bool changed = false;
  for (auto iterator = sync.outbox.begin(); iterator != sync.outbox.end();) {
    if (!iterator->acknowledged) {
      ++iterator;
      continue;
    }
    try {
      store_->removeAcknowledgedOutboxItem(*iterator);
      iterator = sync.outbox.erase(iterator);
      changed = true;
    } catch (const std::exception& error) {
      state.durableStatus = "acknowledged-cleanup-pending";
      printError("acknowledged outbox cleanup deferred", error);
      ++iterator;
    }
  }
  if (!changed) return;
  persist(state);
  compactTerminalHistory(state);
}

void SaveSyncManager::compactTerminalHistory(DocumentState& state) {
  if (!state.durable) return;
  const auto previousSize = state.durable->saveSync.journals.size();
  cadweb::compactSaveSyncHistory(state.durable->saveSync);
  if (state.durable->saveSync.journals.size() != previousSize) {
    persist(state);
  }
}

void SaveSyncManager::processAcknowledgement(DocumentState& state) {
  if (!store_ || !state.durable || !state.durable->pendingIndex ||
      state.durable->pendingArtifactId.empty()) {
    return;
  }
  promotePendingOutbox(state);
  auto& durable = *state.durable;
  const auto found = std::find_if(
      durable.saveSync.outbox.begin(), durable.saveSync.outbox.end(),
      [&durable](const cadweb::OutboxItem& item) {
        return !item.acknowledged &&
               item.artifactId == durable.pendingArtifactId;
      });
  if (found == durable.saveSync.outbox.end()) {
    state.tracker.requireFullSnapshot(
        FullSnapshotReason::MissingSealedOutbox);
    state.durableStatus = "pending-index-without-outbox";
    return;
  }
  try {
    const auto acknowledgement = store_->readAcknowledgement(*found);
    if (!acknowledgement) return;
    const auto previous = durable;
    auto nextIndex = cadweb::acknowledgeCadRevision(
        *durable.pendingIndex, acknowledgement->revision,
        acknowledgement->stateHash);
    auto reduced = cadweb::reduceSaveJournal(
        durable.saveSync,
        cadweb::AcknowledgePublishEvent{
            found->saveToken, found->artifactId, acknowledgement->revision,
            acknowledgement->stateHash});
    if (!reduced.accepted) {
      durable.saveSync = std::move(reduced.state);
      state.tracker.requireFullSnapshot(
          FullSnapshotReason::InvalidJournalTransition);
      state.durableStatus = reduced.error;
      persist(state);
      return;
    }
    durable.saveSync = std::move(reduced.state);
    durable.acknowledgedIndex = std::move(nextIndex);
    durable.pendingIndex.reset();
    durable.pendingArtifactId.clear();
    state.durableStatus = "server-acknowledged";
    if (persist(state)) {
      cleanupAcknowledgedOutbox(state);
    } else {
      durable = previous;
      state.durableStatus = "ack-journal-write-failed";
    }
  } catch (const std::exception& error) {
    state.tracker.requireFullSnapshot(
        FullSnapshotReason::InvalidJournalTransition);
    state.durableStatus = "ack-invalid";
    printError("acknowledgement rejected", error);
  }
}

void SaveSyncManager::loadDurableState(DocumentState& state) {
  if (!store_) {
    state.durableStatus = "storage-root-unavailable";
    return;
  }
  const auto fingerprint = databaseFingerprint(state.database);
  if (fingerprint.empty()) {
    state.durableStatus = "source-fingerprint-unavailable";
    return;
  }
  try {
    state.durable = store_->loadDocumentState(fingerprint);
    if (!state.durable) {
      const auto binding = store_->loadProvisionedBinding(fingerprint);
      if (binding) {
        cadweb::DurableDocumentSyncState initial;
        initial.binding = *binding;
        state.durable = std::move(initial);
        if (!persist(state)) return;
      }
    }
    if (!state.durable) {
      state.durableStatus = "unbound";
      return;
    }
    cleanupAcknowledgedOutbox(state);
    promotePendingOutbox(state);
    processAcknowledgement(state);
    cadweb::RecoveryContext context;
    context.requireTrustedBaseline =
        state.durable->acknowledgedIndex.has_value();
    if (state.durable->saveSync.acknowledgedBaseline ||
        !state.durable->saveSync.journals.empty()) {
      const std::string target =
          state.document->fileName() ? utf8(state.document->fileName())
                                     : std::string{};
      if (!target.empty()) {
        context.currentFileEvidence = savedEvidence(state.database, target);
      }
    }
    const auto recovery =
        cadweb::recoverSaveSync(state.durable->saveSync, context);
    switch (recovery.action) {
      case cadweb::RecoveryAction::Clean:
        state.durableStatus = state.durable->acknowledgedIndex
                                  ? "bound-clean"
                                  : "bound-initial-snapshot-required";
        break;
      case cadweb::RecoveryAction::ResumeUpload:
        state.durableStatus = "resume-upload";
        break;
      case cadweb::RecoveryAction::RequireRebind:
        state.durableStatus = "rebind-required";
        break;
      case cadweb::RecoveryAction::RequireFullSnapshot:
        if (recovery.reason) {
          state.tracker.requireFullSnapshot(*recovery.reason);
        }
        {
          std::vector<std::string> interruptedTokens;
          for (const auto& journal : state.durable->saveSync.journals) {
            if (journal.phase == cadweb::SaveJournalPhase::Begun ||
                journal.phase == cadweb::SaveJournalPhase::CapturePending) {
              interruptedTokens.push_back(journal.saveToken);
            }
          }
          for (const auto& token : interruptedTokens) {
            applyJournalEvent(state, cadweb::RequireRecoveryEvent{token});
          }
        }
        state.durableStatus = "full-snapshot-required";
        break;
    }
  } catch (const std::exception& error) {
    state.durable.reset();
    state.tracker.requireFullSnapshot(FullSnapshotReason::JournalCrashGap);
    state.durableStatus = "durable-state-invalid";
    printError("durable state load failed", error);
  }
}

void SaveSyncManager::attach(AcApDocument* document) {
  if (!document || !document->database() ||
      states_.count(document->database()) != 0U) {
    return;
  }
  auto state = std::make_unique<DocumentState>();
  state->document = document;
  state->database = document->database();
  state->commandDocumentKey = nextCommandDocumentKey_++;
  loadDurableState(*state);
  state->reactor = std::make_unique<DatabaseReactor>(*state);
  if (state->database->addReactor(state->reactor.get()) != Acad::eOk) {
    acutPrintf(L"\n[CadWeb Sync] Could not attach database reactor.");
    return;
  }
  states_.emplace(state->database, std::move(state));
}

void SaveSyncManager::detach(AcApDocument* document) {
  if (!document) return;
  const auto found = states_.find(document->database());
  if (found == states_.end()) return;
  auto& state = *found->second;
  commandRouter_.forgetDocument(state.commandDocumentKey);
  if (state.databaseAlive && state.database && state.reactor) {
    state.database->removeReactor(state.reactor.get());
  }
  states_.erase(found);
}

void SaveSyncManager::start() {
  if (started_ || !acDocManager || !acedEditor) return;
  const auto root = defaultSyncRoot();
  if (!root.empty()) {
    try {
      store_ = std::make_unique<cadweb::CadWebDurableStore>(root);
    } catch (const std::exception& error) {
      printError("durable store initialization failed", error);
    }
  }
  acDocManager->addReactor(this);
  acedEditor->addReactor(this);
  started_ = true;
  auto iterator = acDocManager->getDocumentIterator();
  while (iterator && !iterator->done()) {
    attach(iterator->document());
    iterator->step();
  }
}

void SaveSyncManager::stop() {
  if (!started_) return;
  if (acedEditor) acedEditor->removeReactor(this);
  if (acDocManager) acDocManager->removeReactor(this);
  for (auto& entry : states_) {
    auto& state = *entry.second;
    commandRouter_.forgetDocument(state.commandDocumentKey);
    if (state.databaseAlive && state.database && state.reactor) {
      state.database->removeReactor(state.reactor.get());
    }
  }
  states_.clear();
  store_.reset();
  started_ = false;
}

void SaveSyncManager::documentCreated(AcApDocument* document) {
  attach(document);
}

void SaveSyncManager::documentToBeDestroyed(AcApDocument* document) {
  detach(document);
}

void SaveSyncManager::commandWillStart(const ACHAR* command) {
  auto* state = currentState();
  if (!state) return;
  processAcknowledgement(*state);
  const auto name = canonicalCommand(command);
  state->commandDepth =
      commandRouter_.begin(state->commandDocumentKey, name);
  if (state->commandDepth == 1U) {
    state->outerCommand = name;
    state->namedAtCommandStart = state->document->isNamedDrawing();
  }
  if (cadweb::isUndoRedoCommand(name)) {
    state->tracker.requireFullSnapshot(FullSnapshotReason::UndoRedo);
  }
}

void SaveSyncManager::commandFinished(const ACHAR* command) {
  const auto route = commandRouter_.finish(canonicalCommand(command));
  if (!route) return;
  auto* state = stateForCommandDocument(route->documentKey);
  if (!state) return;
  state->commandDepth = route->documentDepth;
  if (state->commandDepth == 0U) {
    state->outerCommand.clear();
    state->namedAtCommandStart = false;
  }
}

void SaveSyncManager::commandEnded(const ACHAR* command) {
  commandFinished(command);
}
void SaveSyncManager::commandCancelled(const ACHAR* command) {
  commandFinished(command);
}
void SaveSyncManager::commandFailed(const ACHAR* command) {
  commandFinished(command);
}

cadweb::SaveProvenance SaveSyncManager::saveProvenance(
    const DocumentState& state, const std::string& target) const {
  std::string lowerTarget = target;
  std::transform(lowerTarget.begin(), lowerTarget.end(), lowerTarget.begin(),
                 [](unsigned char value) {
                   return static_cast<char>(std::tolower(value));
                 });
  if (lowerTarget.size() >= 4U &&
      lowerTarget.substr(lowerTarget.size() - 4U) == ".sv$") {
    return cadweb::SaveProvenance::AutoSave;
  }
  if (state.outerCommand == "QSAVE") {
    return state.namedAtCommandStart ? cadweb::SaveProvenance::QuickSave
                                     : cadweb::SaveProvenance::FirstSave;
  }
  if (state.outerCommand == "SAVEAS") {
    return state.namedAtCommandStart ? cadweb::SaveProvenance::SaveAs
                                     : cadweb::SaveProvenance::FirstSave;
  }
  if (state.outerCommand == "SAVE") {
    return cadweb::SaveProvenance::SaveCopy;
  }
  return cadweb::SaveProvenance::ApiDriven;
}

cadweb::SaveClassification SaveSyncManager::classifySave(
    const DocumentState& state, cadweb::SaveProvenance provenance,
    const std::string& intendedTarget,
    const std::string& actualTarget) const {
  const bool bound = state.durable.has_value();
  auto classification = cadweb::classifySave(
      {provenance, bound, intendedTarget, actualTarget});
  const std::string& target =
      actualTarget.empty() ? intendedTarget : actualTarget;
  if (bound && !state.durable->acknowledgedIndex && hasDwgExtension(target) &&
      (provenance == cadweb::SaveProvenance::QuickSave ||
       provenance == cadweb::SaveProvenance::FirstSave)) {
    classification = {cadweb::SaveDisposition::PublishInitialSnapshot,
                      cadweb::SaveIneligibilityReason::None};
  }
  return classification;
}

void SaveSyncManager::beginSave(AcDbDatabase* database,
                                const ACHAR* intendedName) {
  auto* state = stateFor(database);
  if (!state) return;
  if (!state->durable) loadDurableState(*state);
  processAcknowledgement(*state);
  compactTerminalHistory(*state);
  if (state->save && state->save->phase == "begun") {
    state->tracker.requireFullSnapshot(
        FullSnapshotReason::InvalidJournalTransition);
    return;
  }

  SaveObservation save;
  save.token = nextIdentifier("save");
  save.intendedTarget = utf8(intendedName);
  save.provenance = saveProvenance(*state, save.intendedTarget);
  save.classification =
      classifySave(*state, save.provenance, save.intendedTarget);
  state->save = std::move(save);

  if (state->durable &&
      std::any_of(state->durable->saveSync.journals.begin(),
                  state->durable->saveSync.journals.end(),
                  [](const cadweb::SaveJournalRecord& journal) {
                    return journal.phase ==
                           cadweb::SaveJournalPhase::RebindRequired;
                  })) {
    state->save->phase = "rebind-required";
    state->durableStatus = "rebind-required";
    return;
  }

  if (!state->durable) {
    if (hasDwgExtension(state->save->intendedTarget) &&
        (state->save->provenance == cadweb::SaveProvenance::QuickSave ||
         state->save->provenance == cadweb::SaveProvenance::FirstSave)) {
      state->save->phase = "capture-blocked-unbound";
      state->tracker.requireFullSnapshot(
          FullSnapshotReason::MissingTrustedBaseline);
    } else {
      state->save->phase = "ineligible";
    }
    return;
  }

  const auto baseRevision = state->durable->acknowledgedIndex
                                ? state->durable->acknowledgedIndex->revision
                                : 0U;
  const bool journaled = applyJournalEvent(
      *state,
      cadweb::BeginSaveEvent{state->save->token,
                             state->durable->binding.drawingId,
                             state->durable->binding.modelEpoch,
                             baseRevision,
                             state->save->intendedTarget,
                             state->save->classification});
  if (!journaled) {
    state->save->phase = "journal-failed";
    return;
  }

  if (state->save->classification.publishEligible() &&
      !state->tracker.frozen()) {
    state->tracker.freeze();
    state->save->generationFrozen = true;
  } else if (state->save->classification.disposition ==
             cadweb::SaveDisposition::RebindRequired) {
    state->save->phase = "rebind-required";
  } else if (!state->save->classification.publishEligible()) {
    state->save->phase = "ineligible";
  }
}

void SaveSyncManager::restoreFence(DocumentState& state) {
  if (state.save && state.save->generationFrozen && state.tracker.frozen()) {
    state.tracker.restoreFrozen();
    state.save->generationFrozen = false;
  }
}

void SaveSyncManager::releaseFence(DocumentState& state) {
  if (state.save && state.save->generationFrozen && state.tracker.frozen()) {
    state.tracker.releaseFrozen();
    state.save->generationFrozen = false;
  }
}

void SaveSyncManager::captureAndSeal(DocumentState& state) {
  if (!store_ || !state.durable || !state.save ||
      !state.save->generationFrozen || !state.tracker.frozen()) {
    throw std::runtime_error("eligible save has no durable capture fence");
  }
  auto& durable = *state.durable;
  if (cadweb::hasPendingAcknowledgement(durable.saveSync)) {
    state.tracker.requireFullSnapshot(
        FullSnapshotReason::PendingAcknowledgement);
    throw std::runtime_error("previous publish still awaits server ACK");
  }

  const auto baseRevision = durable.acknowledgedIndex
                                ? durable.acknowledgedIndex->revision
                                : 0U;
  const bool trackerFallback =
      state.tracker.frozen()->requiresFullSnapshot() ||
      durable.saveSync.requiresFullSnapshot();
  const bool writeSnapshot = !durable.acknowledgedIndex || trackerFallback;
  state.save->artifactId =
      nextIdentifier(writeSnapshot ? "snapshot" : "delta");

  cadweb::objectarx::SnapshotOptions options;
  options.syncBinding = cadweb::SyncBinding{
      durable.binding.drawingId, durable.binding.modelEpoch,
      state.save->artifactId, baseRevision};
  if (durable.acknowledgedIndex) {
    options.fixedOrigin = durable.acknowledgedIndex->origin;
  }
  cadweb::CadDocument captured =
      cadweb::objectarx::snapshotDatabase(state.database, options);
  if (captured.source.drawingFingerprint !=
      durable.binding.sourceFingerprint) {
    throw std::runtime_error(
        "saved drawing fingerprint changed; fork/rebind is required");
  }

  cadweb::CadRevisionIndex pendingIndex;
  std::optional<cadweb::CadDelta> delta;
  cadweb::OutboxArtifactKind artifactKind =
      cadweb::OutboxArtifactKind::Snapshot;
  if (!writeSnapshot) {
    auto plan = cadweb::planCadDelta(
        *durable.acknowledgedIndex, captured, state.save->artifactId,
        cadweb::DeltaTrigger{"qsave", utcTimestamp()});
    pendingIndex = std::move(plan.result);
    if (!plan.semanticChange()) {
      if (!applyJournalEvent(
              state,
              cadweb::VerifyNoopEvent{state.save->token,
                                      pendingIndex.stateHash})) {
        throw std::runtime_error("verified no-op journal commit failed");
      }
      state.save->phase = "verified-noop";
      state.durableStatus = "bound-clean";
      releaseFence(state);
      return;
    }
    delta = std::move(plan.delta);
    artifactKind = cadweb::OutboxArtifactKind::Delta;
  } else {
    pendingIndex = cadweb::planCadSnapshot(captured, baseRevision);
  }

  const auto captureRoot = store_->root() / "capture";
  std::error_code pathError;
  std::filesystem::create_directories(captureRoot, pathError);
  if (pathError) {
    throw std::runtime_error("cannot create local capture directory");
  }
  const auto prepared =
      captureRoot /
      (state.save->artifactId +
       (artifactKind == cadweb::OutboxArtifactKind::Delta
            ? ".cadwebdelta"
            : ".cadweb"));
  if (delta) {
    cadweb::CadDeltaWriter{}.writeAtomically(*delta, prepared);
  } else {
    cadweb::CadWebWriter{}.writeAtomically(captured, prepared);
  }

  cadweb::OutboxItem item;
  item.saveToken = state.save->token;
  item.artifactKind = artifactKind;
  item.artifactId = state.save->artifactId;
  item.drawingId = durable.binding.drawingId;
  item.modelEpoch = durable.binding.modelEpoch;
  item.writerSessionId = durable.binding.writerSessionId;
  item.baseRevision = baseRevision;
  item.resultStateHash = pendingIndex.stateHash;
  auto preparedItem = store_->prepareOutboxItem(std::move(item), prepared);
  std::filesystem::remove(prepared, pathError);

  const auto previousSync = durable.saveSync;
  const auto previousPendingIndex = durable.pendingIndex;
  const auto previousPendingArtifactId = durable.pendingArtifactId;
  auto reduced = cadweb::reduceSaveJournal(
      durable.saveSync,
      cadweb::SealPublishEvent{state.save->token, preparedItem});
  durable.saveSync = std::move(reduced.state);
  if (!reduced.accepted) {
    persist(state);
    throw std::runtime_error(reduced.error);
  }
  durable.pendingIndex = std::move(pendingIndex);
  durable.pendingArtifactId = preparedItem.artifactId;
  if (!persist(state)) {
    durable.saveSync = previousSync;
    durable.pendingIndex = previousPendingIndex;
    durable.pendingArtifactId = previousPendingArtifactId;
    throw std::runtime_error("sealed outbox journal commit failed");
  }
  state.save->phase = "sealed-publish-required";
  releaseFence(state);
  try {
    store_->publishPreparedOutboxItem(preparedItem);
    state.durableStatus = "pending-upload";
  } catch (const std::exception& error) {
    // The sealed journal is authoritative and can promote .staged after a
    // restart. Never roll the successful Save back to an earlier generation.
    state.durableStatus = "staged-awaiting-promotion";
    printError("ready marker publish deferred", error);
  }
}

void SaveSyncManager::saveComplete(AcDbDatabase* database,
                                   const ACHAR* actualName) {
  auto* state = stateFor(database);
  if (!state || !state->save) {
    if (state) state->tracker.requireFullSnapshot(
        FullSnapshotReason::InvalidJournalTransition);
    return;
  }

  auto& save = *state->save;
  save.actualTarget = utf8(actualName);
  if (save.phase != "begun") return;
  if (!state->durable) {
    save.phase = "capture-blocked-unbound";
    restoreFence(*state);
    return;
  }

  save.classification = classifySave(*state, save.provenance,
                                     save.intendedTarget, save.actualTarget);
  if (save.classification.disposition ==
      cadweb::SaveDisposition::RebindRequired) {
    applyJournalEvent(*state, cadweb::RequireRebindEvent{save.token});
    save.phase = "rebind-required";
    restoreFence(*state);
    return;
  }
  if (!save.classification.publishEligible()) {
    applyJournalEvent(*state, cadweb::MarkIneligibleEvent{save.token});
    save.phase = "ineligible";
    restoreFence(*state);
    return;
  }
  if (databaseFingerprint(database) !=
      state->durable->binding.sourceFingerprint) {
    applyJournalEvent(*state, cadweb::RequireRebindEvent{save.token});
    save.phase = "rebind-required";
    restoreFence(*state);
    return;
  }

  try {
    if (!applyJournalEvent(
            *state,
            cadweb::SaveCompletedEvent{
                save.token, savedEvidence(database, save.actualTarget)})) {
      throw std::runtime_error("save-complete journal commit failed");
    }
    captureAndSeal(*state);
  } catch (const std::exception& error) {
    save.phase = "capture-failed-full-snapshot-required";
    state->tracker.requireFullSnapshot(FullSnapshotReason::JournalCrashGap);
    if (state->durable) {
      const auto interrupted = std::find_if(
          state->durable->saveSync.journals.begin(),
          state->durable->saveSync.journals.end(),
          [&save](const cadweb::SaveJournalRecord& journal) {
            return journal.saveToken == save.token &&
                   (journal.phase == cadweb::SaveJournalPhase::Begun ||
                    journal.phase ==
                        cadweb::SaveJournalPhase::CapturePending);
          });
      if (interrupted != state->durable->saveSync.journals.end()) {
        applyJournalEvent(*state,
                          cadweb::RequireRecoveryEvent{save.token});
      }
    }
    restoreFence(*state);
    printError("post-save capture failed", error);
  }
}

void SaveSyncManager::abortSave(AcDbDatabase* database) {
  auto* state = stateFor(database);
  if (!state || !state->save) {
    if (state) state->tracker.requireFullSnapshot(
        FullSnapshotReason::InvalidJournalTransition);
    return;
  }
  if (state->save->phase != "begun") return;
  if (state->durable) {
    applyJournalEvent(*state, cadweb::AbortSaveEvent{state->save->token});
  }
  state->save->phase = "aborted";
  restoreFence(*state);
}

void SaveSyncManager::printStatus() {
  if (!acDocManager || !acDocManager->curDocument()) {
    acutPrintf(L"\n[CadWeb Sync] No current document.");
    return;
  }
  AcDbDatabase* database = acDocManager->curDocument()->database();
  const auto found = states_.find(database);
  if (found == states_.end()) {
    acutPrintf(L"\n[CadWeb Sync] Current document is not tracked.");
    return;
  }
  auto& state = *found->second;
  processAcknowledgement(state);
  const auto frozenCount = state.tracker.frozen()
                               ? state.tracker.frozen()->candidates.size()
                               : 0U;
  const auto phase = state.save ? state.save->phase : std::string("idle");
  const AcString phaseText(phase.c_str(), AcString::Utf8);
  const AcString durableText(state.durableStatus.c_str(), AcString::Utf8);
  const auto baseRevision = state.durable && state.durable->acknowledgedIndex
                                ? state.durable->acknowledgedIndex->revision
                                : 0U;
  const auto pendingCount = state.durable
                                ? static_cast<unsigned long long>(std::count_if(
                                      state.durable->saveSync.outbox.begin(),
                                      state.durable->saveSync.outbox.end(),
                                      [](const cadweb::OutboxItem& item) {
                                        return !item.acknowledged;
                                      }))
                                : 0ULL;
  acutPrintf(L"\n[CadWeb Sync] bound=%ls; base revision=%llu; "
             L"active candidates=%llu; frozen=%llu; pending outbox=%llu; "
             L"save=%ls; status=%ls.",
             state.durable ? L"yes" : L"no",
             static_cast<unsigned long long>(baseRevision),
             static_cast<unsigned long long>(
                 state.tracker.active().candidates.size()),
             static_cast<unsigned long long>(frozenCount),
             pendingCount, phaseText.kwszPtr(), durableText.kwszPtr());
  const auto printReasons = [](const auto& reasons) {
    for (const auto reason : reasons) {
      const AcString reasonText(cadweb::fullSnapshotReasonName(reason),
                                AcString::Utf8);
      acutPrintf(L"\n[CadWeb Sync] full-snapshot reason: %ls",
                 reasonText.kwszPtr());
    }
  };
  printReasons(state.tracker.active().fallbackReasons);
  if (state.tracker.frozen()) {
    printReasons(state.tracker.frozen()->fallbackReasons);
  }
  if (state.durable) {
    printReasons(state.durable->saveSync.fallbackReasons);
  }
}

SaveSyncManager& manager() {
  static SaveSyncManager instance;
  return instance;
}

}  // namespace

void cadWebRegisterSaveSync() { manager().start(); }
void cadWebUnregisterSaveSync() { manager().stop(); }
void cadWebPrintSyncStatus() { manager().printStatus(); }

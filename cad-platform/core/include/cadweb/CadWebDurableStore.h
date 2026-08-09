#pragma once

#include "cadweb/CadWebLimits.h"
#include "cadweb/CadWebOutbox.h"
#include "cadweb/CadWebRevisionPlanner.h"

#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <optional>
#include <string>
#include <vector>

namespace cadweb {

struct ProvisionedWriterBinding {
  std::string drawingId;
  std::string sourceFingerprint;
  std::string modelEpoch;
  std::string writerSessionId;
};

// Durable aggregate owned by one source drawing fingerprint. The pending index
// is stored before a ready item becomes visible so an ACK received after a
// process restart can still advance the exact semantic baseline.
struct DurableDocumentSyncState {
  ProvisionedWriterBinding binding;
  SaveSyncState saveSync;
  std::optional<CadRevisionIndex> acknowledgedIndex;
  std::optional<CadRevisionIndex> pendingIndex;
  std::string pendingArtifactId;
};

struct DurableOutboxLimits {
  std::size_t maxReadyItems = 64U;
  std::uint64_t maxPayloadBytes = limits::kMaxArchiveBytes;
  std::uint64_t maxTotalReadyBytes = 512U * 1024U * 1024U;
};

struct SealedOutboxItem {
  OutboxItem item;
  std::filesystem::path readyDirectory;
  std::filesystem::path manifestPath;
  std::filesystem::path payloadPath;
};

struct DurableAcknowledgement {
  std::string artifactId;
  std::string saveToken;
  std::uint64_t revision = 0U;
  std::string stateHash;
};

class CadWebDurableStore {
 public:
  explicit CadWebDurableStore(
      std::filesystem::path root,
      DurableOutboxLimits limits = DurableOutboxLimits{});

  const std::filesystem::path& root() const noexcept { return root_; }

  // Binding manifests are the narrow handoff from the binding service/daemon.
  // They do not contain a trusted revision index; only base-revision-zero
  // provisioning is accepted for a new local state.
  void writeProvisionedBindingAtomically(
      const ProvisionedWriterBinding& binding) const;
  std::optional<ProvisionedWriterBinding> loadProvisionedBinding(
      const std::string& sourceFingerprint) const;

  void saveDocumentStateAtomically(
      const DurableDocumentSyncState& state) const;
  std::optional<DurableDocumentSyncState> loadDocumentState(
      const std::string& sourceFingerprint) const;

  // Step 1 copies a completed package into <artifactId>.staged, verifies
  // size/SHA-256, and fsyncs item.json + payload. The returned item may be
  // committed to sealed-publish-required state, but is not visible to pollers.
  OutboxItem prepareOutboxItem(
      OutboxItem item,
      const std::filesystem::path& preparedPayload) const;

  // Step 2 runs only after the sealed journal + pending semantic index are
  // durable. It atomically renames .staged to .ready. Calling it again is
  // idempotent and also resumes a crash between journal commit and visibility.
  SealedOutboxItem publishPreparedOutboxItem(const OutboxItem& item) const;

  std::vector<std::filesystem::path> listReadyItemDirectories() const;
  std::optional<DurableAcknowledgement> readAcknowledgement(
      const OutboxItem& item) const;

  // Call only after the ACK transition and new baseline are durable. Removal
  // is idempotent; an acknowledged state can retry cleanup after a crash.
  void removeAcknowledgedOutboxItem(const OutboxItem& item) const;

 private:
  std::filesystem::path bindingPath(
      const std::string& sourceFingerprint) const;
  std::filesystem::path statePath(
      const std::string& sourceFingerprint) const;

  std::filesystem::path root_;
  DurableOutboxLimits limits_;
};

}  // namespace cadweb

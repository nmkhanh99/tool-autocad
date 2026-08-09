#pragma once

#include "cadweb/CadDelta.h"

#include <cstdint>
#include <map>
#include <optional>
#include <string>

namespace cadweb {

// Semantic index for one server-acknowledged full snapshot. It deliberately
// stores hashes rather than ObjectARX identities or pointers, so it can cross
// the save callback boundary and be persisted by the host adapter.
struct CadRevisionIndex {
  std::string drawingId;
  std::string sourceFingerprint;
  std::string modelEpoch;
  std::uint64_t revision = 0U;
  Units units;
  Vec3 origin;
  bool modelEmpty = false;
  Extents3 resultExtents;
  std::map<std::string, std::string> objectHashes;
  std::string stateHash;
};

struct CadDeltaPlan {
  std::optional<CadDelta> delta;
  CadRevisionIndex result;

  bool semanticChange() const noexcept { return delta.has_value(); }
};

// Builds a canonical semantic index from a full revision-bound snapshot. The
// revision is the authoritative server revision represented by the snapshot,
// not a client-authored next revision.
CadRevisionIndex indexCadRevision(const CadDocument& snapshot,
                                  std::uint64_t revision);

// Builds the semantic result for a writer snapshot before the server assigns
// its new revision. baseRevision may be zero for an initial snapshot; the
// returned index is promoted only through acknowledgeCadRevision().
CadRevisionIndex planCadSnapshot(const CadDocument& snapshot,
                                 std::uint64_t baseRevision);

// Diffs a full canonical capture against an ACKed index. A no-op returns no
// delta. Metadata that requires a new model epoch is rejected rather than
// silently encoded as an entity delta.
CadDeltaPlan planCadDelta(const CadRevisionIndex& baseline,
                          const CadDocument& captured,
                          std::string changeSetId,
                          DeltaTrigger trigger);

// Promotes a planned semantic state only after the server has durably accepted
// it at exactly baseRevision + 1. A skipped revision or mismatching state hash
// is never trusted as the next baseline.
CadRevisionIndex acknowledgeCadRevision(CadRevisionIndex planned,
                                        std::uint64_t serverRevision,
                                        const std::string& serverStateHash);

}  // namespace cadweb

#pragma once

#include "cadweb/CadDocument.h"

#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace cadweb {

enum class CadObjectKind : std::uint8_t {
  Entity = 1,
  Block = 2,
  Layer = 3,
};

// Converts an AutoCAD handle to the wire representation: uppercase hexadecimal,
// without 0x or leading zeroes. Invalid or zero handles throw
// std::invalid_argument.
std::string normalizeSourceHandle(std::string_view sourceHandle);
std::string canonicalObjectKey(CadObjectKind kind,
                               std::string_view sourceHandle);
bool isCanonicalObjectKey(std::string_view objectKey);

struct DeltaTrigger {
  std::string kind;
  std::string savedAt;
};

struct CadDelta {
  std::string changeSetId;
  std::string drawingId;
  std::string sourceFingerprint;
  std::string modelEpoch;
  std::uint64_t baseRevision = 0U;
  DeltaTrigger trigger;

  bool modelEmpty = false;
  Extents3 resultExtents;

  std::vector<Entity> entityUpserts;
  std::vector<BlockDefinition> blockUpserts;
  std::vector<Layer> layerUpserts;
  std::vector<std::string> tombstones;
};

struct StateObjectHash {
  std::string objectKey;
  std::string contentSha256;
};

// Canonical per-object hashes use the same deterministic encoders as delta
// payloads. Block child/attribute traversal order does not affect the result.
StateObjectHash computeObjectContentHash(const Entity& entity);
StateObjectHash computeObjectContentHash(const BlockDefinition& block);
StateObjectHash computeObjectContentHash(const Layer& layer);

// Hashes semantic revision state, not ZIP bytes. The canonical input is framed
// binary data containing drawing/model identity, metadata, and object hashes
// sorted by object key.
std::string computeStateHash(
    std::string_view drawingId, std::string_view modelEpoch, bool modelEmpty,
    const Extents3& resultExtents,
    const std::vector<StateObjectHash>& objectHashes);

}  // namespace cadweb

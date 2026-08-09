#include "cadweb/CadWebRevisionPlanner.h"

#include <algorithm>
#include <cmath>
#include <functional>
#include <limits>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace cadweb {
namespace {

constexpr std::uint64_t kMaxJsonSafeInteger = 9007199254740991ULL;
constexpr std::size_t kMaxBlockDependencyDepth = 32U;

void require(bool condition, const std::string& message) {
  if (!condition) {
    throw std::invalid_argument(message);
  }
}

bool sameDouble(double left, double right) {
  return left == right && (left != 0.0 || std::signbit(left) == std::signbit(right));
}

bool sameVec3(const Vec3& left, const Vec3& right) {
  return sameDouble(left.x, right.x) && sameDouble(left.y, right.y) &&
         sameDouble(left.z, right.z);
}

bool sameUnits(const Units& left, const Units& right) {
  if (left.name != right.name ||
      left.metersPerUnit.has_value() != right.metersPerUnit.has_value()) {
    return false;
  }
  return !left.metersPerUnit ||
         sameDouble(*left.metersPerUnit, *right.metersPerUnit);
}

struct IndexedObjects {
  std::map<std::string, std::string> hashes;
  std::vector<StateObjectHash> stateHashes;
};

IndexedObjects indexObjects(const CadDocument& snapshot) {
  IndexedObjects result;
  const auto append = [&result](StateObjectHash object) {
    require(result.hashes.emplace(object.objectKey, object.contentSha256).second,
            "snapshot contains duplicate canonical object key: " +
                object.objectKey);
    result.stateHashes.push_back(std::move(object));
  };
  for (const auto& entity : snapshot.entities) {
    append(computeObjectContentHash(entity));
  }
  for (const auto& block : snapshot.blocks) {
    append(computeObjectContentHash(block));
  }
  for (const auto& layer : snapshot.layers) {
    append(computeObjectContentHash(layer));
  }
  return result;
}

std::pair<std::string, std::string> bindingIdentity(
    const CadDocument& snapshot) {
  require(!(snapshot.syncBinding && snapshot.checkpointBinding),
          "snapshot cannot contain both sync and checkpoint bindings");
  if (snapshot.syncBinding) {
    return {snapshot.syncBinding->drawingId, snapshot.syncBinding->modelEpoch};
  }
  if (snapshot.checkpointBinding) {
    return {snapshot.checkpointBinding->drawingId,
            snapshot.checkpointBinding->modelEpoch};
  }
  throw std::invalid_argument(
      "revision planning requires a revision-bound full snapshot");
}

void validateSnapshotMetadata(const CadDocument& snapshot) {
  require(!snapshot.source.drawingFingerprint.empty(),
          "revision snapshot source fingerprint is required");
  require(snapshot.modelEmpty == snapshot.entities.empty(),
          "snapshot modelEmpty must match top-level entity count");
  require(std::isfinite(snapshot.origin.x) && std::isfinite(snapshot.origin.y) &&
              std::isfinite(snapshot.origin.z),
          "snapshot origin must be finite");
}

void validateBlockDependencies(const CadDocument& snapshot) {
  std::map<std::string, std::vector<std::string>> graph;
  for (const auto& block : snapshot.blocks) {
    require(graph.emplace(block.id, std::vector<std::string>{}).second,
            "snapshot contains duplicate block key: " + block.id);
  }

  const auto appendReferences = [&graph](const std::vector<Entity>& entities,
                                         std::vector<std::string>* references) {
    for (const auto& entity : entities) {
      if (entity.kind != EntityKind::BlockReference) continue;
      require(graph.count(entity.blockDefinitionId) != 0U,
              "snapshot contains dangling block reference: " + entity.id +
                  " -> " + entity.blockDefinitionId);
      if (references) references->push_back(entity.blockDefinitionId);
    }
  };
  appendReferences(snapshot.entities, nullptr);
  for (const auto& block : snapshot.blocks) {
    auto& references = graph.at(block.id);
    appendReferences(block.entities, &references);
    std::sort(references.begin(), references.end());
    references.erase(std::unique(references.begin(), references.end()),
                     references.end());
  }

  // 0 = unvisited, 1 = active DFS path, 2 = fully visited. The path-depth
  // guard bounds recursion before following the next nested definition.
  std::map<std::string, std::uint8_t> states;
  std::map<std::string, std::size_t> longestTails;
  std::function<std::size_t(const std::string&, std::size_t)> visit =
      [&](const std::string& blockId, std::size_t pathDepth) -> std::size_t {
    require(pathDepth <= kMaxBlockDependencyDepth,
            "block dependency depth exceeds 32 at: " + blockId);
    const auto state = states[blockId];
    require(state != 1U, "block dependency cycle includes: " + blockId);
    if (state == 2U) {
      const auto tail = longestTails.at(blockId);
      require(tail <= kMaxBlockDependencyDepth - (pathDepth - 1U),
              "block dependency depth exceeds 32 at: " + blockId);
      return tail;
    }

    states[blockId] = 1U;
    std::size_t longestTail = 1U;
    for (const auto& referencedId : graph.at(blockId)) {
      longestTail = std::max(
          longestTail, 1U + visit(referencedId, pathDepth + 1U));
    }
    states[blockId] = 2U;
    longestTails[blockId] = longestTail;
    return longestTail;
  };
  for (const auto& item : graph) {
    static_cast<void>(visit(item.first, 1U));
  }
}

template <typename Value>
std::map<std::string, const Value*> byId(const std::vector<Value>& values) {
  std::map<std::string, const Value*> result;
  for (const auto& value : values) {
    require(result.emplace(value.id, &value).second,
            "snapshot contains duplicate root object key: " + value.id);
  }
  return result;
}

}  // namespace

CadRevisionIndex planCadSnapshot(const CadDocument& snapshot,
                                 std::uint64_t baseRevision) {
  require(baseRevision <= kMaxJsonSafeInteger,
          "snapshot base revision must be a JSON-safe integer");
  validateSnapshotMetadata(snapshot);
  validateBlockDependencies(snapshot);
  const auto identity = bindingIdentity(snapshot);
  require(!identity.first.empty() && !identity.second.empty(),
          "revision snapshot binding identity is incomplete");

  auto objects = indexObjects(snapshot);
  CadRevisionIndex result;
  result.drawingId = identity.first;
  result.sourceFingerprint = snapshot.source.drawingFingerprint;
  result.modelEpoch = identity.second;
  result.revision = baseRevision;
  result.units = snapshot.units;
  result.origin = snapshot.origin;
  result.modelEmpty = snapshot.modelEmpty;
  result.resultExtents = snapshot.extents;
  result.objectHashes = std::move(objects.hashes);
  result.stateHash = computeStateHash(
      result.drawingId, result.modelEpoch, result.modelEmpty,
      result.resultExtents, objects.stateHashes);
  return result;
}

CadRevisionIndex indexCadRevision(const CadDocument& snapshot,
                                  std::uint64_t revision) {
  require(revision > 0U,
          "indexed revision must be a positive JSON-safe integer");
  return planCadSnapshot(snapshot, revision);
}

CadDeltaPlan planCadDelta(const CadRevisionIndex& baseline,
                          const CadDocument& captured,
                          std::string changeSetId,
                          DeltaTrigger trigger) {
  require(baseline.revision > 0U &&
              baseline.revision <= kMaxJsonSafeInteger,
          "delta baseline revision must be a positive JSON-safe integer");
  validateSnapshotMetadata(captured);
  validateBlockDependencies(captured);
  const auto identity = bindingIdentity(captured);
  require(identity.first == baseline.drawingId,
          "captured snapshot drawing binding does not match baseline");
  require(identity.second == baseline.modelEpoch,
          "captured snapshot model epoch does not match baseline");
  require(captured.source.drawingFingerprint == baseline.sourceFingerprint,
          "captured source fingerprint does not match baseline");
  require(sameVec3(captured.origin, baseline.origin),
          "captured origin changed within a model epoch");
  require(sameUnits(captured.units, baseline.units),
          "captured units changed within a model epoch");

  auto currentObjects = indexObjects(captured);
  CadRevisionIndex result;
  result.drawingId = baseline.drawingId;
  result.sourceFingerprint = baseline.sourceFingerprint;
  result.modelEpoch = baseline.modelEpoch;
  result.revision = baseline.revision;
  result.units = captured.units;
  result.origin = captured.origin;
  result.modelEmpty = captured.modelEmpty;
  result.resultExtents = captured.extents;
  result.objectHashes = currentObjects.hashes;
  result.stateHash = computeStateHash(
      result.drawingId, result.modelEpoch, result.modelEmpty,
      result.resultExtents, currentObjects.stateHashes);

  if (result.stateHash == baseline.stateHash) {
    require(result.objectHashes == baseline.objectHashes,
            "state hash collision or inconsistent baseline index");
    return {std::nullopt, std::move(result)};
  }

  const auto entities = byId(captured.entities);
  const auto blocks = byId(captured.blocks);
  const auto layers = byId(captured.layers);
  CadDelta delta;
  delta.changeSetId = std::move(changeSetId);
  delta.drawingId = baseline.drawingId;
  delta.sourceFingerprint = baseline.sourceFingerprint;
  delta.modelEpoch = baseline.modelEpoch;
  delta.baseRevision = baseline.revision;
  delta.trigger = std::move(trigger);
  delta.modelEmpty = captured.modelEmpty;
  delta.resultExtents = captured.extents;

  for (const auto& object : result.objectHashes) {
    const auto previous = baseline.objectHashes.find(object.first);
    if (previous != baseline.objectHashes.end() &&
        previous->second == object.second) {
      continue;
    }
    if (const auto entity = entities.find(object.first);
        entity != entities.end()) {
      delta.entityUpserts.push_back(*entity->second);
    } else if (const auto block = blocks.find(object.first);
               block != blocks.end()) {
      delta.blockUpserts.push_back(*block->second);
    } else if (const auto layer = layers.find(object.first);
               layer != layers.end()) {
      delta.layerUpserts.push_back(*layer->second);
    } else {
      throw std::invalid_argument(
          "indexed object has no matching captured root: " + object.first);
    }
  }
  for (const auto& object : baseline.objectHashes) {
    if (result.objectHashes.count(object.first) == 0U) {
      delta.tombstones.push_back(object.first);
    }
  }

  const auto operationCount = delta.entityUpserts.size() +
                              delta.blockUpserts.size() +
                              delta.layerUpserts.size() +
                              delta.tombstones.size();
  require(operationCount != 0U,
          "revision metadata changed without a canonical object change");
  return {std::move(delta), std::move(result)};
}

CadRevisionIndex acknowledgeCadRevision(CadRevisionIndex planned,
                                        std::uint64_t serverRevision,
                                        const std::string& serverStateHash) {
  require(planned.revision < kMaxJsonSafeInteger &&
              serverRevision == planned.revision + 1U,
          "server revision must be exactly the next planned revision");
  require(!serverStateHash.empty() && serverStateHash == planned.stateHash,
          "server state hash does not match the planned semantic state");
  planned.revision = serverRevision;
  return planned;
}

}  // namespace cadweb

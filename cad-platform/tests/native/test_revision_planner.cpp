#include "cadweb/CadDeltaWriter.h"
#include "cadweb/CadWebRevisionPlanner.h"

#include <algorithm>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {

void expect(bool condition, const std::string& message) {
  if (!condition) {
    throw std::runtime_error(message);
  }
}

cadweb::Entity line(const std::string& handle,
                    cadweb::SpaceKind space = cadweb::SpaceKind::Model) {
  cadweb::Entity entity;
  entity.id = "entity:" + handle;
  entity.sourceHandle = handle;
  entity.kind = cadweb::EntityKind::Line;
  entity.layerId = "layer:1";
  entity.space = space;
  entity.points = {{0.0, 0.0, 0.0}, {10.0, 5.0, 0.0}};
  entity.style.linetype = "Continuous";
  return entity;
}

cadweb::Entity blockReference(
    const std::string& handle, const std::string& definitionId,
    cadweb::SpaceKind space = cadweb::SpaceKind::BlockDefinition) {
  cadweb::Entity entity;
  entity.id = "entity:" + handle;
  entity.sourceHandle = handle;
  entity.kind = cadweb::EntityKind::BlockReference;
  entity.layerId = "layer:1";
  entity.space = space;
  entity.blockDefinitionId = definitionId;
  entity.transform = cadweb::Matrix4::identity();
  return entity;
}

cadweb::CadDocument snapshot() {
  cadweb::CadDocument document;
  document.producer = {"AutoCAD", "2027", "0.2.0", "macos-arm64"};
  document.source = {"factory.dwg", "AC1038", "fingerprint-a"};
  document.units = {"millimeters", 0.001};
  document.origin = {0.0, 0.0, 0.0};
  document.extents = {{0.0, 0.0, 0.0}, {10.0, 5.0, 0.0}};
  document.syncBinding =
      cadweb::SyncBinding{"drawing-a", "epoch-a", "snapshot-a", 0U};

  cadweb::Layer layer;
  layer.id = "layer:1";
  layer.sourceHandle = "1";
  layer.name = "Geometry";
  layer.linetype = "Continuous";
  document.layers.push_back(layer);
  document.entities.push_back(line("A"));

  cadweb::BlockDefinition block;
  block.id = "block:20";
  block.sourceHandle = "20";
  block.name = "Pump";
  block.entities.push_back(
      line("B", cadweb::SpaceKind::BlockDefinition));
  document.blocks.push_back(block);
  return document;
}

cadweb::CadDocument nestedBlockSnapshot() {
  auto document = snapshot();
  document.blocks.clear();

  cadweb::BlockDefinition leaf;
  leaf.id = "block:30";
  leaf.sourceHandle = "30";
  leaf.name = "Leaf";
  leaf.entities.push_back(
      line("D", cadweb::SpaceKind::BlockDefinition));

  cadweb::BlockDefinition parent;
  parent.id = "block:20";
  parent.sourceHandle = "20";
  parent.name = "Parent";
  auto nested = blockReference("B", leaf.id);
  nested.transform->values[3] = 5.0;
  parent.entities.push_back(std::move(nested));

  auto topLevel = blockReference(
      "C", parent.id, cadweb::SpaceKind::Model);
  topLevel.transform->values[3] = 20.0;
  document.entities.push_back(std::move(topLevel));
  document.blocks = {std::move(parent), std::move(leaf)};
  document.extents.max.x = 35.0;
  return document;
}

cadweb::CadDocument blockChainSnapshot(std::size_t count) {
  auto document = snapshot();
  document.blocks.clear();
  for (std::size_t index = 0U; index < count; ++index) {
    const auto handle = std::to_string(100U + index);
    cadweb::BlockDefinition block;
    block.id = "block:" + handle;
    block.sourceHandle = handle;
    block.name = "Depth" + handle;
    if (index + 1U == count) {
      block.entities.push_back(line(
          std::to_string(1000U + index),
          cadweb::SpaceKind::BlockDefinition));
    } else {
      block.entities.push_back(blockReference(
          std::to_string(1000U + index),
          "block:" + std::to_string(101U + index)));
    }
    document.blocks.push_back(std::move(block));
  }
  document.entities.push_back(blockReference(
      "F0", "block:100", cadweb::SpaceKind::Model));
  return document;
}

cadweb::CadDeltaPlan plan(const cadweb::CadRevisionIndex& baseline,
                          const cadweb::CadDocument& captured) {
  return cadweb::planCadDelta(
      baseline, captured, "change-128",
      cadweb::DeltaTrigger{"qsave", "2026-08-09T12:00:00Z"});
}

template <typename Function>
void expectRejects(Function function, const std::string& message) {
  bool rejected = false;
  try {
    function();
  } catch (const std::invalid_argument&) {
    rejected = true;
  }
  expect(rejected, message);
}

void testNoopAndTraversalIndependence() {
  auto document = snapshot();
  const auto baseline = cadweb::indexCadRevision(document, 127U);
  const auto noChange = plan(baseline, document);
  expect(!noChange.semanticChange() &&
             noChange.result.stateHash == baseline.stateHash,
         "unchanged full capture must plan a verified no-op");

  std::reverse(document.layers.begin(), document.layers.end());
  std::reverse(document.entities.begin(), document.entities.end());
  std::reverse(document.blocks.begin(), document.blocks.end());
  std::reverse(document.blocks.front().entities.begin(),
               document.blocks.front().entities.end());
  const auto reordered = cadweb::indexCadRevision(document, 127U);
  expect(reordered.stateHash == baseline.stateHash &&
             reordered.objectHashes == baseline.objectHashes,
         "revision index must be independent of snapshot traversal order");
}

void testPendingSnapshotUsesBaseUntilServerAck() {
  const auto document = snapshot();
  const auto initial = cadweb::planCadSnapshot(document, 0U);
  expect(initial.revision == 0U && !initial.stateHash.empty() &&
             !initial.objectHashes.empty(),
         "initial snapshot plan should retain base zero without inventing a revision");
  const auto acknowledged = cadweb::acknowledgeCadRevision(
      initial, 1U, initial.stateHash);
  expect(acknowledged.revision == 1U,
         "server ACK should assign the initial snapshot revision");
  expectRejects(
      [&initial] {
        static_cast<void>(cadweb::acknowledgeCadRevision(
            initial, 2U, initial.stateHash));
      },
      "server ACK must not skip the next planned revision");

  auto recoveryDocument = document;
  recoveryDocument.syncBinding->baseRevision = 127U;
  const auto recovery = cadweb::planCadSnapshot(recoveryDocument, 127U);
  expect(recovery.revision == 127U,
         "recovery snapshot plan should retain its CAS base until ACK");
}

void testEntityLayerAndBlockDiffs() {
  const auto original = snapshot();
  const auto baseline = cadweb::indexCadRevision(original, 127U);

  auto moved = original;
  moved.entities.front().points[1].x = 15.0;
  moved.extents.max.x = 15.0;
  auto movedPlan = plan(baseline, moved);
  expect(movedPlan.delta && movedPlan.delta->entityUpserts.size() == 1U &&
             movedPlan.delta->blockUpserts.empty() &&
             movedPlan.delta->layerUpserts.empty() &&
             movedPlan.delta->tombstones.empty(),
         "entity geometry change must produce one entity upsert");
  static_cast<void>(cadweb::CadDeltaWriter{}.build(*movedPlan.delta));

  auto sourceModeChanged = original;
  sourceModeChanged.entities.front().style.colorSourceMode =
      cadweb::PropertySourceMode::ByLayer;
  auto sourceModePlan = plan(baseline, sourceModeChanged);
  expect(sourceModePlan.delta &&
             sourceModePlan.delta->entityUpserts.size() == 1U &&
             sourceModePlan.delta->blockUpserts.empty() &&
             sourceModePlan.delta->layerUpserts.empty(),
         "source-mode-only change must produce one entity upsert");

  auto layerChanged = original;
  layerChanged.layers.front().colorArgb = 0xffff0000U;
  auto layerPlan = plan(baseline, layerChanged);
  expect(layerPlan.delta && layerPlan.delta->layerUpserts.size() == 1U &&
             layerPlan.delta->entityUpserts.empty(),
         "layer semantic change must produce one layer upsert");

  auto blockChanged = original;
  blockChanged.blocks.front().entities.front().points[1].y = 8.0;
  auto blockPlan = plan(baseline, blockChanged);
  expect(blockPlan.delta && blockPlan.delta->blockUpserts.size() == 1U &&
             blockPlan.delta->entityUpserts.empty(),
         "block child change must upsert its aggregate definition");
}

void testNestedBlockChangeCommitsRecomputedWcsExtents() {
  const auto original = nestedBlockSnapshot();
  const auto baseline = cadweb::indexCadRevision(original, 127U);

  auto changed = original;
  changed.blocks[1].entities.front().points[1].x = 20.0;
  // The revision-bound adapter full-captures every top-level occurrence with
  // getGeomExtents(). The planner must commit that recomputed aggregate while
  // sending the changed definition once, not duplicating instance geometry.
  changed.extents.max.x = 45.0;
  const auto changedPlan = plan(baseline, changed);
  expect(changedPlan.delta &&
             changedPlan.delta->blockUpserts.size() == 1U &&
             changedPlan.delta->blockUpserts.front().id == "block:30" &&
             changedPlan.delta->entityUpserts.empty() &&
             changedPlan.delta->resultExtents.max.x == 45.0 &&
             changedPlan.result.resultExtents.max.x == 45.0,
         "nested definition change must commit recomputed top-level WCS extents");
  static_cast<void>(cadweb::CadDeltaWriter{}.build(*changedPlan.delta));
}

void testBlockDependencyCycleAndDepthFailClosed() {
  auto cycle = snapshot();
  cycle.blocks.clear();
  cadweb::BlockDefinition left;
  left.id = "block:20";
  left.sourceHandle = "20";
  left.name = "Left";
  left.entities.push_back(blockReference("B", "block:30"));
  cadweb::BlockDefinition right;
  right.id = "block:30";
  right.sourceHandle = "30";
  right.name = "Right";
  right.entities.push_back(blockReference("C", "block:20"));
  cycle.blocks = {std::move(left), std::move(right)};
  expectRejects(
      [&] { static_cast<void>(cadweb::indexCadRevision(cycle, 127U)); },
      "block dependency cycle must fail before revision planning");

  static_cast<void>(cadweb::indexCadRevision(blockChainSnapshot(32U), 127U));
  expectRejects(
      [&] {
        static_cast<void>(
            cadweb::indexCadRevision(blockChainSnapshot(33U), 127U));
      },
      "block dependency depth beyond 32 must fail before revision planning");
}

void testDeleteLastEntityAndAck() {
  const auto original = snapshot();
  const auto baseline = cadweb::indexCadRevision(original, 127U);
  auto erased = original;
  erased.entities.clear();
  erased.modelEmpty = true;
  erased.extents = {};
  auto erasedPlan = plan(baseline, erased);
  expect(erasedPlan.delta && erasedPlan.delta->modelEmpty &&
             erasedPlan.delta->tombstones.size() == 1U &&
             erasedPlan.delta->tombstones.front() == "entity:A",
         "deleting the final drawable must emit its tombstone and empty model");
  static_cast<void>(cadweb::CadDeltaWriter{}.build(*erasedPlan.delta));

  const auto acknowledged = cadweb::acknowledgeCadRevision(
      erasedPlan.result, 128U, erasedPlan.result.stateHash);
  expect(acknowledged.revision == 128U,
         "matching server ACK must advance the semantic baseline");
  expectRejects(
      [&erasedPlan] {
        static_cast<void>(cadweb::acknowledgeCadRevision(
            erasedPlan.result, 128U, "wrong-state"));
      },
      "mismatching server state hash must not become trusted baseline");
}

void testFailClosedMetadataAndDerivedExtents() {
  const auto original = snapshot();
  const auto baseline = cadweb::indexCadRevision(original, 127U);

  auto wrongEpoch = original;
  wrongEpoch.syncBinding->modelEpoch = "epoch-b";
  expectRejects([&] { static_cast<void>(plan(baseline, wrongEpoch)); },
                "model epoch mismatch must require snapshot recovery");

  auto wrongFingerprint = original;
  wrongFingerprint.source.drawingFingerprint = "fingerprint-b";
  expectRejects([&] { static_cast<void>(plan(baseline, wrongFingerprint)); },
                "source fingerprint mismatch must require rebind/recovery");

  auto changedUnits = original;
  changedUnits.units.metersPerUnit = 1.0;
  expectRejects([&] { static_cast<void>(plan(baseline, changedUnits)); },
                "unit changes cannot be hidden inside an entity delta");

  auto extentsOnly = original;
  extentsOnly.extents.max.x = 99.0;
  expectRejects([&] { static_cast<void>(plan(baseline, extentsOnly)); },
                "derived extents cannot change without an object change");
}

}  // namespace

int main() {
  try {
    testNoopAndTraversalIndependence();
    testPendingSnapshotUsesBaseUntilServerAck();
    testEntityLayerAndBlockDiffs();
    testNestedBlockChangeCommitsRecomputedWcsExtents();
    testBlockDependencyCycleAndDepthFailClosed();
    testDeleteLastEntityAndAck();
    testFailClosedMetadataAndDerivedExtents();
    std::cout << "cadweb revision planner tests passed\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "cadweb revision planner tests failed: " << error.what()
              << '\n';
    return 1;
  }
}

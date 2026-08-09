#include "cadweb/CadDeltaWriter.h"
#include "cadweb/CadWebWriter.h"
#include "cadweb/CadWebLimits.h"

#include "detail/ProducerLimits.h"
#include "detail/Sha256.h"
#include "geometry_generated.h"

#include <algorithm>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <limits>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace {

using Bytes = std::vector<std::uint8_t>;

void expect(bool condition, const std::string& message) {
  if (!condition) {
    throw std::runtime_error(message);
  }
}

std::uint16_t read16(const Bytes& bytes, std::size_t offset) {
  expect(offset + 2U <= bytes.size(), "truncated ZIP uint16");
  return static_cast<std::uint16_t>(bytes[offset]) |
         (static_cast<std::uint16_t>(bytes[offset + 1U]) << 8U);
}

std::uint32_t read32(const Bytes& bytes, std::size_t offset) {
  expect(offset + 4U <= bytes.size(), "truncated ZIP uint32");
  return static_cast<std::uint32_t>(bytes[offset]) |
         (static_cast<std::uint32_t>(bytes[offset + 1U]) << 8U) |
         (static_cast<std::uint32_t>(bytes[offset + 2U]) << 16U) |
         (static_cast<std::uint32_t>(bytes[offset + 3U]) << 24U);
}

std::uint32_t crc32(const Bytes& bytes) {
  std::uint32_t crc = 0xffffffffU;
  for (const auto byte : bytes) {
    crc ^= byte;
    for (int bit = 0; bit < 8; ++bit) {
      const auto mask = static_cast<std::uint32_t>(
          -static_cast<std::int32_t>(crc & 1U));
      crc = (crc >> 1U) ^ (0xedb88320U & mask);
    }
  }
  return ~crc;
}

std::map<std::string, Bytes> parseZipStore(const Bytes& archive) {
  std::map<std::string, Bytes> entries;
  std::size_t offset = 0U;
  while (offset + 4U <= archive.size() &&
         read32(archive, offset) == 0x04034b50U) {
    expect(read16(archive, offset + 6U) == 0x0800U,
           "ZIP entry must use only the UTF-8 flag");
    expect(read16(archive, offset + 8U) == 0U,
           "ZIP entry must use the store method");
    const auto expectedCrc = read32(archive, offset + 14U);
    const auto compressedSize = read32(archive, offset + 18U);
    const auto uncompressedSize = read32(archive, offset + 22U);
    expect(compressedSize == uncompressedSize,
           "stored ZIP entry sizes must match");
    const auto nameSize = read16(archive, offset + 26U);
    const auto extraSize = read16(archive, offset + 28U);
    const auto nameOffset = offset + 30U;
    const auto dataOffset = nameOffset + nameSize + extraSize;
    expect(dataOffset + compressedSize <= archive.size(),
           "truncated ZIP entry");

    const std::string name(archive.begin() +
                               static_cast<std::ptrdiff_t>(nameOffset),
                           archive.begin() + static_cast<std::ptrdiff_t>(
                                                 nameOffset + nameSize));
    Bytes payload(archive.begin() + static_cast<std::ptrdiff_t>(dataOffset),
                  archive.begin() + static_cast<std::ptrdiff_t>(
                                        dataOffset + compressedSize));
    expect(crc32(payload) == expectedCrc, "ZIP CRC mismatch for " + name);
    expect(entries.emplace(name, std::move(payload)).second,
           "duplicate ZIP entry: " + name);
    offset = dataOffset + compressedSize;
  }

  expect(read32(archive, offset) == 0x02014b50U,
         "ZIP central directory is missing");
  expect(archive.size() >= 22U, "ZIP end record is missing");
  const auto endOffset = archive.size() - 22U;
  expect(read32(archive, endOffset) == 0x06054b50U,
         "ZIP end record signature is invalid");
  expect(read16(archive, endOffset + 8U) == entries.size() &&
             read16(archive, endOffset + 10U) == entries.size(),
         "ZIP entry count is inconsistent");
  expect(read16(archive, endOffset + 20U) == 0U,
         "deterministic ZIP must not have a comment");
  return entries;
}

std::string asString(const Bytes& bytes) {
  return std::string(bytes.begin(), bytes.end());
}

void assertDescriptor(const std::string& manifest, const std::string& path,
                      const Bytes& bytes);

cadweb::Entity line(std::string id, std::string layerId,
                    cadweb::SpaceKind space = cadweb::SpaceKind::Model) {
  cadweb::Entity entity;
  entity.id = std::move(id);
  entity.sourceHandle = "10";
  entity.kind = cadweb::EntityKind::Line;
  entity.layerId = std::move(layerId);
  entity.space = space;
  entity.points = {{0.0, 0.0, 0.0}, {12.0, 4.0, 0.0}};
  entity.style.linetype = "Continuous";
  entity.style.lineWeightMm = 0.25F;
  return entity;
}

cadweb::Entity blockReference(std::string id, std::string blockDefinitionId,
                              std::string layerId = "layer:0") {
  cadweb::Entity entity;
  entity.id = std::move(id);
  entity.sourceHandle = entity.id;
  entity.kind = cadweb::EntityKind::BlockReference;
  entity.layerId = std::move(layerId);
  entity.space = cadweb::SpaceKind::BlockDefinition;
  entity.blockDefinitionId = std::move(blockDefinitionId);
  entity.transform = cadweb::Matrix4::identity();
  return entity;
}

cadweb::CadDocument sampleDocument() {
  cadweb::CadDocument document;
  document.producer = {"AutoCAD", "2027", "0.1.0", "macos-arm64"};
  document.source = {"fixture.dwg", "AC1038", "fixture-drawing"};
  document.units = {"millimeters", 0.001};
  document.origin = {0.0, 0.0, 0.0};
  document.extents = {{0.0, 0.0, 0.0}, {100.0, 80.0, 10.0}};

  cadweb::Layer notes;
  notes.id = "layer:notes";
  notes.name = "Notes";
  notes.colorArgb = 0xff00ff00U;
  notes.linetype = "Continuous";
  cadweb::Layer geometry;
  geometry.id = "layer:0";
  geometry.name = "0";
  geometry.linetype = "Continuous";
  document.layers = {notes, geometry};

  auto lineEntity = line("fixture:20", "layer:0");
  lineEntity.style.colorSourceMode = cadweb::PropertySourceMode::ByLayer;

  cadweb::Entity polyline;
  polyline.id = "fixture:10";
  polyline.sourceHandle = "11";
  polyline.kind = cadweb::EntityKind::Polyline;
  polyline.layerId = "layer:0";
  polyline.points = {{0.0, 0.0, 0.0}, {5.0, 0.0, 0.0},
                     {5.0, 5.0, 0.0}};
  polyline.bulges = {0.0, 0.5, 0.0};
  polyline.startWidths = {0.0, 0.1, 0.0};
  polyline.endWidths = {0.1, 0.0, 0.0};
  polyline.closed = true;
  polyline.style.transparencySourceMode =
      cadweb::PropertySourceMode::ByBlock;

  cadweb::Entity arc;
  arc.id = "fixture:30";
  arc.sourceHandle = "12";
  arc.kind = cadweb::EntityKind::Arc;
  arc.layerId = "layer:0";
  arc.center = cadweb::Vec3{20.0, 20.0, 0.0};
  arc.normal = cadweb::Vec3{0.0, 0.0, 1.0};
  arc.radius = 4.0;
  arc.startAngle = 0.0;
  arc.endAngle = 1.5707963267948966;
  arc.style.lineWeightSourceMode = cadweb::PropertySourceMode::ByLayer;

  cadweb::Entity circle;
  circle.id = "fixture:40";
  circle.sourceHandle = "13";
  circle.kind = cadweb::EntityKind::Circle;
  circle.layerId = "layer:0";
  circle.center = cadweb::Vec3{30.0, 20.0, 0.0};
  circle.normal = cadweb::Vec3{0.0, 0.0, 1.0};
  circle.radius = 3.0;
  circle.style.linetypeSourceMode = cadweb::PropertySourceMode::ByBlock;

  cadweb::Entity text;
  text.id = "fixture:50";
  text.sourceHandle = "14";
  text.kind = cadweb::EntityKind::Text;
  text.layerId = "layer:notes";
  text.position = cadweb::Vec3{10.0, 30.0, 0.0};
  text.text = "CADWeb";
  text.height = 2.5;

  cadweb::Entity mtext = text;
  mtext.id = "fixture:60";
  mtext.sourceHandle = "15";
  mtext.kind = cadweb::EntityKind::MText;
  mtext.text = "Dòng 1\\PLine 2";
  mtext.position = cadweb::Vec3{10.0, 40.0, 0.0};

  cadweb::Entity reference;
  reference.id = "fixture:70";
  reference.sourceHandle = "16";
  reference.kind = cadweb::EntityKind::BlockReference;
  reference.layerId = "layer:0";
  reference.blockDefinitionId = "block:A";
  reference.transform = cadweb::Matrix4::identity();
  reference.transform->values[3] = 50.0;
  reference.attributes = {
      {"fixture:a2", "SECOND", "B", {51.0, 1.0, 0.0}, 0.0, 2.0},
      {"fixture:a1", "FIRST", "A", {50.0, 1.0, 0.0}, 0.0, 2.0},
  };

  document.entities = {reference, mtext, circle, polyline,
                       text, arc, lineEntity};

  cadweb::BlockDefinition block;
  block.id = "block:A";
  block.sourceHandle = "B0";
  block.name = "FixtureBlock";
  block.basePoint = {0.0, 0.0, 0.0};
  block.entities = {
      line("fixture:b1", "layer:0", cadweb::SpaceKind::BlockDefinition)};
  document.blocks = {block};

  document.unsupportedEntities = {
      {"AcDbHatch", "99", std::nullopt, "phase-1 entity kind"}};
  document.warnings = {"paper space omitted", "annotative scale omitted"};
  document.omittedSpaces = {"Layout2", "Layout1"};
  return document;
}

cadweb::CadDocument sampleSyncDocument() {
  cadweb::CadDocument document;
  document.producer = {"AutoCAD", "2027", "0.2.0", "macos-arm64"};
  document.source = {"factory.dwg", "AC1038", "fixture-fingerprint"};
  document.units = {"millimeters", 0.001};
  document.origin = {0.0, 0.0, 0.0};
  document.extents = {{0.0, 0.0, 0.0}, {12.0, 4.0, 0.0}};
  document.modelEmpty = false;
  document.syncBinding =
      cadweb::SyncBinding{"drawing-a", "epoch-a", "snapshot-a", 0U};

  cadweb::Layer layer;
  layer.id = "layer:1";
  layer.sourceHandle = "1";
  layer.name = "Geometry";
  layer.linetype = "Continuous";
  document.layers.push_back(layer);

  cadweb::Entity entity;
  entity.id = "entity:A";
  entity.sourceHandle = "A";
  entity.kind = cadweb::EntityKind::Line;
  entity.layerId = layer.id;
  entity.points = {{0.0, 0.0, 0.0}, {12.0, 4.0, 0.0}};
  entity.style.linetype = "Continuous";
  entity.style.colorSourceMode = cadweb::PropertySourceMode::ByLayer;
  entity.style.transparencySourceMode = cadweb::PropertySourceMode::ByBlock;
  entity.style.lineWeightSourceMode = cadweb::PropertySourceMode::Explicit;
  entity.style.linetypeSourceMode = cadweb::PropertySourceMode::ByLayer;
  document.entities.push_back(entity);
  return document;
}

cadweb::Entity deltaLine(
    const std::string& handle,
    cadweb::SpaceKind space = cadweb::SpaceKind::Model) {
  cadweb::Entity entity;
  entity.id = cadweb::canonicalObjectKey(cadweb::CadObjectKind::Entity,
                                         handle);
  entity.sourceHandle = cadweb::normalizeSourceHandle(handle);
  entity.kind = cadweb::EntityKind::Line;
  entity.layerId = "layer:1";
  entity.space = space;
  entity.points = {{0.0, 0.0, 0.0}, {12.0, 4.0, 0.0}};
  entity.style.linetype = "Continuous";
  entity.style.colorSourceMode = cadweb::PropertySourceMode::ByLayer;
  entity.style.transparencySourceMode = cadweb::PropertySourceMode::ByBlock;
  entity.style.lineWeightSourceMode = cadweb::PropertySourceMode::Explicit;
  entity.style.linetypeSourceMode = cadweb::PropertySourceMode::ByLayer;
  return entity;
}

cadweb::CadDelta sampleDelta() {
  cadweb::CadDelta delta;
  delta.changeSetId = "0198a5b0-example";
  delta.drawingId = "d91b-example";
  delta.sourceFingerprint = "fixture-fingerprint";
  delta.modelEpoch = "01-epoch";
  delta.baseRevision = 127U;
  delta.trigger = {"qsave", "2026-08-09T10:15:30Z"};
  delta.resultExtents = {{0.0, 0.0, 0.0}, {125.0, 80.0, 12.0}};

  cadweb::Layer layer;
  layer.id = "layer:1";
  layer.sourceHandle = "1";
  layer.name = "Geometry";
  layer.linetype = "Continuous";
  delta.layerUpserts.push_back(layer);

  auto firstLine = deltaLine("A");
  cadweb::Entity reference;
  reference.id = "entity:B";
  reference.sourceHandle = "B";
  reference.kind = cadweb::EntityKind::BlockReference;
  reference.layerId = "layer:1";
  reference.blockDefinitionId = "block:10";
  reference.transform = cadweb::Matrix4::identity();
  reference.attributes = {
      {"entity:D", "SECOND", "B", {1.0, 0.0, 0.0}, 0.0, 2.0},
      {"entity:C", "FIRST", "A", {0.0, 0.0, 0.0}, 0.0, 2.0},
  };
  delta.entityUpserts = {reference, firstLine};

  cadweb::BlockDefinition block;
  block.id = "block:10";
  block.sourceHandle = "10";
  block.name = "FixtureBlock";
  block.entities = {
      deltaLine("F", cadweb::SpaceKind::BlockDefinition),
      deltaLine("E", cadweb::SpaceKind::BlockDefinition),
  };
  delta.blockUpserts.push_back(block);
  delta.tombstones = {"layer:2", "entity:FF", "block:20"};
  return delta;
}

void expectDeltaRejects(const cadweb::CadDelta& delta,
                        const std::string& message) {
  bool rejected = false;
  try {
    static_cast<void>(cadweb::CadDeltaWriter{}.build(delta));
  } catch (const std::invalid_argument&) {
    rejected = true;
  }
  expect(rejected, message);
}

void testCanonicalDeltaKeys() {
  expect(cadweb::normalizeSourceHandle("0x00af") == "AF",
         "raw handles must normalize case, prefix, and leading zeroes");
  expect(cadweb::canonicalObjectKey(cadweb::CadObjectKind::Entity,
                                    "0X0054af") == "entity:54AF",
         "canonical entity key mismatch");
  expect(cadweb::isCanonicalObjectKey("entity:54AF") &&
             cadweb::isCanonicalObjectKey("block:A") &&
             cadweb::isCanonicalObjectKey("layer:1"),
         "canonical object key was rejected");
  for (const auto* invalid : {"entity:0", "entity:00AF", "entity:af",
                              "entity:0xAF", "attribute:AF", "entity:"}) {
    expect(!cadweb::isCanonicalObjectKey(invalid),
           std::string("non-canonical object key was accepted: ") + invalid);
  }
  for (const auto* invalid : {"", "0", "0x0", "GH"}) {
    bool rejected = false;
    try {
      static_cast<void>(cadweb::normalizeSourceHandle(invalid));
    } catch (const std::invalid_argument&) {
      rejected = true;
    }
    expect(rejected,
           std::string("invalid source handle was accepted: ") + invalid);
  }
}

void testDeltaArchiveAndDeterminism() {
  const cadweb::CadDeltaWriter writer;
  const auto delta = sampleDelta();
  const auto archive = writer.build(delta);
  {
    std::ofstream fixture("build/native-sample.cadwebdelta",
                          std::ios::binary | std::ios::trunc);
    fixture.write(reinterpret_cast<const char*>(archive.data()),
                  static_cast<std::streamsize>(archive.size()));
    expect(static_cast<bool>(fixture),
           "cannot write native delta sample archive");
  }

  auto reordered = delta;
  std::reverse(reordered.entityUpserts.front().attributes.begin(),
               reordered.entityUpserts.front().attributes.end());
  std::reverse(reordered.entityUpserts.begin(),
               reordered.entityUpserts.end());
  std::reverse(reordered.blockUpserts.front().entities.begin(),
               reordered.blockUpserts.front().entities.end());
  std::reverse(reordered.tombstones.begin(), reordered.tombstones.end());
  expect(archive == writer.build(reordered),
         "delta archive must be independent of DTO traversal order");

  const auto entries = parseZipStore(archive);
  expect(entries.size() == 6U, "full delta fixture must contain six entries");
  for (const auto* required : {"change.json", "entities.bin", "blocks.bin",
                               "layers.json", "tombstones.json",
                               "export-report.json"}) {
    expect(entries.count(required) == 1U,
           std::string("missing delta ZIP entry: ") + required);
  }

  const auto change = asString(entries.at("change.json"));
  expect(change.find("\"format\":\"cadweb-delta\"") !=
                 std::string::npos &&
             change.find("\"formatVersion\":{\"major\":1,\"minor\":1}") !=
                 std::string::npos &&
             change.find("\"baseRevision\":127") != std::string::npos &&
             change.find("\"modelEpoch\":\"01-epoch\"") !=
                 std::string::npos &&
             change.find("\"changeSetId\":\"0198a5b0-example\"") !=
                 std::string::npos,
         "delta envelope identity/revision fields are missing");
  expect(change.find("\"revision\":") == std::string::npos,
         "client delta must not contain an assigned revision");
  expect(change.find(
             "\"upserts\":{\"entities\":2,\"blocks\":1,\"layers\":1}") !=
                 std::string::npos &&
             change.find(
                 "\"deletes\":{\"entities\":1,\"blocks\":1,\"layers\":1}") !=
                 std::string::npos,
         "delta operation counts do not match payloads");
  for (const auto* payload : {"entities.bin", "blocks.bin", "layers.json",
                              "tombstones.json", "export-report.json"}) {
    assertDescriptor(change, payload, entries.at(payload));
  }

  const auto& entitiesBytes = entries.at("entities.bin");
  ::flatbuffers::Verifier entitiesVerifier(entitiesBytes.data(),
                                           entitiesBytes.size());
  expect(CadWeb::V1::VerifyGeometryBufferBuffer(entitiesVerifier),
         "delta entities.bin verification failed");
  const auto* entities = CadWeb::V1::GetGeometryBuffer(entitiesBytes.data());
  expect(entities->kind() == CadWeb::V1::BufferKind::Entities &&
             entities->entities() && entities->entities()->size() == 2U &&
             entities->entities()->Get(0)->id()->str() == "entity:A" &&
             entities->entities()->Get(1)->id()->str() == "entity:B",
         "delta entities must be sorted and counted by canonical key");
  expect(entities->entities()->Get(1)->attributes()->Get(0)->id()->str() ==
             "entity:C",
         "delta attributes must be sorted by canonical key");
  const auto* propertyModes = entities->entities()->Get(0);
  expect(propertyModes->colorSourceMode() ==
                 CadWeb::V1::PropertySourceMode::ByLayer &&
             propertyModes->transparencySourceMode() ==
                 CadWeb::V1::PropertySourceMode::ByBlock &&
             propertyModes->lineWeightSourceMode() ==
                 CadWeb::V1::PropertySourceMode::Explicit &&
             propertyModes->linetypeSourceMode() ==
                 CadWeb::V1::PropertySourceMode::ByLayer,
         "delta property source modes did not round-trip");

  const auto& blocksBytes = entries.at("blocks.bin");
  ::flatbuffers::Verifier blocksVerifier(blocksBytes.data(),
                                         blocksBytes.size());
  expect(CadWeb::V1::VerifyGeometryBufferBuffer(blocksVerifier),
         "delta blocks.bin verification failed");
  const auto* blocks = CadWeb::V1::GetGeometryBuffer(blocksBytes.data());
  expect(blocks->kind() == CadWeb::V1::BufferKind::Blocks &&
             blocks->blocks()->size() == 1U &&
             blocks->blocks()->Get(0)->entities()->Get(0)->id()->str() ==
                 "entity:E",
         "delta block children must be sorted by canonical key");

  const auto layers = asString(entries.at("layers.json"));
  expect(layers.find("\"id\":\"layer:1\",\"sourceHandle\":\"1\"") !=
             std::string::npos,
         "delta layer must carry its canonical source handle");
  expect(asString(entries.at("tombstones.json")) ==
             "{\"schemaVersion\":1,\"keys\":[\"block:20\",\"entity:FF\",\"layer:2\"]}\n",
         "tombstones must be sorted deterministically");

  auto deleteOnly = delta;
  deleteOnly.entityUpserts.clear();
  deleteOnly.blockUpserts.clear();
  deleteOnly.layerUpserts.clear();
  const auto deleteEntries = parseZipStore(writer.build(deleteOnly));
  expect(deleteEntries.size() == 3U &&
             deleteEntries.count("tombstones.json") == 1U &&
             deleteEntries.count("entities.bin") == 0U &&
             deleteEntries.count("blocks.bin") == 0U &&
             deleteEntries.count("layers.json") == 0U,
         "zero upsert counts must omit their payload descriptors/entries");

  auto upsertOnly = delta;
  upsertOnly.tombstones.clear();
  const auto upsertEntries = parseZipStore(writer.build(upsertOnly));
  expect(upsertEntries.count("tombstones.json") == 0U &&
             asString(upsertEntries.at("change.json"))
                     .find("\"tombstones\":") == std::string::npos,
         "zero delete counts must omit tombstone descriptor/entry");
}

void testDeltaValidationAndStateHashes() {
  expect(cadweb::computeObjectContentHash(
             sampleSyncDocument().entities.front()).contentSha256 ==
             "d8c85806c41abb017b996c08db9f583cb074f3aa305ec3b87f242b150edfada0",
         "non-default property source modes must keep the cross-language hash");

  auto invalid = sampleDelta();
  invalid.baseRevision = 0U;
  expectDeltaRejects(invalid, "baseRevision zero must be rejected");
  invalid = sampleDelta();
  invalid.baseRevision = 9007199254740992ULL;
  expectDeltaRejects(invalid,
                     "baseRevision outside the JSON-safe range must be rejected");

  invalid = sampleDelta();
  invalid.tombstones.push_back(invalid.entityUpserts.front().id);
  expectDeltaRejects(invalid,
                     "same canonical key in upsert/tombstone must be rejected");
  invalid = sampleDelta();
  invalid.tombstones.push_back(invalid.tombstones.front());
  expectDeltaRejects(invalid, "duplicate tombstone must be rejected");
  invalid = sampleDelta();
  invalid.entityUpserts.push_back(invalid.entityUpserts.front());
  expectDeltaRejects(invalid, "duplicate upsert must be rejected");
  invalid = sampleDelta();
  invalid.entityUpserts.front().id = "entity:00B";
  expectDeltaRejects(invalid, "non-canonical upsert key must be rejected");
  invalid = sampleDelta();
  invalid.entityUpserts.front().attributes.front().id = "attribute:D";
  expectDeltaRejects(invalid,
                     "attribute IDs must use the entity canonical namespace");
  invalid = sampleDelta();
  invalid.entityUpserts.front().style.colorSourceMode =
      static_cast<cadweb::PropertySourceMode>(3U);
  expectDeltaRejects(invalid,
                     "unknown property source mode must be rejected");

  invalid = sampleDelta();
  invalid.entityUpserts.clear();
  invalid.blockUpserts.clear();
  invalid.layerUpserts.clear();
  invalid.tombstones.clear();
  expectDeltaRejects(invalid, "empty no-op delta must be rejected");

  auto emptyModel = sampleDelta();
  emptyModel.entityUpserts.clear();
  emptyModel.modelEmpty = true;
  emptyModel.resultExtents = {};
  static_cast<void>(cadweb::CadDeltaWriter{}.build(emptyModel));
  invalid = emptyModel;
  invalid.resultExtents.max.x = 1.0;
  expectDeltaRejects(invalid,
                     "empty model must use the canonical zero extents");
  invalid = emptyModel;
  invalid.resultExtents.min.x = -0.0;
  expectDeltaRejects(invalid,
                     "empty model must reject negative-zero extents");
  invalid = emptyModel;
  invalid.entityUpserts.push_back(deltaLine("AA"));
  expectDeltaRejects(invalid,
                     "empty model cannot contain top-level entity upsert");

  auto entity = sampleDelta().entityUpserts.back();
  const auto entityHash = cadweb::computeObjectContentHash(entity);
  auto sourceModeOnly = entity;
  sourceModeOnly.style.colorSourceMode = cadweb::PropertySourceMode::ByBlock;
  expect(entityHash.contentSha256 !=
             cadweb::computeObjectContentHash(sourceModeOnly).contentSha256,
         "entity content hash must change when only source mode changes");
  entity.points[1].x += 1.0;
  expect(entityHash.contentSha256 !=
             cadweb::computeObjectContentHash(entity).contentSha256,
         "entity content hash must change with semantic geometry");

  auto block = sampleDelta().blockUpserts.front();
  const auto blockHash = cadweb::computeObjectContentHash(block);
  std::reverse(block.entities.begin(), block.entities.end());
  expect(blockHash.contentSha256 ==
             cadweb::computeObjectContentHash(block).contentSha256,
         "block content hash must ignore child traversal order");
  const auto layerHash =
      cadweb::computeObjectContentHash(sampleDelta().layerUpserts.front());

  std::vector<cadweb::StateObjectHash> objects{
      entityHash, blockHash, layerHash};
  const auto metadata = sampleDelta();
  const auto stateHash = cadweb::computeStateHash(
      metadata.drawingId, metadata.modelEpoch, metadata.modelEmpty,
      metadata.resultExtents, objects);
  std::reverse(objects.begin(), objects.end());
  expect(stateHash == cadweb::computeStateHash(
                          metadata.drawingId, metadata.modelEpoch,
                          metadata.modelEmpty, metadata.resultExtents, objects),
         "state hash must ignore object traversal order");
  objects.front().contentSha256[0] =
      objects.front().contentSha256[0] == '0' ? '1' : '0';
  expect(stateHash != cadweb::computeStateHash(
                          metadata.drawingId, metadata.modelEpoch,
                          metadata.modelEmpty, metadata.resultExtents, objects),
         "state hash must change with object content hash");

  bool stateRejected = false;
  try {
    auto duplicate = objects;
    duplicate.push_back(objects.front());
    static_cast<void>(cadweb::computeStateHash(
        metadata.drawingId, metadata.modelEpoch, metadata.modelEmpty,
        metadata.resultExtents, duplicate));
  } catch (const std::invalid_argument&) {
    stateRejected = true;
  }
  expect(stateRejected, "duplicate state object keys must be rejected");

  auto oversized = sampleDelta();
  oversized.changeSetId.assign(cadweb::limits::kMaxManifestBytes, 'a');
  bool sizeRejected = false;
  try {
    static_cast<void>(cadweb::CadDeltaWriter{}.build(oversized));
  } catch (const std::length_error&) {
    sizeRejected = true;
  }
  expect(sizeRejected, "change.json must enforce the 1 MiB envelope limit");
}

void expectWriterRejects(const cadweb::CadDocument& document,
                         const std::string& message) {
  bool rejected = false;
  try {
    static_cast<void>(cadweb::CadWebWriter{}.build(document));
  } catch (const std::invalid_argument&) {
    rejected = true;
  }
  expect(rejected, message);
}

void expectSizeRejected(
    const std::vector<cadweb::detail::ProducerEntrySize>& entries,
    const std::string& message) {
  bool rejected = false;
  try {
    cadweb::detail::validateProducerSizes(entries);
  } catch (const std::length_error&) {
    rejected = true;
  }
  expect(rejected, message);
}

void assertDescriptor(const std::string& manifest, const std::string& path,
                      const Bytes& bytes) {
  const auto pathMarker = "\"path\":\"" + path + "\"";
  const auto pathPosition = manifest.find(pathMarker);
  expect(pathPosition != std::string::npos,
         "manifest does not declare " + path);
  const auto expected = "\"size\":" + std::to_string(bytes.size()) +
                        ",\"sha256\":\"" +
                        cadweb::detail::sha256Hex(bytes) + "\"";
  expect(manifest.find(expected, pathPosition) != std::string::npos,
         "manifest size/hash mismatch for " + path);
}

void testRevisionBoundSnapshot() {
  const cadweb::CadWebWriter writer;
  const auto document = sampleSyncDocument();
  const auto entries = parseZipStore(writer.build(document));
  const auto manifest = asString(entries.at("manifest.json"));
  expect(manifest.find("\"formatVersion\":{\"major\":1,\"minor\":2}") !=
                 std::string::npos &&
             manifest.find("\"modelEmpty\":false") != std::string::npos &&
             manifest.find(
                 "\"syncBinding\":{\"drawingId\":\"drawing-a\","
                 "\"modelEpoch\":\"epoch-a\",\"snapshotId\":"
                 "\"snapshot-a\",\"baseRevision\":0}") !=
                 std::string::npos,
         "revision-bound snapshot must emit the CADWeb 1.2 sync envelope");
  expect(asString(entries.at("layers.json"))
                 .find("\"id\":\"layer:1\",\"sourceHandle\":\"1\"") !=
             std::string::npos,
         "revision-bound snapshot layer must carry a canonical source handle");

  const auto& entityBytes = entries.at("entities.bin");
  ::flatbuffers::Verifier verifier(entityBytes.data(), entityBytes.size());
  expect(CadWeb::V1::VerifyGeometryBufferBuffer(verifier),
         "revision-bound entities.bin verification failed");
  const auto* geometry = CadWeb::V1::GetGeometryBuffer(entityBytes.data());
  expect(geometry->entities() && geometry->entities()->size() == 1U &&
             geometry->entities()->Get(0)->id()->str() == "entity:A" &&
             geometry->entities()->Get(0)->sourceHandle()->str() == "A" &&
             geometry->entities()->Get(0)->colorSourceMode() ==
                 CadWeb::V1::PropertySourceMode::ByLayer &&
             geometry->entities()->Get(0)->transparencySourceMode() ==
                 CadWeb::V1::PropertySourceMode::ByBlock,
         "snapshot and delta must share the same canonical entity identity");

  auto checkpoint = document;
  checkpoint.syncBinding.reset();
  checkpoint.checkpointBinding = cadweb::CheckpointBinding{
      "drawing-a", "epoch-a", "checkpoint-128", 128U,
      std::string(64U, 'a')};
  const auto checkpointManifest = asString(
      parseZipStore(writer.build(checkpoint)).at("manifest.json"));
  expect(checkpointManifest.find("\"checkpointBinding\":") !=
                 std::string::npos &&
             checkpointManifest.find("\"revision\":128") !=
                 std::string::npos,
         "server checkpoint snapshot must emit its distinct binding");

  auto invalid = document;
  invalid.checkpointBinding = checkpoint.checkpointBinding;
  expectWriterRejects(invalid,
                      "snapshot cannot mix writer and checkpoint bindings");
  invalid = document;
  invalid.entities.front().id = "fixture:A";
  expectWriterRejects(invalid,
                      "revision-bound snapshot must reject legacy entity ids");
  invalid = document;
  invalid.modelEmpty = true;
  expectWriterRejects(invalid,
                      "snapshot modelEmpty must match its top-level entities");

  auto empty = document;
  empty.entities.clear();
  empty.extents = {};
  empty.modelEmpty = true;
  static_cast<void>(writer.build(empty));
  empty.extents.min.x = -0.0;
  expectWriterRejects(
      empty, "empty revision-bound snapshot must reject negative-zero extents");
}

void testSha256KnownVector() {
  const Bytes input{'a', 'b', 'c'};
  expect(cadweb::detail::sha256Hex(input) ==
             "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
         "SHA-256 known vector failed");
}

void testArchiveAndFlatBuffers() {
  const cadweb::CadWebWriter writer;
  const auto document = sampleDocument();
  const auto archive = writer.build(document);
  expect(archive.size() > 4U && archive[0] == 'P' && archive[1] == 'K',
         "archive must have a ZIP signature");
  {
    std::ofstream fixture("build/native-sample.cadweb",
                          std::ios::binary | std::ios::trunc);
    fixture.write(reinterpret_cast<const char*>(archive.data()),
                  static_cast<std::streamsize>(archive.size()));
    expect(static_cast<bool>(fixture), "cannot write native sample archive");
  }

  auto reordered = document;
  std::reverse(reordered.layers.begin(), reordered.layers.end());
  std::reverse(reordered.entities.begin(), reordered.entities.end());
  std::reverse(reordered.blocks.front().entities.begin(),
               reordered.blocks.front().entities.end());
  std::reverse(reordered.unsupportedEntities.begin(),
               reordered.unsupportedEntities.end());
  std::reverse(reordered.warnings.begin(), reordered.warnings.end());
  std::reverse(reordered.omittedSpaces.begin(), reordered.omittedSpaces.end());
  expect(archive == writer.build(reordered),
         "archive must be independent of DTO traversal order");

  const auto entries = parseZipStore(archive);
  expect(entries.size() == 5U, "block fixture must contain five ZIP entries");
  for (const auto* required : {"manifest.json", "layers.json", "entities.bin",
                               "blocks.bin", "export-report.json"}) {
    expect(entries.count(required) == 1U,
           std::string("missing ZIP entry: ") + required);
  }

  const auto manifest = asString(entries.at("manifest.json"));
  expect(manifest.find("\"formatVersion\":{\"major\":1,\"minor\":2}") !=
             std::string::npos,
         "manifest formatVersion is missing");
  for (const auto* payload : {"layers.json", "entities.bin", "blocks.bin",
                              "export-report.json"}) {
    assertDescriptor(manifest, payload, entries.at(payload));
  }

  const auto& entitiesBytes = entries.at("entities.bin");
  expect(CadWeb::V1::GeometryBufferBufferHasIdentifier(entitiesBytes.data()),
         "entities.bin identifier mismatch");
  ::flatbuffers::Verifier entitiesVerifier(entitiesBytes.data(),
                                           entitiesBytes.size());
  expect(CadWeb::V1::VerifyGeometryBufferBuffer(entitiesVerifier),
         "entities.bin verification failed");
  const auto* entities =
      CadWeb::V1::GetGeometryBuffer(entitiesBytes.data());
  expect(entities->schemaVersion() == 1U &&
             entities->kind() == CadWeb::V1::BufferKind::Entities,
         "entities.bin root metadata mismatch");
  expect(entities->entities() && entities->entities()->size() == 7U,
         "entities.bin entity count mismatch");
  expect(entities->entities()->Get(0)->id()->str() == "fixture:10" &&
             entities->entities()->Get(6)->id()->str() == "fixture:70",
         "entities.bin must be sorted by stable id");
  expect(entities->entities()->Get(0)->transparencySourceMode() ==
                 CadWeb::V1::PropertySourceMode::ByBlock &&
             entities->entities()->Get(1)->colorSourceMode() ==
                 CadWeb::V1::PropertySourceMode::ByLayer &&
             entities->entities()->Get(2)->lineWeightSourceMode() ==
                 CadWeb::V1::PropertySourceMode::ByLayer &&
             entities->entities()->Get(3)->linetypeSourceMode() ==
                 CadWeb::V1::PropertySourceMode::ByBlock,
         "all property source modes did not round-trip");
  const auto* blockReference = entities->entities()->Get(6);
  expect(blockReference->kind() == CadWeb::V1::EntityKind::BlockReference &&
             blockReference->attributes() &&
             blockReference->attributes()->size() == 2U &&
             blockReference->attributes()->Get(0)->id()->str() ==
                 "fixture:a1",
         "block reference attributes did not round-trip deterministically");

  const auto& blocksBytes = entries.at("blocks.bin");
  ::flatbuffers::Verifier blocksVerifier(blocksBytes.data(),
                                         blocksBytes.size());
  expect(CadWeb::V1::VerifyGeometryBufferBuffer(blocksVerifier),
         "blocks.bin verification failed");
  const auto* blocks = CadWeb::V1::GetGeometryBuffer(blocksBytes.data());
  expect(blocks->kind() == CadWeb::V1::BufferKind::Blocks &&
             blocks->blocks() && blocks->blocks()->size() == 1U &&
             blocks->blocks()->Get(0)->entities()->size() == 1U,
         "blocks.bin did not round-trip");

  expect(asString(entries.at("layers.json")).find(
             "\"id\":\"layer:0\"") <
             asString(entries.at("layers.json")).find(
                 "\"id\":\"layer:notes\""),
         "layers.json must be sorted by id");
  expect(asString(entries.at("layers.json")).find("\"plot\":true") !=
             std::string::npos,
         "layers.json must emit required plot state");
  const auto report = asString(entries.at("export-report.json"));
  expect(report.find("\"status\":\"partial\"") !=
             std::string::npos,
         "export report status mismatch");
  expect(report.find(
             "\"counts\":{\"exported\":8,\"skipped\":1,\"warnings\":5,\"errors\":0}") !=
             std::string::npos &&
             report.find("\"issues\":[") != std::string::npos,
         "export report counts/issues do not match the v1 contract");
}

void testOptionalBlocksAndUnitless() {
  auto document = sampleDocument();
  document.entities = {line("fixture:1", "layer:0")};
  document.blocks.clear();
  document.units = {"unitless", std::nullopt};
  document.unsupportedEntities.clear();
  document.warnings.clear();
  document.omittedSpaces.clear();

  const auto entries = parseZipStore(cadweb::CadWebWriter{}.build(document));
  expect(entries.count("blocks.bin") == 0U,
         "blocks.bin must be omitted when no definition/reference exists");
  expect(asString(entries.at("manifest.json"))
                 .find("\"metersPerUnit\":null") != std::string::npos,
         "unitless manifest must contain null metersPerUnit");
  expect(asString(entries.at("export-report.json"))
                 .find("\"status\":\"complete\"") != std::string::npos,
         "issue-free export report must be complete");

  document.entities.clear();
  document.failedEntities = {
      {"AcDbLine", "10", std::nullopt, "read failed"}};
  const auto failedEntries =
      parseZipStore(cadweb::CadWebWriter{}.build(document));
  const auto failedReport =
      asString(failedEntries.at("export-report.json"));
  expect(failedReport.find("\"status\":\"failed\"") != std::string::npos &&
             failedReport.find(
                 "\"counts\":{\"exported\":0,\"skipped\":1,\"warnings\":0,\"errors\":1}") !=
                 std::string::npos,
         "all-failed export report totals are invalid");
}

void testCanonicalProducerLimits() {
  using cadweb::detail::ProducerEntrySize;
  namespace limits = cadweb::limits;

  // These descriptors exercise the large boundaries without allocating their
  // payload bytes. An exact-boundary, reader-compatible layout must pass.
  cadweb::detail::validateProducerSizes({
      ProducerEntrySize{"manifest.json", limits::kMaxManifestBytes, true},
      ProducerEntrySize{"layers.json", limits::kMaxJsonPayloadBytes, true},
      ProducerEntrySize{"entities.bin", limits::kMaxEntryUncompressedBytes,
                        false},
  });

  auto maximumCount = std::vector<ProducerEntrySize>(
      limits::kMaxEntries, ProducerEntrySize{"e", 0U, false});
  cadweb::detail::validateProducerSizes(maximumCount);
  maximumCount.push_back(ProducerEntrySize{"e", 0U, false});
  expectSizeRejected(maximumCount, "129 ZIP entries must be rejected");

  expectSizeRejected(
      {ProducerEntrySize{"manifest.json", limits::kMaxManifestBytes + 1U,
                         true}},
      "manifest larger than 1 MiB must be rejected");
  expectSizeRejected(
      {ProducerEntrySize{"layers.json", limits::kMaxJsonPayloadBytes + 1U,
                         true}},
      "JSON payload larger than 16 MiB must be rejected");
  expectSizeRejected(
      {ProducerEntrySize{"entities.bin",
                         limits::kMaxEntryUncompressedBytes + 1U, false}},
      "entry larger than 128 MiB must be rejected");

  expectSizeRejected(
      {
          ProducerEntrySize{"a.bin", limits::kMaxEntryUncompressedBytes,
                            false},
          ProducerEntrySize{"b.bin", limits::kMaxEntryUncompressedBytes,
                            false},
      },
      "ZIP headers beyond a 256 MiB payload must exceed the archive limit");
  expectSizeRejected(
      {
          ProducerEntrySize{"a.bin", limits::kMaxEntryUncompressedBytes,
                            false},
          ProducerEntrySize{"b.bin", limits::kMaxEntryUncompressedBytes,
                            false},
          ProducerEntrySize{"c.bin", 1U, false},
      },
      "uncompressed payload total larger than 256 MiB must be rejected");

  // Exercise the actual writer wiring at a low-memory boundary. The manifest
  // adds structural JSON around this 1 MiB valid UTF-8 producer value.
  auto oversizedManifest = sampleDocument();
  oversizedManifest.producer.application.assign(limits::kMaxManifestBytes,
                                                  'a');
  bool writerRejected = false;
  try {
    static_cast<void>(cadweb::CadWebWriter{}.build(oversizedManifest));
  } catch (const std::length_error&) {
    writerRejected = true;
  }
  expect(writerRejected,
         "CadWebWriter::build must enforce the manifest size limit");
}

void testProducerReaderConsistency() {
  auto topLevelBlockSpace = sampleDocument();
  topLevelBlockSpace.entities.front().space =
      cadweb::SpaceKind::BlockDefinition;
  expectWriterRejects(topLevelBlockSpace,
                      "top-level BlockDefinition space must be rejected");

  for (const auto invalidSpace : {cadweb::SpaceKind::Model,
                                  cadweb::SpaceKind::Paper}) {
    auto blockChildSpace = sampleDocument();
    blockChildSpace.blocks.front().entities.front().space = invalidSpace;
    expectWriterRejects(blockChildSpace,
                        "block child outside BlockDefinition space must be rejected");
  }

  for (const auto textKind : {cadweb::EntityKind::Text,
                              cadweb::EntityKind::MText}) {
    auto zeroHeightText = sampleDocument();
    const auto found = std::find_if(
        zeroHeightText.entities.begin(), zeroHeightText.entities.end(),
        [textKind](const cadweb::Entity& entity) {
          return entity.kind == textKind;
        });
    expect(found != zeroHeightText.entities.end(),
           "sample text entity is missing");
    found->height = 0.0;
    expectWriterRejects(zeroHeightText,
                        "Text/MText with zero height must be rejected");
  }

  auto duplicateAttribute = sampleDocument();
  const auto reference = std::find_if(
      duplicateAttribute.entities.begin(), duplicateAttribute.entities.end(),
      [](const cadweb::Entity& entity) {
        return entity.kind == cadweb::EntityKind::BlockReference;
      });
  const auto text = std::find_if(
      duplicateAttribute.entities.begin(), duplicateAttribute.entities.end(),
      [](const cadweb::Entity& entity) {
        return entity.kind == cadweb::EntityKind::Text;
      });
  expect(reference != duplicateAttribute.entities.end() &&
             !reference->attributes.empty() &&
             text != duplicateAttribute.entities.end(),
         "sample entities for duplicate attribute test are missing");
  text->attributes.push_back(reference->attributes.front());
  expectWriterRejects(duplicateAttribute,
                      "attribute IDs must be unique across all entities");

  const std::vector<std::string> invalidUtf8{
      {static_cast<char>(0xc3), static_cast<char>(0x28)},
      {static_cast<char>(0xc0), static_cast<char>(0xaf)},
      {static_cast<char>(0xed), static_cast<char>(0xa0),
       static_cast<char>(0x80)},
      {static_cast<char>(0xf4), static_cast<char>(0x90),
       static_cast<char>(0x80), static_cast<char>(0x80)},
      {static_cast<char>(0xe2), static_cast<char>(0x82)},
  };
  for (const auto& malformed : invalidUtf8) {
    auto invalidJsonString = sampleDocument();
    invalidJsonString.layers.front().name = malformed;
    expectWriterRejects(invalidJsonString,
                        "malformed UTF-8 in JSON must be rejected");

    auto invalidFlatBufferString = sampleDocument();
    const auto mtext = std::find_if(
        invalidFlatBufferString.entities.begin(),
        invalidFlatBufferString.entities.end(),
        [](const cadweb::Entity& entity) {
          return entity.kind == cadweb::EntityKind::MText;
        });
    expect(mtext != invalidFlatBufferString.entities.end(),
           "sample MText entity is missing");
    mtext->text = malformed;
    expectWriterRejects(invalidFlatBufferString,
                        "malformed UTF-8 in FlatBuffers must be rejected");
  }

  const std::string embeddedNul("valid\0suffix", 12U);
  auto nulInJson = sampleDocument();
  nulInJson.layers.front().name = embeddedNul;
  expectWriterRejects(nulInJson,
                      "embedded NUL in JSON strings must be rejected");
  auto nulInFlatBuffer = sampleDocument();
  nulInFlatBuffer.entities.front().id = embeddedNul;
  expectWriterRejects(nulInFlatBuffer,
                      "embedded NUL in FlatBuffers strings must be rejected");
}

void testValidationAndAtomicWrite() {
  auto invalid = sampleDocument();
  invalid.entities.back().points.pop_back();
  bool invalidRejected = false;
  try {
    static_cast<void>(cadweb::CadWebWriter{}.build(invalid));
  } catch (const std::invalid_argument&) {
    invalidRejected = true;
  }
  expect(invalidRejected, "invalid line must be rejected");

  auto dangling = sampleDocument();
  dangling.entities.back().kind = cadweb::EntityKind::BlockReference;
  dangling.entities.back().points.clear();
  dangling.entities.back().blockDefinitionId = "block:missing";
  dangling.entities.back().transform = cadweb::Matrix4::identity();
  bool danglingRejected = false;
  try {
    static_cast<void>(cadweb::CadWebWriter{}.build(dangling));
  } catch (const std::invalid_argument&) {
    danglingRejected = true;
  }
  expect(danglingRejected, "dangling block reference must be rejected");

  auto selfCycle = sampleDocument();
  selfCycle.blocks.front().entities.push_back(
      blockReference("fixture:self", "block:A"));
  bool selfCycleRejected = false;
  try {
    static_cast<void>(cadweb::CadWebWriter{}.build(selfCycle));
  } catch (const std::invalid_argument&) {
    selfCycleRejected = true;
  }
  expect(selfCycleRejected, "self-referencing block must be rejected");

  auto multiNodeCycle = sampleDocument();
  multiNodeCycle.blocks.front().entities.push_back(
      blockReference("fixture:a-to-b", "block:B"));
  cadweb::BlockDefinition blockB;
  blockB.id = "block:B";
  blockB.sourceHandle = "B1";
  blockB.name = "FixtureBlockB";
  blockB.entities.push_back(
      blockReference("fixture:b-to-a", "block:A"));
  multiNodeCycle.blocks.push_back(std::move(blockB));
  bool multiNodeCycleRejected = false;
  try {
    static_cast<void>(cadweb::CadWebWriter{}.build(multiNodeCycle));
  } catch (const std::invalid_argument&) {
    multiNodeCycleRejected = true;
  }
  expect(multiNodeCycleRejected,
         "multi-node block reference cycle must be rejected");

  const auto document = sampleDocument();
  const auto archive = cadweb::CadWebWriter{}.build(document);
  const auto digest = cadweb::detail::sha256Hex(archive).substr(0U, 16U);
  const auto directoryBase = std::filesystem::temp_directory_path() /
                             ("cadweb-core-atomic-" + digest);
  std::filesystem::path testDirectory;
  for (std::size_t attempt = 0; attempt < 64U; ++attempt) {
    auto candidate = directoryBase;
    candidate += "-" + std::to_string(attempt);
    std::error_code error;
    if (std::filesystem::create_directory(candidate, error)) {
      testDirectory = std::move(candidate);
      break;
    }
    expect(!error || error == std::errc::file_exists,
           "cannot create atomic-writer test directory");
  }
  expect(!testDirectory.empty(),
         "cannot reserve atomic-writer test directory");

  const auto output = testDirectory / "result.cadweb";
  const auto sentinel = testDirectory / "sentinel.txt";
  auto legacyTemporary = output;
  legacyTemporary += ".tmp";
  {
    std::ofstream stream(sentinel, std::ios::binary | std::ios::trunc);
    stream << "sentinel";
    expect(static_cast<bool>(stream), "cannot create symlink sentinel");
  }

  std::error_code symlinkError;
  std::filesystem::create_symlink(sentinel, legacyTemporary, symlinkError);
  const bool legacySymlinkCreated = !symlinkError;

  const auto readFile = [](const std::filesystem::path& path) {
    std::ifstream stream(path, std::ios::binary);
    expect(static_cast<bool>(stream), "cannot read atomic-writer test file");
    return Bytes((std::istreambuf_iterator<char>(stream)),
                 std::istreambuf_iterator<char>());
  };
  const auto assertOnlyExpectedEntries = [&testDirectory](
                                             std::set<std::filesystem::path>
                                                 expected) {
    for (const auto& entry :
         std::filesystem::directory_iterator(testDirectory)) {
      expect(expected.erase(entry.path().filename()) == 1U,
             "atomic writer left an unexpected temporary entry");
    }
    expect(expected.empty(), "atomic-writer test entry is missing");
  };

  cadweb::CadWebWriter{}.writeAtomically(document, output);
  expect(std::filesystem::exists(output),
         "atomic write did not publish its destination");
  const auto written = readFile(output);
  expect(written == archive, "atomic write changed archive bytes");
  if (legacySymlinkCreated) {
    expect(std::filesystem::symlink_status(legacyTemporary).type() ==
               std::filesystem::file_type::symlink &&
               readFile(sentinel) == Bytes{'s', 'e', 'n', 't', 'i', 'n', 'e', 'l'},
           "writer followed or replaced a pre-created legacy temp symlink");
  }

  std::set<std::filesystem::path> expectedEntries{
      output.filename(), sentinel.filename()};
  if (legacySymlinkCreated) {
    expectedEntries.insert(legacyTemporary.filename());
  }
  assertOnlyExpectedEntries(expectedEntries);

  bool overwriteRejected = false;
  try {
    cadweb::CadWebWriter{}.writeAtomically(document, output);
  } catch (const std::invalid_argument&) {
    overwriteRejected = true;
  }
  expect(overwriteRejected,
         "portable atomic writer must reject an existing destination");
  expect(readFile(output) == archive,
         "existing destination was changed by no-replace publication");
  assertOnlyExpectedEntries(expectedEntries);

  const auto symlinkDestination = testDirectory / "symlink-output.cadweb";
  symlinkError.clear();
  std::filesystem::create_symlink(sentinel, symlinkDestination, symlinkError);
  if (!symlinkError) {
    bool symlinkDestinationRejected = false;
    try {
      cadweb::CadWebWriter{}.writeAtomically(document, symlinkDestination);
    } catch (const std::invalid_argument&) {
      symlinkDestinationRejected = true;
    }
    expect(symlinkDestinationRejected,
           "existing destination symlink must be rejected");
    expect(readFile(sentinel) ==
               Bytes{'s', 'e', 'n', 't', 'i', 'n', 'e', 'l'},
           "destination symlink target was overwritten");
    expectedEntries.insert(symlinkDestination.filename());
    assertOnlyExpectedEntries(expectedEntries);
  }

  std::error_code cleanupError;
  std::filesystem::remove(symlinkDestination, cleanupError);
  cleanupError.clear();
  std::filesystem::remove(legacyTemporary, cleanupError);
  cleanupError.clear();
  std::filesystem::remove(output, cleanupError);
  expect(!cleanupError, "cannot remove atomic-writer test output");
  cleanupError.clear();
  std::filesystem::remove(sentinel, cleanupError);
  expect(!cleanupError, "cannot remove atomic-writer sentinel");
  cleanupError.clear();
  std::filesystem::remove(testDirectory, cleanupError);
  expect(!cleanupError, "atomic writer left temporary residue");
}

}  // namespace

int main() {
  try {
    testSha256KnownVector();
    testCanonicalDeltaKeys();
    testDeltaArchiveAndDeterminism();
    testDeltaValidationAndStateHashes();
    testRevisionBoundSnapshot();
    testArchiveAndFlatBuffers();
    testOptionalBlocksAndUnitless();
    testCanonicalProducerLimits();
    testProducerReaderConsistency();
    testValidationAndAtomicWrite();
    std::cout << "cadweb core native tests passed\n";
    return 0;
  } catch (const std::exception& error) {
    std::cerr << "cadweb core native tests failed: " << error.what() << '\n';
    return 1;
  }
}

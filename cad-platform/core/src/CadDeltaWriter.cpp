#include "cadweb/CadDeltaWriter.h"
#include "cadweb/CadWebLimits.h"

#include "detail/ProducerLimits.h"
#include "detail/Sha256.h"
#include "detail/ZipStore.h"
#include "geometry_generated.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <cstring>
#include <filesystem>
#include <fstream>
#include <iomanip>
#include <limits>
#include <locale>
#include <optional>
#include <random>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <system_error>
#include <utility>
#include <vector>

namespace cadweb {
namespace {

using Bytes = std::vector<std::uint8_t>;

constexpr std::uint64_t kMaxJsonSafeInteger = 9007199254740991ULL;

struct Payload {
  std::string key;
  std::string path;
  std::string encoding;
  bool flatBuffers = false;
  Bytes bytes;
};

struct DeleteCounts {
  std::size_t entities = 0U;
  std::size_t blocks = 0U;
  std::size_t layers = 0U;
};

void require(bool condition, const std::string& message) {
  if (!condition) {
    throw std::invalid_argument(message);
  }
}

bool isFinite(double value) { return std::isfinite(value); }

bool isValidUtf8(std::string_view value) {
  const auto continuation = [](unsigned char byte) {
    return byte >= 0x80U && byte <= 0xbfU;
  };
  std::size_t index = 0U;
  while (index < value.size()) {
    const auto first = static_cast<unsigned char>(value[index]);
    if (first <= 0x7fU) {
      ++index;
      continue;
    }
    if (first >= 0xc2U && first <= 0xdfU) {
      if (index + 1U >= value.size() ||
          !continuation(static_cast<unsigned char>(value[index + 1U]))) {
        return false;
      }
      index += 2U;
      continue;
    }
    if (first >= 0xe0U && first <= 0xefU) {
      if (index + 2U >= value.size()) {
        return false;
      }
      const auto second = static_cast<unsigned char>(value[index + 1U]);
      const auto third = static_cast<unsigned char>(value[index + 2U]);
      const bool validSecond =
          first == 0xe0U ? second >= 0xa0U && second <= 0xbfU
                         : first == 0xedU
                               ? second >= 0x80U && second <= 0x9fU
                               : continuation(second);
      if (!validSecond || !continuation(third)) {
        return false;
      }
      index += 3U;
      continue;
    }
    if (first >= 0xf0U && first <= 0xf4U) {
      if (index + 3U >= value.size()) {
        return false;
      }
      const auto second = static_cast<unsigned char>(value[index + 1U]);
      const auto third = static_cast<unsigned char>(value[index + 2U]);
      const auto fourth = static_cast<unsigned char>(value[index + 3U]);
      const bool validSecond =
          first == 0xf0U ? second >= 0x90U && second <= 0xbfU
                         : first == 0xf4U
                               ? second >= 0x80U && second <= 0x8fU
                               : continuation(second);
      if (!validSecond || !continuation(third) || !continuation(fourth)) {
        return false;
      }
      index += 4U;
      continue;
    }
    return false;
  }
  return true;
}

void validateUtf8(std::string_view value, std::string_view field) {
  require(value.find('\0') == std::string_view::npos,
          std::string(field) + " must not contain NUL bytes");
  require(isValidUtf8(value), std::string(field) + " must be valid UTF-8");
}

void validateRequiredString(std::string_view value, std::string_view field) {
  validateUtf8(value, field);
  require(!value.empty(), std::string(field) + " is required");
}

void validateVec3(const Vec3& value, std::string_view field) {
  require(isFinite(value.x) && isFinite(value.y) && isFinite(value.z),
          std::string(field) + " must contain finite coordinates");
}

void validateExtents(const Extents3& extents, std::string_view field) {
  validateVec3(extents.min, std::string(field) + ".min");
  validateVec3(extents.max, std::string(field) + ".max");
  require(extents.min.x <= extents.max.x &&
              extents.min.y <= extents.max.y &&
              extents.min.z <= extents.max.z,
          std::string(field) + " min must not exceed max");
}

bool isCanonicalZero(double value) {
  return value == 0.0 && !std::signbit(value);
}

void validateModelMetadata(bool modelEmpty, const Extents3& resultExtents) {
  validateExtents(resultExtents, "resultExtents");
  if (modelEmpty) {
    require(isCanonicalZero(resultExtents.min.x) &&
                isCanonicalZero(resultExtents.min.y) &&
                isCanonicalZero(resultExtents.min.z) &&
                isCanonicalZero(resultExtents.max.x) &&
                isCanonicalZero(resultExtents.max.y) &&
                isCanonicalZero(resultExtents.max.z),
            "empty model must use the canonical positive-zero extents");
  }
}

std::string_view objectKindPrefix(CadObjectKind kind) {
  switch (kind) {
    case CadObjectKind::Entity:
      return "entity";
    case CadObjectKind::Block:
      return "block";
    case CadObjectKind::Layer:
      return "layer";
  }
  throw std::invalid_argument("unknown CAD object kind");
}

bool isCanonicalKeyOfKind(std::string_view key, CadObjectKind kind) {
  const auto prefix = objectKindPrefix(kind);
  return key.size() > prefix.size() + 1U &&
         key.compare(0U, prefix.size(), prefix) == 0 &&
         key[prefix.size()] == ':' && isCanonicalObjectKey(key);
}

void validateCanonicalSource(std::string_view objectKey,
                             std::string_view sourceHandle,
                             CadObjectKind kind, std::string_view field) {
  validateRequiredString(objectKey, std::string(field) + ".id");
  validateRequiredString(sourceHandle,
                         std::string(field) + ".sourceHandle");
  require(sourceHandle == normalizeSourceHandle(sourceHandle),
          std::string(field) +
              ".sourceHandle must be uppercase canonical hexadecimal");
  require(objectKey == canonicalObjectKey(kind, sourceHandle),
          std::string(field) + ".id does not match sourceHandle");
}

void validateFiniteValues(const std::vector<double>& values,
                          std::string_view field) {
  require(std::all_of(values.begin(), values.end(), isFinite),
          std::string(field) + " must contain finite values");
}

void validateEntity(const Entity& entity, bool insideBlock,
                    std::set<std::string>& containedObjectIds) {
  validateCanonicalSource(entity.id, entity.sourceHandle,
                          CadObjectKind::Entity, "entity");
  require(containedObjectIds.insert(entity.id).second,
          "duplicate contained object key: " + entity.id);
  validateRequiredString(entity.layerId, "entity.layerId");
  require(isCanonicalKeyOfKind(entity.layerId, CadObjectKind::Layer),
          "entity.layerId must be a canonical layer key: " + entity.id);
  validateUtf8(entity.style.linetype, "entity.style.linetype");
  validateUtf8(entity.text, "entity.text");
  validateUtf8(entity.blockDefinitionId, "entity.blockDefinitionId");

  const auto kind = static_cast<std::uint8_t>(entity.kind);
  require(kind >= static_cast<std::uint8_t>(EntityKind::Line) &&
              kind <= static_cast<std::uint8_t>(EntityKind::BlockReference),
          "entity kind is required: " + entity.id);
  require(static_cast<std::uint8_t>(entity.space) <=
              static_cast<std::uint8_t>(SpaceKind::BlockDefinition),
          "entity space is invalid: " + entity.id);
  require(insideBlock ? entity.space == SpaceKind::BlockDefinition
                      : entity.space != SpaceKind::BlockDefinition,
          insideBlock
              ? "block entity must use BlockDefinition space: " + entity.id
              : "top-level entity cannot use BlockDefinition space: " +
                    entity.id);
  require(std::isfinite(entity.style.lineWeightMm) &&
              entity.style.lineWeightMm >= 0.0F,
          "entity lineWeightMm must be finite and non-negative: " +
              entity.id);
  const auto validSourceMode = [](PropertySourceMode mode) {
    return static_cast<std::uint8_t>(mode) <=
           static_cast<std::uint8_t>(PropertySourceMode::ByBlock);
  };
  require(validSourceMode(entity.style.colorSourceMode) &&
              validSourceMode(entity.style.transparencySourceMode) &&
              validSourceMode(entity.style.lineWeightSourceMode) &&
              validSourceMode(entity.style.linetypeSourceMode),
          "entity property source mode is invalid: " + entity.id);
  require(isFinite(entity.constantWidth) && entity.constantWidth >= 0.0,
          "entity constantWidth must be finite and non-negative: " +
              entity.id);
  require(isFinite(entity.radius) && isFinite(entity.startAngle) &&
              isFinite(entity.endAngle) && isFinite(entity.rotation) &&
              isFinite(entity.height),
          "entity scalar geometry must be finite: " + entity.id);
  require(entity.height >= 0.0,
          "entity height must be non-negative: " + entity.id);
  require(std::all_of(entity.points.begin(), entity.points.end(),
                      [](const Vec3& point) {
                        return isFinite(point.x) && isFinite(point.y) &&
                               isFinite(point.z);
                      }),
          "entity points must be finite: " + entity.id);
  validateFiniteValues(entity.bulges, "entity.bulges");
  validateFiniteValues(entity.startWidths, "entity.startWidths");
  validateFiniteValues(entity.endWidths, "entity.endWidths");
  require(std::all_of(entity.startWidths.begin(), entity.startWidths.end(),
                      [](double width) { return width >= 0.0; }) &&
              std::all_of(entity.endWidths.begin(), entity.endWidths.end(),
                          [](double width) { return width >= 0.0; }),
          "entity widths must be non-negative: " + entity.id);

  if (entity.center) {
    validateVec3(*entity.center, "entity.center");
  }
  if (entity.normal) {
    validateVec3(*entity.normal, "entity.normal");
  }
  if (entity.position) {
    validateVec3(*entity.position, "entity.position");
  }
  if (entity.transform) {
    require(std::all_of(entity.transform->values.begin(),
                        entity.transform->values.end(), isFinite),
            "entity transform must contain finite values: " + entity.id);
  }

  switch (entity.kind) {
    case EntityKind::Line:
      require(entity.points.size() == 2U,
              "line must contain exactly two points: " + entity.id);
      break;
    case EntityKind::Polyline: {
      require(entity.points.size() >= 2U,
              "polyline must contain at least two points: " + entity.id);
      const auto matchesPoints = [&entity](const std::vector<double>& values) {
        return values.empty() || values.size() == entity.points.size();
      };
      require(matchesPoints(entity.bulges) &&
                  matchesPoints(entity.startWidths) &&
                  matchesPoints(entity.endWidths),
              "polyline bulges and widths must be empty or match point count: " +
                  entity.id);
      break;
    }
    case EntityKind::Arc:
    case EntityKind::Circle:
      require(entity.center.has_value() && entity.normal.has_value() &&
                  entity.radius > 0.0,
              "arc/circle requires center, normal, and positive radius: " +
                  entity.id);
      break;
    case EntityKind::Text:
    case EntityKind::MText:
      require(entity.position.has_value() && entity.height > 0.0,
              "text requires a position and positive height: " + entity.id);
      break;
    case EntityKind::BlockReference:
      require(!entity.blockDefinitionId.empty() && entity.transform.has_value(),
              "block reference requires definition id and transform: " +
                  entity.id);
      require(isCanonicalKeyOfKind(entity.blockDefinitionId,
                                   CadObjectKind::Block),
              "blockDefinitionId must be a canonical block key: " +
                  entity.id);
      break;
    case EntityKind::Unknown:
      break;
  }

  for (const auto& attribute : entity.attributes) {
    validateRequiredString(attribute.id, "attribute.id");
    require(isCanonicalKeyOfKind(attribute.id, CadObjectKind::Entity),
            "attribute.id must be a canonical entity key: " + attribute.id);
    require(containedObjectIds.insert(attribute.id).second,
            "duplicate contained object key: " + attribute.id);
    validateRequiredString(attribute.tag, "attribute.tag");
    validateUtf8(attribute.text, "attribute.text");
    validateVec3(attribute.position, "attribute.position");
    require(isFinite(attribute.rotation) && isFinite(attribute.height) &&
                attribute.height >= 0.0,
            "attribute rotation and height are invalid: " + attribute.id);
  }
}

void validateBlock(const BlockDefinition& block,
                   std::set<std::string>& containedObjectIds) {
  validateCanonicalSource(block.id, block.sourceHandle, CadObjectKind::Block,
                          "block");
  validateRequiredString(block.name, "block.name");
  validateVec3(block.basePoint, "block.basePoint");
  for (const auto& entity : block.entities) {
    validateEntity(entity, true, containedObjectIds);
  }
}

void validateLayer(const Layer& layer) {
  validateCanonicalSource(layer.id, layer.sourceHandle, CadObjectKind::Layer,
                          "layer");
  validateRequiredString(layer.name, "layer.name");
  validateUtf8(layer.linetype, "layer.linetype");
  require(std::isfinite(layer.lineWeightMm) && layer.lineWeightMm >= 0.0F,
          "layer lineWeightMm must be finite and non-negative: " +
              layer.id);
}

DeleteCounts countTombstones(const std::vector<std::string>& tombstones) {
  DeleteCounts counts;
  for (const auto& key : tombstones) {
    if (isCanonicalKeyOfKind(key, CadObjectKind::Entity)) {
      ++counts.entities;
    } else if (isCanonicalKeyOfKind(key, CadObjectKind::Block)) {
      ++counts.blocks;
    } else if (isCanonicalKeyOfKind(key, CadObjectKind::Layer)) {
      ++counts.layers;
    } else {
      throw std::invalid_argument("invalid tombstone object key: " + key);
    }
  }
  return counts;
}

void validateDelta(const CadDelta& delta) {
  validateRequiredString(delta.changeSetId, "changeSetId");
  validateRequiredString(delta.drawingId, "drawingId");
  validateRequiredString(delta.sourceFingerprint, "sourceFingerprint");
  validateRequiredString(delta.modelEpoch, "modelEpoch");
  validateRequiredString(delta.trigger.kind, "trigger.kind");
  validateRequiredString(delta.trigger.savedAt, "trigger.savedAt");
  require(delta.baseRevision > 0U &&
              delta.baseRevision <= kMaxJsonSafeInteger,
          "baseRevision must be a positive JSON-safe integer");
  validateModelMetadata(delta.modelEmpty, delta.resultExtents);
  require(!delta.modelEmpty || delta.entityUpserts.empty(),
          "empty model cannot contain a top-level entity upsert");

  const auto totalOperations =
      delta.entityUpserts.size() + delta.blockUpserts.size() +
      delta.layerUpserts.size() + delta.tombstones.size();
  require(totalOperations != 0U,
          "delta must contain at least one upsert or tombstone");
  require(delta.entityUpserts.size() <=
                  std::numeric_limits<std::uint32_t>::max() &&
              delta.blockUpserts.size() <=
                  std::numeric_limits<std::uint32_t>::max() &&
              delta.layerUpserts.size() <=
                  std::numeric_limits<std::uint32_t>::max() &&
              delta.tombstones.size() <=
                  std::numeric_limits<std::uint32_t>::max(),
          "delta operation count exceeds the version 1 limit");

  std::set<std::string> rootUpsertKeys;
  std::set<std::string> containedObjectIds;
  for (const auto& entity : delta.entityUpserts) {
    validateEntity(entity, false, containedObjectIds);
    require(rootUpsertKeys.insert(entity.id).second,
            "duplicate upsert object key: " + entity.id);
  }
  for (const auto& block : delta.blockUpserts) {
    validateBlock(block, containedObjectIds);
    require(rootUpsertKeys.insert(block.id).second,
            "duplicate upsert object key: " + block.id);
  }
  for (const auto& layer : delta.layerUpserts) {
    validateLayer(layer);
    require(rootUpsertKeys.insert(layer.id).second,
            "duplicate upsert object key: " + layer.id);
  }

  std::set<std::string> tombstoneKeys;
  for (const auto& tombstone : delta.tombstones) {
    validateRequiredString(tombstone, "tombstone key");
    require(isCanonicalObjectKey(tombstone),
            "tombstone must use a canonical object key: " + tombstone);
    require(tombstoneKeys.insert(tombstone).second,
            "duplicate tombstone object key: " + tombstone);
    require(rootUpsertKeys.count(tombstone) == 0U &&
                containedObjectIds.count(tombstone) == 0U,
            "object key cannot be both upserted and deleted: " + tombstone);
  }
  static_cast<void>(countTombstones(delta.tombstones));
}

std::string jsonString(std::string_view value) {
  constexpr char kHex[] = "0123456789abcdef";
  std::string output;
  output.reserve(value.size() + 2U);
  output.push_back('"');
  for (const auto byte : value) {
    const auto character = static_cast<unsigned char>(byte);
    switch (character) {
      case '"':
        output += "\\\"";
        break;
      case '\\':
        output += "\\\\";
        break;
      case '\b':
        output += "\\b";
        break;
      case '\f':
        output += "\\f";
        break;
      case '\n':
        output += "\\n";
        break;
      case '\r':
        output += "\\r";
        break;
      case '\t':
        output += "\\t";
        break;
      default:
        if (character < 0x20U) {
          output += "\\u00";
          output.push_back(kHex[character >> 4U]);
          output.push_back(kHex[character & 0x0fU]);
        } else {
          output.push_back(static_cast<char>(character));
        }
    }
  }
  output.push_back('"');
  return output;
}

std::string jsonNumber(double value) {
  std::ostringstream stream;
  stream.imbue(std::locale::classic());
  stream << std::setprecision(std::numeric_limits<double>::max_digits10)
         << value;
  return stream.str();
}

std::string jsonNumber(float value) {
  std::ostringstream stream;
  stream.imbue(std::locale::classic());
  stream << std::setprecision(std::numeric_limits<float>::max_digits10)
         << value;
  return stream.str();
}

const char* jsonBool(bool value) { return value ? "true" : "false"; }

std::string jsonVec3(const Vec3& value) {
  return "[" + jsonNumber(value.x) + "," + jsonNumber(value.y) + "," +
         jsonNumber(value.z) + "]";
}

Bytes toBytes(const std::string& value) {
  return Bytes(value.begin(), value.end());
}

template <typename Value, typename Key>
std::vector<const Value*> sortedPointers(const std::vector<Value>& values,
                                         Key key) {
  std::vector<const Value*> result;
  result.reserve(values.size());
  for (const auto& value : values) {
    result.push_back(&value);
  }
  std::sort(result.begin(), result.end(),
            [&key](const Value* left, const Value* right) {
              return key(*left) < key(*right);
            });
  return result;
}

CadWeb::V1::Vec3 toFlatBuffer(const Vec3& value) {
  return CadWeb::V1::Vec3(value.x, value.y, value.z);
}

CadWeb::V1::Matrix4 toFlatBuffer(const Matrix4& value) {
  return CadWeb::V1::Matrix4(
      value.values[0], value.values[1], value.values[2], value.values[3],
      value.values[4], value.values[5], value.values[6], value.values[7],
      value.values[8], value.values[9], value.values[10], value.values[11],
      value.values[12], value.values[13], value.values[14], value.values[15]);
}

::flatbuffers::Offset<CadWeb::V1::Entity> buildEntity(
    ::flatbuffers::FlatBufferBuilder& builder, const Entity& entity) {
  std::vector<CadWeb::V1::Vec3> points;
  points.reserve(entity.points.size());
  for (const auto& point : entity.points) {
    points.push_back(toFlatBuffer(point));
  }

  const auto attributes = sortedPointers(
      entity.attributes,
      [](const Attribute& attribute) { return attribute.id; });
  std::vector<::flatbuffers::Offset<CadWeb::V1::Attribute>> attributeOffsets;
  attributeOffsets.reserve(attributes.size());
  for (const auto* attribute : attributes) {
    const auto position = toFlatBuffer(attribute->position);
    attributeOffsets.push_back(CadWeb::V1::CreateAttributeDirect(
        builder, attribute->id.c_str(), attribute->tag.c_str(),
        attribute->text.c_str(), &position, attribute->rotation,
        attribute->height));
  }

  const auto center = entity.center
                          ? std::optional<CadWeb::V1::Vec3>(
                                toFlatBuffer(*entity.center))
                          : std::nullopt;
  const auto normal = entity.normal
                          ? std::optional<CadWeb::V1::Vec3>(
                                toFlatBuffer(*entity.normal))
                          : std::nullopt;
  const auto position = entity.position
                            ? std::optional<CadWeb::V1::Vec3>(
                                  toFlatBuffer(*entity.position))
                            : std::nullopt;
  const auto transform = entity.transform
                             ? std::optional<CadWeb::V1::Matrix4>(
                                   toFlatBuffer(*entity.transform))
                             : std::nullopt;

  return CadWeb::V1::CreateEntityDirect(
      builder, entity.id.c_str(), entity.sourceHandle.c_str(),
      static_cast<CadWeb::V1::EntityKind>(entity.kind), entity.layerId.c_str(),
      static_cast<CadWeb::V1::SpaceKind>(entity.space), entity.style.visible,
      entity.style.colorArgb, entity.style.transparency,
      entity.style.lineWeightMm,
      entity.style.linetype.empty() ? nullptr : entity.style.linetype.c_str(),
      entity.style.drawOrder, &points, &entity.bulges, &entity.startWidths,
      &entity.endWidths, entity.constantWidth, entity.closed,
      center ? &*center : nullptr, entity.radius, entity.startAngle,
      entity.endAngle, normal ? &*normal : nullptr,
      (entity.kind == EntityKind::Text || entity.kind == EntityKind::MText)
          ? entity.text.c_str()
          : nullptr,
      position ? &*position : nullptr, entity.rotation, entity.height,
      entity.blockDefinitionId.empty() ? nullptr
                                       : entity.blockDefinitionId.c_str(),
      transform ? &*transform : nullptr,
      attributeOffsets.empty() ? nullptr : &attributeOffsets,
      static_cast<CadWeb::V1::PropertySourceMode>(
          entity.style.colorSourceMode),
      static_cast<CadWeb::V1::PropertySourceMode>(
          entity.style.transparencySourceMode),
      static_cast<CadWeb::V1::PropertySourceMode>(
          entity.style.lineWeightSourceMode),
      static_cast<CadWeb::V1::PropertySourceMode>(
          entity.style.linetypeSourceMode));
}

Bytes finishFlatBuffer(::flatbuffers::FlatBufferBuilder& builder) {
  return Bytes(builder.GetBufferPointer(),
               builder.GetBufferPointer() + builder.GetSize());
}

Bytes buildEntitiesFlatBuffer(const std::vector<Entity>& entities) {
  ::flatbuffers::FlatBufferBuilder builder;
  std::vector<::flatbuffers::Offset<CadWeb::V1::Entity>> offsets;
  for (const auto* entity : sortedPointers(
           entities, [](const Entity& value) { return value.id; })) {
    offsets.push_back(buildEntity(builder, *entity));
  }
  const auto vector = builder.CreateVector(offsets);
  const auto root = CadWeb::V1::CreateGeometryBuffer(
      builder, 1U, CadWeb::V1::BufferKind::Entities, vector, 0);
  CadWeb::V1::FinishGeometryBufferBuffer(builder, root);
  return finishFlatBuffer(builder);
}

Bytes buildBlocksFlatBuffer(const std::vector<BlockDefinition>& blocks) {
  ::flatbuffers::FlatBufferBuilder builder;
  std::vector<::flatbuffers::Offset<CadWeb::V1::BlockDefinition>> offsets;
  for (const auto* block : sortedPointers(
           blocks, [](const BlockDefinition& value) { return value.id; })) {
    std::vector<::flatbuffers::Offset<CadWeb::V1::Entity>> entityOffsets;
    for (const auto* entity : sortedPointers(
             block->entities, [](const Entity& value) { return value.id; })) {
      entityOffsets.push_back(buildEntity(builder, *entity));
    }
    const auto basePoint = toFlatBuffer(block->basePoint);
    offsets.push_back(CadWeb::V1::CreateBlockDefinitionDirect(
        builder, block->id.c_str(), block->sourceHandle.c_str(),
        block->name.c_str(), &basePoint, &entityOffsets));
  }
  const auto vector = builder.CreateVector(offsets);
  const auto root = CadWeb::V1::CreateGeometryBuffer(
      builder, 1U, CadWeb::V1::BufferKind::Blocks, 0, vector);
  CadWeb::V1::FinishGeometryBufferBuffer(builder, root);
  return finishFlatBuffer(builder);
}

std::string layerJson(const Layer& layer) {
  return "{\"id\":" + jsonString(layer.id) +
         ",\"sourceHandle\":" + jsonString(layer.sourceHandle) +
         ",\"name\":" + jsonString(layer.name) +
         ",\"visible\":" + jsonBool(layer.visible) +
         ",\"frozen\":" + jsonBool(layer.frozen) +
         ",\"locked\":" + jsonBool(layer.locked) +
         ",\"plot\":" + jsonBool(layer.plot) +
         ",\"colorArgb\":" + std::to_string(layer.colorArgb) +
         ",\"transparency\":" + std::to_string(layer.transparency) +
         ",\"lineWeightMm\":" + jsonNumber(layer.lineWeightMm) +
         ",\"linetype\":" + jsonString(layer.linetype) + "}";
}

Bytes buildLayersJson(const std::vector<Layer>& layers) {
  std::string json = "{\"schemaVersion\":1,\"layers\":[";
  const auto sorted = sortedPointers(
      layers, [](const Layer& value) { return value.id; });
  for (std::size_t index = 0; index < sorted.size(); ++index) {
    if (index != 0U) {
      json.push_back(',');
    }
    json += layerJson(*sorted[index]);
  }
  json += "]}\n";
  return toBytes(json);
}

Bytes buildTombstonesJson(std::vector<std::string> tombstones) {
  std::sort(tombstones.begin(), tombstones.end());
  std::string json = "{\"schemaVersion\":1,\"keys\":[";
  for (std::size_t index = 0; index < tombstones.size(); ++index) {
    if (index != 0U) {
      json.push_back(',');
    }
    json += jsonString(tombstones[index]);
  }
  json += "]}\n";
  return toBytes(json);
}

Bytes buildExportReportJson(const CadDelta& delta) {
  const auto upserted = delta.entityUpserts.size() +
                        delta.blockUpserts.size() +
                        delta.layerUpserts.size();
  return toBytes(
      "{\"schemaVersion\":1,\"status\":\"complete\","
      "\"xrefPolicy\":\"reference-only\",\"counts\":{"
      "\"exported\":" +
      std::to_string(upserted) +
      ",\"skipped\":0,\"warnings\":0,\"errors\":0},"
      "\"issues\":[],\"omittedSpaces\":[]}\n");
}

std::string fileDescriptorJson(const Payload& payload) {
  std::string json = "{\"path\":" + jsonString(payload.path) +
                     ",\"encoding\":" + jsonString(payload.encoding);
  if (payload.flatBuffers) {
    json += ",\"schemaVersion\":1,\"byteOrder\":\"little-endian\"";
  }
  json += ",\"size\":" + std::to_string(payload.bytes.size()) +
          ",\"sha256\":" + jsonString(detail::sha256Hex(payload.bytes)) +
          "}";
  return json;
}

Bytes buildChangeJson(const CadDelta& delta,
                      const std::vector<Payload>& payloads) {
  const auto deletes = countTombstones(delta.tombstones);
  std::string json =
      "{\"format\":\"cadweb-delta\","
      "\"formatVersion\":{\"major\":1,\"minor\":1},"
      "\"changeSetId\":" +
      jsonString(delta.changeSetId) +
      ",\"drawingId\":" + jsonString(delta.drawingId) +
      ",\"sourceFingerprint\":" + jsonString(delta.sourceFingerprint) +
      ",\"modelEpoch\":" + jsonString(delta.modelEpoch) +
      ",\"baseRevision\":" + std::to_string(delta.baseRevision) +
      ",\"trigger\":{\"kind\":" + jsonString(delta.trigger.kind) +
      ",\"savedAt\":" + jsonString(delta.trigger.savedAt) +
      "},\"upserts\":{\"entities\":" +
      std::to_string(delta.entityUpserts.size()) +
      ",\"blocks\":" + std::to_string(delta.blockUpserts.size()) +
      ",\"layers\":" + std::to_string(delta.layerUpserts.size()) +
      "},\"deletes\":{\"entities\":" +
      std::to_string(deletes.entities) +
      ",\"blocks\":" + std::to_string(deletes.blocks) +
      ",\"layers\":" + std::to_string(deletes.layers) +
      "},\"modelEmpty\":" + jsonBool(delta.modelEmpty) +
      ",\"resultExtents\":{\"min\":" +
      jsonVec3(delta.resultExtents.min) +
      ",\"max\":" + jsonVec3(delta.resultExtents.max) +
      "},\"files\":{";
  for (std::size_t index = 0; index < payloads.size(); ++index) {
    if (index != 0U) {
      json.push_back(',');
    }
    json += jsonString(payloads[index].key) + ":" +
            fileDescriptorJson(payloads[index]);
  }
  json += "}}\n";
  return toBytes(json);
}

std::string randomTemporaryToken(std::random_device& entropy) {
  std::ostringstream token;
  token.imbue(std::locale::classic());
  token << std::hex << std::setfill('0');
  for (std::size_t index = 0; index < 8U; ++index) {
    token << std::setw(8) << static_cast<std::uint32_t>(entropy());
  }
  return token.str();
}

std::filesystem::path createPrivateTemporaryDirectory(
    const std::filesystem::path& parent) {
  std::random_device entropy;
  for (std::size_t attempt = 0; attempt < 64U; ++attempt) {
    const auto name = std::filesystem::path(
        ".cadweb-delta-tmp-" + randomTemporaryToken(entropy));
    const auto candidate = parent.empty() ? name : parent / name;
    std::error_code error;
    const bool created = std::filesystem::create_directory(candidate, error);
    if (!created) {
      if (!error || error == std::errc::file_exists) {
        continue;
      }
      throw std::system_error(error, "cannot reserve temporary delta output");
    }
    std::filesystem::permissions(
        candidate,
        std::filesystem::perms::owner_read |
            std::filesystem::perms::owner_write |
            std::filesystem::perms::owner_exec,
        std::filesystem::perm_options::replace, error);
    if (error) {
      std::error_code ignored;
      std::filesystem::remove(candidate, ignored);
      throw std::system_error(error,
                              "cannot secure temporary delta directory");
    }
    return candidate;
  }
  throw std::runtime_error("cannot reserve a unique temporary delta output");
}

void cleanupTemporaryOutput(const std::filesystem::path& file,
                            const std::filesystem::path& directory) noexcept {
  std::error_code ignored;
  std::filesystem::remove(file, ignored);
  ignored.clear();
  std::filesystem::remove(directory, ignored);
}

void appendUint32(Bytes& output, std::uint32_t value) {
  output.push_back(static_cast<std::uint8_t>(value >> 24U));
  output.push_back(static_cast<std::uint8_t>(value >> 16U));
  output.push_back(static_cast<std::uint8_t>(value >> 8U));
  output.push_back(static_cast<std::uint8_t>(value));
}

void appendFrame(Bytes& output, std::string_view value) {
  require(value.size() <= std::numeric_limits<std::uint32_t>::max(),
          "state hash string exceeds the version 1 limit");
  appendUint32(output, static_cast<std::uint32_t>(value.size()));
  output.insert(output.end(), value.begin(), value.end());
}

void appendDouble(Bytes& output, double value) {
  static_assert(sizeof(double) == sizeof(std::uint64_t),
                "state hash requires 64-bit doubles");
  if (value == 0.0) {
    value = 0.0;  // Canonicalize negative zero.
  }
  std::uint64_t bits = 0U;
  std::memcpy(&bits, &value, sizeof(bits));
  for (int shift = 56; shift >= 0; shift -= 8) {
    output.push_back(static_cast<std::uint8_t>(bits >> shift));
  }
}

std::uint8_t hexValue(char value) {
  if (value >= '0' && value <= '9') {
    return static_cast<std::uint8_t>(value - '0');
  }
  if (value >= 'a' && value <= 'f') {
    return static_cast<std::uint8_t>(value - 'a' + 10);
  }
  throw std::invalid_argument("content hash must be lowercase SHA-256 hex");
}

void appendSha256(Bytes& output, std::string_view value) {
  require(value.size() == 64U,
          "content hash must contain 64 lowercase hexadecimal digits");
  for (std::size_t index = 0; index < value.size(); index += 2U) {
    output.push_back(static_cast<std::uint8_t>(
        (hexValue(value[index]) << 4U) | hexValue(value[index + 1U])));
  }
}

}  // namespace

std::string normalizeSourceHandle(std::string_view sourceHandle) {
  if (sourceHandle.size() >= 2U && sourceHandle[0] == '0' &&
      (sourceHandle[1] == 'x' || sourceHandle[1] == 'X')) {
    sourceHandle.remove_prefix(2U);
  }
  require(!sourceHandle.empty(), "source handle is required");

  std::string normalized;
  normalized.reserve(sourceHandle.size());
  for (const auto value : sourceHandle) {
    if (value >= '0' && value <= '9') {
      normalized.push_back(value);
    } else if (value >= 'A' && value <= 'F') {
      normalized.push_back(value);
    } else if (value >= 'a' && value <= 'f') {
      normalized.push_back(static_cast<char>(value - 'a' + 'A'));
    } else {
      throw std::invalid_argument(
          "source handle must contain only hexadecimal digits");
    }
  }

  const auto firstNonZero = normalized.find_first_not_of('0');
  require(firstNonZero != std::string::npos,
          "source handle zero is not a persistent object handle");
  normalized.erase(0U, firstNonZero);
  return normalized;
}

std::string canonicalObjectKey(CadObjectKind kind,
                               std::string_view sourceHandle) {
  return std::string(objectKindPrefix(kind)) + ":" +
         normalizeSourceHandle(sourceHandle);
}

bool isCanonicalObjectKey(std::string_view objectKey) {
  const auto separator = objectKey.find(':');
  if (separator == std::string_view::npos ||
      objectKey.find(':', separator + 1U) != std::string_view::npos) {
    return false;
  }
  const auto prefix = objectKey.substr(0U, separator);
  if (prefix != "entity" && prefix != "block" && prefix != "layer") {
    return false;
  }
  const auto handle = objectKey.substr(separator + 1U);
  try {
    return handle == normalizeSourceHandle(handle);
  } catch (const std::invalid_argument&) {
    return false;
  }
}

StateObjectHash computeObjectContentHash(const Entity& entity) {
  std::set<std::string> containedIds;
  validateEntity(entity, false, containedIds);
  return StateObjectHash{entity.id,
                         detail::sha256Hex(buildEntitiesFlatBuffer({entity}))};
}

StateObjectHash computeObjectContentHash(const BlockDefinition& block) {
  std::set<std::string> containedIds;
  validateBlock(block, containedIds);
  return StateObjectHash{block.id,
                         detail::sha256Hex(buildBlocksFlatBuffer({block}))};
}

StateObjectHash computeObjectContentHash(const Layer& layer) {
  validateLayer(layer);
  return StateObjectHash{layer.id,
                         detail::sha256Hex(buildLayersJson({layer}))};
}

std::string computeStateHash(
    std::string_view drawingId, std::string_view modelEpoch, bool modelEmpty,
    const Extents3& resultExtents,
    const std::vector<StateObjectHash>& objectHashes) {
  validateRequiredString(drawingId, "drawingId");
  validateRequiredString(modelEpoch, "modelEpoch");
  validateModelMetadata(modelEmpty, resultExtents);
  require(objectHashes.size() <= std::numeric_limits<std::uint32_t>::max(),
          "state hash object count exceeds the version 1 limit");

  auto sorted = sortedPointers(
      objectHashes,
      [](const StateObjectHash& value) { return value.objectKey; });
  std::string previousKey;
  for (const auto* object : sorted) {
    require(isCanonicalObjectKey(object->objectKey),
            "state hash contains a non-canonical object key: " +
                object->objectKey);
    require(previousKey != object->objectKey,
            "state hash contains duplicate object key: " + object->objectKey);
    previousKey = object->objectKey;
    require(object->contentSha256.size() == 64U &&
                std::all_of(object->contentSha256.begin(),
                            object->contentSha256.end(), [](char value) {
                              return (value >= '0' && value <= '9') ||
                                     (value >= 'a' && value <= 'f');
                            }),
            "state object hash must be lowercase SHA-256 hex: " +
                object->objectKey);
  }

  Bytes canonical{'C', 'A', 'D', 'W', 'E', 'B', '-', 'S', 'T', 'A', 'T', 'E',
                  0U, 1U};
  appendFrame(canonical, drawingId);
  appendFrame(canonical, modelEpoch);
  canonical.push_back(modelEmpty ? 1U : 0U);
  appendDouble(canonical, resultExtents.min.x);
  appendDouble(canonical, resultExtents.min.y);
  appendDouble(canonical, resultExtents.min.z);
  appendDouble(canonical, resultExtents.max.x);
  appendDouble(canonical, resultExtents.max.y);
  appendDouble(canonical, resultExtents.max.z);
  appendUint32(canonical, static_cast<std::uint32_t>(sorted.size()));
  for (const auto* object : sorted) {
    appendFrame(canonical, object->objectKey);
    appendSha256(canonical, object->contentSha256);
  }
  return detail::sha256Hex(canonical);
}

std::vector<std::uint8_t> CadDeltaWriter::build(const CadDelta& delta) const {
  validateDelta(delta);

  std::vector<Payload> payloads;
  const auto appendPayload = [&payloads](Payload payload) {
    detail::validateProducerSizes({detail::ProducerEntrySize{
        payload.path, payload.bytes.size(), payload.encoding == "json"}});
    payloads.push_back(std::move(payload));
  };
  if (!delta.entityUpserts.empty()) {
    appendPayload(Payload{"entities", "entities.bin", "flatbuffers", true,
                          buildEntitiesFlatBuffer(delta.entityUpserts)});
  }
  if (!delta.blockUpserts.empty()) {
    appendPayload(Payload{"blocks", "blocks.bin", "flatbuffers", true,
                          buildBlocksFlatBuffer(delta.blockUpserts)});
  }
  if (!delta.layerUpserts.empty()) {
    appendPayload(Payload{"layers", "layers.json", "json", false,
                          buildLayersJson(delta.layerUpserts)});
  }
  if (!delta.tombstones.empty()) {
    appendPayload(Payload{"tombstones", "tombstones.json", "json", false,
                          buildTombstonesJson(delta.tombstones)});
  }
  appendPayload(Payload{"exportReport", "export-report.json", "json", false,
                        buildExportReportJson(delta)});

  std::vector<detail::ZipEntry> entries;
  entries.reserve(payloads.size() + 1U);
  entries.push_back(
      detail::ZipEntry{"change.json", buildChangeJson(delta, payloads)});
  for (auto& payload : payloads) {
    entries.push_back(detail::ZipEntry{payload.path, std::move(payload.bytes)});
  }

  std::vector<detail::ProducerEntrySize> entrySizes;
  entrySizes.reserve(entries.size());
  for (const auto& entry : entries) {
    const bool json = entry.path.size() >= 5U &&
                      entry.path.compare(entry.path.size() - 5U, 5U, ".json") ==
                          0;
    entrySizes.push_back(
        detail::ProducerEntrySize{entry.path, entry.bytes.size(), json});
  }
  detail::validateProducerSizes(entrySizes);
  auto archive = detail::buildZipStore(std::move(entries));
  if (archive.size() > limits::kMaxArchiveBytes) {
    throw std::length_error("CadWeb delta archive exceeds the 256 MiB limit");
  }
  return archive;
}

void CadDeltaWriter::writeAtomically(
    const CadDelta& delta, const std::filesystem::path& destination) const {
  require(!destination.empty() && !destination.filename().empty(),
          "destination file name is required");
  std::error_code pathError;
  const auto publicationDestination =
      std::filesystem::absolute(destination, pathError);
  if (pathError) {
    throw std::system_error(pathError, "cannot resolve delta destination path");
  }
  const auto archive = build(delta);
  require(archive.size() <=
              static_cast<std::size_t>(
                  std::numeric_limits<std::streamsize>::max()),
          "delta archive is too large for the output stream");

  const auto temporaryDirectory =
      createPrivateTemporaryDirectory(publicationDestination.parent_path());
  const auto temporaryFile = temporaryDirectory / "payload";
  try {
    std::ofstream stream(temporaryFile, std::ios::binary | std::ios::trunc);
    if (!stream) {
      throw std::runtime_error("cannot create temporary delta output");
    }
    stream.write(reinterpret_cast<const char*>(archive.data()),
                 static_cast<std::streamsize>(archive.size()));
    stream.flush();
    if (!stream) {
      throw std::runtime_error("cannot write temporary delta output");
    }
    stream.close();
    if (!stream) {
      throw std::runtime_error("cannot close temporary delta output");
    }

    std::error_code error;
    std::filesystem::create_hard_link(temporaryFile, publicationDestination,
                                      error);
    if (error) {
      if (error == std::errc::file_exists) {
        throw std::invalid_argument(
            "destination already exists; CadWeb delta was not replaced");
      }
      std::error_code inspectionError;
      const auto destinationStatus =
          std::filesystem::symlink_status(publicationDestination,
                                          inspectionError);
      if (!inspectionError &&
          destinationStatus.type() != std::filesystem::file_type::not_found) {
        throw std::invalid_argument(
            "destination already exists; CadWeb delta was not replaced");
      }
      throw std::system_error(error, "cannot publish CadWeb delta archive");
    }

    std::filesystem::remove(temporaryFile, error);
    if (error) {
      throw std::system_error(
          error, "CadWeb delta was published but temporary cleanup failed");
    }
    std::filesystem::remove(temporaryDirectory, error);
    if (error) {
      throw std::system_error(
          error, "CadWeb delta was published but temporary cleanup failed");
    }
  } catch (...) {
    cleanupTemporaryOutput(temporaryFile, temporaryDirectory);
    throw;
  }
}

}  // namespace cadweb

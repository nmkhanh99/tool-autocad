#include "cadweb/CadWebWriter.h"
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
#include <filesystem>
#include <fstream>
#include <functional>
#include <iomanip>
#include <limits>
#include <locale>
#include <map>
#include <numeric>
#include <optional>
#include <random>
#include <set>
#include <sstream>
#include <stdexcept>
#include <string>
#include <string_view>
#include <system_error>
#include <tuple>
#include <utility>
#include <vector>

namespace cadweb {
namespace {

using Bytes = std::vector<std::uint8_t>;

struct Payload {
  std::string key;
  std::string path;
  std::string encoding;
  bool flatBuffers = false;
  Bytes bytes;
};

bool isFinite(double value) { return std::isfinite(value); }

bool isCanonicalZero(double value) {
  return value == 0.0 && !std::signbit(value);
}

void require(bool condition, const std::string& message) {
  if (!condition) {
    throw std::invalid_argument(message);
  }
}

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
    const auto name =
        std::filesystem::path(".cadweb-tmp-" + randomTemporaryToken(entropy));
    const auto candidate = parent.empty() ? name : parent / name;
    std::error_code error;
    const bool created = std::filesystem::create_directory(candidate, error);
    if (!created) {
      if (!error || error == std::errc::file_exists) {
        continue;
      }
      throw std::system_error(error, "cannot reserve temporary output");
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
                              "cannot secure temporary output directory");
    }
    return candidate;
  }
  throw std::runtime_error("cannot reserve a unique temporary output");
}

void cleanupTemporaryOutput(const std::filesystem::path& file,
                            const std::filesystem::path& directory) noexcept {
  std::error_code ignored;
  std::filesystem::remove(file, ignored);
  ignored.clear();
  std::filesystem::remove(directory, ignored);
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

void validateFiniteValues(const std::vector<double>& values,
                          std::string_view field) {
  require(std::all_of(values.begin(), values.end(), isFinite),
          std::string(field) + " must contain finite values");
}

bool isNormalizedHandle(std::string_view handle) {
  return !handle.empty() && handle.front() != '0' &&
         std::all_of(handle.begin(), handle.end(), [](const char character) {
           return (character >= '0' && character <= '9') ||
                  (character >= 'A' && character <= 'F');
         });
}

void validateCanonicalKey(std::string_view id, std::string_view kind,
                          std::string_view sourceHandle,
                          std::string_view field) {
  require(isNormalizedHandle(sourceHandle),
          std::string(field) + " sourceHandle must be uppercase hexadecimal");
  require(id == std::string(kind) + ":" + std::string(sourceHandle),
          std::string(field) + " must match kind:sourceHandle");
}

void validateCanonicalEntityKey(std::string_view id,
                                std::string_view field) {
  constexpr std::string_view kPrefix = "entity:";
  require(id.size() > kPrefix.size() &&
              id.compare(0U, kPrefix.size(), kPrefix) == 0 &&
              isNormalizedHandle(id.substr(kPrefix.size())),
          std::string(field) + " must be entity:UPPERHEX");
}

void validateEntity(const Entity& entity,
                    const std::set<std::string>& layerIds,
                    std::set<std::string>& objectIds,
                    bool insideBlock, bool canonicalIds) {
  validateUtf8(entity.id, "entity.id");
  validateUtf8(entity.sourceHandle, "entity.sourceHandle");
  validateUtf8(entity.layerId, "entity.layerId");
  validateUtf8(entity.style.linetype, "entity.style.linetype");
  validateUtf8(entity.text, "entity.text");
  validateUtf8(entity.blockDefinitionId, "entity.blockDefinitionId");
  require(!entity.id.empty(), "entity id is required");
  if (canonicalIds) {
    validateCanonicalKey(entity.id, "entity", entity.sourceHandle,
                         "entity.id");
  }
  require(objectIds.insert(entity.id).second,
          "duplicate object id: " + entity.id);
  require(!entity.layerId.empty(), "entity layerId is required: " + entity.id);
  require(layerIds.count(entity.layerId) != 0U,
          "entity references an unknown layer: " + entity.layerId);
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
          "entity lineWeightMm must be finite and non-negative: " + entity.id);
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
          "entity constantWidth must be finite and non-negative: " + entity.id);
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
  validateFiniteValues(entity.bulges, "entity bulges");
  validateFiniteValues(entity.startWidths, "entity startWidths");
  validateFiniteValues(entity.endWidths, "entity endWidths");
  require(std::all_of(entity.startWidths.begin(), entity.startWidths.end(),
                      [](double width) { return width >= 0.0; }) &&
              std::all_of(entity.endWidths.begin(), entity.endWidths.end(),
                          [](double width) { return width >= 0.0; }),
          "entity widths must be non-negative: " + entity.id);

  if (entity.center) {
    validateVec3(*entity.center, "entity center");
  }
  if (entity.normal) {
    validateVec3(*entity.normal, "entity normal");
  }
  if (entity.position) {
    validateVec3(*entity.position, "entity position");
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
      require(entity.center.has_value() && entity.normal.has_value() &&
                  entity.radius > 0.0,
              "arc requires center, normal, and positive radius: " + entity.id);
      break;
    case EntityKind::Circle:
      require(entity.center.has_value() && entity.normal.has_value() &&
                  entity.radius > 0.0,
              "circle requires center, normal, and positive radius: " +
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
      break;
    case EntityKind::Unknown:
      break;
  }

  for (const auto& attribute : entity.attributes) {
    validateUtf8(attribute.id, "attribute.id");
    validateUtf8(attribute.tag, "attribute.tag");
    validateUtf8(attribute.text, "attribute.text");
    require(!attribute.id.empty() && !attribute.tag.empty(),
            "attribute id and tag are required: " + entity.id);
    if (canonicalIds) {
      validateCanonicalEntityKey(attribute.id, "attribute.id");
    }
    require(objectIds.insert(attribute.id).second,
            "duplicate object id: " + attribute.id);
    validateVec3(attribute.position, "attribute position");
    require(isFinite(attribute.rotation) && isFinite(attribute.height) &&
                attribute.height >= 0.0,
            "attribute rotation and height are invalid: " + attribute.id);
  }
}

void validateIssue(const ExportIssue& issue, std::string_view collection) {
  validateUtf8(issue.type, "export issue type");
  validateUtf8(issue.sourceHandle, "export issue sourceHandle");
  validateUtf8(issue.reason, "export issue reason");
  require(!issue.type.empty() && !issue.sourceHandle.empty() &&
              !issue.reason.empty(),
          std::string(collection) +
              " issue requires type, sourceHandle, and reason");
  if (issue.extents) {
    validateExtents(*issue.extents, std::string(collection) + " issue extents");
  }
}

void validateDocument(const CadDocument& document) {
  const bool canonicalIds = document.syncBinding.has_value() ||
                            document.checkpointBinding.has_value();
  require(!(document.syncBinding && document.checkpointBinding),
          "snapshot cannot contain both syncBinding and checkpointBinding");
  validateUtf8(document.producer.application, "producer.application");
  validateUtf8(document.producer.applicationVersion,
               "producer.applicationVersion");
  validateUtf8(document.producer.pluginVersion, "producer.pluginVersion");
  validateUtf8(document.producer.platform, "producer.platform");
  validateUtf8(document.source.fileName, "source.fileName");
  validateUtf8(document.source.dwgVersion, "source.dwgVersion");
  validateUtf8(document.source.drawingFingerprint,
               "source.drawingFingerprint");
  validateUtf8(document.units.name, "units.name");
  validateUtf8(document.xrefPolicy, "xrefPolicy");
  require(!document.producer.application.empty() &&
              !document.producer.applicationVersion.empty() &&
              !document.producer.pluginVersion.empty() &&
              !document.producer.platform.empty(),
          "producer metadata is required");
  require(!document.source.fileName.empty() &&
              !document.source.dwgVersion.empty() &&
              !document.source.drawingFingerprint.empty(),
          "source metadata is required");
  require(document.source.fileName.find('/') == std::string::npos &&
              document.source.fileName.find('\\') == std::string::npos &&
              document.source.fileName != "." &&
              document.source.fileName != "..",
          "source.fileName must not contain a path");
  require(!document.units.name.empty(), "units.name is required");
  if (document.units.metersPerUnit) {
    require(isFinite(*document.units.metersPerUnit) &&
                *document.units.metersPerUnit > 0.0,
            "units.metersPerUnit must be positive or null");
  }
  validateVec3(document.origin, "coordinateSystem.origin");
  validateExtents(document.extents, "extents");
  require(!document.modelEmpty || canonicalIds,
          "modelEmpty is only valid for a revision-bound snapshot");
  if (canonicalIds) {
    require(document.modelEmpty == document.entities.empty(),
            "modelEmpty must match the top-level entity set");
  }
  if (document.modelEmpty) {
    require(isCanonicalZero(document.extents.min.x) &&
                isCanonicalZero(document.extents.min.y) &&
                isCanonicalZero(document.extents.min.z) &&
                isCanonicalZero(document.extents.max.x) &&
                isCanonicalZero(document.extents.max.y) &&
                isCanonicalZero(document.extents.max.z),
            "empty sync model must use canonical zero extents");
  }
  if (document.syncBinding) {
    const auto& binding = *document.syncBinding;
    validateUtf8(binding.drawingId, "syncBinding.drawingId");
    validateUtf8(binding.modelEpoch, "syncBinding.modelEpoch");
    validateUtf8(binding.snapshotId, "syncBinding.snapshotId");
    require(!binding.drawingId.empty() && !binding.modelEpoch.empty() &&
                !binding.snapshotId.empty(),
            "syncBinding identifiers are required");
  }
  if (document.checkpointBinding) {
    const auto& binding = *document.checkpointBinding;
    validateUtf8(binding.drawingId, "checkpointBinding.drawingId");
    validateUtf8(binding.modelEpoch, "checkpointBinding.modelEpoch");
    validateUtf8(binding.checkpointId, "checkpointBinding.checkpointId");
    validateUtf8(binding.stateHash, "checkpointBinding.stateHash");
    require(!binding.drawingId.empty() && !binding.modelEpoch.empty() &&
                !binding.checkpointId.empty() && binding.revision > 0U,
            "checkpointBinding identifiers and revision are required");
    require(binding.stateHash.size() == 64U &&
                std::all_of(binding.stateHash.begin(), binding.stateHash.end(),
                            [](const char character) {
                              return (character >= '0' && character <= '9') ||
                                     (character >= 'a' && character <= 'f');
                            }),
            "checkpointBinding.stateHash must be lowercase SHA-256");
  }
  require(document.xrefPolicy == "reference-only",
          "version 1 supports only reference-only Xref policy");

  std::set<std::string> layerIds;
  for (const auto& layer : document.layers) {
    validateUtf8(layer.id, "layer.id");
    validateUtf8(layer.sourceHandle, "layer.sourceHandle");
    validateUtf8(layer.name, "layer.name");
    validateUtf8(layer.linetype, "layer.linetype");
    require(!layer.id.empty() && !layer.name.empty(),
            "layer id and name are required");
    if (canonicalIds) {
      validateCanonicalKey(layer.id, "layer", layer.sourceHandle,
                           "layer.id");
    }
    require(layerIds.insert(layer.id).second,
            "duplicate layer id: " + layer.id);
    require(std::isfinite(layer.lineWeightMm) && layer.lineWeightMm >= 0.0F,
            "layer lineWeightMm must be finite and non-negative: " + layer.id);
  }

  std::set<std::string> objectIds;
  for (const auto& entity : document.entities) {
    validateEntity(entity, layerIds, objectIds, false, canonicalIds);
  }

  std::set<std::string> blockIds;
  for (const auto& block : document.blocks) {
    validateUtf8(block.id, "block.id");
    validateUtf8(block.sourceHandle, "block.sourceHandle");
    validateUtf8(block.name, "block.name");
    require(!block.id.empty() && !block.name.empty(),
            "block id and name are required");
    if (canonicalIds) {
      validateCanonicalKey(block.id, "block", block.sourceHandle,
                           "block.id");
    }
    require(blockIds.insert(block.id).second,
            "duplicate block id: " + block.id);
    validateVec3(block.basePoint, "block basePoint");
    for (const auto& entity : block.entities) {
      validateEntity(entity, layerIds, objectIds, true, canonicalIds);
    }
  }

  const auto validateBlockReferences = [&blockIds](
                                           const std::vector<Entity>& entities) {
    for (const auto& entity : entities) {
      if (entity.kind == EntityKind::BlockReference) {
        require(blockIds.count(entity.blockDefinitionId) != 0U,
                "dangling block reference: " + entity.id + " -> " +
                    entity.blockDefinitionId);
      }
    }
  };
  validateBlockReferences(document.entities);
  for (const auto& block : document.blocks) {
    validateBlockReferences(block.entities);
  }

  std::map<std::string, std::vector<std::string>> blockGraph;
  for (const auto& block : document.blocks) {
    auto& references = blockGraph[block.id];
    for (const auto& entity : block.entities) {
      if (entity.kind == EntityKind::BlockReference) {
        references.push_back(entity.blockDefinitionId);
      }
    }
    std::sort(references.begin(), references.end());
    references.erase(std::unique(references.begin(), references.end()),
                     references.end());
  }

  // 0 = unvisited, 1 = active DFS path, 2 = fully visited.
  std::map<std::string, std::uint8_t> blockState;
  std::function<void(const std::string&)> visitBlock =
      [&](const std::string& blockId) {
        auto& state = blockState[blockId];
        require(state != 1U, "block reference cycle includes: " + blockId);
        if (state == 2U) {
          return;
        }
        state = 1U;
        for (const auto& referencedId : blockGraph.at(blockId)) {
          visitBlock(referencedId);
        }
        state = 2U;
      };
  for (const auto& item : blockGraph) {
    visitBlock(item.first);
  }

  for (const auto& issue : document.unsupportedEntities) {
    validateIssue(issue, "unsupported");
  }
  for (const auto& issue : document.failedEntities) {
    validateIssue(issue, "failed");
  }
  for (const auto& warning : document.warnings) {
    validateUtf8(warning, "warning");
    require(!warning.empty(), "warnings must not contain empty strings");
  }
  for (const auto& space : document.omittedSpaces) {
    validateUtf8(space, "omitted space");
    require(!space.empty(), "omittedSpaces must not contain empty strings");
  }
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

std::vector<const Layer*> sortedLayers(const CadDocument& document) {
  std::vector<const Layer*> result;
  result.reserve(document.layers.size());
  for (const auto& layer : document.layers) {
    result.push_back(&layer);
  }
  std::sort(result.begin(), result.end(),
            [](const Layer* left, const Layer* right) {
              return left->id < right->id;
            });
  return result;
}

std::vector<const Entity*> sortedEntities(const std::vector<Entity>& entities) {
  std::vector<const Entity*> result;
  result.reserve(entities.size());
  for (const auto& entity : entities) {
    result.push_back(&entity);
  }
  std::sort(result.begin(), result.end(),
            [](const Entity* left, const Entity* right) {
              return left->id < right->id;
            });
  return result;
}

std::vector<const BlockDefinition*> sortedBlocks(const CadDocument& document) {
  std::vector<const BlockDefinition*> result;
  result.reserve(document.blocks.size());
  for (const auto& block : document.blocks) {
    result.push_back(&block);
  }
  std::sort(result.begin(), result.end(),
            [](const BlockDefinition* left, const BlockDefinition* right) {
              return left->id < right->id;
            });
  return result;
}

Bytes buildLayersJson(const CadDocument& document) {
  std::string json = "{\"schemaVersion\":1,\"layers\":[";
  bool first = true;
  for (const auto* layer : sortedLayers(document)) {
    if (!first) {
      json.push_back(',');
    }
    first = false;
    json += "{\"id\":" + jsonString(layer->id);
    if (!layer->sourceHandle.empty()) {
      json += ",\"sourceHandle\":" + jsonString(layer->sourceHandle);
    }
    json += ",\"name\":" + jsonString(layer->name) +
            ",\"visible\":" + jsonBool(layer->visible) +
            ",\"frozen\":" + jsonBool(layer->frozen) +
            ",\"locked\":" + jsonBool(layer->locked) +
            ",\"plot\":" + jsonBool(layer->plot) +
            ",\"colorArgb\":" + std::to_string(layer->colorArgb) +
            ",\"transparency\":" + std::to_string(layer->transparency) +
            ",\"lineWeightMm\":" + jsonNumber(layer->lineWeightMm) +
            ",\"linetype\":" + jsonString(layer->linetype) + "}";
  }
  json += "]}\n";
  return toBytes(json);
}

struct ReportIssue {
  std::string severity;
  std::string code;
  std::string message;
  std::string entityKind;
  std::string sourceHandle;
  std::optional<Extents3> extents;
};

std::string issueJson(const ReportIssue& issue) {
  std::string json = "{\"severity\":" + jsonString(issue.severity) +
                     ",\"code\":" + jsonString(issue.code) +
                     ",\"message\":" + jsonString(issue.message);
  if (!issue.entityKind.empty()) {
    json += ",\"entityKind\":" + jsonString(issue.entityKind);
  }
  if (!issue.sourceHandle.empty()) {
    json += ",\"sourceHandle\":" + jsonString(issue.sourceHandle);
  }
  if (issue.extents) {
    json += ",\"extents\":{\"min\":" + jsonVec3(issue.extents->min) +
            ",\"max\":" + jsonVec3(issue.extents->max) + "}";
  }
  json.push_back('}');
  return json;
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

std::string jsonStringArray(std::vector<std::string> values) {
  std::sort(values.begin(), values.end());
  std::string json = "[";
  for (std::size_t index = 0; index < values.size(); ++index) {
    if (index != 0U) {
      json.push_back(',');
    }
    json += jsonString(values[index]);
  }
  json.push_back(']');
  return json;
}

Bytes buildExportReportJson(const CadDocument& document) {
  std::vector<ReportIssue> issues;
  issues.reserve(document.unsupportedEntities.size() +
                 document.failedEntities.size() + document.warnings.size() +
                 document.omittedSpaces.size());
  for (const auto& issue : document.unsupportedEntities) {
    issues.push_back(ReportIssue{"warning", "unsupported-entity",
                                 issue.reason, issue.type,
                                 issue.sourceHandle, issue.extents});
  }
  for (const auto& issue : document.failedEntities) {
    issues.push_back(ReportIssue{"error", "entity-export-failed",
                                 issue.reason, issue.type,
                                 issue.sourceHandle, issue.extents});
  }
  for (const auto& warning : document.warnings) {
    issues.push_back(
        ReportIssue{"warning", "export-warning", warning, "", "", {}});
  }
  for (const auto& space : document.omittedSpaces) {
    issues.push_back(ReportIssue{"warning", "space-omitted",
                                 "Space omitted: " + space, "", "", {}});
  }
  std::sort(issues.begin(), issues.end(),
            [](const ReportIssue& left, const ReportIssue& right) {
              const auto key = [](const ReportIssue& issue) {
                const auto extents =
                    issue.extents
                        ? jsonVec3(issue.extents->min) +
                              jsonVec3(issue.extents->max)
                        : std::string{};
                return std::make_tuple(issue.severity, issue.code,
                                       issue.message, issue.entityKind,
                                       issue.sourceHandle, extents);
              };
              return key(left) < key(right);
            });

  const auto warningCount = static_cast<std::size_t>(std::count_if(
      issues.begin(), issues.end(), [](const ReportIssue& issue) {
        return issue.severity == "warning";
      }));
  const auto errorCount = issues.size() - warningCount;
  const auto exportedCount =
      document.entities.size() +
      static_cast<std::size_t>(std::accumulate(
          document.blocks.begin(), document.blocks.end(), std::size_t{0},
          [](std::size_t count, const BlockDefinition& block) {
            return count + block.entities.size();
          }));
  const auto skippedCount = document.unsupportedEntities.size() +
                            document.failedEntities.size();
  const auto status = errorCount != 0U && exportedCount == 0U
                          ? "failed"
                          : issues.empty() ? "complete" : "partial";

  std::string json =
      "{\"schemaVersion\":1,\"status\":" +
      jsonString(status) +
      ",\"xrefPolicy\":" + jsonString(document.xrefPolicy) +
      ",\"counts\":{\"exported\":" + std::to_string(exportedCount) +
      ",\"skipped\":" + std::to_string(skippedCount) +
      ",\"warnings\":" + std::to_string(warningCount) +
      ",\"errors\":" + std::to_string(errorCount) + "},\"issues\":[";
  for (std::size_t index = 0; index < issues.size(); ++index) {
    if (index != 0U) {
      json.push_back(',');
    }
    json += issueJson(issues[index]);
  }
  json += "],\"omittedSpaces\":" +
          jsonStringArray(document.omittedSpaces) + "}\n";
  return toBytes(json);
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
      builder, entity.id.c_str(),
      entity.sourceHandle.empty() ? nullptr : entity.sourceHandle.c_str(),
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

Bytes buildEntitiesFlatBuffer(const CadDocument& document) {
  ::flatbuffers::FlatBufferBuilder builder;
  std::vector<::flatbuffers::Offset<CadWeb::V1::Entity>> offsets;
  for (const auto* entity : sortedEntities(document.entities)) {
    offsets.push_back(buildEntity(builder, *entity));
  }
  const auto entities = builder.CreateVector(offsets);
  const auto root = CadWeb::V1::CreateGeometryBuffer(
      builder, 1U, CadWeb::V1::BufferKind::Entities, entities, 0);
  CadWeb::V1::FinishGeometryBufferBuffer(builder, root);
  return finishFlatBuffer(builder);
}

Bytes buildBlocksFlatBuffer(const CadDocument& document) {
  ::flatbuffers::FlatBufferBuilder builder;
  std::vector<::flatbuffers::Offset<CadWeb::V1::BlockDefinition>> offsets;
  for (const auto* block : sortedBlocks(document)) {
    std::vector<::flatbuffers::Offset<CadWeb::V1::Entity>> entityOffsets;
    for (const auto* entity : sortedEntities(block->entities)) {
      entityOffsets.push_back(buildEntity(builder, *entity));
    }
    const auto basePoint = toFlatBuffer(block->basePoint);
    offsets.push_back(CadWeb::V1::CreateBlockDefinitionDirect(
        builder, block->id.c_str(),
        block->sourceHandle.empty() ? nullptr : block->sourceHandle.c_str(),
        block->name.c_str(), &basePoint, &entityOffsets));
  }
  const auto blocks = builder.CreateVector(offsets);
  const auto root = CadWeb::V1::CreateGeometryBuffer(
      builder, 1U, CadWeb::V1::BufferKind::Blocks, 0, blocks);
  CadWeb::V1::FinishGeometryBufferBuffer(builder, root);
  return finishFlatBuffer(builder);
}

bool hasBlockReference(const CadDocument& document) {
  const auto containsReference = [](const std::vector<Entity>& entities) {
    return std::any_of(entities.begin(), entities.end(),
                       [](const Entity& entity) {
                         return entity.kind == EntityKind::BlockReference;
                       });
  };
  if (containsReference(document.entities)) {
    return true;
  }
  return std::any_of(document.blocks.begin(), document.blocks.end(),
                     [&containsReference](const BlockDefinition& block) {
                       return containsReference(block.entities);
                     });
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

Bytes buildManifestJson(const CadDocument& document,
                        const std::vector<Payload>& payloads) {
  std::string json =
      "{\"format\":\"cadweb\",\"formatVersion\":{\"major\":1,\"minor\":2},"
      "\"producer\":{\"application\":" +
      jsonString(document.producer.application) +
      ",\"applicationVersion\":" +
      jsonString(document.producer.applicationVersion) +
      ",\"pluginVersion\":" + jsonString(document.producer.pluginVersion) +
      ",\"platform\":" + jsonString(document.producer.platform) +
      "},\"source\":{\"fileName\":" +
      jsonString(document.source.fileName) + ",\"dwgVersion\":" +
      jsonString(document.source.dwgVersion) +
      ",\"drawingFingerprint\":" +
      jsonString(document.source.drawingFingerprint) +
      "},\"units\":{\"name\":" + jsonString(document.units.name) +
      ",\"metersPerUnit\":";
  json += document.units.metersPerUnit
              ? jsonNumber(*document.units.metersPerUnit)
              : "null";
  json += "},\"coordinateSystem\":{\"space\":\"WCS\",\"upAxis\":\"Z\","
          "\"origin\":" +
          jsonVec3(document.origin) + "},\"extents\":{\"min\":" +
          jsonVec3(document.extents.min) + ",\"max\":" +
          jsonVec3(document.extents.max) + "}";
  if (document.syncBinding) {
    const auto& binding = *document.syncBinding;
    json += ",\"modelEmpty\":";
    json += jsonBool(document.modelEmpty);
    json += ",\"syncBinding\":{\"drawingId\":" +
            jsonString(binding.drawingId) + ",\"modelEpoch\":" +
            jsonString(binding.modelEpoch) + ",\"snapshotId\":" +
            jsonString(binding.snapshotId) + ",\"baseRevision\":" +
            std::to_string(binding.baseRevision) + "}";
  } else if (document.checkpointBinding) {
    const auto& binding = *document.checkpointBinding;
    json += ",\"modelEmpty\":";
    json += jsonBool(document.modelEmpty);
    json += ",\"checkpointBinding\":{\"drawingId\":" +
            jsonString(binding.drawingId) + ",\"modelEpoch\":" +
            jsonString(binding.modelEpoch) + ",\"checkpointId\":" +
            jsonString(binding.checkpointId) + ",\"revision\":" +
            std::to_string(binding.revision) + ",\"stateHash\":" +
            jsonString(binding.stateHash) + "}";
  }
  json += ",\"xrefPolicy\":" + jsonString(document.xrefPolicy) +
          ",\"files\":{";

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

}  // namespace

namespace detail {

void validateProducerSizes(const std::vector<ProducerEntrySize>& entries) {
  if (entries.size() > limits::kMaxEntries) {
    throw std::length_error("CadWeb archive exceeds the 128-entry limit");
  }

  const auto checkedAdd = [](std::size_t& total, std::size_t value,
                             const char* label) {
    if (value > std::numeric_limits<std::size_t>::max() - total) {
      throw std::length_error(std::string(label) + " size overflow");
    }
    total += value;
  };

  std::size_t uncompressedBytes = 0U;
  std::size_t archiveBytes = 22U;  // End-of-central-directory record.
  for (const auto& entry : entries) {
    if (entry.bytes > limits::kMaxEntryUncompressedBytes) {
      throw std::length_error(std::string(entry.path) +
                              " exceeds the 128 MiB entry limit");
    }
    if ((entry.path == "manifest.json" || entry.path == "change.json") &&
        entry.bytes > limits::kMaxManifestBytes) {
      throw std::length_error(std::string(entry.path) +
                              " exceeds the 1 MiB envelope limit");
    }
    if (entry.json && entry.path != "manifest.json" &&
        entry.path != "change.json" &&
        entry.bytes > limits::kMaxJsonPayloadBytes) {
      throw std::length_error(std::string(entry.path) +
                              " exceeds the 16 MiB JSON limit");
    }

    checkedAdd(uncompressedBytes, entry.bytes, "uncompressed payload");
    if (uncompressedBytes > limits::kMaxTotalUncompressedBytes) {
      throw std::length_error(
          "CadWeb payloads exceed the 256 MiB uncompressed limit");
    }

    // ZIP-store uses 30-byte local and 46-byte central headers, each with the
    // path bytes, plus the uncompressed payload itself.
    checkedAdd(archiveBytes, 76U, "ZIP-store archive");
    checkedAdd(archiveBytes, entry.path.size(), "ZIP-store archive");
    checkedAdd(archiveBytes, entry.path.size(), "ZIP-store archive");
    checkedAdd(archiveBytes, entry.bytes, "ZIP-store archive");
    if (archiveBytes > limits::kMaxArchiveBytes) {
      throw std::length_error("CadWeb archive exceeds the 256 MiB limit");
    }
  }
}

}  // namespace detail

std::vector<std::uint8_t> CadWebWriter::build(
    const CadDocument& document) const {
  validateDocument(document);

  std::vector<Payload> payloads;
  const auto appendPayload = [&payloads](Payload payload) {
    detail::validateProducerSizes({detail::ProducerEntrySize{
        payload.path, payload.bytes.size(), payload.encoding == "json"}});
    payloads.push_back(std::move(payload));
  };
  appendPayload(Payload{"layers", "layers.json", "json", false,
                        buildLayersJson(document)});
  appendPayload(Payload{"entities", "entities.bin", "flatbuffers", true,
                        buildEntitiesFlatBuffer(document)});
  if (!document.blocks.empty() || hasBlockReference(document)) {
    appendPayload(Payload{"blocks", "blocks.bin", "flatbuffers", true,
                          buildBlocksFlatBuffer(document)});
  }
  appendPayload(Payload{"exportReport", "export-report.json", "json", false,
                        buildExportReportJson(document)});

  std::vector<detail::ZipEntry> entries;
  entries.reserve(payloads.size() + 1U);
  entries.push_back(
      detail::ZipEntry{"manifest.json", buildManifestJson(document, payloads)});
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
    throw std::length_error("CadWeb archive exceeds the 256 MiB limit");
  }
  return archive;
}

void CadWebWriter::writeAtomically(
    const CadDocument& document,
    const std::filesystem::path& destination) const {
  require(!destination.empty() && !destination.filename().empty(),
          "destination file name is required");
  std::error_code pathError;
  const auto publicationDestination =
      std::filesystem::absolute(destination, pathError);
  if (pathError) {
    throw std::system_error(pathError, "cannot resolve destination path");
  }
  const auto archive = build(document);
  require(archive.size() <=
              static_cast<std::size_t>(
                  std::numeric_limits<std::streamsize>::max()),
          "archive is too large for the output stream");

  const auto temporaryDirectory =
      createPrivateTemporaryDirectory(publicationDestination.parent_path());
  const auto temporaryFile = temporaryDirectory / "payload";
  try {
    std::ofstream stream(temporaryFile, std::ios::binary | std::ios::trunc);
    if (!stream) {
      throw std::runtime_error("cannot create temporary output");
    }
    stream.write(reinterpret_cast<const char*>(archive.data()),
                 static_cast<std::streamsize>(archive.size()));
    stream.flush();
    if (!stream) {
      throw std::runtime_error("cannot write temporary output");
    }
    stream.close();
    if (!stream) {
      throw std::runtime_error("cannot close temporary output");
    }

    // A hard-link create is the C++17 filesystem primitive that both publishes
    // a complete sibling file atomically and fails when destination exists.
    std::error_code error;
    std::filesystem::create_hard_link(temporaryFile, publicationDestination,
                                      error);
    if (error) {
      if (error == std::errc::file_exists) {
        throw std::invalid_argument(
            "destination already exists; CadWeb output was not replaced");
      }
      std::error_code inspectionError;
      const auto destinationStatus =
          std::filesystem::symlink_status(publicationDestination,
                                          inspectionError);
      if (!inspectionError &&
          destinationStatus.type() != std::filesystem::file_type::not_found) {
        throw std::invalid_argument(
            "destination already exists; CadWeb output was not replaced");
      }
      throw std::system_error(error, "cannot publish CadWeb archive");
    }

    std::filesystem::remove(temporaryFile, error);
    if (error) {
      throw std::system_error(
          error, "CadWeb archive was published but temporary cleanup failed");
    }
    std::filesystem::remove(temporaryDirectory, error);
    if (error) {
      throw std::system_error(
          error, "CadWeb archive was published but temporary cleanup failed");
    }
  } catch (...) {
    cleanupTemporaryOutput(temporaryFile, temporaryDirectory);
    throw;
  }
}

}  // namespace cadweb

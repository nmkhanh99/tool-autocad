#include "CadWebAcDbAdapter.h"

#include <AcCmColor.h>
#include <AcString.h>
#include <dbents.h>
#include <dbmain.h>
#include <dbmtext.h>
#include <dbpl.h>
#include <dbsymtb.h>
#include <dbxutil.h>

#include <algorithm>
#include <cmath>
#include <map>
#include <set>
#include <stdexcept>
#include <string>
#include <utility>

namespace cadweb::objectarx {
namespace {

constexpr const char* kPluginVersion = "0.1.0";

Vec3 point(const AcGePoint3d& value) {
  return {value.x, value.y, value.z};
}

Vec3 vector(const AcGeVector3d& value) {
  return {value.x, value.y, value.z};
}

std::string utf8(const ACHAR* value) {
  return value ? AcString(value).utf8Str() : std::string{};
}

std::string handleOf(AcDbObject* object) {
  if (!object) return {};
  AcDbHandle handle;
  object->getAcDbHandle(handle);
  ACHAR buffer[32] = {};
  handle.getIntoAsciiBuffer(buffer);
  return utf8(buffer);
}

std::string handleOf(AcDbObjectId id) {
  if (id.isNull()) return {};
  const AcDbHandle handle = id.handle();
  ACHAR buffer[32] = {};
  handle.getIntoAsciiBuffer(buffer);
  return utf8(buffer);
}

std::string typeOf(AcDbObject* object) {
  if (!object || !object->isA()) return "UNKNOWN";
  const ACHAR* dxfName = object->isA()->dxfName();
  if (dxfName && *dxfName) return utf8(dxfName);
  return utf8(object->isA()->name());
}

std::uint32_t argb(const AcCmColor& color) {
  return 0xff000000U | (static_cast<std::uint32_t>(color.red()) << 16U) |
         (static_cast<std::uint32_t>(color.green()) << 8U) |
         static_cast<std::uint32_t>(color.blue());
}

std::uint8_t transparencyAmount(const AcCmTransparency& transparency) {
  // ObjectARX alpha is opacity (255 = solid); CadWeb stores transparency
  // amount (0 = opaque).
  return static_cast<std::uint8_t>(255U - transparency.alpha());
}

float lineWeightMillimetres(AcDb::LineWeight lineWeight) {
  const int hundredths = static_cast<int>(lineWeight);
  return hundredths >= 0 ? static_cast<float>(hundredths) / 100.0F : 0.0F;
}

PropertySourceMode sourceMode(const AcCmColor& color) {
  if (color.isByLayer()) return PropertySourceMode::ByLayer;
  if (color.isByBlock()) return PropertySourceMode::ByBlock;
  return PropertySourceMode::Explicit;
}

PropertySourceMode sourceMode(const AcCmTransparency& transparency) {
  if (transparency.isByLayer()) return PropertySourceMode::ByLayer;
  if (transparency.isByBlock()) return PropertySourceMode::ByBlock;
  return PropertySourceMode::Explicit;
}

PropertySourceMode sourceMode(AcDb::LineWeight lineWeight) {
  if (lineWeight == AcDb::kLnWtByLayer) return PropertySourceMode::ByLayer;
  if (lineWeight == AcDb::kLnWtByBlock) return PropertySourceMode::ByBlock;
  return PropertySourceMode::Explicit;
}

PropertySourceMode linetypeSourceMode(AcDbEntity* entity) {
  AcDbDatabase* database = entity ? entity->database() : nullptr;
  if (!database) return PropertySourceMode::Explicit;
  const AcDbObjectId linetypeId = entity->linetypeId();
  if (linetypeId == database->byLayerLinetype())
    return PropertySourceMode::ByLayer;
  if (linetypeId == database->byBlockLinetype())
    return PropertySourceMode::ByBlock;
  return PropertySourceMode::Explicit;
}

std::optional<Extents3> extentsOf(AcDbEntity* entity) {
  AcDbExtents extents;
  if (!entity || entity->getGeomExtents(extents) != Acad::eOk) return std::nullopt;
  const AcGePoint3d minimum = extents.minPoint();
  const AcGePoint3d maximum = extents.maxPoint();
  if (!std::isfinite(minimum.x) || !std::isfinite(minimum.y) ||
      !std::isfinite(minimum.z) || !std::isfinite(maximum.x) ||
      !std::isfinite(maximum.y) || !std::isfinite(maximum.z) ||
      minimum.x > maximum.x || minimum.y > maximum.y ||
      minimum.z > maximum.z) {
    return std::nullopt;
  }
  return Extents3{point(minimum), point(maximum)};
}

std::string unitName(AcDb::UnitsValue value) {
  switch (value) {
    case AcDb::kUnitsUndefined: return "unitless";
    case AcDb::kUnitsInches: return "inches";
    case AcDb::kUnitsFeet: return "feet";
    case AcDb::kUnitsMiles: return "miles";
    case AcDb::kUnitsMillimeters: return "millimeters";
    case AcDb::kUnitsCentimeters: return "centimeters";
    case AcDb::kUnitsMeters: return "meters";
    case AcDb::kUnitsKilometers: return "kilometers";
    case AcDb::kUnitsMicroinches: return "microinches";
    case AcDb::kUnitsMils: return "mils";
    case AcDb::kUnitsYards: return "yards";
    case AcDb::kUnitsAngstroms: return "angstroms";
    case AcDb::kUnitsNanometers: return "nanometers";
    case AcDb::kUnitsMicrons: return "microns";
    case AcDb::kUnitsDecimeters: return "decimeters";
    case AcDb::kUnitsDekameters: return "dekameters";
    case AcDb::kUnitsHectometers: return "hectometers";
    case AcDb::kUnitsGigameters: return "gigameters";
    case AcDb::kUnitsAstronomical: return "astronomical-units";
    case AcDb::kUnitsLightYears: return "light-years";
    case AcDb::kUnitsParsecs: return "parsecs";
    case AcDb::kUnitsUSSurveyFeet: return "us-survey-feet";
    case AcDb::kUnitsUSSurveyInch: return "us-survey-inches";
    case AcDb::kUnitsUSSurveyYard: return "us-survey-yards";
    case AcDb::kUnitsUSSurveyMile: return "us-survey-miles";
    default: return "unknown";
  }
}

std::string dwgVersionName(AcDb::AcDbDwgVersion value) {
  switch (value) {
    case AcDb::kDHL_1032: return "AC1032";
    case AcDb::kDHL_1027: return "AC1027";
    case AcDb::kDHL_1024: return "AC1024";
    case AcDb::kDHL_1021: return "AC1021";
    case AcDb::kDHL_1800: return "AC1018";
    case AcDb::kDHL_1015: return "AC1015";
    case AcDb::kDHL_1014: return "AC1014";
    case AcDb::kDHL_1012: return "AC1012";
    default: return "unknown";
  }
}

std::string platformName() {
#if defined(_WIN64)
  return "windows-x64";
#elif defined(__aarch64__) || defined(__arm64__)
  return "macos-arm64";
#elif defined(__x86_64__)
  return "macos-x64";
#else
  return "unknown-native";
#endif
}

struct Context {
  AcDbDatabase* database = nullptr;
  CadDocument document;
  std::string fingerprint;
  bool canonicalIds = false;
  std::optional<Vec3> fixedOrigin;
  std::map<std::string, Layer> layersByHandle;
  std::set<std::string> warningSet;
  std::optional<Extents3> payloadExtents;

  std::string stableEntityId(const std::string& handle) const {
    return canonicalIds ? "entity:" + handle : fingerprint + ":" + handle;
  }

  std::string stableLayerId(const std::string& handle) const {
    return canonicalIds ? "layer:" + handle
                        : fingerprint + ":layer:" + handle;
  }

  std::string stableBlockId(const std::string& handle) const {
    return canonicalIds ? "block:" + handle
                        : fingerprint + ":block:" + handle;
  }

  void warn(const std::string& warning) {
    if (warningSet.insert(warning).second) document.warnings.push_back(warning);
  }

  void includePayloadExtents(AcDbEntity* entity) {
    const auto candidate = extentsOf(entity);
    if (!candidate) return;
    if (!payloadExtents) {
      payloadExtents = candidate;
      return;
    }
    payloadExtents->min.x = std::min(payloadExtents->min.x, candidate->min.x);
    payloadExtents->min.y = std::min(payloadExtents->min.y, candidate->min.y);
    payloadExtents->min.z = std::min(payloadExtents->min.z, candidate->min.z);
    payloadExtents->max.x = std::max(payloadExtents->max.x, candidate->max.x);
    payloadExtents->max.y = std::max(payloadExtents->max.y, candidate->max.y);
    payloadExtents->max.z = std::max(payloadExtents->max.z, candidate->max.z);
  }

  void finishPayloadExtents() {
    if (payloadExtents) {
      document.extents = *payloadExtents;
      document.origin = fixedOrigin.value_or(payloadExtents->min);
    } else {
      document.extents = {};
      document.origin = fixedOrigin.value_or(Vec3{});
      warn("payload_extents_unavailable");
    }
    if (canonicalIds) {
      document.modelEmpty = document.entities.empty();
    }
  }
};

Layer fallbackLayer(Context& context, AcDbObjectId layerId) {
  const std::string sourceHandle = handleOf(layerId);
  Layer layer;
  layer.id = context.stableLayerId(sourceHandle.empty() ? "unknown" : sourceHandle);
  layer.sourceHandle = sourceHandle;
  layer.name = "<unavailable>";
  context.warn("entity_layer_unavailable");
  return layer;
}

const Layer& layerFor(Context& context, AcDbObjectId layerId) {
  const std::string sourceHandle = handleOf(layerId);
  const auto found = context.layersByHandle.find(sourceHandle);
  if (found != context.layersByHandle.end()) return found->second;
  Layer layer = fallbackLayer(context, layerId);
  const auto inserted = context.layersByHandle.emplace(sourceHandle, std::move(layer));
  return inserted.first->second;
}

EntityStyle styleOf(Context& context, AcDbEntity* entity) {
  const Layer& layer = layerFor(context, entity->layerId());
  EntityStyle style;
  // Entity visibility and layer state are separate contract fields. Keeping
  // them separate lets the viewer explicitly turn an off/frozen layer on.
  style.visible = entity->visibility() == AcDb::kVisible;
  style.colorArgb = layer.colorArgb;
  style.transparency = layer.transparency;
  style.lineWeightMm = layer.lineWeightMm;
  style.linetype = layer.linetype;

  const AcCmColor color = entity->color();
  style.colorSourceMode = sourceMode(color);
  if (style.colorSourceMode == PropertySourceMode::Explicit)
    style.colorArgb = argb(color);

  const AcCmTransparency transparency = entity->transparency();
  style.transparencySourceMode = sourceMode(transparency);
  if (style.transparencySourceMode == PropertySourceMode::Explicit &&
      transparency.isByAlpha())
    style.transparency = transparencyAmount(transparency);

  const AcDb::LineWeight lineWeight = entity->lineWeight();
  style.lineWeightSourceMode = sourceMode(lineWeight);
  if (style.lineWeightSourceMode == PropertySourceMode::Explicit &&
      static_cast<int>(lineWeight) >= 0)
    style.lineWeightMm = lineWeightMillimetres(lineWeight);

  AcString linetype;
  if (entity->linetype(linetype) == Acad::eOk) {
    style.linetypeSourceMode = linetypeSourceMode(entity);
    const std::string name = linetype.utf8Str();
    if (!name.empty() &&
        style.linetypeSourceMode == PropertySourceMode::Explicit)
      style.linetype = name;
  }
  return style;
}

ExportIssue issueFor(AcDbEntity* entity, const std::string& reason) {
  ExportIssue issue;
  issue.type = typeOf(entity);
  issue.sourceHandle = handleOf(entity);
  issue.extents = extentsOf(entity);
  issue.reason = reason;
  return issue;
}

Matrix4 matrix(const AcGeMatrix3d& source) {
  Matrix4 result;
  for (unsigned row = 0; row < 4; ++row) {
    for (unsigned column = 0; column < 4; ++column)
      result.values[row * 4U + column] = source(row, column);
  }
  return result;
}

bool finite(const Vec3& value) {
  return std::isfinite(value.x) && std::isfinite(value.y) &&
         std::isfinite(value.z);
}

bool finite(const Matrix4& value) {
  return std::all_of(value.values.begin(), value.values.end(),
                     [](double item) { return std::isfinite(item); });
}

// Keep corrupt or degenerate AcDb geometry local to one export-report entry.
// The portable writer intentionally validates the whole DTO graph, so letting
// an invalid converted entity through would otherwise abort the entire export.
std::string convertedEntityError(const Entity& entity) {
  if (entity.id.empty() || entity.sourceHandle.empty() ||
      entity.layerId.empty() ||
      !std::isfinite(entity.style.lineWeightMm) ||
      entity.style.lineWeightMm < 0.0F) {
    return "converted entity metadata is invalid";
  }
  if (!std::all_of(entity.points.begin(), entity.points.end(),
                   [](const Vec3& value) { return finite(value); }) ||
      !std::all_of(entity.bulges.begin(), entity.bulges.end(),
                   [](double value) { return std::isfinite(value); }) ||
      !std::all_of(entity.startWidths.begin(), entity.startWidths.end(),
                   [](double value) {
                     return std::isfinite(value) && value >= 0.0;
                   }) ||
      !std::all_of(entity.endWidths.begin(), entity.endWidths.end(),
                   [](double value) {
                     return std::isfinite(value) && value >= 0.0;
                   }) ||
      !std::isfinite(entity.constantWidth) || entity.constantWidth < 0.0) {
    return "converted entity geometry contains invalid numeric values";
  }
  if ((entity.center && !finite(*entity.center)) ||
      (entity.normal && !finite(*entity.normal)) ||
      (entity.position && !finite(*entity.position)) ||
      !std::isfinite(entity.radius) || !std::isfinite(entity.startAngle) ||
      !std::isfinite(entity.endAngle) || !std::isfinite(entity.rotation) ||
      !std::isfinite(entity.height) || entity.height < 0.0 ||
      (entity.transform && !finite(*entity.transform))) {
    return "converted entity geometry contains invalid numeric values";
  }

  switch (entity.kind) {
    case EntityKind::Line:
      if (entity.points.size() != 2U)
        return "line does not contain exactly two points";
      break;
    case EntityKind::Polyline: {
      if (entity.points.size() < 2U)
        return "lightweight polyline contains fewer than two vertices";
      const auto matchesPointCount = [&entity](const std::vector<double>& values) {
        return values.empty() || values.size() == entity.points.size();
      };
      if (!matchesPointCount(entity.bulges) ||
          !matchesPointCount(entity.startWidths) ||
          !matchesPointCount(entity.endWidths)) {
        return "lightweight-polyline arrays do not match its vertex count";
      }
      break;
    }
    case EntityKind::Arc:
    case EntityKind::Circle:
      if (!entity.center || !entity.normal || entity.radius <= 0.0)
        return "arc or circle has no finite positive radius";
      break;
    case EntityKind::Text:
    case EntityKind::MText:
      if (!entity.position || entity.height <= 0.0)
        return "text has no finite positive height";
      break;
    case EntityKind::BlockReference:
      if (entity.blockDefinitionId.empty() || !entity.transform)
        return "block reference has no definition or transform";
      break;
    case EntityKind::Unknown:
      return "converted entity kind is unknown";
  }
  return {};
}

bool convertEntity(Context& context, AcDbEntity* source, SpaceKind space,
                   Entity& target, std::string& error) {
  target.id = context.stableEntityId(handleOf(source));
  target.sourceHandle = handleOf(source);
  target.layerId = layerFor(context, source->layerId()).id;
  target.space = space;
  target.style = styleOf(context, source);

  if (AcDbLine* line = AcDbLine::cast(source)) {
    target.kind = EntityKind::Line;
    target.points = {point(line->startPoint()), point(line->endPoint())};
    target.normal = vector(line->normal());
    return true;
  }

  if (AcDbPolyline* polyline = AcDbPolyline::cast(source)) {
    target.kind = EntityKind::Polyline;
    const unsigned vertexCount = polyline->numVerts();
    target.points.reserve(vertexCount);
    target.bulges.reserve(vertexCount);
    target.startWidths.reserve(vertexCount);
    target.endWidths.reserve(vertexCount);
    for (unsigned index = 0; index < vertexCount; ++index) {
      AcGePoint3d vertex;
      double bulge = 0.0;
      double startWidth = 0.0;
      double endWidth = 0.0;
      if (polyline->getPointAt(index, vertex) != Acad::eOk ||
          polyline->getBulgeAt(index, bulge) != Acad::eOk ||
          polyline->getWidthsAt(index, startWidth, endWidth) != Acad::eOk) {
        error = "cannot read every lightweight-polyline vertex";
        return false;
      }
      target.points.push_back(point(vertex));
      target.bulges.push_back(bulge);
      target.startWidths.push_back(startWidth);
      target.endWidths.push_back(endWidth);
    }
    double constantWidth = 0.0;
    if (polyline->getConstantWidth(constantWidth) == Acad::eOk)
      target.constantWidth = constantWidth;
    target.closed = polyline->isClosed();
    target.normal = vector(polyline->normal());
    return true;
  }

  if (AcDbArc* arc = AcDbArc::cast(source)) {
    target.kind = EntityKind::Arc;
    target.center = point(arc->center());
    target.radius = arc->radius();
    target.startAngle = arc->startAngle();
    target.endAngle = arc->endAngle();
    target.normal = vector(arc->normal());
    return true;
  }

  if (AcDbCircle* circle = AcDbCircle::cast(source)) {
    target.kind = EntityKind::Circle;
    target.center = point(circle->center());
    target.radius = circle->radius();
    target.normal = vector(circle->normal());
    return true;
  }

  // Attribute definitions derive from AcDbText but are not plain text
  // geometry. Version 1 stores supported attribute instances on each block
  // reference; definition flags/prompts need a future schema revision.
  if (AcDbAttributeDefinition::cast(source)) {
    error = "entity type is not supported by CadWeb v1";
    return false;
  }

  if (AcDbMText* mtext = AcDbMText::cast(source)) {
    target.kind = EntityKind::MText;
    target.position = point(mtext->location());
    target.normal = vector(mtext->normal());
    target.rotation = mtext->rotation();
    target.height = mtext->textHeight();
    AcString contents;
    if (mtext->contents(contents) != Acad::eOk) {
      error = "cannot read MText contents";
      return false;
    }
    target.text = contents.utf8Str();
    return true;
  }

  if (AcDbText* text = AcDbText::cast(source)) {
    target.kind = EntityKind::Text;
    target.position = point(text->position());
    target.normal = vector(text->normal());
    target.rotation = text->rotation();
    target.height = text->height();
    AcString contents;
    if (text->textString(contents) != Acad::eOk) {
      error = "cannot read Text contents";
      return false;
    }
    target.text = contents.utf8Str();
    return true;
  }

  // MINSERT is a block-reference subclass whose row/column replication cannot
  // be represented by the single-transform BlockReference record in v1.
  if (AcDbMInsertBlock::cast(source)) {
    error = "entity type is not supported by CadWeb v1";
    return false;
  }

  if (AcDbBlockReference* reference = AcDbBlockReference::cast(source)) {
    const AcDbObjectId definitionId = reference->blockTableRecord();
    if (definitionId.isNull() || definitionId.database() != context.database ||
        definitionId.isErased() || definitionId.isEffectivelyErased()) {
      error = "cannot resolve the referenced block definition";
      return false;
    }
    AcDbBlockTableRecord* definition = nullptr;
    const Acad::ErrorStatus definitionStatus =
        acdbOpenObject(definition, definitionId, AcDb::kForRead);
    if (definitionStatus != Acad::eOk || !definition) {
      if (definition) definition->close();
      error = "cannot resolve the referenced block definition";
      return false;
    }
    const bool referencesLayout = definition->isLayout();
    definition->close();
    if (referencesLayout) {
      error = "block reference points to a layout record";
      return false;
    }
    target.kind = EntityKind::BlockReference;
    target.position = point(reference->position());
    target.normal = vector(reference->normal());
    target.rotation = reference->rotation();
    target.blockDefinitionId =
        context.stableBlockId(handleOf(definitionId));
    target.transform = matrix(reference->blockTransform());

    AcDbObjectIterator* iterator = reference->attributeIterator();
    if (iterator) {
      for (; !iterator->done(); iterator->step()) {
        AcDbAttribute* attribute = nullptr;
        if (reference->openAttribute(attribute, iterator->objectId(),
                                     AcDb::kForRead) != Acad::eOk ||
            !attribute) {
          context.warn("block_attribute_unavailable:" + target.sourceHandle);
          continue;
        }
        const std::string attributeHandle = handleOf(attribute);
        if (attribute->isInvisible()) {
          // V1 has no attribute-visibility field. Preserve the tag/value as
          // metadata and report the lost display semantic instead of dropping
          // a hidden attribute that may carry application data.
          context.warn(
              "invisible_block_attribute_visibility_flattened:" +
              attributeHandle);
        }
        if (attribute->isMTextAttribute()) {
          context.warn("mtext_block_attribute_flattened:" + attributeHandle);
        }
        Attribute output;
        output.id = context.stableEntityId(attributeHandle);
        AcString tag;
        AcString contents;
        if (attribute->tag(tag) != Acad::eOk ||
            attribute->textString(contents) != Acad::eOk) {
          context.warn("block_attribute_text_unavailable:" + attributeHandle);
          attribute->close();
          continue;
        }
        output.tag = tag.utf8Str();
        output.text = contents.utf8Str();
        output.position = point(attribute->position());
        output.rotation = attribute->rotation();
        output.height = attribute->height();
        if (attributeHandle.empty() || output.id.empty() || output.tag.empty() ||
            !finite(output.position) || !std::isfinite(output.rotation) ||
            !std::isfinite(output.height) || output.height < 0.0) {
          context.warn("invalid_block_attribute_omitted:" + attributeHandle);
          attribute->close();
          continue;
        }
        target.attributes.push_back(std::move(output));
        attribute->close();
      }
      delete iterator;
    }
    return true;
  }

  error = "entity type is not supported by CadWeb v1";
  return false;
}

void collectLayers(Context& context) {
  AcDbLayerTable* table = nullptr;
  if (context.database->getLayerTable(table, AcDb::kForRead) != Acad::eOk || !table)
    throw std::runtime_error("cannot open the AutoCAD layer table");

  AcDbLayerTableIterator* iterator = nullptr;
  if (table->newIterator(iterator) != Acad::eOk || !iterator) {
    table->close();
    throw std::runtime_error("cannot iterate the AutoCAD layer table");
  }

  for (; !iterator->done(); iterator->step()) {
    AcDbLayerTableRecord* source = nullptr;
    if (iterator->getRecord(source, AcDb::kForRead) != Acad::eOk || !source) {
      context.warn("layer_record_unavailable");
      continue;
    }
    const std::string sourceHandle = handleOf(source);
    Layer layer;
    layer.id = context.stableLayerId(sourceHandle);
    layer.sourceHandle = sourceHandle;
    AcString name;
    source->getName(name);
    layer.name = name.utf8Str();
    layer.visible = !source->isOff() && !source->isFrozen();
    layer.frozen = source->isFrozen();
    layer.locked = source->isLocked();
    layer.plot = source->isPlottable();
    layer.colorArgb = argb(source->color());
    const AcCmTransparency transparency = source->transparency();
    layer.transparency = transparency.isByAlpha()
                             ? transparencyAmount(transparency)
                             : static_cast<std::uint8_t>(0);
    layer.lineWeightMm = lineWeightMillimetres(source->lineWeight());
    AcDbLinetypeTableRecord* linetype = nullptr;
    if (acdbOpenObject(linetype, source->linetypeObjectId(), AcDb::kForRead) ==
            Acad::eOk &&
        linetype) {
      AcString linetypeName;
      linetype->getName(linetypeName);
      layer.linetype = linetypeName.utf8Str();
      linetype->close();
    }
    context.layersByHandle[sourceHandle] = std::move(layer);
    source->close();
  }
  delete iterator;
  table->close();
}

SpaceKind spaceOf(AcDbDatabase* database, AcDbObjectId ownerId,
                  std::string* layoutName = nullptr) {
  AcDbBlockTableRecord* owner = nullptr;
  if (acdbOpenObject(owner, ownerId, AcDb::kForRead) != Acad::eOk || !owner)
    return SpaceKind::BlockDefinition;
  SpaceKind space = SpaceKind::BlockDefinition;
  if (owner->isLayout()) {
    AcString name;
    owner->getName(name);
    if (layoutName) *layoutName = name.utf8Str();
    // currentSpaceId may be paper space. The canonical block-record name, not
    // the active viewport, determines the serialized space.
    space = name == ACDB_MODEL_SPACE ? SpaceKind::Model : SpaceKind::Paper;
  }
  owner->close();
  return space;
}

bool appendConverted(Context& context, AcDbEntity* source, SpaceKind space,
                     std::vector<Entity>& destination) {
  Entity target;
  std::string error;
  if (convertEntity(context, source, space, target, error)) {
    error = convertedEntityError(target);
    if (!error.empty()) {
      context.document.failedEntities.push_back(issueFor(source, error));
      return false;
    }
    destination.push_back(std::move(target));
    return true;
  } else if (error == "entity type is not supported by CadWeb v1") {
    context.document.unsupportedEntities.push_back(issueFor(source, error));
  } else {
    context.document.failedEntities.push_back(issueFor(source, error));
  }
  return false;
}

void collectTopLevelEntity(Context& context, AcDbObjectId id,
                           std::set<AcDbObjectId>& referencedBlocks) {
  if (id.isNull() || id.database() != context.database || id.isErased() ||
      id.isEffectivelyErased())
    throw std::invalid_argument("selection contains a stale or foreign object id");
  AcDbEntity* entity = nullptr;
  if (acdbOpenObject(entity, id, AcDb::kForRead) != Acad::eOk || !entity)
    throw std::runtime_error("cannot open a selected AutoCAD entity");
  const SpaceKind space = spaceOf(context.database, entity->blockId());
  if (space == SpaceKind::BlockDefinition) {
    context.document.failedEntities.push_back(
        issueFor(entity, "selected entity is not a top-level layout entity"));
    entity->close();
    return;
  }
  const bool converted =
      appendConverted(context, entity, space, context.document.entities);
  if (converted)
    context.includePayloadExtents(entity);
  if (converted) {
    AcDbBlockReference* reference = AcDbBlockReference::cast(entity);
    if (reference)
      referencedBlocks.insert(reference->blockTableRecord());
  }
  entity->close();
}

void collectSpace(Context& context, AcDbObjectId spaceId,
                  std::set<AcDbObjectId>& referencedBlocks) {
  AcDbBlockTableRecord* space = nullptr;
  if (acdbOpenObject(space, spaceId, AcDb::kForRead) != Acad::eOk || !space)
    throw std::runtime_error("cannot open AutoCAD model space");
  AcDbBlockTableRecordIterator* iterator = nullptr;
  if (space->newIterator(iterator) != Acad::eOk || !iterator) {
    space->close();
    throw std::runtime_error("cannot iterate AutoCAD model space");
  }
  for (; !iterator->done(); iterator->step()) {
    AcDbEntity* entity = nullptr;
    if (iterator->getEntity(entity, AcDb::kForRead) != Acad::eOk || !entity) {
      context.warn("model_entity_unavailable");
      continue;
    }
    const bool converted = appendConverted(
        context, entity, SpaceKind::Model, context.document.entities);
    if (converted)
      context.includePayloadExtents(entity);
    if (converted) {
      AcDbBlockReference* reference = AcDbBlockReference::cast(entity);
      if (reference)
        referencedBlocks.insert(reference->blockTableRecord());
    }
    entity->close();
  }
  delete iterator;
  space->close();
}

void collectBlockDefinition(Context& context, AcDbObjectId id,
                            std::set<AcDbObjectId>& referencedBlocks) {
  if (id.isNull()) return;
  AcDbBlockTableRecord* source = nullptr;
  if (acdbOpenObject(source, id, AcDb::kForRead) != Acad::eOk || !source) {
    context.warn("block_definition_unavailable:" + handleOf(id));
    return;
  }
  if (source->isLayout()) {
    source->close();
    return;
  }

  BlockDefinition block;
  block.sourceHandle = handleOf(source);
  block.id = context.stableBlockId(block.sourceHandle);
  AcString name;
  source->getName(name);
  block.name = name.utf8Str();
  block.basePoint = point(source->origin());

  if (source->isFromExternalReference()) {
    context.warn("xref_reference_only:" + block.sourceHandle);
  } else {
    AcDbBlockTableRecordIterator* iterator = nullptr;
    if (source->newIterator(iterator) != Acad::eOk || !iterator) {
      context.warn("block_entities_unavailable:" + block.sourceHandle);
    } else {
      for (; !iterator->done(); iterator->step()) {
        AcDbEntity* entity = nullptr;
        if (iterator->getEntity(entity, AcDb::kForRead) != Acad::eOk || !entity) {
          context.warn("block_entity_unavailable:" + block.sourceHandle);
          continue;
        }
        const bool converted = appendConverted(
            context, entity, SpaceKind::BlockDefinition, block.entities);
        if (converted) {
          AcDbBlockReference* reference = AcDbBlockReference::cast(entity);
          if (reference)
            referencedBlocks.insert(reference->blockTableRecord());
        }
        entity->close();
      }
      delete iterator;
    }
  }
  context.document.blocks.push_back(std::move(block));
  source->close();
}

void collectAllBlockIds(Context& context, std::set<AcDbObjectId>& ids) {
  AcDbBlockTable* table = nullptr;
  if (context.database->getBlockTable(table, AcDb::kForRead) != Acad::eOk || !table)
    throw std::runtime_error("cannot open the AutoCAD block table");
  AcDbBlockTableIterator* iterator = nullptr;
  if (table->newIterator(iterator) != Acad::eOk || !iterator) {
    table->close();
    throw std::runtime_error("cannot iterate the AutoCAD block table");
  }
  for (; !iterator->done(); iterator->step()) {
    AcDbBlockTableRecord* record = nullptr;
    if (iterator->getRecord(record, AcDb::kForRead) != Acad::eOk || !record) {
      context.warn("block_record_unavailable");
      continue;
    }
    if (record->isLayout()) {
      AcString name;
      record->getName(name);
      if (name != ACDB_MODEL_SPACE)
        context.document.omittedSpaces.push_back(name.utf8Str());
    } else {
      ids.insert(record->objectId());
    }
    record->close();
  }
  delete iterator;
  table->close();
}

void collectBlockGraph(Context& context, std::set<AcDbObjectId> pending) {
  std::set<AcDbObjectId> visited;
  while (!pending.empty()) {
    const AcDbObjectId id = *pending.begin();
    pending.erase(pending.begin());
    if (!visited.insert(id).second) continue;
    std::set<AcDbObjectId> nested;
    collectBlockDefinition(context, id, nested);
    for (const AcDbObjectId nestedId : nested) {
      if (!nestedId.isNull() && visited.find(nestedId) == visited.end())
        pending.insert(nestedId);
    }
  }
}

std::string sourceFileName(AcDbDatabase* database) {
  const ACHAR* raw = nullptr;
  if (database->getFilename(raw) != Acad::eOk || !raw || !*raw)
    return "untitled.dwg";
  const std::string fullName = utf8(raw);
  const std::size_t separator = fullName.find_last_of("/\\");
  const std::string name = separator == std::string::npos
                               ? fullName
                               : fullName.substr(separator + 1U);
  return name.empty() ? "untitled.dwg" : name;
}

void collectMetadata(Context& context) {
  AcString fingerprint;
  if (context.database->getFingerprintGuid(fingerprint) != Acad::eOk ||
      fingerprint.isEmpty()) {
    context.database->getVersionGuid(fingerprint);
  }
  context.fingerprint = fingerprint.utf8Str();
  if (context.fingerprint.empty()) {
    context.fingerprint = "unsaved-drawing";
    context.warn("drawing_fingerprint_unavailable");
  }

  context.document.producer =
      Producer{"AutoCAD", "2027", kPluginVersion, platformName()};
  context.document.source =
      SourceDrawing{sourceFileName(context.database),
                    dwgVersionName(context.database->lastSavedAsVersion()),
                    context.fingerprint};

  const AcDb::UnitsValue units = context.database->insunits();
  context.document.units.name = unitName(units);
  if (units != AcDb::kUnitsUndefined) {
    double factor = 0.0;
    if (acdbGetUnitsConversion(units, AcDb::kUnitsMeters, factor) == Acad::eOk &&
        std::isfinite(factor) && factor > 0.0) {
      context.document.units.metersPerUnit = factor;
    } else {
      context.warn("unit_conversion_unavailable");
    }
  }

}

}  // namespace

CadDocument snapshotDatabase(AcDbDatabase* database,
                             const SnapshotOptions& options) {
  if (!database) throw std::invalid_argument("AutoCAD database is null");
  if (options.selectedOnly && options.selectedIds.empty())
    throw std::invalid_argument("selected export requires at least one entity");
  if (options.selectedOnly && options.syncBinding)
    throw std::invalid_argument(
        "selected export cannot be a revision-bound snapshot");
  if (options.syncBinding && options.syncBinding->baseRevision > 0U &&
      !options.fixedOrigin)
    throw std::invalid_argument(
        "recovery snapshot requires the model epoch fixed origin");

  Context context;
  context.database = database;
  context.canonicalIds = options.syncBinding.has_value();
  context.fixedOrigin = options.fixedOrigin;
  context.document.syncBinding = options.syncBinding;
  collectMetadata(context);
  collectLayers(context);

  std::set<AcDbObjectId> referencedBlocks;
  if (options.selectedOnly) {
    std::set<std::string> handles;
    for (const AcDbObjectId id : options.selectedIds) {
      const std::string handle = handleOf(id);
      if (!handles.insert(handle).second)
        throw std::invalid_argument("selection contains duplicate object ids");
      collectTopLevelEntity(context, id, referencedBlocks);
    }
  } else {
    AcDbBlockTable* table = nullptr;
    if (database->getBlockTable(table, AcDb::kForRead) != Acad::eOk || !table)
      throw std::runtime_error("cannot open the AutoCAD block table");
    AcDbObjectId modelSpaceId;
    const Acad::ErrorStatus status = table->getAt(ACDB_MODEL_SPACE, modelSpaceId);
    table->close();
    if (status != Acad::eOk || modelSpaceId.isNull())
      throw std::runtime_error("cannot resolve AutoCAD model space");
    collectSpace(context, modelSpaceId, referencedBlocks);
    collectAllBlockIds(context, referencedBlocks);
  }

  collectBlockGraph(context, std::move(referencedBlocks));
  context.finishPayloadExtents();
  for (const auto& item : context.layersByHandle)
    context.document.layers.push_back(item.second);
  return context.document;
}

}  // namespace cadweb::objectarx

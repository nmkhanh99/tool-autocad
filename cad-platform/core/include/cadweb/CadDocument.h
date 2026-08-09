#pragma once

#include <array>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace cadweb {

struct Vec3 {
  double x = 0.0;
  double y = 0.0;
  double z = 0.0;
};

struct Matrix4 {
  std::array<double, 16> values{
      1.0, 0.0, 0.0, 0.0,
      0.0, 1.0, 0.0, 0.0,
      0.0, 0.0, 1.0, 0.0,
      0.0, 0.0, 0.0, 1.0,
  };

  static Matrix4 identity() { return {}; }
};

struct Extents3 {
  Vec3 min;
  Vec3 max;
};

enum class EntityKind : std::uint8_t {
  Unknown = 0,
  Line = 1,
  Polyline = 2,
  Arc = 3,
  Circle = 4,
  Text = 5,
  MText = 6,
  BlockReference = 7,
};

enum class SpaceKind : std::uint8_t {
  Model = 0,
  Paper = 1,
  BlockDefinition = 2,
};

enum class PropertySourceMode : std::uint8_t {
  Explicit = 0,
  ByLayer = 1,
  ByBlock = 2,
};

struct EntityStyle {
  bool visible = true;
  std::uint32_t colorArgb = 0xffffffffU;
  std::uint8_t transparency = 0;
  float lineWeightMm = 0.0F;
  std::string linetype;
  std::int32_t drawOrder = 0;
  PropertySourceMode colorSourceMode = PropertySourceMode::Explicit;
  PropertySourceMode transparencySourceMode = PropertySourceMode::Explicit;
  PropertySourceMode lineWeightSourceMode = PropertySourceMode::Explicit;
  PropertySourceMode linetypeSourceMode = PropertySourceMode::Explicit;
};

struct Attribute {
  std::string id;
  std::string tag;
  std::string text;
  Vec3 position;
  double rotation = 0.0;
  double height = 0.0;
};

// The adapter fills only fields relevant to kind. The writer validates the
// required fields and emits the exact shape defined by schema/geometry.fbs.
struct Entity {
  std::string id;
  std::string sourceHandle;
  EntityKind kind = EntityKind::Unknown;
  std::string layerId;
  SpaceKind space = SpaceKind::Model;
  EntityStyle style;

  std::vector<Vec3> points;
  std::vector<double> bulges;
  std::vector<double> startWidths;
  std::vector<double> endWidths;
  double constantWidth = 0.0;
  bool closed = false;

  std::optional<Vec3> center;
  double radius = 0.0;
  double startAngle = 0.0;
  double endAngle = 0.0;
  std::optional<Vec3> normal;

  std::string text;
  std::optional<Vec3> position;
  double rotation = 0.0;
  double height = 0.0;

  std::string blockDefinitionId;
  std::optional<Matrix4> transform;
  std::vector<Attribute> attributes;
};

struct BlockDefinition {
  std::string id;
  std::string sourceHandle;
  std::string name;
  Vec3 basePoint;
  std::vector<Entity> entities;
};

struct Layer {
  std::string id;
  std::string sourceHandle;
  std::string name;
  bool visible = true;
  bool frozen = false;
  bool locked = false;
  bool plot = true;
  std::uint32_t colorArgb = 0xffffffffU;
  std::uint8_t transparency = 0;
  float lineWeightMm = 0.0F;
  std::string linetype;
};

struct ExportIssue {
  std::string type;
  std::string sourceHandle;
  std::optional<Extents3> extents;
  std::string reason;
};

struct Producer {
  std::string application;
  std::string applicationVersion;
  std::string pluginVersion;
  std::string platform;
};

struct SourceDrawing {
  std::string fileName;
  std::string dwgVersion;
  std::string drawingFingerprint;
};

struct Units {
  std::string name;
  std::optional<double> metersPerUnit;
};

struct SyncBinding {
  std::string drawingId;
  std::string modelEpoch;
  std::string snapshotId;
  std::uint64_t baseRevision = 0;
};

struct CheckpointBinding {
  std::string drawingId;
  std::string modelEpoch;
  std::string checkpointId;
  std::uint64_t revision = 0;
  std::string stateHash;
};

struct CadDocument {
  Producer producer;
  SourceDrawing source;
  Units units;
  Vec3 origin;
  Extents3 extents;
  bool modelEmpty = false;
  std::optional<SyncBinding> syncBinding;
  std::optional<CheckpointBinding> checkpointBinding;

  std::vector<Layer> layers;
  std::vector<Entity> entities;
  std::vector<BlockDefinition> blocks;

  std::vector<ExportIssue> unsupportedEntities;
  std::vector<ExportIssue> failedEntities;
  std::vector<std::string> warnings;
  std::vector<std::string> omittedSpaces;
  std::string xrefPolicy = "reference-only";
};

}  // namespace cadweb

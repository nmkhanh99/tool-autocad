import { Builder, ByteBuffer } from "flatbuffers";

import { CadWebError } from "./errors";
import { verifyGeometryBufferStructure } from "./flatbuffer-verifier";
import {
  AttributeT,
  BlockDefinitionT,
  BufferKind,
  EntityKind,
  EntityT,
  GeometryBuffer,
  GeometryBufferT,
  Matrix4T,
  PropertySourceMode,
  SpaceKind,
  Vec3T,
  type Attribute,
  type BlockDefinition,
  type Entity,
  type Matrix4 as FlatMatrix4,
  type Vec3 as FlatVec3,
} from "./generated/cad-web/v1";
import type {
  CadWebAttribute,
  CadWebBlockDefinition,
  CadWebEntity,
  CadWebGeometry,
  Matrix4,
  Vec3,
} from "./types";

const MAX_PARSE_ITEMS = 5_000_000;
const utf8 = new TextDecoder("utf-8", { fatal: true });

class ReadBudget {
  private remaining: number;

  constructor(byteLength: number) {
    this.remaining = Math.min(MAX_PARSE_ITEMS, Math.max(10_000, byteLength * 4));
  }

  take(count: number, label: string): void {
    if (!Number.isSafeInteger(count) || count < 0 || count > this.remaining) {
      throw new CadWebError("GEOMETRY_INVALID", `${label} exceeds the geometry item limit`);
    }
    this.remaining -= count;
  }
}

function finite(value: number, label: string): number {
  if (!Number.isFinite(value)) {
    throw new CadWebError("GEOMETRY_INVALID", `${label} must be finite`);
  }
  return value;
}

function optionalString(value: string | Uint8Array | null, label: string): string | undefined {
  if (value === null) return undefined;
  try {
    return typeof value === "string" ? value : utf8.decode(value);
  } catch (cause) {
    throw new CadWebError("GEOMETRY_INVALID", `${label} is not valid UTF-8`, { cause });
  }
}

function requiredString(value: string | Uint8Array | null, label: string): string {
  const decoded = optionalString(value, label);
  if (!decoded) {
    throw new CadWebError("GEOMETRY_INVALID", `${label} is required`);
  }
  return decoded;
}

function readVec3(value: FlatVec3 | null, label: string): Vec3 | undefined {
  if (value === null) return undefined;
  return [finite(value.x(), `${label}.x`), finite(value.y(), `${label}.y`), finite(value.z(), `${label}.z`)];
}

function readMatrix4(value: FlatMatrix4 | null, label: string): Matrix4 | undefined {
  if (value === null) return undefined;
  return [
    finite(value.m00(), `${label}.m00`),
    finite(value.m01(), `${label}.m01`),
    finite(value.m02(), `${label}.m02`),
    finite(value.m03(), `${label}.m03`),
    finite(value.m10(), `${label}.m10`),
    finite(value.m11(), `${label}.m11`),
    finite(value.m12(), `${label}.m12`),
    finite(value.m13(), `${label}.m13`),
    finite(value.m20(), `${label}.m20`),
    finite(value.m21(), `${label}.m21`),
    finite(value.m22(), `${label}.m22`),
    finite(value.m23(), `${label}.m23`),
    finite(value.m30(), `${label}.m30`),
    finite(value.m31(), `${label}.m31`),
    finite(value.m32(), `${label}.m32`),
    finite(value.m33(), `${label}.m33`),
  ];
}

function readAttribute(value: Attribute, label: string): CadWebAttribute {
  const position = readVec3(value.position(), `${label}.position`);
  const text = optionalString(value.text(), `${label}.text`);
  return {
    id: requiredString(value.id(), `${label}.id`),
    tag: requiredString(value.tag(), `${label}.tag`),
    ...(text === undefined ? {} : { text }),
    ...(position === undefined ? {} : { position }),
    rotation: finite(value.rotation(), `${label}.rotation`),
    height: finite(value.height(), `${label}.height`),
  };
}

function readNumberVector(
  length: number,
  getter: (index: number) => number | null,
  budget: ReadBudget,
  label: string,
): number[] {
  budget.take(length, label);
  const result = new Array<number>(length);
  for (let index = 0; index < length; index += 1) {
    result[index] = finite(getter(index) ?? 0, `${label}[${index}]`);
  }
  return result;
}

function readEntity(value: Entity, budget: ReadBudget, label: string): CadWebEntity {
  const pointsLength = value.pointsLength();
  budget.take(pointsLength, `${label}.points`);
  const points = new Array<Vec3>(pointsLength);
  for (let index = 0; index < pointsLength; index += 1) {
    const point = readVec3(value.points(index), `${label}.points[${index}]`);
    if (!point) throw new CadWebError("GEOMETRY_INVALID", `${label}.points contains a null value`);
    points[index] = point;
  }

  const attributesLength = value.attributesLength();
  budget.take(attributesLength, `${label}.attributes`);
  const attributes = new Array<CadWebAttribute>(attributesLength);
  for (let index = 0; index < attributesLength; index += 1) {
    const attribute = value.attributes(index);
    if (!attribute) {
      throw new CadWebError("GEOMETRY_INVALID", `${label}.attributes contains a null value`);
    }
    attributes[index] = readAttribute(attribute, `${label}.attributes[${index}]`);
  }

  const sourceHandle = optionalString(value.sourceHandle(), `${label}.sourceHandle`);
  const linetype = optionalString(value.linetype(), `${label}.linetype`);
  const text = optionalString(value.text(), `${label}.text`);
  const blockDefinitionId = optionalString(
    value.blockDefinitionId(),
    `${label}.blockDefinitionId`,
  );
  const center = readVec3(value.center(), `${label}.center`);
  const normal = readVec3(value.normal(), `${label}.normal`);
  const position = readVec3(value.position(), `${label}.position`);
  const transform = readMatrix4(value.transform(), `${label}.transform`);

  const result: CadWebEntity = {
    id: requiredString(value.id(), `${label}.id`),
    ...(sourceHandle === undefined ? {} : { sourceHandle }),
    kind: value.kind(),
    layerId: requiredString(value.layerId(), `${label}.layerId`),
    space: value.space(),
    visible: value.visible(),
    colorArgb: value.colorArgb(),
    transparency: value.transparency(),
    lineWeightMm: finite(value.lineWeightMm(), `${label}.lineWeightMm`),
    ...(linetype === undefined ? {} : { linetype }),
    colorSourceMode: value.colorSourceMode(),
    transparencySourceMode: value.transparencySourceMode(),
    lineWeightSourceMode: value.lineWeightSourceMode(),
    linetypeSourceMode: value.linetypeSourceMode(),
    drawOrder: value.drawOrder(),
    points,
    bulges: readNumberVector(
      value.bulgesLength(),
      (index) => value.bulges(index),
      budget,
      `${label}.bulges`,
    ),
    startWidths: readNumberVector(
      value.startWidthsLength(),
      (index) => value.startWidths(index),
      budget,
      `${label}.startWidths`,
    ),
    endWidths: readNumberVector(
      value.endWidthsLength(),
      (index) => value.endWidths(index),
      budget,
      `${label}.endWidths`,
    ),
    constantWidth: finite(value.constantWidth(), `${label}.constantWidth`),
    closed: value.closed(),
    ...(center === undefined ? {} : { center }),
    radius: finite(value.radius(), `${label}.radius`),
    startAngle: finite(value.startAngle(), `${label}.startAngle`),
    endAngle: finite(value.endAngle(), `${label}.endAngle`),
    ...(normal === undefined ? {} : { normal }),
    ...(text === undefined ? {} : { text }),
    ...(position === undefined ? {} : { position }),
    rotation: finite(value.rotation(), `${label}.rotation`),
    height: finite(value.height(), `${label}.height`),
    ...(blockDefinitionId === undefined ? {} : { blockDefinitionId }),
    ...(transform === undefined ? {} : { transform }),
    attributes,
  };
  validateEntity(result, label);
  return result;
}

function readBlock(value: BlockDefinition, budget: ReadBudget, label: string): CadWebBlockDefinition {
  const length = value.entitiesLength();
  budget.take(length, `${label}.entities`);
  const entities = new Array<CadWebEntity>(length);
  for (let index = 0; index < length; index += 1) {
    const entity = value.entities(index);
    if (!entity) throw new CadWebError("GEOMETRY_INVALID", `${label}.entities contains null`);
    entities[index] = readEntity(entity, budget, `${label}.entities[${index}]`);
  }
  const sourceHandle = optionalString(value.sourceHandle(), `${label}.sourceHandle`);
  const basePoint = readVec3(value.basePoint(), `${label}.basePoint`);
  return {
    id: requiredString(value.id(), `${label}.id`),
    ...(sourceHandle === undefined ? {} : { sourceHandle }),
    name: requiredString(value.name(), `${label}.name`),
    ...(basePoint === undefined ? {} : { basePoint }),
    entities,
  };
}

function hasPoint(entity: CadWebEntity, field: "center" | "position"): boolean {
  return entity[field] !== undefined;
}

function validateEntity(entity: CadWebEntity, label: string): void {
  if (!entity.id || !entity.layerId) {
    throw new CadWebError("GEOMETRY_INVALID", `${label} id and layerId are required`);
  }
  for (const [name, value] of [
    ["lineWeightMm", entity.lineWeightMm],
    ["constantWidth", entity.constantWidth],
    ["radius", entity.radius],
    ["startAngle", entity.startAngle],
    ["endAngle", entity.endAngle],
    ["rotation", entity.rotation],
    ["height", entity.height],
  ] as const) {
    finite(value, `${label}.${name}`);
  }
  for (const [name, points] of [
    ["points", entity.points],
    ["center", entity.center ? [entity.center] : []],
    ["normal", entity.normal ? [entity.normal] : []],
    ["position", entity.position ? [entity.position] : []],
  ] as const) {
    points.forEach((point, index) =>
      point.forEach((value, axis) => finite(value, `${label}.${name}[${index}][${axis}]`)),
    );
  }
  [...entity.bulges, ...entity.startWidths, ...entity.endWidths].forEach((value, index) =>
    finite(value, `${label}.numericVectors[${index}]`),
  );
  entity.transform?.forEach((value, index) => finite(value, `${label}.transform[${index}]`));
  for (const attribute of entity.attributes) {
    if (!attribute.id || !attribute.tag) {
      throw new CadWebError("GEOMETRY_INVALID", `${label} attribute id and tag are required`);
    }
  }
  if (entity.kind < EntityKind.Line || entity.kind > EntityKind.BlockReference) {
    throw new CadWebError("GEOMETRY_INVALID", `${label}.kind is unsupported`);
  }
  if (entity.space < SpaceKind.Model || entity.space > SpaceKind.BlockDefinition) {
    throw new CadWebError("GEOMETRY_INVALID", `${label}.space is invalid`);
  }
  if (entity.transparency < 0 || entity.transparency > 255) {
    throw new CadWebError("GEOMETRY_INVALID", `${label}.transparency is invalid`);
  }
  for (const [name, mode] of [
    ["colorSourceMode", entity.colorSourceMode],
    ["transparencySourceMode", entity.transparencySourceMode],
    ["lineWeightSourceMode", entity.lineWeightSourceMode],
    ["linetypeSourceMode", entity.linetypeSourceMode],
  ] as const) {
    if (mode < PropertySourceMode.Explicit || mode > PropertySourceMode.ByBlock) {
      throw new CadWebError("GEOMETRY_INVALID", `${label}.${name} is invalid`);
    }
  }
  if (entity.lineWeightMm < 0 || entity.constantWidth < 0) {
    throw new CadWebError("GEOMETRY_INVALID", `${label} widths must not be negative`);
  }
  if (
    entity.startWidths.some((width) => width < 0) ||
    entity.endWidths.some((width) => width < 0)
  ) {
    throw new CadWebError("GEOMETRY_INVALID", `${label} polyline widths must not be negative`);
  }
  if (entity.kind === EntityKind.Line && entity.points.length !== 2) {
    throw new CadWebError("GEOMETRY_INVALID", `${label} line must have exactly two points`);
  }
  if (entity.kind === EntityKind.Polyline) {
    if (entity.points.length < 2) {
      throw new CadWebError("GEOMETRY_INVALID", `${label} polyline must have at least two points`);
    }
    for (const [name, values] of [
      ["bulges", entity.bulges],
      ["startWidths", entity.startWidths],
      ["endWidths", entity.endWidths],
    ] as const) {
      if (values.length !== 0 && values.length !== entity.points.length) {
        throw new CadWebError(
          "GEOMETRY_INVALID",
          `${label}.${name} must be empty or match the point count`,
        );
      }
    }
  }
  if (
    (entity.kind === EntityKind.Arc || entity.kind === EntityKind.Circle) &&
    (!hasPoint(entity, "center") || entity.radius <= 0)
  ) {
    throw new CadWebError("GEOMETRY_INVALID", `${label} arc/circle needs center and positive radius`);
  }
  if (
    (entity.kind === EntityKind.Text || entity.kind === EntityKind.MText) &&
    (!hasPoint(entity, "position") || entity.text === undefined || entity.height <= 0)
  ) {
    throw new CadWebError(
      "GEOMETRY_INVALID",
      `${label} text needs position, text content and positive height`,
    );
  }
  if (
    entity.kind === EntityKind.BlockReference &&
    (!entity.blockDefinitionId || entity.transform === undefined)
  ) {
    throw new CadWebError(
      "GEOMETRY_INVALID",
      `${label} block reference needs blockDefinitionId and transform`,
    );
  }
}

function toVec3(value: Vec3 | undefined): Vec3T | null {
  return value ? new Vec3T(value[0], value[1], value[2]) : null;
}

function toMatrix4(value: Matrix4 | undefined): Matrix4T | null {
  return value ? new Matrix4T(...value) : null;
}

function toAttribute(value: CadWebAttribute): AttributeT {
  return new AttributeT(
    value.id,
    value.tag,
    value.text ?? null,
    toVec3(value.position),
    value.rotation ?? 0,
    value.height ?? 0,
  );
}

function toEntity(value: CadWebEntity, label: string): EntityT {
  validateEntity(value, label);
  return new EntityT(
    value.id,
    value.sourceHandle ?? null,
    value.kind,
    value.layerId,
    value.space,
    value.visible,
    value.colorArgb,
    value.transparency,
    value.lineWeightMm,
    value.linetype ?? null,
    value.drawOrder,
    value.points.map((point) => toVec3(point)!),
    [...value.bulges],
    [...value.startWidths],
    [...value.endWidths],
    value.constantWidth,
    value.closed,
    toVec3(value.center),
    value.radius,
    value.startAngle,
    value.endAngle,
    toVec3(value.normal),
    value.text ?? null,
    toVec3(value.position),
    value.rotation,
    value.height,
    value.blockDefinitionId ?? null,
    toMatrix4(value.transform),
    value.attributes.map(toAttribute),
    value.colorSourceMode,
    value.transparencySourceMode,
    value.lineWeightSourceMode,
    value.linetypeSourceMode,
  );
}

function toBlock(value: CadWebBlockDefinition, label: string): BlockDefinitionT {
  if (!value.id || !value.name) {
    throw new CadWebError("GEOMETRY_INVALID", `${label} id and name are required`);
  }
  return new BlockDefinitionT(
    value.id,
    value.sourceHandle ?? null,
    value.name,
    toVec3(value.basePoint),
    value.entities.map((entity, index) => toEntity(entity, `${label}.entities[${index}]`)),
  );
}

export function buildGeometryBuffer(value: CadWebGeometry): Uint8Array {
  if (value.schemaVersion !== 1) {
    throw new CadWebError("VERSION_UNSUPPORTED", `geometry schema version ${value.schemaVersion} is unsupported`);
  }
  if (value.kind !== BufferKind.Entities && value.kind !== BufferKind.Blocks) {
    throw new CadWebError("GEOMETRY_INVALID", "geometry buffer kind must be Entities or Blocks");
  }
  if (value.kind === BufferKind.Entities && value.blocks.length !== 0) {
    throw new CadWebError("GEOMETRY_INVALID", "entities buffer must not contain block definitions");
  }
  if (value.kind === BufferKind.Blocks && value.entities.length !== 0) {
    throw new CadWebError("GEOMETRY_INVALID", "blocks buffer must not contain top-level entities");
  }
  const root = new GeometryBufferT(
    1,
    value.kind,
    value.entities.map((entity, index) => toEntity(entity, `entities[${index}]`)),
    value.blocks.map((block, index) => toBlock(block, `blocks[${index}]`)),
  );
  const builder = new Builder(1024);
  const offset = root.pack(builder);
  GeometryBuffer.finishGeometryBufferBuffer(builder, offset);
  return Uint8Array.from(builder.asUint8Array());
}

export function parseGeometryBuffer(
  bytes: Uint8Array,
  expectedKind?: BufferKind.Entities | BufferKind.Blocks,
): CadWebGeometry {
  if (bytes.byteLength < 8) {
    throw new CadWebError("GEOMETRY_INVALID", "geometry buffer is too short");
  }
  try {
    verifyGeometryBufferStructure(bytes);
    const byteBuffer = new ByteBuffer(bytes);
    if (!GeometryBuffer.bufferHasIdentifier(byteBuffer)) {
      throw new CadWebError("GEOMETRY_INVALID", "geometry buffer identifier must be CWEB");
    }
    const root = GeometryBuffer.getRootAsGeometryBuffer(byteBuffer);
    if (root.schemaVersion() !== 1) {
      throw new CadWebError(
        "VERSION_UNSUPPORTED",
        `geometry schema version ${root.schemaVersion()} is unsupported`,
      );
    }
    const kind = root.kind();
    if (kind !== BufferKind.Entities && kind !== BufferKind.Blocks) {
      throw new CadWebError("GEOMETRY_INVALID", "geometry buffer kind is invalid");
    }
    if (expectedKind !== undefined && kind !== expectedKind) {
      throw new CadWebError("GEOMETRY_INVALID", "geometry buffer kind does not match its manifest role");
    }
    const budget = new ReadBudget(bytes.byteLength);
    const entityLength = root.entitiesLength();
    const blockLength = root.blocksLength();
    budget.take(entityLength, "entities");
    budget.take(blockLength, "blocks");
    if (kind === BufferKind.Entities && blockLength !== 0) {
      throw new CadWebError("GEOMETRY_INVALID", "entities buffer contains block definitions");
    }
    if (kind === BufferKind.Blocks && entityLength !== 0) {
      throw new CadWebError("GEOMETRY_INVALID", "blocks buffer contains top-level entities");
    }
    const entities = new Array<CadWebEntity>(entityLength);
    for (let index = 0; index < entityLength; index += 1) {
      const entity = root.entities(index);
      if (!entity) throw new CadWebError("GEOMETRY_INVALID", "entities contains a null value");
      entities[index] = readEntity(entity, budget, `entities[${index}]`);
    }
    const blocks = new Array<CadWebBlockDefinition>(blockLength);
    for (let index = 0; index < blockLength; index += 1) {
      const block = root.blocks(index);
      if (!block) throw new CadWebError("GEOMETRY_INVALID", "blocks contains a null value");
      blocks[index] = readBlock(block, budget, `blocks[${index}]`);
    }
    return { schemaVersion: 1, kind, entities, blocks };
  } catch (cause) {
    if (cause instanceof CadWebError) throw cause;
    throw new CadWebError("GEOMETRY_INVALID", "geometry buffer is malformed", { cause });
  }
}

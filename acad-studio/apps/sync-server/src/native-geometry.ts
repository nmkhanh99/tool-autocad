import { Builder, type Offset } from "flatbuffers";

import {
  EntityKind,
  type CadWebAttribute,
  type CadWebBlockDefinition,
  type CadWebEntity,
  type Matrix4,
  type Vec3,
} from "@acad/cadweb";

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function createVec3(builder: Builder, value: Vec3): Offset {
  builder.prep(8, 24);
  builder.writeFloat64(value[2]);
  builder.writeFloat64(value[1]);
  builder.writeFloat64(value[0]);
  return builder.offset();
}

function createMatrix4(builder: Builder, value: Matrix4): Offset {
  builder.prep(8, 128);
  for (let index = value.length - 1; index >= 0; index -= 1) {
    builder.writeFloat64(value[index]!);
  }
  return builder.offset();
}

function createOffsetVector(builder: Builder, values: readonly Offset[]): Offset {
  if (values.length === 0) {
    builder.addInt32(0);
    return builder.offset();
  }
  builder.startVector(4, values.length, 4);
  for (let index = values.length - 1; index >= 0; index -= 1) {
    builder.addOffset(values[index]!);
  }
  return builder.endVector();
}

function createDoubleVector(builder: Builder, values: readonly number[]): Offset {
  if (values.length === 0) {
    builder.addInt32(0);
    return builder.offset();
  }
  builder.startVector(8, values.length, 8);
  for (let index = values.length - 1; index >= 0; index -= 1) {
    builder.addFloat64(values[index]!);
  }
  return builder.endVector();
}

function createVec3Vector(builder: Builder, values: readonly Vec3[]): Offset {
  if (values.length === 0) {
    builder.addInt32(0);
    return builder.offset();
  }
  builder.startVector(24, values.length, 8);
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index]!;
    builder.writeFloat64(value[2]);
    builder.writeFloat64(value[1]);
    builder.writeFloat64(value[0]);
  }
  return builder.endVector();
}

function buildAttribute(builder: Builder, value: CadWebAttribute): Offset {
  const id = builder.createString(value.id);
  const tag = builder.createString(value.tag);
  const text = builder.createString(value.text ?? "");

  builder.startObject(6);
  builder.addFieldFloat64(5, value.height ?? 0, 0);
  builder.addFieldFloat64(4, value.rotation ?? 0, 0);
  builder.addFieldStruct(3, createVec3(builder, value.position ?? [0, 0, 0]), 0);
  builder.addFieldOffset(2, text, 0);
  builder.addFieldOffset(1, tag, 0);
  builder.addFieldOffset(0, id, 0);
  const offset = builder.endObject();
  builder.requiredField(offset, 4);
  builder.requiredField(offset, 6);
  return offset;
}

function buildEntity(builder: Builder, value: CadWebEntity): Offset {
  const attributes = [...value.attributes]
    .sort((left, right) => lexicalCompare(left.id, right.id))
    .map((attribute) => buildAttribute(builder, attribute));

  const id = builder.createString(value.id);
  const sourceHandle = builder.createString(value.sourceHandle ?? "");
  const layerId = builder.createString(value.layerId);
  const linetype = value.linetype ? builder.createString(value.linetype) : 0;
  const points = createVec3Vector(builder, value.points);
  const bulges = createDoubleVector(builder, value.bulges);
  const startWidths = createDoubleVector(builder, value.startWidths);
  const endWidths = createDoubleVector(builder, value.endWidths);
  const text = value.kind === EntityKind.Text || value.kind === EntityKind.MText
    ? builder.createString(value.text ?? "")
    : 0;
  const blockDefinitionId = value.blockDefinitionId
    ? builder.createString(value.blockDefinitionId)
    : 0;
  const attributeVector = attributes.length === 0 ? 0 : createOffsetVector(builder, attributes);

  builder.startObject(33);
  builder.addFieldFloat64(25, value.height, 0);
  builder.addFieldFloat64(24, value.rotation, 0);
  builder.addFieldFloat64(20, value.endAngle, 0);
  builder.addFieldFloat64(19, value.startAngle, 0);
  builder.addFieldFloat64(18, value.radius, 0);
  builder.addFieldFloat64(15, value.constantWidth, 0);
  builder.addFieldOffset(28, attributeVector, 0);
  if (value.transform) {
    builder.addFieldStruct(27, createMatrix4(builder, value.transform), 0);
  }
  builder.addFieldOffset(26, blockDefinitionId, 0);
  if (value.position) builder.addFieldStruct(23, createVec3(builder, value.position), 0);
  builder.addFieldOffset(22, text, 0);
  if (value.normal) builder.addFieldStruct(21, createVec3(builder, value.normal), 0);
  if (value.center) builder.addFieldStruct(17, createVec3(builder, value.center), 0);
  builder.addFieldOffset(14, endWidths, 0);
  builder.addFieldOffset(13, startWidths, 0);
  builder.addFieldOffset(12, bulges, 0);
  builder.addFieldOffset(11, points, 0);
  builder.addFieldInt32(10, value.drawOrder, 0);
  builder.addFieldOffset(9, linetype, 0);
  builder.addFieldFloat32(8, value.lineWeightMm, 0);
  builder.addFieldInt32(6, value.colorArgb, 0xff_ffffff);
  builder.addFieldOffset(3, layerId, 0);
  builder.addFieldOffset(1, sourceHandle, 0);
  builder.addFieldOffset(0, id, 0);
  builder.addFieldInt8(32, value.linetypeSourceMode, 0);
  builder.addFieldInt8(31, value.lineWeightSourceMode, 0);
  builder.addFieldInt8(30, value.transparencySourceMode, 0);
  builder.addFieldInt8(29, value.colorSourceMode, 0);
  builder.addFieldInt8(16, +value.closed, 0);
  builder.addFieldInt8(7, value.transparency, 0);
  builder.addFieldInt8(5, +value.visible, 1);
  builder.addFieldInt8(4, value.space, 0);
  builder.addFieldInt8(2, value.kind, 0);
  const offset = builder.endObject();
  builder.requiredField(offset, 4);
  builder.requiredField(offset, 10);
  return offset;
}

function buildBlock(builder: Builder, value: CadWebBlockDefinition): Offset {
  const entities = [...value.entities]
    .sort((left, right) => lexicalCompare(left.id, right.id))
    .map((entity) => buildEntity(builder, entity));
  const id = builder.createString(value.id);
  const sourceHandle = builder.createString(value.sourceHandle ?? "");
  const name = builder.createString(value.name);
  const entityVector = createOffsetVector(builder, entities);

  builder.startObject(5);
  builder.addFieldOffset(4, entityVector, 0);
  builder.addFieldStruct(3, createVec3(builder, value.basePoint ?? [0, 0, 0]), 0);
  builder.addFieldOffset(2, name, 0);
  builder.addFieldOffset(1, sourceHandle, 0);
  builder.addFieldOffset(0, id, 0);
  const offset = builder.endObject();
  builder.requiredField(offset, 4);
  builder.requiredField(offset, 8);
  return offset;
}

function finishGeometry(
  builder: Builder,
  kind: 1 | 2,
  entities: Offset,
  blocks: Offset,
): Uint8Array {
  builder.startObject(4);
  builder.addFieldOffset(3, blocks, 0);
  builder.addFieldOffset(2, entities, 0);
  builder.addFieldInt32(0, 1, 1);
  builder.addFieldInt8(1, kind, 0);
  const root = builder.endObject();
  builder.finish(root, "CWEB");
  return Uint8Array.from(builder.asUint8Array());
}

export function buildNativeEntityBuffer(entity: CadWebEntity): Uint8Array {
  const builder = new Builder(1024);
  const entityOffset = buildEntity(builder, entity);
  return finishGeometry(builder, 1, createOffsetVector(builder, [entityOffset]), 0);
}

export function buildNativeBlockBuffer(block: CadWebBlockDefinition): Uint8Array {
  const builder = new Builder(1024);
  const blockOffset = buildBlock(builder, block);
  return finishGeometry(builder, 2, 0, createOffsetVector(builder, [blockOffset]));
}

import {
  CadWebError,
  DEFAULT_CADWEB_LIMITS,
  EntityKind,
  PropertySourceMode,
  readCadWeb,
  readCadWebDelta,
  type CadWebBlockDefinition,
  type CadWebDeltaDocument,
  type CadWebDocument,
  type CadWebEntity,
  type CadWebLayer,
  type CadWebRevisionState,
  type Matrix4,
  type Vec3,
} from "@acad/cadweb";

import {
  revisionStateFromSnapshot,
  stageCadWebDelta,
  type CadWebRenderInvalidation,
  type CadWebViewerRevisionState,
} from "./cadweb-viewer-state";

export type CadWebWorkerRequest =
  | {
      type: "load";
      requestId: number;
      file: File;
    }
  | {
      type: "loadSnapshot";
      requestId: number;
      file: File;
      revision: number;
    }
  | {
      type: "applyDelta";
      requestId: number;
      file: File;
    }
  | {
      type: "resetToSnapshot";
      requestId: number;
      file: File;
      revision: number;
    }
  | {
      type: "reset";
      requestId: number;
    };

export type CadWebRenderLayer = {
  id: string;
  name: string;
  defaultVisible: boolean;
  locked: boolean;
  colorArgb: number;
  entityCount: number;
  renderedEntityCount: number;
  lineVertices: Float32Array;
  markerVertices: Float32Array;
  bounds: readonly [number, number, number, number] | null;
};

export type CadWebViewerDocument = {
  archiveName: string;
  archiveSize: number;
  sourceFileName: string;
  formatVersion: string;
  producer: string;
  platform: string;
  units: string;
  origin: Vec3;
  extents: {
    min: Vec3;
    max: Vec3;
  };
  exportStatus: "complete" | "partial" | "failed";
  entityCount: number;
  renderedEntityCount: number;
  blockDefinitionCount: number;
  layers: CadWebRenderLayer[];
  warnings: string[];
  drawingId?: string;
  modelEpoch?: string;
  revision?: number;
};

export type CadWebWorkerResponse =
  | {
      type: "loaded";
      requestId: number;
      mode: "load" | "snapshot" | "delta" | "recovery";
      document: CadWebViewerDocument;
    }
  | {
      type: "error";
      requestId: number;
      code?: string;
      message: string;
    }
  | {
      type: "reset";
      requestId: number;
    }
  | {
      type: "reset-needed";
      requestId: number;
      code: string;
      message: string;
      currentRevision?: number;
    };

type Color = readonly [number, number, number, number];

type ResolvedEntityStyle = {
  colorArgb: number;
  transparency: number;
  lineWeightMm: number;
  linetype: string | undefined;
};

type LayerBuilder = {
  layer: CadWebLayer;
  budget: RenderBudget;
  entityCount: number;
  renderedEntityCount: number;
  lines: number[];
  markers: number[];
  bounds: [number, number, number, number] | null;
  captureVertices: boolean;
};

type WorkerScope = {
  addEventListener(
    type: "message",
    listener: (event: MessageEvent<CadWebWorkerRequest>) => void,
  ): void;
  postMessage(message: CadWebWorkerResponse, transfer?: Transferable[]): void;
};

const workerScope = globalThis as unknown as WorkerScope;
const TWO_PI = Math.PI * 2;
const MIN_RADIUS = 1e-12;
const MAX_BLOCK_DEPTH = 32;
const MAX_EXPANDED_ENTITIES = 500_000;
export const MAX_RENDER_VERTICES = 1_000_000;
const IDENTITY_MATRIX: Matrix4 = [
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
];

export function multiplyMatrix4(left: Matrix4, right: Matrix4): Matrix4 {
  const result = new Array<number>(16);
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 4; column += 1) {
      let value = 0;
      for (let index = 0; index < 4; index += 1) {
        value += left[row * 4 + index] * right[index * 4 + column];
      }
      result[row * 4 + column] = value;
    }
  }
  return result as unknown as Matrix4;
}

export function transformPoint(point: Vec3, matrix: Matrix4): Vec3 {
  const [x, y, z] = point;
  const transformedX = matrix[0] * x + matrix[1] * y + matrix[2] * z + matrix[3];
  const transformedY = matrix[4] * x + matrix[5] * y + matrix[6] * z + matrix[7];
  const transformedZ = matrix[8] * x + matrix[9] * y + matrix[10] * z + matrix[11];
  const w = matrix[12] * x + matrix[13] * y + matrix[14] * z + matrix[15];
  if (Math.abs(w) > MIN_RADIUS && Math.abs(w - 1) > MIN_RADIUS) {
    return [transformedX / w, transformedY / w, transformedZ / w];
  }
  return [transformedX, transformedY, transformedZ];
}

function colorFromArgb(argb: number, transparency: number): Color {
  const value = argb >>> 0;
  const encodedAlpha = (value >>> 24) & 0xff;
  const alpha = (encodedAlpha === 0 ? 1 : encodedAlpha / 255) *
    (1 - Math.min(255, Math.max(0, transparency)) / 255);
  return [
    ((value >>> 16) & 0xff) / 255,
    ((value >>> 8) & 0xff) / 255,
    (value & 0xff) / 255,
    alpha,
  ];
}

function projectedPoint(point: Vec3, transform: Matrix4, origin: Vec3): Vec3 {
  const transformed = transformPoint(point, transform);
  return [
    transformed[0] - origin[0],
    transformed[1] - origin[1],
    transformed[2] - origin[2],
  ];
}

function includePoint(builder: LayerBuilder, x: number, y: number): void {
  if (builder.bounds === null) {
    builder.bounds = [x, y, x, y];
    return;
  }
  builder.bounds[0] = Math.min(builder.bounds[0], x);
  builder.bounds[1] = Math.min(builder.bounds[1], y);
  builder.bounds[2] = Math.max(builder.bounds[2], x);
  builder.bounds[3] = Math.max(builder.bounds[3], y);
}

type RenderBudget = {
  vertices: number;
  exhausted: boolean;
};

export function reserveRenderVertices(budget: RenderBudget, count: number): boolean {
  if (
    budget.exhausted ||
    !Number.isSafeInteger(count) ||
    count <= 0 ||
    count > MAX_RENDER_VERTICES - budget.vertices
  ) {
    budget.exhausted = true;
    return false;
  }
  budget.vertices += count;
  return true;
}

function pushVertex(target: number[], point: Vec3, color: Color): void {
  target.push(point[0], point[1], color[0], color[1], color[2], color[3]);
}

function addLine(
  builder: LayerBuilder,
  start: Vec3,
  end: Vec3,
  color: Color,
): boolean {
  if (!reserveRenderVertices(builder.budget, 2)) {
    return false;
  }
  if (!builder.captureVertices) {
    return true;
  }
  pushVertex(builder.lines, start, color);
  pushVertex(builder.lines, end, color);
  includePoint(builder, start[0], start[1]);
  includePoint(builder, end[0], end[1]);
  return true;
}

function addMarker(builder: LayerBuilder, point: Vec3, color: Color): boolean {
  if (!reserveRenderVertices(builder.budget, 1)) {
    return false;
  }
  if (!builder.captureVertices) {
    return true;
  }
  pushVertex(builder.markers, point, color);
  includePoint(builder, point[0], point[1]);
  return true;
}

function addStraightPolyline(
  builder: LayerBuilder,
  points: readonly Vec3[],
  closed: boolean,
  color: Color,
  transform: Matrix4,
  origin: Vec3,
): boolean {
  let rendered = false;
  for (let index = 0; index + 1 < points.length; index += 1) {
    if (!addLine(
      builder,
      projectedPoint(points[index], transform, origin),
      projectedPoint(points[index + 1], transform, origin),
      color,
    )) {
      return rendered;
    }
    rendered = true;
  }
  if (closed && points.length > 2) {
    if (!addLine(
      builder,
      projectedPoint(points[points.length - 1], transform, origin),
      projectedPoint(points[0], transform, origin),
      color,
    )) {
      return rendered;
    }
    rendered = true;
  }
  return rendered;
}

function addArc(
  builder: LayerBuilder,
  center: Vec3,
  radius: number,
  startAngle: number,
  sweep: number,
  color: Color,
  transform: Matrix4,
  origin: Vec3,
): boolean {
  if (!Number.isFinite(radius) || radius <= MIN_RADIUS || !Number.isFinite(sweep)) {
    return false;
  }

  const segments = Math.min(
    256,
    Math.max(4, Math.ceil(Math.abs(sweep) / (Math.PI / 36))),
  );
  let previous: Vec3 = [
    center[0] + Math.cos(startAngle) * radius,
    center[1] + Math.sin(startAngle) * radius,
    center[2],
  ];

  let rendered = false;
  for (let index = 1; index <= segments; index += 1) {
    const angle = startAngle + (sweep * index) / segments;
    const next: Vec3 = [
      center[0] + Math.cos(angle) * radius,
      center[1] + Math.sin(angle) * radius,
      center[2],
    ];
    if (!addLine(
      builder,
      projectedPoint(previous, transform, origin),
      projectedPoint(next, transform, origin),
      color,
    )) {
      return rendered;
    }
    rendered = true;
    previous = next;
  }
  return rendered;
}

function addBulgedSegment(
  builder: LayerBuilder,
  start: Vec3,
  end: Vec3,
  bulge: number,
  color: Color,
  transform: Matrix4,
  origin: Vec3,
): boolean {
  if (!Number.isFinite(bulge) || Math.abs(bulge) < 1e-10) {
    return addLine(
      builder,
      projectedPoint(start, transform, origin),
      projectedPoint(end, transform, origin),
      color,
    );
  }

  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const chord = Math.hypot(dx, dy);
  if (chord <= MIN_RADIUS) {
    return false;
  }

  const centerOffset = (chord * (1 - bulge * bulge)) / (4 * bulge);
  const center: Vec3 = [
    (start[0] + end[0]) / 2 - (dy / chord) * centerOffset,
    (start[1] + end[1]) / 2 + (dx / chord) * centerOffset,
    (start[2] + end[2]) / 2,
  ];
  const radius = (chord * (1 + bulge * bulge)) / (4 * Math.abs(bulge));
  const startAngle = Math.atan2(start[1] - center[1], start[0] - center[0]);
  return addArc(
    builder,
    center,
    radius,
    startAngle,
    4 * Math.atan(bulge),
    color,
    transform,
    origin,
  );
}

function addPolyline(
  builder: LayerBuilder,
  points: readonly Vec3[],
  bulges: readonly number[],
  closed: boolean,
  color: Color,
  transform: Matrix4,
  origin: Vec3,
): boolean {
  if (bulges.length === 0) {
    return addStraightPolyline(builder, points, closed, color, transform, origin);
  }

  const segmentCount = closed ? points.length : Math.max(0, points.length - 1);
  let rendered = false;
  for (let index = 0; index < segmentCount; index += 1) {
    rendered = addBulgedSegment(
      builder,
      points[index],
      points[(index + 1) % points.length],
      bulges[index] ?? 0,
      color,
      transform,
      origin,
    ) || rendered;
    if (builder.budget.exhausted) {
      break;
    }
  }
  return rendered;
}

function normalZRatio(normal: Vec3 | undefined): number | null {
  if (normal === undefined) {
    return 1;
  }
  const length = Math.hypot(normal[0], normal[1], normal[2]);
  return length <= MIN_RADIUS ? null : normal[2] / length;
}

export function canTessellateBulges(normal: Vec3 | undefined): boolean {
  const zRatio = normalZRatio(normal);
  return zRatio !== null && zRatio > 0.999999;
}

function isParallelToZ(normal: Vec3 | undefined): boolean {
  const zRatio = normalZRatio(normal);
  return zRatio !== null && Math.abs(zRatio) > 0.999999;
}

export function counterclockwiseSweep(startAngle: number, endAngle: number): number | null {
  const difference = endAngle - startAngle;
  if (!Number.isFinite(difference)) {
    return null;
  }
  const sweep = ((difference % TWO_PI) + TWO_PI) % TWO_PI;
  return sweep > 1e-12 ? sweep : null;
}

function renderEntity(
  builder: LayerBuilder,
  entity: CadWebEntity,
  style: ResolvedEntityStyle,
  transform: Matrix4,
  origin: Vec3,
  warningCounts: Map<string, number>,
): boolean {
  if (!entity.visible) {
    return false;
  }

  const color = colorFromArgb(style.colorArgb, style.transparency);
  const points = entity.points;

  switch (entity.kind) {
    case EntityKind.Line:
      if (points.length < 2) {
        warningCounts.set("invalidLine", (warningCounts.get("invalidLine") ?? 0) + 1);
        return false;
      }
      return addStraightPolyline(builder, points, false, color, transform, origin);

    case EntityKind.Polyline:
      if (points.length < 2) {
        warningCounts.set("invalidPolyline", (warningCounts.get("invalidPolyline") ?? 0) + 1);
        return false;
      }
      if (
        entity.bulges.some((bulge) => Math.abs(bulge) >= 1e-10) &&
        !canTessellateBulges(entity.normal)
      ) {
        warningCounts.set(
          "nonPlanarPolyline",
          (warningCounts.get("nonPlanarPolyline") ?? 0) + 1,
        );
        return false;
      }
      return addPolyline(
        builder,
        points,
        entity.bulges,
        entity.closed,
        color,
        transform,
        origin,
      );

    case EntityKind.Arc: {
      if (entity.center === undefined || !canTessellateBulges(entity.normal)) {
        warningCounts.set("nonPlanarArc", (warningCounts.get("nonPlanarArc") ?? 0) + 1);
        return false;
      }
      const sweep = counterclockwiseSweep(entity.startAngle, entity.endAngle);
      if (sweep === null) {
        warningCounts.set("invalidArc", (warningCounts.get("invalidArc") ?? 0) + 1);
        return false;
      }
      return addArc(
        builder,
        entity.center,
        entity.radius,
        entity.startAngle,
        sweep,
        color,
        transform,
        origin,
      );
    }

    case EntityKind.Circle:
      if (entity.center === undefined || !isParallelToZ(entity.normal)) {
        warningCounts.set("nonPlanarCircle", (warningCounts.get("nonPlanarCircle") ?? 0) + 1);
        return false;
      }
      return addArc(
        builder,
        entity.center,
        entity.radius,
        0,
        TWO_PI,
        color,
        transform,
        origin,
      );

    case EntityKind.Text:
    case EntityKind.MText:
      if (entity.position === undefined) {
        warningCounts.set("invalidText", (warningCounts.get("invalidText") ?? 0) + 1);
        return false;
      }
      if (!addMarker(builder, projectedPoint(entity.position, transform, origin), color)) {
        return false;
      }
      warningCounts.set("textMarker", (warningCounts.get("textMarker") ?? 0) + 1);
      return true;

    default:
      warningCounts.set("unsupported", (warningCounts.get("unsupported") ?? 0) + 1);
      return false;
  }
}

function warningSummary(counts: Map<string, number>): string[] {
  const warnings: string[] = [];
  const add = (key: string, text: (count: number) => string): void => {
    const count = counts.get(key) ?? 0;
    if (count > 0) {
      warnings.push(text(count));
    }
  };

  add("textMarker", (count) =>
    `${count} đối tượng Text/MText được hiển thị bằng marker; glyph chưa được dựng ở phase 1.`,
  );
  add("blockAttributes", (count) =>
    `${count} attribute trong block reference chưa được dựng glyph ở phase 1.`,
  );
  add("blockDepth", (count) =>
    `${count} nhánh block vượt giới hạn lồng ${MAX_BLOCK_DEPTH} cấp và đã bị dừng.`,
  );
  add("blockBudget", () =>
    `Block expansion đã dừng ở giới hạn ${MAX_EXPANDED_ENTITIES.toLocaleString("en-US")} entity.`,
  );
  add("missingBlock", (count) =>
    `${count} block reference không tìm thấy definition.`,
  );
  add("missingBlockTransform", (count) =>
    `${count} block reference không có transform hợp lệ.`,
  );
  add("nonPlanarArc", (count) =>
    `${count} arc không nằm trên mặt phẳng XY nên chưa được render.`,
  );
  add("nonPlanarCircle", (count) =>
    `${count} circle không nằm trên mặt phẳng XY nên chưa được render.`,
  );
  add("nonPlanarPolyline", (count) =>
    `${count} polyline có bulge ngoài mặt phẳng XY/+Z nên chưa được render.`,
  );
  add("invalidLine", (count) => `${count} line thiếu điểm hợp lệ.`);
  add("invalidPolyline", (count) => `${count} polyline thiếu điểm hợp lệ.`);
  add("invalidArc", (count) => `${count} arc có tham số không hợp lệ.`);
  add("invalidText", (count) => `${count} Text/MText không có điểm chèn.`);
  add("unsupported", (count) => `${count} entity chưa được viewer phase 1 hỗ trợ.`);
  add("renderBudget", () =>
    `Tessellation đã dừng ở giới hạn ${MAX_RENDER_VERTICES.toLocaleString("en-US")} vertex.`,
  );
  return warnings;
}

function synthesizedLayer(id: string): CadWebLayer {
  return {
    id,
    name: id,
    visible: true,
    frozen: false,
    locked: false,
    plot: true,
    colorArgb: 0xffd8e7f3,
  };
}

type RenderContext = {
  builders: Map<string, LayerBuilder>;
  blocks: ReadonlyMap<string, CadWebBlockDefinition>;
  origin: Vec3;
  warningCounts: Map<string, number>;
  expandedEntities: number;
  renderBudget: RenderBudget;
  captureLayerIds: ReadonlySet<string> | null;
};

function incrementWarning(context: RenderContext, key: string): void {
  context.warningCounts.set(key, (context.warningCounts.get(key) ?? 0) + 1);
}

function ensureLayerBuilder(context: RenderContext, layerId: string): LayerBuilder {
  const existing = context.builders.get(layerId);
  if (existing !== undefined) {
    return existing;
  }
  const layer = synthesizedLayer(layerId);
  const builder: LayerBuilder = {
    layer,
    budget: context.renderBudget,
    entityCount: 0,
    renderedEntityCount: 0,
    lines: [],
    markers: [],
    bounds: null,
    captureVertices:
      context.captureLayerIds === null || context.captureLayerIds.has(layerId),
  };
  context.builders.set(layerId, builder);
  incrementWarning(context, "missingLayer");
  return builder;
}

function effectiveLayerId(
  context: RenderContext,
  entityLayerId: string,
  referenceLayerId: string | undefined,
): string {
  const layer = context.builders.get(entityLayerId)?.layer;
  if (referenceLayerId !== undefined && (entityLayerId === "0" || layer?.name === "0")) {
    return referenceLayerId;
  }
  return entityLayerId;
}

function resolvedProperty<T>(
  mode: PropertySourceMode,
  explicitValue: T,
  layerValue: T | undefined,
  blockValue: T | undefined,
): T {
  switch (mode) {
    case PropertySourceMode.ByLayer:
      return layerValue ?? explicitValue;
    case PropertySourceMode.ByBlock:
      return blockValue ?? explicitValue;
    default:
      return explicitValue;
  }
}

function resolveEntityStyle(
  entity: CadWebEntity,
  layer: CadWebLayer,
  blockStyle: ResolvedEntityStyle | undefined,
): ResolvedEntityStyle {
  return {
    colorArgb: resolvedProperty(
      entity.colorSourceMode,
      entity.colorArgb,
      layer.colorArgb,
      blockStyle?.colorArgb,
    ),
    transparency: resolvedProperty(
      entity.transparencySourceMode,
      entity.transparency,
      layer.transparency,
      blockStyle?.transparency,
    ),
    lineWeightMm: resolvedProperty(
      entity.lineWeightSourceMode,
      entity.lineWeightMm,
      layer.lineWeightMm,
      blockStyle?.lineWeightMm,
    ),
    linetype: resolvedProperty(
      entity.linetypeSourceMode,
      entity.linetype,
      layer.linetype,
      blockStyle?.linetype,
    ),
  };
}

function renderEntityTree(
  entity: CadWebEntity,
  parentTransform: Matrix4,
  referenceLayerId: string | undefined,
  blockStyle: ResolvedEntityStyle | undefined,
  depth: number,
  context: RenderContext,
): number {
  if (!entity.visible) {
    return 0;
  }
  if (context.expandedEntities >= MAX_EXPANDED_ENTITIES) {
    if (!context.warningCounts.has("blockBudget")) {
      incrementWarning(context, "blockBudget");
    }
    return 0;
  }
  if (context.renderBudget.exhausted) {
    if (!context.warningCounts.has("renderBudget")) {
      incrementWarning(context, "renderBudget");
    }
    return 0;
  }
  context.expandedEntities += 1;

  const layerId = effectiveLayerId(context, entity.layerId, referenceLayerId);
  const builder = ensureLayerBuilder(context, layerId);
  const style = resolveEntityStyle(entity, builder.layer, blockStyle);
  builder.entityCount += 1;

  if (entity.kind !== EntityKind.BlockReference) {
    if (renderEntity(
      builder,
      entity,
      style,
      parentTransform,
      context.origin,
      context.warningCounts,
    )) {
      builder.renderedEntityCount += 1;
      return 1;
    }
    return 0;
  }

  if (depth >= MAX_BLOCK_DEPTH) {
    incrementWarning(context, "blockDepth");
    return 0;
  }
  if (entity.attributes.length > 0) {
    context.warningCounts.set(
      "blockAttributes",
      (context.warningCounts.get("blockAttributes") ?? 0) + entity.attributes.length,
    );
  }
  if (entity.transform === undefined) {
    incrementWarning(context, "missingBlockTransform");
    return 0;
  }
  const definition = context.blocks.get(entity.blockDefinitionId ?? "");
  if (definition === undefined) {
    incrementWarning(context, "missingBlock");
    return 0;
  }

  const transform = multiplyMatrix4(parentTransform, entity.transform);
  let rendered = 0;
  for (const child of definition.entities) {
    rendered += renderEntityTree(child, transform, layerId, style, depth + 1, context);
  }
  return rendered;
}

type CadWebRenderModel = {
  entities: readonly CadWebEntity[];
  blocks: ReadonlyMap<string, CadWebBlockDefinition>;
  layers: readonly CadWebLayer[];
  extents: { min: Vec3; max: Vec3 };
  drawingId?: string;
  modelEpoch?: string;
  revision?: number;
};

type CadWebViewerMetadata = {
  archiveName: string;
  archiveSize: number;
  sourceFileName: string;
  formatVersion: string;
  producer: string;
  platform: string;
  units: string;
  origin: Vec3;
  exportStatus: "complete" | "partial" | "failed";
  exportWarnings: string[];
};

type CadWebRevisionSession = {
  state: CadWebViewerRevisionState;
  metadata: CadWebViewerMetadata;
  document: CadWebViewerDocument;
  renderCacheByLayerId: ReadonlyMap<string, CadWebRenderLayer>;
};

export type CadWebWorkerReaders = {
  readSnapshot(bytes: Uint8Array): Promise<CadWebDocument>;
  readDelta(bytes: Uint8Array): Promise<CadWebDeltaDocument>;
};

const defaultReaders: CadWebWorkerReaders = {
  readSnapshot: readCadWeb,
  readDelta: readCadWebDelta,
};

function viewerMetadata(
  file: File,
  cadweb: CadWebDocument,
): CadWebViewerMetadata {
  return {
    archiveName: file.name,
    archiveSize: file.size,
    sourceFileName: cadweb.manifest.source.fileName,
    formatVersion: `${cadweb.manifest.formatVersion.major}.${cadweb.manifest.formatVersion.minor}`,
    producer: `${cadweb.manifest.producer.application} ${cadweb.manifest.producer.applicationVersion}`,
    platform: cadweb.manifest.producer.platform,
    units: cadweb.manifest.units.name,
    origin: cadweb.manifest.coordinateSystem.origin,
    exportStatus: cadweb.exportReport.status,
    exportWarnings: cadweb.exportReport.issues.map(
      (issue) => `${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`,
    ),
  };
}

function renderViewerDocument(
  model: CadWebRenderModel,
  metadata: CadWebViewerMetadata,
  previousLayers: ReadonlyMap<string, CadWebRenderLayer> = new Map(),
  captureLayerIds: ReadonlySet<string> | null = null,
): CadWebViewerDocument {
  const builders = new Map<string, LayerBuilder>();
  const warningCounts = new Map<string, number>();
  const renderBudget: RenderBudget = { vertices: 0, exhausted: false };
  for (const layer of model.layers) {
    const captureVertices =
      captureLayerIds === null ||
      captureLayerIds.has(layer.id) ||
      !previousLayers.has(layer.id);
    builders.set(layer.id, {
      layer,
      budget: renderBudget,
      entityCount: 0,
      renderedEntityCount: 0,
      lines: [],
      markers: [],
      bounds: null,
      captureVertices,
    });
  }

  const context: RenderContext = {
    builders,
    blocks: model.blocks,
    origin: metadata.origin,
    warningCounts,
    expandedEntities: 0,
    renderBudget,
    captureLayerIds,
  };
  for (const entity of model.entities) {
    renderEntityTree(entity, IDENTITY_MATRIX, undefined, undefined, 0, context);
  }
  if (renderBudget.exhausted && !warningCounts.has("renderBudget")) {
    warningCounts.set("renderBudget", 1);
  }

  const layers = Array.from(builders.values(), (builder): CadWebRenderLayer => {
    const previous = previousLayers.get(builder.layer.id);
    if (!builder.captureVertices && previous !== undefined) {
      return previous;
    }
    return {
      id: builder.layer.id,
      name: builder.layer.name,
      defaultVisible: builder.layer.visible && !builder.layer.frozen,
      locked: builder.layer.locked,
      colorArgb: builder.layer.colorArgb,
      entityCount: builder.entityCount,
      renderedEntityCount: builder.renderedEntityCount,
      lineVertices: new Float32Array(builder.lines),
      markerVertices: new Float32Array(builder.markers),
      bounds: builder.bounds,
    };
  });

  const warnings = [...metadata.exportWarnings, ...warningSummary(warningCounts)];
  const missingLayerCount = warningCounts.get("missingLayer") ?? 0;
  if (missingLayerCount > 0) {
    warnings.push(
      `${missingLayerCount} entity tham chiếu layer không có trong layers.json; viewer đã tạo layer tạm.`,
    );
  }
  return {
    archiveName: metadata.archiveName,
    archiveSize: metadata.archiveSize,
    sourceFileName: metadata.sourceFileName,
    formatVersion: metadata.formatVersion,
    producer: metadata.producer,
    platform: metadata.platform,
    units: metadata.units,
    origin: metadata.origin,
    extents: model.extents,
    exportStatus: metadata.exportStatus,
    entityCount: model.entities.length,
    renderedEntityCount: layers.reduce(
      (total, layer) => total + layer.renderedEntityCount,
      0,
    ),
    blockDefinitionCount: model.blocks.size,
    layers,
    warnings,
    ...(model.drawingId === undefined ? {} : { drawingId: model.drawingId }),
    ...(model.modelEpoch === undefined ? {} : { modelEpoch: model.modelEpoch }),
    ...(model.revision === undefined ? {} : { revision: model.revision }),
  };
}

function modelFromSnapshot(cadweb: CadWebDocument): CadWebRenderModel {
  return {
    entities: cadweb.entities.entities,
    blocks: new Map((cadweb.blocks?.blocks ?? []).map((block) => [block.id, block])),
    layers: cadweb.layers.layers,
    extents: cadweb.manifest.extents,
  };
}

function modelFromRevision(state: CadWebRevisionState): CadWebRenderModel {
  return {
    entities: [...state.entities.values()],
    blocks: state.blocks,
    layers: [...state.layers.values()],
    extents: state.resultExtents,
    drawingId: state.drawingId,
    modelEpoch: state.modelEpoch,
    revision: state.revision,
  };
}

function renderCacheByLayerId(
  document: CadWebViewerDocument,
): ReadonlyMap<string, CadWebRenderLayer> {
  return new Map(document.layers.map((layer) => [layer.id, layer]));
}

function sameVec3(left: Vec3, right: Vec3): boolean {
  return left.every((value, index) => Object.is(value, right[index]));
}

function validateRecoverySnapshot(
  current: CadWebRevisionSession | undefined,
  nextState: CadWebViewerRevisionState,
  nextMetadata: CadWebViewerMetadata,
): void {
  if (current === undefined) return;
  if (nextState.drawingId !== current.state.drawingId) {
    throw new CadWebError(
      "REVISION_MISMATCH",
      `recovery snapshot drawing ${nextState.drawingId} does not match current drawing ${current.state.drawingId}`,
    );
  }
  if (nextState.revision < current.state.revision) {
    throw new CadWebError(
      "REVISION_MISMATCH",
      `recovery snapshot revision ${nextState.revision} would roll back current revision ${current.state.revision}`,
    );
  }
  if (nextState.modelEpoch === current.state.modelEpoch) {
    if (nextState.sourceFingerprint !== current.state.sourceFingerprint) {
      throw new CadWebError(
        "REVISION_MISMATCH",
        "recovery snapshot source fingerprint changed within the current model epoch",
      );
    }
    if (!sameVec3(nextMetadata.origin, current.metadata.origin)) {
      throw new CadWebError(
        "REVISION_MISMATCH",
        "recovery snapshot origin changed within the current model epoch",
      );
    }
  } else if (nextState.revision === current.state.revision) {
    throw new CadWebError(
      "REVISION_MISMATCH",
      "a model epoch transition must advance the revision",
    );
  }
}

async function readViewerFile(file: File): Promise<Uint8Array> {
  if (file.size > DEFAULT_CADWEB_LIMITS.maxArchiveBytes) {
    throw new CadWebError(
      "ZIP_LIMIT",
      `archive exceeds the ${DEFAULT_CADWEB_LIMITS.maxArchiveBytes}-byte viewer limit`,
    );
  }
  return new Uint8Array(await file.arrayBuffer());
}

function errorResponse(requestId: number, cause: unknown): CadWebWorkerResponse {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
  return { type: "error", requestId, code, message: error.message };
}

function resetNeededResponse(
  requestId: number,
  cause: unknown,
  currentRevision: number | undefined,
): CadWebWorkerResponse {
  const error = cause instanceof Error ? cause : new Error(String(cause));
  const code = "code" in error && typeof error.code === "string"
    ? error.code
    : "DELTA_APPLY_FAILED";
  return {
    type: "reset-needed",
    requestId,
    code,
    message: error.message,
    ...(currentRevision === undefined ? {} : { currentRevision }),
  };
}

export class CadWebWorkerSession {
  private revisionSession: CadWebRevisionSession | undefined;
  private requestTail: Promise<void> = Promise.resolve();

  constructor(private readonly readers: CadWebWorkerReaders = defaultReaders) {}

  get currentRevision(): number | undefined {
    return this.revisionSession?.state.revision;
  }

  get currentDrawingId(): string | undefined {
    return this.revisionSession?.state.drawingId;
  }

  get currentModelEpoch(): string | undefined {
    return this.revisionSession?.state.modelEpoch;
  }

  handle(request: CadWebWorkerRequest): Promise<CadWebWorkerResponse> {
    const response = this.requestTail.then(() => this.handleRequest(request));
    this.requestTail = response.then(
      () => undefined,
      () => undefined,
    );
    return response;
  }

  private async handleRequest(request: CadWebWorkerRequest): Promise<CadWebWorkerResponse> {
    if (request.type === "reset") {
      this.revisionSession = undefined;
      return { type: "reset", requestId: request.requestId };
    }
    if (request.type === "applyDelta") {
      if (this.revisionSession === undefined) {
        return resetNeededResponse(
          request.requestId,
          new CadWebError("REVISION_MISMATCH", "loadSnapshot is required before applyDelta"),
          undefined,
        );
      }
      try {
        const delta = await this.readers.readDelta(await readViewerFile(request.file));
        const staged = stageCadWebDelta(this.revisionSession.state, delta);
        const invalidation: CadWebRenderInvalidation = staged.invalidation;
        const captureLayerIds = invalidation.rebuildAllLayers
          ? null
          : invalidation.layerIds;
        const previousLayers = this.revisionSession.renderCacheByLayerId;
        const metadata: CadWebViewerMetadata = {
          ...this.revisionSession.metadata,
          exportStatus: delta.exportReport.status,
          exportWarnings: delta.exportReport.issues.map(
            (issue) => `${issue.severity.toUpperCase()} ${issue.code}: ${issue.message}`,
          ),
        };
        const document = renderViewerDocument(
          modelFromRevision(staged.state),
          metadata,
          previousLayers,
          captureLayerIds,
        );
        this.revisionSession = {
          state: staged.state,
          metadata,
          document,
          renderCacheByLayerId: renderCacheByLayerId(document),
        };
        return { type: "loaded", requestId: request.requestId, mode: "delta", document };
      } catch (cause) {
        return resetNeededResponse(
          request.requestId,
          cause,
          this.revisionSession.state.revision,
        );
      }
    }

    try {
      const cadweb = await this.readers.readSnapshot(await readViewerFile(request.file));
      const metadata = viewerMetadata(request.file, cadweb);
      if (request.type === "load") {
        const document = renderViewerDocument(modelFromSnapshot(cadweb), metadata);
        this.revisionSession = undefined;
        return { type: "loaded", requestId: request.requestId, mode: "load", document };
      }
      const state = revisionStateFromSnapshot(cadweb, request.revision);
      if (request.type === "resetToSnapshot") {
        validateRecoverySnapshot(this.revisionSession, state, metadata);
      }
      const document = renderViewerDocument(modelFromRevision(state), metadata);
      this.revisionSession = {
        state,
        metadata,
        document,
        renderCacheByLayerId: renderCacheByLayerId(document),
      };
      return {
        type: "loaded",
        requestId: request.requestId,
        mode: request.type === "resetToSnapshot" ? "recovery" : "snapshot",
        document,
      };
    } catch (cause) {
      if (request.type === "resetToSnapshot") {
        return resetNeededResponse(
          request.requestId,
          cause,
          this.revisionSession?.state.revision,
        );
      }
      return errorResponse(request.requestId, cause);
    }
  }
}

export async function loadCadWeb(
  request: Extract<CadWebWorkerRequest, { type: "load" }>,
): Promise<CadWebWorkerResponse> {
  return new CadWebWorkerSession().handle(request);
}

function transferableResponse(response: CadWebWorkerResponse): {
  response: CadWebWorkerResponse;
  transfer: Transferable[];
} {
  if (response.type !== "loaded") return { response, transfer: [] };
  const transfer: Transferable[] = [];
  const layers = response.document.layers.map((layer): CadWebRenderLayer => {
    const lineVertices = layer.lineVertices.slice();
    const markerVertices = layer.markerVertices.slice();
    transfer.push(lineVertices.buffer, markerVertices.buffer);
    return { ...layer, lineVertices, markerVertices };
  });
  return {
    response: { ...response, document: { ...response.document, layers } },
    transfer,
  };
}

const defaultSession = new CadWebWorkerSession();
if (typeof workerScope.addEventListener === "function") {
  workerScope.addEventListener("message", (event) => {
    void defaultSession.handle(event.data).then((result) => {
      const { response, transfer } = transferableResponse(result);
      workerScope.postMessage(response, transfer);
    });
  });
}

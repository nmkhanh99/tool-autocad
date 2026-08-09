import { zipSync } from "fflate";

import { sha256Hex } from "./archive";
import { buildGeometryBuffer } from "./geometry";
import {
  BufferKind,
  EntityKind,
  PropertySourceMode,
  SpaceKind,
} from "./generated/cad-web/v1";
import type {
  CadWebEntity,
  CadWebExportReport,
  CadWebFileDescriptor,
  CadWebLayers,
  CadWebManifest,
} from "./types";

const encoder = new TextEncoder();
const fixedZipDate = new Date(1980, 0, 1, 0, 0, 0);

function jsonBytes(value: unknown): Uint8Array {
  return encoder.encode(`${JSON.stringify(value, null, 2)}\n`);
}

function entity(
  value: Pick<CadWebEntity, "id" | "kind" | "layerId"> & Partial<CadWebEntity>,
): CadWebEntity {
  return {
    sourceHandle: value.id.replace("entity:", ""),
    space: SpaceKind.Model,
    visible: true,
    colorArgb: 0xff_ffffff,
    transparency: 0,
    lineWeightMm: 0.25,
    linetype: "Continuous",
    colorSourceMode: PropertySourceMode.Explicit,
    transparencySourceMode: PropertySourceMode.Explicit,
    lineWeightSourceMode: PropertySourceMode.Explicit,
    linetypeSourceMode: PropertySourceMode.Explicit,
    drawOrder: 0,
    points: [],
    bulges: [],
    startWidths: [],
    endWidths: [],
    constantWidth: 0,
    closed: false,
    radius: 0,
    startAngle: 0,
    endAngle: 0,
    rotation: 0,
    height: 0,
    attributes: [],
    ...value,
  };
}

async function descriptor(
  path: string,
  encoding: "json" | "flatbuffers",
  bytes: Uint8Array,
): Promise<CadWebFileDescriptor> {
  return {
    path,
    encoding,
    ...(encoding === "flatbuffers"
      ? { schemaVersion: 1, byteOrder: "little-endian" as const }
      : {}),
    size: bytes.byteLength,
    sha256: await sha256Hex(bytes),
  };
}

export async function createDeterministicFixture(): Promise<Uint8Array> {
  const layers: CadWebLayers = {
    schemaVersion: 1,
    layers: [
      {
        id: "layer:0",
        name: "0",
        visible: true,
        frozen: false,
        locked: false,
        plot: true,
        colorArgb: 0xff_ffffff,
      },
      {
        id: "layer:annotation",
        name: "ANNOTATION",
        visible: true,
        frozen: false,
        locked: false,
        plot: true,
        colorArgb: 0xff_00ffff,
      },
    ],
  };
  const topLevelEntities: CadWebEntity[] = [
    entity({
      id: "entity:10",
      kind: EntityKind.Line,
      layerId: "layer:0",
      points: [
        [0, 0, 0],
        [10, 0, 0],
      ],
    }),
    entity({
      id: "entity:11",
      kind: EntityKind.Polyline,
      layerId: "layer:0",
      points: [
        [0, 1, 0],
        [4, 1, 0],
        [4, 3, 0],
      ],
      bulges: [0, 0.41421356237309503, 0],
      startWidths: [0.1, 0.1, 0.1],
      endWidths: [0.1, 0.1, 0.1],
    }),
    entity({
      id: "entity:12",
      kind: EntityKind.Arc,
      layerId: "layer:0",
      center: [5, 5, 0],
      radius: 2,
      startAngle: 0,
      endAngle: Math.PI,
      normal: [0, 0, 1],
    }),
    entity({
      id: "entity:13",
      kind: EntityKind.Circle,
      layerId: "layer:0",
      center: [9, 5, 0],
      radius: 1,
      normal: [0, 0, 1],
    }),
    entity({
      id: "entity:14",
      kind: EntityKind.Text,
      layerId: "layer:annotation",
      text: "Cửa Ø100",
      position: [1, 7, 0],
      height: 0.5,
    }),
    entity({
      id: "entity:15",
      kind: EntityKind.BlockReference,
      layerId: "layer:0",
      blockDefinitionId: "block:door",
      transform: [
        1, 0, 0, 12,
        0, 1, 0, 2,
        0, 0, 1, 0,
        0, 0, 0, 1,
      ],
      attributes: [
        {
          id: "attribute:16",
          tag: "DOOR_NO",
          text: "D-01",
          position: [12, 2.5, 0],
          height: 0.25,
        },
      ],
    }),
  ];
  const blockEntities: CadWebEntity[] = [
    entity({
      id: "entity:20",
      kind: EntityKind.Line,
      layerId: "layer:0",
      space: SpaceKind.BlockDefinition,
      points: [
        [0, 0, 0],
        [1, 0, 0],
      ],
    }),
    entity({
      id: "entity:21",
      kind: EntityKind.Arc,
      layerId: "layer:0",
      space: SpaceKind.BlockDefinition,
      center: [0, 0, 0],
      radius: 1,
      startAngle: 0,
      endAngle: Math.PI / 2,
      normal: [0, 0, 1],
    }),
  ];
  const entitiesBytes = buildGeometryBuffer({
    schemaVersion: 1,
    kind: BufferKind.Entities,
    entities: topLevelEntities,
    blocks: [],
  });
  const blocksBytes = buildGeometryBuffer({
    schemaVersion: 1,
    kind: BufferKind.Blocks,
    entities: [],
    blocks: [
      {
        id: "block:door",
        sourceHandle: "1F",
        name: "DOOR",
        basePoint: [0, 0, 0],
        entities: blockEntities,
      },
    ],
  });
  const report: CadWebExportReport = {
    schemaVersion: 1,
    status: "complete",
    counts: { exported: 8, skipped: 0, warnings: 0, errors: 0 },
    issues: [],
  };
  const layersBytes = jsonBytes(layers);
  const reportBytes = jsonBytes(report);
  const manifest: CadWebManifest = {
    format: "cadweb",
    formatVersion: { major: 1, minor: 0 },
    producer: {
      application: "AutoCAD",
      applicationVersion: "2027",
      pluginVersion: "0.1.0",
      platform: "fixture",
    },
    source: {
      fileName: "basic-v1.dwg",
      dwgVersion: "AC1032",
      drawingFingerprint: "cadweb-fixture-basic-v1",
    },
    units: { name: "millimeters", metersPerUnit: 0.001 },
    coordinateSystem: { space: "WCS", upAxis: "Z", origin: [0, 0, 0] },
    extents: { min: [0, 0, 0], max: [13, 7.5, 0] },
    files: {
      layers: await descriptor("layers.json", "json", layersBytes) as CadWebManifest["files"]["layers"],
      entities: await descriptor("entities.bin", "flatbuffers", entitiesBytes) as CadWebManifest["files"]["entities"],
      blocks: await descriptor("blocks.bin", "flatbuffers", blocksBytes) as CadWebManifest["files"]["blocks"],
      exportReport: await descriptor("export-report.json", "json", reportBytes) as CadWebManifest["files"]["exportReport"],
    },
  };
  const manifestBytes = jsonBytes(manifest);
  return zipSync(
    {
      "manifest.json": [manifestBytes, { level: 0, mtime: fixedZipDate }],
      "layers.json": [layersBytes, { level: 0, mtime: fixedZipDate }],
      "entities.bin": [entitiesBytes, { level: 0, mtime: fixedZipDate }],
      "blocks.bin": [blocksBytes, { level: 0, mtime: fixedZipDate }],
      "export-report.json": [reportBytes, { level: 0, mtime: fixedZipDate }],
    },
    { level: 0 },
  );
}

/** Mô hình dữ liệu thư viện block, tách khỏi giao diện.
 *
 * Panel legacy và route mới `/library/blocks` dùng CHUNG file này. Hai giao
 * diện là chuyện tạm thời trong lúc migrate; hai bản logic chuẩn hoá thì không
 * — chúng sẽ lệch nhau, và lệch ở đây nghĩa là hai màn hình nói hai trạng thái
 * đồng bộ khác nhau cho cùng một block.
 *
 * `syncStatus` giữ đủ **5** giá trị của backend. Bộ mẫu thiết kế chỉ vẽ 3
 * (khớp / bản vẽ dùng bản cũ / chỉ có trong bản vẽ); ép xuống 3 sẽ gộp mất
 * `conflict` — trạng thái duy nhất mà người dùng buộc phải xử lý tay.
 */
import { asRecord, type JsonRecord } from "../../lib/daemon/client";

export type BlockType = "static" | "dynamic";
export type BlockSpace = "model" | "layout";
export type SyncStatus = "local_only" | "cad_only" | "synced" | "outdated" | "conflict";

export type LibrarySource = {
  id: string;
  kind: "dwg" | "xtp" | "image";
  displayName: string;
  path: string;
};

export type BlockDefinition = JsonRecord & {
  id: string;
  technicalName: string;
  cadName?: string;
  displayName: string;
  description: string;
  category: string;
  tags: string[];
  useCases: string[];
  type: BlockType;
  hasAttributes: boolean;
  attributeDefinitions: unknown[];
  basePoint: { x: number; y: number; z: number };
  units: string;
  defaultLayer: string;
  allowedSpaces: BlockSpace[];
  annotative: boolean;
  scales: string[];
  sourceId?: string;
  sourcePath?: string;
  sourceBlockName?: string;
  toolPalettePath?: string;
  referenceCount?: number;
  geometryFingerprint?: string;
  previewImage?: string;
  syncStatus: SyncStatus;
};

export type DuplicateGroup = {
  reason: "name_collision" | "geometry_fingerprint";
  key: string;
  blockIds: string[];
};

export type Notice = {
  tone: "ok" | "error" | "info" | "warn";
  text: string;
};

export function textValue(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

export function textList(value: unknown): string[] {
  if (typeof value === "string") return splitList(value);
  if (!Array.isArray(value)) return [];
  return value.map((item) => textValue(item).trim()).filter(Boolean);
}

export function splitList(value: string): string[] {
  return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
}

export function finiteNumber(value: unknown, fallback = 0): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function slugifyTechnicalName(value: string): string {
  const slug = value
    .trim()
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 128)
    .replace(/_+$/g, "");
  return slug || "block";
}

export function normalizeSource(value: unknown): LibrarySource | null {
  const source = asRecord(value);
  if (!source) return null;
  const id = textValue(source.id).trim();
  const kind = source.kind === "xtp" || source.kind === "image" ? source.kind : "dwg";
  if (!id) return null;
  return {
    id,
    kind,
    displayName: textValue(source.displayName || source.name || id),
    path: textValue(source.path || source.sourcePath),
  };
}

export function normalizeBlock(value: unknown): BlockDefinition | null {
  const source = asRecord(value);
  if (!source) return null;
  const id = textValue(source.id || source.blockId).trim();
  const technicalName = textValue(source.technicalName || source.name).trim();
  if (!id || !technicalName) return null;
  const point = asRecord(source.basePoint) || {};
  const spaces = textList(source.allowedSpaces)
    .filter((space): space is BlockSpace => space === "model" || space === "layout");
  const syncStatus = ["local_only", "cad_only", "synced", "outdated", "conflict"]
    .includes(textValue(source.syncStatus))
    ? textValue(source.syncStatus) as SyncStatus
    : "local_only";
  return {
    ...source,
    id,
    technicalName,
    ...(textValue(source.cadName) ? { cadName: textValue(source.cadName) } : {}),
    displayName: textValue(source.displayName || technicalName),
    description: textValue(source.description),
    category: textValue(source.category),
    tags: textList(source.tags),
    useCases: textList(source.useCases),
    type: source.type === "dynamic" ? "dynamic" : "static",
    hasAttributes: source.hasAttributes === true,
    attributeDefinitions: Array.isArray(source.attributeDefinitions)
      ? source.attributeDefinitions
      : [],
    basePoint: {
      x: finiteNumber(point.x),
      y: finiteNumber(point.y),
      z: finiteNumber(point.z),
    },
    units: textValue(source.units || "mm"),
    defaultLayer: textValue(source.defaultLayer || "0"),
    allowedSpaces: spaces.length ? spaces : ["model"],
    annotative: source.annotative === true,
    scales: textList(source.scales),
    ...(textValue(source.sourceId) ? { sourceId: textValue(source.sourceId) } : {}),
    ...(textValue(source.sourcePath) ? { sourcePath: textValue(source.sourcePath) } : {}),
    ...(textValue(source.sourceBlockName)
      ? { sourceBlockName: textValue(source.sourceBlockName) }
      : {}),
    ...(Number.isFinite(Number(source.referenceCount))
      ? { referenceCount: Math.max(0, Math.trunc(Number(source.referenceCount))) }
      : {}),
    ...(textValue(source.geometryFingerprint)
      ? { geometryFingerprint: textValue(source.geometryFingerprint) }
      : {}),
    ...(textValue(source.previewImage)
      ? { previewImage: textValue(source.previewImage) }
      : {}),
    ...(textValue(source.toolPalettePath)
      ? { toolPalettePath: textValue(source.toolPalettePath) }
      : {}),
    syncStatus,
  };
}

export function normalizeDuplicates(value: unknown): DuplicateGroup[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => {
    const row = asRecord(item) || {};
    const reason = row.reason === "geometry_fingerprint"
      ? "geometry_fingerprint"
      : "name_collision";
    return {
      reason,
      key: textValue(row.key),
      blockIds: textList(row.blockIds),
    } as DuplicateGroup;
  }).filter((group) => group.key && group.blockIds.length > 1);
}

export function localDuplicateGroups(blocks: BlockDefinition[]): DuplicateGroup[] {
  const groups: DuplicateGroup[] = [];
  const collect = (
    reason: DuplicateGroup["reason"],
    keyOf: (block: BlockDefinition) => string | undefined,
  ) => {
    const byKey = new Map<string, string[]>();
    for (const block of blocks) {
      const key = keyOf(block)?.trim().toLocaleLowerCase("en-US");
      if (!key) continue;
      byKey.set(key, [...(byKey.get(key) || []), block.id]);
    }
    for (const [key, blockIds] of byKey) {
      if (blockIds.length > 1) groups.push({ reason, key, blockIds });
    }
  };
  collect("name_collision", (block) => block.technicalName);
  collect("geometry_fingerprint", (block) => block.geometryFingerprint);
  return groups;
}

export function emptyBlock(): BlockDefinition {
  return {
    id: "",
    technicalName: "",
    displayName: "",
    description: "",
    category: "",
    tags: [],
    useCases: [],
    type: "static",
    hasAttributes: false,
    attributeDefinitions: [],
    basePoint: { x: 0, y: 0, z: 0 },
    units: "mm",
    defaultLayer: "0",
    allowedSpaces: ["model"],
    annotative: false,
    scales: [],
    syncStatus: "local_only",
  };
}

export function catalogRecord(body: JsonRecord): JsonRecord {
  return asRecord(body.catalog) || asRecord(body.data) || body;
}

export function syncLabel(status: SyncStatus): string {
  if (status === "synced") return "Đã sync";
  if (status === "cad_only") return "Chỉ trong CAD";
  if (status === "outdated") return "Cần cập nhật";
  if (status === "conflict") return "Xung đột";
  return "Chỉ trong app";
}

export function duplicateLabel(reason: DuplicateGroup["reason"]): string {
  return reason === "name_collision" ? "Trùng tên chuẩn" : "Trùng hình học";
}

export function blockMatches(block: BlockDefinition, query: string): boolean {
  if (!query) return true;
  return [
    block.technicalName,
    block.cadName,
    block.displayName,
    block.description,
    block.category,
    block.defaultLayer,
    ...block.tags,
    ...block.useCases,
  ].filter(Boolean).join(" ").toLocaleLowerCase("vi").includes(query);
}

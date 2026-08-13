import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { basename, extname, join } from "node:path";
import express, { type Router } from "express";
import {
  acadRunning as defaultAcadRunning,
  dispatchLiveJob as defaultDispatchLiveJob,
  findCoreConsole as defaultFindCoreConsole,
  listOpenDocs as defaultListOpenDocs,
  requestDrawingInfo as defaultRequestDrawingInfo,
  runHeadless as defaultRunHeadless,
  nativeDocumentTarget,
  selectOpenDocument,
} from "./acadBridge.js";
import {
  BlockLibraryConflictError,
  BlockLibraryValidationError,
  createLibrarySource,
  findBlockDuplicateGroups,
  loadBlockLibraryCatalog,
  parseBlockDescription,
  resolveBlockLibraryDataDir,
  sanitizeBlockDefinition,
  saveBlockLibraryCatalog,
  upsertBlockDefinition,
  upsertLibrarySource,
  type BlockDefinition,
  type BlockLibraryCatalog,
  type BlockLibraryStorageOptions,
  type LibrarySource,
} from "./blockLibrary.js";
import {
  attributesForRow,
  blockMetadataPayload,
  buildBlockMetadataNativeJob,
  buildCreateBlockLisp,
  buildInsertBlockLisp,
  buildWblockExportScript,
  drawingBlocks,
  metadataIdentity,
  parseAcadlibMetadata,
  technicalNameForCadName,
  unitName,
  type DrawingBlockRow,
} from "./blockLibraryCad.js";
import {
  newJobToken,
  runNativeJob as defaultRunNativeJob,
  type NativeDone,
  type WaitExpect,
} from "./livePreview.js";

type OpenDocument = { title: string; file: string; active: boolean };
type JsonRecord = Record<string, unknown>;

export type BlockLibraryRouterDeps = {
  storage?: BlockLibraryStorageOptions;
  now?: () => Date;
  acadRunning?: () => Promise<boolean>;
  listOpenDocs?: (
    timeoutMs?: number,
  ) => Promise<{ alive: boolean; docs: OpenDocument[] }>;
  requestDrawingInfo?: (
    target: string,
    timeoutMs?: number,
  ) => Promise<Record<string, unknown> | null>;
  dispatchLiveJob?: (
    lisp: string,
    target: string | undefined,
    wait: number,
  ) => Promise<{
    jobId: string;
    state: "pending" | "sent" | "done" | "error" | "timeout";
    result: { status: string; message: string } | null;
  }>;
  runNativeJob?: (
    body: string,
    expect: WaitExpect,
    waitMs?: number,
  ) => Promise<NativeDone>;
  findCoreConsole?: () => string | null;
  runHeadless?: (
    bin: string,
    dwg: string | null,
    body: string,
    timeoutMs: number,
  ) => Promise<{ ok: boolean; exit: unknown; stdout: string }>;
};

export type DrawingBlockMergeReport = {
  importedIds: string[];
  updatedIds: string[];
  conflictIds: string[];
  drawingBlockIds: string[];
  missingCatalogBlockIds: string[];
};

const SAFE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,95}$/;
export const BLOCK_LIBRARY_PLUGIN_MIN_VERSION = "1.3.0";

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function cleanRevision(value: unknown): string {
  const revision = String(value ?? "").trim();
  if (!/^[a-f0-9]{64}$/.test(revision)) {
    throw new BlockLibraryValidationError(
      "Thiếu/sai expectedRevision; hãy tải lại thư viện trước khi cập nhật.",
    );
  }
  return revision;
}

function requestedRevision(req: express.Request): string {
  return cleanRevision(req.get("if-match") || req.body?.expectedRevision);
}

function blockById(catalog: BlockLibraryCatalog, value: unknown): BlockDefinition {
  const id = String(value ?? "").trim();
  const block = catalog.blocks.find((item) => item.id === id);
  if (!block) throw new BlockLibraryValidationError("Không tìm thấy block trong thư viện");
  return block;
}

function replaceBlock(
  catalog: BlockLibraryCatalog,
  block: BlockDefinition,
): BlockLibraryCatalog {
  const index = catalog.blocks.findIndex((item) => item.id === block.id);
  if (index >= 0) catalog.blocks[index] = block;
  else catalog.blocks.push(block);
  return catalog;
}

function displayNameFromRow(row: DrawingBlockRow, description: string): string {
  const firstLine = description.split(/\r?\n/, 1)[0]?.trim();
  return (firstLine || row.name).slice(0, 160);
}

function validMetadataId(value: unknown): string | undefined {
  const id = String(value ?? "").trim();
  return SAFE_ID_PATTERN.test(id) ? id : undefined;
}

function rowNameMatchesBlock(row: DrawingBlockRow, block: BlockDefinition): boolean {
  const name = row.name.toLocaleLowerCase("en-US");
  return [block.cadName, block.technicalName]
    .filter(Boolean)
    .some((candidate) => candidate!.toLocaleLowerCase("en-US") === name);
}

function assertRowIdentity(row: DrawingBlockRow, expectedId: string): string | undefined {
  const rowId = validMetadataId(metadataIdentity(row).id);
  if (rowId && rowId !== expectedId) {
    throw new BlockLibraryConflictError(
      `Definition '${row.name}' thuộc block id '${rowId}', không thể dùng cho '${expectedId}'.`,
    );
  }
  return rowId;
}

function rowForBlock(rows: DrawingBlockRow[], block: BlockDefinition): DrawingBlockRow | undefined {
  const byId = rows.find((row) => validMetadataId(metadataIdentity(row).id) === block.id);
  if (byId) return byId;
  const byName = rows.find((row) => rowNameMatchesBlock(row, block));
  if (byName) assertRowIdentity(byName, block.id);
  return byName;
}

/** Convert one plugin snapshot row without guessing geometry or altering source linkage. */
export function blockFromDrawingRow(
  row: DrawingBlockRow,
  existing?: BlockDefinition,
  forcedId?: string,
  now = new Date(),
): BlockDefinition {
  const identity = metadataIdentity(row);
  if (forcedId) assertRowIdentity(row, forcedId);
  const metadata = parseAcadlibMetadata(row.acadlibMetadata);
  const parsedDescription = parseBlockDescription(row.comments || "");
  const id = forcedId || validMetadataId(identity.id) || existing?.id || randomUUID();
  const metadataKey = String(metadata.key ?? "").trim();
  const technicalName = existing?.technicalName ||
    (/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(metadataKey)
      ? metadataKey
      : technicalNameForCadName(row.name));
  const attributeDefinitions = row.attributeDefinitions == null
    ? existing?.attributeDefinitions || []
    : attributesForRow(row);
  const origin = row.origin || (existing
    ? [existing.basePoint.x, existing.basePoint.y, existing.basePoint.z]
    : []);
  const description = parsedDescription.description || existing?.description || "";
  const draft: BlockDefinition = {
    ...(existing || {} as BlockDefinition),
    id,
    technicalName,
    cadName: row.name,
    displayName: existing?.displayName || displayNameFromRow(row, description),
    description,
    category: existing?.category || "",
    tags: existing?.tags || [],
    useCases: existing?.useCases || [],
    type: row.dynamic == null ? existing?.type || "static" : row.dynamic ? "dynamic" : "static",
    hasAttributes: row.hasAttributeDefinitions == null
      ? existing?.hasAttributes || Boolean(attributeDefinitions.length)
      : Boolean(row.hasAttributeDefinitions || attributeDefinitions.length),
    attributeDefinitions,
    basePoint: {
      x: Number(origin[0]) || 0,
      y: Number(origin[1]) || 0,
      z: Number(origin[2]) || 0,
    },
    units: unitName(row.insertUnits ?? existing?.units),
    defaultLayer: existing?.defaultLayer || "0",
    allowedSpaces: existing?.allowedSpaces || ["model", "layout"],
    annotative: row.annotative == null ? existing?.annotative || false : row.annotative,
    scales: row.annotationScales == null ? existing?.scales || [] : row.annotationScales,
    referenceCount: row.referenceCount ?? existing?.referenceCount ?? 0,
    syncStatus: "cad_only",
  };
  const clean = sanitizeBlockDefinition(draft);
  const keyConflict = metadataKey &&
    metadataKey.toLocaleLowerCase("en-US") !== clean.technicalName.toLocaleLowerCase("en-US");
  if (identity.id && existing?.id === identity.id) {
    if (keyConflict) {
      clean.syncStatus = "conflict";
    } else if (identity.revision === blockMetadataPayload(clean).revision) {
      clean.syncStatus = "synced";
      clean.lastSyncedAt = now.toISOString();
    } else {
      clean.syncStatus = "outdated";
    }
  }
  return sanitizeBlockDefinition(clean);
}

/** Merge a drawing scan into the catalog; duplicates are reported, never replaced automatically. */
export function mergeDrawingBlocksIntoCatalog(
  catalogValue: BlockLibraryCatalog,
  snapshot: unknown,
  now = new Date(),
): { catalog: BlockLibraryCatalog; report: DrawingBlockMergeReport } {
  const catalog = {
    ...catalogValue,
    sources: [...catalogValue.sources],
    blocks: catalogValue.blocks.map((block) => ({ ...block })),
  };
  const beforeIds = new Set(catalog.blocks.map((block) => block.id));
  const importedIds: string[] = [];
  const updatedIds: string[] = [];
  const conflictIds = new Set<string>();
  const drawingBlockIds: string[] = [];

  for (const row of drawingBlocks(snapshot)) {
    const identityId = validMetadataId(metadataIdentity(row).id);
    const byId = identityId
      ? catalog.blocks.find((block) => block.id === identityId)
      : undefined;
    const byName = catalog.blocks.find((block) => rowNameMatchesBlock(row, block));
    // A stable ID wins. A same-name/different-ID row is deliberately imported as
    // a conflict so the user can choose rename/merge later.
    const existing = byId || (!identityId ? byName : undefined);
    let block = blockFromDrawingRow(row, existing, identityId || existing?.id, now);
    const collision = catalog.blocks.find((candidate) =>
      candidate.id !== block.id &&
      candidate.technicalName.toLocaleLowerCase("en-US") ===
        block.technicalName.toLocaleLowerCase("en-US"));
    if (collision) {
      block = sanitizeBlockDefinition({ ...block, syncStatus: "conflict" });
      const collisionIndex = catalog.blocks.findIndex((item) => item.id === collision.id);
      catalog.blocks[collisionIndex] = sanitizeBlockDefinition({
        ...collision,
        syncStatus: "conflict",
      });
      conflictIds.add(block.id);
      conflictIds.add(collision.id);
    } else if (block.syncStatus === "conflict") {
      conflictIds.add(block.id);
    }
    replaceBlock(catalog, block);
    drawingBlockIds.push(block.id);
    if (beforeIds.has(block.id)) updatedIds.push(block.id);
    else importedIds.push(block.id);
  }

  const drawingIds = new Set(drawingBlockIds);
  return {
    catalog,
    report: {
      importedIds,
      updatedIds,
      conflictIds: [...conflictIds],
      drawingBlockIds,
      missingCatalogBlockIds: catalog.blocks
        .filter((block) => !drawingIds.has(block.id))
        .map((block) => block.id),
    },
  };
}

function catalogPayload(catalog: BlockLibraryCatalog, extra: JsonRecord = {}): JsonRecord {
  return {
    ok: true,
    catalog,
    revision: catalog.revision,
    blocks: catalog.blocks,
    sources: catalog.sources,
    duplicates: findBlockDuplicateGroups(catalog.blocks),
    ...extra,
  };
}

async function resolveDocument(
  target: unknown,
  deps: Required<Pick<BlockLibraryRouterDeps, "acadRunning" | "listOpenDocs">>,
): Promise<{ document: OpenDocument; exactTarget: string }> {
  if (!(await deps.acadRunning())) throw new Error("AutoCAD chưa chạy");
  const open = await deps.listOpenDocs(4_000);
  if (!open.alive) throw new Error("Plugin AcadBridge không phản hồi");
  const requested = String(target ?? "").trim();
  const selected = selectOpenDocument(open.docs, requested);
  if (selected.ambiguous) {
    throw new Error("Có nhiều bản vẽ khớp target; hãy chọn bằng full file path");
  }
  const document = selected.document;
  if (!document) {
    throw new Error(requested
      ? "Không thấy bản vẽ đang mở khớp chính xác target"
      : "Không thấy bản vẽ active");
  }
  /* `file || instance || title`: bản vẽ CHƯA LƯU không có đường dẫn, nên mã
     phiên là thứ duy nhất chỉ đích danh được khi hai bản vẽ trùng tiêu đề.
     Ở file này mọi chỗ dùng `exactTarget` đều là đường GỬI — `requestDrawingInfo`,
     `dispatchLiveJob`, và header `TARGET` của native job — và cả ba đều kết thúc
     ở `findDocExact()` của plugin, thứ đã nhận mã phiên. Không có chốt LISP nào
     so với `DWGNAME`, cũng không có giá trị nào được LƯU LẠI: `TARGET` chỉ sống
     trong một lượt job. Vì vậy ở đây một đích là đủ, không cần tách đôi như
     `drawingStandards`. */
  const exactTarget = nativeDocumentTarget(document);
  if (!exactTarget) throw new Error("Bản vẽ đích chưa có title/path");
  return { document, exactTarget };
}

function selectionCount(snapshot: unknown): number {
  const root = asRecord(snapshot);
  const selection = asRecord(root.selection);
  const drawingSelection = asRecord(asRecord(root.drawing).selection);
  const count = Number(selection.count ?? drawingSelection.count ?? 0);
  return Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;
}

function assertSnapshot(snapshot: Record<string, unknown> | null): Record<string, unknown> {
  if (!snapshot?.ok) {
    throw new Error(String(snapshot?.error || "Không đọc được trạng thái bản vẽ"));
  }
  return snapshot;
}

function versionAtLeast(value: unknown, minimum: string): boolean {
  const actual = String(value ?? "").split(".").map(Number);
  const required = minimum.split(".").map(Number);
  if (actual.some((part) => !Number.isInteger(part) || part < 0)) return false;
  for (let index = 0; index < Math.max(actual.length, required.length); index++) {
    const left = actual[index] || 0;
    const right = required[index] || 0;
    if (left !== right) return left > right;
  }
  return true;
}

function assertMetadataBridge(snapshot: Record<string, unknown>): void {
  const pluginVersion = asRecord(snapshot.source).pluginVersion;
  if (!versionAtLeast(pluginVersion, BLOCK_LIBRARY_PLUGIN_MIN_VERSION)) {
    throw new Error(
      `Thư viện block cần AcadBridge ${BLOCK_LIBRARY_PLUGIN_MIN_VERSION}+ ` +
      `(đang có ${String(pluginVersion || "không xác định")}); hãy build/nạp lại plugin.`,
    );
  }
}

function assertJobDone(job: {
  state: string;
  result: { status: string; message: string } | null;
}): void {
  if (job.state !== "done" || job.result?.status !== "ok") {
    throw new Error(job.result?.message || `Thao tác AutoCAD chưa hoàn tất (${job.state})`);
  }
}

async function writeCadMetadata(
  block: BlockDefinition,
  target: string,
  runNativeJob: NonNullable<BlockLibraryRouterDeps["runNativeJob"]>,
): Promise<void> {
  const token = newJobToken();
  const opId = `blockmeta-${block.id}`;
  const body = buildBlockMetadataNativeJob(block, target, token);
  const done = await runNativeJob(body, { token, mode: "COMMIT", opId }, 15_000);
  if (!done.ok || done.count !== 1) {
    throw new Error(done.error || `Không ghi được metadata block (count=${done.count})`);
  }
}

function linkedDwgSource(
  block: BlockDefinition,
  catalog: BlockLibraryCatalog,
): { path: string; sourceBlockName: string } {
  const source = block.sourceId
    ? catalog.sources.find((item) => item.id === block.sourceId)
    : undefined;
  const path = block.sourceId
    ? source?.kind === "dwg" ? source.path : ""
    : block.sourcePath || "";
  if (!path) {
    throw new BlockLibraryValidationError(
      "Block chưa link source DWG và definition chưa có trong bản vẽ đích.",
    );
  }
  if (extname(path).toLocaleLowerCase("en-US") !== ".dwg") {
    throw new BlockLibraryValidationError("Nguồn dùng để chèn phải là file DWG");
  }
  if (!existsSync(path)) {
    throw new BlockLibraryValidationError(`Không tìm thấy source DWG: ${path}`);
  }
  return {
    path,
    sourceBlockName: block.sourceBlockName || block.cadName || block.technicalName,
  };
}

async function prepareInsertSource(
  block: BlockDefinition,
  catalog: BlockLibraryCatalog,
  deps: Required<Pick<BlockLibraryRouterDeps, "findCoreConsole" | "runHeadless">> & {
    storage: BlockLibraryStorageOptions;
  },
): Promise<{ path: string; sourceBlockName: string }> {
  const source = linkedDwgSource(block, catalog);
  const stem = basename(source.path, extname(source.path));
  if (stem.toLocaleLowerCase("en-US") === block.technicalName.toLocaleLowerCase("en-US")) {
    return source;
  }
  const stat = statSync(source.path);
  const cacheRevision = createHash("sha256")
    .update(`${source.path}\0${stat.size}\0${stat.mtimeMs}\0${block.sourceRevision || ""}`)
    .digest("hex")
    .slice(0, 16);
  const cacheDir = join(
    resolveBlockLibraryDataDir(deps.storage),
    "block-cache",
    block.id,
    cacheRevision,
  );
  const outputPath = join(cacheDir, `${block.technicalName}.dwg`);
  if (existsSync(outputPath)) return { ...source, path: outputPath };
  const coreConsole = deps.findCoreConsole();
  if (!coreConsole) {
    throw new Error("Không tìm thấy AcCoreConsole để trích block từ source DWG tổng hợp");
  }
  mkdirSync(cacheDir, { recursive: true });
  const script = buildWblockExportScript(source.sourceBlockName, outputPath);
  const result = await deps.runHeadless(coreConsole, source.path, script, 120_000);
  if (!result.ok || !existsSync(outputPath) || !result.stdout.includes("ACADLIB_WBLOCK_OK")) {
    throw new Error(
      `Không trích được block '${source.sourceBlockName}' từ source DWG: ` +
      `${String(result.stdout || result.exit).slice(-500)}`,
    );
  }
  return { ...source, path: outputPath };
}

function errorResponse(res: express.Response, error: unknown): express.Response {
  if (error instanceof BlockLibraryConflictError) {
    return res.status(409).json({ ok: false, code: error.code, error: error.message });
  }
  if (error instanceof BlockLibraryValidationError) {
    return res.status(400).json({ ok: false, code: error.code, error: error.message });
  }
  const message = error instanceof Error ? error.message : String(error);
  const status = /chưa chạy|không phản hồi|không thấy bản vẽ|AcCoreConsole/i.test(message)
    ? 503
    : 400;
  return res.status(status).json({ ok: false, error: message });
}

export function blockLibraryRouter(routerDeps: BlockLibraryRouterDeps = {}): Router {
  const storage = routerDeps.storage || {};
  const now = routerDeps.now || (() => new Date());
  const deps = {
    acadRunning: routerDeps.acadRunning || defaultAcadRunning,
    listOpenDocs: routerDeps.listOpenDocs || defaultListOpenDocs,
    requestDrawingInfo: routerDeps.requestDrawingInfo || defaultRequestDrawingInfo,
    dispatchLiveJob: routerDeps.dispatchLiveJob || defaultDispatchLiveJob,
    runNativeJob: routerDeps.runNativeJob || defaultRunNativeJob,
    findCoreConsole: routerDeps.findCoreConsole || defaultFindCoreConsole,
    runHeadless: routerDeps.runHeadless || defaultRunHeadless,
  };
  const router = express.Router();
  let mutationTail = Promise.resolve();

  const serializeMutation = (
    handler: (req: express.Request, res: express.Response) => unknown | Promise<unknown>,
  ) => async (req: express.Request, res: express.Response): Promise<void> => {
    const previous = mutationTail;
    let release!: () => void;
    mutationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      await handler(req, res);
    } finally {
      release();
    }
  };

  router.get("/", (_req, res) => {
    try {
      const catalog = loadBlockLibraryCatalog(storage);
      return res.json(catalogPayload(catalog, {
        capabilities: {
          createFromSelection: ["static", "attribute"],
          dynamicAuthoring: false,
          dynamicImport: true,
          metadata: { descriptionFallback: true, xrecord: "ACADLIB" },
          minPluginVersion: BLOCK_LIBRARY_PLUGIN_MIN_VERSION,
          palettes: {
            primary: process.platform === "darwin" ? "blocks_palette" : "app",
            xtp: process.platform === "win32" ? "compatibility_export" : "linked_artifact_only",
            authoritative: false,
          },
        },
      }));
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  router.get("/sources", (_req, res) => {
    try {
      const catalog = loadBlockLibraryCatalog(storage);
      return res.json({ ok: true, revision: catalog.revision, sources: catalog.sources });
    } catch (error) {
      return errorResponse(res, error);
    }
  });

  router.post("/sources", serializeMutation((req, res) => {
    try {
      const expectedRevision = requestedRevision(req);
      const raw = asRecord(req.body?.source);
      const source: LibrarySource = raw.id
        ? { ...raw } as LibrarySource
        : createLibrarySource({
            kind: raw.kind as LibrarySource["kind"],
            displayName: String(raw.displayName ?? ""),
            path: String(raw.path ?? ""),
          });
      const catalog = upsertLibrarySource(source, expectedRevision, storage);
      return res.status(201).json(catalogPayload(catalog));
    } catch (error) {
      return errorResponse(res, error);
    }
  }));

  router.put("/:id", serializeMutation((req, res) => {
    try {
      const expectedRevision = requestedRevision(req);
      const raw = asRecord(req.body?.block);
      if (raw.id && String(raw.id) !== req.params.id) {
        throw new BlockLibraryValidationError("Block id trong URL/body không khớp");
      }
      const currentCatalog = loadBlockLibraryCatalog(storage);
      if (currentCatalog.revision !== expectedRevision) {
        throw new BlockLibraryConflictError(
          "Block library đã thay đổi; hãy tải lại trước khi lưu.",
        );
      }
      const previous = currentCatalog.blocks.find((block) => block.id === req.params.id);
      let next = sanitizeBlockDefinition({
        ...raw,
        id: req.params.id,
        // Sync state is derived from CAD, never trusted from an editable form.
        syncStatus: previous?.syncStatus || raw.syncStatus || "local_only",
        lastSyncedAt: previous?.lastSyncedAt,
      });
      if (previous && previous.syncStatus === "synced" &&
          blockMetadataPayload(previous).revision !== blockMetadataPayload(next).revision) {
        next = sanitizeBlockDefinition({
          ...next,
          syncStatus: "outdated",
          lastSyncedAt: undefined,
        });
      }
      const catalog = upsertBlockDefinition(
        next,
        expectedRevision,
        storage,
      );
      return res.json(catalogPayload(catalog));
    } catch (error) {
      return errorResponse(res, error);
    }
  }));

  router.post("/scan", serializeMutation(async (req, res) => {
    try {
      const expectedRevision = requestedRevision(req);
      const catalog = loadBlockLibraryCatalog(storage);
      if (catalog.revision !== expectedRevision) {
        throw new BlockLibraryConflictError("Thư viện đã thay đổi; hãy tải lại rồi quét.");
      }
      const { document, exactTarget } = await resolveDocument(req.body?.target, deps);
      const snapshot = assertSnapshot(await deps.requestDrawingInfo(exactTarget, 12_000));
      const merged = mergeDrawingBlocksIntoCatalog(catalog, snapshot, now());
      const saved = saveBlockLibraryCatalog(merged.catalog, expectedRevision, storage);
      return res.json(catalogPayload(saved, {
        target: document.file || document.title,
        report: merged.report,
      }));
    } catch (error) {
      return errorResponse(res, error);
    }
  }));

  router.post("/create", serializeMutation(async (req, res) => {
    try {
      const expectedRevision = requestedRevision(req);
      const catalog = loadBlockLibraryCatalog(storage);
      if (catalog.revision !== expectedRevision) {
        throw new BlockLibraryConflictError("Thư viện đã thay đổi; hãy tải lại trước khi tạo block.");
      }
      let block: BlockDefinition;
      if (req.body?.blockId) {
        block = blockById(catalog, req.body.blockId);
      } else {
        const raw = asRecord(req.body?.block);
        block = sanitizeBlockDefinition({
          ...raw,
          id: raw.id || randomUUID(),
          syncStatus: raw.syncStatus || "local_only",
        });
        const duplicate = catalog.blocks.find((item) =>
          item.technicalName.toLocaleLowerCase("en-US") ===
            block.technicalName.toLocaleLowerCase("en-US"));
        if (duplicate) {
          throw new BlockLibraryConflictError(
            `Tên kỹ thuật '${block.technicalName}' đã có trong thư viện; không tự ghi đè.`,
          );
        }
      }
      const { document, exactTarget } = await resolveDocument(req.body?.target, deps);
      if (!document.active) {
        throw new BlockLibraryValidationError(
          "Tạo block từ selection chỉ áp dụng cho bản vẽ đang active trong AutoCAD.",
        );
      }
      const before = assertSnapshot(await deps.requestDrawingInfo(exactTarget, 10_000));
      assertMetadataBridge(before);
      if (selectionCount(before) < 1) {
        throw new BlockLibraryValidationError(
          "Hãy chọn hình/ATTDEF trong AutoCAD trước khi bấm Tạo block.",
        );
      }
      const job = await deps.dispatchLiveJob(buildCreateBlockLisp(block), exactTarget, 120_000);
      assertJobDone(job);
      const after = assertSnapshot(await deps.requestDrawingInfo(exactTarget, 12_000));
      const row = rowForBlock(drawingBlocks(after), block);
      if (!row) throw new Error("Đã chạy BLOCK nhưng không tìm thấy definition vừa tạo");
      block = blockFromDrawingRow(row, block, block.id, now());
      await writeCadMetadata(block, exactTarget, deps.runNativeJob);
      block = sanitizeBlockDefinition({
        ...block,
        syncStatus: "synced",
        lastSyncedAt: now().toISOString(),
      });
      replaceBlock(catalog, block);
      const saved = saveBlockLibraryCatalog(catalog, expectedRevision, storage);
      return res.status(201).json(catalogPayload(saved, {
        block,
        target: document.file || document.title,
        hint: "Đã tạo block, ghi Description + ACADLIB XRecord và đồng bộ catalog.",
      }));
    } catch (error) {
      return errorResponse(res, error);
    }
  }));

  router.post("/sync", serializeMutation(async (req, res) => {
    try {
      const expectedRevision = requestedRevision(req);
      const catalog = loadBlockLibraryCatalog(storage);
      if (catalog.revision !== expectedRevision) {
        throw new BlockLibraryConflictError("Thư viện đã thay đổi; hãy tải lại trước khi sync.");
      }
      let block = blockById(catalog, req.body?.blockId);
      const { document, exactTarget } = await resolveDocument(req.body?.target, deps);
      const snapshot = assertSnapshot(await deps.requestDrawingInfo(exactTarget, 10_000));
      assertMetadataBridge(snapshot);
      const row = rowForBlock(drawingBlocks(snapshot), block);
      if (!row) {
        throw new BlockLibraryValidationError(
          "Definition chưa có trong bản vẽ đích; hãy dùng Chèn block trước.",
        );
      }
      block = sanitizeBlockDefinition({
        ...block,
        cadName: row.name,
        referenceCount: row.referenceCount ?? block.referenceCount ?? 0,
      });
      await writeCadMetadata(block, exactTarget, deps.runNativeJob);
      block = sanitizeBlockDefinition({
        ...block,
        syncStatus: "synced",
        lastSyncedAt: now().toISOString(),
      });
      replaceBlock(catalog, block);
      const saved = saveBlockLibraryCatalog(catalog, expectedRevision, storage);
      return res.json(catalogPayload(saved, {
        block,
        target: document.file || document.title,
        hint: "Đã đồng bộ Description và ACADLIB XRecord vào AutoCAD.",
      }));
    } catch (error) {
      return errorResponse(res, error);
    }
  }));

  router.post("/insert", serializeMutation(async (req, res) => {
    try {
      const expectedRevision = requestedRevision(req);
      const catalog = loadBlockLibraryCatalog(storage);
      if (catalog.revision !== expectedRevision) {
        throw new BlockLibraryConflictError("Thư viện đã thay đổi; hãy tải lại trước khi chèn.");
      }
      let block = blockById(catalog, req.body?.blockId);
      const { document, exactTarget } = await resolveDocument(req.body?.target, deps);
      const before = assertSnapshot(await deps.requestDrawingInfo(exactTarget, 10_000));
      assertMetadataBridge(before);
      let row = rowForBlock(drawingBlocks(before), block);
      let definitionName: string;
      let insertSource: string | undefined;
      let staleExistingDefinition = false;
      let shouldWriteMetadata = false;
      if (row) {
        definitionName = row.name;
        const identity = metadataIdentity(row);
        staleExistingDefinition = validMetadataId(identity.id) === block.id &&
          identity.revision !== blockMetadataPayload(block).revision;
        shouldWriteMetadata = !validMetadataId(identity.id);
        block = sanitizeBlockDefinition({
          ...block,
          cadName: row.name,
          referenceCount: row.referenceCount ?? block.referenceCount ?? 0,
        });
      } else {
        const source = await prepareInsertSource(block, catalog, { ...deps, storage });
        definitionName = block.technicalName;
        insertSource = source.path;
        shouldWriteMetadata = true;
        block = sanitizeBlockDefinition({
          ...block,
          sourceBlockName: block.sourceBlockName || source.sourceBlockName,
        });
      }
      const job = await deps.dispatchLiveJob(buildInsertBlockLisp({
        definitionName,
        insertSource,
        defaultLayer: block.defaultLayer,
        allowedSpaces: block.allowedSpaces,
        scale: req.body?.scale ?? 1,
        rotation: req.body?.rotation ?? 0,
      }), exactTarget, 120_000);
      assertJobDone(job);
      const after = assertSnapshot(await deps.requestDrawingInfo(exactTarget, 12_000));
      const afterRows = drawingBlocks(after);
      row = rowForBlock(afterRows, block);
      if (!row) {
        const namedRow = afterRows.find((item) =>
          item.name.toLocaleLowerCase("en-US") === definitionName.toLocaleLowerCase("en-US"));
        if (namedRow) assertRowIdentity(namedRow, block.id);
        row = namedRow;
      }
      if (!row) throw new Error("Đã chạy INSERT nhưng không tìm thấy definition trong bản vẽ");
      block = sanitizeBlockDefinition({
        ...block,
        cadName: row.name,
        referenceCount: row.referenceCount ?? block.referenceCount ?? 0,
      });
      if (!staleExistingDefinition && shouldWriteMetadata) {
        await writeCadMetadata(block, exactTarget, deps.runNativeJob);
      }
      block = sanitizeBlockDefinition(staleExistingDefinition
        ? { ...block, syncStatus: "outdated", lastSyncedAt: undefined }
        : { ...block, syncStatus: "synced", lastSyncedAt: now().toISOString() });
      replaceBlock(catalog, block);
      const saved = saveBlockLibraryCatalog(catalog, expectedRevision, storage);
      return res.json(catalogPayload(saved, {
        block,
        target: document.file || document.title,
        hint: staleExistingDefinition
          ? "Đã chèn definition hiện có; metadata trong AutoCAD vẫn cũ và cần review/sync."
          : "Đã chèn block tại điểm chọn và đồng bộ metadata definition.",
      }));
    } catch (error) {
      return errorResponse(res, error);
    }
  }));

  return router;
}

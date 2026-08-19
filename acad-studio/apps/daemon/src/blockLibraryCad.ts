import { createHash } from "node:crypto";
import {
  mergeBlockDescription,
  parseBlockDescription,
  slugifyTechnicalName,
  TECHNICAL_NAME_PATTERN,
  type BlockAttributeDefinition,
  type BlockDefinition,
} from "./blockLibrary.js";

type JsonRecord = Record<string, unknown>;

export type DrawingBlockRow = {
  name: string;
  handle?: string;
  comments?: string;
  anonymous?: boolean;
  isLayout?: boolean;
  isXref?: boolean;
  dynamic?: boolean;
  hasAttributeDefinitions?: boolean;
  origin?: number[];
  referenceCount?: number;
  insertUnits?: number | string;
  annotative?: boolean;
  annotationScales?: string[];
  attributeDefinitions?: unknown[];
  acadlibMetadata?: string;
};

const UNIT_NAMES: Record<number, string> = {
  0: "unitless",
  1: "in",
  2: "ft",
  4: "mm",
  5: "cm",
  6: "m",
  7: "km",
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as JsonRecord
    : {};
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function boolValue(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function optionalBool(row: JsonRecord, ...keys: string[]): boolean | undefined {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key) && row[key] != null) {
      return boolValue(row[key]);
    }
  }
  return undefined;
}

function finiteNumber(value: unknown, fallback = 0): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function cleanStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item).trim()).filter(Boolean).slice(0, 100);
}

function cleanAttributeDefinitions(value: unknown): BlockAttributeDefinition[] {
  if (!Array.isArray(value)) return [];
  const output: BlockAttributeDefinition[] = [];
  for (const raw of value.slice(0, 500)) {
    const row = asRecord(raw);
    const tag = stringValue(row.tag);
    if (!TECHNICAL_NAME_PATTERN.test(tag)) continue;
    output.push({
      tag,
      prompt: stringValue(row.prompt),
      defaultValue: stringValue(row.defaultValue ?? row.default),
      invisible: boolValue(row.invisible),
      constant: boolValue(row.constant),
      preset: boolValue(row.preset),
      verify: boolValue(row.verify ?? row.verifiable),
      lockPosition: boolValue(row.lockPosition),
    });
  }
  return output;
}

export function parseAcadlibMetadata(value: unknown): JsonRecord {
  if (typeof value !== "string" || !value.trim()) return {};
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

export function drawingBlocks(snapshot: unknown): DrawingBlockRow[] {
  const root = asRecord(snapshot);
  const drawing = asRecord(root.drawing);
  const tables = asRecord(root.tables);
  const raw = Array.isArray(drawing.blocks)
    ? drawing.blocks
    : Array.isArray(tables.blocks)
      ? tables.blocks
      : [];
  return raw
    .map((item) => asRecord(item))
    .map((row) => ({
      name: stringValue(row.name),
      handle: stringValue(row.handle) || undefined,
      comments: stringValue(row.comments ?? row.description) || undefined,
      anonymous: boolValue(row.anonymous),
      isLayout: boolValue(row.isLayout ?? row.layout),
      isXref: boolValue(row.isXref ?? row.xref),
      dynamic: optionalBool(row, "dynamic", "isDynamicBlock"),
      hasAttributeDefinitions: optionalBool(row, "hasAttributeDefinitions"),
      origin: Array.isArray(row.origin)
        ? row.origin.map((item) => finiteNumber(item)).slice(0, 3)
        : undefined,
      referenceCount: row.referenceCount != null || row.references != null || row.count != null
        ? Math.max(0, Math.trunc(finiteNumber(
            row.referenceCount ?? row.references ?? row.count,
          )))
        : undefined,
      insertUnits: typeof row.insertUnits === "string" || typeof row.insertUnits === "number"
        ? row.insertUnits
        : undefined,
      annotative: optionalBool(row, "annotative"),
      annotationScales: Array.isArray(row.annotationScales) || Array.isArray(row.scales)
        ? cleanStringArray(row.annotationScales ?? row.scales)
        : undefined,
      attributeDefinitions: Array.isArray(row.attributeDefinitions)
        ? row.attributeDefinitions
        : undefined,
      acadlibMetadata: stringValue(row.acadlibMetadata) || undefined,
    }))
    .filter((row) => row.name && !row.anonymous && !row.isLayout && !row.isXref);
}

export function metadataIdentity(row: DrawingBlockRow): {
  id?: string;
  revision?: string;
} {
  const metadata = parseAcadlibMetadata(row.acadlibMetadata);
  const description = parseBlockDescription(row.comments || "");
  const id = stringValue(metadata.id) || description.id;
  const revision = stringValue(metadata.revision);
  return {
    ...(id ? { id } : {}),
    ...(revision ? { revision } : {}),
  };
}

export function unitName(value: unknown): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  const number = Number(value);
  return Number.isInteger(number) ? UNIT_NAMES[number] || `acad:${number}` : "unitless";
}

export function blockMetadataPayload(block: BlockDefinition): {
  schema: "acad-studio.block/1";
  id: string;
  key: string;
  revision: string;
} {
  const content = {
    schema: "acad-studio.block/1" as const,
    id: block.id,
    key: block.technicalName,
    displayName: block.displayName,
    description: block.description,
    category: block.category,
    tags: [...block.tags].sort((a, b) => a.localeCompare(b, "en-US")),
    useCases: [...block.useCases].sort((a, b) => a.localeCompare(b, "en-US")),
    type: block.type,
    hasAttributes: block.hasAttributes,
    attributeDefinitions: block.attributeDefinitions,
    basePoint: block.basePoint,
    units: block.units,
    defaultLayer: block.defaultLayer,
    allowedSpaces: [...block.allowedSpaces].sort(),
    annotative: block.annotative,
    scales: [...block.scales].sort((a, b) => a.localeCompare(b, "en-US")),
    sourceId: block.sourceId || "",
    sourcePath: block.sourcePath || "",
    sourceBlockName: block.sourceBlockName || "",
    sourceRevision: block.sourceRevision || "",
  };
  const revision = createHash("sha256")
    .update(JSON.stringify(content))
    .digest("hex");
  return { schema: content.schema, id: block.id, key: block.technicalName, revision };
}

export function hexUtf8(value: string): string {
  return Buffer.from(value, "utf8").toString("hex");
}

function nativeCell(value: unknown): string {
  return String(value ?? "").replace(/[\t\r\n]/g, " ");
}

export function buildBlockMetadataNativeJob(
  block: BlockDefinition,
  target: string,
  token: string,
): string {
  if (!token) throw new Error("token required");
  const name = block.cadName || block.technicalName;
  const comments = mergeBlockDescription(block.description, block.id);
  const metadata = JSON.stringify(blockMetadataPayload(block));
  const lines = [
    "MODE\tCOMMIT",
    `OPID\tblockmeta-${nativeCell(block.id)}`,
    `TOKEN\t${nativeCell(token)}`,
  ];
  if (target) lines.push(`TARGET\t${nativeCell(target)}`);
  lines.push(
    `BLOCKMETA\t${nativeCell(name)}\t${hexUtf8(comments)}\t${hexUtf8(metadata)}`,
  );
  return `${lines.join("\n")}\n`;
}

function lispString(value: unknown): string {
  const text = String(value ?? "");
  if (/[\0\r\n]/.test(text)) throw new Error("Chuỗi AutoLISP chứa ký tự không an toàn");
  return `"${text.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function lispNumber(value: unknown, label: string): string {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new Error(`${label} phải là số hữu hạn`);
  return String(number);
}

function allowedSpaceExpression(allowedSpaces: BlockDefinition["allowedSpaces"]): string {
  const model = allowedSpaces.includes("model");
  const layout = allowedSpaces.includes("layout");
  if (model && layout) return "T";
  if (model) return '(= acadlib:space "model")';
  if (layout) return '(= acadlib:space "layout")';
  return "nil";
}

export function buildCreateBlockLisp(block: BlockDefinition): string {
  if (block.type === "dynamic") {
    throw new Error("MVP chỉ tạo block tĩnh/attribute; dynamic block phải author trong Block Editor");
  }
  const name = block.technicalName;
  const layer = block.defaultLayer || "0";
  const fallbackDescription = mergeBlockDescription(block.description, block.id)
    .replace(/\r?\n/g, " | ");
  return `
(setq acadlib:ss (cadr (ssgetfirst)))
(setq acadlib:old-layer (getvar "CLAYER"))
(setq acadlib:space
  (if (or (= (getvar "TILEMODE") 1) (> (getvar "CVPORT") 1)) "model" "layout"))
(cond
  ((not ${allowedSpaceExpression(block.allowedSpaces)})
    (acad:write-result "error" (strcat "space_not_allowed=" acadlib:space)))
  ((null acadlib:ss)
    (acad:write-result "error" "selection_required"))
  ((tblsearch "BLOCK" ${lispString(name)})
    (acad:write-result "error" "block_name_exists"))
  (T
    (setq acadlib:bp (getpoint "\\nChon diem chen block: "))
    (if (null acadlib:bp)
      (acad:write-result "error" "cancelled")
      (progn
        (command "_.-BLOCK" ${lispString(name)} acadlib:bp acadlib:ss "")
        (setq acadlib:btr (tblobjname "BLOCK" ${lispString(name)}))
        (if acadlib:btr
          (progn
            (setq acadlib:ed (entget acadlib:btr))
            (if (assoc 4 acadlib:ed)
              (entmod (subst (cons 4 ${lispString(fallbackDescription)}) (assoc 4 acadlib:ed) acadlib:ed))
              (entmod (append acadlib:ed (list (cons 4 ${lispString(fallbackDescription)})))))
            (command "_.-LAYER" "_M" ${lispString(layer)} "")
            ;; -BLOCK DOI phan da chon thanh mot the hien cua block vua tao, nen
            ;; entlast chinh la the hien do -- da do tren AcCoreConsole 2027:
            ;; entlast ra INSERT mang dung ten block, doi tuong khac khong dung toi.
            ;; Nhung no dung nho mot dieu kien NGAM: khong co gi them doi tuong vao
            ;; ban ve giua -BLOCK va entlast (-LAYER _M chi tao ban ghi bang, khong
            ;; phai doi tuong). Chen mot buoc vao quang do la CHPROP lang le doi
            ;; layer cua mot hinh KHONG lien quan.
            ;; Nen kiem thang thu vua nhat duoc thay vi tin vao thu tu: dung loai
            ;; INSERT va dung ten block thi moi doi. Sai thi BO QUA -- khong doi
            ;; layer con sua duoc bang tay, doi nham mot hinh khac thi khong ai
            ;; biet ma sua.
            (setq acadlib:ref (entlast))
            (if (and acadlib:ref
                     (= (cdr (assoc 0 (entget acadlib:ref))) "INSERT")
                     (= (strcase (cdr (assoc 2 (entget acadlib:ref))))
                        (strcase ${lispString(name)})))
              (command "_.CHPROP" acadlib:ref "" "_LA" ${lispString(layer)} ""))
            (setvar "CLAYER" acadlib:old-layer)
            (acad:write-result "ok" (strcat "created=" ${lispString(name)}))
          )
          (acad:write-result "error" "create_failed")
        )
      )
    )
  )
)
(princ)
`.trim() + "\n";
}

export function buildInsertBlockLisp(options: {
  definitionName: string;
  insertSource?: string;
  defaultLayer: string;
  allowedSpaces?: BlockDefinition["allowedSpaces"];
  scale?: number;
  rotation?: number;
}): string {
  const definitionName = options.definitionName.trim();
  if (!definitionName) throw new Error("definitionName required");
  const insertSpec = options.insertSource?.trim() || definitionName;
  const layer = options.defaultLayer.trim() || "0";
  const scale = lispNumber(options.scale ?? 1, "scale");
  const rotation = lispNumber(options.rotation ?? 0, "rotation");
  const allowedSpaces = options.allowedSpaces ?? ["model", "layout"];
  return `
(setq acadlib:space
  (if (or (= (getvar "TILEMODE") 1) (> (getvar "CVPORT") 1)) "model" "layout"))
(if (not ${allowedSpaceExpression(allowedSpaces)})
  (acad:write-result "error" (strcat "space_not_allowed=" acadlib:space))
  (progn
    (setq acadlib:old-layer (getvar "CLAYER"))
    (setq acadlib:old-attreq (getvar "ATTREQ"))
    (setq acadlib:old-attdia (getvar "ATTDIA"))
    (setq acadlib:outer-error *error*)
    (defun acadlib:restore ()
      (setvar "CLAYER" acadlib:old-layer)
      (setvar "ATTREQ" acadlib:old-attreq)
      (setvar "ATTDIA" acadlib:old-attdia))
    (setq *error*
      (lambda (message)
        (acadlib:restore)
        (setq *error* acadlib:outer-error)
        (acad:write-result "error" (if message message "insert_failed"))
        (princ)))
    (command "_.-LAYER" "_M" ${lispString(layer)} "")
    (setvar "ATTREQ" 0)
    (setvar "ATTDIA" 0)
    (setq acadlib:pt (getpoint "\\nChon diem chen block: "))
    (if acadlib:pt
      (progn
        (command "_.-INSERT" ${lispString(insertSpec)} acadlib:pt ${scale} ${scale} ${rotation})
        (acadlib:restore)
        (setq *error* acadlib:outer-error)
        (acad:write-result "ok" (strcat "inserted=" ${lispString(definitionName)}))
      )
      (progn
        (acadlib:restore)
        (setq *error* acadlib:outer-error)
        (acad:write-result "error" "cancelled")
      )
    )
  )
)
(princ)
`.trim() + "\n";
}

export function buildWblockExportScript(blockName: string, outputPath: string): string {
  const name = blockName.trim();
  if (!name || /[\0\r\n\t"]/.test(name)) throw new Error("Tên block nguồn không hợp lệ");
  if (!outputPath || /[\0\r\n"]/.test(outputPath)) throw new Error("Đường dẫn WBLOCK không hợp lệ");
  return `(setvar "FILEDIA" 0)(setvar "CMDDIA" 0)\n` +
    `(if (tblsearch "BLOCK" ${lispString(name)})\n` +
    `  (progn (command "_.-WBLOCK" ${lispString(outputPath)} ${lispString(name)}) ` +
    `(princ "\\nACADLIB_WBLOCK_OK"))\n` +
    `  (princ "\\nACADLIB_WBLOCK_MISSING"))\n(princ)\n`;
}

export function technicalNameForCadName(name: string): string {
  const clean = name.trim();
  if (TECHNICAL_NAME_PATTERN.test(clean) && !clean.startsWith("*") && !clean.includes("$")) {
    return clean;
  }
  return slugifyTechnicalName(clean);
}

export function attributesForRow(row: DrawingBlockRow): BlockAttributeDefinition[] {
  return cleanAttributeDefinitions(row.attributeDefinitions);
}

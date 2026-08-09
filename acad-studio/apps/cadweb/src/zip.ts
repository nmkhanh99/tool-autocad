import { unzipSync } from "fflate";

import { CadWebError } from "./errors";

const LOCAL_FILE_SIGNATURE = 0x04034b50;
const CENTRAL_FILE_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP64_EXTRA_FIELD = 0x0001;
const MAX_ZIP_COMMENT = 65_535;

export interface CadWebReadLimits {
  maxArchiveBytes: number;
  maxEntries: number;
  maxEntryUncompressedBytes: number;
  maxTotalUncompressedBytes: number;
  maxCompressionRatio: number;
  maxManifestBytes: number;
  maxJsonPayloadBytes: number;
}

export const DEFAULT_CADWEB_LIMITS: Readonly<CadWebReadLimits> = {
  maxArchiveBytes: 256 * 1024 * 1024,
  maxEntries: 128,
  maxEntryUncompressedBytes: 128 * 1024 * 1024,
  maxTotalUncompressedBytes: 256 * 1024 * 1024,
  maxCompressionRatio: 100,
  maxManifestBytes: 1024 * 1024,
  maxJsonPayloadBytes: 16 * 1024 * 1024,
};

export interface ZipEntryInfo {
  readonly name: string;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly compressionMethod: 0 | 8;
  readonly crc32: number;
}

export interface InspectedZip {
  readonly entries: readonly ZipEntryInfo[];
  readonly totalUncompressedSize: number;
}

interface InternalZipEntry extends ZipEntryInfo {
  localStart: number;
  dataEnd: number;
}

const utf8 = new TextDecoder("utf-8", { fatal: true });
const crcTable = new Uint32Array(256);
for (let index = 0; index < crcTable.length; index += 1) {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) {
    value = (value & 1) !== 0 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  }
  crcTable[index] = value >>> 0;
}

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff]! ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function ensureRange(bytes: Uint8Array, offset: number, length: number, label: string): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0) {
    throw new CadWebError("ZIP_INVALID", `${label} has an invalid byte range`);
  }
  if (offset > bytes.byteLength || length > bytes.byteLength - offset) {
    throw new CadWebError("ZIP_INVALID", `${label} extends outside the archive`);
  }
}

function readName(bytes: Uint8Array, offset: number, length: number, flags: number): string {
  ensureRange(bytes, offset, length, "ZIP entry name");
  const raw = bytes.subarray(offset, offset + length);
  if ((flags & 0x0800) === 0 && raw.some((byte) => byte > 0x7f)) {
    throw new CadWebError("ZIP_PATH", "non-ASCII ZIP paths must use the UTF-8 flag");
  }
  try {
    return utf8.decode(raw);
  } catch (cause) {
    throw new CadWebError("ZIP_PATH", "ZIP entry path is not valid UTF-8", { cause });
  }
}

function validatePath(name: string): void {
  if (
    name.length === 0 ||
    name.startsWith("/") ||
    /^[A-Za-z]:/.test(name) ||
    name.includes("\\") ||
    /[\u0000-\u001f\u007f]/.test(name) ||
    name.normalize("NFC") !== name
  ) {
    throw new CadWebError("ZIP_PATH", `unsafe ZIP entry path: ${JSON.stringify(name)}`);
  }
  const segments = name.split("/");
  if (
    segments.some(
      (segment) =>
        segment === "" ||
        segment === "." ||
        segment === ".." ||
        segment === "__proto__" ||
        segment === "prototype" ||
        segment === "constructor",
    )
  ) {
    throw new CadWebError("ZIP_PATH", `unsafe ZIP entry path: ${JSON.stringify(name)}`);
  }
}

function validateExtraFields(
  view: DataView,
  bytes: Uint8Array,
  offset: number,
  length: number,
): void {
  ensureRange(bytes, offset, length, "ZIP extra fields");
  const end = offset + length;
  let cursor = offset;
  while (cursor < end) {
    if (end - cursor < 4) {
      throw new CadWebError("ZIP_INVALID", "ZIP extra field header is truncated");
    }
    const type = view.getUint16(cursor, true);
    const fieldLength = view.getUint16(cursor + 2, true);
    cursor += 4;
    if (fieldLength > end - cursor) {
      throw new CadWebError("ZIP_INVALID", "ZIP extra field payload is truncated");
    }
    if (type === ZIP64_EXTRA_FIELD) {
      throw new CadWebError("ZIP_INVALID", "ZIP64 archives are not supported by CADWeb v1");
    }
    cursor += fieldLength;
  }
}

function findEndOfCentralDirectory(view: DataView, bytes: Uint8Array): number {
  if (bytes.byteLength < 22) {
    throw new CadWebError("ZIP_INVALID", "archive is too short to be a ZIP file");
  }
  const earliest = Math.max(0, bytes.byteLength - 22 - MAX_ZIP_COMMENT);
  for (let offset = bytes.byteLength - 22; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue;
    const commentLength = view.getUint16(offset + 20, true);
    if (offset + 22 + commentLength === bytes.byteLength) return offset;
  }
  throw new CadWebError("ZIP_INVALID", "ZIP end-of-central-directory record was not found");
}

function normalizeLimits(overrides: Partial<CadWebReadLimits>): CadWebReadLimits {
  const limits = { ...DEFAULT_CADWEB_LIMITS, ...overrides };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isFinite(value) || value <= 0) {
      throw new CadWebError("ZIP_LIMIT", `${name} must be a positive finite number`);
    }
  }
  return limits;
}

function inspectZipInternal(
  bytes: Uint8Array,
  overrides: Partial<CadWebReadLimits> = {},
): { inspected: InspectedZip; entries: InternalZipEntry[]; limits: CadWebReadLimits } {
  const limits = normalizeLimits(overrides);
  if (bytes.byteLength > limits.maxArchiveBytes) {
    throw new CadWebError("ZIP_LIMIT", "archive exceeds maxArchiveBytes");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfCentralDirectory(view, bytes);
  const diskNumber = view.getUint16(eocd + 4, true);
  const centralDirectoryDisk = view.getUint16(eocd + 6, true);
  const entriesOnDisk = view.getUint16(eocd + 8, true);
  const entryCount = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (
    diskNumber !== 0 ||
    centralDirectoryDisk !== 0 ||
    entriesOnDisk !== entryCount ||
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new CadWebError("ZIP_INVALID", "multi-disk and ZIP64 archives are not supported");
  }
  if (entryCount > limits.maxEntries) {
    throw new CadWebError("ZIP_LIMIT", "archive exceeds maxEntries");
  }
  ensureRange(bytes, centralOffset, centralSize, "ZIP central directory");
  if (centralOffset + centralSize !== eocd) {
    throw new CadWebError("ZIP_INVALID", "ZIP central directory has an unexpected boundary");
  }

  const entries: InternalZipEntry[] = [];
  const seen = new Set<string>();
  let totalUncompressedSize = 0;
  let cursor = centralOffset;
  const centralEnd = centralOffset + centralSize;
  for (let index = 0; index < entryCount; index += 1) {
    ensureRange(bytes, cursor, 46, `ZIP central entry ${index}`);
    if (view.getUint32(cursor, true) !== CENTRAL_FILE_SIGNATURE) {
      throw new CadWebError("ZIP_INVALID", `ZIP central entry ${index} has an invalid signature`);
    }
    const flags = view.getUint16(cursor + 8, true);
    const versionMadeBy = view.getUint16(cursor + 4, true);
    const versionNeeded = view.getUint16(cursor + 6, true);
    const compressionMethod = view.getUint16(cursor + 10, true);
    const expectedCrc32 = view.getUint32(cursor + 16, true);
    const compressedSize = view.getUint32(cursor + 20, true);
    const uncompressedSize = view.getUint32(cursor + 24, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const startDisk = view.getUint16(cursor + 34, true);
    const externalAttributes = view.getUint32(cursor + 38, true);
    const localStart = view.getUint32(cursor + 42, true);
    const variableLength = nameLength + extraLength + commentLength;
    ensureRange(bytes, cursor + 46, variableLength, `ZIP central entry ${index}`);
    if (cursor + 46 + variableLength > centralEnd) {
      throw new CadWebError("ZIP_INVALID", `ZIP central entry ${index} exceeds the directory`);
    }
    if ((flags & 0x0041) !== 0) {
      throw new CadWebError("ZIP_INVALID", "encrypted ZIP entries are not supported");
    }
    if ((flags & 0x0008) !== 0) {
      throw new CadWebError("ZIP_INVALID", "ZIP data descriptors are not supported by CADWeb v1");
    }
    if (versionNeeded > 20) {
      throw new CadWebError("ZIP_INVALID", `ZIP version ${versionNeeded / 10} is not supported`);
    }
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new CadWebError("ZIP_INVALID", `unsupported ZIP compression method ${compressionMethod}`);
    }
    if (startDisk !== 0) {
      throw new CadWebError("ZIP_INVALID", "multi-disk ZIP entries are not supported");
    }
    const creatorSystem = versionMadeBy >>> 8;
    const unixMode = externalAttributes >>> 16;
    if (
      ((creatorSystem === 3 || creatorSystem === 19) && (unixMode & 0xf000) === 0xa000) ||
      (externalAttributes & 0x10) !== 0
    ) {
      throw new CadWebError("ZIP_INVALID", "ZIP links and directory entries are not supported");
    }
    validateExtraFields(view, bytes, cursor + 46 + nameLength, extraLength);
    const name = readName(bytes, cursor + 46, nameLength, flags);
    validatePath(name);
    const portableName = name.toLocaleLowerCase("en-US");
    if (seen.has(portableName)) {
      throw new CadWebError("ZIP_DUPLICATE", `duplicate ZIP entry path: ${name}`);
    }
    seen.add(portableName);
    if (uncompressedSize > limits.maxEntryUncompressedBytes) {
      throw new CadWebError("ZIP_LIMIT", `${name} exceeds maxEntryUncompressedBytes`);
    }
    totalUncompressedSize += uncompressedSize;
    if (totalUncompressedSize > limits.maxTotalUncompressedBytes) {
      throw new CadWebError("ZIP_LIMIT", "archive exceeds maxTotalUncompressedBytes");
    }
    if (
      uncompressedSize > 0 &&
      (compressedSize === 0 || uncompressedSize / compressedSize > limits.maxCompressionRatio)
    ) {
      throw new CadWebError("ZIP_LIMIT", `${name} exceeds maxCompressionRatio`);
    }

    ensureRange(bytes, localStart, 30, `ZIP local entry ${name}`);
    if (view.getUint32(localStart, true) !== LOCAL_FILE_SIGNATURE) {
      throw new CadWebError("ZIP_INVALID", `${name} has an invalid local header signature`);
    }
    const localFlags = view.getUint16(localStart + 6, true);
    const localVersionNeeded = view.getUint16(localStart + 4, true);
    const localMethod = view.getUint16(localStart + 8, true);
    const localCrc32 = view.getUint32(localStart + 14, true);
    const localNameLength = view.getUint16(localStart + 26, true);
    const localExtraLength = view.getUint16(localStart + 28, true);
    ensureRange(
      bytes,
      localStart + 30,
      localNameLength + localExtraLength,
      `ZIP local entry ${name}`,
    );
    const localName = readName(bytes, localStart + 30, localNameLength, localFlags);
    if (
      localName !== name ||
      localVersionNeeded !== versionNeeded ||
      localFlags !== flags ||
      localMethod !== compressionMethod
    ) {
      throw new CadWebError("ZIP_INVALID", `${name} local and central headers disagree`);
    }
    validateExtraFields(view, bytes, localStart + 30 + localNameLength, localExtraLength);
    if (
      localCrc32 !== expectedCrc32 ||
      view.getUint32(localStart + 18, true) !== compressedSize ||
      view.getUint32(localStart + 22, true) !== uncompressedSize
    ) {
      throw new CadWebError("ZIP_INVALID", `${name} local and central integrity fields disagree`);
    }
    const dataStart = localStart + 30 + localNameLength + localExtraLength;
    const dataEnd = dataStart + compressedSize;
    ensureRange(bytes, dataStart, compressedSize, `ZIP data for ${name}`);
    if (dataEnd > centralOffset) {
      throw new CadWebError("ZIP_INVALID", `${name} data overlaps the central directory`);
    }
    entries.push({
      name,
      compressedSize,
      uncompressedSize,
      compressionMethod,
      crc32: expectedCrc32,
      localStart,
      dataEnd,
    });
    cursor += 46 + variableLength;
  }
  if (cursor !== centralEnd) {
    throw new CadWebError("ZIP_INVALID", "ZIP central directory entry count is inconsistent");
  }
  const ranges = [...entries].sort((left, right) => left.localStart - right.localStart);
  for (let index = 1; index < ranges.length; index += 1) {
    if (ranges[index]!.localStart < ranges[index - 1]!.dataEnd) {
      throw new CadWebError("ZIP_INVALID", "ZIP local entries overlap");
    }
  }
  return {
    inspected: {
      entries: entries.map(({ name, compressedSize, uncompressedSize, compressionMethod, crc32 }) => ({
        name,
        compressedSize,
        uncompressedSize,
        compressionMethod,
        crc32,
      })),
      totalUncompressedSize,
    },
    entries,
    limits,
  };
}

export function inspectCadWebZip(
  bytes: Uint8Array,
  limits: Partial<CadWebReadLimits> = {},
): InspectedZip {
  return inspectZipInternal(bytes, limits).inspected;
}

export function decompressCadWebZip(
  bytes: Uint8Array,
  limitOverrides: Partial<CadWebReadLimits> = {},
): { entries: Map<string, Uint8Array>; limits: CadWebReadLimits } {
  const { entries: metadata, limits } = inspectZipInternal(bytes, limitOverrides);
  let output: Record<string, Uint8Array>;
  try {
    output = unzipSync(bytes);
  } catch (cause) {
    throw new CadWebError("ZIP_INVALID", "ZIP payload could not be decompressed", { cause });
  }
  const entries = new Map<string, Uint8Array>();
  for (const entry of metadata) {
    const value = output[entry.name];
    if (
      !(value instanceof Uint8Array) ||
      value.byteLength !== entry.uncompressedSize ||
      crc32(value) !== entry.crc32
    ) {
      throw new CadWebError("ZIP_INVALID", `${entry.name} decompressed size is inconsistent`);
    }
    entries.set(entry.name, value);
  }
  if (entries.size !== metadata.length) {
    throw new CadWebError("ZIP_INVALID", "ZIP decompressor returned an inconsistent entry set");
  }
  return { entries, limits };
}

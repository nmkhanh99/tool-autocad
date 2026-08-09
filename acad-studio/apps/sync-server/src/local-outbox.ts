import { randomUUID } from "node:crypto";
import { link, lstat, mkdir, open, readdir, readFile, rename, unlink } from "node:fs/promises";
import { join } from "node:path";

import { isSha256, sha256 } from "./crypto";
import { MAX_CADWEB_ARTIFACT_BYTES, resolveCadWebArtifactByteLimit } from "./limits";
import type { ArtifactMode } from "./types";

const MAX_MANIFEST_BYTES = 64 * 1024;
const SCOPE_MARKER_FILE_NAME = "scope.json";
const safeArtifactId = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;

function lexicalCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export interface ReadyOutboxManifest {
  schemaVersion: 1;
  artifactKind: ArtifactMode;
  artifactId: string;
  saveToken: string;
  drawingId: string;
  modelEpoch: string;
  writerSessionId: string;
  baseRevision: number;
  resultStateHash: string;
  payload: {
    fileName: "payload.cadweb" | "payload.cadwebdelta";
    size: number;
    sha256: string;
  };
}

export interface ReadyOutboxScope {
  tenantId: string;
  projectId: string;
}

interface ReadyOutboxScopeMarker extends ReadyOutboxScope {
  schemaVersion: 1;
}

export type DeliveryStatus =
  | "uploading"
  | "retry-wait"
  | "snapshot-required"
  | "manual-resolve"
  | "invalid";

export interface DeliveryState {
  schemaVersion: 1;
  artifactId: string;
  status: DeliveryStatus;
  attemptCount: number;
  updatedAt: string;
  nextAttemptAt?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface OutboxAcknowledgement {
  schemaVersion: 1;
  artifactId: string;
  saveToken: string;
  revision: number;
  stateHash: string;
  acknowledgedAt: string;
}

export interface ReadyOutboxEntry {
  directoryName: string;
  directoryPath: string;
  manifest: ReadyOutboxManifest;
  delivery?: DeliveryState;
  acknowledgement?: OutboxAcknowledgement;
}

export class LocalOutboxError extends Error {
  readonly code: string;
  readonly artifactId?: string;

  constructor(code: string, message: string, artifactId?: string) {
    super(message);
    this.name = "LocalOutboxError";
    this.code = code;
    this.artifactId = artifactId;
  }
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new LocalOutboxError("manifest_invalid", `${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new LocalOutboxError("manifest_invalid", `${label} is required`);
  }
  return value;
}

function integerValue(value: unknown, label: string, allowZero = true): number {
  if (!Number.isSafeInteger(value) || (value as number) < (allowZero ? 0 : 1)) {
    throw new LocalOutboxError("manifest_invalid", `${label} is invalid`);
  }
  return value as number;
}

function parseManifest(value: unknown, directoryName: string): ReadyOutboxManifest {
  const object = objectValue(value, "item.json");
  if (object.schemaVersion !== 1) {
    throw new LocalOutboxError("manifest_invalid", "unsupported item.json schemaVersion");
  }
  const artifactKind = object.artifactKind;
  if (artifactKind !== "snapshot" && artifactKind !== "delta") {
    throw new LocalOutboxError("manifest_invalid", "artifactKind must be snapshot or delta");
  }
  const artifactId = stringValue(object.artifactId, "artifactId");
  if (!safeArtifactId.test(artifactId) || directoryName !== `${artifactId}.ready`) {
    throw new LocalOutboxError(
      "manifest_invalid",
      "artifactId must be a safe file name matching its .ready directory",
      artifactId,
    );
  }
  const payload = objectValue(object.payload, "payload");
  const expectedFileName = artifactKind === "snapshot"
    ? "payload.cadweb"
    : "payload.cadwebdelta";
  if (payload.fileName !== expectedFileName) {
    throw new LocalOutboxError(
      "manifest_invalid",
      `payload.fileName must be ${expectedFileName}`,
      artifactId,
    );
  }
  const payloadHash = stringValue(payload.sha256, "payload.sha256");
  const resultStateHash = stringValue(object.resultStateHash, "resultStateHash");
  if (!isSha256(payloadHash) || !isSha256(resultStateHash)) {
    throw new LocalOutboxError(
      "manifest_invalid",
      "payload and result state hashes must be lowercase SHA-256",
      artifactId,
    );
  }
  const baseRevision = integerValue(object.baseRevision, "baseRevision");
  if (artifactKind === "delta" && baseRevision === 0) {
    throw new LocalOutboxError(
      "manifest_invalid",
      "delta baseRevision must be positive",
      artifactId,
    );
  }
  return {
    schemaVersion: 1,
    artifactKind,
    artifactId,
    saveToken: stringValue(object.saveToken, "saveToken"),
    drawingId: stringValue(object.drawingId, "drawingId"),
    modelEpoch: stringValue(object.modelEpoch, "modelEpoch"),
    writerSessionId: stringValue(object.writerSessionId, "writerSessionId"),
    baseRevision,
    resultStateHash,
    payload: {
      fileName: expectedFileName,
      size: integerValue(payload.size, "payload.size", false),
      sha256: payloadHash,
    },
  };
}

function parseDelivery(value: unknown, artifactId: string): DeliveryState {
  const object = objectValue(value, "delivery.json");
  if (object.schemaVersion !== 1 || object.artifactId !== artifactId) {
    throw new LocalOutboxError("delivery_invalid", "delivery state identity is invalid", artifactId);
  }
  const statuses: readonly DeliveryStatus[] = [
    "uploading",
    "retry-wait",
    "snapshot-required",
    "manual-resolve",
    "invalid",
  ];
  if (!statuses.includes(object.status as DeliveryStatus)) {
    throw new LocalOutboxError("delivery_invalid", "delivery status is invalid", artifactId);
  }
  return {
    schemaVersion: 1,
    artifactId,
    status: object.status as DeliveryStatus,
    attemptCount: integerValue(object.attemptCount, "attemptCount"),
    updatedAt: stringValue(object.updatedAt, "updatedAt"),
    ...(object.nextAttemptAt === undefined
      ? {}
      : { nextAttemptAt: stringValue(object.nextAttemptAt, "nextAttemptAt") }),
    ...(object.errorCode === undefined
      ? {}
      : { errorCode: stringValue(object.errorCode, "errorCode") }),
    ...(object.errorMessage === undefined
      ? {}
      : { errorMessage: stringValue(object.errorMessage, "errorMessage") }),
  };
}

function parseAcknowledgement(value: unknown, manifest: ReadyOutboxManifest): OutboxAcknowledgement {
  const object = objectValue(value, "ack.json");
  const stateHash = stringValue(object.stateHash, "ack.stateHash");
  const revision = integerValue(object.revision, "ack.revision", false);
  if (
    object.schemaVersion !== 1 || object.artifactId !== manifest.artifactId ||
    object.saveToken !== manifest.saveToken || stateHash !== manifest.resultStateHash ||
    !isSha256(stateHash) || revision !== manifest.baseRevision + 1
  ) {
    throw new LocalOutboxError(
      "ack_invalid",
      "acknowledgement does not match its immutable outbox item",
      manifest.artifactId,
    );
  }
  return {
    schemaVersion: 1,
    artifactId: manifest.artifactId,
    saveToken: manifest.saveToken,
    revision,
    stateHash,
    acknowledgedAt: stringValue(object.acknowledgedAt, "ack.acknowledgedAt"),
  };
}

function parseScopeMarker(value: unknown): ReadyOutboxScopeMarker {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new LocalOutboxError("scope_invalid", "scope.json must be an object");
  }
  const object = value as Record<string, unknown>;
  if (
    object.schemaVersion !== 1 ||
    typeof object.tenantId !== "string" || object.tenantId.length === 0 ||
    typeof object.projectId !== "string" || object.projectId.length === 0
  ) {
    throw new LocalOutboxError("scope_invalid", "scope.json identity is invalid");
  }
  return {
    schemaVersion: 1,
    tenantId: object.tenantId,
    projectId: object.projectId,
  };
}

async function fsyncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readSmallJson(path: string, label: string): Promise<unknown> {
  const info = await lstat(path);
  if (
    !info.isFile() || info.isSymbolicLink() ||
    info.size === 0 || info.size > MAX_MANIFEST_BYTES
  ) {
    throw new LocalOutboxError("manifest_invalid", `${label} has an invalid size`);
  }
  try {
    return JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error) {
    if (error instanceof LocalOutboxError) throw error;
    throw new LocalOutboxError(
      "manifest_invalid",
      `${label} is not valid JSON: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
}

async function readOptionalJson(path: string, label: string): Promise<unknown | undefined> {
  try {
    return await readSmallJson(path, label);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function readScopeMarker(path: string): Promise<ReadyOutboxScopeMarker> {
  try {
    return parseScopeMarker(await readSmallJson(path, SCOPE_MARKER_FILE_NAME));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") throw error;
    if (error instanceof LocalOutboxError && error.code === "scope_invalid") throw error;
    throw new LocalOutboxError("scope_invalid", "scope.json is invalid");
  }
}

async function writeAtomicJson(directory: string, fileName: string, value: unknown): Promise<void> {
  const temporaryPath = join(directory, `.${fileName}.${randomUUID()}.tmp`);
  const finalPath = join(directory, fileName);
  const handle = await open(temporaryPath, "wx", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(value)}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporaryPath, finalPath);
  await fsyncDirectory(directory);
}

export class FileReadyOutboxStore {
  readonly root: string;
  readonly itemsDirectory: string;
  private readonly scope: ReadyOutboxScope;
  private readonly maxPayloadBytes: number;
  private activeScopeCheck?: Promise<void>;

  constructor(
    root: string,
    scope: ReadyOutboxScope,
    maxPayloadBytes = MAX_CADWEB_ARTIFACT_BYTES,
  ) {
    if (scope.tenantId.length === 0 || scope.projectId.length === 0) {
      throw new LocalOutboxError("scope_invalid", "tenantId and projectId are required");
    }
    this.root = root;
    this.itemsDirectory = join(root, "outbox", "items");
    this.scope = { ...scope };
    this.maxPayloadBytes = resolveCadWebArtifactByteLimit(maxPayloadBytes);
  }

  async list(): Promise<ReadyOutboxEntry[]> {
    await this.ensureScope();
    let directories;
    try {
      directories = await readdir(this.itemsDirectory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const result: ReadyOutboxEntry[] = [];
    for (const directory of directories
      .filter((entry) => entry.isDirectory() && entry.name.endsWith(".ready"))
      .sort((left, right) => lexicalCompare(left.name, right.name))) {
      const directoryPath = join(this.itemsDirectory, directory.name);
      const manifest = parseManifest(
        await readSmallJson(join(directoryPath, "item.json"), "item.json"),
        directory.name,
      );
      if (manifest.payload.size > this.maxPayloadBytes) {
        throw new LocalOutboxError(
          "payload_too_large",
          `payload exceeds ${this.maxPayloadBytes} bytes`,
          manifest.artifactId,
        );
      }
      const deliveryValue = await readOptionalJson(join(directoryPath, "delivery.json"), "delivery.json");
      const acknowledgementValue = await readOptionalJson(join(directoryPath, "ack.json"), "ack.json");
      result.push({
        directoryName: directory.name,
        directoryPath,
        manifest,
        ...(deliveryValue === undefined ? {} : { delivery: parseDelivery(deliveryValue, manifest.artifactId) }),
        ...(acknowledgementValue === undefined
          ? {}
          : { acknowledgement: parseAcknowledgement(acknowledgementValue, manifest) }),
      });
    }
    return result;
  }

  async readPayload(entry: ReadyOutboxEntry): Promise<Uint8Array> {
    await this.ensureScope();
    const path = join(entry.directoryPath, entry.manifest.payload.fileName);
    const info = await lstat(path);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new LocalOutboxError(
        "payload_invalid",
        "outbox payload must be a regular file",
        entry.manifest.artifactId,
      );
    }
    if (info.size !== entry.manifest.payload.size || info.size > this.maxPayloadBytes) {
      throw new LocalOutboxError(
        "payload_invalid",
        "outbox payload size does not match item.json",
        entry.manifest.artifactId,
      );
    }
    const bytes = await readFile(path);
    if (bytes.byteLength !== info.size || sha256(bytes) !== entry.manifest.payload.sha256) {
      throw new LocalOutboxError(
        "payload_invalid",
        "outbox payload SHA-256 does not match item.json",
        entry.manifest.artifactId,
      );
    }
    return bytes;
  }

  async recordDelivery(entry: ReadyOutboxEntry, state: DeliveryState): Promise<void> {
    await this.ensureScope();
    if (state.artifactId !== entry.manifest.artifactId) {
      throw new LocalOutboxError("delivery_invalid", "delivery identity changed");
    }
    await writeAtomicJson(entry.directoryPath, "delivery.json", state);
  }

  async acknowledge(
    entry: ReadyOutboxEntry,
    acknowledgement: OutboxAcknowledgement,
  ): Promise<void> {
    await this.ensureScope();
    parseAcknowledgement(acknowledgement, entry.manifest);
    const existing = await readOptionalJson(join(entry.directoryPath, "ack.json"), "ack.json");
    if (existing !== undefined) {
      const parsed = parseAcknowledgement(existing, entry.manifest);
      if (
        parsed.revision !== acknowledgement.revision ||
        parsed.acknowledgedAt !== acknowledgement.acknowledgedAt
      ) {
        throw new LocalOutboxError(
          "ack_invalid",
          "acknowledgement is immutable once written",
          entry.manifest.artifactId,
        );
      }
      return;
    }
    await writeAtomicJson(entry.directoryPath, "ack.json", acknowledgement);
  }

  private ensureScope(): Promise<void> {
    if (this.activeScopeCheck) return this.activeScopeCheck;
    const check = this.ensureScopeOnce().finally(() => {
      if (this.activeScopeCheck === check) this.activeScopeCheck = undefined;
    });
    this.activeScopeCheck = check;
    return check;
  }

  private async ensureScopeOnce(): Promise<void> {
    const markerPath = join(this.root, SCOPE_MARKER_FILE_NAME);
    let marker: ReadyOutboxScopeMarker;
    try {
      marker = await readScopeMarker(markerPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      marker = await this.createScopeMarker(markerPath);
    }
    if (marker.tenantId !== this.scope.tenantId || marker.projectId !== this.scope.projectId) {
      throw new LocalOutboxError(
        "scope_mismatch",
        "sync root belongs to a different tenant/project",
      );
    }
  }

  private async createScopeMarker(markerPath: string): Promise<ReadyOutboxScopeMarker> {
    await mkdir(this.root, { recursive: true });
    const marker: ReadyOutboxScopeMarker = { schemaVersion: 1, ...this.scope };
    const serialized = `${JSON.stringify(marker)}\n`;
    if (Buffer.byteLength(serialized) > MAX_MANIFEST_BYTES) {
      throw new LocalOutboxError("scope_invalid", "scope.json exceeds its size limit");
    }
    const temporaryPath = join(this.root, `.scope.${randomUUID()}.tmp`);
    const handle = await open(temporaryPath, "wx", 0o600);
    try {
      await handle.writeFile(serialized, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    let published = false;
    try {
      await link(temporaryPath, markerPath);
      published = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    } finally {
      await unlink(temporaryPath);
    }
    if (published) await fsyncDirectory(this.root);
    return published ? marker : readScopeMarker(markerPath);
  }
}

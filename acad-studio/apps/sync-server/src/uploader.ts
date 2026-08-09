import { LocalOutboxError } from "./local-outbox";
import type {
  DeliveryState,
  FileReadyOutboxStore,
  OutboxAcknowledgement,
  ReadyOutboxEntry,
  ReadyOutboxManifest,
} from "./local-outbox";

export interface RemotePublishAcknowledgement {
  artifactId: string;
  revision: number;
  stateHash: string;
  idempotent: boolean;
}

export interface RevisionPublishClient {
  publish(
    manifest: ReadyOutboxManifest,
    bytes: Uint8Array,
  ): Promise<RemotePublishAcknowledgement>;
}

export class RevisionPublishError extends Error {
  readonly status?: number;
  readonly code: string;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: string,
    message: string,
    status?: number,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = "RevisionPublishError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export interface FetchRevisionPublishClientOptions {
  baseUrl: string;
  tenantId: string;
  projectId: string;
  headers?: HeadersInit | (() => Promise<HeadersInit> | HeadersInit);
  fetch?: typeof fetch;
}

function requiredString(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new RevisionPublishError("invalid_server_response", `${label} is missing`);
  }
  return value;
}

function requiredRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new RevisionPublishError("invalid_server_response", "server revision is invalid");
  }
  return value as number;
}

export class FetchRevisionPublishClient implements RevisionPublishClient {
  private readonly baseUrl: string;
  private readonly tenantId: string;
  private readonly projectId: string;
  private readonly additionalHeaders?: FetchRevisionPublishClientOptions["headers"];
  private readonly fetchImplementation: typeof fetch;

  constructor(options: FetchRevisionPublishClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, "");
    this.tenantId = options.tenantId;
    this.projectId = options.projectId;
    this.additionalHeaders = options.headers;
    this.fetchImplementation = options.fetch ?? fetch;
  }

  async publish(
    manifest: ReadyOutboxManifest,
    bytes: Uint8Array,
  ): Promise<RemotePublishAcknowledgement> {
    const route = manifest.artifactKind === "snapshot" ? "snapshots" : "changesets";
    const url = `${this.baseUrl}/v1/tenants/${encodeURIComponent(this.tenantId)}`
      + `/projects/${encodeURIComponent(this.projectId)}`
      + `/drawings/${encodeURIComponent(manifest.drawingId)}/${route}`;
    const configuredHeaders = typeof this.additionalHeaders === "function"
      ? await this.additionalHeaders()
      : this.additionalHeaders;
    const headers = new Headers(configuredHeaders);
    headers.set(
      "content-type",
      manifest.artifactKind === "snapshot"
        ? "application/vnd.cadweb+zip"
        : "application/vnd.cadweb-delta+zip",
    );
    headers.set("x-cadweb-writer-session-id", manifest.writerSessionId);
    headers.set("x-cadweb-state-hash", manifest.resultStateHash);

    let response: Response;
    try {
      response = await this.fetchImplementation(url, {
        method: "POST",
        headers,
        body: Buffer.from(bytes),
      });
    } catch (error) {
      throw new RevisionPublishError(
        "network_error",
        error instanceof Error ? error.message : "revision upload failed",
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new RevisionPublishError(
        "invalid_server_response",
        `revision service returned non-JSON status ${response.status}`,
        response.status,
      );
    }
    if (!response.ok) {
      const envelope = body !== null && typeof body === "object"
        ? body as Record<string, unknown>
        : {};
      const error = envelope.error !== null && typeof envelope.error === "object"
        ? envelope.error as Record<string, unknown>
        : {};
      throw new RevisionPublishError(
        typeof error.code === "string" ? error.code : "http_error",
        typeof error.message === "string" ? error.message : `revision upload failed (${response.status})`,
        response.status,
        error.details !== null && typeof error.details === "object"
          ? error.details as Record<string, unknown>
          : undefined,
      );
    }

    const envelope = body !== null && typeof body === "object"
      ? body as Record<string, unknown>
      : {};
    const revision = envelope.revision !== null && typeof envelope.revision === "object"
      ? envelope.revision as Record<string, unknown>
      : {};
    return {
      artifactId: requiredString(revision.artifactId, "revision.artifactId"),
      revision: requiredRevision(revision.revision),
      stateHash: requiredString(revision.stateHash, "revision.stateHash"),
      idempotent: envelope.idempotent === true,
    };
  }
}

export interface LocalOutboxUploaderOptions {
  store: FileReadyOutboxStore;
  client: RevisionPublishClient;
  clock?: () => Date;
  initialRetryDelayMs?: number;
  maxRetryDelayMs?: number;
}

export interface UploadRunResult {
  acknowledged: string[];
  retryScheduled: string[];
  blocked: string[];
  skipped: string[];
}

export interface UploadRunOptions {
  /** Retry an item in retry-wait now; terminal recovery states remain blocked. */
  forceRetryWait?: boolean;
}

type FailureDisposition = "retry-wait" | "snapshot-required" | "manual-resolve" | "invalid";

function failureDisposition(
  error: unknown,
  manifest: ReadyOutboxManifest,
): FailureDisposition {
  if (error instanceof LocalOutboxError) return "invalid";
  if (!(error instanceof RevisionPublishError)) return "retry-wait";
  if (error.code === "invalid_server_response") return "invalid";
  if (
    error.status === undefined || error.status === 408 || error.status === 425 ||
    error.status === 429 || error.status >= 500 || error.code === "authentication_required"
  ) return "retry-wait";
  if (error.code === "revision_conflict") {
    return error.details?.writerSessionId === manifest.writerSessionId
      ? "snapshot-required"
      : "manual-resolve";
  }
  if (error.code === "model_epoch_conflict") return "snapshot-required";
  if (
    error.code === "writer_session_conflict" || error.code === "writer_lease_expired" ||
    error.code === "source_fingerprint_conflict" || error.code === "idempotency_key_reused" ||
    error.code === "forbidden"
  ) return "manual-resolve";
  return "invalid";
}

function errorIdentity(error: unknown): { code: string; message: string } {
  if (error instanceof RevisionPublishError) return { code: error.code, message: error.message };
  if (error instanceof Error) return { code: "local_error", message: error.message };
  return { code: "unknown_error", message: "unknown upload failure" };
}

export class LocalOutboxUploader {
  private readonly store: FileReadyOutboxStore;
  private readonly client: RevisionPublishClient;
  private readonly clock: () => Date;
  private readonly initialRetryDelayMs: number;
  private readonly maxRetryDelayMs: number;
  private activeRun?: Promise<UploadRunResult>;

  constructor(options: LocalOutboxUploaderOptions) {
    this.store = options.store;
    this.client = options.client;
    this.clock = options.clock ?? (() => new Date());
    this.initialRetryDelayMs = options.initialRetryDelayMs ?? 1_000;
    this.maxRetryDelayMs = options.maxRetryDelayMs ?? 5 * 60_000;
  }

  runOnce(options: UploadRunOptions = {}): Promise<UploadRunResult> {
    if (this.activeRun) return this.activeRun;
    const run = this.run(options).finally(() => {
      if (this.activeRun === run) this.activeRun = undefined;
    });
    this.activeRun = run;
    return run;
  }

  private async run(options: UploadRunOptions): Promise<UploadRunResult> {
    const result: UploadRunResult = {
      acknowledged: [],
      retryScheduled: [],
      blocked: [],
      skipped: [],
    };
    const now = this.clock();
    const entries = await this.store.list();
    const pending = entries.filter((entry) => entry.acknowledgement === undefined);
    const byDrawing = new Map<string, ReadyOutboxEntry[]>();
    for (const entry of pending) {
      const group = byDrawing.get(entry.manifest.drawingId) ?? [];
      group.push(entry);
      byDrawing.set(entry.manifest.drawingId, group);
    }

    for (const group of byDrawing.values()) {
      if (group.length === 1) continue;
      for (const entry of group) {
        await this.recordFailure(
          entry,
          "snapshot-required",
          entry.delivery?.attemptCount ?? 0,
          now,
          "pending_outbox_conflict",
          "multiple unacknowledged artifacts exist for one drawing",
        );
        result.blocked.push(entry.manifest.artifactId);
      }
    }

    for (const entry of pending) {
      const artifactId = entry.manifest.artifactId;
      if ((byDrawing.get(entry.manifest.drawingId)?.length ?? 0) > 1) continue;
      if (
        entry.delivery?.status === "snapshot-required" ||
        entry.delivery?.status === "manual-resolve" ||
        entry.delivery?.status === "invalid"
      ) {
        result.blocked.push(artifactId);
        continue;
      }
      if (
        entry.delivery?.status === "retry-wait" && entry.delivery.nextAttemptAt &&
        Date.parse(entry.delivery.nextAttemptAt) > now.getTime() && !options.forceRetryWait
      ) {
        result.skipped.push(artifactId);
        continue;
      }

      const attemptCount = (entry.delivery?.attemptCount ?? 0) + 1;
      await this.store.recordDelivery(entry, {
        schemaVersion: 1,
        artifactId,
        status: "uploading",
        attemptCount,
        updatedAt: now.toISOString(),
      });
      try {
        const bytes = await this.store.readPayload(entry);
        const acknowledgement = await this.client.publish(entry.manifest, bytes);
        if (
          acknowledgement.artifactId !== artifactId ||
          acknowledgement.stateHash !== entry.manifest.resultStateHash ||
          acknowledgement.revision !== entry.manifest.baseRevision + 1
        ) {
          throw new RevisionPublishError(
            "invalid_server_response",
            "server ACK does not match the immutable outbox item",
          );
        }
        const ack: OutboxAcknowledgement = {
          schemaVersion: 1,
          artifactId,
          saveToken: entry.manifest.saveToken,
          revision: acknowledgement.revision,
          stateHash: acknowledgement.stateHash,
          acknowledgedAt: this.clock().toISOString(),
        };
        await this.store.acknowledge(entry, ack);
        result.acknowledged.push(artifactId);
      } catch (error) {
        const disposition = failureDisposition(error, entry.manifest);
        const identity = errorIdentity(error);
        await this.recordFailure(
          entry,
          disposition,
          attemptCount,
          this.clock(),
          identity.code,
          identity.message,
        );
        if (disposition === "retry-wait") result.retryScheduled.push(artifactId);
        else result.blocked.push(artifactId);
      }
    }
    return result;
  }

  private async recordFailure(
    entry: ReadyOutboxEntry,
    disposition: FailureDisposition,
    attemptCount: number,
    now: Date,
    errorCode: string,
    errorMessage: string,
  ): Promise<void> {
    const state: DeliveryState = {
      schemaVersion: 1,
      artifactId: entry.manifest.artifactId,
      status: disposition,
      attemptCount,
      updatedAt: now.toISOString(),
      errorCode,
      errorMessage,
      ...(disposition === "retry-wait"
        ? {
            nextAttemptAt: new Date(
              now.getTime() + Math.min(
                this.maxRetryDelayMs,
                this.initialRetryDelayMs * 2 ** Math.min(Math.max(attemptCount - 1, 0), 20),
              ),
            ).toISOString(),
          }
        : {}),
    };
    await this.store.recordDelivery(entry, state);
  }
}

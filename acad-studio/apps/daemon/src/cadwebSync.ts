import { posix, win32 } from "node:path";

import {
  FetchRevisionPublishClient,
  FileReadyOutboxStore,
  LocalOutboxError,
  LocalOutboxUploader,
  RevisionPublishError,
  type ReadyOutboxEntry,
  type UploadRunResult,
} from "@acad/sync-server";
import { Router } from "express";

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const MIN_POLL_INTERVAL_MS = 250;
const MAX_POLL_INTERVAL_MS = 5 * 60_000;
const MIN_REQUEST_TIMEOUT_MS = 1_000;
const MAX_REQUEST_TIMEOUT_MS = 2 * 60_000;

type ConfigurationIssue =
  | "enabled_flag_invalid"
  | "sync_root_unavailable"
  | "sync_root_not_absolute"
  | "base_url_required"
  | "base_url_invalid"
  | "base_url_insecure"
  | "tenant_id_required"
  | "project_id_required"
  | "credential_required"
  | "poll_interval_invalid"
  | "request_timeout_invalid";

export type CadWebSyncConfiguration =
  | { mode: "disabled" }
  | { mode: "misconfigured"; issue: ConfigurationIssue }
  | {
      mode: "enabled";
      root: string;
      baseUrl: string;
      tenantId: string;
      projectId: string;
      pollIntervalMs: number;
      requestTimeoutMs: number;
    };

export interface CadWebSyncRunSummary {
  acknowledged: number;
  retryScheduled: number;
  blocked: number;
  skipped: number;
}

export interface CadWebSyncQueueSummary {
  ready: number;
  pending: number;
  acknowledgedAwaitingCad: number;
  queued: number;
  uploading: number;
  retryWait: number;
  snapshotRequired: number;
  manualResolve: number;
  invalid: number;
  nextAttemptAt?: string;
}

export type CadWebSyncState =
  | "disabled"
  | "misconfigured"
  | "idle"
  | "pending"
  | "running"
  | "retry-wait"
  | "blocked"
  | "error";

export interface CadWebSyncStatus {
  enabled: boolean;
  state: CadWebSyncState;
  issue?: ConfigurationIssue;
  pollIntervalMs?: number;
  queue?: CadWebSyncQueueSummary;
  lastRun?: {
    trigger: "timer" | "manual";
    startedAt: string;
    completedAt?: string;
    result?: CadWebSyncRunSummary;
  };
  lastError?: { code: string; at: string };
}

export interface CadWebSyncControl {
  start(): void;
  stop(): void;
  status(): Promise<CadWebSyncStatus>;
  retryNow(): Promise<CadWebSyncRunSummary | undefined>;
}

export interface CadWebSyncTimer {
  unref?(): unknown;
}

export interface CadWebSyncScheduler {
  set(callback: () => void, delayMs: number): CadWebSyncTimer;
  clear(timer: CadWebSyncTimer): void;
}

interface OutboxReader {
  list(): Promise<ReadyOutboxEntry[]>;
}

interface OutboxRunner {
  runOnce(options?: { forceRetryWait?: boolean }): Promise<UploadRunResult>;
}

interface CadWebSyncRuntimeOptions {
  store: OutboxReader;
  uploader: OutboxRunner;
  pollIntervalMs: number;
  clock?: () => Date;
  scheduler?: CadWebSyncScheduler;
}

interface CreateCadWebSyncControlOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  headers?: () => Promise<HeadersInit> | HeadersInit;
  fetch?: typeof fetch;
  clock?: () => Date;
  scheduler?: CadWebSyncScheduler;
}

const nodeScheduler: CadWebSyncScheduler = {
  set(callback, delayMs) {
    return setTimeout(callback, delayMs);
  },
  clear(timer) {
    clearTimeout(timer as ReturnType<typeof setTimeout>);
  },
};

function configuredValue(value: string | undefined): string | undefined {
  const configured = value?.trim();
  return configured ? configured : undefined;
}

function configuredInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= minimum && parsed <= maximum
    ? parsed
    : undefined;
}

function syncRoot(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): string | undefined {
  const override = configuredValue(env.CADWEB_SYNC_ROOT);
  if (override) return override;
  if (platform === "win32") {
    const localData = configuredValue(env.LOCALAPPDATA);
    return localData ? win32.join(localData, "AcadStudio", "CadWebSync") : undefined;
  }
  const userHome = configuredValue(env.HOME);
  return userHome
    ? posix.join(userHome, "Library", "Application Support", "AcadStudio", "CadWebSync")
    : undefined;
}

function loopbackHostname(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

export function cadWebSyncConfiguration(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): CadWebSyncConfiguration {
  const enabledFlag = configuredValue(env.CADWEB_SYNC_ENABLED)?.toLowerCase();
  if (enabledFlag === undefined || enabledFlag === "0" || enabledFlag === "false") {
    return { mode: "disabled" };
  }
  if (enabledFlag !== "1" && enabledFlag !== "true") {
    return { mode: "misconfigured", issue: "enabled_flag_invalid" };
  }

  const root = syncRoot(env, platform);
  if (!root) return { mode: "misconfigured", issue: "sync_root_unavailable" };
  const platformPath = platform === "win32" ? win32 : posix;
  if (!platformPath.isAbsolute(root)) {
    return { mode: "misconfigured", issue: "sync_root_not_absolute" };
  }

  const configuredBaseUrl = configuredValue(env.CADWEB_SYNC_BASE_URL);
  if (!configuredBaseUrl) return { mode: "misconfigured", issue: "base_url_required" };
  let url: URL;
  try {
    url = new URL(configuredBaseUrl);
  } catch {
    return { mode: "misconfigured", issue: "base_url_invalid" };
  }
  if (
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopbackHostname(url.hostname))) ||
    url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== ""
  ) {
    return { mode: "misconfigured", issue: "base_url_insecure" };
  }

  const tenantId = configuredValue(env.CADWEB_SYNC_TENANT_ID);
  if (!tenantId) return { mode: "misconfigured", issue: "tenant_id_required" };
  const projectId = configuredValue(env.CADWEB_SYNC_PROJECT_ID);
  if (!projectId) return { mode: "misconfigured", issue: "project_id_required" };

  const pollIntervalMs = configuredInteger(
    env.CADWEB_SYNC_POLL_INTERVAL_MS,
    DEFAULT_POLL_INTERVAL_MS,
    MIN_POLL_INTERVAL_MS,
    MAX_POLL_INTERVAL_MS,
  );
  if (pollIntervalMs === undefined) {
    return { mode: "misconfigured", issue: "poll_interval_invalid" };
  }
  const requestTimeoutMs = configuredInteger(
    env.CADWEB_SYNC_REQUEST_TIMEOUT_MS,
    DEFAULT_REQUEST_TIMEOUT_MS,
    MIN_REQUEST_TIMEOUT_MS,
    MAX_REQUEST_TIMEOUT_MS,
  );
  if (requestTimeoutMs === undefined) {
    return { mode: "misconfigured", issue: "request_timeout_invalid" };
  }

  return {
    mode: "enabled",
    root,
    baseUrl: url.toString().replace(/\/$/, ""),
    tenantId,
    projectId,
    pollIntervalMs,
    requestTimeoutMs,
  };
}

function summarizeRun(result: UploadRunResult): CadWebSyncRunSummary {
  return {
    acknowledged: result.acknowledged.length,
    retryScheduled: result.retryScheduled.length,
    blocked: result.blocked.length,
    skipped: result.skipped.length,
  };
}

function summarizeQueue(entries: ReadyOutboxEntry[]): CadWebSyncQueueSummary {
  const summary: CadWebSyncQueueSummary = {
    ready: entries.length,
    pending: 0,
    acknowledgedAwaitingCad: 0,
    queued: 0,
    uploading: 0,
    retryWait: 0,
    snapshotRequired: 0,
    manualResolve: 0,
    invalid: 0,
  };
  const retryTimes: number[] = [];
  for (const entry of entries) {
    if (entry.acknowledgement) {
      summary.acknowledgedAwaitingCad += 1;
      continue;
    }
    summary.pending += 1;
    switch (entry.delivery?.status) {
      case undefined:
        summary.queued += 1;
        break;
      case "uploading":
        summary.uploading += 1;
        break;
      case "retry-wait": {
        summary.retryWait += 1;
        const retryAt = Date.parse(entry.delivery.nextAttemptAt ?? "");
        if (Number.isFinite(retryAt)) retryTimes.push(retryAt);
        break;
      }
      case "snapshot-required":
        summary.snapshotRequired += 1;
        break;
      case "manual-resolve":
        summary.manualResolve += 1;
        break;
      case "invalid":
        summary.invalid += 1;
        break;
    }
  }
  if (retryTimes.length > 0) {
    summary.nextAttemptAt = new Date(Math.min(...retryTimes)).toISOString();
  }
  return summary;
}

function safeErrorCode(error: unknown): string {
  if (error instanceof LocalOutboxError || error instanceof RevisionPublishError) {
    return error.code;
  }
  return "local_error";
}

function stateForQueue(queue: CadWebSyncQueueSummary): CadWebSyncState {
  if (queue.snapshotRequired + queue.manualResolve + queue.invalid > 0) return "blocked";
  if (queue.retryWait > 0) return "retry-wait";
  if (queue.pending > 0) return "pending";
  return "idle";
}

export class CadWebSyncRuntime implements CadWebSyncControl {
  private readonly store: OutboxReader;
  private readonly uploader: OutboxRunner;
  private readonly pollIntervalMs: number;
  private readonly clock: () => Date;
  private readonly scheduler: CadWebSyncScheduler;
  private timer?: CadWebSyncTimer;
  private started = false;
  private activeForceRetryWait = false;
  private activeRun?: Promise<CadWebSyncRunSummary>;
  private queuedForcedRun?: Promise<CadWebSyncRunSummary>;
  private lastRun?: CadWebSyncStatus["lastRun"];
  private lastError?: CadWebSyncStatus["lastError"];

  constructor(options: CadWebSyncRuntimeOptions) {
    this.store = options.store;
    this.uploader = options.uploader;
    this.pollIntervalMs = options.pollIntervalMs;
    this.clock = options.clock ?? (() => new Date());
    this.scheduler = options.scheduler ?? nodeScheduler;
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    this.schedule(0);
  }

  stop(): void {
    this.started = false;
    if (!this.timer) return;
    this.scheduler.clear(this.timer);
    this.timer = undefined;
  }

  retryNow(): Promise<CadWebSyncRunSummary> {
    return this.runOnce(true, "manual");
  }

  async status(): Promise<CadWebSyncStatus> {
    let queue: CadWebSyncQueueSummary;
    try {
      queue = summarizeQueue(await this.store.list());
    } catch (error) {
      return {
        enabled: true,
        state: "error",
        pollIntervalMs: this.pollIntervalMs,
        ...(this.lastRun ? { lastRun: this.lastRun } : {}),
        lastError: { code: safeErrorCode(error), at: this.clock().toISOString() },
      };
    }
    return {
      enabled: true,
      state: this.activeRun ? "running" : this.lastError ? "error" : stateForQueue(queue),
      pollIntervalMs: this.pollIntervalMs,
      queue,
      ...(this.lastRun ? { lastRun: this.lastRun } : {}),
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  private schedule(delayMs: number): void {
    if (!this.started || this.timer) return;
    const timer = this.scheduler.set(() => {
      if (this.timer === timer) this.timer = undefined;
      if (!this.started) return;
      void this.runOnce(false, "timer")
        .catch(() => undefined)
        .finally(() => this.schedule(this.pollIntervalMs));
    }, delayMs);
    timer.unref?.();
    this.timer = timer;
  }

  private runOnce(
    forceRetryWait: boolean,
    trigger: "timer" | "manual",
  ): Promise<CadWebSyncRunSummary> {
    if (this.activeRun) {
      if (!forceRetryWait || this.activeForceRetryWait) return this.activeRun;
      if (!this.queuedForcedRun) {
        this.queuedForcedRun = this.activeRun
          .catch(() => undefined)
          .then(() => this.beginRun(true, trigger))
          .finally(() => {
            this.queuedForcedRun = undefined;
          });
      }
      return this.queuedForcedRun;
    }
    return this.beginRun(forceRetryWait, trigger);
  }

  private beginRun(
    forceRetryWait: boolean,
    trigger: "timer" | "manual",
  ): Promise<CadWebSyncRunSummary> {
    const startedAt = this.clock().toISOString();
    this.lastRun = { trigger, startedAt };
    this.activeForceRetryWait = forceRetryWait;
    const run = this.uploader.runOnce({ forceRetryWait })
      .then((result) => {
        const summary = summarizeRun(result);
        this.lastRun = {
          trigger,
          startedAt,
          completedAt: this.clock().toISOString(),
          result: summary,
        };
        this.lastError = undefined;
        return summary;
      })
      .catch((error: unknown) => {
        const at = this.clock().toISOString();
        this.lastRun = { trigger, startedAt, completedAt: at };
        this.lastError = { code: safeErrorCode(error), at };
        throw error;
      })
      .finally(() => {
        if (this.activeRun === run) {
          this.activeRun = undefined;
          this.activeForceRetryWait = false;
        }
      });
    this.activeRun = run;
    return run;
  }
}

class InactiveCadWebSyncControl implements CadWebSyncControl {
  constructor(private readonly configuration: Exclude<CadWebSyncConfiguration, { mode: "enabled" }>) {}

  start(): void {}
  stop(): void {}

  async status(): Promise<CadWebSyncStatus> {
    return this.configuration.mode === "disabled"
      ? { enabled: false, state: "disabled" }
      : { enabled: false, state: "misconfigured", issue: this.configuration.issue };
  }

  async retryNow(): Promise<undefined> {
    return undefined;
  }
}

function environmentHeaders(env: NodeJS.ProcessEnv): (() => HeadersInit) | undefined {
  if (!configuredValue(env.CADWEB_SYNC_ACCESS_TOKEN)) return undefined;
  return () => {
    const token = configuredValue(env.CADWEB_SYNC_ACCESS_TOKEN);
    if (!token) {
      throw new RevisionPublishError(
        "authentication_required",
        "CADWeb sync credential is unavailable",
      );
    }
    return { authorization: `Bearer ${token}` };
  };
}

function timeoutFetch(fetchImplementation: typeof fetch, timeoutMs: number): typeof fetch {
  return (input, init) => fetchImplementation(input, {
    ...init,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export function createCadWebSyncControl(
  options: CreateCadWebSyncControlOptions = {},
): CadWebSyncControl {
  const env = options.env ?? process.env;
  const configuration = cadWebSyncConfiguration(env, options.platform ?? process.platform);
  if (configuration.mode !== "enabled") {
    return new InactiveCadWebSyncControl(configuration);
  }
  const headers = options.headers ?? environmentHeaders(env);
  if (!headers) {
    return new InactiveCadWebSyncControl({ mode: "misconfigured", issue: "credential_required" });
  }
  const store = new FileReadyOutboxStore(configuration.root, {
    tenantId: configuration.tenantId,
    projectId: configuration.projectId,
  });
  const client = new FetchRevisionPublishClient({
    baseUrl: configuration.baseUrl,
    tenantId: configuration.tenantId,
    projectId: configuration.projectId,
    headers,
    fetch: timeoutFetch(options.fetch ?? fetch, configuration.requestTimeoutMs),
  });
  return new CadWebSyncRuntime({
    store,
    uploader: new LocalOutboxUploader({ store, client, ...(options.clock ? { clock: options.clock } : {}) }),
    pollIntervalMs: configuration.pollIntervalMs,
    ...(options.clock ? { clock: options.clock } : {}),
    ...(options.scheduler ? { scheduler: options.scheduler } : {}),
  });
}

export function cadWebSyncRouter(control: CadWebSyncControl): Router {
  const router = Router();
  router.get("/status", async (_request, response) => {
    response.json({ ok: true, sync: await control.status() });
  });
  router.post("/retry", async (_request, response) => {
    const before = await control.status();
    if (!before.enabled) {
      return response.status(409).json({
        ok: false,
        code: before.state === "disabled" ? "sync_disabled" : "sync_misconfigured",
        sync: before,
      });
    }
    try {
      const run = await control.retryNow();
      return response.json({ ok: true, run, sync: await control.status() });
    } catch {
      return response.status(503).json({
        ok: false,
        code: "sync_run_failed",
        sync: await control.status(),
      });
    }
  });
  return router;
}

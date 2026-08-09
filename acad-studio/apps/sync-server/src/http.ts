import { SyncError } from "./errors";
import { resolveCadWebArtifactByteLimit } from "./limits";
import type { Authenticator, DrawingScope, Principal } from "./types";
import type { SyncRevisionService } from "./service";

interface HttpHandlerOptions {
  service: SyncRevisionService;
  authenticator: Authenticator;
  maxArtifactBytes?: number;
}

interface Route {
  scope: DrawingScope;
  suffix: string[];
}

function json(status: number, body: unknown): Response {
  return new Response(`${JSON.stringify(body)}\n`, {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function parseRoute(pathname: string): Route | undefined {
  let segments: string[];
  try {
    segments = pathname.split("/").filter(Boolean).map((segment) => decodeURIComponent(segment));
  } catch {
    throw new SyncError("invalid_request", 400, "route contains invalid percent encoding");
  }
  if (
    segments.length < 7 ||
    segments[0] !== "v1" ||
    segments[1] !== "tenants" ||
    segments[3] !== "projects" ||
    segments[5] !== "drawings"
  ) return undefined;
  return {
    scope: { tenantId: segments[2]!, projectId: segments[4]!, drawingId: segments[6]! },
    suffix: segments.slice(7),
  };
}

async function optionalJsonBody(request: Request): Promise<Record<string, unknown>> {
  if (!request.body) return {};
  try {
    const value = await request.json() as unknown;
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("body must be an object");
    }
    return value as Record<string, unknown>;
  } catch (error) {
    throw new SyncError("invalid_request", 400, "invalid JSON request body", {
      reason: error instanceof Error ? error.message : "unknown",
    });
  }
}

function leaseSeconds(body: Record<string, unknown>): number | undefined {
  const value = body.leaseSeconds;
  if (value === undefined) return undefined;
  if (typeof value !== "number") {
    throw new SyncError("invalid_request", 400, "leaseSeconds must be a number");
  }
  return value;
}

async function artifactBytes(request: Request, maxArtifactBytes: number): Promise<Uint8Array> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const length = Number(contentLength);
    if (!Number.isSafeInteger(length) || length < 0) {
      throw new SyncError("invalid_request", 400, "content-length is invalid");
    }
    if (length > maxArtifactBytes) {
      throw new SyncError("upload_too_large", 413, "artifact exceeds upload limit", {
        maxArtifactBytes,
      });
    }
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    total += chunk.value.byteLength;
    if (total > maxArtifactBytes) {
      await reader.cancel();
      throw new SyncError("upload_too_large", 413, "artifact exceeds upload limit", {
        maxArtifactBytes,
      });
    }
    chunks.push(chunk.value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

function requiredHeader(request: Request, name: string): string {
  const value = request.headers.get(name);
  if (!value) throw new SyncError("invalid_request", 400, `${name} header is required`);
  return value;
}

async function dispatch(
  service: SyncRevisionService,
  principal: Principal,
  route: Route,
  request: Request,
  maxArtifactBytes: number,
): Promise<Response> {
  const { scope, suffix } = route;

  if (request.method === "POST" && suffix.length === 1 && suffix[0] === "writer-sessions") {
    const seconds = leaseSeconds(await optionalJsonBody(request));
    const session = await service.acquireWriterSession(scope, principal, seconds);
    return json(201, session);
  }

  if (
    request.method === "PUT" &&
    suffix.length === 2 &&
    suffix[0] === "writer-sessions"
  ) {
    const seconds = leaseSeconds(await optionalJsonBody(request));
    const session = await service.renewWriterSession(scope, principal, suffix[1]!, seconds);
    return json(200, session);
  }

  if (
    request.method === "POST" &&
    suffix.length === 1 &&
    (suffix[0] === "snapshots" || suffix[0] === "changesets")
  ) {
    const writerSessionId = requiredHeader(request, "x-cadweb-writer-session-id");
    const stateHash = requiredHeader(request, "x-cadweb-state-hash");
    const publishRequest = {
      scope,
      principal,
      writerSessionId,
      stateHash,
      bytes: await artifactBytes(request, maxArtifactBytes),
    };
    const result = suffix[0] === "snapshots"
      ? await service.publishSnapshot(publishRequest)
      : await service.publishChangeset(publishRequest);
    return json(result.idempotent ? 200 : 201, result);
  }

  if (request.method === "GET" && suffix.length === 1 && suffix[0] === "head") {
    return json(200, await service.getHead(scope, principal));
  }

  if (request.method === "GET" && suffix.length === 1 && suffix[0] === "changes") {
    const url = new URL(request.url);
    const after = Number(url.searchParams.get("after") ?? "0");
    const limit = Number(url.searchParams.get("limit") ?? "100");
    return json(200, { changes: await service.getChangesAfter(scope, principal, after, limit) });
  }

  if (suffix[0] === "revisions" && suffix.length >= 2) {
    const revision = Number(suffix[1]);
    if (request.method === "GET" && suffix.length === 2) {
      return json(200, await service.getRevision(scope, principal, revision));
    }
    if (request.method === "GET" && suffix.length === 3 && suffix[2] === "blob") {
      const checkpointId = new URL(request.url).searchParams.get("checkpointId") ?? undefined;
      const blob = await service.getRevisionBlob(scope, principal, revision, checkpointId);
      return new Response(Buffer.from(blob.bytes), {
        status: 200,
        headers: {
          "content-type": blob.mode === "delta"
            ? "application/vnd.cadweb-delta+zip"
            : "application/vnd.cadweb+zip",
          "etag": `\"sha256:${blob.hash}\"`,
          "x-content-sha256": blob.hash,
        },
      });
    }
    if (
      request.method === "POST" &&
      suffix.length === 3 &&
      suffix[2] === "checkpoints"
    ) {
      const result = await service.attachCheckpoint({
        scope,
        principal,
        bytes: await artifactBytes(request, maxArtifactBytes),
        expectedRevision: revision,
      });
      return json(result.idempotent ? 200 : 201, result);
    }
  }

  return json(404, { error: { code: "not_found", message: "route not found" } });
}

export function createSyncHttpHandler(options: HttpHandlerOptions): (request: Request) => Promise<Response> {
  const maxArtifactBytes = resolveCadWebArtifactByteLimit(options.maxArtifactBytes);
  return async (request: Request): Promise<Response> => {
    try {
      const route = parseRoute(new URL(request.url).pathname);
      if (!route) return json(404, { error: { code: "not_found", message: "route not found" } });
      const principal = await options.authenticator.authenticate(request);
      if (!principal) {
        throw new SyncError("authentication_required", 401, "authentication required");
      }
      return await dispatch(options.service, principal, route, request, maxArtifactBytes);
    } catch (error) {
      if (error instanceof SyncError) {
        return json(error.status, {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details === undefined ? {} : { details: error.details }),
          },
        });
      }
      return json(500, { error: { code: "internal_error", message: "internal server error" } });
    }
  };
}

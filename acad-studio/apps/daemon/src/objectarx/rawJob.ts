/**
 * Pure ObjectARX raw-job protocol (daemon ↔ plugin).
 * Format: TAB-separated lines written to ~/Acad-Bridge/raw.job
 * Result: JSON in ~/Acad-Bridge/raw.done
 *
 * Keep this module free of AutoCAD / Express I/O so tests can exercise
 * the real shipped builder/parser without a live CAD session.
 */
import { byCapabilityId, type RawCapability } from "./catalog.js";

export type RawParams = Record<string, string | number | boolean | null | undefined>;

export type RawJobRequest = {
  id: string;
  target?: string;
  params?: RawParams;
};

export type RawResult = {
  ok: boolean;
  id: string;
  interactive?: boolean;
  blocked?: boolean;
  payload?: Record<string, unknown>;
  error?: string;
  diagnostic?: string;
};

/** Escape a single cell for the TAB protocol (no tabs/newlines). */
export function cell(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/[\t\r\n]/g, " ");
}

/**
 * Build raw.job body for the plugin.
 * Lines:
 *   RAW   \t <capabilityId>
 *   TARGET\t <doc name>           (optional)
 *   PARAM \t <key> \t <value>     (0..n)
 */
export function buildRawJob(req: RawJobRequest): string {
  const id = String(req.id || "").trim();
  if (!id) throw new Error("raw job requires id");
  const lines: string[] = [`RAW\t${cell(id)}`];
  if (req.target) lines.push(`TARGET\t${cell(req.target)}`);
  const params = req.params || {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined) continue;
    lines.push(`PARAM\t${cell(k)}\t${cell(v)}`);
  }
  return lines.join("\n") + "\n";
}

/** Parse a raw.job body back into a request (round-trip for tests + dry-run). */
export function parseRawJob(raw: string): RawJobRequest {
  const lines = String(raw || "").split("\n");
  let id = "";
  let target = "";
  const params: RawParams = {};
  for (let ln of lines) {
    ln = ln.replace(/\r$/, "");
    if (!ln.trim()) continue;
    const t = ln.split("\t");
    const op = t[0];
    if (op === "RAW" && t[1]) id = t[1].trim();
    else if (op === "TARGET" && t[1] !== undefined) target = t[1].trim();
    else if (op === "PARAM" && t[1]) params[t[1]] = t[2] ?? "";
  }
  if (!id) throw new Error("raw.job missing RAW id");
  return { id, target: target || undefined, params };
}

/** Parse plugin result JSON (raw.done). Accepts strict JSON only. */
export function parseRawResult(text: string): RawResult {
  const s = String(text || "").trim();
  if (!s) throw new Error("empty raw.done");
  const obj = JSON.parse(s) as RawResult;
  if (!obj || typeof obj !== "object") throw new Error("raw.done not an object");
  if (typeof obj.id !== "string" || !obj.id) throw new Error("raw.done missing id");
  if (typeof obj.ok !== "boolean") throw new Error("raw.done missing ok");
  return obj;
}

/**
 * Local (no AutoCAD) validation of a raw invoke request against the catalog.
 * Returns a structured result for disabled/interactive-without-CAD paths used
 * by the daemon when it cannot reach the plugin — never fabricates success for
 * native ops that require CAD.
 */
export function validateRawInvoke(req: RawJobRequest): {
  cap: RawCapability | undefined;
  preflight?: RawResult;
} {
  const cap = byCapabilityId(req.id);
  if (!cap) {
    return {
      cap: undefined,
      preflight: {
        ok: false,
        id: req.id,
        error: `Unknown capability id: ${req.id}`,
        diagnostic: "not_in_catalog",
      },
    };
  }
  if (!cap.enabled) {
    return {
      cap,
      preflight: {
        ok: false,
        id: cap.id,
        blocked: true,
        error: cap.reason || "Capability disabled",
        diagnostic: "disabled",
        payload: {
          group: cap.group,
          catalogStatus: cap.catalogStatus,
          api: cap.api,
          name: cap.name,
        },
      },
    };
  }
  return { cap };
}

/**
 * Default sample params for menu demos / structural probes.
 * Pure data — not a reimplementation of C++ entity logic.
 */
export function defaultParamsFor(id: string): RawParams {
  switch (id) {
    case "db.entity_curves":
      return { kind: "line", x1: 0, y1: 0, x2: 1000, y2: 0, layer: "0" };
    case "db.polyline":
      return { points: "0,0 1000,0 1000,500", layer: "0" };
    case "db.mline":
      return { x1: 0, y1: 0, x2: 1000, y2: 0, layer: "0" };
    case "db.text_mtext":
      return { kind: "text", x: 0, y: 0, h: 250, text: "ACAD RAW", layer: "0" };
    case "db.block":
      return { action: "define", name: "ACAD_RAW_BLK", x: 0, y: 0 };
    case "db.layer":
      return { name: "ACAD-RAW-TEST", aci: 3 };
    case "db.xdata":
      return { action: "probe" };
    case "db.handle":
      return { action: "probe" };
    case "db.symbol_tables":
      return { which: "layer" };
    case "ed.sysvar":
      return { name: "CLAYER" };
    case "ed.printf":
      return { msg: "[ACAD RAW] acutPrintf probe" };
    case "db.units":
      return { action: "get" };
    case "db.extents":
      return { action: "model" };
    case "db.group":
      return { action: "probe", name: "ACAD_RAW_GRP" };
    case "db.nod":
      return { action: "probe", key: "ACAD_TOOLKIT" };
    case "db.transaction":
      return { action: "probe" };
    case "db.hatch":
      return { points: "0,0 500,0 500,500 0,500", pattern: "SOLID", layer: "0" };
    case "db.table":
      return { x: 0, y: 0, rows: 3, cols: 3 };
    case "db.dimension":
      return { kind: "aligned", x1: 0, y1: 0, x2: 1000, y2: 0, mx: 500, my: -200 };
    case "db.leader":
      return { x1: 0, y1: 0, x2: 500, y2: 500, text: "RAW" };
    case "db.circle_only":
      return { x: 0, y: 0, r: 100 };
    default:
      return { action: "probe" };
  }
}

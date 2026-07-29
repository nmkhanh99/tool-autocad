import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";

import {
  DaemonAutoCADBackend,
  type AcadMcpBackend,
  type ToolInput,
  type ToolName,
  type ToolResponse,
} from "./backend.js";

const dataSchema = z.record(z.string(), z.unknown()).optional();
const targetSchema = z
  .string()
  .optional()
  .describe(
    "AutoCAD document title or full path. Required for every mutating live operation.",
  );

const commonSchema = {
  operation: z.string().describe("Operation to dispatch."),
  data: dataSchema,
  include_screenshot: z
    .boolean()
    .optional()
    .describe("Ask the backend to include a screenshot when supported."),
  target: targetSchema,
};

const entitySchema = z.object({
  ...commonSchema,
  x1: z.number().optional(),
  y1: z.number().optional(),
  x2: z.number().optional(),
  y2: z.number().optional(),
  points: z.array(z.array(z.number())).optional(),
  side_point: z.array(z.number()).min(2).max(3).optional(),
  rows: z.number().int().positive().optional(),
  cols: z.number().int().positive().optional(),
  row_dist: z.number().optional(),
  col_dist: z.number().optional(),
  layer: z.string().optional(),
  entity_id: z.string().optional(),
});

const viewSchema = z.object({
  ...commonSchema,
  x1: z.number().optional(),
  y1: z.number().optional(),
  x2: z.number().optional(),
  y2: z.number().optional(),
});

export function asToolResult(response: ToolResponse) {
  const payload = response.payload &&
      typeof response.payload === "object" &&
      !Array.isArray(response.payload)
    ? response.payload as Record<string, unknown>
    : undefined;
  const directImage = payload;
  const nestedImage = payload?.screenshot &&
      typeof payload.screenshot === "object" &&
      !Array.isArray(payload.screenshot)
    ? payload.screenshot as Record<string, unknown>
    : undefined;
  const image = [directImage, nestedImage].find((candidate) =>
    candidate?.mimeType === "image/png" &&
    typeof candidate.data === "string" &&
    candidate.data.length > 0);
  const imageData = typeof image?.data === "string" ? image.data : undefined;

  let textResponse = response;
  if (image && imageData && payload) {
    const imageMetadata = {
      ...image,
      data: `<base64 omitted; ${imageData.length} characters>`,
    };
    textResponse = {
      ...response,
      payload: image === directImage
        ? imageMetadata
        : { ...payload, screenshot: imageMetadata },
    };
  }
  const content: Array<
    | { type: "text"; text: string }
    | { type: "image"; data: string; mimeType: string }
  > = [
    {
      type: "text",
      text: JSON.stringify(textResponse),
    },
  ];
  if (imageData) {
    content.push({
      type: "image",
      data: imageData,
      mimeType: "image/png",
    });
  }
  return {
    content,
    isError: !response.ok,
  };
}

function callBackend(
  backend: AcadMcpBackend,
  tool: ToolName,
  input: ToolInput,
) {
  return backend.call(tool, input).then(asToolResult);
}

export function createAcadMcpServer(
  backend: AcadMcpBackend = new DaemonAutoCADBackend(),
): McpServer {
  const server = new McpServer({
    name: "acad-mcp",
    version: "0.1.0",
  });

  server.registerTool(
    "drawing",
    {
      title: "AutoCAD Drawing Operations",
      description:
        "Drawing file management. Operations: create, open, info, save, save_as_dxf, plot_pdf, purge, get_variables, undo, redo.",
      inputSchema: z.object(commonSchema),
      annotations: { readOnlyHint: false },
    },
    (input) => callBackend(backend, "drawing", input),
  );

  server.registerTool(
    "entity",
    {
      title: "AutoCAD Entity Operations",
      description:
        "Entity creation, querying, and modification. Operations: create_line, create_circle, create_polyline, create_rectangle, create_arc, create_ellipse, create_mtext, create_hatch, list, count, get, copy, move, rotate, scale, mirror, offset, array, fillet, chamfer, erase. offset requires distance and side_point; array requires rows, cols, row_dist, and col_dist.",
      inputSchema: entitySchema,
      annotations: { readOnlyHint: false },
    },
    (input) => callBackend(backend, "entity", input),
  );

  server.registerTool(
    "layer",
    {
      title: "AutoCAD Layer Operations",
      description:
        "Layer creation and management. Operations: list, create, set_current, set_properties, freeze, thaw, lock, unlock.",
      inputSchema: z.object(commonSchema),
      annotations: { readOnlyHint: false },
    },
    (input) => callBackend(backend, "layer", input),
  );

  server.registerTool(
    "block",
    {
      title: "AutoCAD Block Operations",
      description:
        "Block definition, insertion, and attribute management. Operations: list, insert, insert_with_attributes, get_attributes, update_attribute, define. define accepts bounded LINE, CIRCLE, and ATTDEF recipes in data.entities.",
      inputSchema: z.object(commonSchema),
      annotations: { readOnlyHint: false },
    },
    (input) => callBackend(backend, "block", input),
  );

  server.registerTool(
    "annotation",
    {
      title: "AutoCAD Annotation Operations",
      description:
        "Text, dimension, and leader operations: create_text, create_dimension_linear, create_dimension_aligned, create_dimension_angular, create_dimension_radius, create_leader.",
      inputSchema: z.object(commonSchema),
      annotations: { readOnlyHint: false },
    },
    (input) => callBackend(backend, "annotation", input),
  );

  server.registerTool(
    "pid",
    {
      title: "P&ID Operations (Generic Geometry)",
      description:
        "P&ID operations backed by generic placeholder geometry and a fallback symbol catalog, not CTO blocks: setup_layers, insert_symbol, list_symbols, draw_process_line, connect_equipment, add_flow_arrow, add_equipment_tag, add_line_number, insert_valve, insert_instrument, insert_pump, insert_tank.",
      inputSchema: z.object(commonSchema),
      annotations: { readOnlyHint: false },
    },
    (input) => callBackend(backend, "pid", input),
  );

  server.registerTool(
    "view",
    {
      title: "AutoCAD View Operations",
      description:
        "Viewport operations plus a real PNG capture of the visible AutoCAD window on macOS: zoom_extents, zoom_window, get_screenshot.",
      inputSchema: viewSchema,
      annotations: { readOnlyHint: false },
    },
    (input) => callBackend(backend, "view", input),
  );

  server.registerTool(
    "system",
    {
      title: "AutoCAD MCP System",
      description:
        "Server operations: status, health, get_backend, runtime, init, execute_lisp. Pass data.job_id to status to reconcile an accepted live job that has not completed yet.",
      inputSchema: z.object(commonSchema),
      annotations: { readOnlyHint: false },
    },
    (input) => callBackend(backend, "system", input),
  );

  return server;
}

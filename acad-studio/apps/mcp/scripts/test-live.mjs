import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

if (process.env.ACAD_RUN_LIVE_E2E !== "1") {
  console.log("Live MCP test skipped (set ACAD_RUN_LIVE_E2E=1 to run).");
  process.exit(0);
}

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const studioRoot = fileURLToPath(new URL("../../..", import.meta.url));
const serverEntry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
const timestamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
const drawingPath = process.env.ACAD_MCP_LIVE_DWG ||
  join(studioRoot, ".work", `MCP-LIVE-${timestamp}.dwg`);
const pdfPath = process.env.ACAD_MCP_LIVE_PDF ||
  drawingPath.replace(/\.dwg$/i, ".pdf");
const layoutPdfPath = drawingPath.replace(/\.dwg$/i, "-layout.pdf");
const daemonUrl = process.env.ACAD_DAEMON_URL || "http://127.0.0.1:8788";

assert.equal(
  existsSync(drawingPath),
  false,
  `Refusing to overwrite existing live-test drawing: ${drawingPath}`,
);
assert.equal(
  existsSync(pdfPath),
  false,
  `Refusing to overwrite existing live-test PDF: ${pdfPath}`,
);
assert.equal(
  existsSync(layoutPdfPath),
  false,
  `Refusing to overwrite existing live-test layout PDF: ${layoutPdfPath}`,
);
mkdirSync(dirname(drawingPath), { recursive: true });

const env = Object.fromEntries(
  Object.entries(process.env).filter((entry) => entry[1] !== undefined),
);
Object.assign(env, {
  ACAD_DAEMON_URL: daemonUrl,
  ACAD_MCP_AUTOSTART_DAEMON:
    process.env.ACAD_MCP_AUTOSTART_DAEMON || "0",
});

const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["--import", "tsx", serverEntry],
  cwd: packageRoot,
  env,
  stderr: "pipe",
});
const client = new Client({
  name: "acad-mcp-live-test",
  version: "0.1.0",
});
let connected = false;
let serverStderr = "";

transport.stderr?.on("data", (chunk) => {
  serverStderr += chunk.toString();
});

async function callResult(name, args) {
  const response = await client.callTool({ name, arguments: args });
  const text = response.content.find((item) => item.type === "text");
  assert.ok(text && text.type === "text", `${name} returned no text payload`);
  const payload = JSON.parse(text.text);
  assert.equal(
    response.isError,
    false,
    `${name}.${args.operation} MCP error: ${JSON.stringify(payload)}`,
  );
  assert.equal(
    payload.ok,
    true,
    `${name}.${args.operation} backend error: ${JSON.stringify(payload)}`,
  );
  return { payload, response };
}

async function call(name, args) {
  return (await callResult(name, args)).payload;
}

async function callFailure(name, args) {
  const response = await client.callTool({ name, arguments: args });
  const text = response.content.find((item) => item.type === "text");
  assert.ok(text && text.type === "text", `${name} returned no text payload`);
  const payload = JSON.parse(text.text);
  assert.equal(response.isError, true, `${name}.${args.operation} unexpectedly succeeded`);
  assert.equal(payload.ok, false, `${name}.${args.operation} returned no backend error`);
  return payload;
}

function entityHandle(response) {
  const message = String(response.payload?.result?.message || "");
  const match = /\bentity_id=([0-9a-f]+)\b/i.exec(message);
  assert.ok(match, `Operation returned no entity handle: ${message}`);
  return match[1];
}

async function waitForDocument(path, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await call("system", { operation: "status" });
    const documents = status.payload?.documents?.docs || [];
    if (documents.some((document) =>
      document.file === path || document.path === path || document.title === path)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(`AutoCAD did not report the opened test drawing: ${path}`);
}

async function waitForPlot(jobId, timeoutMs = 180_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const status = await call("system", {
      operation: "status",
      data: { job_id: jobId },
    });
    const job = status.payload?.job || {};
    if (job.state === "done" && job.ok !== false) return job;
    if (job.state === "error" || job.state === "timeout" || job.ok === false) {
      throw new Error(`Native plot failed: ${JSON.stringify(job)}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Native plot job ${jobId} did not finish in ${timeoutMs} ms`);
}

function assertPdf(path) {
  const bytes = readFileSync(path);
  assert.ok(bytes.length > 1_000, "Plotted PDF is unexpectedly small");
  assert.equal(bytes.subarray(0, 5).toString("ascii"), "%PDF-");
  assert.match(bytes.subarray(Math.max(0, bytes.length - 4096)).toString("latin1"), /%%EOF/);
  return bytes;
}

try {
  await client.connect(transport);
  connected = true;

  const health = await call("system", { operation: "health" });
  assert.equal(health.payload?.ok, true, "AutoCAD control-plane health is not OK");

  await call("drawing", {
    operation: "create",
    data: { path: drawingPath, open: true },
  });
  assert.ok(existsSync(drawingPath), "AcCoreConsole did not create the test DWG");
  await waitForDocument(drawingPath);

  await call("layer", {
    operation: "create",
    target: drawingPath,
    data: { name: "MCP-LIVE", color: 3, linetype: "CONTINUOUS" },
  });
  const sourceLine = await call("entity", {
    operation: "create_line",
    target: drawingPath,
    x1: 0,
    y1: 0,
    x2: 100,
    y2: 0,
    layer: "MCP-LIVE",
  });
  const sourceLineHandle = entityHandle(sourceLine);
  const offset = await call("entity", {
    operation: "offset",
    target: drawingPath,
    entity_id: sourceLineHandle,
    data: { distance: 5, side_point: [50, 10] },
  });
  assert.match(String(offset.payload?.result?.message), /\bentity_id=/);

  const array = await call("entity", {
    operation: "array",
    target: drawingPath,
    entity_id: sourceLineHandle,
    data: {
      rows: 2,
      cols: 3,
      row_dist: 12,
      col_dist: 120,
    },
  });
  assert.match(String(array.payload?.result?.message), /\bcopies=5\b/);
  await call("entity", {
    operation: "create_circle",
    target: drawingPath,
    layer: "MCP-LIVE",
    data: { cx: 50, cy: 30, radius: 10 },
  });
  await call("annotation", {
    operation: "create_text",
    target: drawingPath,
    data: {
      x: 0,
      y: 10,
      text: "MCP macOS live test",
      height: 2.5,
      layer: "MCP-LIVE",
    },
  });
  await call("pid", {
    operation: "setup_layers",
    target: drawingPath,
  });
  await call("pid", {
    operation: "insert_valve",
    target: drawingPath,
    data: {
      x: 80,
      y: 30,
      valve_type: "GATE",
      attributes: { TAG: "XV-001" },
    },
  });
  await call("block", {
    operation: "define",
    target: drawingPath,
    data: {
      name: "MCP-LIVE-BLOCK",
      entities: [
        { type: "LINE", x1: -3, y1: 0, x2: 3, y2: 0 },
        { type: "CIRCLE", cx: 0, cy: 0, radius: 2 },
        { type: "ATTDEF", tag: "TAG", x: -2, y: -4, height: 1.5 },
      ],
    },
  });
  await call("block", {
    operation: "insert_with_attributes",
    target: drawingPath,
    data: {
      name: "MCP-LIVE-BLOCK",
      x: 20,
      y: 30,
      scale: 1,
      rotation: 0,
      attributes: { TAG: "MCP-001" },
    },
  });
  await call("view", {
    operation: "zoom_extents",
    target: drawingPath,
  });

  const plotStateBefore = await call("drawing", {
    operation: "get_variables",
    target: drawingPath,
    data: { names: ["BACKGROUNDPLOT", "CTAB", "CVPORT"] },
  });
  const plotted = await call("drawing", {
    operation: "plot_pdf",
    target: drawingPath,
    data: {
      path: pdfPath,
      layout: process.env.ACAD_MCP_PLOT_LAYOUT || "Model",
      device:
        process.env.ACAD_MCP_PLOT_DEVICE ||
        "AutoCAD PDF (General Documentation).pc3",
      media:
        process.env.ACAD_MCP_PLOT_MEDIA ||
        "ISO_A4_(210.00_x_297.00_MM)",
      plot_type: "extents",
      scale: "fit",
      rotation: 0,
      centered: true,
      overwrite: false,
      timeout_ms: 180_000,
    },
  });
  if (plotted.payload?.completed === false) {
    assert.match(String(plotted.payload?.jobId || ""), /^[a-f0-9]{8}$/i);
    await waitForPlot(plotted.payload.jobId);
  }
  assert.equal(existsSync(pdfPath), true, "Native plot did not publish the PDF");
  const firstPdf = assertPdf(pdfPath);

  const noOverwrite = await callFailure("drawing", {
    operation: "plot_pdf",
    target: drawingPath,
    data: {
      path: pdfPath,
      layout: process.env.ACAD_MCP_PLOT_LAYOUT || "Model",
      device:
        process.env.ACAD_MCP_PLOT_DEVICE ||
        "AutoCAD PDF (General Documentation).pc3",
      media:
        process.env.ACAD_MCP_PLOT_MEDIA ||
        "ISO_A4_(210.00_x_297.00_MM)",
    },
  });
  assert.equal(noOverwrite.code, "file_exists");
  assert.deepEqual(readFileSync(pdfPath), firstPdf, "No-overwrite changed the PDF");

  const overwritten = await call("drawing", {
    operation: "plot_pdf",
    target: drawingPath,
    data: {
      path: pdfPath,
      layout: process.env.ACAD_MCP_PLOT_LAYOUT || "Model",
      device:
        process.env.ACAD_MCP_PLOT_DEVICE ||
        "AutoCAD PDF (General Documentation).pc3",
      media:
        process.env.ACAD_MCP_PLOT_MEDIA ||
        "ISO_A4_(210.00_x_297.00_MM)",
      plot_type: "extents",
      scale: "fit",
      rotation: 0,
      centered: true,
      overwrite: true,
      timeout_ms: 180_000,
    },
  });
  if (overwritten.payload?.completed === false) {
    assert.match(String(overwritten.payload?.jobId || ""), /^[a-f0-9]{8}$/i);
    await waitForPlot(overwritten.payload.jobId);
  }
  assertPdf(pdfPath);

  const layoutPlot = await call("drawing", {
    operation: "plot_pdf",
    target: drawingPath,
    data: {
      path: layoutPdfPath,
      layout: "Layout1",
      device:
        process.env.ACAD_MCP_PLOT_DEVICE ||
        "AutoCAD PDF (General Documentation).pc3",
      media:
        process.env.ACAD_MCP_PLOT_MEDIA ||
        "ISO_A4_(210.00_x_297.00_MM)",
      plot_type: "layout",
      scale: "1:1",
      rotation: 0,
      centered: false,
      overwrite: false,
      timeout_ms: 180_000,
    },
  });
  if (layoutPlot.payload?.completed === false) {
    assert.match(String(layoutPlot.payload?.jobId || ""), /^[a-f0-9]{8}$/i);
    await waitForPlot(layoutPlot.payload.jobId);
  }
  assertPdf(layoutPdfPath);

  const plotStateAfter = await call("drawing", {
    operation: "get_variables",
    target: drawingPath,
    data: { names: ["BACKGROUNDPLOT", "CTAB", "CVPORT"] },
  });
  assert.deepEqual(
    plotStateAfter.payload?.result?.rows,
    plotStateBefore.payload?.result?.rows,
    "Native plot did not restore AutoCAD plot/layout state",
  );

  const screenshot = await callResult("view", {
    operation: "get_screenshot",
    target: drawingPath,
  });
  const image = screenshot.response.content.find((item) => item.type === "image");
  assert.ok(image && image.type === "image", "Screenshot returned no MCP ImageContent");
  assert.equal(image.mimeType, "image/png");
  const imageBytes = Buffer.from(image.data, "base64");
  assert.ok(imageBytes.length > 10_000, "Screenshot PNG is unexpectedly small");
  assert.deepEqual(
    [...imageBytes.subarray(0, 8)],
    [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a],
  );
  assert.equal(screenshot.payload.payload?.mimeType, "image/png");
  assert.match(
    String(screenshot.payload.payload?.data),
    /^<base64 omitted;/,
    "Screenshot metadata text must not duplicate the full base64 image",
  );

  const layers = await call("layer", {
    operation: "list",
    target: drawingPath,
  });
  assert.ok(
    layers.payload?.layers?.some((layer) =>
      typeof layer === "string" ? layer === "MCP-LIVE" : layer?.name === "MCP-LIVE"),
    "Live snapshot did not include MCP-LIVE layer",
  );

  const blocks = await call("block", {
    operation: "list",
    target: drawingPath,
  });
  assert.ok(
    blocks.payload?.blocks?.some((block) =>
      typeof block === "string"
        ? block === "MCP-LIVE-BLOCK"
        : block?.name === "MCP-LIVE-BLOCK"),
    "Live snapshot did not include MCP-LIVE-BLOCK",
  );

  const entities = await call("entity", {
    operation: "list",
    target: drawingPath,
    layer: "MCP-LIVE",
  });
  assert.ok(entities.payload?.result?.count >= 9, "Entity TSV result was not parsed");

  const count = await call("entity", {
    operation: "count",
    target: drawingPath,
    layer: "MCP-LIVE",
  });
  assert.ok(Number(count.payload?.count) >= 9, "Expected at least 9 test entities");

  await call("drawing", {
    operation: "save",
    target: drawingPath,
  });

  console.log(
    `Live MCP test passed on macOS: created, plotted, edited, queried, and saved ${drawingPath}; PDFs ${pdfPath}, ${layoutPdfPath}`,
  );
} catch (error) {
  if (serverStderr) console.error(serverStderr);
  throw error;
} finally {
  if (connected) await client.close();
  else await transport.close();
}

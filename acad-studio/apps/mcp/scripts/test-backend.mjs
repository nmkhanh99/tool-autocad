import assert from "node:assert/strict";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

import {
  BASE_OPERATIONS,
  DaemonAutoCADBackend,
  TOOL_NAMES,
} from "../src/backend.ts";
import { asToolResult } from "../src/server.ts";
import {
  hasPngSignature,
  selectAutoCADWindow,
} from "../src/screenshot.ts";

const backend = new DaemonAutoCADBackend({
  daemonUrl: "http://127.0.0.1:1",
  autostartDaemon: false,
});

assert.deepEqual(TOOL_NAMES, [
  "drawing",
  "entity",
  "layer",
  "block",
  "annotation",
  "pid",
  "view",
  "system",
]);
assert.equal(
  Object.values(BASE_OPERATIONS).reduce(
    (total, operations) => total + operations.length,
    0,
  ),
  72,
  "base contract must expose the reference project's 72 operations",
);

const runtime = await backend.call("system", { operation: "runtime" });
assert.equal(runtime.ok, true);
assert.equal(runtime.payload.adapter.transport, "stdio");
assert.equal(runtime.payload.adapter.autostartDaemon, false);
assert.equal(runtime.payload.capabilities.drawing.plot_pdf.supported, false);
assert.equal(runtime.payload.capabilities.entity.offset.supported, true);
assert.equal(runtime.payload.capabilities.entity.array.supported, true);
assert.equal(runtime.payload.capabilities.block.define.supported, true);
assert.equal(runtime.payload.capabilities.view.get_screenshot.supported, true);

const paddedRuntime = await backend.call("system", { operation: "  runtime  " });
assert.equal(paddedRuntime.ok, true);
assert.equal(paddedRuntime.operation, "runtime");

const unknown = await backend.call("drawing", { operation: "drop_everything" });
assert.equal(unknown.ok, false);
assert.equal(unknown.code, "unknown_operation");
assert.equal(unknown.supported, false);

const missingTarget = await backend.call("entity", {
  operation: "create_line",
  x1: 0,
  y1: 0,
  x2: 10,
  y2: 10,
});
assert.equal(missingTarget.ok, false);
assert.equal(missingTarget.code, "target_required");

const symbols = await backend.call("pid", {
  operation: "list_symbols",
  data: { category: "VALVES" },
});
assert.equal(symbols.ok, true);
assert.ok(symbols.payload.symbols.includes("VA-GATE"));
assert.match(symbols.payload.representation, /placeholder/i);

let documents = [];
const healthPayload = { ok: false, error: "mock health failure" };
let openPayload = { ok: false, error: "mock open failure" };
const jobBodies = [];
let jobPayload = {
  jobId: "a1b2c3d4",
  state: "done",
  result: { status: "ok", message: "entity_id=AA" },
};

const mockDaemon = createServer(async (request, response) => {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const body = chunks.length
    ? JSON.parse(Buffer.concat(chunks).toString("utf8"))
    : {};
  let payload;
  if (request.url === "/api/acad/docs") {
    payload = { running: true, alive: true, docs: documents };
  } else if (request.url === "/api/acad/health") {
    payload = healthPayload;
  } else if (request.url === "/api/acad/status") {
    payload = { running: true };
  } else if (request.url === "/api/acad/raw/coverage") {
    payload = { total: 0 };
  } else if (request.url === "/api/acad/open") {
    payload = openPayload;
  } else if (request.url === "/api/acad/job/a1b2c3d4") {
    payload = {
      jobId: "a1b2c3d4",
      state: "done",
      result: { status: "ok", message: "entity_id=AA" },
    };
  } else if (request.url === "/api/acad/job") {
    jobBodies.push(body);
    payload = jobPayload;
  } else {
    response.statusCode = 404;
    payload = { error: `Unhandled mock route: ${request.url}` };
  }
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(payload));
});

await new Promise((resolve) => mockDaemon.listen(0, "127.0.0.1", resolve));
try {
  const address = mockDaemon.address();
  assert.ok(address && typeof address === "object");
  const routedBackend = new DaemonAutoCADBackend({
    daemonUrl: `http://127.0.0.1:${address.port}`,
    autostartDaemon: false,
  });

  const failedHealth = await routedBackend.call("system", { operation: "health" });
  assert.equal(failedHealth.ok, false);
  assert.equal(failedHealth.code, "health_failed");

  const failedOpen = await routedBackend.call("drawing", {
    operation: "open",
    data: { path: fileURLToPath(new URL("../package.json", import.meta.url)) },
  });
  assert.equal(failedOpen.ok, false);
  assert.equal(failedOpen.code, "open_failed");

  const openPath = fileURLToPath(new URL("../package.json", import.meta.url));
  openPayload = { ok: true };
  documents = [
    { title: "package.json", file: openPath, active: true },
  ];
  const confirmedOpen = await routedBackend.call("drawing", {
    operation: "open",
    data: { path: openPath },
  });
  assert.equal(confirmedOpen.ok, true);
  assert.equal(confirmedOpen.payload.document.file, openPath);

  documents = [];
  const unconfirmedOpen = await routedBackend.call("drawing", {
    operation: "open",
    data: { path: openPath, timeout_ms: 500 },
  });
  assert.equal(unconfirmedOpen.ok, false);
  assert.equal(unconfirmedOpen.code, "open_not_confirmed");
  openPayload = { ok: false, error: "mock open failure" };

  documents = [
    { title: "duplicate.dwg", file: "/tmp/a/duplicate.dwg", active: true },
    { title: "duplicate.dwg", file: "/tmp/b/duplicate.dwg", active: false },
  ];
  const ambiguous = await routedBackend.call("entity", {
    operation: "create_line",
    target: "duplicate.dwg",
    x1: 0,
    y1: 0,
    x2: 1,
    y2: 1,
  });
  assert.equal(ambiguous.ok, false);
  assert.equal(ambiguous.code, "target_ambiguous");

  const missing = await routedBackend.call("entity", {
    operation: "create_line",
    target: "/tmp/not-open.dwg",
    x1: 0,
    y1: 0,
    x2: 1,
    y2: 1,
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "target_not_found");

  documents = [
    { title: "one.dwg", file: "/tmp/canonical/one.dwg", active: true },
  ];
  const routed = await routedBackend.call("entity", {
    operation: "create_line",
    target: "  one.dwg  ",
    x1: 0,
    y1: 0,
    x2: 1,
    y2: 1,
  });
  assert.equal(routed.ok, true);
  assert.equal(jobBodies.at(-1).target, "/tmp/canonical/one.dwg");

  const ambiguousOffset = await routedBackend.call("entity", {
    operation: "offset",
    target: "/tmp/canonical/one.dwg",
    entity_id: "AA",
    data: { distance: 2 },
  });
  assert.equal(ambiguousOffset.ok, false);
  assert.equal(ambiguousOffset.supported, true);
  assert.equal(ambiguousOffset.code, "ambiguous_operation");

  const offset = await routedBackend.call("entity", {
    operation: "offset",
    target: "/tmp/canonical/one.dwg",
    entity_id: "AA",
    data: { distance: 2, side_point: [0, 10] },
  });
  assert.equal(offset.ok, true);
  assert.match(jobBodies.at(-1).lisp, /_\.OFFSET/);

  jobPayload = {
    jobId: "a1b2c3d4",
    state: "sent",
    result: null,
  };
  const pending = await routedBackend.call("entity", {
    operation: "create_line",
    target: "/tmp/canonical/one.dwg",
    include_screenshot: true,
    x1: 0,
    y1: 0,
    x2: 2,
    y2: 2,
  });
  assert.equal(pending.ok, true);
  assert.equal(pending.payload.accepted, true);
  assert.equal(pending.payload.completed, false);
  assert.equal(pending.payload.screenshot, undefined);
  assert.match(pending.warnings.join("\n"), /không gửi lại operation/i);

  const tracked = await routedBackend.call("system", {
    operation: "status",
    data: { job_id: "a1b2c3d4" },
  });
  assert.equal(tracked.ok, true);
  assert.equal(tracked.payload.job.state, "done");

  const invalidJobId = await routedBackend.call("system", {
    operation: "status",
    data: { job_id: "../secret" },
  });
  assert.equal(invalidJobId.ok, false);
  assert.equal(invalidJobId.code, "invalid_input");
  jobPayload = {
    jobId: "a1b2c3d4",
    state: "done",
    result: { status: "ok", message: "entity_id=AA" },
  };

  documents[0].active = false;
  const inactiveScreenshot = await routedBackend.call("view", {
    operation: "get_screenshot",
    target: "/tmp/canonical/one.dwg",
  });
  assert.equal(inactiveScreenshot.ok, false);
  assert.equal(inactiveScreenshot.code, "target_not_active");
  documents[0].active = true;

} finally {
  await new Promise((resolve, reject) =>
    mockDaemon.close((error) => error ? reject(error) : resolve()));
}

const windows = [
  {
    id: 10,
    owner: "AutoCAD 2027",
    title: "other.dwg",
    layer: 0,
    alpha: 1,
    x: 0,
    y: 0,
    width: 2200,
    height: 1400,
  },
  {
    id: 11,
    owner: "AutoCAD 2027",
    title: "wanted.dwg — AutoCAD 2027",
    layer: 0,
    alpha: 1,
    x: 10,
    y: 20,
    width: 1600,
    height: 1000,
  },
  {
    id: 12,
    owner: "AutoCAD 2027",
    title: "palette",
    layer: 3,
    alpha: 1,
    x: 0,
    y: 0,
    width: 500,
    height: 500,
  },
  {
    id: 13,
    owner: "AutoCAD 2027",
    title: "data.dwg",
    layer: 0,
    alpha: 1,
    x: 0,
    y: 0,
    width: 1200,
    height: 800,
  },
];
assert.equal(selectAutoCADWindow(windows).id, 10);
assert.equal(selectAutoCADWindow([windows[1], windows[0]]).id, 11);
assert.equal(selectAutoCADWindow(windows, "/tmp/wanted.dwg").id, 11);
assert.equal(selectAutoCADWindow(windows, "/tmp/missing.dwg"), undefined);
assert.equal(selectAutoCADWindow(windows, "/tmp/a.dwg"), undefined);
assert.equal(
  selectAutoCADWindow(
    [
      windows[1],
      { ...windows[1], id: 14, title: "wanted.dwg — second AutoCAD" },
    ],
    "/tmp/wanted.dwg",
  ),
  undefined,
);
assert.equal(
  hasPngSignature(Buffer.from("89504e470d0a1a0a00", "hex")),
  true,
);
assert.equal(hasPngSignature(Buffer.from("not-png")), false);

const imageBase64 = Buffer.from("unit-test-image").toString("base64");
const imageResult = asToolResult({
  ok: true,
  supported: true,
  tool: "view",
  operation: "get_screenshot",
  backend: "acad-studio-daemon",
  payload: {
    mimeType: "image/png",
    data: imageBase64,
    sizeBytes: 15,
  },
});
assert.equal(imageResult.isError, false);
assert.equal(imageResult.content.length, 2);
assert.equal(imageResult.content[1].type, "image");
assert.equal(imageResult.content[1].data, imageBase64);
assert.doesNotMatch(imageResult.content[0].text, new RegExp(imageBase64));

console.log(
  "MCP backend test passed: 72-op contract, guards, target routing, screenshot content, PID catalog.",
);

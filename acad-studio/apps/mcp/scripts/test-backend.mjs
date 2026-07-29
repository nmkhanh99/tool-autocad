import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
  "review",
  "system",
]);
assert.equal(
  Object.values(BASE_OPERATIONS).reduce(
    (total, operations) => total + operations.length,
    0,
  ),
  76,
  "base contract must expose 72 reference operations plus 4 review operations",
);

const runtime = await backend.call("system", { operation: "runtime" });
assert.equal(runtime.ok, true);
assert.equal(runtime.payload.adapter.transport, "stdio");
assert.equal(runtime.payload.adapter.autostartDaemon, false);
assert.equal(runtime.payload.capabilities.drawing.plot_pdf.supported, true);
assert.equal(runtime.payload.capabilities.entity.offset.supported, true);
assert.equal(runtime.payload.capabilities.entity.array.supported, true);
assert.equal(runtime.payload.capabilities.block.define.supported, true);
assert.equal(runtime.payload.capabilities.view.get_screenshot.supported, true);
assert.equal(runtime.payload.capabilities.review.run_standards.supported, true);

const reviewCapabilities = await backend.call("review", {
  operation: "capabilities",
});
assert.equal(reviewCapabilities.ok, true);
assert.equal(
  reviewCapabilities.payload.aiReview.reasoningProvider,
  "mcp_client_model",
);
assert.equal(
  reviewCapabilities.payload.aiReview.guards.exactTargetMustBeActive,
  true,
);
assert.equal(reviewCapabilities.payload.pdf.plotPdf.implemented, true);
assert.equal(
  reviewCapabilities.payload.pdf.underlayInventory.scope,
  "direct_layout_space_references",
);
assert.equal(reviewCapabilities.payload.excel.dataLinkInventory.implemented, true);
assert.equal(
  reviewCapabilities.payload.excel.dataLinkInventory.sourceUpdatePermissionField,
  "dataLinks[].sourceUpdateAllowed",
);
assert.ok(reviewCapabilities.payload.excluded.includes("ocr"));

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
const plotBodies = [];
const standardsScanBodies = [];
let jobPayload = {
  jobId: "a1b2c3d4",
  state: "done",
  result: { status: "ok", message: "entity_id=AA" },
};
let plotPayload = {
  ok: true,
  jobId: "b1c2d3e4",
  state: "done",
  result: {
    path: "/tmp/mock-output.pdf",
    bytes: 1024,
    verified: true,
  },
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
  } else if (request.url?.startsWith("/api/acad/drawing-info?")) {
    payload = {
      ok: true,
      source: {
        channel: "objectarx",
        protocol: 1,
        pluginVersion: "1.6.0",
      },
      document: {
        title: "one.dwg",
        file: "/tmp/canonical/one.dwg",
        quiescent: true,
        instance: "document-instance-one",
        revision: 7,
      },
      counts: { entities: 12, pdfUnderlays: 1, dataLinks: 1 },
      pdfUnderlays: [{ handle: "A1", sourceFile: "/tmp/reference.pdf" }],
      dataLinks: [{
        handle: "B1",
        adapterId: "AcExcel",
        updateOption: 1_048_576,
        sourceUpdateAllowed: true,
      }],
      limits: {
        maxEntitiesScanned: 200_000,
        pdfUnderlayScope: "direct_layout_space_references",
      },
      warnings: [],
    };
    if (request.url.includes("legacy.dwg")) {
      payload.source.pluginVersion = "1.5.0";
    }
    if (request.url.includes("malformed.dwg")) {
      delete payload.dataLinks;
    }
  } else if (request.url === "/api/acad/standards/profiles") {
    payload = {
      ok: true,
      activeProfileId: "default-a3-mm",
      profiles: [{ id: "default-a3-mm", revision: "profile-r1" }],
    };
  } else if (request.url === "/api/acad/standards/scan") {
    standardsScanBodies.push(body);
    payload = {
      ok: true,
      scanId: "private-apply-token",
      target: body.target,
      profileId: body.profileId,
      profileRevision: "profile-r1",
      scannedAt: "2026-07-29T00:00:00.000Z",
      current: { document: { revision: 7 } },
      evidence: {
        drawingRevision: 'native:["document-instance-one",7]',
        completeness: { complete: true, reasons: [] },
        standardsScan: { objectsTruncated: false },
      },
      issues: [
        { id: "unit-1", severity: "error", scope: "unit", handles: [] },
        { id: "layer-1", severity: "warning", scope: "layer", handles: ["A1"] },
      ],
      objects: [],
      dimensions: [],
    };
    if (body.profileId === "broken-profile") {
      payload.issues = null;
    }
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
  } else if (request.url === "/api/acad/plot-pdf") {
    plotBodies.push(body);
    payload = plotPayload;
  } else {
    response.statusCode = 404;
    payload = { error: `Unhandled mock route: ${request.url}` };
  }
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(payload));
});

await new Promise((resolve) => mockDaemon.listen(0, "127.0.0.1", resolve));
const plotTestDir = mkdtempSync(join(tmpdir(), "acad-mcp-plot-"));
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
    {
      title: "one.dwg",
      file: "/tmp/canonical/one.dwg",
      active: true,
      instance: "document-instance-one",
    },
  ];

  const missingReviewTarget = await routedBackend.call("review", {
    operation: "snapshot",
  });
  assert.equal(missingReviewTarget.ok, false);
  assert.equal(missingReviewTarget.code, "target_required");

  const reviewProfiles = await routedBackend.call("review", {
    operation: "profiles",
  });
  assert.equal(reviewProfiles.ok, true);
  assert.equal(reviewProfiles.payload.profiles[0].id, "default-a3-mm");

  const reviewSnapshot = await routedBackend.call("review", {
    operation: "snapshot",
    target: "/tmp/canonical/one.dwg",
  });
  assert.equal(reviewSnapshot.ok, true);
  assert.equal(reviewSnapshot.payload.source.pluginVersion, "1.6.0");
  assert.equal(reviewSnapshot.payload.pdfUnderlays[0].handle, "A1");
  assert.equal(reviewSnapshot.payload.dataLinks[0].adapterId, "AcExcel");
  assert.equal(reviewSnapshot.payload.dataLinks[0].updateOption, 1_048_576);
  assert.equal(reviewSnapshot.payload.dataLinks[0].sourceUpdateAllowed, true);

  for (const target of ["/tmp/legacy.dwg", "/tmp/malformed.dwg"]) {
    const invalidSnapshot = await routedBackend.call("review", {
      operation: "snapshot",
      target,
    });
    assert.equal(invalidSnapshot.ok, false);
    assert.equal(invalidSnapshot.code, "snapshot_contract_mismatch");
  }

  const invalidReviewProfile = await routedBackend.call("review", {
    operation: "run_standards",
    target: "/tmp/canonical/one.dwg",
    data: { profile_id: "../bad" },
  });
  assert.equal(invalidReviewProfile.ok, false);
  assert.equal(invalidReviewProfile.code, "invalid_input");

  const malformedStandards = await routedBackend.call("review", {
    operation: "run_standards",
    target: "/tmp/canonical/one.dwg",
    data: { profile_id: "broken-profile" },
  });
  assert.equal(malformedStandards.ok, false);
  assert.equal(malformedStandards.code, "invalid_daemon_response");

  const standardsReview = await routedBackend.call("review", {
    operation: "run_standards",
    target: "/tmp/canonical/one.dwg",
    data: { profile_id: "default-a3-mm" },
  });
  assert.equal(standardsReview.ok, true);
  assert.equal(standardsReview.payload.scanId, undefined);
  assert.doesNotMatch(
    JSON.stringify(standardsReview),
    /private-apply-token/,
  );
  assert.equal(
    standardsReview.payload.evidence.drawingRevision,
    'native:["document-instance-one",7]',
  );
  assert.equal(standardsReview.payload.summary.issueCount, 2);
  assert.deepEqual(standardsReview.payload.summary.bySeverity, {
    error: 1,
    warning: 1,
  });
  assert.deepEqual(standardsScanBodies.at(-1), {
    target: "/tmp/canonical/one.dwg",
    profileId: "default-a3-mm",
    readOnly: true,
  });

  const plotPath = join(plotTestDir, "page-setup.pdf");
  const pageSetupPlot = {
    path: plotPath,
    layout: "Layout 1",
    page_setup: "PDF A3",
  };
  const missingPlotTarget = await routedBackend.call("drawing", {
    operation: "plot_pdf",
    data: pageSetupPlot,
  });
  assert.equal(missingPlotTarget.ok, false);
  assert.equal(missingPlotTarget.code, "target_required");

  const invalidPlotCases = [
    {
      data: { ...pageSetupPlot, path: "relative.pdf" },
      message: /đường dẫn tuyệt đối/i,
    },
    {
      data: { ...pageSetupPlot, path: join(plotTestDir, "output.txt") },
      message: /\.pdf/i,
    },
    {
      data: { path: plotPath, page_setup: "PDF A3" },
      message: /layout/i,
    },
    {
      data: { path: plotPath, layout: "Layout 1" },
      message: /đúng một chế độ/i,
    },
    {
      data: {
        ...pageSetupPlot,
        device: "AutoCAD PDF.pc3",
        media: "ISO_A3",
      },
      message: /không được kết hợp/i,
    },
    {
      data: {
        path: plotPath,
        layout: "Layout 1",
        device: "AutoCAD PDF.pc3",
      },
      message: /đồng thời device và media/i,
    },
    {
      data: {
        path: plotPath,
        layout: "Layout 1",
        device: "AutoCAD PDF.pc3",
        media: "ISO_A3",
        rotation: 45,
      },
      message: /rotation/i,
    },
    {
      data: {
        path: plotPath,
        layout: "Layout 1",
        device: "AutoCAD PDF.pc3",
        media: "ISO_A3",
        centered: null,
      },
      message: /centered/i,
    },
    {
      data: { ...pageSetupPlot, rotation: 90 },
      message: /page_setup/i,
    },
    {
      data: {
        path: plotPath,
        layout: "Layout 1",
        device: "AutoCAD PDF.pc3",
        media: "ISO_A3",
        plot_type: "layout",
      },
      message: /1:1/i,
    },
    {
      data: { ...pageSetupPlot, overwrite: "false" },
      message: /overwrite/i,
    },
    {
      data: { ...pageSetupPlot, timeout_ms: 499 },
      message: /timeout_ms/i,
    },
  ];
  for (const testCase of invalidPlotCases) {
    const invalidPlot = await routedBackend.call("drawing", {
      operation: "plot_pdf",
      target: "/tmp/canonical/one.dwg",
      data: testCase.data,
    });
    assert.equal(invalidPlot.ok, false);
    assert.equal(invalidPlot.supported, true);
    assert.equal(invalidPlot.code, "invalid_input");
    assert.match(invalidPlot.error, testCase.message);
  }

  plotPayload = {
    ok: true,
    jobId: "b1c2d3e4",
    state: "done",
    result: {
      path: plotPath,
      bytes: 2048,
      verified: true,
    },
  };
  const plotted = await routedBackend.call("drawing", {
    operation: "plot_pdf",
    target: "one.dwg",
    data: pageSetupPlot,
  });
  assert.equal(plotted.ok, true);
  assert.equal(plotted.payload.accepted, true);
  assert.equal(plotted.payload.completed, true);
  assert.equal(plotted.payload.result.verified, true);
  assert.deepEqual(plotBodies.at(-1), {
    target: "/tmp/canonical/one.dwg",
    documentInstance: "document-instance-one",
    path: plotPath,
    layout: "Layout 1",
    page_setup: "PDF A3",
    overwrite: false,
    timeout_ms: 120_000,
  });

  const explicitPath = join(plotTestDir, "explicit.pdf");
  plotPayload = {
    ok: true,
    jobId: "b1c2d3e5",
    state: "done",
    result: {
      path: explicitPath,
      bytes: 4096,
      verified: true,
    },
  };
  const explicitPlot = await routedBackend.call("drawing", {
    operation: "plot_pdf",
    target: "/tmp/canonical/one.dwg",
    data: {
      path: explicitPath,
      layout: "Layout 2",
      device: "AutoCAD PDF.pc3",
      media: "ISO_A3",
      plot_type: "layout",
      scale: "1:1",
      rotation: 90,
      centered: false,
      style_sheet: "monochrome.ctb",
      overwrite: true,
      timeout_ms: 500,
      future_daemon_option: "preserved-by-schema-only",
    },
  });
  assert.equal(explicitPlot.ok, true);
  assert.deepEqual(plotBodies.at(-1), {
    target: "/tmp/canonical/one.dwg",
    documentInstance: "document-instance-one",
    path: explicitPath,
    layout: "Layout 2",
    device: "AutoCAD PDF.pc3",
    media: "ISO_A3",
    plot_type: "layout",
    scale: "1:1",
    rotation: 90,
    centered: false,
    style_sheet: "monochrome.ctb",
    overwrite: true,
    timeout_ms: 500,
  });

  const existingPath = join(plotTestDir, "existing.pdf");
  writeFileSync(existingPath, "%PDF-1.7\nold\n%%EOF\n");
  const plotCallsBeforeExisting = plotBodies.length;
  const existingPlot = await routedBackend.call("drawing", {
    operation: "plot_pdf",
    target: "/tmp/canonical/one.dwg",
    data: {
      ...pageSetupPlot,
      path: existingPath,
    },
  });
  assert.equal(existingPlot.ok, false);
  assert.equal(existingPlot.code, "file_exists");
  assert.equal(plotBodies.length, plotCallsBeforeExisting);

  plotPayload = {
    ok: true,
    jobId: "b1c2d3e6",
    state: "sent",
    result: null,
  };
  const pendingPlot = await routedBackend.call("drawing", {
    operation: "plot_pdf",
    target: "/tmp/canonical/one.dwg",
    data: pageSetupPlot,
    include_screenshot: true,
  });
  assert.equal(pendingPlot.ok, true);
  assert.equal(pendingPlot.payload.accepted, true);
  assert.equal(pendingPlot.payload.completed, false);
  assert.equal(pendingPlot.payload.screenshot, undefined);
  assert.match(pendingPlot.warnings.join("\n"), /không gửi lại operation/i);

  plotPayload = {
    ok: false,
    jobId: "b1c2d3e7",
    state: "error",
    result: {
      status: "error",
      code: "plot_configuration_invalid",
      message: "Named page setup does not exist",
    },
  };
  const failedPlot = await routedBackend.call("drawing", {
    operation: "plot_pdf",
    target: "/tmp/canonical/one.dwg",
    data: pageSetupPlot,
  });
  assert.equal(failedPlot.ok, false);
  assert.equal(failedPlot.supported, true);
  assert.equal(failedPlot.code, "plot_configuration_invalid");
  assert.match(failedPlot.error, /page setup/i);
  assert.equal(failedPlot.payload.jobId, "b1c2d3e7");

  plotPayload = {
    ok: false,
    jobId: "b1c2d3e8",
    state: "timeout",
    uncertain: true,
    path: plotPath,
    result: {
      status: "timeout",
      code: "plot_timeout_uncertain",
      message: "Plugin may still be writing the temporary PDF",
      payload: {
        temp_path: join(plotTestDir, ".page-setup.pdf.b1c2d3e8.tmp.pdf"),
      },
    },
  };
  const timedOutPlot = await routedBackend.call("drawing", {
    operation: "plot_pdf",
    target: "/tmp/canonical/one.dwg",
    data: pageSetupPlot,
  });
  assert.equal(timedOutPlot.ok, false);
  assert.equal(timedOutPlot.code, "plot_timeout_uncertain");
  assert.equal(timedOutPlot.payload.jobId, "b1c2d3e8");
  assert.equal(timedOutPlot.payload.uncertain, true);
  assert.match(
    timedOutPlot.payload.result.payload.temp_path,
    /\.tmp\.pdf$/,
  );

  const missingInstanceDocuments = documents;
  documents = [
    { title: "legacy.dwg", file: "/tmp/canonical/legacy.dwg", active: true },
  ];
  const missingInstance = await routedBackend.call("drawing", {
    operation: "plot_pdf",
    target: "/tmp/canonical/legacy.dwg",
    data: pageSetupPlot,
  });
  assert.equal(missingInstance.ok, false);
  assert.equal(missingInstance.code, "target_instance_unavailable");
  documents = missingInstanceDocuments;

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
  rmSync(plotTestDir, { recursive: true, force: true });
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
  "MCP backend test passed: 76-op contract, review guards, target routing, screenshot content, PID catalog.",
);

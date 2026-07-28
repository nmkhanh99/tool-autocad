import assert from "node:assert/strict";

import {
  CAD_SELECTION_MAX_SUBJECTS,
  CAD_SELECTION_TTL_MS,
  buildSelectionControlParams,
  cadSelectionRouter,
} from "../src/cadSelection.ts";
import { byCapabilityId } from "../src/objectarx/catalog.ts";

const drawing = {
  title: "Drawing1.dwg",
  file: "/tmp/Drawing1.dwg",
  active: true,
  instance: "DOC-0001",
  revision: 7,
};

const baseSubjects = [
  {
    handle: "A1",
    type: "AcDbLine",
    layer: "A-WALL",
    layerHandle: "10",
    ownerHandle: "1F",
  },
  {
    handle: "B2",
    type: "AcDbBlockReference",
    layer: "A-FURN",
    layerHandle: "11",
    ownerHandle: "1F",
  },
];

function snapshot(options = {}) {
  return {
    ok: true,
    document: {
      title: drawing.title,
      file: drawing.file,
      active: drawing.active,
      readOnly: false,
      instance: drawing.instance,
      revision: drawing.revision,
      ...(options.document || {}),
    },
    tables: {
      layers: [
        { name: "0", handle: "F" },
        { name: "A-WALL", handle: "10" },
        { name: "A-FURN", handle: "11" },
        { name: "A-DEST", handle: "12" },
      ],
      blocks: [
        { name: "CHAIR", handle: "20", referenceCount: 3 },
      ],
      ...(options.tables || {}),
    },
  };
}

function nativeSuccess(command, captureSubjects = baseSubjects) {
  const common = {
    ok: true,
    token: command.token,
    action: command.action,
    target: command.exactTarget,
  };
  if (command.action === "activate") {
    return { ...common, count: 0, changed: 0, subjects: [] };
  }
  if (command.action === "capture") {
    return {
      ...common,
      count: captureSubjects.length,
      changed: 0,
      subjects: captureSubjects,
    };
  }
  if (command.action === "resolve" || command.action === "select") {
    const handles = String(command.params.handles || "")
      .split(",")
      .filter(Boolean);
    const subjects = handles.length
      ? handles.map((handle, index) => ({
          handle,
          type: index ? "AcDbBlockReference" : "AcDbLine",
          layer: index ? "A-FURN" : "A-WALL",
          layerHandle: index ? "11" : "10",
          ownerHandle: "1F",
        }))
      : captureSubjects.slice(0, 1);
    return {
      ...common,
      count: subjects.length,
      changed: 0,
      subjects,
    };
  }
  const destination = Buffer.from(
    String(command.params.destLayerHex || ""),
    "hex",
  ).toString("utf8");
  const expectedHandles = String(command.params.handles || "")
    .split(",")
    .filter(Boolean);
  const beforeByHandle = new Map(
    captureSubjects.map((subject) => [subject.handle, subject]),
  );
  const subjects = expectedHandles.map((handle) => ({
    ...(beforeByHandle.get(handle) || baseSubjects[0]),
    handle,
    layer: destination,
    layerHandle: "12",
  }));
  const changed = expectedHandles.filter((handle) =>
    beforeByHandle.get(handle)?.layer.toUpperCase() !==
    destination.toUpperCase()).length;
  return {
    ...common,
    count: subjects.length,
    changed,
    subjects,
  };
}

function harness(options = {}) {
  let clock = options.now ?? Date.parse("2026-07-28T00:00:00.000Z");
  let sequence = 0;
  const calls = [];
  const snapshots = [];
  const documents = options.documents || [drawing];
  let documentReads = 0;
  const captureSubjects = options.captureSubjects ?? baseSubjects;
  const dependencies = {
    now: () => clock,
    randomId: () => (++sequence).toString(16).padStart(16, "0"),
    listOpenDocs: async () => ({
      alive: true,
      docs: options.listDocuments
        ? options.listDocuments(++documentReads)
        : documents,
    }),
    requestDrawingInfo: async (target) => {
      snapshots.push(target);
      return options.requestSnapshot
        ? options.requestSnapshot(target, snapshots.length)
        : options.snapshot ?? snapshot();
    },
    invokeSelectionControl: async (command) => {
      calls.push(command);
      if (options.invoke) return options.invoke(command, calls.length);
      return nativeSuccess(command, captureSubjects);
    },
  };
  return {
    router: cadSelectionRouter(dependencies),
    calls,
    snapshots,
    advance(ms) {
      clock += ms;
    },
  };
}

async function invoke(router, method, path, {
  body = {},
  params = {},
  query = {},
} = {}) {
  const layer = router.stack.find((item) =>
    item.route?.path === path && item.route.methods[method.toLowerCase()]);
  assert.ok(layer, `${method} ${path} handler exists`);
  let status = 200;
  let payload;
  const response = {
    status(value) {
      status = value;
      return response;
    },
    json(value) {
      payload = value;
      return response;
    },
  };
  await layer.route.stack[0].handle({
    body,
    params,
    query,
  }, response);
  return { status, payload };
}

function applyPath(operation) {
  return {
    path: "/operations/:id/apply",
    params: { id: operation.id },
    body: { revision: operation.revision, confirmed: true },
  };
}

function rejectPath(operation) {
  return {
    path: "/operations/:id/reject",
    params: { id: operation.id },
    body: { revision: operation.revision },
  };
}

const capability = byCapabilityId("ed.selection_control");
assert.equal(capability?.enabled, true);
assert.equal(capability?.interactive, true);
assert.equal(capability?.handler, "command");

const rawParams = buildSelectionControlParams({
  action: "move",
  token: "abc123",
  exactTarget: drawing.file,
  guard: {
    instance: drawing.instance,
    revision: drawing.revision,
    activeInstance: drawing.instance,
  },
  subjects: baseSubjects,
  destLayer: "A-DEST",
  destLayerHandle: "12",
});
assert.equal(rawParams.action, "move");
assert.equal(
  Buffer.from(String(rawParams.exactTargetHex), "hex").toString("utf8"),
  drawing.file,
);
assert.equal(rawParams.handles, "A1,B2");
assert.match(
  String(rawParams.expected),
  /^A1,416344624c696e65,10,1F;B2,/,
);
assert.equal(
  Buffer.from(String(rawParams.destLayerHex), "hex").toString("utf8"),
  "A-DEST",
);
assert.equal(rawParams.destLayerHandle, "12");
assert.equal(rawParams.documentInstance, drawing.instance);
assert.equal(rawParams.databaseRevision, drawing.revision);
assert.equal(rawParams.activeDocumentInstance, drawing.instance);

// GET current is a full native capture, not the 200-object drawing-info list.
{
  const test = harness();
  const current = await invoke(test.router, "GET", "/current", {
    query: { target: drawing.file },
  });
  assert.equal(current.status, 200);
  assert.equal(current.payload.ok, true);
  assert.equal(current.payload.target, drawing.file);
  assert.equal(current.payload.count, 2);
  assert.deepEqual(current.payload.subjects, baseSubjects);
  assert.match(current.payload.selectionRevision, /^[a-f0-9]{64}$/);
  assert.equal(test.calls.length, 1);
  assert.equal(test.calls[0].action, "capture");
  assert.equal(test.calls[0].exactTarget, drawing.file);
}

// Prepare/reject activate is server-only; a confirmed apply invokes native once.
{
  const test = harness();
  const prepared = await invoke(test.router, "POST", "/prepare", {
    body: { target: drawing.file, action: "activate-document" },
  });
  assert.equal(prepared.status, 201);
  assert.equal(prepared.payload.operation.state, "pending");
  assert.match(prepared.payload.operation.revision, /^[a-f0-9]{64}$/);
  assert.equal(test.calls.length, 0, "prepare activate does not call native");

  const rejected = await invoke(test.router, "POST", rejectPath(
    prepared.payload.operation,
  ).path, rejectPath(prepared.payload.operation));
  assert.equal(rejected.status, 200);
  assert.equal(rejected.payload.operation.state, "rejected");
  assert.equal(test.calls.length, 0, "reject does not call native");

  const rejectedApply = await invoke(test.router, "POST", applyPath(
    prepared.payload.operation,
  ).path, applyPath(prepared.payload.operation));
  assert.equal(rejectedApply.status, 409);
  assert.equal(rejectedApply.payload.code, "operation_not_pending");
  assert.equal(test.calls.length, 0);

  const second = await invoke(test.router, "POST", "/prepare", {
    body: { target: drawing.file, action: "activate-document" },
  });
  const applied = await invoke(
    test.router,
    "POST",
    applyPath(second.payload.operation).path,
    applyPath(second.payload.operation),
  );
  assert.equal(applied.status, 200);
  assert.equal(applied.payload.operation.state, "applied");
  assert.equal(test.calls.length, 1);
  assert.equal(test.calls[0].action, "activate");
}

// Select proposal freezes the current selection and exact scope subjects read-only.
{
  const test = harness();
  const prepared = await invoke(test.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "select",
      scope: { kind: "layer", name: "a-wall" },
    },
  });
  assert.equal(prepared.status, 201);
  const operation = prepared.payload.operation;
  assert.equal(operation.scope.name, "A-WALL");
  assert.equal(operation.scope.handle, "10");
  assert.equal(operation.summary.count, 1);
  assert.equal(operation.subjectCount, 1);
  assert.equal(test.calls.length, 2);
  assert.deepEqual(
    test.calls.map((call) => call.action),
    ["capture", "resolve"],
    "prepare select only makes read-only native calls",
  );

  const unconfirmed = await invoke(
    test.router,
    "POST",
    "/operations/:id/apply",
    {
      params: { id: operation.id },
      body: { revision: operation.revision },
    },
  );
  assert.equal(unconfirmed.status, 400);
  assert.equal(unconfirmed.payload.code, "confirmation_required");
  assert.equal(test.calls.length, 2);

  const wrongRevision = await invoke(
    test.router,
    "POST",
    "/operations/:id/apply",
    {
      params: { id: operation.id },
      body: { revision: "bad", confirmed: true },
    },
  );
  assert.equal(wrongRevision.status, 409);
  assert.equal(wrongRevision.payload.code, "operation_revision_mismatch");
  assert.equal(test.calls.length, 2);

  const applied = await invoke(
    test.router,
    "POST",
    applyPath(operation).path,
    applyPath(operation),
  );
  assert.equal(applied.status, 200);
  assert.equal(applied.payload.result.count, 1);
  assert.equal(test.calls.length, 3, "confirmed apply invokes one mutating native call");
  assert.equal(test.calls[2].action, "select");
  assert.equal(test.calls[2].params.scopeKind, "layer");
  assert.equal(test.calls[2].params.scopeHandle, "10");
  assert.equal(
    Buffer.from(String(test.calls[2].params.scopeNameHex), "hex").toString("utf8"),
    "A-WALL",
  );
  assert.equal(test.calls[2].params.handles, "A1");
  assert.equal(test.calls[2].params.expectedSelectionCount, 2);
  assert.match(String(test.calls[2].params.expectedSelection), /A1,.*;B2,/);

  const repeated = await invoke(
    test.router,
    "POST",
    applyPath(operation).path,
    applyPath(operation),
  );
  assert.equal(repeated.status, 409);
  assert.equal(test.calls.length, 3, "applied operation is one-shot");
}

// Handle scopes normalize duplicates and resolve complete subject guards at prepare.
{
  const test = harness();
  const prepared = await invoke(test.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "select",
      scope: { kind: "handles", handle: "000a1", handles: ["A1", "b2"] },
    },
  });
  assert.equal(prepared.status, 201);
  assert.deepEqual(prepared.payload.operation.scope.handles, ["A1", "B2"]);
  assert.equal(prepared.payload.operation.subjectCount, 2);
  assert.deepEqual(
    test.calls.map((call) => call.action),
    ["capture", "resolve"],
  );
  const rejected = await invoke(
    test.router,
    "POST",
    rejectPath(prepared.payload.operation).path,
    rejectPath(prepared.payload.operation),
  );
  assert.equal(rejected.status, 200);
  assert.equal(rejected.payload.operation.state, "rejected");
  assert.deepEqual(
    test.calls.map((call) => call.action),
    ["capture", "resolve"],
    "reject never invokes select",
  );
}

// A duplicate document title is ambiguous; a full file path remains exact.
{
  const documents = [
    {
      title: "Shared.dwg",
      file: "/tmp/a/Shared.dwg",
      active: true,
      instance: "DOC-A",
      revision: 3,
    },
    {
      title: "Shared.dwg",
      file: "/tmp/b/Shared.dwg",
      active: false,
      instance: "DOC-B",
      revision: 4,
    },
  ];
  const test = harness({
    documents,
    requestSnapshot: (target) => snapshot({
      document: {
        title: "Shared.dwg",
        file: target,
        active: target === "/tmp/a/Shared.dwg",
        instance: target === "/tmp/a/Shared.dwg" ? "DOC-A" : "DOC-B",
        revision: target === "/tmp/a/Shared.dwg" ? 3 : 4,
      },
    }),
  });
  const ambiguous = await invoke(test.router, "POST", "/prepare", {
    body: {
      target: "Shared.dwg",
      action: "activate-document",
    },
  });
  assert.equal(ambiguous.status, 409);
  assert.equal(ambiguous.payload.code, "target_ambiguous");
  assert.equal(test.calls.length, 0);

  const exact = await invoke(test.router, "POST", "/prepare", {
    body: {
      target: "/tmp/b/Shared.dwg",
      action: "activate-document",
    },
  });
  assert.equal(exact.status, 201);
  assert.equal(exact.payload.operation.target, "/tmp/b/Shared.dwg");
  assert.equal(test.calls.length, 0);
}

// Move captures full current Pickfirst at prepare and sends guarded subjects only on apply.
{
  const mixed = [
    baseSubjects[0],
    { ...baseSubjects[1], layer: "A-DEST", layerHandle: "12" },
  ];
  const test = harness({ captureSubjects: mixed });
  const prepared = await invoke(test.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "move-to-layer",
      params: { layer: "a-dest" },
    },
  });
  assert.equal(prepared.status, 201);
  const operation = prepared.payload.operation;
  assert.deepEqual(operation.summary, {
    count: 2,
    fromLayers: ["A-WALL", "A-DEST"],
    toLayer: "A-DEST",
  });
  assert.equal(operation.subjectCount, 2);
  assert.equal(test.calls.length, 1);
  assert.equal(test.calls[0].action, "capture");

  const applied = await invoke(
    test.router,
    "POST",
    applyPath(operation).path,
    applyPath(operation),
  );
  assert.equal(applied.status, 200);
  assert.equal(applied.payload.result.changed, 1);
  assert.equal(test.calls.length, 2);
  assert.equal(test.calls[1].action, "move");
  assert.equal(test.calls[1].params.handles, "A1,B2");
  assert.equal(test.calls[1].params.destLayerHandle, "12");
  assert.match(String(test.calls[1].params.expected), /A1,.*10,1F;B2,.*12,1F/);
  assert.equal(test.calls[1].exactTarget, drawing.file);
}

// Empty, too-large, already-at-destination, and non-active move proposals fail closed.
{
  const empty = harness({ captureSubjects: [] });
  const response = await invoke(empty.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "move-to-layer",
      params: { layer: "A-DEST" },
    },
  });
  assert.equal(response.status, 409);
  assert.equal(response.payload.code, "selection_empty");
  assert.equal(empty.calls.length, 1);

  const already = harness({
    captureSubjects: baseSubjects.map((subject) => ({
      ...subject,
      layer: "A-DEST",
      layerHandle: "12",
    })),
  });
  const noChange = await invoke(already.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "move-to-layer",
      params: { layer: "A-DEST" },
    },
  });
  assert.equal(noChange.status, 400);
  assert.equal(noChange.payload.code, "no_change");

  const manySubjects = Array.from(
    { length: CAD_SELECTION_MAX_SUBJECTS + 1 },
    (_, index) => ({
      ...baseSubjects[0],
      handle: (index + 1).toString(16).toUpperCase(),
    }),
  );
  const tooLarge = harness({ captureSubjects: manySubjects });
  const oversized = await invoke(tooLarge.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "move-to-layer",
      params: { layer: "A-DEST" },
    },
  });
  assert.equal(oversized.status, 409);
  assert.equal(oversized.payload.code, "selection_too_large");

  const inactive = harness({
    documents: [
      { ...drawing, active: false },
      {
        title: "Other.dwg",
        file: "/tmp/Other.dwg",
        active: true,
        instance: "DOC-OTHER",
        revision: 1,
      },
    ],
  });
  const notActive = await invoke(inactive.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "move-to-layer",
      params: { layer: "A-DEST" },
    },
  });
  assert.equal(notActive.status, 409);
  assert.equal(notActive.payload.code, "target_not_active");
  assert.equal(inactive.calls.length, 0);
}

// Missing scopes/layers are rejected before native selection control is invoked.
{
  const test = harness();
  const missingLayer = await invoke(test.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "select",
      scope: { kind: "layer", name: "DOES-NOT-EXIST" },
    },
  });
  assert.equal(missingLayer.status, 404);
  assert.equal(missingLayer.payload.code, "scope_not_found");
  assert.equal(test.calls.length, 0);

  const missingDestination = await invoke(test.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "move-to-layer",
      params: { layer: "DOES-NOT-EXIST" },
    },
  });
  assert.equal(missingDestination.status, 404);
  assert.equal(missingDestination.payload.code, "layer_not_found");
  assert.equal(test.calls.length, 0);
}

// A scope or destination layer recreated under the same name is stale by handle.
{
  const changedScope = harness({
    requestSnapshot: (_target, call) => snapshot({
      tables: {
        layers: [
          { name: "A-WALL", handle: call === 1 ? "10" : "99" },
          { name: "A-DEST", handle: "12" },
        ],
        blocks: [{ name: "CHAIR", handle: "20" }],
      },
    }),
  });
  const selected = await invoke(changedScope.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "select",
      scope: { kind: "layer", name: "A-WALL" },
    },
  });
  const staleScope = await invoke(
    changedScope.router,
    "POST",
    applyPath(selected.payload.operation).path,
    applyPath(selected.payload.operation),
  );
  assert.equal(staleScope.status, 409);
  assert.equal(staleScope.payload.code, "scope_stale");
  assert.equal(changedScope.calls.length, 2);

  const changedDestination = harness({
    requestSnapshot: (_target, call) => snapshot({
      tables: {
        layers: [
          { name: "A-WALL", handle: "10" },
          { name: "A-FURN", handle: "11" },
          { name: "A-DEST", handle: call === 1 ? "12" : "98" },
        ],
        blocks: [{ name: "CHAIR", handle: "20" }],
      },
    }),
  });
  const moved = await invoke(changedDestination.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "move-to-layer",
      params: { layer: "A-DEST" },
    },
  });
  assert.equal(moved.status, 201);
  const staleDestination = await invoke(
    changedDestination.router,
    "POST",
    applyPath(moved.payload.operation).path,
    applyPath(moved.payload.operation),
  );
  assert.equal(staleDestination.status, 409);
  assert.equal(staleDestination.payload.code, "destination_stale");
  assert.equal(
    changedDestination.calls.length,
    1,
    "destination stale blocks move before second native call",
  );
}

// Document instance, database revision, and active-document changes invalidate
// the operation before any mutating native action can run.
{
  const changedInstance = harness({
    listDocuments: (read) => [{
      ...drawing,
      instance: read === 1 ? drawing.instance : "DOC-REOPENED",
    }],
  });
  const instancePrepared = await invoke(
    changedInstance.router,
    "POST",
    "/prepare",
    {
      body: {
        target: drawing.file,
        action: "select",
        scope: { kind: "layer", name: "A-WALL" },
      },
    },
  );
  const instanceStale = await invoke(
    changedInstance.router,
    "POST",
    applyPath(instancePrepared.payload.operation).path,
    applyPath(instancePrepared.payload.operation),
  );
  assert.equal(instanceStale.status, 409);
  assert.equal(instanceStale.payload.code, "document_stale");
  assert.deepEqual(
    changedInstance.calls.map((call) => call.action),
    ["capture", "resolve"],
  );

  const changedRevision = harness({
    listDocuments: (read) => [{
      ...drawing,
      revision: read === 1 ? drawing.revision : drawing.revision + 1,
    }],
  });
  const revisionPrepared = await invoke(
    changedRevision.router,
    "POST",
    "/prepare",
    {
      body: {
        target: drawing.file,
        action: "move-to-layer",
        params: { layer: "A-DEST" },
      },
    },
  );
  const revisionStale = await invoke(
    changedRevision.router,
    "POST",
    applyPath(revisionPrepared.payload.operation).path,
    applyPath(revisionPrepared.payload.operation),
  );
  assert.equal(revisionStale.status, 409);
  assert.equal(revisionStale.payload.code, "drawing_stale");
  assert.deepEqual(
    changedRevision.calls.map((call) => call.action),
    ["capture"],
  );

  const source = {
    title: "Source.dwg",
    file: "/tmp/Source.dwg",
    active: true,
    instance: "DOC-SOURCE",
    revision: 1,
  };
  const target = {
    title: "Target.dwg",
    file: "/tmp/Target.dwg",
    active: false,
    instance: "DOC-TARGET",
    revision: 2,
  };
  const changedActive = harness({
    listDocuments: (read) => read === 1
      ? [source, target]
      : [{ ...source, active: false }, { ...target, active: true }],
    requestSnapshot: () => snapshot({
      document: target,
    }),
  });
  const activationPrepared = await invoke(
    changedActive.router,
    "POST",
    "/prepare",
    {
      body: {
        target: target.file,
        action: "activate-document",
      },
    },
  );
  const activeStale = await invoke(
    changedActive.router,
    "POST",
    applyPath(activationPrepared.payload.operation).path,
    applyPath(activationPrepared.payload.operation),
  );
  assert.equal(activeStale.status, 409);
  assert.equal(activeStale.payload.code, "document_stale");
  assert.equal(changedActive.calls.length, 0);
}

// A native last-moment stale guard is surfaced and the one-shot operation closes.
{
  const test = harness({
    invoke: async (command) => {
      if (command.action !== "select") return nativeSuccess(command);
      return {
        ok: false,
        token: command.token,
        action: command.action,
        code: "selection_stale",
        error: "selection_stale: resolved scope differs from proposal",
      };
    },
  });
  const prepared = await invoke(test.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "select",
      scope: { kind: "block", name: "CHAIR" },
    },
  });
  const stale = await invoke(
    test.router,
    "POST",
    applyPath(prepared.payload.operation).path,
    applyPath(prepared.payload.operation),
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.payload.code, "selection_stale");
  assert.deepEqual(
    test.calls.map((call) => call.action),
    ["capture", "resolve", "select"],
  );
}

// Token mismatch and stale native errors cannot be mistaken for success.
{
  const mismatch = harness({
    invoke: async (command) => ({
      ...nativeSuccess(command),
      token: "wrong-token",
    }),
  });
  const current = await invoke(mismatch.router, "GET", "/current", {
    query: { target: drawing.file },
  });
  assert.equal(current.status, 502);
  assert.equal(current.payload.code, "native_response_mismatch");

  const stale = harness({
    invoke: async (command) => {
      if (command.action === "capture") return nativeSuccess(command);
      return {
        ok: false,
        token: command.token,
        action: command.action,
        code: "selection_stale",
        error: "expected layer changed",
      };
    },
  });
  const prepared = await invoke(stale.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "move-to-layer",
      params: { layer: "A-DEST" },
    },
  });
  const operation = prepared.payload.operation;
  const applied = await invoke(
    stale.router,
    "POST",
    applyPath(operation).path,
    applyPath(operation),
  );
  assert.equal(applied.status, 409);
  assert.equal(applied.payload.code, "selection_stale");
  assert.equal(stale.calls.length, 2);

  const rejected = await invoke(
    stale.router,
    "POST",
    rejectPath(operation).path,
    rejectPath(operation),
  );
  assert.equal(rejected.status, 200);
  assert.equal(rejected.payload.operation.state, "rejected");
  assert.equal(stale.calls.length, 2, "rejecting failed op is server-only");
}

// Native guard failures retain stable API errors, and malformed plugin rows are
// treated as bridge failures rather than bad client input.
{
  const tooLarge = harness({
    invoke: async (command) => ({
      ok: false,
      token: command.token,
      action: command.action,
      code: "selection_too_large",
      error: "selection_too_large",
    }),
  });
  const oversized = await invoke(tooLarge.router, "GET", "/current", {
    query: { target: drawing.file },
  });
  assert.equal(oversized.status, 409);
  assert.equal(oversized.payload.code, "selection_too_large");

  const empty = harness({
    invoke: async (command) => ({
      ok: false,
      token: command.token,
      action: command.action,
      code: "no_matching_objects",
      error: "no_matching_objects",
    }),
  });
  const noMatch = await invoke(empty.router, "GET", "/current", {
    query: { target: drawing.file },
  });
  assert.equal(noMatch.status, 409);
  assert.equal(noMatch.payload.code, "selection_empty");

  const malformed = harness({
    invoke: async (command) => ({
      ...nativeSuccess(command),
      count: 1,
      subjects: [{
        handle: "not-a-handle",
        type: "AcDbLine",
        layer: "0",
        layerHandle: "F",
        ownerHandle: "1F",
      }],
    }),
  });
  const invalidResponse = await invoke(malformed.router, "GET", "/current", {
    query: { target: drawing.file },
  });
  assert.equal(invalidResponse.status, 502);
  assert.equal(invalidResponse.payload.code, "native_response_invalid");
}

// Proposal TTL is enforced without touching AutoCAD.
{
  const test = harness();
  const prepared = await invoke(test.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "select",
      scope: { kind: "block", name: "chair" },
    },
  });
  assert.equal(prepared.status, 201);
  test.advance(CAD_SELECTION_TTL_MS + 1);
  const expired = await invoke(
    test.router,
    "POST",
    applyPath(prepared.payload.operation).path,
    applyPath(prepared.payload.operation),
  );
  assert.equal(expired.status, 409);
  assert.equal(expired.payload.code, "operation_expired");
  assert.equal(test.calls.length, 2);
}

console.log("✓ cad selection: exact target, two-phase confirmation, full capture and stale guards");

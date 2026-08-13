import assert from "node:assert/strict";

import {
  CAD_SELECTION_MAX_SUBJECTS,
  CAD_SELECTION_TTL_MS,
  buildSelectionControlParams,
  cadSelectionRouter,
  spaceMismatchReason,
} from "../src/cadSelection.ts";
import { byCapabilityId } from "../src/objectarx/catalog.ts";

const drawing = {
  title: "Drawing1.dwg",
  file: "/tmp/Drawing1.dwg",
  active: true,
  instance: "DOC-0001",
  revision: 7,
};

const catalogGuard = {
  instance: drawing.instance,
  revision: drawing.revision,
};

const layerCatalogScope = {
  kind: "layer",
  name: "A-WALL",
  handle: "10",
  selectedAll: false,
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

const catalogScopeParams = buildSelectionControlParams({
  action: "resolve",
  token: "catalog123",
  exactTarget: drawing.file,
  guard: {
    instance: drawing.instance,
    revision: drawing.revision,
    activeInstance: drawing.instance,
  },
  scope: { kind: "handles", handles: ["A1"] },
  catalogScope: layerCatalogScope,
});
assert.equal(catalogScopeParams.catalogScopeKind, "layer");
assert.equal(
  Buffer.from(String(catalogScopeParams.catalogScopeNameHex), "hex").toString("utf8"),
  "A-WALL",
);
assert.equal(catalogScopeParams.catalogScopeHandle, "10");
assert.equal(catalogScopeParams.catalogScopeSelectedAll, 0);

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

/* Bản vẽ CHƯA LƯU trùng tiêu đề: đích gửi đi phải là MÃ PHIÊN.
   `completeDocument()` dựng lại đối tượng bản vẽ theo từng trường, nên quên chép
   `targetsInstance` là `nativeDocumentTarget()` thấy `undefined` — tức "plugin
   không nhận mã phiên" — và lùi về tiêu đề. Hai bản vẽ vừa được chọn ĐÚNG bằng
   mã phiên lại chết ở `target_ambiguous` ngay bước sau: chốt viết xong, verify
   xanh, mà cả đường vẫn hỏng. Đúng cái bẫy chú thích của `space` đã cảnh báo. */
{
  const unsavedA = {
    title: "Drawing1.dwg", file: "", active: true,
    instance: "DOC-AAAA", revision: 3, targetsInstance: true,
  };
  const unsavedB = { ...unsavedA, active: false, instance: "DOC-BBBB" };
  const test = harness({
    documents: [unsavedA, unsavedB],
    snapshot: snapshot({ instance: unsavedA.instance, revision: unsavedA.revision }),
  });
  const current = await invoke(test.router, "GET", "/current", {
    query: { target: unsavedA.instance },
  });
  assert.equal(current.status, 200, JSON.stringify(current.payload));
  assert.equal(
    test.calls[0].exactTarget,
    unsavedA.instance,
    "đích gửi đi phải là mã phiên, không phải tiêu đề trùng",
  );

  /* Không có cờ năng lực = plugin bản cũ: phải lùi về tiêu đề, vì gửi mã phiên
     cho nó là nhận `not_found`. */
  const legacy = harness({
    documents: [{ ...unsavedA, targetsInstance: undefined }],
    snapshot: snapshot({ instance: unsavedA.instance, revision: unsavedA.revision }),
  });
  const legacyCurrent = await invoke(legacy.router, "GET", "/current", {
    query: { target: "Drawing1.dwg" },
  });
  assert.equal(legacyCurrent.status, 200, JSON.stringify(legacyCurrent.payload));
  assert.equal(legacy.calls[0].exactTarget, "Drawing1.dwg");
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

// Empty layer/block scopes fail visibly at prepare and never create an operation.
for (const scope of [
  { kind: "layer", name: "A-WALL" },
  { kind: "block", name: "CHAIR" },
]) {
  const test = harness({
    invoke: async (command) => {
      if (command.action === "capture") return nativeSuccess(command, []);
      return {
        ok: false,
        token: command.token,
        action: command.action,
        target: command.exactTarget,
        code: "no_matching_objects",
        error: "no_matching_objects",
      };
    },
  });
  const prepared = await invoke(test.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "select",
      scope,
    },
  });
  assert.equal(prepared.status, 409);
  assert.equal(prepared.payload.code, "selection_empty");
  assert.equal(prepared.payload.operation, undefined);
  assert.deepEqual(
    test.calls.map((call) => call.action),
    ["capture", "resolve"],
    `${scope.kind} empty scope is checked read-only before proposal`,
  );
}

// Handle scopes fail closed unless the cached catalog is bound to the current
// document instance and revision. Validation happens before native capture or
// resolve, and the fast path never requests a drawing-info snapshot.
{
  const test = harness();
  const missing = await invoke(test.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "select",
      scope: { kind: "handles", handles: ["A1"] },
    },
  });
  assert.equal(missing.status, 400);
  assert.equal(missing.payload.code, "invalid_request");
  assert.equal(test.calls.length, 0);
  assert.equal(test.snapshots.length, 0);
}

for (const invalidGuard of [
  { instance: `${drawing.instance}\nold`, revision: drawing.revision },
  { instance: "X".repeat(129), revision: drawing.revision },
  { instance: drawing.instance, revision: -1 },
  { instance: drawing.instance, revision: Number.MAX_SAFE_INTEGER + 1 },
]) {
  const test = harness();
  const invalid = await invoke(test.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "select",
      scope: { kind: "handles", handles: ["A1"] },
      catalogGuard: invalidGuard,
    },
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.payload.code, "invalid_request");
  assert.equal(test.calls.length, 0);
  assert.equal(test.snapshots.length, 0);
}

for (const [invalidCatalogScope, code] of [
  [{ kind: "layout", name: "Model", handle: "1", selectedAll: false }, "invalid_request"],
  [{ kind: "layer", name: "A-WALL\nold", handle: "10", selectedAll: false }, "invalid_request"],
  [{ kind: "layer", name: "A-WALL", handle: "not-a-handle", selectedAll: false }, "invalid_scope"],
  [{ kind: "layer", name: "A-WALL", handle: "10", selectedAll: "false" }, "invalid_request"],
]) {
  const test = harness();
  const invalid = await invoke(test.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "select",
      scope: { kind: "handles", handles: ["A1"] },
      catalogGuard,
      catalogScope: invalidCatalogScope,
    },
  });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.payload.code, code);
  assert.equal(test.calls.length, 0);
  assert.equal(test.snapshots.length, 0);
}

for (const [staleGuard, code] of [
  [{ instance: "DOC-OLD", revision: drawing.revision }, "document_stale"],
  [
    { instance: drawing.instance, revision: drawing.revision + 1 },
    "drawing_stale",
  ],
]) {
  const test = harness();
  const stale = await invoke(test.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "select",
      scope: { kind: "handles", handles: ["A1"] },
      catalogGuard: staleGuard,
    },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.payload.code, code);
  assert.equal(test.calls.length, 0);
  assert.equal(test.snapshots.length, 0);
}

// A matching catalog guard preserves the exact handles fast path, normalizes
// duplicate handles and resolves complete subject guards at prepare.
{
  const test = harness();
  const prepared = await invoke(test.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "select",
      scope: { kind: "handles", handle: "000a1", handles: ["A1", "b2"] },
      catalogGuard,
    },
  });
  assert.equal(prepared.status, 201);
  assert.deepEqual(prepared.payload.operation.scope.handles, ["A1", "B2"]);
  assert.equal(prepared.payload.operation.subjectCount, 2);
  assert.equal(
    test.snapshots.length,
    0,
    "handles prepare uses listOpenDocs guards without a drawing-info scan",
  );
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

// Handles apply keeps the fast path: listOpenDocs guards the operation and the
// native select call performs the final current-subject identity check.
{
  const test = harness();
  const prepared = await invoke(test.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "select",
      scope: { kind: "handles", handles: ["A1", "B2"] },
      catalogGuard,
    },
  });
  const applied = await invoke(
    test.router,
    "POST",
    applyPath(prepared.payload.operation).path,
    applyPath(prepared.payload.operation),
  );
  assert.equal(applied.status, 200);
  assert.equal(applied.payload.result.count, 2);
  assert.equal(test.snapshots.length, 0, "handles apply does not rescan drawing-info");
  assert.deepEqual(
    test.calls.map((call) => call.action),
    ["capture", "resolve", "select"],
  );
  assert.equal(test.calls[2].params.databaseRevision, drawing.revision);
  assert.equal(test.calls[2].params.activeDocumentInstance, drawing.instance);
}

// Catalog-origin handle sets carry their layer/block precondition through the
// operation hash and both native phases. selectedAll is also preserved
// so native can distinguish an exact full group from a user-selected subset.
{
  const test = harness();
  const prepared = await invoke(test.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "select",
      scope: { kind: "handles", handles: ["A1"] },
      catalogGuard,
      catalogScope: { ...layerCatalogScope, selectedAll: true },
    },
  });
  assert.equal(prepared.status, 201);
  assert.deepEqual(prepared.payload.operation.catalogScope, {
    ...layerCatalogScope,
    selectedAll: true,
  });
  assert.equal(test.calls[1].params.catalogScopeKind, "layer");
  assert.equal(test.calls[1].params.catalogScopeHandle, "10");
  assert.equal(test.calls[1].params.catalogScopeSelectedAll, 1);
  assert.equal(
    Buffer.from(String(test.calls[1].params.catalogScopeNameHex), "hex").toString("utf8"),
    "A-WALL",
  );

  const applied = await invoke(
    test.router,
    "POST",
    applyPath(prepared.payload.operation).path,
    applyPath(prepared.payload.operation),
  );
  assert.equal(applied.status, 200);
  assert.equal(test.calls[2].params.catalogScopeKind, "layer");
  assert.equal(test.calls[2].params.catalogScopeHandle, "10");
  assert.equal(test.calls[2].params.catalogScopeSelectedAll, 1);
}

// A handle that no longer belongs to its catalog layer/block is rejected by
// native at prepare, before an operation can be offered for confirmation.
{
  const test = harness({
    invoke: async (command) => {
      if (command.action !== "resolve") return nativeSuccess(command);
      return {
        ok: false,
        token: command.token,
        action: command.action,
        target: command.exactTarget,
        code: "catalog_scope_stale",
        error: "catalog_scope_stale: exact handle left its origin",
      };
    },
  });
  const stale = await invoke(test.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "select",
      scope: { kind: "handles", handles: ["A1"] },
      catalogGuard,
      catalogScope: layerCatalogScope,
    },
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.payload.code, "selection_stale");
  assert.deepEqual(test.calls.map((call) => call.action), ["capture", "resolve"]);
}

// Origin membership is checked again inside the confirmed native select. This
// closes a same-revision catalog rebase between prepare and Apply.
{
  const test = harness({
    invoke: async (command) => {
      if (command.action !== "select") return nativeSuccess(command);
      return {
        ok: false,
        token: command.token,
        action: command.action,
        target: command.exactTarget,
        code: "catalog_scope_stale",
        error: "catalog_scope_stale: complete origin handle set changed",
      };
    },
  });
  const prepared = await invoke(test.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "select",
      scope: { kind: "handles", handles: ["B2"] },
      catalogGuard,
      catalogScope: {
        kind: "block",
        name: "CHAIR",
        handle: "20",
        selectedAll: true,
      },
    },
  });
  assert.equal(prepared.status, 201);
  const stale = await invoke(
    test.router,
    "POST",
    applyPath(prepared.payload.operation).path,
    applyPath(prepared.payload.operation),
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.payload.code, "selection_stale");
  assert.equal(test.calls[2].params.catalogScopeKind, "block");
  assert.equal(test.calls[2].params.catalogScopeHandle, "20");
  assert.equal(test.calls[2].params.catalogScopeSelectedAll, 1);
}

// Even when the daemon heartbeat has not advanced yet, native performs the
// final database-revision check inside the Apply command.
{
  const test = harness({
    invoke: async (command) => {
      if (command.action !== "select") return nativeSuccess(command);
      return {
        ok: false,
        token: command.token,
        action: command.action,
        target: command.exactTarget,
        code: "drawing_stale",
        error: "drawing_stale: database revision changed",
      };
    },
  });
  const prepared = await invoke(test.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "select",
      scope: { kind: "handles", handles: ["A1"] },
      catalogGuard,
      catalogScope: layerCatalogScope,
    },
  });
  const stale = await invoke(
    test.router,
    "POST",
    applyPath(prepared.payload.operation).path,
    applyPath(prepared.payload.operation),
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.payload.code, "drawing_stale");
  assert.deepEqual(
    test.calls.map((call) => call.action),
    ["capture", "resolve", "select"],
  );
}

// The listOpenDocs revision guard still closes a handles operation before the
// mutating native call; skipping drawing-info must not weaken stale protection.
{
  const test = harness({
    listDocuments: (read) => [{
      ...drawing,
      revision: read === 1 ? drawing.revision : drawing.revision + 1,
    }],
  });
  const prepared = await invoke(test.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "select",
      scope: { kind: "handles", handles: ["A1"] },
      catalogGuard,
    },
  });
  const stale = await invoke(
    test.router,
    "POST",
    applyPath(prepared.payload.operation).path,
    applyPath(prepared.payload.operation),
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.payload.code, "drawing_stale");
  assert.equal(test.snapshots.length, 0);
  assert.deepEqual(
    test.calls.map((call) => call.action),
    ["capture", "resolve"],
    "revision stale blocks handles select before native mutation",
  );
}

// Even on the fast path, a changed subject identity is rejected from the
// native result and never reported as a successful selection.
{
  const test = harness({
    invoke: async (command) => {
      if (command.action !== "select") return nativeSuccess(command);
      return {
        ...nativeSuccess(command),
        subjects: [{
          ...baseSubjects[0],
          handle: "A1",
          type: "AcDbCircle",
        }],
        count: 1,
      };
    },
  });
  const prepared = await invoke(test.router, "POST", "/prepare", {
    body: {
      target: drawing.file,
      action: "select",
      scope: { kind: "handles", handles: ["A1"] },
      catalogGuard,
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
  assert.equal(test.snapshots.length, 0);
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

/* Chốt không gian Model/Layout.
 *
 * Ba mốc trong `cadSelection.ts` đều gọi hàm này, nên nó là chỗ duy nhất quyết
 * định "cho qua hay từ chối". Điều dễ sai nhất — và đã sai thật hai lần trong
 * cùng một lượt — là gộp "plugin bản cũ không phát trường này" với "plugin có
 * trả lời nhưng không đọc được không gian". Cả hai đều rỗng, nhưng một cái là
 * tương thích ngược, cái kia là AutoCAD không biết mình đang ở đâu. */
{
  /* Luật BẤT ĐỐI XỨNG. Đây là phần dễ sai nhất của cả chốt, và đã sai hai lần
     theo hai chiều ngược nhau. */

  // Chưa từng biết → cho qua. Ca có thật: nâng cấp daemon mà CHƯA nâng plugin.
  // Plugin cũ không phát `space` trong `/docs` nhưng VẪN phát
  // `selectionCatalog.space`, nên vế kia có giá trị. Từ chối ở đây là làm hỏng
  // mọi `select` theo phạm vi và mọi `move-to-layer` trên một cấu hình hợp lệ.
  assert.equal(spaceMismatchReason(undefined, undefined), null);
  assert.equal(spaceMismatchReason(undefined, "Model"), null);

  // Từng biết, giờ không → TỪ CHỐI. Một lần đọc hỏng, hoặc plugin bị HẠ CẤP
  // giữa lúc chuẩn bị và lúc ghi — mà plugin cũ thì cũng không tự kiểm.
  assert.ok(spaceMismatchReason("Model", undefined));

  // Trùng nhau → cho qua.
  assert.equal(spaceMismatchReason("Model", "Model"), null);
  assert.equal(spaceMismatchReason("01", "01"), null);

  // Lệch nhau → từ chối, và câu trả lời phải nói RA cả hai bên.
  const drift = spaceMismatchReason("01", "Model");
  assert.ok(drift && /Model/.test(drift) && /01/.test(drift), drift ?? "null");

  // Rỗng = KHÔNG ĐỌC ĐƯỢC, không phải tương thích ngược. Đây là nhánh
  // fail-closed; cho qua ở đây là để một lệnh ghi chạy mà không ai biết nó chạm
  // vào không gian nào.
  assert.ok(spaceMismatchReason("", "Model"));
  assert.ok(spaceMismatchReason("01", ""));
  assert.ok(spaceMismatchReason("", ""));

  /* Tài liệu NỀN không có `space` (plugin cố ý bỏ, vì đọc database
     không-current phải lock). Nơi gọi phải tự loại trừ bằng `document.active` —
     hàm này không biết gì về chuyện đó, và nếu gọi nó cho một tài liệu nền thì
     nó sẽ từ chối đúng cái lệnh `activate-document` dùng để đổi sang bản vẽ
     đang cần. Ghi lại đây vì đã sập thật một lần. */

  console.log("✓ chốt không gian: phân biệt thiếu trường với không đọc được");
}

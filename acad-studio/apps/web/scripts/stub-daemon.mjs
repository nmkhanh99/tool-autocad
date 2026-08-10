/* Daemon giả cho việc kiểm giao diện bằng tay.
 *
 * Không phải test tự động — chỉ để dựng đủ dữ liệu cho một màn hình chạy thật
 * trong trình duyệt mà không phải ghi block giả vào thư viện thật của người dùng.
 */
import { createServer } from "node:http";
import { createHash } from "node:crypto";

const PORT = 8899;

let sources = [
  { id: "s1", kind: "dwg", displayName: "Thư viện dự án", path: "/Data/Acad-Library/van.dwg" },
  { id: "s2", kind: "xtp", displayName: "Bảng công cụ cũ", path: "/Data/palette.xtp" },
];

let blocks = [
  {
    id: "b1", technicalName: "VAN_CONG_DN80", displayName: "Van cổng DN80",
    description: "Van cổng mặt bích, dùng cho tuyến cấp nước chính.",
    category: "Cấp nước", tags: ["van", "DN80"], useCases: [],
    type: "static", hasAttributes: false, attributeDefinitions: [],
    allowedSpaces: ["model"], basePoint: [0, 0, 0], units: "mm",
    defaultLayer: "MEP-PIPE", annotative: false, scales: [], syncStatus: "synced",
  },
  {
    id: "b2", technicalName: "TEE_DN100", displayName: "Tê DN100",
    description: "", category: "Cấp nước", tags: ["te"], useCases: [],
    type: "dynamic", hasAttributes: true, attributeDefinitions: [],
    allowedSpaces: ["model", "layout"], basePoint: [0, 0, 0], units: "mm",
    defaultLayer: "MEP-PIPE", annotative: false, scales: [], syncStatus: "conflict",
  },
];

const revision = () =>
  createHash("sha256").update(JSON.stringify({ blocks, sources })).digest("hex");

const send = (res, code, body) => {
  res.writeHead(code, {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
  });
  res.end(JSON.stringify(body));
};

createServer((req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;
  if (req.method === "OPTIONS") return send(res, 204, {});

  if (path === "/api/acad/status") {
    return send(res, 200, { ok: true, app: "/Applications/AutoCAD 2027.app", running: true, busy: false });
  }
  if (path === "/api/acad/docs") {
    return send(res, 200, {
      ok: true, running: true, alive: true,
      documents: [{ title: "GIA-LAP.dwg", file: "/tmp/GIA-LAP.dwg", active: true, dbmod: 0 }],
    });
  }
  if (path === "/api/acad/events") {
    res.writeHead(200, { "Content-Type": "text/event-stream", "Access-Control-Allow-Origin": "*" });
    return res.write(": stub\n\n");
  }
  let lispRoots = globalThis.__lispRoots ||= [
    { id: "r1", label: "Thư viện công ty", path: "/Data/lisp/cty" },
    { id: "r2", label: "Vendor", path: "/Data/lisp/vendor" },
  ];

  if (path === "/api/acad/lisp/roots" && req.method === "GET") {
    return send(res, 200, { ok: true, roots: lispRoots });
  }
  if (path === "/api/acad/lisp/roots" && req.method === "POST") {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    return req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      if (!String(body.path || "").startsWith("/")) {
        return send(res, 400, { ok: false, code: "invalid_root_path", error: "invalid_root_path" });
      }
      const root = {
        id: `r${lispRoots.length + 1}`,
        label: body.label || String(body.path).split("/").filter(Boolean).pop(),
        path: body.path,
      };
      globalThis.__lispRoots = [...lispRoots, root];
      return send(res, 201, { ok: true, root });
    });
  }
  if (path === "/api/acad/lisp/roots/import-autocad" && req.method === "POST") {
    const added = [{ id: "r9", label: "AutoCAD Support · support", path: "/Data/acad/support" }];
    globalThis.__lispRoots = [...lispRoots, ...added];
    return send(res, 200, { ok: true, added, skippedCount: 2 });
  }
  const lispLoad = path.match(/^\/api\/acad\/lisp\/([^/]+)\/load$/);
  if (lispLoad && req.method === "POST") {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    return req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      if (body.baseRevision !== "rev-lsp-01") {
        return send(res, 409, {
          ok: false, code: "revision_conflict", error: "revision_conflict",
        });
      }
      return send(res, 200, { ok: true, state: "done", jobId: "stub-1" });
    });
  }
  const challenge = path.match(/^\/api\/acad\/lisp\/([^/]+)\/approval-challenge$/);
  if (challenge && req.method === "POST") {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    return req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      if (!body.userProof) {
        return send(res, 403, {
          ok: false, code: "desktop_user_review_proof_required",
          error: "Chỉ thao tác review trực tiếp trong Acad Studio desktop mới được phép duyệt",
        });
      }
      globalThis.__token = "tok-" + Date.now();
      globalThis.__tokenHash = body.proposalHash;
      return send(res, 200, { ok: true, approvalToken: globalThis.__token, expiresInMs: 120000 });
    });
  }
  const manifestPut = path.match(/^\/api\/acad\/lisp\/([^/]+)\/manifest$/);
  if (manifestPut && req.method === "PUT") {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    return req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      if (body.approvalToken !== globalThis.__token || body.proposalHash !== globalThis.__tokenHash) {
        return send(res, 403, {
          ok: false, code: "user_review_challenge_required",
          error: "Token đã thiếu, hết hạn hoặc không khớp proposal",
        });
      }
      globalThis.__token = null;
      return send(res, 200, { ok: true, resource: { id: decodeURIComponent(manifestPut[1]) } });
    });
  }
  const lispOne = path.match(/^\/api\/acad\/lisp\/([^/]+)$/);
  if (lispOne && req.method === "GET") {
    const id = decodeURIComponent(lispOne[1]);
    const src = id === "LSP-03" ? null : `(defun c:CTY-SETVARS ( / )
  (setvar "OSMODE" 179)
  (setvar "DIMSCALE" 100)
  (command "_.-LAYER" "_M" "MEP-PIPE" "")
  (princ "\\nDa dat bien theo ho so tieu chuan.")
  (princ))`;
    return send(res, 200, {
      ok: true,
      resource: {
        id, manifestRevision: "rev-lsp-01",
        source: src, sourceEncoding: src ? "utf8" : null,
        baseManifest: id === "LSP-02" ? { summary: "Đặt biến bản vẽ theo hồ sơ tiêu chuẩn." } : null,
        inferred: {
          commands: ["CTY-SETVARS"], functions: [], dependencies: ["cty/common.lsp"],
          dialogs: [], cadCommands: ["-LAYER"],
          systemVariables: ["OSMODE", "DIMSCALE"], apiCalls: [], fileReferences: [],
        },
      },
    });
  }

  if (path === "/api/acad/lisp") {
    const resources = [
      {
        id: "LSP-01", name: "Gán đối tượng layer 0 sang A-WALL", extension: ".lsp",
        kind: "autolisp-source", pathLabel: "cty/layerfix.lsp", rootId: "r1",
        sizeBytes: 1840, modifiedAt: "2026-07-02T09:14:00Z",
        sourceHash: "9c1fa730be41cd52aa77e0031b6d4419aa02cf5511e7d38c9a4b1f2e6d708c33",
        readable: true, loadable: true, loadBlockReason: null,
        commands: ["CTY-LAYERFIX"], functions: ["c:cty-layerfix"], dependencies: [],
        reviewStatus: "stale",
        manifest: { summary: "cũ", review: {
          status: "approved", analysisCoverage: "full-source",
          acknowledgedIncompleteAnalysis: false, reviewedAt: "2026-05-04T02:10:00Z",
          reviewedBy: "user",
          approvedSourceHash: "1111111111111111111111111111111111111111111111111111111111111111",
        } },
        warnings: ["manifest_dependency_or_source_changed"],
      },
      {
        id: "LSP-02", name: "Đặt biến bản vẽ theo hồ sơ tiêu chuẩn", extension: ".lsp",
        kind: "autolisp-source", pathLabel: "cty/setvars.lsp", rootId: "r1",
        sizeBytes: 620, modifiedAt: "2026-06-11T04:02:00Z",
        sourceHash: "4be210dd0f7c48ab91335ce6d0aa7712bb4419aa02cf5511e7d38c9a4b1f2e6d",
        readable: true, loadable: true, loadBlockReason: null,
        commands: ["CTY-SETVARS"], functions: [], dependencies: ["cty/common.lsp"],
        reviewStatus: "approved",
        manifest: { review: {
          status: "approved", analysisCoverage: "full-source",
          acknowledgedIncompleteAnalysis: false, reviewedAt: "2026-06-12T01:00:00Z",
          reviewedBy: "user",
          approvedSourceHash: "4be210dd0f7c48ab91335ce6d0aa7712bb4419aa02cf5511e7d38c9a4b1f2e6d",
        } },
        warnings: [],
      },
      {
        id: "LSP-03", name: "Bộ công cụ nội bộ (đã biên dịch)", extension: ".vlx",
        kind: "visual-lisp-application", pathLabel: "vendor/toolkit.vlx", rootId: "r2",
        sizeBytes: 48210, modifiedAt: "2025-11-20T00:00:00Z", sourceHash: "",
        readable: false, loadable: false, loadBlockReason: "vlx_windows_only",
        commands: [], functions: [], dependencies: [],
        reviewStatus: "approved",
        manifest: { summary: "vendor", review: {
          status: "approved", analysisCoverage: "metadata-only",
          acknowledgedIncompleteAnalysis: true, reviewedAt: "2025-12-01T08:30:00Z",
          reviewedBy: "user", approvedSourceHash: "",
        } },
        warnings: ["compiled_source_not_readable", "vlx_windows_only"],
      },
    ];
    return send(res, 200, {
      ok: true,
      resources,
      roots: lispRoots,
      counts: { total: 3, readable: 2, loadable: 2, reviewed: 1, needsReview: 2 },
      truncated: false,
      scanWarnings: [],
    });
  }

  if (path === "/api/acad/blocks/sources" && req.method === "GET") {
    return send(res, 200, { ok: true, revision: revision(), sources });
  }
  if (path === "/api/acad/blocks/sources" && req.method === "POST") {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    return req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      if (body.expectedRevision !== revision()) {
        return send(res, 409, { ok: false, error: "Block library đã thay đổi; hãy tải lại trước khi lưu." });
      }
      sources = [...sources, { id: `s${sources.length + 1}`, ...body.source }];
      return send(res, 201, { ok: true, revision: revision(), blocks, sources });
    });
  }
  if (path === "/api/acad/blocks/create" && req.method === "POST") {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    return req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      if (body.expectedRevision !== revision()) {
        return send(res, 409, { ok: false, error: "Thư viện đã thay đổi; hãy tải lại trước khi tạo block." });
      }
      if (process.env.NO_SELECTION === "1") {
        return send(res, 400, { ok: false, error: "Hãy chọn hình/ATTDEF trong AutoCAD trước khi bấm Tạo block." });
      }
      const created = { ...body.block, id: `b${blocks.length + 1}`, syncStatus: "synced" };
      blocks = [...blocks, created];
      return send(res, 201, {
        ok: true, revision: revision(), blocks, sources, block: created,
        hint: "stub: coi như đã tạo định nghĩa từ bộ chọn.",
      });
    });
  }
  if (path === "/api/acad/blocks" && req.method === "GET") {
    return send(res, 200, { ok: true, revision: revision(), blocks, sources });
  }

  // POST /api/acad/blocks/insert — không làm gì thật, chỉ để nơi gọi tải lại danh mục
  if (path === "/api/acad/blocks/insert" && req.method === "POST") {
    return send(res, 200, { ok: true, hint: "stub: coi như đã chèn." });
  }

  // PUT /api/acad/blocks/:id — bắt chước router thật: synced + metadata đổi → outdated
  const put = path.match(/^\/api\/acad\/blocks\/([^/]+)$/);
  if (put && req.method === "PUT") {
    let raw = "";
    req.on("data", (chunk) => { raw += chunk; });
    return req.on("end", () => {
      const body = JSON.parse(raw || "{}");
      // Ép 409 một lần để kiểm đường thoát: đặt CONFLICT_ONCE=1 khi chạy stub.
      if (process.env.CONFLICT_ONCE === "1" && !global.__conflicted) {
        global.__conflicted = true;
        return send(res, 409, { ok: false, error: "Block library đã thay đổi; hãy tải lại trước khi lưu." });
      }
      if (body.expectedRevision !== revision()) {
        return send(res, 409, { ok: false, error: "Block library đã thay đổi; hãy tải lại trước khi lưu." });
      }
      const id = decodeURIComponent(put[1]);
      const index = blocks.findIndex((b) => b.id === id);
      if (index < 0) return send(res, 404, { ok: false, error: "Không có block đó" });
      const previous = blocks[index];
      const incoming = { ...previous, ...body.block, id, syncStatus: previous.syncStatus };
      // Bắt chước `sanitizeBlockDefinition` của daemon thật: cắt khoảng trắng.
      const next = { ...incoming, displayName: String(incoming.displayName).trim() };
      const changed = JSON.stringify({ ...previous, syncStatus: 0 }) !== JSON.stringify({ ...next, syncStatus: 0 });
      if (previous.syncStatus === "synced" && changed) next.syncStatus = "outdated";
      blocks = blocks.map((b, i) => (i === index ? next : b));
      return send(res, 200, { ok: true, revision: revision(), blocks, sources });
    });
  }

  return send(res, 404, { ok: false, error: `stub không có route ${req.method} ${path}` });
}).listen(PORT, "127.0.0.1", () => console.log(`stub daemon :${PORT}`));

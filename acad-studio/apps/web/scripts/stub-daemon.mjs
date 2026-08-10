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

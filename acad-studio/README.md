# Acad Studio

Shell UI/desktop cho **AutoCAD Toolkit** (3 cột: Offline · ACAD Control · ObjectARX).  
Stack: Next.js + Electron + Express daemon + SQLite. Chat agent local (Claude / Codex / Grok)
gọi `/api/acad/*`, `app/cli.py`, và bridge `~/Acad-Bridge/` — domain-agnostic; plumbing chỉ là profile mẫu.

## Stack

| Tầng | Công nghệ | Thư mục |
|---|---|---|
| Frontend | **Next.js 16 App Router + React 19 + TS** | `apps/web` |
| Daemon | **Node 24 · Express · SSE streaming · SQLite** (`node:sqlite`) | `apps/daemon` |
| Desktop | **Electron 33** shell nạp UI web, quản lý vòng đời | `apps/desktop` |
| MCP | **SDK v2 · stdio · 8 tools / 72 names (71 implemented)** | `apps/mcp` |
| Lifecycle | **1 entrypoint** `pnpm tools-dev` | `scripts/tools-dev.mjs` |

> Ghi chú: bảng gốc Open Design ghi `better-sqlite3`; ở đây dùng **`node:sqlite`** built-in của
> Node 24 — cùng engine SQLite, không cần build native (tránh xung đột ABI với Electron).

## Chạy

```bash
cd acad-studio
pnpm install          # lần đầu
pnpm tools-dev        # dựng daemon + web + mở cửa sổ app
```

- `pnpm tools-dev` — full app desktop (cửa sổ Electron).
- `pnpm tools-dev web` — chỉ daemon + web, mở trong trình duyệt (không cần Electron).
- `pnpm mcp` — MCP stdio adapter; cấu hình client và capability matrix tại
  [`MCP.md`](MCP.md).
- Đóng cửa sổ hoặc Ctrl+C ở terminal → tắt sạch cả 3 tiến trình.

Yêu cầu: có ít nhất một CLI agent trên PATH — `claude`, `codex`, hoặc `grok`.

### Demo vẽ thật bản vẽ T1

```bash
npx tsx scripts/draw-demo.mjs --list          # 35 prompt của kịch bản
npx tsx scripts/draw-demo.mjs --interactive   # vẽ thật, xác nhận từng bước
```

Dựng lại bản vẽ thoát nước tầng 1 bằng AcCoreConsole (không cần mở AutoCAD GUI),
theo vòng lặp *yêu cầu → vẽ (preview) → xác nhận → áp dụng*.
Chi tiết: [DRAW-T1-REAL.md](DRAW-T1-REAL.md).

## Kiến trúc luồng

```
apps/web (Next.js)  ──fetch POST /api/chat (SSE)──►  apps/daemon (Express)
   khung chat, sidebar lịch sử          │  spawn claude/codex/grok headless
   đọc /api/agents, /api/conversations   │  cwd = thư mục tool-autocad
        ▲                                 │  parser → event chuẩn hoá → SSE
        └───────── stream event ──────────┘  lưu hội thoại vào SQLite
apps/desktop (Electron) bọc apps/web thành cửa sổ native.
```

**Daemon endpoints** (`http://127.0.0.1:8788`):
- `GET /api/agents` — CLI nào đã cài.
- `POST /api/chat` — SSE; body `{agent, message, sessionId?, conversationId?}`; event
  `{kind: conversation|session|thinking|text|tool|log|done|error|end}`.
- `GET /api/conversations`, `GET /api/conversations/:id/messages` — lịch sử (SQLite).
- `POST /api/acad/*` — **điều khiển AutoCAD for Mac** (headless/batch/live). Xem
  [`ACAD-CONTROL.md`](ACAD-CONTROL.md). Đã verify: đọc + **sửa bản vẽ thật** (KHBV,
  layer, entity) không cần mở GUI, và điều khiển được ngay từ khung chat.
- `GET /api/acad/drawing-info?target=...` — snapshot ObjectARX **chỉ đọc** của đúng
  bản vẽ đang mở; bỏ `target` để lấy document active. Nút **Hồ sơ bản vẽ** hiển thị
  metadata, entity/layer/block/layout/xref/style/selection và dữ liệu thô.
- `GET/POST /api/acad/blocks/*` — panel **Thư viện block** quản lý catalog, nguồn
  DWG/ảnh/XTP và các luồng scan/create/insert/sync metadata; duplicate chỉ được báo cáo,
  không tự replace. Xem kiến trúc và giới hạn MVP tại [`BLOCK-LIBRARY.md`](BLOCK-LIBRARY.md).
- `GET /api/acad/standards/profiles`, `POST /scan`, `POST /apply`, `POST /action` —
  panel **Chuẩn hóa** quản lý mẫu A3/unit/DIM/layer/mapping; quét read-only, cho tick/bỏ
  DIM lệch rồi mới chạy DIMSPACE hoặc các thao tác scale/rotate/color/layer/area.
- `GET /api/acad/lisp` và `GET /api/acad/lisp/:id` — catalog + source/metadata của
  `.lsp`, `.mnl`, `.fas`, `.vlx`, `.dcl`, `.scr`. Nút **Thư viện AutoCAD** cho phép
  tìm kiếm, thêm thư mục, xem source/config, chọn đúng DWG và load có xác nhận.
- `PUT /api/acad/lisp/:id/manifest` — chỉ được gọi khi user bấm duyệt proposal của
  agent. Source/config đổi revision sẽ bị từ chối; duyệt config không tự load Lisp.
- `POST /api/acad/lisp/:id/load` — stage + kiểm lại hash, giữ đúng dependency/Support
  Path và gửi qua FIFO vào đúng document title/path; plugin không fallback sang DWG active khác.
- Base manifest cho tài nguyên của repo: `../acad-lisp/library.manifest.json`. Root
  tùy chỉnh và override đã duyệt nằm trong `ACAD_DATA_DIR`, không ghi đè source Lisp.
- Resource ngoài base manifest nhận cấu hình tự suy ra ở trạng thái chưa duyệt. Lượt agent
  review dùng source nhúng, không có tool, chạy ở thư mục tạm; UI bắt xem diff/manifest và
  xác nhận riêng. Quyết định từ chối được lưu trong SQLite.

Daemon chỉ chấp nhận browser Origin của UI Electron/cổng dev; CLI local không gửi `Origin`
vẫn dùng được. Đây là ranh giới bắt buộc vì các endpoint live có thể chạy code trong AutoCAD.

**Registry agent** (`apps/daemon/src/agents.ts`): mỗi agent có `buildArgs()` (câu lệnh
headless) + `parse()` (chuẩn hoá JSONL) — mô phỏng `runtimes/defs/*` của Open Design.
Vai trò trợ lý ở system prompt (`MEP_PROMPT` / agents.ts — generic AutoCAD toolkit).

## Dữ liệu

SQLite tại `~/Library/Application Support/acad-studio/acad.sqlite` (đổi bằng `ACAD_DATA_DIR`).

## Đóng gói thành .app / .dmg cài đặt được

```bash
pnpm package
```

Chạy `scripts/package.mjs`: (1) Next static export → `apps/web/out`, (2) bundle daemon
1 file bằng esbuild → `apps/desktop/build/daemon.cjs`, (3) copy `sql-wasm.wasm` + UI tĩnh,
(4) electron-builder. Kết quả trong **`apps/desktop/dist/`**:
- `Acad Studio.app` — app tự chứa (double-click chạy; tự spawn daemon phục vụ UI + API).
- `Acad Studio-0.1.0.dmg` — bộ cài (kéo app vào Applications).

Trong bản đóng gói:
- Daemon chạy bằng **Node của Electron** (`ELECTRON_RUN_AS_NODE`), phục vụ UI tĩnh + `/api` ở
  cùng cổng 8788 → không cần Next server.
- Storage **sql.js (WASM)** → không phụ thuộc phiên bản Node/Electron.
- **Thư mục dự án** mà agent thao tác: mặc định `~/Desktop/tool-autocad` (đổi bằng
  `ACAD_PROJECT_ROOT`). Dữ liệu lịch sử ở `~/Library/Application Support/Acad Studio/`.
- Bộ `acad-lisp`, các Lisp trích xuất dưới `acad-studio/scripts/extract` và manifest
  cơ sở được đóng gói trong app; thư viện vẫn quét thêm project, thư mục hỗ trợ
  Autodesk và các root do user chọn.
- App **chưa ký (unsigned)**: lần đầu mở có thể phải chuột phải → *Open* (Gatekeeper).

## Bước sau

- Ký (code sign) + notarize để chia sẻ máy khác không bị Gatekeeper chặn; thêm icon `.icns`.
- Cho người dùng **chọn thư mục dự án** trong app (thay cho mặc định cứng).
- Bổ sung PATH đầy đủ khi mở từ Finder để nhận cả `codex` (`~/.nvm/...`).
- Preview file/Excel agent tạo; chọn model trong mỗi agent.

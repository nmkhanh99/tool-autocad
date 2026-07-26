# AutoCAD Toolkit

Domain-agnostic toolkit for reading, analyzing, and editing AutoCAD drawings on macOS — **three equal columns**, not a plumbing/MEP product.

```
                    ┌─────────────────────────────┐
                    │  UI / Agent / CLI (shell)    │
                    │  acad-studio · cli · chat     │
                    └──────────────┬──────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
     ┌────────────────┐  ┌─────────────────┐  ┌──────────────────┐
     │ A. OFFLINE CORE│  │ B. ACAD CONTROL │  │ C. OBJECTARX     │
     │ app/acadtool   │  │ daemon /api/acad│  │ objectarx/*.bundle│
     │ ODA/ezdxf/     │  │ AcCoreConsole   │  │ in-process CAD   │
     │ LibreDWG       │  │ + job file LISP │  │ watch + raw ops  │
     └────────────────┘  └────────┬────────┘  └────────┬─────────┘
                                  │                    │
                                  ▼                    ▼
                         ┌────────────────────────────────────┐
                         │         AutoCAD (session)          │
                         │  headless DWG đóng · live DWG mở   │
                         │  acad-lisp · AcadBridge plugin     │
                         └────────────────────────────────────┘
                                  ▲
                                  │ shared contract
                         ~/Acad-Bridge/
                         job.lsp · raw.job · results/ · docs.*
```

## Three columns (peers)

| Column | Path | Role |
|--------|------|------|
| **A. Offline core** | `app/acadtool`, `app/cli.py` | Inventory, layers, title, takeoff without AutoCAD open (ODA / ezdxf / LibreDWG) |
| **B. ACAD Control** | `acad-studio/apps/daemon` → `/api/acad/*` | AcCoreConsole **headless/batch** on closed DWG; **live job** LISP into open session |
| **C. ObjectARX** | `objectarx/` → **AcadBridge** | In-process Mac plugin: FSEvents watch `job.lsp` + **raw.job** catalog (no Accessibility) |

Plumbing / drainage samples may remain under `acad-lisp/mep.lsp` and `acad-lisp/profiles/plumbing.lsp` — they are **profiles**, not product identity.

## Shared bridge contract

| File | Purpose |
|------|---------|
| `~/Acad-Bridge/job.lsp` | Live LISP job (atomic write: temp + rename) |
| `~/Acad-Bridge/raw.job` → `raw.done` | ObjectARX raw capability invoke |
| `~/Acad-Bridge/results/<id>.txt` | Job result (`status=` + `==end==`) |
| `docs.req` / `docs.json` | Open documents + plugin heartbeat |
| `native.job` / `native.done` | Native C++ entity ops (optional) |

**Legacy aliases (one release):** `~/MEP-Bridge/`, `mep_job.lsp`, env `MEP_BRIDGE_DIR`. Prefer `ACAD_BRIDGE_DIR` and `~/Acad-Bridge/`.

## Quick start

```bash
# Offline inventory (no CAD)
cd app && python3 cli.py info /path/to/drawing.dwg

# Daemon control plane
cd acad-studio && pnpm install
cd apps/daemon && pnpm start   # http://127.0.0.1:8788/api/acad/*

# Build ObjectARX plugin (needs ObjectARX 2027 Mac SDK + AutoCAD 2027)
cd objectarx && bash build.sh
# → ApplicationPlugins/Acad-Bridge.bundle  (APPLOAD path printed)
```

### API (control plane)

```
GET  /api/acad/status
GET  /api/acad/drawing-info?target=...  # snapshot read-only; bỏ target = bản vẽ active
GET  /api/acad/lisp                    # catalog LSP/MNL/FAS/VLX/DCL/SCR
GET  /api/acad/lisp/:id                # source/metadata + manifest AI
PUT  /api/acad/lisp/:id/manifest       # user duyệt cấu hình agent đề xuất
POST /api/acad/lisp/:id/load           # nạp artifact đúng revision vào đúng DWG đang mở
POST /api/acad/headless   { script, dwg?, timeoutMs? }
POST /api/acad/batch      { script, dwgs[], timeoutMs? }
POST /api/acad/job        { lisp, wait?, target? }
POST /api/acad/open       { path? }
GET  /api/acad/raw/catalog
POST /api/acad/raw/invoke { id, params?, target?, dryRun? }
```

Payloads are pure LISP/script or generic ops — not hard-coded plumbing entity types in the control plane.

The **AutoCAD Library** panel scans the project, AutoCAD installation/user support folders,
and user-added folders. Text formats (`.lsp`, `.mnl`, `.dcl`, `.scr`) are readable;
compiled `.fas`/`.vlx` files expose metadata and hash only. DCL is a Lisp dependency, and
VLX loading is Windows-only. Agents may propose a per-resource manifest, but only an explicit
user review writes the approved configuration; approval never loads code by itself. Every
discovered resource gets a deterministic unreviewed baseline (commands, functions, dependencies,
dialogs, called CAD commands, system variables, Visual LISP APIs and file references). Agent
review runs without tools in an isolated temporary workspace, and approval is bound to the exact
resource hash/revision.

Live jobs share one FIFO transport. AcadBridge snapshots `job.lsp` before asynchronous execution;
library artifacts/dependencies are staged and re-hashed before load. Dependency preloading is
opt-in with `preload: true`; otherwise the resource controls its own load order through the staged
Support Path. The loopback daemon rejects browser origins outside the packaged/dev UI allowlist.

## Docs

- [ACAD Control](acad-studio/ACAD-CONTROL.md) — headless / batch / live
- [ObjectARX capabilities](acad-studio/OBJECTARX-CAPABILITIES.md)
- [Bridge LISP](acad-lisp/BRIDGE.md)
- [ObjectARX NOTES](objectarx/NOTES.md) — SDK install + build

## North star

1. **No CAD open** → offline inventory + proposed edits  
2. **CAD headless or live** → apply via AcCoreConsole or AcadBridge on **any** DWG  

Bridge and plugin names are **Acad-Bridge / AcadBridge**, not MEP.

## Repository layout (after clean)

| Path | Column / role |
|------|----------------|
| `app/` | A — Offline core |
| `acad-studio/` | Shell UI + daemon `/api/acad/*` (B control plane) |
| `objectarx/` | C — AcadBridge plugin sources + build |
| `acad-lisp/` | Job payloads / core + optional plumbing profile samples |
| `As-built drawing/` | Optional sample DWGs for local demos (not product identity) |

**Removed from product tree (not toolkit columns):** vendored `open-design-main/`, BIM installer `.exe`, unrelated root notes/media.

Shell packages: `@acad/daemon`, `@acad/web`, `@acad/desktop` (product **Acad Studio**).

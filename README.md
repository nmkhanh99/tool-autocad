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
POST /api/acad/headless   { script, dwg?, timeoutMs? }
POST /api/acad/batch      { script, dwgs[], timeoutMs? }
POST /api/acad/job        { lisp, wait?, target? }
POST /api/acad/open       { path? }
GET  /api/acad/raw/catalog
POST /api/acad/raw/invoke { id, params?, target?, dryRun? }
```

Payloads are pure LISP/script or generic ops — not hard-coded plumbing entity types in the control plane.

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

# AutoCAD MCP

`apps/mcp` exposes the reference project's eight consolidated MCP tools while
reusing Acad Studio's existing macOS control plane:

```text
MCP client ──stdio──> apps/mcp ──loopback HTTP──> apps/daemon
                                                ├─ AcCoreConsole (create/headless)
                                                └─ AcadBridge (open DWG/live jobs)
```

The adapter does not write `~/Acad-Bridge/job.lsp` itself. The daemon remains
the single owner of document routing and the serialized live-job queue.

## Start and configure

```bash
cd /Users/khanhnm/Desktop/tool-autocad/acad-studio
pnpm install
pnpm mcp
```

For an MCP client, launch the TypeScript entry directly so package-manager
status text can never enter the stdio protocol:

```json
{
  "mcpServers": {
    "autocad": {
      "command": "/Users/khanhnm/Desktop/tool-autocad/acad-studio/apps/mcp/node_modules/.bin/tsx",
      "args": [
        "/Users/khanhnm/Desktop/tool-autocad/acad-studio/apps/mcp/src/index.ts"
      ],
      "env": {
        "ACAD_PROJECT_ROOT": "/Users/khanhnm/Desktop/tool-autocad",
        "ACAD_DAEMON_URL": "http://127.0.0.1:8788",
        "ACAD_MCP_AUTOSTART_DAEMON": "1",
        "ACAD_SCREENSHOT_PYTHON": "/Library/Frameworks/Python.framework/Versions/Current/bin/python3"
      }
    }
  }
}
```

The adapter can start a detached loopback daemon when none is running. Set
`ACAD_MCP_AUTOSTART_DAEMON=0` when Acad Studio/Desktop manages that process.

## Base contract

The server registers exactly eight tools and retains all 72 reference operation
names.

| Tool | Operations |
|---|---:|
| `drawing` | 10 |
| `entity` | 21 |
| `layer` | 8 |
| `block` | 6 |
| `annotation` | 6 |
| `pid` | 12 |
| `view` | 3 |
| `system` | 6 |

The adapter implements 71 of the 72 names. `drawing.plot_pdf` remains an
explicit `supported: false`: a trustworthy live plot needs an exact layout,
named page setup, installed PDF device/media, serialized native plot engine,
temporary output, and PDF postcondition. The reference project's macOS backend
also leaves this operation unsupported; its alternate IPC recipe hard-codes a
Windows plot profile and does not check that a PDF was created.

The formerly ambiguous operations use bounded, deterministic extensions:

- `entity.offset`: `data.distance > 0` and
  `data.side_point: [x, y] | [x, y, z]`. The side point is mandatory; distance
  alone cannot select which side of an entity to offset.
- `entity.array`: positive integer `rows`/`cols`, finite `row_dist`/`col_dist`,
  at most 10,000 cells. It keeps the source at row 0/column 0 and makes the
  remaining copies with explicit displacements.
- `block.define`: `data.name` plus at most 256 `data.entities`. Recipes are
  strictly limited to `LINE`, `CIRCLE`, and `ATTDEF`; unknown recipes, invalid
  names, duplicate definitions, and invalid dimensions fail explicitly.
- `view.get_screenshot`: captures the currently visible AutoCAD window on
  macOS and returns both JSON metadata and MCP `ImageContent` (`image/png`).
  When `target` is supplied it must be the active visible drawing, preventing a
  screenshot of the wrong tab. Other tools can set `include_screenshot: true`;
  the primary operation still succeeds with a warning if capture is denied.

Window capture uses Quartz window discovery plus macOS `screencapture`. The
Python selected by `ACAD_SCREENSHOT_PYTHON` (default: the framework `Current`
Python when installed, then `python3`) must import PyObjC `Quartz`, and the host
running MCP may need Screen & System Audio Recording permission.

P&ID insert operations currently create clearly labelled generic geometry.
Their built-in catalog is a fallback, not a claim that CTO blocks are installed.

## Safe routing

- Every live mutation requires `target`.
- A title is accepted only when it identifies one open document.
- The adapter resolves a title to its canonical full path before queuing work.
- Missing, stale, and duplicate targets fail before they can occupy the live-job
  queue.
- `drawing.create` refuses to overwrite an existing file.
- If AcCoreConsole times out after writing a DWG, create returns
  `create_uncertain` with the exact orphan path and tells the caller not to
  retry that path.
- `drawing.open` and `drawing.create(open=true)` return success only after
  AcadBridge reports the exact full path in the open-document list; a successful
  LaunchServices handoff alone is not treated as proof.
- A live job that exceeds the synchronous wait is returned as
  `ok: true, payload.completed: false` with its `jobId`, because AutoCAD may
  still apply it. Do not retry it. Reconcile with
  `system(operation="status", data={"job_id":"…" })`.
- `system.execute_lisp` is an intentional raw escape hatch. It requires a target
  but does not pass through the safe AutoLISP builders.

Call `system` with `operation: "status"` to inspect open documents and the
per-operation capability matrix.

## Tests

```bash
cd /Users/khanhnm/Desktop/tool-autocad/acad-studio

# TypeScript, AutoLISP builders, backend guards, and real MCP stdio handshake
pnpm test:mcp

# Real AutoCAD 2027 + AcadBridge test on a new ignored .work DWG
ACAD_RUN_LIVE_E2E=1 pnpm test:mcp:live
```

The live test creates and opens a new disposable DWG, then verifies entity
offset/array, block definition plus attributes, P&ID placeholder geometry,
queries, zoom, a real PNG MCP image response, and save against AutoCAD 2027 on
macOS. It never overwrites a drawing and leaves the DWG under
`acad-studio/.work/` for inspection.

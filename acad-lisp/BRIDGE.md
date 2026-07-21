# Cầu nối: App ngoài ⇄ AutoCAD (domain-agnostic)

App (UI/daemon/CLI) lo inventory, form, batch. AutoCAD lo vẽ/sửa trong session.  
Hai bên nói chuyện qua **file** trong `~/Acad-Bridge/` — Mac & Win.

```
App / daemon (/api/acad/*)                 AutoCAD (bản vẽ đang mở)
─────────────────────────                  ────────────────────────
POST /api/acad/job
   │
   ▼
Ghi  ~/Acad-Bridge/job.lsp  ────────────►  AcadBridge plugin (FSEvents)
     atomic temp+rename                    → sendStringToExecute (load)
                                           hoặc gõ ACAD-RUN
```

## File contract

| File | Mô tả |
|------|--------|
| `job.lsp` | Job LISP live (primary) |
| `mep_job.lsp` | Legacy alias (một release) |
| `results/<id>.txt` | Kết quả + sentinel `==end==` |
| `raw.job` / `raw.done` | ObjectARX raw (không LISP) |

Env: `ACAD_BRIDGE_DIR` (ưu tiên) hoặc `MEP_BRIDGE_DIR`.  
Legacy dir: `~/MEP-Bridge/` nếu primary chưa tồn tại.

## Lệnh LISP

| Lệnh | Vai trò |
|------|---------|
| `ACAD-RUN` | Load `job.lsp` (primary) |
| `MEP-RUN` / `MR` | Alias → `ACAD-RUN` |
| `ACAD-INIT` | Layer base (core.lsp) |
| `MEP-INIT` … | Profile plumbing (`mep.lsp` / `profiles/plumbing.lsp`) — sample only |

Core: `acad-lisp/core.lsp`  
Profile mẫu: `acad-lisp/profiles/plumbing.lsp` → load `mep.lsp`

## Headless (cột B, không GUI)

Daemon: `POST /api/acad/headless` / `batch` với AcCoreConsole + script.  
Lib: `headless/acad_lib.lsp` (generic), `headless/mep_lib.lsp` (helpers sample).

## ObjectARX (cột C)

Plugin **AcadBridge** (`Acad-Bridge.bundle`) watch `job.lsp` + `raw.job`.  
Lệnh CAD: `ACADARX`, `ACADRAW`, `ACADDOCS`, `ACADWATCH` (legacy `MEP*` vẫn đăng ký).

# Điều khiển AutoCAD (AutoCAD Toolkit / macOS)

Tổng hợp từ khảo sát + **đã kiểm chứng** trên AutoCAD 2027 for Mac.
Daemon expose API tại `http://127.0.0.1:8788/api/acad/*`.

Kiến trúc toolkit = **3 cột ngang**: Offline core · **ACAD Control** (tài liệu này) · ObjectARX (AcadBridge).  
MEP/plumbing chỉ là profile mẫu, không phải identity sản phẩm.

## Điều khiển được gì — bản đồ kênh

| Kênh | Cơ chế | Điều khiển được gì | Tin cậy | Quyền cần |
|---|---|---|---|---|
| **Headless** ⭐ | `AcCoreConsole` (Helpers/) + script LISP trên DWG **đóng** | Entity, layer, ATTRIB, PURGE, SAVEAS, PDF | **Cao — đã verify** | Không |
| **Batch** ⭐ | Headless lặp nhiều file | Chuẩn hóa cả bộ bản vẽ | **Cao — đã verify** | Không |
| **Live (job)** | Ghi `~/Acad-Bridge/job.lsp` → **AcadBridge** FSEvents `(load)` đúng document | AutoLISP trong session đang mở | Cao (plugin) / TB (keystroke fallback) | Plugin; Accessibility chỉ fallback |
| **Open** | `open -a` | Mở AutoCAD / DWG | Cao | Không |
| Keystroke | System Events | Fallback khi chưa có plugin | Thấp | Accessibility |

**KHÔNG khả thi trên Mac:** .NET/COM/ActiveX, AppleScript dictionary, URL scheme, JS API.

## Hợp đồng file `~/Acad-Bridge/`

| File | Vai trò |
|------|---------|
| `job.lsp` | Live LISP job (ghi atomic temp+rename) |
| `raw.job` / `raw.done` | ObjectARX raw catalog |
| `results/<jobId>.txt` | Kết quả job (`status=` … `==end==`) |
| `docs.req` / `docs.json` | Heartbeat + danh sách bản vẽ mở |
| `job_target.txt` | Document đích (tuỳ chọn) |

Legacy (một release): `~/MEP-Bridge/`, `mep_job.lsp`, env `MEP_BRIDGE_DIR`.  
Env ưu tiên: `ACAD_BRIDGE_DIR`.

## API

```
GET  /api/acad/status
     → { app, running, coreConsole, bridgeDir, activeJob }

POST /api/acad/headless   { script: "<AutoLISP/lệnh>", dwg?: "/abs/path.dwg", timeoutMs? }
     → { ok, exit, output }

POST /api/acad/batch      { script, dwgs: ["/abs/a.dwg", …], timeoutMs? }
     → { count, ok, results:[{dwg,ok,exit,tail}] }

POST /api/acad/open       { path?: "/abs/ban-ve.dwg" }
POST /api/acad/job        { lisp: "<AutoLISP>", wait?, target? }
     → { jobId, state, result }   # lisp có (acad:write-result "ok" <str>) / alias mep:write-result
GET  /api/acad/job/:id

GET  /api/acad/raw/catalog
POST /api/acad/raw/invoke { id, params?, target?, dryRun? }

POST /api/acad/keystroke  { text }   # fallback only
```

Payload = LISP/script thuần hoặc op generic (title, layer, raw catalog) — **không** hardcode `mep-pipe` / `ME-TN-*` trong control plane.

## Live job (plugin)

1. Cài **Acad-Bridge.bundle** (`objectarx/build.sh` → ApplicationPlugins / ApplicationAddins).
2. Mở bản vẽ trong AutoCAD 2027.
3. `POST /api/acad/job` → daemon ghi `job.lsp` atomic → plugin load (~0.3s).
4. Nếu chưa có plugin: gõ `ACAD-RUN` (alias `MEP-RUN`) hoặc keystroke fallback.

## Lưu ý headless

- Đường dẫn tuyệt đối; dialog-alternative (`-LAYER`, `-PURGE`).
- Sửa file kết thúc bằng `(command "_.SAVEAS" "2018" "/abs/out.dwg")`.
- Lib: `acad-lisp/headless/acad_lib.lsp` (generic) / `mep_lib.lsp` (sample plumbing helpers).

## Liên quan

- ObjectARX: `OBJECTARX-CAPABILITIES.md`, `objectarx/NOTES.md`
- LISP bridge: `acad-lisp/BRIDGE.md`, `acad-lisp/core.lsp`
- Offline: `app/cli.py` (`info`, `bom`, …)

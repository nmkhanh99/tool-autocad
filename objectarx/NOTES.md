# Ghi chú build ObjectARX AcadBridge

## Product identity

| Item | Primary | Legacy alias |
|------|---------|--------------|
| Bridge dir | `~/Acad-Bridge/` | `~/MEP-Bridge/` |
| Live job | `job.lsp` | `mep_job.lsp` |
| Bundle | `Acad-Bridge.bundle` | `MEP-Bridge.bundle` |
| Binary | `AcadBridge` | `MepBridge` |
| Commands | `ACADARX`, `ACADRAW`, … | `MEPARX`, `MEPRAW`, … |

## Prereqs
## Việc user PHẢI tự làm trước khi build

**1. Tải ObjectARX 2027 macOS SDK**
- https://aps.autodesk.com/developer/overview/objectarx-autocad-sdk → licensing → macOS **2027**
- Headers: `/Library/Developer/Autodesk/ObjectARX 2027/inc/`
- Gói macOS chỉ có `inc/` — link dylib từ `AutoCAD 2027.app/Contents/Frameworks`

**2. Đối chiếu** `inc/prj_arx.xcconfig` với `build.sh` DEFINES/LDLIBS nếu build lỗi.

**3.** Command Line Tools clang đủ; không bắt buộc full Xcode.

**4.** FSEvents/CoreServices có sẵn trên macOS.

## Build & install

```bash
cd objectarx
bash build.sh
# → build/Acad-Bridge.bundle
# → ~/Library/Application Support/Autodesk/ApplicationPlugins/Acad-Bridge.bundle
# → ApplicationAddins/Acad-Bridge.bundle
```

APPLOAD path = outer package `.bundle` (flat ARX, `acrxEntryPoint` trên package binary).

## Integration (daemon)

Chỉ cần ghi **atomic** `~/Acad-Bridge/job.lsp` (temp + rename).  
Plugin watch mtime → `(load)` đúng document (`job_target.txt` optional).  
Result: `results/<jobId>.txt` + `==end==` (daemon `pollResult`).

Raw: ghi `raw.job` → `raw.done` JSON.  
Daemon: `GET /api/acad/raw/catalog`, `POST /api/acad/raw/invoke`.

### Atomic write (daemon)

```ts
import { atomicWriteFile, jobLspPath, resolveBridgeDir } from "./bridgeContract.js";
atomicWriteFile(jobLspPath(resolveBridgeDir()), wrapJob(id, lisp));
```

## Core path rules

- Core watch/load **không** hardcode plumbing layer/pipe rules.
- Domain vẽ ống = LISP profile / sample native.job `PIPE` lines — optional.
- Sample preview layer `MEP-PREVIEW` may remain for demos only.

## Risks

1. SDK 2027 may be absent in CI — then structural + unit tests are the bar.
2. FSEvents main queue only — never call ObjectARX from background threads.
3. AutoCAD 2027 not binary-compatible with 2026/2025.
4. Debounce by mtime nano + atomic rename prevents double-run.
5. Job already present at AutoCAD start is **not** auto-run (init lastMtime) — write a new job or type `ACADARX`.

# Điều khiển AutoCAD từ MEP Studio (macOS)

Tổng hợp từ khảo sát + **đã kiểm chứng chạy thật** trên AutoCAD 2027 for Mac (máy này).
Daemon expose API tại `http://127.0.0.1:8788/api/acad/*`.

## Điều khiển được gì — bản đồ kênh

| Kênh | Cơ chế | Điều khiển được gì | Tin cậy | Quyền cần |
|---|---|---|---|---|
| **Headless** ⭐ | `AcCoreConsole` (có sẵn trong AutoCAD 2027 for Mac, `Contents/Helpers/`) chạy `.scr`/AutoLISP trên DWG **đóng** | Đọc/sửa **mọi thứ** trong bản vẽ: entity, layer, block, **ATTRIB khung tên**, đo/đếm, vẽ thêm, PURGE, AUDIT, **SAVEAS**, xuất DWG/DXF/PDF | **Cao — đã verify** | Không |
| **Batch** ⭐ | Headless lặp trên nhiều file | Áp 1 thao tác cho **cả bộ bản vẽ** (vd sửa KHBV toàn bộ 9 file) | **Cao — đã verify** | Không |
| **Live (job)** | Ghi `~/MEP-Bridge/mep_job.lsp` → gõ `(load …)` vào command line qua System Events | Chạy AutoLISP trong **session đang mở** (vẽ ống realtime, điền khung tên bản vẽ đang xem) | Trung bình | **Accessibility** |
| **Open** | `open -a` | Mở AutoCAD / mở 1 bản vẽ trong GUI | Cao | Không |
| Keystroke | System Events gõ phím | Bơm lệnh bất kỳ (fallback) | Thấp (phụ thuộc focus) | **Accessibility** |

**KHÔNG khả thi trên Mac:** .NET/COM/ActiveX, AppleScript scripting dictionary (không có),
URL scheme, JavaScript API. (ObjectARX C++ có SDK Mac nhưng phải tự viết plugin in-process.)

## Đã kiểm chứng end-to-end
- Đọc khung tên (ATTRIB) từ DWG đóng → OK.
- **Sửa `KHBV: CTN-01 → ME-TH-T08` + PURGE + SAVEAS** ra file mới → đọc lại xác nhận đúng.
- **Batch** đọc KHBV từ nhiều file cùng lúc → OK.

## API

```
GET  /api/acad/status
     → { app, running, coreConsole, bridgeDir, activeJob }

POST /api/acad/headless   { script: "<AutoLISP/lệnh>", dwg?: "/abs/path.dwg", timeoutMs? }
     → { ok, exit, output }              # chạy trên DWG đóng (hoặc bản vẽ trống nếu bỏ dwg)

POST /api/acad/batch      { script, dwgs: ["/abs/a.dwg", …], timeoutMs? }
     → { count, ok, results:[{dwg,ok,exit,tail}] }

POST /api/acad/open       { path?: "/abs/ban-ve.dwg" }
POST /api/acad/job        { lisp: "<AutoLISP>", wait? }   # live; cần Accessibility
     → { jobId, state, result }          # trong lisp có sẵn (mep:write-result "ok" <str>)
GET  /api/acad/job/:id
POST /api/acad/keystroke  { text: "<ASCII 1 dòng>" }      # fallback; cần Accessibility
```

## Bật kênh Live (nếu cần điều khiển bản vẽ đang mở)
System Settings › **Privacy & Security › Accessibility** → bật cho app chạy daemon
(**MEP Studio** khi đóng gói, hoặc **Terminal** khi chạy dev). Lần đầu chạy job nếu AutoCAD
hỏi **SECURELOAD** thì bấm *Load*; muốn hết hỏi: lệnh `TRUSTEDPATHS` thêm `~/MEP-Bridge/...`.

## Lưu ý viết script headless
- Đường dẫn **tuyệt đối**. Mỗi lệnh 1 dòng; dùng bản dialog-alternative (`-LAYER`, `-PURGE`).
- Sửa file phải kết thúc bằng lưu: `(command "_.SAVEAS" "2018" "/abs/out.dwg")`.
- Text tiếng Việt trong DWG cũ có thể ở dạng `\U+xxxx` (Unicode escape) — xử lý khi cần.

## Chat tự dùng được
`MEP_PROMPT` (agents.ts) đã dạy agent gọi các endpoint này. Ví dụ gõ trong chat:
*"Sửa KHBV sai của tất cả bản vẽ thông hơi trong As-built drawing"* → agent tự dựng script +
gọi `/api/acad/batch`.

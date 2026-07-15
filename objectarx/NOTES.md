# Ghi chú build ObjectARX MepBridge

## Prereqs
## Việc user PHẢI tự làm trước khi build (không tự động hoá được)

**1. Tải ObjectARX 2027 macOS SDK (BẮT BUỘC — máy đang CHƯA có, đã kiểm tra: `/Library/Developer/Autodesk/ObjectARX 2027` không tồn tại).**
- Không có URL tải trực tiếp. Phải qua form chấp nhận license + CAPTCHA (cần tài khoản Autodesk).
- Vào: https://aps.autodesk.com/developer/overview/objectarx-autocad-sdk → bấm "Get a license and download the ObjectARX for AutoCAD SDK" → trang licensing: https://aps.autodesk.com/developer/overview/autocad-objectarx-sdk-licensing → chấp nhận → chọn gói **macOS cho version 2027** (KHÔNG dùng gói Windows, KHÔNG dùng SDK 2026 — 2027 không binary-compatible với 2026/2025).
- Cài xong, headers nằm ở `/Library/Developer/Autodesk/ObjectARX 2027/inc/`. Gói macOS **chỉ có thư mục `inc/`** (headers), KHÔNG có `lib/`, KHÔNG có `.dylib` — đây là ĐÚNG, không phải lỗi. Link libs là các dylib đã nằm sẵn trong `AutoCAD 2027.app/Contents/Frameworks`.

**2. Sau khi cài SDK, mở và đối chiếu 2 file để xác nhận macro/flags chính xác:**
- `/Library/Developer/Autodesk/ObjectARX 2027/inc/prj_arx.xcconfig` → xem `GCC_PREPROCESSOR_DEFINITIONS` (danh sách -D authoritative; lịch sử gồm `_ADESK_MAC_`) và `OTHER_LDFLAGS` (có -l module nào thêm không).
- `/Library/Developer/Autodesk/ObjectARX 2027/inc/prj_env.xcconfig`.
- Nếu khác với `build.sh` (mục DEFINES/LDLIBS), sửa lại cho khớp.

**3. KHÔNG cần cài full Xcode.** Đã kiểm tra & chứng minh: Command Line Tools clang 16.0.0 (đang có) build được universal .bundle hợp lệ. Full Xcode chỉ cần nếu muốn mở .xcodeproj mẫu của Autodesk hoặc dùng debugger GUI. `xcode-select -p` = `/Library/Developer/CommandLineTools` là đủ.

**4. Không cần cài thêm gì cho watcher:** CoreServices/CoreFoundation (FSEvents) là framework hệ thống có sẵn — đã compile-test universal thành công trên máy này.

**Caveats môi trường (không chặn build, chỉ lưu ý runtime):**
- Máy là **Intel x86_64** (không phải Apple Silicon) → arch chạy thật là x86_64; arm64 chỉ để universal.
- macOS đang là **15.2**, Autodesk yêu cầu chính thức **15.4.1+** cho AutoCAD 2027 → nên cân nhắc update macOS trước khi test load thật.
- AutoCAD 2027.app có entitlement `com.apple.security.cs.disable-library-validation=true` (đã kiểm tra) → bundle **ad-hoc sign** (không cần notarize, không cần Developer ID) VẪN load được. build.sh đã ad-hoc sign sẵn.

## Integration
## Daemon/UI cần đổi gì: gần như KHÔNG — chỉ 1 thay đổi nhỏ (ghi atomic)

**Kết luận: chỉ cần ghi `~/MEP-Bridge/mep_job.lsp` là đủ.** Plugin tự watch file này (debounce theo mtime nano-giây) rồi tự `(load ...)`. KHÔNG cần file cờ `mep_trigger`, KHÔNG cần endpoint mới, KHÔNG cần socket. Cơ chế kết quả hiện tại giữ nguyên: `wrapJob()` đã nhúng sẵn đường dẫn `results/<jobId>.txt` + sentinel `==end==` vào chính file LISP, nên khi plugin load file, LISP vẫn ghi result đúng chỗ và `pollResult()` của daemon đọc như cũ.

### Thay đổi duy nhất cần làm: ghi ATOMIC (temp + rename)
Hiện `acadBridge.ts` dùng `writeFileSync(JOB_LSP, ...)` (không atomic). FSEvents có thể bắn khi file đang ghi dở → plugin (hoặc MEP-RUN tay) đọc trúng file cụt. Sửa để ghi ra `.tmp` rồi `rename` (rename trên cùng volume là atomic).

Trong `/Users/khanhnm/Desktop/tool-autocad/mep-studio/apps/daemon/src/acadBridge.ts`:

1. Dòng 9 — thêm `renameSync` vào import `node:fs`:
```ts
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, globSync } from "node:fs";
```

2. Thêm helper (đặt gần `wrapJob`):
```ts
/** Ghi mep_job.lsp atomic: viet .tmp roi rename -> plugin/MEP-RUN khong bao gio doc file ghi do. */
function writeJobAtomic(content: string): void {
  const tmp = JOB_LSP + ".tmp";
  writeFileSync(tmp, content, "utf8");
  renameSync(tmp, JOB_LSP); // rename cung volume = atomic; mtime = luc ghi -> plugin phat hien
}
```

3. Thay 2 chỗ ghi:
- `writeLiveJob()` (dòng ~70): `writeFileSync(JOB_LSP, wrapJob(...), "utf8")` → `writeJobAtomic(wrapJob(randomUUID().slice(0,8), lisp))`.
- Handler `POST /job` (dòng ~199): `writeFileSync(JOB_LSP, wrapJob(jobId, lisp), "utf8")` → `writeJobAtomic(wrapJob(jobId, lisp))`.

### Có thể bỏ (không bắt buộc)
Nhánh `trigger === "keystroke"` (Accessibility/osascript, dòng ~216-230) không còn cần khi plugin đã cài — plugin tự chạy job, không cần bơm phím. Có thể giữ làm fallback. Sửa `hint` của nhánh `trigger === "run"` (dòng ~213) từ "gõ MEP-RUN" thành ví dụ: "Plugin MepBridge sẽ tự chạy trong ~0.3s; nếu chưa cài plugin thì gõ MEP-RUN".

### Hành vi cần biết (UI nên phản ánh)
- Plugin khởi tạo `lastMtime` = mtime hiện tại lúc AutoCAD mở → job ghi TRƯỚC khi mở AutoCAD sẽ KHÔNG tự chạy (tránh chạy job cũ ngoài ý muốn). User ghi job mới (daemon POST) hoặc gõ `MEPARX` để chạy job đang có.
- Không cần AutoCAD chạy sẵn để ghi job; nhưng job chỉ được vẽ khi có bản vẽ mở (plugin bỏ qua nếu `curDocument()` == null, có in cảnh báo).

## Risks
## Rủi ro & giới hạn

**1. CHƯA verify được toàn bộ compile/load tới khi cài SDK (rủi ro chính).**
- Phần FSEvents/CoreServices/C++ ĐÃ compile+link universal thành công trên máy này (đã test). Phần đụng ObjectARX headers (`arxHeaders.h`, `acdocman.h`, `sendStringToExecute`, `acedRegCmds->addCommand`, `acrxRegisterAppMDIAware`) CHƯA compile được vì SDK 2027 chưa cài.
- Nếu build lỗi tên hàm: (a) `acrxRegisterAppMDIAware(pkt)` là free-function trong `rxregsvc.h`; nếu không có, đổi sang method `acrxDynamicLinker->registerAppMDIAware(pkt)`. (b) Nếu `acutPrintf` chưa khai báo, thêm `#include "acutads.h"`. (c) Nếu `arxHeaders.h` không tồn tại đúng tên, thay bằng include cụ thể: `rxregsvc.h`, `rxdlinkr.h`, `aced.h`, `acedads.h`.
- Macro `-D_ADESK_MAC_=1`: là suy đoán lịch sử. PHẢI đối chiếu `inc/prj_arx.xcconfig` sau khi cài SDK và sửa lại DEFINES trong build.sh cho khớp (có thể thiếu/thừa -D hoặc thiếu -l module).

**2. Thread-safety.** An toàn với điều kiện KHÔNG được thêm std::thread nền gọi ObjectARX. Code hiện tại dùng `FSEventStreamSetDispatchQueue(main queue)` → callback chạy main thread → `sendStringToExecute` (chỉ enqueue) là an toàn. Nếu sau này ai đó chuyển sang poll bằng std::thread, BẮT BUỘC marshal về main thread bằng `dispatch_async(dispatch_get_main_queue(), ^{...})` trước khi chạm ObjectARX; gọi trực tiếp từ thread nền sẽ crash/hỏng dữ liệu.

**3. Binary compatibility.** AutoCAD 2027 (R26.0) KHÔNG binary-compatible với 2026/2025. Phải: dùng headers SDK 2027, link dylib trong chính AutoCAD 2027.app, giữ `-std=c++20`. Bundle build bằng SDK 2026 hoặc -std cũ sẽ không load / crash. Không có symbol-version shim trên Mac.

**4. Vẽ trùng (double-draw).** FSEvents có thể bắn nhiều event cho 1 lần ghi. Đã chặn bằng debounce theo `st_mtimespec` (nano-giây, APFS). PHỤ THUỘC daemon ghi atomic (rename) + mỗi job có mtime mới. Nếu daemon ghi 2 lần trong cùng nano-giây (cực hiếm) hoặc không đổi mtime, job có thể bị bỏ hoặc trùng. Ghi atomic + mtime mới mỗi lần (đã khuyến nghị) loại bỏ rủi ro này trên thực tế.

**5. macOS 15.2 < 15.4.1 (yêu cầu chính thức của AutoCAD 2027).** Build OK nhưng khi test LOAD thật trong AutoCAD có thể gặp hành vi lạ; nên update macOS lên ≥15.4.1 trước khi kết luận plugin lỗi.

**6. Job cũ không tự chạy khi mở AutoCAD.** Watcher init `lastMtime` = mtime hiện tại → đây là chủ ý (an toàn, tránh chạy job tồn đọng), nhưng nếu user kỳ vọng "mở AutoCAD là chạy job đang chờ" thì sẽ bất ngờ. Giải pháp: gõ `MEPARX`.

**7. SECURELOAD / code-sign.** Đặt trong `ApplicationAddins` là trusted path nên không bị hỏi. Bundle ad-hoc sign đủ vì app có `disable-library-validation=true` (đã kiểm tra). Nếu Autodesk siết entitlement ở bản cập nhật tương lai, có thể cần Developer ID + notarize.

**8. sendStringToExecute là async/enqueue.** Nếu 2 job tới dồn dập nhanh hơn tốc độ command line xử lý, chúng xếp hàng theo thứ tự (OK), nhưng một job đang chạy dở có thể làm job sau chờ; không mất job nhưng độ trễ tăng. Không phải lỗi đúng-sai, chỉ là đặc tính.
## ObjectARX raw catalog (v9)

- Plugin watches `~/MEP-Bridge/raw.job` and writes `raw.done` (JSON: ok/id/payload/error).
- Interactive ops schedule `MEPRAW` command in AutoCAD.
- Daemon: `GET /api/acad/raw/catalog`, `POST /api/acad/raw/invoke`.
- Web panel: **ObjectARX raw** lists all 86 catalog capabilities; MEP composites stay separate.
- Build: `bash build.sh` compiles `mepbridge.cpp` + `mepraw.cpp`.

# CadWeb Save Sync — resume context

> Cập nhật lần cuối: 2026-08-09 (Asia/Ho_Chi_Minh)
>
> Mục đích: handoff để tiếp tục đúng điểm dừng sau khi hội thoại/agent bị đóng.
> Đọc ADR 0001, ADR 0002 và `cadweb-sync-implementation-plan.md` trước khi sửa.

## Trạng thái tổng quát

Worktree đang rất bẩn và phần lớn CadWeb vẫn chưa được commit. Không reset, checkout,
xóa hoặc gom các file ngoài phạm vi. Các thay đổi UI/Preconstruction/React cache,
`.od-skills/`, `React/`, `css/`, `js/`, `index.html`, `workspace.html` có thể thuộc
người dùng và không được xem là rác của CadWeb.

Trạng thái tại điểm dừng:

- P0 audit/baseline: đã audit code/ADR, kiểm tra SDK ObjectARX 2027 cục bộ và chạy
  load/command smoke thật trên AutoCAD 2027 for Mac. macOS initial QSAVE và
  LINE -> U -> QSAVE trên DWG copy đã pass; Windows compile/load và phần còn lại
  của save/provenance runtime matrix vẫn là release gate.
- P1 contract/reducer/cross-read: portable code hoàn tất; native/TS và C++ -> TS
  snapshot/delta cross-read đều xanh.
- P2 Save-only host/journal: portable code và pure tests xanh; ACK đã khóa đúng
  `baseRevision + 1`, MDI command completion không còn lookup current document.
  Parser ACK và các restart boundary ACK -> GC -> compaction đã được siết/test.
  macOS host đã chứng minh initial snapshot, ACK -> GC, Undo conservative snapshot
  và semantic state-hash oracle. Chưa release-complete vì thiếu actual
  kill/failure injection và phần lớn AutoCAD runtime save matrix.
- P3 uploader + central revision service: portable implementation xanh `35/35`;
  artifact hard maximum đã thống nhất 256 MiB và sync root đã khóa một
  tenant/project bằng `scope.json`.
- P3 daemon wiring: typecheck và `test:cadweb-sync` xanh sau patch cuối.
- P4 canonical viewer/apply/recovery: pure/worker hoàn tất và viewer `27/27` xanh.
  Chưa wire panel tới HTTP/SSE vì chưa có tenant/project/drawing/auth binding.
- P5 provenance slice: schema/native/TS/server/viewer và conservative cache
  invalidation đã triển khai; graph block và MDI/Undo pure hardening đã có. Toàn
  Pha 5 vẫn chưa complete vì adapter/runtime, dynamic block, targeted extents và
  event matrix còn mở.
- P6/P7 command-based/Xref/post-MVP: chưa bắt đầu và không được bật trước các gate.

Không còn agent, AutoCAD/AcCoreConsole hoặc tiến trình build/test nền cần chờ.
Worktree vẫn chưa commit.

## Checkpoint continuation mới nhất

Lượt tiếp tục đã hoàn thành ba nhánh độc lập, giữ đúng assumptions: không cài plug-in,
không sửa DWG gốc/default sync root, không xóa ba registry plist isolate và không
implement extents/recovery khi ownership chưa đủ bằng chứng.

1. Packaging drift đã được sửa sẵn trong workspace trước khi audit: hai manifest
   đều có đủ bốn command và README package/macOS đã mô tả export + SaveSync. Audit
   không ghi đè các file đó. Bổ sung `cad-platform/tests/test_package_commands.py`
   để suy command group/list từ `CadWebCommands.cpp` và bắt mọi manifest lệch source.
   `cad-platform/README.md` được sửa đúng hai mô tả còn gọi bundle là “export-only”
   và coi SaveSync chỉ là design input.
2. Bổ sung `runtime-save-gate.scr` và `runtime-undo-gate.scr`. Hai AutoCAD 2027 GUI
   run trên copy `T1-DEMO-VE-THAT.dwg` và root tạm đều exit 0, tự QUIT sạch. Initial
   QSAVE tạo snapshot base 0; ACK revision 1 được consume/GC; LINE -> U -> QSAVE tạo
   snapshot base 1 với cùng `resultStateHash`. Marker Undo xác nhận entity count
   `273 -> 274 -> 273` và `DBMOD=0`.
3. Audit `.staged` kết luận chưa an toàn để implement GC. Failure window thật nằm
   sau durable rename `.preparing-* -> .staged` nhưng trước sealed state persist.
   Root chứa nhiều drawing, chưa có full state inventory/process lock và manifest
   không mang authoritative state key; per-document cleanup có thể xóa item hợp lệ
   của drawing chưa mở. Giữ implementation pending cho đến khi có root-wide native
   producer lock, full-state ownership scan, fail-closed validation và quarantine.
4. Native tests, packaging contract/XML/shell checks, macOS universal build và hai
   C++ -> TypeScript host snapshot cross-read đều xanh.

Trong lúc chạy, worktree ngoài scope tiếp tục thay đổi: status tăng từ `192` lên
`216` dòng do các HTML và 14 file `mau-thiet-ke/*.artifact.json` mới xuất hiện;
HTML/CSS/JS cũng tiếp tục đổi mtime ngay trong lượt. Đây được coi là thay đổi đồng
thời của user/process khác và không bị chỉnh sửa.

## P2 — những gì đã triển khai

Các file chính:

- `cad-platform/core/include/cadweb/CadWebDurableStore.h`
- `cad-platform/core/src/CadWebDurableStore.cpp`
- `cad-platform/core/include/cadweb/CadWebOutbox.h`
- `cad-platform/core/src/CadWebOutbox.cpp`
- `cad-platform/objectarx/common/CadWebSaveReactor.h`
- `cad-platform/objectarx/common/CadWebSaveReactor.cpp`
- `cad-platform/tests/native/test_save_sync.cpp`

Luồng bound hiện tại:

1. Host chỉ nhận binding base-revision-zero đã được provision vào native store;
   không tự suy `drawingId` từ fingerprint.
2. `beginSave` persist journal trước khi freeze generation.
3. `saveComplete` full-capture canonical database, rồi lập verified-noop, delta hoặc
   snapshot fallback.
4. Package được ghi vào `<artifactId>.staged`; sealed journal và pending semantic
   index được persist trước khi rename nguyên tử thành `<artifactId>.ready`.
5. Restart có thể promote `.staged` khớp sealed journal.
6. Daemon chỉ ghi `ack.json` khi revision đúng `baseRevision + 1`; planner, reducer,
   durable C++ parser và TS uploader/parser đều reject ACK nhảy revision. Native
   persist ACKed baseline trước, sau đó mới GC item và compact journal idempotent.

Ba lỗi review quan trọng đã được sửa:

- Không expose `.ready` trước sealed journal/pending index.
- Không xóa payload trước khi ACKed baseline durable; ACKed item được GC để quota
  không kẹt vĩnh viễn.
- ACK của recovery/initial snapshot xóa fallback reason đã được snapshot giải quyết,
  để Save kế tiếp có thể trở lại delta.

Contract handoff hiện dùng:

```text
<root>/outbox/items/<artifactId>.ready/
  item.json
  payload.cadweb | payload.cadwebdelta
  delivery.json               # daemon mutable state
  ack.json                    # daemon atomic ACK
```

Root mặc định phải giống nhau ở native và daemon:

- override: `CADWEB_SYNC_ROOT` (phải là absolute path);
- Windows: `%LOCALAPPDATA%/AcadStudio/CadWebSync`;
- macOS: `$HOME/Library/Application Support/AcadStudio/CadWebSync`.

Daemon atomically claim `<root>/scope.json` ở lần dùng đầu với đúng một `tenantId`
và `projectId`. Mọi list/read/write/ACK validate lại marker; marker invalid hoặc
scope mismatch fail closed trước network. Một root có thể chứa nhiều drawing nhưng
không được trộn tenant/project. Payload hard maximum là 256 MiB xuyên suốt native,
uploader và server; cấu hình chỉ được giảm, không được tăng quá cap này.

P2 đã được xác minh portable:

- `make -C cad-platform/tests/native clean test` xanh cả core/save-sync/planner;
- universal macOS build xanh `x86_64` + `arm64`, plist, exported symbol và codesign;
- `CadWebCommandRouter` nhớ owner ở `commandWillStart`, route ended/cancelled/failed
  về đúng document, giữ depth riêng và quên frame khi detach/stop;
- `U`/`UNDO`/`REDO` vẫn force conservative full-snapshot fallback lúc bắt đầu;
  command completion không publish.
- ACK JSON bắt buộc có object envelope `{...}`, không trailing bytes sau `}`, và
  scalar/string không được có trailing garbage. Tests reject partial/oversized,
  schema sai, brace thiếu, artifact/token/hash sai, timestamp rỗng, stale/skipped
  revision; valid ACK phải đúng revision kế tiếp.
- Store được reopen thật tại các mốc sealed journal trước `.ready`, ACK file trước
  baseline persist, baseline persist trước GC, payload delete trước state update và
  state update trước compaction. Retry `.staged`, publish `.ready`, ACKed delete và
  compaction đều idempotent trong pure store tests.

P2 còn phải xác minh trên host thật:

- Windows SDK compile;
- macOS initial QSAVE và một `U` conservative fallback đã pass trên representative
  copy; vẫn còn first Save/SAVE-copy/SAVEAS, AutoSave/failure/CLOSE/QUIT, MDI,
  unload/reload, kill points, REDO và Windows toàn matrix;
- callback ordering MDI, nhất là hai command trùng tên chồng lấp;
- actual OS kill/fsync và direct failure injection của từng persist/delete. Pure
  reopen đã cover các boundary logic, nhưng chưa chứng minh host/process failure;
- hard kill sau `prepareOutboxItem()` nhưng trước sealed-state persist có thể để lại
  `.staged` mồ côi. API per-document không thể GC an toàn vì một root chứa nhiều
  drawing. Audit mới yêu cầu root-wide native-producer OS lock, inventory/decode
  toàn bộ `state/*.cwsj`, exact single-owner validation và quarantine idempotent;
  root legacy/unmarked chỉ audit/report, không mutate. `publishPreparedOutboxItem`
  hiện vẫn tin `OutboxItem` caller truyền vào thay vì tự enforce sealed durable
  owner; test `artifact-129` cũng publish không có sealed owner và phải được đổi khi
  triển khai boundary này;
- provisioning writer binding, acquire/renew writer lease và rebind flow chưa được
  nối end-to-end với daemon/server.

## macOS AutoCAD 2027 host smoke

Host đã kiểm tra:

```text
AutoCAD: /Applications/Autodesk/AutoCAD 2027/AutoCAD 2027.app
version: R26.0.60.161 / ACADVER 26.0s (LMS Tech)
host: macOS 15.2, x86_64
SDK: /Library/Developer/Autodesk/ObjectARX 2027
bundle: cad-platform/objectarx/macos/build/CadWebExporter.bundle
```

Bundle hiện là universal `x86_64 + arm64`, ad-hoc codesign hợp lệ và export
`_acrxEntryPoint`. Không cài bundle vào user/machine `ApplicationPlugins`; smoke nạp
trực tiếp bằng `-ld`. Harness mới:

- `cad-platform/objectarx/macos/runtime-smoke.scr`;
- hướng dẫn trong `cad-platform/objectarx/macos/README.md`.

Authoritative GUI smoke cuối:

```bash
LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 \
CADWEB_RUNTIME_SMOKE_RESULT=/var/folders/d6/t6kbyns970j6_5vd0qnwnm7r0000gn/T/cadweb-gui-smoke.V8E2cs/result.txt \
CADWEB_SYNC_ROOT=/var/folders/d6/t6kbyns970j6_5vd0qnwnm7r0000gn/T/cadweb-gui-smoke.V8E2cs/sync-root \
"/Applications/Autodesk/AutoCAD 2027/AutoCAD 2027.app/Contents/MacOS/AutoCAD" \
  -nologo \
  -ld /Users/khanhnm/Desktop/tool-autocad/cad-platform/objectarx/macos/build/CadWebExporter.bundle \
  -b /Users/khanhnm/Desktop/tool-autocad/cad-platform/objectarx/macos/runtime-smoke.scr
```

Kết quả:

```text
launcher exit: 0
status=passed
acadver=26.0s (LMS Tech)
platform=macOS Version 15.2 (x86_64)
```

Marker chỉ được ghi sau khi `CADWEBSETTINGS` và `CADWEBSYNCSTATUS` đều return.
Script dùng raw `_.QUIT` ở dòng script, và rerun cuối đã tự đóng sạch AutoCAD; kiểm
tra sau run không còn process AutoCAD/AcCoreConsole. Bản vẽ mới không bị save/mutate,
không có sync root nào được tạo trong scratch vì drawing chưa bind.

Các probe không-authoritative nhưng phải nhớ:

- Lần launch đầu dưới environment runner `LC_ALL=C` abort exit 134 trước plug-in init
  với `collate_byname<char>::collate_byname failed to construct`. Crash report:
  `/Users/khanhnm/Library/Logs/DiagnosticReports/AutoCAD-2026-08-09-184021.ips`.
  Luôn dùng locale UTF-8 khi launch executable trực tiếp.
- Bản harness đầu gọi `(command-s "_.QUIT")`; marker pass nhưng child AutoCAD còn
  sống. PID đúng của smoke đã được đóng bằng AppleScript, sau đó harness đổi sang
  raw `_.QUIT` và authoritative rerun tự thoát sạch.
- AcCoreConsole thật nằm tại
  `.../Contents/Helpers/AcCoreConsole.app/Contents/MacOS/AcCoreConsole`. Usage runtime
  xác nhận `/isolate <userIdOrRegKey> <userDataFolder>` và `/loadmodule <module>`.
  Tuy nhiên `arxload` bundle trả `ARXLOAD failed`; `/loadmodule` cả bundle path lẫn
  binary path không đăng ký các lệnh CadWeb. Marker đều không được tạo. Vì vậy bundle
  GUI này hiện không được coi là CoreConsole-compatible; exit 0 của console không
  phải pass nếu thiếu marker.
- Một CoreConsole probe lỗi script không tự thoát và bỏ qua SIGTERM; chỉ đúng PID
  `78285` do probe tạo đã bị SIGKILL. Không còn process nền ở điểm bàn giao.
- Packaging drift đã đóng: cả manifest macOS và two-OS đều khai báo
  `CADWEBSYNCSTATUS`; README/build scope phản ánh SaveSync. Regression mới bắt source
  command list lệch manifest. Mọi host run vẫn phải dùng sync root mới, tuyệt đối
  không dùng default root có dữ liệu thật.

Basic smoke chỉ chứng minh GUI load + command registration/status path. Save/Undo
gate mới bên dưới bổ sung bằng chứng QSAVE/journal/outbox/ACK-GC/Undo, nhưng chưa
chứng minh toàn bộ SAVEAS/MDI/Redo/unload/property-source/crash-recovery matrix.

## macOS Save/Undo runtime gate mới

Evidence được giữ tại:

```text
/private/tmp/cadweb-save-undo.M4bzHY
  runtime-copy.dwg
  initial-result.txt
  undo-result.txt
  sync-root/
```

Source là `As-built drawing/T1-DEMO-VE-THAT.dwg`. Trước run, source và copy cùng
size `94179` và SHA-256
`7196b3220120ca9f94a55ed25c8eb463f66f1a6b1a44f85982a4ef82e5a5290f`.
Sau hai QSAVE chỉ copy đổi byte; source vẫn đúng checksum trên. `dwgread` xác nhận
fingerprint giữ nguyên:

```text
{82142CD4-5E3B-4E45-A940-212DD41F8828}
```

Root tạm được provision base-revision-zero tại
`bindings/82142CD4-5E3B-4E45-A940-212DD41F8828.json`. Hai run dùng locale UTF-8,
load bundle trực tiếp bằng `-ld`, đặt copied DWG trước switches và `-b` cuối command;
không cài plug-in.

Initial QSAVE (`runtime-save-gate.scr`):

```text
launcher exit=0
artifact=snapshot-6589C478314CD-2
kind=snapshot; baseRevision=0
resultStateHash=ee3e85a4b74bec2db823ea73f70221cdb211c14c4d07c6138249cd89afc43718
payload size=187321
payload sha256=fc92ffb0de75130f83fe174c2ab1d953b90e8883adf8e85cd8a359883c473175
cross-read: entities=7, blocks=1, layers=2, status=partial
```

`item.json`, payload size/SHA, manifest fingerprint/file name/sync binding đều khớp;
có đúng một `.ready`, không `.staged`. Marker đã ghi `status=passed`, nhưng bản script
đầu thử đọc `FINGERPRINTGUID/VERSIONGUID` qua AutoLISP `getvar` không hợp lệ nên phần
metadata marker dừng sau `dwgname`; artifact là oracle chính và hai sysvar đã được
gỡ khỏi harness trước Undo gate.

Một `ack.json` đúng immutable item được atomic rename với revision 1. Lần launch kế
tiếp consume ACK, persist baseline và GC item đầu trước mutation. Undo gate
(`runtime-undo-gate.scr`) dùng raw `LINE`, raw `U`, raw `QSAVE`:

```text
launcher exit=0; status=passed; DBMOD=0
entity count: before=273; edited=274; after U=273
artifact=snapshot-6589C6D0FB9AE-2
kind=snapshot; baseRevision=1
resultStateHash=ee3e85a4b74bec2db823ea73f70221cdb211c14c4d07c6138249cd89afc43718
payload size=187321
payload sha256=81ba96a968c8e8d3d2ec1959d41657b1d695fdf51dddcca0f791bab552478d69
cross-read: entities=7, blocks=1, layers=2, status=partial
```

State hash của hai revision giống hệt; SHA-256 của `layers.json`, `entities.bin`,
`blocks.bin`, `export-report.json` trong hai manifest cũng giống hệt. Archive tổng
thể khác đúng kỳ vọng vì `snapshotId/baseRevision` khác. Sau gate 2 còn đúng item
base 1 `.ready`, không `.staged`, và không còn AutoCAD/AcCoreConsole process.

Đây là evidence thật cho initial QSAVE -> durable snapshot -> ACK/GC -> conservative
Undo snapshot. Nó chưa cover change delta sau ACK, REDO, SAVEAS, MDI hoặc kill point.

## P3 — revision service và uploader

Package: `acad-studio/apps/sync-server`.

Đã có:

- CAS head và idempotency request digest cho snapshot/delta;
- single-writer lease gắn principal;
- immutable blob durable trước metadata commit;
- canonical server-side state hash cho entity/block/layer/state;
- checkpoint verify/attach không tăng head;
- unpublished-event recovery sau restart;
- HTTP head/changes/revision/blob, ACL/auth interface và streaming upload limit;
- `FileReadyOutboxStore`, `FetchRevisionPublishClient`, `LocalOutboxUploader`;
- payload size/SHA verification, symlink rejection, durable retry/backoff,
  `snapshot-required`/`manual-resolve`/`invalid`, atomic ACK;
- `runOnce({ forceRetryWait: true })` chỉ bypass thời gian chờ của trạng thái
  `retry-wait`, không mở trạng thái terminal/blocking.
- hard maximum 256 MiB dùng chung HTTP/service/uploader/native; giá trị cấu hình
  ngoài `1..256 MiB` bị reject;
- durable `scope.json` claim race-safe, same-scope restart được phép, mismatch hoặc
  marker invalid dừng trước upload;
- remote ACK và ACK đã nằm trên disk phải đúng chính xác `baseRevision + 1`;
  `invalid_server_response` đi vào terminal `invalid`, không retry vô hạn.

Lỗi idempotency quan trọng đã được sửa: lookup artifact đã commit và kiểm
`requestDigest` diễn ra trước active-lease/CAS check. Vì vậy retry byte-identical
sau khi ACK bị mất vẫn trả revision cũ kể cả lease đã hết hoặc writer mới đã thay
lease; request mới vẫn bắt buộc có active lease.

Đã chạy độc lập:

```text
pnpm --dir acad-studio --filter @acad/sync-server test
35 passed, 0 failed; tsc --noEmit passed
```

Production blockers:

- `FileRevisionMetadataStore` chỉ CAS trong một process; multi-replica cần database
  transaction/unique constraints thật.
- Authenticator/Authorizer/EventPublisher mới là interface injection; chưa có backend
  auth hoặc SSE/WebSocket transport thật.
- Chưa có checkpoint retention/materialization scheduler và metrics.

## Daemon wiring

Files:

- `acad-studio/apps/daemon/src/cadwebSync.ts`
- `acad-studio/apps/daemon/src/server.ts`
- `acad-studio/apps/daemon/scripts/test-cadweb-sync.mjs`
- `acad-studio/apps/daemon/package.json`
- importer liên quan trong `acad-studio/pnpm-lock.yaml`

Behavior:

- disabled mặc định; chỉ bật khi `CADWEB_SYNC_ENABLED=1`;
- HTTPS bắt buộc, chỉ cho HTTP nếu endpoint loopback;
- timer self-scheduling, `unref()`, start sau khi server listen và stop khi server
  close;
- `GET /api/cadweb/sync/status` chỉ trả aggregate đã sanitize;
- `POST /api/cadweb/sync/retry` chỉ force `retry-wait`;
- không ghi geometry blob vào sql.js.

Đã chạy độc lập sau patch cuối:

```text
pnpm --dir acad-studio --filter @acad/daemon exec tsc --noEmit
pnpm --dir acad-studio --filter @acad/daemon test:cadweb-sync
pnpm --dir acad-studio --filter @acad/sync-server test
```

Ba lệnh đều pass; sync-server là `35/35` và daemon báo
`CADWeb daemon sync wiring: all checks passed`.

Daemon blockers:

- env access token chỉ phù hợp bootstrap/dev; production cần Keychain/Credential
  Manager và rotation.
- Chưa có safe manual discard/rebase/lease-rebind flow; blocked item chỉ được
  surfaced, không được tự xóa.
- Tenant/project vẫn là global daemon config; `scope.json` đã enforce một root/một
  tenant-project, nên multi-project phải dùng root riêng hoặc thiết kế partition mới.
- Chưa có process lock chống hai daemon cùng xử lý một root.
- Windows fsync/write/rename và đường dẫn thực phải host-test.

## P4 — viewer

Files chính:

- `acad-studio/apps/web/app/cadweb-viewer-state.ts`
- `acad-studio/apps/web/app/cadweb.worker.ts`
- `acad-studio/apps/web/app/cadweb-revision-recovery.ts`
- `acad-studio/apps/web/scripts/test-cadweb-*.test.ts`

Đã có canonical entity/block/layer maps, block reference/dependency indexes,
atomic per-revision stage/commit, serialized worker requests, guarded
`resetToSnapshot`, retained layer cache tên đúng là `renderCacheByLayerId`, và pure
recovery coordinator dùng GET-head + bounded contiguous delta chain + snapshot
fallback. Worker hiện resolve Explicit/ByLayer/ByBlock, gồm effective layer 0 và
parent block-reference style; root ByBlock dùng scalar fallback. Mọi layer,
block-definition hoặc block-reference mutation rebuild toàn bộ layer cache để giữ
correctness trước khi có targeted reverse index.

Đã chạy độc lập:

```text
@acad/web viewer tests: 27/27 passed
@acad/web tsc --noEmit: passed trước và sau production build
@acad/web production build: passed, 3/3 static pages
@acad/cadweb tests: 27/27 passed
```

Blocker tích hợp: `CadWebViewerPanel` chưa có tenant/project/drawing/auth binding nên
coordinator chưa được wire tới HTTP/SSE. Ngoài ra coordinator coi drawing change là
snapshot fallback trong pure plan, còn worker recovery reset cố ý từ chối thay
drawing; khi wire panel phải chốt explicit unbind/reset semantics thay vì dựa vào
hai behavior này ngầm định.

## P5 — provenance, block graph và Undo/MDI hardening

Portable provenance slice đã triển khai:

1. `PropertySourceMode { Explicit=0, ByLayer=1, ByBlock=2 }` đã được thêm vào
   schema/DTO; bốn mode field được append ở cuối FlatBuffers `Entity`, nên buffer cũ
   thiếu field vẫn đọc thành `Explicit` và resolved scalar cũ vẫn là fallback.
2. Snapshot minor là 1.2, delta minor là 1.1; reader tiếp tục nhận version cũ.
3. Native writer, TS reader/writer/verifier và sync-server native geometry builder
   đều hiểu bốn mode. Non-default native/server semantic hash parity là:

   ```text
   d8c85806c41abb017b996c08db9f583cb074f3aa305ec3b87f242b150edfada0
   ```

4. ObjectARX adapter capture raw source mode bằng color/transparency predicates,
   lineweight sentinels và linetype object IDs.
5. Viewer resolve Explicit/ByLayer/ByBlock, effective layer 0 và nested parent
   block-reference style; root ByBlock dùng entity scalar. Không còn sentinel
   `colorArgb===0`.
6. Mọi layer/block-definition/block-reference upsert hoặc tombstone hiện rebuild
   toàn bộ layer cache. Cycle bị reject atomically; nested A -> B update refresh đúng
   geometry trong depth/budget.

Block/extents và command hardening đã thêm:

- revision planner reject dangling block reference, dependency cycle và chain sâu
  hơn 32; depth 32 accept, 33 reject;
- nested leaf definition change chỉ upsert leaf block một lần và commit aggregate
  WCS extents do adapter full-capture cung cấp;
- `CadWebCommandRouter` nhớ document owner/depth lúc command start, route cả ended,
  cancelled và failed về owner, cleanup khi detach/stop;
- U/UNDO/REDO vẫn đánh full-snapshot fallback ngay lúc bắt đầu; chưa bật command
  publish.

Portable tests đã chứng minh old-buffer default, đủ ba mode, mode-only hash/delta,
C++ -> TS cross-read, layer semantics, nested layer-0/ByBlock, atomic cycle reject,
nested block update và MDI router synthetic cases.

Không được đánh toàn Pha 5 complete/release-ready. Các gap còn mở:

- root ByBlock scalar từ adapter hiện khởi tạo từ layer scalar, chưa có AutoCAD oracle
  chứng minh effective fallback; `kLnWtByLwDefault`/`kLnWtByDIPs` chưa biểu diễn đúng;
- dynamic/anonymous blocks chưa có fixture/runtime proof; attribute owner chỉ partial,
  AttributeDefinition unsupported, visibility/MText bị flatten và viewer chưa render
  attribute glyph;
- chưa có layer/style -> entity reverse index, targeted block occurrence invalidation,
  draw-order adapter hoặc targeted extents recomputation;
- `CadRevisionIndex` không giữ extent topology, nên core không thể transform/reduce
  mọi affected occurrence một cách có chứng cứ. Chỉ hai map per-root WCS AABB và
  per-definition local AABB vẫn không đủ: aggregate AABB không thể trừ contribution
  cũ, còn rotation/shear lồng nhau làm overbound phụ thuộc path. Không dựng
  reverse-index giả trước khi có capture evidence đầy đủ;
- chưa chạy full host event matrix MOVE/COPY/ERASE -> Save -> Undo/Redo, block editor,
  refedit, layer/style/table, unload/close MDI và crash/restart kill points.

Thiết kế targeted extents đã audit nhưng **chưa implement**. Nếu R1 không giữ full
capture, mô hình tối thiểu đúng phải là sidecar nội bộ, không đổi FlatBuffers/wire:

```text
RootExtentEvidence
  rootEntityId
  directWcsBounds? / intrinsicWcsBounds?
  blockOccurrence? { targetDefinitionId, mcsToWcsTransform }
  resolvedWcsBounds?

DefinitionExtentEvidence
  definitionId
  directLocalBounds?
  occurrences[]  # giữ từng occurrence, không dedupe
    { occurrenceEntityId, targetDefinitionId, ownerLocalTransform,
      intrinsicLocalBounds? }
  resolvedLocalBounds?

extentEvidenceComplete: bool
```

Phải phân biệt `known empty` với `unavailable`; zero box không thể đóng vai trò cả
hai. Transform AABB bằng đủ tám góc, require finite affine matrix, dùng
`Tcombined = Tparent * Tchild`, cycle/dangling/depth fail closed. Closure invalidation
phải dùng cả old và new reverse graph để edge bị xóa vẫn co lại đúng. Nếu evidence
thiếu thì fallback full snapshot, không đoán.

Nếu persist sidecar này, durable state cần version 2: decoder vẫn đọc v1 và map
`extentEvidenceComplete=false`, không làm mất pending v1 ACK/outbox; encoder ghi v2.
Full capture và targeted reducer phải chốt cùng một extent domain trước (canonical
supported geometry hay ObjectARX `getGeomExtents()` gồm unsupported/Xref/attribute).
Pure test hiện tại về nested leaf chỉ tự gán changed global extent, chưa chứng minh
derive. Cần host oracle cho local coordinate space, attributes, dynamic blocks,
refedit cache và non-uniform transforms. Native đã enforce depth 32; TS/server mới
reject cycle và viewer truncate ở 32, nên contract-wide depth invariant còn phải
đồng bộ sau khi chốt thiết kế.

FlatBuffers được regen bằng official `flatc` v25.9.23. Provenance đã verify:

```text
archive: MacIntel.flatc.binary.zip
archive size: 1430454
archive sha256: 7a1de9cd4d0e769a39c41f3c59496bd011bc7a94d97baa58b0df8df782dc5c8d
extracted flatc size: 3799808
extracted flatc sha256: d224509681fbf73a5770b7f61fdc4d5fccd9f303493c4339dbb16fb0ea8af2df
binary/version: Mach-O x86_64, flatc version 25.9.23
temporary path used:
/var/folders/d6/t6kbyns970j6_5vd0qnwnm7r0000gn/T/tmp.7ADKWN8EWS/unpacked/flatc
```

Path trên là tạm, không được coi là dependency và binary không được copy vào repo.
Nếu regen lại, tải official archive, verify cả archive/binary checksum trước khi chạy.

## Regression cuối đã chạy

```text
make -C cad-platform/tests/native clean test
PASS: core, save-sync, revision-planner

cad-platform/objectarx/macos/build.sh --build-only
PASS: x86_64 + arm64, plist, exported symbol, codesign
NOTE: chỉ có warning format-security/include-case từ ObjectARX SDK headers

pnpm --dir acad-studio --filter @acad/cadweb test
PASS: 27/27 + typecheck

native snapshot cross-read
PASS: entities=7, blocks=1, layers=2, status=partial

native delta cross-read (dùng absolute artifact path)
PASS: baseRevision=127, entities=2, blocks=1, layers=1, tombstones=3,
      status=complete

pnpm --dir acad-studio --filter @acad/sync-server test
PASS: 35/35 + typecheck

pnpm --dir acad-studio --filter @acad/daemon exec tsc --noEmit
pnpm --dir acad-studio --filter @acad/daemon test:cadweb-sync
PASS: typecheck; CADWeb daemon sync wiring: all checks passed

pnpm --dir acad-studio --filter @acad/web exec tsc --noEmit
pnpm --dir acad-studio --filter @acad/web test:cadweb-viewer
pnpm --dir acad-studio --filter @acad/web build
pnpm --dir acad-studio --filter @acad/web exec tsc --noEmit
PASS: pre/post-build tsc, viewer 27/27, production build 3/3 static pages
```

Sau patch ACK parser/restart tests và runtime harness, authoritative native rerun
cuối vẫn xanh:

```text
make -C cad-platform/tests/native clean test
PASS: cadweb core native tests
PASS: cadweb save sync pure tests
PASS: cadweb revision planner tests
NOTE: compile dùng -Wall -Wextra -Wpedantic -Werror

cad-platform/objectarx/macos/build.sh --build-only
PASS: universal x86_64 + arm64, Info.plist, exported symbol, codesign
NOTE: build-only xác nhận không đổi AutoCAD plug-in directories
```

Lượt continuation mới nhất chạy lại các gate trực tiếp liên quan:

```text
python3 -m unittest cad-platform/tests/test_package_commands.py -v
PASS: 1/1; command group/list trong cả hai manifest khớp source

xmllint --noout <two PackageContents.xml + Info.plist>
bash -n <build.sh + stage-package.sh>
package staging + no-overwrite rerun smoke
PASS

make -C cad-platform/tests/native test
PASS: core, save-sync, revision-planner

cad-platform/objectarx/macos/build.sh --build-only
PASS: universal x86_64 + arm64, Info.plist, exported symbol, codesign
NOTE: chỉ warning đã biết từ ObjectARX SDK headers; không install

host initial snapshot cross-read
host Undo fallback snapshot cross-read
PASS each: entities=7, blocks=1, layers=2, status=partial
```

Delta cross-read phải nhận absolute path; không truyền dấu `--` thành filename. Một
lần sync-server `34/35` xảy ra giữa lúc classifier đang được patch; authoritative
rerun hậu patch là `35/35`. Git-visible status trước/sau final TS regression giống
hệt (180 dòng); ignored `.next`/build output có thể được refresh.

Regression cũ vẫn có giá trị:

- Python daemon/app tests: `PYTHONPATH=app python3 -m unittest discover -s app/tests -v`
  -> 13/13 pass. `pytest` không cài trong environment.
- Các daemon suites raw/control/contract/headless/preview/live-preview non-E2E/
  ui-preview/stability/identity/draw-t1/lisp/standards/selection/block-library đã
  pass trong các batch trước wiring.

Lưu ý side effect ngoài repo:

- suite stability đã chạy `fixfonts` và cài/copy `romans1.shx`, `SUPEROS.SHX` vào:

```text
/Users/khanhnm/Library/Application Support/Autodesk/AutoCAD 2027/R26.0/roaming/@en@/Support/SHXFont
```

- AutoCAD GUI smoke có thể đã cập nhật licensing/telemetry, prefs, caches, saved
  state và logs bình thường của AutoCAD. Crash report LC_ALL=C nằm ở path đã ghi
  phía trên.
- Scratch runtime còn dưới:

  ```text
  /var/folders/d6/t6kbyns970j6_5vd0qnwnm7r0000gn/T/cadweb-runtime-smoke.XXXXXX.yxgCU54nsS
  /var/folders/d6/t6kbyns970j6_5vd0qnwnm7r0000gn/T/cadweb-coreconsole-smoke.r2SzVb
  /var/folders/d6/t6kbyns970j6_5vd0qnwnm7r0000gn/T/cadweb-coreconsole-arxload.JrVbUc
  /var/folders/d6/t6kbyns970j6_5vd0qnwnm7r0000gn/T/cadweb-coreconsole-module.diCm1P
  /var/folders/d6/t6kbyns970j6_5vd0qnwnm7r0000gn/T/cadweb-gui-smoke.V8E2cs
  /private/tmp/cadweb-save-undo.M4bzHY
  ```

  Chúng chỉ chứa copied DWG/user-data/marker hoặc empty isolated sync paths; file
  gốc không bị sửa. Không xóa/restore font, crash report hoặc scratch nếu chưa có
  chỉ dẫn của người dùng.
- Ba lần CoreConsole `/isolate` còn tạo registry plist **ngay tại workspace root**,
  không chỉ trong `/var/folders`. Đây là side effect của các probe trước, hiện vẫn
  untracked và được giữ nguyên:

  ```text
  cadweb-smoke/HKCU_V1.plist
    size=169134
    sha256=6412680e122e567ae7b1f0e2f2a9dc8b4ad159fba2c172f500b222dd2da69617

  cadweb-core-smoke/HKCU_V1.plist
    size=475580
    sha256=1de5c1af42af956f0baefc904e9f72ffd6399ebd76478a449a971756c35331c6

  cadweb-module-smoke/HKCU_V1.plist
    size=478670
    sha256=30d2d51711ee4f00d44dfba00d9f7c21ee4b8055202f47df7fdbd602ef5463f5
  ```

  Không xóa/move các thư mục này khi resume nếu chưa chủ động quyết định cleanup;
  nếu chạy CoreConsole lần nữa, đặt working directory trong scratch để không sinh
  thêm registry directory ở repo root.

Git-visible snapshot mới nhất là `216` status lines; SHA-256 của output
`git status --short --untracked-files=all` là:

```text
75a09f40596f164c892de1bb301587a2aadd0a6688b86df697a7b69a9a9b5702
```

Mốc cũ `184`/`463941...` không còn đại diện workspace. Lúc resume lượt này đã là
`192` dòng; các HTML/artifact mới dưới `mau-thiet-ke/` xuất hiện đồng thời trong
lượt và không thuộc CadWeb. `git diff --check` sạch.

## Release boundary

Portable evidence đủ để gọi P1, P3 core/uploader và P4 pure path code-complete;
P2 portable implementation và P5 provenance slice cũng đã qua regression. Điều đó
không thay thế các release gate sau:

- Windows ObjectARX 2027 x64 compile/load và AutoCAD 2027 Windows runtime;
- macOS basic GUI load/commands, representative initial QSAVE, ACK -> GC và một
  LINE -> U -> QSAVE semantic oracle đã pass; SAVE-copy/SAVEAS/AutoSave/failure,
  CLOSE/QUIT/unload/MDI/REDO/property oracle và kill matrix vẫn mở;
- full Save/CLOSE/QUIT/unload/MDI/Undo/Redo matrix, property provenance oracle và
  kill-point ACK/GC recovery;
- dynamic/anonymous block, attribute/draw-order fidelity và targeted occurrence
  extents/reverse index;
- production database CAS, auth/event transport, secure credentials, process lock,
  provisioning/lease/rebind và viewer HTTP/SSE binding.

Không đánh P2/P5/P6 release-complete trước khi các gate tương ứng có bằng chứng.

## Trình tự tiếp tục đề nghị

1. Đọc file này + ADR 0002; chạy `git status --short` và `git diff --check`, tuyệt
   đối không reset/xóa/gom thay đổi ngoài scope.
2. Chạy Windows SDK compile/load smoke. Trên macOS không cần lặp basic load smoke
   hoặc initial QSAVE/Undo gate nếu bundle/harness không đổi; bước tiếp theo là
   change -> QSAVE delta, no-op QSAVE, SAVE-copy/SAVEAS/AutoSave/failure/CLOSE/QUIT,
   MDI/REDO, unload/reload, block/extents và oracle bốn property source modes. Luôn
   dùng UTF-8 locale, DWG copy và một `CADWEB_SYNC_ROOT` tuyệt đối mới.
3. Chốt conservative full capture có đủ cho R1 hay không. Nếu cần targeted extents,
   implement sidecar evidence/algorithm/durable-v2 đúng mô hình đã ghi ở trên trước
   khi thêm reverse recomputation; không chỉ thêm hai aggregate extent maps.
4. Implement root-wide native-producer OS lock + full `state/*.cwsj` ownership scan,
   exact-owner promotion và orphan quarantine trên root-format mới; legacy root chỉ
   audit/report. Enforce sealed-owner check trong publish API, rồi mới chạy actual
   OS kill/fsync và injected persist/delete failure matrix.
5. Hoàn thiện provisioning/lease/rebind, secure credential/process lock và production
   P3 persistence/auth/event transport.
6. Wire viewer recovery qua HTTP/SSE với explicit tenant/project/drawing binding và
   unbind/reset semantics.
7. Ghi release audit cuối tách portable code-complete khỏi host/runtime gates; chỉ
   sau đó mới cân nhắc P6/P7.

Không có commit nào được tạo ở điểm dừng.

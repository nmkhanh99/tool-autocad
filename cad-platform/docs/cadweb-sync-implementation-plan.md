# Kế hoạch triển khai CadWeb Save Sync

> Mục tiêu: user sửa DWG trong AutoCAD, eligible Save thành công, viewer đang mở tự cập
> nhật revision mới mà không tải lại toàn bộ drawing đối với entity-only change.
>
> Thiết kế chuẩn tắc: [ADR 0002](0002-cadweb-revision-delta-contract.md).
> Ngày lập kế hoạch: 2026-08-09.

## Kết luận triển khai

MVP khả thi với codebase hiện tại, vì repo đã có full snapshot exporter, C++ core,
TypeScript reader và WebGL viewer. Tuy nhiên chưa có thành phần delta nào hoàn chỉnh.
Critical path là:

```text
freeze snapshot v1
  -> runtime event spike
  -> delta contract + pure reducer
  -> Save-only native tracker/outbox
  -> revision service
  -> retained viewer model/apply
  -> hardening Windows/macOS
```

Không bật `commandEnded -> publish` trước khi Save-only qua đủ Undo/Redo, MDI,
reconnect và snapshot fallback. Live drag là một sản phẩm khác và không nằm trong
MVP này.

## Hiện trạng repo

| Thành phần | Đã có | Còn thiếu cho sync |
|---|---|---|
| `cad-platform/core` | DTO snapshot, FlatBuffers/JSON, SHA-256, ZIP deterministic | Delta DTO/writer, object hash index, tombstone, merge rules |
| `cad-platform/objectarx/common` | Full/selected snapshot cho entity phase 1 | Per-document reactors, aggregate-root snapshot, save fence, journal/outbox |
| Windows/macOS entrypoint | Hai build target dùng chung adapter | Register/unregister tracker và host runtime verification |
| `apps/cadweb` | Fail-closed `.cadweb` reader | `.cadwebdelta` reader, reducer, revision/model-epoch validation |
| `apps/web` | Worker parse và WebGL2 full load | Canonical maps, apply delta, dependency index, gap recovery |
| `apps/daemon` | Loopback Express, SQLite/sql.js, SSE | Durable outbox watcher/uploader và publish status |
| Central server | Chưa có | Drawing/revision store, blob store, CAS/idempotency, push |

Prototype reactor trong `objectarx/mepbridge.cpp` chỉ là bằng chứng luồng sự kiện:
nó dùng một global dirty flag, không lưu handle/op, bỏ qua erase boolean và chỉ bám
active database. Không mở rộng monolith đó thành CadWeb sync. Phần mới phải nằm trong
`cad-platform/objectarx/common` để Windows và macOS dùng cùng implementation.

Viewer hiện gom primitive vào một `Float32Array` theo layer. Do chưa có index
`stableId -> render allocation`, code hiện tại không thể thật sự remove/add handle
`54AF`. MVP sẽ thêm canonical object maps và rebuild chunk/layer bị ảnh hưởng; tối ưu
GPU surgical patch là bước sau khi semantics đúng.

## Nguyên tắc thực hiện

1. Correctness trước realtime: mất/gap/không chắc thì tải snapshot.
2. Reactor chỉ invalidation: không coi callback là durable change log.
3. Server cấp revision: client không tự `revision++`.
4. Save và publish tách failure domain: lưu DWG thành công không phụ thuộc mạng.
5. Một revision apply nguyên khối: viewer không thấy nửa transaction.
6. Không truyền `AcDb*` qua thread/process boundary.
7. Cùng DTO/schema/golden fixture trên Windows và Mac; binary và host test riêng.
8. Unknown object/style/Xref phải report hoặc fallback, không silent drop.

## Pha 0 — Khóa baseline và runtime spike

Mục tiêu: bảo vệ phần full snapshot đang có và loại bỏ rủi ro API trước khi mở rộng
schema.

### Công việc

- Tách/commit baseline CadWeb hiện tại thành change riêng trước delta. Hiện toàn bộ
  `cad-platform/`, `apps/cadweb`, viewer và tài liệu kiến trúc vẫn đang untracked;
  không trộn với các thay đổi UI/Preconstruction/React cache khác trong worktree.
- Thêm một event-trace build tạm cho Windows và Mac, log:
  - database/document identity;
  - callback name, handle, class, owner handle, erase boolean;
  - command depth/name;
  - begin/saveComplete/abortSave và intended/actual extension;
  - timestamp/sequence chỉ để quan sát, không làm protocol.
- Chạy QSAVE, SAVE-copy, SAVEAS, first Save, AutoSave, save fail, API save,
  MOVE/COPY/ERASE, ESC, U/UNDO/REDO, nested command và hai document mở đồng thời.
- Chạy SAVEAS sang DWG/DXF/DWT/DWS; chỉ DWG mới thuộc Save Sync.
- Chạy CLOSE/QUIT với Save/Don't Save/Cancel, kể cả nhiều MDI document; ghi thứ tự
  save callback so với `documentToBeDestroyed`.
- Kiểm chứng `getFingerprintGuid`/`getVersionGuid` qua QSAVE, SAVE-copy, SAVEAS,
  copy file và reopen. Release 1 dùng binding policy trong ADR: SAVE-copy không đổi
  binding, SAVEAS DWG mặc định fork/rebind.
- Đo khả năng resolve/read dirty object trong transaction ở safe boundary sau
  `saveComplete` và trước command tiếp theo.

### Gate thoát pha

- Có trace thực tế từ AutoCAD 2027 Windows và AutoCAD 2027 Mac.
- Chốt bảng callback sequence theo từng case, không còn giả định dựa trên tên API.
- Không crash khi mở/đóng/đổi tab 100 lần và unload/reload plug-in.
- Chốt đường seal-before-destroy: capture tạm ở `beginSave`, capture ở
  `saveComplete`, hoặc headless reopen recovery đã host-test. `commandEnded` không
  được là điều kiện correctness cho CLOSE/QUIT.
- Kill plug-in/AutoCAD ở từng điểm từ `beginSave` đến atomic outbox; mọi token dở
  phải được phát hiện và buộc full recovery, không mất successful Save.

Nếu chưa có máy Windows, phần Windows vẫn là release blocker; compile Mac không thay
thế được gate này.

## Pha 1 — Contract và reducer thuần

Mục tiêu: định nghĩa change set có thể test không cần AutoCAD/server/browser.

### File đề xuất

```text
cad-platform/
├── schema/
│   ├── change.schema.json
│   └── delta.fbs
├── core/include/cadweb/
│   ├── CadDelta.h
│   └── CadDeltaWriter.h
├── core/src/
│   └── CadDeltaWriter.cpp
└── tests/native/
    └── delta fixtures/tests

acad-studio/apps/cadweb/src/
├── delta.ts
├── delta-validation.ts
└── revision-reducer.ts
```

Tên file là đề xuất; contract và ownership mới là phần bắt buộc.

### Công việc

- Chốt `.cadwebdelta` ZIP layout, JSON Schema, FlatBuffers upsert và tombstone.
- Chốt sync snapshot 1.1: `drawingId`, `modelEpoch`, `snapshotId`, `baseRevision`,
  fixed origin và canonical `objectKind:sourceHandle` ID xuyên snapshot/delta. Thêm
  `sourceHandle` cho layer; v1.0 không được dùng trực tiếp làm revision baseline.
- Tách envelope writer `syncBinding(snapshotId, baseRevision)` khỏi server
  `checkpointBinding(checkpointId, revision, stateHash)`; checkpoint không thể gửi
  qua writer publish endpoint.
- Thêm `drawingId`, `sourceFingerprint`, `modelEpoch`, `changeSetId`,
  `baseRevision`, trigger, `modelEmpty`, `resultExtents` và file descriptors có
  hash/size.
- Chốt canonical object key và uppercase handle normalization.
- Chốt object content hash độc lập traversal order.
- Chốt revision `stateHash` từ sorted canonical object hashes + model epoch/metadata,
  độc lập ZIP byte layout.
- Viết reducer transition tests:
  - append -> erase = no-op;
  - modify -> erase = delete;
  - erase -> unerase = no-op hoặc upsert theo hash;
  - modify -> revert = no-op;
  - duplicate upsert/tombstone bị reject;
  - count/payload descriptor mismatch bị reject;
  - xóa entity cuối -> `modelEmpty=true` + canonical zero extents;
  - block definition đổi -> WCS extents mọi top-level occurrence được recompute;
  - base revision/model epoch mismatch bị reject.
- Reuse ZIP security limits của snapshot reader: duplicate path, traversal, ratio,
  checksum, size budget, unknown major version.
- Tạo golden delta mà C++ writer ghi và TypeScript reader đọc.
- Tạo golden full sync snapshot 1.1; selected export bị reject nếu dùng làm
  initial/recovery/compaction baseline.

### Gate thoát pha

- Native và TypeScript contract tests xanh.
- C++ -> TypeScript cross-read và deterministic semantic diff xanh.
- Fuzz/negative fixtures không cấp phát vượt limit và fail closed.
- Không còn client-authored `revision`; chỉ có `baseRevision`.
- Snapshot và delta dùng cùng canonical key; tombstone từ delta xóa đúng entity đã
  load từ snapshot.

## Pha 2 — Native Save-only change tracker

Mục tiêu: AutoCAD tạo đúng immutable DTO/delta sau eligible Save, chưa cần server.

### File đề xuất

```text
cad-platform/objectarx/common/
├── CadWebChangeTracker.h/.cpp
├── CadWebObjectSnapshot.h/.cpp
├── CadWebSaveReactor.h/.cpp
└── CadWebOutbox.h/.cpp
```

Windows/Mac entrypoint chỉ đăng ký cùng các class này và cung cấp platform path/
lifecycle adapter tối thiểu.

### Công việc

- Tạo state riêng mỗi document/database, khởi tạo cả document đang mở lúc plug-in
  load và document mở sau đó.
- Attach/detach reactor trong `documentCreated`/`documentToBeDestroyed`; không gọi
  `removeReactor` trên database đã hủy.
- Callback thu candidate handle/category/owner; thêm
  `objectUnAppended`/`objectReAppended`, erase/unerase và header sysvar.
- Ghép `beginSave`, `saveComplete`, `abortSave`; áp dụng eligibility policy cho
  QSAVE/first Save/SAVE-copy/SAVEAS/AutoSave và target không phải DWG.
- Persist journal token trước Save, trạng thái `capture-pending` tại saveComplete,
  last ACKed
  revision/fingerprint/version/file evidence và trusted baseline marker. Attach mà
  thiếu baseline hoặc thấy token/file evidence không chắc chắn phải full recovery.
- Implement terminal state machine: `aborted/ineligible` close local;
  `verified-noop` persist last-observed file/version evidence rồi close không outbox;
  `sealed-publish-required` mới chờ server ACK để advance model baseline. SAVEAS fork
  dùng `rebind-required`, không để orphan token.
- Implement đường seal-before-destroy đã thắng gate P0; SAVE-on-CLOSE/QUIT không
  được phụ thuộc outer `commandEnded`.
- Khi outer command là U/UNDO/REDO, mặc định đánh full-scan/full-snapshot fallback;
  database reactor không có `objectModifyUndone` để bảo đảm candidate cho mọi
  geometry/property Undo.
- Tại safe boundary, resolve bằng `getAcDbObjectId(..., false, handle)`, snapshot
  read-only, đóng transaction rồi mới giao DTO thuần cho encoder/worker.
- Refactor adapter hiện tại thành các hàm aggregate-root:
  - entity top-level;
  - block definition;
  - layer/metadata;
  - full database fallback.
- Bubble child change: attribute -> block reference; block child -> block
  definition. Unknown owner/type đặt full-snapshot reason.
- Duy trì baseline content-hash index và không replay event theo thứ tự.
- Baseline index giữ WCS extents mỗi top-level drawable root và local extents cho
  definition. Block-definition change đi qua reverse graph, recompute mọi transformed
  top-level occurrence/nested reference trước khi reduce `modelEmpty/resultExtents`.
  Sync snapshot writer nhận fixed epoch origin, không tự lấy extents min ở fallback.
- Chỉ full database snapshot được làm initial/recovery baseline; selected export
  vẫn là command standalone.
- Ghi package/outbox bằng temp + atomic publish; bounded queue, quota và status.
- Thêm command chẩn đoán read-only, ví dụ `CADWEBSYNCSTATUS`, để xem drawing binding,
  base revision, dirty count, pending outbox và fallback reason.

### Gate thoát pha

- MOVE ba entity tạo đúng ba upsert, giữ nguyên canonical object ID.
- COPY tạo add/upsert mới; ERASE tạo tombstone; append rồi erase trước Save là no-op.
- Eligible Save không semantic change không tạo revision package rỗng.
- No-op QSAVE rồi restart không tạo fallback/revision; abort, AutoSave, SAVE-copy và
  target non-DWG không để orphan journal token hoặc làm mất dirty candidates.
- ESC/cancel không publish trạng thái trung gian.
- U/UNDO/REDO trước Save khớp semantic full snapshot của cùng database.
- AutoSave không tạo package; abortSave không clear dirty.
- MDI không trộn handle/drawing; close document không crash/leak.
- QSAVE rồi CLOSE/QUIT vẫn tạo durable package; Don't Save/Cancel không tạo package
  sai. Kill ở mọi crash point tự phục hồi latest saved state bằng full snapshot.
- Restart với complete token + matching sealed outbox chỉ resume upload; token đứt
  hoặc manual discard buộc full snapshot/rebase.
- MOVE/delete object đang giữ global min/max cập nhật `resultExtents`; fallback
  snapshot giữ nguyên origin của epoch.
- Xóa drawable cuối tạo `modelEmpty=true` + zero extents; block definition change
  cập nhật WCS extents của mọi occurrence phụ thuộc.
- Callback p95 chỉ làm bounded bookkeeping; không có network call trong AutoCAD.

## Pha 3 — Local uploader và central revision service

Mục tiêu: durable publish với idempotency, conflict detection và snapshot recovery.

### Phân chia trách nhiệm

`apps/daemon`:

- watch/poll atomic outbox;
- login/token storage ở OS-appropriate secure store;
- upload/retry/backoff;
- expose loopback sync status cho UI;
- không lưu geometry blob lớn trong sql.js chat database.

Service mới, đề xuất `acad-studio/apps/sync-server`:

- tenant/project/drawing ACL;
- drawing binding và monotonic revision head;
- auditable single-writer session/lease cho Release 1;
- idempotent change-set ingestion;
- transactional compare-and-swap `baseRevision` cho cả snapshot và delta;
- immutable blob storage cho snapshot/delta;
- canonical revision state hash và server-generated checkpoint attachment;
- revision metadata/audit trong database;
- HTTP snapshot/delta/head API;
- SSE hoặc WebSocket revision notification.

### API tối thiểu

```text
POST /v1/drawings/:drawingId/snapshots       # writer publish; creates revision
POST /v1/drawings/:drawingId/changesets
POST /v1/drawings/:drawingId/writer-sessions
GET  /v1/drawings/:drawingId/head
GET  /v1/drawings/:drawingId/revisions/:revision
GET  /v1/drawings/:drawingId/revisions/:revision/blob
GET  /v1/drawings/:drawingId/changes?after=:revision
```

### Công việc

- Transaction lock/CAS head cho snapshot lẫn delta; initial snapshot có base 0,
  recovery snapshot có reconciled head; server cấp revision sau commit.
- Authenticate/authorize drawing trước idempotency lookup. Unique
  `(drawing_id, change_set_id|snapshot_id)` lưu request digest bao phủ envelope,
  base/epoch/session và mọi blob hash; retry chỉ trả cùng revision khi digest khớp,
  cùng ID khác digest trả `409 idempotency_key_reused`.
- Verify active `writerSessionId`; head thuộc session khác thì dừng auto-publish và
  yêu cầu lease/rebind/manual resolve, không tự snapshot-overwrite.
- `409 revision_conflict` trả head/model epoch/session. Same-session lost ACK hoặc
  stale local head được reconcile rồi có thể snapshot fallback bằng CAS. Foreign
  session phải dừng/manual lease-rebind resolve, không tự đè.
- Publish event chỉ sau database commit và blob durable.
- Ordered outbox cho offline; quota/backpressure và manual retry/discard có audit;
  discard bắt buộc đánh full snapshot/rebase cho generation kế tiếp.
- MVP giới hạn một publish chưa ACK mỗi drawing. Save tiếp theo trong lúc trạng thái
  server chưa chắc chắn được compact thành latest full snapshot sau khi reconcile
  head; không phát hai delta có cùng `baseRevision`.
- Server checkpoint job materialize full canonical state của revision hiện hữu,
  verify `stateHash/modelEpoch`, rồi attach atomically mà không tăng head, không push
  event và không yêu cầu writer lease. Đây không phải `POST .../snapshots`.
- Checkpoint/retention job theo config; không xóa delta chain trước khi checkpoint
  tương đương đã durable và semantic-verified.
- Metrics: ingest latency, conflict, retry, blob bytes, snapshot fallback count.

### Gate thoát pha

- Gửi cùng change set 10 lần chỉ tạo một revision.
- Gửi cùng snapshot 10 lần chỉ tạo một revision; stale snapshot trả 409 và không đổi
  head/model epoch.
- Cùng changeSetId/snapshotId nhưng đổi một byte, base hoặc epoch trả
  `idempotency_key_reused`; unauthorized drawing không được oracle qua lookup.
- Hai request cùng base chỉ một request thắng CAS.
- Foreign writer session conflict không tạo snapshot/head mới và hiện trạng thái cần
  manual resolve.
- Kill server giữa upload/commit không tạo head trỏ tới blob thiếu.
- Mất mạng không ảnh hưởng Save; restart daemon tiếp tục outbox.
- Nhiều Save khi offline phục hồi đúng latest saved state, không tạo revision chain
  có base sai; intermediate offline history được ghi rõ là ngoài MVP.
- ACL chặn cross-project drawing; package limits được kiểm trước decode lớn.
- Viewer reconnect có thể tìm head đúng dù bỏ lỡ mọi push event.
- Checkpoint reconstruct đúng canonical `stateHash/modelEpoch` của revision nguồn,
  không tăng head; viewer load checkpoint + tail delta bằng semantic state head.

## Pha 4 — Viewer incremental

Mục tiêu: viewer apply entity delta nguyên khối và chỉ tải snapshot khi cần.

### Công việc

- Mở rộng worker protocol:

```text
loadSnapshot(snapshot, revision, modelEpoch)
applyDelta(delta)
resetToSnapshot(snapshot)
```

- Worker giữ canonical maps:

```text
entitiesById
blocksById
layersById
blockReferencesByDefinitionId
blockDefinitionDependencies
renderCacheByStableId
```

- Validate `drawingId`, canonical object key, `baseRevision`, `modelEpoch`, checksum,
  `modelEmpty/resultExtents` và reference graph trước mutation.
- Stage reducer trên copy/journal; chỉ commit cả revision khi mọi op hợp lệ.
- Rebuild render data của affected layer/chunk; block definition change invalidates
  mọi reference transitive.
- Commit `resultExtents` cùng revision; fit-to-view/camera không dùng extents của
  revision trước; `modelEmpty` bỏ qua zero box. Origin chỉ đổi khi reset sang model
  epoch mới.
- Preserve selection/hover theo stable ID nếu object còn tồn tại.
- Push listener chỉ gọi head/delta API; reconnect luôn reconcile head.
- Nếu delta chain thiếu, quá xa, version không hỗ trợ hoặc apply lỗi: fetch snapshot.

### Gate thoát pha

- MOVE/COPY/ERASE thấy trên hai viewer mà không tải lại `.cadweb` full.
- Viewer không render revision 128 nếu một op của change set 128 lỗi.
- Event duplicate/out-of-order không làm revision lùi hoặc apply hai lần.
- Viewer từ revision 120 vào lại head 128 bằng delta chain hoặc một snapshot đúng.
- Tombstone dùng key của delta xóa đúng object từ snapshot 1.1; MOVE/delete object
  biên cập nhật fit-to-view mà không đổi epoch origin.
- Xóa drawable cuối không fit zero box; block change recompute WCS bounds của mọi
  occurrence trước atomic revision swap.
- Block definition update không cần gửi N bản geometry theo N reference.
- Không nhánh render theo producer Windows/Mac.

## Pha 5 — Layer, block, Undo/Redo và hardening

Mục tiêu: xử lý các invalidation lớn mà vẫn đúng semantics.

### Công việc

- Mở rộng contract giữ property source mode `ByLayer | ByBlock | Explicit` cho
  color, transparency, lineweight và linetype.
- Bổ sung reverse dependency layer/style -> entity và block definition -> nested
  definition/reference.
- Xử lý dynamic/anonymous block, attribute owner và layer 0/ByBlock fixtures.
- Chạy event/reconciliation matrix cho:
  - MOVE -> Save -> Undo -> Save -> Redo -> Save;
  - COPY -> Undo/Redo;
  - ERASE -> Undo/Redo;
  - block editor/refedit;
  - layer rename/color/freeze/off;
  - draw order/style/table changes.
- Hardening journal/outbox qua plug-in crash, daemon crash, AutoCAD close và machine
  restart.
- Semantic diff mỗi revision delta-applied với một independent full snapshot.

### Gate thoát pha

- Mọi case trên tạo canonical state bằng full snapshot cùng revision.
- Đổi layer color chỉ làm entity ByLayer đổi; explicit/ByBlock giữ đúng semantics.
- Nested block invalidation không cycle/vượt depth budget.
- Plugin unload/close MDI không use-after-free, stale pointer hoặc orphan reactor.
- Full snapshot fallback có reason/audit và không làm viewer giữ state nửa cũ nửa mới.

## Pha 6 — Bật command-ended sync

Mục tiêu: command kết thúc thì viewer cập nhật, không cần Save.

Chỉ bắt đầu sau khi phase 5 đạt. Cơ chế dùng cùng delta/revision protocol, thêm
trigger `command-ended` và per-command staging/depth.

### Công việc

- Theo dõi outer command depth; không publish mỗi nested/transparent callback.
- `commandEnded` thành công -> reconcile/apply một change set.
- `commandCancelled`/`commandFailed` -> discard staging hoặc reconcile final state,
  tuyệt đối không publish intermediate state.
- Coalesce event storm và serialize publisher per drawing.
- UI phân biệt `saved revision` và `working revision` nếu product vẫn cần biết trạng
  thái chưa Save vào DWG.

### Gate thoát pha

- MOVE/STRETCH/COPY/ERASE cập nhật sau outer command, nguyên khối.
- ESC không tạo revision sai.
- UNDO group/mark và command nested không tách transaction tùy tiện.
- Save sau working revision không tạo duplicate semantic revision.

## Pha 7 — Xref và live editing

Hai track độc lập, không ghép vào MVP.

### Xref

- MVP nâng cao: attach/detach/reload/unload/restore invalidates dependency subtree.
- Server giữ graph `host drawing -> referenced drawing revision`.
- External child change không tự coi là loaded; chỉ publish sau Reload/Reopen hoặc
  freshness workflow có user-safe reload.
- Identity occurrence gồm reference instance path.
- Test nested, unresolved, circular, same Xref inserted nhiều lần và source đổi khi
  host đang mở.

### Live drag

Chỉ làm khi có product requirement và SLO rõ. Track riêng phải giải quyết transient
geometry, cancel/ESC, packet ordering, throttle, locks và rollback. Event live không
được ghi thành durable revision cho đến commit boundary.

## Ma trận kiểm thử bắt buộc

| Nhóm | Cases tối thiểu |
|---|---|
| Entity | LINE, LWPOLYLINE bulge/width, ARC, CIRCLE, TEXT, MTEXT, BLOCKREFERENCE/attribute |
| Operation | MOVE, STRETCH, COPY, ERASE, CHANGE layer/property, PASTE/INSERT |
| Transition | add-delete, delete-undo, modify-revert, multiple modify trước Save |
| Command | success, ESC/cancel, fail, nested/transparent, UNDO group |
| Save | QSAVE, SAVE-copy, first Save, SAVEAS DWG/DXF/DWT/DWS, AutoSave, abort/fail, API save |
| Document | two+ MDI docs, switch/close/reopen, CLOSE/QUIT Save/Don't Save/Cancel, plug-in unload/reload |
| Aggregate | layer/style, block definition, nested/dynamic block, draw order |
| Xref | attach/detach/reload/unload, missing/nested/same source multi-instance |
| Network | offline, retry, duplicate, conflict, out-of-order push, reconnect/gap |
| Security | malformed ZIP, checksum, path traversal, bomb/limits, unauthorized drawing |
| Platform | cùng fixture trên Windows/Mac, Intel/Apple Silicon theo support matrix |

Oracle chính là semantic equality với full snapshot độc lập, không phải chỉ kiểm
`changedHandles` hay số callback.

## SLO đề xuất để benchmark

Đây là target ban đầu, chỉ chốt sau P0/P4 benchmark:

- reactor bookkeeping p95 dưới 1 ms/callback;
- thêm latency vào Save dưới 250 ms khi <= 100 entity phase 1 thay đổi;
- save-to-visible p95 dưới 2 giây trên mạng nội bộ/test environment;
- không network I/O trên AutoCAD UI thread;
- viewer apply 100 entity delta dưới một frame budget dài (mục tiêu 100 ms ở worker,
  UI vẫn responsive);
- viewer gap và same-session lost-ACK conflict phục hồi tự động; foreign-session
  conflict dừng an toàn với trạng thái/action rõ, không snapshot-overwrite.

Không tối ưu 60 fps live drag trong các SLO này.

## Risk register

| Rủi ro | Mức | Mitigation/gate |
|---|---:|---|
| Missed/ambiguous reactor event | Cao | Candidate + reconciliation; unknown -> full snapshot; semantic diff oracle |
| Use-after-free khi MDI close | Cao | Per-document ownership, detach tại `documentToBeDestroyed`, stress test |
| Client/server revision lệch | Cao | Server CAS, idempotency, durable outbox, snapshot fallback |
| Layer inheritance bị flatten | Cao | Contract source mode trước layer delta; fallback snapshot |
| Viewer flat GPU buffers | Trung bình/Cao | Canonical maps + chunk/layer rebuild trước surgical allocator |
| SAVEAS/copy trùng drawing ID | Cao | Explicit binding/fork policy và fingerprint guard |
| Snapshot v1 ID không khớp delta | Cao | Sync snapshot 1.1 + canonical key; không revision hóa selected/v1.0 trực tiếp |
| Crash/close sau Save trước outbox | Cao | Durable save journal + seal-before-destroy + kill-point tests |
| Stale snapshot ghi đè head | Cao | Snapshot CAS/idempotency + single-writer session/lease |
| Idempotency key bị reuse khác payload | Cao | Stored request digest compare; mismatch reject |
| Server checkpoint làm đổi history | Cao | Attach theo revision/stateHash; không tăng head/push |
| Extents/origin drift | Cao | Revision `resultExtents`; fixed origin theo model epoch |
| Xref source đổi ngoài host | Cao | Reload/Reopen policy; dependency graph phase riêng |
| AutoCAD bị block bởi encode/network | Cao | Bounded DTO capture; serialize/upload ngoài callback/UI thread |
| Windows/Mac semantic drift | Cao | Shared core/adapter, cross-read golden và runtime fixture hai host |
| Dirty worktree làm lẫn baseline | Trung bình | Commit snapshot v1 riêng trước implementation delta |

## Definition of Done cho Release 1 — Save Sync

Release chỉ được gọi là hoàn tất khi:

- eligible Save có semantic change tạo đúng một server revision hoặc idempotent
  retry; no-op Save tạo 0 revision và restart không biến nó thành crash fallback;
- MOVE/COPY/ERASE phase-1 entity cập nhật viewer không tải full snapshot;
- layer/block/unsupported change cập nhật đúng bằng delta đã hỗ trợ hoặc full fallback;
- Undo/Redo/ESC và MDI qua semantic full-snapshot oracle;
- offline/reconnect/revision gap tự phục hồi;
- Save-on-CLOSE/QUIT và crash ở mọi điểm trước outbox không làm mất latest saved
  state;
- Windows và Mac cùng fixture cho kết quả tương đương;
- không crash/leak reactor trong stress lifecycle;
- auth/ACL, package validation, metrics và publish status có vận hành tối thiểu;
- tài liệu support nói rõ AutoSave, SAVEAS, Xref và unsupported scope.

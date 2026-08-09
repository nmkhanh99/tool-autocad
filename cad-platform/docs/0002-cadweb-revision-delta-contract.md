# ADR 0002: Đồng bộ CadWeb theo revision và delta sau khi Save

- Trạng thái: **proposed; đã kiểm chứng API, chưa qua runtime spike trong hai host**
- Ngày: 2026-08-09
- Phạm vi: AutoCAD đầy đủ trên Windows/macOS, một CAD writer và nhiều viewer
- Phụ thuộc: [ADR 0001 — CadWeb v1 snapshot](0001-cadweb-v1-contract.md)

## Quyết định

CadWeb sẽ giữ hai contract độc lập nhưng tương thích:

1. `.cadweb` là snapshot đầy đủ, dùng để khởi tạo, phục hồi và compact lịch sử.
2. `.cadwebdelta` là change set bất biến, áp dụng nguyên khối từ một revision nền.

MVP chỉ publish sau một **eligible Save** thành công của drawing DWG đã được bind;
policy cụ thể nằm ở mục Save boundary. Reactor chỉ thu thập candidate key; không
upload mạng và không giữ `AcDbObject*`. Sau Save, plug-in đối chiếu trạng thái cuối
với baseline đã publish, sao chép dữ liệu sang DTO thuần, ghi
outbox bền vững, rồi helper ngoài process upload. Server là nơi duy nhất cấp revision.

```text
AutoCAD document
  ├─ AcDbDatabaseReactor: candidate handles/categories only
  ├─ beginSave/saveComplete: eligible-save lifecycle
  └─ bounded read transaction: AcDb* -> immutable DTO
                           │
                           ▼
                 atomic local outbox
                           │
                    Acad Studio daemon
                  retry/auth/backpressure
                           │
                           ▼
               revision service (CAS + blobs)
                           │
                  push revision available
                           │
                           ▼
             viewer fetches and atomically applies
```

Đây là quyết định **GO có điều kiện** cho MVP `Save -> app cập nhật`. Không có
blocker ở API ObjectARX. Tuy nhiên, hệ thống production không phải chỉ thêm vài
callback: correctness qua Undo/Redo, layer/block inheritance, MDI, Save As,
reconnect và snapshot recovery là phần việc đáng kể.

## Kết quả kiểm chứng kỹ thuật

| Nhận định ban đầu | Kết quả | Diễn giải chính xác |
|---|---:|---|
| `AcDbDatabaseReactor` biết object append/modify/erase | Xác nhận | Có `objectAppended`, `objectModified`, `objectErased`; callback áp dụng cho mọi `AcDbObject`, không chỉ entity. |
| Database reactor có `reappended()` | Cần sửa tên | Database-level là `objectUnAppended()` và `objectReAppended()`; `unappended()`/`reappended()` là tên object-level. |
| `objectModified()` phát khi object đóng sau write-open | Chỉ đúng một phần | Mô tả write-open, `assertWriteEnabled()` và close thuộc `AcDbObject::modified()`. Tài liệu database-level chỉ bảo đảm object vừa hoàn tất thao tác sửa. |
| `commandEnded()` là điểm gom transaction | Xác nhận có điều kiện | Đây là command completion signal, không phải database commit log. Entity cuối có thể vẫn read-open; transaction mở trong callback phải kết thúc trước khi return. |
| `saveComplete()` báo save thành công | Xác nhận | Callback có `pDwg` và tên file thực tế. Nó thuộc `AcRxEventReactor` và được expose/override qua `AcEditorReactor`, không thuộc `AcDbDatabaseReactor`. |
| `saveComplete()` đồng nghĩa Ctrl+S | Không | AutoSave cũng đi qua save lifecycle. `beginSave()` cho phép nhận biết tên `.sv$`; phải lọc theo policy. |
| Handle dùng làm ID bền vững | Xác nhận | Handle tồn tại qua session nhưng chỉ unique trong một database. Có thể resolve bằng `getAcDbObjectId(..., false, handle)`. |
| `reappended` giải quyết Undo/Redo | Không đầy đủ | Nó chỉ bảo đảm REDO của một append đã bị UNDO. Erase/unerase dùng `objectErased(..., true/false)`; Undo của MOVE/property cần reconciliation và host test. |
| Cùng kiến trúc dùng được trên Mac | Xác nhận có điều kiện | ObjectARX và các reactor lõi có trên Mac, nhưng Autodesk không bảo đảm toàn bộ Windows API có parity. Dùng chung protocol/core; build, package và platform adapter riêng. |
| Save host đủ để Xref mới nhất xuất hiện | Không | Xref là database/dependency graph riêng. File con đổi bên ngoài chỉ được phản ánh sau Reload/Reopen hoặc một freshness workflow riêng. |

Nguồn Autodesk chính thức:

- [Programming interfaces hỗ trợ trên Windows/macOS, AutoCAD 2027](https://help.autodesk.com/cloudhelp/2027/ENU/AutoCAD-Customization/files/GUID-E6429154-36DF-4D84-8ABC-9FCA15B66158.htm)
- [AcDbDatabaseReactor trên macOS](https://help.autodesk.com/cloudhelp/2026/ENU/OARXMAC-RefGuide/files/OARXMAC-RefGuide-AcDbDatabaseReactor.html)
- [`objectAppended`](https://help.autodesk.com/cloudhelp/2026/ENU/OARXMAC-RefGuide/files/OARXMAC-RefGuide-AcDbDatabaseReactor__objectAppended_AcDbDatabase__AcDbObject_.html), [`objectModified`](https://help.autodesk.com/cloudhelp/2026/ENU/OARXMAC-RefGuide/files/OARXMAC-RefGuide-AcDbDatabaseReactor__objectModified_AcDbDatabase__AcDbObject_.html), [`objectErased`](https://help.autodesk.com/cloudhelp/2026/ENU/OARXMAC-RefGuide/files/OARXMAC-RefGuide-AcDbDatabaseReactor__objectErased_AcDbDatabase__AcDbObject__bool.html)
- [`objectUnAppended`](https://help.autodesk.com/cloudhelp/2026/ENU/OARXMAC-RefGuide/files/OARXMAC-RefGuide-AcDbDatabaseReactor__objectUnAppended_AcDbDatabase__AcDbObject_.html), [`objectReAppended`](https://help.autodesk.com/cloudhelp/2026/ENU/OARXMAC-RefGuide/files/OARXMAC-RefGuide-AcDbDatabaseReactor__objectReAppended_AcDbDatabase__AcDbObject_.html)
- [`AcDbObject::modified()` lifecycle](https://help.autodesk.com/cloudhelp/2018/ENU/OARX-RefGuide/files/OREF-AcDbObject__modified_AcDbObject_.html)
- [`AcEditorReactor::commandEnded()` trên macOS](https://help.autodesk.com/cloudhelp/2026/ENU/OARXMAC-RefGuide/files/OARXMAC-RefGuide-AcEditorReactor__commandEnded_ACHAR_.html)
- [`beginSave()`](https://help.autodesk.com/cloudhelp/2026/ENU/OARXMAC-RefGuide/files/OARXMAC-RefGuide-AcEditorReactor__beginSave_AcDbDatabase__ACHAR_.html) và [`saveComplete()`](https://help.autodesk.com/cloudhelp/2026/ENU/OARXMAC-RefGuide/files/OARXMAC-RefGuide-AcEditorReactor__saveComplete_AcDbDatabase__ACHAR_.html)
- [ObjectId, handle và `getAcDbObjectId()`](https://help.autodesk.com/cloudhelp/2022/ENU/OARX-DevGuide/files/GUID-0A020C24-EE38-4BDA-8D46-4B326B63F3C6.htm)
- [Notification use guidelines](https://help.autodesk.com/cloudhelp/2018/ENU/OARX-DevGuide/files/GUID-80825422-6512-414B-86B3-36FAA46866D0.htm)
- [Theo dõi lifecycle document/database đúng cách](https://help.autodesk.com/cloudhelp/2022/ENU/OARX-DevGuide/files/GUID-925C090F-C90F-4F1E-91F7-E39FF48E5655.htm)
- [Xref trên ObjectARX macOS](https://help.autodesk.com/cloudhelp/2026/ENU/OARXMAC-DevGuide/files/GUID-54C4F6C3-EFB1-4CA8-AC2F-018862C1D9A7.htm) và [reload Xref trong AutoCAD](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-MAC-Core/files/GUID-665F9850-0B24-4F7C-9CE1-E5706E89E479.htm)

Header ObjectARX 2027 đang cài trên máy phát triển cũng xác nhận chữ ký ở
`rxevent.h`, `aced.h` và `dbmain.h`. Header SDK đích, không phải tài liệu của một
release cũ, là nguồn chuẩn khi biên dịch vì một số release dùng `bool`, release cũ
dùng `Adesk::Boolean`.

## Phạm vi MVP

MVP cam kết:

- AutoCAD 2027 đầy đủ trên Windows x64 và macOS Intel/Apple Silicon;
- một writer đang chỉnh một drawing, nhiều viewer chỉ đọc;
- full snapshot ban đầu;
- eligible Save thành công trên drawing đã bind và có semantic change thì tạo
  revision mới; no-op Save tạo 0 revision;
- incremental upsert/delete cho tập entity CadWeb phase 1 hiện có;
- revision apply nguyên khối, reconnect/gap thì phục hồi bằng snapshot;
- upload lỗi không làm hỏng hoặc rollback thao tác Save trong AutoCAD.

MVP chưa cam kết:

- collaboration từ nhiều AutoCAD writer trên cùng drawing;
- live geometry trong lúc grip edit/drag;
- publish AutoSave;
- Xref entity-level delta;
- fidelity đầy đủ cho hatch, dimension, annotative/proxy/custom entity;
- object-level GPU patch trong mọi trường hợp metadata/block thay đổi.

Layer, block, style, layout, Xref hoặc object type không biểu diễn được phải tạo
fallback rõ ràng, không được bỏ qua im lặng. Fallback của MVP là full snapshot của
revision mới.

Initial, recovery và compaction snapshot của một revision lineage luôn là **full
supported database model**. `CADWEBEXPORTSELECTED`/selected `.cadweb` là artifact
standalone, không được bind làm revision baseline: object ngoài selection bị omit và
origin hiện cũng phụ thuộc selected extents. Subset sync chỉ được thêm khi có
filter/subset identity và baseline semantics riêng.

## Identity

### Drawing và object

Wire identity tối thiểu là:

```text
drawingId / objectKind / sourceHandle
```

- `drawingId` là UUID của lineage trên server, không phải đường dẫn file.
- `sourceFingerprint` từ DWG được gửi kèm như guard chống gắn nhầm drawing.
- `sourceHandle` là handle AutoCAD chuẩn hóa uppercase, không có `0x`.
- `ObjectId` chỉ được giữ tạm trong edit session và không bao giờ đi lên wire.
- Khi resolve handle, luôn gọi `getAcDbObjectId` với `createIfNotFound=false`.

Identity này phải giống nhau trong snapshot và delta. Snapshot v1.0 hiện dùng
`drawingFingerprint:handle` (và biến thể `:layer:`/`:block:`) làm `id`, nên **không
được** dùng trực tiếp làm revision 0 cho reducer delta. Save Sync yêu cầu snapshot
contract 1.1 với:

```text
syncBinding = drawingId + modelEpoch + snapshotId + baseRevision
objectKey   = objectKind + ":" + normalizedSourceHandle
```

`objectKind` ở đây là namespace contract (`entity`, `layer`, `block`...), không phải
tên DXF như `LINE` hay `LWPOLYLINE`.

`drawingId` nằm ở envelope; mọi entity/layer/block dùng `objectKey` canonical làm
ID và reference. Layer 1.1 phải có `sourceHandle` riêng thay vì buộc reader parse ID
v1.0. Binding service cấp `drawingId` trước initial export; client gửi
`baseRevision=0`, server mới cấp revision 1. Snapshot recovery dùng head đã ACK làm
`baseRevision`. Archive v1.0 chỉ được mở read-only hoặc migrate/re-export sang 1.1;
không suy đoán tombstone mapping từ fingerprint string.

Server-generated checkpoint dùng cùng object keys nhưng envelope khác, không giả làm
writer publish:

```text
checkpointBinding = drawingId + modelEpoch + checkpointId + revision + stateHash
```

`getFingerprintGuid()` hiện đã được exporter dùng, nhưng không được mặc định coi
nó là product-level `drawingId`. Copy file, `SAVEAS`, `WBLOCK` và template có thể
tạo semantics lineage khác nhau. Cho đến khi host matrix chứng minh policy, MVP:

1. không publish drawing chưa được lưu/bind;
2. phát hiện actual filename/fingerprint thay đổi;
3. dừng auto-publish và yêu cầu fork/rebind, mặc định tạo lineage mới để tránh hai
   file độc lập ghi chung revision history.

### Block và Xref occurrence

Definition trong cùng database dùng `drawingId + handle`. Một occurrence Xref hoặc
block lồng nhau cần thêm instance path:

```text
hostDrawingId / reference-handle-path / definitionDrawingId / definitionHandle
```

Chỉ `host drawing UUID + child handle` không phân biệt được cùng Xref được insert
nhiều lần hoặc qua nhiều nhánh nested Xref.

## Change tracking

### State phải theo document/database

Không dùng một global dirty set. Mỗi `AcApDocument`/`AcDbDatabase` có:

```text
ChangeTrackerState
├── drawing binding + last acknowledged revision
├── candidate keys grouped by kind
├── published content-hash index
├── durable save lifecycle token + last published source evidence
├── ordered local outbox state
└── requiresFullSnapshot + reason set
```

Khi plug-in load, nó khởi tạo state cho mọi document đang mở và nghe
`documentCreated()`. Nó tháo reactor và hủy per-document state trong
`documentToBeDestroyed()` khi database vẫn còn sống. Đây là yêu cầu correctness;
repo đã từng có crash do gọi `removeReactor` trên database đã bị hủy.

State khôi phục phải fail closed. `beginSave` ghi một journal record nhỏ, atomic và
durable, chứa binding, save token, intended target và last acknowledged
revision/fingerprint/version/file evidence. State machine tối thiểu:

```text
begun
  ├─ abort/ineligible -> locally-closed (dirty candidates vẫn giữ nếu cần)
  └─ saveComplete -> capture-pending
       ├─ hash == trusted ACKed baseline -> verified-noop -> locally-closed
       └─ semantic change -> sealed-publish-required -> server-acknowledged
```

`verified-noop` được persist atomic cùng last-observed saved file/version evidence,
nhưng không đổi last-acknowledged revision/model baseline và không tạo outbox item.
Transition này chỉ hợp lệ khi không có generation trước đang chờ ACK và final hash
khớp trusted ACKed baseline; nếu còn pending publish thì đi theo offline compaction/
reconciliation, không gọi là no-op.
`aborted`/`ineligible` cũng là terminal local rõ ràng; SAVEAS cần rebind chuyển sang
`rebind-required` thay vì để orphan token. Chỉ `sealed-publish-required` cần matching
outbox và **server ACK** để advance published baseline rồi xóa item/token.

Sau restart, sealed item khớp token thì chỉ resume upload. Token `begun`/
`capture-pending`, publish-required không có matching sealed item, file evidence đổi
không giải thích được, manual discard, hoặc attach không có trusted baseline đều đặt
`requiresFullSnapshot/rebase`. Crash trước khi persist `verified-noop` cũng fallback;
crash sau marker thì không. Không được suy ra “không có candidate nghĩa là không có
thay đổi”.

### Callback chỉ ghi candidate

Các callback sau chỉ sao chép handle, class/category hint, owner hint và trạng thái
erase nếu có:

```cpp
objectAppended(...)
objectModified(...)
objectErased(..., bool bErased)
objectUnAppended(...)
objectReAppended(...)
headerSysVarChanged(...)
```

Không callback nào được:

- giữ `AcDbObject*` sau khi return;
- gọi HTTP/WebSocket/TLS;
- ghi package lớn;
- gọi `acedCommand`, `acedGetPoint` hoặc tương tác user;
- giả định thứ tự notification ngoài những cặp Autodesk bảo đảm.

`commandCancelled()` và `commandFailed()` cũng phải được xử lý. Với Save-only,
candidate từ command lỗi được giữ như false positive và bị reconciliation loại bỏ.
Khi bật command-based sync, mỗi outer command cần staging riêng; cancel/fail không
được publish như một transaction thành công.

Database-level API không có callback tương đương object-level `modifyUndone()`.
Vì vậy `U`, `UNDO` và `REDO` phải đặt `requiresFullScan` (hoặc
`requiresFullSnapshot` trong MVP) cho document hiện hành, trừ khi runtime matrix của
đúng SDK chứng minh dirty coverage đầy đủ. `objectReAppended()` chỉ tối ưu được REDO
của append; nó không được dùng làm bằng chứng rằng Undo của MOVE/property đã được
đưa vào candidate set.

### Reconciliation, không replay callback

Reactor là invalidation hint, không phải durable change log. Tại publish boundary,
mỗi candidate được resolve lại và so với hash của revision nền:

| Baseline | Trạng thái cuối | Wire op |
|---|---|---|
| không có | tồn tại | upsert/add |
| có | tồn tại, hash đổi | upsert/update |
| có | không còn/erased | delete tombstone |
| không có | không còn | no-op |
| có | tồn tại, hash như cũ | no-op |

Nhờ đó `append -> erase`, `erase -> unerase`, Undo/Redo hoặc ESC không cần reducer
dựa hoàn toàn vào thứ tự callback. Nếu không resolve hoặc không phân loại an toàn,
đánh `requiresFullSnapshot`; không đoán.

Các object con phải bubble tới aggregate root của contract:

- attribute thay đổi -> dirty owning block reference;
- entity trong block table record -> dirty block definition;
- nested block definition -> invalidation truyền ngược qua dependency graph;
- style/table/sortents/unknown object -> metadata delta khi đã hỗ trợ, nếu chưa thì
  full snapshot.

## Save boundary

Eligible Save policy của Release 1:

| Trường hợp | Publish policy |
|---|---|
| Ctrl+S/QSAVE một bound `.dwg` | Publish cùng lineage nếu semantic state đổi. |
| First Save của untitled drawing sang `.dwg` | Tạo/bind lineage rồi initial full snapshot. |
| SAVEAS sang `.dwg` | Dừng auto-publish, yêu cầu fork/rebind; mặc định lineage mới. |
| SAVE trên drawing đã có tên | Đây là lệnh tạo copy nhưng giữ current drawing; không publish copy hoặc đổi binding tự động. |
| SAVE/SAVEAS sang DXF/DWT/DWS hoặc target khác `.dwg` | Không publish; ngoài contract Save Sync. |
| AutoSave `.sv$` | Không publish. |
| API-driven save | Ngoài cam kết Release 1 cho đến khi provenance/callback matrix được chốt. |

Autodesk phân biệt rõ [`SAVE`](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-Core/files/GUID-155255B4-ADFA-4C21-958F-601DE09260EB.htm), lệnh có thể ghi copy mà không đổi current drawing, với [`SAVEAS`](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-Core/files/GUID-1FF801F9-7FEE-4494-854D-4704A7784232.htm), lệnh làm tên mới thành current drawing. SAVEAS còn có thể ghi [DWG/DWS/DXF/DWT](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-Core/files/GUID-E2CEA3F2-43CA-41D0-A2C6-BACF2229715A.htm), nên chỉ nhìn actual filename thay đổi là không đủ để quyết định lineage.

MVP ghép ba callback thay vì chỉ nghe tên lệnh:

1. `beginSave(pDwg, pIntendedName)` persist save token và loại `.sv$` theo policy.
2. `saveComplete(pDwg, pActualName)` xác nhận đúng database và persist trạng thái
   `complete/publish-required` trước khi lên lịch capture.
3. `abortSave(pDwg)` persist trạng thái abort; dirty state vẫn còn cho lần save sau.

Không được mặc định chờ outer `commandEnded`: `CLOSE`/`QUIT` có thể Save rồi hủy
document trước callback đó. P0 phải chốt một đường **seal-before-destroy** trên từng
host:

1. ưu tiên capture DTO tạm ở `beginSave`, rồi chỉ atomic-promote sang outbox khi
   `saveComplete`; `abortSave` bỏ DTO tạm; hoặc
2. capture bằng bounded read transaction tại `saveComplete`/document context và
   persist outbox trước khi document bị destroy; hoặc
3. nếu hai cách trên không an toàn, persist recovery marker rồi reopen file vừa Save
   bằng exporter headless đã host-test.

`commandEnded` có thể là đường deferred tối ưu cho QSAVE thông thường chỉ sau khi
đã chứng minh document còn sống; nó không phải điều kiện correctness. Save token +
command/document provenance cùng quyết định eligibility; tên command một mình không
chứng minh save thành công, còn `saveComplete` một mình không phân biệt QSAVE với
SAVE-copy. Đuôi `.sv$` chỉ nhận diện AutoSave. Mọi transaction phải đóng trước khi
callback return.

Runtime spike P0 phải chứng minh trên cả hai host:

- thứ tự `beginSave -> saveComplete/abortSave -> commandEnded` cho QSAVE, SAVE và
  SAVEAS; SAVE-copy phải giữ binding cũ;
- SAVEAS sang DWG/DXF/DWT/DWS và first Save của untitled drawing;
- `CLOSE`/`QUIT` với Save/Don't Save/Cancel, kể cả nhiều MDI document, và thứ tự
  `saveComplete` so với `documentToBeDestroyed`;
- callback của AutoSave và API-driven save;
- khả năng đọc dirty entity khi entity cuối còn read-open;
- DTO đúng với trạng thái vừa được lưu, không vô tình lấy thay đổi của command sau;
- latency khi dirty set nhỏ/lớn.

Nếu API-driven hoặc close-save không có safe command boundary, implementation phải
dùng một đường seal/recovery phía trên; không truy cập `AcDb*` từ worker thread. Mọi
background task chỉ nhận DTO thuần.

## Delta contract

`.cadwebdelta` là ZIP deterministic, áp dụng cùng security profile với `.cadweb`.
Các entry đề xuất:

```text
change.json              bắt buộc
entities.bin             upsert entity, tùy chọn
blocks.bin               upsert block definition, tùy chọn
layers.json              upsert layer, tùy chọn
tombstones.json          delete keys, tùy chọn
export-report.json       bắt buộc
```

`change.json` tối thiểu:

```json
{
  "format": "cadweb-delta",
  "formatVersion": { "major": 1, "minor": 0 },
  "changeSetId": "019...",
  "drawingId": "d91b...",
  "sourceFingerprint": "...",
  "modelEpoch": "01...",
  "baseRevision": 127,
  "trigger": {
    "kind": "qsave",
    "savedAt": "2026-08-09T10:15:30Z"
  },
  "upserts": {
    "entities": 2,
    "blocks": 0,
    "layers": 0
  },
  "deletes": {
    "entities": 1,
    "blocks": 0,
    "layers": 0
  },
  "modelEmpty": false,
  "resultExtents": {
    "min": [0.0, 0.0, 0.0],
    "max": [125.0, 80.0, 12.0]
  },
  "files": {
    "entities": {
      "path": "entities.bin",
      "encoding": "flatbuffers",
      "schemaVersion": 1,
      "byteOrder": "little-endian",
      "size": 824,
      "sha256": "0000000000000000000000000000000000000000000000000000000000000000"
    },
    "tombstones": {
      "path": "tombstones.json",
      "encoding": "json",
      "size": 96,
      "sha256": "1111111111111111111111111111111111111111111111111111111111111111"
    },
    "exportReport": {
      "path": "export-report.json",
      "encoding": "json",
      "size": 128,
      "sha256": "2222222222222222222222222222222222222222222222222222222222222222"
    }
  }
}
```

Các `size`/`sha256` trong ví dụ chỉ minh họa shape; package thật phải ghi giá trị
tính từ đúng payload bytes.

Không có field `revision` do client tự tăng. Server kiểm tra `baseRevision` bằng
compare-and-swap rồi mới trả revision mới. `changeSetId` và content hash là
idempotency key để retry không tạo hai revision.

Schema bắt buộc count dương khi và chỉ khi descriptor tương ứng tồn tại; descriptor
không được trỏ tới entry thiếu/không khai báo. `exportReport` luôn có. Cùng một
canonical key xuất hiện ở cả upsert và tombstone là package invalid, không dựa vào
thứ tự để chọn op cuối.

Wire operation ưu tiên `upsert + tombstone`, thay vì tin nhãn `added/modified` từ
callback. Server và viewer vẫn có thể suy ra add/update bằng baseline. Mỗi payload
phải có size/SHA-256, schema version, giới hạn cấp phát và report như ADR 0001.

`modelEpoch` cố định coordinate frame, units và render origin cho một lineage.
Exporter hiện lấy `origin = payload extents min`; sync writer 1.1 phải nhận origin
đã khóa bởi epoch và dùng lại nó cho mọi fallback snapshot. Không được tự lấy extents
min mới, vì sẽ làm toàn bộ GPU coordinate dịch chuyển. Đổi units/origin hoặc schema
không tương thích tạo snapshot epoch mới.

`resultExtents` là extents authoritative của canonical model sau khi apply toàn
change set. Nếu model rỗng, `modelEmpty=true` và `resultExtents` là canonical zero
box `[0,0,0]..[0,0,0]`; viewer không dùng box đó để fit camera. Snapshot 1.1 dùng
cùng cặp field, giữ tương thích với reader v1 vốn yêu cầu một extents object.

Native baseline index giữ WCS extents của từng top-level drawable aggregate root;
upsert/delete cập nhật index rồi reduce thành extents mới. Khi block definition đổi,
reverse dependency graph phải recompute local definition extents rồi mọi transformed
top-level reference/nested occurrence phụ thuộc; không dùng local block extents như
WCS extents. Viewer chỉ thay extents khi commit nguyên revision. Object không tính
extents an toàn được buộc full snapshot/report; snapshot fallback vẫn giữ epoch
origin cũ. Nhờ đó MOVE/add/delete object đang tạo min/max không để camera/fit-to-view
dùng extents cũ.

`stateHash` là SHA-256 deterministic của `drawingId`, `modelEpoch`, revision-level
metadata (`modelEmpty/resultExtents`) và danh sách canonical object key + content hash
đã sort. Nó không phụ thuộc ZIP byte layout. Server cập nhật state hash trong cùng
transaction publish; checkpoint phải reconstruct lại đúng hash này.

## Revision service

MVP là single-writer, multi-viewer. Cả delta **và writer snapshot publish** đều là
conditional publish, dùng `changeSetId`/`snapshotId`, `drawingId`, `writerSessionId`,
`modelEpoch` và `baseRevision`. Initial snapshot dùng `baseRevision=0`; server tạo
revision 1. Recovery snapshot dùng head mà writer đã reconcile làm base. Không có
API “upload snapshot rồi ghi đè head” vô điều kiện.

Ingestion logic:

```text
authenticate + authorize tenant/project/drawing
enforce upload limits and compute requestDigest(envelope + blob hashes)
BEGIN
  lock drawing head
  verify active single-writer binding/session
  if idempotency id already accepted:
    if constantTimeEqual(requestDigest, storedDigest) -> return existing revision
    else -> 409 idempotency_key_reused
  if request.baseRevision != head.revision -> 409 revision_conflict
  validate package/hash/limits/modelEpoch
  persist immutable blob + revision metadata
  head.revision += 1
COMMIT
publish revision-available event
```

`409` không tự cho phép client rebuild snapshot trên head mới nếu head thuộc writer
session khác. Trường hợp đó dừng auto-publish và yêu cầu lease/rebind/manual resolve.
Trong single-writer MVP, server chỉ cấp một active writer session cho drawing; lease
expiry/recovery phải audit được. Snapshot đổi `modelEpoch` là một transition có CAS
riêng, không phải cách lách conflict.

Idempotency digest bao phủ loại artifact, drawing/session, base revision, model epoch,
canonical envelope và mọi blob hash. Cùng `changeSetId`/`snapshotId` nhưng khác bất
kỳ dữ liệu nào là lỗi reuse, không được silently ACK revision cũ.

Save DWG và publish revision là hai trạng thái độc lập. Network fail không được làm
Save fail. Helper giữ durable ordered outbox, exponential retry và trạng thái UI.
Chỉ xóa một item sau server ACK. Nếu local baseline mất, plugin restart giữa chừng,
same-session lost-ACK/stale-local-head hoặc event coverage không chắc chắn, reconcile
head rồi gửi snapshot mới bằng CAS. Conflict với foreign writer session luôn dừng
auto-publish và yêu cầu lease/rebind/manual resolve; không snapshot-overwrite.

MVP không hứa giữ mọi revision phát sinh khi offline. Mỗi drawing chỉ có một publish
đang chờ ACK. Candidate phát sinh sau lúc seal được giữ ở generation kế tiếp. Nếu user
Save thêm khi item trước chưa có kết quả chắc chắn, helper không tạo hai delta cùng
`baseRevision`: nó reconcile server head rồi publish **latest saved state** bằng full
snapshot. Giữ nguyên mọi intermediate offline Save cần một local parent-change-set
chain riêng và là phase sau. Cách compact này hy sinh lịch sử offline trung gian nhưng
không làm mất trạng thái DWG đã Save gần nhất.

Central service không nên nhét vào `apps/daemon`: daemon hiện bind loopback, có quyền
điều khiển AutoCAD và là security boundary local. Production nên có service riêng,
ví dụ `acad-studio/apps/sync-server`; geometry/archive ở object storage/filesystem,
revision metadata ở transactional database.

## Push và viewer apply

Push chỉ là invalidation, không phải nguồn chân lý. Event nhỏ:

```json
{
  "type": "cadweb.revision.available",
  "drawingId": "d91b...",
  "baseRevision": 127,
  "revision": 128,
  "mode": "delta",
  "changeSetId": "019..."
}
```

Viewer fetch package qua HTTP, validate, rồi:

1. chỉ apply nếu `currentRevision == baseRevision` và `modelEpoch` khớp;
2. stage toàn change set trên canonical maps;
3. cập nhật block/layer reverse dependencies;
4. rebuild/upload các render chunk bị ảnh hưởng;
5. swap revision một lần và `requestRender()`;
6. lỗi/gap thì tải missing chain hoặc snapshot head.

Reconnect luôn gọi `GET head`; không giả định WebSocket/SSE giao đủ hoặc đúng thứ tự.
Vì MVP chỉ cần server -> viewer, SSE hiện có trong repo là đủ về chức năng và đơn
giản hơn. WebSocket vẫn là transport hợp lệ nếu sản phẩm chốt nó; contract revision
không phụ thuộc transport. Live edit hai chiều mới thực sự cần WebSocket.

## Layer và block

### Layer/style

Contract hiện tại resolve ByLayer thành màu cụ thể trên từng entity. Do đó gửi một
layer delta **chưa đủ** để recolor đúng 10.000 entity: viewer không biết entity nào
là ByLayer, ByBlock hay explicit.

Trước khi bật layer-only delta, minor contract phải giữ source mode cho color,
transparency, lineweight và linetype:

```text
ByLayer | ByBlock | Explicit
```

MVP trước thay đổi này có hai lựa chọn đúng: fan-out upsert mọi entity phụ thuộc,
hoặc full snapshot. Mặc định chọn full snapshot để fail closed.

### Block

Block definition + reference separation trong ADR 0001 phù hợp với delta. Khi một
definition đổi, server gửi một definition upsert; viewer invalidates mọi reference
phụ thuộc, kể cả transitive nested block. Không gửi 500 bản geometry giống nhau.

Viewer hiện flatten geometry thành một `Float32Array` cho mỗi layer và chưa có
`stableId -> GPU range`. MVP phải giữ canonical `Map` trong worker và có thể rebuild
layer/chunk bị ảnh hưởng. True surgical GPU replacement cần chunk allocator hoặc
retained scene index; không được mô tả là đã có trong code hiện tại.

## Xref policy

MVP giữ `reference-only` và coi attach/detach/reload/unload/restore là invalidation
của dependency subtree hoặc full snapshot. Không tạo entity delta xuyên Xref.

Manifest dependency tương lai cần ít nhất:

- source drawing identity và content revision/fingerprint;
- resolved/unloaded/missing status;
- reference handle/instance path và transform;
- nested dependency edges;
- path đã sanitize, không lộ absolute path mặc định.

Khi file Xref con bị sửa bởi người khác, host reactor không tự biết content mới.
Policy MVP: chỉ publish content Xref mới sau XREF Reload hoặc reopen host. File
watcher/hash rồi yêu cầu reload là phase sau; Save host đơn thuần không được quảng
cáo là đủ.

## Writer snapshot fallback và server checkpoint

Writer full snapshot publish tạo một revision mới và luôn đi qua writer session,
idempotency digest và `baseRevision` CAS như mục Revision service. Nó bắt buộc khi:

- không có trusted published index;
- dirty class/owner graph không phân loại được;
- metadata/units/origin/model epoch thay đổi;
- candidate set hoặc delta vượt threshold cấu hình;
- same-session conflict đã reconcile, journal/outbox mất hoặc server yêu cầu.

Foreign-session conflict không nằm trong fallback này và phải dừng/manual resolve.

Server compaction checkpoint là operation khác: server materialize canonical state
của **một revision đã tồn tại**, ghi full snapshot kèm `revision`, `modelEpoch` và
canonical `stateHash`, rồi atomically attach checkpoint vào đúng revision nếu hash
khớp. Checkpoint không tăng head, không phát revision event, không cần CAD writer
lease và không dùng writer snapshot API. Job/checkpoint ID vẫn idempotent; mismatch
state/hash phải fail, không được thay history.

Server tạo checkpoint theo số revision, tổng byte delta hoặc tỷ lệ object đổi.
Threshold là operational config sau benchmark, không hard-code vào protocol. Viewer
đang quá xa tải checkpoint gần nhất không vượt head rồi apply phần delta còn lại, hoặc
tải checkpoint tại head nếu có.

## Consequences

Lợi ích:

- Save của AutoCAD và publish web tách failure domain;
- change set nguyên khối, idempotent và recoverable;
- cùng protocol/core cho Windows/macOS;
- revision history mở đường cho compare 2 revision;
- object delta giảm network và parse so với full archive.

Chi phí:

- cần per-document lifecycle và local journal/outbox;
- adapter phải hỗ trợ snapshot từng aggregate root;
- schema phải giữ property inheritance;
- viewer phải chuyển từ load-only sang retained canonical model;
- cần central revision service mới;
- runtime verification hai host là release gate, không thể chứng minh chỉ bằng compile.

## Open decisions trước khi chuyển trạng thái accepted

1. Push MVP dùng SSE hiện có hay WebSocket theo product requirement?
2. Delta ZIP dùng FlatBuffers schema riêng hay tái sử dụng `GeometryBuffer` cho upsert?
3. Seal-before-destroy dùng capture ở `beginSave`, `saveComplete` hay headless recovery
   trên từng host?
4. Policy rollout CadWeb 1.1: old reader được render-only sync snapshot hay phải
   reject artifact có `syncBinding`?
5. Durable journal/outbox path, quota và cleanup policy trên Windows/macOS.
6. Snapshot compaction/retention theo SLO thực tế.
7. Có cần bảo toàn mọi intermediate Save khi offline hay chỉ latest saved state?

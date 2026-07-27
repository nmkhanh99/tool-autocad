# Kiến trúc thư viện block

Tài liệu này mô tả MVP **Thư viện block** đang có trong Acad Studio: catalog metadata,
nguồn hình học, identity nhúng trong AutoCAD và bốn luồng **scan / create / insert /
sync**. Phần cuối ghi rõ các chức năng chưa được triển khai để UI và tài liệu không hứa
quá khả năng hiện tại.

## 1. Mô hình tổng thể

```text
DWG nguồn ── hình học khi insert ───────────────┐
                                                ▼
Catalog JSON ◄── scan/create/insert/sync ── DWG đích
  metadata chuẩn                         BlockTableRecord
  revision lạc quan                      ├─ Description fallback
                                         └─ ACADLIB XRecord

`block.previewImage` ── hiển thị UI   XTP/ảnh source ── artifact chỉ được link path
```

Ba đối tượng cần phân biệt:

1. **Block definition** (`BlockTableRecord`) chứa hình học và định nghĩa attribute.
2. **Block reference** là mỗi lần chèn, có layer, vị trí, scale, rotation và giá trị
   attribute riêng.
3. **Library source** là file cung cấp definition/preview; liên kết nguồn không biến block
   đã chèn thành xref hay cập nhật hình học tự động.

Catalog được lưu theo schema version tại `block-library.v1.json` trong `ACAD_DATA_DIR`;
nếu không cấu hình thì dùng thư mục dữ liệu mặc định của Acad Studio. Mỗi lần ghi tạo một
`revision` nội dung mới khi catalog thay đổi. Các request thay đổi phải gửi revision đã đọc để ngăn một tab cũ ghi đè
catalog mới hơn.

## 2. Source of truth và metadata mapping

| Thứ tự | Nơi lưu | Vai trò |
|---|---|---|
| 1 | Catalog Acad Studio | Dữ liệu chuẩn giàu thông tin: tên hiển thị, mô tả, phân loại, tag, use case, layer, space, source và trạng thái sync |
| 2 | DWG nguồn | Hình học chuẩn khi block có source; catalog chỉ liên kết đường dẫn, không nhúng hình học |
| 3 | XRecord `ACADLIB` trên block definition | Identity bền trong DWG: `schema`, `id`, technical key và revision metadata |
| 4 | `Description`/Comments của block definition | Fallback để app nhận lại `id` khi XRecord thiếu hoặc chưa đọc được |
| 5 | Ảnh và XTP | Artifact hiển thị/tương thích, không phải source of truth |

### Tên và Description

- `technicalName` là key dùng trong AutoCAD và API: ASCII không dấu, bắt đầu bằng chữ
  hoặc số, chỉ dùng chữ, số, `.`, `_`, `-`; so sánh tên không phân biệt hoa thường.
- `displayName` là tên thân thiện cho người dùng, được phép có dấu, ví dụ **Ghế sofa 2 chỗ**.
- `description` là mô tả con người đọc được: mục đích, vị trí dùng và ghi chú kỹ thuật.
- Khi ghi vào AutoCAD, app giữ phần mô tả và thêm một dòng marker ổn định:

  ```text
  Ghế sofa 2 chỗ dùng cho mặt bằng nội thất
  ACADLIB:v1;id=<library-id>
  ```

`ACADLIB` XRecord là identity chính trong DWG; marker ở Description chỉ là fallback. App
không nhét toàn bộ catalog vào Description. Điều này cũng giảm rủi ro mất mapping khi một
luồng `INSERT` từ file khác không bảo toàn Description như mong đợi.

Payload XRecord hiện tại chỉ chứa `schema`, `id`, technical key và revision. Metadata giàu
thông tin vẫn thuộc catalog; revision cho biết bản nhúng trong DWG có khớp catalog không.

## 3. Các trục phân loại độc lập

Không gộp “dynamic”, “attribute” và “annotative” thành một enum duy nhất. Một block có thể
đồng thời là dynamic, có attribute, annotative và chỉ được phép chèn ở layout.

| Trục | Giá trị hiện có | Ý nghĩa |
|---|---|---|
| Kiểu definition | `static` / `dynamic` | Dynamic nói về behavior/parameters của definition |
| Attribute | `hasAttributes` + danh sách definition | Tách biệt với static/dynamic; static block vẫn có thể có attribute |
| Không gian đặt reference | `model`, `layout`, hoặc cả hai | Policy của thư viện, không phải hai bản definition khác nhau |
| Annotative | `annotative` + danh sách scale | Context tỷ lệ của definition/reference, độc lập với ba trục trên |

### Base point

`basePoint` là origin của block definition. Luồng **Tạo block** yêu cầu người dùng chọn
điểm chèn; scan đọc origin hiện có. Cần đặt điểm này tại vị trí dễ bắt điểm và ổn định, ví
dụ tâm thiết bị, mép tường hoặc điểm nối ống. `INSBASE` của file DWG nguồn là khái niệm liên
quan nhưng không thay thế origin của named block bên trong một DWG tổng hợp.

### Layer

`defaultLayer` hiện là layer đặt **BlockReference** khi create/insert. MVP không tự đổi layer
của entity bên trong definition. Quy ước thư viện nên vẽ hình học nội bộ trên Layer 0 và
dùng ByLayer/ByBlock có chủ đích; nếu block nội bộ gắn cứng màu/layer khác, đổi layer của
reference không sửa được các thuộc tính đó.

### Hatch và làm nổi bật

Hatch là nội dung kỹ thuật thì phải nằm trong definition/source DWG và tuân theo layer,
pattern, scale của dự án. MVP chưa quét/validate hatch bên trong definition và không tự
chèn một hatch “highlight” cố định vì nó sẽ tham gia plot và làm đổi hình học. Panel làm
nổi record đang chọn ở UI; validator hatch và highlight tạm trên canvas AutoCAD là hạng
mục riêng cho phase 2.

### Đơn vị

Scan ghi nhận `Block Unit`/insertion units; catalog giữ đơn vị theo tên. API insert nhận
được scale/rotation, nhưng panel MVP chưa có ô nhập nên hiện gửi mặc định scale `1`,
rotation `0` và để AutoCAD áp dụng quy tắc insertion units. Block `Unitless` phải được
review vì kết quả phụ thuộc thiết lập bản vẽ. MVP chưa có bộ kiểm tra/chuyển đổi đơn vị
riêng cho từng source.

### Model, layout và annotative

Block definition nằm trong database và có thể được reference từ model hoặc paper space.
`allowedSpaces` là policy được create/insert kiểm tra tại thời điểm chạy. Scan cũng ghi cờ
annotative và các annotation scale tìm thấy, nhưng create chưa author context annotative
và insert chưa tự bổ sung scale cần thiết cho viewport. Người dùng vẫn phải kiểm tra hiển
thị theo tỷ lệ/layout.

## 4. Nguồn thư viện

| Loại | Cách dùng trong MVP | Lưu ý |
|---|---|---|
| `dwg` | Nguồn hình học để chèn. File độc lập được insert trực tiếp khi basename trùng `technicalName`; trường hợp khác được coi là DWG tổng hợp và cần đúng `sourceBlockName` để app WBLOCK ra cache | Đây là bản sao definition khi insert, không phải liên kết sống |
| `image` | Lưu đường dẫn artifact ảnh | Chưa tự gán vào `block.previewImage`, chưa phục vụ local file qua HTTP và không dùng để dựng hình học |
| `xtp` | Chỉ lưu đường dẫn artifact phục vụ trao đổi Tool Palette trên Windows | Chưa parse/import/export/validate XTP; không phải source of truth native trên Mac |

Source được **link bằng đường dẫn**, không đóng gói vào catalog. Khi di chuyển thư viện,
phải di chuyển DWG/ảnh/XTP theo cấu trúc đã thống nhất hoặc cập nhật lại path. Với block vừa
tạo từ selection mà chưa có DWG nguồn, hình học chỉ đang tồn tại trong DWG đích; nên export
ra DWG nguồn trước khi coi đó là asset dùng chung lâu dài.

Trên macOS dùng Blocks palette bằng `CONTENT` hoặc **Window → Blocks**. XTP chỉ là artifact
tương thích Windows; xem thêm
[TOOLPALETTE.md](../acad-lisp/TOOLPALETTE.md).

## 5. Luồng hiện có

Các endpoint nằm dưới `/api/acad/blocks`. Mọi thao tác CAD yêu cầu resolve đúng document
đích; app không âm thầm fallback sang một DWG active khác. Create/insert/sync metadata yêu
cầu plugin **AcadBridge 1.3.0+** có lệnh native `BLOCKMETA`.

### Scan — `POST /scan`

1. Đọc snapshot read-only của đúng DWG đích.
2. Bỏ qua anonymous block, layout block và xref definition.
3. Đọc tên, handle, Description, ACADLIB metadata, dynamic/attribute, origin, unit,
   annotative scale và số reference.
4. Match theo `ACADLIB.id` trước, Description marker sau, rồi mới tới technical/CAD name.
5. Merge vào catalog và trả report imported/updated/conflict/missing; không sửa DWG.

Snapshot ObjectARX hiện giới hạn 500 block definition và phát warning khi bị cắt. Router
chưa đưa warning đó thành trường riêng trong merge report; với DWG vượt giới hạn, danh
sách `missingCatalogBlockIds` phải được hiểu là chưa quan sát thấy, không phải bằng chứng
definition đã bị xóa.

### Create — `POST /create`

1. Kiểm tra catalog revision, technical name không trùng và space hiện tại được phép.
2. Dùng selection hiện có trong AutoCAD; người dùng chọn base point trong DWG.
3. Tạo block tĩnh hoặc block có attribute bằng `-BLOCK`, tạo/gắn `defaultLayer` cho
   reference được sinh ra.
4. Đọc lại snapshot rồi ghi Description + `ACADLIB` XRecord vào definition.
5. Lưu metadata đã xác nhận về catalog và đánh dấu `synced`.

Create không author dynamic block và không overwrite definition cùng tên.

### Insert — `POST /insert`

1. Nếu definition đã có trong DWG đích, dùng chính definition đó; không redefine.
2. Nếu chưa có, lấy DWG nguồn. Với DWG tổng hợp, app trích đúng named block ra file cache.
3. Kiểm tra model/layout, đặt current layer, yêu cầu điểm chèn và chạy `-INSERT`; panel
   hiện dùng scale `1`, rotation `0`.
4. Đọc lại definition. Definition mới/legacy chưa có identity được ghi Description +
   XRecord; definition cùng ID nhưng revision cũ vẫn được chèn song được giữ trạng thái
   `outdated` để người dùng review hoặc chủ động chạy Sync.

Trong MVP, `ATTREQ=0` và `ATTDIA=0` trong lúc insert rồi được khôi phục. Vì vậy attribute
instance nhận giá trị mặc định; chưa có form/prompt nhập giá trị riêng cho từng reference.

### Sync AutoCAD — `POST /sync`

1. Definition phải tồn tại trong DWG đích; nếu chưa có, người dùng phải **Chèn** trước.
2. App xác minh identity/tên definition và cập nhật tên CAD/số reference quan sát được.
3. App đẩy Description + `ACADLIB` XRecord từ catalog vào definition rồi cập nhật trạng
   thái/revision catalog; Description cũ trong CAD không ghi đè mô tả mới của app.

`sync` hiện chỉ đồng bộ **Description và identity/revision ACADLIB**. Nó không áp policy
catalog vào layer của reference, base point, unit, allowed space, annotative context,
attribute definition/value; cũng không pull/push hình học, redefine block hay chạy
`ATTSYNC`. Muốn cập nhật các thuộc tính definition đọc từ CAD vào catalog, dùng Scan.

### Sửa metadata — `PUT /:id`

Cho phép cập nhật record catalog với revision hiện tại. Thay đổi catalog chưa tự chảy vào
mọi DWG; cần chạy Sync trên từng bản vẽ đích có definition tương ứng.

## 6. Trạng thái và duplicate report

| Trạng thái | Ý nghĩa |
|---|---|
| `local_only` | Record chỉ có trong catalog hoặc chưa được xác nhận trong DWG đích |
| `cad_only` | Definition vừa scan từ CAD nhưng chưa có identity/revision khớp catalog |
| `synced` | ACADLIB identity và revision trong DWG khớp metadata catalog |
| `outdated` | Cùng identity nhưng revision khác |
| `conflict` | Identity/key mâu thuẫn hoặc cùng technical name thuộc các record khác nhau |

Trạng thái hiện phản ánh **bản vẽ đích được scan/sync gần nhất**, chưa phải ma trận trạng
thái đồng thời của mọi DWG trong một dự án.

Duplicate report hiện nhóm theo:

- technical name không phân biệt hoa thường;
- `geometryFingerprint` khi record đã có fingerprint.

Scan cũng đánh dấu conflict khi hai stable ID khác nhau cùng ánh xạ vào một technical name.
App **chỉ báo cáo, không tự replace/merge/rename**. Create từ chối tên đã tồn tại; insert
dùng definition đang có trong DWG thay vì tự ghi đè. Người dùng phải review nguồn, chọn
record giữ lại và quyết định rename/merge/redefine ngoài luồng tự động.

`geometryFingerprint` mới là field/report hook; MVP chưa tính hash hình học chuẩn hóa từ
entity CAD. Vì vậy report khác tên nhưng giống hình học chưa thể coi là đầy đủ.

## 7. Giới hạn MVP và phase 2

| Hạng mục | Trạng thái hiện tại | Hướng phase 2 |
|---|---|---|
| Dynamic block authoring | Scan nhận biết và insert definition dynamic có sẵn; chưa quản lý/test round-trip parameters, actions, visibility hoặc per-instance properties; create bị chặn | Author/test parameters, actions, visibility states trong Block Editor hoặc API chuyên biệt |
| Attribute instance | Scan definition/tag/default; insert dùng default | Form nhập value, validate tag bắt buộc, cập nhật reference và cảnh báo trước `ATTSYNC` |
| Geometry duplicate | Chỉ dùng fingerprint nếu đã được cung cấp | Canonicalize entity/layer/property rồi hash; thêm tolerance và preview diff |
| Update hình học nguồn | Không có live link/redefine tự động | So revision DWG nguồn, preview ảnh hưởng và chỉ redefine sau khi user xác nhận |
| Layer/unit/annotative normalization | Lưu policy và kiểm tra một phần | Validator + migration có preview, không sửa hàng loạt âm thầm |
| Khung tên và hồ sơ bản vẽ | Khung tên được catalog như block attribute thường và khi insert chỉ nhận default; chưa có semantics sheet/title | Form attribute, catalog title block, tỷ lệ, sheet list, đánh số bản vẽ |
| Tổng thể ↔ chi tiết | Chưa theo dõi dependency | Link detail/sheet, phát hiện thay đổi và tạo danh sách vị trí cần review thủ công |

Đặc biệt, cập nhật definition có attribute có thể làm thay đổi reference hiện hữu; Autodesk
cảnh báo `ATTSYNC` có thể xóa format/property tùy chỉnh trên attribute. Phase 2 phải preview
phạm vi và xin xác nhận, không chạy tự động chỉ vì catalog đổi.

Create/insert/sync không phải một transaction chung giữa AutoCAD và file catalog. Nếu
người dùng đã hoàn tất lệnh CAD nhưng bước ghi XRecord hoặc lưu catalog sau đó thất bại,
definition/reference có thể đã tồn tại trong DWG dù API trả lỗi; cần Scan để đối soát và
khôi phục trạng thái trước khi thử lại.

## 8. Tài liệu Autodesk chính thức

- [Block Definition dialog: base point, units, annotative and Description](https://help.autodesk.com/cloudhelp/2027/ENU/AutoCAD-MAC-Core/files/GUID-03B61417-F040-4EB0-AFEA-B229AD303D91.htm)
- [Insert blocks and behavior of source DWG/Description](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-Core/files/GUID-BBD754F5-D51F-4692-8194-49E5B130CE68.htm)
- [BlockTableRecord properties](https://help.autodesk.com/cloudhelp/2022/ENU/OARX-ManagedRefGuide/files/OARX-ManagedRefGuide-__MEMBERTYPE_Properties_Autodesk_AutoCAD_DatabaseServices_BlockTableRecord.html)
- [Xrecords in extension dictionaries](https://help.autodesk.com/view/OARX/2026/ENU/?guid=GUID-94F52FE1-941B-483E-B12D-B2AFDC172C20)
- [Define attributes for blocks](https://help.autodesk.com/cloudhelp/2026/ENU/OARX-DevGuide-Managed/files/GUID-63FE1010-F9D4-46CF-A246-CAAAFA60560B.htm)
- [ATTSYNC command and warning](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-Core/files/GUID-56B14079-250B-4C99-AB3D-F95BA1C32AB7.htm)
- [Control properties of objects in blocks by layer](https://help.autodesk.com/cloudhelp/2017/ENU/AutoCAD-Core/files/GUID-25E9F20C-D146-426C-8815-37DF48D2D33F.htm)
- [Block units and insertion scale](https://help.autodesk.com/cloudhelp/2027/ENU/AutoCAD-LT-MAC/files/GUID-6C46049D-8636-442D-8BAC-CF4FD515FDC0.htm)
- [Annotative blocks](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-LT/files/GUID-4F448A62-A99E-4AB5-AE50-9EAAC0485283.htm)
- [Blocks Palette on Mac (`CONTENT`)](https://help.autodesk.com/cloudhelp/2025/ENU/AutoCAD-MAC-Core/files/GUID-09389064-395E-4D18-99CF-7F6C18718EF3.htm)
- [Share Tool Palettes and XTP packages](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-Core/files/GUID-CF1117E9-DD3B-4E79-9333-41D5E6388981.htm)

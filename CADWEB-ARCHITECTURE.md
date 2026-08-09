# Kiến trúc xuất DWG đa nền tảng sang CadWeb

> Trạng thái: kiến trúc full snapshot và lát cắt portable Save Sync/revision đã được triển khai trong repo. macOS đã qua load/command smoke, initial QSAVE và Undo fallback trên DWG copy; Windows build/runtime và phần còn lại của host matrix vẫn là release gate.
> Mốc kiểm chứng: 09/08/2026, AutoCAD/ObjectARX 2027 và .NET 10.
> Phạm vi: AutoCAD đầy đủ trên Windows và macOS; không bao gồm AutoCAD LT.

## Kết luận

Kiến trúc phù hợp nhất khi cần một bộ đọc DWG chạy trong AutoCAD trên cả Windows và macOS là:

```text
AutoCAD Windows                         AutoCAD macOS
      │                                      │
ObjectARX C++ (.arx)             ObjectARX C++ (loadable .bundle)
      └──────────────────┬───────────────────┘
                         │ cùng source lõi và cùng contract export
                         ▼
                  drawing.cadweb
                         │
             ┌───────────┴───────────┐
             ▼                       ▼
      React/WebGL viewer       helper/backend tùy chọn
             │
      Web + Windows + macOS
```

Hai plug-in chia sẻ source nhưng phải build thành native artifact riêng cho từng hệ điều hành và phải được kiểm thử theo từng release AutoCAD. Viewer chỉ phụ thuộc contract `.cadweb`, không phụ thuộc hệ điều hành đã tạo file.

### Mở rộng Save Sync/revision

Yêu cầu `sửa trong AutoCAD -> Save -> app cập nhật` là khả thi bằng
`AcDbDatabaseReactor` kết hợp save lifecycle, nhưng reactor chỉ nên tạo dirty
candidate. Correctness phải đến từ reconciliation với revision nền, server-side
compare-and-swap và snapshot fallback; không replay callback như một event log.

Thiết kế chuẩn tắc và kế hoạch thực hiện nằm tại:

- [ADR 0002 — CadWeb revision/delta sau Save](cad-platform/docs/0002-cadweb-revision-delta-contract.md)
- [Kế hoạch triển khai CadWeb Save Sync](cad-platform/docs/cadweb-sync-implementation-plan.md)

Các điều chỉnh quan trọng đã chốt: `saveComplete()` được expose qua
`AcEditorReactor` chứ không thuộc `AcDbDatabaseReactor`; AutoSave cũng đi qua save
lifecycle; `objectReAppended()` không bao phủ mọi Undo/Redo; revision do server cấp;
Xref chỉ phản ánh file con mới sau Reload/Reopen hoặc freshness workflow riêng; và
snapshot sync cần contract 1.1/canonical ID thay vì revision hóa trực tiếp snapshot
v1.0 hoặc selected export. Save journal + seal-before-destroy là gate bắt buộc để
không mất publish khi user Save trong CLOSE/QUIT.

## Kết quả kiểm chứng

| Nhận định | Kết quả | Điều chỉnh cần thiết |
|---|---:|---|
| Modern .NET chạy trên macOS Intel và Apple Silicon | Xác nhận | Microsoft phát hành SDK/runtime `x64` và `Arm64`. Không đồng nghĩa mọi UI framework .NET đều đa nền tảng. |
| AutoCAD Managed .NET API chạy trong AutoCAD for Mac | Không | Autodesk chỉ hỗ trợ Managed .NET trong AutoCAD trên Windows. Assembly tham chiếu `AcCoreMgd.dll`, `AcDbMgd.dll` hoặc `AcMgd.dll` không phải plug-in được hỗ trợ trên Mac. |
| ObjectARX chạy trên AutoCAD Windows và macOS | Xác nhận | Áp dụng cho AutoCAD đầy đủ, không phải AutoCAD LT. |
| Có thể dùng chung binary ObjectARX cho Windows và Mac | Không | Chỉ có thể dùng chung source. Windows và macOS dùng toolchain, định dạng native và module khác nhau. |
| ObjectARX Mac dùng C++/Objective-C và Xcode | Xác nhận có điều kiện | Phần ObjectARX cốt lõi nên viết bằng C++; chỉ dùng Objective-C/Objective-C++ cho tích hợp Cocoa/macOS khi cần. Toolchain cụ thể thay đổi theo release SDK. |
| API ObjectARX trên Mac ngang bằng Windows | Không | Autodesk ghi rõ không phải mọi API đều có trên macOS. Phải kiểm từng class/member trong Mac SDK đúng release. |
| Một autoloader package có thể chứa component cho cả hai OS | Xác nhận | Dùng `RuntimeRequirements` riêng cho `OS="Win64"` và `OS="Mac"`. |
| ObjectARX SDK “miễn phí” | Chưa đủ bằng chứng để viết tuyệt đối | Autodesk cung cấp trang License and download và giấy phép SDK riêng; trang hiện hành không nêu khoản phí mua SDK. |
| Export local/in-process bằng ObjectARX không cần AutoCAD | Không | Máy chạy export cần AutoCAD hoặc một Autodesk AutoCAD-based extensible host mà plug-in target. Người chạy phải có quyền sử dụng host hợp lệ; giấy phép ObjectARX SDK không cấp quyền sử dụng AutoCAD. |

Nguồn chính thức: [ma trận API AutoCAD 2027](https://help.autodesk.com/cloudhelp/2027/ENU/AutoCAD-MAC-Customization/files/GUID-E6429154-36DF-4D84-8ABC-9FCA15B66158.htm), [ObjectARX applications](https://help.autodesk.com/cloudhelp/2027/ENU/AutoCAD-MAC-Customization/files/GUID-3FF72BD0-9863-4739-8A45-B14AF1B67B06.htm), [ObjectARX SDK 2027](https://aps.autodesk.com/developer/overview/objectarx-autocad-sdk), [.NET trên macOS](https://learn.microsoft.com/en-us/dotnet/core/install/macos).

### SDK, AutoCAD và quyền sử dụng

ObjectARX SDK có giấy phép riêng với AutoCAD. Autodesk cho phép dùng/copy SDK theo các điều kiện trong agreement và loại trừ việc phát triển cho AutoCAD LT, DWG TrueView và DWG TrueConvert. Trang tải hiện hành không nêu một khoản phí mua SDK riêng, nhưng điều đó không cấp quyền chạy AutoCAD.

Trong phương án desktop/in-process này, người export phải có quyền sử dụng AutoCAD/host đích hợp lệ. Quyền đó có thể là subscription/named user, Flex, trial hoặc Education tùy trường hợp và điều khoản hiện hành; không nên mô tả chung là “license gắn với máy”.

## Ranh giới quan trọng giữa .NET và AutoCAD Managed .NET

`.NET` và `AutoCAD Managed .NET API` là hai khái niệm khác nhau:

- Modern .NET là runtime/SDK đa nền tảng. Nó phù hợp cho CLI, service, uploader, backend hoặc app độc lập trên macOS.
- AutoCAD Managed .NET API là lớp API do AutoCAD host, gồm các assembly như `AcCoreMgd.dll`, `AcDbMgd.dll` và `AcMgd.dll`. Autodesk chỉ hỗ trợ lớp này trong AutoCAD trên Windows.
- WPF và Windows Forms vẫn là công nghệ UI chỉ chạy trên Windows. Nếu helper .NET cần GUI đa nền tảng, phải chọn một stack phù hợp như .NET MAUI (trên macOS dùng Mac Catalyst) hoặc một framework đa nền tảng khác.
- Bản self-contained, single-file/apphost và native dependency phải publish theo RID phù hợp như `osx-x64`, `osx-arm64` hoặc target Windows tương ứng. Một portable managed DLL không dùng native/OS-specific API có thể dùng chung nếu máy đích có runtime tương thích.

Vì vậy, một helper C# độc lập có thể chạy cạnh AutoCAD for Mac, nhưng phần portable của helper không được load hoặc gọi các assembly Managed API của AutoCAD. Nếu thật sự cần tích hợp Managed API trên Windows, phải cô lập nó trong target Windows-only.

### Có nên dùng C# trên Windows và C++ trên Mac?

Phương án này hợp lệ về kỹ thuật:

```text
AutoCAD Windows → Managed .NET plug-in C#
AutoCAD macOS   → ObjectARX plug-in C++
```

Nó phù hợp khi đã có một codebase C# Windows trưởng thành, cần UI/API chỉ có trên Windows, hoặc phạm vi hỗ trợ Mac rất nhỏ. Đổi lại, mọi quy tắc đọc entity, block, text, hatch, dimension, Xref và annotative object sẽ có hai implementation. Hai exporter dễ lệch semantics dù cùng ghi một schema.

Với mục tiêu parity lâu dài của CadWeb, quyết định mặc định vẫn là C++ ObjectARX trên cả hai hệ điều hành. C# chỉ nên nằm ở helper/backend hoặc được chọn cho plug-in Windows khi lợi ích Windows-specific đủ lớn để chấp nhận chi phí duy trì kép. Managed plug-in Windows cũng phải target đúng phiên bản .NET mà release AutoCAD yêu cầu; với AutoCAD 2027, trang SDK hiện hành yêu cầu .NET 10.

## Kiến trúc source đề xuất

```text
cad-platform/
├── core/
│   ├── include/
│   │   ├── CadDocument.h
│   │   ├── CadEntity.h
│   │   └── CadGeometry.h
│   └── src/
│       ├── BlockResolver.cpp
│       ├── GeometryNormalizer.cpp
│       ├── TextNormalizer.cpp
│       └── CadWebWriter.cpp
├── objectarx/
│   ├── common/
│   │   ├── AcDbDocumentReader.cpp
│   │   ├── AcDbEntityReader.cpp
│   │   ├── AcDbBlockReader.cpp
│   │   └── AcDbPropertyReader.cpp
│   ├── windows/
│   │   ├── WindowsEntryPoint.cpp
│   │   └── build project
│   └── macos/
│       ├── MacEntryPoint.cpp
│       └── build project
├── schema/
│   ├── manifest.schema.json
│   └── geometry.fbs
├── tests/
│   ├── fixtures/
│   ├── golden/
│   └── cross-platform/
└── viewer/
    └── React + WebGL + Web Worker
```

Trách nhiệm của từng lớp:

| Lớp | Được phụ thuộc | Không được phụ thuộc | Trách nhiệm |
|---|---|---|---|
| `core` | C++ standard library và thư viện serialization đã chọn | AutoCAD SDK, `AcDb*`, `AcGe*`, Win32, Cocoa | Mô hình trung gian, chuẩn hóa geometry, block transform, serialization |
| `objectarx/common` | Tập API ObjectARX đã được xác nhận trên cả hai OS | UI riêng của Windows/macOS | Đọc database và chuyển `AcDb*`/`AcGe*` sang DTO của `core` |
| `objectarx/windows` | ObjectARX Windows, Win32 khi thật sự cần | Logic nghiệp vụ dùng chung | Entry point, lifecycle, phần khác biệt Windows |
| `objectarx/macos` | ObjectARX Mac, Objective-C++/Cocoa khi thật sự cần | Logic nghiệp vụ dùng chung | Entry point, lifecycle, phần khác biệt macOS |
| `viewer` | Contract `.cadweb` | ObjectARX hoặc nhánh xử lý theo OS nguồn | Parse, render, selection, layer/property UI |

`AcGe` là một phần của ObjectARX SDK, vì vậy không nên lọt vào `core` nếu mục tiêu là lõi hoàn toàn độc lập với AutoCAD. Adapter phải chuyển `AcGePoint3d`, `AcGeMatrix3d` và các curve sang kiểu dữ liệu nội bộ trước khi gọi `core`.

### Quy tắc truy cập AutoCAD

- Với database của document đang mở, chỉ truy cập `AcDbDatabase` và các `AcDbObject` trong command/document context hợp lệ. Side database không gắn document phải theo lifecycle, ownership và threading contract riêng.
- Đóng/mở object và transaction theo đúng ownership của ObjectARX.
- Không chuyển con trỏ hoặc object AutoCAD sang worker thread. Nếu cần serialize nền, trước hết sao chép toàn bộ dữ liệu cần thiết sang DTO thuần của `core`.
- Đối tượng không hỗ trợ phải được ghi vào báo cáo export; không được bỏ qua im lặng.
- Mọi API dùng chung phải qua cả compile gate Windows/Mac và runtime fixture test cho release đích. Có tên class trong header chưa đủ chứng minh mọi member có parity.

## Contract `.cadweb`

### Dạng container

Phiên bản 1 nên định nghĩa `drawing.cadweb` là một ZIP archive có cấu trúc chuẩn, không phải một thư mục được đổi đuôi tùy ý. Cách này giúp upload, checksum và lưu offline nhất quán.

```text
drawing.cadweb
├── manifest.json          bắt buộc
├── layers.json            bắt buộc
├── entities.bin           bắt buộc
├── blocks.bin             bắt buộc nếu có block definition/reference
├── properties.json        tùy chọn
├── export-report.json     bắt buộc, kể cả khi không có warning
├── fonts/                 tùy chọn, chỉ chứa font được phép phân phối
└── preview.png            tùy chọn
```

Quy ước tối thiểu:

- JSON dùng UTF-8; binary encoding, byte order và schema version phải ghi trong manifest.
- Mọi đường dẫn trong archive là đường dẫn tương đối chuẩn hóa bằng `/`; reader phải chặn path traversal và ZIP bomb.
- Mỗi payload có `size` và SHA-256 để kiểm tra toàn vẹn.
- Writer tạo payload trong thư mục tạm cùng volume, hoàn tất checksum rồi
  publish nguyên khối sang `.cadweb`; implementation hiện tại dùng hard-link
  no-replace và fail-closed trên filesystem không hỗ trợ thay vì ghi đè file có
  sẵn.
- Viewer từ chối major version không hỗ trợ nhưng bỏ qua field tùy chọn chưa biết trong cùng major version.
- Backend có thể unpack archive thành từng object để cache/range-load; trình duyệt không nên giải nén và parse bản vẽ lớn trên main thread.

Khi chưa đăng ký một media type riêng, transport nên dùng `application/zip` và giữ tên file `.cadweb`. Chỉ công bố `application/vnd.cadweb+zip` như media type chính thức sau khi quy ước/đăng ký của hệ thống đã được chốt.

### Manifest đề xuất

```json
{
  "format": "cadweb",
  "formatVersion": {
    "major": 1,
    "minor": 0
  },
  "producer": {
    "application": "AutoCAD",
    "applicationVersion": "2027",
    "pluginVersion": "0.1.0",
    "platform": "macos-arm64"
  },
  "source": {
    "fileName": "factory-layout.dwg",
    "dwgVersion": "unknown",
    "drawingFingerprint": "<drawing-id>"
  },
  "units": {
    "name": "millimeters",
    "metersPerUnit": 0.001
  },
  "coordinateSystem": {
    "space": "WCS",
    "upAxis": "Z",
    "origin": [0.0, 0.0, 0.0]
  },
  "extents": {
    "min": [0.0, 0.0, 0.0],
    "max": [25000.0, 18000.0, 0.0]
  },
  "files": {
    "layers": {
      "path": "layers.json",
      "encoding": "json",
      "size": 1234,
      "sha256": "<64-hex>"
    },
    "entities": {
      "path": "entities.bin",
      "encoding": "flatbuffers",
      "schemaVersion": 1,
      "byteOrder": "little-endian",
      "size": 123456,
      "sha256": "<64-hex>"
    },
    "blocks": {
      "path": "blocks.bin",
      "encoding": "flatbuffers",
      "schemaVersion": 1,
      "byteOrder": "little-endian",
      "size": 34567,
      "sha256": "<64-hex>"
    },
    "exportReport": {
      "path": "export-report.json",
      "encoding": "json",
      "size": 567,
      "sha256": "<64-hex>"
    }
  }
}
```

`dwgVersion` và `drawingFingerprint` phải lấy từ API/metadata thật khi triển khai; giá trị trong ví dụ chỉ là placeholder. Không lưu absolute source path mặc định vì có thể làm lộ tên user, server hoặc cấu trúc dự án.

### Mô hình dữ liệu cần chốt trước khi code exporter

1. Hệ tọa độ: WCS/UCS, trục Z, origin rebasing cho bản vẽ có tọa độ rất lớn và precision của WebGL.
2. Units: giá trị `INSUNITS`, hệ số chuyển đổi và cách xử lý `Unitless`.
3. Spaces: model space, paper space, layout và viewport.
4. Block: giữ definition + instance transform; không flatten mặc định. Phải hỗ trợ block lồng nhau và phát hiện cycle/dangling reference.
5. Định danh: lưu source handle để trace; không coi handle đơn lẻ là ID toàn cục. Một ID ổn định tối thiểu cần ghép drawing fingerprint với handle.
6. Hình học: giữ tham số analytic khi có thể và thêm tessellation phục vụ render. Quy định tolerance theo đơn vị bản vẽ.
7. Hiển thị: layer state, ACI/true color, transparency, lineweight, linetype, visibility và draw order.
8. Text: style, alignment, rotation, width factor, MText runs và chiến lược thay font. Chỉ embed font có quyền phân phối; cần fallback cho SHX/Big Font.
9. Xref: chọn rõ `reference-only`, `embed` hoặc `flatten`. Mặc định không ghi absolute path vào package.
10. Unsupported/proxy entity: ghi type, handle, extents và lý do không hỗ trợ vào export report.

Không nên hứa ngay rằng mọi spline, hatch, dimension, annotative object, viewport, Xref hoặc custom entity sẽ hiển thị giống AutoCAD. Mỗi loại cần một fixture và tiêu chí fidelity riêng.

## Plug-in ObjectARX

Plug-in nên giữ UI tối thiểu và cung cấp các command ổn định:

```text
CADWEBEXPORT
CADWEBEXPORTSELECTED
CADWEBSETTINGS
```

Luồng export:

```text
command context
  → snapshot document/database metadata
  → traverse model/layout/block graph
  → AcDb/AcGe adapter tạo DTO thuần
  → normalize + validate
  → serialize vào file tạm
  → checksum + atomic publication
  → trả đường dẫn/kết quả cho helper hoặc mở viewer
```

Phần mở trình duyệt, file picker và UI native nên nằm ở adapter theo nền tảng hoặc helper ngoài process. Logic đọc entity và format không được phụ thuộc UI.

### Tập API chung

Các nhóm `AcDbDatabase`, block table/record, entity hình học cơ bản, layer, text, block reference, attribute và `AcGe` là điểm xuất phát hợp lý. Tuy nhiên, đây là danh sách ưu tiên kiểm chứng, không phải bảo đảm blanket compatibility. Mỗi API/member phải được:

1. compile với SDK Windows và Mac đúng release;
2. chạy trên fixture DWG ở cả hai host;
3. so sánh output theo tolerance đã định nghĩa.

Ưu tiên hỗ trợ theo pha:

- Pha 1: line, lightweight polyline có bulge/width, arc, circle, text/MText cơ bản, layer, block/attribute.
- Pha 2: ellipse, spline, hatch, dimension/leader, layout/viewport.
- Pha 3: Xref, annotative behavior, complex text, proxy/custom entity và 3D.

## Đóng gói và phân phối

Cần phân biệt hai khái niệm cùng có hậu tố `.bundle`:

- Autoloader package là một thư mục `CadWebExporter.bundle` chứa `PackageContents.xml`; cơ chế này dùng để tổ chức plug-in và target OS/release.
- Native ObjectARX module trên macOS là một loadable code-bundle directory `.bundle`, bên trong chứa `Contents/Info.plist` và Mach-O executable. Plug-in cho AutoCAD desktop Windows thông thường là `.arx`; `.crx` là Console Runtime Extension không có UI và không phải target mặc định của kiến trúc này.

Cấu trúc package đa nền tảng có thể tổ chức như sau:

```text
CadWebExporter.bundle/                       outer autoloader package
├── PackageContents.xml
└── Contents/
    ├── Windows/2027/
    │   └── CadWebExporter.arx
    └── MacOS/2027/
        └── CadWebExporter.bundle            native Mac module
```

Tên `Windows`, `MacOS` và `2027` chỉ là quy ước thư mục. `ModuleName` là đường dẫn tương đối từ root package và dùng `/`.

Đây là target layout mang hai OS, không phải layout duy nhất. Với package chỉ dành cho Mac, outer autoloader package và native macOS code bundle có thể là cùng một physical bundle với `ModuleName="./"`. Target `cad-platform/objectarx/macos` dùng dạng flat này; package đa OS stage chính bundle export + SaveSync đó thành module lồng. Cả autoload và APPLOAD vẫn phải được smoke-test trong AutoCAD 2027 trước khi phát hành.

Ví dụ rút gọn:

```xml
<Components>
  <RuntimeRequirements
      OS="Win64"
      Platform="AutoCAD"
      SeriesMin="R26.0"
      SeriesMax="R26.0" />
  <ComponentEntry
      AppName="CadWebExporter"
      AppType="Arx"
      ModuleName="./Contents/Windows/2027/CadWebExporter.arx" />
</Components>

<Components>
  <RuntimeRequirements
      OS="Mac"
      Platform="AutoCAD"
      SeriesMin="R26.0"
      SeriesMax="R26.0" />
  <ComponentEntry
      AppName="CadWebExporter"
      AppType="Arx"
      ModuleName="./Contents/MacOS/2027/CadWebExporter.bundle" />
</Components>
```

Trên Mac, `AppType="Arx"` là bắt buộc để nạp ObjectARX component từ autoloader package; `AppType="Bundle"` chỉ loại package, không thay cho loại ObjectARX component. `SeriesMin`/`SeriesMax` chỉ giới hạn host mà autoloader được phép thử load; chúng phải phản ánh compatibility matrix lẫn phạm vi đã build/test, chứ không tự chứng minh binary compatibility. Nếu phân phối qua Autodesk App Store, hướng dẫn publisher hiện hành còn yêu cầu `SeriesMax` từ AutoCAD 2025.

Nguồn chính thức: [PackageContents.xml](https://help.autodesk.com/cloudhelp/2027/ENU/AutoCAD-MAC-Customization/files/GUID-BC76355D-682B-46ED-B9B7-66C95EEF2BD0.htm), [`Components`](https://help.autodesk.com/cloudhelp/2027/ENU/AutoCAD-MAC-Customization/files/GUID-3C25E517-8660-4BB7-9447-2310462EF06F.htm), [`RuntimeRequirements`](https://help.autodesk.com/cloudhelp/2027/ENU/AutoCAD-MAC-Customization/files/GUID-1591CA01-EF87-48CD-952B-772FE26037F1.htm), [cấu trúc outer `.bundle`](https://help.autodesk.com/cloudhelp/2025/ENU/AutoCAD-MAC-Customization/files/GUID-40F5E92C-37D8-4D54-9497-CD9F0659F9BB.htm), [`arxload` và extension theo OS](https://help.autodesk.com/cloudhelp/2026/ENU/AutoCAD-AutoLISP-Reference/files/GUID-965A0D2A-CFD0-4D7C-9D2B-2D8188F0DAC8.htm).

## Viewer và helper

React viewer dùng chung source cho Windows, macOS và web, nhưng “dùng chung” không có nghĩa bỏ qua browser compatibility. Cần test ít nhất Chrome, Edge và Safari theo một support matrix cụ thể. Parse/decompress/tessellation phải chạy trong Web Worker; cache có thể dùng IndexedDB nhưng cần quota/error handling.

Nếu cần desktop/offline, chỉ nên chọn một shell chính:

- Electron/Tauri nếu muốn tái sử dụng trực tiếp React viewer;
- .NET helper nếu hệ sinh thái vận hành cần C#, với UI framework đa nền tảng phù hợp;
- helper headless nếu chỉ cần login, checksum, upload, cache và mở browser.

Một helper độc lập có thể đảm nhiệm authentication, upload, checksum, retry, cache, version sync, lưu offline và mở viewer đúng drawing/revision. Giao thức giữa plug-in và helper phải là contract ngoài process rõ ràng, chẳng hạn file atomic + event, local socket hoặc loopback HTTP có xác thực; không truyền object/con trỏ AutoCAD qua ranh giới này.

Trong repo hiện tại đã có `acad-studio/apps/daemon`, `acad-studio/apps/web` và Electron tại `acad-studio/apps/desktop`. Vì vậy, .NET helper là một lựa chọn thay thế, không phải thành phần bắt buộc; thêm nó ngay sẽ tạo thêm một runtime và một kênh update cần vận hành.

## Kiểm thử chấp nhận

Kiến trúc chỉ được coi là đạt parity khi có bằng chứng từ cùng bộ fixture DWG trên cả hai OS:

- Output Windows và Mac tương đương về ngữ nghĩa; không bắt buộc byte-for-byte nếu số thực hoặc thứ tự traversal khác nhau.
- Sau khi quy định deterministic ordering và tolerance, số entity, layer, block instance, extents và transform phải khớp.
- Viewer không có nhánh render theo `producer.platform`.
- Mọi entity bị bỏ qua đều xuất hiện trong export report.
- Golden fixtures bao gồm polyline bulge, block lồng nhau, attribute, Unicode/MText, hatch, spline, dimension, layout, Xref và proxy object.
- Có test bản vẽ lớn về thời gian export, peak memory, archive size và thời gian first render.
- Reader kiểm tra checksum, giới hạn kích thước, duplicate paths và path traversal trước khi cấp phát lớn.

## Hiện trạng repo và lộ trình

Hiện tại repo đã có:

- JSON Schema, FlatBuffers schema, ADR và fixture `.cadweb` v1;
- C++17 DTO/writer độc lập ObjectARX, ZIP deterministic, SHA-256 và native tests;
- adapter ObjectARX dùng chung cho entity pha 1, block/attribute cơ bản, layer,
  units và export report;
- target ObjectARX macOS export + SaveSync với bốn command `CADWEBEXPORT`,
  `CADWEBEXPORTSELECTED`, `CADWEBSETTINGS`, `CADWEBSYNCSTATUS`, build universal
  Intel + Apple Silicon;
- TypeScript reader fail-closed với giới hạn ZIP, checksum, schema/FlatBuffers validation và contract tests;
- React/Web Worker/WebGL2 viewer đã nối vào UI chính;
- project ObjectARX Windows và target autoloader package hai OS.

Phần Windows mới là build target, chưa được compile/load trên máy Windows. Bundle
macOS đã qua GUI load/command smoke và representative initial QSAVE/Undo gate,
nhưng chưa qua toàn bộ SAVEAS/MDI/Redo/failure/kill matrix; bundle đa OS dạng nested
cũng chưa được smoke-test trong host. Pha 1 chưa hỗ trợ ATTDEF, MINSERT replication, spline,
hatch, dimension, layout/viewport, Xref embed/flatten, proxy/custom entity hoặc
complex text fidelity. Thuộc tính ByBlock/layer 0, visibility của hidden
attribute và một số MText attribute đang được flatten có cảnh báo (tag/value
vẫn được giữ); đối tượng không thể biểu diễn được ghi vào
`export-report.json`.

Nếu yêu cầu chuyển thành export unattended trên server không cài AutoCAD desktop, kiến trúc plug-in local này không còn đáp ứng trực tiếp. RealDWG hoặc Autodesk Platform Services Automation là các hướng khác và phải được đánh giá riêng về API, vận hành và quyền sử dụng.

Trạng thái lộ trình:

1. Hoàn tất ADR cho container, versioning, units, coordinates, block và Xref policy.
2. Hoàn tất JSON Schema, FlatBuffers schema, validator và fixture deterministic.
3. Hoàn tất DTO/core, adapter pha 1, export report, Mac compile và partial runtime gate.
4. Hoàn tất viewer đọc `.cadweb` thật từ Web Worker và render WebGL2 cơ bản.
5. Đã thêm build target riêng cho Windows và macOS; còn Windows load/export và
   phần lớn runtime/semantic matrix trên hai host bằng cùng fixture DWG.
6. Đã thêm package hai OS; còn host smoke test, signing/notarization, browser
   matrix và performance gate.

## Nguồn tham khảo chính thức

- Autodesk: [About Supported Programming Interfaces, AutoCAD 2027](https://help.autodesk.com/cloudhelp/2027/ENU/AutoCAD-MAC-Customization/files/GUID-E6429154-36DF-4D84-8ABC-9FCA15B66158.htm)
- Autodesk: [About ObjectARX Applications](https://help.autodesk.com/cloudhelp/2027/ENU/AutoCAD-MAC-Customization/files/GUID-3FF72BD0-9863-4739-8A45-B14AF1B67B06.htm)
- Autodesk APS: [ObjectARX for AutoCAD SDK](https://aps.autodesk.com/developer/overview/objectarx-autocad-sdk)
- Autodesk APS: [ObjectARX SDK licensing](https://aps.autodesk.com/developer/overview/autocad-objectarx-sdk-licensing)
- Autodesk: [PackageContents.xml Format Reference](https://help.autodesk.com/cloudhelp/2027/ENU/AutoCAD-MAC-Customization/files/GUID-BC76355D-682B-46ED-B9B7-66C95EEF2BD0.htm)
- Autodesk: [RuntimeRequirements Element Reference](https://help.autodesk.com/cloudhelp/2027/ENU/AutoCAD-MAC-Customization/files/GUID-1591CA01-EF87-48CD-952B-772FE26037F1.htm)
- Autodesk: [ObjectARX compatibility](https://help.autodesk.com/cloudhelp/2027/ENU/AutoCAD-Customization/files/GUID-C21B8F00-C7DE-4E44-8006-D5DC99199F31.htm)
- Autodesk: [Managed .NET compatibility](https://help.autodesk.com/cloudhelp/2027/ENU/AutoCAD-Customization/files/GUID-A6C680F2-DE2E-418A-A182-E4884073338A.htm)
- Autodesk: [Console Runtime Extension](https://help.autodesk.com/cloudhelp/2021/ENU/AutoCAD-Customization/files/GUID-0F71C933-8933-46E9-A73C-148EFB42D8B7.htm)
- Autodesk APS: [AutoCAD publisher guidelines](https://aps.autodesk.com/marketplace/publisher-center/autocad-publisher-guidelines)
- Autodesk APS: [RealDWG API](https://aps.autodesk.com/developer/overview/realdwg-api)
- Autodesk APS: [Automation API](https://aps.autodesk.com/developer/overview/automation-api)
- Microsoft: [Install .NET on macOS](https://learn.microsoft.com/en-us/dotnet/core/install/macos)
- Microsoft: [.NET application publishing](https://learn.microsoft.com/en-us/dotnet/core/deploying/)
- Microsoft: [.NET Runtime Identifier (RID) catalog](https://learn.microsoft.com/en-us/dotnet/core/rid-catalog)
- Microsoft: [.NET desktop guide for WPF and Windows Forms](https://learn.microsoft.com/en-us/dotnet/desktop/)
- Microsoft: [WPF is Windows-only](https://learn.microsoft.com/en-us/dotnet/desktop/wpf/overview/)
- Microsoft: [.NET MAUI supported platforms](https://learn.microsoft.com/en-us/dotnet/maui/supported-platforms?view=net-maui-10.0)
- Autodesk: [AutoCAD subscription FAQ](https://www.autodesk.com/solutions/autocad-subscription-faq)

# CHANGELOG

## 2026-08-13 — Ba ca biên của đường nhập layer

Ba mục nợ kỹ thuật ghi lại sau mục 1.1. Cả ba đụng plugin ObjectARX nên
**phải khởi động lại AutoCAD** thì mới có tác dụng.

### Added — layer màu thật (true color) nhập và áp được

- Hồ sơ nhận màu dạng `#RRGGBB` bên cạnh chỉ số ACI `0…256` và ba tên
  `Default`/`ByLayer`/`ByBlock`. Đường áp dụng ghi nó thành **DXF group 420**.
- Plugin phát thêm `colorMethod` cho mỗi layer. Không có nó thì phía web phải suy
  màu thật từ `rgb`, và chỗ suy đó có một điểm mù không gỡ được: màu thật **đen
  tuyền** cũng là `rgb: [0, 0, 0]`, không phân biệt được với một layer ACI.
- `acadstd:ensure-layer-rgb` thay `acadstd:ensure-layer` làm đường ghi chính; hàm
  cũ giữ nguyên chữ ký và gọi vào hàm mới, nên mọi hồ sơ hiện có sinh ra đúng các
  group code như trước. Đây là đường ghi **một pha, không hoàn tác được**, nên
  một thay đổi arity là thứ không được phép làm ẩu.
- Ô màu trong bảng layer tô thẳng mã màu thật thay vì bỏ trống. `Number("#FF8000")`
  là `NaN`, nên nếu không tách nhánh thì ô sẽ trống đúng lúc đã biết chắc màu.

### Fixed — bản vẽ chưa lưu chỉ định danh được bằng tiêu đề

- `findDocExact` (plugin) nhận thêm mã phiên (`acadDocumentInstanceToken`) làm
  đích, và `selectOpenDocument` (daemon) khớp `instance` xen giữa đường khớp theo
  đường dẫn file và đường khớp theo tiêu đề.
- `requestTargetOf()` tách riêng khỏi `targetOf()`. Hai hàm trả lời hai câu khác
  nhau — "chỉ đích danh cách nào chắc nhất" để GỬI, và "máy chủ gọi bản vẽ này là
  gì" để SO với `scan.target` — và gộp chúng làm một sẽ hỏng `/review`, nơi daemon
  đặt `scan.target` bằng `file || title`.
- Hai bản vẽ chưa lưu trùng tiêu đề nay chọn được, thay vì bị loại khỏi ô chọn.
- **Codex review bắt được: sửa một tầng chưa đủ.** `selectOpenDocument` chọn đúng
  bản vẽ rồi, nhưng route `GET /drawing-info` dựng lại đích bằng `file || title`
  trước khi gọi plugin — tiêu đề mơ hồ làm `findDocExact` trả về rỗng, và cả
  đường bản-vẽ-chưa-lưu vẫn hỏng ở đúng một bước sau chỗ đã sửa.
  `nativeDocumentTarget()` tách riêng đích GỬI ĐI. `exactTarget` **không đổi**, vì
  nó còn chảy vào `withLegacySelectionCatalog` → guard LISP so `acad:cat-expected`
  với `DWGNAME`; LISP không biết mã phiên là gì.
- Ô chọn màu nay gõ được `#RRGGBB`. Trước đó `onChange` khai cứng `number`, nên
  màu thật xem được mà không sửa được bằng tay — một nửa tính năng.

### Fixed — Codex review vòng hai: hai lỗ hổng của chính hai sửa trên

- **[P1] Layer màu thật báo lệch MÃI MÃI trong lượt kiểm.** `auditStandards` so
  màu hồ sơ với `actual.aci ?? actual.color`, mà với layer màu thật thì `aci` là
  một chỉ số **không mang màu người dùng đặt**. Hồ sơ ghi `#FF8000`, audit đọc ra
  một số, và phép so không bao giờ khớp — mỗi lần bấm sửa lại áp dụng đúng cái
  giá trị đã có sẵn. Lỗi kiểu này không tự lộ ra: nó trông hệt như một bản vẽ
  thật sự sai chuẩn. Nay `observedLayerColor()` lấy màu quan sát được từ
  `colorMethod`/`rgb`; `rgb` hỏng thì lùi về ACI chứ không bịa mã màu.
- **[P2] Gửi một đích chính xác hơn lại làm hỏng thứ đang chạy.** Plugin phát
  `instance` trong danh sách bản vẽ từ trước khi `findDocExact` biết nhận nó, nên
  có những bản plugin trả `not_found` cho mã phiên. Bản vẽ chưa lưu trước đây đọc
  được bằng tiêu đề. Nay lùi về `exactTarget` khi gặp `not_found` — nhưng **chỉ
  khi** đích cũ còn chỉ đúng một bản vẽ, vì một tiêu đề trùng sẽ khớp bản vẽ KHÁC
  và trả về bảng layer của bản vẽ khác thì tệ hơn hẳn báo lỗi.

### Fixed — Codex review vòng ba: sửa ở GỐC thay vì vá tầng thứ tư

Vòng ba ra **cùng một dạng lỗi lần thứ ba**: với plugin cũ, hai bản vẽ chưa lưu
trùng tiêu đề lọt vào ô chọn rồi bấm cái nào cũng hỏng. Ba vòng cùng dạng nghĩa
là thiết kế sai, không phải cần thêm một bản vá — đúng bài học đã ghi ở mục 1.1.

Nguyên nhân chung của cả ba: **app không biết plugin đang chạy có nhận mã phiên
làm đích hay không**, nên mỗi tầng tự đoán lấy. `instance` nằm trong payload danh
sách bản vẽ từ lâu, còn `findDocExact` mới biết nhận nó — hai sự thật khác nhau,
và không suy được cái sau từ cái trước.

- Plugin công bố `targetsInstance: true` trong danh sách bản vẽ. Thiếu trường =
  bản cũ, và giao diện fail-closed y như trước.
- `sendTarget()` chỉ gửi mã phiên khi cờ đó bật; `pickable()` chỉ cho chọn bản vẽ
  chưa lưu trùng tiêu đề khi cờ đó bật.
- Cả hai chuyển từ `ImportLayers.tsx` sang `model.ts` — nằm trong component thì
  không có cách nào khoá bằng test, và đó chính là lý do ba vòng đều trượt.
- `OpenDocument` của `cadSelection` giữ `targetsInstance` ở dạng tuỳ chọn, cùng
  nhóm `dbmod`/`space`: ép thành bắt buộc là biến "plugin không nói gì" thành một
  giá trị bịa.

### Fixed — Codex review vòng bốn: lượt lùi có thể đọc nhầm bản vẽ

Phép kiểm "tiêu đề không mơ hồ" trước lượt lùi đo trên `open.docs`, một ảnh chụp
đã cũ. Bản vẽ đóng đi rồi một bản khác trùng tiêu đề mở lên trong khoảng đó là
tiêu đề ấy trỏ sang bản vẽ **khác** — và ta trả về bảng layer của bản vẽ khác mà
không ai biết. Đúng loại lỗi mà cả tính năng này dựng ra để chặn.

Nay chốt bằng thứ không mơ hồ được: mã phiên trong phản hồi phải đúng bản vẽ đã
chọn, không khớp thì bỏ lượt lùi và giữ `not_found`. Chốt này luôn có dữ liệu ở
đúng những bản plugin cần tới lượt lùi — `instance` vào cả danh sách bản vẽ lẫn
`drawing-info` trong cùng một commit (`104bb32`).

### Fixed — Codex review vòng sáu: "không biết" không được thành "đạt"

`observedLayerColor()` lùi về `aci` khi `rgb` không đọc được. Đó là một đường
**báo đạt sai**: hồ sơ chờ đợi ACI 7, layer nói rõ nó dùng màu thật nhưng `rgb`
hỏng, `aci` tình cờ bằng 7 — audit báo đạt chuẩn trong khi màu thật sự của layer
không ai biết. Đúng nguyên tắc đã dùng ở mọi chỗ khác trong mục này, chỉ chỗ này
bỏ sót: không biểu diễn được thì không kết luận, **kể cả kết luận "đúng"**. Nay
trả `undefined` và audit báo `color: null`.

Phía web đã đúng sẵn — `readDrawingLayers` loại hẳn dòng đó vào `skipped`.

### Technical — `test-bridge-contract.mjs` nay chạy trong `pnpm verify`

File test này tồn tại và xanh, nhưng không nằm trong chuỗi `verify` và dự án
không có CI, nên trên thực tế nó không chạy bao giờ. Đã thêm vào.

**Codex review vòng năm bắt được hệ quả:** đường lùi của `ACAD_SCRATCH` trong file
đó là một đường dẫn tuyệt đối trong `/var/folders` của **một máy cụ thể**. Nó
chạy được ở đúng máy ấy nên không ai thấy; đưa test vào `verify` là biến nó thành
chốt chặn trên mọi máy khác, và trên Linux thì `/var/folders` còn không tồn tại
nên `mkdirSync` ném EACCES. Nay dùng `mkdtempSync(tmpdir())` — `mkdtemp` chứ
không phải một tên cố định, vì hai lượt chạy song song sẽ giẫm lên nhau.

Sáu script khác (`test-acad-stability`, `test-acad-control`, `test-headless-layer`,
`test-preview-apply`, `test-objectarx-live`, `test-live-preview`,
`test-product-identity`) có cùng đường dẫn cứng nhưng **không** nằm trong
`verify`. Chưa sửa — xem `Technical Debt`.

### Changed — ngưỡng bảng layer lên 5.000 dòng

- `kInfoMaxLayerItems` = 5.000, tách khỏi `kInfoMaxTableItems` = 500 vẫn dùng
  chung cho linetype/textstyle/dimstyle, và plugin công bố nó trong `limits`.
- **Chưa hết**: bản vẽ quá 5.000 layer vẫn ẩn nhóm xoá, vì một ngưỡng lớn hơn
  không phải là phân trang. Bảng bị cắt không chứng minh được layer nào vắng mặt,
  mà tích một dòng ở nhóm xoá là XOÁ nó khỏi hồ sơ.

### Fixed — hai đường bịa màu lộ ra khi mở cho màu thật

- Dòng màu thật mà `rgb` hỏng (thiếu kênh, kênh ngoài `0…255`) trước đây vẫn lọt,
  rồi `reconcileLayers` làm `source.color ?? 7` biến nó thành ACI 7 — layer nhập
  vào đổi màu mà không ai báo. Nay tính vào `skipped`.
- ACI `0` (ByBlock) và `256` (ByLayer) không phải màu hợp lệ của một layer: layer
  không kế thừa màu từ chính nó, và `layerColor()` lặng lẽ đổi cả hai thành `7`
  lúc áp dụng. Nay cũng tính vào `skipped`.

### Technical

- `trueColor()` (daemon) và `isTrueColor()`/`hexColor()` (web) đều chỉ nhận đúng 6
  chữ số hex. `#abc` là cú pháp CSS chứ không phải cú pháp DXF, và đoán nó thành
  `#aabbcc` là tự chọn thay người dùng một màu họ không gõ.
- `acadstd:sync-layers` nhận `rgb` làm trường **thứ sáu, tuỳ chọn**: hồ sơ không
  dùng màu thật thì daemon không phát nó, `nth 5` trả `nil`, và hành vi y hệt cũ.
- Test khoá đường ghi: mọi dòng của hồ sơ chỉ-ACI phải kết thúc bằng `nil`, và
  `#000000` phải ra `0` — một phép kiểm `|| nil` theo độ-thật sẽ biến màu đen
  thành "không có màu thật", tức layer đen tuyền lặng lẽ quay về ACI.
- `pnpm verify`: **174 test** (trước 169), 10 guardrail, exit 0.

## 2026-08-12 — Nhập layer từ bản vẽ (mục 1.1)

### Added — `/standards` lấy được bảng layer từ một bản vẽ đang mở

Hồ sơ mặc định có 5 layer; một bộ quy chuẩn thật của công ty có 30–80. Gõ tay
tên, màu, kiểu nét, bề dày cho từng dòng là việc không ai làm đến hết — và cách
lập hồ sơ tự nhiên nhất là lấy từ một bản vẽ đã chuẩn rồi tỉa lại.

**Đối chiếu, không thay thế.** Panel cũ hỏi một câu rồi thay sạch danh sách: ai
đã tinh chỉnh cột "bắt buộc" và bề dày cho 40 layer sẽ mất hết trong một cú bấm,
không có bước hoàn tác nào. Hộp thoại mới chia ba nhóm và **không dòng nào đổi
trừ khi được tích**, với mặc định nghiêng về phía an toàn:

| Nhóm | Mặc định | Vì sao |
|---|---|---|
| Chỉ có trong bản vẽ | **tích sẵn** | cộng thêm, không lấy đi gì |
| Khác thuộc tính | không tích | ghi đè là lấy đi giá trị bạn đã đặt |
| Chỉ có trong hồ sơ | không tích | tích nghĩa là **xoá** |

Cột **bắt buộc** không nằm trong phép đối chiếu: nó là quyết định của người lập
hồ sơ, không phải thuộc tính đọc được từ bản vẽ. Đưa nó vào là mời người dùng
ghi đè chính lựa chọn của mình bằng một mặc định.

Nhận xong **chưa lưu** — kết quả vào bản nháp, nút Lưu hồ sơ vẫn là bước ghi
thật và `If-Match` vẫn chốt tranh chấp như mọi lần lưu khác.

### Fixed — Codex review: ba lỗ hổng của chính đường nhập

- **Danh sách bản vẽ chỉ nạp một lần (P1).** Mở `/standards` trước khi AutoCAD
  sẵn sàng thì `docs` rỗng mãi và nút nhập khoá vĩnh viễn; mở hay đóng một bản vẽ
  trong lúc trang còn mở thì danh sách nguồn hoặc thiếu, hoặc mời một bản vẽ đã
  đóng. Nay bám bus sự kiện có sẵn, cùng cách `/review` làm — và một lượt đọc
  hỏng giữ nguyên danh sách cũ thay vì khoá nút.
- **Bảng layer bị cắt vẫn được đem đi đối chiếu (P1).** Plugin cắt ở
  `maxTableItems` = **500 dòng** và phát `layers_truncated`. Đường nhập bỏ qua
  cảnh báo đó, nên với bản vẽ nhiều layer thì những layer thật của hồ sơ — chỉ
  đơn giản nằm ngoài phần được trả về — sẽ hiện dưới nhóm **"chỉ có trong hồ
  sơ"**, và tích một dòng ở đó là **xoá** nó. Nay nhóm xoá bị ẩn khi danh sách bị
  cắt, kèm lời giải thích; hai nhóm còn lại vẫn dùng được vì chúng chỉ chạm tới
  layer thật sự đọc được. Khoá cả hộp thoại sẽ chặn đúng người dùng cần nó nhất.
- **Mất đường lùi payload lồng.** `/drawing-info` để bảng layer ở **ba chỗ** tuỳ
  phiên bản plugin; panel cũ lùi qua cả ba, tôi chỉ đọc `tables.layers`. Một phản
  hồi lồng cũ sẽ bị báo "không có bảng layer nào" trong khi nó có đủ. Đã gom phép
  đọc vào `readDrawingLayers()` ở model để test được cả ba dạng.

### Fixed — Codex review vòng hai: ba lỗ hổng nữa của cùng đường nhập

- **Dòng thiếu thuộc tính bị điền giá trị bịa (P1).** Một dòng chỉ có `name`
  (và `handle`) không phải một dòng bảng layer — plugin luôn phát đủ `aci`,
  `linetype`, `lineweight`. Nhận nó rồi điền `7`/`Continuous`/`Default` là **bịa
  ra thuộc tính** rồi trình bày như thể đọc được từ bản vẽ, ngay trong tính năng
  mà cả điểm của nó là *"lấy đúng giá trị bản vẽ đang dùng"*. Nay bỏ những dòng
  đó và **nói ra số lượng** thay vì im lặng.
- **`layers_unavailable` bị gộp với "bản vẽ trống".** Hai cảnh báo
  `layers_unavailable` / `layers_iterator_unavailable` nghĩa là plugin **không
  đọc được** bảng layer — khác hẳn "bản vẽ không có layer nào", điều không tồn
  tại: mọi bản vẽ đều có ít nhất layer `0`. Nay báo đúng và chỉ đường build lại
  plugin.
- **Quá 500 layer thì lưu hỏng mà không ai báo trước.** `MAX_LAYERS` của daemon
  là 500. Nhập từ một bản vẽ lớn sẽ báo "đã nhận vào bản nháp" rồi để lượt PUT
  ăn 400. Nay `profileSaveBlockedReason()` chặn trước, cho cả layer lẫn ánh xạ.
- **Danh sách bản vẽ thiếu vé.** Lượt đọc lúc gắn trang và lượt do sự kiện `doc*`
  kích hoạt chồng nhau thì phản hồi **cũ** ghi đè ảnh chụp **mới** — ô chọn nguồn
  bày một tệp đã đóng, rồi lượt nhập đọc từ sai nguồn. `/review` đã có
  `docsSequence` cho đúng chuyện này; nay `/standards` cũng có.

### Fixed — Codex review vòng ba: năm điểm, hai P1

- **Bản sửa vòng hai chỉ đúng một nửa (P1).** Bộ lọc dùng `||`, nên một dòng
  `{name, aci}` vẫn lọt và hai thuộc tính còn lại vẫn bị bịa. Nay đòi **đủ cả
  ba**. Một bản sửa nửa vời còn khó thấy hơn không sửa, vì nó trông như đã có
  chốt chặn.
- **Bản vẽ nguồn bị đóng trong lúc hộp thoại còn mở (P1).** Ô chọn không còn mục
  đó nhưng ảnh chụp layer thì vẫn nguyên, và nút Nhận vẫn đổ nó vào hồ sơ — nhập
  từ một bản vẽ không còn tồn tại. Nay vứt ảnh chụp và nói ra.
- **`alive: false` vẫn bật nút nhập.** Giữ danh sách cũ khi một lượt đọc hỏng là
  đúng, nhưng nút lại chỉ nhìn `docs.length`, nên giao diện mời một đường dẫn có
  thể đã chết. Nay cờ sống tách riêng và chính nó quyết nút.
- **Không nghe `drawingSaved`.** Plugin gọi `writeDocs()` rồi phát sự kiện đó
  ngay trong `saveComplete` — chú thích trong chính plugin nói *"UI nạp lại danh
  sách theo sự kiện, `writeDocs()` một mình không đánh thức ai cả"*. Một lượt
  **Save As** đổi đường dẫn tệp, đúng thứ `targetOf()` ưu tiên, nên không nghe là
  mọi lượt đọc layer sau đó trả `not_found`.
- **Ném lỗi làm mất chẩn đoán vừa dựng.** Khi mọi dòng đều thiếu thuộc tính,
  `skipped` khác 0 nhưng lệnh `throw` rơi vào `catch` và `catch` xoá luôn nó —
  hộp thoại chỉ còn "không có bảng layer nào", tức mất đúng lời giải thích.

### Fixed — Codex review vòng bốn: ảnh chụp phải biết nó thuộc về bản vẽ nào

- **Lượt đọc bảng layer thiếu vé (P1).** Đổi nguồn hai lần liên tiếp thì phản hồi
  của lượt **cũ** có thể về sau và ghi đè ảnh chụp của lượt **mới**, trong khi ô
  chọn và câu tóm tắt vẫn ghi tên bản vẽ mới. Tôi vừa thêm vé cho danh sách bản
  vẽ ở vòng trước mà quên chính lượt đọc layer.
- **Định danh ảnh chụp là đường dẫn, đáng lẽ phải là `instance` (P1).** Đường dẫn
  không đủ ở ba ca: đóng hết bản vẽ (`docs` rỗng làm cờ cũ im hẳn), `/docs` hỏng
  (trang cha giữ danh sách cũ), và **mở lại cùng một tệp** — cùng đường dẫn nhưng
  `instance` khác, tức một database khác mang ảnh chụp của database cũ.
- **Thiếu tài liệu.** Rule `documentation-maintenance` đòi cập nhật
  `USER_GUIDE.md` cho thay đổi người dùng thấy được và `DEVELOPMENT.md` cho thay
  đổi kiến trúc/state. Tôi cập nhật CHANGELOG và ROADMAP rồi dừng.

### Changed — Codex review vòng năm: gộp 5 mảnh trạng thái thành MỘT

Bốn vòng liền, mỗi vòng đều tìm ra **một cặp trạng thái bị lệch** trong hộp
thoại nhập: xoá định danh thì cờ hợp lệ tự tắt và cảnh báo biến mất; xoá danh
sách layer mà quên `picks` thì nút Nhận vẫn sáng. Đó không còn là chuỗi lỗi rời
rạc mà là **một component mang 8 mảnh trạng thái phải cùng đúng cùng sai**.

Nay gom `drawingLayers` · `snapshotOf` · `truncated` · `skipped` · cờ hợp lệ vào
một khối `Snapshot | null`. Tính hợp lệ **suy ra** từ khối đó chứ không giữ cờ
riêng — không còn cặp nào để lệch. Hành vi không đổi: vẫn 42/0/4 trên bản vẽ
thật.

Hai P1 đi kèm:

- **Định danh phải lấy từ chính phản hồi `/drawing-info`**, không phải từ lượt
  `/docs` trước đó. Bản vẽ có thể bị đóng rồi mở lại **giữa hai lượt gọi**, và
  khi đó số layer trả về thuộc một database khác với thứ `/docs` vừa mô tả.
  Phản hồi mang sẵn `document.instance`.
- **Đích biến mất thì DỜI sang bản vẽ khác còn mở.** Giữ nguyên là ô chọn trỏ vào
  một mục không tồn tại, và người dùng phải đóng hộp thoại rồi mở lại mới chọn
  được gì.

### Fixed — kiểm KIỂU chứ không chỉ kiểm "có mặt"

`Number(null)` là `0` và `Number("")` cũng là `0`, nên một dòng
`{aci: null, linetype: null, lineweight: null}` lọt qua phép kiểm `!== undefined`
rồi chuẩn hoá thành màu `0`, `Continuous`, bề dày `0` — vẫn là **bịa dữ liệu**,
chỉ khó thấy hơn. Đây là lần thứ **ba** siết bộ lọc này; hai lần trước đều siết
nửa vời (`||` thay vì `&&`, rồi `!== undefined` thay vì kiểm kiểu).

### Fixed — Codex review vòng sáu: `instance` bắt "bản vẽ khác", không bắt "đã sửa"

Sửa một layer trong AutoCAD **giữ nguyên** `instance` — chỉ bộ đếm revision nhảy.
Nên chốt định danh ở vòng trước vẫn cho ảnh chụp cũ đi qua, rồi ghi màu và bề dày
lỗi thời vào hồ sơ trong im lặng. Nay so cả `revision`, và `/standards` nghe thêm
`drawingModified` để bộ đếm ấy được làm mới.

Một đánh đổi đã cân nhắc và ghi ra: **đổi tab trong AutoCAD cũng làm revision
nhảy** (AutoCAD dựng lại viewport — xem chú thích ở `docs.ts`), nên chốt này báo
cả khi người dùng không sửa gì. Chấp nhận, vì hai vế lệch nhau rất xa: báo thừa
tốn một cú bấm trên một lệnh **chỉ đọc**, còn bỏ sót thì hỏng dữ liệu hồ sơ.

Kèm một điểm nhỏ: hai bản vẽ **cùng tên tệp ở hai thư mục** phát cùng một `title`,
và ô chọn nguồn chỉ hiện tiêu đề — người dùng không phân biệt được, chọn nhầm là
nhập bảng layer của bản vẽ khác. Trùng thì nay hiện luôn đường dẫn.

### Fixed — Codex review vòng bảy: sửa CA thay vì sửa NGUYÊN TẮC

Nhóm "chỉ có trong hồ sơ" bị ẩn khi danh sách **bị cắt**, nhưng vẫn hiện khi có
dòng **đọc không nổi**. Hai thứ đó là **cùng một tình huống nhận thức**: không
đọc được thì không biết bản vẽ còn những layer nào — mà "không biết" thì không
được kết luận "layer này không còn", và tích một dòng ở đó là **xoá khỏi hồ sơ**.
Nay gom thành một khái niệm `incomplete`, đúng cho cả hai nguồn.

- **Bản vẽ chưa lưu trùng tiêu đề không thể chỉ đích danh.** Chúng không có đường
  dẫn nên `targetOf()` lùi về tiêu đề, và hai bản vẽ như vậy cho ra **cùng một
  đích** — máy chủ từ chối vì mơ hồ, còn ô chọn thì có hai mục giống hệt.
  `/drawing-info` nhận đích theo đường dẫn hoặc tiêu đề, **không** nhận
  `instance`, nên không định danh nào cứu được. Bỏ chúng khỏi danh sách và nói lý
  do, thay vì bày một lựa chọn chắc chắn hỏng.
- **Khe đua giữa sự kiện và lượt đọc lại.** Trang cha nghe `drawingModified` rồi
  gọi `loadDocs()` — bất đồng bộ, và trong khoảng chờ ấy bộ đếm revision hộp thoại
  nhìn thấy vẫn là số cũ, nút Nhận vẫn sáng. Nay mốc thay đổi đi thẳng qua prop và
  vô hiệu ảnh chụp **ngay**. Tín hiệu phải đi qua prop chứ không nghe thẳng:
  `check:boundaries` chặn `features/standards` import `features/acad-connection`
  — và nó chặn đúng, tôi đã thử đường tắt đó và bị bắt.

### Changed — Codex review vòng tám: bỏ hẳn cơ chế "giữ ảnh chụp cho tươi"

Tám vòng, và ba vòng gần nhất đều là **bản vá của tôi đẻ ra vấn đề mới**. Nhìn
lại thì nguyên nhân chung rất rõ: tôi cố canh cho một ảnh chụp luôn khớp bản vẽ
bằng cách thêm tín hiệu — `instance`, `revision`, `changedAt`, `readAt`,
`collectedAt` — và các tín hiệu bắt đầu mâu thuẫn nhau:

- So `revision` giữa **hai lượt đọc khác nhau** vừa báo **sót** (bản vẽ đổi giữa
  lúc plugin thu thập và lúc phản hồi về) vừa báo **thừa** (đổi tab cũng làm nó
  nhảy). Riêng đường `withLegacySelectionCatalog()` tự làm revision nhảy rồi kẹt
  vĩnh viễn ở trạng thái "đã đổi", thử lại bao nhiêu lần cũng vậy.
- Sự kiện thì bất đồng bộ, nên luôn còn một khe giữa lúc AutoCAD đổi và lúc giao
  diện biết — bịt bằng cách nghe thêm sự kiện chỉ làm khe hẹp lại, không đóng.

Không khe nào đóng được bằng cách thêm tín hiệu, vì nguyên nhân chung là **có
một khoảng thời gian giữa lúc đọc và lúc ghi**.

Nên bỏ hẳn khoảng đó: bảng trong hộp thoại là **bản xem trước**, còn lúc bấm Nhận
thì **đọc lại** và áp trên số liệu vừa đọc. Tích của người dùng gắn với tên layer
nên sống sót qua lượt đọc lại; thứ gì đã tích mà lượt đọc mới không còn thấy thì
**dừng lại và bày số liệu mới**, thay vì ghi bừa. Nếu lượt đọc lại cho thấy bảng
không đầy đủ mà người dùng đang tích dòng xoá thì cũng dừng.

Gỡ được: `changedAt`, `readAt`, `revision`, phép so instance-để-đo-độ-tươi, và
prop nối giữa trang với hộp thoại. Hành vi trên bản vẽ thật không đổi (42/0/4),
và đường Nhận đã chạy end-to-end: đọc lại → áp vào bản nháp → nút Lưu bật, máy
chủ vẫn nguyên v10 với 5 layer.

### Fixed — Codex review vòng chín: năm lỗi biên của thiết kế đọc-lại

- **Huỷ giữa lúc đang đọc lại vẫn sửa bản nháp (P1).** `apply()` chờ một lượt
  đọc, và trong khoảng đó Huỷ / Esc / bấm nền vẫn ăn — hộp thoại gỡ khỏi cây
  nhưng phần tiếp sau của hàm bất đồng bộ vẫn chạy và vẫn gọi `onApply`. Nay khoá
  mọi đường đóng khi đang bận, và có cờ huỷ chặn ở phía sau.
- **Bản vẽ chưa lưu chỉ định danh bằng tiêu đề (P1).** Đóng nó rồi mở một bản vẽ
  chưa lưu khác trùng tiêu đề thì máy chủ giải ra bản thay thế, và hộp thoại áp
  lựa chọn của bản vẽ này lên bảng layer của bản vẽ kia. Nay ảnh chụp mang
  `document.instance` của **chính phản hồi**, và lượt đọc lại phải khớp.

  Khác hẳn cách dùng `instance` đã bỏ ở vòng tám: ở đây so **hai phản hồi với
  nhau** (xem trước ↔ đọc lại), không so phản hồi với một lượt `/docs` đọc ở thời
  điểm khác. Cùng nguồn, cùng loại, nên không có đua.
- **Tiêu đề trùng phải so với MỌI bản vẽ**, không chỉ với các bản vẽ chưa lưu
  khác: một bản vẽ chưa lưu trùng tiêu đề với một bản vẽ **đã lưu** cũng làm máy
  chủ trả `target_ambiguous`.
- **`aci: null` biến thành màu 0.** `num()` gọi `Number()`, mà `Number(null)` là
  `0` và hữu hạn — nên `num(aci) ?? num(color)` cho ra `0` và đường lùi `color`
  không bao giờ chạy. Layer nhập vào mang màu 0 thay vì màu thật. Nay chọn theo
  **kiểu**.
- **Ô tích vẫn bấm được lúc đang đọc lại.** `apply()` chụp tập đã tích *trước*
  khi chờ, nên tích thêm lúc đó chỉ đổi thứ hiện trên màn hình còn thứ được áp
  vẫn là tập cũ — người dùng thấy một đằng, app ghi một nẻo.

### Fixed — Codex review vòng mười: bốn P1 cùng một câu hỏi, và một mất mát im lặng

Bốn phát hiện đầu đều là **cùng một câu hỏi diễn đạt bốn kiểu**: *"thứ đang áp có
đúng là thứ người dùng vừa xem không, và ta có BIẾT điều đó không?"* Bốn lỗ:

- **Đóng hết bản vẽ** → hiệu ứng dời đích thoát sớm ở nhánh `!docs.length`, nên
  hộp thoại tiếp tục bày số liệu của một bản vẽ đã đóng và nút Nhận vẫn sáng.
- **Đích đổi trong lúc đọc lại** → phần tiếp sau chỉ kiểm cờ huỷ, không kiểm đích
  còn là đích cũ không.
- **Thiếu `instance`** → chốt định danh bỏ qua phép so, tức **fail open**. Nay
  fail closed cho bản vẽ **chưa lưu** (chúng chỉ định danh được bằng tiêu đề);
  bản vẽ đã lưu thì đường dẫn đã là định danh duy nhất nên không cần.
- **Đích ban đầu có thể không chọn được** → khởi tạo từ `docs` thay vì từ danh
  sách đã lọc, nên hộp thoại mở ra đã hỏng sẵn khi bản vẽ đang hoạt động là một
  bản chưa lưu trùng tiêu đề.

Và một mất mát im lặng: **layer dùng màu thật (true color)**. Hồ sơ chỉ biểu diễn
được chỉ số ACI `0…256` hoặc ba tên. Plugin gửi `aci` = `colorIndex()`, mà với
màu thật thì chỉ số đó **không** mang màu người dùng đặt — nhập vào là lặng lẽ
thay màu layer bằng một ACI sai. Nay bỏ chúng và đếm vào `skipped`, đúng nguyên
tắc đã dùng cho dòng thiếu thuộc tính: **không biểu diễn được thì không bịa**.
Dấu hiệu là `rgb` khác `[0,0,0]`; đo trên bản vẽ thật thì 43 layer đều dùng ACI
và cả 43 đều `rgb: [0,0,0]`, nên bộ lọc không loại nhầm dòng nào.

### Fixed — Codex review vòng mười một: phép so luôn đúng, và màu đen tuyền

- **Chốt "đích đã đổi" của vòng trước là phép so vô nghĩa (P1).** `startedFor` và
  `target` **cùng đóng gói từ một lần render**, nên chúng luôn bằng nhau và chốt
  không bao giờ phát hiện được gì. Muốn biết đích đã đổi thì phải đọc một ô nhớ
  **sống** (`useRef`), không phải một biến đã đông cứng lúc hàm được tạo.
- **Vứt đích mà không huỷ lượt đọc đang bay (P1).** `preview("")` thoát ngay ở
  `if (!file) return` nên không cấp vé mới, và phản hồi cũ qua được phép kiểm vé
  rồi dựng lại ảnh chụp của bản vẽ đã đóng — bật lại nút Nhận.
- **Màu thật ĐEN TUYỀN không phân biệt được với ACI.** `rgb: [0,0,0]` giống hệt
  một layer dùng ACI, và payload không mang `colorMethod`. Nhưng nó lộ ở chỗ
  khác: `colorIndex()` của layer màu thật trả `0`, mà `0` (ByBlock) và `256`
  (ByLayer) đều **không phải màu hợp lệ cho một layer** — một layer không kế thừa
  màu từ chính nó, và `layerColor()` của daemon lặng lẽ đổi cả hai thành `7` lúc
  áp dụng. Nay bỏ chúng.

### Fixed — Codex review vòng mười hai: lỗi cũ đè lên bản xem trước mới

Nguồn A bị đóng giữa chừng, hộp thoại dời sang B và nạp xong bản xem trước của B
— rồi lượt đọc của A hỏng và ghi lỗi của A đè lên. Bảng của B vẫn nằm đó nhưng bị
giấu sau một thông báo lỗi không liên quan, và lượt nạp thành công thì không xoá
lỗi. Nay `catch` và `finally` cũng kiểm vé, không chỉ đường thành công — và
`apply()` dùng **chung** bộ đếm vé với `preview()`, vì hai đường cùng ghi vào
`snapshot`/`error`/`busy`.

### Technical — bề dày phải quy đổi, và không được đoán

Plugin gửi thẳng `(int)layer->lineWeight()`, tức **luôn là mã DXF group 370**;
kho hồ sơ nhận ba **tên** và số **milimét** `0…2.11`. Bỏ bước đổi là mọi layer
nhập vào bị máy chủ từ chối từng dòng một.

`lineweightFromDxf()` chia thẳng cho 100 chứ không dùng ngưỡng đoán. Bộ mẫu đoán
bằng `n > 2.11 ? n/100 : n`; trên bản vẽ thật hai cách cho cùng kết quả (giá trị
hợp lệ duy nhất ≤ 2.11 là `0`, mà `0/100` cũng là `0`), nhưng ngưỡng ấy sẽ đọc
một giá trị lạ như `2` thành *2 mm* thay vì *0.02 mm*. Nguồn đã chắc chắn là
group 370 thì không có gì để đoán.

Phải làm tròn hai chữ số: `13/100` trong dấu phẩy động là `0.13000000000000003`,
và giá trị đó không khớp mục nào trong ô chọn — dòng vừa nhập sẽ hiện ra như một
giá trị lạ. Test khoá điều kiện **mọi giá trị quy đổi đều tồn tại trong
`LINEWEIGHTS`**.

- `features/standards/ImportLayers.tsx` (mới); `reconcileLayers()`,
  `applyLayerReconcile()`, `lineweightFromDxf()`, `normalizeDrawingLayers()`,
  `countLayerPicks()` trong `model.ts`.
- 2 test mới (27 test cho module này) dùng đúng phân bố group 370 đo được trên
  bản vẽ thật: `-3 · 0 · 5 · 9 · 13 · 15 · 18 · 30 · 35 · 40`.
- **Đã kiểm trên AutoCAD 2027 thật:** bản vẽ 43 layer đối chiếu với hồ sơ 5 layer
  cho ra **42 thêm · 0 khác · 4 chỉ-có-ở-hồ-sơ** — phép cộng khớp, vì đúng layer
  `0` trùng nhau hoàn toàn. Quy đổi hiện đúng trên màn hình: `-3`→`Default`,
  `13`→`0.13`, `5`→`0.05`, `15`→`0.15`. Bấm Huỷ, hồ sơ vẫn nguyên 5 layer.

---

## 2026-08-12 — Bảng đối tượng đã nhận diện (mục 2.1)

### Added — `/review` hiện đối tượng các ánh xạ bắt được

Máy chủ **đã trả** dữ liệu này trong kết quả quét từ trước; `/review` nhận rồi
vứt. Hệ quả: câu app khuyên ở màn Hồ sơ — *"lưu, rồi quét ở màn Kiểm tra và đối
chiếu số đối tượng"* — không làm theo được. Đây là vòng phản hồi **duy nhất** cho
câu "ánh xạ của tôi có đúng không", vì bảy route của `drawingStandards.ts` không
có dry-run nào.

Gộp theo ánh xạ, không phải danh sách phẳng: câu hỏi thật là *"quy tắc Phòng
khách bắt được bao nhiêu cái"*, nên số đếm mỗi nhóm là câu trả lời còn danh sách
chi tiết thì gập lại. Ánh xạ bắt **0 đối tượng** vẫn nằm nguyên trong bảng và
được tô đậm — nó vắng mặt hoàn toàn khỏi `scan.objects`, mà đấy lại là dấu hiệu
quy tắc sai rõ nhất. Vì vậy `groupObjectsByMapping()` lấy danh sách ánh xạ từ
**hồ sơ**, không phải từ kết quả quét.

### Fixed — phản hồi `/scan` gửi diện tích thô, không kèm đơn vị

`displayObjects()` chỉ được áp cho bản lưu phiên; phản hồi gửi `parsed.objects`.
Với bản vẽ mm, một phòng 20 m² ra `20000000` — và giao diện không có cách nào
biết vì payload không mang trường đơn vị nào. Nay gửi đúng bản đã lưu vào phiên.

`areaUnit` **không phải lúc nào cũng `m²`**: `metersPerUnit()` chỉ nhận INSUNITS
1/2/4/5/6 (inch, foot, mm, cm, m); mọi giá trị khác — kể cả `0` là "không đơn
vị", rất thường gặp ở bản vẽ cũ — giữ số thô và được gắn nhãn `drawing-unit²`.
Giao diện hiện đơn vị máy chủ trả về chứ không ghim một chữ.

### Fixed — `0` là "chưa đo được", không phải "diện tích bằng không"

Đo trên bản vẽ thật lộ ra: 8 đối tượng khung tên, cả 8 đều `area: 0, width: 0,
height: 0`. Chính bộ máy gọi đó là *"chưa đo được kích thước tự động"*
(`frame-unmeasurable`). Chốt của tôi kiểm `!== undefined` nên lọt, và bảng sẽ
hiện "0,00 m²" — bịa ra tám vùng rỗng ngay tại con số dùng để bóc tách. Nay
"đo được" nghĩa là **dương**, cho cả diện tích lẫn rộng/cao.

### Changed — hai chỗ cố ý khác bộ mẫu

- **Cờ cắt đọc từ `evidence.standardsScan.objectsTruncated`**, không cộng tay từ
  các nhóm: máy chủ tính nó trên số đối tượng **trước** bộ lọc diện tích, còn
  tổng các nhóm là số **sau** khi lọc. Cộng tay sẽ bỏ sót cờ khi bộ lọc cắt nhiều.
- **Câu banner.** Bộ mẫu khuyên "quét lại trên phạm vi hẹp hơn"; `/scan` chỉ nhận
  `target` + `profileId` + `readOnly`, không có tham số phạm vi. Đường thật là thu
  hẹp mẫu nhận diện ở màn Hồ sơ — đã ghi đúng như vậy.

### Fixed — Codex review: "bắt 0" không phải lúc nào cũng là lỗi

Phiên bản đầu coi **mọi** ánh xạ bắt 0 đối tượng là "gần như chắc chắn sai". Sai
theo hai đường, và cả hai đều biến bảng thành máy báo động giả:

- **Ánh xạ tuỳ chọn** (`required: false`) bắt 0 là chuyện bình thường — bản vẽ
  này chỉ không có loại đó. Hồ sơ mặc định có đúng hai ánh xạ như vậy
  (`living-room`, `section-plane`), nên bảng đã gắn cảnh báo cho đúng hai dòng
  hoàn toàn lành — **trên chính bản vẽ tôi đem ra làm bằng chứng là nó chạy
  đúng**.
- **Danh sách bị cắt** thì `0` nghĩa là *chưa quét tới*, không phải *không khớp
  gì*. `acadstd:scan` chia một ngân sách 2.000 mục **dùng chung** cho mọi ánh xạ
  và tiêu theo đúng thứ tự hồ sơ:
  `(if (< count maxItems) (scan-map … (- maxItems count)))`. Ánh xạ đầu ăn hết
  ngân sách là những ánh xạ sau **không bao giờ được chạy**.

Nay chỉ báo động khi ánh xạ **bắt buộc** và lượt quét **không bị cắt**; hai
trường hợp còn lại có ghi chú trung tính nói đúng điều đang biết.

### Fixed — Codex review vòng hai: gom số liệu cũ theo hồ sơ mới

Cùng một khuôn đã ám cả tính năng này: **hai nguồn đọc ở hai thời điểm thì sẽ
lệch**. Kết quả quét là của hồ sơ phiên bản N, còn `profile.mappings` đã là N+1
sau khi người dùng sửa hồ sơ. Gom số liệu cũ theo danh sách mới cho ra hai lời
nói dối: một quy tắc **vừa thêm** hiện ra như "bắt 0" dù nó chưa từng được quét,
và một quy tắc **vừa đổi tên** dán nhãn mới lên số liệu cũ.

Băng cảnh báo lệch phiên bản ở đầu trang chỉ *nhắc*; bảng thì vẫn bịa. Nay khi
lệch, bảng chỉ hiện thứ lượt quét **thật sự tìm được** — nhãn lấy từ chính đối
tượng, tức nhãn máy chủ gắn lúc quét — và nói rõ vì sao thiếu dòng bắt 0.

### Fixed — Codex review vòng ba: bản vá vừa rồi đẻ ra một lời nói dối khác

Nhánh "bảng rỗng" nói *"Hồ sơ này chưa có ánh xạ nào"*. Nhưng bản vá lệch phiên
bản ở trên **cố ý** truyền danh sách ánh xạ rỗng khi lệch, nên một lượt quét
không tìm được gì sẽ rơi đúng vào nhánh ấy — rồi báo hồ sơ không có ánh xạ nào,
trong khi nó có đủ. Nay hai nguyên nhân có hai câu riêng.

### Technical

- `features/standards/RecognizedObjects.tsx` (mới), `groupObjectsByMapping()` và
  `normalizeMappedObject()` trong `model.ts`, một dòng ở
  `drawingStandards.ts`.
- 1 test mới (23 test cho module này), dùng đúng hình dạng dữ liệu đo được trên
  máy thật. `pnpm verify` 164 test, exit 0.
- **Đã kiểm trên AutoCAD 2027 thật.** Quét bản vẽ đang mở: `Khung vẽ` 8 đối
  tượng với diện tích **"—"** (không phải "0,00 m²"), `Phòng khách` và `Mặt phẳng
  cắt` mỗi cái 0 đối tượng, in đậm kèm câu "gần như chắc chắn sai" và không có
  nút bung. Bung `Khung vẽ` ra: 8 hàng `INSERT` trên layer `0`, rộng/cao/diện
  tích đều "—". Khớp chính xác payload đo bằng curl.

  Ảnh chụp màn hình từng lỗi `params.clip.scale` và `read_page` trả viewport
  0×0 — hoá ra **không phải extension hỏng** mà là cửa sổ Chrome có chiều cao 0.
  Đặt lại kích thước cửa sổ là chạy bình thường. Ghi lại để lần sau không kết
  luận vội là công cụ hỏng.

---

## 2026-08-12 — Rà soát panel cũ trước khi xoá: 13 khoảng trống, 3 đã đóng

### Added — hai trường hồ sơ từng vô hình ở màn mới

Rà từng chức năng của `DrawingStandardsPanel.tsx` (2.411 dòng) đối chiếu
`/standards` + `/review` — theo đúng bài học đã ghi sau lượt `/workspace`: rà
trước, port cái thiếu, rồi mới xoá.

Việc rà lộ ra ngay hai trường panel cũ sửa được mà màn mới **không có ô nào**:

- `drawing.linearFormat` — kiểu ghi số dài (LUNITS).
- `drawing.frameTolerancePercent` — khung lệch quá bao nhiêu phần trăm thì lượt
  quét báo lỗi.

Chúng sống sót qua mỗi lượt lưu nhờ phép vá `...drawing`, nên không ai mất dữ
liệu và cũng **không ai biết chúng tồn tại**. Đúng loại lỗi với 20 trường
dimension từng bị giấu, chỉ nhỏ hơn — và chỉ lộ ra vì rà lại panel cũ.

### Fixed — ô “Loại” của ánh xạ bị khoá nhầm thành danh sách chọn

Panel cũ cho gõ tự do. Bộ máy nhận diện khung tên bằng
`/frame|sheet|title.?block|khung/i` trên `kind`, nên `sheet` hay `khung-ten` đều
là giá trị dùng được — khoá thành `select` là lấy mất chúng. Nay gõ tự do kèm
gợi ý, và vẫn không gợi ý `text` (loại không tồn tại).

### Fixed — `linearFormat` lưu được nhưng áp dụng không hiểu

Codex bắt: `stringValue()` cho qua mọi chuỗi ≤64 ký tự, còn `linearFormat()` lúc
áp dụng chỉ hiểu năm tên hoặc số 1–5. Gõ `6` hay `foo` là lưu êm rồi hỏng ở
`apply-units`. Cùng một cái bẫy với màu `RGB(...)` và bề dày dạng chữ lạ — nay
chặn cùng một cách.

### Fixed — Codex review: giới hạn độ dài, và tài liệu nói dối sau khi bỏ theo dõi bộ mẫu

- **Ô Loại của ánh xạ vượt 64 ký tự thì lưu hỏng.** Chính lượt này mở nó thành gõ
  tự do, nên giới hạn của daemon mới trở nên chạm tới được — dán một đoạn dài là
  ăn 400. Gom mọi giới hạn chữ vào `MAX_LENGTHS`: tên layer 255, kiểu nét 255,
  nhãn ánh xạ 160, loại ánh xạ 64.
- **Bỏ theo dõi `mau-thiet-ke/` làm `DEVELOPMENT.md` nói dối.** Nó vẫn trỏ tới bộ
  mẫu như nguồn thiết kế, trong khi một bản clone mới sẽ không có thư mục đó —
  vi phạm quy tắc "tài liệu phải đủ rõ để người khác clone và tiếp tục". Nay ghi
  rõ bộ mẫu nằm ngoài repo, kèm ba lệnh tra lại bản đã commit ở `82f5232`, và
  nói thẳng rằng bản **mới nhất** chỉ có trên máy người thiết kế.
- **Hai trường `drawing` mới chưa vào mô hình dữ liệu.** Đã bổ sung bảng đầy đủ
  sáu trường `drawing` vào `DEVELOPMENT.md` kèm ràng buộc và nơi đọc chúng lúc
  áp dụng.

### Technical — kết quả rà soát

**Không xoá được panel.** Còn 10 khoảng trống sau khi đóng 3 cái trên. Ghi đầy đủ
trong `ROADMAP.md`; bản đề xuất thiết kế kèm ràng buộc từng mục ở
`DE-XUAT-UI-CON-THIEU.html`.

Ba sự thật máy chủ đào ra khi đánh giá, cả ba đều trái với thứ nhìn giao diện mà
đoán:

- **`bounds` của ánh xạ là ba thứ nằm chung một tên.** `minX/minY/maxX/maxY` tới
  chương trình LISP lọc theo vùng; `minArea/maxArea/areaUnit` lọc ở daemon **sau**
  lượt quét; còn `width/height/tolerancePercent` — thứ hồ sơ mặc định đang có ở
  `drawing-frame` — **không ai đọc**. Việc so khung với khổ giấy lấy số từ
  `drawing.paper`, không phải từ đây.
- **Máy chủ đã trả `objects` và `dimensions` trong kết quả quét**, `/review` nhận
  rồi vứt. Hệ quả: câu app đang khuyên ở màn hồ sơ — “lưu, rồi quét ở màn Kiểm
  tra và đối chiếu số đối tượng” — hiện **không làm theo được**.
- **`activeProfileId` không phải một thiết lập.** Daemon tính nó bằng
  `state.profiles[0]?.id`. Dấu ★ của panel cũ nói “hồ sơ đầu danh sách”, không
  phải “đang dùng” — cố ý không port.

**Quyết định của user (2026-08-12):** bỏ hẳn nhóm công cụ thao tác trực tiếp
(`scale`, `rotate`, `color`, `layer`, `area`, đọc bộ chọn). Chúng là lệnh AutoCAD
gốc, và là nhóm rủi ro nhất — `scale`/`rotate` chạy được trên cả bản vẽ, không
hoàn tác được từ app. Thứ tự năm mục còn lại: 2.1 → 1.1 → 2.2 → 1.2 → 2.3; xoá
panel khi xong ba mục đầu.

Codex cũng soi bộ mẫu và tìm ra **ba hiểu nhầm y hệt ba cái bản dựng thật vừa
sửa** — loại `text` không tồn tại, “không mẫu nào” bị hiểu là khớp-0 trong khi
thật ra khớp-tất-cả, và ACI 10–249 đoán màu bằng HSL — cộng một lỗi mất chữ khi
rời ô nhập. Bốn điểm đó nằm trong `mau-thiet-ke/`, đã ghi thành mục riêng (M1–M4)
của bản đề xuất để người thiết kế sửa trước khi thiết kế tiếp.

---

## 2026-08-12 — Ba bảng của bộ mẫu vào app thật

### Added — `/standards` sửa được layer, ánh xạ và 20 trường kích thước

Ba khối cuối của bộ mẫu, dựng trong `features/standards/ProfileTables.tsx`:

- **Bảng layer** — tên, màu (bảng chọn ACI), kiểu nét, bề dày, bắt buộc; thêm và
  xoá dòng. Dòng sai viền đỏ kèm lý do ngay dưới ô, và khoá nút Lưu.
- **Bảng ánh xạ** — mỗi mẫu nhận diện là một **thẻ** riêng thay vì một chuỗi
  ngăn bằng dấu phẩy. Lý do: một dấu phẩy thừa tạo ra mẫu rỗng — thứ khớp mọi
  đối tượng, và không ai nhìn ra vì nó vô hình.
- **20 thiết lập kích thước nâng cao** — khối gập, dựng từ chính dữ liệu hồ sơ.
  Trước đó chúng bị `applyProfileEdits()` giữ lại nhưng không ai thấy được.

`applyProfileEdits()` nay ghi ngược cả ba. Mapping vá theo `id` lên bản ghi gốc
để `bounds` sống sót; layer thì ghi trọn năm trường vì `LayerStandard` chỉ có
đúng năm. Đã kiểm trên hồ sơ thật của daemon: thêm mẫu, đổi bề dày, đổi
`arrowhead` — cả hai `bounds` (`420×297` và `minArea 6–80 m²`) và cả 23 trường
`dimension` còn nguyên.

### Added — lượt quét mang số phiên bản hồ sơ đọc được

`POST /scan` trả thêm `profileVersion`, **chụp lúc quét**. Đọc bộ đếm hiện tại
khi vẽ màn hình sẽ khoác số mới cho một lượt quét cũ — đúng thứ chip này sinh ra
để bác bỏ.

`/review` hiện nó ở phụ đề và ở chip cạnh mã phiên (hash để trong `title`). Khi
hồ sơ đã đổi, cảnh báo nói bằng số — *"Lượt quét theo phiên bản 6; hồ sơ giờ là
phiên bản 7"* — và nút quét đổi nhãn thành **Quét lại theo phiên bản 7**. Thiếu
một vế thì không bịa số: vẫn cảnh báo, nhưng không nói "phiên bản 0".

### Fixed — bảng bề dày nét dựng sai thang đo

Tôi dựng nó theo mã DXF group 370: 1/100 mm, ba giá trị âm cho
`Default`/`ByLayer`/`ByBlock`. Kho hồ sơ nhận **milimét `0…2.11`** cộng ba
**chuỗi**. 26 trong 27 lựa chọn sẽ ăn 400 ngay lúc lưu.

Đo trực tiếp trên daemon thay vì suy: `40` → 400 *"phải nhỏ hơn hoặc bằng
2.11"*, `-3` → 400 *"phải lớn hơn hoặc bằng 0"*, `"Default"` → 200. Việc đổi
sang mã âm là của `lineweight()` ở bước **áp dụng**, không phải của kho — hai
thang đo, hai tầng, tôi gộp làm một.

Đây là lần thứ hai trong cùng một màn hình tôi đoán khoảng giá trị thay vì đọc
`standardsProfile.ts`. Lần trước là các ô số của form.

### Fixed — ba khe do chính ba bảng mới mở ra

Tự rà lại trước khi commit, cả ba đều thuộc cùng một dạng: **một thao tác trông
vô hại làm mất hoặc làm hỏng dữ liệu mà giao diện không mô hình hoá.**

1. **Sửa mã một ánh xạ làm mất `bounds`.** `applyProfileEdits()` tìm bản ghi gốc
   theo mã đang hiện, nên vừa chữa một lỗi gõ là phép tìm trượt và khung giới
   hạn diện tích biến mất. Nay `MappingRule` mang thêm `sourceId` — mã **lúc nạp
   về** — và phép ghép bám theo nó. Dòng thêm mới có `sourceId` rỗng nên không
   vơ nhầm bản ghi nào, kể cả khi mã của nó trùng một bản ghi đang có.

2. **Xoá trắng một trường kích thước số rồi gõ lại biến nó thành chuỗi.** Kiểu
   được suy từ giá trị *đang gõ*; xoá trắng làm nó thành `""`, và từ đó mọi ký
   tự vào đều là chuỗi. `numberValue()` của daemon từ chối thẳng chuỗi — kể cả
   `"2"`. Nay kiểu lấy từ bản **đã lưu**, trường boolean render bằng ô tích thay
   vì ô chữ, và `profileSaveBlockedReason()` chặn trước kèm tên trường. Đo trên
   daemon: `textGap: "0.7"` → 400 *"phải là số hữu hạn"*, `annotative: "false"`
   → 400 *"phải là boolean"*.

3. **Bấm × một thẻ mẫu xoá cả thẻ trùng với nó.** Ô thẻ khử trùng lặp lúc thêm
   nhưng dữ liệu máy chủ thì không, và nút xoá lọc theo **giá trị**. Nay xoá
   theo vị trí.

### Fixed — Codex review: bảng ánh xạ hứa ba thứ chương trình LISP không làm

Đọc `acad-lisp/headless/standards_lib.lsp` mới thấy hết. `acadstd:scan-map` chỉ
rẽ nhánh trên `"ROOM"`; mọi `kind` khác chạy chung `acadstd:map-entity-p`, và
hàm đó đọc `nth 3` (layer), `nth 4` (block), `nth 6` (loại đối tượng) — **không
bao giờ đọc `nth 5` (mẫu chữ)**.

| `kind` | mẫu layer | mẫu block | mẫu chữ | loại đối tượng |
|---|---|---|---|---|
| `room` | dùng | dùng | **dùng** — chọn nhãn TEXT/MTEXT | dùng |
| mọi giá trị khác | dùng | dùng | **bỏ qua** | dùng |

Ba hệ quả, cả ba đã sửa:

- **Loại `text` là thứ tôi bịa ra.** Nó hứa một cách khớp không tồn tại. Đã bỏ
  khỏi danh sách chọn; cột mẫu chữ ghi rõ “(chỉ room)”, và đặt mẫu chữ ở loại
  khác thì bị chặn kèm lý do.
- **Không có cột loại đối tượng.** Ánh xạ mới khởi tạo `entityTypes: []`, mà
  `acadstd:pattern-p` trả TRUE cho mẫu rỗng — nên quy tắc vơ mọi loại đối tượng.
  Hồ sơ mặc định *đang dùng* trường này (`INSERT`, `LWPOLYLINE`, `HATCH`…) và
  giao diện không cho thấy nó. Đã thêm cột.
- **“Không có mẫu nào” tôi mô tả ngược.** Tôi viết là “sẽ không khớp đối tượng
  nào”; `map-entity-p` dòng 168 coi *layer rỗng VÀ block rỗng* là **khớp mọi
  thứ**. Ngược đúng hướng nguy hiểm.

### Fixed — Codex review: bốn ràng buộc của daemon giao diện chưa kiểm

Mỗi cái đều để nút Lưu sáng rồi kết thúc bằng 400:

- **Mã ánh xạ** phải khớp `PROFILE_ID_PATTERN` (`foo/bar`, `-mo-dau` bị từ chối).
- **Trùng mã** so sau khi VIẾT HOA (`assertUnique`), nên `abc` và `ABC` là trùng.
  Phép so của layer cũng đổi từ locale `vi` sang `en-US` cho khớp daemon.
- **Nhãn ánh xạ** không được rỗng.
- **Bề dày và màu dạng CHUỖI SỐ** thì tôi chặn nhầm: `lineweight()` ép kiểu bằng
  `Number(value)` nên `"0.35"` và `"35"` đều chạy; `numericColor()` hiểu `"7"`,
  `ByLayer`, `ByBlock`. Vì phép kiểm chạy cho mọi dòng, một hồ sơ cũ như thế sẽ
  không sửa được gì nữa. Ngược lại `RGB(...)` thì **phải** chặn — nó lưu êm rồi
  ném lỗi lúc áp dụng.

Ô thẻ cũng đã nhận `disabled`: trước đó thêm một mẫu trong lúc PUT đang bay thì
nó biến mất khi phản hồi máy chủ thay bản nháp.

### Fixed — Codex review vòng hai: ba lỗi nữa, một trong đó làm cảnh báo vô hình

- **`var(--danger)` không tồn tại.** Tôi bịa ra một token thay vì đọc bảng token
  của hệ — nó đơn sắc có chủ ý: đen, xám, một xanh nhấn. Trình duyệt bỏ cả ba
  khai báo, nên **dòng sai trông y hệt dòng đúng**. Tệ hơn nữa: tôi từng chụp
  màn hình và nghĩ đã thấy viền đỏ — thứ tôi thấy là vòng focus xanh của ô vừa
  gõ. Nay báo bằng độ đậm và mực như `mau-thiet-ke/css/app.css` làm: nền hàng
  `--fg-02`, viền `--fg` 1.5px, lời báo có dấu vuông đặc.
- **Không gõ được số thập phân ở bảng nâng cao.** `Number("2.")` là `2`, nên ô
  điều khiển chuẩn hoá ngay khi vừa gõ dấu chấm. Bình luận tôi viết nói ô này
  giữ được `2.` — bình luận đúng, mã thì không. `NumberField` ở `page.tsx` đã
  giải đúng bài này từ trước; nay tách `ExtraValueField` dùng cùng cách.
- **Chặn nhầm quy tắc `room` chỉ có mẫu chữ.** `acadstd:scan-room` tự thu hẹp
  bằng cấu trúc — chỉ nhận đường bao KÍN có TEXT/MTEXT nằm trong — và dùng chính
  mẫu chữ để chọn nhãn. Lọc phòng theo nhãn là cách dùng thường gặp nhất của
  loại này, và tôi đếm độ rộng bằng cùng một công thức cho cả hai đường quét.

Khoá dòng ánh xạ cũng đổi từ chỉ số sang `sourceId`: xoá một dòng phía trên làm
React tái dùng component của dòng dưới cho một ánh xạ khác, mang theo cả chữ
đang gõ dở trong ô thẻ.

### Không sửa — có lý do

- **Khoảng giá trị của 20 trường kích thước nâng cao.** Chúng khác nhau thật
  (`min: 0`, `0.01`, `0.000001`; `font` có `allowEmpty`), và chép sang web sẽ
  trôi lệch ngay khi máy chủ thêm trường — phá đúng tính chất khiến bảng này
  đáng tin (dựng từ dữ liệu). Lỗi khoảng của daemon đã nêu đích danh trường và
  bờ (`profile.dimension.widthFactor: phải lớn hơn hoặc bằng 0.01`) và
  `daemonFailureText()` hiện nguyên văn. Phép kiểm **kiểu** thì giữ, vì lỗi kiểu
  mới là loại cho ra lời báo khó lần.
- **Hai phát hiện nằm trong `mau-thiet-ke/`, không phải app.** Bảng màu ACI
  10–249 suy màu bằng HSL, và ô thẻ của bộ mẫu không nhận chữ đang gõ khi rời ô.
  Bản dựng thật cố ý **không** đoán màu, và **có** nhận chữ khi rời ô. Cần báo
  lại cho người thiết kế; bộ mẫu không nằm trong commit này.

### Changed — nói thẳng chỗ không có

Bộ mẫu có nút "Thử trên bản vẽ đang mở" cho ánh xạ. `drawingStandards.ts` phát
đúng bảy route và **không có dry-run** — nút đó trong mẫu chạy trên dữ liệu giả
trong trình duyệt. Bê nguyên là bịa ra một con số người dùng sẽ tin. Màn hình
thật ghi rõ là chưa có, và chỉ đường kiểm duy nhất: lưu → quét → đối chiếu.

Tương tự, ô kiểu nét gõ tự do chứ không phải danh sách chọn: màn này không mở
bản vẽ nên không biết bản vẽ đã nạp những kiểu nét nào.

### Technical

- Popover chọn màu dùng `position: fixed` — bảng nằm trong `.tablewrap` có
  `overflow: auto`, nên `absolute` bị cắt cụt tại mép bảng. Vị trí **đo bằng
  `useLayoutEffect`** rồi lật lên trên nếu tràn đáy; bản đầu đoán sẵn 260px
  trong khi phần tử thật cao hơn 300px, và hàng cuối bảng mở ra một popover cụt.
- Màu ACI chỉ vẽ ô màu cho chỉ số 1–9. Từ 10 trở đi là bảng tra của AutoCAD;
  đoán bằng công thức cho ra màu sai, mà một ô màu sai cạnh tên layer tệ hơn
  không có ô nào — người dùng dựa vào đúng nó để tìm nhầm lẫn.
- 8 test mới trong `test-standards-model.test.ts` (11 → 19). Một test cũ phải
  sửa: nó khẳng định layer đi **nguyên** từ bản gốc kèm `bounds`, trong khi
  `sanitizeLayer` của daemon vốn đã bỏ `bounds` — nó ghi lại hành vi của giao
  diện, không phải hợp đồng của máy chủ.

---

## 2026-08-12 — Bộ đếm phiên bản hồ sơ, và truy tiếp lỗi revision

### Added — hồ sơ quy tắc có số phiên bản đọc được

`revision` là hash nội dung: chính xác cho việc so sánh, nhưng `f304e8e7` không
nói gì với ai. Nay mỗi hồ sơ có thêm `version` — một bộ đếm tăng 1 **mỗi lần nội
dung thật sự đổi**.

Hai thứ, hai việc, giữ cả hai:

| | Dùng để | Lưu nội dung y hệt |
|---|---|---|
| `revision` (hash) | `If-Match`, chốt lượt quét | **không đổi** → lượt quét vẫn sống |
| `version` (số đếm) | hiển thị cho người | **không tăng** |

Đã đo cả ba nhánh trên máy thật: lưu y hệt → vẫn `1`; đổi tỷ lệ model → `2`;
hoàn nguyên → `3` nhưng **hash quay về đúng giá trị ban đầu**. Bộ đếm đếm số lần
sửa, hash định danh nội dung — cố ý không thay thế nhau.

`version` nằm NGOÀI phép tính hash (đưa vào là tự tham chiếu), và
`sanitizeProfile` không tự quyết nó: chỉ `upsertProfile` mới biết bản trước đó
là gì để so. Hồ sơ **mới** luôn bắt đầu từ 1 kể cả khi chép từ một bản đang ở
v7 — thừa kế số của nguồn làm lần sửa đầu tiên thành v8, một lịch sử không có
thật.

### Fixed — lượt quét tự phá kết quả: sửa đúng chỗ, sau ba lần sai chỗ

Bản vá hôm qua (miễn `FILEDIA`/`CMDDIA`) có tác dụng nhưng chưa đủ: vẫn +8 mỗi
lượt quét. Khoanh vùng bằng cách thử từng lời gọi — `drawing-info` → 0, job LISP
tối thiểu → 0, lượt quét tiêu chuẩn → **+8**. Công cụ chẩn đoán chỉ đích danh:
**`modified:AcDbViewport`**. AutoCAD tự dựng lại viewport khi chương trình
`ssget "_X"` quét toàn bộ bản vẽ. Không một `setvar`/`entmod`/`command` nào
trong đường quét.

**Tôi đã sửa sai chỗ ba lần trước khi sửa đúng.** Cả ba đều chặn nhầm thứ — chặn
**bộ đếm revision** thay vì chặn cờ bẩn:

1. Canh tệp `job.lsp` biến mất. Sai: chương trình xoá **bản sao snapshot**, còn
   `job.lsp` là đường truyền dùng chung nên luôn còn. Cờ **không bao giờ hạ**,
   và mọi chốt độ tươi của app đóng băng trong im lặng.
2. Cờ toàn tiến trình. Sai: nó nuốt luôn những sửa thật ở **bản vẽ khác** đang
   mở.
3. Gắn cờ với đúng database. Đúng hơn, nhưng vẫn chặn nhầm đối tượng: bộ đếm
   revision phục vụ nhiều chốt khác, không nên bị can thiệp vì một endpoint.

Cơ chế đúng có hai nửa. Nửa ở plugin: chặn **cờ bẩn** (và qua đó là sự kiện
`drawingModified`) trong lúc job chỉ đọc chạy — an toàn vì job giữ main thread
nên người dùng không sửa được gì trong quãng đó. Nửa ở daemon: Bộ đếm revision và thao tác của người dùng là
hai chuyện khác nhau, và plugin đã có sẵn tín hiệu phân biệt: **`drawingModified`
chỉ bắn khi một LỆNH kết thúc và bản vẽ bẩn**. Đọc bản vẽ không kết thúc lệnh
nào. Nên `/standards/scan` nay ghi một mốc trong nhật ký sự kiện trước khi chạy,
và sau đó hỏi "có `drawingModified` nào mới không" thay vì so bộ đếm. Cơ chế
chặn ở plugin đã **gỡ bỏ hoàn toàn**.

Mốc `drawingRevision` mà phiên quét lưu lại cũng đổi sang giá trị **sau** lượt
quét: chính lượt quét làm bộ đếm nhảy, nên lưu giá trị trước là bảo đảm
`/apply` luôn 409.

Đã kiểm đủ ba vế trên máy thật, với plugin cuối cùng đã nạp:

- Lượt quét sạch → **thành công, 15 phát hiện**.
- Bơm một `drawingModified` vào giữa lượt quét → **`drawing_stale`, từ chối
  đúng**.
- Bộ đếm revision **vẫn nhảy 0 → 8** trong lượt quét sạch — đúng như thiết kế:
  8 tín hiệu nhiễu bị chặn khỏi *cờ bẩn*, còn bộ đếm thì không bị can thiệp, vì
  nó phục vụ những chốt khác.

Nhân đó biết thêm một con số hữu ích: lượt quét chỉ mất **1 giây**.

Bản vá của chốt mới lại đẻ ra bốn lỗi nữa, và ba trong số đó là P1:

- **Cắt nhật ký theo KÝ TỰ thay vì BYTE.** `statSync().size` đếm byte,
  `String.slice` đếm ký tự — nhật ký có tên bản vẽ tiếng Việt nên hai thang lệch
  nhau, và phần cắt ra bắt đầu giữa một dòng JSON. Dòng hỏng = không nhận ra
  `drawingModified` = nhận một lượt quét đã cũ.
- **Mốc đặt sau lượt đọc ảnh chụp đầu tiên.** Sửa đổi xảy ra giữa hai mốc đó
  nằm TRƯỚC mốc và bị bỏ qua, nên `auditStandards()` chấm điểm ảnh chụp trước
  khi sửa còn phiên quét lưu revision sau khi sửa.
- **Chính lượt quét sinh ra `drawingModified`.** Sau khi gỡ cờ chặn, nhiễu
  `AcDbViewport` lại đặt `gDirty` — chốt mới sẽ từ chối một lượt quét sạch.

  Tôi thử "chỉ đặt `gDirty` khi đang trong một LỆNH". Sai: lệnh ghi LISP và
  native (`entmake`/`entmod` của đường sửa tiêu chuẩn, `execNativeJob`) chạy
  NGOÀI lệnh nào cả — chúng sẽ không còn phát `drawingModified`, và cả app mất
  tín hiệu bản vẽ đã đổi.

  Cách đúng, và lập luận kiểm chứng được: **job chỉ đọc giữ main thread của
  AutoCAD**, nên trong quãng đó người dùng không tương tác được — không có "sửa
  thật" nào để bỏ sót. Chặn `gDirty` trong quãng đó là an toàn theo nghĩa chặt.
  Và **chỉ chặn `gDirty`**, không chặn bộ đếm revision: bộ đếm còn phục vụ những
  chốt khác, để nó nhảy theo nhiễu thì không ai chết.
- **Đọc nhật ký hỏng trả "sạch".** Không có bằng chứng không phải là bằng chứng
  không có. Nay fail-closed — và chốt revision đã gỡ nên không còn ai đỡ phía
  sau.

Test của daemon cũng phải đổi theo: nó đang khoá đúng đoạn mã vừa gỡ. Nay khoá
**cả hai chiều** — bơm `drawingModified` giữa lượt quét thì phải 409, và một
lượt quét sạch có revision nhảy 11 → 19 thì phải đi qua. Không có vế thứ hai thì
một chốt "luôn từ chối" cũng làm test xanh, đúng lỗi vừa sửa. `test:standards`
nay nằm trong `pnpm verify`.

- **Đóng rồi mở lại cùng đường dẫn trong lúc quét** không sinh
  `drawingModified` nào — chỉ `docClosed`/`docOpened` — nên chốt sự kiện cho
  qua. Nhưng với AutoCAD đó là một database khác: handle trong ảnh chụp cũ trỏ
  sang đối tượng khác. Nay so `instance` giữa hai lượt chụp, cùng cách phía web
  đang làm.

### Fixed — bịt khe hẹp của cờ chặn cờ bẩn

Cờ từng được hạ khi **watcher** thấy bản sao snapshot biến mất. Giữa lúc job
xong và lúc watcher chạy có một khe, và sửa đúng trong khe đó thì mất
`drawingModified`. Còn nếu job không bao giờ được xếp hàng thì cờ treo tới hết
hạn 180 giây.

Cả hai đều là triệu chứng của cùng một sai lầm: **suy ra vòng đời từ một tệp**.
ObjectARX có sẵn vòng đời thật — `AcEditorReactor::lispWillStart` /
`lispEnded` / `lispCancelled`. Nay cờ bật/hạ theo đúng ba callback đó. Không còn
khe, không còn hạn thời gian đoán mò, không còn canh tệp.

Ba chi tiết đáng ghi:

- **Chương trình TỰ KHAI BÁO** bằng marker `(progn (setq acad:ro-job T) …)`,
  thay vì plugin đoán xem biểu thức LISP nào là của mình. Người dùng có thể gõ
  một biểu thức xen vào giữa lúc xếp hàng và lúc job chạy — chặn nhầm nó là nuốt
  một thay đổi thật. Khớp bằng **tiền tố chính xác**, không phải "có chứa": một
  biểu thức của người dùng tình cờ chứa chuỗi đó, trong comment hay trong string,
  cũng sẽ bật chế độ chặn.
- **Marker phải nằm trong CÙNG MỘT biểu thức với thân job.** AutoCAD đánh giá
  mỗi biểu thức cấp cao thành **một lượt LISP riêng**: bản đầu đặt marker thành
  một `(setq …)` đứng trước, và nó chạy xong rồi kết thúc trong lượt của chính
  nó — job bắt đầu ở lượt sau với `firstLine` không còn marker, nên cờ không bao
  giờ bật. Đo thấy qua log: `lispEnded` rồi mới tới `lispWillStart` của thân job.
  Nay gói cả hai trong một `(progn …)`.
- **Database lấy tại `lispWillStart`**, không phải lúc xếp hàng: tại thời điểm
  đó AutoCAD đã vào đúng document context của job.

Đây là lần thứ năm tôi động vào cơ chế này trong một lượt, và là lần đầu tiên
không phải đoán: bốn lần trước đều suy vòng đời từ tệp, từ thời gian, hoặc từ
"đang trong lệnh hay không". Kiểm chứng cuối trên máy thật, plugin đã nạp: quét
sạch → **thành công, 15 phát hiện, 8 nhiễu bị chặn khỏi cờ bẩn**; bơm một
`drawingModified` vào giữa lượt quét → **`drawing_stale`, từ chối đúng**; bộ đếm
revision vẫn nhảy 0 → 8, đúng thiết kế.

### Added — công cụ chẩn đoán bộ đếm revision

Hai lần liên tiếp bộ đếm nhảy vì lý do không ai đoán được, và đoán mò tốn nhiều
thời gian hơn cả việc sửa. Nay `MepDbReactor` ghi lại **callback nào bắn và cho
lớp đối tượng gì**, kèm cả những lần bị bỏ qua vì job chỉ đọc.

Tắt mặc định, bật bằng `touch ~/Acad-Bridge/debug_revision`. Cờ được đọc lại mỗi
giây và **không nhớ kết quả phủ định** — bật nó sau khi plugin đã chạy là cách
dùng duy nhất của một công cụ chẩn đoán; bắt bật trước thì phải đoán trước lúc
nào sẽ cần nó.

## 2026-08-12 — Giai đoạn 6: tách `/review` và `/standards`

### Added — hai màn hình thay cho một hộp thoại 2.411 dòng

`DrawingStandardsPanel` gộp hai việc khác hẳn nhau: **soạn hồ sơ quy tắc** và
**quét bản vẽ rồi sửa theo phát hiện**. Chúng khác nhau ở chỗ quan trọng nhất —
cái đầu không chạm vào bản vẽ, cái sau ghi thẳng và không hoàn tác được.

- **`/standards`** — danh sách hồ sơ, sửa đơn vị / khổ khung / kích thước, lưu
  có kiểm tranh chấp (`If-Match`). Layer và ánh xạ mới **đọc** được; phần soạn
  chúng còn ở màn hình cũ và được ghi rõ bằng nhãn "chưa có ở màn này".
- **`/review`** — chọn bản vẽ + hồ sơ, quét, lọc theo mức độ, tìm theo từ khoá,
  xem chi tiết, và sửa các phát hiện đã chọn.

### Ba sự thật việc tách làm lộ ra

**1. Lượt quét gắn với PHIÊN BẢN hồ sơ.** `/standards/apply` trả 409 khi
`profile.revision` đã đổi. Panel cũ không bao giờ gặp vì nó khoá nút quét khi hồ
sơ còn thay đổi chưa lưu — hai việc ở chung một hộp thoại nên không thể lệch.
Tách ra thì người dùng quét ở `/review`, sang `/standards` sửa một dòng, quay
lại bấm sửa, và ăn lỗi từ máy chủ. `profileDriftNote()` bắt trước ở giao diện.

**2. `revision` là HASH NỘI DUNG, không phải bộ đếm.** Tôi đã giả định là số,
viết `Number(...)` và gửi `If-Match: "0"` — máy chủ từ chối, và may là nó từ
chối (xem mục 3). Hệ quả tốt của hash: lưu mà nội dung không đổi thì lượt quét
đang mở **vẫn dùng được**; chỉ thay đổi thật mới giết nó.

**3. Gửi bản nháp đi là XOÁ những gì form chưa mô hình hoá.** Bản nháp trong
giao diện là hình dạng **phẳng** do màn hình tự đặt cho dễ dựng form; máy chủ
lưu dạng **lồng**, với `dimension` **23 trường** mà form chỉ đụng 3. Gửi thẳng
là ghi đè 20 trường còn lại bằng mặc định — không lỗi nào báo, không test nào
đỏ, và lượt quét sau đó bắt lỗi hàng loạt theo một quy tắc người dùng chưa từng
đặt. Nay `applyProfileEdits()` **vá lên bản ghi gốc**; đã đo vòng tròn thật:
sửa "Cao chữ" 2.5 → 3 rồi trả về 2.5 cho ra **đúng hash ban đầu**
(`f304e8e7873e`), tức không mất một trường nào.

### Fixed — bốn lỗi của lượt này (Codex review)

- **Ghi nhầm bản vẽ (P1).** Lượt sửa gửi đi **chỉ có `scanId`**, nên máy chủ
  dùng đích đã lưu trong phiên quét — không phải đích đang hiện trên màn hình.
  Quét bản vẽ A, đổi ô chọn sang B, bấm sửa: AutoCAD sửa **A** trong khi màn
  hình nói B. Nay đổi bản vẽ hoặc đổi hồ sơ là **vứt lượt quét**, và còn một
  chốt nữa ở `applyBlockedReason` phòng khi lọt.
- **Quét bản vẽ không hoạt động thì daemon tự kích hoạt nó** — đổi tab AutoCAD
  sau lưng người dùng, và họ chỉ biết khi ngẩng lên thấy bản vẽ khác. Đổi tab là
  việc của họ, không phải của một nút "Quét". Nay chặn kèm hướng dẫn.
- **Không gõ được số thập phân.** Ô số đọc lại từ giá trị đã phân tích mỗi lần
  render, nên `2.` bị chuẩn hoá về `2` ngay khi vừa gõ dấu chấm — không cách nào
  gõ `2.5`. Lỗi chỉ lộ ra khi gõ thật, không lộ ra khi đọc mã.
- **Mục căn hàng dimension luôn trả 400.** `dimspace` đòi `dimBaseHandle` (một
  DIM làm chuẩn) mà màn hình chưa hỏi được. Nay ô tích của những mục đó bị khoá
  kèm lý do, thay vì để người dùng tích rồi ăn lỗi.

### Fixed — ba lỗi nữa, và một câu tôi viết trên giao diện là SAI

- **"Ô trống = không ràng buộc" là bịa.** Tôi viết câu đó ngay dưới ô "Số lẻ".
  Thật ra `sanitizeDrawing`/`sanitizeDimension` gọi `numberValue()`, và hàm đó
  trả 400 cho bất cứ thứ gì không phải số hữu hạn — nên xoá trắng một ô là bảo
  đảm lưu hỏng, sau khi người dùng đã gõ xong cả form. Nay bảy ô số được kiểm
  trước khi cho bấm Lưu, và lý do **gọi tên từng ô thiếu**.
- **Danh sách CẤM đổi thành danh sách CHO PHÉP.** Tôi chỉ chặn `dimspace`. Máy
  chủ thật ra chỉ chạy đúng **năm** hành động; mọi thứ khác nó **im lặng bỏ
  qua** và trả `skippedIssueIds` — trộn một mục như vậy vào lô sửa được là để
  người dùng tưởng đã sửa xong. Nay ngoài danh sách là không tích được, và số
  mục bị bỏ qua (nếu có) được nói ra sau khi ghi.
- **Thiếu `readOnly: true` khi quét.** Chốt phía giao diện là chưa đủ: người
  dùng đổi tab trong AutoCAD giữa lúc bấm và lúc yêu cầu tới nơi thì daemon tự
  kích hoạt bản vẽ cũ sau lưng họ. Cờ này bắt máy chủ kiểm lại và dispatch job
  không kích hoạt tab.

### Fixed — bốn lỗi vòng sau

- **Thẻ xác nhận không nhận lý do chặn.** Trạng thái đổi trong lúc thẻ đang mở
  (bản vẽ vừa bị sửa chẳng hạn) thì nút vẫn sáng, bấm thì hàm lặng lẽ thoát ra
  và thẻ đứng im — một ngõ cụt không nói lý do.
- **Câu tóm tắt nói ít hơn sự thật.** `apply-dimstyle` chạy
  `configureDimensionExpression` trên **toàn bộ** dimstyle chứ không chỉ mấy DIM
  được liệt kê; `apply-units` đổi đơn vị cả bản vẽ; `sync-layers` sửa bảng
  layer. Đếm riêng số đối tượng là nói ít hơn sự thật ở đúng chỗ người dùng đọc
  để quyết định bấm một lệnh không hoàn tác được.
- **Kiểm hồ sơ mới bắt bảy ô số.** Xoá trắng `Đơn vị`, `Tên khổ` hay
  `Tên dimstyle`, hoặc nhập số ngoài khoảng / không nguyên, vẫn lọt xuống máy
  chủ rồi ăn 400. Nay khoảng giá trị lấy **đúng từ daemon**.
- **`ATTREQ`/`ATTDIA`/`EXPERT` bị gỡ khỏi danh sách miễn trừ revision.** Tôi
  thêm chúng theo thói quen "biến hộp thoại". Nhưng chúng chỉ được đặt trong
  đường **chèn block** — mà đường đó ghi thật vào bản vẽ, nên bộ đếm tăng là
  ĐÚNG. Và nếu một trong số đó hoá ra có lưu trong DWG thì miễn nó là để một
  thay đổi thật đi qua mà không ai biết. Danh sách nay chỉ còn `TRUSTEDPATHS`,
  `FILEDIA`, `CMDDIA`, `CMDECHO` — vừa đủ cho đúng vấn đề `loadLib()`.

### Fixed — bốn lỗi vòng cuối

- **Khoảng giá trị tôi tự đoán, không đọc từ daemon.** `sanitizePaper` đòi khổ
  giấy >= **0.001** (không phải 0.000001 như các trường khác), còn `textHeight`
  cho phép **0** (dimstyle annotative lấy chiều cao từ style). Đoán sai sinh ra
  hai loại lỗi cùng lúc: chặn hồ sơ máy chủ chấp nhận, và cho qua hồ sơ máy chủ
  từ chối.
- **Báo "đã lưu" trước khi trạng thái được làm mới.** PUT xong mà lượt GET sau
  đó hỏng thì `loadProfiles` nuốt lỗi, bản nháp giữ `revision` cũ, và lần lưu
  sau gửi `If-Match` đã chết — người dùng thấy "đã lưu" rồi ăn xung đột không
  hiểu từ đâu. Nay cập nhật bản nháp từ chính phản hồi PUT trước, và lỗi nạp lại
  được ném ra.
- **Lượt quét về xoá mất cảnh báo "bản vẽ đã đổi".** Một thay đổi xảy ra SAU khi
  máy chủ kiểm lần cuối nhưng TRƯỚC khi phản hồi về tới giao diện là thay đổi
  thật — xoá trắng cờ là mở lại nút sửa cho một lượt quét đã cũ.
- **Phản hồi của lượt quét cũ ghi đè bối cảnh mới.** Ô chọn bản vẽ/hồ sơ vẫn bấm
  được trong lúc quét và chúng vứt lượt quét cũ, nhưng phản hồi cũ vẫn về và bày
  một danh sách phát hiện của bản vẽ khác. Nay có vé như `loadDocs`.

### Fixed — bốn lỗi trong máy trạng thái quét

Cả bốn nằm trong phần tôi vừa dựng ở vòng trước, và một trong số đó là ngõ cụt
thật sự:

- **Kẹt vĩnh viễn ở "Đang quét…".** Đổi ô chọn giữa lúc quét làm vé lệch đi, nên
  `finally` của lượt cũ bỏ qua `setScanBusy(false)` — và không lượt mới nào chạy
  để dọn. Nút quét khoá cho tới khi tải lại trang. Nay bốn việc của "bỏ lượt
  quét" gom vào một hàm: tăng vé, xoá kết quả, **xoá cờ bận**, xoá cờ bẩn.
- **Sửa bản vẽ KHÁC cũng giết lượt quét.** Sự kiện mang `activeDoc` là **tiêu
  đề**, còn `scan.target` là **đường dẫn tệp** — so thẳng hai thứ đó không bao
  giờ khớp, nên mọi thay đổi ở mọi bản vẽ đang mở đều chặn nút sửa.
- **Cờ bẩn sót lại từ một lượt quét hỏng** chặn nút sửa của lượt sạch tiếp theo.
  Cờ đó thuộc về từng lượt, nên nay đặt lại theo vé.
- **`profile_stale` chỉ in lỗi rồi thôi.** Tab khác sửa hồ sơ thì bản sao trên
  màn hình giữ revision cũ mãi, và cảnh báo lệch hồ sơ chặn nút sửa ở MỌI lượt
  quét sau đó — không có đường nào ngoài tải lại trang. Nay nạp lại hồ sơ.

### Fixed — năm lỗi nữa, một P1 lại là ghi nhầm bản vẽ

- **Ghi nhầm bản vẽ sau khi đổi tab AutoCAD (P1).** Quét bản vẽ A, người dùng
  chuyển AutoCAD sang B, rồi bấm sửa: lượt sửa chỉ mang `scanId`, và
  `/standards/apply` dispatch một job **không** read-only — nó tự kích hoạt A
  rồi ghi vào A trong khi người dùng đang nhìn B. Nay chặn khi bản vẽ đã quét
  không còn là bản vẽ đang hoạt động.
- **Regex bắt lỗi theo CHỮ, trượt hoàn toàn.** Tôi viết `/profile_stale|hồ sơ/i`
  nhưng câu máy chủ trả là "Mẫu quy chuẩn đã đổi; hãy quét lại" — không khớp từ
  nào. `DaemonError` mang sẵn `code`; nay soi mã.
- **Quét bị từ chối `drawing_stale` mà kết quả cũ vẫn bấm sửa được.** Nó mô tả
  một trạng thái đã qua hai lần.
- **Nút "Quét lại" ở dải lệch hồ sơ không nạp lại hồ sơ**, nên cảnh báo quay lại
  y nguyên sau mỗi lần quét — mãi mãi, cho tới khi tải lại trang.
- **"Nhân bản" khi còn thay đổi chưa lưu** chép bản ĐÃ LƯU rồi nhảy sang bản
  sao: thay đổi đang gõ dở biến mất trong im lặng.

### Fixed — chốt "đúng bản vẽ" chuyển xuống DAEMON

Hai vòng review liền chỉ ra cùng một chuyện theo hai đường khác nhau, và kết
luận thì giống hệt bài học của chốt không gian hôm qua: **chốt phía giao diện
vốn dĩ có khe đua.** Nó đọc `/docs` ở một thời điểm trước đó, còn người dùng đổi
tab bất cứ lúc nào.

- **(P1) `/standards/apply` nay tự kiểm bản vẽ đích có đang hoạt động không**,
  ngay sát lúc dispatch. Trước đó nó chỉ kiểm đích còn khớp phiên quét — mà job
  nó chạy KHÔNG read-only, nên AutoCAD sẽ tự kích hoạt bản vẽ đó rồi ghi vào,
  trong khi người dùng đang nhìn bản vẽ khác.
- **(P1) Không biết bản vẽ nào đang hoạt động = CHẶN.** Danh sách rỗng làm
  `activeTarget` rỗng, và phép so bằng chuỗi rỗng thì luôn cho qua — đúng cái
  cửa chốt này sinh ra để đóng.
- Bấm "Quét lại" không xoá lô đã tích, nên thẻ xác nhận vẫn gửi được lô **cũ**
  trong lúc lượt quét mới đang chạy.
- Lời báo "đã lưu" bị chính effect dựng lại bản nháp xoá mất — lưu thành công
  làm revision đổi, mà effect đó phụ thuộc revision. Mọi lần lưu thật đều im
  lặng.
- Nút "Thử lại" sau xung đột nạp lại thẳng, vứt luôn thứ người dùng đang gõ dở.

### Fixed — chốt "đúng bản vẽ" đi nốt vào chương trình LISP

- **(P1) Chốt cuối cùng nằm trong chính chương trình.** Mọi chốt phía trên —
  giao diện, rồi daemon lúc nhận yêu cầu — đều đọc trạng thái ở một thời điểm
  TRƯỚC khi AutoCAD thật sự chạy lệnh; giữa hai mốc đó người dùng đổi tab được,
  và `dispatchLiveJob` với job ghi sẽ **kích hoạt lại** bản vẽ đích rồi ghi vào
  đó. Nay chương trình tự so `DWGPREFIX+DWGNAME` với đích đã chuẩn bị và thoát
  ra nếu lệch.

  **Chốt này KHÔNG bịt hết khe, và nói rõ ở đây để không ai tưởng nó bịt.**
  `runJob()` **kích hoạt** bản vẽ đích trước khi chạy chương trình, nên tới lúc
  guard chạy thì AutoCAD đã ở đúng bản vẽ đó — guard luôn đúng. Nó chỉ bắt được
  trường hợp kích hoạt THẤT BẠI (bản vẽ vừa bị đóng). Khe còn lại: người dùng
  đổi tab trong quãng giữa lúc daemon kiểm và lúc job chạy thì AutoCAD sẽ nhảy
  về bản vẽ đã quét rồi sửa nó.

  Bịt hẳn phải sửa bộ chạy job **dùng chung** cho mọi lệnh ghi (chặn kích hoạt
  khi đích chưa active), và việc đó chạm tới cả chèn block lẫn ghi LISP — không
  làm ở cuối một lượt sửa dài. Đã ghi vào `ROADMAP.md`.
- **(P1) "Chưa hoàn tất" bị coi là hỏng.** Daemon hết hạn CHỜ sau 30 giây nhưng
  job vẫn chạy tiếp trong AutoCAD. Để người dùng bấm lại là xếp thêm một lượt
  ghi nữa lên cùng tập đối tượng — mà không lượt nào hoàn tác được từ app.
- **Hai bản vẽ trùng tên.** Sự kiện chỉ mang TIÊU ĐỀ, nên `/a/plan.dwg` và
  `/b/plan.dwg` không phân biệt được. Nay trùng tên thì coi như có liên quan —
  chặn thừa thì quét lại, bỏ sót thì sửa lên một bản vẽ đã đổi.

### Fixed — lượt quét tự phá kết quả của chính nó (lỗi backend)

`/standards/scan` đọc revision bản vẽ trước và sau lượt quét rồi so; lệch thì
loại bỏ kết quả. Nhưng chính lượt quét làm nó lệch: **đo thật 16 → 24**, và
endpoint hỏng **lần nào cũng vậy** — `/review` không dùng được.

Nguyên nhân: `headerSysVarChanged` của plugin đếm **mọi** `setvar` vào bộ đếm
revision, kể cả biến lưu trong registry chứ không lưu trong DWG. `loadLib()` —
đoạn bọc **mọi** job của daemon — chạy `(setvar "FILEDIA" 0)(setvar "CMDDIA" 0)`
trước khi làm gì.

Đã có sẵn một ngoại lệ cho `TRUSTEDPATHS` với đúng lý do này ("must not make a
read-only drawing review look stale"), nhưng nó là một trường hợp lẻ. Nay thành
danh sách biến **phiên/ứng dụng**: `TRUSTEDPATHS`, `FILEDIA`, `CMDDIA`,
`ATTDIA`, `CMDECHO`, `ATTREQ`, `EXPERT`. Biến thuộc **nội dung bản vẽ** —
`CLAYER`, `INSUNITS`, `LUPREC`, `CTAB` — cố ý KHÔNG có mặt: bỏ qua chúng là để
một thay đổi thật đi qua mà không ai biết.

**Chưa xác minh:** cần khởi động lại AutoCAD để nạp plugin mới rồi đo lại. Sau
khi trừ `FILEDIA`+`CMDDIA` vẫn còn nguồn khác chưa truy ra (+8 mỗi lượt quét).

## 2026-08-11 — Bắt được việc đổi tab Model/Layout

### Added — plugin phát không gian hiện hành và sự kiện `layoutSwitched`

Gỡ khoảng trống đã ghi trong `ROADMAP.md` sáng nay. Danh mục đối tượng chỉ quét
**một** không gian, nên đổi tab trong AutoCAD làm nó mô tả một không gian không
còn hiện hành — và lệnh chọn theo handle sẽ hỏng với "not a top-level entity in
current space". Trước đây màn hình không cách nào biết.

Cần **hai** thứ, thiếu một cái là vô dụng:

- **`space` trong `/docs`** (`writeDocs`, dùng lại `currentSpaceName` đã có).
- **Sự kiện `layoutSwitched`** (`AcEditorReactor::layoutSwitched`). Gửi trường
  `space` thôi vẫn chưa đủ: app chỉ HỎI `/docs` khi có sự kiện, mà bấm chuột vào
  tab thì không qua lệnh nào. Không có sự kiện thì tín hiệu có mà không ai đánh
  thức để đọc.

**Một giả định của tôi đã bị phép đo bác bỏ.** Tôi viết trong `ROADMAP.md` sáng
nay rằng "bộ đếm revision không tăng vì đổi tab không sửa đối tượng nào". Đo
thật: đổi sang layout `02` rồi `03` làm revision nhảy **0 → 121**, vì AutoCAD
phải dựng lại viewport. Nghĩa là `revision` cũng bắt được việc đổi tab — nhưng
nó bắt **nhầm lý do**: người dùng sẽ đọc "bản vẽ đã thay đổi" trong khi họ không
sửa gì, rồi đi tìm thay đổi không có thật. Nên `space-changed` được xét TRƯỚC
`changed`, và trường `space` vẫn cần thiết vì nó nói đúng chuyện gì đã xảy ra.

Giao diện: `profileStaleReason` thêm loại `space-changed` với lời riêng, so
không gian mà **danh mục đã quét** (`selectionCatalog.space`) với không gian
hiện tại trong `/docs`. Thiếu một trong hai vế thì im — plugin bản cũ không phát
`space`.

### Fixed — thẻ xác nhận sống sót qua một lần hồ sơ hoá cũ (Codex review)

Thao tác đã chuẩn bị mang theo mô tả của **lúc chuẩn bị** ("chọn 40 đối tượng ở
không gian 03"). Người dùng đổi tab rồi bấm Xác nhận là chạy nó trên một không
gian khác. Guard máy chủ không cứu được: nó soi `instance` + `revision`, không
soi không gian. Nay hồ sơ hoá cũ thì thao tác đang chờ bị **huỷ ở máy chủ** kèm
câu giải thích, chứ không chỉ đóng thẻ (bỏ lại thì operation nằm trong hàng chờ
tới hết phiên).

Bản vá đầu của chính mục này lại sinh ra ba lỗi, hai P1 — Codex bắt được cả ba:

- **P1 — chặn quá muộn.** Bản đầu chỉ dựa vào `stale`, mà `stale` chỉ đổi SAU
  khi lượt đọc `/docs` về. Trong quãng đó thẻ xác nhận vẫn bấm được và máy chủ
  vẫn nhận. Nay chặn **đồng bộ ngay tại sự kiện** `layoutSwitched`; đây là cửa
  sổ duy nhất trong màn hình này mà một thao tác sai có thể đi lọt tới AutoCAD.
- **P1 — chặn luôn đường phục hồi.** Đổi sang bản vẽ B làm hồ sơ hoá cũ; cách gỡ
  đúng là chọn lại bản vẽ A trong ô chọn — nhưng việc đó tạo một thao tác
  `activate-document`, và bản vá đầu huỷ nó ngay khi vừa tạo. Ô chọn bản vẽ trở
  thành vô dụng, và lối thoát duy nhất bị bịt. Nay miễn trừ loại `activate`.
- **P2 — huỷ nhầm thao tác ĐANG chạy.** `pending` vẫn còn trong lúc
  `applyStagedOp` chờ; một `move-to-layer` thành công phát `drawingModified` →
  hồ sơ hoá cũ → huỷ nhầm cái vừa chạy xong, và người dùng đọc "đã huỷ" cho một
  thao tác máy chủ đã thực hiện. Nay có một pha "đang áp dụng" (ref, không phải
  state — một lần re-render thêm ở giữa `applyStagedOp` là đúng thứ mở ra cửa sổ
  mà nó đang bịt).

Và bản vá của bản vá lại tái phạm một lỗi đã sửa sáng nay: câu giải thích đi vào
ô lỗi dùng chung, nên nó hiện dưới nhãn **"Không chuẩn bị được"** ở cột bộ tạo
thao tác — trong khi chẳng có gì chuẩn bị hỏng, thao tác đã chuẩn bị xong rồi
mới bị huỷ, và nó có thể đến từ danh mục chứ không phải bộ tạo. Nay là một dải
cảnh báo **cấp trang** riêng, có nút "Đã hiểu".

Codex tìm thêm một P1 nữa trong bản vá đó: **lượt chuẩn bị ĐANG BAY không ai
gác.** Giữa lúc bấm và lúc `/selection/prepare` trả lời, `pending` vẫn là `null`
nên nhánh chặn bỏ qua nó — rồi thao tác về và mở một thẻ xác nhận mô tả không
gian cũ. Nay có một bộ đếm **thế hệ không gian**: ai chuẩn bị thì chụp số đó
trước khi chờ, và vứt kết quả (huỷ ở máy chủ) nếu nó đã đổi. Áp cho cả hai đường
chuẩn bị — danh mục theo handle và bộ tạo theo phạm vi.

Hai lỗi nhỏ hơn cùng đợt: chỉ so không gian khi bản ghi sống ĐANG hoạt động
(không gian của một tài liệu nền không phải không gian AutoCAD đang mở, và một
cảnh báo sai ở đây thì huỷ luôn thao tác đang chờ); và thêm `space` vào kiểu
`OpenAcadDocument` phía daemon, không chỉ phía web.

### Technical — đã kiểm gì, và CHƯA kiểm được gì

Kiểm thật trên trình duyệt bằng cách bơm sự kiện `layoutSwitched` vào
`events.jsonl` (daemon tail file này và đẩy qua SSE trong 500ms) — không đụng gì
tới bản vẽ:

- Đổi tab khi thẻ xác nhận **đang mở** → thẻ đóng ngay, dải cảnh báo cấp trang
  hiện đúng câu. Đã lặp lại ba lần.
- Đổi tab khi **không có** thao tác nào chờ → dải "AutoCAD đã chuyển sang không
  gian X" hiện, nút ghi khoá, và cột bộ tạo thao tác cũng khoá cùng lý do.
- Không gian thật không đổi → không cảnh báo sai.

Ba lỗi nữa ở vòng sau, hai P1:

- **P1 — daemon không biên dịch được.** `cadSelection.ts` định nghĩa
  `OpenDocument = Required<Omit<OpenAcadDocument, "dbmod">>`, nên thêm một trường
  **tuỳ chọn** vào `OpenAcadDocument` lại biến nó thành **bắt buộc** ở đó. Lỗi
  hiện ra ở `completeDocument()` chứ không ở chỗ vừa sửa. Nguyên nhân gốc: lệnh
  `pnpm verify` mà tôi vẫn chạy nằm ở **gói web** và không hề kiểm daemon. Đã
  thêm `acad-studio/pnpm verify` chạy `typecheck:daemon` trước, và `DEVELOPMENT.md`
  nay chỉ chạy từ `acad-studio/`.
- **P1 — chốt không gian phải ở DAEMON, không chỉ ở giao diện.** Toàn bộ phần
  trên phát hiện đổi tab qua sự kiện SSE — mà luồng đó **đứt được**, và lúc nó
  đứt thì không còn gì chặn. Chốt apply của daemon soi `instance` + `revision`
  nhưng không soi không gian, còn `selection_control.cpp` cũng không kiểm đối
  tượng Pickfirst có thuộc không gian hiện hành hay không. Nay `DocumentGuard`
  mang thêm `space`: daemon tự chụp lúc chuẩn bị và so lại lúc ghi, không phụ
  thuộc vào kênh nào có thể chết. Mã lỗi mới `space_changed` kèm thái độ riêng ở
  UI — `check:guards` bắt ngay khi tôi quên phần đó.

  Bản vá đầu của chốt này là **no-op trong im lặng**, và đó là lỗi đáng nhớ nhất
  đợt này: `completeDocument()` dựng lại object tài liệu mà **bỏ rơi** `space`,
  nên `guard.space` luôn `undefined` và phép so luôn bị bỏ qua. Verify xanh,
  review đọc thấy chốt, nhìn từ ngoài y hệt như đã có bảo vệ — mà nó không bao
  giờ chạy. Cùng lượt còn hai lỗ nữa: ảnh chụp và `/docs` đọc ở hai thời điểm
  nên `subjects` có thể đến từ không gian mới trong khi chốt mang không gian cũ
  (`snapshotGuard` nay so cả hai); và giữa lúc daemon kiểm với lúc AutoCAD thật
  sự chạy lệnh đã xếp hàng còn một quãng nữa — nay `currentSpace` đi cùng lệnh
  và `selection_control.cpp` so lại lần cuối ngay trước khi chạm vào bản vẽ.

  Rồi ba lỗ nữa, cùng một họ — **fail-OPEN khi không biết**:

  · Plugin không mở được BTR của không gian hiện hành thì `currentSpaceName()`
    trả chuỗi rỗng, và chốt native coi rỗng là "daemon bản cũ không gửi" rồi cho
    qua. Nhưng daemon CÓ gửi — rỗng nghĩa là AutoCAD không biết mình đang ở đâu.
  · Cùng lỗi ở tầng daemon: `completeDocument()` quy `""` về `undefined`, tức
    gộp "plugin đọc hỏng" vào "plugin bản cũ". Nay tách hẳn: thiếu trường thì
    cho qua, trường rỗng thì TỪ CHỐI. Một hàm `spaceMismatchReason()` duy nhất
    cho cả ba mốc so, để lần sau không lệch nhau.
  · `snapshotGuard` đọc `document.space` của ảnh chụp — mà `drawing-info` không
    hề phát trường đó (`null` trên phản hồi thật); không gian đã quét nằm ở
    `selectionCatalog`/`selectionScope`. Lại một chốt không bao giờ bắn.

  Và một lỗi về **thứ tự**, không về tính đúng: phép so revision chạy trước phép
  so không gian, nên đổi tab (vốn hay kéo revision nhảy theo) báo ra
  `drawing_stale`. Người dùng đọc "nội dung bản vẽ đã thay đổi" rồi đi tìm một
  thay đổi không có thật, trong khi việc họ vừa làm là bấm sang tab khác. Đã đo
  đúng hiện tượng này khi thử bằng API: nhận `drawing_stale` cho một cú đổi tab.
  Đã sửa ở CẢ HAI tầng — daemon và plugin.

  Hai điều còn lại, đều là "rỗng không bằng thiếu":

  · Giao diện cũng gộp `space: ""` vào "plugin bản cũ" như daemon từng gộp. Nay
    cả hai tầng dùng chung một quy tắc, và có test khoá nó lại
    (`spaceMismatchReason` ở daemon, `profileStaleReason` ở web).
  · Khoá khử trùng lặp sự kiện là `(giây, tên layout)`, nên ba cú đổi trong cùng
    một giây có thể va khoá và một cú bị bỏ. Nay plugin phát thêm **số thứ tự**
    `n` cho mỗi lần phát thật — duy nhất theo đúng nghĩa, không phải suy đoán từ
    dấu thời gian. Plugin bản cũ (`seq = 0`) lùi về khoá cũ.

  Và một lỗi ObjectARX thuần: `writeDocs()` đọc database của **mọi** tài liệu
  đang mở, kể cả tài liệu nền — mà đọc database không-current thì phải lấy lock
  trước (`writeDrawingInfo`/`writeGeometry` đều làm). `writeDocs()` lại chạy từ
  trong reactor, nơi lấy lock là chuyện không nên làm. Đọc mà không lock thì
  ObjectARX có thể trả về rỗng — và theo quy tắc vừa dựng ở trên, rỗng nghĩa là
  "không đọc được", nên daemon sẽ **từ chối mọi thao tác** trên tài liệu đó, kể
  cả lệnh `activate-document` vốn là đường phục hồi. Nay chỉ phát `space` cho
  tài liệu vừa active vừa current, và **bỏ hẳn trường** với tài liệu nền —
  "không biết, và không cần biết": chốt không gian chỉ có nghĩa cho tài liệu
  đang được thao tác, mà daemon bắt buộc đó phải là tài liệu active.

  Cuối cùng, ba chỗ nữa cùng một họ với những cái trên:

  · **Thiếu trường không phải lúc nào cũng là "plugin cũ".** Từ khi plugin cố ý
    bỏ `space` với tài liệu nền, một lần `/docs` trả về thiếu trường cho tài
    liệu ĐÍCH là dấu hiệu đọc hỏng — mà cả daemon lẫn plugin đều cho qua. Nay
    `resolveDocument` trả thêm `spaceSupported` (có tài liệu nào phát `space`
    không); plugin mới mà tài liệu đích thiếu trường thì TỪ CHỐI.
  · **Thứ tự chốt ở nhánh chuẩn bị** vẫn để revision chạy trước — hai nhánh nói
    hai câu khác nhau cho cùng một việc. Đã đồng bộ.
  · **Khoá khử trùng lặp va nhau sau khi plugin nạp lại**, vì bộ đếm về 0. Nay
    xoá sạch khoá khi thấy `pluginLoaded`.

  Và vòng cuối, ba biến thể cuối cùng của cùng một luật:

  · **Giao thức raw không phân biệt được "không gửi" với "gửi chuỗi rỗng"** —
    `param()` bên plugin trả `""` cho cả hai. Nay có cờ hiện diện riêng
    `spaceKnown`: có cờ nghĩa là daemon ĐÒI kiểm, và chuỗi rỗng lúc đó là "không
    đọc được" nên plugin từ chối.
  · **`selectionCatalog.space` rỗng** — chính lượt quét không biết nó quét không
    gian nào — vẫn lọt qua giao diện.
  · **Sự kiện phát lại rơi đúng giây người dùng bấm** thì `>=` không phân biệt
    được, và một thao tác hợp lệ bị huỷ oan. Nay **daemon** gắn cờ `replay` cho
    15 dòng nó đẩy lúc mở kết nối — chỉ máy chủ biết khung nào là lịch sử; phía
    web không có cách nào suy ra. Có test cho cả `seq` lẫn `replay`.

  Và vòng cuối cùng bắt được **hai hồi quy do chính vòng trước tôi gây ra** —
  cả hai đều P1, và cái đầu lại đúng vào đường phục hồi:

  · **Đổi bản vẽ bị chặn.** `activate-document` cố ý nhắm vào một tài liệu NỀN,
    mà plugin cố ý không phát `space` cho tài liệu nền. Luật "một vế thiếu thì
    từ chối" vừa dựng ở trên liền từ chối đúng cái lệnh dùng để đổi sang bản vẽ
    đang cần. Nay chốt không gian chỉ xét khi đích là tài liệu đang hoạt động —
    đó cũng là nơi duy nhất nó có nghĩa.
  · **Hạ cấp plugin giữa chừng thì chốt tự tắt.** Cờ `spaceSupported` tôi thêm ở
    vòng trước đọc trạng thái HIỆN TẠI, nên nạp lại một plugin bản cũ sau khi đã
    chuẩn bị xong sẽ làm phép so bị bỏ qua — đúng lúc plugin cũ cũng không kiểm
    gì. Nay bỏ hẳn cờ đó: chỉ cần một vế biết là phải so.
  · Và khung `replay` KHÔNG hẳn là chuyện cũ: SSE đứt trong lúc thẻ xác nhận
    đang mở thì cú đổi tab thật nằm đúng trong 15 dòng đẩy lại. Bỏ hết là để một
    thao tác đã hoá cũ vẫn bấm được. Nay chỉ bỏ khung cũ hơn thao tác đang chờ.

  Và một ca tương thích ngược tôi đã bỏ sót suốt: plugin cũ **không** phát
  `space` trong `/docs` nhưng **vẫn** phát `selectionCatalog.space` — nên luật
  "một vế thiếu thì từ chối" làm hỏng mọi `select` theo phạm vi và mọi
  `move-to-layer` với ai chỉ nâng daemon mà chưa nâng plugin. Luật cuối cùng là
  **bất đối xứng**: chưa từng biết thì cho qua, từng biết rồi mất thì từ chối.

  Chốt không gian nay có test riêng trong `test:cad-selection`, và
  `acad-studio/pnpm verify` chạy nó — đó là bộ test daemon DUY NHẤT trong
  `verify`, thêm vào cùng lượt với `typecheck:daemon`.
- **P1 — dữ liệu cá nhân trong repo.** Ba thư mục `cadweb-*-smoke/` chứa
  `HKCU_V1.plist` — bản chụp registry AutoCAD có họ tên thật, danh sách bản vẽ
  vừa mở và `SUBSCRIPTIONMACID`. Chưa từng được commit; đã thêm vào `.gitignore`.
  Không xoá — file của người dùng. Cùng lượt: `React/RCTImageDownloader/Cache.db`
  là cache URL của CoreFoundation do một app React Native đẻ ra ở thư mục làm
  việc, cũng đã ignore.
- **P2 — sự kiện phát lại giết thao tác hợp lệ.** `GET /api/acad/events` đẩy lại
  **15 dòng cuối** mỗi lần mở kết nối, kể cả khi tự nối lại giữa phiên. Một cú
  đổi tab xảy ra lúc đường truyền đứt sẽ quay lại như tin mới và huỷ một thao
  tác vừa chuẩn bị, trong khi AutoCAD chẳng đổi gì.

  Mất **ba** lượt mới đúng, và mỗi lượt hỏng vì tôi chọn MỘT cơ chế thay vì hai:
  tập "đã thấy" chỉ biết những gì trang này nhận được, nên sự kiện xảy ra lúc
  đứt kết nối vẫn lọt; đổi sang mốc thời gian thì lại chỉ tới **giây**, nên một
  bản phát lại rơi đúng giây người dùng bấm vẫn qua được. Nay dùng cả hai — mỗi
  cái bịt một nửa khác nhau của cùng một lỗ.

  Còn lại một trường hợp, cố ý: một lần đổi THẬT trong đúng giây bắt đầu chuẩn
  bị vẫn huỷ. Đó là chiều an toàn — thà huỷ thừa một thao tác chuẩn bị lại được,
  còn hơn để lọt một thao tác chạy nhầm không gian.

Đã kiểm thật cả hai chiều: bơm một sự kiện MỚI và một sự kiện **cũ 10 phút** vào
cùng một lượt — thẻ xác nhận bị huỷ đúng bởi cái mới, cái cũ bị bỏ qua.

**Chưa dựng lại được bằng thao tác thật:** nhánh so mốc sau khi chờ, tức
đúng lúc `/selection/prepare` đang bay. Cửa sổ đó dưới một giây, và thí nghiệm
cho thấy nó còn hẹp hơn nữa vì `blockNote` đã khoá nút sẵn trong suốt lượt đọc
`/docs` — muốn lọt phải có `/docs` vừa xong tại thời điểm bấm, rồi đổi tab trước
khi máy chủ trả lời. Chốt này là lớp phòng thủ thứ hai sau chốt đó; đã đọc kỹ mã
nhưng chưa có ảnh chứng minh.

### Technical

- Đã kiểm trên máy thật: `/docs` trả `space: "Model"` cho bản vẽ trống và
  `space: "01"` cho bản vẽ as-built — trường này thật và đổi theo từng tài liệu.
- Reactor đã được xác nhận bắn trên AutoCAD 2027 Mac: bấm tab layout cho ra
  `layoutSwitched` với `detail` là `02` rồi `03`, và `/docs` đổi theo sang
  `space: "03"`.

## 2026-08-11 — Giai đoạn 6: xoá `DrawingInfoPanel` legacy

### Known — một phát hiện được ghi nhận, không sửa

**Không gộp các lượt đọc `/docs` chồng nhau.** Codex chỉ ra: một lượt đọc do sự
kiện mở có thể về sau lượt của "Đọc lại"; nếu lượt sau timeout thì `docsAlive`
hạ xuống `false` ngay sau một thao tác thành công, và màn hình khoá lại. Không
sửa vì đó là hành vi ĐÚNG theo thiết kế hiện tại: lượt hỏi gần nhất hỏng nghĩa
là ta không biết, và màn hình này cố tình fail-closed khi không biết. Nó tự khỏi
ở sự kiện kế tiếp. Thêm một tầng gom lời gọi để đổi lấy một khoảng khoá vài giây
là không đáng.

### Removed — `DrawingInfoPanel` legacy (1.789 dòng TSX + 184 quy tắc CSS)

Panel đầu tiên bị xoá trong đợt migrate. Trước khi xoá đã port nốt hai chức năng
cuối sang `/drawing-info`:

- **Danh mục đối tượng** — lọc theo handle/kiểu/layer/tên block, phân trang 100
  dòng, tích nhiều rồi chọn cả tập trong AutoCAD. Đây là thứ `/workspace` không
  làm được: ở đó chọn **một** đối tượng bằng cách bấm vào hình nó; ở đây với tới
  được cả những đối tượng không nhìn thấy hoặc nằm chồng lên nhau.
- **JSON thô** — để đối chiếu khi màn hình và AutoCAD nói khác nhau, thay vì
  phải mở terminal gọi `curl`.

Đã chạy thật trọn đường: tích một MLINE trong danh mục → xác nhận → đọc lại
`drawing-info` thấy `selected: 1`, handle `12181`, đúng đối tượng đã tích.

CSS xoá theo ba lượt (rule đơn → selector ghép → đệ quy vào `@media`), chỉ xoá
quy tắc mà **mọi** class `drawing-*` trong đó thuộc riêng panel này.
`.drawing-empty-open` giữ lại vì `page.tsx` còn dùng. `globals.css` 3.511 → 3.130
dòng.

24 assert trong `test-contract.mjs` nói về kiến trúc cache-snapshot của panel đã
chết theo nó. **Năm** bất biến còn giá trị được chuyển sang trỏ vào màn hình mới
— chúng nói về dữ liệu và về an toàn, không về kiến trúc.

### Fixed — hai mươi chín lỗi của lượt này (Codex review, mười hai vòng)

- **Handle giữ qua lượt đọc khác (P1).** Handle của AutoCAD **cục bộ theo bản
  vẽ**. Giữ tập đã tích qua một lượt "Đọc lại" hay một lần đổi bản vẽ là gửi
  handle của bản vẽ CŨ kèm guard của bản vẽ MỚI — guard hợp lệ, và cùng handle
  đó ở bản vẽ mới trỏ sang một đối tượng hoàn toàn khác.
- **Bản vá đầu của lỗi trên vẫn thủng**, vì nó nhận diện lượt đọc bằng
  `collectedAt` của plugin — dấu thời gian chỉ tới **giây**. Đọc lại hai lần
  trong cùng một giây cho cùng một khoá, và tập đã tích không bị xoá. Nay dùng
  số thứ tự lượt đọc của `useDrawingInfo`, thứ vốn đã có và không lặp lại.
- **Mất nút "Mở AutoCAD" khi xoá panel.** Panel cũ có nó ngay tại chỗ; xoá mà
  không mang sang là bắt người dùng quay về màn hình cũ chỉ để khởi động lại.
  Một ngõ cụt tôi tự tạo ra khi dọn dẹp.
- **JSON thô `stringify` cả khi khối đang đóng.** Chính một assert cũ của panel
  legacy chỉ ra: nó bảo "chỉ dựng khi được mở", còn bản của tôi thì không.
  350 KB `JSON.stringify` ở mỗi lần render cho một khối không ai mở.
- **Tích cả trang vượt trần 5.000 handle**, làm nút ghi khoá lại cho tới khi
  người dùng tự bỏ tích từng cái.
- **Đổi tập đã tích trong lúc đang chuẩn bị** — thao tác chờ mang tập cũ còn màn
  hình hiện tập mới. Lần khoá đầu sót nút **"Bỏ tích"**: ô tích thì khoá, nút
  xoá cả tập thì không, nên người dùng vẫn xác nhận được một hộp thoại trong khi
  màn hình sau lưng nói mình chưa chọn gì.
- **Nút chọn vẫn bấm được trong lúc đọc lại hồ sơ**, và bấm thì không có gì xảy
  ra.
- **Dải "AutoCAD chưa phản hồi" hiện khi `/docs` còn đang bay.** Điều kiện chỉ
  chờ lượt đọc hồ sơ, không chờ lời gọi danh sách bản vẽ — mà lúc mới mở, "chưa
  hỏi xong" và "hỏi xong, plugin chết" đều là `false`. Kết quả: báo AutoCAD chết
  kèm nút "Mở AutoCAD" cho một AutoCAD đang chạy bình thường. Bản vá đầu vẫn
  thiếu vế thứ hai: sau một lần hỏng, mỗi sự kiện `pluginLoaded` mở một lượt hỏi
  lại, và trong lúc lượt đó chưa về thì kết luận trên màn hình là kết luận cũ.
  Nay dải cảnh báo **ở nguyên** nhưng đổi chữ thành "đang kiểm tra lại…" — ẩn
  rồi hiện lại là một nhịp nháy, mà nháy thì đọc ra như đã kết nối được.
- **Danh mục không biết bản vẽ đã bị sửa sau lượt đọc.** Hồ sơ chỉ đọc lại khi
  bấm, nên danh mục có thể già hơn bản vẽ hàng chục thao tác — handle của một
  đối tượng vừa bị xoá vẫn nằm đó, tích được. Máy chủ vẫn chặn
  (`drawing_stale`), nên không phải lỗ hổng ghi nhầm; nhưng để người dùng tích
  40 dòng rồi mới ăn một lỗi từ máy chủ là bắt họ trả giá cho thứ màn hình biết
  trước. Nay so `revision` của hồ sơ với `revision` trong `/docs` — lời gọi nhẹ,
  đã tự nạp lại theo sự kiện reactor, và nay nghe thêm `drawingModified`.
- **Lỗi "Mở AutoCAD" hiện dưới nhãn "Không chuẩn bị được"** ở cột bên kia, vì nó
  dùng chung ô lỗi với bộ tạo thao tác. Đọc ra như một lệnh ghi hỏng, trong khi
  chưa có thao tác nào được tạo.
- **Hai câu nói sai về hiện tại.** "Chỉ chạm tới N đối tượng trong không gian X
  — không gian AutoCAD **đang mở**" là một điều màn hình không biết: đổi tab
  Model/Layout không sửa đối tượng nào nên revision không nhúc nhích, và `/docs`
  không mang không gian. Sửa thành "không gian AutoCAD mở **lúc đọc** hồ sơ
  này" — thứ duy nhất nói được có căn cứ.
- **Lý do chặn là một câu đóng hộp cho ba tình huống khác nhau.** "Hồ sơ này
  không phải bản vẽ AutoCAD đang mở" bị dùng cho cả "sai bản vẽ", "không có bản
  vẽ nào mở" và "bản vẽ đã đổi" — hai trong ba là nói sai. Nay trả lại chính ghi
  chú đã tính ra. Câu cứng đó còn nằm ở HAI chỗ nữa — dải cảnh báo của trang và
  bộ tạo thao tác; cả hai đã sửa theo.
- **Đóng rồi mở lại CÙNG một tệp không bị bắt.** Tên tệp khớp nên "sai bản vẽ"
  không thấy gì, revision của database mới lại bắt đầu từ 0 nên "đã thay đổi"
  cũng không. Nhưng với AutoCAD đó là một database khác, và guard `instance` của
  máy chủ từ chối. Nay so theo `instance`: hồ sơ trỏ tới một `instance` không
  còn trong danh sách nghĩa là bản vẽ đó đã đóng. Ba tình huống hồ sơ cũ gộp vào
  một hàm `profileStaleReason`, mỗi loại một tiêu đề riêng.
- **Nút "Đọc lại" không gỡ được kẹt.** Nó chỉ đọc lại hồ sơ. Khi danh sách bản
  vẽ đang rỗng vì lỡ một sự kiện `docOpened`, hồ sơ mới về được nhưng `docs` vẫn
  rỗng — màn hình tiếp tục nói "AutoCAD không mở bản vẽ nào" và khoá mọi thứ cho
  tới khi có một sự kiện khác. Nay đọc lại cả hai nguồn.
- **Dải "AutoCAD không mở bản vẽ nào" cũng kết luận trong lúc đang hỏi lại** —
  cùng lỗi với dải "chưa phản hồi", ở dải bên cạnh. Nay cũng nói "đang kiểm tra
  lại…".
- **Trạng thái lưu đọc từ hồ sơ, không từ danh sách bản vẽ.** Sau một lượt lưu
  trong AutoCAD, thanh tiêu đề (đọc danh sách) nói "đã lưu" còn dòng "Trạng thái
  lưu" (đọc hồ sơ) vẫn nói "có thay đổi chưa lưu" — hai chỗ trên cùng một màn
  hình nói ngược nhau. Nay cả hai lấy từ danh sách bản vẽ, khớp theo `instance`.
  Nhân đó sửa luôn một lỗi đã được ghi thành quy tắc trong `docs.ts` nhưng chưa
  thực thi: **thiếu `dbmod` là KHÔNG BIẾT**, không phải "đã lưu" — plugin bản cũ
  không phát trường này, và một nhãn "đã lưu" sai trên bản vẽ chưa lưu là đúng
  thứ dẫn tới mất dữ liệu khi khởi động lại AutoCAD.
- **Hai lời gọi `/docs` chồng nhau sau khi đổi bản vẽ hoạt động** — `reloadAll`
  đã gọi rồi mà lời gọi cũ vẫn còn. Lượt về trước bị `docsSequence` bỏ đi, và
  nếu lượt sau timeout thì màn hình rơi vào trạng thái mất kết nối ngay sau một
  lần đổi bản vẽ THÀNH CÔNG.
- **Đọc `/docs` hỏng thì xoá sạch danh sách bản vẽ.** Cùng lỗi mà
  `useDrawingInfo` đã tránh từ đầu ("GIỮ hồ sơ cũ") nhưng `loadDocs` không làm
  theo. Kịch bản cụ thể: `move-to-layer` chạy xong phát `drawingModified`, lượt
  đọc do sự kiện đó mở về SAU lượt của "Đọc lại" và hỏng — câu trả lời đúng vừa
  nhận bị ném đi, và màn hình báo mất kết nối ngay sau một thao tác THÀNH CÔNG.
  Nay chỉ hạ cờ sống, giữ nguyên danh sách.
- **Chọn được trong lúc chưa biết hồ sơ còn khớp không.** Danh sách bản vẽ là
  thứ DUY NHẤT màn hình dùng để kiểm độ tươi của hồ sơ, nhưng nút chọn không hề
  soi nó — plugin chết hoặc lượt đọc đang bay thì vẫn bấm được, rồi ăn một lỗi
  `drawing_stale` từ máy chủ. Nay gộp mọi lý do chặn vào một giá trị `blockNote`
  dùng chung cho cả danh mục lẫn bộ tạo thao tác.
- **Danh mục tự nhận là "đã đủ" trong khi đã bỏ bớt dòng.** `catalogSubjects`
  loại dòng trùng handle và dòng thiếu handle, nhưng câu ghi chú vẫn đọc thẳng
  `scanned` và `complete` từ payload — bảng hiện 2 dòng mà khẳng định có đủ 3
  đối tượng. Nay ghi chú tính từ số dòng THẬT, và lệch bao nhiêu cũng hạ xuống
  "CHƯA đủ" kèm số dòng đã bỏ.
- **Lỗi của lượt chọn hiện ở panel khác.** Cùng lỗi với nút "Mở AutoCAD": nút ở
  danh mục mà phản hồi lại nằm dưới nhãn "Không chuẩn bị được" ở cột bên kia.
  Danh mục nay có ô lỗi riêng.
- **Không chặn khi AutoCAD không có ĐÚNG MỘT bản vẽ hoạt động.** Daemon đòi đúng
  một, và sẽ từ chối mọi lệnh ghi khi không có hoặc có nhiều hơn một — nhưng
  giao diện vẫn cho bấm. Nay chặn tại chỗ với hướng dẫn cụ thể.
- **Danh sách bản vẽ vẫn bị xoá sạch — qua cửa còn lại.** Bản vá trước chỉ chặn
  nhánh `catch`, nhưng daemon trả **HTTP 200** kèm `{alive:false, docs:[]}` khi
  plugin im, nên lượt hỏng đi qua nhánh THÀNH CÔNG. Nay chỉ ghi đè danh sách khi
  plugin thật sự trả lời.
- **Hai bản vẽ chưa lưu trùng tên không phân biệt được.** Bản vẽ chưa lưu không
  có đường dẫn, nên hai `Drawing1.dwg` mở cùng lúc cho ra tên khớp; nếu cả hai
  còn ở revision 0 thì so revision cũng khớp nốt, và màn hình trưng hồ sơ của
  bản vẽ KHÔNG hoạt động như thể nó là bản đang mở. Nay khớp `instance` chưa đủ
  — phải là bản vẽ đang hoạt động.
- **Trạng thái lưu vẫn đọc danh sách đã không tin được nữa (P1).** Cùng lỗi với
  mục ngay dưới nhưng tôi chỉ sửa một nửa: chặn phần chẩn đoán, quên phần trạng
  thái lưu. Đây là nửa nguy hiểm hơn — hiện "đã lưu" khi thật ra không biết là
  làm người dùng đóng AutoCAD và mất phần chưa lưu. Nay `savedState` nhận thêm
  `docsAlive` và trả "không biết" khi lượt đọc gần nhất hỏng, kể cả khi hồ sơ có
  sẵn một con số.
- **Chẩn đoán "hồ sơ cũ" dựa trên danh sách bản vẽ đã cũ** — hệ quả trực tiếp
  của bản vá ngay trên. Từ lúc `loadDocs` giữ lại danh sách khi đọc hỏng, danh
  sách đó có thể mô tả một trạng thái AutoCAD đã qua, và đem so với hồ sơ cho ra
  một chẩn đoán tự tin mà sai, kiểu "bạn đang ở bản vẽ khác" trong khi thật ra
  không biết gì cả. Nay chỉ chẩn đoán khi `docsAlive`; không biết thì nói không
  biết.
- **`savedState` lùi về con số cũ khi bản ghi sống thiếu `dbmod`.** Tìm thấy bản
  ghi sống nghĩa là nó mới hơn; thiếu trường chỉ nói plugin không phát, không
  phải cái cớ để hồi sinh giá trị đã cũ trong hồ sơ.
- **Bỏ sót sự kiện `drawingSaved`.** Nó đến từ `saveComplete` của database
  reactor, không đi qua `commandEnded`, nên một lượt lưu tự động hay QSAVE từ
  menu không phát `drawingModified`. Hệ quả: `dbmod` treo ở "chưa lưu" và
  revision đứng lại ở số cũ cho tới lần bấm "Đọc lại" tiếp theo.

### Added — `/drawing-info` đổi được bản vẽ đang hoạt động

Bước bắt buộc trước khi xoá được `DrawingInfoPanel` legacy. Panel cũ có 5 chỗ
dùng `activate-document`; màn hình mới thì chưa — xoá luôn là mất tính năng.

Titlebar của shell mới đã chờ sẵn: tab bản vẽ ở đó cố tình **không bấm được**,
kèm chú thích "cho tới khi luồng đó có màn hình". `/drawing-info` là chỗ đúng để
chứa nó — đây là màn hình về "tôi đang xem bản vẽ nào".

Ô chọn bản vẽ đứng **riêng**, trên cùng, không gộp vào danh sách thao tác: nó
không chạm đối tượng nào mà đổi **thứ mọi thao tác bên dưới nhắm vào**.

### Fixed — sáu lỗi cùng một họ: hai nguồn dữ liệu lệch nhau (Codex review)

Hồ sơ bản vẽ là ảnh chụp nặng đọc một lần; danh sách bản vẽ nhẹ và mới hơn. Mọi
lỗi dưới đây đều sinh ra từ chỗ hai nguồn đó lệch nhau:

- **Ô chọn lấy bản vẽ hoạt động từ hồ sơ (P1).** Người dùng đổi tab trong AutoCAD
  thì ô chọn vẫn đánh dấu bản vẽ cũ. Nay lấy từ danh sách bản vẽ — nguồn mới hơn.
- **Danh sách bản vẽ chỉ đọc một lần lúc mở (P1).** Đổi tab sau đó thì không gì
  cập nhật, và dải cảnh báo không bao giờ hiện — đúng tình huống nó sinh ra để
  bắt. Nay nghe sự kiện reactor, dùng lại đúng cơ chế của shell.
- **Cho chuẩn bị thao tác trong lúc hồ sơ đã cũ (P1).** Chặn hẳn, không chỉ cảnh
  báo: daemon **bắt buộc** đích của `select`/`move-to-layer` là bản vẽ đang hoạt
  động, nên lượt chuẩn bị chắc chắn hỏng — bấm được rồi báo lỗi là ngõ cụt.
- **Cho chuẩn bị trong lúc đang đọc lại hồ sơ (P1).** Sau khi đổi bản vẽ,
  `payload` còn là bản vẽ trước cho tới khi đọc xong; danh sách layer bên dưới
  thuộc về bản vẽ cũ.
- **Hai lượt chuẩn bị chạy song song.** Lượt về sau ghi đè thẻ xác nhận, lượt kia
  bị bỏ rơi ở máy chủ.
- **Lượt đọc danh sách bản vẽ về trái thứ tự.** Sự kiện reactor tới thành chùm.

Thêm dải cảnh báo mới: **"Hồ sơ này không phải bản vẽ đang mở"** — cả trang, kể
cả bảng layer và bộ tạo thao tác, đang mô tả một bản vẽ khác.

### Known — `DrawingInfoPanel` legacy VẪN chưa xoá được

Lượt trước tôi nói nó "bỏ được ngay". Sai. Rà lại thì panel cũ còn ba thứ màn
hình mới chưa có: **lọc + phân trang danh mục đối tượng**, **xem JSON thô**, và
**bộ chọn bản vẽ** (phần này đã làm xong ở lượt này). Xoá khi chưa port là mất
tính năng, không phải dọn dẹp.

## 2026-08-11 — D2: cảnh báo màn hình dựng thử

### Added — dải "BẢN DỰNG THỬ" cho hai màn hình không có backend

Thi hành **quyết định D2** của `ROADMAP.md` — đã chốt từ lâu nhưng chưa làm.

`PreconstructionWorkspace` gọi **0** API; `PDF & Review Workspace` gọi **1** (chỉ
để đọc `INSUNITS`). Mọi khối lượng, đơn giá, danh sách tài liệu, danh sách markup
và cả bản vẽ trong khung xem đều là **hằng số viết cứng** — kể cả con số
"1.115.576.347 đ" ở ô dự toán và "18,60 m²" cạnh một mặt bằng. Trước lượt này
không có một dòng nào trên màn hình nói ra điều đó.

Đó không phải một tính năng chưa xong. Đó là một màn hình **nói dối**, và nó
nguy hiểm hơn một màn hình trống: kỹ sư mở ra, thấy số, chép vào hồ sơ.

Dải cảnh báo **không tắt được** — cho tắt là biến nó thành một cú bấm phiền toái
người ta bỏ qua trong ba giây đầu.

### Added — `check:prototype`, guardrail canh chính dải cảnh báo đó

Dải cảnh báo là thứ dễ bị gỡ nhất trong repo: nó xấu, chiếm chỗ, và "ai cũng biết
rồi". Ràng buộc phải nằm ở chỗ máy kiểm được.

Bản đầu đếm `fetch(` và coi "dưới 2 lời gọi" là chưa có backend — **báo nhầm ngay
hai chỗ**: `CadWebViewerPanel` nhận dữ liệu qua prop (viewer thuần, không gọi API
là kiến trúc đúng), và `DrawingInfoPanel` gọi một lời gọi tới một endpoint trả về
toàn bộ hồ sơ. Một script hay báo sai sẽ bị nới lỏng cho tới lúc vô dụng, nên
ràng buộc đổi sang bám vào **danh sách đã quyết định** ở D2, kiểm cả hai chiều.

Script còn chặn hai kiểu hỏng đã xảy ra thật trong chính lượt này:

- **Bọc banner vào comment vẫn qua được** nếu chỉ tìm chuỗi thô. Nay bóc chú
  thích trước khi tìm — và đã thử phá để chắc là nó bắt.
- **Quên hàng lưới ở override responsive.** Hai panel là lưới hàng cố định; thêm
  banner là thêm một hàng. Bản gốc đã sửa nhưng **ba override responsive thì
  chưa**, nên ở khổ màn hình hẹp banner chiếm hàng header và thân panel bị nén
  vào hàng footer 24px. Script nay đòi mọi `grid-template-rows` của hai panel đó
  bắt đầu bằng `auto`.

## 2026-08-11 — Giai đoạn 6: màn hình `/drawing-info`

### Added — màn hình `/drawing-info`

Giai đoạn 6, phần đầu. Hồ sơ đầy đủ của bản vẽ đang mở: tệp và phiên bản, đơn vị
và phạm vi, đối tượng theo kiểu, bảng layer 43 dòng, bảng ký hiệu, layout/xref,
từ điển đối tượng có tên — cộng **bộ tạo thao tác** ở cột phải.

Bốn chỗ cố tình lệch khỏi bộ mẫu, vì bộ mẫu tả một backend khác:

- **`extents` có thể bị GIẤU ĐI.** Mẫu in EXTMIN/EXTMAX như một cặp toạ độ lúc
  nào cũng có nghĩa. Thật ra AutoCAD gộp mọi không gian vào một cặp: `min` từ
  Model (toạ độ bản vẽ) và `max` từ layout (mm trên giấy), ra một khung rộng
  **3,8 triệu** đơn vị. Bản vẽ nhiều không gian thì màn hình nói "không dùng
  được" và chỉ sang `/workspace`, nơi có khung theo từng không gian.
- **Bỏ "theo kiểu đối tượng" và "đặt màu theo layer".** `cleanScope()` của daemon
  chỉ nhận `layer`/`block`/`handles`; thao tác chỉ có `select` và `move-to-layer`.
- **Hai thao tác chạy trên hai TẬP KHÁC NHAU** — và đây là chỗ dễ gây ghi nhầm
  nhất. `select` chạy theo phạm vi chọn ở đây; `move-to-layer` **bỏ qua phạm vi
  hoàn toàn**, daemon gọi `captureCurrent()` và ghi lên **bộ chọn hiện tại của
  AutoCAD**. Nên khi chọn thao tác gán, hai ô phạm vi **biến mất** thay vì đứng
  đó gợi ý sai, và màn hình nói rõ nó chạy trên bao nhiêu đối tượng đang chọn.
- **Bỏ banner về snapshot `.cadweb`.** Mẫu nói khung xem không hiện
  dimension/hatch/xref. Từ giai đoạn 5, `/workspace` đọc hình học trực tiếp và vẽ
  được cả hai — giữ câu đó là nói sai về chính app.

Đã chạy trọn hai pha trên bản vẽ thật: `Đã chọn 1 đối tượng trong AutoCAD`. Đó
cũng lấp nốt chỗ chưa kiểm được của commit trước.

### Fixed — tám lỗi của lượt này (Codex review)

- **Bộ tạo thao tác mời ghi nhầm đối tượng (P1).** Gửi `scope` kèm
  `move-to-layer` trong khi daemon bỏ qua nó: người dùng chọn "layer P-ThoatXi",
  bấm ghi, và một tập đối tượng khác hẳn bị đổi layer.
- **Bản vẽ chưa lưu ghi nhầm sang bản vẽ khác (P1).** `document.file` rỗng khi
  bản vẽ chưa từng lưu, và đích rỗng làm daemon phân giải sang **bản vẽ đang hoạt
  động** — có thể là bản vẽ khác nếu người dùng đổi tab AutoCAD sau khi trang
  tải. Nay lùi về `title`, đúng thứ tự `file || title` daemon dùng. Sửa ở **cả**
  `/workspace`.
- **Chỉ đọc được một dạng phản hồi (P1).** `drawing-info` trả cả khoá ở gốc lẫn
  khối `drawing` lồng bên trong với tên khác (`entitiesByType`, `layers`…).
  Daemon chỉ bù `tables.layers`/`blocks`; `counts`/`settings`/`extents` chép
  thẳng từ plugin. Một plugin chỉ phát dạng lồng sẽ cho ra màn hình 0 đối tượng
  mà không lỗi gì. Nay chuẩn hoá một chỗ, và **tên khoá đã đối chiếu với phản hồi
  thật** (`dimension`/`linetypes`, không phải `dim`/`linetype` như tôi đoán).
- **Bản vẽ chỉ đọc bị chặn cả thao tác chọn**, dù daemon chỉ chặn chỉ-đọc cho
  `move-to-layer`.
- **CSS rò rỉ sang màn hình legacy.** `.info` không phạm vi trúng
  `.lisp-library-notice.info`. Nay cả khối bọc trong `[data-screen="drawing-info"]`,
  **từng selector một** — bọc mỗi cái đầu sau dấu phẩy vẫn để `.kv dd` ở phạm vi
  toàn cục.
- **Ẩn hẳn bộ tạo thao tác dưới 900px.** Quy tắc chép từ bộ mẫu, nhưng ẩn một
  tính năng mà không có đường mở lại là ngõ cụt. Nay xếp dọc xuống dưới.
- **`inUse` thiếu bị coi là "không dùng"** — một lời khai không có căn cứ, mà
  người dùng dọn bản vẽ dựa trên đúng nhãn đó.
- **Ô màu layer vô hình:** `.swatch` chỉ có kích thước bên trong `.layerrow`.

### Changed — `check:css` bắt được kiểu rò rỉ đã lọt

Guardrail cũ so "class đơn với class đơn", nên một quy tắc design-system không
phạm vi trúng phần tử legacy chỉ được nhắm bằng **selector ghép** thì không bị
báo. Thêm chiều kiểm thứ hai, và sửa luôn một lỗi trong chính nó: `unscopedClasses`
bóc `[...]` **trước** khi tìm tổ tiên, nên `[data-screen="x"] .info` bị đọc thành
không phạm vi — đúng lỗi làm lọt `.info` qua vòng kiểm đầu.

Chiều kiểm mới tìm ra một va chạm **có sẵn**: `.check` của design system
(`inline-flex`) trúng vào `<td class="check">` của bảng standards legacy. Đổi tên
phía legacy thành `.selcell`, đúng như thông điệp của chính guardrail.

## 2026-08-11 — Giai đoạn 5: chọn trong AutoCAD từ khung xem

### Added — "Chọn trong AutoCAD" từ khung xem

Chỗ cuối cùng của giai đoạn 5 còn treo. Bấm một đối tượng trong khung xem rồi
nhờ AutoCAD chọn chính nó — đường **duy nhất** từ màn hình này chạm tới AutoCAD,
và vẫn đi qua hai pha như mọi thứ khác.

- **Guard phải lấy từ chính lượt đọc đã sinh ra handle.**
  `/selection/prepare` đòi `catalogGuard: {instance, revision}`, nên plugin nay
  phát cả hai trong `document` của `geometry.json`. Ghép handle của lượt này với
  guard đọc ở lượt khác là mở ra đúng khoảng thời gian giữa hai lượt: bản vẽ đổi
  trong quãng đó thì handle trỏ sang đối tượng khác, guard vẫn hợp lệ, và người
  dùng chọn nhầm thứ mình không nhìn thấy.
- **Ràng buộc thật, tìm ra bằng cách thử:** chọn theo handle **chỉ chạy với
  không gian hiện hành** của AutoCAD; các không gian khác trả `not a top-level
  entity in current space`. Thử cả 5 không gian của bản vẽ as-built: đúng một
  cái chạy. Nên plugin phát thêm `document.space`, và nút tự khoá kèm câu "Đối
  tượng nằm ở Model, còn AutoCAD đang ở Layout 01 — chuyển sang Model rồi thử
  lại". Bấm được rồi mới báo lỗi là một ngõ cụt.
- **Mode `selection` mới cho `ConfirmSheet`.** Cả ba cảnh báo của `staged` đều
  SAI ở đây: chọn không sửa đối tượng nào, `UNDO` không có gì để hoàn tác, và ô
  tích "tôi hiểu thao tác này không hoàn tác được" là một lời khai sai. Một cảnh
  báo sai làm hỏng đúng thứ nó tồn tại để bảo vệ — lần sau người dùng đọc lướt
  cả những cảnh báo đúng.

### Fixed — ba lỗi của lượt này (Codex review)

- **Hộp xác nhận mô tả nhầm đối tượng.** Canvas vẫn bấm được trong lúc chờ máy
  chủ chuẩn bị, nên `selectedEntity` có thể đã đổi khi thẻ xác nhận hiện ra —
  ngay trong hộp thoại tồn tại để người dùng kiểm lại. Nay chụp lại đối tượng
  cùng lúc với thao tác.
- **Bỏ qua chạy song song với xác nhận.** `busy` chỉ khoá hai nút ở chân hộp
  thoại; phím Esc và cú bấm ra nền vẫn gọi được. Bỏ mà thắng thì lượt chọn vừa
  xác nhận hỏng với `operation_not_pending`.
- **Import chéo feature** (`workspace` → `staged-ops`) — chính guardrail
  `check:boundaries` của dự án chặn lại. Phần chuẩn bị lệnh chọn chuyển sang
  `features/staged-ops/selectHandles.ts` và nhận **giá trị trần** thay vì payload
  hình học: module ở `staged-ops` không được biết hình dạng dữ liệu của feature
  khác.

### Known — chưa chạy được trọn hai pha trên máy này

Pha chuẩn bị đã chạy thật và trả về operation hợp lệ. Pha xác nhận **chưa** chạy
được vì AutoCAD trên máy này kẹt ở trạng thái `exact target has an active
command` sau nhiều lần khởi động lại bằng script; cửa sổ bản vẽ cũng không hiện.
Đó là trạng thái môi trường, không phải mã — nhưng chưa có bằng chứng chạy thật
cho pha ghi.

## 2026-08-11 — Giai đoạn 5: VIEWPORT và MTEXT

### Added — VIEWPORT có viền thật, MTEXT có căn lề và nhiều dòng

**Hình bao còn 0/10.888.** Không còn đối tượng nào vẽ bằng hộp chữ nhật.

- **VIEWPORT 8/8.** Cái nhìn thấy trên giấy *là* khung của viewport, và khung đó
  đọc thẳng từ `centerPoint`/`width`/`height` — không cần `worldDraw`. Trước đó
  1 cái không vẽ được vì `worldDraw` của nó đi qua cơ chế cắt theo biên mà bộ
  bắt nói thẳng là không làm được, nên nó chọn không vẽ gì. Khung cắt không phải
  chữ nhật thì đánh dấu `viewport-clipped`: hình chữ nhật vẫn là **biên ngoài**
  đúng, nhưng không phải đường viền thật.
- **MTEXT tách dòng và bóc mã định dạng.** MTEXT mang mã điều khiển ngay trong
  nội dung (`\P` xuống dòng, `{}` nhóm, `\H` đổi cỡ, `\S1^2;` phân số xếp
  chồng, `\U+00B0` ký hiệu). Trước đó xuất nguyên chuỗi nên người dùng đọc được
  cả mã lẫn chữ trộn vào nhau. Nay bóc mã, tách dòng, giữ lại phân số dạng
  `1/2`. Trên bản vẽ này: 60 MTEXT, 2 cái nhiều dòng.
- **Căn lề.** `horizontalMode` khác trái thì điểm vẽ **thật** là
  `alignmentPoint()` chứ không phải `position()`; dùng nhầm là vẽ lệch đúng bằng
  chiều dài dòng, dòng càng dài lệch càng nhiều. **48 dòng chữ căn giữa** trên
  bản vẽ này trước đó đều sai vị trí. Nay có `ha`/`va` cho cả TEXT lẫn MTEXT —
  113 đối tượng có neo khác mặc định.
- **Ký hiệu `%%`.** `%%d` `%%c` `%%p` `%%176` thành °, ⌀, ±, và ký tự theo mã;
  `%%u` `%%o` `%%k` chỉ bật/tắt gạch nên bỏ. Gặp thật trong bản vẽ:
  `%%UKÝ HIỆU` giờ ra `KÝ HIỆU`.

### Fixed — sáu lỗi của lượt này (Codex review)

- **Chữ căn hai đầu bị dời cả đoạn (P1).** Với `kTextAlign`/`kTextFit`,
  `alignmentPoint()` là **điểm cuối** của đoạn chứa chữ chứ không phải một cái
  neo. Lấy nó làm neo là đặt cả dòng bắt đầu từ điểm cuối.
- **Hai khoá `aw` trong cùng một đối tượng JSON.** Parser giữ cái sau, nên lý do
  thật bị thay bằng lý do khác và câu giải thích cho nó không bao giờ hiện ra.
  Nay chọn đúng một lý do, ưu tiên phép chiếu sai vì nó ảnh hưởng cả **vị trí**.
- **`%%176` bị nuốt mất chữ số đầu**, còn lại `76` — đổi thầm lặng một ghi chú
  thành một con số khác hẳn. Mã lạ nay **giữ nguyên**: nuốt thứ không hiểu là
  xoá nội dung thật mà không ai biết đã xoá gì.
- **`\U+00B0` ở cuối chuỗi không được giải mã** vì điều kiện biên chặt hơn một
  ký tự — đúng chỗ ký hiệu độ hay nằm nhất.
- **Khối MTEXT nhiều dòng căn giữa/căn đáy bị tụt xuống.** Neo dọc của AutoCAD
  ôm **cả khối**, còn `dominant-baseline` của SVG chỉ neo dòng đầu.
- **MTEXT mất xuống dòng tự động (P1).** MTEXT có bề rộng cột thì AutoCAD tự
  xuống dòng khi vẽ, mà `contents()` chỉ mang `\P` — tách tay thì một ghi chú
  dài ra đúng một dòng, sai cả số dòng lẫn chiều cao khối. Nay đi qua
  `explodeFragments`: AutoCAD trả về từng **đoạn chữ kèm vị trí thế giới**, nên
  xuống dòng, căn lề và đổi cỡ giữa dòng đều do nó tính. 60/60 MTEXT trên bản vẽ
  này bung được; khối ghi chú dài ra 20 đoạn. Đường tự tách dòng chỉ còn là dự
  phòng, và nay **luôn** đánh dấu `mtext-not-wrapped`.
- **MTEXT mất danh tính khi bung đoạn.** Ra `k:"multi"` giống HATCH nên inspector
  gọi một khối chữ là "Vùng gạch" và không có điểm để phóng tới. Nay cụm mang
  theo `p` + `lines`, và `shapeLabel()` phân biệt ba loại `multi`.
- **Cắt chữ giữa ký tự nhiều byte.** `total` đếm byte mà chữ tiếng Việt 2-3 byte
  mỗi ký tự — cắt giữa cho ra UTF-8 hỏng và cả phản hồi JSON thành không đọc
  được. Thêm một lỗi nữa cùng họ: ngân sách còn lại rơi vào giữa ký tự đầu của
  một đoạn thì cắt xong không còn byte nào, `used` không nhích, và **mọi đoạn sau
  lại thêm một phần tử rỗng** — vòng lặp không có điểm dừng.
- **Mã điều khiển đi vòng qua trần độ dài.** Phân số xếp chồng dài hay chuỗi
  `\P` liên tiếp không bị tính, nên một đối tượng có thể sinh hàng nghìn thẻ
  `<tspan>`.

### Known — chữ mã hoá phông Việt cũ

Bản vẽ as-built dùng phông TCVN3/VNI đời cũ: DWG lưu byte theo bảng mã riêng của
phông, nên chuỗi đọc ra là `èng tho¸t n\xadíc xÝ` thay vì `ống thoát nước xí`.
Đây là dữ liệu trong bản vẽ, không phải lỗi đọc — muốn hiện đúng phải nhận diện
phông rồi giải mã theo bảng, và đoán sai bảng sẽ làm hỏng cả chữ vốn đang đúng.
Chưa làm.

## 2026-08-10

### Added — bộ bắt hình `worldDraw`: hình bao còn 0,01%

AutoCAD vẽ mọi đối tượng bằng cách gọi `worldDraw()` của nó với một bộ ngữ cảnh
vẽ. Đưa vào đó một bộ ngữ cảnh **tự viết** thì thay vì vẽ lên màn hình, ta nhận
được chính các nguyên thuỷ đồ hoạ AutoCAD định vẽ. Một bộ bắt dùng được cho mọi
kiểu đối tượng — nên xong MULTILEADER là xong luôn cả HATCH tô đặc và VIEWPORT.

Kết quả trên bản vẽ as-built: **1 hình bao trên 10.888 đối tượng (0,01%)**. Đầu
phiên là 18,1%.

- **MULTILEADER** 23/23 — trung bình 5,3 hình con, gồm đường dẫn, mũi tên và
  **ghi chú**: `WP-uPVC-D90;I=1%`, `SP-uPVC-D110;I=1%`. Bắt được mũi tên là nhờ
  `draw()` **gọi đệ quy** (mũi tên là một block, AutoCAD vẽ nó qua chính lời gọi
  đó) — có trần độ sâu 6 để chặn vòng lặp.
- **HATCH tô đặc** 43/43 — qua `shell()`, lấy viền từng mặt. Đây chính là đường
  biên mà đường `AcGeCurve2d` không lấy được.
- **VIEWPORT** 7/8.

Chữ bắt ở **lời gọi cấp cao** (`text()` với vị trí, chiều cao, hướng, nội dung),
không bắt đường bao glyph: một dòng chữ vẽ bằng đường bao là hàng trăm đường,
nặng gấp bội mà đọc ra thì tệ hơn hẳn một thẻ `<text>`.

Mọi hình bắt kiểu này đều `a:1` (`aw:"worlddraw"`). Đó là hình AutoCAD **vẽ ra**,
không phải hình học gốc: cung tròn đã bị chia thành đoạn thẳng, độ mịn phụ thuộc
`deviation` mình tự chọn (lấy theo kích thước đối tượng — một mũi tên dài 2 đơn
vị và một vùng gạch rộng 50.000 cần hai mức chia rất khác nhau). Nhìn thì giống,
**đo thì không được**, và inspector nói đúng câu đó.

### Fixed — bốn lỗi của bộ bắt hình (Codex review)

- **Đọc quá bộ đệm chữ, ngay trong lòng AutoCAD (P1).** `AcGiGeometry::text` có
  thể đưa vào một bộ đệm **không kết thúc bằng NUL** kèm độ dài riêng. Bản đầu
  đổi cả chuỗi rồi mới cắt — quét thẳng qua vùng nhớ. Bản sửa thứ nhất vẫn sai
  tinh vi hơn: `for (p = w; *p; ++p)` rồi kiểm trần ở dòng đầu thân vẫn **đọc
  `*p` một lần nữa** sau ký tự hợp lệ cuối. Nay trần nằm trong chính điều kiện
  vòng lặp, `&&` chặn ngắn mạch. Cũng cắt theo **ký tự** chứ không theo byte:
  `length` đếm ký tự rộng, cắt `std::string` là cắt byte nên chữ có dấu bị gãy
  đôi.
- **Vòng tròn mất mặt phẳng của nó.** Bản đầu bỏ qua pháp tuyến và lấy mẫu một
  vòng tròn trong mặt phẳng XY; nạp ba điểm thì vẽ ra một **tam giác**. Nay dựng
  hệ trục nằm trong đúng mặt phẳng của cung (thuật toán trục tuỳ ý của AutoCAD),
  và ba điểm đi qua `AcGeCircArc3d` — đối tượng trên ngăn xếp, không cấp phát
  cho ai.
- **Chiều cao chữ đo sai trục.** Lấy `(0,1,0)` của thế giới rồi biến đổi là sai
  ngay khi block bị xoay hoặc co giãn không đều. Trục đứng của chữ là
  `normal × direction`, và API text đưa vào cả hai.
- **Chữ trong cụm gần đúng lại hiện như hình thật.** Nó đến từ cùng một lượt bắt
  với các nét quanh nó; để nó ra màu khác là nói rằng chữ đáng tin hơn hình.
- **Vứt mất phép biến đổi mà đối tượng đang yêu cầu (P1).**
  `pushPositionTransform` / `pushScaleTransform` / `pushOrientationTransform`
  chỉ đẩy một bản sao rồi trả ma trận đơn vị, nên đồ hoạ chú thích rơi sai chỗ
  hoặc sai cỡ. Nay tính đúng cho các behavior **thuộc về thế giới**; các
  behavior `Viewport*`/`Screen*` cần một camera mà ở đây không có, nên giữ
  nguyên tỉ lệ bản vẽ — lựa chọn có ý, ghi rõ tại chỗ.
- **Cung theo chiều kim đồng hồ bị lật thành phần bù của nó.** Chuẩn hoá mọi góc
  quét không dương thành dương biến một cung 1/4 vòng thuận chiều thành cung 3/4
  vòng ngược lại. Nay giữ dấu; nơi nào chỉ có góc đầu/góc cuối thì tự chuẩn hoá
  trước khi gọi, và cung ba điểm suy ra chiều từ điểm giữa.
- **Mặt của vùng tô đặc hỏng vì chỉ số âm (P1).** Danh sách mặt của `shell()`
  đánh dấu cạnh vô hình bằng chỉ số âm, mã hoá `-(i+1)`. Bản đầu bỏ **cả mặt**
  khi gặp; bản sửa thứ nhất đọc `-raw` nên lấy nhầm đỉnh kế tiếp và bỏ mất đỉnh
  cuối. Suy ra được mã hoá đúng chứ không phải đoán: với `-i` thì đỉnh số 0
  không bao giờ đánh dấu được. Nay giải mã đúng, và đỉnh sai thì bỏ **riêng đỉnh
  đó** — mất một mặt của vùng tô đặc là mất một mảng hình không dấu vết.
- **Hứa cắt theo biên rồi không cắt.** `pushClipBoundary` trả `kTrue` khiến đối
  tượng tin là đã được cắt và không tìm đường khác, trong khi nguyên thuỷ ngoài
  biên vẫn bị ghi lại thành hình nhìn thấy được — VIEWPORT chính là thứ dùng cơ
  chế này. Nay trả `kFalse`, nói không ngay từ đầu.
- **Chữ mất hệ số bề ngang.** Chiều cao đi theo trục đứng còn bề rộng glyph đi
  theo font, nên chữ trong block co giãn không đều vẽ ra sai tỉ lệ. Thêm trường
  `xs`. Ba nguồn độc lập phải nhân với nhau: `widthFactor` của `AcDbText`,
  `xScale` của kiểu chữ trong `worldDraw`, và tỉ lệ do phép biến đổi mang lại.
  Trên bản vẽ này có **98 dòng chữ** hệ số 0,5–0,8, tức trước đó vẽ rộng hơn
  thực tế tới gấp đôi.

**Vì sao đường này an toàn**, khác hẳn đường `AcGeCurve2d` đã làm AutoCAD chết:
`worldDraw` chỉ **đưa** dữ liệu vào hàm của ta, không giao quyền sở hữu gì cả.
Mọi con trỏ nhận được đều thuộc về AutoCAD; ta chỉ đọc và sao chép, không
`delete` gì. Đã chạy 6 lượt đọc liên tiếp, AutoCAD sống.

### Added — plugin dựng hình HATCH, DIMENSION, ELLIPSE, SPLINE

Hình bao còn **0,7%** số đối tượng (74/10.888), trước là 18,1%.

- **DIMENSION** — không tự dựng lại đường kích thước, mũi tên, đường gióng và
  chữ. AutoCAD đã giữ sẵn đồ hoạ của mỗi dimension trong một **block ẩn danh**
  (`*D188`); lấy chính block đó rồi đi qua đường xuất block có sẵn. Kết quả là
  hình THẬT, không phải gần đúng. 29/29 dimension ra hình.
- **HATCH** — vòng biên dạng polyline (giữ cả `bulge`, tức giữ độ cong thật) và
  đường gạch pattern do AutoCAD tính sẵn. Ra kiểu mới `multi`: nhiều hình con
  nhưng vẫn là **một** đối tượng chọn được. 77/120 hatch ra hình.
- **ELLIPSE** — xuất **gọn** bằng 7 số (tâm, hai bán trục, góc nghiêng, hai tham
  số đầu/cuối), không lấy mẫu. Bản vẽ as-built có 1847 ellipse: chênh lệch giữa
  13 KB và 830 KB payload cho cùng một hình. `a0`/`a1` là **tham số**, không
  phải góc thật — cung tham số ánh xạ 1-1 sang cung elip của SVG nên đây là hình
  chính xác.
- **SPLINE và các đường cong khác** — lấy mẫu 48 điểm qua `AcDbCurve`, đánh dấu
  `curve-sampled` vì lấy mẫu LÀ xấp xỉ.

Còn hình bao: 43 HATCH tô đặc có biên dạng cạnh rời, 23 MULTILEADER, 8 VIEWPORT.

### Fixed — đường biên hatch làm AutoCAD chết (tự gây ra, tự sửa)

Bản đầu tiên lấy biên hatch qua `getLoopAt` dạng **mảng con trỏ `AcGeCurve2d*`**
rồi `delete` từng cái theo đúng tài liệu. Chạy trên bản vẽ thật: AutoCAD đọc
xong **đúng một lượt** rồi chết — dấu hiệu kinh điển của hỏng heap, vì lỗi không
nổ ngay tại chỗ `delete`. Bỏ hẳn đường đó.

Đổi lại: vùng gạch có biên dạng cạnh rời mất đường viền (`hatch-boundary-partial`),
nhưng nếu không tô đặc thì các đường gạch vẫn vẽ ra cả vùng. Đổi một cái viền
lấy nguy cơ làm sập AutoCAD của người dùng là đổi sai chiều. Muốn làm đúng phải
qua `worldDraw` — xem `ROADMAP.md`.

Bản sửa đã chạy 6 lượt đọc liên tiếp, AutoCAD sống.

### Changed — tải nhanh hơn: 0,55 s → 0,37 s, và 38.223 node SVG → 1.468

Đo trước khi sửa: plugin quét 0,31 s, daemon 0,24 s.

- **Bỏ tuần tự hoá lại ở daemon (−29 ms).** `res.json(obj)` duyệt lại toàn bộ
  cây vừa `JSON.parse` xong để dựng lại đúng chuỗi plugin đã ghi. Nay giữ chuỗi
  gốc và gửi thẳng.
- **Nhịp dò thích ứng (−60 ms trung bình).** Nhịp cố định 120 ms cộng trung bình
  60 ms chết vào mọi lượt đọc. Nay 15 ms trong giây đầu rồi giãn dần.
- **`<defs>` + `<use>` + gộp nét (38.223 → 1.468 node).** Định nghĩa block dựng
  một lần; bên trong mỗi định nghĩa, mọi nét cùng kiểu gộp thành một `<path>` —
  hình bên trong block không chọn riêng được nên gộp không mất gì.
- **Đã thử gzip rồi BỎ.** Mức 1 tốn 20 ms nén + 10 ms giải nén để bớt 1,3 MB
  đường truyền, mà daemon chỉ lắng nghe trên `127.0.0.1` nơi 1,3 MB đi hết vài
  mili-giây. Đo end-to-end: có gzip **chậm hơn** (0,42 s so với 0,37 s). Ghi lại
  để lần sau không ai thêm `compression` vào vì nghe hợp lý.

Sau khi sửa: 0,37 s cho một payload **to hơn** (1,82 MB thay vì 1,24 MB, vì đã
có thêm hình của hatch, dimension và ellipse).

### Added — màn hình `/workspace`: khung xem hình học thật

Route mới, đọc `GET /api/acad/geometry` và vẽ ra SVG: canvas thu/phóng/kéo, bộ
chọn không gian, bảng layer lọc theo khung xem, inspector thuộc tính.

Ba chỗ **cố tình lệch khỏi bộ mẫu**, vì bộ mẫu mô tả một backend không tồn tại:

- **Bỏ dải phiên bản snapshot** (r45→r48 + banner "snapshot cũ hơn bản vẽ").
  Không có lịch sử snapshot, `.cadweb` sync chưa có máy chủ nhận, hình học đọc
  trực tiếp từ plugin mỗi lượt. Thay bằng một sự thật: ảnh chụp lúc mấy giờ, và
  nút đọc lại.
- **Bỏ hàng "Màu" và "Linetype"** khỏi inspector. Payload không mang. Một hàng
  "Màu: ByLayer" viết cứng đọc y hệt giá trị đọc được từ bản vẽ.
- **Thêm bộ chọn không gian** mà bộ mẫu không có. Bản vẽ thật có 5 không gian
  với hệ toạ độ khác hẳn nhau (Model ở toạ độ trắc địa cách gốc 3,7 triệu đơn
  vị; layout tính bằng mm trên giấy). Không có bộ chọn thì 34 đối tượng trên các
  layout không có đường nào để xem.

Màu nét nói **độ trung thực**, không nói layer: trắng = hình thật, xanh = hình
thiếu, xám nét đứt = chưa có hình. Trên Model của bản vẽ as-built: 135 / 35 / 54.

### Added — plugin xuất nội dung định nghĩa block

**Đây là thứ quyết định màn hình có dùng được hay không.** Bản vẽ as-built của
dự án chỉ có **259 đối tượng ở cấp trên cùng** (127 trong đó là lần chèn block,
không có XREF nào) — toàn bộ mặt bằng kiến trúc, khung tên, trục, cửa, hatch nằm
**bên trong 95 định nghĩa block**. Bản trước chỉ xuất điểm chèn, nên khung xem
ra đúng mấy cái chấm; đối chiếu với ảnh bản vẽ thật mới lộ ra.

Nay `geometry.json` có thêm `blocks`: nội dung từng định nghĩa, gửi **một lần**
mỗi block dù được chèn bao nhiêu lần, kèm ma trận `m` ở mỗi lần chèn. Trên bản
vẽ thật: 147 định nghĩa, **10.122 đối tượng** — gấp 40 lần cấp trên cùng, mà
payload chỉ 1,2 MB vì không nhân bản.

- `m` lấy thẳng từ `blockTransform()` của AutoCAD, đã gồm điểm chèn, điểm gốc
  block, tỉ lệ âm và trục không vuông góc. Dựng lại từ `rot`+`sc` chỉ đúng ở
  trường hợp đơn giản nhất.
- Block lồng nhau duyệt theo lớp, trần độ sâu 8 — chặn cả đệ quy vô hạn (bản vẽ
  hỏng: A chèn B chèn lại A) lẫn những cây lồng quá sâu.
- Ngân sách riêng 60.000 đối tượng cho nội dung block, tách khỏi trần xuất của
  cấp trên cùng, kèm cảnh báo `block_geometry_truncated` /
  `block_nesting_too_deep`.

### Fixed — bốn lỗi của khung xem (Codex review)

- **Góc chữ tính bằng radian đem vẽ như độ (P1).** Plugin trả `rotation()` của
  AutoCAD là radian, SVG `rotate()` nhận độ — một nhãn xoay 90° chỉ nghiêng
  1,57°. Sai mà trông như "chữ hơi lệch", nên rất dễ lọt. Inspector cũng in
  `1.5708°`. Nay cả hai đi qua `degrees()`.
- **Nội dung block bị cắt mà màn hình vẫn báo đủ (P1).** Plugin phát
  `block_geometry_truncated` / `block_nesting_too_deep` nhưng **không** bật
  `truncated` ở cấp trên cùng, và một định nghĩa còn sót một phần vẫn được xếp
  là "hình thật". Nay đọc cả hai mã và nói ra.
- **Bộ lọc layer không chạm tới hình bên trong block.** 97% hình nằm trong định
  nghĩa block, mỗi hình mang layer riêng — tắt một layer chỉ ẩn được phần ở cấp
  trên cùng, và layer chỉ xuất hiện bên trong block thì không có trong bảng.
  Nay lọc và đếm đệ quy, kèm **quy tắc layer `0` của AutoCAD**: đối tượng trên
  layer `0` bên trong block kế thừa layer của lần chèn.
- **Đọc lại không trả khung nhìn về.** `box` cũ đè lên khung vừa khít mới tính,
  nên đổi bản vẽ là thấy canvas trống ở một góc toạ độ không còn gì.

### Changed — dựng block bằng `<defs>` + `<use>`

Bung thẳng nội dung block tại mỗi lần chèn cho **38.223 node SVG** trên bản vẽ
as-built và **treo cả tab** — đã thử và đã treo thật. Định nghĩa dựng một lần
trong `<defs>`, mỗi lần chèn là một `<use>`: còn **10.737 node**.

Được thêm đúng hành vi chọn: nội dung `<use>` nằm trong shadow tree nên
`event.target` luôn là lần chèn — bấm vào đâu trong block cũng chọn block, đúng
như AutoCAD. Khoá của `<defs>` phải gồm cả layer của lần chèn, vì quy tắc layer
`0` làm cùng một block chèn trên hai layer có thể bị ẩn khác nhau.

### Fixed — khung xem báo "đang hiện" cả những đối tượng nằm ngoài màn hình

`bounds` của plugin gom từ `getGeomExtents()`, mà block rỗng thì hàm đó báo
không hợp lệ — 5 block bị đặt lạc cách bản vẽ hàng triệu đơn vị không nằm trong
khung. Khung xem fit theo `bounds` rồi vẫn ghi "224/224 đối tượng đang hiện".
Nay đếm và nói ra, kèm nút "Thu hết".

 Giai đoạn 5 (backend): plugin xuất hình học 2D

Việc backend gỡ chặn cho `/workspace`. **Đã chạy thật trên bản vẽ as-built của
dự án**, không phải chỉ biên dịch được.

### Added — `geometry.req` → `geometry.json`

`objectarx/mepbridge.cpp`: `writeGeometry()` + `entityGeometryJson()`.
`apps/daemon`: `buildGeometryRequest()`, `requestGeometry()`,
`GET /api/acad/geometry?target&space&layer&maxEntities`.

Tách khỏi `drawing-info` vì snapshot đó đã 350 KB khi **chưa có toạ độ nào**;
nhét hình học vào là bắt mọi màn hình chỉ cần số đếm phải kéo theo cả bản vẽ.

Xuất toạ độ thật cho `LINE`, `LWPOLYLINE` (**kèm `bulge`**, không thì ống cong
thành ống thẳng), `CIRCLE`, `ARC`, `POINT`, `INSERT` (vị trí + xoay + tỉ lệ +
tên block), `TEXT`/`MTEXT`. Kiểu khác lùi về hình bao.

**Mọi đối tượng gần đúng đều mang cờ `a:1` kèm `aw` nói rõ vì sao** —
`bounding-box` hay `mline-centerline`. Không có cờ đó thì canvas vẽ một dãy hình
hộp và người dùng tin đó là bản vẽ.

### Fixed — ba lỗi chỉ lộ ra khi chạy thật

- **TEXT đè mất handle.** Chiều cao chữ dùng khoá `"h"`, trùng khoá handle ở cấp
  trên; `JSON.parse` lấy cái sau nên đối tượng **mất danh tính** — hỏng đúng chỗ
  hit-test phải chạy. Đổi thành `th`/`txt`, và `s` của INSERT thành `sc`.
- **MLINE — tức là ỐNG — ra hình hộp.** Bản vẽ thật có 41 MLINE trên layer
  `P-ThoatRua`. Hình bao cho ra một dãy chữ nhật đúng chỗ ống chạy: vô dụng để
  nhìn, vô dụng để bắt điểm. Nay xuất **tim ống** (`aw:"mline-centerline"`).
  Số đối tượng chỉ có hình bao giảm 103 → 62.
- **`bounds` trộn Model với layout giấy.** Toạ độ giấy tính bằng mm trên tờ
  giấy, model ở toạ độ cách gốc hàng triệu đơn vị — gộp lại cho ra một khung vô
  nghĩa. Nay `bounds` là **map theo từng space**, kèm `spaces` đếm đối tượng mỗi
  space để giao diện dựng bộ chọn space mà không cần gọi thêm lần nữa.

### Fixed — hai lỗi nghiêm trọng từ Codex review (P1 ×2)

- **Quét hình học không khoá tài liệu.** `writeDrawingInfo()` lấy `AcAp::kRead`
  trước khi đọc database; `writeGeometry()` thì không. Đọc database của một tài
  liệu không phải tài liệu hiện hành mà không khoá là đúng thứ ObjectARX cấm —
  một lệnh chạy song song có thể làm lượt quét hỏng, hoặc làm **AutoCAD mất ổn
  định**. Nay khoá trước khi quét và mở khoá ở mọi đường ra.
- **Query xấu có thể giết daemon.** `buildGeometryRequest()` ném khi tham số
  chứa xuống dòng — đó là chặn tiêm dòng, làm đúng. Nhưng Express 4 **không**
  bắt lỗi của handler async, nên nó thoát ra thành unhandled rejection: một
  query xấu hạ được cả dịch vụ. Nay trả 400. Đã thử thật: `space` chứa xuống
  dòng → HTTP 400, `/api/health` vẫn 200.

  Vòng review sau chỉ ra bản vá đầu bắt **quá rộng**: một thư mục bridge không
  ghi được cũng thành "client gửi sai" — giấu sự cố hạ tầng dưới nhãn lỗi người
  dùng, và giám sát không thấy gì. Nay `GeometryRequestError` tách riêng: đầu vào
  sai → 400, sự cố vận hành → 500.

### Technical — kiểm lại toàn bộ sau khi nạp bản plugin cuối

Khởi động lại AutoCAD để nạp bản build có khoá tài liệu, trần quét, và các bản
sửa phép chiếu, rồi chạy lại trên bản vẽ as-built: 258 đối tượng, `bounds` theo
từng space, 103 đối tượng `a:1` (62 hình bao + 41 tim ống MLINE), handle duy
nhất trên cả 258, mọi entity có layer, `h` (handle) và `th` (chiều cao chữ) tách
bạch. Chặn tiêm dòng trả đúng 400 `invalid_geometry_request`.

Bản kẹp `maxEntities` chỉ có tác dụng **sau khi khởi động lại daemon** — tiến
trình đang chạy giữ code cũ, và lần kiểm đầu tiên đã cho ra kết quả đảo ngược
đúng như hành vi cũ (`1e21` → 1 đối tượng, `0.5` → 20.000). Sau khi khởi động
lại: `1e21` → kẹp về 100.000 trả đủ 258; `0.5` → sàn về 1 kèm `truncated`.

**Hai thứ chưa kiểm được trên bản vẽ này:** trần quét 200.000 (bản vẽ chỉ có 258
đối tượng) và bản sửa polyline khép kín (bản vẽ không có polyline có bulge trên
mặt phẳng nghiêng — đếm được 0 trường hợp `projected-bulge`). Cả hai vẫn là sửa
đúng theo mã nguồn, nhưng chưa có bằng chứng chạy thật.

### Fixed — polyline khép kín bị mở toác khi bulge bị chiếu phẳng (Codex review)

Cờ `approx` gánh hai lý do khác nhau — cắt bớt đỉnh, và bulge không tả được sau
khi chiếu — nhưng chỉ **cắt đỉnh** mới phá tính khép kín. Một polyline khép kín
có bulge trên mặt phẳng nghiêng vẫn còn **đủ mọi đỉnh**, nên bỏ `closed` ở đó là
tự tay xoá mất một cạnh có thật (cạnh cuối về đỉnh đầu). Nay điều kiện là
`truncated`, không phải `approx`.

### Fixed — bộ lọc layer không khớp gì vẫn quét cả bản vẽ (Codex review, P1)

`maxEntities` chỉ đếm thứ **đã xuất**. Một bộ lọc layer không khớp gì — gõ sai
tên chẳng hạn — sẽ không bao giờ chạm trần đó, nên plugin duyệt **toàn bộ** bản
vẽ trên main thread dù người gọi xin đúng 1 đối tượng. Nay có trần **quét** riêng
(200.000) kèm cảnh báo `geometry_scan_cap_reached` — tách khỏi
`geometry_truncated` vì hai nguyên nhân rất khác nhau: chạm trần xuất nghĩa là
còn đối tượng khớp chưa gửi; chạm trần quét nghĩa là còn phần bản vẽ chưa nhìn tới.

### Fixed — thiếu trần tổng cho payload (Codex review, P1)

Trần số đối tượng (100.000) và trần đỉnh mỗi polyline (4.000) nhân với nhau ra
**400 triệu toạ độ** nối chuỗi trên **main thread** của AutoCAD — đủ để ngốn vài
GB và làm đông cứng hoặc giết AutoCAD. Trần số đối tượng một mình không chặn
được bản vẽ ít đối tượng nhưng mỗi đối tượng cực dày. Nay có thêm trần tổng
24 MB; chạm trần thì dừng và bật `truncated` như mọi đường cắt khác.

### Fixed — polyline nghiêng trả sai toạ độ (Codex review)

Overload `getPointAt(i, AcGePoint2d&)` trả về toạ độ **OCS của polyline**.
Polyline có pháp tuyến khác mặc định sẽ được vẽ **sai vị trí**, mà lại không mang
cờ `a:1` vì mọi thứ khác trong phản hồi đều là toạ độ thế giới. Nay dùng overload
3D (trả WCS) rồi bỏ Z.

### Fixed — cả một HỌ lỗi "chiếu xuống XY" (Codex review, 3 vòng)

Cùng một sai lầm lặp ở bốn chỗ, và Codex bắt từng cái một qua ba vòng trước khi
tôi nhận ra nó là một họ: **mọi đại lượng đo TRONG mặt phẳng của đối tượng đều
sai sau khi bỏ Z** nếu pháp tuyến không phải `+Z`.

- **Vòng tròn / cung** → hình chiếu là elip; `-Z` còn đảo chiều cung.
- **`bulge` của polyline** → mỗi cung thành elip mà không bulge nào tả được. Đỉnh
  vẫn là WCS nên vị trí đúng; chỉ độ cong là không tả được, nên bỏ `bulge` và
  đánh dấu `aw:"projected-bulge"`.
- **Góc xoay của TEXT/MTEXT** → `aw:"projected-rotation"`.
- **Phép biến đổi của INSERT** (`rotation`, `scaleFactors` đo trong mặt phẳng
  chèn) → `aw:"projected-transform"`.

Một lỗi quy trình của tôi lộ ra giữa loạt này: bản vá bulge vòng đầu **không vào
file** vì tôi thay chuỗi mà không assert, và tôi báo đã sửa. Codex bắt lại ở vòng
sau. Nay mọi lần thay đều có assert.

Nay có một phép kiểm dùng chung `planarXY()` thay vì bốn bản kiểm rời.

Chi tiết vòng tròn/cung: chỉ giữ được hình khi mặt phẳng của nó song song XY. Pháp tuyến nghiêng thì hình
chiếu xuống XY là một **elip**, và góc đầu/cuối đo trong mặt phẳng riêng của đối
tượng — xuất `center`+`radius` cho ra một hình **sai** mà lại **không** mang cờ
`a:1`. Nay chỉ xuất chính xác khi pháp tuyến song song trục Z; còn lại rơi xuống
hình bao. Riêng CUNG còn phải đúng chiều: pháp tuyến `-Z` vẫn song song nhưng góc
đo ngược, cung sẽ vẽ sai phía.

### Fixed — hai lỗi về giới hạn và cờ cắt bớt (Codex review)

- **`maxEntities: 1e21` biến thành quét 1 đối tượng.** `String(1e21)` cho ra
  `"1e+21"`, mà plugin đọc bằng `atoll` nên chỉ lấy được `1` — xin cả bản vẽ lại
  nhận đúng một đối tượng. Nay kẹp về trần 100.000 **trước khi** tuần tự hoá.
- **`maxEntities: 0.5` biến thành quét 20.000.** Làm tròn xuống cho ra `0`, mà
  plugin coi giá trị không dương là "không có giới hạn hợp lệ" rồi dùng mặc định
  — một yêu cầu cố ý giới hạn thật chặt lại kích hoạt một lượt quét lớn. Nay sàn
  xuống ít nhất 1.
- **Báo `truncated` khi không bỏ sót gì.** Kiểm trần **trước** khi lọc layer,
  nên chạm trần rồi thì mọi đối tượng còn lại đều làm cờ bật lên — kể cả khi
  chúng thuộc layer khác và đằng nào cũng không được xuất. Giao diện được yêu
  cầu hiện cờ này lên, nên báo nhầm là nói dối người dùng. Nay chỉ bật khi thật
  sự có đối tượng **đáng lẽ được xuất** bị bỏ.

### Fixed — ba lỗi nữa từ Codex review

Không lỗi nào kịp gây hại trong lượt kiểm (text dài nhất 67 byte, polyline nhiều
đỉnh nhất 97, không có truncation), nên số liệu xác minh bên dưới vẫn đứng.

- **Cắt text giữa một ký tự UTF-8.** Cắt đúng 120 byte có thể rơi vào giữa ký tự
  nhiều byte và sinh UTF-8 hỏng. Bản vẽ Việt Nam đầy nhãn tiếng Việt, nên đây là
  đường chắc chắn gặp. Nay lùi về ranh giới ký tự.
- **Polyline bị cắt bớt đỉnh vẫn báo `closed:true`.** Renderer sẽ kẻ một đoạn giả
  từ đỉnh cuối về đỉnh đầu, có thể cắt ngang cả bản vẽ. (Vòng review sau bắt
  đúng lỗi ấy ở nhánh **MLINE** — nơi tôi đã bỏ sót vì `approx` ở đó luôn bật
  nên không tái dùng được phép kiểm cũ.)
- **Chạm trần `maxEntities` là mất luôn các layout sau.** Vòng lặp dừng hẳn nên
  `spaces`/`bounds` thiếu mọi layout chưa quét — mà giao diện lại dùng đúng nó để
  dựng bộ chọn space. Nay thêm `layouts`: tên **mọi** layout, kể cả chưa quét.
  Đọc tên layout thì rẻ; quét đối tượng mới đắt.

### Verified — trên `ABD_He thong thoat nuoc tang 1`

| | |
|---|---|
| quét / xuất | 259 / 258 đối tượng, 1 bỏ qua (không có hình học) |
| gần đúng | 62 hình bao + 41 tim ống |
| `bounds` Model | 98.545 × 92.400 đơn vị |
| `bounds` layout `01` | 420 × 297 — đúng khổ A3 |
| thời gian | dưới 1 giây |

### Technical

- Giới hạn hai phía: `maxEntities` mặc định 20.000, plugin cắt cứng 100.000;
  4.000 đỉnh mỗi polyline; 120 ký tự mỗi chuỗi text. Plugin chạy trên **main
  thread** của AutoCAD — không chặn thì người dùng thấy AutoCAD đơ.
- Chỉ xuất X/Y (`projection:"xy"`). Bản vẽ MEP mặt bằng là 2D; giữ Z nhân đôi
  payload mà không ai dùng.
- 11 assertion mới ở `test-bridge-contract.mjs`: request nhiều dòng nên phải
  chặn tiêm dòng — một `space` chứa `\n` có thể chèn thêm `maxEntities=99999`
  vào chính request mà người gọi cố ý giới hạn.
- Bản plugin cũ đã sao lưu trước khi ghi đè
  (`Acad-Bridge.bundle.bak-20260810-154936`).

---

## 2026-08-10 — Giai đoạn 4 XONG: duyệt manifest ngay trên `/library/lisp`

Mảnh cuối của giai đoạn 4. `/library/lisp` nay duyệt được, và **không cần agent**.

### Added — duyệt từ manifest sẵn có

`features/lisp/{approval.ts,ApprovalDialog.tsx,fingerprint.ts}`.

Giả định tôi mang theo suốt hai lượt trước là **sai**: tôi tưởng phải có đề xuất
của agent mới duyệt được, nên coi việc này bị chặn bởi "đề xuất lưu ở đâu". Đọc
`validateApprovedManifest()` thì manifest được duyệt chỉ bắt buộc **một câu tóm
tắt**; `commands`/`publicFunctions`/`dependencies` daemon đã phân tích tĩnh sẵn
trong `inferred`. Và chữ ký Ed25519 xác nhận **một con người đã đọc source**,
không xác nhận rằng một agent đã chạy — nên đòi phải có agent là thêm một điều
kiện mà thiết kế bảo mật không hề đòi.

Nên hộp duyệt làm đúng thứ chữ ký nói: **hiện source ra**, cho đối chiếu với
phân tích tĩnh của daemon, bắt viết một câu tóm tắt, bắt tích xác nhận đã đọc.

**`analysisCoverage` được suy ra, không cho khai.** Máy chủ trả source nguyên
vẹn hoặc không trả gì (quá 4 MB → `source_too_large`) chứ không cắt dở, nên "đã
đọc bao nhiêu" là hệ quả của việc có source hay không. Cho người dùng tự chọn
`full-source` khi màn hình không hiện được dòng nào là mở đường cho một lời khai
sai nằm vĩnh viễn trong manifest. Không đọc được source thì có thêm ô xác nhận
thứ hai — đúng thứ máy chủ đòi (`acknowledgedIncomplete`).

Không dùng `ConfirmSheet`: ba cảnh báo của nó nói về ghi vào bản vẽ hoặc đổi
phiên AutoCAD, còn duyệt thì ghi vào thư viện.

### Changed — chỉ còn MỘT chỗ băm manifest

`canonicalJson` + phép băm chuyển từ `app/lispProposal.ts` sang
`features/lisp/fingerprint.ts`; chat legacy import lại từ đó.

Đây là chỗ dễ hỏng ngầm nhất của cả luồng: khi nhận `PUT /:id/manifest`, máy chủ
**tự tính lại** `sha256(stableJson({resourceId, baseRevision, manifest}))` và từ
chối nếu khác giá trị đã dùng để xin token. Hai bản băm song song lệch nhau một
dấu phẩy là mọi lượt duyệt trả 403 — mà thông điệp lại nói về "token thiếu hoặc
hết hạn", sai hướng hoàn toàn. Bất biến khoá: đúng **một** chỗ gọi
`crypto.subtle.digest`, và `lispProposal.ts` không được tự băm.

### Changed — bỏ hẳn `.countdown` 2 phút

Mẫu vẽ hai bước "Ký duyệt" rồi đếm ngược token. Ở đây ký → xin token → ghi chạy
liền trong một lời gọi, token sống vài mili-giây. Dựng đồng hồ đếm ngược cho
quãng đó là vẽ một cơ chế người dùng không bao giờ chạm tới, đổi lại thêm một
trạng thái hỏng có thật: token hết hạn giữa hai cú bấm.

### Fixed — duyệt lại đánh rơi manifest đang có (Codex review, P1)

Hộp duyệt dựng payload từ `baseManifest` — sidecar **gốc**. Manifest đang có
hiệu lực là `resource.manifest` (đã gộp override). Bấm "Duyệt lại" vì thế dựng
lại từ dữ liệu cũ và **âm thầm xoá** những trường đã có: `guardrails`,
`examples`, mọi phần đã sửa trước đó. Mất dữ liệu, không phải mất tiện nghi.

### Fixed — file rỗng bị coi là không đọc được (Codex review, P2)

`coverageFor` đòi `source.length > 0`. Một file `.lsp` rỗng là file hợp lệ, và
người duyệt đã nhìn thấy trọn vẹn nội dung của nó — nhưng giao diện lại bảo
"không đọc được source", bắt tích một ô xác nhận sai sự thật, rồi ghi
`metadata-only` vào manifest vĩnh viễn. Nay chỉ `null` mới là không đọc được.

### Fixed — thông báo duyệt mượn nhầm tiêu đề của nạp

Lượt duyệt thành công hiện "Đã gửi lệnh nạp" — không có lệnh nạp nào được gửi.
Cùng loại lỗi đã sửa một lần ở `/library/blocks`. Nay thông báo mang `kind`.

### Fixed — ghi chú cuối pane nói sai

Vẫn ghi "chưa dựng ở đây: duyệt manifest" trong khi nút Duyệt nằm ngay bên trên.

### Technical

- 11 bất biến mới ở `test-contract.mjs`.
- Kiểm mắt cả hai nhánh: đọc được source (hiện mã, một ô xác nhận, ký xong báo
  "Đã duyệt") và không đọc được (cảnh báo + **hai** ô xác nhận).
- Nút Duyệt **luôn hiện**, kể cả khi không ký được — ẩn đi thì người dùng trong
  trình duyệt không biết có việc này; hiện kèm lý do thì họ biết mở ở đâu.

---

## 2026-08-10 — D7: duyệt LISP theo môi trường đang chạy

### Fixed — banner nói sai khi mở trong app desktop

Bản trước viết cứng "Duyệt script là thao tác của app desktop, **không phải của
web**". Câu đó đúng trong trình duyệt và **sai** khi chính trang này được app
desktop mở — nơi `window.acadStudio.signReview` có thật. Một màn hình dựng lên
để không nói sai về khả năng của mình lại nói sai về chính mình.

Nay `features/lisp/reviewSigner.ts` đọc môi trường và banner kết luận theo đó.

**Ba trạng thái, không phải hai.** `unknown` tồn tại vì lần render đầu chạy lúc
prerender rồi mới hydrate: mặc định "không có bộ ký" sẽ hiện một câu sai trong
khoảnh khắc đầu ở app desktop. Lúc chưa biết thì chỉ nói phần luôn đúng.

**Có bộ ký mới là nửa điều kiện.** Nửa còn lại là `ACAD_REVIEW_PUBLIC_KEY` của
daemon — chỉ được đặt khi daemon do app desktop khởi chạy, và client không nhìn
thấy biến môi trường của daemon. Giao diện nói đúng nửa mình biết chứ không kết
luận thay; daemon chạy tay thì vẫn 403.

### Technical

- 4 bất biến mới ở `test-contract.mjs`.
- Kiểm cả **hai** nhánh trên Chrome: không có bộ ký → "Cửa sổ này không có bộ
  ký…"; cài `window.acadStudio.signReview` rồi điều hướng mềm quay lại → "Duyệt
  được từ đây — nhưng còn một điều kiện nữa ở phía daemon."
- Sửa một hiểu nhầm của chính tôi ghi ở phần trước: rail **có** điều hướng mềm
  (`next/link`). Những lần "vá `window.fetch` không sống qua chuyển trang" trước
  đây là do bấm trước khi hydrate xong, không phải do tải lại cả trang.
- Thanh trạng thái hiện "AutoCAD chưa chạy" trong khoảnh khắc sau khi chuyển
  trang rồi mới về "đã nối". Đây là mặc định **fail-closed** trong lúc chờ lượt
  poll đầu tiên — đúng ý đồ với một cờ dùng để khoá lệnh ghi, không phải lỗi.

---

## 2026-08-10 — Giai đoạn 4 (phần 7): nạp script LISP · thư mục gốc

Hai lệnh ghi của thư viện LISP mà **web làm được**. Duyệt manifest thì không —
xem phần 6 và mục còn treo trong `ROADMAP.md`.

### Added — nạp vào phiên AutoCAD

`features/lisp/{actions.ts,LoadDialog.tsx,useLispDetail.ts}` →
`POST /api/acad/lisp/:id/load`.

**`ConfirmSheet` có chế độ thứ ba: `session`.** Nạp LISP không ghi vào bản vẽ,
nên chế độ `immediate` là sai ở đúng một câu — nó bảo người dùng gõ `UNDO` để
hoàn tác, mà `UNDO` **không** gỡ được mã đã nạp. Chỉ một đường thoát không tồn
tại còn tệ hơn không chỉ. Chế độ mới nói: phiên chỉ trở lại như cũ khi đóng
AutoCAD.

Đọc `buildLibraryLoadLisp` thì "nạp" là **ba** thay đổi, không phải một, và hộp
thoại nói đủ cả ba:

1. `(load ...)` **thực thi** file — biểu thức ở mức cao nhất chạy ngay, kể cả
   biểu thức sửa bản vẽ;
2. thư mục được thêm vào support path (`ACAD`) của phiên;
3. thư mục được thêm vào **`TRUSTEDPATHS`** — từ đó AutoCAD tin mã ở đó mà không
   hỏi `SECURELOAD` nữa.

Nạp **hỏng** thì LISP khôi phục cả (2) và (3); nạp **xong** thì không — chúng
nằm lại tới khi đóng AutoCAD. Giấu (3) là giấu một thay đổi về bảo mật.

Guardstrip ở đây là guardstrip **thật**: `loadable` và `reviewStatus` đọc từ
chính danh mục mà máy chủ sẽ đọc lại, nên tick/chéo là kết luận có cơ sở. Riêng
hàng **phụ thuộc** để `pending` — danh mục chỉ trả tên tham chiếu, còn phân giải
tên đó ra tài nguyên nào là logic của máy chủ.

`useLispDetail` tồn tại vì một lý do hẹp: danh mục **không** trả
`manifestRevision`, mà mọi lệnh ghi đều đòi nó làm `baseRevision`. Đổi tài
nguyên là xoá revision cũ ngay — giữ lại thì nút Nạp có thể gửi revision của tài
nguyên trước đó, và 409 nhận được sẽ nói một lý do không dính gì tới sự thật.

### Added — thư mục gốc

`features/lisp/RootsDialog.tsx` → `POST /roots` và `POST /roots/import-autocad`.

Khác nguồn của thư viện block ở hai chỗ dễ nhầm: đây là **thư mục** (máy chủ từ
chối nếu là file), và thêm vào **có** tác dụng — lượt quét sau sẽ đọc nó. Chặn
trước ba thứ đáng tin vì chúng lặp lại đúng điều kiện của `addRoot()`: rỗng,
`~` (máy chủ không nở dấu ngã), và gốc hệ thống.

"Lấy support path từ AutoCAD" là một **job LISP** đọc `ACADPREFIX`, không phải
phép đọc cấu hình — nên cần AutoCAD mở và plugin trả lời, và nó dùng
`WriteButton` để khoá thật khi không ghi được.

### Changed — `guards.ts` chuyển sang `lib/daemon/`

Script trích mã quét **toàn bộ** daemon, nên bản đồ mã-lỗi → câu chữ nói cho cả
app chứ không riêng hàng chờ hai pha. Thư viện LISP là nơi gọi thứ hai; để nó
trong `features/staged-ops/` nghĩa là feature khác phải import chéo feature —
hoặc tự viết lại câu chữ cho cùng một mã, rồi hai màn hình giải thích cùng một
lỗi bằng hai cách.

Vài mã của daemon mang **tham số** (`review_required:stale`,
`dependency_review_required:<id>:<ref>`) nên `guards.ts` tra không ra. Thêm
`lispFailureText()` dịch chúng; có test cho cả ca tham chiếu chứa dấu hai chấm
(`C:/lisp/common.lsp`) mà một `split(":")` ngây thơ sẽ cắt cụt.

### Fixed — hộp thoại tự mâu thuẫn, và 409 lại thành ngõ cụt (Codex review, P2 ×2)

- **`ConfirmSheet` chế độ `session` vẫn in câu "Ghi vào bản vẽ đang hoạt động
  trong AutoCAD"** ngay dưới cảnh báo "không ghi vào bản vẽ". Hai câu chọi nhau
  trong đúng một hộp thoại người dùng đang cân nhắc chuyện bảo mật. Nay chế độ
  này nói: *áp lên phiên AutoCAD đang chạy, không bản vẽ nào bị ghi*.
- **`useLispDetail` chỉ bám `[daemon, id]`**, nên `manifestRevision` không bao
  giờ đọc lại khi vẫn đang chọn cùng một tài nguyên. Một thay đổi từ bên ngoài
  là mọi lượt nạp sau đó ăn `revision_conflict` **mãi**, kể cả sau khi tải lại
  danh mục — không có đường thoát nào trên trang ngoài chọn sang tài nguyên khác
  rồi chọn lại. Nay `useLispLibrary` phát `version` tăng theo mỗi lượt đọc, và
  chi tiết đọc lại theo nó.

### Technical

- `state: "sent"` **không** phải "đã nạp xong" — máy chủ chỉ chờ AutoCAD trong
  15 giây. Thông báo nói đúng điều đó thay vì báo thành công.
- 10 bất biến mới ở `test-contract.mjs`; test 43 → **47**.
- **Đã kiểm bằng mắt** (bổ sung sau khi gỡ được sự cố Chrome, xem mục dưới):
  hộp nạp hiện đủ ba cảnh báo và câu "không bản vẽ nào bị ghi"; guardstrip cho
  dấu **đạt/không đạt thật** trên `loadable` và `reviewStatus`, hàng phụ thuộc
  để nét đứt; tài nguyên `stale` bị chặn kèm lý do, tài nguyên đã duyệt nạp
  trọn vòng. Hộp thư mục gốc: chặn `~`, thêm tay (đếm 2 → 3, nhãn tự lấy tên
  thư mục), lấy support path từ AutoCAD (đếm → 4, báo "bỏ qua 2 đường dẫn").
  Kiểm lại `/library/blocks` sau khi sửa `ConfirmSheet`: chế độ `immediate`
  không hồi quy.

- **Sự cố Chrome hoá ra không phải lỗi extension.** Có **hai** Chrome cùng kết
  nối, nên lệnh tự động đi vào cửa sổ khác với cửa sổ đang mở — mọi thao tác
  báo "error page" trong khi `curl` vẫn 200. Lần sau gặp triệu chứng này, kiểm
  số trình duyệt đang kết nối trước khi nghi ngờ dev server.

---

## 2026-08-10 — Giai đoạn 4 (phần 6): `/library/lisp` bản chỉ đọc

### Added

- `app/(shell)/library/lisp/page.tsx` — duyệt danh mục AutoLISP: tìm theo tên,
  **tên lệnh** hoặc đường dẫn; lọc theo trạng thái duyệt; pane chi tiết.
- `features/lisp/{model.ts,useLispLibrary.ts}` — chuẩn hoá + dịch mã của daemon
  sang tiếng Việt, hook đọc `GET /api/acad/lisp`.
- 15 test mới (`test-lisp-model.test.ts`); tổng 28 → **43**.

Màn hình gần như không cần CSS riêng — `.list`, `.listrow`, `.split`, `.detail`,
`.opstate` đã có sẵn trong design system.

### Added — nói ra thứ "Đã duyệt" đang giấu

Đọc `saveManifest()` mới thấy daemon **có lưu** bằng chứng của lượt duyệt trong
`manifest.review`: phạm vi source người duyệt đọc được (`analysisCoverage`), có
xác nhận biết mình đọc thiếu hay không, và **hash của source lúc duyệt**.

Không hiện ra thì "Đã duyệt" là một cái nhãn rỗng. Nay pane chi tiết nói:

- **Phạm vi đã đọc lúc duyệt** — và cảnh báo khi nó không phải `full-source`.
- **File đã đổi sau khi duyệt**, kèm hash lúc duyệt so với hash hiện tại.

Một chi tiết dễ nói dối, đã khoá bằng test: bản duyệt cũ không ghi phạm vi thì
rơi về `manual-review`, **không** rơi về `full-source`. Mặc định sai ở đây sẽ
biến một bản duyệt không kiểm chứng được thành một bản duyệt đáng tin.

### Changed — nói thẳng vì sao web không duyệt được

Đọc `lispLibrary.ts` + `apps/desktop/main.js`: `POST /:id/approval-challenge`
đòi chữ ký **Ed25519**; khoá riêng nằm trong tiến trình chính của app desktop và
chỉ với tới được qua `window.acadStudio.signReview`; daemon kiểm bằng
`ACAD_REVIEW_PUBLIC_KEY`, biến này **chỉ được đặt khi daemon do app desktop khởi
chạy**. Daemon chạy tay thì không ai duyệt được, kể cả app desktop.

Nên màn hình mở đầu bằng một banner nói rõ điều đó, thay vì vẽ nút "Duyệt" rồi
để nó ném lỗi. Bất biến chặn lại: `lisp/page.tsx` không được chứa
`approval-challenge`, `signReview` hay `approvalToken`.

### Fixed — nút "Quét lại đĩa" không khoá lại (Codex review, P2)

`loading` chỉ đúng ở lần đọc đầu và không bao giờ bật lại, nên sau đó nút vẫn mở
và bấm chồng được nhiều lượt quét đĩa — thao tác đắt nhất màn này.

Sửa thẳng bằng `setLoading(true)` thì lại xoá trắng danh sách mỗi lần làm mới,
nên tách hai khái niệm: `loading` = **chưa có gì để hiện** (lần đầu),
`refreshing` = **đang đọc lại nhưng vẫn có dữ liệu cũ**. Nút dùng `refreshing`,
danh sách dùng `loading`. Khoá bằng hai bất biến.

### Technical

- Mã của daemon (`reviewStatus`, `kind`, `warnings[]`, `loadBlockReason`,
  `analysisCoverage`) đều có nhãn tiếng Việt, và **mã lạ trả lại nguyên văn**
  thay vì thành ô trống. Test khoá đủ 5 mã cảnh báo và 4 lý do chặn nạp mà
  daemon đang phát.
- Chuẩn hoá fail-closed: `reviewStatus` lạ → `unreviewed`; `readable`/`loadable`
  chỉ `true` khi đúng boolean `true`.
- `useLispLibrary` mang sẵn số thứ tự lượt đọc như `useBlockLibrary` — ở đây còn
  cần hơn vì `reload(true)` bắt máy chủ quét lại đĩa, chậm hơn hẳn.
- `truncated` được nói ra: im lặng nghĩa là người dùng kết luận "không có script
  nào tên X" trong khi thật ra là chưa quét tới.
- 6 bất biến mới ở `test-contract.mjs`; `nav.ts` đánh dấu `/library/lisp` đã dựng.
- **Kiểm bằng mắt:** danh sách, bộ lọc, pane chi tiết của bản `.vlx` (không đọc
  được source · không nạp được · 2 cảnh báo có nhãn). Phần **bằng chứng duyệt**
  đã xem lại sau đó: "Phạm vi đã đọc lúc duyệt: Đọc toàn bộ source" và cảnh báo
  **"File đã đổi sau khi duyệt"** kèm hash lúc duyệt so với hash hiện tại.

---

## 2026-08-10 — Giai đoạn 4 (phần 5): tạo block từ bộ chọn · nguồn thư viện

Hai lệnh ghi cuối của thư viện block. Với phần này, `/library/blocks` làm được
mọi việc màn hình cũ làm, trừ quét bản vẽ vào danh mục.

### Added — tạo block từ bộ chọn

`features/blocks/CreateBlockDialog.tsx` + `createBlockFromSelection()` →
`POST /api/acad/blocks/create`.

Dựng **bên trong** `ConfirmSheet` chứ không phải một Modal riêng: đây là lệnh ghi
vào bản vẽ nên phải mang đúng ba cảnh báo bắt buộc, và cách chắc chắn nhất để
không viết lại chúng lệch đi là dùng lại chính component đó, đưa form vào làm
`children`. `ConfirmSheet` nhận thêm `blocked` — *lý do* chưa ghi được, không
phải cờ boolean, vì một nút ghi bị khoá mà không nói vì sao là một ngõ cụt.

**Đây là lệnh ghi duy nhất trong app lấy đi thứ đang có trên bản vẽ.** Đọc
`buildCreateBlockLisp`: nó chạy `-BLOCK`, lệnh gom các đối tượng đang chọn thành
định nghĩa rồi **xoá chúng khỏi bản vẽ**. Hộp thoại nói thẳng điều đó và chỉ
đường lấy lại (`OOPS`), thay vì để người dùng phát hiện sau khi hình biến mất.

Guardstrip liệt kê ba điều kiện, tất cả để `data-pass="pending"` (vòng nét đứt).
Đây là lựa chọn có chủ ý: app **không kiểm được** chúng, nên vẽ dấu tick hay dấu
chéo là bịa ra một phép kiểm không tồn tại. Riêng bộ chọn, màn hình cố ý **không**
hiện số đối tượng đang chọn tuy `GET /selection/current` đọc được — con số ấy cũ
đi ngay khi người dùng chuyển sang AutoCAD, mà chuyển sang AutoCAD lại đúng là
việc họ phải làm.

Chặn trước hai thứ **đáng tin**: tên sai định dạng, và tên trùng trong thư viện
(so không phân biệt hoa thường, trên đúng danh mục mà máy chủ sẽ so).

### Added — nguồn thư viện

`features/blocks/{sources.ts,SourcesDialog.tsx}` + ô **Nguồn DWG** trong form
metadata (`sourceId`).

### Changed — bộ mẫu mô tả sai việc này, và đây là chỗ sửa lại

Mẫu gọi nguồn là "thư mục nguồn" và có nút "Quét lại nguồn". Đọc daemon thì:

- `POST /blocks/sources` **chỉ ghi đường dẫn** vào danh mục — không quét, không
  nhập định nghĩa nào;
- `POST /blocks/scan` **không quét nguồn**, nó quét **bản vẽ đang mở**;
- nguồn chỉ có tác dụng ở đúng một chỗ: `linkedDwgSource()` khi chèn một block mà
  bản vẽ đích chưa có định nghĩa — và chỉ với **file `.dwg`** có thật.

Nên màn hình nói đúng thứ đang xảy ra: nguồn là **một file**, thêm nguồn không
quét gì, và nó chỉ có tác dụng khi một định nghĩa trỏ vào nó. Nguồn `xtp`/`image`
hiện kèm nhãn "không chèn được", cả ở danh sách lẫn ô chọn.

Chặn `~` ngay tại chỗ: `linkedDwgSource()` gọi thẳng `existsSync(path)` và không
có chỗ nào nở dấu ngã, nên `~/...` chắc chắn hỏng — nhưng chỉ hỏng lúc chèn, với
thông điệp "không tìm thấy source DWG" chẳng nhắc gì tới dấu ngã.

### Changed — `ConfirmSheet` chuyển sang `components/ui/`

`check-import-boundaries.mjs` chặn đúng lúc: `features/blocks/CreateBlockDialog`
import `features/staged-ops/ConfirmSheet` là feature import chéo feature. Cùng
lý do đã chuyển `WriteButton` trước đây — **mọi** màn hình có lệnh ghi đều cần
`ConfirmSheet`, kể cả lệnh một pha không đi qua hàng chờ, nên nó là hạ tầng dùng
chung chứ không thuộc `staged-ops`.

### Fixed — gỡ nguồn nhưng block vẫn còn liên kết (Codex review, P2)

Kiểu lỗi tệ nhất: giao diện nói một đằng, máy chủ làm một nẻo. Chọn “— không gán
nguồn —” chỉ gỡ `sourceId`, trong khi `linkedDwgSource()` **cố ý quay về**
`block.sourcePath` khi không có `sourceId`. Block vẫn nhập được từ file DWG cũ,
tuy form ghi rõ là không gán nguồn.

Nay gỡ nguồn là gỡ cả `sourcePath`. Và nếu một định nghĩa đang liên kết kiểu cũ
(trỏ thẳng tới file, không qua nguồn nào), form nói ra đường dẫn đó cùng cách gỡ
— thay vì hiện “không gán nguồn” rồi để người dùng tin là đã gỡ.

### Fixed — lượt tải lại về muộn đè lên trạng thái mới (Codex review, P2)

`applyServerEcho` đặt revision mới rồi `reload()` chạy song song, không xếp thứ
tự. Hai lệnh ghi liên tiếp là đủ hỏng: lượt tải lại của lệnh đầu có thể về **sau**
echo của lệnh sau, ghi đè revision mới bằng revision cũ, và lệnh kế tiếp ăn 409
dù không ai sửa gì. Nay mỗi lượt đọc mang số thứ tự và kết quả cũ bị bỏ; nhận
echo thì vô hiệu hoá mọi lượt đọc đang bay.

Đồng thời bỏ `setSources([])` ở nhánh lỗi. Lý do cũ ("nguồn chỉ là con số phụ")
hết đúng từ commit này: nguồn nay là ô **Nguồn DWG** trong form, nên xoá trắng vì
một lần đọc hỏng sẽ làm block đang gán nguồn hiện ra như chưa gán — rồi người
dùng lưu đè lên đúng liên kết đang có.

### Fixed — xung đột 409 tự gây ra sau mỗi lượt ghi (Codex review, P2)

`revision` chỉ được cập nhật khi `library.reload()` chạy xong, mà lời gọi đó bất
đồng bộ. Bấm ghi lần thứ hai trong quãng đó gửi `expectedRevision` cũ và ăn 409 —
không có ai sửa thư viện cả, xung đột hoàn toàn do app tự tạo.

Nay `useBlockLibrary` có `applyServerEcho()`: lấy revision mới thẳng từ phản hồi
của lệnh ghi, áp cho **cả bốn** đường ghi vào danh mục (`insert`/`sync`, lưu
metadata, thêm nguồn, tạo block). Vòng review sau chỉ ra rằng sửa mỗi hai đường
mới là chưa đủ: form sửa metadata tự ghim revision của bản nháp nên nó không tự
hỏng, nhưng `library.revision` mới là thứ **các lệnh ghi khác** dùng — lưu
metadata xong mở ngay hộp Nguồn và thêm một nguồn là ăn 409 oan. Khoá bằng một
bất biến đếm: đủ 4 chỗ áp echo.

### Fixed — thêm nguồn hỏng thì mất luôn đường dẫn vừa gõ (Codex review, P2)

Form xoá trắng ngay khi bấm, trước khi biết kết quả. Hỏng hay gặp nhất ở đây là
409, nên người dùng phải gõ lại một đường dẫn tuyệt đối dài chỉ vì máy chủ bảo
"tải lại rồi thử lại". Nay `onAdd` trả về `Promise<boolean>` và form chỉ xoá khi
máy chủ đã ghi.

### Technical

- `endpoints.blockCreate()`; `LibrarySourceKind` tách thành type có tên.
- 13 bất biến mới ở `test-contract.mjs`: hộp tạo block phải nói "xoá khỏi bản vẽ"
  và chỉ `OOPS`; không được dùng `data-pass="true|false"` cho điều kiện không
  kiểm được; màn nguồn phải nói "thêm nguồn không quét gì cả" và không được gọi
  nguồn là thư mục.
- `scripts/stub-daemon.mjs` thêm route `/blocks/create`, `POST /blocks/sources`,
  và cờ `NO_SELECTION=1` để dựng ca lỗi.
- Kiểm trên Chrome: thêm nguồn (đếm 2 → 3), `~` bị chặn, tạo block chạy trọn
  vòng và tự chọn định nghĩa mới, trùng tên `van_cong_dn80` vs `VAN_CONG_DN80`
  bị chặn, ô Nguồn DWG liệt kê 3 nguồn với `xtp` bị khoá.
- **Chưa kiểm được:** đường lỗi "bộ chọn rỗng" trên trình duyệt — dialog đóng/mở
  lệch nhịp với công cụ tự động. Nó dùng chung đúng component thông báo đã kiểm
  ở ca 409.

---

## 2026-08-10 — Giai đoạn 4 (phần 4): sửa metadata block

### Added

- `features/blocks/BlockMetadataForm.tsx` — form sửa metadata một định nghĩa:
  tên kỹ thuật, tên hiển thị, mô tả, layer mặc định, đơn vị, nhóm, thẻ, không
  gian cho phép. Nút Lưu chỉ bật khi **có thay đổi và dữ liệu hợp lệ**; nút bị
  khoá nói lý do qua `title`; có đường Hoàn tác về bản đang lưu.
- `saveBlockMetadata()` + `endpoints.block(base, id)` → `PUT /api/acad/blocks/:id`
  kèm `expectedRevision`.

### Changed — form này KHÔNG dùng `ConfirmSheet`

Nó ghi vào **thư viện**, không vào bản vẽ: không có AutoCAD nào bị chạm, không
có gì để `UNDO`, sửa lại là được. Mượn hộp cảnh báo không-hoàn-tác cho một việc
rút lại được sẽ làm nhẹ đi cảnh báo ở đúng hai chỗ thật sự không rút lại được
(`insert`, `sync`). Đã khoá bằng bất biến: `BlockMetadataForm.tsx` không được
chứa `ConfirmSheet` hay chữ "không hoàn tác".

### Changed — validate dùng chung với panel cũ

`TECHNICAL_NAME_PATTERN` và `validateBlockDraft()` chuyển từ
`app/BlockLibraryPanel.tsx` sang `features/blocks/model.ts`; panel cũ nay import
lại (3 call site). Hai màn hình chấp nhận **cùng một tập tên** thay vì hai bản
regex song song trôi dần ra khỏi nhau.

### Fixed — lưu metadata làm mất đồng bộ mà không nói

Đọc `blockLibraryRouter.ts` mới thấy: `PUT /:id` đẩy một block đang `synced` về
`outdated` khi metadata đổi — đúng, vì định nghĩa trong bản vẽ nay giữ thông tin
cũ. Nhưng người dùng nhận thông báo "đã lưu" rồi thấy thẻ trạng thái tự đổi từ
"Đã sync" sang "Cần cập nhật" mà không có lời giải thích nào.

Nay thông báo nói thẳng và chỉ việc tiếp theo: *"Định nghĩa trong bản vẽ nay là
bản cũ — chạy Đồng bộ metadata để ghi bản mới."*

Trạng thái được **đọc từ phản hồi PUT**, không đoán phía client: máy chủ tự đặt
lại `syncStatus` (nó không tin `syncStatus` gửi từ form), và một sửa đổi bị
`sanitizeBlockDefinition` chuẩn hoá về y như cũ sẽ giữ nguyên `synced` — đoán
theo cờ `dirty` sẽ báo sai ở đúng ca đó.

### Fixed — `USER_GUIDE.md` còn ghi màn hình là "chỉ đọc"

Bỏ sót ở commit trước: phần 3 đã thêm hai nút ghi vào `/library/blocks` nhưng
hướng dẫn vẫn nói mọi lệnh ghi "vẫn ở màn hình cũ". Nay viết lại đủ ba việc
(chèn · đồng bộ metadata · sửa metadata) kèm giới hạn 2 phút của `insert`, câu
"hình học không đổi" của `sync`, và cảnh báo trạng thái đồng bộ là kết quả lần
quét gần nhất chứ không phải trạng thái so với bản vẽ đang mở.

### Fixed — lưu xong thì pane chi tiết biến mất (Codex review, P2)

Block đang chọn được tra trong danh sách **đã lọc**. Mà chính lượt lưu metadata
đẩy block từ `synced` sang `outdated` — nên đang bật bộ lọc "Khớp thư viện" rồi
lưu là block vừa sửa rơi khỏi danh sách, pane chi tiết unmount và phần đang gõ
dở biến mất. Đổi tên cho nó không còn khớp ô tìm kiếm cũng ra kết quả y hệt.

Nay tra trong toàn danh mục; danh sách đã lọc chỉ dùng để vẽ lưới.

### Fixed — tải lại hỏng thì xoá luôn bản nháp (Codex review, P1)

`useBlockLibrary` gọi `setBlocks([])` ở nhánh lỗi. Nghĩa là daemon tắt hay mạng
chớp trong một lần tải lại sẽ làm `selected` thành null, form sửa metadata
unmount, và người dùng mất trắng phần đang gõ. Lần tải lại ngay sau một lượt lưu
vừa là lúc dễ hỏng nhất, vừa là lúc có nhiều thứ để mất nhất — và bản sửa 409 ở
trên còn làm nó chạy cả khi lưu hỏng.

Nay hỏng thì **giữ danh mục cũ**. Trang phân biệt hai ca: chưa có gì thì hiện
hộp lỗi như cũ; đã có dữ liệu thì hiện dải "Danh mục có thể đã cũ" phía trên và
giữ nguyên danh sách lẫn pane chi tiết.

### Fixed — 409 là ngõ cụt không có đường ra (Codex review, P2)

Ghim revision đổi xung đột từ "một lần hỏng" thành "hỏng mãi": form ngồi trên
phiên bản không còn tồn tại, mọi lần lưu sau đều 409 y hệt, và trang không có
nút tải lại nào. Nay:

- tải lại danh mục **kể cả khi lưu hỏng**, không chỉ khi thành công;
- thông báo lỗi nói luôn việc phải làm thay vì chỉ báo lỗi;
- **Hoàn tác** lấy bản **mới nhất của máy chủ** chứ không phải mốc đã cũ — bình
  thường hai cái là một, khác nhau đúng ở ca này, và đây là đường ra duy nhất
  trên trang nên nó phải dẫn tới bản đang có thật.

Đã kiểm bằng stub ép trả 409: thông báo hiện đúng hướng dẫn, chữ đã gõ vẫn còn,
bấm Hoàn tác thì form về bản máy chủ và sạch trở lại.

### Fixed — hai ca hiếm còn sót của form (Codex review, P2)

- **Ảnh chụp lượt lưu cũ sống quá lâu.** Lưu block A → danh mục về bản A mới hơn
  → chọn block khác → quay lại A: form vừa mount nuốt phải ảnh chụp cũ và hiện
  metadata lỗi thời kèm revision lỗi thời. Nay đổi block là xoá luôn ảnh chụp.
- **Gõ tiếp trong lúc chờ máy chủ thì mất chữ.** Ô nhập không khoá khi đang lưu
  — và không khoá được, vì cờ bận dùng chung với `insert`, mà `insert` chờ tới 2
  phút. Nay khi phản hồi về, **mốc và revision** luôn cập nhật theo máy chủ,
  nhưng **nội dung form** chỉ bị dội nếu người dùng chưa gõ thêm kể từ lúc bấm.

### Fixed — lưu metadata ghi đè im lặng thay đổi của người khác (Codex review, P1)

Nghiêm trọng nhất trong loạt này, và là hệ quả không lường của việc giữ bản nháp
qua các lần tải lại. Kịch bản: form đang mở block B → người khác sửa B → một lệnh
`insert`/`sync` làm danh mục tải lại → `library.revision` thành bản mới trong khi
bản nháp vẫn là các giá trị **cũ**. Bấm Lưu lúc đó gửi giá trị cũ kèm revision
mới, máy chủ **chấp nhận** và xoá sạch thay đổi của người kia. Đúng loại hỏng mà
`expectedRevision` tồn tại để chặn, bị chính bản sửa trước đó mở ra.

Nay vá hai vế:

- Bản nháp **sạch** thì nhận bản mới khi danh mục tải lại — không có gì để mất,
  và ngồi trên dữ liệu cũ mới là nguồn của lỗi trên.
- Bản nháp **đang sửa dở** thì giữ nguyên, kèm luôn **revision mà nó dựa trên**.
  Lượt lưu gửi revision đó, nên máy chủ từ chối và người dùng phải tải lại — thay
  vì ghi đè trong im lặng.

Khoá bằng hai bất biến: `onSaveMetadata` phải nhận `expectedRevision` từ form, và
`saveBlockMetadata(...)` không được nhận `library.revision`.

### Fixed — nút Lưu sáng lại sau khi đã lưu (Codex review, P2)

Hệ quả của bản sửa ngay dưới, Codex bắt ở vòng review tiếp theo. Máy chủ chuẩn
hoá đầu vào (`sanitizeBlockDefinition` cắt khoảng trắng…), nên gõ `"Van "` rồi
lưu sẽ để lại bản nháp `"Van "` bên cạnh bản đã ghi `"Van"`: nút Lưu sáng lại
như thể còn thay đổi, và Hoàn tác thì đổi nội dung form một cách khó hiểu.

Nay form dội bản nháp theo **phản hồi `PUT`** sau mỗi lượt lưu thành công. Phải
là phản hồi chứ không phải lần tải lại danh mục ngay sau đó: form không phân
biệt được lần tải lại ấy với một lần tải lại bất kỳ, mà lần bất kỳ thì **không
được** đụng vào phần đang gõ dở.

Đã kiểm: gõ `" XX   "` vào Tên hiển thị → Lưu → form hiện `"Van cổng DN80 XX"`
(đã cắt khoảng trắng) và cả Lưu lẫn Hoàn tác đều tắt.

Vòng review sau chỉ ra rằng dội bản nháp thôi chưa đủ: mốc so sánh vẫn là prop
`block`, mà prop đó còn là bản **cũ** cho tới khi danh mục tải lại xong. Nút Lưu
sáng suốt quãng đó, bấm lần nữa là gửi `expectedRevision` cũ và ăn 409; tải lại
mà hỏng thì form không bao giờ về sạch. Nay mốc là một state riêng, cập nhật
cùng lúc với bản nháp.

### Fixed — mất công gõ khi danh mục tải lại (Codex review, P2)

Bản nháp của form là **cả** `BlockDefinition` và được đặt lại theo object `block`.
Danh mục thì tải lại sau mỗi lệnh `insert`/`sync`, và mỗi lần tải lại sinh object
mới hoàn toàn — nên chạy Chèn trong lúc đang sửa metadata sẽ **xoá sạch phần
đang gõ**, tuy người dùng không hề chọn sang block khác.

Nay bản nháp chỉ giữ **đúng những trường form sửa được** và chỉ đặt lại theo
`block.id`. Cách này còn gỡ luôn một cái bẫy thứ hai chưa lộ ra: `syncStatus` do
máy chủ quyết định và tự đổi sau khi lưu, nên nếu nó nằm trong bản nháp thì sau
mỗi lượt lưu nút Lưu sẽ sáng vĩnh viễn vì một "thay đổi" không ai tạo ra.

Đã kiểm đúng ca đó trên trình duyệt: gõ dở vào Mô tả → chạy Chèn → danh mục tải
lại → phần gõ dở vẫn còn.

### Fixed — ô Thẻ nuốt dấu phẩy (Codex review, P2)

Ô Thẻ render từ `tags.join(", ")` còn `onChange` tách chuỗi và bỏ phần rỗng: gõ
`van,` → `["van", ""]` → bỏ rỗng → render lại thành `van`. Dấu phẩy biến mất
ngay khi vừa gõ, nên **không gõ được thẻ thứ hai** trừ khi dán cả chuỗi.

Nay ô giữ nguyên văn người dùng gõ; mảng `tags` vẫn cập nhật theo từng phím để
`dirty`/validate chạy đúng, và nguyên văn chỉ được chuẩn hoá khi rời ô.

### Fixed — tiêu đề thông báo nói sai loại thao tác

Thông báo thành công dùng chung nhãn "Đã gửi lệnh" cho cả ba việc. Với lưu
metadata thì không có lệnh nào được gửi đi đâu cả — nó ghi vào thư viện và xong
ngay, nên nhãn đó ngụ ý còn một việc đang chạy trong AutoCAD. Nay `insert`/`sync`
giữ "Đã gửi lệnh", lưu metadata dùng "Đã lưu".

### Fixed — `<label>` lồng `<label>` (Codex review, P2)

Bảy trường của form được viết là `<label className="field">` bọc một `<label>`
nữa. HTML không hợp lệ: trình duyệt đóng label ngoài sớm khi parse, cây DOM lệch
với cây React (cảnh báo hydrate) và mất liên kết bấm-nhãn-để-focus.

Nay theo đúng cấu trúc của bộ mẫu: `<div className="field">` + `<label htmlFor>`
nối với `id` sinh từ `useId()`.

### Technical

- `DEVELOPMENT.md`: cây thư mục `apps/web` cập nhật đủ `components/`,
  `features/`, `lib/`; ghi lý do `lib/acadState.ts` tách khỏi feature.
- 2 test mới cho `validateBlockDraft` (`test-blocks-model.test.ts`: 9 → 11).
- 4 bất biến mới ở `test-contract.mjs`.
- Kiểm trên Chrome thật: tên có dấu → khoá + `aria-invalid`, tên rỗng → khoá,
  sửa hợp lệ → mở, Hoàn tác → về bản gốc và khoá lại. Gõ **bằng bàn phím thật**
  `, ren` vào ô Thẻ → dấu phẩy đứng lại, nút Lưu bật; bấm Lưu → thẻ đổi từ
  "Đã sync" sang "Cần cập nhật" kèm đúng câu nhắc chạy Đồng bộ metadata.
- Kiểm bằng một daemon giả (`NEXT_PUBLIC_DAEMON_URL` trỏ sang cổng khác) thay vì
  ghi block giả vào thư viện thật.

---

## 2026-08-10 — Giai đoạn 4 (phần 3): lệnh ghi của thư viện block

### Added

- `features/staged-ops/ConfirmSheet.tsx` — hộp xác nhận dùng chung cho mọi lệnh
  ghi. Nó bắt buộc nói ba điều: ghi cái gì vào bản vẽ nào, **không có hoàn tác**,
  và **có qua hàng chờ hay không**. Điều thứ ba là chỗ dễ hiểu nhầm nhất: phần
  lớn lệnh ghi là hai pha, nhưng chèn block và chèn bảng BOQ là **một pha** —
  gọi cả hai là "xác nhận" mà không phân biệt sẽ khiến người dùng tưởng còn một
  bước nữa để rút lui. Ô tích xác nhận là bắt buộc và cố ý gây ma sát.
- `features/blocks/actions.ts` — `insert` và `sync`, kèm `expectedRevision` để
  máy chủ từ chối nếu người khác vừa sửa thư viện.
- Hai nút ghi trên `/library/blocks`, dùng `WriteButton` nên bị khoá thật khi
  AutoCAD không ở trạng thái ghi được.

### Changed — sắp lại ranh giới thư mục

`ConfirmSheet` ở `features/staged-ops` cần `WriteButton` ở
`features/acad-connection` — vi phạm chính quy tắc "feature không import chéo
feature". Trạng thái kết nối AutoCAD là **hạ tầng dùng chung**, không phải một
feature ngang hàng, nên:

- kiểu + nhãn + `canWrite` chuyển sang `lib/acadState.ts`;
- `WriteButton` + `AcadStateProvider` chuyển sang `components/ui/`;
- `features/acad-connection/useAcadState.ts` giữ phần *đọc* trạng thái
  (polling, SSE, heuristic phân biệt `no-plugin` với `mute`).

### Fixed — plugin: cờ dirty không được xả khi job không dùng lệnh

Phát hiện khi chạy thật, không phải từ đọc code. Vẽ một đường qua
`(command "_.CIRCLE" …)` thì chấm "chưa lưu" trên doctab đổi ngay. Vẽ bằng
`entmake` thuần thì **không có gì xảy ra** — `docs.json` báo `dbmod=1` nhưng UI
treo ở trạng thái cũ.

Nguyên nhân: `drawingModified` chỉ được phát trong `commandEnded`. Một job LISP
sửa bản vẽ bằng `entmake` không kết thúc lệnh nào, nên cờ dirty nằm mãi. Chính
các job của app đi đường này.

Nay nhịp watcher xả cờ khi `isQuiescent()` — điều kiện bắt buộc, xả giữa chừng
một lệnh đang chạy sẽ báo "đã sửa" trước khi lệnh đó thật sự xong.

Đã kiểm lại đúng ca hỏng sau khi nạp plugin mới: `entmake` thuần → sự kiện
`drawingModified` phát ra, `dbmod` 0 → 1, chấm trên doctab đổi theo.

### Fixed — UI hứa một việc backend không làm

Codex review bắt đúng loại lỗi mà cả bộ guardrail này tồn tại để chặn. Hộp xác
nhận `sync` của tôi viết "đè bản đang có" và "mọi thể hiện của block đổi hình
theo". Đọc lại `blockLibraryRouter.ts`: `/blocks/sync` **đòi định nghĩa phải có
sẵn** trong bản vẽ rồi gọi `writeCadMetadata` — nó chỉ ghi thông tin mô tả, và
**không hề** nhập hay thay hình học.

Người dùng sẽ xác nhận một thao tác nghe như phá huỷ mà thực tế không xảy ra —
rồi tin rằng hình block đã được cập nhật.

Nay: nhãn đổi thành "Đồng bộ metadata", hộp xác nhận nói rõ hình học không đổi,
và nút bị **chặn trước** khi định nghĩa chưa có trong bản vẽ (`local_only`) kèm
lý do, thay vì để người dùng bấm rồi nhận 409.

### Fixed — hai lỗi nữa về luồng chèn

- **Hộp thoại chặn màn hình đúng lúc cần sang AutoCAD.** Máy chủ chờ tới **2
  phút** để người dùng chỉ điểm chèn *trong AutoCAD*, mà hộp xác nhận chỉ đóng
  sau khi request trả về — nó chắn màn hình suốt quãng đó và không có đường huỷ
  nếu lệnh treo. Nay hộp đóng ngay khi gửi lệnh, và thông báo nói rõ phải chuyển
  sang AutoCAD cùng giới hạn 2 phút.
- **Thông báo hiện dưới nhầm block.** Nó được giữ ở dạng toàn cục trong khi
  người dùng đổi block đang chọn được — thông báo của thao tác cũ sẽ hiện dưới
  định nghĩa mới và ngụ ý thao tác vừa áp lên nó. Nay thông báo gắn với `blockId`
  đã sinh ra nó.

### Fixed — và một lần tôi tự sửa quá tay

- **Chặn trước dựa trên dữ liệu không đáng tin.** Tôi đã vô hiệu hoá nút Đồng bộ
  theo `syncStatus`, viện nguyên tắc "chặn trước, không báo lỗi sau". Codex chỉ
  ra `GET /api/acad/blocks` nhận request bằng `_req` — nó **bỏ qua mọi tham số**,
  kể cả `target`. Danh mục là toàn cục và `syncStatus` là trạng thái lần quét
  gần nhất, không phải trạng thái so với bản vẽ đang mở: một block `synced` với
  bản vẽ A vẫn có thể cần ghi metadata ở bản vẽ B. Chặn theo dữ liệu như vậy làm
  nút chết oan. Nay bỏ chặn, và hộp xác nhận nói rõ máy chủ sẽ từ chối nếu bản
  vẽ chưa có định nghĩa. Nguyên tắc "chặn trước" chỉ đúng khi phép kiểm **đáng
  tin**.
- Gỡ luôn tham số `?target=` khỏi lời gọi danh mục — máy chủ không đọc nó, giữ
  lại là ngụ ý một khả năng không tồn tại.
- **Bấm hai lần xếp hai lệnh ghi.** Hộp thoại đóng ngay khi gửi, nhưng `insert`
  chờ tới 2 phút; không khoá lại thì cú bấm thứ hai gửi thêm một lệnh nữa với
  cùng `expectedRevision`. Nay có cờ đang-bay, nút đổi nhãn "Đang chờ AutoCAD…".

### Technical

- Bất biến mới: `ConfirmSheet` phải có cảnh báo riêng cho chế độ `immediate` và
  câu "không hoàn tác được"; `features/blocks/actions.ts` không được nhắc tới
  `staged-ops` (bỏ comment trước khi đếm); hộp xác nhận sync phải nói "hình học
  không đổi" và không được chứa lời hứa thay hình học.

---

## 2026-08-10 — Xác minh `dbmod` trên AutoCAD thật

Plugin AcadBridge đã build và **nạp vào AutoCAD 2027**. Đây là thứ duy nhất của
giai đoạn 3 chưa kiểm được trên máy thật.

### Verified

| Bước | `revision` | `dbmod` |
|---|---|---|
| Bản vẽ vừa mở (sạch) | 0 | **0** |
| Sau khi vẽ một đường (`entmake LINE` qua `/api/acad/job`) | 3 | **1** |
| Sau khi lưu (`QSAVE`) | 44 | **0** |

Sự kiện `drawingSaved` phát đúng chỗ trong `events.jsonl`, nằm giữa
`commandStart QSAVE` và `commandEnded QSAVE`.

Trường `busy` mới ở `/api/acad/status` cũng trả đúng `false` khi không có job.

### Technical

Ghi lại một điều chỉ lộ ra khi chạy thật: sau khi lưu, `revision` nhảy **3 → 44**
vì AutoCAD chạm nhiều đối tượng trong quá trình lưu. Nếu `dbmod` so bộ đếm thô
thì bản vẽ sẽ bị báo "chưa lưu" **ngay sau khi vừa lưu xong**. Nó ra `0` vì
`AcRxEventReactor::saveComplete` đặt lại mốc — đúng lý do thiết kế cần mốc chứ
không so thẳng bộ đếm. Không có bước kiểm thật này thì lỗi đó sẽ chỉ lộ ra ở
tay người dùng.

Bản plugin cũ (29.07) đã được sao lưu trước khi ghi đè, xem mục hoàn tác trong
`ROADMAP.md`.

---

## 2026-08-10 — Giai đoạn 4 (phần 2): route `/library/blocks` (chỉ đọc)

### Added

- `app/(shell)/library/blocks/page.tsx` — màn Thư viện block trong giao diện
  mới: bộ lọc, lưới định nghĩa, pane chi tiết. **Chỉ đọc.**
- `app/(shell)/library/blocks/blocks.module.css` — style riêng của màn hình,
  trích từ mẫu. Mỗi màn hình trong bộ mẫu có một khối `<style>` riêng bên cạnh
  design system; những style đó **không** được nhét vào `design-system.css` —
  chúng chỉ phục vụ một màn hình, và đưa vào hệ dùng chung là làm nó phình ra
  rồi lệch khỏi mẫu.
- `features/blocks/useBlockLibrary.ts` — đọc danh mục. Hook này **không cấp
  đường ghi nào**, nên không có cách nào vô tình ghi vào bản vẽ từ màn hình mới.
- `daemonFailureText()` trong `lib/daemon/client.ts`.

### Changed

- `nav.ts`: `/library/blocks` vào danh sách route đã tồn tại.

### Fixed

- Lỗi mạng không còn hiện `"Failed to fetch"` — chuỗi thô của trình duyệt không
  nói gì với người đang dùng app. Nay nêu ba nguyên nhân thực tế kèm lối thoát:
  daemon chưa chạy, sai cổng, hoặc mở bằng `file://`.

- Nguồn thư viện hỏng không còn xoá cả danh mục (Codex review). Hai lời gọi
  không ngang hàng: danh mục là nội dung màn hình, danh sách thư mục nguồn chỉ
  là một con số phụ ở thanh lọc. Gộp vào một `Promise.all` nghĩa là mất cả màn
  hình vì một thông tin bên lề — panel cũ cũng tách hai đường này.

- Pane chi tiết không còn biến mất ở màn hình hẹp (Codex review). Design system
  ẩn `.split > .detail` ở ≤1240px — hợp lý cho những màn có thông tin trùng ở
  cột trái, nhưng ở đây pane đó là nơi **duy nhất** xem được metadata và đường
  sang trình sửa, nên ẩn nó biến việc bấm vào một block thành thao tác không có
  gì xảy ra. CSS module xếp chồng nó xuống dưới lưới thay vì ẩn.
- Nút "Mở màn hình cũ để sửa" giờ **thật sự mở** thư viện ở màn hình cũ
  (`/?panel=blocks`). Trước đó nó chỉ về trang gốc còn panel vẫn đóng — nhãn
  hứa một việc mà liên kết không làm.

- **Địa chỉ daemon từng có hai tên biến môi trường** (Codex review). Tôi đặt
  `NEXT_PUBLIC_ACAD_DAEMON` cho shell và route mới, trong khi màn hình cũ và
  `scripts/package.mjs` dùng `NEXT_PUBLIC_DAEMON_URL`. Bản đóng gói chỉ set cái
  sau, nên giao diện mới sẽ trỏ sai địa chỉ **trong khi mọi thứ khác vẫn chạy**
  — kiểu lỗi chỉ lộ ra sau khi giao hàng. Nay có đúng một `DAEMON_BASE` trong
  `lib/daemon/endpoints.ts`, và contract test cấm mọi file khác đọc
  `NEXT_PUBLIC_*`.

### Cố ý làm khác mẫu

- Bộ lọc trạng thái đồng bộ có **6** mục chứ không phải 4 như mẫu. Backend có 5
  trạng thái; mẫu chỉ vẽ 3, và thiếu đúng `conflict` — trạng thái duy nhất người
  dùng buộc phải xử lý tay. Lọc mà thiếu một trạng thái nghĩa là có block không
  bao giờ tìm thấy được.

### Docs

- `USER_GUIDE.md` bổ sung mục **Giao diện mới**: cách đi lại giữa hai giao diện,
  ba phím tắt của khung chung, ba trạng thái chấm "đã lưu", và hướng dẫn màn Thư
  viện block kèm giới hạn chỉ-đọc. Codex review nhắc đúng — tôi đã bỏ sót việc
  này từ giai đoạn 3, khi shell mới bắt đầu có màn hình người dùng nhìn thấy.

### Chưa làm — nói rõ trên chính màn hình

Tạo block từ bộ chọn, chèn vào bản vẽ, đồng bộ định nghĩa và sửa metadata vẫn ở
màn hình cũ. Đó là các lệnh **ghi**, và chúng cần `ConfirmSheet` cùng luồng hai
pha chưa dựng lại ở đây. Trang nói thẳng điều đó và có liên kết sang màn hình cũ
ngay tại chỗ người dùng cần, thay vì vẽ nút rồi để nó không làm gì.

---

## 2026-08-10 — Giai đoạn 4 (phần 1): tách tầng dữ liệu thư viện block

### Added

- `features/blocks/model.ts` — kiểu dữ liệu và toàn bộ logic chuẩn hoá của thư
  viện block, tách khỏi giao diện. Panel legacy và route `/library/blocks` sắp
  dựng sẽ dùng **chung** file này: hai giao diện là chuyện tạm thời trong lúc
  migrate, hai bản logic chuẩn hoá thì không — chúng sẽ lệch, và lệch ở đây
  nghĩa là hai màn hình nói hai trạng thái đồng bộ khác nhau cho cùng một block.
- `scripts/test-blocks-model.test.ts` — 9 test. Lớp này quyết định người dùng
  **nhìn thấy** trạng thái đồng bộ nào; sai ở đây không gây lỗi, nó chỉ hiển thị
  sai và người dùng chèn một block họ tưởng đã khớp thư viện.

### Changed

- `BlockLibraryPanel.tsx` từ 888 → 657 dòng, import từ module chung. **Không
  đổi hành vi.**

### Technical

- Test khoá đúng hai điều dễ hỏng nhất: giữ đủ **5** trạng thái đồng bộ của
  backend (mẫu chỉ vẽ 3; ép xuống 3 sẽ nuốt mất `conflict` — trạng thái duy nhất
  người dùng buộc phải xử lý tay), và trạng thái lạ phải lùi về `local_only`
  chứ **không** lùi về `synced`, vì lùi sai hướng là nói với người dùng rằng
  block đã khớp thư viện.
- Hai test đầu tôi viết sai kỳ vọng về `slugifyTechnicalName` (đoán hoa/gạch
  ngang, thực tế là thường/gạch dưới; và đoán trả rỗng, thực tế lùi về `"block"`
  vì AutoCAD cần tên không rỗng). Test đã sửa theo hành vi thật của code.

---

## 2026-08-10 — Giai đoạn 3: shell dùng chung, và giao diện mới chạy được

Lần đầu người dùng nhìn thấy bộ mẫu thiết kế chạy thật: `/changes` mở ra với
titlebar, rail 14 mục, thanh trạng thái, ⌘K và nhật ký hoạt động.

### Added

- `components/ui/icons.tsx` — 27 glyph, **sinh từ** `mau-thiet-ke/js/app.js`
  @ `82f5232` chứ không chép tay. 27 đường path SVG chép tay là 27 cơ hội sai
  một toạ độ mà không ai phát hiện tới lúc nhìn thấy icon méo.
- `components/shell/nav.ts` — NAV 5 nhóm/14 mục + 15 lệnh ⌘K, cũng sinh từ mẫu.
  Cờ `built` nghĩa là *route tồn tại và điều hướng tới được*; mục chưa có route
  hiện dạng vô hiệu hoá kèm lý do, thay vì dẫn tới trang trống.
- `components/shell/` — `AppShell`, `Titlebar`, `Rail`, `Statusbar`,
  `CommandPalette`, `ActivityDrawer`, `useRail`.
- `components/ui/` — 5 primitive có ít nhất hai nơi dùng: `Button`, `Tag`,
  `Panel`, `Modal`, `GuardStrip`. 20 primitive còn lại của kế hoạch **chưa
  dựng** — tạo khi màn hình thứ hai cần, không sớm hơn.
- `features/acad-connection/useAcadState.ts` — 6 trạng thái kết nối.
- `features/acad-connection/WriteButton.tsx` — nút ghi, đọc trạng thái từ
  **context** chứ không nhận qua prop: nếu nơi gọi phải tự truyền, sớm muộn sẽ
  có chỗ truyền nhầm. Không có provider thì mặc định `off` — fail-closed.
- `features/staged-ops/store.ts` — hàng chờ dùng chung cho chip titlebar và huy
  hiệu rail; hai nơi không bao giờ nói hai con số khác nhau.
- `lib/storage.ts` — 4 khoá, mọi truy cập bọc try/catch (Safari riêng tư ném
  ngay khi **đọc** `localStorage`).
- Cầu nối hai chiều giữa màn hình legacy và shell mới. Xoá ở giai đoạn 8.

### Fixed — quyết định D6 (`dbmod`), và kế hoạch đã sai về nó

Kế hoạch ước lượng "~5 dòng C++: đọc DBMOD cho từng document trong iterator".
**Không làm được như vậy**, đã kiểm chứng trên header ObjectARX 2027 thật:

- `acedGetVar(DBMOD)` chỉ đọc được **tài liệu hiện hành** — chính code
  `/drawing-info` cũ đã phải cảnh báo `dbmod_unavailable_for_non_current_document`.
- `AcApDocument` **không có** accessor nào cho việc này: chỉ `isQuiescent`,
  `isReadOnly`, `isCommandInputInactive`, `isNamedDrawing`.
- `AcDbDatabaseReactor` và `AcApDocManagerReactor` **đều không có** callback
  "đã lưu".

Đường đi được là suy từ bộ đếm revision mà plugin đã có: DB reactor tăng bộ đếm
mỗi lần sửa, và `AcRxEventReactor::saveComplete` — nơi **duy nhất** trong
ObjectARX báo đã lưu xong — đặt lại mốc. Cách này đúng cho **mọi** bản vẽ đang
mở, không chỉ bản vẽ hiện hành.

Giới hạn đã biết, ghi trong code: DB reactor chỉ gắn vào database của tài liệu
đang hoạt động, nên thay đổi do *code khác* gây ra trên một bản vẽ nền không
được đếm. Sửa của **người dùng** luôn xảy ra khi tài liệu đang hoạt động nên vẫn
đếm đúng.

Chấm trên doctab vì vậy có **ba** trạng thái chứ không phải hai: đã lưu, chưa
lưu, và **không đọc được**. Một chấm xanh sai trên bản vẽ chưa lưu là đúng thứ
dẫn tới mất dữ liệu khi người dùng khởi động lại AutoCAD.

Codex review bắt thêm hai lỗi P1 trong chính bản D6 này, cả hai đều đúng:

- **Chấm treo ở trạng thái cũ.** Shell chỉ nạp lại danh sách bản vẽ khi có sự
  kiện `doc*`. Sửa bản vẽ phát `drawingModified`, còn lưu xong thì
  `saveComplete` chỉ ghi lại `docs.json` mà không đánh thức ai — nên chấm không
  đổi cho tới lần mở/đóng bản vẽ tiếp theo. Nay plugin phát thêm sự kiện
  `drawingSaved`, và shell nghe cả ba tín hiệu.
- **Bản vẽ bẩn trước khi nạp plugin bị báo là đã lưu.** Plugin nạp sau khi người
  dùng đã sửa thì cả hai bản đồ revision đều trống, hiệu bằng 0, và kết quả là
  `dbmod: 0` — sai theo đúng hướng nguy hiểm. Nay `acadDatabaseModifiedKnown()`
  trả về "không biết" khi chưa có mốc, và mốc được đặt từ **DBMOD thật** ngay
  khi tài liệu trở thành hiện hành (lúc đó `acedGetVar` mới đọc được nó). Bản vẽ
  mở từ trước vì thế có mốc đúng ngay khi người dùng bấm sang nó.
- **Undo hết về mốc đã lưu vẫn báo chưa lưu** (review lần hai). Bộ đếm revision
  chỉ tăng, nên nó không biểu diễn được việc quay về trạng thái sạch. Nay tài
  liệu **hiện hành** đọc thẳng `DBMOD` thật — nguồn chính xác, về 0 khi undo hết
  — và mỗi lần đọc được thì mốc của bản vẽ nền cũng được đồng bộ lại.

### Fixed — một lỗi nữa, ở tầng daemon

Codex review lần ba: `useAcadState` coi **bất kỳ** `activeJob` nào là "đang
bận". Nhưng daemon **không bao giờ** đặt `activeJob` về `null` — nó giữ bản ghi
job cuối cùng để `/job/:id` còn tra được. Suy như vậy nghĩa là sau job đầu tiên,
shell kẹt vĩnh viễn ở trạng thái `busy` và **mọi nút ghi bị khoá**.

Daemon vốn đã có định nghĩa đúng của "đang bận" (`state === "sent"` và chưa quá
120 giây) nhưng chôn trong một câu `if` ở route khác. Nay nó được tách thành
`acadBusy()` và trả về qua `/status`; UI đọc cờ đó thay vì tự suy. Một định
nghĩa, hai nơi dùng, không thể lệch.

### Fixed — hai lỗi cuối, từ review lần bốn

- **Tab bản vẽ giả vờ tương tác được.** Chúng là `<button role="tab">` nhưng
  không có handler: bấm vào tab nền không có gì xảy ra. Đổi bản vẽ hiện hành là
  một lệnh **ghi** (`activate-document`) và phải đi qua chuẩn bị → xác nhận như
  mọi lệnh ghi khác, nên luồng đó thuộc màn hình dùng nó. Cho tới lúc đó, tab
  là chỉ báo **đọc-thôi** kèm hướng dẫn đổi bản vẽ trong AutoCAD — một "tab" bấm
  không phản ứng luôn bị hiểu là app hỏng.
- **Kết quả đọc cũ ghi đè kết quả mới.** Nhịp 15 giây và lần đọc do sự kiện
  kích hoạt có thể chồng nhau và về không theo thứ tự gửi đi. Hậu quả cụ thể:
  pill quay lại "đã nối" sau khi AutoCAD đã tắt, và nút ghi mở lại cho tới nhịp
  sau. Nay mỗi lần đọc mang số thứ tự và chỉ lần mới nhất được ghi state.

### Một phát hiện đã xem xét và KHÔNG sửa

Review lần năm báo `drawingModified` đọc lại `docs.json` cũ vì `commandEnded`
không gọi `writeDocs()`. Đã kiểm chứng và **không đúng**: `listOpenDocs()` ghi
`docs.req` rồi *chờ* `docs.json` có `mtime >= reqAt`, không thì trả
`alive: false` (`acadBridge.ts:322-339`); phía plugin, watcher thấy `docs.req`
đổi là gọi `writeDocs()` ngay (`mepbridge.cpp:1818-1821`). Snapshot tươi theo
thiết kế, không có gì để sửa.

### Technical

- Plugin **đã build được** (`./build.sh --build-only`, universal x86_64+arm64,
  export `acrxEntryPoint`). Chưa nạp vào AutoCAD để chạy thử.
- Sai lệch thứ 3 của `design-system.css`: cỡ `svg` trong `.searchbtn` /
  `.stagedchip` (mẫu bỏ sót, `<svg>` có `viewBox` mà không có `width` mặc định
  rộng 300px và làm vỡ thanh tiêu đề), cộng trạng thái chấm thứ ba.
- Bất biến mới: nếu UI render `data-saved` thì cả bốn nơi — plugin C++,
  `OpenAcadDocument`, `AcadDocument`, `Titlebar` — phải cùng khai `dbmod`.
- `AppShell` đặt `data-screen` trên **cả** phần tử gốc, không chỉ `<body>`: bản
  đóng gói là HTML tĩnh và test route phải đọc được mốc trước khi React chạy.
- Kiểm bằng Chrome thật: ⌘K mở bảng lệnh (15 lệnh, mũi tên, Enter, Esc); ⌘B thu
  rail xuống 64px và lưu lựa chọn; **điều hướng client-side hai chiều** giữa
  shell và legacy gỡ sạch cả bốn attribute — đúng kịch bản phản biện cảnh báo là
  dễ rò nhất.

---

## 2026-08-10 — Giai đoạn 2B: chat sửa message theo ID, không theo vị trí

Mọi handler của chat đều có dạng "thêm chỗ giữ chỗ → await mạng 0,2–120 giây →
điền kết quả". Bước cuối trước đây dùng `patchLast` — sửa phần tử **cuối mảng**.
Giả định ngầm là không có message nào chen vào giữa lúc `await`; giả định đó sai
bất cứ khi nào người dùng gõ tiếp, một sự kiện AutoCAD chèn thông báo, hay hai
chức năng chạy song song. Hậu quả không phải crash mà là **kết quả rơi vào nhầm
message** — người dùng thấy kết quả của thao tác này nằm dưới nhãn của thao tác
khác.

### Added

- `features/assistant/messages.ts` — `newMessageId()` và `patchById()`.
  `patchById` giữ nguyên identity của message không đụng tới (React dựa vào đó
  để bỏ qua re-render) và trả lại danh sách cũ nguyên vẹn khi ID không còn.
- `scripts/test-chat-messages.test.ts` — 7 test, gồm một test ghi lại **hành vi
  sai của bản cũ** để sau này còn biết bất biến này tồn tại vì lý do gì.
- `appendMessage()` trong `page.tsx`: thêm message và **trả về ID**, để handler
  giữ ID từ bước đầu.

### Changed

- Xoá toàn bộ **28** lời gọi `patchLast`; 17 hàm nay patch theo ID.
- `decide` và `decideLispProposal` nhận **ID** thay vì chỉ số mảng; chúng từng
  đọc `messagesRef.current[idx]` sau `await`. `decideBusy` và
  `lispProposalBusy` đổi từ `number | null` sang `string | null`.
- `refreshBom` từng nhớ **chỉ số** thẻ BOM trong `bomIdxRef` rồi cập nhật theo
  chỉ số đó — xoá một hội thoại hay chèn một thông báo là BOM ghi đè lên message
  khác. Nay là `bomMessageIdRef`.
- `key` của message bỏ fallback `m.id || <chỉ số>`.

### Fixed

- **`Msg.id` đổi từ tuỳ chọn sang bắt buộc.** Đây là thay đổi có sức nặng nhất:
  ngay khi siết kiểu, TypeScript chỉ ra **13 chỗ** tạo message không có ID mà
  grep không tìm ra hết. Để `id?` là mở lại đúng cái cửa vừa đóng.
- **Auto-BOM tắt câm khi đổi hội thoại** (Codex review phát hiện). `patchById`
  cố ý không làm gì khi ID đã biến mất, nên khi người dùng sang hội thoại khác,
  `refreshBom` vẫn cầm ID của thẻ cũ và mọi sự kiện vẽ tiếp theo không hiện gì —
  không lỗi, không thông báo. Nay `refreshBom` kiểm sự hiện diện của thẻ trước
  khi patch và dựng thẻ mới nếu không còn, `newChat` cũng xoá ref. Bản cũ dùng
  chỉ số cũng hỏng ở tình huống này, chỉ hỏng theo kiểu khác.

### Technical

- Bất biến mới: `patchLast(` = 0 · `messagesRef.current[` = 0 · `bomIdxRef` = 0 ·
  `key={m.id ||` không tồn tại · `Msg.id` khai là bắt buộc.
- Kiểm end-to-end bằng Chrome: chạy nối tiếp hai chức năng khi daemon tắt, **mỗi
  lỗi rơi vào đúng message của nó**. Với `patchLast` cũ thì message đầu sẽ không
  có lỗi còn message sau bị ghi hai lần.

---

## 2026-08-10 — Giai đoạn 2A (phần 3): một EventSource, một nơi đọc danh sách bản vẽ

### Added

- `features/acad-connection/events.ts` — bus sự kiện AutoCAD. Một
  `EventSource` cho toàn app, đếm tham chiếu (mở khi có listener đầu tiên, đóng
  khi listener cuối rời đi), listener giữ trong `Set` cấp module chứ không
  trong state. Một listener ném lỗi không làm câm các listener còn lại.
  Chuẩn hoá dấu thời gian: daemon lúc gửi mili giây lúc gửi giây.
- `lib/daemon/docs.ts` — một `fetchDocs()` cho cả ba màn hình từng tự fetch và
  tự bóc payload `/api/acad/docs`.
- `scripts/test-acad-events.test.ts` — 8 test cho vòng đời đăng ký, chạy trong
  `test:contract` với một `EventSource` giả. Lỗi của bus không lộ ra ngay: nó
  biểu hiện thành "màn hình kia bỗng ngừng nhận sự kiện" nhiều thao tác về sau,
  nên phần này được khoá bằng test thay vì bằng đọc code.

### Changed

- `page.tsx` không còn tự mở `EventSource`; nó đăng ký qua `useAcadEvents`.
  Hành vi xử lý sự kiện giữ nguyên từng nhánh.

### Fixed

- **Đăng ký trùng callback huỷ nhầm nhau** (Codex review phát hiện).
  `subscribeAcadEvents` thêm thẳng `listener` vào `Set`, mà `Set` khoá theo
  identity — nên cùng một hàm đăng ký hai lần chỉ tạo một entry, và hàm huỷ của
  người này gỡ đăng ký của người kia rồi đóng luôn kết nối chung. Nay mỗi lần
  đăng ký được bọc trong wrapper riêng, huỷ lặp không tính hai lần, và chỉ xoá
  bus khỏi bảng nếu bus trong bảng vẫn đúng là bus đó.

### Technical

- Bất biến siết thêm: `new EventSource` không chỉ **= 1** mà còn phải **nằm
  trong** `features/acad-connection/events.ts`. Tiêu chí "= 1" đơn thuần đã
  đúng sẵn từ trước khi làm gì, nên nó không đo được gì. Tương tự, endpoint
  `docs`/`events` chỉ được khai trong `lib/daemon/endpoints.ts`.
- Negative test cho chính bản sửa: hoàn nguyên về `Set` khoá theo identity thì
  đúng 1 trong 8 test đỏ (test đăng ký trùng), khôi phục thì xanh lại.
- **Thêm `check:types` vào chuỗi `verify`.** Codex review lần hai bắt được một
  lỗi TypeScript trong chính test mới mà `pnpm verify` lúc đó vẫn báo xanh:
  `next build` **không** typecheck thư mục `scripts/`, dù `tsconfig.json` có
  include nó. Nghĩa là suốt từ giai đoạn 0 tới giờ, mọi lỗi kiểu trong script
  kiểm thử đều lọt. Nay `tsc --noEmit -p tsconfig.json` chạy như một bước riêng.
- Contract test đỏ đúng vai lần thứ hai: đổi tên biến `eventAt` → `event.at`
  làm assert về dấu thời gian drawing-info fail. Bất biến vẫn đúng, chỉ mẫu cần
  cập nhật — đó chính là lúc con người phải xác nhận thay vì máy đoán.

### Hai điều CỐ Ý không làm

- **Không** chuyển bảy `setState` của handler SSE ra khỏi `Page()`. Cái lợi
  re-render chỉ đến khi từng panel tự đăng ký, mà việc đó đổi hợp đồng props
  của hai panel lớn nhất — thuộc về lúc migrate chúng sang route (GĐ5–6).
- **Không** gộp quy tắc suy đích vẽ vào `fetchDocs`. Ba màn hình suy khác nhau
  và gộp bừa sẽ làm đích vẽ nhảy sang bản vẽ khác trong im lặng. Chi tiết ba
  quy tắc ghi trong `lib/daemon/docs.ts`.

---

## 2026-08-10 — Giai đoạn 2A (phần 2): một bộ đọc phản hồi daemon

### Changed

- Xoá 3 bản `responseJson` cục bộ trong `BlockLibraryPanel`, `LispLibraryPanel`,
  `DrawingStandardsPanel`; cả ba nay dùng `daemonRecord` / `daemonJson` từ
  `lib/daemon/client.ts`. Đổi tên tại chỗ dùng thay vì import kèm alias — một
  cái tên nói dối buộc người đọc sau này phải nhảy lên đầu file mới biết mình
  đang gọi gì.
- Xoá `app/json.ts`; `asRecord` và `JsonRecord` chuyển về
  `lib/daemon/client.ts`. Bốn panel đổi đường import.

### Fixed

- Thông điệp lỗi nay chỉ nhận giá trị nguyên thuỷ. Ba trong bốn bản cũ dùng
  `String(record.error)`, nên khi daemon trả `error` là một object thì người
  dùng nhận được `[object Object]` — vô nghĩa và tệ hơn cả mã HTTP. Lấy theo
  bản an toàn nhất trong bốn bản (`LispLibraryPanel`): không phải chuỗi/số/bool
  thì lùi về `HTTP <mã>`.

### Technical

- Bất biến mới: không panel nào được tự viết lại bộ đọc phản hồi
  (`async function responseJson|responseRecord` = 0), và cả bốn panel phải
  import từ `lib/daemon/client`.
- Contract test đỏ đúng như thiết kế khi `app/json.ts` bị xoá (assert
  `from "./json"`), và `tsc` bắt được một call site `responseJson` mà regex đổi
  tên bỏ sót. Đây là hai lưới an toàn hoạt động đúng vai, không phải phiền toái.

---

## 2026-08-10 — Giai đoạn 2A (phần 1): một luồng ghi duy nhất

Gộp 3 bản sao của luồng ghi hai pha **trước khi** di chuyển bất kỳ file nào.
Thứ tự này không tuỳ ý: lệnh ghi vào bản vẽ không hoàn tác được, và một bản port
sót `confirmed: true` là một đường ghi chạy mà không hiện danh sách đối tượng
cho ai xem.

### Added

- `lib/daemon/endpoints.ts` — mọi đường dẫn API khai một chỗ.
- `lib/daemon/client.ts` — `DaemonError` giữ `code` và `status`; chuẩn hoá cặp
  mã đồng nghĩa `ambiguous_target` → `target_ambiguous` và
  `autocad_not_running` → `not_running` ngay tại biên nhận.
- `features/staged-ops/{types,guards,prepareApplyReject}.ts` — một bản duy nhất
  của prepare → confirm → reject. `confirmed: true` chỉ tồn tại ở đây.
- `scripts/extract-guard-codes.mjs` + script `check:guards`. Nó quét daemon và
  bắt UI phải có thái độ với **từng** mã: hoặc có câu chữ riêng, hoặc nằm trong
  `GENERIC_CODES`, hoặc fail build. Chặn cả chiều ngược lại — entry cho mã
  daemon không còn phát ra cũng fail, vì câu chữ chết còn tệ hơn không có.

### Changed

- `page.tsx`, `DrawingInfoPanel`, `DrawingStandardsPanel` gọi module chung thay
  cho ba bản tự viết.
- Bản trong `page.tsx` trước đây **không kiểm `ok === false`** và vứt luôn mã
  lỗi có kiểu của daemon; nay nó dùng chung đường xử lý lỗi với hai panel kia.
- Chuỗi rút số đối tượng lấy theo bản đầy đủ nhất trong ba bản. Bản ngắn ở
  `page.tsx` bỏ sót `summary.subjectCount` và độ dài mảng `subjects`.
- `prepare` nay từ chối cả phản hồi thiếu `revision`, không chỉ thiếu `id` —
  thiếu revision thì daemon không có gì để đối chiếu lúc ghi.
- Tập mã "snapshot đã cũ" mở rộng từ 4 lên 7. Bốn mã cũ là các mã kết thúc bằng
  `_stale` trừ `destination_stale` — một thiếu sót. Thêm
  `operation_revision_mismatch` và `target_mismatch` vì cả hai đều có nghĩa là
  thứ app đang cầm không còn khớp bản vẽ. Mở rộng theo hướng an toàn: nhiều
  trường hợp hơn sẽ đánh dấu snapshot cũ và buộc quét lại.

### Fixed

- 62 mã lỗi của daemon nay đều có thái độ, trong đó 51 mã có câu giải thích và
  lối thoát riêng. Bộ mẫu thiết kế chỉ liệt kê 11 — thiếu cả bốn mã mà màn
  "Thay đổi chờ duyệt" sẽ gặp nhiều nhất khi apply một thao tác cũ
  (`operation_expired`, `operation_not_found`, `operation_not_pending`,
  `operation_revision_mismatch`) và thiếu `selection_too_large`.

### Technical

- Bất biến mới trong `test-contract.mjs`: `confirmed: true` đúng **1** lần
  (trước là 3) và phải nằm trong `features/staged-ops/prepareApplyReject.ts`;
  không file nào ngoài `lib/daemon/endpoints.ts` được nhắc endpoint
  prepare/operations. Phép đếm **bỏ comment trước khi đếm** — chính comment giải
  thích bất biến lại chứa chuỗi đang đếm.
- `check-import-boundaries.mjs` cũng bỏ comment: một doc comment nhắc tên
  endpoint mà nó mô tả không phải là phụ thuộc.
- Negative test: thêm một bản sao luồng ghi thứ hai thì contract test đỏ
  (`2 !== 1`), gỡ ra thì xanh lại.
- `tsc --noEmit` sạch. `applyStagedOp` trả `JsonRecord` (giá trị `unknown`) thay
  vì `any` như `response.json()` cũ — siết chặt hơn, đã sửa một chỗ gọi.

---

## 2026-08-09 — Giai đoạn 1: dọn va chạm CSS

Giao diện **không đổi**. Đây là điều kiện nghiệm thu chính của giai đoạn, đã
kiểm bằng trình duyệt thật chứ không chỉ bằng script.

### Added

- `apps/web/app/design-system.css` — copy của `mau-thiet-ke/css/app.css` @
  `82f5232`, với đúng 2 sai lệch được khai ngay đầu file: khối reset gate bằng
  `body[data-ds]`, và mục 8 mở rộng khoá lệnh ghi cho `missing` / `no-plugin` /
  `mute` (mẫu chỉ khoá `busy` và `off`).
- Route `(shell)/changes` nay đặt `data-ds` và dùng class của design system —
  nó là chỗ duy nhất chứng minh `design-system.css` thật sự áp được trước khi
  `AppShell` tồn tại ở giai đoạn 3.

### Changed

- Đổi tên mọi thứ va chạm ở **phía legacy** (phía sẽ chết), không đụng phía
  design system: `--bg` → `--legacy-bg`, `--accent` → `--legacy-accent`,
  `.app` `.main` `.empty` `.modal` `.field` → tiền tố `legacy-`.
- Gate `body` và 5 rule cấp element của legacy (`select`, `textarea`,
  `textarea:focus`, `code`, `footer`) bằng `body[data-legacy="1"]`. Mọi gate
  dùng `:where()` nên **specificity không đổi** — mục tiêu là cascade giữ
  nguyên, không chỉ giao diện giữ nguyên.
- `app/page.tsx` đặt `data-legacy` trong `useEffect` và gỡ khi unmount.

### Fixed

- Gộp 3 `@keyframes` xoay giống hệt nhau (`drawing-spin`, `standards-spin`,
  `lisp-library-spin`) thành `legacy-spin`; giữ nguyên tên class vì chúng được
  dùng trong TSX. Còn 5 keyframes.
- Xoá dead code đã xác minh 0 usage: `.chips`, `.chip`, `.chip:hover`, `.log`.

### Technical

- **Đếm usage trước/sau khớp tuyệt đối** — đây là tiêu chí thay cho "khác một
  pixel" vốn không đo được: `.app` 1→1, `.modal` 1→1, `.field` 4→4, `.empty`
  2→2, `.main` 1→1 (CSS); 1/2/2/1/1 (JSX); `var(--bg)` 1→1, `var(--accent)`
  40→40.
- **Kiểm bằng Chrome thật, không chỉ bằng script.** Route legacy:
  `data-legacy="1"`, body `rgb(15,18,22)`, chữ `rgb(230,233,238)`, 15px, grid
  `240px 1fr auto`. Route shell: `data-ds="1"`, body `rgb(245,245,245)`, 13px,
  `SF Pro HK`, `--muted` `rgb(140,140,140)`, không rò `data-legacy`. Các rule
  vừa gate cũng khớp bản gốc: `select`/`textarea` nền `#1e242c`, `footer` nền
  `#171b21` viền `#2a313b`.
- Ghi vào `DEVELOPMENT.md` một bẫy dev đã mất thời gian truy: `next dev` chặn
  `/_next/*` từ `127.0.0.1`, làm React **không hydrate** — trang trông như đã
  chạy nhưng chết hoàn toàn, console không báo gì. Dùng `localhost:3000`.

---

## 2026-08-09 — Giai đoạn 0: gỡ blocker & dựng guardrail

### Added

- `KE-HOACH-CHUYEN-DOI-UI.html` — kế hoạch chuyển giao diện sang bộ mẫu
  `mau-thiet-ke/`: 11 giai đoạn, bảng 14 màn hình, danh sách bỏ, backend cần
  thêm, 11 rủi ro và 6 quyết định cần chốt.
- `DEVELOPMENT.md`, `ROADMAP.md`, `USER_GUIDE.md`, `CHANGELOG.md`.
- `apps/web/scripts/test-route-serving.mjs` — khởi động daemon thật trên cổng
  riêng (dữ liệu ghi vào thư mục tạm) và khẳng định bản đóng gói phục vụ đúng
  route: `out/changes/index.html` tồn tại, `/changes` trả 301 sang `/changes/`,
  route `/` mang đúng mốc `data-screen` của giai đoạn hiện tại, `/_next/*` thiếu
  trả 404, payload `.txt` giữ `text/plain`.
- `apps/web/scripts/check-css-collisions.mjs` — dò va chạm giữa hai hệ CSS trên
  **selector đã chuẩn hoá**, cộng trần hex literal cho `globals.css`.
- `apps/web/scripts/check-import-boundaries.mjs` — khoá 3 ranh giới thư mục của
  kiến trúc mới bằng ~100 dòng node, không dựng thêm tooling lint.
- `apps/web/app/(shell)/changes/page.tsx` — route giàn giáo để test route
  serving có đối tượng thật để kiểm.
- Script `check:css`, `check:boundaries`, `test:routes` và `verify` trong
  `apps/web/package.json`.

### Fixed

- **Bản đóng gói phục vụ sai nội dung cho mọi route con.** `next.config.mjs`
  thiếu `trailingSlash: true`, nên Next sinh `out/changes.html` mà
  `express.static` (không bật option `extensions`) không tìm ra; request rơi vào
  catch-all và trả HTTP **200** kèm nội dung route `/`. `next dev` chạy đúng nên
  lỗi chỉ lộ khi đóng gói.
- **Catch-all của daemon nuốt cả asset build và payload điều hướng client.**
  `apps/daemon/src/server.ts` nay trả 404 cho đường dẫn bắt đầu `/_next/` hoặc
  kết thúc `.txt`. Trước đó một payload RSC thiếu được trả về dưới dạng
  `index.html` kèm 200 `text/html`, làm router Next nhận HTML thay vì payload —
  điều hướng client hỏng im lặng trong khi curl route HTML vẫn xanh.

### Changed

- `apps/web/scripts/test-contract.mjs` viết lại theo glob. Bản cũ đọc 6 file
  theo path cứng, nên mọi assert phủ định (`!includes`, `doesNotMatch`) **tự
  động xanh** khi code chuyển sang file khác — đúng những bất biến an toàn nhất
  sẽ âm thầm biến mất giữa một đợt di chuyển file. Nay assert phủ định chạy trên
  toàn bộ source nối lại, assert khẳng định tra file bằng đuôi đường dẫn. Giữ
  nguyên toàn bộ bất biến cũ, thêm: chỉ một `EventSource`, không `data-write`
  trên `<button>` thô, không hardcode đường dẫn home.
- `apps/web/app/page.tsx` thêm `data-screen="legacy"` trên phần tử gốc làm mốc
  cho `test-route-serving.mjs`.

### Technical

- Kiểm chứng trực tiếp trên Next 16.2.10: khi `app/page.tsx` và
  `app/(shell)/page.tsx` cùng tồn tại, build **thành công, không một dòng cảnh
  báo**, và file trong route group bị bỏ im lặng. `test-route-serving.mjs` có
  assert cấu trúc chặn trường hợp này ngay lúc dev tạo file.
- Đo lại các con số nền của kế hoạch: `globals.css` có **1.119** hex literal khác
  nhau; va chạm CSS thật giữa hai hệ là **5 class** (`.app` `.main` `.empty`
  `.modal` `.field`) và **2 token** (`--bg` `--accent`). Ba class `.count`
  `.spacer` `.check` **không** va chạm — cả hai phía đều đã có tổ tiên riêng, nên
  bộ dò phải so trên selector chứ không trên token class rời.
- Cả ba script guardrail đã được kiểm bằng negative test: cố tình tạo vi phạm thì
  chúng đỏ, gỡ vi phạm thì xanh trở lại.

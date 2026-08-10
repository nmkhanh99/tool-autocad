# CHANGELOG

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

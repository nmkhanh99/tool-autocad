# CHANGELOG

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

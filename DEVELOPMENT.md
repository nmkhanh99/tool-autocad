# DEVELOPMENT

Tài liệu kỹ thuật cho AutoCAD Toolkit. Mục tiêu: một developer clone repo về là
chạy được, kiểm được, và tiếp tục phát triển mà không cần kiến thức ngầm.

Chỉ ghi những gì đã xác minh từ code hoặc từ kết quả chạy lệnh thật. Phần chưa
xác minh được ghi rõ `Chưa xác minh`.

---

## 1. Kiến trúc tổng thể

Ba cột ngang hàng, không cột nào phụ thuộc cột kia. Xem `README.md` cho sơ đồ
đầy đủ và `CADWEB-ARCHITECTURE.md` cho định dạng `.cadweb`.

| Cột | Đường dẫn | Vai trò |
|-----|-----------|---------|
| A. Offline core | `app/acadtool`, `app/cli.py` | Đọc DWG bằng LibreDWG, không cần AutoCAD mở |
| B. ACAD Control | `acad-studio/apps/daemon` | AcCoreConsole headless trên DWG đóng; job LISP vào phiên đang mở |
| C. ObjectARX | `objectarx/` | Plugin trong tiến trình AutoCAD (macOS), watch `job.lsp` + `raw.job` |

Giao diện người dùng nằm ở `acad-studio/apps/web`, nói chuyện với daemon qua
HTTP loopback `127.0.0.1:8788`.

---

## 2. Cấu trúc `acad-studio` (pnpm workspace)

| Package | Thư mục | Nội dung |
|---------|---------|----------|
| `@acad/web` | `apps/web` | Next.js 16.2.10, App Router, `output: "export"` |
| `@acad/daemon` | `apps/daemon` | Express 4 + tsx, control plane `/api/*` |
| `@acad/cadweb` | `apps/cadweb` | Đọc/ghi định dạng `.cadweb` |
| `@acad/sync-server` | `apps/sync-server` | Nhận snapshot `.cadweb` — **chưa được bind vào process nào** |
| `@acad/mcp` | `apps/mcp` | Adapter MCP stdio, dùng lại daemon |
| `@acad/desktop` | `apps/desktop` | Vỏ Electron |

### Giao diện web — trạng thái đang chuyển đổi

Repo đang trong quá trình chuyển giao diện sang bộ mẫu `mau-thiet-ke/`.
Kế hoạch đầy đủ: `KE-HOACH-CHUYEN-DOI-UI.html` (11 giai đoạn).

```
apps/web/
├── next.config.mjs          output: "export" + trailingSlash: true
├── app/
│   ├── layout.tsx           root layout
│   ├── page.tsx             MÀN HÌNH LEGACY — chat + 7 panel, sẽ dời ở giai đoạn 8
│   ├── globals.css          CSS legacy (3.500 dòng), sẽ bị thay ở giai đoạn 10
│   ├── design-system.css    CSS của giao diện mới, gate bằng body[data-ds]
│   ├── (shell)/             route group của giao diện mới
│   │   ├── changes/         giàn giáo giai đoạn 0
│   │   ├── library/blocks/  page.tsx + blocks.module.css (style riêng của màn)
│   │   └── library/lisp/    page.tsx (không cần CSS riêng)
│   └── *Panel.tsx           7 panel của màn hình legacy
├── components/
│   ├── shell/               khung dùng chung: Titlebar, Rail, Statusbar…
│   └── ui/                  primitive: Button, Modal, Tag, GuardStrip,
│                            WriteButton (+ AcadStateProvider), ConfirmSheet
├── features/                logic theo miền, KHÔNG import chéo nhau
│   ├── acad-connection/     đọc trạng thái AutoCAD (polling + SSE bus)
│   ├── assistant/           model tin nhắn chat
│   ├── blocks/              model + hook đọc + actions + 3 form (metadata,
│   │                        tạo từ bộ chọn, nguồn thư viện)
│   ├── lisp/                model + hook đọc + actions + 2 hộp thoại
│   │                        (nạp vào phiên, thư mục gốc)
│   └── staged-ops/          hàng chờ hai pha
├── lib/                     hạ tầng dùng chung, không thuộc feature nào
│   ├── acadState.ts         kiểu + nhãn + canWrite của trạng thái AutoCAD
│   ├── daemon/              client, endpoints (nguồn duy nhất của URL), docs,
│   │                        guards (mã lỗi daemon → câu chữ, dùng cho cả app)
│   └── storage.ts
└── scripts/                 guardrail + test hợp đồng
```

**Vì sao `ConfirmSheet` ở `components/ui/` chứ không ở `features/staged-ops/`:**
mọi màn hình có lệnh ghi đều cần nó, kể cả những lệnh **một pha** không hề đi qua
hàng chờ (`/blocks/insert`, `/blocks/sync`, `/blocks/create`). Để nó trong một
feature nghĩa là feature khác phải import chéo feature — hoặc tệ hơn, tự viết lại
ba cảnh báo bắt buộc và viết lệch đi. `check-import-boundaries.mjs` chặn vế thứ
nhất; vế thứ hai thì không script nào bắt được, nên phải giải quyết bằng vị trí.

**Vì sao `lib/acadState.ts` tách khỏi `features/acad-connection`:** `ConfirmSheet`
(ở `features/staged-ops`) cần `WriteButton`, mà `WriteButton` cần trạng thái kết
nối. Để nó ở `features/acad-connection` là buộc feature import chéo feature.
Trạng thái kết nối AutoCAD là **hạ tầng dùng chung**, không phải một feature
ngang hàng — nên phần kiểu/nhãn/`canWrite` nằm ở `lib/`, phần *đọc* trạng thái
(polling, SSE, heuristic `no-plugin` vs `mute`) ở lại feature.

**Quy tắc bất khả xâm phạm trong lúc migrate:** không được tạo
`app/(shell)/page.tsx` chừng nào `app/page.tsx` còn tồn tại. Cả hai cùng resolve
về `/`, và Next 16 **âm thầm bỏ** file trong route group — build xanh, không một
dòng cảnh báo. Đã kiểm chứng trực tiếp trên Next 16.2.10.
`scripts/test-route-serving.mjs` chặn trường hợp này.

---

## 3. Yêu cầu môi trường

| Thành phần | Phiên bản đã kiểm chứng |
|------------|-------------------------|
| Node.js | v24.14.1 |
| pnpm | 10.33.0 (khai trong `packageManager`) |
| Python | 3 (cho `app/cli.py`) |
| AutoCAD | 2027 (chỉ cần cho cột B và C) |
| ObjectARX SDK | 2027 macOS — chỉ cần khi build plugin |

Không cần AutoCAD để chạy giao diện web hay để chạy toàn bộ test dưới đây.

---

## 4. Lệnh

### Cài đặt

```bash
cd acad-studio && pnpm install
```

### Chạy

```bash
# Daemon (control plane) — http://127.0.0.1:8788
pnpm --filter @acad/daemon start

# Giao diện web ở chế độ dev — http://127.0.0.1:3000
pnpm --filter @acad/web dev

# Offline core, không cần AutoCAD
cd app && python3 cli.py info /đường/dẫn/ban-ve.dwg
```

### Kiểm tra

Chạy **tất cả** trước mỗi commit:

```bash
cd acad-studio/apps/web && pnpm verify
```

`verify` chạy lần lượt:

| Lệnh | Kiểm cái gì |
|------|-------------|
| `pnpm check:css` | Va chạm class/token giữa `globals.css` và `design-system.css`; trần hex literal của `globals.css` |
| `pnpm check:boundaries` | 3 ranh giới thư mục của kiến trúc mới |
| `pnpm check:guards` | Mọi mã lỗi daemon phát ra đều có thái độ trong UI, và ngược lại |
| `pnpm check:types` | `tsc --noEmit` trên **toàn** `tsconfig.json`, gồm cả `scripts/` |
| `pnpm test:contract` | Bất biến an toàn của UI (xem §6) + test bus sự kiện |
| `pnpm build` | Next build |
| `pnpm test:routes` | Bản đóng gói phục vụ đúng route (khởi động daemon thật) |

Ngoài ra:

```bash
pnpm --filter @acad/web test:cadweb-viewer   # 27 test cho pipeline .cadweb
pnpm --filter @acad/daemon test:standards    # tiêu chuẩn bản vẽ
pnpm --filter @acad/daemon test:cad-selection
```

> **`pnpm build` một mình KHÔNG đủ để bắt lỗi kiểu.** `next build` chỉ typecheck
> phần nằm trong đồ thị build của app, nên lỗi TypeScript trong `scripts/` lọt
> qua dù `tsconfig.json` có include thư mục đó. Vì vậy `check:types` là một bước
> riêng trong `verify` — đã có một lỗi thật lọt qua theo đúng đường này.

Chưa có: lint và format. Repo không có cấu hình ESLint hay Prettier — ba ranh
giới thư mục được kiểm bằng `scripts/check-import-boundaries.mjs` thay vì bằng
plugin lint, để không phải dựng thêm một bộ tooling chỉ cho 3 quy tắc.

---

## 5. Biến môi trường

| Biến | Mặc định | Dùng để |
|------|----------|---------|
| `ACAD_DAEMON_PORT` | `8788` | Cổng daemon |
| `ACAD_WEB_DIR` | *(trống)* | Thư mục `out/` của Next; có giá trị thì daemon phục vụ UI tĩnh |
| `ACAD_PROJECT_ROOT` | thư mục repo | Gốc dự án cho các thao tác tệp |
| `ACAD_DATA_DIR` | `~/Library/Application Support/acad-studio` | Nơi ghi `acad.sqlite` |
| `ACAD_BRIDGE_DIR` | `~/Acad-Bridge` | Hợp đồng trao đổi với plugin ObjectARX |
| `ACAD_SQLJS_WASM` | *(bắt buộc)* | Đường dẫn `sql-wasm.wasm`; script `start` đã set sẵn |
| `ACAD_WEB_URL` | *(trống)* | Thêm một origin được phép gọi daemon |

Tiền tố `MEP_*` vẫn được chấp nhận như alias cũ.

### Origin guard — nguyên nhân phổ biến nhất khi "backend trông như chết"

Daemon chạy được AutoLISP, nên `Origin` của trình duyệt là một ranh giới bảo mật.
`apps/daemon/src/originPolicy.ts` chỉ cho phép:

- `http://127.0.0.1:<PORT>` và `http://localhost:<PORT>`
- `http://127.0.0.1:3000` và `http://localhost:3000`
- origin khai trong `ACAD_WEB_URL`

Hệ quả cần biết:

- Mở `apps/web/out/index.html` trực tiếp bằng `file://` → trình duyệt gửi
  `Origin: null` → **mọi request trả 403 `origin_not_allowed`**. Phải mở qua
  daemon (`ACAD_WEB_DIR=.../out`) hoặc qua `next dev`.
- Đổi cổng dev khác 3000 mà không set `ACAD_WEB_URL` → cũng 403.

Triệu chứng giống hệt "daemon không chạy", nên hãy kiểm tra mã lỗi trước khi đi
tìm nguyên nhân khác.

### Bẫy thứ hai: `next dev` chặn `/_next/*` từ `127.0.0.1`

Mở <http://127.0.0.1:3000> ở chế độ dev cho ra một trang **trông như đã chạy
nhưng chết hoàn toàn**: HTML server-render hiện đầy đủ, còn client JS bị chặn
nên React **không hydrate** — không effect nào chạy, không nút nào bấm được, và
console không báo gì. Log của dev server mới là chỗ nói ra:

```
⚠ Blocked cross-origin request to Next.js dev resource /_next/webpack-hmr from "127.0.0.1".
```

**Luôn dùng <http://localhost:3000> khi chạy `next dev`.** (Bản đóng gói do
daemon phục vụ không dính bẫy này — nó không đi qua dev server.) Nếu bắt buộc
phải dùng `127.0.0.1`, thêm `allowedDevOrigins: ["127.0.0.1"]` vào
`next.config.mjs` rồi khởi động lại dev server.

### Kiểm giao diện bằng tay mà không đụng dữ liệu thật

Nhiều màn hình chỉ hiện được khi có dữ liệu, mà dữ liệu thật thì nằm trong thư
viện/bản vẽ của người dùng. Đừng tạo dữ liệu giả bằng cách gọi endpoint ghi của
daemon thật, và cũng đừng vá `window.fetch` trong console: thanh điều hướng dời
trang theo kiểu MPA nên bản vá mất ngay khi đổi màn hình.

Cách dùng: chạy một daemon giả ở cổng khác rồi trỏ dev server sang nó.

```bash
cd acad-studio/apps/web
node scripts/stub-daemon.mjs         # :8899, phục vụ /api/acad/* bằng dữ liệu bịa
NEXT_PUBLIC_DAEMON_URL=http://127.0.0.1:8899 npx next dev -p 3100
```

`scripts/stub-daemon.mjs` **không** nằm trong `pnpm verify` — nó là công cụ xem
bằng mắt, không phải test. Hôm nay nó mới phục vụ phần thư viện block; thêm màn
hình nào thì thêm route cho màn đó.

Hai lưu ý khi thao tác bằng công cụ tự động:

- **Cú bấm đầu tiên ngay sau khi tải trang bị nuốt** — React chưa hydrate xong.
  Bấm lại lần nữa.
- Đọc trạng thái nút **ngay trong cùng một lần chạy script** sau khi bắn sự kiện
  `input` sẽ thấy giá trị cũ: React render bất đồng bộ. Đọc ở lượt sau, hoặc
  dùng bàn phím thật.

---

## 6. Bất biến được khoá bằng test

`apps/web/scripts/test-contract.mjs` chia assert làm hai loại, cố ý:

- **Phủ định** (`doesNotMatch`, `!includes`) chạy trên **toàn bộ source nối lại**.
  Lý do: bản trước đọc 6 file theo path cứng, nên mọi assert phủ định *tự động
  xanh* khi code chuyển sang file khác — đúng những bất biến an toàn nhất sẽ âm
  thầm biến mất giữa một đợt di chuyển file.
- **Khẳng định** (`match`) gắn với một file, tra bằng **đuôi đường dẫn**. Di
  chuyển file làm test đỏ, và đỏ ở đây là tín hiệu đúng: người di chuyển phải xác
  nhận bất biến còn đúng chứ không mặc nhiên bỏ qua.

Hai phép đếm dạng "chuỗi X chỉ được xuất hiện N lần" **bỏ comment trước khi
đếm** — chính comment giải thích bất biến lại chứa chuỗi đang đếm.

Các bất biến đang được khoá:

| Bất biến | Trạng thái |
|----------|-----------|
| Không request nào nhắm bản vẽ chỉ bằng title | đang khoá |
| Kết quả API được validate trước khi render | đang khoá |
| Không hardcode đường dẫn home của developer | đang khoá |
| Chỉ MỘT `EventSource` trong toàn app | đang khoá |
| Nút ghi không đặt `data-write` lên `<button>` thô | đang khoá |
| Route `/` mang mốc `data-screen` đúng giai đoạn | đang khoá |
| Chỉ một luồng ghi (`confirmed: true` = 1, trong `features/staged-ops/`) | đang khoá |
| Không màn hình nào gọi thẳng endpoint prepare/apply/reject | đang khoá |
| Mọi mã lỗi daemon đều có thái độ trong UI | đang khoá (`check:guards`) |
| Endpoint chỉ khai ở `lib/daemon/endpoints.ts` | **chỉ áp cho `components/` và `features/`** — `app/` legacy còn 32 đường dẫn rải rác |

---

## 7. Quy ước

### Code

- TypeScript strict, không thêm thư viện khi chưa có ≥2 nơi dùng.
- Comment giải thích **tại sao**, không mô tả lại code.
- Sửa tối thiểu: mỗi dòng thay đổi phải truy được về yêu cầu cụ thể.

### CSS trong lúc migrate

Hai hệ sống song song tới giai đoạn 10:

| File | Gate | Dùng cho |
|------|------|----------|
| `app/globals.css` | `body[data-legacy="1"]` | màn hình legacy (`app/page.tsx`) |
| `app/design-system.css` | `body[data-ds]` | mọi route trong `app/(shell)/` |

Component đặt attribute trong `useEffect` và **phải gỡ khi unmount** — nếu không,
điều hướng sang hệ kia sẽ kéo theo nền của hệ này.

Ba quy tắc:

1. **Luôn đổi tên phía sẽ chết** (`globals.css` → tiền tố `legacy-`), không bao
   giờ đổi phía design system — đổi là fork khỏi `mau-thiet-ke/css/app.css` và
   không đồng bộ lại được nữa.
2. **Mọi gate dùng `:where()`** để giữ nguyên specificity. Mục tiêu của giai đoạn
   1 là giao diện không đổi một pixel, nên cascade cũng không được đổi.
3. **`design-system.css` chỉ được lệch khỏi mẫu theo danh sách khai ở đầu file.**
   Hiện có đúng 2 sai lệch: gate reset, và mở rộng khoá lệnh ghi cho
   `missing`/`no-plugin`/`mute`.

Va chạm đã đo được và đã xử lý (5 class + 2 token): `.app` `.main` `.empty`
`.modal` `.field`, `--bg` `--accent`. Các class `.count` `.spacer` `.check`
**không** va chạm — cả hai phía đều đã có tổ tiên riêng, nên bộ dò so trên
selector chứ không trên token class rời.

### Git

- Không commit thẳng `main`; mỗi giai đoạn một nhánh.
- Trước mỗi commit: chạy `pnpm verify`, cập nhật tài liệu, chạy Codex review.
- Commit message theo `type(scope): mô tả`.

---

### Duyệt AutoLISP là thao tác của app desktop, không phải của web

Một ràng buộc dễ mất công nếu không biết trước. `POST /api/acad/lisp/:id/approval-challenge`
đòi một `userProof` **ký bằng Ed25519**:

- khoá riêng nằm trong tiến trình chính của Electron (`apps/desktop/main.js`),
  phơi ra cho renderer qua `window.acadStudio.signReview` trong `preload.js`, và
  chỉ nhận request từ origin `127.0.0.1|localhost:8788|3000`;
- daemon kiểm bằng `ACAD_REVIEW_PUBLIC_KEY` — biến này **chỉ được đặt khi daemon
  do app desktop spawn**. Chạy `pnpm --filter @acad/daemon start` thì biến rỗng
  và `validUserReviewProof()` trả `false` với mọi request.

Hệ quả: trong lúc phát triển bằng `next dev` + daemon chạy tay, **không có cách
nào duyệt được** — và đó là hành vi đúng, không phải lỗi cấu hình. Bằng chứng
của lượt duyệt được lưu trong `manifest.review` (`analysisCoverage`,
`acknowledgedIncompleteAnalysis`, `approvedSourceHash`), nên màn hình đọc vẫn
hiện được đầy đủ mà không cần ký gì.

---

### Hình học bản vẽ: `geometry.req` → `geometry.json`

Kênh riêng, **tách khỏi `drawing-info`** — snapshot đó đã 350 KB khi chưa có toạ
độ nào. Daemon: `GET /api/acad/geometry?target&space&layer&maxEntities`.

Request nhiều dòng: `requestId` · `target` · rồi từng `key=value`. Vì có nhiều
dòng nên `buildGeometryRequest()` **chặn tiêm dòng** — một `space` chứa `\n` có
thể chèn thêm `maxEntities=99999` vào chính request mà người gọi cố ý giới hạn.

**Nội dung định nghĩa block nằm ở `blocks`, không ở `entities`.** Bản vẽ
as-built của dự án chỉ có 259 đối tượng ở cấp trên cùng (127 là lần chèn block,
không XREF nào); cả mặt bằng kiến trúc, khung tên, trục, cửa, hatch nằm trong 95
định nghĩa block. Bỏ qua `blocks` là mất 97% bản vẽ.

- `blocks` là `{ "tên block": [đối tượng…] }`, toạ độ trong hệ của block, gửi
  **một lần** mỗi block dù được chèn bao nhiêu lần.
- Mỗi `insert` mang `m` = affine 2D `[a,b,c,d,e,f]` lấy từ `blockTransform()`:
  `x' = a·x + c·y + e`, `y' = b·x + d·y + f`. Đã gồm điểm chèn, điểm gốc block,
  tỉ lệ âm, trục không vuông góc — dựng lại từ `rot`+`sc` chỉ đúng ở trường hợp
  đơn giản nhất.
- Đối tượng bên trong định nghĩa **không có `sp`**: chúng không thuộc không gian
  nào, chúng thuộc không gian của lần chèn.
- Block lồng nhau duyệt theo lớp, trần độ sâu 8; renderer cũng phải tự chặn độ
  sâu chứ không tin payload.
- Bung ra để vẽ thì Model của bản vẽ này thành **~38.000 node SVG** — renderer
  phải memo hoá cảnh theo dữ liệu, không theo khung nhìn.

⚠️ **`bounds` có thể KHÔNG chứa hết `entities`.** Nó gom từ `getGeomExtents()`,
mà block rỗng thì hàm đó báo không hợp lệ. Trên bản vẽ thật có 5 block đặt lạc
cách bản vẽ hàng triệu đơn vị nằm ngoài `bounds`. Nơi nào fit khung theo `bounds`
đều phải tự đếm số đối tượng nằm ngoài và nói ra.

Ba điều mọi nơi tiêu thụ dữ liệu này phải mang theo:

1. **`a:1` = hình vẽ ra không phải hình thật của đối tượng**, và `aw` nói vì
   sao: `bounding-box` (DIMENSION, HATCH, MULTILEADER, VIEWPORT…) hay
   `mline-centerline` (MLINE — tức là ống — chỉ có tim, không có hai đường
   thành). Trên bản vẽ as-built của dự án, đó là **103/258** đối tượng.

   `a` **không** nói gì về block: một INSERT không có `a` vẫn có thể không vẽ
   được gì, nếu định nghĩa của nó không có trong `blocks`. Độ trung thực phải
   suy từ `k` + `aw` + có hay không định nghĩa block.
2. **`truncated`** — vẽ 3.000/47.000 đối tượng mà im lặng thì người dùng tin đó
   là cả bản vẽ.
3. **`bounds` là map theo từng space**, không phải một khung. Toạ độ giấy tính
   bằng mm trên tờ giấy; model có thể ở toạ độ trác địa cách gốc hàng triệu đơn
   vị. Gộp lại cho ra một khung vô nghĩa.

Giới hạn **ba** phía, vì có ba cách khác nhau để làm treo AutoCAD:

| Trần | Giá trị | Chặn điều gì |
| --- | --- | --- |
| `maxEntities` (xuất) | mặc định 20.000, cắt cứng 100.000 | payload quá lớn → `truncated` |
| `kGeomMaxScanned` (quét) | 200.000 | bộ lọc layer **không khớp gì** vẫn duyệt cả bản vẽ → `geometry_scan_cap_reached` |
| tổng byte | 24 MB | nhiều polyline 4.000 đỉnh cộng lại |
| `kGeomMaxBlockEntities` | 60.000 | nội dung định nghĩa block (ngân sách RIÊNG) |
| `kGeomMaxBlockDepth` | 8 | block lồng nhau, kể cả vòng lặp A→B→A |

Trần xuất và trần quét phải tách nhau: `maxEntities` chỉ đếm thứ đã xuất, nên
một tên layer gõ sai không bao giờ chạm tới nó — plugin vẫn mở và soi từng đối
tượng của cả bản vẽ dù người gọi xin đúng 1. Hai cảnh báo cũng khác nghĩa: chạm
trần xuất là *còn đối tượng khớp chưa gửi*; chạm trần quét là *còn phần bản vẽ
chưa nhìn tới*.

Thêm 4.000 đỉnh mỗi polyline. Plugin chạy trên **main thread** của AutoCAD.

`maxEntities` được **kẹp về [1, 100.000] trước khi tuần tự hoá**, không phải chỉ
làm tròn: `0.5` xuống 0 thì plugin coi là "không có giới hạn" rồi dùng mặc định
20.000, còn `1e21` ra chuỗi `"1e+21"` mà `atoll` chỉ đọc được `1`. Cả hai đều
cho ra thứ ngược hẳn với ý người gọi.

Chỉ xuất X/Y (`projection:"xy"`).

**Kiểu hình (`k`).** `line`, `poly` (có `bulge`), `circle`, `arc`, `ellipse`,
`point`, `text`, `insert`, `box` (hình bao), `multi` (nhiều hình con trong `g` —
dùng cho HATCH: một đối tượng chọn được, nhiều hình bên trong).

`ellipse` xuất **gọn** bằng 7 số chứ không lấy mẫu; `a0`/`a1` của nó là **tham
số**, không phải góc thật: `P(t) = C + rx·cos(t)·u + ry·sin(t)·v`. Đem `atan2`
ra tính lại là sai ở mọi elip không tròn.

**Thứ tự thử khi dựng hình một đối tượng** (`entityGeometryJson`): kiểu riêng đã
biết (line, polyline, circle, arc, ellipse, MLINE, HATCH, DIMENSION) → `AcDbCurve`
lấy mẫu (SPLINE…) → **`worldDraw`** → hình bao. Mỗi bậc là một mức trung thực
thấp hơn, và `aw` nói rõ đang ở bậc nào.

⚠️ **Chỉ dùng API KHÔNG giao quyền sở hữu.** `AcDbHatch::getLoopAt` dạng mảng
`AcGeCurve2d*` giao việc giải phóng cho người gọi — đã thử làm đúng theo tài
liệu và AutoCAD chết sau đúng một lượt đọc (hỏng heap). `worldDraw`,
`AcDbCurve::getPointAtParam`, `getHatchLinesData` đều chỉ đưa dữ liệu vào, không
cấp phát cho ai. Giữ nguyên tắc đó.

**Hiệu năng — ba con số đã đo, đừng đoán lại:**

| | |
| --- | --- |
| Lượt đọc end-to-end | 0,37 s (plugin quét 0,28 s + daemon 0,09 s) |
| Payload | 1,82 MB, 95% là `blocks` |
| Node SVG của Model | 1.468 (bung thẳng không gộp: 11.304; không dùng `<defs>`: 38.223) |

- Daemon **không** tuần tự hoá lại: `res.json(obj)` tốn 29 ms để dựng lại đúng
  chuỗi plugin đã ghi.
- Nhịp dò phản hồi **thích ứng** (15 ms trong giây đầu rồi giãn), không cố định.
- **Không nén.** Đã đo: gzip mức 1 tốn 30 ms CPU để bớt 1,3 MB trên loopback —
  end-to-end chậm hơn. Đừng thêm `compression`.
- Renderer phải dùng `<defs>`+`<use>` và **gộp nét** trong từng định nghĩa. Bung
  thẳng 38.000 node đã treo cả tab Chrome một lần.

**Sửa plugin thì phải khởi động lại AutoCAD** — ghi đè bundle không ảnh hưởng
tiến trình đang chạy. Sao lưu bản cũ trước khi `./build.sh` (có `--build-only`
để chỉ biên dịch).

---

## 8. Hạn chế kỹ thuật đã biết

- **Không in được tệp DWG đóng trên macOS** — `-PLOT` headless crash. Đây là giới
  hạn của AutoCAD, không phải tính năng chưa build.
- **Thao tác chờ duyệt không persist.** Sáu cơ chế staged trong daemon đều sống
  trong `Map` RAM; khởi động lại daemon là mất sạch, và không có API liệt kê tất
  cả.
- **Sync `.cadweb` chưa có máy chủ nhận.** `createSyncHttpHandler` hiện chỉ được
  gọi trong test.
- **`/api/acad/docs` không trả trạng thái đã lưu (`dbmod`).** Nó chỉ có trong
  snapshot `/drawing-info`, mỗi lần đọc là một lời gọi nặng cho một bản vẽ.
- **21% code của web app là prototype không backend** — `PreconstructionPanel`
  (0 lời gọi API) và `DocumentReviewPanel` (1 lời gọi). Xem `ROADMAP.md`.

---

## 9. Mô hình dữ liệu

Chưa có tài liệu đầy đủ. Nguồn đáng tin hiện tại:

- Định dạng `.cadweb`: `CADWEB-ARCHITECTURE.md`
- Hợp đồng bridge với plugin: `README.md` §"Shared bridge contract"
- Kiểu dữ liệu API: `acad-studio/apps/daemon/src/*.ts`

Sẽ bổ sung sau khi từng màn hình được migrate và kiểu dữ liệu được gom về
`lib/daemon/`.

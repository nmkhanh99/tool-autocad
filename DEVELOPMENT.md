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

> **`mau-thiet-ke/` KHÔNG còn nằm trong repo** (bỏ theo dõi 2026-08-12, xem
> `.gitignore`). Nó là bản dựng thử của người thiết kế, được sinh lại liên tục
> bằng công cụ, và app thật **không import một dòng nào** từ đó — nó là tài liệu
> tham chiếu, không phải mã nguồn. Để trong repo thì mỗi lượt chỉnh mẫu đẻ ra
> một diff hàng trăm dòng lẫn vào diff thật.
>
> **Bản đã commit vẫn tra được trong lịch sử tại `82f5232`:**
>
> ```bash
> git show 82f5232 --stat -- mau-thiet-ke/          # xem có những file gì
> git show 82f5232:mau-thiet-ke/css/app.css         # đọc một file
> git checkout 82f5232 -- mau-thiet-ke/             # lấy lại cả thư mục
> ```
>
> Bản **mới nhất** không nằm trong lịch sử — nó chỉ có trên máy người thiết kế.
> Mọi trích dẫn từ bộ mẫu trong tài liệu này vì vậy phải nêu rõ giá trị được
> trích, đừng bắt người đọc mở file mới hiểu.

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
│   ├── standards/           model (hồ sơ + lượt quét + mọi ràng buộc) và
│   │                        ProfileTables.tsx — ba bảng sửa tại chỗ của
│   │                        /standards, dùng chung bởi /standards và /review
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
cd acad-studio && pnpm verify
```

Chạy từ `acad-studio/`, KHÔNG từ `apps/web/`. Bản ở gói web không kiểm daemon,
và một lỗi kiểu thật đã lọt qua đúng khe đó: thêm một trường tuỳ chọn vào
`OpenAcadDocument` làm `cadSelection.ts` không biên dịch được, mà `verify` của
web vẫn xanh. Nay `acad-studio/pnpm verify` chạy `typecheck:daemon` trước rồi
mới tới `verify` của web.

`verify` chạy lần lượt:

| Lệnh | Kiểm cái gì |
|------|-------------|
| `pnpm typecheck:daemon` | `tsc --noEmit` trên gói daemon |
| `pnpm --filter @acad/daemon test:cad-selection` | Hai pha, chốt độ tươi, chốt không gian Model/Layout |
| `pnpm --filter @acad/daemon test:standards` | Hồ sơ quy tắc, chốt độ tươi theo sự kiện, router |

rồi chuyển sang gói web:

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
   giờ đổi phía design system — đổi là fork khỏi `mau-thiet-ke/css/app.css`
   (không còn trong repo; bản gốc ở `git show 82f5232:mau-thiet-ke/css/app.css`)
   và không đồng bộ lại được nữa.
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

**`document` mang bốn thứ, không chỉ tên tệp:** `title`, `file`, `instance`,
`space`, `revision`. Cặp `instance` + `revision` là **guard** mà
`/selection/prepare` đòi khi chọn đối tượng theo handle, và nó **phải** lấy từ
chính lượt đọc đã sinh ra handle. `space` là **không gian hiện hành của
AutoCAD** — chọn theo handle chỉ chạy với đối tượng ở không gian đó; các không
gian khác trả `not a top-level entity in current space`.

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
`point`, `text`, `mtext` (nhiều dòng trong `lines`), `insert`, `box` (hình bao),
`multi` (nhiều hình con trong `g` — dùng cho HATCH và cho hình bắt qua
`worldDraw`: một đối tượng chọn được, nhiều hình bên trong).

**Chữ.** `ha`/`va` là neo theo quy ước `text-anchor`/`dominant-baseline` của
SVG, và **đi kèm với điểm neo**: khi căn lề khác trái, `p` là điểm căn lề chứ
không phải điểm chèn. Bỏ qua `ha` mà vẫn dùng `p` là vẽ lệch đúng bằng chiều dài
dòng. `xs` là hệ số bề ngang (vắng mặt là 1). `ls` là khoảng cách dòng tính bằng
**bội của chiều cao chữ**; neo dọc ôm **cả khối** chữ, không phải dòng đầu.

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

### `/api/acad/docs` — danh sách bản vẽ đang mở

Lời gọi NHẸ, khác hẳn `drawing-info` (350 KB). Đây là nguồn "mới nhất" của màn
hình `/drawing-info`: hồ sơ chỉ đọc lại khi người dùng bấm, còn danh sách này tự
nạp theo sự kiện reactor. Mọi phép so "hồ sơ còn khớp bản vẽ không" đều dựa vào
nó.

Plugin dựng payload trong `writeDocs()` (`objectarx/mepbridge.cpp`); kiểu phía
daemon là `OpenAcadDocument`, phía web là `AcadDocument` (`lib/daemon/docs.ts`).

| Trường | Ý nghĩa | Thiếu thì sao |
|---|---|---|
| `title`, `file` | Tên và đường dẫn. Bản vẽ **chưa lưu** có `file` rỗng | — |
| `active` | Bản vẽ đang hoạt động. Daemon đòi đúng **một** | UI chặn mọi lệnh ghi |
| `instance` | Mã phiên của database trong tiến trình AutoCAD | Không so được độ tươi |
| `revision` | Bộ đếm sửa đổi của database | Không bắt được "đã sửa" |
| `dbmod` | 1 = chưa lưu, 0 = sạch | **KHÔNG BIẾT**, không phải "đã lưu" |
| `space` | Không gian hiện hành (Model hoặc tên layout) | Không bắt được đổi tab |

Ba trường cuối là tuỳ chọn vì plugin bản cũ không phát chúng. **Thiếu phải hiểu
là "không biết", không được suy ra giá trị mặc định** — xem `savedState()` và
`profileStaleReason()` trong `features/drawing-info/model.ts`.

> `OpenDocument` trong `cadSelection.ts` là `Required<Omit<OpenAcadDocument,
> "dbmod" | "space">>`. Mọi trường tuỳ chọn thêm vào sau này **phải** được loại
> ra khỏi `Omit` đó, nếu không nó tự động thành bắt buộc và daemon không biên
> dịch được.

### Sự kiện reactor (`GET /api/acad/events`, SSE)

Plugin ghi `~/Acad-Bridge/events.jsonl`; daemon tail file đó mỗi 500 ms và đẩy
qua SSE. Các loại mà `/drawing-info` nghe:

| Sự kiện | Nguồn trong plugin | Vì sao cần |
|---|---|---|
| `docOpened` / `docClosed` / `docActivated` | `AcApDocManagerReactor` | Danh sách bản vẽ đổi |
| `drawingModified` | `commandEnded` + cờ dirty của DB reactor | Revision đã nhảy |
| `drawingSaved` | `AcRxEventReactor::saveComplete` | KHÔNG đi qua `commandEnded` |
| `layoutSwitched` | `AcEditorReactor::layoutSwitched` | Bấm tab không qua lệnh nào |
| `pluginLoaded` | Nạp plugin | Phục hồi sau khi AutoCAD khởi động lại |

> **Kết nối SSE phát lại 15 dòng cuối** mỗi lần mở, kể cả khi tự nối lại giữa
> phiên. Nơi nào coi một sự kiện là "vừa mới xảy ra" phải khử trùng lặp bằng
> **cả hai** cách, vì mỗi cách chỉ bịt một nửa:
>
> - **Khoá danh tính** `(at, detail)` — bắt bản phát lại rơi đúng giây đang xét,
>   thứ mà phép so mốc thời gian (chỉ tới giây) không phân biệt được.
> - **Mốc thời gian** so với lúc bắt đầu thao tác — bắt sự kiện xảy ra trong lúc
>   SSE đứt, thứ mà khoá danh tính không biết vì trang chưa từng nhận nó.
>
> Và daemon gắn `replay: true` cho đúng 15 dòng đó. **Chỉ máy chủ biết khung nào
> là lịch sử** — phía web không suy ra được, vì dấu thời gian chỉ tới giây nên
> một dòng cũ phát lại trong cùng giây người dùng bấm trông y hệt tin mới. Nơi
> nào HUỶ thao tác theo sự kiện phải bỏ qua khung `replay`; nơi nào chỉ nạp lại
> dữ liệu thì dùng bình thường.

**Quy tắc chung, đã sai bảy lần trong một lượt:** với mọi trường tuỳ chọn của
plugin, `undefined` (thiếu trường) và `""` (có trường nhưng rỗng) là HAI chuyện
khác nhau — tương thích ngược và một lần đọc hỏng. Gộp chúng lại là biến lỗi đọc
thành giấy phép đi qua. Giao thức raw xuống plugin không tự phân biệt được, nên
phải kèm cờ hiện diện riêng (`spaceKnown`).

### `/api/acad/standards/*` — hồ sơ quy tắc và lượt quét

Hai màn hình dùng chung một API, và ràng buộc giữa chúng là thứ dễ sai nhất.

| Endpoint | Việc | Ghi vào bản vẽ |
|---|---|---|
| `GET/POST /profiles` | Danh sách, tạo | không |
| `PUT /profiles/:id` | Sửa. Nhận `If-Match` | không |
| `POST /scan` | Quét, trả `scanId` + `profileRevision` + `profileVersion` | không |
| `POST /apply` | Sửa theo phát hiện | **CÓ — một pha** |

> **Khe còn lại, đã biết:** `runJob()` **kích hoạt** bản vẽ đích trước khi chạy
> job ghi, nên chốt trong chương trình LISP luôn thấy đúng bản vẽ. Đổi tab trong
> quãng giữa lúc daemon kiểm và lúc job chạy vẫn dẫn tới ghi nhầm. Xem
> `ROADMAP.md` mục nợ kỹ thuật.

> **`/apply` tự kiểm bản vẽ đích ĐANG HOẠT ĐỘNG** ngay sát lúc dispatch, vì job
> nó chạy không read-only: đích không active thì AutoCAD tự kích hoạt rồi ghi
> vào đó. Giao diện có chốt riêng, nhưng nó đọc `/docs` ở một thời điểm trước đó
> và người dùng đổi tab bất cứ lúc nào — chốt duy nhất không có khe đua là chốt
> tại daemon.

> **`/apply` ghi MỘT PHA.** Nó dispatch LISP thẳng vào AutoCAD: không có
> `prepare`, không có id để huỷ, không vào hàng chờ của `/changes`. Thẻ xác nhận
> phải dùng `mode="immediate"`; dùng `"staged"` là hứa một bước rút lui không
> tồn tại.

#### Các trường `drawing` giao diện gửi lên

Cả sáu đều **bắt buộc** — `sanitizeDrawing` gọi `numberValue()`/`stringValue()`,
và cả hai từ chối thiếu hoặc rỗng. Khoảng giá trị lấy đúng từ
`standardsProfile.ts`, đừng đoán:

| Trường | Kiểu | Ràng buộc | Ai đọc lúc áp dụng |
|---|---|---|---|
| `unit` | chuỗi | ≤64 ký tự, không rỗng | — |
| `insunits` | số | nguyên `0…24` | `apply-units` |
| `precision` | số | nguyên `0…8` | `apply-units` |
| `modelScale` | số | `0.000001…1e9` | so khung với khổ giấy |
| `linearFormat` | chuỗi | ≤64 ký tự — nhưng `linearFormat()` lúc áp dụng **chỉ hiểu** `Decimal`/`Scientific`/`Engineering`/`Architectural`/`Fractional` hoặc số `1…5` | `apply-units` (→ LUNITS) |
| `frameTolerancePercent` | số | `0…100` | `expectedSheet()` — khung lệch quá bao nhiêu phần trăm thì báo lỗi |

Hai trường cuối từng **vô hình** ở màn `/standards`: chúng sống sót qua mỗi lượt
lưu nhờ phép vá `...drawing`, nên không ai mất dữ liệu và cũng không ai biết
chúng tồn tại. Cùng loại lỗi với 20 trường `dimension` từng bị giấu.

`linearFormat` là ví dụ rõ nhất của **hai tầng kiểm khác nhau**: kho hồ sơ nhận
mọi chuỗi ≤64, còn bước áp dụng chỉ hiểu năm tên. Gõ `6` là lưu êm rồi hỏng ở
`apply-units`. `profileSaveBlockedReason()` chặn theo tầng **chặt hơn** — cùng
cách đã làm với màu `RGB(...)` và bề dày dạng chữ lạ.

Giới hạn độ dài các trường chữ khác gom trong `MAX_LENGTHS` của
`features/standards/model.ts`: tên layer 255, kiểu nét 255, nhãn ánh xạ 160,
loại ánh xạ 64.

Hồ sơ mang **hai** chỉ số phiên bản, cố ý không thay thế nhau:

| Trường | Kiểu | Dùng để | Lưu nội dung y hệt |
|---|---|---|---|
| `revision` | hash sha256 của nội dung | `If-Match`, chốt lượt quét | không đổi |
| `version` | số đếm, tăng khi nội dung đổi | hiển thị cho người | không tăng |

`version` nằm NGOÀI phép tính hash — đưa vào là tự tham chiếu. Và
`sanitizeProfile` không tự quyết nó: chỉ `upsertProfile` mới biết bản trước đó
là gì để so nội dung.

**`profile.revision` là HASH NỘI DUNG, không phải bộ đếm.** Hai hệ quả:

- Đọc nó như số (`Number(...)`) cho ra `NaN` và mọi phép so đều sai.
- Lưu một hồ sơ mà nội dung không đổi thì hash y nguyên, nên lượt quét đang mở
  **vẫn dùng được**. Chỉ thay đổi thật mới giết nó.

`/apply` so `profile.revision` với `session.profileRevision` và trả 409 khi
lệch. `profileDriftNote()` bắt trước ở giao diện — panel legacy không cần nó vì
nó khoá nút quét khi hồ sơ còn thay đổi chưa lưu.

`profileVersion` được **chụp vào phiên quét** chứ không tính lúc trả lời. Đọc bộ
đếm hiện tại khi vẽ màn hình sẽ khoác số mới cho một lượt quét cũ — đúng thứ mà
chip này sinh ra để bác bỏ.

> **Ghi hồ sơ phải VÁ lên bản ghi gốc.** Bản nháp trong giao diện là hình dạng
> phẳng do màn hình tự đặt cho dễ dựng form; máy chủ lưu dạng lồng với
> `dimension` **23 trường** mà form có ô riêng cho 3. Gửi thẳng bản nháp là ghi
> đè 20 trường còn lại bằng mặc định — không lỗi nào báo và không test nào đỏ.
> Xem `applyProfileEdits()`.
>
> 20 trường đó nay **hiện ra và sửa được** ở bảng `DimensionExtras`, dựng từ
> chính dữ liệu hồ sơ. `ObjectMapping` cũng có `bounds` tuỳ chọn mà form không
> mô hình hoá, nên `applyProfileEdits()` vá mapping lên bản ghi gốc thay vì dựng
> lại. `LayerStandard` thì **đúng năm trường**, không có gì để giữ.
>
> Phép vá bám `MappingRule.sourceId` — mã **lúc nạp về** — chứ không bám `id`
> đang hiện. Ô mã sửa được, và bám `id` thì vừa chữa một lỗi gõ là phép tìm
> trượt và `bounds` biến mất không một lời báo. `sourceId` rỗng = dòng thêm mới
> ở giao diện, không có bản ghi gốc nào để giữ.

Bảng `DimensionExtras` là ô chữ tự do trên dữ liệu **có kiểu**, nên kiểu phải
lấy từ hồ sơ **đã lưu**, không từ giá trị đang gõ: xoá trắng một trường số làm
nó thành `""`, và suy kiểu từ đó thì mọi ký tự gõ tiếp đều thành chuỗi.
`numberValue()` từ chối thẳng chuỗi — kể cả `"2"` — và `booleanValue()` từ chối
`"false"`. Vì vậy `profileSaveBlockedReason()` nhận thêm tham số `baseline`, và
trường boolean render bằng ô tích chứ không phải ô chữ.

#### Bề dày nét có HAI kiểu dữ liệu, và hai thang đo khác nhau

Đây là chỗ tôi đã sai một lần, và cái sai không lộ ra cho tới lúc lưu:

| Nơi | Dạng đặc biệt | Dạng số |
|---|---|---|
| Kho hồ sơ (`standardLineweight`) | **chuỗi** `Default`/`ByLayer`/`ByBlock` | **milimét**, `0 … 2.11` |
| DXF group 370 (sau `lineweight()`) | `-3` / `-1` / `-2` | 1/100 mm, `0 … 211` |

Bảng chọn của giao diện phải theo cột **kho hồ sơ**. Dựng theo cột DXF thì 26
trong 27 lựa chọn ăn 400 lúc lưu. Đo trực tiếp trên daemon: `40` → 400 *"phải
nhỏ hơn hoặc bằng 2.11"*, `-3` → 400 *"phải lớn hơn hoặc bằng 0"*, `"Default"`
→ 200. Việc đổi sang mã âm là của `lineweight()` ở bước **áp dụng**, không phải
của kho.

Một chuỗi ngoài ba tên trên **lưu được** nhưng `lineweight()` không hiểu, nên nó
hỏng ở bước áp dụng. `layerRowErrors()` chặn tại chỗ nhập vì lỗi hiện ra nơi sửa
được thì rẻ hơn nhiều.

#### `kind` của ánh xạ chỉ có HAI hành vi, không phải bốn

`acadstd:scan-map` trong `acad-lisp/headless/standards_lib.lsp` rẽ nhánh đúng
một lần, trên `"ROOM"` (so bằng `strcase`). Mọi giá trị khác chạy chung
`acadstd:map-entity-p`, và hàm đó đọc `nth 3` (layer), `nth 4` (block), `nth 6`
(loại đối tượng) — **không bao giờ đọc `nth 5` (mẫu chữ)**.

| `kind` | mẫu layer | mẫu block | mẫu chữ | loại đối tượng |
|---|---|---|---|---|
| `room` | dùng | dùng | **dùng** — chọn nhãn TEXT/MTEXT rồi tìm đường bao kín chứa nó | dùng |
| mọi giá trị khác | dùng | dùng | **bỏ qua** | dùng |

`kind` vẫn có ý nghĩa thứ hai ở tầng daemon: `standardsEngine.ts` nhận diện
khung tên bằng `/frame|sheet|title.?block|khung/i` trên `kind` + `mappingId`.

**Mẫu rỗng nghĩa là KHỚP TẤT CẢ, không phải "bỏ qua".** `acadstd:pattern-p` trả
`T` ngay khi mẫu rỗng, và `map-entity-p` coi *layer rỗng VÀ block rỗng* là khớp
mọi thứ. Một ánh xạ không có mẫu layer/block/loại nào sẽ vơ cả bản vẽ vào bảng
bóc tách — im lặng, và trông như đã cấu hình xong. `mappingRowErrors()` chặn nó.

#### Nhập layer từ bản vẽ — ba cái bẫy của một tính năng "chỉ đọc rồi chép"

`/standards` **không gắn với bản vẽ nào**, nên nó chỉ đọc `/api/acad/docs` cho
đúng một việc: hỏi hộp thoại nhập layer lấy từ đâu. Danh sách đó bám bus sự kiện
(`doc*`, `drawingSaved`, `pluginLoaded`) và có vé chống đua như `/review`.

Ba thứ dữ liệu phải đúng, và cả ba đều từng sai:

1. **Bề dày là mã DXF group 370, không phải milimét.** Plugin gửi thẳng
   `(int)layer->lineWeight()`. Kho hồ sơ nhận ba **tên** và số **milimét**
   `0…2.11`. `lineweightFromDxf()` chia thẳng cho 100 — không dùng ngưỡng đoán —
   và làm tròn hai chữ số, vì `13/100` trong dấu phẩy động là
   `0.13000000000000003`, một giá trị không khớp mục nào trong ô chọn.
2. **`layers_truncated` phải chặn kết luận "không còn".** Riêng bảng layer cắt ở
   `kInfoMaxLayerItems` = **5.000**, tách khỏi `kInfoMaxTableItems` = 500 vẫn dùng
   chung cho linetype/textstyle/dimstyle; plugin công bố cả hai trong `limits`.
   Một danh sách cụt không đủ để nói layer nào *không còn* trong bản vẽ — nên
   nhóm xoá bị ẩn khi cờ này bật, còn hai nhóm kia vẫn dùng được vì chúng chỉ
   chạm tới layer thật sự đọc được. **Ngưỡng lớn hơn không phải là phân trang**:
   bản vẽ quá 5.000 layer vẫn ẩn nhóm xoá.
3. **Dòng có thuộc tính không ĐỌC ĐƯỢC phải bị bỏ, không được điền mặc định.**
   Plugin luôn phát đủ `aci` · `linetype` · `lineweight`; một dòng thiếu bất kỳ
   cái nào không phải dòng bảng layer. Ba ca nữa cũng rơi vào `skipped`, vì cả ba
   đều kết thúc ở một màu bịa: `rgb` hỏng (`reconcileLayers` làm
   `source.color ?? 7`), ACI `0` (ByBlock) và ACI `256` (ByLayer) — layer không kế
   thừa màu từ chính nó, và `layerColor()` đổi cả hai thành `7` lúc áp dụng. Điền
   mặc định rồi trình bày như thể đọc từ bản vẽ là bịa dữ liệu, ngay trong tính
   năng mà cả điểm của nó là "lấy đúng giá trị bản vẽ đang dùng".

`layers_unavailable` / `layers_iterator_unavailable` **khác** "bản vẽ không có
layer nào" — điều sau không tồn tại, mọi bản vẽ đều có ít nhất layer `0`. Hai
cảnh báo đó nghĩa là plugin không đọc được bảng, và câu thông báo phải chỉ đường
build lại plugin.

**Định danh ảnh chụp là `instance`, không phải đường dẫn.** Đóng rồi mở lại cùng
một tệp cho ra `instance` khác — cùng đường dẫn nhưng là một database khác, và
ảnh chụp cũ khi đó nói về thứ không còn tồn tại.

**Bản vẽ chưa lưu chỉ đích danh được bằng `instance`.** `findDocExact` (plugin)
nhận mã phiên làm đích, và `selectOpenDocument` (daemon) khớp `instance` **xen
giữa** đường khớp theo đường dẫn file và đường khớp theo tiêu đề. Nhưng
`requestTargetOf()` phải TÁCH khỏi `targetOf()`: hai hàm trả lời hai câu khác
nhau — "chỉ đích danh cách nào chắc nhất" để GỬI, và "máy chủ gọi bản vẽ này là
gì" để SO với `scan.target`, thứ daemon đặt bằng `file || title`. Gộp lại là hỏng
`/review`.

**Phía daemon phải tách y hệt**, và bỏ sót chỗ này là sửa một tầng rồi hỏng ở
tầng kế: route `GET /drawing-info` giữ `exactTarget` = `file || title`, nhưng gọi
plugin bằng `nativeDocumentTarget()` = `file || instance || title`. Lý do
`exactTarget` không được đổi theo: nó còn chảy vào `withLegacySelectionCatalog`,
nơi guard LISP so `acad:cat-expected` với `DWGNAME`/`DWGPREFIX+DWGNAME` — LISP
không biết mã phiên là gì, nên đưa mã phiên vào đó biến một lượt chạy được thành
`selection_catalog_target_mismatch`. Hai đích không bao giờ cần đúng cùng lúc:
đường legacy chỉ chạy với bản plugin cũ, mà bản cũ cũng không có `findDocExact`
nhận mã phiên.

**Plugin phải CÔNG BỐ là nó nhận mã phiên** — `targetsInstance: true` trong danh
sách bản vẽ. Đây là chỗ ba vòng Codex review liên tiếp đều trượt: `instance` có
trong payload từ lâu, còn `findDocExact` mới biết nhận nó làm đích, và mỗi tầng
tự suy cái sau từ cái trước lại hỏng một kiểu. Thiếu cờ = plugin bản cũ →
`sendTarget()` gửi tiêu đề, `pickable()` loại bản vẽ chưa lưu trùng tiêu đề. Cả
hai hàm sống ở `model.ts` chứ không ở component, vì nằm trong component thì không
khoá được bằng test.

**Lượt lùi về tiêu đề phải chốt lại bằng mã phiên.** Plugin cũ trả `not_found`
cho mã phiên, nên route lùi về `exactTarget` — nhưng phép kiểm "tiêu đề không mơ
hồ" đo trên `open.docs`, một ảnh chụp đã cũ. Đóng một bản vẽ rồi mở một bản khác
trùng tiêu đề trong khoảng đó là lượt lùi đọc bản vẽ khác. Vì vậy phản hồi phải
mang đúng `instance` đã chọn, không thì bỏ lượt lùi.

**Các route khác cũng nhận mã phiên (2026-08-13)**, nhưng theo hai khuôn khác nhau
tuỳ vào việc đích có bị SO hay LƯU ở đâu không:

- `blockLibraryRouter`, `cadSelection`: **một** đích. Mọi chỗ dùng đều là đường
  gửi, và cả ba (`requestDrawingInfo`, `dispatchLiveJob`, header `TARGET` của
  native job) đều kết thúc ở `findDocExact`. `TARGET` chỉ sống trong một lượt
  job — mã phiên chỉ có nghĩa trong một phiên AutoCAD, nên lưu nó xuống đĩa sẽ
  là một lỗi khác.
- `drawingStandards`: **hai** đích. `nativeTarget` để gửi; `exactTarget` giữ
  `file || title` cho `documentGuardLisp()` và `session.exactTarget`.
- `selection_control.cpp` nhận mã phiên làm `exactTarget`, và `documentInstance`
  vẫn phải khớp ngay bên dưới — phép kiểm chặt hơn hẳn so tiêu đề.

`/standards/scan` phát `documentInstance` — **định danh** bản vẽ đã quét, không
phải tên nó. Chốt "bản vẽ đã quét có đang hoạt động không" ở phía client phải so
bằng nó: `target` là `file || title`, mà hai bản vẽ chưa lưu trùng tiêu đề cho ra
cùng một giá trị, nên so bằng tên sẽ bật nút Sửa cho bản vẽ SAI rồi để máy chủ từ
chối. Thiếu định danh ở bất kỳ vế nào thì lùi về so tên.

**Phía web cũng có đúng cặp đó**: `/review` gửi `sendTarget()` nhưng SO bằng
`targetOf()`. `applyBlockedReason` đòi CẢ HAI trường đích ở dạng `targetOf()`, vì
cả hai chỉ dùng để so với `scan.target` — thứ daemon đặt bằng `file || title` của
bản vẽ nó giải quyết được, bất kể ta gửi đích nào. Trộn hai dạng là chặn vĩnh
viễn mọi bản vẽ chưa lưu.

`ScanSession` lưu **cả hai**: `exactTarget` để so, `nativeTarget` để tìm lại bản
vẽ lúc áp. Thiếu cái sau là hai bản vẽ chưa lưu trùng tiêu đề quét được mà không
sửa được. `latestFrame()` tra được bằng cả ba cách gọi tên (`target`,
`exactTarget`, `nativeTarget`) vì khách gửi cách nào cũng phải tìm ra.

Cờ `targetsInstance` được kiểm **bên trong `nativeDocumentTarget()`**, không ở
từng chỗ gọi — đặt ở chỗ gọi là mời mỗi chỗ quên một kiểu. Cùng lý do,
`cadSelection` gọi thẳng `selectOpenDocument` thay vì giữ bản chép tay của phép
khớp: bản chép đứng yên trong khi bản gốc học thêm nhánh mới.

**Giới hạn còn lại**: với hai bản vẽ chưa lưu trùng tiêu đề, `documentGuardLisp()`
không phân biệt được chúng — nó chỉ có `DWGNAME`. Bù lại, plugin định tuyến job
bằng mã phiên qua `resolveTarget()` → `findDocExact()`, chạy bên trong AutoCAD
đúng lúc job chạy. Tổng thể không yếu đi.

#### Bảng màu ACI lấy từ AutoCAD, không đoán

Chỉ số ACI 1–9 có quy ước cố định; từ 10 trở đi là bảng tra do AutoCAD định
nghĩa. Đoán bằng công thức cho ra màu sai, mà một ô màu sai cạnh tên layer tệ hơn
không có ô nào. Vì vậy plugin gọi `acedGetRGB()` và ghi
`~/Acad-Bridge/aci-palette.json`; daemon phục vụ nó ở `GET /api/acad/aci-palette`.

**Thời điểm ghi**: ở đúng nhánh xử lý `docs.req` — tức khi **daemon chủ động
hỏi**. Không phải lúc nạp plugin (`kInitAppMsg` chạy trước khi trình soạn thảo
dựng xong, mà `acedGetRGB()` đọc bảng màu của trình soạn thảo), và cũng không
phải trong `writeDocs()` nói chung: hàm đó còn được gọi từ reactor
`documentCreated`, thứ bắn khi AutoCAD tạo bản vẽ đầu tiên trong lượt khởi động.
Cờ "đã ghi" chỉ đặt khi ghi **thành công**, vì đặt trong mọi trường hợp là một
lần ghi hỏng khoá luôn cả phiên.

Hệ quả cho daemon: endpoint phải **gọi `listOpenDocs()` trước rồi mới đọc file** —
chính lượt hỏi đó làm plugin ghi ra bảng màu, nên đọc trước là lượt đầu sau mỗi
lần khởi động AutoCAD luôn trả 404.

Và trong plugin, bảng màu ghi **trước** `docs.json`. Thứ tự đó là chốt: daemon chờ
`docs.json` mới hơn lượt hỏi, nên ghi bảng màu sau sẽ để lại một khe trong đó
daemon thấy `docs.json` đã mới mà bảng màu chưa ra đời. Đổi thứ tự làm khe biến
mất — không cần cơ chế thử lại nào.

`Adesk::ColorRef` là định dạng COLORREF của Win32 — `0x00bbggrr`, **R ở byte
thấp**. Đảo R/B là sinh ra đúng loại màu sai mà cả tính năng này dựng ra để tránh
(đối chiếu `adesk.h` dòng 126).

Đường riêng chứ không ghép: `/docs` bị hỏi liên tục nên nhét 256 mã màu tĩnh vào
mỗi lượt là lãng phí, còn `/drawing-info` thì màn Hồ sơ **không gọi bao giờ** vì
nó không gắn với bản vẽ nào.

`readAciPalette()` kiểm **từng mục**, không chỉ kiểm mảng — một mục hỏng lọt qua
là một ô màu sai. Mục `0` phải rỗng: ByBlock không phải một màu, và một mã màu ở
đó nghĩa là bảng lệch chỉ số nên mọi ô sau đó sai một bậc. Thiếu bảng thì
`aciHex()` lùi về 9 màu có quy ước, ngoài dải đó trả `null` để giao diện hiện số.

File này **nằm lại** sau khi AutoCAD thoát, nên nó phải mang **mã phiên**: plugin
đóng dấu `session` vào cả bảng màu lẫn danh sách bản vẽ, và daemon đòi hai bên
KHỚP chứ không chỉ "có mặt". Thiếu chốt đó thì hạ cấp plugin, hoặc một lượt ghi
thất bại, là giao diện hiện bảng màu của phiên trước như thể của phiên này.

Ngoại lệ đã biết: `acedGetRGB(7)` trả trắng trên nền tối và đen trên nền sáng.
Đổi màu nền AutoCAD **trong cùng một phiên** thì file này cũ — chấp nhận được, vì
nó chỉ ảnh hưởng đúng một ô màu; đổi giữa hai phiên thì mã phiên đã chặn.

#### `pnpm check:css` bắt cả token treo

`var(--x)` với `--x` không tồn tại là khai báo **không hợp lệ** — trình duyệt bỏ
lặng lẽ, không cảnh báo. Hậu quả trông y hệt "quên viết CSS", nên nó sống sót qua
review; đã mắc hai lần trong một mục.

Bộ quét gom định nghĩa từ **cả ba** nguồn hợp lệ: file `.css` bất kỳ (gồm
`*.module.css` tự khai token riêng), token đặt inline trong TSX
(`style={{ "--review-zoom": … }}`), và bỏ qua `var(--x, fallback)` vì fallback vẫn
vẽ ra thứ gì đó. Bỏ sót một nguồn là script báo sai, và một script hay báo sai sẽ
bị nới lỏng cho tới lúc vô dụng. Nó cũng **bỏ chú thích** trước khi tìm — chính
`design-system.css` có một chú thích giải thích lỗi `var(--danger)`.

#### Màu layer: ACI, hay `#RRGGBB` ghi vào DXF group 420

`LayerRule.color` nhận chỉ số ACI `0…256`, ba tên `Default`/`ByLayer`/`ByBlock`,
hoặc mã màu thật `#RRGGBB` (đúng **6** chữ số hex — `#abc` là cú pháp CSS chứ
không phải cú pháp DXF, và đoán nó thành `#aabbcc` là tự chọn thay người dùng một
màu họ không gõ).

**Đặt màu ACI phải GIỮ DẤU của group 62.** Dấu âm nghĩa là layer đang **tắt** —
trạng thái người dùng đặt, mà hồ sơ tiêu chuẩn không có cột nào để ghi đè lên.
`subst` thẳng một số dương vào đó sẽ bật layer lên, tức áp hồ sơ màu sắc làm hiện
ra thứ họ đã cố ý tắt, trên đường ghi một pha không hoàn tác được. Đường màu thật
không mắc lỗi này vì nó không đụng tới 62.

Không có harness chạy AutoLISP, nên chỗ này chỉ khoá được bằng một bất biến **văn
bản** trên chương trình phát đi (`test-drawing-standards.mjs`) — nó chặn việc
"đơn giản hoá" lại, không chứng minh hành vi.

Quy tắc của AutoCAD chi phối cả đường ghi: **group 420 có mặt thì nó thắng group
62.** Hai chiều, và bỏ sót chiều nào cũng là một lượt áp dụng báo thành công mà
màu không đổi:

- Đặt màu **ACI** phải **xoá** 420. Còn sót lại thì màu ACI vừa ghi vô tác dụng.
- Đặt màu **thật** thì **không đụng** 62. 62 lúc đó chỉ là màu dự phòng cho phần
  mềm đọc DWG không hiểu true color, nên ghi đè lên nó không được gì — trong khi
  giữ nguyên thì giữ được cả dấu **ÂM** của nó, mà 62 âm nghĩa là layer đang TẮT.
  `subst` một số dương vào đó sẽ BẬT layer lên, tức đổi màu lại làm hiện ra thứ
  người dùng đã tắt.

Đường ghi là `acadstd:ensure-layer-rgb`; `acadstd:ensure-layer` giữ nguyên chữ ký
cũ và gọi vào nó, còn `acadstd:sync-layers` nhận `rgb` làm trường **thứ sáu, tuỳ
chọn**. Hồ sơ không dùng màu thật thì daemon không phát nó và hành vi y hệt cũ.
Đây là đường ghi một pha, không hoàn tác được — một thay đổi arity ở đây không
được phép làm ẩu.

Phía đọc, plugin phát `colorMethod` (`kByColor` = `0xC2`) cho mỗi layer. Không có
nó thì phải suy màu thật từ `rgb`, và chỗ suy đó có một điểm mù không gỡ được:
màu thật **đen tuyền** cũng là `rgb: [0, 0, 0]`, không phân biệt được với một
layer ACI. `isTrueColor()` vẫn giữ đường lùi theo `rgb` cho bản plugin cũ.

**Lượt kiểm phải đọc màu quan sát được, không đọc `aci`.** `observedLayerColor()`
trong `standardsEngine.ts` suy màu từ `colorMethod`/`rgb` trước khi so với hồ sơ.
Đọc thẳng `aci` là so với một chỉ số không mang màu người dùng đặt, nên layer màu
thật báo lệch mãi mãi và mỗi lượt sửa lại ghi đúng giá trị đã có. Loại lỗi này
không tự lộ ra — nó trông hệt một bản vẽ thật sự sai chuẩn.

Layer khai là màu thật mà `rgb` không đọc được thì màu quan sát được là **không
biết**, và `observedLayerColor()` trả `undefined`. Lùi về `aci` ở đó là một đường
báo ĐẠT sai: hồ sơ chờ ACI 7, `aci` tình cờ bằng 7, audit báo đạt chuẩn trong khi
màu thật sự không ai biết. Không biểu diễn được thì không kết luận, kể cả kết
luận "đúng".

Ba trường màu của `dimension` (`textColor`, `dimensionLineColor`,
`extensionLineColor`) và `acadstd:set-color` của `/review` **vẫn chỉ nhận ACI** —
DIMCLR\* là biến hệ thống theo chỉ số, và mở rộng chúng không nằm trong mục này.

#### Không có đường xem trước ánh xạ

`drawingStandards.ts` phát đúng bảy route: `GET/POST /profiles`,
`PUT/DELETE /profiles/:id`, `POST /scan`, `POST /apply`, `POST /action`. **Không
có dry-run.** Bộ mẫu `mau-thiet-ke/` có nút "Thử trên bản vẽ đang mở" nhưng nó
chạy trên dữ liệu giả trong trình duyệt; bê nguyên sang app thật là bịa ra một
con số người dùng sẽ tin. Màn hình thật nói thẳng là chưa có, và chỉ đường kiểm
duy nhất: lưu → quét → đối chiếu.

### Bộ đếm revision bản vẽ KHÔNG được đếm biến hệ thống của phiên

`headerSysVarChanged` của plugin từng đếm **mọi** `setvar`. Nhưng `loadLib()` —
đoạn bọc mọi job của daemon — chạy `(setvar "FILEDIA" 0)(setvar "CMDDIA" 0)`
trước khi làm gì, nên **mỗi job tự làm bản vẽ trông như đã thay đổi**.

Hệ quả đo được: `/standards/scan` đọc revision trước và sau lượt quét rồi so, và
tự loại bỏ kết quả của chính mình — 16 → 24, **lần nào cũng vậy**.

Nay có danh sách biến **phiên/ứng dụng** được miễn trong `MepDbReactor`:
`TRUSTEDPATHS`, `FILEDIA`, `CMDDIA`, `ATTDIA`, `CMDECHO`, `ATTREQ`, `EXPERT`.

> Biến thuộc **nội dung bản vẽ** — `CLAYER`, `INSUNITS`, `LUPREC`, `CTAB`,
> `TILEMODE` — KHÔNG được vào danh sách đó. Miễn chúng là để một thay đổi thật
> đi qua mà không ai biết.

Danh sách biến chỉ giải quyết được một nửa. Nửa còn lại: **chính AutoCAD nhúc
nhích khi một job chỉ đọc quét bản vẽ**. Công cụ chẩn đoán chỉ đích danh
`modified:AcDbViewport` — AutoCAD dựng lại viewport khi `ssget "_X"` quét toàn
bộ, làm bộ đếm +8 dù chương trình không sửa gì.

**Không sửa bằng cách chặn bộ đếm.** Đã thử ba biến thể của ý tưởng đó và cả ba
đều hỏng; biến thể cuối cùng hỏng ở chỗ nguyên tắc: bộ đếm phục vụ nhiều chốt
khác, không nên bị can thiệp vì một endpoint.

Thứ được chặn là **cờ bẩn** (và qua đó là sự kiện `drawingModified`), chỉ trong
lúc một job chỉ đọc chạy, chỉ trên đúng database của nó. An toàn theo nghĩa
chặt: job giữ main thread của AutoCAD nên trong quãng đó người dùng không tương
tác được — không có "sửa thật" nào để bỏ sót.

Cờ đó bám **vòng đời LISP của chính AutoCAD** — `AcEditorReactor::lispWillStart`
/ `lispEnded` / `lispCancelled` — chứ không suy ra từ tệp, từ thời gian, hay từ
"đang trong lệnh hay không". Đã thử cả ba cách suy đó và hỏng cả ba; cách canh
tệp còn để lại một khe giữa lúc job xong và lúc watcher chạy.

Chương trình **tự khai báo** bằng marker `(progn (setq acad:ro-job T) …)`. Plugin
không đoán biểu thức LISP nào là của mình: người dùng gõ một biểu thức xen vào
giữa lúc xếp hàng và lúc job chạy là chuyện có thật, và chặn nhầm nó là nuốt một
thay đổi thật. Khớp bằng **tiền tố chính xác** chứ không phải "có chứa".

> **AutoCAD đánh giá mỗi biểu thức cấp cao thành một lượt LISP RIÊNG.** Marker
> đặt thành một `(setq …)` đứng trước thân job sẽ chạy và kết thúc trong lượt
> của chính nó — `lispWillStart` của thân job không còn thấy nó. Bất cứ thứ gì
> cần đi cùng một lượt LISP phải nằm trong **cùng một biểu thức**.

> Cờ này kẹt ở trạng thái bật nghĩa là **mọi chốt độ tươi của app đóng băng
> trong im lặng**. Đó là lý do nó phải bám một vòng đời có `end` VÀ `cancel`,
> chứ không bám một tín hiệu gián tiếp.

> **Bộ đếm revision và thao tác của người dùng là hai chuyện khác nhau.** Chỗ
> nào cần biết "người dùng có sửa không", đừng so bộ đếm — dùng
> `drawingChangedSince()`, thứ đọc sự kiện `drawingModified`. Sự kiện đó chỉ bắn
> khi một **lệnh kết thúc và bản vẽ bẩn**; đọc bản vẽ không kết thúc lệnh nào.
>
> Bộ đếm vẫn đúng cho việc nó sinh ra: làm token so sánh giữa hai mốc đọc
> (`instance` + `revision` trong guard của `/selection/prepare`).

`/standards/scan` ghi một mốc nhật ký (`eventLogMark()`) trước khi chạy và hỏi
lại sau đó. Mốc `drawingRevision` mà phiên quét lưu là giá trị **sau** lượt
quét — lưu giá trị trước là bảo đảm `/apply` luôn 409.

> **Chẩn đoán khi bộ đếm lại nhảy bất thường:**
> `touch ~/Acad-Bridge/debug_revision`, chạy lại thao tác, rồi đọc các dòng
> `revisionBump` trong `~/Acad-Bridge/events.jsonl`. Mỗi dòng ghi callback nào
> bắn và cho lớp đối tượng gì; những lần bị bỏ qua vì job chỉ đọc cũng được ghi,
> có tiền tố `skipped-readonly:`. Đoán mò tốn nhiều thời gian hơn cả việc sửa —
> đã hai lần.

### Trạng thái độ tươi của `/drawing-info`

Màn hình này đọc **hai** nguồn ở hai thời điểm khác nhau, và gần như mọi lỗi
từng gặp ở đây nằm ở khe giữa chúng:

- `useDrawingInfo` — hồ sơ 350 KB, **chỉ** đọc khi mở màn hình và khi bấm "Đọc
  lại". Lộ ra `readId` (số thứ tự lượt đọc, không lặp) để nơi khác biết hồ sơ
  trên màn hình đã là của lượt đọc khác.
- `loadDocs()` — danh sách bản vẽ, tự nạp theo các sự kiện ở bảng trên. Giữ bốn
  trạng thái tách bạch: `docs` (danh sách gần nhất ĐỌC ĐƯỢC), `docsAlive` (lượt
  hỏi gần nhất có trả lời không), `docsSettled` (đã hỏi xong lần nào chưa),
  `docsPending` (có lượt đang bay không). Đọc hỏng thì **giữ** `docs`, chỉ hạ
  `docsAlive`.

`profileStaleReason(payload, docs)` gộp mọi lý do hồ sơ không dùng được thành
bốn loại, mỗi loại một lời giải thích riêng: `wrong-drawing`, `closed`,
`space-changed`, `changed`. `blockNote` trong `page.tsx` gộp tiếp với sức khoẻ
`/docs` thành **một** lý do chặn dùng chung cho mọi nút ghi.

Chốt CÓ THẨM QUYỀN nằm ở daemon và plugin, không ở giao diện. `DocumentGuard`
trong `cadSelection.ts` chụp `instance` + `revision` + `space` lúc chuẩn bị và
so lại ở **ba** mốc, vì mỗi mốc có một quãng thời gian riêng lọt qua được:

| Mốc | Bịt quãng nào |
|---|---|
| `snapshotGuard()` | Giữa lượt đọc `/docs` và lượt quét ảnh chụp |
| Lúc `apply` | Giữa lúc chuẩn bị và lúc người dùng xác nhận |
| `selection_control.cpp::currentExactDocument()` | Giữa lúc daemon kiểm và lúc AutoCAD chạy lệnh đã xếp hàng |

Cả ba đều bỏ qua khi một vế không biết (plugin bản cũ không phát `space`) — so
với "không biết" thì mọi thao tác đều bị từ chối.

> **Trường tuỳ chọn phải được giữ lại trong `completeDocument()`.** Hàm đó dựng
> lại object tài liệu từ phản hồi plugin; quên một trường ở đó làm mọi chốt dùng
> trường ấy thành **no-op trong im lặng** — không lỗi kiểu, không test đỏ, và
> nhìn từ ngoài y hệt như đã có bảo vệ. Đã sập đúng một lần với `space`.

Ba lớp dưới đây chỉ để người dùng không phải trả giá bằng một lỗi 409 — chúng
chạy trên luồng sự kiện SSE, mà luồng đó đứt được.

Thao tác hai pha còn được gác thêm ba lớp, mỗi lớp sinh ra từ một lỗi thật:

1. Thẻ xác nhận đang mở + hồ sơ hoá cũ → huỷ ở máy chủ. **Trừ**
   `activate-document` (đó là đường phục hồi) và trừ lúc đang `apply`.
2. `layoutSwitched` → huỷ **đồng bộ** ngay tại sự kiện, không đợi `/docs` về.
3. Bộ đếm **thế hệ không gian**: ai chuẩn bị thì chụp số trước khi chờ và vứt
   kết quả nếu nó đã đổi — vì giữa lúc bấm và lúc máy chủ trả lời thì `pending`
   vẫn là `null` nên hai lớp trên không thấy gì.

Sẽ bổ sung sau khi từng màn hình được migrate và kiểu dữ liệu được gom về
`lib/daemon/`.

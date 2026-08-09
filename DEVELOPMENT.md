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
│   ├── (shell)/             route group của giao diện mới
│   │   └── changes/page.tsx giàn giáo giai đoạn 0
│   └── *Panel.tsx           7 panel của màn hình legacy
└── scripts/                 guardrail + test hợp đồng
```

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
| `pnpm test:contract` | Bất biến an toàn của UI (xem §6) |
| `pnpm build` | Next build + TypeScript |
| `pnpm test:routes` | Bản đóng gói phục vụ đúng route (khởi động daemon thật) |

Ngoài ra:

```bash
pnpm --filter @acad/web test:cadweb-viewer   # 27 test cho pipeline .cadweb
pnpm --filter @acad/daemon test:standards    # tiêu chuẩn bản vẽ
pnpm --filter @acad/daemon test:cad-selection
```

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

Các bất biến đang được khoá:

| Bất biến | Trạng thái |
|----------|-----------|
| Không request nào nhắm bản vẽ chỉ bằng title | đang khoá |
| Kết quả API được validate trước khi render | đang khoá |
| Không hardcode đường dẫn home của developer | đang khoá |
| Chỉ MỘT `EventSource` trong toàn app | đang khoá |
| Nút ghi không đặt `data-write` lên `<button>` thô | đang khoá |
| Route `/` mang mốc `data-screen` đúng giai đoạn | đang khoá |
| Chỉ một luồng ghi (`confirmed: true` = 1) | **chưa** — hiện là 3, mở khoá ở giai đoạn 2A |
| Endpoint chỉ khai ở `lib/daemon/endpoints.ts` | **chỉ áp cho `components/` và `features/`** — `app/` legacy còn 32 đường dẫn rải rác |

---

## 7. Quy ước

### Code

- TypeScript strict, không thêm thư viện khi chưa có ≥2 nơi dùng.
- Comment giải thích **tại sao**, không mô tả lại code.
- Sửa tối thiểu: mỗi dòng thay đổi phải truy được về yêu cầu cụ thể.

### CSS trong lúc migrate

Hai hệ sống song song. Khi có va chạm tên, **luôn đổi tên phía sẽ chết**
(`globals.css` → tiền tố `legacy-`), không bao giờ đổi phía design system — đổi
là fork khỏi `mau-thiet-ke/css/app.css` và không đồng bộ lại được nữa.

Va chạm đã đo được (5 class + 2 token): `.app` `.main` `.empty` `.modal`
`.field`, `--bg` `--accent`. Các class `.count` `.spacer` `.check` **không** va
chạm — cả hai phía đều đã có tổ tiên riêng.

### Git

- Không commit thẳng `main`; mỗi giai đoạn một nhánh.
- Trước mỗi commit: chạy `pnpm verify`, cập nhật tài liệu, chạy Codex review.
- Commit message theo `type(scope): mô tả`.

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

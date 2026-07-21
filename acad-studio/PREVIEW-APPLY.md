# Vẽ có Xem trước & Chấp nhận/Hoàn tác (Preview–Apply–Rollback)

Học từ Open Design (luồng *brief → đề xuất → chọn → preview → accept*) nhưng cho AutoCAD.
Điểm khác: AutoCAD headless trên Mac **không render/PDF** được → ta **xuất geometry ra JSON và
tự vẽ SVG** trong app (đã kiểm chứng). Nhờ đó xem trước thay đổi **bằng hình** không cần mở GUI.

## Nguyên tắc an toàn dữ liệu
- File gốc **chỉ được COPY** vào `base.dwg` (bất biến, không bao giờ ghi).
- Thao tác chạy trên `current.dwg` → **SAVEAS `staged.dwg`** ⇒ `current` bất biến tới khi *Chấp nhận*.
- *Chấp nhận* → **backup** `current` rồi thay bằng `staged` (atomic rename). *Bỏ* → xoá `staged`.
- **Rollback** khôi phục từ chuỗi backup (reversible: backup current trước khi hoàn tác).

## Sandbox phiên: `~/Acad-Studio/sessions/<id>/`
```
base.dwg              copy gốc, IMMUTABLE
current.dwg           state đã accept ("bản đang làm")
staged.dwg            candidate của preview cuối (xoá khi accept/reject)
snapshots/current.json   geometry current (before của op kế)
snapshots/staged-<op>.json geometry candidate (after)
backups/current-<ts>-<op>.dwg  chuỗi backup pre-accept & pre-rollback
```

## Diff theo HANDLE
So `staged.json` với `current.json` theo `handle` (mã DXF code 5, bền qua SAVEAS):
`added` (handle mới) · `removed` (handle mất) · `modified` (handle còn nhưng geometry/thuộc tính đổi).

## API daemon (`apps/daemon/src/session.ts`)
| Method | Path | Vào | Ra |
|---|---|---|---|
| POST | `/api/acad/session/open` | `{originalPath}` | `{sessionId, geometry}` |
| POST | `/api/acad/preview` | `{sessionId, recipe, params}` | `{opId, diff, geometry(after), before}` |
| POST | `/api/acad/apply` | `{sessionId, opId}` | `{applied, backup}` |
| POST | `/api/acad/reject` | `{sessionId, opId}` | `{rejected}` |
| GET  | `/api/acad/history?sessionId=` | | `{head, ops[]}` |
| POST | `/api/acad/rollback` | `{sessionId, opId}` | `{head, geometry}` |
| POST | `/api/acad/export` | `{sessionId, targetPath?}` | `{written}` |

Recipe hỗ trợ preview: `drawpipes, tagpipes, numberpipes, stdlayers, titlefix, qa`.
Geometry snapshot: `mep:dump-geom` trong `acad-lisp/headless/mep_lib.lsp`.

## UI (`apps/web/app/page.tsx`)
Chức năng có cờ `preview:true` (nhóm *Vẽ & hỗ trợ*) chạy luồng: mở session → preview →
`<PreviewView>`: **2 view SVG "Hiện tại | Kết quả"** (tô **xanh=thêm / hổ phách=đổi / đỏ nét đứt=xoá**)
+ thanh tóm tắt + nút **Chấp nhận / Không chấp nhận**. Đọc file gốc luôn an toàn.

## Live preview trên AutoCAD (primary cho vẽ trực tiếp)
Khi AutoCAD GUI + MepBridge sống và recipe hỗ trợ (`drawpipes`):
1. `POST /api/acad/livepreview` → plugin `native.job` `MODE PREVIEW` vẽ lên layer **`MEP-PREVIEW`** (màu cam), XDATA `preview=1` + `op=<id>` + `dest=<layer vĩnh viễn>`.
2. UI: **Không chấp nhận** / **✓ Chấp nhận** — không commit im lặng.
3. Apply → `MODE APPLY` đổi layer entity sang dest (accepted). Reject → `MODE REJECT` xoá entity preview.
4. Tests: `pnpm --filter @acad/daemon test:live-preview`.

Sandbox SVG (`/session` + `/preview`) vẫn còn làm fallback khi không có plugin/GUI.

## Đã build & test (POC P0–P2)
- ✅ `mep:dump-geom` (geometry + handle) · session/open/preview/apply/reject/history/rollback/export
- ✅ Diff theo handle đúng (vẽ 2 ống → +2; tag → +24; file gốc bất biến khi chưa accept)
- ✅ UI 2-view SVG + accept/reject
- ✅ Preview chạy trên **work copy** của `current.dwg` (không mở `current` để mutate); fingerprint chứng minh original + current bất biến tới khi apply
- ✅ `reject` chỉ huỷ op `staged`; re-apply op đã reject fail
- ✅ Tests: `pnpm --filter @acad/daemon test:preview` (`scripts/test-preview-apply.mjs`)
- ✅ Live on-CAD: PREVIEW/APPLY/REJECT trong `objectarx/mepbridge.cpp` + `livePreview.ts`

## Chưa làm (P3–P6, spec sẵn)
- History strip + nút hoàn tác nhiều bước trong UI (endpoint rollback đã có).
- Export guard: chặn ghi đè khi file đang mở trong AutoCAD (`.dwl` lock) → xuất `.reviewed.dwg`.
- Propose gate: agent phát `<question-form>` chốt tham số trước khi vẽ (như Open Design).
- Persistence session vào SQLite + xử lý op re-handle (AUDIT/merge) bằng signature-matching.

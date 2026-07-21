# ACAD stability — kiểm tra / sửa trong app MEP

## Root cause (không phải CER)
File `…/Autodesk/CER/…/*.analytics` chỉ là telemetry hộp thoại crash.
Crash thật: **MepBridge** `documentActivated` → `removeReactor` trên database đã huỷ khi đổi/đóng tab.

## Trong app
1. Bấm **⚙ Kiểm tra / Sửa AutoCAD**
2. Đọc khối **Ổn định (crash / CER)** — giải thích CER ≠ bug
3. **Build & cài plugin (fix crash)** → **Restart AutoCAD**
4. **Sửa font SHX** nếu thiếu romans1 / SUPEROS

## API
- `GET /api/acad/health` → `checks` + `stability.cerNotRootCause`
- `POST /api/acad/setup/buildplugin|restartacad|openacad|fixfonts`

## Test
```bash
cd acad-studio/apps/daemon && pnpm test:stability
```

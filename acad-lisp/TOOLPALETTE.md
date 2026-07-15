# Tạo bảng nút bấm "MEP" trong AutoCAD (Mac & Windows)

Biến các lệnh thành **nút bấm chuột** — không cần gõ. AutoCAD for Mac **có** Tool Palette + CUI, nên làm được; chỉ khác Windows là **phải thiết lập 1 lần bằng tay** (Mac không tạo palette tự động bằng code).

> Thời gian: ~3–5 phút, làm 1 lần. Sau đó dùng mãi.

## Bước 0 — Cho LISP tự nạp (để nút gọi được hàm)
1. Gõ lệnh **`APPLOAD`**.
2. Mục **Startup Suite** (Contents…) → **Add** → chọn `acad-lisp/mep.lsp` → Close.
   → Mỗi lần mở AutoCAD, các lệnh `MEP-*` và hàm `mep-pipe`/`mep-fit` đã sẵn sàng.

## Bước 1 — Mở & tạo Tool Palette
1. Menu **Window → Tool Palettes** (hoặc gõ `TOOLPALETTES`).
2. Chuột phải vào vùng palette → **New Palette** → đặt tên **`MEP`**.

## Bước 2 — Tạo lệnh & kéo thành nút (làm cho từng dòng bảng dưới)
1. Gõ **`CUI`** → khung **Command List** → bấm **＋** (New Command).
2. Điền **Name** và **Macro** đúng theo bảng → Enter.
3. Vẫn để CUI mở: **kéo** command vừa tạo từ Command List **thả vào palette `MEP`**.
4. (Tùy chọn) Chuột phải nút → **Specify Image…** để gán icon cho đẹp.

### Bảng nút đề xuất

| Tên nút (Name) | Macro | Tác dụng |
|---|---|---|
| **▶ Chạy job (từ app)** | `^C^CMEP-RUN` | **Vẽ live** thứ app MEP Studio vừa gửi (thay vì gõ MEP-RUN) |
| **Vẽ ống** | `^C^CMEP-ONG` | Chọn hệ thống + DN rồi vẽ |
| **Phụ kiện** | `^C^CMEP-PK` | Chú thích phụ kiện (BOM đọc được) |
| **Layer chuẩn** | `^C^CMEP-INIT` | Tạo bộ layer chuẩn |
| **Ký hiệu BV** | `^C^CMEP-KHBV` | Sinh ký hiệu `ME-…` |

> **Nút quan trọng nhất cho luồng "app vẽ live"**: **▶ Chạy job** (macro `^C^CMEP-RUN`).
> Sau khi bấm nút chức năng trong MEP Studio (Vẽ ống LIVE / Áp dụng LIVE), chỉ cần bấm nút này
> trong AutoCAD là hình được vẽ vào bản vẽ đang mở — khỏi gõ. (Gõ tắt cũng được: `MR`.)

### Nút "một-chạm" cho ống hay dùng (tùy chọn — gọi thẳng, khỏi chọn)

| Tên nút | Macro |
|---|---|
| **Thoát rửa DN90** | `^C^C(mep-pipe "Rua" 90)` |
| **Thoát xí DN110** | `^C^C(mep-pipe "Xi" 110)` |
| **Thông hơi DN60** | `^C^C(mep-pipe "Hoi" 60)` |
| **Cấp nước DN25** | `^C^C(mep-pipe "Cap" 25)` |

> Phụ kiện một-chạm tương tự: `^C^C(mep-fit "Chech" "Upvc" 90)` (Chếch uPVC DN90).
> Hệ thống hợp lệ: `Xi / Rua / Hoi / Cap`. Loại phụ kiện: `Cut Chech Te Tedeu Y Ydeu Con Sip`.

## Kết quả
```
┌─ MEP ──────────────┐
│  Vẽ ống            │   ← bấm: chọn hệ/DN rồi click vẽ
│  Phụ kiện          │
│  Layer chuẩn       │
│  Ký hiệu BV        │
│ ─────────────────  │
│  Thoát rửa DN90    │   ← bấm phát vẽ luôn
│  Thoát xí DN110    │
│  Thông hơi DN60    │
│  Cấp nước DN25     │
└────────────────────┘
```

## Mẹo
- Kéo palette `MEP` ra cạnh màn hình cho luôn hiện.
- Sửa/thêm nút: lặp Bước 2 với macro khác.
- Muốn thanh nút nổi (toolbar) thay vì palette: trong CUI tạo **Toolbar** mới rồi kéo command vào — cũng chạy trên Mac.
- Nếu bấm nút báo lỗi "no function": kiểm tra `mep.lsp` đã ở **Startup Suite** (Bước 0).

# Fonts SHX cho bản vẽ as-built / full sheet

Bản vẽ tầng 1 (và clone demo) tham chiếu font **không** có sẵn trong AutoCAD Mac mặc định:

| Font trong DWG | Thay thế đã cài |
|----------------|-----------------|
| `romans1.shx`  | copy từ `romans.shx` |
| `SUPEROS.SHX`  | copy từ `simplex.shx` |

Đã cài vào Support của AutoCAD 2027 (user) và backup tại thư mục này.

## Khi mở DWG vẫn báo missing SHX

1. Dialog: **Specify a replacement** → `romans.shx` hoặc `simplex.shx`.
2. Options → Files → Support File Search Path → thêm `acad-studio/fonts`.
3. Font map `acad.fmp`: `romans1;romans.shx`, `SUPEROS;simplex.shx`.

**Lưu ý:** SUPEROS thường là font custom. Thay simplex chỉ để **mở được**; chữ có thể khác gốc. Nếu có SUPEROS.SHX gốc từ máy vẽ, copy vào SHXFont để đúng font.

# Vẽ thật bản vẽ T1 — phân tích, chức năng vẽ, kịch bản demo

Tài liệu này trả lời 4 câu hỏi:

1. Bản vẽ mẫu **gồm những thành phần gì**?
2. **Thứ tự vẽ** ra sao và vì sao?
3. **Chức năng vẽ nào đã được thêm** để dựng lại được?
4. **Kịch bản demo** (prompt cho AI) + vòng lặp *yêu cầu → vẽ → xác nhận*.

Bản vẽ mẫu: `As-built drawing/ABD_He thong thoat nuoc tang 1_Tran tang 1_V.00.dwg`

Toàn bộ số liệu dưới đây trích trực tiếp từ chính bản vẽ bằng **AcCoreConsole**
(AutoCAD 2027 for Mac, X.60.M.161) — không suy đoán.

---

## 1. Bản vẽ mẫu gồm gì

### 1.1 Bộ khung

| Hạng mục | Giá trị thật trong file |
|---|---|
| Đơn vị | `INSUNITS = 4` (mm) |
| Toạ độ model | Toạ độ công trình thật, quanh `(-3.73e6, -1.05e6)` |
| Khổ giấy | A3 `420 × 297` — `ISO_full_bleed_A3` |
| Layout | `Model` + 4 tab giấy: `01`, `02`, `03`, `KL` |
| Tỷ lệ thật | **1 : 103.703704** (= 2800/27), *không* phải 1:100 — viewport `285 / 29555.5556` |
| `DIMSCALE` header | 100 (danh nghĩa) — tỷ lệ thật nằm ở viewport |
| Khung tên | Block `A3-1-1-ISO3TGROUP`, insert trong **cả** paper (scale 1.0) và model (scale 103.704) |

### 1.2 Layer (11 layer nghiệp vụ)

| Layer | Màu ACI | Vai trò |
|---|---|---|
| `P-ThoatXi` | 190 | Ống thoát xí (soil pipe) |
| `P-ThoatRua` | 50 | Ống thoát rửa (waste pipe) |
| `P-ThongHoi` | 5 | Ống thông hơi |
| `P-Hientrang` | 8 | Hiện trạng |
| `DCCD-nuoclanh` | 90 | Trục đứng / nước lạnh |
| `DCCD-text` | 93 | Ghi chú hệ thống |
| `A.DIM` | 7 | Kích thước |
| `Leader` | 255 | Ghi chú dẫn ống |
| `CT-Leader` | 7 | Ghi chú chi tiết |
| `RSA -HACK` | 8 | Nền kiến trúc |
| `0-9` | 8 | Khung tên |

> **Vân tay nhận dạng:** 3 layer ống dùng linetype viết sai chính tả `CONTINOUS`
> (thiếu chữ U). Xuất hiện ở cả 6 file as-built đã đối chiếu.

### 1.3 Thành phần vẽ (model space)

> **Quan trọng — bản vẽ CHỦ YẾU là kiến trúc.** Model space chứa **4 tờ A3**,
> mỗi tờ là một **mặt bằng tầng đầy đủ**: cầu thang bộ, 2 thang máy, WC nam/nữ,
> sảnh khách sạn, sảnh thang máy, phòng gửi hành lý, khu văn phòng, lối lên
> xuống tầng hầm, lưới trục A–D × 1–6. Đo được: **~30 000 đoạn kiến trúc** so với
> **35 tuyến ống** — kiến trúc chiếm ~99 % nét vẽ.
>
> Nền kiến trúc nằm trong block `B_MBT1` / `B_MBT2` (layer `RSA -HACK`), không
> phải MLINE. Hình học **ống** thì gom thành 3 cụm rộng ~1 m, cao 2.6–11.3 m:
>
> | Cụm | Kích thước | Nội dung |
> |---|---|---|
> | giữa | 1.0 × 11.26 m | Sơ đồ trục đứng tổng tầng 1 (23 MLINE) |
> | trái | 1.0 × 2.98 m | Chi tiết trục đứng WC — chiều cao 1 tầng (6 MLINE) |
> | phải | 1.0 × 2.58 m | Bản sao chi tiết WC, lệch đúng 51 049.2 mm theo X (6 MLINE) |
>
> Cụm giữa = tuyến thoát chính chạy dọc trục D trên mặt bằng; 2 cụm nhỏ = chi
> tiết trục đứng WC (bản mẫu đặt trên tờ layout riêng, tỷ lệ 1:35 và 1:50).

| # | Thành phần | Entity | Số lượng | Đặc tả quyết định |
|---|---|---|---|---|
| 1 | **Ống** | `MLINE` | 35 | mlinestyle `MLST1`/`MLST2`, **group 40 (scale) = DN mm**, justification `Zero`, `CELTSCALE = 200` (28/35 ống có group 48) |
| 2 | **Phụ kiện** | `INSERT` + `ATTRIB` | 90 | nhãn nằm trong ATTRIB, tag = loại phụ kiện |
| 3 | **Kích thước** | `DIMENSION` | 29 | `AcDbRotatedDimension` (g70=32), g50 ∈ {0, π/2}, 6 dimstyle |
| 4 | **Ghi chú dẫn** | `MULTILEADER` | 20 (+3 CT) | text `SP\|WP-uPVC-D<DN>;I=1%` |
| 5 | **Đường bao / hướng dòng** | `LWPOLYLINE` | 11 | 5 kín + 6 hở, layer `P-ThoatRua` |
| 6 | **Trục đứng** | `CIRCLE` | 1 | R = 70 (ống đứng D140 nhìn bằng) |
| 7 | **Hatch** | `HATCH` | 2 | `ANSI31`, scale 20, góc 0 |
| 8 | **Khung tên** | `INSERT` | 1/tờ | 11 ATTRIB (`KHBV`, `TENBANVE1`, …) |
| 9 | **Bảng ký hiệu** | `MLINE` + `TEXT` | 2 dòng | **nằm trong PAPER space** của layout 01/02/03 |
| 10 | **Viewport** | `VIEWPORT` | 1–2/layout | 344.9 × 284.9 mm, layer `Defpoints` |

### 1.4 Ống — bảng khối lượng thật

| Hệ | DN | Số tuyến | Chiều dài |
|---|---|---|---|
| P-ThoatXi | 140 | 5 | 10.29 m |
| P-ThoatXi | 110 | 6 | 10.40 m |
| P-ThoatRua | 125 | 6 | 14.72 m |
| P-ThoatRua | 90 | 17 | 10.13 m |
| P-ThoatRua | 42 | 1 | 0.41 m |
| | | **35** | **45.95 m** |

### 1.5 Phụ kiện — phân loại

Nhãn nằm trong ATTRIB của block; tag cho biết họ phụ kiện:

| ATTRIB tag | Nghĩa | Giá trị mẫu | Số lượng |
|---|---|---|---|
| `CHECHDENHAT` | Chếch 45° | `Chếch; uPVC; DN90` | 74 (DN 42/90/110/125/140) |
| `YTIENPHONGTHOAT` | Nhánh Y | `Y đều; uPVC; DN125` | 12 |
| `CONTIENPHONGTHOAT` | Côn thu | `Côn; uPVC; D125/90` | 3 |
| `CUTDENHAT` | Cút 90° | `Cút; PPR; DN90` | 1 |

### 1.6 Dimstyle — DN mã hoá trong tên + `DIMPOST`

| Dimstyle | DIMPOST | DIMSCALE | DIMTXT | DIMASZ | Dùng cho |
|---|---|---|---|---|---|
| `H-D35` | *(rỗng)* | 35 | 2.2 | 1.0 | 2 chi tiết trục đứng WC, tỷ lệ 1:35 (17 dim) |
| `SP-D110` | `-D110` | 100 | 2.0 | 0.5 | Sơ đồ trục đứng thoát xí |
| `SP-D140` | `-D140` | 100 | 2.0 | 0.5 | |
| `WP-D90` | `-D90` | 100 | 2.0 | 0.5 | Thoát rửa |
| `WP-D125` | `-D125` | 100 | 2.0 | 0.5 | |
| `WP-D42` | `-D42` | 100 | 2.0 | 0.5 | |

`SP` = Soil Pipe (thoát xí), `WP` = Waste Pipe (thoát rửa).
Text kích thước **không** bị override (group 1 rỗng ở cả 29 dim) — hậu tố `-D110`
đến từ `DIMPOST`, nên dim hiện `434-D140`.

---

## 2. Thứ tự vẽ và lý do phụ thuộc

Thứ tự dưới đây là **bắt buộc** — mỗi bước phụ thuộc kết quả bước trước.

```
I.   Chuẩn bị          1. Linetype CENTER2  →  2. Layer  →  3. Style
II.  MẶT BẰNG          4. Lưới trục → 5. Tường bao → 6. Tường ngăn
                       7. Cầu thang → 8. Thang máy → 9. WC + thiết bị
                      10. Cửa → 11. Ram tầng hầm → 12. Tên phòng
III. Ống              13. DN lớn (trục chính) → DN nhỏ (nhánh)
IV.  Hình học phụ     14. Đường bao / hướng dòng  → 15. Trục đứng
V.   Phụ kiện         16. Bám nút giao của ống đã vẽ
VI.  Kích thước       17. p13/p14 bám endpoint ống + phụ kiện
VII. Ghi chú dẫn      18. Mũi tên trỏ vào ống
VIII.Hatch            19. Cần biên đã tồn tại
IX.  Ký hiệu          20. Bảng ký hiệu + ghi chú chung
X.   Khối lượng       21. Cộng từ ống đã vẽ → 22. Khung tên
XI.  Layout           23. Layout + viewport nhìn vào model đã xong
```

**Vì sao không đảo được:**

- **MẶT BẰNG TRƯỚC MEP** — bản vẽ MEP là lớp phủ trên nền kiến trúc. Không có
  mặt bằng thì ống "lơ lửng", bản vẽ không đọc được. Đây là lỗi của bản demo
  đầu tiên: chỉ vẽ 35 tuyến ống, bỏ trắng toàn bộ 99 % nét kiến trúc.
- **Lưới trục trước tường** — tường bám toạ độ trục.
- **CENTER2 trước MLINESTYLE** — `MLST1` tham chiếu linetype `CENTER2` cho tim ống.
  Chưa nạp linetype thì style trỏ vào thứ không tồn tại.
- **MLINESTYLE trước MLINE** — lệnh `MLSTYLE` chỉ có dialog, không script được;
  phải `entmakex` + `dictadd` vào dictionary `ACAD_MLINESTYLE` **trước**.
- **TEXTSTYLE trước DIMSTYLE** — `DIMTXSTY` trỏ tới handle của bảng STYLE.
- **Ống trước phụ kiện** — phụ kiện đặt tại nút giao ống.
- **Ống + phụ kiện trước kích thước** — `p13`/`p14` của 29 dim bám đúng endpoint
  MLINE; một số dim còn dài hơn MLINE vì bao cả phụ kiện.
- **Ống trước ghi chú dẫn** — mũi tên leader trỏ vào thân ống.
- **Biên trước hatch** — `-HATCH _S` cần entity biên đã có.
- **Model xong trước layout** — tâm và tỷ lệ viewport phụ thuộc phạm vi model.

---

## 3. Chức năng vẽ đã thêm

### 3.1 `acad-lisp/headless/draw_lib.lsp` — thư viện primitive

Mọi hàm **đã chạy thật** trong AcCoreConsole trên bản vẽ trống (xem §6).

| Hàm | Vẽ ra | Ghi chú |
|---|---|---|
| **`dl:arch-layers`** | LAYER | 7 layer kiến trúc: `A-TRUC` `A-TUONG` `A-LOI` `A-CUA` `A-TB` `A-TEXT` `A-HATCH` |
| **`dl:grid`** / `dl:grid-line` | LINE + CIRCLE + TEXT | lưới trục + bubble + nhãn 2 đầu |
| **`dl:wall`** | 2 LINE | tường theo tim + bề dày |
| **`dl:stair`** | khung + n bậc + mũi tên | cầu thang bộ |
| **`dl:elevator`** | khung + 2 chéo + khe cửa | cabin thang máy |
| **`dl:door`** | LINE + ARC | cánh cửa + cung quét 90° |
| **`dl:fixture`** | CIRCLE/ELLIPSE/LINE | thiết bị vệ sinh: `xi` / `chau` / `tieu` |
| `dl:room-box` / `dl:room-label` | LWPOLYLINE / TEXT | khung phòng, tên phòng |
| `dl:layer` / `dl:std-layers` | LAYER | 11 layer MEP chuẩn kèm màu ACI |
| `dl:ltype` | LTYPE | nạp từ `acadiso.lin` |
| `dl:mlstyle` | MLINESTYLE | 3 element `+0.5 / 0.0 CENTER2 / −0.5`, flags 544 — đúng `MLST1` gốc |
| **`dl:pipe`** | **MLINE** | `scale = DN`, justification Zero, `CELTSCALE 200` |
| `dl:lwpoly` `dl:line` `dl:circle` | LWPOLYLINE / LINE / CIRCLE | entmake, không phụ thuộc prompt |
| `dl:textstyle` `dl:text` `dl:mtext` | STYLE / TEXT / MTEXT | |
| `dl:dimstyle` | DIMSTYLE | nhận `DIMPOST`, `DIMSCALE`, `DIMTXT`, `DIMASZ`, `DIMCLRT` |
| **`dl:dim-linear`** | **DIMENSION** | `_H`/`_V` → `AcDbRotatedDimension` g70=32 |
| `dl:dim-aligned` | DIMENSION | *không* dùng cho bản vẽ này (sinh g70=33) |
| **`dl:mleader`** / `dl:leader` | MULTILEADER / LEADER | |
| `dl:hatch` | HATCH | `-HATCH _P <pattern> <scale> <angle> _S <ent>` |
| `dl:def-fitting` / **`dl:fitting`** | BLOCK + INSERT + ATTRIB | 4 họ: `CHECH`, `Y`, `CON`, `CUT` |
| `dl:def-titleblock` / `dl:titleblock` | BLOCK khung tên A3 | 11 ATTDEF đúng tag bản mẫu |
| `dl:layout` `dl:viewport` `dl:to-model` | LAYOUT / VIEWPORT | |
| `dl:table` | Bảng LINE + TEXT | bảng khối lượng |
| `dl:insert` | INSERT + ATTRIB + SEQEND | entmake, bỏ qua prompt `-INSERT` |
| **`dl:preview-begin/count/apply/reject`** | — | hợp đồng *stage → xác nhận → apply* |
| `dl:report` `dl:result` `dl:save` | — | kiểm đếm + kết quả cho daemon |

### 3.2 `apps/daemon/src/drawT1.ts` — sinh bước vẽ + LISP

- `loadDrawRecipe()` — nạp `demo/t1-draw-recipe.json` (hình học trích từ bản mẫu,
  đã dời về gốc cục bộ `(0,0)`).
- `buildDrawSteps()` — **35 bước** có thứ tự, mỗi bước 1 prompt tiếng Việt.
- `buildStageLisp()` / `buildApplyLisp()` / `buildRejectLisp()` / `buildVerifyLisp()`.
- `matchDrawStep(text)` — khớp câu chat «Vẽ …» với bước.

### 3.3 `scripts/render-dwg.mjs` — XEM BẢN VẼ BẰNG MẮT

```bash
node scripts/render-dwg.mjs .work/T1-DEMO-VE-THAT.dwg
```

Nở phẳng toàn bộ DWG (kể cả block lồng nhau) bằng `scripts/extract/walk.lsp` rồi
vẽ ra PNG. **Bắt buộc chạy sau mỗi lần vẽ.** Đếm entity đúng KHÔNG có nghĩa là
bản vẽ đúng — bản demo đầu tiên đếm khớp 100 % số ống/dim/leader nhưng nhìn vào
thì chỉ có vài nét ống lơ lửng, không có nhà.

### 3.4 `apps/daemon/src/headlessDraw.ts` — chạy thật

`runHeadlessLisp()` gọi AcCoreConsole trên DWG đóng → không cần mở GUI.
`createBlankDwg()`, `readReport()`.

### 3.5 `apps/daemon/src/drawRouter.ts` — API cho agent

```
GET  /api/acad/draw/scenario           kịch bản 44 prompt
GET  /api/acad/draw/docs               bản vẽ ĐANG MỞ + đích vẽ hiện tại
POST /api/acad/draw/target  {title}    chọn đích = bản vẽ đang mở  (vẽ LIVE)
                            {dwg}      hoặc file DWG đóng trên đĩa
                            {}         về mặc định .work/
POST /api/acad/draw/match   {text}     khớp prompt → bước
POST /api/acad/draw/new     {dwg?}     tạo bản vẽ trống
POST /api/acad/draw/stage   {text}     VẼ lên layer preview → trả opId
POST /api/acad/draw/apply   {opId}     ← chỉ gọi SAU khi user Chấp nhận
POST /api/acad/draw/reject  {opId}
GET  /api/acad/draw/verify  ?dwg=      kiểm đếm vs bản mẫu
GET  /api/acad/draw/contract
```

### Hai kênh vẽ

| Đích | Kênh | Lưu file? |
|---|---|---|
| Bản vẽ **đang mở** trong AutoCAD | `~/Acad-Bridge/job.lsp` → plugin AcadBridge | **Không** — giữ dirty, bạn tự Save |
| File DWG **đóng** trên đĩa | AcCoreConsole | Có — `SAVEAS` sau mỗi bước |

Chọn đích trong app: dropdown góc phải trên thanh công cụ.

---

## 4. Vòng lặp yêu cầu → vẽ → xác nhận

```
User: «Vẽ ống thoát xí DN140»
  │
  ├─ agent  POST /draw/stage {"text":"Vẽ ống thoát xí DN140"}
  │         → vẽ 5 MLINE lên layer ACAD-PREVIEW-<opId>
  │         → trả {opId, count:5, committed:false, waitApply:true}
  │
  ├─ agent  "⏸ Đã vẽ 5 đối tượng. CHƯA áp dụng — chờ bạn Chấp nhận."
  │
  ├─ User: Chấp nhận ──► POST /draw/apply  {opId}
  │                      → CHPROP 5 entity sang layer P-ThoatXi
  │
  └─ User: Không  ─────► POST /draw/reject {opId}
                         → ERASE sạch preview, bản vẽ như cũ
```

**Bất biến:** `stage` không bao giờ ghi vào layer đích. `apply` phải là request
riêng. Không bulk-apply im lặng.

---

## 5. Kịch bản demo — 35 prompt

Xem đầy đủ: `npx tsx scripts/draw-demo.mjs --list`

| # | Prompt | Kết quả kỳ vọng |
|---|---|---|
| 1 | `Vẽ bộ layer chuẩn hệ thoát nước` | 11 layer |
| 2 | `Vẽ style chuẩn: mline style, text style, dimstyle` | MLST1/MLST2 + 6 dimstyle |
| 3 | `Vẽ khung tên A3 và điền thông tin bản vẽ` | 1 INSERT + 7 ATTRIB |
| 4 | `Vẽ ống thoát xí DN140` | 5 MLINE |
| 5 | `Vẽ ống thoát xí DN110` | 6 MLINE |
| 6 | `Vẽ ống thoát rửa DN125` | 6 MLINE |
| 7 | `Vẽ ống thoát rửa DN90` | 17 MLINE |
| 8 | `Vẽ ống thoát rửa DN42` | 1 MLINE |
| 9 | `Vẽ đường bao và ký hiệu hướng dòng chảy` | 11 LWPOLYLINE |
| 10 | `Vẽ ký hiệu trục đứng` | 1 CIRCLE |
| 11–19 | `Vẽ phụ kiện chếch DN140 trên ống thoát xí` … | 90 INSERT |
| 20–25 | `Vẽ kích thước dimstyle H-D35` … | 29 DIMENSION |
| 26–30 | `Vẽ ghi chú dẫn SP-uPVC-D110;I=1%` … | 20 MULTILEADER |
| 31 | `Vẽ hatch ANSI31 vùng kỹ thuật` | 2 HATCH |
| 32 | `Vẽ bảng ký hiệu và ghi chú chung` | TEXT + MLINE mẫu |
| 33 | `Vẽ bảng khối lượng ống` | Bảng 7 dòng |
| 34 | `Vẽ layout A3 và viewport` | LAYOUT + VIEWPORT (tỷ lệ đặt thủ công) |

### Chạy

```bash
cd acad-studio

npx tsx scripts/draw-demo.mjs --list          # xem kịch bản
npx tsx scripts/draw-demo.mjs                 # vẽ thật, tự xác nhận
npx tsx scripts/draw-demo.mjs --interactive   # hỏi Chấp nhận từng bước
npx tsx scripts/draw-demo.mjs --steps 6       # 6 bước đầu
npx tsx scripts/draw-demo.mjs --reject pipe_pthoatrua_dn90   # thử từ chối

open -a "AutoCAD 2027" .work/T1-DEMO-VE-THAT.dwg
```

Yêu cầu: AutoCAD 2027 for Mac (chỉ cần AcCoreConsole, **không** cần mở GUI).
Đặt `ACAD_CORE_CONSOLE` nếu cài ở đường dẫn khác.

### Kết quả chạy thật (44/44 bước, 0 lỗi)

```
entity          vẽ được   bản mẫu
✓ MLINE              37        35     (35 ống + 2 mẫu trong bảng ký hiệu)
✓ DIMENSION          29        29
✓ LEADER             20        20     (bản mẫu dùng MULTILEADER — xem §7)
✓ HATCH               3         2
  INSERT             91        90     (90 phụ kiện + 1 khung tên)
  TỔNG entity       448

44 bước áp dụng, 0 từ chối, 0 lỗi
→ acad-studio/.work/T1-DEMO-V3.dwg
```

**Bắt buộc xem ảnh sau khi vẽ:**

```bash
node scripts/render-dwg.mjs .work/T1-DEMO-V3.dwg
```

Bản demo ĐẦU TIÊN đếm khớp 100 % số ống/dim/leader nhưng khi render ra ảnh thì
chỉ thấy vài nét ống lơ lửng — thiếu toàn bộ mặt bằng (cầu thang, thang máy, WC,
sảnh). **Số đếm đúng không chứng minh bản vẽ đúng.**

### Kiểm thử không cần AutoCAD

```bash
cd apps/daemon && pnpm test:draw-t1     # 35 assertion: recipe, thứ tự bước,
                                        # khớp prompt, hợp đồng stage/apply, cú pháp LISP
```

---

## 6. Kiểm chứng primitive

Mọi primitive được thử **riêng lẻ** trên bản vẽ trống trước khi đưa vào thư viện.
Kết quả (`AcCoreConsole X.60.M.161`):

| Primitive | Cách chạy được | Kết quả |
|---|---|---|
| MLINE | `(command "_.MLINE" "_ST" s "_S" dn "_J" "_Z" p1 p2 "")` | ✅ g40=DN, g48=200, 3 element |
| MLINESTYLE | `entmakex` + `dictadd` | ✅ — lệnh `MLSTYLE` chỉ có dialog |
| DIMENSION | `(command "_.DIMLINEAR" p1 p2 "_H"\|"_V" ptxt)` | ✅ g70=32, g50=0/1.5708, số đo khớp mẫu |
| DIMSTYLE | `(command "_.-DIMSTYLE" "_SAVE" name)` | ✅ — **chỉ khi style chưa tồn tại** |
| MULTILEADER | `(command "_.MLEADER" pArrow pLand txt)` | ✅ |
| HATCH | `(command "_.-HATCH" "_P" pat scale ang "_S" ent "" "")` | ✅ |
| BLOCK + INSERT | `entmake BLOCK/…/ENDBLK` + `entmakex INSERT/ATTRIB/SEQEND` | ✅ |
| TEXT / STYLE | `entmakex` / `-STYLE` (7 prompt: font, h, w, obl, N, N, N) | ✅ |
| LAYOUT / VIEWPORT | `-LAYOUT _N` → `_S` → `MVIEW` | ✅ |

**Cạm bẫy đã gặp và xử lý:**

- **KÊNH LIVE: tuyệt đối không dùng lệnh có dấu nhắc.** `(command "_.CHPROP" ss "" "_LA" …)`
  chạy trong session AutoCAD ĐANG MỞ (job nạp từ callback plugin) hỏng giữa chừng:
  trả `Function cancelled` **và để AutoCAD kẹt ở dấu nhắc CHPROP** → mọi job sau đó
  treo, chỉ gỡ được bằng cách bấm ESC trong AutoCAD.
  Bằng chứng: `~/Acad-Bridge/events.jsonl` có `commandStart: CHPROP` mà không có
  `commandEnded`. Đã đổi `dl:preview-apply` → `entmod`, `dl:preview-reject` → `entdel`,
  `dl:layer` → `entmake`/`entmod`. Test `test:draw-t1` khoá lại bằng cách quét mã
  nguồn: 3 hàm này không được chứa `(command …)`.

- `(command …)` **thất bại im lặng** headless — sai chuỗi prompt là entity không
  sinh ra nhưng LISP *không* báo lỗi. Vì vậy mọi hàm `dl:*` so `entlast` trước/sau
  và trả `nil` khi không tạo được.
- Lệnh `MLINE` **nhớ trạng thái** giữa các lần gọi → luôn truyền đủ `_ST` `_S` `_J`.
- `-DIMSTYLE _Save` trên style đã tồn tại sinh prompt xác nhận → treo script.
  `dl:dimstyle` chặn bằng `tblsearch`.
- Không có ActiveX/VLA trên macOS (`vl-load-com` lỗi) → không dùng `vla-*`.
- Không set được tỷ lệ viewport bằng AutoLISP thuần; `ZOOM …xp` bị từ chối trong
  AcCoreConsole.

---

## 7. Sai khác có chủ đích so với bản mẫu

Ghi rõ để không nhầm là lỗi:

| Điểm | Bản mẫu | Bản vẽ lại | Lý do |
|---|---|---|---|
| Chữ tiếng Việt | byte TCVN3 legacy (font `.VnAvantH`, `vnshxh.shx`) | Unicode + `romans.shx` | Font TCVN3 không có trên máy; Unicode đọc được ở mọi máy |
| Bảng ký hiệu | trong **paper space** layout 01/02/03 | trong **model**, cạnh sơ đồ trục đứng | Demo dựng 1 model duy nhất; layout tạo ở bước cuối |
| Linetype layer ống | `CONTINOUS` (sai chính tả) | `Continuous` | Không tái tạo lỗi chính tả |
| Block phụ kiện | `chechdenhatD*`, `*U…` ẩn danh (80% insert) | `FIT-CHECH-D90`… có tên | Block có tên tra cứu/bóc khối lượng được |
| Chiều cao ATTDEF phụ kiện | 0.1 mm (gần như vô hình) | `1.2 × DN` | Bản mẫu dùng ATTRIB làm **dữ liệu**, không phải nhãn |
| Tỷ lệ | 1 : 103.703704 (2800/27) | khung tên insert scale 103.704 | Giữ đúng tỷ lệ; viewport đặt thủ công |
| Số tờ | 4 layout (01/02/03/KL) | 1 layout `SHEET-01` | Demo dựng 1 tờ |
| Kiểu ghi chú dẫn | `MULTILEADER` | `LEADER` + mũi tên + `TEXT` | Lệnh `MLEADER` sinh prompt phụ và **treo AcCoreConsole** khi bản vẽ đã nhiều entity (đã gặp: 5 bước quá 180 s). Pipeline không người trông chỉ dùng lệnh tất định. |
| Ghi chú dẫn | 20 `Leader` + **3 `CT-Leader`** | 20 `Leader` | 3 CT-Leader nằm ngoài phạm vi 3 cụm sơ đồ (nhãn tiêu đề hình chi tiết + bảng thống kê phụ kiện), không tái tạo |

---

## 8. File liên quan

| File | Vai trò |
|---|---|
| `acad-lisp/headless/draw_lib.lsp` | Thư viện primitive vẽ |
| `acad-studio/demo/t1-draw-recipe.json` | Hình học trích từ bản mẫu (gốc cục bộ) |
| `acad-studio/scripts/extract/` | Trích lại recipe từ DWG bất kỳ (xem §9) |
| `acad-studio/apps/daemon/src/drawT1.ts` | 35 bước + sinh LISP |
| `acad-studio/apps/daemon/src/headlessDraw.ts` | Chạy AcCoreConsole |
| `acad-studio/apps/daemon/src/drawRouter.ts` | API `/api/acad/draw/*` |
| `acad-studio/scripts/draw-demo.mjs` | CLI demo vẽ thật |
| `acad-studio/SAMPLE-T1-FULL-ANALYSIS.md` | Phân tích trước đó (kịch bản pure, 55 bước) |

---

## 9. Trích lại recipe từ bản vẽ khác

`demo/t1-draw-recipe.json` không viết tay — nó được **trích tự động** từ DWG:

```bash
cd acad-studio/scripts/extract
./extract-recipe.sh "/abs/path/ABD_He thong thoat nuoc tang 3_Tran tang 2_V.00.dwg"
```

Pipeline:

| Bước | File | Việc |
|---|---|---|
| 1 | `dump-tables.lsp` | layer, textstyle, dimstyle, block, layout, entity model |
| 2 | `dump-detail.lsp` | mline (DN), insert, mleader, mlinestyle, hình học block |
| 3 | `dump-dims.lsp` | dimension chi tiết (g50 hướng, g42 số đo) + DIMPOST |
| 4 | `mkrecipe.py` | gộp, dời về gốc cục bộ, giải mã text → `t1-draw-recipe.json` |

Biến môi trường: `ACAD_CORE_CONSOLE`, `ACAD_DUMP_OUT`, `ACAD_RECIPE_OUT`.

> Lưu ý khi áp cho bản vẽ khác: bộ layer/dimstyle của hệ **cấp nước** khác hẳn
> (DN nằm trong *tên layer*: `D20N`, `D25 L`), và MLINE scale có thể **âm**.
> `mkrecipe.py` hiện tối ưu cho hệ thoát nước.

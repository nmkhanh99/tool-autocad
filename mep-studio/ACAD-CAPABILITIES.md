# AutoCAD for Mac — Bản đồ năng lực (headless AcCoreConsole)

Tổng hợp từ tài liệu Autodesk + **probe thực tế** trên AutoCAD 2027 for Mac (máy này). 
Cột *headless*: `works` = đã chạy được không cần GUI; `gui-only` = phải mở AutoCAD; `no` = không có trên Mac.

## ✅ Đã kiểm chứng + đã build thành chức năng (API)

Các recipe headless dựng sẵn trong daemon — `POST /api/acad/mep/<recipe>`, body `{dwgs:[...] | dir, params, save, outDir}`:

| Recipe | Làm gì | Đã test |
|---|---|---|
| `bompipe` | BOM ống: tổng chiều dài (mm+m) theo layer, **tự tính cung bulge** | ✅ 91.6 m /P-ThongHoi |
| `bomfit` | Đếm phụ kiện (INSERT) theo tên block | ✅ |
| `titleindex` | Đọc khung tên nhiều file → mục lục (KHBV, tên, ngày…) | ✅ đọc cả file LibreDWG hỏng, tiếng Việt decode |
| `layers` / `stats` | Danh sách layer / thống kê entity theo dxftype | ✅ |
| `titlefix` | Sửa ATTRIB khung tên hàng loạt + lưu | ✅ KHBV→ME-TH-T08 |
| `qa` | AUDIT + PURGE + OVERKILL + lưu | ✅ **2.6M→364K** |
| `convert` | Đổi version DWG (2013/2018) | ✅ |
| `dxfout` | Xuất DXF (cầu nối ezdxf offline) | ✅ |

Thư viện LISP: `acad-lisp/headless/mep_lib.lsp`. Kênh tổng quát: `/api/acad/headless` (chạy .scr tuỳ ý), `/api/acad/batch` (nhiều file).

> **Đính chính quan trọng (probe thực tế trên máy này):** `getpropertyvalue`/`setpropertyvalue`/`dumpallproperties`
> **KHÔNG có** trên AcCoreConsole AutoCAD 2027 for Mac (`bad function`) — tài liệu web nói ngược lại là sai.
> Cũng KHÔNG có: mọi `vla-*`/`vlax-*` (kể cả `vlax-curve-*`). ⇒ **Mọi đo đạc hình học phải tính tay từ DXF group codes**
> (thư viện `mep_lib.lsp` đã làm, có xử lý cung bulge). `vl-catch-all-apply`, `vl-string-*` thì CÓ.

## Ma trận thao tác

| | Thao tác | Cách làm | Ghi chú |
|---|---|---|---|
| ✅ | **AcCoreConsole (engine headless Mac 2027)** | `"/Applications/Autodesk/AutoCAD 2027/AutoCAD 2027.app/Contents/Helpers/AcCoreConsole.app/Contents/MacOS/AcCoreConsole" /i in.dwg /s job.scr /l en-US. Batch: for` | PROBE-CONFIRMED tồn tại native (universal arm64+x86_64) và chạy headless, exit 0, ACADVER=26.0. Undocumented/unsupported. Warning vô hại 'Fi |
| ✅ | **CLI flags /i /s /l /isolate** | `/i <dwg> input; /s <scr> script; /l en-US ngôn ngữ; /isolate cô lập sysvar. Bỏ /i = bản vẽ trống.` | PROBE: /i /s /l đã chạy thật. /isolate tránh nạp acad2027.LSP. /b /r /product chưa xác nhận trên Mac. |
| ✅ | **entmake (LINE/CIRCLE/TEXT/MTEXT/LWPOLYLINE/ARC...)** | `(entmake '((0 . "LINE")(8 . "ONG_GIO")(10 0.0 0.0 0.0)(11 100.0 50.0 0.0))). LWPOLYLINE cần (100 . "AcDbEntity")(100 . "AcDbPolyline")(90 . n)(70 . flag) + mỗi ` | PROBE-CONFIRMED tạo LINE/CIRCLE/TEXT/MTEXT/LWPOLYLINE, persist sau QSAVE. GOTCHA: scalar phải dotted pair '(40 . 25.0)' KHÔNG '(40 25.0)' →  |
| ✅ | **entmakex** | `(setq e (entmakex '((0 . "LINE")(10 0 0 0)(11 10 0 0)))) → trả ENAME. Cách chuẩn tạo XRECORD/DICTIONARY không owner trong console.` | Core, headless-safe. Dùng để tạo entity rồi gắn xdata/extension dict ngay. |
| ✅ | **entmod (sửa layer/màu/xdata/attrib)** | `(setq el (entget en))(setq el (subst (cons 8 "NEW") (assoc 8 el) el))(entmod el). Đổi màu: subst/append (cons 62 n). Sửa ATTRIB rồi (entupd en).` | PROBE-CONFIRMED đổi layer/màu/ATTRIB value, persist qua reopen. Phải giữ nguyên (-1 . ename). Đổi type (code 0) không được; sửa entity trong |
| ✅ | **entget (đọc entity + xdata)** | `(entget en) → assoc list DXF. Kèm xdata: (entget en '("MYAPP")).` | PROBE nền tảng mọi thao tác đọc. Chạy hoàn hảo headless. |
| ✅ | **entnext / entlast** | `(entnext) entity đầu; (entnext en) kế tiếp (kể cả ATTRIB/vertex subentity); (entlast) cuối. Duyệt block: từ (cdr(assoc -2 blk)) rồi entnext tới hết.` | PROBE: dùng walk ATTRIB từ INSERT (66=1) và duyệt text nested trong block definition. |
| ✅ | **entdel** | `(entdel en) xoá soft; gọi lại cùng session để undelete.` | Core headless-safe. Không xoá entity trong block definition; không undelete xuyên session. |
| ✅ | **ssget "X" (filter DXF, quét database)** | `(ssget "_X" '((0 . "LWPOLYLINE")(8 . "M-DUCT"))). OR: (ssget "X" '((-4 . "<OR")(0 . "LINE")(0 . "MLINE")(-4 . "OR>"))). Lọc space: (410 . "Model").` | PROBE: API lọc chính headless. Quét cả model+paper. Bỏ qua code -1/5/>1000 trong filter. ssget "X" '((0 . "ATTRIB")) trả nil → phải walk ent |
| ✅ | **sslength/ssname/ssadd/ssdel/ssmemb** | `(sslength ss);(ssname ss i);(setq ss(ssadd))(ssadd en ss);(ssdel en ss);(ssmemb en ss).` | Core selection-set ops, headless-safe. |
| ✅ | **getpropertyvalue/setpropertyvalue/dumpallproperties/ispropertyreadonly** | `(getpropertyvalue en "Length") đo chiều dài KHÔNG cần ActiveX; (setpropertyvalue en "Layer" "X"); (dumpallproperties en) liệt kê property name.` | CORE (không phải vl/vla) thêm để thay ActiveX trong console. Cách đo Length headless-safe nhất. Nên probe tên property qua dumpallproperties |
| ✅ | **Đo length thuần DXF (fallback tính tay)** | `LINE=distance((assoc 10),(assoc 11)). LWPOLYLINE: cộng đoạn giữa các (10); bulge (42): ang=4*atan/b/, arclen=chord*(ang/2)/sin(ang/2); closed=(logand 1 (assoc 7` | PROBE-CONFIRMED thật: t8.dwg P-ThongHoi(MLINE)=91583.44, A6(LWPOLYLINE)=340200, bulge xử lý đúng. 100% core, an toàn tuyệt đối — phương án đ |
| ✅ | **tblnext (duyệt LAYER/BLOCK/STYLE/DIMSTYLE...)** | `(setq l (tblnext "LAYER" T))(while l ... (setq l (tblnext "LAYER"))). Block: (cdr(assoc -2 blk))=entity đầu định nghĩa → entnext duyệt nội dung.` | PROBE: đọc 58 layer (t8)/95 (cn), tên/màu(62)/linetype(6)/flag(70). READ-ONLY (sửa qua tblobjname). |
| ✅ | **tblsearch / tblobjname** | `(tblsearch "LAYER" "M-PIPE") check tồn tại; (tblobjname "LAYER" "M-PIPE") → ename record → entget/entmod để SỬA color/linetype/frozen.` | PROBE: verify layer tồn tại sau tạo/rename. tblobjname là cầu nối sửa symbol table (vì tblnext read-only). |
| ✅ | **command-s** | `(command-s "_.-PURGE" "_A" "*" "_N"). Đánh giá hết đối số trước, lệnh phải bắt đầu+kết thúc trong 1 lời gọi.` | Khuyến nghị cho batch/headless, an toàn hơn command. Không PAUSE. |
| ✅ | **vl-cmdf** | `(vl-cmdf "_.-INSERT" "blk" "0,0" 1 1 0). Đánh giá đối số trước; bản '-'; no PAUSE.` | Hàm CORE (không ActiveX) → chạy console. Cùng ràng buộc no-GUI như command. |
| ✅ | **File I/O (open/read-line/write-line/close)** | `(setq f (open "/abs/out.csv" "w"))(write-line "id,length" f)(close f). Đọc: mode "r"; append "a". Dữ liệu chỉ ghi khi close.` | PROBE nền tảng xuất BOM/CSV/JSON. Dùng đường dẫn tuyệt đối, '/' trên Mac. |
| ✅ | **vl-string-* + wcmatch + substr** | `(vl-string-search "DN" s), (vl-string-subst "new" "old" s), (vl-string-trim " " s), (wcmatch "M-PIPE" "M-*"), (substr s 1 3).` | Luôn khả dụng headless (không phải COM object). An toàn parse tên block/layer/attribute/spec ống. |
| ✅ | **XDATA đọc (regapp/entget appname)** | `(regapp "MYAPP"); (setq el (entget en '("MYAPP"))); (assoc -3 el) → (-3 ("MYAPP" (1000 . "pipe-DN100")(1040 . 3.14)(1070 . 5))). Codes: 1000 str,1040 real,1070 ` | Core headless-safe. Xdata tối đa ~16KB/entity/app. |
| ✅ | **XDATA ghi (entmake/entmod -3)** | `(regapp "MYAPP")(entmod (append (entget en)(list (list -3 (list "MYAPP" (cons 1000 "DN100")))))). Xoá: ghi (-3 ("MYAPP")) rỗng.` | Core headless-safe. PHẢI regapp trước khi ghi nếu app chưa tồn tại. |
| ✅ | **Extension dict & XRECORD (dictadd/dictsearch/dictnext/namedobjdict)** | `(namedobjdict)→NOD; (setq xr (entmakex '((0 . "XRECORD")(100 . "AcDbXrecord")(1 . "pipe")(40 . 100.0))))(dictadd dict "KEY" xr); (dictsearch dict "KEY").` | Core headless-safe, thay XDATA (không giới hạn 16KB, có cấu trúc). GOTCHA: dictnext chỉ 1 iterator toàn cục — đừng lồng 2 dict. |
| ✅ | **getvar / setvar (sysvars)** | `(setvar "FILEDIA" 0)(setvar "CMDDIA" 0)(setvar "OSMODE" 0); (getvar "INSUNITS"). Cấu hình môi trường console đầu script.` | PROBE hoàn hảo. INSUNITS=4(mm), MEASUREMENT=1, ACADVER=26.0, DIMSCALE=100. KHÔNG có 'DWGUNITS' (trả nil). |
| ✅ | **-LAYER (Make/Set/Color/Rename/Freeze/Lock/Ltype)** | `(command "_.-LAYER" "_M" "ONG_GIO" "_C" "3" "" "") tạo; "_Rename" old new; "_C" color name.` | PROBE-CONFIRMED tạo ONG_GIO/KHUNG_TEN/GHI_CHU, rename, persist qua reopen. Layer cũ phải TỒN TẠI khi rename nếu không 'Cannot find layer'. C |
| ✅ | **-LAYERSTATE / layerstate-* (LISP core)** | `(command "-LAYERSTATE" "Restore" "AsPlot"). Hoặc (layerstate-save "S1" mask nil),(layerstate-restore "S1" vpid mask).` | layerstate-* là AutoLISP CORE (không ActiveX) → hợp lệ console. Web-based, probe local nên xác nhận. |
| ✅ | **-PURGE (All / Regapps)** | `Script: -PURGE / All / <blank> / N / QSAVE. Regapp rác: -PURGE / Regapps / * / N.` | PROBE-CONFIRMED t8.dwg: 58→37 layers, 426→74 blocks, file 2.71MB→369KB. PURGE All tự lặp nhiều pass. Regapps chỉ purge qua -PURGE. Verify pe |
| ✅ | **AUDIT (kiểm tra & fix DB)** | `Script: AUDIT / Y / QSAVE (Y=fix errors). (setvar "AUDITCTL" 1) để log .adt.` | PROBE-CONFIRMED: 'Total errors found 0 fixed 0', exit 0. RECOVER (mở file khác) có dialog → không dùng console; recover qua /i. |
| ✅ | **-OVERKILL (xoá đối tượng trùng/chồng)** | `(command "_.-OVERKILL" (ssget "_X") "" "" ...) rồi Ignore/Tolerance/Done. Bản command-line.` | PROBE-CONFIRMED chạy headless. Rất hữu ích dọn line/ống MEP trùng lặp. OVERKILL không dash = dialog. |
| ✅ | **MLINE (vẽ ống/tường)** | `(setvar "OSMODE" 0)(command "_.MLINE" "0,0" "300,0" "300,300" ""). Style/scale hiện hành.` | PROBE-CONFIRMED: MLINE 24→25. Web nói partial, probe nói works. Không tạo style mới ở đây (MLSTYLE là dialog). Nhớ OSMODE 0. |
| ✅ | **DIMLINEAR / DIM* (DIMALIGNED/RADIUS/ANGULAR...)** | `(setvar "OSMODE" 0)(command "_.DIMLINEAR" "0,0" "300,0" "150,-100"). Cấp đủ toạ độ scripted; DIMSTYLE hiện hành.` | PROBE-CONFIRMED DIMLINEAR: 0→1 DIMENSION, persist. Web nói partial nhưng chạy khi cấp toạ độ. Offline nên entmake DIMENSION trực tiếp. |
| ✅ | **-DIMSTYLE (Save/Restore/Variables)** | `Set DIM* vars ((setvar "DIMTXT" 2.5)) rồi (command "-DIMSTYLE" "Save" "MEP-DIM" "Y"); Restore name.` | Command-line có Save/Restore/Variables (dialog không có). Web-based, probe local xác nhận. |
| ✅ | **-INSERT block (có sẵn/từ DWG)** | `(command "_.-INSERT" "SIPHONG" "5000,5000" "1" "1" "0"); từ file: (command "_.-INSERT" "/lib/valve.dwg" pt 1 1 0).` | PROBE-CONFIRMED: INSERT 19→20 với block MEP thật SIPHONG. INSERT không dash = palette (GUI), CLASSICINSERT = dialog. |
| ✅ | **-WBLOCK (xuất DWG / tách block)** | `(setvar "FILEDIA" 0). Cả bản vẽ: _.-WBLOCK /out/all.dwg *. 1 block: _.-WBLOCK /out/valve.dwg =VALVE. Selection: (vl-cmdf "_.-WBLOCK" "/out/sel.dwg" "" "0,0" (ss` | PROBE-CONFIRMED tạo wblock_test.dwg 27KB. Hợp xây thư viện block MEP thành .dwg riêng. FILEDIA=0 chặn dialog. |
| ✅ | **-RENAME (layer/block/style/dimstyle)** | `(command "_.-RENAME" "LAyer" "OLD" "NEW"). Types: Block/Dimstyle/LAyer/LType/Material/Style/Ucs/VIew/VPort.` | Command-line. Không đổi tên chuẩn (layer 0, Continuous, Standard). Web/Kean-based. |
| ✅ | **-SCALELISTEDIT** | `Reset: (command "-SCALELISTEDIT" "Reset" "Y" "Exit"). Add: "Add" "1:50" "1:50" "Exit".` | Command-line ổn định hơn dialog. Web-based, probe local xác nhận. |
| ✅ | **SAVEAS (đổi version DWG)** | `(command "_.SAVEAS" "2018" "/path/out.dwg") (_Y overwrite). Version: R14/2000/2004/2007/2010/2013/2018/DXF/Template.` | PROBE-CONFIRMED tạo test_out.dwg 32KB. Hạ/đổi version thoải mái. QSAVE mặc định lưu 2018. |
| ✅ | **DXFOUT / SAVEAS DXF** | `(command "._DXFOUT" "/path/out.dxf" "_V" "2018" "16") (16=precision). Prompt hỗ trợ Binary/Objects/Version.` | PROBE-CONFIRMED tạo dxfout_test.dxf 120KB. Cầu nối chính cho pipeline offline ezdxf. |
| ✅ | **STLOUT (3D solid → STL)** | `(command "_.STLOUT" (ssget "_X") "" "_Y" "/path/out.stl") (Y=binary).` | PROBE-CONFIRMED tạo stl_test.stl 684B từ BOX. CHỈ nhận 3D solid/watertight mesh → bản vẽ MEP as-built 2D gần như KHÔNG dùng. |
| ✅ | **MOVE (dời entity)** | `(setvar "OSMODE" 0)(command "_.MOVE" ename "" "0,0" "100,200").` | PROBE-CONFIRMED chính xác +100,+200. OSMODE bật làm sai → phải OSMODE 0. Truyền trực tiếp ename làm selection. |
| ✅ | **COPY (sao chép entity)** | `(setvar "OSMODE" 0)(command "_.COPY" ename "" "0,0" "0,1000").` | PROBE-CONFIRMED: LINE 1→2, persist qua reopen. |
| ✅ | **QSAVE (lưu bản vẽ)** | `(command "_.QSAVE") hoặc dòng QSAVE trong .scr. Lưu định dạng 2018.` | PROBE: BẮT BUỘC để persist mọi thay đổi entmake/entmod/purge (đã kiểm chứng reload). Không QSAVE = mất thay đổi. |
| ✅ | **Liệt kê layer + màu + state + linetype** | `(tblnext "LAYER" T) loop: (assoc 2)=tên,(assoc 62)=màu ACI,(assoc 70)=flag,(assoc 6)=linetype. Off=62<0; frozen=bit1 của 70; locked=bit4.` | PROBE thật: t8=58, cn=95 layer, đọc đủ tên/màu/linetype/state. |
| ✅ | **Đếm block INSERT theo tên** | `(ssget "_X" '((0 . "INSERT"))) loop: (cdr(assoc 2 (entget en))) gom assoc-list. Block *Uxxx = anonymous (dynamic/array).` | PROBE thật: t8=19 INSERT, cn=303. ssget "X" quét mọi space. |
| ✅ | **Đọc ATTRIB khung tên (title block)** | `INSERT có (assoc 66)=1: (setq sub (entnext en)) while (="ATTRIB"): tag=(assoc 2), value=(assoc 1), (entnext sub).` | PROBE thật đọc full khung tên A3-ISO3TGROUP: KHBV/TENBANVE/THIETKE... GOTCHA encoding: tiếng Việt lưu '\U+1EB6' (Unicode MIF) + đôi khi moji |
| ✅ | **Đo tổng chiều dài ống theo layer** | `(ssget "_X" '((0 . "LINE,LWPOLYLINE,MLINE"))) → tính tay length (xem 'Đo length thuần DXF'), gom theo (assoc 8). Convert ra m qua INSUNITS.` | PROBE thật t8: P-ThongHoi=91583.44 (~91.6m vì INSUNITS=4 mm). Thao tác lõi thống kê ống MEP. |
| ✅ | **Đọc TEXT/MTEXT (kể cả nested trong block)** | `Model: (ssget "_X" '((0 . "TEXT,MTEXT"))). Nested: duyệt (tblnext "BLOCK"), từ (assoc -2) entnext gom TEXT/MTEXT/ATTDEF. Strip mã format MTEXT (\f,\W,\U+).` | PROBE GOTCHA: t8 model TEXT=0 vì TẤT CẢ nằm trong block definition (NESTED_TEXT=114, MTEXT=58, ATTDEF=164). Phải duyệt block table. |
| ✅ | **Đếm entity theo dxftype (thống kê)** | `(ssget "_X" '((410 . "Model"))) chỉ model. Loop (cdr(assoc 0 (entget en))) gom + vl-sort giảm dần.` | PROBE thật cn model: INSERT=282, MLINE=106, DIMENSION=92, LWPOLYLINE=49... Lọc space bằng (410). |
| ✅ | **Đọc header/sysvars (INSUNITS/MEASUREMENT/ACADVER)** | `(getvar "INSUNITS")(getvar "MEASUREMENT")(getvar "LUNITS")(getvar "DIMSCALE")(getvar "DWGNAME").` | PROBE thật: INSUNITS=4(mm), MEASUREMENT=1(metric), LUNITS=2, ACADVER=26.0, DIMSCALE=100. KHÔNG có 'DWGUNITS'. Đơn vị suy từ INSUNITS (4=mm,6 |
| ✅ | **Đọc callout ống từ MULTILEADER** | `(ssget "_X" '((0 . "MULTILEADER"))): text ở (cdr(assoc 304 ed)), layer (assoc 8).` | PROBE thật layer CT-Leader: đọc spec 'd90','d110','vp-pvc-d90','SP-PVC-D110' → bóc đường kính/vật liệu ống tự động. |
| 🟡 | **command (replay lệnh)** | `(command "_.-LAYER" "_M" "X" ""). Phải dùng bản '-' (hyphen), KHÔNG PAUSE, không input tương tác. Trước lệnh nhập toạ độ: (setvar "OSMODE" 0).` | PROBE: chạy được nhưng OSMODE bật làm lệch điểm (line 1000,1000 hoá zero-length). Lệnh dialog phải dùng bản '-'. |
| 🟡 | **vl-load-com** | `(vl-load-com) đầu mỗi drawing. Trên Mac trả 'yes' nhưng KHÔNG bật object model / vlax-curve.` | PROBE: nạp một số utility/string nhưng KHÔNG có COM/curve. Mỗi drawing có Lisp env riêng → gọi lại mỗi file. |
| 🟡 | **FIELD / UPDATEFIELD** | `FIELD (build biểu thức) = dialog GUI. UPDATEFIELD làm mới: (command "UPDATEFIELD" (ssget "_X") ""). Chèn field qua mã trong chuỗi TEXT/MTEXT.` | UPDATEFIELD chạy headless; chèn field trực tiếp khó vì cần dialog build biểu thức. |
| 🟡 | **EXTENTS bản vẽ (EXTMIN/EXTMAX)** | `(getvar "EXTMIN")(getvar "EXTMAX"). Cũng có LIMMIN/LIMMAX.` | PROBE: giá trị LƯU trong header, có thể CŨ nếu sửa mà chưa regen; console không có màn hình để ZOOM E cập nhật. Chính xác 100% phải duyệt en |
| 🟡 | **DIESEL $(getvar,...) / MODEMACRO** | `$(getvar,...),$(if,...) đánh giá qua field/menucmd. MODEMACRO (status bar) = GUI-only.` | String engine đánh giá được nhưng công dụng chính gắn GUI. UNTESTED trên Mac console. |
| ❓ | **DGNEXPORT / -DGNEXPORT (ra DGN)** | `_.-DGNEXPORT /path/out.dgn ... (cần seed .dgn).` | CHƯA probe cục bộ. Là lệnh riêng (không raster) → có thể chạy headless. Cần test lệnh có trong console Mac + seed file. |
| ❓ | **-ATTEXT ra CSV (attribute extraction)** | `(setvar "FILEDIA" 0)(command "-ATTEXT" "C" "tmpl.txt" "out.txt") (C=CDF, S=SDF cần template; D=DXF→.dxx không cần).` | CHƯA probe headless trên Mac. Có trang help AutoCAD-MAC-Core → nhiều khả năng chạy. Đường thay thế DATAEXTRACTION trên Mac. Cần test cục bộ. |
| ❓ | **MEASUREGEOM** | `(command "MEASUREGEOM" "Area" p1 p2 p3 "" "eXit"). Kết quả chỉ in command line → phải bắt qua log.` | CHƯA probe cách đọc kết quả từ console log. Offline nên tính area/length bằng ezdxf/shapely hoặc DXF thuần. |
| ❓ | **BCOUNT (Express Tool đếm block)** | `(command "BCOUNT" ""). Thay headless: đếm bằng ssget INSERT + gom theo (assoc 2), hoặc ezdxf.` | Express Tool (acett.arx) thường KHÔNG tự nạp trong console → nhiều khả năng 'unknown command'. Đếm block bằng LISP core an toàn hơn. |
| ❓ | **ObjectARX for Mac (C++/Obj-C → .bundle)** | `Viết C++/Obj-C, build bằng Xcode ra .bundle (không .arx). Cần ObjectARX for Mac SDK.` | API Mac là tập con Windows. MEMORY: máy user CHƯA có Xcode/ODA → ưu tiên Python+ezdxf offline + AcCoreConsole trước. |
| ❓ | **.NET managed (AcCoreMgd, NETLOAD)** | `Thử (command "NETLOAD" "asm.dll") trong AcCoreConsole Mac.` | PHÁT HIỆN LOCAL: bundle Mac 2027 CÓ .NET runtime (DotNetRunTime .../Microsoft.NETCore.App/10.0.0) + DesignAutomation → gợi ý managed plugin  |
| ❓ | **acad.lsp / acaddoc.lsp autoload** | `Chắc ăn: (load "/abs/file.lsp") tường minh trong .scr. Autoload: (autoload "APP" '("cmd")). Support path Mac trong ~/Library (hidden).` | Chưa xác nhận AcCoreConsole Mac tự nạp acaddoc.lsp (ACADLSPASDOC ảnh hưởng). Cần probe. |
| ❓ | **Design Automation for AutoCAD (APS cloud)** | `Đóng gói AppBundle (.NET/LISP)+Activity chạy engine headless trên cloud APS, không cần license desktop.` | Bundle Mac 2027 có thư mục DesignAutomation. Hướng headless 'chính chủ' nếu muốn scale, không phụ thuộc máy Mac. |
| 🖥 | **ssget interactive (pick/Window/Crossing/implied)** | `(ssget), (ssget "W" p1 p2), (ssget "_I") cần con trỏ/màn hình → treo/nil trong console. Thay bằng "X"/"_A" + filter.` | AcCoreConsole không có GUI/interactive input. |
| 🖥 | **MLSTYLE (tạo multiline style)** | `Không có -MLSTYLE. Headless: entmake MLINESTYLE dictionary hoặc nạp .mln trước.` | Dialog, có thể crash console. Style phải nạp trước khi dùng MLINE. |
| 🖥 | **EXPORTPDF** | `Chỉ bản GUI. Không có -EXPORTPDF command-line.` | PROBE: 'Unknown command EXPORTPDF' trong AcCoreConsole. Lệ thuộc backend PDF GUI Mac. |
| 🖥 | **PUBLISH / -PUBLISH (batch PDF)** | `Windows: -PUBLISH + .DSD. Mac: PUBLISH dialog.` | PROBE: PUBLISH nhận nhưng NO-OP trong console (mở dialog, không DSD). Backend PDF Mac hỏng → không tạo PDF headless. |
| 🖥 | **JPGOUT / PNGOUT (raster)** | `_.PNGOUT/_.JPGOUT phụ thuộc viewport/màn hình.` | ~100 DPI, không xuất lớn hơn màn hình → GUI-only (console không có screen). Muốn hi-res: PDF (GUI) rồi convert. |
| 🖥 | **TABLE / ACAD_TABLE** | `Không có -TABLE. Headless: entmake ACAD_TABLE hoặc ObjectARX/.NET; offline vẽ lưới+text bằng ezdxf.` | Không có bản command-line. Với BOM nên xuất CSV thay vì bảng trong DWG. |
| 🖥 | **Render / Visual Styles / VSCURRENT / 3DORBIT / HIDE / SHADE** | `Không tạo output — console không có graphics pipeline/canvas.` | Suy chắc chắn từ 'no drawing canvas'. Rendering là mảng GUI-only điển hình. |
| 🖥 | **Palette/Ribbon/Properties/Tool Palettes/Dynamic input** | `Cấu hình qua setvar trong script thay palette.` | GUI-only, liệt kê để phân định ranh giới. |
| ❌ | **vlax-curve-* (đo length/area qua ename)** | `KHÔNG DÙNG. (vlax-curve-getEndParam e), (vlax-curve-getDistAtParam e p) → lỗi. Thay bằng getpropertyvalue hoặc tính tay DXF.` | PROBE-CONFIRMED FAIL trên Mac: 'no function definition: VLAX-CURVE-GETENDPARAM'. (vl-load-com) trả 'yes' nhưng KHÔNG nạp object model. RÀNG  |
| ❌ | **vla-* / vlax-get-acad-object / vlax-ename->vla-object** | `KHÔNG DÙNG. Thay: entget/entmod, getpropertyvalue/setpropertyvalue, tblnext/tblobjname, ssget "X".` | PROBE-CONFIRMED FAIL: 'no function definition: VLAX-ENAME->VLA-OBJECT'. Doc: 'Supported on Windows only'. Toàn tool MEP tránh nhánh vla-* từ |
| ❌ | **Reactors vlr-* (vlr-command/object/dwg-reactor)** | `Không dùng. Muốn event-driven → ObjectARX/.NET (nếu chạy được).` | ActiveX extension, Windows-only + vô nghĩa trong phiên headless không tương tác. |
| ❌ | **-PLOT ra PDF (Mac headless)** | `Trên Mac phải chạy .scr khi app GUI mở. Windows accoreconsole: -PLOT + 'DWG To PDF.pc3' OK.` | PROBE-CONFIRMED FAIL trên Mac AcCoreConsole: crash 'AutoCAD cannot continue' hoặc treo 0% CPU, 0 PDF. Backend PDF Mac cần Quartz/GUI. Các .p |
| ❌ | **-EXPORT (DGN/STL/PDF tổng hợp)** | `Thay bằng lệnh riêng: STL→STLOUT, DGN→DGNEXPORT.` | PROBE: 'Unknown command -EXPORT' trong AcCoreConsole. |
| ❌ | **DATAEXTRACTION / -DATAEXTRACTION** | `Thay: -ATTEXT (CSV) hoặc bóc offline bằng ezdxf (đọc INSERT+ATTRIB).` | KHÔNG có trên AutoCAD for Mac ('Unknown command' trên forum Mac). XLS/MDB là format Windows. Hợp kiến trúc hybrid: dùng ezdxf. |

## Chức năng MEP nên build (ưu tiên)

| # | Chức năng | Endpoint | Effort | Giá trị |
|---|---|---|---|---|
| 1 | QA dọn & chuẩn hoá bản vẽ (audit + purge + overkill) | `AcCoreConsole /i <dwg> /s qa.scr → AUDIT Y; -PURGE All <blan` | low | Cao nhất: 1 batch làm sạch cả folder DWG, PROBE-CONFIRMED giảm file 2.71MB→369KB, 58→37 la |
| 2 | Bóc BOM ống ra CSV (pipe length takeoff theo layer/hệ thống) | `AcCoreConsole /i <dwg> /s bom_pipe.scr → ssget theo layer + ` | med | Cao: tự động hoá khối lượng ống — PROBE-CONFIRMED đo đúng MLINE/LWPOLYLINE có cung. Thay t |
| 3 | Bóc BOM phụ kiện/thiết bị ra CSV (fitting & equipment count) | `AcCoreConsole /i <dwg> /s bom_fit.scr → ssget INSERT + gom t` | low | Cao: đếm van/siphong/thiết bị tự động — PROBE t8 phân biệt được block thật vs anonymous *U |
| 4 | Thống kê khối lượng tổng hợp (quantity takeoff report JSON/CSV) | `AcCoreConsole /i <dwg> /s qto.scr → đếm entity theo dxftype+` | med | Cao: dashboard khối lượng 1 file per drawing — PROBE đếm chính xác 549 entity cn.dwg. Feed |
| 5 | Chuẩn hoá layer cả bộ theo standard (layer mapping/rename/color) | `AcCoreConsole /i <dwg> /s layerstd.scr → đọc mapping table, ` | med | Cao: ép cả folder về bộ layer chuẩn công ty — PROBE-CONFIRMED tạo/rename/đổi màu persist.  |
| 6 | Sửa khung tên hàng loạt (batch title block attribute update) | `AcCoreConsole /i <dwg> /s titleblock.scr → ssget INSERT(66=1` | med | Cao: cập nhật ngày/người/mã bản vẽ cho cả bộ hồ sơ — PROBE-CONFIRMED sửa ATTRIB persist. G |
| 7 | Trích khung tên ra bảng index (drawing/sheet index) | `for f in *.dwg: AcCoreConsole /i $f /s readtb.scr → đọc ATTR` | med | Cao: tự sinh mục lục bản vẽ (mã, tên, ngày, người vẽ) từ cả folder — PROBE đọc full khung  |
| 8 | Đánh số/tag tự động ống & phụ kiện (auto-numbering + label) | `AcCoreConsole /i <dwg> /s autotag.scr → ssget theo layer, co` | med | Cao: gán mã P-01, VP-02... tự động cho hàng trăm đối tượng, lưu tag vào XDATA để truy vết. |
| 9 | Đo chiều dài ống theo hệ thống + quy đổi đơn vị ra mét | `AcCoreConsole /i <dwg> /s len_system.scr → ssget theo nhóm l` | med | Cao: tổng chiều dài từng hệ (cấp nước/thoát/thông hơi) ra mét — PROBE 91583mm→91.6m. Số li |
| 10 | Đổi version DWG hàng loạt (batch downgrade/convert) | `for f in *.dwg: AcCoreConsole /i $f /s saveas.scr → SAVEAS 2` | low | Trung-cao: hạ version cho khách/nhà thầu dùng CAD cũ, hoặc đồng bộ version cả bộ. Đơn giản |
| 11 | Xuất DXF cho pipeline offline ezdxf (hybrid bridge) | `for f in *.dwg: AcCoreConsole /i $f /s dxfout.scr → DXFOUT /` | low | Cao: cầu nối kiến trúc hybrid — chuyển DWG→DXF để Python+ezdxf xử lý sâu (thứ AcCoreConsol |
| 12 | Chèn thư viện block MEP (batch insert component library) | `AcCoreConsole /i <dwg> /s inslib.scr → -INSERT từ /lib/*.dwg` | low | Trung: chèn van/thiết bị/ký hiệu MEP chuẩn hàng loạt từ thư viện. Kết hợp -WBLOCK để dựng  |
| 13 | Tách bản vẽ / xuất block ra DWG riêng (split & extract) | `AcCoreConsole /i <dwg> /s split.scr → -WBLOCK per block hoặc` | med | Trung: tách từng tầng/hệ/block thành file riêng để phát hành hoặc dựng thư viện component. |
| 14 | Gộp bản vẽ (merge multiple DWG into one) | `AcCoreConsole /i base.dwg /s merge.scr → -INSERT nhiều DWG r` | med | Trung: gộp các file tầng/bộ môn thành 1 bản tổng. Cần định vị toạ độ scripted (không có pi |
| 15 | Tag metadata MEP vào XDATA/extension dict (DN, vật liệu, hệ thống) | `AcCoreConsole /i <dwg> /s tagmeta.scr → regapp + entmod XDAT` | med | Trung-cao: gắn thuộc tính kỹ thuật (DN100, PVC, hệ cấp nước) vào từng ống để BOM/truy vết  |
| 16 | Bóc spec ống từ MULTILEADER thành bảng (callout → spec CSV) | `AcCoreConsole /i <dwg> /s spec.scr → ssget MULTILEADER + par` | low | Trung-cao: PROBE đọc 'd90/vp-pvc-d110' → tự bóc đường kính+vật liệu ống thành bảng. Bổ sun |
| 17 | Kiểm tra tuân thủ layer standard (layer compliance audit) | `for f in *.dwg: AcCoreConsole /i $f /s laycheck.scr → tblnex` | low | Trung: phát hiện layer không đúng chuẩn trong cả bộ hồ sơ trước khi phát hành. Read-only,  |
| 18 | Đổi đơn vị / scale bản vẽ (unit conversion) | `AcCoreConsole /i <dwg> /s unit.scr → đọc INSUNITS, SCALE toà` | med | Trung: đồng nhất đơn vị khi gộp bản vẽ từ nhiều nguồn. Không có DWGUNITS trên Mac → dùng S |
| 19 | Báo cáo thống kê entity toàn bộ (drawing statistics dashboard) | `for f in *.dwg: AcCoreConsole /i $f /s stats.scr → đếm dxfty` | low | Trung: bức tranh sức khoẻ/quy mô cả folder (số entity, layer, đơn vị, version). Read-only, |
| 20 | Batch xuất PDF phát hành hồ sơ (multi-sheet PDF) | `Mac: chạy .scr -PLOT khi AutoCAD GUI mở (AppleScript/-b). Wi` | high | Cao về nghiệp vụ nhưng GIỚI HẠN: PROBE-CONFIRMED -PLOT crash headless trên Mac. Chỉ khả th |

## KHÔNG làm được headless (giới hạn Mac)

- Xuất PDF headless trên Mac: -PLOT crash/treo (PROBE-CONFIRMED), EXPORTPDF 'Unknown command', PUBLISH no-op → phải chạy khi AutoCAD GUI mở, hoặc dùng Windows accoreconsole / Design Automation cloud
- DATAEXTRACTION / -DATAEXTRACTION: không tồn tại trên AutoCAD for Mac ('Unknown command') → thay bằng -ATTEXT hoặc ezdxf offline
- Raster JPGOUT / PNGOUT: phụ thuộc viewport/màn hình, ~100 DPI, console không có screen
- MLSTYLE: tạo multiline style là dialog, không có -MLSTYLE (style phải nạp trước khi vẽ MLINE)
- TABLE / chèn bảng AcDbTable: không có -TABLE (phải entmake ACAD_TABLE hoặc ObjectARX; BOM nên xuất CSV)
- FIELD (build biểu thức field): cần dialog; chỉ UPDATEFIELD chạy được headless
- LAYER / LAYERSTATE / PURGE / OVERKILL / DIMSTYLE / WBLOCK / INSERT / RENAME / SCALELISTEDIT / ATTEXT (bản KHÔNG dấu gạch): mở dialog/palette → phải dùng bản '-' (hyphen) + FILEDIA/CMDDIA 0
- INSERT hiện đại (Blocks palette) & CLASSICINSERT: GUI → dùng -INSERT
- Render / Visual Styles / VSCURRENT / 3DORBIT / HIDE / SHADE / SHADEMODE / real-time PAN-ZOOM: không có graphics pipeline trong Core Console
- ActiveX/COM toàn bộ: vla-*, vlax-get-acad-object, vlax-create-object, vlax-ename->vla-object, vlax-import-type-library — 'no function definition' trên Mac (PROBE-CONFIRMED), Windows-only
- vlax-curve-* (getEndParam/getDistAtParam/getArea...): 'no function definition' trên Mac → mọi đo hình học phải tính tay từ DXF group codes
- Reactors vlr-* (command/object/dwg/editor reactor): ActiveX extension Windows-only + vô nghĩa trong phiên headless
- Palette / Ribbon / Properties / Tool Palettes / Dynamic input / Command-line UI: không truy cập được, cấu hình qua setvar
- ssget interactive (pick / Window / Crossing / implied "_I"): cần con trỏ/màn hình → dùng ssget "X"/"_A" + filter
- Mọi dialog / file browser: bị chặn → dùng lệnh '-' + (setvar FILEDIA 0)(setvar CMDDIA 0)(setvar ATTDIA 0)
- -EXPORT (DGN/STL/PDF tổng hợp): 'Unknown command' → dùng lệnh riêng (STLOUT / DGNEXPORT)
- PLOT PREVIEW: chỉ GUI
- CUI / customization dialog: có thể crash Core Console (Kean 2013)
- MODEMACRO (status bar DIESEL): GUI, vô nghĩa headless
- BCOUNT (Express Tool): thường không tự nạp trong AcCoreConsole → dùng ssget INSERT đếm thay
- Dấu vết cần probe thêm (chưa xác nhận, không dùng ngay): -ATTEXT trên Mac, DGNEXPORT, MEASUREGEOM đọc kết quả, NETLOAD/.NET AcCoreMgd, acaddoc.lsp autoload, ObjectARX .bundle (chưa có Xcode/ODA)
;;; ============================================================================
;;;  draw_lib.lsp — thư viện VẼ THẬT cho AutoCAD Toolkit (headless + live)
;;;
;;;  Mọi primitive ở đây ĐÃ ĐƯỢC KIỂM CHỨNG chạy được trong AcCoreConsole
;;;  (AutoCAD 2027 for Mac, X.60.M.161) trên bản vẽ trống — xem
;;;  acad-studio/DRAW-FUNCTIONS.md §"Kiểm chứng primitive".
;;;
;;;  Quy ước:
;;;    - Prefix `dl:` (draw lib).
;;;    - Hàm vẽ trả về ename của entity vừa tạo (hoặc nil khi hỏng).
;;;    - Hàm "ensure" (layer/style/dimstyle/mlinestyle) idempotent: gọi lại
;;;      nhiều lần không tạo trùng.
;;;    - Toạ độ = list (x y) hoặc (x y z), theo drawing units hiện tại.
;;;      Các profile/ví dụ MEP giả định INSUNITS=4 (mm); caller phải kiểm tra.
;;;
;;;  Nạp: (load "/abs/path/acad-lisp/headless/draw_lib.lsp")
;;; ============================================================================

;;; ---------------------------------------------------------------- tiện ích

(defun dl:pt (p) ; "x,y" cho command prompt
  (strcat (rtos (car p) 2 6) "," (rtos (cadr p) 2 6)))

(defun dl:p3 (p) ; list 3D cho entmake
  (list (float (car p)) (float (cadr p)) (if (caddr p) (float (caddr p)) 0.0)))

(defun dl:silent ( )
  (setvar "CMDECHO" 0) (setvar "FILEDIA" 0) (setvar "ATTDIA" 0)
  (setvar "ATTREQ" 0)  (setvar "OSMODE" 0)  (setvar "BLIPMODE" 0)
  (princ))

(defun dl:dist (p1 p2)
  (sqrt (+ (expt (- (car p2) (car p1)) 2.0) (expt (- (cadr p2) (cadr p1)) 2.0))))

;;; ------------------------------------------------------------------ LAYER

(defun dl:layer (name col ltype / rec ent)
  "Tạo/đặt thuộc tính layer. col = ACI 1..255, ltype = nil|\"Continuous\"|...

   DÙNG entmake/entmod thay (command \"_.-LAYER\" …): hàm này chạy ở MỌI bước
   vẽ; lệnh có dấu nhắc mà hỏng giữa chừng sẽ để AutoCAD kẹt (xem dl:preview-apply)."
  (setq rec (list '(0 . "LAYER")
                  '(100 . "AcDbSymbolTableRecord")
                  '(100 . "AcDbLayerTableRecord")
                  (cons 2 name)
                  '(70 . 0)
                  (cons 62 col)))
  (if (and ltype (tblsearch "LTYPE" ltype))
    (setq rec (append rec (list (cons 6 ltype)))))
  (if (tblsearch "LAYER" name)
    ;; đã có → cập nhật màu (+ linetype nếu chỉ định)
    (progn
      (setq ent (entget (tblobjname "LAYER" name)))
      (setq ent (subst (cons 62 col) (assoc 62 ent) ent))
      (if (and ltype (tblsearch "LTYPE" ltype) (assoc 6 ent))
        (setq ent (subst (cons 6 ltype) (assoc 6 ent) ent)))
      (entmod ent))
    (entmake rec))
  name)

(defun dl:clayer (name)
  (if (not (tblsearch "LAYER" name)) (dl:layer name 7 nil))
  (setvar "CLAYER" name)
  name)

;; Bộ layer chuẩn rút từ bản vẽ mẫu ABD_He thong thoat nuoc tang 1.
;; (tên . màu ACI) — màu lấy đúng từ dump layers.csv của bản vẽ mẫu.
(defun dl:std-layers ( / )
  (foreach L '(("P-ThoatXi"     . 190)   ; ống thoát xí  (soil pipe)
               ("P-ThoatRua"    .  50)   ; ống thoát rửa (waste pipe)
               ("P-ThongHoi"    .   5)   ; ống thông hơi (vent)
               ("P-Hientrang"   .   8)   ; hiện trạng
               ("DCCD-nuoclanh" .  90)   ; nước lạnh / trục đứng
               ("DCCD-text"     .  93)   ; ghi chú hệ thống
               ("A.DIM"         .   7)   ; kích thước
               ("Leader"        . 255)   ; ghi chú dẫn
               ("CT-Leader"     .   7)   ; ghi chú chi tiết
               ("RSA -HACK"     .   8)   ; nền kiến trúc
               ("0-9"           .   8))  ; khung tên
    (dl:layer (car L) (cdr L) nil))
  (length '(1 2 3 4 5 6 7 8 9 10 11)))

;;; ------------------------------------------------------------ MLINE STYLE

(defun dl:ltype (name / )
  "Nạp linetype từ acadiso.lin nếu chưa có (CENTER2 dùng cho tim ống)."
  (if (not (tblsearch "LTYPE" name))
    (command "_.-LINETYPE" "_L" name "acadiso.lin" ""))
  (tblsearch "LTYPE" name))

(defun dl:mlstyle (name desc / dic e existing)
  "Tạo mline style 3 element: +0.5 BYLAYER / 0.0 CENTER2 màu 8 / -0.5 BYLAYER.
   Bề rộng danh nghĩa 1.0 => MLINE scale N cho ra ống DN = N mm.
   Đúng định nghĩa MLST1/MLST2 của bản vẽ mẫu (71=3, 70=544). Idempotent."
  (dl:ltype "CENTER2")
  (setq dic (cdr (assoc -1 (dictsearch (namedobjdict) "ACAD_MLINESTYLE"))))
  (setq existing (dictsearch dic name))
  (cond
    (existing T)
    ((not dic) nil)
    (T
     (setq e (entmakex (list '(0 . "MLINESTYLE") '(100 . "AcDbMlineStyle")
                             (cons 2 name) '(70 . 544) (cons 3 (if desc desc ""))
                             '(62 . 256) '(51 . 1.5708) '(52 . 1.5708)
                             '(71 . 3)
                             '(49 . 0.5)  '(62 . 256) '(6 . "BYLAYER")
                             '(49 . 0.0)  '(62 . 8)   '(6 . "CENTER2")
                             '(49 . -0.5) '(62 . 256) '(6 . "BYLAYER"))))
     (if e (progn (dictadd dic name e) T) nil))))

;;; -------------------------------------------------------------------- ỐNG

(defun dl:pipe (layer style dn pts / old n)
  "Vẽ 1 tuyến ống = MLINE. dn = đường kính danh nghĩa (mm) -> MLINE scale.
   pts = list các điểm ((x y) (x y) ...). Justification = Zero (tim ống).
   Trả về ename MLINE, hoặc nil."
  (if (< (length pts) 2) nil
    (progn
      (dl:mlstyle style "AcadToolkit pipe")
      (setq old (getvar "CLAYER"))
      (dl:clayer layer)
      ;; 28/35 ống của bản mẫu mang group 48 = 200.0 → nét CENTER2 ở tim ống hiển
      ;; thị đúng ở tỷ lệ 1:100. Lấy 200 làm mặc định.
      (setvar "CELTSCALE" 200.0)
      (setq n (entlast))
      (command "_.MLINE" "_ST" style "_S" (rtos (float dn) 2 3) "_J" "_Z")
      (foreach p pts (command (dl:pt p)))
      (command "")
      (setvar "CLAYER" old)
      (if (eq n (entlast)) nil (entlast)))))

(defun dl:pipe-len (pts / tot i)
  (setq tot 0.0 i 0)
  (while (< i (1- (length pts)))
    (setq tot (+ tot (dl:dist (nth i pts) (nth (1+ i) pts))) i (1+ i)))
  tot)

;;; --------------------------------------------------------- LWPOLYLINE/nét

(defun dl:lwpoly (layer pts closed / d)
  "LWPOLYLINE (dùng cho đường bao, mũi tên hướng dòng, khung vùng)."
  (if (< (length pts) 2) nil
    (progn
      (setq d (list '(0 . "LWPOLYLINE") '(100 . "AcDbEntity") (cons 8 layer)
                    '(100 . "AcDbPolyline")
                    (cons 90 (length pts)) (cons 70 (if closed 1 0))))
      (foreach p pts (setq d (append d (list (cons 10 (dl:p3 p))))))
      (entmakex d))))

(defun dl:line (layer p1 p2)
  (entmakex (list '(0 . "LINE") '(100 . "AcDbEntity") (cons 8 layer)
                  '(100 . "AcDbLine") (cons 10 (dl:p3 p1)) (cons 11 (dl:p3 p2)))))

(defun dl:circle (layer c r)
  "CIRCLE — dùng cho ký hiệu trục đứng (riser)."
  (entmakex (list '(0 . "CIRCLE") '(100 . "AcDbEntity") (cons 8 layer)
                  '(100 . "AcDbCircle") (cons 10 (dl:p3 c)) (cons 40 (float r)))))

;;; ------------------------------------------------------------------- CHỮ

(defun dl:textstyle (name font width / )
  "Tạo text style. font = tên file .shx/.ttf. Idempotent.
   Chuỗi prompt -STYLE: font, height, width, oblique, backwards, upside-down, vertical."
  (if (not (tblsearch "STYLE" name))
    (command "_.-STYLE" name font "0" (rtos (float width) 2 3) "0" "_N" "_N" "_N"))
  name)

(defun dl:text (layer style pt h rot txt)
  "TEXT một dòng (entmake — không phụ thuộc prompt)."
  (entmakex (list '(0 . "TEXT") '(100 . "AcDbEntity") (cons 8 layer)
                  '(100 . "AcDbText") (cons 10 (dl:p3 pt)) (cons 40 (float h))
                  (cons 1 txt) (cons 7 (if style style "Standard"))
                  (cons 50 (float rot)) '(100 . "AcDbText"))))

(defun dl:mtext (layer style pt h width txt)
  (entmakex (list '(0 . "MTEXT") '(100 . "AcDbEntity") (cons 8 layer)
                  '(100 . "AcDbMText") (cons 10 (dl:p3 pt)) (cons 40 (float h))
                  (cons 41 (float width)) '(71 . 1) (cons 1 txt)
                  (cons 7 (if style style "Standard")))))

;;; -------------------------------------------------------------- KÍCH THƯỚC

(defun dl:dimstyle (name post scale txt asz clrt txtsty / )
  "Lưu dimstyle từ các biến DIM* hiện hành. Idempotent (bỏ qua nếu đã có —
   gọi -DIMSTYLE _Save trên style ĐÃ CÓ sẽ sinh prompt xác nhận và treo script).

   post  = DIMPOST, vd \"-D110\" → text kích thước hiện «434-D110» (bản mẫu để
           group 1 rỗng, hậu tố DN đến từ DIMPOST chứ không override text).
   scale = DIMSCALE (bản mẫu: 100 cho sơ đồ trục đứng, 35 cho mặt bằng)."
  (if (not (tblsearch "DIMSTYLE" name))
    (progn
      (setvar "DIMSCALE" (float scale))
      (setvar "DIMTXT"   (float txt))
      (setvar "DIMASZ"   (float asz))
      (setvar "DIMEXE" 1.0) (setvar "DIMEXO" 1.0) (setvar "DIMGAP" 0.5)
      (setvar "DIMDEC" 0)   (setvar "DIMLUNIT" 2)
      (setvar "DIMPOST" (if post post ""))
      (if clrt (setvar "DIMCLRT" clrt))
      (if (and txtsty (tblsearch "STYLE" txtsty)) (setvar "DIMTXSTY" txtsty))
      (command "_.-DIMSTYLE" "_SAVE" name)
      (setvar "DIMPOST" "")))
  name)

(defun dl:dim-linear (layer style orient p1 p2 ptxt / old n)
  "DIMLINEAR (AcDbRotatedDimension) — đúng loại dim của bản vẽ mẫu (g70=32,
   g50 chỉ 0 hoặc pi/2). KHÔNG dùng DIMALIGNED: nó sinh g70=33 và đo khoảng
   cách xiên, khác số đo trong bản mẫu.
   orient = \"H\" (ngang, g50=0) hoặc \"V\" (đứng, g50=1.5708)."
  (setq old (getvar "CLAYER"))
  (if (and style (tblsearch "DIMSTYLE" style))
    (command "_.-DIMSTYLE" "_RESTORE" style))
  (dl:clayer layer)
  (setq n (entlast))
  (command "_.DIMLINEAR" (dl:pt p1) (dl:pt p2)
           (if (= orient "V") "_V" "_H") (dl:pt ptxt))
  (setvar "CLAYER" old)
  (if (eq n (entlast)) nil (entlast)))

(defun dl:dim-aligned (layer style p1 p2 ptxt / old n)
  "DIMALIGNED — đo khoảng cách xiên. Bản vẽ mẫu KHÔNG dùng loại này; giữ lại
   cho các bản vẽ khác."
  (setq old (getvar "CLAYER"))
  (if (and style (tblsearch "DIMSTYLE" style))
    (command "_.-DIMSTYLE" "_RESTORE" style))
  (dl:clayer layer)
  (setq n (entlast))
  (command "_.DIMALIGNED" (dl:pt p1) (dl:pt p2) (dl:pt ptxt))
  (setvar "CLAYER" old)
  (if (eq n (entlast)) nil (entlast)))

;;; ------------------------------------------------------------ GHI CHÚ DẪN

(defun dl:mleader (layer parrow pland txt h / dx dy L ux uy ax ay pend e)
  "Ghi chú dẫn: LEADER (entmake, KHÔNG dùng prompt) + mũi tên + TEXT.

   CỐ Ý KHÔNG dùng lệnh MLEADER: trên bản vẽ đã có nhiều entity, lệnh này
   sinh prompt phụ và TREO AcCoreConsole (đã gặp: quá 180 s, 5 bước hỏng).
   Lệnh có prompt không dùng được trong pipeline chạy không người trông.

   parrow = đầu mũi tên (trỏ vào ống); pland = điểm gãy; txt đặt sau pland.
   h = chiều cao chữ; nil → 200."
  (if (null h) (setq h 200.0))
  ;; đoạn landing nằm ngang, dài bằng ~1.2 lần bề rộng chữ
  (setq pend (list (+ (car pland) (* h (strlen txt) 0.65)) (cadr pland)))
  (entmakex (list '(0 . "LEADER") '(100 . "AcDbEntity") (cons 8 layer)
                  '(100 . "AcDbLeader") '(3 . "Standard")
                  '(71 . 1) '(72 . 0) '(73 . 3) '(74 . 0) '(75 . 0)
                  '(76 . 3)
                  (cons 10 (dl:p3 parrow)) (cons 10 (dl:p3 pland))
                  (cons 10 (dl:p3 pend))))
  ;; mũi tên đặc ở đầu parrow, hướng từ pland về parrow
  (setq dx (- (car parrow) (car pland)) dy (- (cadr parrow) (cadr pland))
        L (sqrt (+ (* dx dx) (* dy dy))))
  (if (> L 1e-6)
    (progn
      (setq ux (/ dx L) uy (/ dy L) ax (* h 0.5) ay (* h 0.18))
      (dl:lwpoly layer
        (list parrow
              (list (- (car parrow) (* ux ax) (* uy ay))
                    (- (cadr parrow) (* uy ax) (- (* ux ay))))
              (list (- (car parrow) (* ux ax) (- (* uy ay)))
                    (- (cadr parrow) (* uy ax) (* ux ay))))
        T)))
  (dl:text layer "MEP-TXT" (list (car pland) (+ (cadr pland) (* h 0.25))) h 0.0 txt))

(defun dl:leader (layer parrow pland txt / old n)
  "LEADER cổ điển — fallback khi MLEADER không khả dụng."
  (setq old (getvar "CLAYER"))
  (dl:clayer layer)
  (setq n (entlast))
  (command "_.LEADER" (dl:pt parrow) (dl:pt pland) "" txt "")
  (setvar "CLAYER" old)
  (if (eq n (entlast)) nil (entlast)))

;;; ------------------------------------------------------------------ HATCH

(defun dl:hatch (layer pattern scale ang ent / old n)
  "Tô mặt cắt lên biên là entity `ent` (LWPOLYLINE/CIRCLE đóng).
   Bản mẫu dùng ANSI31 scale 20 góc 0 trên layer P-ThoatRua."
  (setq old (getvar "CLAYER"))
  (dl:clayer layer)
  (setq n (entlast))
  (command "_.-HATCH" "_P" pattern (rtos (float scale) 2 3) (rtos (float ang) 2 3)
           "_S" ent "" "")
  (setvar "CLAYER" old)
  (if (eq n (entlast)) nil (entlast)))

;;; ------------------------------------------------------------------ BLOCK

(defun dl:block-begin (name)
  (entmake (list '(0 . "BLOCK") (cons 2 name) '(70 . 2) '(10 0.0 0.0 0.0))))

(defun dl:block-end ( )
  (entmake '((0 . "ENDBLK"))))

(defun dl:attdef (pt h tag prompt default)
  (entmake (list '(0 . "ATTDEF") '(8 . "0") (cons 10 (dl:p3 pt)) (cons 40 (float h))
                 (cons 1 default) (cons 2 tag) (cons 3 prompt)
                 '(70 . 0) '(73 . 0) '(50 . 0.0))))

(defun dl:insert (layer blk pt sc rot atts / e)
  "INSERT bằng entmake (không phụ thuộc prompt -INSERT).
   atts = list ((tag . value) ...) hoặc nil. Đặt ATTRIB cạnh điểm chèn."
  (if (not (tblsearch "BLOCK" blk)) nil
    (progn
      (setq e (entmakex (list '(0 . "INSERT") '(100 . "AcDbEntity") (cons 8 layer)
                              '(100 . "AcDbBlockReference")
                              (cons 66 (if atts 1 0)) (cons 2 blk)
                              (cons 10 (dl:p3 pt))
                              (cons 41 (float sc)) (cons 42 (float sc)) (cons 43 (float sc))
                              (cons 50 (float rot)))))
      (if atts
        (progn
          (foreach a atts
            (entmakex (list '(0 . "ATTRIB") '(100 . "AcDbEntity") (cons 8 layer)
                            '(100 . "AcDbText")
                            (cons 10 (dl:p3 (list (+ (car pt) (* sc 60.0))
                                                  (+ (cadr pt) (* sc 60.0)))))
                            (cons 40 (* (float sc) 100.0)) (cons 1 (cdr a))
                            '(100 . "AcDbAttribute") (cons 2 (car a)) '(70 . 0))))
          (entmakex (list '(0 . "SEQEND") '(100 . "AcDbEntity") (cons 8 layer)))))
      e)))

;;; ------------------------------------------------- THƯ VIỆN PHỤ KIỆN (fitting)
;;; Bản mẫu ghi phụ kiện bằng block có ATTRIB, tag theo loại:
;;;   CHECHDENHAT       "Chếch; uPVC; DN90"      (chếch 45°)
;;;   YTIENPHONGTHOAT   "Y đều; uPVC; DN125"     (nhánh Y)
;;;   CONTIENPHONGTHOAT "Côn; uPVC; D125/90"     (côn thu)
;;;   CUTDENHAT         "Cút; PPR; DN90"         (cút 90°)

(defun dl:fitting-blockname (kind dn) (strcat "FIT-" kind "-D" (rtos (float dn) 2 0)))

(defun dl:fitting-tag (kind)
  (cond ((= kind "CHECH") "CHECHDENHAT")
        ((= kind "Y")     "YTIENPHONGTHOAT")
        ((= kind "CON")   "CONTIENPHONGTHOAT")
        ((= kind "CUT")   "CUTDENHAT")
        (T "FITTING")))

(defun dl:def-fitting (kind dn / nm r)
  "Định nghĩa block phụ kiện theo loại + DN. Hình học tỉ lệ theo DN.
   kind: CHECH (chếch 45) | Y (nhánh Y) | CON (côn thu) | CUT (cút 90)."
  (setq nm (dl:fitting-blockname kind dn) r (/ (float dn) 2.0))
  (if (tblsearch "BLOCK" nm) nm
    (progn
      (dl:block-begin nm)
      (cond
        ;; Chếch 45°: hai đoạn ống gặp nhau ở 45 độ
        ((= kind "CHECH")
         (entmake (list '(0 . "LINE") '(8 . "0") (cons 10 (dl:p3 (list (- r) (- r))))
                        (cons 11 (dl:p3 (list 0.0 0.0)))))
         (entmake (list '(0 . "LINE") '(8 . "0") (cons 10 (dl:p3 (list 0.0 0.0)))
                        (cons 11 (dl:p3 (list (* r 1.41) (- r))))))
         (entmake (list '(0 . "LINE") '(8 . "0") (cons 10 (dl:p3 (list (- r) r)))
                        (cons 11 (dl:p3 (list (* r 1.41) r))))))
        ;; Cút 90°: cung nối hai nhánh vuông góc
        ((= kind "CUT")
         (entmake (list '(0 . "ARC") '(8 . "0") (cons 10 (dl:p3 (list r r)))
                        (cons 40 r) '(50 . 3.14159) '(51 . 4.71239)))
         (entmake (list '(0 . "LINE") '(8 . "0") (cons 10 (dl:p3 (list 0.0 (* r 2.0))))
                        (cons 11 (dl:p3 (list 0.0 r)))))
         (entmake (list '(0 . "LINE") '(8 . "0") (cons 10 (dl:p3 (list r 0.0)))
                        (cons 11 (dl:p3 (list (* r 2.0) 0.0))))))
        ;; Y: ống chính + nhánh xiên 45°
        ((= kind "Y")
         (entmake (list '(0 . "LINE") '(8 . "0") (cons 10 (dl:p3 (list (- r) 0.0)))
                        (cons 11 (dl:p3 (list (* r 2.0) 0.0)))))
         (entmake (list '(0 . "LINE") '(8 . "0") (cons 10 (dl:p3 (list 0.0 0.0)))
                        (cons 11 (dl:p3 (list r r)))))
         (entmake (list '(0 . "LINE") '(8 . "0") (cons 10 (dl:p3 (list r 0.0)))
                        (cons 11 (dl:p3 (list (* r 1.7) (* r 0.7)))))))
        ;; Côn thu: hình thang
        ((= kind "CON")
         (entmake (list '(0 . "LWPOLYLINE") '(8 . "0") '(100 . "AcDbEntity")
                        '(100 . "AcDbPolyline") '(90 . 4) '(70 . 0)
                        (cons 10 (dl:p3 (list 0.0 r)))
                        (cons 10 (dl:p3 (list (* r 1.5) (* r 0.6))))
                        (cons 10 (dl:p3 (list (* r 1.5) (* r -0.6))))
                        (cons 10 (dl:p3 (list 0.0 (- r)))))))
        (T (entmake (list '(0 . "CIRCLE") '(8 . "0") '(10 0.0 0.0 0.0) (cons 40 r)))))
      (dl:attdef (list (* r 1.2) (* r 1.2)) (* (float dn) 1.2)
                 (dl:fitting-tag kind) "Phu kien" "")
      (dl:block-end)
      nm)))

(defun dl:fitting (layer kind dn pt rot label / nm)
  "Chèn 1 phụ kiện. label = chuỗi mô tả ghi vào ATTRIB, vd \"Chech; uPVC; DN90\"."
  (setq nm (dl:def-fitting kind dn))
  (dl:insert layer nm pt 1.0 rot (list (cons (dl:fitting-tag kind) label))))

;;; =========================================================================
;;;  KIẾN TRÚC — mặt bằng nền (trục, tường, lõi thang, WC, cửa, nhãn phòng)
;;;
;;;  Bản vẽ MEP luôn nằm TRÊN nền kiến trúc. Bản mẫu để nền trong block
;;;  B_MBT1 (layer RSA -HACK); ở đây vẽ lại bằng tham số từ t1-plan-spec.json.
;;; =========================================================================

;; Layer kiến trúc chuẩn (tên . màu ACI)
(defun dl:arch-layers ( / )
  (foreach L '(("A-TRUC"   .   8)   ; lưới trục định vị
               ("A-TUONG"  .   7)   ; tường
               ("A-LOI"    .   4)   ; lõi thang / thang máy
               ("A-CUA"    .   3)   ; cửa
               ("A-TB"     .   6)   ; thiết bị vệ sinh
               ("A-TEXT"   .   2)   ; tên phòng
               ("A-HATCH"  .   9))  ; gạch dốc / ram
    (dl:layer (car L) (cdr L) nil))
  7)

;; ---- Lưới trục -----------------------------------------------------------
(defun dl:grid-line (layer p1 p2 r label style / mid dir)
  "1 trục: đường tim + bubble tròn + nhãn ở CẢ HAI đầu."
  (dl:line layer p1 p2)
  (dl:circle layer p1 r)
  (dl:circle layer p2 r)
  (dl:text layer style (list (- (car p1) (* r 0.45)) (- (cadr p1) (* r 0.45)))
           (* r 1.3) 0.0 label)
  (dl:text layer style (list (- (car p2) (* r 0.45)) (- (cadr p2) (* r 0.45)))
           (* r 1.3) 0.0 label)
  label)

(defun dl:grid (layer style xs ys r ext / x0 x1 y0 y1)
  "Lưới trục đầy đủ. xs = list (\"A\" . x), ys = list (\"1\" . y).
   ext = độ vươn của trục ra ngoài bao công trình (mm)."
  (setq x0 (- (apply 'min (mapcar 'cdr xs)) ext)
        x1 (+ (apply 'max (mapcar 'cdr xs)) ext)
        y0 (- (apply 'min (mapcar 'cdr ys)) ext)
        y1 (+ (apply 'max (mapcar 'cdr ys)) ext))
  (foreach a xs
    (dl:grid-line layer (list (cdr a) y0) (list (cdr a) y1) r (car a) style))
  (foreach a ys
    (dl:grid-line layer (list x0 (cdr a)) (list x1 (cdr a)) r (car a) style))
  (+ (length xs) (length ys)))

;; ---- Tường ---------------------------------------------------------------
(defun dl:wall (layer p1 p2 th / dx dy L nx ny hx hy)
  "Tường 2 nét song song quanh TIM p1→p2, bề dày th. Trả về ename nét thứ 2.
   LƯU Ý: không đặt tên tham số là `t` — T là hằng số của AutoLISP."
  (setq dx (- (car p2) (car p1)) dy (- (cadr p2) (cadr p1))
        L (sqrt (+ (* dx dx) (* dy dy))))
  (if (< L 1e-6) nil
    (progn
      (setq nx (/ (- dy) L) ny (/ dx L)
            hx (* nx (/ th 2.0)) hy (* ny (/ th 2.0)))
      (dl:line layer (list (+ (car p1) hx) (+ (cadr p1) hy))
                     (list (+ (car p2) hx) (+ (cadr p2) hy)))
      (dl:line layer (list (- (car p1) hx) (- (cadr p1) hy))
                     (list (- (car p2) hx) (- (cadr p2) hy))))))

(defun dl:room-box (layer x1 y1 x2 y2)
  "Khung chữ nhật (phòng / hộp kỹ thuật)."
  (dl:lwpoly layer (list (list x1 y1) (list x2 y1) (list x2 y2) (list x1 y2)) T))

;; ---- Lõi giao thông ------------------------------------------------------
(defun dl:stair (layer x1 y1 x2 y2 n dir / i w hgt)
  "Cầu thang bộ: khung + n bậc đều + mũi tên chiều lên.
   dir = \"V\" (bậc nằm ngang, người đi theo phương Y) hoặc \"H\"."
  (dl:room-box layer x1 y1 x2 y2)
  (setq i 1)
  (if (= dir "H")
    (progn
      (setq w (/ (- x2 x1) (float n)))
      (while (< i n)
        (dl:line layer (list (+ x1 (* i w)) y1) (list (+ x1 (* i w)) y2))
        (setq i (1+ i))))
    (progn
      (setq hgt (/ (- y2 y1) (float n)))
      (while (< i n)
        (dl:line layer (list x1 (+ y1 (* i hgt))) (list x2 (+ y1 (* i hgt))))
        (setq i (1+ i)))))
  ;; mũi tên chiều lên (dọc tim thang)
  (setq w (/ (+ x1 x2) 2.0))
  (dl:line layer (list w (+ y1 (* (- y2 y1) 0.1))) (list w (+ y1 (* (- y2 y1) 0.9))))
  (dl:line layer (list w (+ y1 (* (- y2 y1) 0.9)))
                 (list (- w (* (- x2 x1) 0.12)) (+ y1 (* (- y2 y1) 0.78))))
  (dl:line layer (list w (+ y1 (* (- y2 y1) 0.9)))
                 (list (+ w (* (- x2 x1) 0.12)) (+ y1 (* (- y2 y1) 0.78))))
  n)

(defun dl:elevator (layer x1 y1 x2 y2 / )
  "Thang máy: khung + 2 đường chéo (ký hiệu cabin) + khe cửa."
  (dl:room-box layer x1 y1 x2 y2)
  (dl:line layer (list x1 y1) (list x2 y2))
  (dl:line layer (list x1 y2) (list x2 y1))
  ;; khe cửa ở cạnh phải
  (dl:line layer (list x2 (+ y1 (* (- y2 y1) 0.35)))
                 (list x2 (+ y1 (* (- y2 y1) 0.65))))
  T)

;; ---- Cửa -----------------------------------------------------------------
(defun dl:door (layer hinge w ang / a rad)
  "Cửa 1 cánh: cánh + cung quét 90°. ang = góc cánh khi đóng (độ)."
  (setq rad (/ (* pi ang) 180.0))
  (dl:line layer hinge (list (+ (car hinge) (* w (cos rad)))
                             (+ (cadr hinge) (* w (sin rad)))))
  (entmakex (list '(0 . "ARC") '(100 . "AcDbEntity") (cons 8 layer)
                  '(100 . "AcDbCircle") (cons 10 (dl:p3 hinge)) (cons 40 (float w))
                  '(100 . "AcDbArc") (cons 50 rad) (cons 51 (+ rad (/ pi 2.0))))))

;; ---- Thiết bị vệ sinh ----------------------------------------------------
(defun dl:fixture (layer kind p r / )
  "Ký hiệu thiết bị vệ sinh nhìn bằng.
   kind: \"xi\" (bồn cầu) | \"chau\" (chậu rửa) | \"tieu\" (tiểu nam)."
  (cond
    ((= kind "xi")
     (dl:circle layer p (* r 0.55))
     (dl:room-box layer (- (car p) (* r 0.45)) (- (cadr p) r)
                        (+ (car p) (* r 0.45)) (- (cadr p) (* r 0.25))))
    ((= kind "chau")
     (entmakex (list '(0 . "ELLIPSE") '(100 . "AcDbEntity") (cons 8 layer)
                     '(100 . "AcDbEllipse") (cons 10 (dl:p3 p))
                     (cons 11 (list (float r) 0.0 0.0)) '(210 0.0 0.0 1.0)
                     '(40 . 0.7) '(41 . 0.0) (cons 42 (* 2.0 pi)))))
    (T ; tiểu
     (dl:circle layer p (* r 0.5))
     (dl:line layer (list (- (car p) (* r 0.5)) (cadr p))
                    (list (+ (car p) (* r 0.5)) (cadr p)))))
  kind)

;; ---- Nhãn phòng ----------------------------------------------------------
(defun dl:room-label (layer style p h name)
  (dl:text layer style p h 0.0 name))

;;; ------------------------------------------------------------- KHUNG TÊN

;; Tag khung tên rút từ block A3-1-1-ISO3TGROUP của bản vẽ mẫu.
(defun dl:titleblock-tags ( )
  '("KHBV" "TENBANVE1" "CHUNHIEM" "CHUTRIBOMON" "THIETKE" "VE1" "VE2"
    "KIENTRUC1-ARCHITECTURE" "XX/YY/ZZZZ" "DD/MM/YYYY" "...........HDTV"))

(defun dl:def-titleblock (name w h / bx by bw bh y i tags)
  "Định nghĩa block khung tên khổ w×h mm (A3 = 420×297) + ô tên bên phải dưới."
  (if (tblsearch "BLOCK" name) name
    (progn
      (dl:block-begin name)
      ;; viền ngoài + viền trong (lề trái 20, còn lại 10)
      (entmake (list '(0 . "LWPOLYLINE") '(8 . "0") '(100 . "AcDbEntity")
                     '(100 . "AcDbPolyline") '(90 . 4) '(70 . 1)
                     (cons 10 (dl:p3 (list 0.0 0.0))) (cons 10 (dl:p3 (list w 0.0)))
                     (cons 10 (dl:p3 (list w h)))     (cons 10 (dl:p3 (list 0.0 h)))))
      (entmake (list '(0 . "LWPOLYLINE") '(8 . "0") '(100 . "AcDbEntity")
                     '(100 . "AcDbPolyline") '(90 . 4) '(70 . 1)
                     (cons 10 (dl:p3 (list 20.0 10.0)))    (cons 10 (dl:p3 (list (- w 10.0) 10.0)))
                     (cons 10 (dl:p3 (list (- w 10.0) (- h 10.0)))) (cons 10 (dl:p3 (list 20.0 (- h 10.0))))))
      ;; ô khung tên 150×60 góc phải dưới
      (setq bw 150.0 bh 60.0 bx (- w 10.0 bw) by 10.0)
      (entmake (list '(0 . "LWPOLYLINE") '(8 . "0") '(100 . "AcDbEntity")
                     '(100 . "AcDbPolyline") '(90 . 4) '(70 . 1)
                     (cons 10 (dl:p3 (list bx by)))          (cons 10 (dl:p3 (list (+ bx bw) by)))
                     (cons 10 (dl:p3 (list (+ bx bw) (+ by bh)))) (cons 10 (dl:p3 (list bx (+ by bh))))))
      ;; các dòng ATTDEF trong ô khung tên
      (setq tags (dl:titleblock-tags) i 0)
      (foreach tg tags
        (setq y (- (+ by bh) 5.0 (* i 5.0)))
        (if (> y by) (dl:attdef (list (+ bx 3.0) y) 2.5 tg tg ""))
        (setq i (1+ i)))
      (dl:block-end)
      name)))

(defun dl:titleblock (layer name pt scale attrs / )
  "Chèn khung tên. attrs = list ((tag . value) ...).
   Bản mẫu chèn khung A3 vào MODEL với scale ≈103.7 (bản vẽ tỷ lệ 1:100)."
  (dl:def-titleblock name 420.0 297.0)
  (dl:insert layer name pt scale 0.0 attrs))

;;; --------------------------------------------------------- LAYOUT + VIEWPORT

(defun dl:layout (name / )
  "Tạo layout mới (nếu chưa có) và chuyển sang layout đó."
  (command "_.-LAYOUT" "_N" name)
  (command "_.-LAYOUT" "_S" name)
  (getvar "CTAB"))

(defun dl:viewport (p1 p2 / n)
  "Tạo viewport trong layout hiện hành (phải đang ở paper space)."
  (setq n (entlast))
  (command "_.MVIEW" (dl:pt p1) (dl:pt p2))
  (if (eq n (entlast)) nil (entlast)))

(defun dl:to-model ( ) (command "_.-LAYOUT" "_S" "Model") (getvar "CTAB"))

;;; ------------------------------------------------------- BẢNG KHỐI LƯỢNG

(defun dl:table (layer style pt colw rowh rows / y x r c)
  "Bảng khối lượng vẽ bằng LINE + TEXT (không phụ thuộc AcDbTable/tablestyle).
   rows = list các dòng, mỗi dòng = list chuỗi. colw = list bề rộng cột."
  (setq y (cadr pt) r 0)
  (foreach row rows
    (setq x (car pt) c 0)
    (foreach cell row
      (dl:line layer (list x y) (list (+ x (nth c colw)) y))
      (dl:line layer (list x y) (list x (- y rowh)))
      (dl:text layer style (list (+ x (* rowh 0.2)) (- y (* rowh 0.75)))
               (* rowh 0.5) 0.0 cell)
      (setq x (+ x (nth c colw)) c (1+ c)))
    (dl:line layer (list x y) (list x (- y rowh)))          ; viền phải
    (setq y (- y rowh) r (1+ r)))
  ;; viền đáy
  (setq x (car pt))
  (foreach w colw (dl:line layer (list x y) (list (+ x w) y)) (setq x (+ x w)))
  r)

;;; ---------------------------------------------- PREVIEW → CHẤP NHẬN → ÁP DỤNG
;;; Hợp đồng wait-apply: vẽ lên layer preview riêng của op, KHÔNG đụng layer đích
;;; cho tới khi user chấp nhận.

(if (not (boundp '*DL-PREVIEW-ACTIVE*))
  (setq *DL-PREVIEW-ACTIVE* '()))
(setq *DL-PREVIEW-XDATA-APP* "ACADPREVIEW")

(defun dl:preview-layer (opid) (strcat "ACAD-PREVIEW-" opid))

(defun dl:preview-key (opid)
  (if (and (= (type opid) 'STR) (> (strlen opid) 0)) (strcase opid) nil))

(defun dl:preview-entry (opid / key)
  (setq key (dl:preview-key opid))
  (if key (assoc key *DL-PREVIEW-ACTIVE*) nil))

(defun dl:preview-state (opid / en data record appdata stored)
  "State trên layer: 1=ACTIVE, 2=CONFLICT, 3=APPLIED, 4=REJECTED, 5=SEALED."
  (setq en (tblobjname "LAYER" (dl:preview-layer opid)))
  (if (and en (tblsearch "APPID" *DL-PREVIEW-XDATA-APP*))
    (progn
      (setq data (entget en (list *DL-PREVIEW-XDATA-APP*))
            record (assoc -3 data)
            appdata (if record (cadr record) nil)
            stored (if appdata (cdr (assoc 1000 (cdr appdata))) nil))
      (if (and stored (= (strcase stored) (strcase opid)))
        (cdr (assoc 1070 (cdr appdata)))
        nil))
    nil))

(defun dl:preview-set-state (opid state / en data old xdata)
  (setq en (tblobjname "LAYER" (dl:preview-layer opid)))
  (if en
    (progn
      (if (not (tblsearch "APPID" *DL-PREVIEW-XDATA-APP*))
        (regapp *DL-PREVIEW-XDATA-APP*))
      (if (tblsearch "APPID" *DL-PREVIEW-XDATA-APP*)
        (progn
          (setq data (entget en (list *DL-PREVIEW-XDATA-APP*))
                old (assoc -3 data)
                xdata (list -3
                  (list *DL-PREVIEW-XDATA-APP*
                        (cons 1000 opid) (cons 1070 state))))
          (entmod (if old (subst xdata old data) (append data (list xdata)))))
        nil))
    nil))

(defun dl:preview-active-p (opid)
  (equal (dl:preview-state opid) 1))

(defun dl:preview-sealed-p (opid)
  (equal (dl:preview-state opid) 5))

(defun dl:preview-owned-p (en opid / data record appdata strings item handle)
  (setq data (entget en (list *DL-PREVIEW-XDATA-APP*))
        record (assoc -3 data)
        appdata (if record (cadr record) nil)
        strings '())
  (if appdata
    (foreach item (cdr appdata)
      (if (= (car item) 1000) (setq strings (cons (cdr item) strings)))))
  (setq strings (reverse strings)
        handle (cdr (assoc 5 data)))
  (and (= (length strings) 2)
       (= (strcase (car strings)) (strcase opid))
       (= (strcase (cadr strings)) (strcase handle))
       (equal (cdr (assoc 1070 (cdr appdata))) 10)))

(defun dl:preview-tag (en opid / data old handle xdata)
  (setq data (entget en (list *DL-PREVIEW-XDATA-APP*))
        old (assoc -3 data)
        handle (cdr (assoc 5 data))
        xdata (list -3
          (list *DL-PREVIEW-XDATA-APP*
                (cons 1000 opid) (cons 1000 handle) (cons 1070 10))))
  (entmod (if old (subst xdata old data) (append data (list xdata)))))

(defun dl:preview-conflict (opid / entry replacement)
  (setq entry (dl:preview-entry opid))
  (if entry
    (progn
      (setq replacement (list (car entry) (cadr entry) "CONFLICT"))
      (setq *DL-PREVIEW-ACTIVE*
        (subst replacement entry *DL-PREVIEW-ACTIVE*))))
  (dl:preview-set-state opid 2)
  nil)

(defun dl:preview-close (opid / entry key old lay keep item)
  (setq entry (dl:preview-entry opid)
        key (dl:preview-key opid)
        lay (dl:preview-layer opid))
  (setq old (if entry (cadr entry) "0"))
  (if (= (strcase (getvar "CLAYER")) (strcase lay))
    (setvar "CLAYER" (if (tblsearch "LAYER" old) old "0")))
  (if entry
    (progn
      (setq keep '())
      (foreach item *DL-PREVIEW-ACTIVE*
        (if (/= (car item) key) (setq keep (cons item keep))))
      (setq *DL-PREVIEW-ACTIVE* (reverse keep))))
  nil)

(defun dl:preview-begin (opid / key lay old)
  "Bắt đầu preview mới. opid phải mới; trả nil nếu layer/op đã tồn tại."
  (setq key (dl:preview-key opid))
  (cond
    ((not key)
     (princ "\n[ACAD] Preview opid phai la chuoi khong rong.")
     nil)
    ((tblsearch "LAYER" (dl:preview-layer opid))
     (dl:preview-conflict opid)
     (princ (strcat "\n[ACAD] Preview layer da ton tai, hay tao opid moi: " opid))
     nil)
    (T
     (setq lay (dl:preview-layer opid) old (getvar "CLAYER"))
     (dl:layer lay 30 nil)
     (if (dl:preview-set-state opid 1)
       (progn
         (setvar "CLAYER" lay)
         (setq *DL-PREVIEW-ACTIVE*
           (cons (list key old "ACTIVE") *DL-PREVIEW-ACTIVE*))
         lay)
       (progn
         (princ "\n[ACAD] Khong ghi duoc preview ownership; da huy begin.")
         nil)))))

(defun dl:preview-count (opid / ss i n total en)
  "Lần gọi đầu sau khi vẽ sẽ seal đúng handle hiện có; lần sau chỉ đếm ownership."
  (setq ss (ssget "_X" (list (cons 8 (dl:preview-layer opid))))
        i 0 n 0 total (if ss (sslength ss) 0))
  (cond
    ((dl:preview-active-p opid)
     (if ss
       (while (< i total)
         (setq en (ssname ss i))
         (if (dl:preview-tag en opid) (setq n (1+ n)))
         (setq i (1+ i))))
     (if (= n total)
       (dl:preview-set-state opid 5)
       (dl:preview-conflict opid))
     n)
    ((dl:preview-sealed-p opid)
     (if ss
       (while (< i total)
         (if (dl:preview-owned-p (ssname ss i) opid) (setq n (1+ n)))
         (setq i (1+ i))))
     n)
    (T 0)))

(defun dl:preview-apply (opid destlayer / ss i n total en el)
  "User CHẤP NHẬN: chuyển toàn bộ entity preview sang layer đích thật.
   destlayer = tên layer đích. Trả về số entity đã chuyển.
   Chỉ exact handles đã seal bằng dl:preview-count mới được apply.

   DÙNG entmod, KHÔNG dùng (command \"_.CHPROP\" …): lệnh có dấu nhắc chạy
   trong session AutoCAD ĐANG MỞ (job nạp từ callback của plugin) sẽ hỏng
   giữa chừng — trả 'Function cancelled' và ĐỂ AUTOCAD KẸT ở dấu nhắc, làm
   mọi job sau đó treo. entmod là thao tác CSDL thuần, an toàn ở mọi ngữ cảnh."
  (if (not (dl:preview-sealed-p opid))
    (progn
      (princ "\n[ACAD] Preview chua seal hoac da conflict; khong apply.")
      0)
    (progn
      (if (not (tblsearch "LAYER" destlayer)) (dl:layer destlayer 7 nil))
      (setq ss (ssget "_X" (list (cons 8 (dl:preview-layer opid))))
            n 0 i 0 total 0)
      (if ss
        (while (< i (sslength ss))
          (setq en (ssname ss i) el (entget en))
          (if (dl:preview-owned-p en opid)
            (progn
              (setq total (1+ total))
              (if (entmod (subst (cons 8 destlayer) (assoc 8 el) el))
                (setq n (1+ n)))))
          (setq i (1+ i))))
      (if (= n total)
        (progn (dl:preview-set-state opid 3) (dl:preview-close opid)))
      n)))

(defun dl:preview-apply-map (opid pairs)
  "Compatibility wrapper: chỉ dùng destination của pair đầu, bỏ qua marker
   và các pair còn lại. Trả 0 nếu pairs rỗng."
  (if pairs (dl:preview-apply opid (cdar pairs)) 0))

(defun dl:preview-reject (opid / ss n i total)
  "User KHÔNG CHẤP NHẬN: xoá exact handles đã seal của preview này.
   Không rollback thay đổi ngoài layer preview.
   Dùng entdel thay (command \"_.ERASE\" …) — xem ghi chú ở dl:preview-apply."
  (if (not (dl:preview-sealed-p opid))
    (progn
      (princ "\n[ACAD] Preview chua seal hoac da conflict; khong reject.")
      0)
    (progn
      (setq ss (ssget "_X" (list (cons 8 (dl:preview-layer opid))))
            n 0 i 0 total 0)
      (if ss
        (while (< i (sslength ss))
          (if (dl:preview-owned-p (ssname ss i) opid)
            (progn
              (setq total (1+ total))
              (if (entdel (ssname ss i)) (setq n (1+ n)))))
          (setq i (1+ i))))
      (if (= n total)
        (progn (dl:preview-set-state opid 4) (dl:preview-close opid)))
      n)))

;;; --------------------------------------------------------------- KIỂM ĐẾM

(defun dl:count (ty / ss)
  (setq ss (ssget "_X" (list (cons 0 ty))))
  (if ss (sslength ss) 0))

(defun dl:count-layer (lay / ss)
  (setq ss (ssget "_X" (list (cons 8 lay))))
  (if ss (sslength ss) 0))

(defun dl:report (path / f)
  "Ghi báo cáo kiểm đếm ra file để daemon/agent đọc lại."
  (setq f (open path "w"))
  (foreach ty '("MLINE" "LWPOLYLINE" "LINE" "CIRCLE" "ARC" "TEXT" "MTEXT"
                "INSERT" "DIMENSION" "MULTILEADER" "LEADER" "HATCH" "VIEWPORT")
    (write-line (strcat ty "=" (itoa (dl:count ty))) f))
  (foreach lay '("P-ThoatXi" "P-ThoatRua" "P-ThongHoi" "A.DIM" "Leader"
                 "CT-Leader" "DCCD-text" "DCCD-nuoclanh" "RSA -HACK" "0-9")
    (write-line (strcat "LAYER:" lay "=" (itoa (dl:count-layer lay))) f))
  (write-line (strcat "TOTAL=" (itoa (if (setq s (ssget "_X")) (sslength s) 0))) f)
  (close f)
  path)

(defun dl:save (path)
  (command "_.SAVEAS" "2018" path)
  path)

(defun dl:result (path kvs / f)
  "Ghi kết quả 1 bước (key=value mỗi dòng) để daemon/agent đọc.
   kvs = list ((\"key\" . \"value\") ...). Luôn kết thúc bằng ==end==."
  (setq f (open path "w"))
  (foreach kv kvs (write-line (strcat (car kv) "=" (cdr kv)) f))
  (write-line "==end==" f)
  (close f)
  path)

(princ "\n[ACAD] draw_lib.lsp ready — dl:pipe dl:fitting dl:dim-aligned dl:mleader dl:hatch dl:titleblock dl:layout dl:preview-*")
(princ)

;;; ============================================================================
;;;  mep_lib.lsp — thư viện AutoLISP HEADLESS cho MEP Studio (AcCoreConsole/Mac)
;;;  Chỉ dùng hàm CORE (đã probe trên AutoCAD 2027 Mac): ent*/ss*/tbl*/file I/O.
;;;  KHÔNG dùng: vla-*/vlax-*/getpropertyvalue/dumpallproperties (không có trên Mac).
;;;  Đo chiều dài tính tay từ DXF group codes (có xử lý cung bulge).
;;;  Giá trị text tiếng Việt ghi RAW (\U+xxxx) — daemon Node sẽ decode.
;;; ============================================================================

;; ---- Hình học: chiều dài entity ------------------------------------------
(defun mep:seglen (p1 p2 bul / chord theta r)
  (setq chord (distance p1 p2))
  (if (or (null bul) (equal bul 0.0 1e-9)) chord
    (progn
      (setq theta (* 4.0 (atan bul)))
      (if (equal theta 0.0 1e-9) chord
        (progn (setq r (/ chord (* 2.0 (sin (/ theta 2.0)))))
               (abs (* r theta)))))))

(defun mep:lwlen (el / pts bulges closed tot i n)
  (setq pts '() bulges '())
  (foreach x el
    (cond ((= (car x) 10)
           (setq pts (cons (list (cadr x) (caddr x)) pts) bulges (cons 0.0 bulges)))
          ((= (car x) 42)
           (setq bulges (cons (cdr x) (cdr bulges))))))
  (setq pts (reverse pts) bulges (reverse bulges)
        closed (= 1 (logand 1 (cdr (assoc 70 el)))) tot 0.0 n (length pts) i 0)
  (while (< i (1- n))
    (setq tot (+ tot (mep:seglen (nth i pts) (nth (1+ i) pts) (nth i bulges))) i (1+ i)))
  (if (and closed (> n 1))
    (setq tot (+ tot (mep:seglen (nth (1- n) pts) (nth 0 pts) (nth (1- n) bulges)))))
  tot)

(defun mep:mlen (el / pts tot i n)
  (setq pts '())
  (foreach x el (if (= (car x) 11) (setq pts (cons (list (cadr x) (caddr x)) pts))))
  (setq pts (reverse pts) tot 0.0 n (length pts) i 0)
  (while (< i (1- n)) (setq tot (+ tot (distance (nth i pts) (nth (1+ i) pts))) i (1+ i)))
  tot)

(defun mep:entlen (en / el ty)
  (setq el (entget en) ty (cdr (assoc 0 el)))
  (cond
    ((= ty "LINE") (distance (cdr (assoc 10 el)) (cdr (assoc 11 el))))
    ((= ty "LWPOLYLINE") (mep:lwlen el))
    ((= ty "MLINE") (mep:mlen el))
    ((= ty "ARC") (* (cdr (assoc 40 el)) (abs (- (cdr (assoc 51 el)) (cdr (assoc 50 el))))))
    ((= ty "CIRCLE") (* 2.0 pi (cdr (assoc 40 el))))
    (T 0.0)))

;; ---- Tiện ích file/CSV ----------------------------------------------------
(defun mep:esc (s) ; escape cho CSV: bọc "..." nếu có , " hoặc xuống dòng
  (if (or (vl-string-search "," s) (vl-string-search "\"" s) (vl-string-search "\n" s))
    (strcat "\"" (mep:replace s "\"" "\"\"") "\"") s))
(defun mep:replace (s old new / i r) ; thay chuỗi con
  (setq r "")
  (while (setq i (vl-string-search old s))
    (setq r (strcat r (substr s 1 i) new) s (substr s (+ i 1 (strlen old)))))
  (strcat r s))
(defun mep:rt (v) (if (= (type v) 'REAL) (rtos v 2 3) (vl-princ-to-string v)))

;; ---- Đọc layer -> CSV -----------------------------------------------------
(defun mep:layers (csv / f e n)
  (setq f (open csv "w") n 0)
  (write-line "layer,color,on,frozen,locked,linetype" f)
  (setq e (tblnext "LAYER" T))
  (while e
    (write-line (strcat (mep:esc (cdr (assoc 2 e))) ","
      (itoa (abs (cdr (assoc 62 e)))) ","
      (if (minusp (cdr (assoc 62 e))) "0" "1") ","
      (if (= 1 (logand 1 (cdr (assoc 70 e)))) "1" "0") ","
      (if (= 4 (logand 4 (cdr (assoc 70 e)))) "1" "0") ","
      (mep:esc (cdr (assoc 6 e)))) f)
    (setq n (1+ n) e (tblnext "LAYER")))
  (close f) n)

;; ---- BOM ống: tổng chiều dài theo layer -> CSV ---------------------------
(defun mep:pipe-bom (csv / ss i en el lay len tbl cell f tot)
  (setq ss (ssget "X" '((0 . "LINE,LWPOLYLINE,MLINE,ARC"))) tbl '() tot 0.0)
  (if ss
    (progn (setq i 0)
      (repeat (sslength ss)
        (setq en (ssname ss i) el (entget en)
              lay (cdr (assoc 8 el)) len (mep:entlen en))
        (setq cell (assoc lay tbl))
        (if cell (setq tbl (subst (cons lay (+ (cdr cell) len)) cell tbl))
          (setq tbl (cons (cons lay len) tbl)))
        (setq tot (+ tot len) i (1+ i)))))
  (setq f (open csv "w"))
  (write-line "layer,length_mm,length_m" f)
  (foreach c tbl
    (write-line (strcat (mep:esc (car c)) "," (rtos (cdr c) 2 1) "," (rtos (/ (cdr c) 1000.0) 2 3)) f))
  (write-line (strcat "TOTAL,," (rtos (/ tot 1000.0) 2 3)) f)
  (close f) tot)

;; ---- BOM phụ kiện: đếm INSERT theo tên block -> CSV -----------------------
(defun mep:fit-bom (csv / ss i en el nm tbl cell f)
  (setq ss (ssget "X" '((0 . "INSERT"))) tbl '())
  (if ss (progn (setq i 0)
    (repeat (sslength ss)
      (setq en (ssname ss i) nm (cdr (assoc 2 (entget en))))
      (setq cell (assoc nm tbl))
      (if cell (setq tbl (subst (cons nm (1+ (cdr cell))) cell tbl))
        (setq tbl (cons (cons nm 1) tbl)))
      (setq i (1+ i)))))
  (setq f (open csv "w"))
  (write-line "block,count" f)
  (foreach c tbl (write-line (strcat (mep:esc (car c)) "," (itoa (cdr c))) f))
  (close f) (length tbl))

;; ---- Đọc khung tên: mọi ATTRIB của INSERT có attribute -> key=value -------
(defun mep:read-title (txt / ss i en sub el f wrote)
  (setq ss (ssget "X" '((0 . "INSERT") (66 . 1))) f (open txt "w") wrote nil)
  (if ss (progn (setq i 0)
    (repeat (sslength ss)
      (setq en (ssname ss i) sub (entnext en))
      (while (and sub (= "ATTRIB" (cdr (assoc 0 (setq el (entget sub))))))
        (write-line (strcat (cdr (assoc 2 el)) "\t" (cdr (assoc 1 el))) f)
        (setq wrote T sub (entnext sub)))
      (setq i (1+ i)))))
  (close f) wrote)

;; ---- Sửa ATTRIB khung tên theo cặp tag/value (kv = list (TAG . VAL)) ------
(defun mep:set-title (kv / ss i en sub el tag nv n)
  (setq ss (ssget "X" '((0 . "INSERT") (66 . 1))) n 0)
  (if ss (progn (setq i 0)
    (repeat (sslength ss)
      (setq en (ssname ss i) sub (entnext en))
      (while (and sub (= "ATTRIB" (cdr (assoc 0 (setq el (entget sub))))))
        (setq tag (strcase (cdr (assoc 2 el))))
        (if (setq nv (cdr (assoc tag kv)))
          (progn (entmod (subst (cons 1 nv) (assoc 1 el) el)) (entupd sub) (setq n (1+ n))))
        (setq sub (entnext sub)))
      (setq i (1+ i)))))
  n)

;; ---- BOM ống theo HỆ (layer) × DN (scale MLINE) -> CSV --------------------
(defun mep:pipe-layer? (lay)
  (wcmatch (strcase lay) "P-*,DCCD*,N-T*,PR-*,CN-*,TN-*,TH-*,*PIPE*,*DUCT*"))
(defun mep:pipe-bom-dn (csv / ss i en el ty lay dn len key tbl cell f tot)
  (setq ss (ssget "X" '((0 . "LINE,LWPOLYLINE,MLINE,ARC"))) tbl '() tot 0.0)
  (if ss (progn (setq i 0)
    (repeat (sslength ss)
      (setq en (ssname ss i) el (entget en) ty (cdr (assoc 0 el)) lay (cdr (assoc 8 el)))
      (if (mep:pipe-layer? lay)
        (progn
          (setq len (mep:entlen en)
                dn (if (and (= ty "MLINE") (assoc 40 el)) (itoa (fix (+ 0.5 (abs (cdr (assoc 40 el)))))) "?")
                key (strcat lay "\t" dn) cell (assoc key tbl))
          (if cell (setq tbl (subst (cons key (+ (cdr cell) len)) cell tbl))
            (setq tbl (cons (cons key len) tbl)))
          (setq tot (+ tot len))))
      (setq i (1+ i)))))
  (setq f (open csv "w"))
  (write-line "he_thong,DN,length_m" f)
  (foreach c tbl
    (write-line (strcat (mep:esc (car (mep:split-tab (car c)))) ","
                        (cadr (mep:split-tab (car c))) ","
                        (rtos (/ (cdr c) 1000.0) 2 2)) f))
  (write-line (strcat "TONG,," (rtos (/ tot 1000.0) 2 2)) f)
  (close f) tot)
(defun mep:split-tab (s / i) ; tách "a\tb" -> ("a" "b")
  (if (setq i (vl-string-search "\t" s)) (list (substr s 1 i) (substr s (+ i 2))) (list s "")))

;; ---- Mục lục: gom ATTRIB theo TỪNG khung tên (1 dòng/sheet) -> CSV --------
(defun mep:title-rows (csv / ss i en sub el tags f khbv ten ngay ve)
  (setq ss (ssget "X" '((0 . "INSERT") (66 . 1))) f (open csv "w"))
  (write-line "khbv,ten_ban_ve,ngay,nguoi_ve" f)
  (if ss (progn (setq i 0)
    (repeat (sslength ss)
      (setq en (ssname ss i) sub (entnext en) khbv "" ten "" ngay "" ve "")
      (while (and sub (= "ATTRIB" (cdr (assoc 0 (setq el (entget sub))))))
        (setq tg (strcase (cdr (assoc 2 el))) vl (cdr (assoc 1 el)))
        (cond ((= tg "KHBV") (setq khbv vl))
              ((wcmatch tg "TENBANVE1*") (if (= ten "") (setq ten vl)))
              ((= tg "DD/MM/YYYY") (setq ngay vl))
              ((wcmatch tg "VE1*") (if (= ve "") (setq ve vl))))
        (setq sub (entnext sub)))
      (if (or (/= khbv "") (/= ten "")) ; chỉ khung tên thật (có KHBV/tên)
        (write-line (strcat (mep:esc khbv) "," (mep:esc ten) "," (mep:esc ngay) "," (mep:esc ve)) f))
      (setq i (1+ i)))))
  (close f) T)

;; ---- VẼ/HỖ TRỢ ------------------------------------------------------------
;; Bảng màu chuẩn (rút từ bản vẽ thật): xí=190, rửa=50, hơi=5, cấp=90, thiết bị=2, ghi chú=2
(setq *MEP-STD-LAYERS*
  '(("P-ThoatXi" . 190) ("P-ThoatRua" . 50) ("P-ThongHoi" . 5)
    ("DCCD-nuoclanh" . 90) ("P-ThietBi" . 2) ("MEP-GHICHU" . 2)))

(defun mep:mklayer (name col)
  (if (not (tblsearch "LAYER" name))
    (command "_.-LAYER" "_Make" name "_Color" (itoa col) name "")))

(defun mep:std-layers ( / )
  (foreach e *MEP-STD-LAYERS* (mep:mklayer (car e) (cdr e)))
  (length *MEP-STD-LAYERS*))

(defun mep:sysname (lay / u)
  (setq u (strcase lay))
  (cond ((wcmatch u "*THOATXI*") "SX") ((wcmatch u "*THOATRUA*") "TR")
        ((wcmatch u "*THONGHOI*") "TH") ((wcmatch u "DCCD*,*NUOC*") "CN")
        ((wcmatch u "*THIETBI*") "TB") (T "MEP")))

(defun mep:mid (el / pts n sx sy) ; trung điểm (centroid đỉnh) của MLINE
  (setq pts '() sx 0.0 sy 0.0)
  (foreach x el (if (= (car x) 11) (setq pts (cons (cdr x) pts))))
  (if (null pts) (foreach x el (if (= (car x) 10) (setq pts (cons (cdr x) pts)))))
  (setq n (length pts))
  (if (> n 0)
    (progn (foreach p pts (setq sx (+ sx (car p)) sy (+ sy (cadr p))))
           (list (/ sx n) (/ sy n) 0.0)) '(0.0 0.0 0.0)))

(defun mep:dn-of (el) ; DN từ scale MLINE
  (if (assoc 40 el) (fix (+ 0.5 (abs (cdr (assoc 40 el))))) 0))

;; Gắn nhãn "HỆ DNxx" tại trung điểm mỗi ống -> số ống đã tag
(defun mep:tag-pipes ( / ss i en el lay dn pt txt n h)
  (mep:mklayer "MEP-GHICHU" 2)
  (setq ss (ssget "X" '((0 . "MLINE"))) n 0 h 200.0)
  (if ss (progn (setq i 0)
    (repeat (sslength ss)
      (setq en (ssname ss i) el (entget en) lay (cdr (assoc 8 el)))
      (if (mep:pipe-layer? lay)
        (progn
          (setq dn (mep:dn-of el) pt (mep:mid el)
                txt (strcat (mep:sysname lay) " DN" (itoa dn)))
          (entmake (list '(0 . "TEXT") (cons 8 "MEP-GHICHU") (cons 10 pt) (cons 11 pt)
                         (cons 40 h) (cons 1 txt) (cons 72 1) (cons 73 2)))
          (setq n (1+ n))))
      (setq i (1+ i)))))
  n)

;; Đánh số tuần tự theo hệ (SX-01, TR-02...) + lưu XDATA "MEP" + ghi TEXT
(defun mep:number-pipes ( / ss i en el lay sys cnt cell num pt tbl n)
  (regapp "MEP") (mep:mklayer "MEP-GHICHU" 2)
  (setq ss (ssget "X" '((0 . "MLINE"))) tbl '() n 0)
  (if ss (progn (setq i 0)
    (repeat (sslength ss)
      (setq en (ssname ss i) el (entget en) lay (cdr (assoc 8 el)))
      (if (mep:pipe-layer? lay)
        (progn
          (setq sys (mep:sysname lay) cell (assoc sys tbl))
          (if cell (progn (setq cnt (1+ (cdr cell))) (setq tbl (subst (cons sys cnt) cell tbl)))
            (progn (setq cnt 1) (setq tbl (cons (cons sys cnt) tbl))))
          (setq num (strcat sys "-" (if (< cnt 10) (strcat "0" (itoa cnt)) (itoa cnt))))
          (entmod (append el (list (list -3 (list "MEP" (cons 1000 num))))))
          (entupd en)
          (setq pt (mep:mid el))
          (entmake (list '(0 . "TEXT") (cons 8 "MEP-GHICHU") (cons 10 pt) (cons 11 pt)
                         (cons 40 180.0) (cons 1 num) (cons 72 1) (cons 73 2)))
          (setq n (1+ n))))
      (setq i (1+ i)))))
  n)

;; Vẽ 1 ống = MLINE trên layer, scale=DN, qua danh sách điểm
(defun mep:draw-pipe (lay dn pts)
  (mep:mklayer lay 7)
  (command "_.-LAYER" "_Set" lay "")
  (setvar "OSMODE" 0)
  (command "_.MLINE" "_J" "_Z" "_S" dn)
  (foreach p pts (command p))
  (command "")
  T)

;; ---- Snapshot geometry (có HANDLE) -> JSON để render SVG + diff -----------
(defun mep:jesc (s / r) (setq r (mep:replace s "\\" "\\\\")) (mep:replace r "\"" "\\\""))
(defun mep:n (x) (rtos x 2 1))
(defun mep:pts-line (el / p1 p2)
  (setq p1 (cdr (assoc 10 el)) p2 (cdr (assoc 11 el)))
  (strcat "[" (mep:n (car p1)) "," (mep:n (cadr p1)) "],[" (mep:n (car p2)) "," (mep:n (cadr p2)) "]"))
(defun mep:pts-code (el code / s first)
  (setq s "" first T)
  (foreach x el (if (= (car x) code)
    (progn (if (not first) (setq s (strcat s ","))) (setq first nil)
      (setq s (strcat s "[" (mep:n (cadr x)) "," (mep:n (caddr x)) "]")))))
  s)
(defun mep:dump-geom (json / f ss i el ty lay h pts p extra first)
  (setq f (open json "w")) (write-line "[" f) (setq first T)
  (setq ss (ssget "_X" '((0 . "LINE,LWPOLYLINE,MLINE,CIRCLE,ARC,TEXT,MTEXT,INSERT"))) i 0)
  (if ss (repeat (sslength ss)
    (setq el (entget (ssname ss i)) ty (cdr (assoc 0 el)) lay (cdr (assoc 8 el))
          h (cdr (assoc 5 el)) pts "" extra "")
    (cond
      ((= ty "LINE") (setq pts (mep:pts-line el)))
      ((= ty "LWPOLYLINE") (setq pts (mep:pts-code el 10)))
      ((= ty "MLINE") (setq pts (mep:pts-code el 11) extra (strcat ",\"dn\":" (itoa (mep:dn-of el)))))
      ((= ty "CIRCLE") (setq p (cdr (assoc 10 el))
         extra (strcat ",\"c\":[" (mep:n (car p)) "," (mep:n (cadr p)) "],\"r\":" (mep:n (cdr (assoc 40 el))))))
      ((or (= ty "TEXT") (= ty "MTEXT")) (setq p (cdr (assoc 10 el))
         extra (strcat ",\"xy\":[" (mep:n (car p)) "," (mep:n (cadr p)) "],\"tx\":\"" (mep:jesc (cdr (assoc 1 el))) "\"")))
      ((= ty "INSERT") (setq p (cdr (assoc 10 el))
         extra (strcat ",\"xy\":[" (mep:n (car p)) "," (mep:n (cadr p)) "],\"blk\":\"" (mep:jesc (cdr (assoc 2 el))) "\""))))
    (if (or (/= pts "") (/= extra ""))
      (progn (if (not first) (write-line "," f)) (setq first nil)
        (write-line (strcat "{\"h\":\"" h "\",\"t\":\"" ty "\",\"l\":\"" (mep:jesc lay) "\""
          (if (/= pts "") (strcat ",\"p\":[" pts "]") "") extra "}") f)))
    (setq i (1+ i))))
  (write-line "]" f) (close f) T)

;; ---- Thống kê entity theo dxftype -> CSV ----------------------------------
(defun mep:stats (csv / e ty tbl cell f nent)
  (setq tbl '() nent 0 e (entnext))
  (while e
    (setq ty (cdr (assoc 0 (entget e))) cell (assoc ty tbl))
    (if cell (setq tbl (subst (cons ty (1+ (cdr cell))) cell tbl))
      (setq tbl (cons (cons ty 1) tbl)))
    (setq nent (1+ nent) e (entnext e)))
  (setq f (open csv "w"))
  (write-line "dxftype,count" f)
  (foreach c tbl (write-line (strcat (car c) "," (itoa (cdr c))) f))
  (write-line (strcat "TOTAL," (itoa nent)) f)
  (close f) nent)

(princ "\n[mep_lib] loaded")
(princ)

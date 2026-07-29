;;; ============================================================================
;;;  MEP CAD Companion — Bộ lệnh hỗ trợ vẽ trong AutoCAD (Mac & Windows)
;;;  Dùng AutoLISP + keyword bấm-được (initget/getkword) — KHÔNG dùng DCL
;;;  (DCL không chạy trên AutoCAD for Mac). Keyword hiện trên dòng lệnh và
;;;  bấm chuột chọn được, hoạt động cả Mac lẫn Windows.
;;;
;;;  Vẽ đúng chuẩn đã phân tích từ bản vẽ thật → ăn khớp web BOM:
;;;    Ống = MLINE, scale = DN, layer hệ thống P-*/DCCD-*
;;;    Phụ kiện = text "Loại, Vật liệu, DNxx" (BOM đọc lại được)
;;;  Nạp:  APPLOAD -> chọn mep.lsp   |   Trợ giúp:  gõ  MEP
;;; ============================================================================

;; ---- Layer chuẩn (tên . màu) theo convention thật ----
(setq *MEP-LAYERS*
  (list (cons "P-ThoatXi" 1) (cons "P-ThoatRua" 5) (cons "P-ThongHoi" 3)
        (cons "DCCD-nuoclanh" 4) (cons "P-ThietBi" 6) (cons "MEP-GHICHU" 2)))

;; ---- Hệ thống ống: (keyword  tên-hiển-thị  layer) ----
(setq *MEP-HETHONG*
  (list (list "Xi"  "Thoat xi"   "P-ThoatXi")
        (list "Rua" "Thoat rua"  "P-ThoatRua")
        (list "Hoi" "Thong hoi"  "P-ThongHoi")
        (list "Cap" "Cap nuoc"   "DCCD-nuoclanh")))

;; ---- Loại phụ kiện: (keyword  tên-tiếng-Việt) ----
(setq *MEP-PHUKIEN*
  (list (list "Cut" "Cút") (list "Chech" "Chếch") (list "Te" "Tê thu")
        (list "Tedeu" "Tê đều") (list "Y" "Y thu") (list "Ydeu" "Y đều")
        (list "Con" "Côn") (list "Sip" "Siphong")))

;; ---------------------------------------------------------------------------
;;  Tiện ích
;; ---------------------------------------------------------------------------
(defun mep:mklayer (name col)
  (if (not (tblsearch "LAYER" name))
    (command "_.-LAYER" "_Make" name "_Color" (itoa col) name ""))
  (command "_.-LAYER" "_Set" name ""))

(defun mep:find (kw lst / r) (foreach e lst (if (= (car e) kw) (setq r e))) r)

;; Hỏi 1 keyword (bấm-được). lst = ((kw hiển-thị ...) ...). Trả phần tử khớp.
(defun mep:choose (msg lst default / kws p res)
  (setq kws "" p (strcat "\n" msg " ["))
  (foreach e lst
    (setq kws (strcat kws (car e) " ")
          p   (strcat p (car e) "/")))
  (setq p (strcat (substr p 1 (1- (strlen p))) "]"))
  (if default (setq p (strcat p " <" default ">")))
  (setq p (strcat p ": "))
  (initget kws)
  (setq res (getkword p))
  (if (and (null res) default) (setq res default))
  (mep:find res lst))

;; ---------------------------------------------------------------------------
;;  MEP-INIT : tạo bộ layer chuẩn
;; ---------------------------------------------------------------------------
(defun c:MEP-INIT ( / e)
  (foreach e *MEP-LAYERS* (mep:mklayer (car e) (cdr e)))
  (princ (strcat "\n[MEP] Da tao/kiem tra " (itoa (length *MEP-LAYERS*)) " layer chuan."))
  (princ))

;; ---------------------------------------------------------------------------
;;  Vẽ ống = MLINE, layer theo hệ thống, scale = DN
;; ---------------------------------------------------------------------------
(defun mep:drawpipe (lay dn)
  (mep:mklayer lay (cdr (assoc lay *MEP-LAYERS*)))
  (princ (strcat "\n[MEP] Ve ong tren " lay " DN" (itoa dn)
                 " — click cac diem, Enter de ket thuc."))
  (command "_.MLINE" "_Justification" "_Zero" "_Scale" dn)
  (while (> (getvar "CMDACTIVE") 0) (command pause))
  (princ))

;; Public — nút Tool Palette gọi thẳng, vd:  (mep-pipe "Rua" 90)
(defun mep-pipe (syskw dn / he)
  (setq he (mep:find syskw *MEP-HETHONG*))
  (if (and he dn (> dn 0)) (mep:drawpipe (caddr he) dn)
    (princ "\n[MEP] Tham so ong khong hop le."))
  (princ))

;; Lệnh đầy đủ: chọn hệ thống + DN
(defun c:MEP-ONG ( / he dn)
  (princ "\n[MEP] He thong:  Xi=Thoat xi  Rua=Thoat rua  Hoi=Thong hoi  Cap=Cap nuoc")
  (setq he (mep:choose "Chon he thong" *MEP-HETHONG* "Rua"))
  (cond
    ((null he) (princ "\n[MEP] Da huy."))
    (T (initget 6)
       (setq dn (getint "\nDuong kinh DN (vd 90, 110): "))
       (if dn (mep:drawpipe (caddr he) dn) (princ "\n[MEP] Da huy (chua nhap DN)."))))
  (princ))

;; ---------------------------------------------------------------------------
;;  Chú thích phụ kiện theo format BOM "Loại, Vật liệu, DNxx"
;; ---------------------------------------------------------------------------
(defun mep:writefit (name vl dn / p txt h)
  (setq p (getpoint "\nDiem dat chu thich: "))
  (cond
    ((null p) (princ "\n[MEP] Da huy."))
    (T
     (setq txt (strcat name ", " vl ", DN" (itoa dn)))
     (mep:mklayer "MEP-GHICHU" 2)
     (setq h (if (> (getvar "TEXTSIZE") 0) (getvar "TEXTSIZE") 250.0))
     (entmake (list '(0 . "TEXT") (cons 8 "MEP-GHICHU") (cons 10 p) (cons 11 p)
                    (cons 40 h) (cons 1 txt) (cons 72 0) (cons 73 0)))
     (princ (strcat "\n[MEP] Da ghi: " txt))))
  (princ))

;; Public — nút Tool Palette gọi thẳng, vd:  (mep-fit "Chech" "Upvc" 90)
(defun mep-fit (pkkw vl dn / pk)
  (setq pk (mep:find pkkw *MEP-PHUKIEN*))
  (if (and pk dn (> dn 0))
    (mep:writefit (cadr pk) (if (= vl "Ppr") "PPR" "uPVC") dn)
    (princ "\n[MEP] Tham so phu kien khong hop le."))
  (princ))

;; Lệnh đầy đủ: chọn loại + vật liệu + DN
(defun c:MEP-PK ( / pk vl dn)
  (setq pk (mep:choose "Loai phu kien" *MEP-PHUKIEN* "Chech"))
  (cond
    ((null pk) (princ "\n[MEP] Da huy."))
    (T
     (initget "Upvc Ppr")
     (setq vl (getkword "\nVat lieu [Upvc/Ppr] <Upvc>: "))
     (setq vl (if (= vl "Ppr") "PPR" "uPVC"))
     (initget 6)
     (setq dn (getint "\nDuong kinh DN: "))
     (if dn (mep:writefit (cadr pk) vl dn) (princ "\n[MEP] Da huy (chua nhap DN)."))))
  (princ))

;; ---------------------------------------------------------------------------
;;  MEP-KHBV : sinh ký hiệu bản vẽ ME-{CN|TN|TH}-T{tầng}
;; ---------------------------------------------------------------------------
(defun c:MEP-KHBV ( / he tg kh)
  (initget "Cap Thoat Hoi")
  (setq he (getkword "\nHe thong [Cap/Thoat/Hoi]: "))
  (initget 6)
  (setq tg (getint "\nTang: "))
  (cond
    ((or (null he) (null tg)) (princ "\n[MEP] Da huy."))
    (T
     (setq kh (strcat "ME-"
                      (cond ((= he "Cap") "CN") ((= he "Thoat") "TN") ((= he "Hoi") "TH"))
                      "-T" (if (< tg 10) (strcat "0" (itoa tg)) (itoa tg))))
     (princ (strcat "\n[MEP] Ky hieu de xuat: " kh))))
  (princ))

;; ---------------------------------------------------------------------------
;;  MEP-HELP : trợ giúp (danh sách lệnh)
;; ---------------------------------------------------------------------------
(defun c:MEP-HELP ( )
  (princ "\n=========== MEP CAD Companion — lenh ho tro ve ===========")
  (princ "\n  MEP        Mo BANG DIEU KHIEN (hop thoai nut bam)")
  (princ "\n  MEP-INIT   Tao bo layer chuan")
  (princ "\n  MEP-ONG    Ve ong (MLINE, scale=DN, dung layer he thong)")
  (princ "\n  MEP-PK     Chu thich phu kien 'Loai, Vat lieu, DNxx'")
  (princ "\n  MEP-KHBV   Sinh ky hieu ban ve ME-{CN|TN|TH}-T{tang}")
  (princ "\n  -> Ve dung chuan -> Web MEP CAD Companion boc BOM tu dong.")
  (princ "\n==========================================================")
  (princ))

;; ---------------------------------------------------------------------------
;;  Giao diện DCL — bảng nút bấm thật (chạy AutoCAD for Mac 2021+ & Windows)
;;  Tự ghi file .dcl ra thư mục tạm để chỉ cần nạp 1 file mep.lsp.
;; ---------------------------------------------------------------------------
(defun mep:dclpath ( / d)
  (setq d (cond ((getenv "TMPDIR")) ((getenv "TMP")) ((getenv "TEMP")) (".")))
  (if (and (> (strlen d) 0)
           (/= (substr d (strlen d)) "/") (/= (substr d (strlen d)) "\\"))
    (setq d (strcat d "/")))
  (strcat d "mep_panel.dcl"))

(defun mep:writedcl ( / p f)
  (setq p (mep:dclpath) f (open p "w"))
  (foreach ln
    (list
      "mep_main : dialog {"
      "  label = \"MEP CAD Companion\";"
      "  : boxed_radio_column {"
      "    key = \"sys\";"
      "    label = \"He thong ong\";"
      "    : radio_button { key = \"Xi\";  label = \"Thoat xi  (P-ThoatXi)\"; }"
      "    : radio_button { key = \"Rua\"; label = \"Thoat rua (P-ThoatRua)\"; }"
      "    : radio_button { key = \"Hoi\"; label = \"Thong hoi (P-ThongHoi)\"; }"
      "    : radio_button { key = \"Cap\"; label = \"Cap nuoc  (DCCD-nuoclanh)\"; }"
      "  }"
      "  : edit_box { key = \"dn\"; label = \"Duong kinh DN:\"; edit_width = 6; }"
      "  : row {"
      "    : button { key = \"pipe\"; label = \"Ve ong\"; width = 16; fixed_width = true; }"
      "    : button { key = \"init\"; label = \"Tao layer chuan\"; width = 18; fixed_width = true; }"
      "  }"
      "  : spacer { height = 0.4; }"
      "  : boxed_column {"
      "    label = \"Phu kien (chu thich BOM)\";"
      "    : popup_list { key = \"ft\"; label = \"Loai phu kien:\"; }"
      "    : popup_list { key = \"mt\"; label = \"Vat lieu:\"; }"
      "    : button { key = \"fit\"; label = \"Chu thich phu kien\"; }"
      "  }"
      "  : spacer { height = 0.4; }"
      "  : button { key = \"khbv\"; label = \"Sinh ky hieu ban ve...\"; }"
      "  : spacer { height = 0.4; }"
      "  : button { key = \"close\"; label = \"Dong\"; is_cancel = true; }"
      "}"
    )
    (write-line ln f))
  (close f)
  p)

;; MEP : mở bảng điều khiển có nút bấm
(defun c:MEP ( / dclpath id mats act sys dn ftidx mtidx keepon)
  (setq dclpath (mep:writedcl)
        mats    (list (list "Upvc" "uPVC") (list "Ppr" "PPR"))
        keepon  T)
  (while keepon
    (setq id (load_dialog dclpath))
    (cond
      ((< id 0) (princ "\n[MEP] Khong nap duoc giao dien DCL.") (setq keepon nil))
      ((not (new_dialog "mep_main" id))
       (princ "\n[MEP] Khong mo duoc hop thoai.") (unload_dialog id) (setq keepon nil))
      (T
       (start_list "ft") (foreach e *MEP-PHUKIEN* (add_list (cadr e))) (end_list)
       (start_list "mt") (foreach e mats (add_list (cadr e))) (end_list)
       (set_tile "sys" "Rua") (set_tile "dn" "90")
       (set_tile "ft" "1") (set_tile "mt" "0")
       (setq act nil
             *mep_sys* "Rua" *mep_dn* "90" *mep_ft* "1" *mep_mt* "0")
       (action_tile "sys"   "(setq *mep_sys* $value)")
       (action_tile "dn"    "(setq *mep_dn* $value)")
       (action_tile "ft"    "(setq *mep_ft* $value)")
       (action_tile "mt"    "(setq *mep_mt* $value)")
       (action_tile "pipe"  "(setq act \"pipe\")(done_dialog 1)")
       (action_tile "init"  "(setq act \"init\")(done_dialog 1)")
       (action_tile "fit"   "(setq act \"fit\")(done_dialog 1)")
       (action_tile "khbv"  "(setq act \"khbv\")(done_dialog 1)")
       (action_tile "close" "(setq act \"close\")(done_dialog 0)")
       (start_dialog)
       (unload_dialog id)
       (cond
         ((= act "init") (c:MEP-INIT))
         ((= act "pipe")
          (setq sys *mep_sys* dn (atoi *mep_dn*))
          (if (and sys (> dn 0)) (mep-pipe sys dn)
            (princ "\n[MEP] Chua chon he thong hoac DN.")))
         ((= act "fit")
          (setq ftidx (atoi *mep_ft*) mtidx (atoi *mep_mt*) dn (atoi *mep_dn*))
          (if (> dn 0)
            (mep-fit (car (nth ftidx *MEP-PHUKIEN*)) (car (nth mtidx mats)) dn)
            (princ "\n[MEP] Chua nhap DN.")))
         ((= act "khbv") (c:MEP-KHBV))
         (T (setq keepon nil))))))
  (princ))

;; ---------------------------------------------------------------------------
;;  F2: Thư viện linh kiện — vẽ SYMBOL sơ đồ (theo DN) + chú thích BOM
;;  Không cần file block sẵn; symbol sinh bằng AutoLISP nên chạy cả Mac/Win.
;; ---------------------------------------------------------------------------
(defun mep:p+ (p dx dy) (list (+ (car p) dx) (+ (cadr p) dy)))

;; LWPOLYLINE từ danh sách điểm 2D (tuyệt đối)
(defun mep:pline (pts lay / e)
  (setq e (list '(0 . "LWPOLYLINE") (cons 8 lay)
                '(100 . "AcDbEntity") '(100 . "AcDbPolyline")
                (cons 90 (length pts)) '(70 . 0)))
  (foreach pt pts (setq e (append e (list (cons 10 pt)))))
  (entmake e))

;; Vẽ hình symbol theo loại phụ kiện tại p, kích thước theo h
(defun mep:symshape (kw p h lay)
  (cond
    ((= kw "Cut")
     (mep:pline (list (mep:p+ p 0 (* 2 h)) p (mep:p+ p (* 2 h) 0)) lay))
    ((= kw "Chech")
     (mep:pline (list (mep:p+ p 0 (* 2 h)) p (mep:p+ p (* 1.41 h) (* 1.41 h))) lay))
    ((or (= kw "Te") (= kw "Tedeu"))
     (mep:pline (list (mep:p+ p (* -2 h) 0) (mep:p+ p (* 2 h) 0)) lay)
     (mep:pline (list p (mep:p+ p 0 (* -2 h))) lay))
    ((or (= kw "Y") (= kw "Ydeu"))
     (mep:pline (list p (mep:p+ p 0 (* -2 h))) lay)
     (mep:pline (list p (mep:p+ p (* -1.41 h) (* 1.41 h))) lay)
     (mep:pline (list p (mep:p+ p (* 1.41 h) (* 1.41 h))) lay))
    ((= kw "Con")
     (mep:pline (list (mep:p+ p 0 h) (mep:p+ p (* 2 h) (* 0.5 h))
                      (mep:p+ p (* 2 h) (* -0.5 h)) (mep:p+ p 0 (* -1 h))
                      (mep:p+ p 0 h)) lay))
    ((= kw "Sip")
     (mep:pline (list (mep:p+ p 0 (* 2 h)) p (mep:p+ p (* 1.5 h) 0)
                      (mep:p+ p (* 1.5 h) (* 2 h))) lay))
    (T (mep:pline (list (mep:p+ p (* -1 h) 0) (mep:p+ p h 0)) lay))))

;; Public — nút/Job:  (mep-sym "Chech" "Upvc" 90)  → click 1 điểm
(defun mep-sym (pkkw vl dn / pk p h lay txt th mat)
  (setq pk (mep:find pkkw *MEP-PHUKIEN*))
  (cond
    ((not (and pk dn (> dn 0))) (princ "\n[MEP] Tham so phu kien khong hop le."))
    (T
     (setq mat (if (= vl "Ppr") "PPR" "uPVC")
           lay "MEP-PhuKien")
     (mep:mklayer lay 2)
     (setq p (getpoint (strcat "\nDiem dat " (cadr pk) " DN" (itoa dn) ": ")))
     (cond
       ((null p) (princ "\n[MEP] Da huy."))
       (T
        (setq h (/ (float (max dn 40)) 2.0))
        (mep:symshape pkkw p h lay)
        (setq th (if (> (getvar "TEXTSIZE") 0) (getvar "TEXTSIZE") 250.0)
              txt (strcat (cadr pk) ", " mat ", DN" (itoa dn)))
        (entmake (list '(0 . "TEXT") (cons 8 "MEP-GHICHU")
                       (cons 10 (mep:p+ p 0 (* -2.5 h))) (cons 11 (mep:p+ p 0 (* -2.5 h)))
                       (cons 40 th) (cons 1 txt) (cons 72 0) (cons 73 0)))
        (princ (strcat "\n[MEP] Da chen: " txt))))))
  (princ))

;; ---------------------------------------------------------------------------
;;  F1: điền khung tên — ghi giá trị vào ATTRIB của bản vẽ đang mở
;;  kv = list các (TAG . "Gia tri"), TAG viết HOA (vd "KHBV", "VE1_001").
;;  Public — app sinh job:  (mep-title (list (cons "KHBV" "ME-TN-T05") ...))
;; ---------------------------------------------------------------------------
(defun mep-title (kv / en et tag nv done n)
  (setq en (entnext) n 0)
  (while en
    (setq et (entget en))
    (if (= (cdr (assoc 0 et)) "ATTRIB")
      (progn
        (setq tag (strcase (cdr (assoc 2 et))))
        (if (setq nv (cdr (assoc tag kv)))
          (progn
            (entmod (subst (cons 1 nv) (assoc 1 et) et))
            (entupd en)
            (setq done T n (1+ n))))))
    (setq en (entnext en)))
  (if done
    (princ (strcat "\n[MEP] Da dien khung ten (" (itoa n) " o)."))
    (princ "\n[MEP] Khong thay ATTRIB khung ten khop — mo dung ban ve co khung ten."))
  (princ))

;; ---------------------------------------------------------------------------
;;  F4: chuẩn hoá layer (tạo layer chuẩn + dọn rác) & xuất PDF
;;  Chạy trên bản vẽ ĐANG MỞ. Batch nhiều file đóng: chỉ Windows qua
;;  accoreconsole (hướng nâng cấp sau, không có trên Mac).
;; ---------------------------------------------------------------------------
(defun mep-layerfix ( / e)
  (foreach e *MEP-LAYERS* (mep:mklayer (car e) (cdr e)))
  (command "_.-LAYER" "_Set" "0" "")
  (command "_.-PURGE" "_All" "*" "_No")   ; dọn layer/khối/kiểu không dùng
  (command "_.AUDIT" "_Yes")              ; soát & sửa lỗi bản vẽ
  (princ (strcat "\n[MEP] Da chuan hoa " (itoa (length *MEP-LAYERS*))
                 " layer + PURGE + AUDIT."))
  (princ))
(defun c:MEP-LAYERFIX ( ) (mep-layerfix))

;; bỏ đuôi .dwg khỏi tên file (không dùng hàm Visual LISP — Mac không có)
(defun mep:basename (s / n)
  (setq n (strlen s))
  (if (and (> n 4) (= (strcase (substr s (1+ (- n 4)))) ".DWG"))
    (substr s 1 (- n 4))
    s))

(defun mep-pdf ( / dir base fn fd)
  (setq dir  (mep:bridgedir)
        base (mep:basename (getvar "DWGNAME")))
  (if (= base "") (setq base "ban-ve"))
  (setq fn (strcat dir base ".pdf") fd (getvar "FILEDIA"))
  (setvar "FILEDIA" 0)
  (princ (strcat "\n[MEP] Xuat PDF -> " fn))
  (command "_.EXPORTPDF" fn)              ; xuất layout hiện tại ra PDF
  (setvar "FILEDIA" fd)
  (princ "\n[MEP] Neu loi: lenh/tham so EXPORTPDF co the khac tren ban CAD cua ban — bao lai de chinh.")
  (princ))
(defun c:MEP-PDF ( ) (mep-pdf))

;; ---------------------------------------------------------------------------
;;  CẦU NỐI app ngoài -> AutoCAD (hybrid) — domain-agnostic bridge
;;  App ghi job ra ~/Acad-Bridge/job.lsp (legacy: ~/MEP-Bridge/mep_job.lsp).
;;  Plugin AcadBridge auto-load; hoặc gõ ACAD-RUN / MEP-RUN.
;; ---------------------------------------------------------------------------
(defun acad:bridgedir ( / d env primary legacy)
  (setq env (getenv "ACAD_BRIDGE_DIR"))
  (if (or (null env) (= env ""))
    (setq env (getenv "MEP_BRIDGE_DIR")))
  (if (and env (/= env ""))
    (progn
      (if (and (/= (substr env (strlen env)) "/")
               (/= (substr env (strlen env)) "\\"))
        (setq env (strcat env "/")))
      env)
    (progn
      (setq d (cond ((getenv "HOME")) ((getenv "USERPROFILE")) (".")))
      (if (and (> (strlen d) 0)
               (/= (substr d (strlen d)) "/") (/= (substr d (strlen d)) "\\"))
        (setq d (strcat d "/")))
      (setq primary (strcat d "Acad-Bridge/")
            legacy  (strcat d "MEP-Bridge/"))
      (cond
        ((vl-file-directory-p primary) primary)
        ((vl-file-directory-p legacy) legacy)
        (T primary)))))

(defun mep:bridgedir ( ) (acad:bridgedir))

(defun acad:job-path ( / dir p)
  (setq dir (acad:bridgedir)
        p (strcat dir "job.lsp"))
  (if (findfile p) p
    (progn
      (setq p (strcat dir "mep_job.lsp"))
      (if (findfile p) p (strcat dir "job.lsp")))))

(defun c:ACAD-RUN ( / p)
  (setq p (acad:job-path))
  (cond
    ((findfile p)
     (princ (strcat "\n[ACAD] Nap job tu app: " p))
     (load p)
     (princ "\n[ACAD] Da chay xong job."))
    (T (princ (strcat "\n[ACAD] Khong thay job file. Can: " p))))
  (princ))

;; Legacy aliases
(defun c:MEP-RUN ( ) (c:ACAD-RUN))
(defun c:MR ( ) (c:ACAD-RUN))

(defun acad:trust ( / hp tp)
  (setq hp (getenv "HOME"))
  (if (and hp (= (type (getvar "TRUSTEDPATHS")) 'STR))
    (progn
      (setq tp (getvar "TRUSTEDPATHS"))
      (if (not (or (vl-string-search "Acad-Bridge" tp) (vl-string-search "MEP-Bridge" tp)))
        (setvar "TRUSTEDPATHS"
          (strcat tp ";" hp "/Acad-Bridge/...;" hp "/MEP-Bridge/...;"
                  hp "/Desktop/tool-autocad/acad-lisp/...")))))
  (princ))
(defun mep:trust ( ) (acad:trust))
(acad:trust)

(princ "\n[ACAD] San sang. Go ACAD-RUN (hoac MEP-RUN / MR) de chay job. Bridge: ~/Acad-Bridge/job.lsp")
(princ)

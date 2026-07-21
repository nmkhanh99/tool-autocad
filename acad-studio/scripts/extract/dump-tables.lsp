;; dump.lsp - dump toan bo cau truc ban ve ra file de phan tich
(defun dq (s) (if s (vl-princ-to-string s) ""))
(defun n1 (x) (if (numberp x) (rtos x 2 3) (dq x)))
(defun esc (s / r i c out)
  (setq s (vl-princ-to-string s) out "" i 0)
  (while (< i (strlen s))
    (setq c (substr s (1+ i) 1))
    (setq out (cond ((= c "\"") (strcat out "'"))
                    ((= c ",")  (strcat out ";"))
                    ((= c "\n") (strcat out " "))
                    (T (strcat out c))))
    (setq i (1+ i)))
  out)
(defun pt2 (p) (if p (strcat (rtos (car p) 2 3) " " (rtos (cadr p) 2 3)) ""))

(setq OUT (strcat (cond ((getenv "ACAD_DUMP_OUT")) ("/tmp/acad-dump")) "/"))

;; ---------- 1. HEADER ----------
(setq f (open (strcat OUT "header.txt") "w"))
(foreach v '("INSUNITS" "LTSCALE" "DIMSCALE" "CELTSCALE" "TEXTSIZE" "TEXTSTYLE"
             "CLAYER" "TILEMODE" "PSLTSCALE" "MEASUREMENT" "LUNITS" "LUPREC"
             "DIMSTYLE" "CMLSTYLE" "CMLSCALE" "CMLJUST" "ACADVER" "DWGCODEPAGE")
  (write-line (strcat v "=" (dq (getvar v))) f))
(write-line (strcat "EXTMIN=" (dq (getvar "EXTMIN"))) f)
(write-line (strcat "EXTMAX=" (dq (getvar "EXTMAX"))) f)
(close f)

;; ---------- 2. LAYERS ----------
(setq f (open (strcat OUT "layers.csv") "w"))
(write-line "name,color,linetype,lweight,plot,frozen,off,desc" f)
(setq e (tblnext "LAYER" T))
(while e
  (write-line (strcat (esc (cdr (assoc 2 e))) ","
                      (itoa (cdr (assoc 62 e))) ","
                      (esc (cdr (assoc 6 e))) ","
                      (if (assoc 370 e) (itoa (cdr (assoc 370 e))) "") ","
                      (if (assoc 290 e) (itoa (cdr (assoc 290 e))) "1") ","
                      (if (= 1 (logand 1 (cdr (assoc 70 e)))) "1" "0") ","
                      (if (< (cdr (assoc 62 e)) 0) "1" "0") ",")
              f)
  (setq e (tblnext "LAYER")))
(close f)

;; ---------- 3. TEXT STYLES ----------
(setq f (open (strcat OUT "styles.csv") "w"))
(write-line "name,font,bigfont,height,width,oblique,flags" f)
(setq e (tblnext "STYLE" T))
(while e
  (write-line (strcat (esc (cdr (assoc 2 e))) ","
                      (esc (cdr (assoc 3 e))) ","
                      (esc (cdr (assoc 4 e))) ","
                      (n1 (cdr (assoc 40 e))) ","
                      (n1 (cdr (assoc 41 e))) ","
                      (n1 (cdr (assoc 50 e))) ","
                      (itoa (cdr (assoc 70 e))))
              f)
  (setq e (tblnext "STYLE")))
(close f)

;; ---------- 4. DIM STYLES / LTYPES / VIEWS ----------
(setq f (open (strcat OUT "tables.txt") "w"))
(foreach tb '("DIMSTYLE" "LTYPE" "UCS" "VPORT" "APPID")
  (setq e (tblnext tb T))
  (while e
    (write-line (strcat tb "|" (esc (cdr (assoc 2 e)))) f)
    (setq e (tblnext tb))))
(close f)

;; ---------- 5. DIMSTYLE detail (current) ----------
(setq f (open (strcat OUT "dimvars.txt") "w"))
(foreach v '("DIMSCALE" "DIMTXT" "DIMASZ" "DIMEXE" "DIMEXO" "DIMGAP" "DIMTXSTY"
             "DIMDEC" "DIMLUNIT" "DIMBLK" "DIMCLRD" "DIMCLRE" "DIMCLRT" "DIMTIH" "DIMTOH")
  (write-line (strcat v "=" (dq (getvar v))) f))
(close f)

;; ---------- 6. BLOCK DEFS ----------
(setq f (open (strcat OUT "blocks.csv") "w"))
(write-line "block,nents,types,hasattdef,attdeftags,isanon,isxref" f)
(setq e (tblnext "BLOCK" T))
(while e
  (setq bn (cdr (assoc 2 e)) en (cdr (assoc -2 e)) cnt 0 tys '() tags "" flg (cdr (assoc 70 e)))
  (while en
    (setq el (entget en) ty (cdr (assoc 0 el)) cnt (1+ cnt))
    (if (not (member ty tys)) (setq tys (cons ty tys)))
    (if (= ty "ATTDEF") (setq tags (strcat tags (if (= tags "") "" " ") (dq (cdr (assoc 2 el))))))
    (setq en (entnext en)))
  (write-line (strcat (esc bn) "," (itoa cnt) ","
                      (esc (apply 'strcat (mapcar '(lambda (x) (strcat x " ")) tys))) ","
                      (if (= tags "") "0" "1") "," (esc tags) ","
                      (if (wcmatch bn "`**") "1" "0") ","
                      (if (= 4 (logand 4 flg)) "1" "0"))
              f)
  (setq e (tblnext "BLOCK")))
(close f)

;; ---------- 7. LAYOUTS ----------
(setq f (open (strcat OUT "layouts.txt") "w"))
(setq lo (dictsearch (namedobjdict) "ACAD_LAYOUT"))
(foreach it lo
  (if (= 3 (car it)) (write-line (strcat "LAYOUT=" (esc (cdr it))) f)))
(close f)

;; ---------- 8. ENTITIES (model + paper) ----------
(defun dump-space (spacename outfile / ss i en el ty f2)
  (setq f2 (open (strcat OUT outfile) "w"))
  (write-line "handle,type,layer,space,color,ltype,data" f2)
  (setq ss (ssget "_X" (list (cons 410 spacename))))
  (setq i 0)
  (if ss
    (while (< i (sslength ss))
      (setq en (ssname ss i) el (entget en) ty (cdr (assoc 0 el)) data "")
      (cond
        ((= ty "MLINE")
         (setq data (strcat "style=" (esc (dq (cdr (assoc 2 el))))
                            " scale=" (n1 (cdr (assoc 40 el)))
                            " just=" (dq (cdr (assoc 70 el)))
                            " npts=" (dq (cdr (assoc 72 el)))
                            " pts=["))
         (foreach p el (if (= 11 (car p)) (setq data (strcat data "(" (pt2 (cdr p)) ")"))))
         (setq data (strcat data "]")))
        ((or (= ty "LWPOLYLINE"))
         (setq data (strcat "closed=" (dq (cdr (assoc 70 el))) " w=" (n1 (cdr (assoc 43 el))) " pts=["))
         (foreach p el (if (= 10 (car p)) (setq data (strcat data "(" (pt2 (cdr p)) ")"))))
         (setq data (strcat data "]")))
        ((= ty "LINE")
         (setq data (strcat "p1=(" (pt2 (cdr (assoc 10 el))) ") p2=(" (pt2 (cdr (assoc 11 el))) ")")))
        ((= ty "CIRCLE")
         (setq data (strcat "c=(" (pt2 (cdr (assoc 10 el))) ") r=" (n1 (cdr (assoc 40 el))))))
        ((= ty "ARC")
         (setq data (strcat "c=(" (pt2 (cdr (assoc 10 el))) ") r=" (n1 (cdr (assoc 40 el)))
                            " a1=" (n1 (cdr (assoc 50 el))) " a2=" (n1 (cdr (assoc 51 el))))))
        ((or (= ty "TEXT") (= ty "ATTDEF") (= ty "ATTRIB"))
         (setq data (strcat "p=(" (pt2 (cdr (assoc 10 el))) ") h=" (n1 (cdr (assoc 40 el)))
                            " rot=" (n1 (cdr (assoc 50 el)))
                            " sty=" (esc (dq (cdr (assoc 7 el))))
                            " tag=" (esc (dq (cdr (assoc 2 el))))
                            " txt=" (esc (dq (cdr (assoc 1 el)))))))
        ((= ty "MTEXT")
         (setq data (strcat "p=(" (pt2 (cdr (assoc 10 el))) ") h=" (n1 (cdr (assoc 40 el)))
                            " w=" (n1 (cdr (assoc 41 el)))
                            " sty=" (esc (dq (cdr (assoc 7 el))))
                            " txt=" (esc (dq (cdr (assoc 1 el)))))))
        ((= ty "INSERT")
         (setq data (strcat "blk=" (esc (dq (cdr (assoc 2 el))))
                            " p=(" (pt2 (cdr (assoc 10 el))) ")"
                            " sx=" (n1 (cdr (assoc 41 el))) " sy=" (n1 (cdr (assoc 42 el)))
                            " rot=" (n1 (cdr (assoc 50 el)))
                            " att=" (dq (cdr (assoc 66 el))))))
        ((= ty "DIMENSION")
         (setq data (strcat "sty=" (esc (dq (cdr (assoc 3 el))))
                            " defp=(" (pt2 (cdr (assoc 10 el))) ")"
                            " txtp=(" (pt2 (cdr (assoc 11 el))) ")"
                            " p13=(" (pt2 (cdr (assoc 13 el))) ")"
                            " p14=(" (pt2 (cdr (assoc 14 el))) ")"
                            " dtype=" (dq (cdr (assoc 70 el)))
                            " txt=" (esc (dq (cdr (assoc 1 el)))))))
        ((= ty "MULTILEADER")
         (setq data (strcat "raw=" (esc (dq el)))))
        ((= ty "HATCH")
         (setq data (strcat "pat=" (esc (dq (cdr (assoc 2 el))))
                            " solid=" (dq (cdr (assoc 70 el)))
                            " scale=" (n1 (cdr (assoc 41 el)))
                            " ang=" (n1 (cdr (assoc 52 el))))))
        ((= ty "VIEWPORT")
         (setq data (strcat "ctr=(" (pt2 (cdr (assoc 10 el))) ")"
                            " w=" (n1 (cdr (assoc 40 el))) " h=" (n1 (cdr (assoc 41 el)))
                            " vpid=" (dq (cdr (assoc 69 el)))
                            " vh=" (n1 (cdr (assoc 45 el))))))
        (T (setq data (esc (dq el))))
      )
      (write-line (strcat (dq (cdr (assoc 5 el))) "," ty ","
                          (esc (cdr (assoc 8 el))) "," spacename ","
                          (if (assoc 62 el) (itoa (cdr (assoc 62 el))) "") ","
                          (esc (dq (cdr (assoc 6 el)))) "," data)
                  f2)
      (setq i (1+ i))))
  (close f2))

(dump-space "Model" "ents-model.csv")
(dump-space "*Paper_Space*" "ents-paper.csv")

;; ---------- 9. ATTRIB cua INSERT (khung ten) ----------
(setq f (open (strcat OUT "attribs.csv") "w"))
(write-line "insert_handle,block,tag,value,pos,height,style" f)
(setq ss (ssget "_X" '((0 . "INSERT") (66 . 1))))
(setq i 0)
(if ss
  (while (< i (sslength ss))
    (setq en (ssname ss i) el (entget en) bn (cdr (assoc 2 el)) hh (cdr (assoc 5 el)))
    (setq sub (entnext en))
    (while (and sub (/= "SEQEND" (cdr (assoc 0 (entget sub)))))
      (setq sel (entget sub))
      (if (= "ATTRIB" (cdr (assoc 0 sel)))
        (write-line (strcat (dq hh) "," (esc bn) "," (esc (dq (cdr (assoc 2 sel)))) ","
                            (esc (dq (cdr (assoc 1 sel)))) ","
                            "(" (pt2 (cdr (assoc 10 sel))) "),"
                            (n1 (cdr (assoc 40 sel))) ","
                            (esc (dq (cdr (assoc 7 sel)))))
                    f))
      (setq sub (entnext sub)))
    (setq i (1+ i))))
(close f)

;; ---------- 10. MLINE STYLE dictionary ----------
(setq f (open (strcat OUT "mlinestyles.txt") "w"))
(setq ml (dictsearch (namedobjdict) "ACAD_MLINESTYLE"))
(foreach it ml
  (if (= 3 (car it))
    (progn
      (write-line (strcat "MLSTYLE=" (esc (cdr it))) f)
      (setq d2 (dictsearch (cdr (assoc -1 (list (cons -1 (cdr (assoc 350 ml)))))) (cdr it)))))
  (if (= 350 (car it))
    (progn
      (setq mel (entget (cdr it)))
      (write-line (strcat "  detail=" (esc (dq mel))) f))))
(close f)

(princ "\nDUMP-OK\n")
(princ)

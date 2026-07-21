;; dump2.lsp - dimstyles, mleader text, layouts/viewports, block geometry
(defun dq (s) (if s (vl-princ-to-string s) ""))
(defun n1 (x) (if (numberp x) (rtos x 2 3) (dq x)))
(setq OUT (strcat (cond ((getenv "ACAD_DUMP_OUT")) ("/tmp/acad-dump")) "/"))

;; ---- DIMSTYLES full ----
(setq f (open (strcat OUT "dimstyles.txt") "w"))
(setq e (tblnext "DIMSTYLE" T))
(while e
  (write-line (strcat "STYLE=" (dq (cdr (assoc 2 e)))) f)
  (foreach it e
    (if (member (car it) '(3 4 5 6 7 40 41 42 43 44 45 46 140 141 143 144 147 176 177 178 271 272 279 280 281 282 283 341 342 343 344))
      (write-line (strcat "   " (itoa (car it)) " = " (dq (cdr it))) f)))
  (setq e (tblnext "DIMSTYLE")))
(close f)

;; ---- MLEADER text ----
(setq f (open (strcat OUT "mleaders.txt") "w"))
(setq ss (ssget "_X" '((0 . "MULTILEADER"))))
(setq i 0)
(if ss (while (< i (sslength ss))
  (setq el (entget (ssname ss i)))
  (write-line (strcat "--- " (dq (cdr (assoc 5 el))) " layer=" (dq (cdr (assoc 8 el)))) f)
  (foreach it el
    (if (member (car it) '(300 302 304 40 41 42 43 45 90 91 170 171 172 173 174 175 176 177 178 179 10 11 12 13))
      (write-line (strcat "   " (itoa (car it)) " = " (dq (cdr it))) f)))
  (setq i (1+ i))))
(close f)

;; ---- LAYOUTS + VIEWPORTS ----
(setq f (open (strcat OUT "layout-vp.txt") "w"))
(setq lo (dictsearch (namedobjdict) "ACAD_LAYOUT"))
(foreach it lo
  (if (= 350 (car it))
    (progn
      (setq lel (entget (cdr it)))
      (write-line (strcat "LAYOUT " (dq (cdr (assoc 1 lel)))
                          " tab=" (dq (cdr (assoc 71 lel)))
                          " pmin=" (dq (cdr (assoc 10 lel)))
                          " pmax=" (dq (cdr (assoc 11 lel)))
                          " limmin=" (dq (cdr (assoc 14 lel)))
                          " limmax=" (dq (cdr (assoc 15 lel)))
                          " psize=" (dq (cdr (assoc 44 lel))) "x" (dq (cdr (assoc 45 lel)))
                          " canonical=" (dq (cdr (assoc 4 lel))))
                  f))))
(close f)

;; ---- entities per layout tab ----
(setq f (open (strcat OUT "ents-by-space.txt") "w"))
(foreach sp '("Model" "01" "02" "03" "KL")
  (setq ss (ssget "_X" (list (cons 410 sp))))
  (write-line (strcat "SPACE " sp " n=" (if ss (itoa (sslength ss)) "0")) f)
  (setq i 0)
  (if ss (while (< i (sslength ss))
    (setq el (entget (ssname ss i)))
    (write-line (strcat "   " (dq (cdr (assoc 0 el))) " lay=" (dq (cdr (assoc 8 el)))
                        (if (= "INSERT" (cdr (assoc 0 el))) (strcat " blk=" (dq (cdr (assoc 2 el)))) "")
                        (if (= "VIEWPORT" (cdr (assoc 0 el)))
                          (strcat " ctr=" (dq (cdr (assoc 10 el))) " w=" (n1 (cdr (assoc 40 el)))
                                  " h=" (n1 (cdr (assoc 41 el))) " vh=" (n1 (cdr (assoc 45 el)))
                                  " vctr=" (dq (cdr (assoc 12 el))) " status=" (dq (cdr (assoc 68 el))))
                          "")
                        (if (member (cdr (assoc 0 el)) '("TEXT" "MTEXT"))
                          (strcat " txt=" (dq (cdr (assoc 1 el)))) ""))
                f)
    (setq i (1+ i)))))
(close f)

;; ---- FITTING BLOCK GEOMETRY (named, non-anon, small) ----
(setq f (open (strcat OUT "fitting-blocks.txt") "w"))
(setq e (tblnext "BLOCK" T))
(while e
  (setq bn (cdr (assoc 2 e)))
  (if (and (not (wcmatch bn "`**")) (not (wcmatch bn "A$C*")))
    (progn
      (write-line (strcat "BLOCK " bn " base=" (dq (cdr (assoc 10 e)))) f)
      (setq en (cdr (assoc -2 e)) k 0)
      (while (and en (< k 40))
        (setq el (entget en) ty (cdr (assoc 0 el)))
        (write-line (strcat "    " ty " lay=" (dq (cdr (assoc 8 el)))
                            (cond
                              ((= ty "LINE") (strcat " " (dq (cdr (assoc 10 el))) "->" (dq (cdr (assoc 11 el)))))
                              ((= ty "CIRCLE") (strcat " c=" (dq (cdr (assoc 10 el))) " r=" (n1 (cdr (assoc 40 el)))))
                              ((= ty "ARC") (strcat " c=" (dq (cdr (assoc 10 el))) " r=" (n1 (cdr (assoc 40 el))) " " (n1 (cdr (assoc 50 el))) "-" (n1 (cdr (assoc 51 el)))))
                              ((= ty "LWPOLYLINE") (strcat " nv=" (dq (cdr (assoc 90 el))) " closed=" (dq (cdr (assoc 70 el)))))
                              ((= ty "ATTDEF") (strcat " tag=" (dq (cdr (assoc 2 el))) " def=" (dq (cdr (assoc 1 el))) " h=" (n1 (cdr (assoc 40 el)))))
                              ((member ty '("TEXT")) (strcat " txt=" (dq (cdr (assoc 1 el))) " h=" (n1 (cdr (assoc 40 el)))))
                              ((= ty "INSERT") (strcat " blk=" (dq (cdr (assoc 2 el)))))
                              (T "")))
                    f)
        (setq en (entnext en) k (1+ k)))))
  (setq e (tblnext "BLOCK")))
(close f)

;; ---- MLINE style detail ----
(setq f (open (strcat OUT "mlstyle.txt") "w"))
(setq ml (dictsearch (namedobjdict) "ACAD_MLINESTYLE"))
(foreach it ml
  (if (= 350 (car it))
    (progn (setq mel (entget (cdr it)))
           (write-line "---" f)
           (foreach t2 mel (write-line (strcat "   " (itoa (car t2)) " = " (dq (cdr t2))) f)))))
(close f)

;; ---- MLINE full list with DN ----
(setq f (open (strcat OUT "mlines.csv") "w"))
(write-line "handle,layer,style,dn,npts,pts" f)
(setq ss (ssget "_X" '((0 . "MLINE"))))
(setq i 0)
(if ss (while (< i (sslength ss))
  (setq el (entget (ssname ss i)) s "")
  (foreach p el (if (= 11 (car p)) (setq s (strcat s "(" (rtos (car (cdr p)) 2 2) " " (rtos (cadr (cdr p)) 2 2) ")"))))
  (write-line (strcat (dq (cdr (assoc 5 el))) "," (dq (cdr (assoc 8 el))) ","
                      (dq (cdr (assoc 2 el))) "," (n1 (cdr (assoc 40 el))) ","
                      (dq (cdr (assoc 72 el))) "," s) f)
  (setq i (1+ i))))
(close f)

;; ---- INSERT full list ----
(setq f (open (strcat OUT "inserts.csv") "w"))
(write-line "handle,layer,block,x,y,sx,rot" f)
(setq ss (ssget "_X" '((0 . "INSERT"))))
(setq i 0)
(if ss (while (< i (sslength ss))
  (setq el (entget (ssname ss i)) p (cdr (assoc 10 el)))
  (write-line (strcat (dq (cdr (assoc 5 el))) "," (dq (cdr (assoc 8 el))) ","
                      (dq (cdr (assoc 2 el))) ","
                      (rtos (car p) 2 2) "," (rtos (cadr p) 2 2) ","
                      (n1 (cdr (assoc 41 el))) ","
                      (rtos (/ (* 180.0 (cdr (assoc 50 el))) pi) 2 2)) f)
  (setq i (1+ i))))
(close f)

(princ "\nDUMP2-OK\n")
(princ)

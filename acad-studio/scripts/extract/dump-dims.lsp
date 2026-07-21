;; dump3.lsp — DIMENSION chi tiết (góc quay, kiểu, số đo) + DIMSTYLE DIMPOST/arrow
(defun dq (s) (if s (vl-princ-to-string s) ""))
(defun n1 (x) (if (numberp x) (rtos x 2 4) (dq x)))
(setq OUT (strcat (cond ((getenv "ACAD_DUMP_OUT")) ("/tmp/acad-dump")) "/"))

(setq f (open (strcat OUT "dims-detail.csv") "w"))
(write-line "handle,layer,style,g70,g50,meas,text,p10x,p10y,p11x,p11y,p13x,p13y,p14x,p14y" f)
(setq ss (ssget "_X" '((0 . "DIMENSION"))))
(setq i 0)
(if ss (while (< i (sslength ss))
  (setq el (entget (ssname ss i)))
  (setq p10 (cdr (assoc 10 el)) p11 (cdr (assoc 11 el))
        p13 (cdr (assoc 13 el)) p14 (cdr (assoc 14 el)))
  (write-line (strcat (dq (cdr (assoc 5 el))) "," (dq (cdr (assoc 8 el))) ","
                      (dq (cdr (assoc 3 el))) ","
                      (dq (cdr (assoc 70 el))) ","
                      (n1 (if (assoc 50 el) (cdr (assoc 50 el)) 0.0)) ","
                      (n1 (if (assoc 42 el) (cdr (assoc 42 el)) 0.0)) ","
                      (dq (cdr (assoc 1 el))) ","
                      (n1 (car p10)) "," (n1 (cadr p10)) ","
                      (n1 (car p11)) "," (n1 (cadr p11)) ","
                      (n1 (car p13)) "," (n1 (cadr p13)) ","
                      (n1 (car p14)) "," (n1 (cadr p14)))
              f)
  (setq i (1+ i))))
(close f)

;; DIMSTYLE: DIMPOST(3) DIMSCALE(40) DIMTXT(140) DIMASZ(41) arrow blocks(342/343/344) txtsty(340)
(setq f (open (strcat OUT "dimstyles-key.csv") "w"))
(write-line "name,dimpost,dimscale,dimtxt,dimasz,dimdec,arrowblk,txtstyle,clrt" f)
(setq e (tblnext "DIMSTYLE" T))
(while e
  (write-line (strcat (dq (cdr (assoc 2 e))) ","
                      (dq (cdr (assoc 3 e))) ","
                      (n1 (cdr (assoc 40 e))) ","
                      (n1 (cdr (assoc 140 e))) ","
                      (n1 (cdr (assoc 41 e))) ","
                      (dq (cdr (assoc 271 e))) ","
                      (if (assoc 342 e) (dq (cdr (assoc 2 (entget (cdr (assoc 342 e)))))) "") ","
                      (if (assoc 340 e) (dq (cdr (assoc 2 (entget (cdr (assoc 340 e)))))) "") ","
                      (dq (cdr (assoc 178 e))))
              f)
  (setq e (tblnext "DIMSTYLE")))
(close f)

;; MLEADERSTYLE
(setq f (open (strcat OUT "mleaderstyles.txt") "w"))
(setq d (dictsearch (namedobjdict) "ACAD_MLEADERSTYLE"))
(foreach it d
  (if (= 350 (car it))
    (progn (write-line "---" f)
           (foreach t2 (entget (cdr it))
             (if (member (car t2) '(2 3 40 41 42 43 45 90 91 140 141 142 143 170 171 172 173 174 175 176 177 178 179 340 341 342 343))
               (write-line (strcat "   " (itoa (car t2)) " = " (dq (cdr t2))) f))))))
(close f)
(princ "\nDUMP3-OK\n")
(princ)

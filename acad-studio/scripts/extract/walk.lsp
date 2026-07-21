;; walk.lsp — duyệt ĐỆ QUY định nghĩa block, xuất hình học ra TOẠ ĐỘ THẾ GIỚI.
;; Không EXPLODE, không sửa bản vẽ.
(defun dq (s) (if s (vl-princ-to-string s) ""))
(defun n2 (x) (rtos (float x) 2 2))

(setq OUTF (cond ((getenv "ACAD_WALK_OUT")) ("/tmp/walk.csv")))
(setq MAXD 6)

;; biến đổi điểm p qua (dx dy, sx sy, rot)
(defun xf (p tr / x y sx sy rot c s nx ny)
  (setq x (car p) y (cadr p)
        sx (nth 2 tr) sy (nth 3 tr) rot (nth 4 tr))
  (setq x (* x sx) y (* y sy))
  (setq c (cos rot) s (sin rot))
  (setq nx (- (* x c) (* y s))
        ny (+ (* x s) (* y c)))
  (list (+ nx (car tr)) (+ ny (cadr tr))))

(defun sc (tr) (abs (nth 2 tr)))          ; hệ số tỷ lệ tổng cho bán kính/chiều cao

;; gộp transform con vào transform cha
(defun compose (tr el / ip sx sy rot p)
  (setq ip (cdr (assoc 10 el))
        sx (cond ((cdr (assoc 41 el))) (1.0))
        sy (cond ((cdr (assoc 42 el))) (1.0))
        rot (cond ((cdr (assoc 50 el))) (0.0)))
  (setq p (xf (list (car ip) (cadr ip)) tr))
  (list (car p) (cadr p)
        (* (nth 2 tr) sx) (* (nth 3 tr) sy)
        (+ (nth 4 tr) rot)))

(setq ROOT "")
(defun emit (ty lay dat) (write-line (strcat ROOT "," ty "," lay "," dat) F))

(defun do-ent (el tr / ty lay p q r pts)
  (setq ty (cdr (assoc 0 el)) lay (dq (cdr (assoc 8 el))))
  (cond
    ((= ty "LINE")
     (setq p (xf (cdr (assoc 10 el)) tr) q (xf (cdr (assoc 11 el)) tr))
     (emit "LINE" lay (strcat (n2 (car p)) " " (n2 (cadr p)) " " (n2 (car q)) " " (n2 (cadr q)))))
    ((= ty "LWPOLYLINE")
     (setq pts "")
     (foreach g el
       (if (= 10 (car g))
         (progn (setq p (xf (cdr g) tr))
                (setq pts (strcat pts (n2 (car p)) " " (n2 (cadr p)) " ")))))
     (emit "LWPOLYLINE" lay (strcat pts "|" (dq (cdr (assoc 70 el))))))
    ((= ty "CIRCLE")
     (setq p (xf (cdr (assoc 10 el)) tr))
     (emit "CIRCLE" lay (strcat (n2 (car p)) " " (n2 (cadr p)) " "
                                (n2 (* (sc tr) (cdr (assoc 40 el)))))))
    ((= ty "ARC")
     (setq p (xf (cdr (assoc 10 el)) tr))
     (emit "ARC" lay (strcat (n2 (car p)) " " (n2 (cadr p)) " "
                             (n2 (* (sc tr) (cdr (assoc 40 el)))) " "
                             (n2 (+ (cdr (assoc 50 el)) (nth 4 tr))) " "
                             (n2 (+ (cdr (assoc 51 el)) (nth 4 tr))))))
    ((= ty "ELLIPSE")
     ;; group 10 = TÂM (điểm), group 11 = VECTOR trục lớn (tương đối tâm)
     ;; → chỉ xoay + tỷ lệ vector, KHÔNG tịnh tiến.
     (setq p (xf (cdr (assoc 10 el)) tr)
           q (xf (cdr (assoc 11 el)) (list 0.0 0.0 (nth 2 tr) (nth 3 tr) (nth 4 tr))))
     (emit "ELLIPSE" lay (strcat (n2 (car p)) " " (n2 (cadr p)) " "
                                 (n2 (car q)) " " (n2 (cadr q)) " "
                                 (n2 (cdr (assoc 40 el))))))
    ((member ty '("TEXT" "ATTRIB" "ATTDEF"))
     (setq p (xf (cdr (assoc 10 el)) tr))
     (emit ty lay (strcat (n2 (car p)) " " (n2 (cadr p)) " "
                          (n2 (* (sc tr) (cdr (assoc 40 el)))) " "
                          (n2 (+ (cond ((cdr (assoc 50 el))) (0.0)) (nth 4 tr))) " |"
                          (dq (cdr (assoc 1 el))))))
    ((= ty "MTEXT")
     (setq p (xf (cdr (assoc 10 el)) tr))
     (emit "MTEXT" lay (strcat (n2 (car p)) " " (n2 (cadr p)) " "
                               (n2 (* (sc tr) (cdr (assoc 40 el)))) " 0 |"
                               (dq (cdr (assoc 1 el))))))
    ((= ty "MLINE")
     (setq pts "")
     (foreach g el
       (if (= 11 (car g))
         (progn (setq p (xf (cdr g) tr))
                (setq pts (strcat pts (n2 (car p)) " " (n2 (cadr p)) " ")))))
     (emit "MLINE" lay (strcat pts "|" (n2 (* (sc tr) (cdr (assoc 40 el)))))))
    ((= ty "POINT")
     (setq p (xf (cdr (assoc 10 el)) tr))
     (emit "POINT" lay (strcat (n2 (car p)) " " (n2 (cadr p)))))
  ))

(defun walk-block (bname tr depth / bl en el ty)
  (if (> depth MAXD) nil
    (progn
      (setq bl (tblsearch "BLOCK" bname))
      (if bl
        (progn
          (setq en (cdr (assoc -2 bl)))
          (while en
            (setq el (entget en) ty (cdr (assoc 0 el)))
            (if (= ty "INSERT")
              (walk-block (cdr (assoc 2 el)) (compose tr el) (1+ depth))
              (do-ent el tr))
            (setq en (entnext en))))))))

(setq F (open OUTF "w"))
(write-line "root,type,layer,data" F)
;; duyệt model space
(setq ss (ssget "_X" '((410 . "Model"))))
(setq i 0 n (if ss (sslength ss) 0))
(while (< i n)
  (setq el (entget (ssname ss i)))
  (if (= "INSERT" (cdr (assoc 0 el)))
    (progn (setq ROOT (dq (cdr (assoc 2 el))))
           (walk-block (cdr (assoc 2 el)) (compose '(0.0 0.0 1.0 1.0 0.0) el) 1))
    (progn (setq ROOT "-msp-") (do-ent el '(0.0 0.0 1.0 1.0 0.0))))
  (setq i (1+ i)))
(close F)
(princ (strcat "\n### WALK model n=" (itoa n) " -> " OUTF))
(princ "\nWALK-OK\n")
(princ)

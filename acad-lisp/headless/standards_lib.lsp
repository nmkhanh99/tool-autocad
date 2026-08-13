;;; ============================================================================
;;; standards_lib.lsp — primitives for drawing standards scan/apply
;;;
;;; Designed for AutoCAD for Mac/Core Console.  It intentionally uses only
;;; ent*/ss*/tbl*/setvar/command and plain file I/O; no VLA/VLAX curve APIs.
;;; The daemon inlines this file into an exact-target live job.
;;; ============================================================================

(defun acadstd:replace (s old new / at out)
  (setq out "")
  (while (setq at (vl-string-search old s))
    (setq out (strcat out (substr s 1 at) new)
          s (substr s (+ at (strlen old) 1))))
  (strcat out s))

(defun acadstd:text (value / s)
  (setq s
    (cond
      ((null value) "")
      ((= (type value) 'STR) value)
      ((= (type value) 'INT) (itoa value))
      ((= (type value) 'REAL) (rtos value 2 8))
      (T (vl-princ-to-string value))))
  (setq s (acadstd:replace s "\t" " "))
  (setq s (acadstd:replace s "\r" " "))
  (acadstd:replace s "\n" " "))

(defun acadstd:line (stream values / out)
  (setq out "")
  (foreach value values
    (setq out
      (strcat out (if (= out "") "" "\t") (acadstd:text value))))
  (write-line out stream))

(defun acadstd:point3 (point)
  (if point
    (list
      (float (car point))
      (float (cadr point))
      (if (caddr point) (float (caddr point)) 0.0))
    '(0.0 0.0 0.0)))

(defun acadstd:lwpoints (data / points item)
  (setq points '())
  (foreach item data
    (if (= (car item) 10)
      (setq points (cons (list (cadr item) (caddr item)) points))))
  (reverse points))

(defun acadstd:closed-lwpoly-p (data)
  (and
    (= (cdr (assoc 0 data)) "LWPOLYLINE")
    (assoc 70 data)
    (= 1 (logand 1 (cdr (assoc 70 data))))))

(defun acadstd:bounds-points (points / point minx miny maxx maxy)
  (if (null points)
    nil
    (progn
      (setq point (car points)
            minx (car point) maxx (car point)
            miny (cadr point) maxy (cadr point))
      (foreach point (cdr points)
        (setq minx (min minx (car point))
              miny (min miny (cadr point))
              maxx (max maxx (car point))
              maxy (max maxy (cadr point))))
      (list minx miny maxx maxy))))

(defun acadstd:entity-bounds (data / entityType center radius)
  (setq entityType (cdr (assoc 0 data)))
  (cond
    ((= entityType "LWPOLYLINE")
      (acadstd:bounds-points (acadstd:lwpoints data)))
    ((= entityType "CIRCLE")
      (setq center (cdr (assoc 10 data))
            radius (abs (cdr (assoc 40 data))))
      (list (- (car center) radius) (- (cadr center) radius)
            (+ (car center) radius) (+ (cadr center) radius)))
    (T
      (if (assoc 10 data)
        (progn
          (setq center (cdr (assoc 10 data)))
          (list (car center) (cadr center) (car center) (cadr center)))
        nil))))

(defun acadstd:bounds-center (bounds)
  (if bounds
    (list
      (/ (+ (nth 0 bounds) (nth 2 bounds)) 2.0)
      (/ (+ (nth 1 bounds) (nth 3 bounds)) 2.0))
    nil))

(defun acadstd:lwarea (data / points count index next total p1 p2)
  ;; Shoelace area. Curved bulge segments are deliberately not approximated.
  (setq points (acadstd:lwpoints data)
        count (length points)
        index 0
        total 0.0)
  (if (< count 3)
    0.0
    (progn
      (while (< index count)
        (setq next (rem (1+ index) count)
              p1 (nth index points)
              p2 (nth next points)
              total (+ total (- (* (car p1) (cadr p2))
                                (* (cadr p1) (car p2))))
              index (1+ index)))
      (/ (abs total) 2.0))))

(defun acadstd:entity-area (data / entityType radius)
  (setq entityType (cdr (assoc 0 data)))
  (cond
    ((and (= entityType "LWPOLYLINE") (acadstd:closed-lwpoly-p data))
      (acadstd:lwarea data))
    ((= entityType "CIRCLE")
      (setq radius (abs (cdr (assoc 40 data))))
      (* pi radius radius))
    (T 0.0)))

(defun acadstd:point-in-poly (point points / inside count i j pi2 pj2 yi yj)
  (setq inside nil count (length points) i 0 j (1- (length points)))
  (if (> count 2)
    (while (< i count)
      (setq pi2 (nth i points)
            pj2 (nth j points)
            yi (cadr pi2)
            yj (cadr pj2))
      (if
        (and
          (not (eq (> yi (cadr point)) (> yj (cadr point))))
          (< (car point)
             (+ (car pi2)
                (* (- (car pj2) (car pi2))
                   (/ (- (cadr point) yi) (- yj yi))))))
        (setq inside (not inside)))
      (setq j i i (1+ i))))
  inside)

(defun acadstd:pattern-p (value pattern)
  (or
    (= (acadstd:text pattern) "")
    (wcmatch (strcase (acadstd:text value)) (strcase pattern))))

(defun acadstd:map-in-bounds-p (center mapping / minx miny maxx maxy)
  ;; mapping: id label kind layer block text entity minx miny maxx maxy
  (setq minx (nth 7 mapping) miny (nth 8 mapping)
        maxx (nth 9 mapping) maxy (nth 10 mapping))
  (or
    (not (and (numberp minx) (numberp miny)
              (numberp maxx) (numberp maxy)))
    (and center
         (>= (car center) minx) (<= (car center) maxx)
         (>= (cadr center) miny) (<= (cadr center) maxy))))

(defun acadstd:map-entity-p (data mapping / entityType layer block bounds center layerPattern blockPattern)
  (setq entityType (cdr (assoc 0 data))
        layer (cdr (assoc 8 data))
        block (if (= entityType "INSERT") (cdr (assoc 2 data)) "")
        bounds (acadstd:entity-bounds data)
        center (acadstd:bounds-center bounds)
        layerPattern (acadstd:text (nth 3 mapping))
        blockPattern (acadstd:text (nth 4 mapping)))
  (and
    (acadstd:pattern-p entityType (nth 6 mapping))
    (or
      (and (= layerPattern "") (= blockPattern ""))
      (and (/= layerPattern "") (acadstd:pattern-p layer layerPattern))
      (and (/= blockPattern "") (= entityType "INSERT")
           (acadstd:pattern-p block blockPattern)))
    (acadstd:map-in-bounds-p center mapping)))

(defun acadstd:write-object (stream mapping entity label / data bounds center area)
  (setq data (entget entity)
        bounds (acadstd:entity-bounds data)
        center (acadstd:bounds-center bounds)
        area (acadstd:entity-area data))
  (acadstd:line stream
    (list
      "OBJECT"
      (nth 0 mapping)
      (nth 1 mapping)
      (nth 2 mapping)
      (cdr (assoc 5 data))
      (cdr (assoc 0 data))
      (cdr (assoc 8 data))
      area
      (if bounds (- (nth 2 bounds) (nth 0 bounds)) 0.0)
      (if bounds (- (nth 3 bounds) (nth 1 bounds)) 0.0)
      (if center (car center) 0.0)
      (if center (cadr center) 0.0)
      label)))

(defun acadstd:already-seen-p (handle seen)
  (if (member handle seen) T nil))

(defun acadstd:scan-room (stream mapping allSelection textSelection maxItems
                          / ti textEntity textData textPoint textValue
                            ei entity data handle seen written)
  (setq ti 0 seen '() written 0)
  (if textSelection
    (while (and (< ti (sslength textSelection)) (< written maxItems))
      (setq textEntity (ssname textSelection ti)
            textData (entget textEntity)
            textPoint (cdr (assoc 10 textData))
            textValue (cdr (assoc 1 textData)))
      (if (and textPoint
               (acadstd:pattern-p textValue (nth 5 mapping)))
        (progn
          (setq ei 0)
          (while (and allSelection
                      (< ei (sslength allSelection))
                      (< written maxItems))
            (setq entity (ssname allSelection ei)
                  data (entget entity)
                  handle (cdr (assoc 5 data)))
            (if
              (and
                (not (acadstd:already-seen-p handle seen))
                (acadstd:closed-lwpoly-p data)
                (acadstd:map-entity-p data mapping)
                (acadstd:point-in-poly textPoint (acadstd:lwpoints data)))
              (progn
                (acadstd:write-object stream mapping entity textValue)
                (setq seen (cons handle seen)
                      written (1+ written))))
            (setq ei (1+ ei)))))
      (setq ti (1+ ti))))
  written)

(defun acadstd:scan-map (stream mapping allSelection maxItems
                         / index entity data written)
  (if (= (strcase (acadstd:text (nth 2 mapping))) "ROOM")
    (acadstd:scan-room
      stream mapping allSelection
      (ssget "_X" '((0 . "TEXT,MTEXT"))) maxItems)
    (progn
      (setq index 0 written 0)
      (if allSelection
        (while (and (< index (sslength allSelection)) (< written maxItems))
          (setq entity (ssname allSelection index)
                data (entget entity))
          (if (acadstd:map-entity-p data mapping)
            (progn
              (acadstd:write-object stream mapping entity "")
              (setq written (1+ written))))
          (setq index (1+ index))))
      written)))

(defun acadstd:dim-axis (rotation / normalized tolerance)
  (setq normalized (rem (+ rotation (* 2.0 pi)) pi)
        tolerance 0.01745329252) ; one degree
  (cond
    ((or (< normalized tolerance) (> normalized (- pi tolerance))) "H")
    ((< (abs (- normalized (/ pi 2.0))) tolerance) "V")
    (T "A")))

(defun acadstd:scan-dimensions (stream maxItems / selection index entity data point rotation axis)
  (setq selection (ssget "_X" '((0 . "DIMENSION"))) index 0)
  (if selection
    (while (and (< index (sslength selection)) (< index maxItems))
      (setq entity (ssname selection index)
            data (entget entity)
            point (cdr (assoc 10 data))
            rotation
              (cond
                ((assoc 50 data) (cdr (assoc 50 data)))
                ((and (assoc 13 data) (assoc 14 data))
                  (angle (cdr (assoc 13 data)) (cdr (assoc 14 data))))
                (T 0.0))
            axis (acadstd:dim-axis rotation))
      (acadstd:line stream
        (list
          "DIM"
          (cdr (assoc 5 data))
          (cdr (assoc 8 data))
          (cdr (assoc 3 data))
          axis
          (if (= axis "V") (car point) (cadr point))
          rotation
          (if (assoc 42 data) (cdr (assoc 42 data)) 0.0)
          (if (assoc 1 data) (cdr (assoc 1 data)) "")))
      (setq index (1+ index))))
  index)

(defun acadstd:write-settings (stream / variable)
  (foreach variable
    '("INSUNITS" "LUNITS" "LUPREC" "AUNITS" "AUPREC" "MEASUREMENT"
      "DIMSTYLE" "DIMDEC" "DIMLFAC" "DIMSCALE" "DIMATFIT" "DIMTAD"
      "DIMJUST" "DIMANNO" "DIMTXT" "DIMTXSTY" "DIMCLRT" "DIMCLRD"
      "DIMCLRE" "DIMEXE" "DIMEXO" "DIMGAP" "DIMTMOVE" "DIMTOFL"
      "DIMTIH" "DIMTOH" "DIMBLK")
    (acadstd:line stream (list "SETTING" variable (getvar variable)))))

(defun acadstd:scan (output mappings maxItems / stream allSelection mapping count)
  (setq stream (open output "w"))
  (if (null stream)
    nil
    (progn
      (acadstd:line stream (list "ACAD_STANDARDS" "1"))
      (acadstd:write-settings stream)
      (acadstd:scan-dimensions stream maxItems)
      (setq allSelection (ssget "_X") count 0)
      (foreach mapping mappings
        (if (< count maxItems)
          (setq count
            (+ count
               (acadstd:scan-map
                 stream mapping allSelection (- maxItems count))))))
      (acadstd:line stream (list "END" count))
      (close stream)
      count)))

;;; ---------------------------------------------------------------- apply

(defun acadstd:ss-handles (handles / selection handle entity)
  (setq selection (ssadd))
  (foreach handle handles
    (if (and (= (type handle) 'STR) (setq entity (handent handle)))
      (ssadd entity selection)))
  selection)

(defun acadstd:remove-code (data code / output item)
  (setq output '())
  (foreach item data
    (if (/= (car item) code) (setq output (cons item output))))
  (reverse output))

(defun acadstd:model-selection ()
  (or (ssget "_X" '((410 . "Model"))) (ssget "_X")))

(defun acadstd:selection-handles (selection / handles index data)
  (setq handles '() index 0)
  (if selection
    (while (< index (sslength selection))
      (setq data (entget (ssname selection index)))
      (if (assoc 5 data)
        (setq handles (cons (cdr (assoc 5 data)) handles)))
      (setq index (1+ index))))
  (reverse handles))

(defun acadstd:ensure-layer (name color linetype lineweight)
  (acadstd:ensure-layer-rgb name color linetype lineweight nil))

;; `rgb` = mau that dong goi 24-bit (group 420), hoac nil.
;;
;; Doi so THEM chu khong doi chu ky ham cu: moi ho so hien co van di qua
;; `acadstd:ensure-layer` va sinh ra dung cac group code nhu truoc. Duong ap dung
;; nay ghi MOT PHA vao ban ve that va khong hoan tac duoc, nen mot thay doi arity
;; la thu khong duoc phep lam om.
;;
;; Quy tac cua AutoCAD: group 420 co mat thi no thang group 62. Hai chieu:
;;
;;   - Dat mau ACI phai XOA 420. Con sot lai thi mau ACI vua ghi khong co tac
;;     dung nao ca, va nguoi dung thay lenh "chay thanh cong" ma mau khong doi.
;;   - Dat mau that thi CHI ghi 420 va KHONG dung toi 62. 62 luc nay chi la mau
;;     du phong cho phan mem doc DWG khong hieu true color, nen ghi de len no
;;     khong duoc gi — trong khi giu nguyen thi giu duoc ca gia tri san co lan
;;     DAU cua no: 62 AM nghia la layer dang TAT. `subst` mot so duong vao do se
;;     BAT layer len, tuc doi mau lai lam hien ra thu nguoi dung da tat.
(defun acadstd:ensure-layer-rgb (name color linetype lineweight rgb / record data)
  (if (setq record (tblobjname "LAYER" name))
    (progn
      (setq data (entget record))
      (if (and (numberp color) (not (numberp rgb)))
        (setq data
          (if (assoc 62 data)
            ;; GIU DAU cua group 62. Dau AM nghia la layer dang TAT, va do la
            ;; mot trang thai NGUOI DUNG dat, khong phai thuoc tinh cua ho so
            ;; tieu chuan. `subst` thang mot so duong vao day se BAT layer len:
            ;; ap ho so mau sac lai lam hien ra thu ho da co y tat, tren duong
            ;; ghi mot pha khong hoan tac duoc.
            ;;
            ;; Ho so KHONG mang cot bat/tat, nen khong co gi de ghi de len trang
            ;; thai ay ca — giu nguyen la lua chon duy nhat dung.
            (subst
              (cons 62
                (if (minusp (cdr (assoc 62 data))) (- color) color))
              (assoc 62 data) data)
            (append data (list (cons 62 color))))))
      (if (numberp rgb)
        (setq data
          (if (assoc 420 data)
            (subst (cons 420 rgb) (assoc 420 data) data)
            (append data (list (cons 420 rgb)))))
        (if (assoc 420 data)
          (setq data (acadstd:remove-code data 420))))
      (if (and (= (type linetype) 'STR)
               (/= linetype "")
               (tblsearch "LTYPE" linetype))
        (setq data
          (if (assoc 6 data)
            (subst (cons 6 linetype) (assoc 6 data) data)
            (append data (list (cons 6 linetype))))))
      (if (numberp lineweight)
        (setq data
          (if (assoc 370 data)
            (subst (cons 370 lineweight) (assoc 370 data) data)
            (append data (list (cons 370 lineweight))))))
      (entmod data))
    (entmake
      (append
        (list
          '(0 . "LAYER")
          '(100 . "AcDbSymbolTableRecord")
          '(100 . "AcDbLayerTableRecord")
          (cons 2 name)
          '(70 . 0)
          (cons 62 (if (numberp color) color 7)))
        ;; Layer chua ton tai thi khong co 62 san de giu, nen 7 la mau du phong.
        (if (numberp rgb) (list (cons 420 rgb)) '())
        (if (and (= (type linetype) 'STR) (tblsearch "LTYPE" linetype))
          (list (cons 6 linetype))
          '())
        (if (numberp lineweight) (list (cons 370 lineweight)) '()))))
  name)

(defun acadstd:sync-layers (layers / layer)
  ;; layer = name color linetype lineweight required [rgb]
  ;;
  ;; `rgb` la doi so THU SAU va tuy chon: ho so khong dung mau that thi daemon
  ;; khong phat no, `nth 5` tra nil, va `ensure-layer-rgb` xoa group 420 — dung
  ;; hanh vi cu.
  (foreach layer layers
    (acadstd:ensure-layer-rgb
      (nth 0 layer) (nth 1 layer) (nth 2 layer) (nth 3 layer) (nth 5 layer)))
  (length layers))

(defun acadstd:scale (handles all factor base / selection)
  (setq selection
    (if all (acadstd:model-selection) (acadstd:ss-handles handles)))
  (if (and selection (> (sslength selection) 0) (numberp factor) (> factor 0.0))
    (progn
      (command "_.SCALE" selection "" (acadstd:point3 base) factor)
      (sslength selection))
    0))

(defun acadstd:rotate (handles angleDegrees base / selection)
  (setq selection (acadstd:ss-handles handles))
  (if (and selection (> (sslength selection) 0) (numberp angleDegrees))
    (progn
      (command "_.ROTATE" selection "" (acadstd:point3 base) angleDegrees)
      (sslength selection))
    0))

(defun acadstd:set-color (handles color / handle entity data changed)
  (setq changed 0)
  (foreach handle handles
    (if (and (setq entity (handent handle)) (setq data (entget entity)))
      (progn
        (if (assoc 420 data)
          (setq data (acadstd:remove-code data 420)))
        (setq data
          (if (assoc 62 data)
            (subst (cons 62 color) (assoc 62 data) data)
            (append data (list (cons 62 color)))))
        (if (entmod data) (setq changed (1+ changed))))))
  changed)

(defun acadstd:assign-layer (handles layer / handle entity data changed)
  (acadstd:ensure-layer layer 7 "Continuous" -3)
  (setq changed 0)
  (foreach handle handles
    (if (and (setq entity (handent handle)) (setq data (entget entity)))
      (progn
        (setq data
          (if (assoc 8 data)
            (subst (cons 8 layer) (assoc 8 data) data)
            (append data (list (cons 8 layer)))))
        (if (entmod data) (setq changed (1+ changed))))))
  changed)

(defun acadstd:set-units (insunits linearFormat precision)
  (setvar "INSUNITS" insunits)
  (setvar "LUNITS" linearFormat)
  (setvar "LUPREC" precision)
  T)

(defun acadstd:ensure-textstyle (name font widthFactor / record data)
  (if (setq record (tblobjname "STYLE" name))
    (progn
      (setq data (entget record))
      (if (and (/= font "") (assoc 3 data))
        (setq data (subst (cons 3 font) (assoc 3 data) data)))
      (if (assoc 41 data)
        (setq data (subst (cons 41 widthFactor) (assoc 41 data) data)))
      (entmod data))
    (command "_.-STYLE" name font "0" widthFactor "0" "_N" "_N" "_N"))
  name)

(defun acadstd:configure-dimstyle (name textStyle font widthFactor variables
                                  / variable)
  ;; The profile owns this text style, so font and width are synchronized too.
  (if (/= textStyle "")
    (acadstd:ensure-textstyle textStyle font widthFactor))
  (foreach variable variables
    (setvar (car variable) (cdr variable)))
  (if (and (/= textStyle "") (tblsearch "STYLE" textStyle))
    (setvar "DIMTXSTY" textStyle))
  ;; -DIMSTYLE asks for overwrite confirmation only when the name exists.
  (if (tblsearch "DIMSTYLE" name)
    (command "_.-DIMSTYLE" "_Save" name "_Yes")
    (command "_.-DIMSTYLE" "_Save" name))
  (command "_.-DIMSTYLE" "_Restore" name)
  name)

(defun acadstd:assign-dimstyle (handles style / handle entity data changed)
  (setq changed 0)
  (if (tblsearch "DIMSTYLE" style)
    (foreach handle handles
      (if (and (setq entity (handent handle))
               (setq data (entget entity))
               (= (cdr (assoc 0 data)) "DIMENSION"))
        (progn
          (setq data
            (if (assoc 3 data)
              (subst (cons 3 style) (assoc 3 data) data)
              (append data (list (cons 3 style)))))
          (if (entmod data)
            (progn (entupd entity) (setq changed (1+ changed))))))))
  changed)

(defun acadstd:dimspace (baseHandle handles spacing / base selection)
  (setq base (handent baseHandle)
        selection (acadstd:ss-handles handles))
  (if (and base selection (> (sslength selection) 0) (numberp spacing))
    (progn
      (command "_.DIMSPACE" base selection "" spacing)
      (sslength selection))
    0))

(defun acadstd:resize-frame (handle targetWidth targetHeight / entity data entityType bounds
                             minx miny width height sx sy item updated point)
  (setq entity (handent handle))
  (if (null entity)
    0
    (progn
      (setq data (entget entity)
            entityType (cdr (assoc 0 data))
            bounds (acadstd:entity-bounds data))
      (cond
        ((and (= entityType "LWPOLYLINE") bounds
              (> (- (nth 2 bounds) (nth 0 bounds)) 1e-9)
              (> (- (nth 3 bounds) (nth 1 bounds)) 1e-9))
          (setq minx (nth 0 bounds) miny (nth 1 bounds)
                width (- (nth 2 bounds) minx)
                height (- (nth 3 bounds) miny)
                sx (/ targetWidth width)
                sy (/ targetHeight height)
                updated '())
          (foreach item data
            (if (= (car item) 10)
              (progn
                (setq point (cdr item))
                (setq updated
                  (cons
                    (cons 10
                      (list
                        (+ minx (* (- (car point) minx) sx))
                        (+ miny (* (- (cadr point) miny) sy))))
                    updated)))
              (setq updated (cons item updated))))
          (if (entmod (reverse updated)) 1 0))
        (T 0)))))

(defun acadstd:select (handles / selection)
  (setq selection (acadstd:ss-handles handles))
  (sssetfirst nil selection)
  (sslength selection))

(defun acadstd:measure (output handles / stream handle entity data area total count)
  (setq stream (open output "w") total 0.0 count 0)
  (if stream
    (progn
      (acadstd:line stream (list "ACAD_AREA" "1"))
      (foreach handle handles
        (if (and (setq entity (handent handle)) (setq data (entget entity)))
          (progn
            (setq area (acadstd:entity-area data))
            (acadstd:line stream
              (list "AREA" handle (cdr (assoc 0 data)) (cdr (assoc 8 data)) area))
            (setq total (+ total area) count (1+ count)))))
      (acadstd:line stream (list "TOTAL" count total))
      (close stream)))
  total)

(princ)

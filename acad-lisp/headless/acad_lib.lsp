;;; ============================================================================
;;;  acad_lib.lsp — generic AutoLISP helpers for AutoCAD Toolkit headless
;;;  (AcCoreConsole / Mac). Domain-agnostic: layers, title, length, CSV I/O.
;;;
;;;  Plumbing-specific helpers remain in mep_lib.lsp (sample profile).
;;;  This file loads mep_lib for shared geometry/CSV primitives and adds
;;;  ACAD-* aliases for the control plane (no product identity "MEP").
;;; ============================================================================

(if (findfile "mep_lib.lsp")
  (load "mep_lib.lsp")
  ;; When loaded via absolute path from daemon, mep_lib sits beside this file.
  (progn
    (setq _acad_lib_dir
      (if (and *load-pathname* (= (type *load-pathname*) 'STR))
        (vl-filename-directory *load-pathname*)
        nil))
    (if (and _acad_lib_dir (findfile (strcat _acad_lib_dir "/mep_lib.lsp")))
      (load (strcat _acad_lib_dir "/mep_lib.lsp")))))

;; Generic aliases (control plane prefers these names)
(if (not (car (atoms-family 1 '("ACAD:LAYERS"))))
  (defun acad:layers (csv) (mep:layers csv)))
(if (not (car (atoms-family 1 '("ACAD:READ-TITLE"))))
  (defun acad:read-title (out)
    (if (car (atoms-family 1 '("MEP:READ-TITLE"))) (mep:read-title out) 0)))
(if (not (car (atoms-family 1 '("ACAD:SET-TITLE"))))
  (defun acad:set-title (kv)
    (if (car (atoms-family 1 '("MEP:SET-TITLE"))) (mep:set-title kv) nil)))

(princ "\n[ACAD] acad_lib loaded (generic headless helpers).")
(princ)

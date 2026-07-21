;;; ============================================================================
;;;  core.lsp — domain-agnostic AutoCAD Toolkit core commands
;;;
;;;  Load this for bridge + generic helpers. Plumbing/drawing profiles are
;;;  optional (see profiles/plumbing.lsp → historically mep.lsp).
;;;
;;;  Commands:
;;;    ACAD-RUN   — load ~/Acad-Bridge/job.lsp (or legacy mep_job.lsp)
;;;    ACAD-INIT  — create layers from optional config (stub → profile)
;;; ============================================================================

;; Bridge dir + ACAD-RUN (shared with mep.lsp for compatibility)
(defun acad:bridgedir ( / d primary legacy)
  (setq d (cond ((getenv "HOME")) ((getenv "USERPROFILE")) (".")))
  (if (and (> (strlen d) 0)
           (/= (substr d (strlen d)) "/") (/= (substr d (strlen d)) "\\"))
    (setq d (strcat d "/")))
  (setq primary (strcat d "Acad-Bridge/")
        legacy  (strcat d "MEP-Bridge/"))
  (cond
    ((vl-file-directory-p primary) primary)
    ((vl-file-directory-p legacy) legacy)
    (T primary)))

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
     (princ (strcat "\n[ACAD] Nap job: " p))
     (load p)
     (princ "\n[ACAD] Done."))
    (T (princ (strcat "\n[ACAD] Missing job file: " p))))
  (princ))

;; Generic init: only layer "0" + note — profiles override with domain layers
(defun c:ACAD-INIT ( / )
  (command "_.-LAYER" "_M" "0" "")
  (princ "\n[ACAD] ACAD-INIT: base layers ready (load profile for domain layers).")
  (princ))

(defun acad:trust ( / hp tp)
  (setq hp (getenv "HOME"))
  (if (and hp (= (type (getvar "TRUSTEDPATHS")) 'STR))
    (progn
      (setq tp (getvar "TRUSTEDPATHS"))
      (if (not (or (vl-string-search "Acad-Bridge" tp) (vl-string-search "MEP-Bridge" tp)))
        (setvar "TRUSTEDPATHS"
          (strcat tp ";" hp "/Acad-Bridge/...;" hp "/MEP-Bridge/...")))))
  (princ))
(acad:trust)

(princ "\n[ACAD] core.lsp ready. ACAD-RUN / ACAD-INIT. Bridge ~/Acad-Bridge/job.lsp")
(princ)

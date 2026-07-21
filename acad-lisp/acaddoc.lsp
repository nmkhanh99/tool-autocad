;;; acaddoc.lsp — auto-load on every drawing open (if on support path / Startup Suite)
;;; Loads domain-agnostic core (ACAD-RUN). Optional plumbing profile stays separate.
;;;
;;; App/daemon writes live jobs to ~/Acad-Bridge/job.lsp; AcadBridge plugin auto-runs,
;;; or type ACAD-RUN / MEP-RUN.

(if (findfile "core.lsp")
  (load "core.lsp")
  (if (findfile "mep.lsp")
    (load "mep.lsp")))

(princ "\n[ACAD] acaddoc: bridge ready — ACAD-RUN for ~/Acad-Bridge/job.lsp")
(princ)

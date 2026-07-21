;;; ============================================================================
;;;  profiles/plumbing.lsp — SAMPLE domain profile (drainage / supply pipes)
;;;
;;;  Not product identity. Product is AutoCAD Toolkit (domain-agnostic).
;;;  Load mep.lsp for full plumbing command set, or load this file as a thin
;;;  pointer:
;;; ============================================================================

(princ "\n[ACAD profile] plumbing sample — loading mep.lsp (MEP-INIT / mep-pipe / …)")
;; Resolve sibling: profiles/../mep.lsp
(if (findfile "mep.lsp")
  (load "mep.lsp")
  (princ "\n[ACAD profile] mep.lsp not on support path — APPLOAD acad-lisp/mep.lsp manually."))
(princ)

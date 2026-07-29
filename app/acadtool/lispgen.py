"""Sinh script AutoLISP để GHI vào bản vẽ đang mở trong AutoCAD (Mac/Win).

AutoLISP ghi attribute native nên không có rủi ro round-trip làm hỏng dữ liệu. Người dùng nạp .lsp
(APPLOAD) rồi gõ lệnh; script tự nhận bản vẽ hiện tại theo tên file và điền đúng.
"""
from __future__ import annotations

from pathlib import Path

from .model import Drawing
from .titleblock import gen_khbv


def _esc(s: str) -> str:
    """Escape chuỗi cho AutoLISP."""
    return s.replace("\\", "\\\\").replace('"', '\\"')


def build_titlefix_lisp(
    drawings: list[Drawing],
    common: dict[str, str] | None = None,
) -> str:
    """Tạo nội dung .lsp: lệnh MEPFIX điền khung tên theo từng file.

    common: trường áp cho MỌI sheet (vd {"DD/MM/YYYY": "22/06/2026"}).
    Mỗi sheet luôn có KHBV chuẩn sinh từ tên file (nếu suy ra được).
    """
    common = common or {}
    records = []
    for d in drawings:
        fields: dict[str, str] = dict(common)
        khbv = gen_khbv(d.name)
        if khbv:
            fields["KHBV"] = khbv
        if not fields:
            continue
        pairs = " ".join(f'(cons "{_esc(k)}" "{_esc(v)}")' for k, v in fields.items())
        records.append(f'    (list "{_esc(d.name)}" {pairs})')

    data = "\n".join(records)
    return f""";;; MEPFIX — điền/sửa khung tên cho bản vẽ đang mở (sinh tự động bởi acadtool)
;;; Cách dùng: APPLOAD file này -> gõ MEPFIX. Tự nhận bản vẽ theo tên file.
(setq *MEPFIX-DATA*
  (list
{data}
  )
)

(defun mepfix:set-attrs (blk fields / ent tag val)
  ;; blk: ename của INSERT; fields: alist (TAG . VALUE)
  (setq ent (entnext blk))
  (while (and ent (= "ATTRIB" (cdr (assoc 0 (entget ent)))))
    (setq tag (strcase (cdr (assoc 2 (entget ent)))))
    (setq val (assoc tag (mapcar '(lambda (p) (cons (strcase (car p)) (cdr p))) fields)))
    (if val
      (progn
        (entmod (subst (cons 1 (cdr val)) (assoc 1 (entget ent)) (entget ent)))
        (entupd ent)
      )
    )
    (setq ent (entnext ent))
  )
)

(defun c:MEPFIX ( / dwg rec ss i blk eg has)
  (setq dwg (vl-filename-base (getvar "DWGNAME")))
  (setq rec (assoc dwg *MEPFIX-DATA*))
  (if (null rec)
    (princ (strcat "\\nKhong co du lieu cho ban ve: " dwg))
    (progn
      (setq ss (ssget "X" '((0 . "INSERT") (66 . 1))))  ; INSERT co attribute
      (if ss
        (progn
          (setq i 0)
          (while (< i (sslength ss))
            (setq blk (ssname ss i))
            ;; chi sua block khung ten: co attrib tag KHBV
            (setq has (mepfix:has-tag blk "KHBV"))
            (if has (mepfix:set-attrs blk (cdr rec)))
            (setq i (1+ i))
          )
          (princ (strcat "\\nDa cap nhat khung ten: " dwg))
        )
        (princ "\\nKhong tim thay block co attribute.")
      )
    )
  )
  (princ)
)

(defun mepfix:has-tag (blk tag / ent found)
  (setq ent (entnext blk) tag (strcase tag) found nil)
  (while (and ent (= "ATTRIB" (cdr (assoc 0 (entget ent)))))
    (if (= tag (strcase (cdr (assoc 2 (entget ent))))) (setq found T))
    (setq ent (entnext ent))
  )
  found
)
(princ "\\nDa nap MEPFIX. Go MEPFIX de dien khung ten ban ve dang mo.")
(princ)
"""


def write_titlefix_lisp(
    path: str | Path,
    drawings: list[Drawing],
    common: dict[str, str] | None = None,
) -> Path:
    out = Path(path)
    out.write_text(build_titlefix_lisp(drawings, common), encoding="utf-8")
    return out

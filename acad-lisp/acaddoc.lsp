;;; ============================================================================
;;;  acaddoc.lsp — AutoCAD tự NẠP file này MỖI khi mở/tạo bản vẽ (không cần APPLOAD).
;;;  Đặt file này + mep.lsp vào một thư mục nằm trong "Support File Search Path"
;;;  của AutoCAD (Preferences > Application > Support File Search Path > Add...),
;;;  và Trust thư mục đó (lệnh TRUSTEDPATHS) để khỏi hỏi SECURELOAD.
;;;
;;;  Mục đích: luôn có sẵn lệnh MEP-RUN (và bộ lệnh MEP) trong mọi bản vẽ →
;;;  app MEP Studio ghi job vào ~/MEP-Bridge/mep_job.lsp, bạn chỉ cần gõ MEP-RUN
;;;  (hoặc bấm nút) để chạy — KHÔNG cần quyền Accessibility, không kẹt bộ gõ.
;;; ============================================================================
(if (findfile "mep.lsp")
  (load "mep.lsp")
  (princ "\n[MEP] Khong thay mep.lsp trong support path."))
(princ "\n[MEP] San sang. Go  MEP-RUN  de chay job tu app MEP Studio.")
(princ)

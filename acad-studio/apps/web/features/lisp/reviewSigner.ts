"use client";

/** Môi trường đang chạy có ký duyệt được không.
 *
 * App desktop phơi `window.acadStudio.signReview` qua preload; trình duyệt
 * thường không có nó. Đây là **điều kiện cần**, không phải điều kiện đủ: daemon
 * còn phải được chính app desktop khởi chạy thì mới có
 * `ACAD_REVIEW_PUBLIC_KEY` để kiểm chữ ký. Phía client không nhìn thấy biến môi
 * trường của daemon, nên chỗ này chỉ trả lời được nửa câu hỏi — và giao diện
 * phải nói đúng nửa ấy chứ không kết luận thay.
 *
 * Ba trạng thái, không phải hai. `unknown` tồn tại vì lần render đầu tiên chạy
 * trên máy chủ (`output: "export"` prerender) rồi hydrate lại: đoán "không có
 * signer" ngay từ đầu sẽ khiến app desktop hiện một câu SAI trong khoảnh khắc
 * đầu — đúng thứ màn hình này tồn tại để tránh.
 */
import { useEffect, useState } from "react";

export type SignerState = "unknown" | "present" | "absent";

type SignerWindow = {
  acadStudio?: { signReview?: unknown };
};

export function useReviewSigner(): SignerState {
  const [state, setState] = useState<SignerState>("unknown");

  useEffect(() => {
    const shell = (window as unknown as SignerWindow).acadStudio;
    setState(typeof shell?.signReview === "function" ? "present" : "absent");
  }, []);

  return state;
}

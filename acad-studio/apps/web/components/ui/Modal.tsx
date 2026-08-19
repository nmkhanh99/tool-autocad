"use client";

/** Hộp thoại chặn.
 *
 * Ba thứ bắt buộc mà một `<div>` tự chế hay quên, và thiếu cái nào cũng khiến
 * người dùng bàn phím kẹt lại: Escape đóng được, focus không đi ra ngoài hộp
 * thoại, và focus quay về chỗ cũ khi đóng.
 */
import { useEffect, useRef, type ReactNode } from "react";

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]),' +
  ' textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Modal({ title, sub, wide = false, footer, onClose, children }: {
  title: string;
  sub?: string;
  wide?: boolean;
  footer?: ReactNode;
  onClose: () => void;
  children?: ReactNode;
}) {
  const box = useRef<HTMLDivElement>(null);
  /* Gương của `onClose`. Hiệu ứng dưới đây ĐẶT LẠI focus mỗi lần nó chạy, nên
     nó chỉ được chạy đúng một lần cho mỗi lượt mở. Nhưng nơi gọi hầu như luôn
     truyền một arrow mới mỗi lượt render — `onClose={() => …}` — nên để `onClose`
     trong deps là: cha render lại (một nhịp đồng hồ, một lượt nạp về) → hiệu ứng
     dọn rồi chạy lại → focus bị giật về ô đầu tiên. Người dùng đang dùng bàn
     phím thì không tới được nút xác nhận. */
  const closeRef = useRef(onClose);
  useEffect(() => { closeRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const returnTo = document.activeElement as HTMLElement | null;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab" || !box.current) return;
      const items = [...box.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    box.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      returnTo?.focus?.();
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div ref={box} className={wide ? "modal modal--wide" : "modal"} role="dialog" aria-modal="true">
        <header>
          <h2>{title}</h2>
          {sub ? <p>{sub}</p> : null}
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer>{footer}</footer> : null}
      </div>
    </div>
  );
}

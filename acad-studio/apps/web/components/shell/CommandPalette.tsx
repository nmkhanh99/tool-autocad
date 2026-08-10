"use client";

/** Bảng lệnh ⌘K.
 *
 * Chỉ điều hướng và mở nhật ký. Không lệnh nào ghi vào bản vẽ — một lệnh ghi
 * luôn phải dừng ở "Thay đổi chờ duyệt" trước, và một bảng lệnh gõ-là-chạy đi
 * ngược hẳn nguyên tắc đó.
 *
 * Lệnh trỏ tới màn hình chưa dựng vẫn hiện nhưng không chọn được, kèm lý do —
 * ẩn đi thì người dùng tìm mãi không thấy và tưởng mình nhớ nhầm.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { COMMANDS, NAV } from "./nav";

const BUILT_ROUTES = new Set(NAV.flatMap((g) => g.items).filter((i) => i.built).map((i) => i.href));

function isAvailable(href?: string): boolean {
  return !href || BUILT_ROUTES.has(href);
}

export function CommandPalette({ open, onClose, onOpenDrawer }: {
  open: boolean;
  onClose: () => void;
  onOpenDrawer: () => void;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return COMMANDS.filter((c) =>
      !q || c.label.toLowerCase().includes(q) || c.cmd.toLowerCase().includes(q));
  }, [query]);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActive(0);
    inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); onClose(); return; }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((i) => Math.min(i + 1, shown.length - 1));
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
      } else if (event.key === "Enter") {
        event.preventDefault();
        run(shown[active]);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  });

  function run(command?: (typeof COMMANDS)[number]) {
    if (!command || !isAvailable(command.href)) return;
    onClose();
    if (command.drawer) { onOpenDrawer(); return; }
    if (command.href) router.push(command.href);
  }

  if (!open) return null;

  return (
    <div
      className="palette-backdrop"
      onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}
    >
      <div className="palette" role="dialog" aria-modal="true" aria-label="Bảng lệnh">
        <input
          ref={inputRef}
          type="text"
          value={query}
          placeholder="Đi tới màn hình hoặc mở nhật ký…"
          aria-label="Tìm lệnh"
          onChange={(event) => { setQuery(event.target.value); setActive(0); }}
        />
        <ul>
          {shown.length === 0 ? (
            <li data-active="false" style={{ color: "var(--muted)" }}>Không có mục khớp</li>
          ) : shown.map((command, index) => {
            const available = isAvailable(command.href);
            return (
              <li
                key={command.cmd}
                data-active={index === active}
                aria-disabled={!available}
                onMouseEnter={() => setActive(index)}
                onClick={() => run(command)}
              >
                <span>{command.label}</span>
                <span className="cmd">{available ? command.cmd : "chưa dựng"}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

"use client";

/** Nhật ký hoạt động — các sự kiện AutoCAD đã xảy ra TRONG PHIÊN NÀY.
 *
 * Không phải kho lịch sử. Daemon không lưu sự kiện xuống đĩa, nên đóng tab là
 * mất; banner nói thẳng điều đó thay vì để người dùng tưởng mình tra cứu được
 * việc hôm qua.
 */
import { useEffect, useRef, useState } from "react";
import { Button } from "../ui/Button";
import { Icon } from "../ui/icons";
import { useAcadEvents, type AcadEvent } from "../../features/acad-connection/events";

const MAX_ROWS = 200;

export function ActivityDrawer({ daemon, open, onClose }: {
  daemon: string;
  open: boolean;
  onClose: () => void;
}) {
  const [rows, setRows] = useState<AcadEvent[]>([]);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useAcadEvents(daemon, (event) => {
    setRows((previous) => [event, ...previous].slice(0, MAX_ROWS));
  });

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); closeRef.current(); }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="drawer-backdrop"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <aside className="drawer" role="dialog" aria-modal="true" aria-label="Nhật ký hoạt động">
        <header>
          <h2>Nhật ký hoạt động</h2>
          <Button variant="quiet" icon onClick={onClose} title="Đóng"><Icon name="close" /></Button>
        </header>
        <p className="hint" style={{ padding: "0 var(--s4) var(--s3)" }}>
          Sự kiện của phiên này. App không lưu lịch sử — đóng tab là mất.
        </p>
        <div className="drawer-body">
          {rows.length === 0
            ? <div className="statebox"><p className="hint">Chưa có sự kiện nào từ AutoCAD.</p></div>
            : rows.map((row, i) => (
                <div className="logrow" key={`${row.at}-${i}`}>
                  <span className="mono">{new Date(row.at * 1000).toLocaleTimeString("vi-VN")}</span>
                  <span><b>{row.type}</b>{row.detail ? ` · ${row.detail}` : ""}</span>
                  <span className="hint">{row.activeDoc}</span>
                </div>
              ))}
        </div>
      </aside>
    </div>
  );
}

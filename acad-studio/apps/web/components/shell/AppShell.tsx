"use client";

/** Khung chung của mọi màn hình trong `app/(shell)/`.
 *
 * Nó ghi bốn attribute lên `<body>`, vì CSS của bộ mẫu gate mọi thứ ở đó:
 * `data-ds` bật design system, `data-rail` quyết định bề rộng thanh điều hướng,
 * `data-acad` khoá lệnh ghi, `data-screen` để test biết ai đang phục vụ route.
 *
 * Cả bốn **phải được gỡ khi unmount**. `app/page.tsx` legacy vẫn sống tới giai
 * đoạn 8 và dùng hệ CSS khác; điều hướng từ shell về đó mà còn sót `data-ds` là
 * nền sáng đè lên màn hình tối, còn sót `data-acad="off"` là mười quy tắc khoá
 * lệnh ghi treo lơ lửng trên một trang không liên quan.
 *
 * Không chuyển các selector này sang `.app[data-…]` cho "sạch kiểu React":
 * làm vậy là fork khỏi CSS của mẫu và mất đường đồng bộ về sau.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ActivityDrawer } from "./ActivityDrawer";
import { CommandPalette } from "./CommandPalette";
import { Rail } from "./Rail";
import { Statusbar } from "./Statusbar";
import { Titlebar } from "./Titlebar";
import { useRail } from "./useRail";
import { useAcadState } from "../../features/acad-connection/useAcadState";
import { AcadStateProvider } from "../../features/acad-connection/WriteButton";
import { useStagedOps } from "../../features/staged-ops/store";
import { fetchDocs, type AcadDocument } from "../../lib/daemon/docs";
import { DAEMON_BASE } from "../../lib/daemon/endpoints";
import { useAcadEvents } from "../../features/acad-connection/events";

export function AppShell({ screen, title, sub, actions, children }: {
  /** Khớp `id` trong NAV — quyết định mục nào sáng ở rail. */
  screen: string;
  title: string;
  sub?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const rail = useRail();
  const acad = useAcadState(DAEMON_BASE);
  const staged = useStagedOps();
  const [docs, setDocs] = useState<AcadDocument[]>([]);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const reloadDocs = useCallback(() => {
    fetchDocs(DAEMON_BASE).then((snapshot) => setDocs(snapshot.docs)).catch(() => setDocs([]));
  }, []);

  useEffect(reloadDocs, [reloadDocs]);
  // Nạp lại danh sách bản vẽ khi có BẤT KỲ thay đổi nào ảnh hưởng tới nó.
  // Chỉ nghe `doc*` là không đủ: người dùng sửa bản vẽ phát `drawingModified`,
  // lưu xong phát `drawingSaved` — bỏ hai cái đó thì chấm "chưa lưu" treo ở
  // trạng thái cũ cho tới lần mở/đóng bản vẽ tiếp theo.
  useAcadEvents(DAEMON_BASE, (event) => {
    if (
      event.type.startsWith("doc") ||
      event.type === "drawingModified" ||
      event.type === "drawingSaved" ||
      event.type === "pluginLoaded"
    ) reloadDocs();
  });

  // Bốn attribute + dọn dẹp. Xem lý do ở đầu file.
  useEffect(() => {
    const body = document.body;
    body.dataset.ds = "1";
    body.dataset.screen = screen;
    return () => {
      delete body.dataset.ds;
      delete body.dataset.screen;
      delete body.dataset.rail;
      delete body.dataset.acad;
    };
  }, [screen]);

  // Chỉ ghi SAU khi useRail đã đọc xong lựa chọn đã lưu. Trước đó, giá trị do
  // script chống nháy đặt là giá trị đúng — ghi đè sớm là tự tạo lại cú nháy.
  useEffect(() => {
    if (rail.synced) document.body.dataset.rail = rail.state;
  }, [rail.synced, rail.state]);
  useEffect(() => { document.body.dataset.acad = acad.state; }, [acad.state]);

  // ⌘K mở bảng lệnh, ⌘B thu/mở rail. Bỏ qua khi con trỏ đang ở ô nhập liệu —
  // người dùng gõ ⌘B trong một textarea là muốn in đậm, không muốn đổi bố cục.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key !== "k" && key !== "b") return;

      const target = event.target as HTMLElement | null;
      const typing = !!target?.closest?.("input, textarea, select, [contenteditable='true']");
      if (typing && key === "b") return;

      event.preventDefault();
      if (key === "k") setPaletteOpen((open) => !open);
      else rail.toggle();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [rail]);

  return (
    <AcadStateProvider state={acad.state}>
      {/* `data-screen` cũng đặt trên phần tử gốc, không chỉ trên <body>: bản
          đóng gói là HTML tĩnh, và `scripts/test-route-serving.mjs` phải đọc
          được mốc này TRƯỚC khi React chạy để biết daemon đang phục vụ route
          nào. Đặt trên body qua effect thì HTML tĩnh không mang mốc nào cả.
          CSS không dùng selector này (đã kiểm), nên không có tác dụng phụ. */}
      <div className="app" data-screen={screen}>
        <Titlebar
          docs={docs}
          acadState={acad.state}
          pending={staged.pending}
          railLocked={rail.locked}
          railExpanded={rail.state === "expanded"}
          onToggleRail={rail.toggle}
          onOpenPalette={() => setPaletteOpen(true)}
          onOpenDrawer={() => setDrawerOpen(true)}
        />

        <div className="body">
          <Rail screen={screen} pending={staged.pending} />

          <main className="main">
            <div className="pagehead">
              <div>
                <h1>{title}</h1>
                {sub ? <div className="sub">{sub}</div> : null}
              </div>
              {actions ? <div className="actions">{actions}</div> : null}
            </div>
            <div className="scroll">{children}</div>
          </main>
        </div>

        <Statusbar acadState={acad.state} />

        <CommandPalette
          open={paletteOpen}
          onClose={() => setPaletteOpen(false)}
          onOpenDrawer={() => setDrawerOpen(true)}
        />
        <ActivityDrawer daemon={DAEMON_BASE} open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      </div>
    </AcadStateProvider>
  );
}

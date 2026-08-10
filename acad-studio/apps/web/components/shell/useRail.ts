"use client";

/** Thu/mở thanh điều hướng — ba đầu vào, một kết quả.
 *
 *   1. lựa chọn đã lưu của người dùng — thắng ở bề rộng bình thường;
 *   2. bề rộng cửa sổ — quyết định mặc định khi chưa có lựa chọn;
 *   3. ngưỡng 900px — dưới mức này không đủ chỗ cho nhãn, thu gọn bất kể.
 *
 * Điểm đáng chú ý: dưới 900px nút bấm bị **vô hiệu hoá và nói rõ lý do** thay
 * vì bấm mà không thấy gì xảy ra. Một nút im lặng không phản ứng luôn bị hiểu
 * là app hỏng.
 */
import { useCallback, useEffect, useState } from "react";
import { STORAGE_KEYS, readText, writeText } from "../../lib/storage";

export type RailState = "expanded" | "collapsed";

const LOCK_WIDTH = 900;
const DEFAULT_COLLAPSE_WIDTH = 1240;

export function resolveRail(width: number, saved: string | null): RailState {
  if (width < LOCK_WIDTH) return "collapsed";
  if (saved === "collapsed" || saved === "expanded") return saved;
  return width < DEFAULT_COLLAPSE_WIDTH ? "collapsed" : "expanded";
}

export function useRail() {
  // Khởi tạo "expanded" để HTML máy chủ và lần render đầu phía client khớp nhau.
  // Giá trị THẬT nằm trên `body[data-rail]`, do script chống nháy trong
  // app/layout.tsx đặt trước lần vẽ đầu tiên.
  //
  // `synced` là lý do cả cơ chế này hoạt động: chừng nào chưa đồng bộ, KHÔNG ai
  // được ghi đè `data-rail`. Ghi "expanded" vào đó trước khi `sync()` chạy sẽ
  // tạo ra đúng cú nháy thu → mở → thu mà script sinh ra để tránh.
  const [state, setState] = useState<RailState>("expanded");
  const [locked, setLocked] = useState(false);
  const [synced, setSynced] = useState(false);

  const sync = useCallback(() => {
    const width = window.innerWidth;
    setState(resolveRail(width, readText(STORAGE_KEYS.rail)));
    setLocked(width < LOCK_WIDTH);
    setSynced(true);
  }, []);

  useEffect(() => {
    sync();
    window.addEventListener("resize", sync);
    return () => window.removeEventListener("resize", sync);
  }, [sync]);

  const toggle = useCallback(() => {
    if (window.innerWidth < LOCK_WIDTH) return;
    const next: RailState = resolveRail(window.innerWidth, readText(STORAGE_KEYS.rail)) === "expanded"
      ? "collapsed"
      : "expanded";
    writeText(STORAGE_KEYS.rail, next);
    sync();
  }, [sync]);

  const toggleTitle = locked
    ? "Màn hình quá hẹp để mở rộng thanh điều hướng"
    : state === "expanded"
      ? "Thu gọn thanh điều hướng (⌘B)"
      : "Mở rộng thanh điều hướng (⌘B)";

  return { state, locked, synced, toggle, toggleTitle };
}

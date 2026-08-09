"use client";

/** MỘT EventSource cho toàn app.
 *
 * Plugin AcadBridge phát sự kiện reactor về daemon, daemon đẩy tiếp qua SSE.
 * Trước đây `app/page.tsx` tự mở `EventSource` và gọi tới bảy `setState` cho
 * mỗi sự kiện — mà cả bảy đều nằm trong component gốc, nên mỗi lần AutoCAD nhúc
 * nhích là re-render cả cây gồm bảy panel đang mount.
 *
 * Bus này giữ danh sách listener trong một `Set` ở cấp module, không trong
 * state. Mỗi màn hình tự đăng ký cái nó quan tâm và chỉ nó re-render. Hôm nay
 * mới có một subscriber (`page.tsx`) nên chưa thấy lợi; cái lợi đến khi từng
 * panel được migrate sang route và tự đăng ký thay vì nhận `refreshToken` qua
 * props.
 *
 * EventSource được đếm tham chiếu: mở khi có listener đầu tiên, đóng khi
 * listener cuối rời đi. Nhiều màn hình cùng nghe vẫn chỉ một kết nối.
 */
import { useEffect, useRef } from "react";
import { endpoints } from "../../lib/daemon/endpoints";

export type AcadEvent = {
  /** `doc*`, `drawingModified`, `pluginLoaded`, … */
  type: string;
  /** Đường dẫn bản vẽ đang hoạt động lúc sự kiện xảy ra. Có thể rỗng. */
  activeDoc: string;
  detail: string;
  /** Giây epoch. Daemon lúc gửi mili giây, lúc gửi giây — đã chuẩn hoá. */
  at: number;
};

type Listener = (event: AcadEvent) => void;

type Bus = { source: EventSource; listeners: Set<Listener> };

const buses = new Map<string, Bus>();

/** Daemon gửi `t` khi thì mili giây khi thì giây. Mốc 1e12 nằm giữa hai thang
 * (năm 2001 tính bằng giây so với năm 1970 tính bằng mili giây) nên phân biệt
 * được an toàn. Không có `t` hợp lệ thì lấy giờ máy — thà lệch vài mili giây
 * còn hơn coi sự kiện là "từ năm 1970" rồi bỏ qua nó. */
function secondsOf(raw: unknown): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return Date.now() / 1_000;
  return value >= 1_000_000_000_000 ? value / 1_000 : value;
}

function busFor(daemon: string): Bus {
  const existing = buses.get(daemon);
  if (existing) return existing;

  const listeners = new Set<Listener>();
  const source = new EventSource(endpoints.acadEvents(daemon));
  source.onmessage = (message) => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(message.data);
    } catch {
      return; // daemon gửi khung không phải JSON — bỏ qua, không làm hỏng stream
    }
    const event: AcadEvent = {
      type: String(parsed.type || ""),
      activeDoc: String(parsed.activeDoc || ""),
      detail: String(parsed.detail || ""),
      at: secondsOf(parsed.t),
    };
    // Một listener ném lỗi không được làm câm các listener còn lại.
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        /* lỗi của subscriber là việc của subscriber */
      }
    }
  };
  source.onerror = () => {
    /* daemon restart — EventSource tự reconnect, không cần làm gì */
  };

  const bus: Bus = { source, listeners };
  buses.set(daemon, bus);
  return bus;
}

/** Đăng ký ngoài React (test, module không phải component). Trả hàm huỷ.
 *
 * Mỗi lần gọi là một đăng ký ĐỘC LẬP, kể cả khi truyền vào cùng một hàm. `Set`
 * khoá theo identity, nên nếu thêm thẳng `listener` thì đăng ký lần hai không
 * tạo entry mới, và hàm huỷ của người này sẽ gỡ đăng ký của người kia rồi đóng
 * luôn kết nối chung. Bọc mỗi lần đăng ký trong một wrapper riêng để hai bên
 * không giẫm chân nhau.
 */
export function subscribeAcadEvents(daemon: string, listener: Listener): () => void {
  const bus = busFor(daemon);
  const entry: Listener = (event) => listener(event);
  bus.listeners.add(entry);

  let active = true;
  return () => {
    if (!active) return; // huỷ hai lần không được tính là hai lần rời đi
    active = false;
    bus.listeners.delete(entry);
    if (bus.listeners.size > 0) return;
    bus.source.close();
    // Chỉ xoá nếu bus trong bảng vẫn đúng là bus này: giữa lúc đăng ký và lúc
    // huỷ có thể đã có người mở một bus mới cho cùng daemon.
    if (buses.get(daemon) === bus) buses.delete(daemon);
  };
}

/** Nghe sự kiện AutoCAD. `listener` được đọc qua ref nên component không cần
 * memo hoá nó — đổi closure giữa chừng không mở lại kết nối. */
export function useAcadEvents(daemon: string, listener: Listener): void {
  const latest = useRef(listener);
  latest.current = listener;

  useEffect(() => {
    if (!daemon) return;
    return subscribeAcadEvents(daemon, (event) => latest.current(event));
  }, [daemon]);
}

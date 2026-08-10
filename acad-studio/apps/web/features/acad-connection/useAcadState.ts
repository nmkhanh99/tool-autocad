"use client";

/** Sáu trạng thái kết nối AutoCAD mà toàn bộ shell dựa vào.
 *
 * Đây là thứ quyết định nút ghi có bấm được không, nên nó phải nói THẬT. Trạng
 * thái được suy từ hai endpoint có sẵn, không bịa thêm cái nào:
 *
 *   /api/acad/status → { app, running, busy }   ← `busy` do daemon tự tính
 *   /api/acad/docs   → { running, alive }        ← `alive` = plugin có trả lời
 *
 * ⚠️ Một giới hạn phải nói rõ: daemon **không phân biệt** "chưa nạp plugin" với
 * "plugin đã nạp nhưng ngừng trả lời" — cả hai đều chỉ ra `alive: false`. Bộ
 * mẫu thiết kế lại vẽ chúng thành hai trạng thái khác nhau vì lối thoát khác
 * nhau (gõ APPLOAD, so với khởi động lại AutoCAD).
 *
 * Cách phân biệt ở đây là một HEURISTIC trong phạm vi phiên làm việc: nếu phiên
 * này đã từng thấy plugin trả lời rồi sau đó im, đó là `mute`; chưa từng thấy
 * thì báo `no-plugin` — lối thoát rẻ hơn và đúng trong đa số trường hợp. Tải
 * lại trang sẽ đưa suy đoán về `no-plugin`. Muốn phân biệt thật thì daemon phải
 * trả thêm dấu hiệu plugin đã từng nạp; ghi trong ROADMAP.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { daemonJson } from "../../lib/daemon/client";
import { endpoints } from "../../lib/daemon/endpoints";
import { useAcadEvents } from "./events";

import { type AcadState } from "../../lib/acadState";
export { ACAD_STATE_LABEL, canWrite, type AcadState } from "../../lib/acadState";

type StatusPayload = {
  app?: string | null;
  running?: boolean;
  /** Daemon tự tính. KHÔNG suy từ `activeJob`: bản ghi job cuối cùng được giữ
   * lại để `/job/:id` còn tra được, nên "có activeJob" không đồng nghĩa "đang
   * bận" — suy nhầm là mọi nút ghi bị khoá vĩnh viễn sau job đầu tiên. */
  busy?: boolean;
};
type DocsPayload = { running?: boolean; alive?: boolean };

export type AcadConnection = {
  state: AcadState;
  /** Chưa đọc xong lần đầu. Khác với `off`: chưa biết, không phải đã biết là tắt. */
  loading: boolean;
  refresh: () => void;
};

export function useAcadState(daemon: string): AcadConnection {
  const [state, setState] = useState<AcadState>("off");
  const [loading, setLoading] = useState(true);
  /** Phiên này đã từng thấy plugin trả lời chưa — xem ghi chú heuristic ở đầu file. */
  const sawPlugin = useRef(false);
  /** Số thứ tự lần đọc. Nhịp 15 giây và lần đọc do sự kiện kích hoạt có thể
   * chồng nhau và về KHÔNG theo thứ tự gửi đi; kết quả cũ ghi đè kết quả mới
   * nghĩa là pill có thể quay lại "đã nối" sau khi AutoCAD đã tắt, và nút ghi
   * mở lại cho tới nhịp sau. */
  const latestRead = useRef(0);

  const read = useCallback(async () => {
    const seq = ++latestRead.current;
    const stale = () => seq !== latestRead.current;
    try {
      const [status, docs] = await Promise.all([
        daemonJson<StatusPayload>(await fetch(endpoints.acadStatus(daemon), { cache: "no-store" })),
        daemonJson<DocsPayload>(await fetch(endpoints.docs(daemon), { cache: "no-store" })),
      ]);

      if (stale()) return;
      if (docs.alive === true) sawPlugin.current = true;

      if (!status.app) setState("missing");
      else if (!status.running) setState("off");
      else if (status.busy === true) setState("busy");
      else if (docs.alive === true) setState("on");
      else setState(sawPlugin.current ? "mute" : "no-plugin");
    } catch {
      // Không gọi được daemon thì AutoCAD chắc chắn không điều khiển được.
      // Báo `off` chứ không giữ trạng thái cũ: một pill nói "đã nối" trong khi
      // không có đường nào tới AutoCAD là lời nói dối nguy hiểm nhất ở đây.
      if (!stale()) setState("off");
    } finally {
      if (!stale()) setLoading(false);
    }
  }, [daemon]);

  useEffect(() => { void read(); }, [read]);

  // Nhịp chậm để bắt được việc người dùng mở/đóng AutoCAD ngoài app. Sự kiện
  // reactor bên dưới lo phần phản ứng nhanh; đây chỉ là lưới an toàn.
  useEffect(() => {
    const timer = setInterval(() => { void read(); }, 15_000);
    return () => clearInterval(timer);
  }, [read]);

  // Plugin nạp hay bản vẽ mở/đóng đều đổi trạng thái ngay, không đợi nhịp.
  useAcadEvents(daemon, (event) => {
    if (event.type === "pluginLoaded" || event.type.startsWith("doc")) void read();
  });

  return { state, loading, refresh: () => void read() };
}

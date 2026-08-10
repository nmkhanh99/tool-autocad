"use client";

/** Đọc hình học của bản vẽ đang mở.
 *
 * **Không tự động tải lại.** Mỗi lượt đọc là một lượt quét trên main thread của
 * AutoCAD — bản vẽ lớn làm AutoCAD đứng hình trong lúc chạy. Một hook tự làm
 * mới theo nhịp, hay tải lại mỗi khi có sự kiện reactor, sẽ biến màn hình này
 * thành thứ khiến AutoCAD giật liên tục trong khi người dùng đang vẽ. Nên: đọc
 * một lần lúc mở, và chỉ đọc lại khi người dùng bấm.
 *
 * Hệ quả phải nói ra ở giao diện: dữ liệu là **ảnh chụp tại một thời điểm**.
 * `collectedAt` và nút tải lại tồn tại để nói đúng điều đó, thay vì để người
 * dùng tin khung xem đang bám theo bản vẽ.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { daemonFailureText, daemonRecord } from "../../lib/daemon/client";
import { endpoints } from "../../lib/daemon/endpoints";
import type { GeometryResponse } from "./model";

export type GeometryState = {
  data: GeometryResponse | null;
  /** Lượt đọc đầu tiên chưa xong. Khác với "bản vẽ rỗng". */
  loading: boolean;
  /** Đang đọc lại trong khi vẫn còn dữ liệu cũ trên màn hình. */
  refreshing: boolean;
  error: string;
  reload: () => void;
};

export function useGeometry(daemon: string): GeometryState {
  const [data, setData] = useState<GeometryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  /* Lượt đọc mất vài giây. Bấm tải lại hai lần thì lượt cũ có thể về sau lượt
     mới và ghi đè bằng dữ liệu cũ hơn — trên màn hình này nghĩa là vẽ lại một
     bản vẽ đã lỗi thời mà không có dấu hiệu gì. */
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++sequence.current;
    const stale = () => ticket !== sequence.current;
    setError("");
    setRefreshing(true);

    try {
      const body = await daemonRecord(
        await fetch(endpoints.geometry(daemon), { cache: "no-store" }),
      );
      if (stale()) return;
      setData(body as GeometryResponse);
    } catch (failure) {
      if (stale()) return;
      /* GIỮ dữ liệu cũ. Xoá nó vì một lần đọc hỏng — AutoCAD bận, plugin chưa
         nạp — sẽ làm canvas trắng và mất cả đối tượng đang chọn. Ảnh chụp cũ
         kèm câu báo lỗi vẫn đọc được; màn hình trắng thì không. */
      setError(daemonFailureText(failure));
    } finally {
      if (!stale()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [daemon]);

  useEffect(() => {
    void load();
  }, [load]);

  return { data, loading, refreshing, error, reload: () => void load() };
}

"use client";

/** Đọc hồ sơ bản vẽ đang mở.
 *
 * **Không tự động tải lại.** Đây là lượt đọc NẶNG NHẤT của app: trên bản vẽ
 * as-built của dự án nó trả về 350 KB và quét toàn bộ bảng ký hiệu, từ điển,
 * xref. Làm mới theo nhịp sẽ khiến AutoCAD giật trong lúc người dùng đang vẽ.
 * Đọc một lần lúc mở, và chỉ đọc lại khi người dùng bấm.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { daemonFailureText, daemonRecord } from "../../lib/daemon/client";
import { endpoints } from "../../lib/daemon/endpoints";
import type { JsonRecord } from "./model";

export type DrawingInfoState = {
  data: JsonRecord | null;
  loading: boolean;
  refreshing: boolean;
  error: string;
  reload: () => void;
};

export function useDrawingInfo(daemon: string): DrawingInfoState {
  const [data, setData] = useState<JsonRecord | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  /* Lượt đọc mất vài giây. Bấm đọc lại hai lần thì lượt cũ có thể về sau lượt
     mới và ghi đè bằng hồ sơ cũ hơn — trên màn hình này nghĩa là bảng layer và
     bộ tạo chọn nói về một trạng thái bản vẽ đã qua. */
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++sequence.current;
    const stale = () => ticket !== sequence.current;
    setError("");
    setRefreshing(true);
    try {
      const body = await daemonRecord(
        await fetch(endpoints.drawingInfo(daemon), { cache: "no-store" }),
      );
      if (stale()) return;
      setData(body as JsonRecord);
    } catch (failure) {
      if (stale()) return;
      /* GIỮ hồ sơ cũ. Xoá nó vì một lần đọc hỏng sẽ làm bộ tạo chọn mất hết
         danh sách layer đúng lúc người dùng đang điền dở. */
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

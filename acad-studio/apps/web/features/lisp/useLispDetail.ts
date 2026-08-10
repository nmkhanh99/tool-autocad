"use client";

/** Đọc chi tiết một tài nguyên LISP, chỉ để lấy `manifestRevision`.
 *
 * Vì sao phải gọi thêm một endpoint: danh mục (`GET /lisp`) **không** trả
 * `manifestRevision`, mà mọi lệnh ghi đều đòi nó làm `baseRevision` và máy chủ
 * 409 nếu sai. Nói cách khác, không có nó thì không nạp được gì cả.
 *
 * Revision này khác `sourceHash`: nó tính cả manifest và dependency, nên file
 * không đổi mà một phụ thuộc đổi thì revision vẫn khác. Chính vì thế nó phải
 * đọc lại mỗi lần danh mục đọc lại (`catalogVersion`): bám theo mỗi `id` nghĩa
 * là một thay đổi từ bên ngoài sẽ khiến mọi lượt nạp sau đó ăn `revision_conflict`
 * mãi, và không có đường thoát nào ngay trên trang ngoài chọn sang tài nguyên
 * khác rồi chọn lại.
 */
import { useEffect, useRef, useState } from "react";
import { daemonFailureText, daemonRecord } from "../../lib/daemon/client";
import { endpoints } from "../../lib/daemon/endpoints";
import { asRecord } from "../../lib/daemon/client";

export type LispDetail = {
  revision: string;
  loading: boolean;
  error: string;
};

export function useLispDetail(daemon: string, id: string, catalogVersion: number): LispDetail {
  const [revision, setRevision] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);

  useEffect(() => {
    const ticket = ++sequence.current;
    if (!id) {
      setRevision("");
      setError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    /* Xoá revision cũ NGAY. Giữ lại nghĩa là trong lúc chờ đọc, nút Nạp có thể
       gửi revision cũ — máy chủ sẽ 409, nhưng lý do hiện ra ("cấu hình đã đổi")
       không dính gì tới sự thật. */
    setRevision("");
    void (async () => {
      try {
        const body = await daemonRecord(
          await fetch(endpoints.lispResource(daemon, id), { cache: "no-store" }),
        );
        if (ticket !== sequence.current) return;
        const resource = asRecord(body.resource);
        const value = resource?.manifestRevision;
        setRevision(typeof value === "string" ? value : "");
      } catch (failure) {
        if (ticket !== sequence.current) return;
        setError(daemonFailureText(failure));
      } finally {
        if (ticket === sequence.current) setLoading(false);
      }
    })();
  }, [daemon, id, catalogVersion]);

  return { revision, loading, error };
}

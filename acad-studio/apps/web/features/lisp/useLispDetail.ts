"use client";

/** Đọc chi tiết một tài nguyên LISP: revision, **source**, và manifest.
 *
 * Vì sao phải gọi thêm một endpoint: danh mục (`GET /lisp`) **không** trả
 * `manifestRevision`, mà mọi lệnh ghi đều đòi nó làm `baseRevision` và máy chủ
 * 409 nếu sai. Nói cách khác, không có nó thì không nạp được gì cả.
 *
 * Nó cũng là nơi duy nhất có **source**. Đó là điều kiện để duyệt ngay trên màn
 * này: chữ ký duyệt xác nhận một con người đã đọc nội dung, nên nội dung phải
 * hiện ra trước mắt họ. `source` là **toàn bộ file hoặc không có gì** — máy chủ
 * bỏ hẳn khi file quá 4 MB (`source_too_large`) chứ không cắt dở — nên phạm vi
 * đã đọc suy ra được, không phải để người dùng tự khai.
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
import { asRecord, type JsonRecord } from "../../lib/daemon/client";

export type LispDetail = {
  revision: string;
  /** Toàn bộ source, hoặc `null` khi không đọc được. Không bao giờ là một phần. */
  source: string | null;
  /** Manifest ĐANG CÓ HIỆU LỰC — thứ sẽ được duyệt.
   *
   * `resource.manifest` là bản đã gộp override; `baseManifest` chỉ là sidecar
   * gốc. Duyệt lại mà đọc `baseManifest` sẽ dựng lại payload từ dữ liệu cũ và
   * **âm thầm đánh rơi** những trường đã có (`guardrails`, `examples`, phần đã
   * sửa trước đó) — mất dữ liệu, không phải chỉ mất tiện nghi. */
  effectiveManifest: JsonRecord | null;
  /** Kết quả phân tích tĩnh của daemon — dùng để điền sẵn manifest. */
  inferred: JsonRecord | null;
  loading: boolean;
  error: string;
};

export function useLispDetail(daemon: string, id: string, catalogVersion: number): LispDetail {
  const [revision, setRevision] = useState("");
  const [source, setSource] = useState<string | null>(null);
  const [effectiveManifest, setEffectiveManifest] = useState<JsonRecord | null>(null);
  const [inferred, setInferred] = useState<JsonRecord | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const sequence = useRef(0);

  useEffect(() => {
    const ticket = ++sequence.current;
    const clear = () => {
      setRevision("");
      setSource(null);
      setEffectiveManifest(null);
      setInferred(null);
    };
    if (!id) {
      clear();
      setError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    /* Xoá revision cũ NGAY. Giữ lại nghĩa là trong lúc chờ đọc, nút Nạp có thể
       gửi revision cũ — máy chủ sẽ 409, nhưng lý do hiện ra ("cấu hình đã đổi")
       không dính gì tới sự thật. */
    clear();
    void (async () => {
      try {
        const body = await daemonRecord(
          await fetch(endpoints.lispResource(daemon, id), { cache: "no-store" }),
        );
        if (ticket !== sequence.current) return;
        const resource = asRecord(body.resource);
        const value = resource?.manifestRevision;
        setRevision(typeof value === "string" ? value : "");
        setSource(typeof resource?.source === "string" ? resource.source : null);
        setEffectiveManifest(
          asRecord(resource?.manifest) ?? asRecord(resource?.baseManifest),
        );
        setInferred(asRecord(resource?.inferred));
      } catch (failure) {
        if (ticket !== sequence.current) return;
        setError(daemonFailureText(failure));
      } finally {
        if (ticket === sequence.current) setLoading(false);
      }
    })();
  }, [daemon, id, catalogVersion]);

  return { revision, source, effectiveManifest, inferred, loading, error };
}

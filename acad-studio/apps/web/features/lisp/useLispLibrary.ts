"use client";

/** Đọc danh mục AutoLISP.
 *
 * CHỈ ĐỌC. Duyệt manifest và nạp script vẫn ở màn hình cũ — xem ghi chú ở
 * `app/(shell)/library/lisp/page.tsx` về việc vì sao duyệt không dựng lại được
 * ở đây bằng một lượt sửa giao diện.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { daemonFailureText, daemonRecord } from "../../lib/daemon/client";
import { endpoints } from "../../lib/daemon/endpoints";
import {
  normalizeResource,
  normalizeRoot,
  type LispCounts,
  type LispResource,
  type LispRoot,
} from "./model";

const EMPTY_COUNTS: LispCounts = {
  total: 0,
  readable: 0,
  loadable: 0,
  reviewed: 0,
  needsReview: 0,
};

export type LispCatalog = {
  resources: LispResource[];
  roots: LispRoot[];
  counts: LispCounts;
  /** Máy chủ đã cắt bớt kết quả quét. Không nói ra thì danh sách trông như đã
   * đầy đủ, và người dùng kết luận "không có script nào tên X" trong khi thật
   * ra là chưa quét tới. */
  truncated: boolean;
  /** CHƯA đọc xong lần đầu — tức chưa có gì để hiện. */
  loading: boolean;
  /** Đang đọc lại trong khi VẪN có dữ liệu cũ để hiện. Tách khỏi `loading` là
   * cố ý: dùng chung một cờ thì mỗi lần "Quét lại đĩa" sẽ thay cả danh sách
   * bằng chữ "đang đọc…", và người dùng mất chỗ đang xem vì một thao tác làm
   * mới. Nút quét dùng cờ này; danh sách dùng `loading`. */
  refreshing: boolean;
  error: string;
  reload: (force?: boolean) => void;
};

export function useLispLibrary(daemon: string): LispCatalog {
  const [resources, setResources] = useState<LispResource[]>([]);
  const [roots, setRoots] = useState<LispRoot[]>([]);
  const [counts, setCounts] = useState<LispCounts>(EMPTY_COUNTS);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  /* Cùng lý do như `useBlockLibrary`: kết quả về muộn không được đè lên trạng
     thái mới hơn. Ở đây còn dễ xảy ra hơn vì `reload(true)` bắt máy chủ quét
     lại đĩa — nó chậm hơn hẳn một lượt đọc thường. */
  const sequence = useRef(0);

  const load = useCallback(async (force: boolean) => {
    const ticket = ++sequence.current;
    const stale = () => ticket !== sequence.current;
    setError("");
    setRefreshing(true);
    try {
      const url = force ? `${endpoints.lispCatalog(daemon)}?refresh=1` : endpoints.lispCatalog(daemon);
      const body = await daemonRecord(await fetch(url, { cache: "no-store" }));
      if (stale()) return;
      const rawResources = Array.isArray(body.resources) ? body.resources : [];
      setResources(
        rawResources.map(normalizeResource).filter((r): r is LispResource => r !== null),
      );
      const rawRoots = Array.isArray(body.roots) ? body.roots : [];
      setRoots(rawRoots.map(normalizeRoot).filter((r): r is LispRoot => r !== null));
      const rawCounts = body.counts;
      setCounts(
        rawCounts && typeof rawCounts === "object"
          ? { ...EMPTY_COUNTS, ...(rawCounts as Partial<LispCounts>) }
          : EMPTY_COUNTS,
      );
      setTruncated(body.truncated === true);
    } catch (failure) {
      if (stale()) return;
      // Giữ danh sách cũ — xem lý do ở `useBlockLibrary`.
      setError(daemonFailureText(failure));
    } finally {
      if (!stale()) {
        setLoading(false);
        setRefreshing(false);
      }
    }
  }, [daemon]);

  useEffect(() => { void load(false); }, [load]);

  return {
    resources,
    roots,
    counts,
    truncated,
    loading,
    refreshing,
    error,
    reload: (force = false) => void load(force),
  };
}

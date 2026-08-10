"use client";

/** Hàng chờ thao tác, dùng chung cho chip ở titlebar, huy hiệu ở rail và màn
 * "Thay đổi chờ duyệt".
 *
 * Cả ba phải đọc CÙNG một con số. Nếu chip nói 2 mà màn hình nói 3 thì người
 * dùng không còn tin được cái nào — và toàn bộ điểm của chip là một lệnh ghi đã
 * chuẩn bị không thể bị quên chỉ vì điều hướng sang chỗ khác.
 *
 * ⚠️ Hàng chờ này sống trong TRÌNH DUYỆT, không phải trên máy chủ. Daemon giữ
 * sáu cơ chế staged rời rạc trong RAM, không cái nào persist qua restart, và
 * không có API liệt kê tất cả. Vì vậy màn hình Thay đổi phải nói thẳng điều đó
 * với người dùng thay vì hứa một hàng chờ mà máy chủ không có. Xem
 * `KE-HOACH-CHUYEN-DOI-UI.html` mục Giai đoạn 7.
 */
import { useCallback, useEffect, useState } from "react";
import { STORAGE_KEYS, readJson, writeJson } from "../../lib/storage";
import type { StagedSource } from "./types";

export type StagedEntryState =
  /** Đã chuẩn bị, chờ người xác nhận. */
  | "ready"
  /** Người dùng đang soạn, chưa gửi lên máy chủ. */
  | "draft"
  /** Bản vẽ đã đổi kể từ lúc chuẩn bị — phải chuẩn bị lại, không retry được. */
  | "stale"
  | "applied"
  | "rejected"
  /** Đã gửi nhưng không xác nhận được kết quả. */
  | "sent";

/** Một dòng trong hàng chờ. Đây là bản ghi nhớ phía trình duyệt, không phải
 * bản sao trạng thái máy chủ — `id` của máy chủ nằm ở `sourceId`. */
export type StagedEntry = {
  id: string;
  /** Màn hình đã tạo ra nó, để người dùng quay lại đúng chỗ chuẩn bị lại. */
  source: StagedSource;
  /** ID do router gốc cấp. Kết hợp với `source` là truy được về máy chủ. */
  sourceId: string;
  verb: string;
  subject: string;
  doc: string;
  rev: string;
  state: StagedEntryState;
  at: number;
};

const PENDING: ReadonlySet<StagedEntryState> = new Set(["ready", "draft"]);

export function readStaged(): StagedEntry[] {
  const list = readJson<StagedEntry[]>(STORAGE_KEYS.staged, []);
  return Array.isArray(list) ? list : [];
}

export function pendingCount(list: readonly StagedEntry[]): number {
  return list.filter((entry) => PENDING.has(entry.state)).length;
}

/** Các tab cùng mở phải thấy cùng một hàng chờ; `storage` chỉ bắn sang tab
 * khác nên tab ghi phải tự báo bằng một sự kiện riêng. */
const CHANGED = "acad:staged-changed";

export function writeStaged(list: StagedEntry[]): void {
  writeJson(STORAGE_KEYS.staged, list);
  try {
    window.dispatchEvent(new CustomEvent(CHANGED));
  } catch {
    /* không có window (render phía máy chủ) — không có ai để báo */
  }
}

export function useStagedOps() {
  const [list, setList] = useState<StagedEntry[]>([]);

  const reload = useCallback(() => setList(readStaged()), []);

  useEffect(() => {
    reload();
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === STORAGE_KEYS.staged) reload();
    };
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHANGED, reload);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CHANGED, reload);
    };
  }, [reload]);

  return { list, pending: pendingCount(list), reload };
}

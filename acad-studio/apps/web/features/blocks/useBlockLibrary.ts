"use client";

/** Đọc danh mục thư viện block.
 *
 * CHỈ ĐỌC. Mọi thao tác ghi của thư viện — tạo block từ bộ chọn, chèn vào bản
 * vẽ, đồng bộ định nghĩa, sửa metadata — vẫn nằm ở panel cũ cho tới khi màn
 * hình mới dựng xong phần đó. Hook này không cấp đường ghi nào, nên không có
 * cách nào vô tình ghi vào bản vẽ từ màn hình mới.
 */
import { useCallback, useEffect, useState } from "react";
import { daemonFailureText, daemonRecord } from "../../lib/daemon/client";
import { endpoints } from "../../lib/daemon/endpoints";
import {
  catalogRecord,
  normalizeBlock,
  normalizeSource,
  type BlockDefinition,
  type LibrarySource,
} from "./model";

export type BlockCatalog = {
  blocks: BlockDefinition[];
  sources: LibrarySource[];
  /** Đã đọc xong lần đầu chưa. Khác với "danh mục rỗng". */
  loading: boolean;
  /** Thông điệp lỗi đã qua `guards`, hoặc rỗng. */
  error: string;
  reload: () => void;
};

export function useBlockLibrary(daemon: string, target: string): BlockCatalog {
  const [blocks, setBlocks] = useState<BlockDefinition[]>([]);
  const [sources, setSources] = useState<LibrarySource[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setError("");

    // Hai lời gọi này KHÔNG ngang hàng nhau. Danh mục là nội dung của màn hình;
    // danh sách thư mục nguồn chỉ là một con số phụ ở thanh lọc. Gộp chúng vào
    // một `Promise.all` nghĩa là nguồn hỏng thì xoá sạch danh mục — người dùng
    // mất cả màn hình vì một thông tin bên lề. Panel cũ cũng tách hai đường này.
    try {
      const query = target ? `?target=${encodeURIComponent(target)}` : "";
      const body = await daemonRecord(
        await fetch(endpoints.blocks(daemon) + query, { cache: "no-store" }),
      );
      const catalog = catalogRecord(body);
      const rawBlocks = Array.isArray(catalog.blocks) ? catalog.blocks : [];
      setBlocks(rawBlocks.map(normalizeBlock).filter((b): b is BlockDefinition => b !== null));
    } catch (failure) {
      setError(daemonFailureText(failure));
      setBlocks([]);
    } finally {
      setLoading(false);
    }

    try {
      const body = await daemonRecord(
        await fetch(endpoints.blockSources(daemon), { cache: "no-store" }),
      );
      const raw = Array.isArray(body.sources) ? body.sources : [];
      setSources(raw.map(normalizeSource).filter((s): s is LibrarySource => s !== null));
    } catch {
      // Không đọc được nguồn thì bỏ trống con số đó; danh mục vẫn dùng được.
      setSources([]);
    }
  }, [daemon, target]);

  useEffect(() => { void load(); }, [load]);

  return { blocks, sources, loading, error, reload: () => void load() };
}

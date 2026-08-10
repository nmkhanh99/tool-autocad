"use client";

/** Đọc danh mục thư viện block.
 *
 * CHỈ ĐỌC. Mọi thao tác ghi của thư viện — tạo block từ bộ chọn, chèn vào bản
 * vẽ, đồng bộ định nghĩa, sửa metadata — vẫn nằm ở panel cũ cho tới khi màn
 * hình mới dựng xong phần đó. Hook này không cấp đường ghi nào, nên không có
 * cách nào vô tình ghi vào bản vẽ từ màn hình mới.
 */
import { useCallback, useEffect, useRef, useState } from "react";
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
  /** Content-hash của danh mục lúc đọc. Gửi kèm mọi lệnh ghi để máy chủ từ
   * chối nếu người khác vừa sửa thư viện — không ghi đè im lặng. */
  revision: string;
  /** Đã đọc xong lần đầu chưa. Khác với "danh mục rỗng". */
  loading: boolean;
  /** Thông điệp lỗi đã qua `guards`, hoặc rỗng. */
  error: string;
  reload: () => void;
  /** Nhận trạng thái máy chủ vừa trả về sau một lệnh ghi, KHÔNG đợi `reload()`.
   *
   * Không có nó thì `revision` còn là hash trước lượt ghi cho tới khi lần tải
   * lại (bất đồng bộ) xong. Bấm ghi lần thứ hai ngay trong quãng đó sẽ gửi
   * `expectedRevision` cũ và ăn 409 — một xung đột hoàn toàn tự gây ra, không
   * có ai sửa thư viện cả. */
  applyServerEcho: (echo: { revision: string; sources?: LibrarySource[] }) => void;
};

/** ⚠️ Danh mục này là TOÀN CỤC, không theo bản vẽ. `GET /api/acad/blocks` nhận
 * request bằng `_req` — nó bỏ qua mọi tham số, kể cả `target`. `syncStatus` vì
 * vậy là trạng thái của lần quét gần nhất, **không** phải trạng thái so với bản
 * vẽ đang mở. Đừng dùng nó để chặn thao tác: một block `synced` với bản vẽ A
 * vẫn có thể cần ghi metadata ở bản vẽ B. */
export function useBlockLibrary(daemon: string): BlockCatalog {
  const [blocks, setBlocks] = useState<BlockDefinition[]>([]);
  const [sources, setSources] = useState<LibrarySource[]>([]);
  const [revision, setRevision] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  /* Số thứ tự lượt đọc. Mỗi lượt tải lại và mỗi lần nhận echo đều lấy một số
     mới; kết quả về muộn hơn số hiện tại bị **bỏ**.
     Không có nó thì hai lượt ghi liên tiếp đủ để hỏng: lượt tải lại của lệnh
     thứ nhất có thể về SAU lượt thứ hai, ghi đè revision mới bằng revision cũ,
     và lệnh ghi kế tiếp ăn 409 dù không ai sửa gì. */
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++sequence.current;
    const stale = () => ticket !== sequence.current;
    setError("");

    // Hai lời gọi này KHÔNG ngang hàng nhau. Danh mục là nội dung của màn hình;
    // danh sách thư mục nguồn chỉ là một con số phụ ở thanh lọc. Gộp chúng vào
    // một `Promise.all` nghĩa là nguồn hỏng thì xoá sạch danh mục — người dùng
    // mất cả màn hình vì một thông tin bên lề. Panel cũ cũng tách hai đường này.
    try {
      const body = await daemonRecord(
        await fetch(endpoints.blocks(daemon), { cache: "no-store" }),
      );
      if (stale()) return;
      const catalog = catalogRecord(body);
      setRevision(String(catalog.revision || body.revision || ""));
      const rawBlocks = Array.isArray(catalog.blocks) ? catalog.blocks : [];
      setBlocks(rawBlocks.map(normalizeBlock).filter((b): b is BlockDefinition => b !== null));
    } catch (failure) {
      if (stale()) return;
      /* GIỮ danh mục cũ. Xoá nó nghĩa là một lần tải lại hỏng — daemon tắt, mạng
         chớp — sẽ làm `selected` thành null, form sửa metadata unmount, và người
         dùng mất trắng phần đang gõ. Lần tải lại ngay sau một lượt lưu là lúc dễ
         hỏng nhất, cũng là lúc có nhiều thứ để mất nhất. Lần tải đầu tiên vốn đã
         rỗng nên không cần xoá gì; nơi gọi phân biệt "hỏng mà chưa có gì" với
         "hỏng nhưng còn bản cũ" qua `error` + `blocks.length`. */
      setError(daemonFailureText(failure));
    } finally {
      if (!stale()) setLoading(false);
    }

    try {
      const body = await daemonRecord(
        await fetch(endpoints.blockSources(daemon), { cache: "no-store" }),
      );
      if (stale()) return;
      const raw = Array.isArray(body.sources) ? body.sources : [];
      setSources(raw.map(normalizeSource).filter((s): s is LibrarySource => s !== null));
    } catch {
      /* GIỮ danh sách nguồn cũ. Trước đây chỗ này `setSources([])` vì nguồn chỉ
         là một con số phụ ở thanh lọc. Nay nó là ô **Nguồn DWG** trong form và
         danh sách trong hộp Nguồn thư viện — xoá trắng vì một lần đọc hỏng sẽ
         làm block đang gán nguồn hiện ra như chưa gán, và người dùng lưu đè lên
         đúng liên kết đang có. */
    }
  }, [daemon]);

  useEffect(() => { void load(); }, [load]);

  return {
    blocks,
    sources,
    revision,
    loading,
    error,
    reload: () => void load(),
    applyServerEcho: (echo) => {
      // Vô hiệu hoá mọi lượt đọc đang bay: phản hồi của lệnh ghi mới nhất.
      sequence.current++;
      if (echo.revision) setRevision(echo.revision);
      if (echo.sources) setSources(echo.sources);
    },
  };
}

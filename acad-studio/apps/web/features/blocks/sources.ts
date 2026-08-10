"use client";

/** Nguồn thư viện block.
 *
 * ⚠️ Đọc kỹ trước khi viết chữ lên giao diện, vì bộ mẫu mô tả sai việc này.
 *
 * Một nguồn KHÔNG phải thư mục được quét. Nó là một **đường dẫn được ghi vào
 * danh mục**, và daemon chỉ dùng tới nó ở đúng một chỗ: `linkedDwgSource()` khi
 * `POST /blocks/insert` gặp một block mà bản vẽ đích **chưa có định nghĩa** —
 * lúc đó nó nhập định nghĩa từ file DWG của nguồn.
 *
 * Ba hệ quả phải nói ra ở giao diện:
 *
 *  1. **Thêm nguồn không quét gì cả.** `POST /blocks/sources` chỉ ghi
 *     `{kind, displayName, path}` vào danh mục. Không có định nghĩa nào được
 *     tìm thấy hay nhập vào. (`POST /blocks/scan` cũng không quét nguồn — nó
 *     quét **bản vẽ đang mở**.)
 *  2. **Nguồn chỉ có tác dụng khi một block trỏ vào nó** qua `sourceId`. Thêm
 *     nguồn rồi để đó thì không có gì thay đổi.
 *  3. **Chỉ `.dwg` dùng để chèn được.** `linkedDwgSource()` từ chối mọi đuôi
 *     khác và đòi file phải tồn tại. `xtp`/`image` ghi được vào danh mục nhưng
 *     không mở khoá đường chèn nào.
 *
 * Máy chủ KHÔNG kiểm đường dẫn lúc ghi — sai đường dẫn chỉ lộ ra lúc chèn.
 */
import { daemonFailureText, daemonRecord } from "../../lib/daemon/client";
import { endpoints } from "../../lib/daemon/endpoints";
import { normalizeSource, type LibrarySource } from "./model";

export type AddSourceResult =
  | { ok: true; sources: LibrarySource[]; revision: string }
  | { ok: false; error: string };

/** Thêm một nguồn vào danh mục. Không có endpoint xoá nguồn — danh mục còn từ
 * chối lưu nếu một block vẫn trỏ vào nguồn bị bỏ đi, nên "xoá" không phải là
 * một nút bị quên, mà là việc backend chưa làm. */
export async function addLibrarySource(
  base: string,
  source: Omit<LibrarySource, "id">,
  expectedRevision: string,
): Promise<AddSourceResult> {
  try {
    const body = await daemonRecord(await fetch(endpoints.blockSources(base), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source, expectedRevision }),
    }));
    const raw = Array.isArray(body.sources) ? body.sources : [];
    return {
      ok: true,
      sources: raw.map(normalizeSource).filter((s): s is LibrarySource => s !== null),
      revision: typeof body.revision === "string" ? body.revision : "",
    };
  } catch (failure) {
    return { ok: false, error: daemonFailureText(failure) };
  }
}

/** Nguồn này có mở khoá được đường chèn không. Dùng để nói thẳng ở danh sách,
 * thay vì để người dùng thêm một nguồn `xtp` rồi tự hỏi vì sao chèn vẫn hỏng. */
export function sourceUsableForInsert(source: LibrarySource): boolean {
  return source.kind === "dwg" && /\.dwg$/i.test(source.path.trim());
}

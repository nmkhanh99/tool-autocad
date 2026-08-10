"use client";

/** Hai lệnh GHI của thư viện block.
 *
 * `insert` chèn một thể hiện block; nếu bản vẽ chưa có định nghĩa thì máy chủ
 * nhập định nghĩa vào trước. `sync` **chỉ ghi metadata** lên một định nghĩa đã
 * có sẵn trong bản vẽ — nó không nhập và không thay hình học. Mô tả nó là
 * "đồng bộ định nghĩa" là hứa một việc backend không làm.
 *
 * ⚠️ Cả hai là **một pha**: gọi là AutoCAD làm ngay. Chúng KHÔNG đi qua
 * `features/staged-ops` và KHÔNG xuất hiện ở màn Thay đổi chờ duyệt — máy chủ
 * không có bước chuẩn bị cho hai đường này, nên đưa chúng vào hàng chờ sẽ biến
 * hàng chờ thành một cái nút lệnh trì hoãn được hoá trang thành hàng chờ duyệt.
 *
 * `expectedRevision` là content-hash của danh mục lúc màn hình đọc nó. Máy chủ
 * so lại và từ chối nếu danh mục đã đổi — người khác vừa sửa thư viện thì thao
 * tác này phải hỏng chứ không được ghi đè.
 */
import { daemonFailureText, daemonRecord } from "../../lib/daemon/client";
import { endpoints } from "../../lib/daemon/endpoints";

export type BlockActionResult = { ok: true; hint: string } | { ok: false; error: string };

export async function runBlockAction(
  base: string,
  action: "insert" | "sync",
  input: { blockId: string; target: string; expectedRevision: string },
): Promise<BlockActionResult> {
  try {
    const body = await daemonRecord(await fetch(endpoints.blockAction(base, action), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        blockId: input.blockId,
        target: input.target,
        expectedRevision: input.expectedRevision,
      }),
    }));
    const hint = typeof body.hint === "string" ? body.hint
      : typeof body.message === "string" ? body.message
      : action === "insert"
        ? "Đã bắt đầu chèn trong AutoCAD — chuyển sang cửa sổ AutoCAD để chỉ điểm chèn."
        : "Đã ghi metadata lên định nghĩa block trong bản vẽ.";
    return { ok: true, hint };
  } catch (failure) {
    return { ok: false, error: daemonFailureText(failure) };
  }
}

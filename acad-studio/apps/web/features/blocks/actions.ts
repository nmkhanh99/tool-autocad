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
import { normalizeBlock, validateBlockDraft, type BlockDefinition } from "./model";

export type BlockActionResult = { ok: true; hint: string } | { ok: false; error: string };

export async function runBlockAction(
  base: string,
  action: "insert" | "sync",
  input: { blockId: string; target: string; expectedRevision: string },
): Promise<BlockActionResult & { revision?: string }> {
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
    /* Cả `insert` lẫn `sync` đều `saveBlockLibraryCatalog(...)`, tức revision
       của danh mục ĐỔI. Không trả nó về thì màn hình còn giữ revision cũ tới khi
       tải lại xong, và lệnh ghi kế tiếp trong quãng đó ăn 409 oan. */
    return {
      ok: true,
      hint,
      ...(typeof body.revision === "string" ? { revision: body.revision } : {}),
    };
  } catch (failure) {
    return { ok: false, error: daemonFailureText(failure) };
  }
}

/** Tạo một định nghĩa mới từ bộ chọn đang có trong AutoCAD.
 *
 * ⚠️ Lệnh ghi **nặng nhất** trong màn hình này, và là lệnh duy nhất **lấy đi**
 * thứ đang có trên bản vẽ. `buildCreateBlockLisp` chạy `-BLOCK`, lệnh này gom
 * các đối tượng đang chọn thành định nghĩa rồi **xoá chúng khỏi bản vẽ**. Không
 * có bước chuẩn bị, không đi qua hàng chờ, và app không hoàn tác được.
 *
 * Bốn điều kiện máy chủ bắt buộc, đều chỉ biết được ở phía AutoCAD:
 *
 *  · phải có **bộ chọn** — LISP đọc `(ssgetfirst)`; rỗng thì `selection_required`;
 *  · bản vẽ đích phải đang **active**;
 *  · không gian hiện tại phải nằm trong `allowedSpaces` (`space_not_allowed`);
 *  · bản vẽ chưa được có sẵn tên block đó (`block_name_exists`).
 *
 * Rồi AutoCAD **hỏi điểm chèn** (`getpoint`) — người dùng phải chuyển sang
 * AutoCAD để chỉ, giới hạn 2 phút như lệnh `insert`.
 *
 * Chỉ tạo được block **tĩnh**: `buildCreateBlockLisp` ném lỗi với block động
 * ("phải author trong Block Editor").
 */
export async function createBlockFromSelection(
  base: string,
  block: BlockDefinition,
  expectedRevision: string,
): Promise<BlockActionResult & { createdId?: string; revision?: string }> {
  const invalid = validateBlockDraft(block);
  if (invalid) return { ok: false, error: invalid };
  try {
    // `id` do máy chủ sinh — gửi id rỗng lên sẽ trượt kiểm `idValue`.
    const { id: _id, ...payload } = block;
    const body = await daemonRecord(await fetch(endpoints.blockCreate(base), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ block: payload, expectedRevision }),
    }));
    const created = normalizeBlock(body.block);
    return {
      ok: true,
      hint: typeof body.hint === "string" ? body.hint : "Đã tạo định nghĩa block từ bộ chọn.",
      ...(created ? { createdId: created.id } : {}),
      // Revision mới, để nơi gọi dùng ngay thay vì đợi danh mục tải lại xong.
      ...(typeof body.revision === "string" ? { revision: body.revision } : {}),
    };
  } catch (failure) {
    return { ok: false, error: daemonFailureText(failure) };
  }
}

/** Lưu metadata một định nghĩa.
 *
 * Khác hai lệnh trên: đây ghi vào **thư viện**, không vào bản vẽ. Không có
 * AutoCAD nào bị chạm, không có gì để `UNDO`, và sửa lại là được — nên nó không
 * cần `ConfirmSheet` với cảnh báo không-hoàn-tác. Đánh đồng nó với một lệnh ghi
 * vào bản vẽ sẽ làm loãng cảnh báo ở chỗ cảnh báo thật sự quan trọng.
 *
 * Trả kèm `saved` — bản định nghĩa **máy chủ vừa ghi** cùng revision mới, không
 * phải bản nháp đã gửi. Chúng khác nhau ở đúng những chỗ quan trọng: máy chủ tự
 * đặt lại `syncStatus` (`PUT /:id` không tin `syncStatus` từ form), đẩy một
 * block đang `synced` về `outdated` khi metadata đổi, và chuẩn hoá đầu vào
 * (cắt khoảng trắng…). Nơi gọi cần cả ba để dội form về đúng thứ đã lưu; đoán ở
 * phía client sẽ sai ở đúng những ca đó.
 */
export async function saveBlockMetadata(
  base: string,
  block: BlockDefinition,
  expectedRevision: string,
): Promise<BlockActionResult & { saved?: { block: BlockDefinition; revision: string } }> {
  const invalid = validateBlockDraft(block);
  if (invalid) return { ok: false, error: invalid };
  try {
    const body = await daemonRecord(await fetch(endpoints.block(base, block.id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ block, expectedRevision }),
    }));
    const hint = typeof body.hint === "string" ? body.hint : "Đã lưu metadata block.";
    const blocks = Array.isArray(body.blocks) ? body.blocks : [];
    const savedBlock = blocks
      .map(normalizeBlock)
      .find((candidate): candidate is BlockDefinition => candidate?.id === block.id);
    const revision = typeof body.revision === "string" ? body.revision : "";
    return savedBlock && revision
      ? { ok: true, hint, saved: { block: savedBlock, revision } }
      : { ok: true, hint };
  } catch (failure) {
    return { ok: false, error: daemonFailureText(failure) };
  }
}

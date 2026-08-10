/** MỘT bản duy nhất của luồng ghi hai pha.
 *
 * Trước giai đoạn 2A có ba bản sao (`page.tsx`, `DrawingInfoPanel`,
 * `DrawingStandardsPanel`) — ba lần lặp lại cùng chuỗi
 * prepare → confirmed:true → reject, mỗi bản lệch một chút. Bản trong
 * `page.tsx` không kiểm `ok === false` và vứt luôn mã lỗi có kiểu; hai bản kia
 * rút số lượng đối tượng theo hai chuỗi fallback khác nhau.
 *
 * Ba bản sao của một lệnh ghi KHÔNG HOÀN TÁC ĐƯỢC là rủi ro thật: chỉ cần một
 * bản port sót `confirmed: true` là có một đường ghi chạy mà không hiện danh
 * sách đối tượng cho ai xem. Gộp trước, di chuyển file sau.
 *
 * Module này CHỈ lo giao thức. Việc gì xảy ra sau khi ghi — nạp lại danh sách,
 * đánh dấu snapshot cũ, đổi đích vẽ — vẫn thuộc về từng màn hình.
 */
import { daemonRecord, DaemonError, asRecord, type JsonRecord } from "../../lib/daemon/client";
import { endpoints } from "../../lib/daemon/endpoints";
import { guardFor } from "../../lib/daemon/guards";
import type { PrepareRequest, StagedAction, StagedOp } from "./types";

/** Mã báo rằng thứ app đang cầm đã cũ so với bản vẽ. Màn hình nhận được nên
 * đánh dấu snapshot của mình là cũ thay vì chỉ hiện lỗi. */
export const STALE_CODES: ReadonlySet<string> = new Set([
  "document_stale",
  "drawing_stale",
  "scope_stale",
  "selection_stale",
  "destination_stale",
  "operation_revision_mismatch",
  "target_mismatch",
]);

export function isStale(error: unknown): boolean {
  return error instanceof DaemonError && STALE_CODES.has(error.code);
}

/** Câu chữ cho người dùng. Có mã có kiểu thì dùng copy đã viết sẵn; không có
 * thì trả message thô của daemon — vẫn đúng bối cảnh hơn một câu chung chung. */
export function stagedErrorText(error: unknown): string {
  if (error instanceof DaemonError) {
    const guard = guardFor(error.code);
    if (guard) return `${guard.title}. ${guard.fix}`;
  }
  return error instanceof Error ? error.message : String(error);
}

/** Daemon trả số lượng đối tượng ở nhiều chỗ tuỳ loại thao tác. Giữ nguyên
 * chuỗi fallback đầy đủ nhất trong ba bản cũ — bản ngắn hơn ở `page.tsx` bỏ
 * sót `summary.subjectCount` và độ dài mảng `subjects`. */
function countOf(operation: JsonRecord, fallback?: number): number | undefined {
  const summary = asRecord(operation.summary) || {};
  const subjects = Array.isArray(operation.subjects) ? operation.subjects : [];
  const raw = operation.subjectCount ?? operation.count ??
    summary.count ?? summary.subjectCount ??
    (subjects.length ? subjects.length : fallback);
  const count = Number(raw);
  return Number.isFinite(count) ? count : fallback;
}

/** Pha 1 — chuẩn bị. KHÔNG chạm vào bản vẽ; chỉ trả về thứ sắp bị thay đổi. */
export async function prepareStagedOp(
  base: string,
  request: PrepareRequest,
  options: { action: StagedAction; fallbackCount?: number },
): Promise<StagedOp> {
  const body = await daemonRecord(await fetch(endpoints.selectionPrepare(base), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  }));

  const operation = asRecord(body.operation) || {};
  const id = String(operation.id || body.operationId || "");
  const revision = String(operation.revision || body.revision || "");
  // Thiếu id hoặc revision thì không có gì để xác nhận, và cũng không có gì để
  // daemon so lại lúc apply. Dừng ở đây tốt hơn là dựng một thẻ xác nhận rỗng.
  if (!id) throw new DaemonError("Daemon không trả operation id để xác nhận.");
  if (!revision) throw new DaemonError("Daemon không trả revision để đối chiếu lúc ghi.");

  const target = String(operation.target || request.target || "");
  return {
    id,
    revision,
    action: options.action,
    target,
    count: countOf(operation, options.fallbackCount),
    ...(options.action === "activate-document" ? { nextTarget: target } : {}),
  };
}

/** Pha 2 — ghi. One-shot: thất bại thì phải chuẩn bị lại, KHÔNG BAO GIỜ gọi
 * lại cùng một id. `confirmed: true` chỉ được xuất hiện ở đây, trong toàn repo. */
export async function applyStagedOp(base: string, op: StagedOp): Promise<JsonRecord> {
  return daemonRecord(await fetch(endpoints.selectionOperationApply(base, op.id), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision: op.revision, confirmed: true }),
  }));
}

/** Bỏ thao tác. Best-effort: không gọi được thì op cũng tự hết hạn phía máy
 * chủ và không có thay đổi nào được ghi, nên nuốt lỗi ở đây là đúng. */
export async function rejectStagedOp(base: string, op: StagedOp): Promise<void> {
  try {
    await fetch(endpoints.selectionOperationReject(base, op.id), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ revision: op.revision }),
    });
  } catch {
    // Không có apply nào được gửi — bản vẽ không đổi dù lời gọi này hỏng.
  }
}

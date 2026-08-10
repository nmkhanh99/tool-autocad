"use client";

/** Lệnh ghi của thư viện AutoLISP — trừ duyệt manifest, thứ web không làm được
 * (xem đầu `app/(shell)/library/lisp/page.tsx`).
 *
 * `load` KHÔNG ghi vào bản vẽ. Nó đổi **phiên AutoCAD đang chạy**, và đổi ba
 * thứ chứ không phải một:
 *
 *  1. `(load ...)` **thực thi** file — mọi biểu thức ở mức cao nhất chạy ngay,
 *     kể cả biểu thức sửa bản vẽ;
 *  2. thêm thư mục vào biến môi trường `ACAD` (support path) của phiên;
 *  3. thêm vào `TRUSTEDPATHS` — từ đó AutoCAD tin mã trong thư mục ấy mà không
 *     hỏi SECURELOAD nữa.
 *
 * Khi nạp **hỏng**, LISP khôi phục cả `ACAD` lẫn `TRUSTEDPATHS`. Khi nạp
 * **thành công** thì KHÔNG — hai thứ đó nằm lại tới khi đóng AutoCAD. Đó là
 * chủ ý (mã đã nạp còn cần tìm dependency), nhưng người dùng phải biết.
 */
import { DaemonError, daemonFailureText, daemonRecord } from "../../lib/daemon/client";
import { guardFor } from "../../lib/daemon/guards";
import { endpoints } from "../../lib/daemon/endpoints";
import { normalizeRoot, reviewLabel, type LispRoot } from "./model";

export type LispActionResult = { ok: true; hint: string } | { ok: false; error: string };

/** Vài mã của daemon mang **tham số** sau dấu hai chấm
 * (`review_required:stale`, `dependency_review_required:<id>:<ref>`). `guards.ts`
 * tra theo mã trần nên không khớp được, và hiện thẳng chuỗi thô thì người dùng
 * đọc `dependency_review_required:LSP-07:cty/common.lsp`. Dịch ở đây. */
export function lispFailureText(failure: unknown): string {
  const code = failure instanceof DaemonError ? failure.code : "";
  const raw = failure instanceof DaemonError ? failure.message : "";
  const tagged = code || raw;

  if (tagged.startsWith("review_required:")) {
    const status = tagged.slice("review_required:".length);
    return `Phải duyệt trước khi nạp — trạng thái hiện tại: ${reviewLabel(status)}. ` +
      "Duyệt trong app Acad Studio desktop rồi thử lại.";
  }
  if (tagged.startsWith("dependency_review_required:")) {
    const reference = tagged.split(":").slice(2).join(":");
    return `Một phụ thuộc chưa được duyệt: ${reference}. Duyệt nó trước, rồi nạp lại.`;
  }
  if (tagged.startsWith("dependency_unresolved:")) {
    const reference = tagged.slice("dependency_unresolved:".length);
    return `Không tìm thấy phụ thuộc bắt buộc: ${reference}. ` +
      "Thêm thư mục chứa nó làm thư mục gốc rồi quét lại.";
  }
  if (tagged === "unsafe_support_path") {
    return "Đường dẫn thư mục chứa ký tự không an toàn nên máy chủ từ chối nạp.";
  }
  if (tagged.startsWith("resource_changed_during_stage")) {
    return "File đổi ngay trong lúc chuẩn bị nạp. Quét lại rồi thử lại.";
  }
  if (tagged.startsWith("managed_stage_corrupt")) {
    return "Bản sao dàn dựng trong ~/Acad-Bridge bị hỏng. Quét lại đĩa rồi thử lại.";
  }

  const guard = code ? guardFor(code) : null;
  if (guard) return `${guard.title} ${guard.why} ${guard.fix}`;
  return daemonFailureText(failure);
}

/** Nạp resource vào phiên AutoCAD đang chạy. */
export async function loadResource(
  base: string,
  id: string,
  baseRevision: string,
  target: string,
): Promise<LispActionResult> {
  try {
    const body = await daemonRecord(await fetch(endpoints.lispLoad(base, id), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ baseRevision, ...(target ? { target } : {}) }),
    }));
    /* `state: "sent"` nghĩa là job đã tới AutoCAD nhưng chưa trả kết quả trong
       thời gian chờ — KHÔNG phải "đã nạp xong". Nói nhầm ở đây khiến người dùng
       gõ tên lệnh và tưởng app hỏng. */
    if (body.state === "sent" || body.state === "pending") {
      return {
        ok: true,
        hint: typeof body.hint === "string"
          ? body.hint
          : "Đã gửi lệnh nạp; AutoCAD chưa trả kết quả. Kiểm tra trong AutoCAD trước khi gõ lệnh.",
      };
    }
    return { ok: true, hint: "Đã nạp vào phiên AutoCAD đang chạy." };
  } catch (failure) {
    return { ok: false, error: lispFailureText(failure) };
  }
}

export type AddRootResult =
  | { ok: true; root: LispRoot }
  | { ok: false; error: string };

/** Thêm một **thư mục** làm gốc quét. Khác nguồn của thư viện block ở chỗ đó:
 * bên kia là một file `.dwg`, bên này là một thư mục. */
export async function addLispRoot(
  base: string,
  path: string,
  label: string,
): Promise<AddRootResult> {
  try {
    const body = await daemonRecord(await fetch(endpoints.lispRoots(base), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path, ...(label ? { label } : {}) }),
    }));
    const root = normalizeRoot(body.root);
    return root ? { ok: true, root } : { ok: false, error: "Máy chủ không trả về thư mục đã thêm." };
  } catch (failure) {
    return { ok: false, error: lispFailureText(failure) };
  }
}

export type ImportRootsResult =
  | { ok: true; added: LispRoot[]; skippedCount: number }
  | { ok: false; error: string };

/** Đọc Support File Search Path của AutoCAD **đang chạy** rồi thêm từng đường
 * dẫn làm thư mục gốc. Cần AutoCAD mở và plugin trả lời — nó là một job LISP,
 * không phải một phép đọc cấu hình. */
export async function importAutocadRoots(
  base: string,
  target: string,
): Promise<ImportRootsResult> {
  try {
    const body = await daemonRecord(await fetch(endpoints.lispRootsImport(base), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(target ? { target } : {}),
    }));
    const raw = Array.isArray(body.added) ? body.added : [];
    return {
      ok: true,
      added: raw.map(normalizeRoot).filter((r): r is LispRoot => r !== null),
      skippedCount: Number.isFinite(Number(body.skippedCount)) ? Number(body.skippedCount) : 0,
    };
  } catch (failure) {
    return { ok: false, error: lispFailureText(failure) };
  }
}

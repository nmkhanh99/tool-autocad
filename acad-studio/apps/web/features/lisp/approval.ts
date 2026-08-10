"use client";

/** Duyệt manifest của một resource AutoLISP.
 *
 * Ba bước, **phải liền một mạch**:
 *
 *  1. **Ký** — `window.acadStudio.signReview` (app desktop) tạo chữ ký Ed25519
 *     trên `{resourceId, baseRevision, proposalHash, analysisCoverage,
 *     acknowledgedIncomplete, issuedAt, nonce}`. Trình duyệt thường không có
 *     hàm này; đó là chủ ý của thiết kế, không phải thiếu sót.
 *  2. **Xin token** — `POST /:id/approval-challenge` kiểm chữ ký bằng
 *     `ACAD_REVIEW_PUBLIC_KEY` rồi phát token sống **2 phút**, dùng một lần.
 *  3. **Ghi** — `PUT /:id/manifest` kèm token.
 *
 * Vì sao gộp cả ba vào một lời gọi thay vì tách "ký" rồi "ghi" như bộ mẫu vẽ:
 * token chỉ tồn tại giữa bước 2 và 3, và ở đây quãng đó là vài mili-giây. Dựng
 * một đồng hồ đếm ngược 2 phút cho quãng ấy là vẽ một cơ chế người dùng không
 * bao giờ chạm tới, đổi lại thêm một trạng thái hỏng có thật (token hết hạn
 * giữa hai cú bấm).
 *
 * ⚠️ `proposalHash` **không** phải hash của bản nháp nào cả — máy chủ tự tính
 * lại từ `{resourceId, baseRevision, manifest}` khi nhận `PUT` và từ chối nếu
 * khác. Nó là cam kết "tôi duyệt ĐÚNG manifest này", nên phải băm đúng manifest
 * sắp gửi đi. Xem `fingerprint.ts`.
 */
import { daemonFailureText, daemonRecord, type JsonRecord } from "../../lib/daemon/client";
import { endpoints } from "../../lib/daemon/endpoints";
import { manifestFingerprint } from "./fingerprint";
import { lispFailureText } from "./actions";

/** Phạm vi source người duyệt thật sự đọc được. **Suy ra, không để người dùng
 * khai.** Máy chủ trả source nguyên vẹn hoặc không trả gì (quá 4 MB) chứ không
 * cắt dở, nên chỉ có hai kết cục thật; `partial-source` dành cho luồng agent,
 * nơi source bị cắt đôi cho vừa ngân sách. */
export function coverageFor(source: string | null): "full-source" | "metadata-only" {
  /* Chuỗi RỖNG vẫn là toàn bộ file — một file .lsp trống là file hợp lệ, và
     người duyệt đã nhìn thấy trọn vẹn nội dung của nó. Coi nó là
     `metadata-only` sẽ bắt tích một ô xác nhận sai sự thật và ghi một phạm vi
     sai vào manifest, vĩnh viễn. Chỉ `null` mới là "không đọc được". */
  return typeof source === "string" ? "full-source" : "metadata-only";
}

type SignReview = (input: {
  resourceId: string;
  baseRevision: string;
  proposalHash: string;
  analysisCoverage: string;
  acknowledgedIncomplete: boolean;
}) => Promise<unknown> | unknown;

function signer(): SignReview | null {
  if (typeof window === "undefined") return null;
  const shell = (window as unknown as { acadStudio?: { signReview?: unknown } }).acadStudio;
  return typeof shell?.signReview === "function" ? (shell.signReview as SignReview) : null;
}

export type ApproveResult = { ok: true; hint: string } | { ok: false; error: string };

export async function approveManifest(
  base: string,
  input: {
    resourceId: string;
    baseRevision: string;
    manifest: JsonRecord;
    analysisCoverage: "full-source" | "metadata-only";
  },
): Promise<ApproveResult> {
  const sign = signer();
  if (!sign) {
    return {
      ok: false,
      error: "Cửa sổ này không có bộ ký của app Acad Studio desktop, nên không duyệt được.",
    };
  }
  /* Máy chủ ĐÒI `acknowledgedIncomplete` khi phạm vi khác `full-source`, và từ
     chối cả lượt xin token nếu thiếu. Suy ra thay vì hỏi lại: nó là hệ quả của
     phạm vi, không phải một lựa chọn riêng. Giao diện đã bắt người dùng tích
     xác nhận trước khi tới được đây. */
  const acknowledgedIncomplete = input.analysisCoverage !== "full-source";

  try {
    const proposalHash = await manifestFingerprint({
      resourceId: input.resourceId,
      baseRevision: input.baseRevision,
      manifest: input.manifest,
    });

    const userProof = await sign({
      resourceId: input.resourceId,
      baseRevision: input.baseRevision,
      proposalHash,
      analysisCoverage: input.analysisCoverage,
      acknowledgedIncomplete,
    });

    const challenge = await daemonRecord(
      await fetch(endpoints.lispApprovalChallenge(base, input.resourceId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseRevision: input.baseRevision,
          proposalHash,
          analysisCoverage: input.analysisCoverage,
          acknowledgedIncomplete,
          userProof,
        }),
      }),
    );
    const approvalToken = typeof challenge.approvalToken === "string" ? challenge.approvalToken : "";
    if (!approvalToken) return { ok: false, error: "Máy chủ không phát token duyệt." };

    await daemonRecord(
      await fetch(endpoints.lispManifest(base, input.resourceId), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          baseRevision: input.baseRevision,
          approved: true,
          manifest: input.manifest,
          proposalHash,
          approvalToken,
        }),
      }),
    );
    return { ok: true, hint: "Đã duyệt. Từ giờ nạp được resource này vào AutoCAD." };
  } catch (failure) {
    /* Lỗi ký ném ra từ preload là `Error` thường, không phải `DaemonError` —
       `lispFailureText` sẽ rơi về `daemonFailureText`, cho ra chính thông điệp
       của preload (`review_signer_origin_not_allowed`…). Đủ để tra, và không
       bịa thêm nguyên nhân. */
    return { ok: false, error: lispFailureText(failure) };
  }
}

/** Manifest sẽ được gửi đi khi duyệt.
 *
 * Bắt đầu từ manifest ĐANG CÓ HIỆU LỰC (không phải sidecar gốc — xem
 * `useLispDetail`), điền phần thiếu từ phân tích tĩnh của
 * daemon, và luôn ghi đè `summary` bằng câu người dùng vừa viết — đó là trường
 * DUY NHẤT máy chủ bắt buộc (`manifest_summary_required`).
 *
 * `review` bị bỏ hẳn: máy chủ tự đặt lại khối đó ở `saveManifest()`, và gửi lên
 * một khối `review` tự chế là gửi một lời khai về chính mình. */
export function manifestToApprove(input: {
  effectiveManifest: JsonRecord | null;
  inferred: JsonRecord | null;
  summary: string;
}): JsonRecord {
  const { review: _serverOwned, ...base } = input.effectiveManifest ?? {};
  const inferred = input.inferred ?? {};
  const list = (value: unknown): string[] =>
    Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

  return {
    ...base,
    summary: input.summary.trim(),
    commands: list(base.commands).length ? base.commands : list(inferred.commands),
    publicFunctions: list(base.publicFunctions).length
      ? base.publicFunctions
      : list(inferred.functions),
    dependencies: list(base.dependencies).length
      ? base.dependencies
      : list(inferred.dependencies),
  };
}

/**
 * liveDraw — chạy job vẽ vào BẢN VẼ ĐANG MỞ trong AutoCAD (không phải file đóng).
 *
 * Đối xứng với headlessDraw.ts:
 *   headlessDraw  → AcCoreConsole mở DWG đóng, tự SAVEAS.
 *   liveDraw      → ghi ~/Acad-Bridge/job.lsp, plugin AcadBridge (FSEvents) nạp
 *                   vào document đang mở rồi chạy; KHÔNG lưu file (giữ dirty để
 *                   người dùng tự Undo / Save).
 *
 * Hợp đồng kết quả: job được wrapJob() bọc sẵn hàm (acad:write-result status msg);
 * LISP ở chế độ live gọi hàm đó với chuỗi "k=v k=v", ta tách lại thành object.
 */
import { acadRunning, dispatchLiveJob, listOpenDocs } from "./acadBridge.js";

export type LiveResult = {
  ok: boolean;
  jobId: string;
  /** k=v đã tách từ message của acad:write-result */
  result: Record<string, string>;
  message: string;
  error?: string;
};

/** Tách chuỗi "staged=5 previewLayer=ACAD-PREVIEW-ab destLayer=P-ThoatXi". */
export function parseKv(message: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const tok of String(message).trim().split(/\s+/)) {
    const i = tok.indexOf("=");
    if (i > 0) out[tok.slice(0, i)] = tok.slice(i + 1);
  }
  return out;
}

/** Danh sách bản vẽ đang mở (proxy listOpenDocs, để router không phụ thuộc acadBridge). */
export async function openDocs(timeoutMs = 3000) {
  return listOpenDocs(timeoutMs);
}

/**
 * Chạy LISP trong AutoCAD đang mở.
 * target = title HOẶC đường dẫn bản vẽ đích (plugin đọc job_target.txt để chọn document).
 */
export async function runLiveLisp(opts: {
  lisp: string;
  target?: string;
  timeoutMs?: number;
}): Promise<LiveResult> {
  const timeoutMs = opts.timeoutMs ?? 60_000;

  if (!(await acadRunning())) {
    return {
      ok: false, jobId: "", result: {}, message: "",
      error: "AutoCAD chưa chạy — mở AutoCAD rồi thử lại (POST /api/acad/open).",
    };
  }

  const dispatched = await dispatchLiveJob(opts.lisp, opts.target, timeoutMs);
  if (dispatched.result) {
    return {
      ok: dispatched.result.status === "ok",
      jobId: dispatched.jobId,
      result: parseKv(dispatched.result.message),
      message: dispatched.result.message,
      error:
        dispatched.result.status === "ok"
          ? undefined
          : dispatched.result.message,
    };
  }
  return {
    ok: false, jobId: dispatched.jobId, result: {}, message: "",
    error:
      `Quá ${timeoutMs} ms chưa thấy kết quả. Plugin AcadBridge có thể chưa nạp job — ` +
      `trong AutoCAD gõ ACAD-RUN (hoặc MEP-RUN) để chạy thủ công.`,
  };
}

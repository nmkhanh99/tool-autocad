"use client";

/** Duyệt manifest ngay trên màn thư viện LISP.
 *
 * **Không dùng `ConfirmSheet`.** Ba cảnh báo của nó nói về việc ghi vào bản vẽ
 * hoặc đổi phiên AutoCAD; duyệt thì không chạm cái nào — nó ghi vào thư viện.
 * Ma sát cần ở đây là loại khác: bạn đang **ký tên vào một nội dung**, nên nội
 * dung phải hiện ra và bạn phải xác nhận đã đọc.
 *
 * Vì sao không cần đề xuất của agent: `validateApprovedManifest()` chỉ bắt buộc
 * **một câu tóm tắt**; phần còn lại (`commands`, `publicFunctions`,
 * `dependencies`) daemon đã phân tích tĩnh sẵn trong `inferred`. Chữ ký duyệt
 * xác nhận **một con người đã đọc source**, không xác nhận rằng một agent đã
 * chạy — nên bắt buộc phải có agent mới duyệt được là thêm một điều kiện mà
 * thiết kế bảo mật không đòi.
 *
 * `analysisCoverage` được **suy ra**, không cho khai: máy chủ trả source nguyên
 * vẹn hoặc không trả gì, nên "đã đọc bao nhiêu" là hệ quả của việc có source
 * hay không. Để người dùng tự chọn `full-source` khi màn hình không hiện được
 * dòng nào là mở đường cho một lời khai sai nằm vĩnh viễn trong manifest.
 */
import { useId, useState } from "react";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { coverageFor, manifestToApprove } from "./approval";
import { coverageLabel, type LispResource } from "./model";
import type { JsonRecord } from "../../lib/daemon/client";
import { revisionLabel } from "../../lib/revisionKinds";

export function ApprovalDialog({
  resource, revision, source, effectiveManifest, inferred, signerPresent, busy, error, onApprove, onCancel,
}: {
  resource: LispResource;
  revision: string;
  source: string | null;
  effectiveManifest: JsonRecord | null;
  inferred: JsonRecord | null;
  signerPresent: boolean;
  busy: boolean;
  error: string;
  onApprove: (manifest: JsonRecord, coverage: "full-source" | "metadata-only") => void;
  onCancel: () => void;
}) {
  const fieldId = useId();
  const existingSummary = typeof effectiveManifest?.summary === "string" ? effectiveManifest.summary : "";
  const [summary, setSummary] = useState(existingSummary);
  const [readAck, setReadAck] = useState(false);
  const [incompleteAck, setIncompleteAck] = useState(false);

  const coverage = coverageFor(source);
  const complete = coverage === "full-source";

  const blocked = !signerPresent
    ? "Cửa sổ này không có bộ ký của app desktop."
    : !revision
      ? `Chưa đọc được ${revisionLabel("manifest").toLowerCase()} của tài nguyên.`
      : !summary.trim()
        ? "Máy chủ bắt buộc một câu tóm tắt script này làm gì."
        : !readAck
          ? "Phải xác nhận đã đọc trước khi ký."
          : !complete && !incompleteAck
            ? "Phải xác nhận biết mình duyệt mà không đọc được source."
            : "";

  return (
    <Modal
      title="Duyệt manifest"
      sub={`${resource.name} · ${coverageLabel(coverage)}`}
      wide
      onClose={onCancel}
      footer={
        <>
          <span className="note">Chữ ký gắn với đúng nội dung đang hiện ở đây.</span>
          <span className="spacer" />
          <Button onClick={onCancel} disabled={busy}>Bỏ qua</Button>
          <Button
            variant="primary"
            disabled={!!blocked || busy}
            title={blocked || undefined}
            onClick={() => onApprove(
              manifestToApprove({ effectiveManifest, inferred, summary }),
              coverage,
            )}
          >
            {busy ? "Đang duyệt…" : "Ký duyệt"}
          </Button>
        </>
      }
    >
      <div className="stack" style={{ gap: "var(--s3)" }}>
        <div className="callout" data-kind="stop">
          <span className="lbl">Duyệt là mở đường cho script chạy trong AutoCAD</span>
          <p>
            Chỉ resource <strong>đã duyệt</strong> mới nạp được. Chữ ký này ghi lại rằng{" "}
            <strong>bạn</strong> đã xem nội dung dưới đây, kèm phạm vi đã đọc và
            hash của source lúc ký. Sửa file sau đó là bản duyệt tự thành “đã cũ”.
          </p>
        </div>

        <div>
          <div className="eyebrow">
            Source · {complete ? "toàn bộ file" : "không đọc được"}
          </div>
          {complete ? (
            <pre
              className="mono"
              style={{
                maxHeight: 260,
                overflow: "auto",
                fontSize: 12,
                lineHeight: 1.5,
                padding: "var(--s3)",
                border: "1px solid var(--border)",
                borderRadius: "var(--r-sm)",
                background: "var(--bg)",
                whiteSpace: "pre",
              }}
            >
              {source}
            </pre>
          ) : (
            <div className="callout" data-kind="warn">
              <p>
                Máy chủ không trả source — mã đã biên dịch, hoặc file quá 4 MB.
                Bạn vẫn duyệt được, nhưng bản duyệt sẽ ghi rõ là{" "}
                <strong>chỉ đọc metadata</strong>, và nó theo resource này mãi.
              </p>
            </div>
          )}
        </div>

        {/* Phân tích tĩnh của daemon. Hiện ra để người đọc đối chiếu với source
            chứ không phải để tin thay việc đọc. */}
        {inferred ? (
          <div className="stack" style={{ gap: "var(--s2)" }}>
            <div className="eyebrow">Daemon đọc được từ file này</div>
            <InferredRow label="Lệnh" value={inferred.commands} />
            <InferredRow label="Hàm" value={inferred.functions} />
            <InferredRow label="Phụ thuộc" value={inferred.dependencies} />
            <InferredRow label="Lệnh AutoCAD gọi" value={inferred.cadCommands} />
            <InferredRow label="Biến hệ thống đụng tới" value={inferred.systemVariables} />
            <InferredRow label="Tệp tham chiếu" value={inferred.fileReferences} />
          </div>
        ) : null}

        <div className="field">
          <label htmlFor={`${fieldId}-summary`}>Script này làm gì</label>
          <textarea
            id={`${fieldId}-summary`}
            className="input"
            rows={3}
            value={summary}
            placeholder="VD: Gán mọi đối tượng trên layer 0 sang A-WALL. Không hỏi lại, không hoàn tác."
            onChange={(event) => setSummary(event.target.value)}
          />
          <span className="hint">
            Bắt buộc — đây là trường duy nhất máy chủ đòi. Viết cho người sau đọc,
            không phải cho máy.
          </span>
        </div>

        <label className="check">
          <input
            type="checkbox"
            checked={readAck}
            onChange={(event) => setReadAck(event.target.checked)}
          />
          <span>
            {complete
              ? "Tôi đã đọc hết source ở trên và chịu trách nhiệm cho bản duyệt này"
              : "Tôi chịu trách nhiệm cho bản duyệt này"}
          </span>
        </label>

        {!complete ? (
          <label className="check">
            <input
              type="checkbox"
              checked={incompleteAck}
              onChange={(event) => setIncompleteAck(event.target.checked)}
            />
            <span>
              Tôi biết mình đang duyệt <strong>mà không đọc được source</strong>
            </span>
          </label>
        ) : null}

        {error ? (
          <div className="callout" data-kind="stop">
            <span className="lbl">Không duyệt được</span>
            <p>{error}</p>
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

function InferredRow({ label, value }: { label: string; value: unknown }) {
  const items = Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
  if (!items.length) return null;
  return (
    <div className="row" style={{ gap: "var(--s3)", alignItems: "baseline" }}>
      <span className="hint" style={{ minWidth: 150 }}>{label}</span>
      <span className="mono" style={{ fontSize: 12 }}>{items.join(" · ")}</span>
    </div>
  );
}

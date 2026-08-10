"use client";

/** Thư viện AutoLISP. **Chỉ đọc.**
 *
 * Vì sao duyệt manifest KHÔNG dựng ở đây được bằng một lượt sửa giao diện —
 * đọc `apps/daemon/src/lispLibrary.ts` và `apps/desktop/main.js`:
 *
 *  1. `POST /:id/approval-challenge` đòi một `userProof` **ký bằng Ed25519**.
 *  2. Khoá riêng nằm trong tiến trình chính của app desktop; trình duyệt chỉ
 *     với tới nó qua `window.acadStudio.signReview` do preload phơi ra.
 *  3. Daemon kiểm bằng `ACAD_REVIEW_PUBLIC_KEY`, và biến đó **chỉ được đặt khi
 *     daemon do app desktop khởi chạy**. Daemon chạy tay thì không có khoá công
 *     khai, và mọi lượt duyệt bị từ chối — kể cả từ app desktop.
 *
 * Nói cách khác, duyệt là một thao tác của **app desktop**, không phải của web.
 * Màn hình này nói thẳng điều đó thay vì vẽ một nút "Duyệt" rồi để nó ném lỗi.
 *
 * Còn ở màn hình cũ: phân tích bằng agent, duyệt manifest, nạp script, quản lý
 * thư mục gốc. Chúng gắn với luồng chat (`askAgent` sinh đề xuất manifest) và sẽ
 * chuyển sang đây ở lượt sau.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "../../../../components/shell/AppShell";
import { Button } from "../../../../components/ui/Button";
import { Tag } from "../../../../components/ui/Tag";
import { Icon } from "../../../../components/ui/icons";
import { useLispLibrary } from "../../../../features/lisp/useLispLibrary";
import { useLispDetail } from "../../../../features/lisp/useLispDetail";
import { useReviewSigner } from "../../../../features/lisp/reviewSigner";
import { ApprovalDialog } from "../../../../features/lisp/ApprovalDialog";
import { approveManifest } from "../../../../features/lisp/approval";
import { LoadDialog } from "../../../../features/lisp/LoadDialog";
import { RootsDialog } from "../../../../features/lisp/RootsDialog";
import {
  addLispRoot,
  importAutocadRoots,
  loadResource,
} from "../../../../features/lisp/actions";
import { WriteButton } from "../../../../components/ui/WriteButton";
import {
  coverageIsComplete,
  coverageLabel,
  formatBytes,
  kindLabel,
  loadBlockLabel,
  resourceMatches,
  reviewLabel,
  warningLabel,
  type LispResource,
  type LispReviewStatus,
} from "../../../../features/lisp/model";
import { DAEMON_BASE } from "../../../../lib/daemon/endpoints";

/** Ánh xạ sang `data-op` của design system để lấy đúng dấu hiệu hình học —
 * người dùng phân biệt được trạng thái mà không cần đọc chữ. */
const REVIEW_OP: Record<LispReviewStatus, string> = {
  approved: "applied",
  stale: "stale",
  unreviewed: "draft",
};

const REVIEW_FILTERS: Array<{ value: string; label: string }> = [
  { value: "", label: "Mọi trạng thái duyệt" },
  { value: "unreviewed", label: "Chưa duyệt" },
  { value: "stale", label: "Bản duyệt đã cũ" },
  { value: "approved", label: "Đã duyệt" },
];

export default function LispLibraryPage() {
  const [query, setQuery] = useState("");
  const [reviewFilter, setReviewFilter] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [loadOpen, setLoadOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [approveError, setApproveError] = useState("");
  const [rootsOpen, setRootsOpen] = useState(false);
  const [inFlight, setInFlight] = useState(false);
  const [rootError, setRootError] = useState("");
  const [rootNotice, setRootNotice] = useState("");
  /** Kết quả lượt nạp gần nhất, gắn với tài nguyên đã sinh ra nó — cùng lý do
   * như `notice` ở `/library/blocks`: giữ toàn cục thì thông báo cũ hiện dưới
   * tài nguyên mới và ngụ ý thao tác vừa rồi áp lên nó. */
  const [loadResultState, setLoadResult] =
    useState<{ ok: boolean; id: string; kind: "load" | "approve"; text: string } | null>(null);
  const library = useLispLibrary(DAEMON_BASE);
  const signer = useReviewSigner();

  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("vi");
    return library.resources.filter((resource) =>
      resourceMatches(resource, needle) &&
      (!reviewFilter || resource.reviewStatus === reviewFilter));
  }, [library.resources, query, reviewFilter]);

  // Tra trong TOÀN danh mục — xem lý do ở `/library/blocks`.
  const selected = library.resources.find((r) => r.id === selectedId) || null;
  const detail = useLispDetail(DAEMON_BASE, selectedId, library.version);

  return (
    <AppShell
      screen="lisp"
      title="Thư viện LISP"
      sub={<>Mã mở rộng AutoCAD · <span className="mono">/lisp</span></>}
      actions={
        <>
          {/* Dùng `refreshing`, không dùng `loading`: `loading` chỉ đúng ở lần
              đọc đầu, nên nút sẽ mở lại ngay sau đó và cho phép bấm chồng nhiều
              lượt quét đĩa — thứ đắt nhất trong màn này. */}
          <Button onClick={() => library.reload(true)} disabled={library.refreshing}>
            {library.refreshing ? "Đang quét…" : "Quét lại đĩa"}
          </Button>
          <Button onClick={() => { setRootError(""); setRootNotice(""); setRootsOpen(true); }}>
            Thư mục gốc
          </Button>
          <Link className="btn" href="/?panel=lisp">
            {signer === "present" ? "Mở màn hình cũ để duyệt" : "Mở màn hình cũ"}
          </Link>
        </>
      }
    >
      {/* Kết luận phải theo MÔI TRƯỜNG ĐANG CHẠY, không viết cứng. Trang này
          cũng được app desktop mở, và ở đó câu "web không duyệt được" là sai —
          đúng loại nói sai mà cả màn hình này tồn tại để tránh. Khi chưa biết
          (lần render đầu, trước hydrate) thì chỉ nói phần luôn đúng. */}
      <div className="banner" data-tone="hard" style={{ margin: "0 0 var(--s3)" }}>
        <span className="bm" />
        <div>
          <strong>
            {signer === "present"
              ? "Duyệt được từ đây — nhưng còn một điều kiện nữa ở phía daemon."
              : signer === "absent"
                ? "Duyệt script là thao tác của app desktop, không phải của web."
                : "Duyệt script cần chữ ký của app Acad Studio desktop."}
          </strong>
          <p>
            Máy chủ đòi một chữ ký Ed25519 do app Acad Studio desktop tạo, và chỉ
            chấp nhận khi <strong>chính app đó khởi chạy daemon</strong>.{" "}
            {signer === "present" ? (
              <>
                Cửa sổ này <strong>có</strong> bộ ký, nên nửa điều kiện đầu đã
                đạt. Nửa còn lại nằm ở daemon và trình duyệt không nhìn thấy
                được: nếu daemon đang chạy được bật bằng tay thì mọi lượt duyệt
                vẫn bị từ chối.
              </>
            ) : signer === "absent" ? (
              <>
                Cửa sổ này <strong>không có</strong> bộ ký, nên không duyệt được
                — không phải vì màn hình thiếu nút, mà vì thiết kế bảo mật cố ý
                như vậy.
              </>
            ) : null}{" "}
            Bản duyệt còn hết hạn sau <strong>2 phút</strong>, nên mỗi lượt duyệt
            phải làm liền một mạch.
          </p>
        </div>
      </div>

      <div className="filterbar" data-od-id="lisp-filters">
        <div className="searchfield" style={{ width: 280 }}>
          <Icon name="search" />
          <input
            className="input"
            value={query}
            placeholder="Tìm theo tên, lệnh hoặc đường dẫn"
            aria-label="Tìm script"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <select
          className="select"
          style={{ width: 200 }}
          aria-label="Lọc theo trạng thái duyệt"
          value={reviewFilter}
          onChange={(event) => setReviewFilter(event.target.value)}
        >
          {REVIEW_FILTERS.map((filter) => (
            <option key={filter.value} value={filter.value}>{filter.label}</option>
          ))}
        </select>
        <span className="tag tag--quiet mono" style={{ marginLeft: "auto" }}>
          {library.refreshing
            ? "đang đọc…"
            : `${shown.length}/${library.counts.total} tài nguyên · ${library.counts.needsReview} chưa duyệt · ${library.roots.length} thư mục gốc`}
        </span>
      </div>

      <div className="split">
        <div className="scroll">
          <div className="pad">
            {library.error && library.resources.length > 0 ? (
              <div className="callout" data-kind="warn" style={{ marginBottom: "var(--s3)" }}>
                <span className="lbl">Danh mục có thể đã cũ</span>
                <p>{library.error}</p>
              </div>
            ) : null}

            {/* Máy chủ cắt bớt kết quả quét thì phải nói ra: im lặng nghĩa là
                người dùng kết luận "không có script nào tên X" trong khi thật
                ra là chưa quét tới. */}
            {library.truncated ? (
              <div className="callout" data-kind="warn" style={{ marginBottom: "var(--s3)" }}>
                <span className="lbl">Danh sách chưa đầy đủ</span>
                <p>
                  Máy chủ đã cắt bớt lượt quét vì có quá nhiều file. Thu hẹp thư
                  mục gốc ở màn hình cũ rồi quét lại.
                </p>
              </div>
            ) : null}

            {library.error && library.resources.length === 0 ? (
              <div className="statebox" data-state="error">
                <strong>Không đọc được thư viện LISP</strong>
                <p className="hint">{library.error}</p>
              </div>
            ) : library.loading ? (
              <div className="statebox"><p className="hint">Đang đọc danh mục…</p></div>
            ) : shown.length === 0 ? (
              <div className="statebox" data-state="empty">
                <strong>Không tìm thấy tài nguyên nào</strong>
                <p className="hint">
                  {library.counts.total === 0
                    ? "Chưa có thư mục gốc nào được quản lý. Thêm ở màn hình cũ rồi quét lại."
                    : "Thử từ khoá khác, hoặc bỏ bộ lọc trạng thái."}
                </p>
              </div>
            ) : (
              <div className="list" role="listbox" aria-label="Script LISP">
                {shown.map((resource) => (
                  <button
                    key={resource.id}
                    type="button"
                    className="listrow"
                    role="option"
                    aria-selected={resource.id === selectedId}
                    style={{ gridTemplateColumns: "1fr auto" }}
                    onClick={() => setSelectedId(resource.id)}
                  >
                    <span>
                      <span className="t">{resource.name}</span>
                      <br />
                      <span className="d mono">
                        {resource.commands.length
                          ? resource.commands.slice(0, 3).join(" · ")
                          : resource.pathLabel || resource.extension}
                      </span>
                    </span>
                    <span className="row" style={{ gap: 5 }}>
                      {resource.warnings.length ? (
                        <Tag>{resource.warnings.length} lưu ý</Tag>
                      ) : null}
                      <span
                        className="tag opstate"
                        data-op={REVIEW_OP[resource.reviewStatus]}
                      >
                        {reviewLabel(resource.reviewStatus)}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside className="detail" aria-label="Chi tiết script" data-od-id="lisp-detail">
          {selected ? (
            <ResourceDetail
              resource={selected}
              notice={loadResultState?.id === selected.id ? loadResultState : null}
              inFlight={inFlight}
              canApprove={signer === "present"}
              onLoad={() => { setLoadResult(null); setLoadOpen(true); }}
              onApprove={() => { setApproveError(""); setApproveOpen(true); }}
            />
          ) : (
            <div className="pad">
              <div className="statebox" data-state="empty">
                <strong>Chọn một script</strong>
                <p className="hint">
                  Đọc hết source trước khi duyệt — chữ ký duyệt là chữ ký vào
                  đúng nội dung bạn đã đọc.
                </p>
              </div>
            </div>
          )}
        </aside>
      </div>

      {loadOpen && selected ? (
        <LoadDialog
          resource={selected}
          revision={detail.revision}
          revisionLoading={detail.loading}
          revisionError={detail.error}
          busy={inFlight}
          onCancel={() => setLoadOpen(false)}
          onLoad={() => {
            const resource = selected;
            /* Đóng hộp thoại ngay: máy chủ chờ AutoCAD tới 15 giây và có thể
               trả `state: "sent"` — giữ hộp chặn màn hình suốt quãng đó chắn
               đúng lúc người ta cần nhìn sang AutoCAD. */
            setLoadOpen(false);
            setInFlight(true);
            void loadResource(DAEMON_BASE, resource.id, detail.revision, "").then((result) => {
              setInFlight(false);
              setLoadResult({
                ok: result.ok,
                id: resource.id,
                kind: "load",
                text: result.ok ? result.hint : result.error,
              });
              /* Quét lại: nạp xong máy chủ có thể gắn cảnh báo
                 `staged_support_paths_added_to_autocad_session` cho tài nguyên. */
              library.reload();
            });
          }}
        />
      ) : null}

      {approveOpen && selected ? (
        <ApprovalDialog
          resource={selected}
          revision={detail.revision}
          source={detail.source}
          effectiveManifest={detail.effectiveManifest}
          inferred={detail.inferred}
          signerPresent={signer === "present"}
          busy={inFlight}
          error={approveError}
          onCancel={() => setApproveOpen(false)}
          onApprove={(manifest, coverage) => {
            const resource = selected;
            setApproveError("");
            setInFlight(true);
            void approveManifest(DAEMON_BASE, {
              resourceId: resource.id,
              baseRevision: detail.revision,
              manifest,
              analysisCoverage: coverage,
            }).then((result) => {
              setInFlight(false);
              if (result.ok) {
                setApproveOpen(false);
                setLoadResult({ ok: true, id: resource.id, kind: "approve", text: result.hint });
              } else {
                /* GIỮ hộp thoại mở khi hỏng: người dùng vừa gõ một câu tóm tắt
                   và tích hai ô xác nhận: đóng lại là bắt làm lại từ đầu. */
                setApproveError(result.error);
              }
              library.reload();
            });
          }}
        />
      ) : null}

      {rootsOpen ? (
        <RootsDialog
          roots={library.roots}
          busy={inFlight}
          error={rootError}
          notice={rootNotice}
          onClose={() => setRootsOpen(false)}
          onAdd={(path, label) => {
            setRootError("");
            setRootNotice("");
            setInFlight(true);
            return addLispRoot(DAEMON_BASE, path, label).then((result) => {
              setInFlight(false);
              if (result.ok) {
                setRootNotice(`Đã thêm “${result.root.label}”. Quét lại để đọc thư mục này.`);
              } else {
                setRootError(result.error);
              }
              /* Tải lại dù thành công hay không: thêm gốc thành công thì danh
                 sách phải đổi, còn hỏng vì trùng đường dẫn thì danh sách hiện
                 tại mới là câu trả lời. */
              library.reload();
              return result.ok;
            });
          }}
          onImport={() => {
            setRootError("");
            setRootNotice("");
            setInFlight(true);
            void importAutocadRoots(DAEMON_BASE, "").then((result) => {
              setInFlight(false);
              if (result.ok) {
                setRootNotice(
                  `Thêm ${result.added.length} thư mục` +
                  (result.skippedCount ? `, bỏ qua ${result.skippedCount} đường dẫn không dùng được` : "") +
                  ". Quét lại để đọc chúng.",
                );
              } else {
                setRootError(result.error);
              }
              library.reload();
            });
          }}
        />
      ) : null}
    </AppShell>
  );
}

function ResourceDetail({ resource, notice, inFlight, canApprove, onLoad, onApprove }: {
  resource: LispResource;
  notice: { ok: boolean; kind: "load" | "approve"; text: string } | null;
  inFlight: boolean;
  /** Cửa sổ này có bộ ký của app desktop không. */
  canApprove: boolean;
  onLoad: () => void;
  onApprove: () => void;
}) {
  return (
    <div className="pad stack" style={{ gap: "var(--s3)" }}>
      <div>
        <div className="eyebrow">Tài nguyên</div>
        <h2 style={{ fontSize: 16 }}>{resource.name}</h2>
        <div className="mono hint">{resource.pathLabel || resource.id}</div>
      </div>

      <Row label="Trạng thái duyệt" value={reviewLabel(resource.reviewStatus)} />

      {/* "Đã duyệt" một mình không nói được gì. Thứ quyết định chữ ký ấy đáng
          tin tới đâu là NGƯỜI DUYỆT ĐỌC ĐƯỢC BAO NHIÊU source — daemon có ghi
          lại (`manifest.review`), nên giấu nó đi là giấu đúng thông tin quan
          trọng nhất. */}
      {resource.review ? (
        <div
          className="callout"
          data-kind={coverageIsComplete(resource.review.analysisCoverage) ? undefined : "warn"}
        >
          <span className="lbl">
            Phạm vi đã đọc lúc duyệt: {coverageLabel(resource.review.analysisCoverage)}
          </span>
          {coverageIsComplete(resource.review.analysisCoverage) ? null : (
            <p>
              Bản duyệt này <strong>không</strong> dựa trên việc đọc hết source.
              {resource.review.acknowledgedIncomplete
                ? " Người duyệt đã xác nhận biết điều đó."
                : " Và không có xác nhận nào được ghi lại."}
            </p>
          )}
          <span className="mono hint" style={{ fontSize: 11 }}>
            {resource.review.reviewedAt || "không rõ thời điểm"}
            {resource.review.reviewedBy ? ` · ${resource.review.reviewedBy}` : ""}
          </span>
        </div>
      ) : null}

      {/* Hash lúc duyệt khác hash bây giờ = file đã đổi. `reviewStatus` cũng
          thành `stale`, nhưng nói bằng con số thì kiểm chứng được. */}
      {resource.review &&
       resource.review.approvedSourceHash &&
       resource.sourceHash &&
       resource.review.approvedSourceHash !== resource.sourceHash ? (
        <div className="callout" data-kind="stop">
          <span className="lbl">File đã đổi sau khi duyệt</span>
          <p>
            Duyệt trên{" "}
            <span className="mono">{resource.review.approvedSourceHash.slice(0, 12)}</span>, hiện tại
            là <span className="mono">{resource.sourceHash.slice(0, 12)}</span>. Bản duyệt cũ không
            còn nói về nội dung này nữa.
          </p>
        </div>
      ) : null}
      <Row label="Loại" value={kindLabel(resource.kind)} />
      <Row label="Kích thước" value={formatBytes(resource.sizeBytes)} />
      {resource.modifiedAt ? <Row label="Sửa lần cuối" value={resource.modifiedAt} mono /> : null}
      {resource.sourceHash ? (
        <Row label="Hash source" value={resource.sourceHash.slice(0, 16)} mono />
      ) : null}

      {/* Không đọc được source thì không phân tích được, nên không duyệt có cơ
          sở được. Đây là điều kiện nặng nhất của cả luồng, phải nói to. */}
      {!resource.readable ? (
        <div className="callout" data-kind="stop">
          <span className="lbl">Không đọc được source</span>
          <p>
            Đây là mã đã biên dịch. Không đọc được thì không phân tích được, và
            duyệt một thứ mình chưa đọc thì chữ ký duyệt không có nghĩa gì.
          </p>
        </div>
      ) : null}

      {!resource.loadable && resource.loadBlockReason ? (
        <div className="callout" data-kind="warn">
          <span className="lbl">Không nạp được vào AutoCAD</span>
          <p>{loadBlockLabel(resource.loadBlockReason)}</p>
        </div>
      ) : null}

      {resource.warnings.length ? (
        <div className="stack" style={{ gap: "var(--s2)" }}>
          <div className="eyebrow">Lưu ý từ máy chủ</div>
          {resource.warnings.map((code) => (
            <div className="callout" data-kind="warn" key={code}>
              <p>{warningLabel(code)}</p>
              <span className="mono hint" style={{ fontSize: 11 }}>{code}</span>
            </div>
          ))}
        </div>
      ) : null}

      {resource.commands.length ? (
        <Row label="Lệnh" value={resource.commands.join(" · ")} mono />
      ) : null}
      {resource.functions.length ? (
        <Row label="Hàm" value={resource.functions.slice(0, 12).join(" · ")} mono />
      ) : null}
      {resource.dependencies.length ? (
        <div>
          <div className="eyebrow">Phụ thuộc</div>
          <div className="mono" style={{ fontSize: 12 }}>
            {resource.dependencies.join(" · ")}
          </div>
          <p className="hint">
            Máy chủ từ chối duyệt tài nguyên này khi một phụ thuộc chưa được
            duyệt.
          </p>
        </div>
      ) : null}

      <Row
        label="Manifest"
        value={resource.manifest ? "đã có" : "chưa có"}
      />

      {notice ? (
        <div className="callout" data-kind={notice.ok ? undefined : "stop"}>
          {/* Duyệt và nạp là hai việc khác nhau; dùng chung một tiêu đề sẽ báo
              "đã gửi lệnh nạp" cho một lượt duyệt không gửi lệnh nào. */}
          <span className="lbl">
            {notice.kind === "approve"
              ? (notice.ok ? "Đã duyệt" : "Không duyệt được")
              : (notice.ok ? "Đã gửi lệnh nạp" : "Không nạp được")}
          </span>
          <p>{notice.text}</p>
        </div>
      ) : null}

      <div className="row" style={{ gap: "var(--s2)" }}>
        <WriteButton variant="primary" onClick={onLoad} disabled={inFlight}>
          {inFlight ? "Đang nạp…" : "Nạp vào AutoCAD"}
        </WriteButton>
        {/* Nút duyệt LUÔN hiện, kể cả khi không ký được — ẩn đi thì người dùng
            trong trình duyệt không biết có việc này, còn hiện kèm lý do thì họ
            biết phải mở ở đâu. Nút bị khoá nói lý do qua `title`. */}
        <Button
          onClick={onApprove}
          disabled={inFlight || !canApprove}
          title={canApprove ? undefined : "Cần app Acad Studio desktop để ký duyệt"}
        >
          {resource.reviewStatus === "approved" ? "Duyệt lại" : "Duyệt"}
        </Button>
      </div>

      <div className="callout" style={{ marginTop: "auto" }}>
        <p className="hint">
          Chưa dựng ở đây: nhờ agent phân tích rồi đề xuất manifest.{" "}
          <Link href="/?panel=lisp">Mở thư viện LISP ở màn hình cũ</Link>. Duyệt
          thì làm ngay tại đây được — nhưng phải mở trong app desktop.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className={mono ? "mono" : undefined} style={{ fontSize: mono ? 12 : 13 }}>
        {value}
      </div>
    </div>
  );
}

"use client";

/** Nạp một resource LISP vào phiên AutoCAD đang chạy.
 *
 * Dùng `ConfirmSheet` với `mode="session"` — không phải `"immediate"`. Khác
 * nhau ở một câu: `"immediate"` bảo người dùng gõ `UNDO` để hoàn tác, mà `UNDO`
 * **không** gỡ được mã đã nạp. Chỉ đường thoát sai còn tệ hơn không chỉ.
 *
 * Guardstrip ở đây là guardstrip **thật**: cả ba điều kiện đều đọc được từ chính
 * danh mục mà máy chủ sẽ đọc lại, nên tick/chéo là kết luận có cơ sở, không
 * phải trang trí. Khác hẳn hộp tạo block — ở đó điều kiện nằm trong AutoCAD và
 * app không kiểm được, nên mọi hàng để `pending`.
 */
import { ConfirmSheet } from "../../components/ui/ConfirmSheet";
import { loadBlockLabel, reviewLabel, type LispResource } from "./model";

export function LoadDialog({ resource, revision, revisionLoading, revisionError, busy, onLoad, onCancel }: {
  resource: LispResource;
  /** `manifestRevision` từ `GET /lisp/:id`. Rỗng = chưa đọc được. */
  revision: string;
  revisionLoading: boolean;
  revisionError: string;
  busy: boolean;
  onLoad: () => void;
  onCancel: () => void;
}) {
  const approved = resource.reviewStatus === "approved";
  const blocked = !resource.loadable
    ? resource.loadBlockReason
      ? loadBlockLabel(resource.loadBlockReason)
      : "Tài nguyên này không nạp được."
    : !approved
      ? `Chỉ nạp được tài nguyên đã duyệt — hiện là “${reviewLabel(resource.reviewStatus)}”.`
      : revisionLoading
        ? "Đang đọc revision của tài nguyên…"
        : !revision
          ? revisionError || "Chưa đọc được revision nên không gửi lệnh nạp được."
          : "";

  return (
    <ConfirmSheet
      title="Nạp vào phiên AutoCAD"
      mode="session"
      summary={`Nạp “${resource.name}” vào phiên AutoCAD đang chạy.`}
      confirmLabel="Nạp ngay"
      busy={busy}
      blocked={blocked}
      onCancel={onCancel}
      onConfirm={onLoad}
    >
      <div className="callout" data-kind="stop">
        <span className="lbl">Nạp là chạy mã, không chỉ là đọc file</span>
        <p>
          AutoCAD <strong>thực thi</strong> file ngay khi nạp. Biểu thức nào nằm
          ở mức cao nhất sẽ chạy luôn — kể cả biểu thức sửa bản vẽ. Chỉ định
          nghĩa hàm thì không sao; đó là điều bản duyệt phải xác nhận.
        </p>
      </div>

      <div className="callout" data-kind="warn">
        <span className="lbl">Phiên AutoCAD bị đổi hai chỗ</span>
        <p>
          Thư mục chứa mã được thêm vào <strong>support path</strong> và vào{" "}
          <strong><code>TRUSTEDPATHS</code></strong> — từ đó AutoCAD tin mã trong
          thư mục ấy mà không hỏi <code>SECURELOAD</code> nữa. Nạp hỏng thì cả hai
          được trả lại như cũ; nạp <strong>xong</strong> thì chúng nằm lại tới khi
          đóng AutoCAD.
        </p>
      </div>

      <div className="guardstrip">
        <div className="gs-head">Điều kiện máy chủ kiểm lại</div>

        <div className="gsrow" data-pass={resource.loadable ? "true" : "false"}>
          <span className="mk" />
          <span className="lbl">
            Định dạng nạp được
            <small>
              {resource.loadable
                ? "Đuôi file này nạp được trên máy hiện tại."
                : resource.loadBlockReason
                  ? loadBlockLabel(resource.loadBlockReason)
                  : "Máy chủ không nạp được tài nguyên này."}
            </small>
          </span>
          <span className="src">loadable</span>
        </div>

        <div className="gsrow" data-pass={approved ? "true" : "false"}>
          <span className="mk" />
          <span className="lbl">
            Đã duyệt
            <small>
              {approved
                ? "Manifest đã qua duyệt."
                : `Hiện là “${reviewLabel(resource.reviewStatus)}”. Duyệt trong app desktop trước.`}
            </small>
          </span>
          <span className="src">reviewStatus</span>
        </div>

        {/* Phụ thuộc: app KHÔNG kiểm được. Danh mục chỉ trả tên tham chiếu
            (`cty/common.lsp`), còn việc phân giải tên đó ra tài nguyên nào là
            logic của máy chủ. Vẽ tick ở đây là đoán. */}
        {resource.dependencies.length ? (
          <div className="gsrow" data-pass="pending">
            <span className="mk" />
            <span className="lbl">
              {resource.dependencies.length} phụ thuộc cũng phải đã duyệt
              <small>
                App không phân giải được tham chiếu thành tài nguyên — máy chủ kiểm
                và sẽ nói rõ cái nào thiếu: {resource.dependencies.join(" · ")}
              </small>
            </span>
            <span className="src">dependencies</span>
          </div>
        ) : null}
      </div>
    </ConfirmSheet>
  );
}

"use client";

/** Thư mục gốc của thư viện LISP: xem, thêm tay, hoặc lấy từ AutoCAD.
 *
 * Khác nguồn của thư viện block ở hai chỗ, và cả hai đều dễ nhầm:
 *
 *  · đây là **thư mục**, không phải file — `addRoot()` từ chối nếu không phải
 *    directory;
 *  · thêm thư mục gốc **có** tác dụng ngay: lượt quét sau sẽ đọc nó. Thêm nguồn
 *    của thư viện block thì không quét gì cả.
 *
 * Không dùng `ConfirmSheet`: ghi vào cấu hình thư viện, không chạm AutoCAD.
 * Riêng "Lấy từ AutoCAD" **có** chạm — nó chạy một job LISP để đọc
 * `ACADPREFIX` — nhưng chỉ đọc, nên vẫn không cần cảnh báo không-hoàn-tác.
 */
import { useId, useState } from "react";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { WriteButton } from "../../components/ui/WriteButton";
import type { LispRoot } from "./model";

export function RootsDialog({ roots, busy, error, notice, onAdd, onImport, onClose }: {
  roots: LispRoot[];
  busy: boolean;
  error: string;
  notice: string;
  /** Trả `true` khi máy chủ đã ghi — form chỉ xoá trắng khi đó. */
  onAdd: (path: string, label: string) => Promise<boolean>;
  onImport: () => void;
  onClose: () => void;
}) {
  const fieldId = useId();
  const [path, setPath] = useState("");
  const [label, setLabel] = useState("");

  const trimmed = path.trim();
  /* Ba phép kiểm ĐÁNG TIN vì chúng lặp lại đúng điều kiện của `addRoot()`:
     đường dẫn rỗng, `~` (máy chủ dùng `realpathSync(resolve(...))` và không nở
     dấu ngã), và gốc quá rộng (`/` hay thư mục nhà bị từ chối thẳng). Phần còn
     lại — có tồn tại không, có phải thư mục không — chỉ máy chủ biết. */
  const invalid = !trimmed
    ? "Chưa có đường dẫn."
    : trimmed.startsWith("~")
      ? "Máy chủ không nở dấu ~ — viết đường dẫn tuyệt đối đầy đủ."
      : trimmed === "/"
        ? "Máy chủ từ chối lấy gốc hệ thống làm thư mục gốc."
        : "";

  return (
    <Modal
      title="Thư mục gốc của thư viện LISP"
      sub="GET · POST /api/acad/lisp/roots"
      wide
      onClose={onClose}
      footer={<Button onClick={onClose} disabled={busy}>Đóng</Button>}
    >
      <div className="stack" style={{ gap: "var(--s4)" }}>
        <div>
          <div className="eyebrow">Đang quản lý {roots.length} thư mục</div>
          {roots.length === 0 ? (
            <p className="hint">
              Chưa có thư mục nào, nên danh mục sẽ rỗng dù trên đĩa có script.
            </p>
          ) : (
            <div className="stack" style={{ gap: "var(--s2)", marginTop: "var(--s2)" }}>
              {roots.map((root) => (
                <div key={root.id} className="panel" style={{ padding: "var(--s3)" }}>
                  <strong style={{ fontSize: 13 }}>{root.label}</strong>
                  <div className="mono hint" style={{ fontSize: 12 }}>{root.path}</div>
                </div>
              ))}
            </div>
          )}
          <p className="hint" style={{ marginTop: "var(--s2)" }}>
            Chưa có đường bỏ thư mục gốc — backend không có endpoint đó.
          </p>
        </div>

        <div className="stack" style={{ gap: "var(--s3)" }}>
          <div className="eyebrow">Lấy từ AutoCAD</div>
          <p className="hint">
            Đọc <strong>Support File Search Path</strong> của AutoCAD đang chạy và
            thêm từng đường dẫn làm thư mục gốc. Đây là một job LISP, nên cần
            AutoCAD mở và plugin trả lời. Đường dẫn không tồn tại sẽ bị bỏ qua và
            đếm lại cho bạn.
          </p>
          <div className="row" style={{ gap: "var(--s2)" }}>
            <WriteButton onClick={onImport} disabled={busy}>
              {busy ? "Đang đọc…" : "Lấy support path từ AutoCAD"}
            </WriteButton>
          </div>
        </div>

        <div className="stack" style={{ gap: "var(--s3)" }}>
          <div className="eyebrow">Thêm tay</div>

          <div className="field">
            <label htmlFor={`${fieldId}-path`}>Đường dẫn thư mục</label>
            <input
              id={`${fieldId}-path`}
              className={invalid && trimmed ? "input invalid mono" : "input mono"}
              value={path}
              placeholder="/duong/dan/tuyet-doi/lisp"
              onChange={(event) => setPath(event.target.value)}
              aria-invalid={(!!invalid && !!trimmed) || undefined}
            />
            <span className="hint">
              Một <strong>thư mục</strong>, không phải file — khác với nguồn của
              thư viện block. Không dùng <code>~</code>. Gốc hệ thống và thư mục
              nhà bị máy chủ từ chối vì quá rộng.
            </span>
          </div>

          <div className="field">
            <label htmlFor={`${fieldId}-label`}>Tên gợi nhớ</label>
            <input
              id={`${fieldId}-label`}
              className="input"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
            />
            <span className="hint">Bỏ trống thì lấy tên thư mục.</span>
          </div>

          {error ? (
            <div className="callout" data-kind="stop">
              <span className="lbl">Không thêm được</span>
              <p>{error}</p>
            </div>
          ) : null}
          {notice ? (
            <div className="callout">
              <p>{notice}</p>
            </div>
          ) : null}

          <div className="row" style={{ gap: "var(--s2)" }}>
            <Button
              variant="primary"
              disabled={!!invalid || busy}
              title={invalid || undefined}
              onClick={() => {
                void onAdd(trimmed, label.trim()).then((added) => {
                  if (!added) return;
                  setPath("");
                  setLabel("");
                });
              }}
            >
              {busy ? "Đang thêm…" : "Thêm thư mục gốc"}
            </Button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

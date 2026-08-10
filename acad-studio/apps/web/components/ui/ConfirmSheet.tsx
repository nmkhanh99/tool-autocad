"use client";

/** Hộp xác nhận cho mọi lệnh ghi vào bản vẽ.
 *
 * Ba thứ nó bắt buộc phải nói, và không màn hình nào được tự viết lại:
 *
 *  1. **Ghi cái gì, vào bản vẽ nào.** Người dùng xác nhận một thao tác cụ thể,
 *     không phải xác nhận chung chung.
 *  2. **Không có hoàn tác.** App không giữ journal, không có inverse-op, không
 *     có endpoint hoàn tác. Đường duy nhất quay lại là gõ `UNDO` trong AutoCAD.
 *  3. **Có qua hàng chờ hay không.** Đây là chỗ dễ hiểu nhầm nhất: phần lớn
 *     lệnh ghi là hai pha (chuẩn bị → xác nhận → ghi), nhưng vài đường như chèn
 *     block và chèn bảng BOQ là MỘT PHA — bấm xác nhận là AutoCAD ghi ngay. Gọi
 *     cả hai là "xác nhận" mà không phân biệt sẽ khiến người dùng tưởng còn một
 *     bước nữa để rút lui.
 *
 * Ô tích xác nhận là bắt buộc và cố ý gây ma sát: một lệnh không hoàn tác được
 * không nên chỉ cách một cú bấm nhầm.
 *
 * Nằm ở `components/ui/` chứ không ở `features/staged-ops/`, cùng lý do với
 * `WriteButton`: **mọi** màn hình có lệnh ghi đều cần nó, kể cả những lệnh một
 * pha không hề đi qua hàng chờ. Để nó trong một feature nghĩa là feature khác
 * phải import chéo feature — hoặc tệ hơn, tự viết lại ba cảnh báo này và viết
 * lệch đi.
 */
import { useState, type ReactNode } from "react";
import { Modal } from "./Modal";
import { Button } from "./Button";
import { WriteButton } from "./WriteButton";

export type ConfirmMode =
  /** Máy chủ đã chuẩn bị sẵn thao tác; xác nhận là ghi bản đã xem. */
  | "staged"
  /** Không có bước chuẩn bị — xác nhận là AutoCAD ghi ngay lập tức. */
  | "immediate"
  /** Không chạm bản vẽ, mà đổi **phiên AutoCAD đang chạy**: nạp mã, thêm
   * support path, sửa `TRUSTEDPATHS`. Phải tách riêng vì câu "gõ `UNDO` để
   * hoàn tác" là SAI ở đây — `UNDO` không gỡ được mã đã nạp. Nói nhầm một
   * đường thoát không tồn tại còn tệ hơn không nói gì. */
  | "session";

export function ConfirmSheet({
  title,
  mode,
  target,
  summary,
  confirmLabel = "Xác nhận & ghi",
  busy = false,
  blocked = "",
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  mode: ConfirmMode;
  /** Bản vẽ sẽ bị ghi. Rỗng nghĩa là bản vẽ đang hoạt động. */
  target?: string;
  /** Một câu nói rõ thao tác chạm vào cái gì. */
  summary: string;
  confirmLabel?: string;
  busy?: boolean;
  /** Lý do chưa ghi được, khi hộp thoại có form bên trong. Rỗng = ghi được.
   * Nó là *lý do*, không phải cờ boolean: một nút ghi bị khoá mà không nói vì
   * sao là một ngõ cụt. */
  blocked?: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const [acked, setAcked] = useState(false);

  return (
    <Modal
      title={title}
      sub={summary}
      onClose={onCancel}
      footer={
        <>
          <label className="check" style={{ marginRight: "auto" }}>
            <input
              type="checkbox"
              checked={acked}
              onChange={(event) => setAcked(event.target.checked)}
            />
            <span>Tôi đã đọc và hiểu thao tác này không hoàn tác được</span>
          </label>
          <Button onClick={onCancel} disabled={busy}>Bỏ qua</Button>
          <WriteButton
            variant="primary"
            disabled={!acked || busy || !!blocked}
            title={blocked || undefined}
            onClick={onConfirm}
          >
            {busy ? "Đang ghi…" : confirmLabel}
          </WriteButton>
        </>
      }
    >
      <div className="stack" style={{ gap: "var(--s3)" }}>
        {mode === "session" ? (
          <div className="callout" data-kind="stop">
            <span className="lbl">Không gỡ ra được</span>
            <p>
              Thao tác này đổi <strong>phiên AutoCAD đang chạy</strong>, không
              ghi vào bản vẽ. <code>UNDO</code> không gỡ được — phiên chỉ trở lại
              như cũ khi bạn đóng AutoCAD.
            </p>
          </div>
        ) : (
          <div className="callout" data-kind="stop">
            <span className="lbl">Không hoàn tác được</span>
            <p>
              App không giữ lịch sử để quay lại. Cách duy nhất hoàn tác là gõ{" "}
              <code>UNDO</code> trong AutoCAD ngay sau đó.
            </p>
          </div>
        )}

        {mode === "immediate" ? (
          <div className="callout" data-kind="warn">
            <span className="lbl">Ghi ngay, không qua hàng chờ</span>
            <p>
              Thao tác này không có bước chuẩn bị. Bấm xác nhận là AutoCAD thực
              hiện ngay — nó sẽ không xuất hiện ở màn Thay đổi chờ duyệt.
            </p>
          </div>
        ) : null}

        {mode === "session" ? (
          <div className="callout" data-kind="warn">
            <span className="lbl">Ghi ngay, không qua hàng chờ</span>
            <p>
              Không có bước chuẩn bị. Bấm xác nhận là AutoCAD nạp ngay — thao tác
              này không xuất hiện ở màn Thay đổi chờ duyệt.
            </p>
          </div>
        ) : null}

        {/* Chế độ `session` KHÔNG ghi vào bản vẽ nào, nên câu "ghi vào bản vẽ
            đang hoạt động" ở đây sẽ mâu thuẫn thẳng với cảnh báo phía trên —
            trong đúng một hộp thoại mà người dùng đang cân nhắc chuyện bảo mật. */}
        {mode === "session" ? (
          <p className="hint">
            Áp lên phiên AutoCAD đang chạy. Không bản vẽ nào bị ghi.
          </p>
        ) : target ? (
          <div>
            <div className="eyebrow">Ghi vào bản vẽ</div>
            <div className="mono" style={{ fontSize: 12 }}>{target}</div>
          </div>
        ) : (
          <p className="hint">Ghi vào bản vẽ đang hoạt động trong AutoCAD.</p>
        )}

        {children}
      </div>
    </Modal>
  );
}

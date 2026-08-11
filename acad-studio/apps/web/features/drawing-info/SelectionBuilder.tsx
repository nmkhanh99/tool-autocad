"use client";

/** Tạo một thao tác có ràng buộc trên tập đối tượng của bản vẽ.
 *
 * Bấm "Chuẩn bị" **không ghi gì** — nó gọi `/selection/prepare`, và bản vẽ chỉ
 * đổi sau khi người dùng xác nhận.
 *
 * ## Hai chỗ cố tình lệch khỏi bộ mẫu
 *
 * **Không có "theo kiểu đối tượng".** `cleanScope()` của daemon chỉ nhận
 * `layer`, `block`, `handles`; mọi thứ khác trả 400. Dựng một ô chọn rồi để nó
 * ném lỗi là tệ hơn không dựng.
 *
 * **Không có "đặt màu theo layer".** Backend có đúng ba thao tác —
 * `activate-document`, `select`, `move-to-layer`. Đổi màu không có, và sẽ không
 * có cho tới khi ai đó viết nó.
 *
 * ## Hai thao tác chạy trên hai TẬP KHÁC NHAU
 *
 * Đây là chỗ dễ gây ghi nhầm nhất của cả màn hình, và không có gì trên giao diện
 * tự gợi ý ra:
 *
 *  - **Chọn** chạy trên **phạm vi** (layer / block) chọn ở đây.
 *  - **Gán sang layer khác** *bỏ qua phạm vi hoàn toàn* — daemon gọi
 *    `captureCurrent()` và ghi lên **bộ chọn hiện tại của AutoCAD**.
 *
 * Nên khi chọn thao tác gán, hai ô phạm vi **biến mất** thay vì đứng đó gợi ý
 * sai. Dựng một ô rồi để nó không có tác dụng còn tệ hơn không dựng: người dùng
 * chọn "layer P-ThoatXi", bấm ghi, và một tập đối tượng khác hẳn bị đổi layer.
 *
 * ## Điều màn hình phải nói ra
 *
 * Danh mục đối tượng của daemon chỉ quét **không gian hiện hành**. Một thao tác
 * chọn "cả layer P-ThoatRua" nghe như chạm tới 125 đối tượng, nhưng thật ra chỉ
 * chạm tới phần nằm trong không gian AutoCAD đang mở.
 */
import { useMemo, useState } from "react";
import { WriteButton } from "../../components/ui/WriteButton";
import type { AcadDocument } from "../../lib/daemon/docs";
import {
  SELECTION_ACTIONS,
  SELECTION_SCOPES,
  actionLabel,
  actionSubjectNote,
  layerRows,
  prepareBlockedReason,
  scopeLabel,
  scopeValues,
  selectionScopeNote,
  type JsonRecord,
  type SelectionActionKind,
  type SelectionScopeKind,
} from "./model";

export type SelectionDraft = {
  scope: SelectionScopeKind;
  value: string;
  action: SelectionActionKind;
  targetLayer: string;
};

export function SelectionBuilder({
  payload, docs, activeFile, busy, profileLoading, staleNote, error, onPrepare, onActivate,
}: {
  payload: JsonRecord | null;
  /** Bản vẽ đang mở trong AutoCAD. Một phần tử thì không có gì để đổi. */
  docs: readonly AcadDocument[];
  /** Đường dẫn bản vẽ mà hồ sơ trên màn hình đang mô tả. */
  activeFile: string;
  busy: boolean;
  /** Hồ sơ đang được đọc lại. Khác `busy`: không có thao tác nào đang chạy,
   * nhưng nội dung trên màn hình đang mô tả một bản vẽ đã cũ. */
  profileLoading: boolean;
  /** Hồ sơ trên màn hình đang mô tả một bản vẽ KHÁC bản vẽ AutoCAD đang mở.
   * Rỗng = khớp. */
  staleNote: string;
  error: string;
  onPrepare: (draft: SelectionDraft) => void;
  onActivate: (file: string) => void;
}) {
  const [scope, setScope] = useState<SelectionScopeKind>("layer");
  const [value, setValue] = useState("");
  const [action, setAction] = useState<SelectionActionKind>("select");
  const [targetLayer, setTargetLayer] = useState("");

  const values = useMemo(
    () => (payload ? scopeValues(payload, scope) : []),
    [payload, scope],
  );
  const layers = useMemo(() => (payload ? layerRows(payload) : []), [payload]);
  /* Đang đọc lại hồ sơ thì danh sách layer/block trên màn hình còn là của bản
     vẽ TRƯỚC. Cho chuẩn bị lúc này là để người dùng chọn "layer A" của bản vẽ
     cũ rồi gửi lên với đích là bản vẽ cũ, trong khi họ tin mình đang làm việc
     với bản vẽ vừa chuyển sang. */
  const blocked = profileLoading
    ? "Đang đọc lại hồ sơ bản vẽ — danh sách bên dưới còn là của bản vẽ trước."
    /* Hồ sơ mô tả bản vẽ khác bản vẽ đang mở: CHẶN, không chỉ cảnh báo. Hai lý
       do độc lập. Một, daemon **bắt buộc** đích của `select`/`move-to-layer`
       phải là bản vẽ đang hoạt động (`requireActive`), nên lượt chuẩn bị chắc
       chắn hỏng — để bấm được rồi báo lỗi là một ngõ cụt. Hai, danh sách layer
       và block bên dưới là của bản vẽ cũ, nên kể cả khi gửi đi được thì người
       dùng cũng đang chọn từ một danh sách không thuộc bản vẽ họ nghĩ. */
    /* Hiện CHÍNH ghi chú, không thay bằng một câu cứng: hồ sơ có thể cũ vì ba
       lý do khác nhau — sai bản vẽ, bản vẽ đã đóng, bản vẽ đã bị sửa — và câu
       "không phải bản vẽ đang mở" chỉ đúng với một trong ba. */
    : staleNote || prepareBlockedReason({ payload, scope, value, action, targetLayer });
  const note = selectionScopeNote(payload);
  const scoped = action === "select";

  return (
    <aside className="picker" aria-label="Tạo bộ chọn">
      <div className="pickpad">
        <div>
          <h2 style={{ fontSize: 13, fontWeight: 640, marginBottom: 4 }}>Tạo thao tác</h2>
          <p className="hint">
            Bấm chuẩn bị <b>không ghi gì</b>. Nó tạo một thao tác chờ xác nhận;
            bản vẽ chỉ đổi sau khi bạn xác nhận.
          </p>
        </div>

        {/* Đổi bản vẽ hoạt động đứng RIÊNG, trên cùng: nó không thao tác trên
            đối tượng nào mà đổi thứ mọi thao tác bên dưới nhắm vào. Gộp nó vào
            danh sách thao tác là mời người dùng chọn "phạm vi: layer A" rồi bấm
            một nút đổi cả bản vẽ. */}
        {docs.length > 1 ? (
          <div className="field">
            <label htmlFor="sel-doc">Bản vẽ đang thao tác</label>
            <select
              className="select"
              id="sel-doc"
              value={activeFile}
              /* Khoá khi đang chuẩn bị một thao tác khác: hai lượt chuẩn bị
                 chạy song song thì lượt về sau ghi đè `pending`, thẻ xác nhận
                 mô tả cái này còn thao tác kia bị bỏ rơi ở máy chủ. */
              disabled={busy || profileLoading}
              onChange={(event) => onActivate(event.target.value)}
            >
              {docs.map((doc) => (
                <option key={doc.file || doc.title} value={doc.file || doc.title || ""}>
                  {doc.title || doc.file}{doc.active ? " · đang hoạt động" : ""}
                </option>
              ))}
            </select>
            <span className="hint">
              Đổi bản vẽ là một lệnh <b>hai pha</b> — nó đổi thứ mọi thao tác
              bên dưới nhắm vào, nên vẫn phải xác nhận.
            </span>
          </div>
        ) : null}

        <div className="field">
          <label htmlFor="sel-action">Thao tác</label>
          <select
            className="select"
            id="sel-action"
            value={action}
            onChange={(event) => setAction(event.target.value as SelectionActionKind)}
          >
            {SELECTION_ACTIONS.map((kind) => (
              <option key={kind} value={kind}>{actionLabel(kind)}</option>
            ))}
          </select>
          <span className="hint">{actionSubjectNote(action, payload)}</span>
        </div>

        {/* Hai ô phạm vi chỉ có tác dụng với thao tác CHỌN — xem chú thích đầu
            tệp. Để chúng đứng đó khi gán layer là gợi ý một ràng buộc không tồn
            tại. */}
        {scoped ? (
        <>
        <div className="field">
          <label htmlFor="sel-scope">Phạm vi</label>
          <select
            className="select"
            id="sel-scope"
            value={scope}
            onChange={(event) => {
              setScope(event.target.value as SelectionScopeKind);
              /* Giá trị cũ thuộc danh sách cũ. Giữ lại là gửi lên một tên layer
                 dưới danh nghĩa tên block. */
              setValue("");
            }}
          >
            {SELECTION_SCOPES.map((kind) => (
              <option key={kind} value={kind}>{scopeLabel(kind)}</option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="sel-value">Giá trị</label>
          <select
            className="select"
            id="sel-value"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          >
            <option value="">— chọn —</option>
            {values.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
        </>
        ) : null}

        {action === "move-to-layer" ? (
          <div className="field">
            <label htmlFor="sel-target">Layer đích</label>
            <select
              className="select"
              id="sel-target"
              value={targetLayer}
              onChange={(event) => setTargetLayer(event.target.value)}
            >
              <option value="">— chọn —</option>
              {layers.map((row) => (
                <option key={row.name} value={row.name}>
                  {row.name}{row.locked ? " · khoá" : ""}{row.frozen ? " · đóng băng" : ""}
                </option>
              ))}
            </select>
          </div>
        ) : null}

        {scoped && note ? <p className="hint">{note}</p> : null}

        <WriteButton
          variant="primary"
          disabled={!!blocked || busy}
          title={blocked || undefined}
          onClick={() => onPrepare({ scope, value, action, targetLayer })}
        >
          {busy ? "Đang chuẩn bị…" : "Chuẩn bị thao tác"}
        </WriteButton>
        {blocked ? <span className="hint">{blocked}</span> : null}

        {error ? (
          <div className="callout" data-kind="stop">
            <span className="lbl">Không chuẩn bị được</span>
            <p>{error}</p>
          </div>
        ) : null}
      </div>
    </aside>
  );
}

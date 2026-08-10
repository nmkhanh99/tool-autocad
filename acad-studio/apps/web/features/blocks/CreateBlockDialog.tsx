"use client";

/** Tạo định nghĩa block từ bộ chọn đang có trong AutoCAD.
 *
 * Dựng **bên trong** `ConfirmSheet` chứ không phải một Modal riêng. Đây là lệnh
 * ghi vào bản vẽ, nên nó phải mang đúng ba cảnh báo bắt buộc — và cách chắc
 * chắn nhất để không viết lại chúng lệch đi là dùng lại chính component đó, đưa
 * form vào làm `children`.
 *
 * Về bộ chọn: màn hình này **không** hiện số đối tượng đang chọn.
 * `GET /api/acad/selection/current` đọc được con số ấy, nhưng nó cũ đi ngay khi
 * người dùng chuyển sang AutoCAD — mà chuyển sang AutoCAD lại đúng là việc họ
 * phải làm. Một dòng "đang chọn 0 đối tượng" đứng yên trong lúc người ta vừa
 * chọn xong 12 đối tượng thì tệ hơn là không hiện gì. Máy chủ kiểm ngay và trả
 * lỗi rõ, nên chỗ này nói **yêu cầu** thay vì đoán **trạng thái**.
 */
import { useId, useState } from "react";
import { ConfirmSheet } from "../../components/ui/ConfirmSheet";
import {
  TECHNICAL_NAME_PATTERN,
  emptyBlock,
  type BlockDefinition,
  type BlockSpace,
} from "./model";

const SPACES: Array<{ value: BlockSpace; label: string }> = [
  { value: "model", label: "Model" },
  { value: "layout", label: "Layout" },
];

export function CreateBlockDialog({ existingNames, busy, onCreate, onCancel }: {
  /** Tên kỹ thuật đã có trong thư viện, để chặn trùng ngay tại chỗ. Đây là phép
   * kiểm **đáng tin**: máy chủ so trên cùng danh mục mà màn hình đang đọc. */
  existingNames: string[];
  busy: boolean;
  onCreate: (block: BlockDefinition) => void;
  onCancel: () => void;
}) {
  const fieldId = useId();
  const [technicalName, setTechnicalName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [defaultLayer, setDefaultLayer] = useState("0");
  const [allowedSpaces, setAllowedSpaces] = useState<BlockSpace[]>(["model"]);

  const name = technicalName.trim();
  const nameLooksWrong = name.length > 0 && !TECHNICAL_NAME_PATTERN.test(name);
  const duplicate = name.length > 0 && existingNames.some(
    (existing) => existing.toLocaleLowerCase("en-US") === name.toLocaleLowerCase("en-US"));

  const blocked = !name
    ? "Chưa có tên kỹ thuật."
    : nameLooksWrong
      ? "Tên kỹ thuật phải là ASCII, không dấu; chỉ dùng chữ, số, dấu chấm, _ hoặc -."
      : duplicate
        ? `Thư viện đã có định nghĩa tên “${name}”.`
        : !displayName.trim()
          ? "Chưa có tên hiển thị."
          : !allowedSpaces.length
            ? "Chọn ít nhất Model hoặc Layout."
            : "";

  return (
    <ConfirmSheet
      title="Tạo block từ bộ chọn"
      mode="immediate"
      summary="Gom các đối tượng đang chọn trong AutoCAD thành một định nghĩa block mới."
      confirmLabel="Tạo block ngay"
      busy={busy}
      blocked={blocked}
      onCancel={onCancel}
      onConfirm={() => onCreate({
        ...emptyBlock(),
        technicalName: name,
        displayName: displayName.trim(),
        defaultLayer: defaultLayer.trim() || "0",
        allowedSpaces,
      })}
    >
      <div className="callout" data-kind="stop">
        <span className="lbl">Các đối tượng đang chọn sẽ biến mất khỏi bản vẽ</span>
        <p>
          AutoCAD gom chúng vào định nghĩa rồi <strong>xoá khỏi bản vẽ</strong> —
          đây là hành vi của lệnh <code>-BLOCK</code>, không phải lựa chọn của
          app. Gõ <code>OOPS</code> trong AutoCAD ngay sau đó nếu cần lấy lại.
        </p>
      </div>

      {/* `data-pass="pending"` — vòng nét đứt — là đúng trạng thái: app KHÔNG
          kiểm được ba điều này. Đánh dấu tick/chéo ở đây sẽ là bịa ra một phép
          kiểm không tồn tại. Thiếu hẳn `.mk` thì grid `15px 1fr auto` của
          `.gsrow` nhét nhãn vào cột 15px và chữ rơi mỗi dòng một từ. */}
      <div className="guardstrip">
        <div className="gs-head">Phải có sẵn trước khi bấm — app không kiểm hộ được</div>
        <div className="gsrow" data-pass="pending">
          <span className="mk" />
          <span className="lbl">
            Bộ chọn trong AutoCAD
            <small>
              App không tạo được bộ chọn thay bạn. Chọn hình/ATTDEF trong AutoCAD
              trước; máy chủ sẽ từ chối nếu bộ chọn rỗng.
            </small>
          </span>
          <span className="src">selection</span>
        </div>
        <div className="gsrow" data-pass="pending">
          <span className="mk" />
          <span className="lbl">
            Bản vẽ đích đang mở và đang hoạt động
            <small>Lệnh chỉ chạy trên bản vẽ active.</small>
          </span>
          <span className="src">document</span>
        </div>
        <div className="gsrow" data-pass="pending">
          <span className="mk" />
          <span className="lbl">
            Bạn sẽ phải chỉ điểm chèn trong AutoCAD
            <small>
              Sau khi bấm, AutoCAD hỏi điểm chèn. Chuyển sang cửa sổ AutoCAD —
              lệnh chờ tối đa 2 phút rồi bỏ.
            </small>
          </span>
          <span className="src">getpoint</span>
        </div>
      </div>

      <div className="field">
        <label htmlFor={`${fieldId}-technical`}>Tên kỹ thuật</label>
        <input
          id={`${fieldId}-technical`}
          className={nameLooksWrong || duplicate ? "input invalid mono" : "input mono"}
          value={technicalName}
          placeholder="VD: VAN_CONG_DN80"
          onChange={(event) => setTechnicalName(event.target.value)}
          aria-invalid={nameLooksWrong || duplicate || undefined}
        />
        <span className="hint">
          Tên này đi thẳng vào AutoCAD. Nếu bản vẽ đã có block cùng tên, máy chủ
          từ chối — kể cả khi thư viện chưa có.
        </span>
      </div>

      <div className="field">
        <label htmlFor={`${fieldId}-display`}>Tên hiển thị</label>
        <input
          id={`${fieldId}-display`}
          className="input"
          value={displayName}
          onChange={(event) => setDisplayName(event.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor={`${fieldId}-layer`}>Layer mặc định</label>
        <input
          id={`${fieldId}-layer`}
          className="input"
          value={defaultLayer}
          onChange={(event) => setDefaultLayer(event.target.value)}
        />
      </div>

      <div className="field">
        <label>Không gian cho phép</label>
        <div className="row" style={{ gap: "var(--s3)" }}>
          {SPACES.map((space) => (
            <label className="check" key={space.value}>
              <input
                type="checkbox"
                checked={allowedSpaces.includes(space.value)}
                onChange={(event) =>
                  setAllowedSpaces(event.target.checked
                    ? [...allowedSpaces, space.value]
                    : allowedSpaces.filter((s) => s !== space.value))}
              />
              <span>{space.label}</span>
            </label>
          ))}
        </div>
        <span className="hint">
          Máy chủ từ chối nếu bạn đang ở không gian không nằm trong danh sách này.
        </span>
      </div>

      <p className="hint">
        Chỉ tạo được <strong>block tĩnh</strong>. Block động phải dựng trong Block
        Editor của AutoCAD.
      </p>
    </ConfirmSheet>
  );
}

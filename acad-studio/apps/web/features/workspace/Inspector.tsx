"use client";

/** Thuộc tính của đối tượng đang chọn.
 *
 * **Chỉ những trường payload thật sự mang.** Bộ mẫu có hàng "Màu" và
 * "Linetype"; `GET /api/acad/geometry` không trả hai trường đó, nên hai hàng ấy
 * không tồn tại ở đây. Một hàng "Màu: ByLayer" viết cứng đọc y hệt một giá trị
 * đọc được từ bản vẽ, và không có cách nào để người dùng biết đấy là bịa.
 *
 * Cũng không có hàng chiều dài hay diện tích: payload không mang, và tự tính từ
 * toạ độ đã bị chiếu phẳng sẽ cho ra số SAI trên mọi đối tượng nghiêng — đúng
 * loại số mà người ta chép thẳng vào bảng khối lượng.
 */
import { Button } from "../../components/ui/Button";
import {
  degrees,
  fidelityLabel,
  fidelityNote,
  fidelityOf,
  kindLabel,
  shapeLabel,
  type BlockDefs,
  type GeomEntity,
} from "./model";

export function Inspector({
  entity, blocks, onIsolateLayer, onZoomTo, onClear,
}: {
  entity: GeomEntity | null;
  blocks: BlockDefs;
  onIsolateLayer: (layer: string) => void;
  onZoomTo: () => void;
  onClear: () => void;
}) {
  return (
    <aside className="wpane wpane--right" aria-label="Thuộc tính đối tượng">
      <header><h2>Thuộc tính</h2></header>

      {!entity ? (
        <div className="empty" style={{ padding: "32px 16px" }}>
          <strong>Chưa chọn đối tượng</strong>
          <span>Nhấp vào một đối tượng trong khung xem để đọc thuộc tính.</span>
        </div>
      ) : (
        <>
          <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
            <div className="eyebrow">{entity.l}</div>
            <div style={{ fontSize: 15, fontWeight: 620, marginTop: 4 }}>
              {entity.name
                ?? (entity.txt ? `"${entity.txt}"` : null)
                ?? (entity.lines?.[0] ? `"${entity.lines[0]}"` : null)
                ?? shapeLabel(entity)}
            </div>
          </div>

          <FidelityCallout entity={entity} blocks={blocks} />

          <dl className="props">
            <dt>Handle</dt><dd>{entity.h}</dd>
            <dt>Kiểu</dt><dd>{entity.t}</dd>
            <dt>Layer</dt><dd>{entity.l}</dd>
            <dt>Không gian</dt><dd>{entity.sp}</dd>
            <dt>Hình vẽ ra</dt><dd>{shapeLabel(entity)} · {fidelityLabel(fidelityOf(entity, blocks))}</dd>
            {entity.name && blocks[entity.name]?.length ? (
              <><dt>Trong block</dt><dd>{blocks[entity.name].length} đối tượng</dd></>
            ) : null}
            {entity.name ? (<><dt>Tên block</dt><dd>{entity.name}</dd></>) : null}
            {entity.sc ? (<><dt>Tỉ lệ</dt><dd>{entity.sc[0]} × {entity.sc[1]}</dd></>) : null}
            {/* `rot` là RADIAN (`rotation()` của AutoCAD). In thẳng kèm dấu độ là
                một con số sai mà trông vẫn hợp lệ: 90° hiện thành "1.5708°". */}
            {entity.rot ? (<><dt>Góc xoay</dt><dd>{degrees(entity.rot).toFixed(2)}°</dd></>) : null}
            {entity.th ? (<><dt>Cao chữ</dt><dd>{entity.th}</dd></>) : null}
            {entity.lines && entity.lines.length > 1 ? (
              <><dt>Số dòng</dt><dd>{entity.lines.length}</dd></>
            ) : null}
            {entity.r ? (<><dt>Bán kính</dt><dd>{entity.r}</dd></>) : null}
            {entity.p && entity.k !== "poly" ? (
              <><dt>Toạ độ</dt><dd>{entity.p[0]?.toFixed(2)}, {entity.p[1]?.toFixed(2)}</dd></>
            ) : null}
            {entity.k === "poly" && entity.p ? (
              <><dt>Số đỉnh</dt><dd>{Math.floor(entity.p.length / 2)}{entity.closed ? " · khép kín" : ""}</dd></>
            ) : null}
          </dl>

          <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
            <Button onClick={onZoomTo}>Phóng tới đối tượng này</Button>
            <Button onClick={() => onIsolateLayer(entity.l)}>Chỉ hiện layer {entity.l}</Button>
            <Button
              onClick={() => void navigator.clipboard?.writeText(entity.h)}
              title="Handle là cách mọi API khác của app nhận diện đối tượng này"
            >
              Sao chép handle
            </Button>
          </div>

          <div style={{ padding: "0 16px 16px" }}>
            <p className="hint">
              Đây là panel web đọc từ một lượt xuất hình học, <b>không phải bảng Properties
              của AutoCAD</b>. Không có đường nào từ đây ghi ngược vào bản vẽ.
            </p>
          </div>
        </>
      )}

      <div style={{ marginTop: "auto", padding: 16, borderTop: "1px solid var(--border)" }}>
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="mono" style={{ fontSize: 12 }}>
            {entity ? `1 đối tượng · ${entity.h}` : "0 đối tượng"}
          </span>
          <Button variant="quiet" onClick={onClear} disabled={!entity}>Bỏ chọn</Button>
        </div>
      </div>
    </aside>
  );
}

/** Nói ra ngay dưới tên đối tượng nếu hình vẽ ra không phải hình thật. Đặt ở
 * đây chứ không ở cuối danh sách: người dùng đọc từ trên xuống và dừng lại khi
 * đã thấy cái mình cần. */
function FidelityCallout({ entity, blocks }: { entity: GeomEntity; blocks: BlockDefs }) {
  const note = fidelityNote(entity, blocks);
  if (!note) return null;
  const placeholder = fidelityOf(entity, blocks) === "placeholder";
  return (
    <div style={{ padding: "12px 16px", borderBottom: "1px solid var(--border)" }}>
      <div className="callout" data-kind={placeholder ? "stop" : "warn"}>
        <span className="lbl">{placeholder ? "Khung xem chưa có hình của đối tượng này" : "Hình vẽ ra thiếu một phần"}</span>
        <p>{note}</p>
      </div>
    </div>
  );
}

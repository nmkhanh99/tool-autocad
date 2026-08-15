"use client";

/** Bảng dimension của lượt quét, và chỗ chọn **DIM chuẩn** cho lệnh căn hàng.
 *
 * Máy chủ vẫn trả `dimensions` trong kết quả quét; `/review` từng vứt đi. Không
 * có bảng này thì `dimspace` — 1 trong 5 hành động sửa tự động — bị khoá, vì nó
 * đòi `dimBaseHandle` mà màn hình không có chỗ hỏi.
 *
 * ## Vì sao nút chọn nằm TRONG bảng
 *
 * Panel cũ đặt DIM chuẩn bằng một ô thả xuống rời khỏi bảng, tức người dùng phải
 * đối chiếu một handle trong ô với một handle trong bảng. Chọn nhầm DIM chuẩn
 * làm **xô lệch cả hàng** và không hoàn tác được từ app, nên nó phải chọn ngay
 * tại dòng đang nhìn.
 */
import { useMemo } from "react";
import type { Scan, ScanDimension } from "./model";

/** Số thập phân theo locale, hoặc "—" khi không đo được.
 *
 * `NaN` ở đây nghĩa là máy chủ không phát trường đó. Hiện "0" thay cho nó là bịa
 * ra một phép đo — cùng loại lỗi với `area: 0` ở bảng đối tượng. */
function shownNumber(value: number): string {
  return Number.isFinite(value)
    ? value.toLocaleString("vi-VN", { maximumFractionDigits: 2 })
    : "—";
}

function axisLabel(axis: string): string {
  if (axis === "H") return "ngang";
  if (axis === "V") return "dọc";
  return axis || "—";
}

export function DimensionTable({ scan, baseHandle, neededAxis, onPickBase, disabled }: {
  scan: Scan;
  /** Handle của DIM đang làm chuẩn, hoặc rỗng. */
  baseHandle: string;
  /** Trục mà lô đang chọn cần căn (`H`/`V`), hoặc rỗng khi lô chưa có mục căn
   * hàng nào. Chỉ số này mới nhận được chuẩn: `DIMSPACE` lấy MỘT mốc cho cả
   * lệnh, nên một mốc khác trục là căn theo một đường không liên quan. */
  neededAxis: string;
  onPickBase: (handle: string) => void;
  disabled: boolean;
}) {
  const rows = scan.dimensions;

  /* Gộp theo TRỤC rồi tới hàng: `DIMSPACE` căn các DIM **cùng trục**, nên trộn
     DIM ngang với DIM dọc trong một danh sách phẳng là mời chọn một chuẩn không
     căn được gì. Sắp theo toạ độ hàng để những cái lệch nhau lộ ra khi liếc. */
  const grouped = useMemo(() => {
    const byAxis = new Map<string, ScanDimension[]>();
    for (const row of rows) {
      const key = row.axis || "?";
      const list = byAxis.get(key) ?? [];
      list.push(row);
      byAxis.set(key, list);
    }
    return [...byAxis.entries()]
      .map(([axis, list]) => ({
        axis,
        list: [...list].sort((a, b) => {
          if (Number.isFinite(a.row) && Number.isFinite(b.row)) return a.row - b.row;
          return Number.isFinite(a.row) ? -1 : Number.isFinite(b.row) ? 1 : 0;
        }),
      }))
      .sort((a, b) => a.axis.localeCompare(b.axis));
  }, [rows]);

  if (!rows.length) {
    return (
      <section className="panel">
        <header><h2>Dimension của lượt quét</h2></header>
        <div style={{ padding: "var(--s3) var(--s4)" }}>
          <p className="hint" style={{ margin: 0 }}>
            Lượt quét này không đọc được dimension nào.
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <header>
        <h2>Dimension của lượt quét</h2>
        <span className="hint">{rows.length} dim</span>
      </header>

      <div style={{ padding: "var(--s3) var(--s4) 0" }}>
        <p className="hint" style={{ margin: 0 }}>
          Chọn <b>một DIM làm chuẩn</b> để lệnh căn hàng lấy làm mốc. DIM chuẩn
          không bị dời; những cái còn lại căn theo nó, và khoảng cách hàng lấy từ
          hồ sơ.
        </p>
        {neededAxis ? (
          <p className="hint" style={{ margin: "var(--s2) 0 0" }}>
            Lô đang chọn cần căn <b>trục {axisLabel(neededAxis)}</b>, nên chỉ DIM
            cùng trục mới đặt làm chuẩn được.
          </p>
        ) : null}
        {scan.dimensionsTruncated ? (
          <p className="hint" style={{ margin: "var(--s2) 0 0" }}>
            <b>Danh sách đã bị cắt.</b> Lượt quét chạm trần số dòng, nên đây chưa
            phải toàn bộ dimension của bản vẽ — DIM chuẩn bạn cần có thể không nằm
            trong danh sách này.
          </p>
        ) : null}
      </div>

      {grouped.map((group) => {
        /* Khoá nút chọn ở nhóm KHÁC trục với lô. Để bấm được rồi báo lỗi sau là
           bắt người dùng tự suy ra vì sao — trong khi bảng đã biết thừa. */
        const offAxis = !!neededAxis && group.axis.toUpperCase() !== neededAxis;
        return (
        <div key={group.axis} style={{ padding: "var(--s3) var(--s4) 0" }}>
          <div className="pophead">
            Trục {axisLabel(group.axis)} · {group.list.length} dim
            {offAxis ? " · không dùng cho lô đang chọn" : ""}
          </div>
          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr>
                  <th style={{ width: 44 }}>Chuẩn</th>
                  <th>Handle</th>
                  <th>Layer</th>
                  <th>Kiểu</th>
                  <th className="n">Hàng</th>
                  <th className="n">Số đo</th>
                  <th>Chữ</th>
                </tr>
              </thead>
              <tbody>
                {group.list.map((row) => {
                  const chosen = row.handle === baseHandle;
                  return (
                    <tr key={row.handle}
                      /* Dòng đang là chuẩn phải nhìn ra NGAY khi liếc, kể cả khi
                         bảng dài — chọn nhầm chuẩn làm xô lệch cả hàng. Báo bằng
                         nền và độ đậm, không bằng màu: hệ thiết kế này đơn sắc. */
                      style={chosen
                        ? { background: "var(--acc-08)", fontWeight: 600 }
                        : undefined}>
                      <td style={{ textAlign: "center" }}>
                        <input type="radio" name="dim-base" disabled={disabled || offAxis}
                          checked={chosen}
                          aria-label={`Đặt ${row.handle} làm DIM chuẩn`}
                          onChange={() => onPickBase(row.handle)} />
                      </td>
                      <td className="mono">{row.handle}</td>
                      <td className="mono">{row.layer || "—"}</td>
                      <td className="mono">{row.style || "—"}</td>
                      <td className="n mono">{shownNumber(row.row)}</td>
                      <td className="n mono">{shownNumber(row.measurement)}</td>
                      <td>{row.text || "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        );
      })}
      <div style={{ padding: "var(--s3) var(--s4)" }} />
    </section>
  );
}

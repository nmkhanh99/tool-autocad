"use client";

/** Bảng layer của khung xem.
 *
 * ⚠️ **Bật/tắt ở đây chỉ ẩn trong khung xem này.** Daemon không có endpoint bật,
 * tắt, khoá hay đóng băng layer — `POST /api/acad/highlight` còn cố tình trả
 * 409 để chặn đường ghi thẳng. Nên câu chữ không được dùng chữ "ẩn layer" trống
 * không: người dùng sẽ đóng app rồi tưởng bản vẽ đã đổi.
 *
 * Số đối tượng đếm từ đợt hình học ĐÃ TẢI, không lấy bảng layer của bản vẽ. Lý
 * do ở `layersOf()`.
 */
import { useMemo, useState } from "react";
import { Icon } from "../../components/ui/icons";
import type { LayerRow } from "./model";

export function LayerPane({
  layers, hidden, onToggle, onShowAll, onIsolate,
}: {
  layers: readonly LayerRow[];
  hidden: ReadonlySet<string>;
  onToggle: (name: string) => void;
  onShowAll: () => void;
  onIsolate: (name: string) => void;
}) {
  const [query, setQuery] = useState("");

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle ? layers.filter((row) => row.name.toLowerCase().includes(needle)) : layers;
  }, [layers, query]);

  return (
    <aside className="wpane" aria-label="Layer">
      <header>
        <h2>Layer</h2>
        <span className="spacer" />
        <button
          className="btn btn--quiet btn--icon"
          onClick={onShowAll}
          disabled={hidden.size === 0}
          title="Hiện lại tất cả layer trong khung xem"
        >
          <Icon name="sync" />
        </button>
      </header>

      <div style={{ padding: "var(--s2)", borderBottom: "1px solid var(--border)" }}>
        <div className="searchfield">
          <Icon name="search" />
          <input
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Lọc layer"
            aria-label="Lọc layer"
          />
        </div>
      </div>

      <div className="scroll">
        {rows.length === 0 ? (
          <p className="hint" style={{ padding: "var(--s3)" }}>
            {layers.length === 0 ? "Không gian này chưa tải được đối tượng nào." : "Không có layer nào khớp."}
          </p>
        ) : (
          rows.map((row) => {
            const off = hidden.has(row.name);
            return (
              <button
                key={row.name}
                className="layerrow"
                data-off={off}
                aria-pressed={!off}
                style={{ width: "100%" }}
                onClick={(event) => (event.altKey ? onIsolate(row.name) : onToggle(row.name))}
                title={
                  off
                    ? `Hiện lại ${row.name} trong khung xem (⌥ để chỉ hiện layer này)`
                    : `Ẩn ${row.name} khỏi khung xem (⌥ để chỉ hiện layer này)`
                }
              >
                <span className="box" data-checked={!off}><Icon name="tick" /></span>
                <span className="swatch" style={{ background: off ? "transparent" : "var(--fg-55)" }} />
                <span className="name">{row.name}</span>
                <span className="cnt">{row.count}</span>
              </button>
            );
          })
        )}
      </div>

      <div style={{ padding: "var(--s3)", borderTop: "1px solid var(--border)" }}>
        <p className="hint">
          Bật/tắt ở đây <b>chỉ ẩn trong khung xem này</b>. Không có đường nào từ app
          bật, tắt, khoá hay đóng băng layer trong bản vẽ.
        </p>
      </div>
    </aside>
  );
}

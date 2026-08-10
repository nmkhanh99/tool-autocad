"use client";

/** Thư viện block — bản chỉ đọc.
 *
 * Màn hình này duyệt và tra cứu định nghĩa block. Nó **không** cấp đường ghi
 * nào: tạo block từ bộ chọn, chèn vào bản vẽ, đồng bộ định nghĩa và sửa
 * metadata vẫn nằm ở màn hình cũ cho tới khi được dựng lại ở đây.
 *
 * Nói thẳng điều đó trên trang thay vì vẽ nút rồi để nó không làm gì. Trang có
 * liên kết sang màn hình cũ ngay tại chỗ người dùng cần.
 *
 * Hai điểm bám theo bộ mẫu, cố ý:
 *
 *  · KHÔNG có hình xem trước. Dịch vụ block không render thumbnail; vẽ một hình
 *    ở đây là ngụ ý máy chủ biết block trông thế nào, điều nó không biết.
 *  · Giữ đủ **5** trạng thái đồng bộ của backend. Mẫu chỉ vẽ 3 — ép xuống 3 sẽ
 *    gộp mất `conflict`, trạng thái duy nhất người dùng buộc phải xử lý tay.
 */
import { useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "../../../../components/shell/AppShell";
import { Tag } from "../../../../components/ui/Tag";
import { Icon } from "../../../../components/ui/icons";
import { useBlockLibrary } from "../../../../features/blocks/useBlockLibrary";
import {
  blockMatches,
  syncLabel,
  type BlockDefinition,
  type SyncStatus,
} from "../../../../features/blocks/model";
import styles from "./blocks.module.css";
import { DAEMON_BASE } from "../../../../lib/daemon/endpoints";

/** Nhóm lọc của mẫu chỉ có 3 mục, nhưng backend có 5 trạng thái. Ánh xạ tường
 * minh để không mục nào biến mất khỏi bộ lọc. */
const SYNC_FILTERS: Array<{ value: string; label: string; match: SyncStatus[] }> = [
  { value: "", label: "Mọi trạng thái đồng bộ", match: [] },
  { value: "synced", label: "Khớp thư viện", match: ["synced"] },
  { value: "outdated", label: "Bản vẽ dùng bản cũ", match: ["outdated"] },
  { value: "cad_only", label: "Chỉ có trong bản vẽ", match: ["cad_only"] },
  { value: "local_only", label: "Chỉ có trong thư viện", match: ["local_only"] },
  { value: "conflict", label: "Xung đột — cần xử lý tay", match: ["conflict"] },
];

export default function BlocksLibraryPage() {
  const [query, setQuery] = useState("");
  const [syncFilter, setSyncFilter] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const library = useBlockLibrary(DAEMON_BASE, "");

  const shown = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase("vi");
    const filter = SYNC_FILTERS.find((f) => f.value === syncFilter);
    return library.blocks.filter((block) =>
      blockMatches(block, needle) &&
      (!filter?.match.length || filter.match.includes(block.syncStatus)));
  }, [library.blocks, query, syncFilter]);

  const selected = shown.find((b) => b.id === selectedId) || null;

  return (
    <AppShell
      screen="blocks"
      title="Thư viện block"
      sub={<>Định nghĩa block dùng chung · <span className="mono">/blocks · /blocks/sources</span></>}
      actions={
        <Link className="btn" href="/?panel=blocks">Mở màn hình cũ để sửa</Link>
      }
    >
      <div className="filterbar" data-od-id="blocks-filters">
        <div className="searchfield" style={{ width: 260 }}>
          <Icon name="search" />
          <input
            className="input"
            value={query}
            placeholder="Tìm theo tên định nghĩa"
            aria-label="Tìm block"
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <select
          className="select"
          style={{ width: 230 }}
          aria-label="Lọc theo đồng bộ"
          value={syncFilter}
          onChange={(event) => setSyncFilter(event.target.value)}
        >
          {SYNC_FILTERS.map((filter) => (
            <option key={filter.value} value={filter.value}>{filter.label}</option>
          ))}
        </select>
        <span className="tag tag--quiet mono" style={{ marginLeft: "auto" }}>
          {library.loading ? "đang đọc…" : `${shown.length}/${library.blocks.length} định nghĩa · ${library.sources.length} nguồn`}
        </span>
      </div>

      <div className="split">
        <div className="scroll">
          <div className="pad">
            {library.error ? (
              <div className="statebox" data-state="error">
                <strong>Không đọc được thư viện block</strong>
                <p className="hint">{library.error}</p>
              </div>
            ) : library.loading ? (
              <div className="statebox"><p className="hint">Đang đọc danh mục…</p></div>
            ) : shown.length === 0 ? (
              <div className="statebox" data-state="empty">
                <strong>Không tìm thấy định nghĩa nào</strong>
                <p className="hint">
                  {library.blocks.length === 0
                    ? "Thư viện chưa có định nghĩa nào, hoặc chưa quét nguồn."
                    : "Thử từ khoá khác, hoặc bỏ bộ lọc trạng thái."}
                </p>
              </div>
            ) : (
              <div className={styles.blockgrid}>
                {shown.map((block) => (
                  <button
                    key={block.id}
                    type="button"
                    className={styles.blockcard}
                    aria-selected={block.id === selectedId}
                    onClick={() => setSelectedId(block.id)}
                  >
                    {/* Không có hình xem trước — xem ghi chú ở đầu file. */}
                    <span className={styles.prev}>
                      <span className={styles.gl}>{block.technicalName}</span>
                      <span className={styles.np}>không có ảnh xem trước</span>
                    </span>
                    <span className={styles.meta}>
                      <span className={styles.n2}>{block.displayName}</span>
                      <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                        <Tag quiet={block.syncStatus === "synced"}>{syncLabel(block.syncStatus)}</Tag>
                        {block.type === "dynamic" ? <Tag quiet>động</Tag> : null}
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <aside
          className={`detail ${styles.detailPane}`}
          aria-label="Chi tiết block"
          data-od-id="blocks-detail"
        >
          {selected ? <BlockDetail block={selected} /> : (
            <div className={styles.detailPad}>
              <p className="hint">Chọn một định nghĩa để xem chi tiết.</p>
            </div>
          )}
        </aside>
      </div>
    </AppShell>
  );
}

function BlockDetail({ block }: { block: BlockDefinition }) {
  return (
    <div className={styles.detailPad}>
      <div>
        <div className="eyebrow">Định nghĩa</div>
        <h2 style={{ fontSize: 16 }}>{block.displayName}</h2>
        <div className="mono hint">{block.technicalName}</div>
      </div>

      <Row label="Đồng bộ" value={syncLabel(block.syncStatus)} />
      <Row label="Kiểu" value={block.type === "dynamic" ? "Block động" : "Block tĩnh"} />
      <Row label="Thuộc tính" value={block.hasAttributes ? `${block.attributeDefinitions.length} thuộc tính` : "không có"} />
      <Row label="Không gian cho phép" value={block.allowedSpaces.length ? block.allowedSpaces.join(", ") : "chưa khai"} />
      <Row
        label="Điểm chèn"
        value={`${block.basePoint.x}, ${block.basePoint.y}, ${block.basePoint.z}`}
        mono
      />
      {block.category ? <Row label="Nhóm" value={block.category} /> : null}
      {block.tags.length ? <Row label="Thẻ" value={block.tags.join(" · ")} /> : null}
      {block.description ? (
        <div>
          <div className="eyebrow">Mô tả</div>
          <p style={{ fontSize: 13 }}>{block.description}</p>
        </div>
      ) : null}

      <div className="callout" style={{ marginTop: "auto" }}>
        <p className="hint">
          Màn hình này chỉ đọc. Chèn block vào bản vẽ, tạo từ bộ chọn, đồng bộ
          định nghĩa và sửa metadata vẫn ở màn hình cũ — đó là các lệnh ghi và
          chúng chưa được dựng lại ở đây.{" "}
          <Link href="/?panel=blocks">Mở thư viện ở màn hình cũ</Link>.
        </p>
      </div>
    </div>
  );
}

function Row({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <div className="eyebrow">{label}</div>
      <div className={mono ? "mono" : undefined} style={{ fontSize: 13 }}>{value}</div>
    </div>
  );
}

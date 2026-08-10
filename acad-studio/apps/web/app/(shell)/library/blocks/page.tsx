"use client";

/** Thư viện block.
 *
 * Duyệt, tra cứu, và hai lệnh ghi: **chèn vào bản vẽ** và **đồng bộ định nghĩa**.
 * Cả hai là MỘT PHA — máy chủ không có bước chuẩn bị cho chúng, nên chúng không
 * đi qua hàng chờ Thay đổi và `ConfirmSheet` phải nói rõ điều đó.
 *
 * Chưa dựng lại ở đây: tạo block từ bộ chọn, sửa metadata, quản lý thư mục
 * nguồn. Trang nói thẳng và có liên kết sang màn hình cũ, thay vì vẽ nút rồi để
 * nó không làm gì.
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
import { WriteButton } from "../../../../components/ui/WriteButton";
import { Icon } from "../../../../components/ui/icons";
import { ConfirmSheet } from "../../../../features/staged-ops/ConfirmSheet";
import { runBlockAction } from "../../../../features/blocks/actions";
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
  const [pending, setPending] = useState<"insert" | "sync" | null>(null);
  /* Thông báo phải gắn với BLOCK đã sinh ra nó. Giữ nó ở dạng toàn cục thì khi
     người dùng chọn block khác, thông báo cũ hiện dưới block mới và ngụ ý thao
     tác vừa rồi áp lên định nghĩa đó. */
  const [notice, setNotice] = useState<{ ok: boolean; blockId: string; text: string } | null>(null);
  /** Lệnh đang bay. `insert` chờ tới 2 phút, nên không khoá lại thì một cú bấm
   * thứ hai sẽ xếp thêm một lệnh ghi nữa với cùng `expectedRevision`. */
  const [inFlight, setInFlight] = useState(false);
  const library = useBlockLibrary(DAEMON_BASE);

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
          {selected ? (
            <BlockDetail
              block={selected}
              notice={notice?.blockId === selected.id ? notice : null}
              inFlight={inFlight}
              onAction={(action) => { setNotice(null); setPending(action); }}
            />
          ) : (
            <div className={styles.detailPad}>
              <p className="hint">Chọn một định nghĩa để xem chi tiết.</p>
            </div>
          )}
        </aside>
      </div>

      {pending && selected ? (
        <ConfirmSheet
          title={pending === "insert" ? "Chèn block vào bản vẽ" : "Đồng bộ metadata block"}
          mode="immediate"
          summary={pending === "insert"
            ? `Chèn “${selected.displayName}” (${selected.technicalName}) vào bản vẽ đang hoạt động.`
            : `Ghi thông tin mô tả của “${selected.technicalName}” lên định nghĩa đã có trong bản vẽ.`}
          confirmLabel={pending === "insert" ? "Chèn ngay" : "Ghi metadata ngay"}
          onCancel={() => setPending(null)}
          onConfirm={() => {
            const action = pending;
            const block = selected;
            /* Đóng hộp thoại NGAY khi gửi lệnh, không đợi máy chủ trả về.
               Với `insert`, máy chủ chờ tới 2 phút để người dùng chỉ điểm chèn
               TRONG AutoCAD — giữ một hộp thoại chặn màn hình suốt quãng đó là
               chắn đúng lúc người ta cần sang cửa sổ khác, và không có đường
               huỷ nếu lệnh treo. */
            setPending(null);
            setInFlight(true);
            setNotice({
              ok: true,
              blockId: block.id,
              text: action === "insert"
                ? "Đã gửi lệnh. Chuyển sang cửa sổ AutoCAD để chỉ điểm chèn — lệnh chờ tối đa 2 phút."
                : "Đang ghi metadata…",
            });
            void runBlockAction(DAEMON_BASE, action, {
              blockId: block.id,
              target: "",
              expectedRevision: library.revision,
            }).then((result) => {
              setNotice({
                ok: result.ok,
                blockId: block.id,
                text: result.ok ? result.hint : result.error,
              });
              setInFlight(false);
              if (result.ok) library.reload();
            });
          }}
        >
          {pending === "insert" ? (
            <p className="hint">
              AutoCAD sẽ chờ bạn <b>chỉ điểm chèn</b> trong cửa sổ của nó. Chuyển
              sang AutoCAD ngay sau khi xác nhận — lệnh chờ có giới hạn thời gian.
            </p>
          ) : (
            <p className="hint">
              Chỉ ghi <b>metadata</b> — tên, mô tả, nhóm, thẻ — lên định nghĩa
              block đã có trong bản vẽ. <b>Hình học của block không đổi</b>, và
              không thể hiện nào của nó bị vẽ lại. Muốn đổi hình thì phải chèn
              lại định nghĩa từ thư viện.
              {" "}Nếu bản vẽ hiện tại chưa có định nghĩa này, máy chủ sẽ từ chối
              và bảo bạn dùng <b>Chèn vào bản vẽ</b> trước.
            </p>
          )}
        </ConfirmSheet>
      ) : null}
    </AppShell>
  );
}

function BlockDetail({ block, notice, inFlight, onAction }: {
  block: BlockDefinition;
  notice: { ok: boolean; blockId: string; text: string } | null;
  inFlight: boolean;
  onAction: (action: "insert" | "sync") => void;
}) {
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

      {notice ? (
        <div className="callout" data-kind={notice.ok ? undefined : "stop"}>
          <span className="lbl">{notice.ok ? "Đã gửi lệnh" : "Không thực hiện được"}</span>
          <p>{notice.text}</p>
        </div>
      ) : null}

      <div className="row" style={{ gap: "var(--s2)", flexWrap: "wrap" }}>
        <WriteButton variant="primary" onClick={() => onAction("insert")} disabled={inFlight}>
          {inFlight ? "Đang chờ AutoCAD…" : "Chèn vào bản vẽ"}
        </WriteButton>
        {/* KHÔNG chặn theo `syncStatus`: danh mục là toàn cục, không theo bản
            vẽ đang mở (xem ghi chú trong useBlockLibrary). Chặn theo dữ liệu
            không đáng tin còn tệ hơn để máy chủ từ chối kèm lý do rõ ràng. */}
        <WriteButton onClick={() => onAction("sync")} disabled={inFlight}>
          Đồng bộ metadata
        </WriteButton>
      </div>

      <div className="callout" style={{ marginTop: "auto" }}>
        <p className="hint">
          Chưa dựng ở đây: tạo block từ bộ chọn, sửa metadata, quản lý thư mục
          nguồn.{" "}
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

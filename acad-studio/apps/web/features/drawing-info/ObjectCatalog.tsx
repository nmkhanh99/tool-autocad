"use client";

/** Duyệt danh mục đối tượng đã quét, và chọn một tập cụ thể trong AutoCAD.
 *
 * Đây là thứ `/workspace` không làm được: ở đó bạn chọn **một** đối tượng bằng
 * cách bấm vào hình nó. Ở đây bạn lọc theo handle / kiểu / layer rồi tích một
 * tập — cách duy nhất để với tới những đối tượng không nhìn thấy được, hoặc nằm
 * chồng lên nhau.
 *
 * ## Ba giới hạn phải nói ra
 *
 * **Danh mục chỉ có không gian hiện hành.** Daemon quét đúng không gian AutoCAD
 * đang mở. Một bản vẽ 10.000 đối tượng mà đang ở layout thì danh mục có thể chỉ
 * 10 dòng — và con số đó trông y hệt một bản vẽ trống.
 *
 * **Danh mục có thể CHƯA ĐỦ.** `complete: false` nghĩa là lượt quét dừng giữa
 * chừng. Đối tượng thiếu không hiện ra ở đâu cả.
 *
 * **Trần 5.000 handle một lượt** — trần của daemon, không phải của giao diện.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { WriteButton } from "../../components/ui/WriteButton";
import { Icon } from "../../components/ui/icons";
import {
  CATALOG_PAGE_SIZE,
  MAX_PICK_HANDLES,
  catalogNote,
  catalogSubjects,
  filterSubjects,
  pageOf,
  pickBlockedReason,
  type JsonRecord,
} from "./model";

export function ObjectCatalog({
  payload, snapshotKey, staleNote, guardReady, busy, profileLoading, error, onPick,
}: {
  payload: JsonRecord | null;
  /** Danh tính của lượt đọc đang hiển thị. Đổi khoá = danh mục đã là của một
   * lượt đọc khác, có thể của một bản vẽ khác. */
  snapshotKey: string;
  staleNote: string;
  /** Hồ sơ có kèm `instance` + `revision` để làm guard cho lệnh chọn không. */
  guardReady: boolean;
  busy: boolean;
  /** Hồ sơ đang được đọc lại — danh mục dưới đây sắp bị thay. */
  profileLoading: boolean;
  /** Lỗi của LƯỢT CHỌN gần nhất. Phải hiện ngay đây, không dồn chung với ô lỗi
   * của bộ tạo thao tác ở cột bên kia — nút bấm ở đây thì phản hồi cũng phải ở
   * đây, và nhãn "Không chuẩn bị được" bên kia mô tả một việc khác. */
  error: string;
  onPick: (handles: string[]) => void;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());

  /* Bỏ tích khi lượt đọc đổi. Handle của AutoCAD là **cục bộ theo bản vẽ**:
     giữ tập đã tích qua một lượt "Đọc lại" hay một lần đổi bản vẽ nghĩa là gửi
     handle của bản vẽ CŨ kèm guard của bản vẽ MỚI — guard hợp lệ, và cùng một
     handle ở bản vẽ mới trỏ sang một đối tượng hoàn toàn khác. Người dùng xác
     nhận một danh sách rồi AutoCAD chọn thứ khác. */
  const lastSnapshot = useRef(snapshotKey);
  useEffect(() => {
    if (lastSnapshot.current === snapshotKey) return;
    lastSnapshot.current = snapshotKey;
    setPicked(new Set());
    /* Trang cũng về đầu: danh sách mới có thể ngắn hơn hẳn. Riêng ô lọc thì
       GIỮ — đó là ý định của người dùng, không phải trạng thái của dữ liệu. */
    setPage(0);
  }, [snapshotKey]);

  const subjects = useMemo(() => catalogSubjects(payload), [payload]);
  const filtered = useMemo(() => filterSubjects(subjects, query), [subjects, query]);
  const view = pageOf(filtered, page);
  /* Truyền số dòng THẬT: câu ghi chú không được nói "đã đủ" khi bảng đã bỏ bớt
     dòng trùng hoặc thiếu handle. */
  const note = catalogNote(payload, subjects.length);
  const blocked = profileLoading
    ? "Đang đọc lại hồ sơ — danh mục bên dưới sắp bị thay."
    : pickBlockedReason({ count: picked.size, staleNote, guardReady });

  const toggle = (handle: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(handle)) next.delete(handle); else next.add(handle);
    return next;
  });

  /* Tích cả trang chỉ chạm tới TRANG ĐANG XEM, không phải cả kết quả lọc: một
     nút "chọn hết" âm thầm gom 4.000 đối tượng là đúng thứ người ta bấm rồi mới
     đọc. Muốn nhiều hơn thì lọc hẹp lại rồi tích từng trang. */
  const allOnPage = view.rows.length > 0 && view.rows.every((row) => picked.has(row.handle));
  const togglePage = () => setPicked((prev) => {
    const next = new Set(prev);
    if (allOnPage) {
      for (const row of view.rows) next.delete(row.handle);
      return next;
    }
    /* Kẹp theo sức chứa CÒN LẠI. Ô tích từng dòng đã chặn ở trần, nhưng tích cả
       trang thì không — và vượt trần làm nút ghi khoá lại cho tới khi người
       dùng tự bỏ tích từng cái, một ngõ cụt do chính giao diện tạo ra. */
    for (const row of view.rows) {
      if (next.size >= MAX_PICK_HANDLES) break;
      next.add(row.handle);
    }
    return next;
  });

  /* Khoá mọi ô tích trong lúc CHUẨN BỊ, không chỉ trong lúc đọc lại. Đổi tập
     giữa chừng thì thao tác đang chờ mang tập CŨ còn màn hình hiện tập MỚI —
     người dùng xác nhận một danh sách và AutoCAD chọn một danh sách khác. */
  const frozen = profileLoading || busy;

  if (!subjects.length) {
    return (
      <section className="panel">
        <header><h2>Danh mục đối tượng</h2></header>
        <div style={{ padding: "var(--s4)" }}>
          <p className="hint">
            {note || "Lượt quét này không kèm danh mục đối tượng. Bấm “Đọc lại”."}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel">
      <header>
        <h2>Danh mục đối tượng</h2>
        <div className="actions">
          <span className="tag mono">{filtered.length}/{subjects.length}</span>
          {picked.size ? <span className="tag">{picked.size} đã tích</span> : null}
        </div>
      </header>

      <div style={{ padding: "var(--s3) var(--s4)", borderBottom: "1px solid var(--border)" }}>
        <div className="searchfield">
          <Icon name="search" />
          <input
            className="input"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              /* Về trang đầu khi lọc: giữ trang cũ thì kết quả 3 dòng mà đang ở
                 trang 5 sẽ ra bảng trống dù có kết quả. */
              setPage(0);
            }}
            placeholder="Lọc theo handle, kiểu, layer, tên block…"
            aria-label="Lọc đối tượng"
          />
        </div>
        {note ? <p className="hint" style={{ marginTop: "var(--s2)" }}>{note}</p> : null}
      </div>

      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 32 }}>
                <input
                  type="checkbox"
                  checked={allOnPage}
                  disabled={frozen || (!allOnPage && picked.size >= MAX_PICK_HANDLES)}
                  onChange={togglePage}
                  aria-label="Tích cả trang này"
                />
              </th>
              <th className="n" style={{ width: 56 }}>#</th>
              <th>Handle</th><th>Kiểu</th><th>Layer</th><th>Block</th>
            </tr>
          </thead>
          <tbody>
            {view.rows.map((row, index) => (
              <tr key={row.handle}>
                <td>
                  <input
                    type="checkbox"
                    checked={picked.has(row.handle)}
                    /* Chặn ngay ở ô tích khi đã chạm trần — để tích thêm rồi
                       báo lỗi ở nút là bắt người dùng bỏ tích lại từng cái. */
                    disabled={frozen
                      || (!picked.has(row.handle) && picked.size >= MAX_PICK_HANDLES)}
                    onChange={() => toggle(row.handle)}
                    aria-label={`Chọn ${row.handle}`}
                  />
                </td>
                <td className="n mono">{view.from + index + 1}</td>
                <td className="mono">{row.handle}</td>
                <td className="mono">{row.type}</td>
                <td className="mono">{row.layer}</td>
                <td className="mono">{row.blockName}</td>
              </tr>
            ))}
            {!view.rows.length ? (
              <tr><td colSpan={6}><span className="hint">Không có đối tượng nào khớp.</span></td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div
        className="row"
        style={{ padding: "var(--s3) var(--s4)", borderTop: "1px solid var(--border)", gap: "var(--s3)" }}
      >
        <Button onClick={() => setPage(view.page - 1)} disabled={view.page === 0}>‹ Trước</Button>
        <span className="hint mono">
          Trang {view.page + 1}/{view.pages} · {CATALOG_PAGE_SIZE} dòng mỗi trang
        </span>
        <Button onClick={() => setPage(view.page + 1)} disabled={view.page + 1 >= view.pages}>Sau ›</Button>
        <span className="spacer" />
        {picked.size ? (
          /* Khoá cùng lúc với ô tích. `onPick` đã chụp tập handle rồi, nên bỏ
             tích lúc này chỉ xoá thứ NHÌN THẤY — thao tác đang chờ vẫn mang tập
             cũ, và người dùng xác nhận một hộp thoại trong khi màn hình sau lưng
             nói mình chưa chọn gì. */
          <Button onClick={() => setPicked(new Set())} disabled={frozen}>
            Bỏ tích ({picked.size})
          </Button>
        ) : null}
        <WriteButton
          variant="primary"
          disabled={!!blocked || busy}
          title={blocked || undefined}
          onClick={() => onPick([...picked])}
        >
          {busy ? "Đang chuẩn bị…" : `Chọn ${picked.size} đối tượng trong AutoCAD`}
        </WriteButton>
      </div>
      {blocked || error ? (
        <div style={{ padding: "0 var(--s4) var(--s3)" }}>
          <span className="hint">{error || blocked}</span>
        </div>
      ) : null}
    </section>
  );
}

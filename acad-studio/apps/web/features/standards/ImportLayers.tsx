"use client";

/** Nhập bảng layer từ một bản vẽ đang mở — bằng cách ĐỐI CHIẾU, không thay thế.
 *
 * ## Vì sao cần
 *
 * Hồ sơ mặc định có 5 layer; một bộ quy chuẩn thật của công ty có 30–80. Gõ tay
 * tên, màu, kiểu nét, bề dày cho từng dòng là việc không ai làm đến hết. Và cách
 * lập hồ sơ tự nhiên nhất là lấy từ một bản vẽ đã chuẩn rồi tỉa lại.
 *
 * ## Vì sao đối chiếu chứ không thay thế
 *
 * Panel cũ hỏi một câu rồi **thay sạch** danh sách. Ai đã tinh chỉnh cột "bắt
 * buộc" và bề dày cho 40 layer sẽ mất hết trong một cú bấm — không có bước hoàn
 * tác nào. Ở đây **không dòng nào đổi trừ khi được tích**, và mặc định nghiêng
 * về phía an toàn: thêm thì tích sẵn, ghi đè và xoá thì không.
 *
 * ## Bề dày phải quy đổi
 *
 * Bản vẽ báo bề dày bằng **mã DXF group 370**; kho hồ sơ nhận ba tên và số
 * **milimét**. Bỏ bước đổi là mọi layer nhập vào bị máy chủ từ chối từng dòng
 * một. Xem `lineweightFromDxf()`.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { DAEMON_BASE, endpoints } from "../../lib/daemon/endpoints";
import { daemonFailureText, daemonRecord } from "../../lib/daemon/client";
import { type AcadDocument } from "../../lib/daemon/docs";
import {
  applyLayerReconcile,
  countLayerPicks,
  readDrawingLayers,
  reconcileLayers,
  targetOf,
  type DrawingLayer,
  type LayerReconcile,
  type LayerRule,
} from "./model";

/** Bản vẽ chọn được làm nguồn.
 *
 * Loại những bản vẽ **chưa lưu** mà tiêu đề trùng với BẤT KỲ bản vẽ nào khác:
 * chúng không có đường dẫn nên `targetOf()` lùi về tiêu đề, và máy chủ sẽ trả
 * `target_ambiguous`. `/drawing-info` nhận đích theo đường dẫn hoặc tiêu đề,
 * không nhận `instance`, nên không định danh nào cứu được.
 */
function pickable(docs: readonly AcadDocument[]): AcadDocument[] {
  return docs.filter((doc) => {
    if ((doc.file || "").trim()) return true;
    return docs.filter((other) =>
      (other.title || "").trim() === (doc.title || "").trim()).length <= 1;
  });
}

function Tick({ id, on, onChange, disabled }: {
  id: string;
  on: boolean;
  onChange: (next: boolean) => void;
  /* Khoá trong lúc đang đọc lại: `apply()` chụp `picks` TRƯỚC khi chờ, nên tích
     thêm lúc đó chỉ đổi thứ hiện trên màn hình, còn thứ được áp vẫn là tập cũ —
     người dùng thấy một đằng, app ghi một nẻo. */
  disabled: boolean;
}) {
  return (
    <input type="checkbox" checked={on} aria-label={id} disabled={disabled}
      onChange={(event) => onChange(event.target.checked)} />
  );
}

/** Bảng layer đọc được của một bản vẽ, tại một thời điểm. */
type Snapshot = {
  target: string;
  /** `document.instance` của CHÍNH phản hồi này.
   *
   * Khác hẳn cách dùng đã bỏ ở vòng trước: ở đây so **hai phản hồi với nhau**
   * (bản xem trước ↔ lượt đọc lại lúc bấm Nhận), không so phản hồi với một lượt
   * `/docs` đọc ở thời điểm khác. Cùng nguồn, cùng loại, nên không có đua.
   *
   * Cần vì bản vẽ CHƯA LƯU chỉ định danh được bằng tiêu đề: đóng nó đi rồi mở
   * một bản vẽ chưa lưu khác trùng tiêu đề thì máy chủ giải ra bản thay thế, và
   * hộp thoại sẽ áp lựa chọn của bản vẽ này lên bảng layer của bản vẽ kia. */
  instance: string;
  layers: DrawingLayer[];
  truncated: boolean;
  skipped: number;
};

/** Nhập layer — và vì sao KHÔNG có cơ chế "giữ ảnh chụp cho tươi".
 *
 * Bản trước cố canh cho ảnh chụp luôn khớp bản vẽ: so `instance`, so `revision`,
 * nghe `drawingModified`, đóng dấu thời gian đọc. Tám vòng review liên tiếp đều
 * tìm ra một khe trong đúng cơ chế ấy — và mỗi tín hiệu thêm vào lại mâu thuẫn
 * với tín hiệu cũ:
 *
 * · so `revision` giữa **hai lượt đọc khác nhau** vừa báo sót (bản vẽ đổi giữa
 *   lúc plugin thu thập và lúc phản hồi về) vừa báo thừa (đổi tab cũng làm nó
 *   nhảy, và đường `withLegacySelectionCatalog()` tự làm nó nhảy rồi kẹt luôn);
 * · sự kiện thì bất đồng bộ, nên luôn có một khe giữa lúc AutoCAD đổi và lúc
 *   giao diện biết.
 *
 * Không khe nào trong số đó đóng được bằng cách thêm tín hiệu, vì nguyên nhân
 * chung là **có một khoảng thời gian giữa lúc đọc và lúc ghi**.
 *
 * Nên bỏ hẳn khoảng đó: bảng dưới đây là **bản xem trước**, còn lúc bấm Nhận thì
 * **đọc lại** và áp trên số liệu vừa đọc. Tích của người dùng gắn với TÊN layer
 * nên sống sót qua lượt đọc lại; thứ gì đã tích mà lượt đọc mới không còn thấy
 * thì dừng lại và nói ra, thay vì ghi bừa.
 */
export function ImportLayers({ layers, docs, docsAlive, onCancel, onApply }: {
  layers: readonly LayerRule[];
  /** Bản vẽ đang mở. Màn Hồ sơ **không gắn với bản vẽ nào**, nên phải hỏi. */
  docs: readonly AcadDocument[];
  /** Danh sách bản vẽ còn đọc được không. Trang cha giữ danh sách cũ khi một lượt
   * đọc hỏng — đúng, nhưng bản xem trước không được tin vào một danh sách không
   * ai bảo đảm còn sống. */
  docsAlive: boolean;
  onCancel: () => void;
  onApply: (next: LayerRule[], summary: string) => void;
}) {
  /* Khởi tạo từ danh sách CHỌN ĐƯỢC, không phải từ `docs`: bản vẽ đang hoạt động
     có thể là một bản chưa lưu trùng tiêu đề, tức thứ đã bị loại khỏi ô chọn —
     lấy nó làm đích ban đầu là mở hộp thoại ra đã hỏng sẵn. `pickable()` lặp lại
     phép lọc vì nó chạy trước khi `selectable` được tính. */
  const [target, setTarget] = useState(() => targetOf(pickable(docs)[0] ?? {}));
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const [picks, setPicks] = useState<ReadonlySet<string>>(new Set());
  /* Vé cho lượt đọc: đổi nguồn hai lần liên tiếp thì phản hồi của lượt CŨ có thể
     về sau và ghi đè bản xem trước của lượt MỚI. */
  const loadSequence = useRef(0);
  /* Đã đóng chưa. `apply()` chờ một lượt đọc lại, và trong khoảng đó người dùng
     vẫn bấm Huỷ / Esc / nền được. */
  const closed = useRef(false);
  /* Đích HIỆN TẠI, đọc được từ trong một hàm bất đồng bộ đã chạy dở.
     Bản trước so `startedFor` với `target` — cả hai đóng gói từ CÙNG một lần
     render, nên phép so luôn bằng nhau và không bao giờ phát hiện được gì. Muốn
     biết đích đã đổi thì phải đọc một ô nhớ sống, không phải một biến đã đông
     cứng lúc hàm được tạo. */
  const currentTarget = useRef(target);
  useEffect(() => { currentTarget.current = target; }, [target]);

  /** Đọc bảng layer. Trả về ảnh chụp, hoặc ném lỗi có câu chữ đọc được. */
  const read = useCallback(async (file: string): Promise<Snapshot> => {
    const body = await daemonRecord(
      await fetch(
        `${endpoints.drawingInfo(DAEMON_BASE)}?target=${encodeURIComponent(file)}`,
        { cache: "no-store" },
      ),
    );
    const parsed = readDrawingLayers(body);
    if (parsed.unavailable) {
      throw new Error(
        "Plugin không đọc được bảng layer của bản vẽ này. Mọi bản vẽ đều có ít "
        + "nhất layer “0”, nên đây là lỗi đọc chứ không phải bản vẽ trống — "
        + "thử build và nạp lại plugin AcadBridge.",
      );
    }
    if (!parsed.layers.length && !parsed.skipped) {
      throw new Error("Bản vẽ không trả về bảng layer nào.");
    }
    const document = body.document && typeof body.document === "object"
      ? (body.document as Record<string, unknown>)
      : {};
    return {
      target: file,
      instance: String(document.instance ?? ""),
      layers: parsed.layers,
      truncated: parsed.truncated,
      skipped: parsed.skipped,
    };
  }, []);

  const preview = useCallback(async (file: string) => {
    if (!file) return;
    const ticket = ++loadSequence.current;
    setBusy(true);
    setError("");
    setNote("");
    setSnapshot(null);
    setPicks(new Set());
    try {
      const next = await read(file);
      if (ticket !== loadSequence.current) return;
      setSnapshot(next);
    } catch (failure) {
      if (ticket !== loadSequence.current) return;
      setError(daemonFailureText(failure));
    } finally {
      if (ticket === loadSequence.current) setBusy(false);
    }
  }, [read]);

  useEffect(() => { void preview(target); }, [target, preview]);

  /* Đích đang chọn biến mất khỏi danh sách thì DỜI sang bản vẽ khác còn mở — giữ
     nguyên là ô chọn trỏ vào một mục không tồn tại và không chọn được gì nữa. */
  const selectable = useMemo(() => pickable(docs), [docs]);
  const ambiguousUnsaved = useMemo(
    () => docs.filter((doc) => !selectable.includes(doc)),
    [docs, selectable],
  );
  const targetDoc = docs.find((doc) => targetOf(doc) === target);
  useEffect(() => {
    if (!docsAlive) return;
    /* KHÔNG còn bản vẽ nào: vứt ảnh chụp và lựa chọn. Bản trước thoát sớm ở đúng
       nhánh này, nên hộp thoại tiếp tục bày số liệu của một bản vẽ đã đóng và nút
       Nhận vẫn sáng. */
    if (!selectable.length) {
      /* Tăng vé TRƯỚC khi xoá: một lượt đọc của đích cũ có thể đang bay, và
         `preview("")` thoát ngay ở `if (!file) return` nên KHÔNG cấp vé mới —
         phản hồi cũ sẽ qua được phép kiểm vé rồi dựng lại ảnh chụp của bản vẽ đã
         đóng, bật lại nút Nhận. */
      loadSequence.current += 1;
      setTarget("");
      setSnapshot(null);
      setPicks(new Set());
      setBusy(false);
      return;
    }
    if (targetDoc && selectable.includes(targetDoc)) return;
    setTarget(targetOf(selectable.find((doc) => doc.active) ?? selectable[0]));
  }, [docsAlive, targetDoc, selectable]);

  /* Bản vẽ CHƯA LƯU không có đường dẫn nên `targetOf()` lùi về tiêu đề; hai bản
     vẽ như vậy trùng tiêu đề cho ra CÙNG một đích, máy chủ từ chối vì mơ hồ.
     `/drawing-info` nhận đích theo đường dẫn hoặc tiêu đề, không nhận `instance`,
     nên không định danh nào cứu được — bỏ ra khỏi danh sách và nói lý do. */

  const plan: LayerReconcile = useMemo(
    () => reconcileLayers(layers, snapshot?.layers ?? []),
    [layers, snapshot],
  );
  const picked = countLayerPicks(plan, picks);

  /* Dữ liệu KHÔNG ĐẦY ĐỦ — bị cắt ở 500 dòng, hoặc có dòng đọc không nổi. Cùng
     một hệ quả: ta **không biết** bản vẽ còn những layer nào, mà "không biết" thì
     không được kết luận "layer này không còn" — và tích một dòng ở nhóm đó là xoá
     khỏi hồ sơ. */
  const incomplete = !!snapshot && (snapshot.truncated || snapshot.skipped > 0);

  useEffect(() => {
    if (!snapshot) return;
    setPicks(new Set(
      reconcileLayers(layers, snapshot.layers).add.map((layer) => `add:${layer.name}`),
    ));
  }, [snapshot]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (key: string) => setPicks((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  });

  /** ĐỌC LẠI rồi mới áp — không có khoảng thời gian nào để dữ liệu kịp cũ.
   *
   * Bản xem trước ở trên có thể đã cũ vài giây hoặc vài phút; thay vì canh chừng
   * nó bằng một chuỗi tín hiệu, đọc lại và áp trên số liệu vừa đọc. Nếu lượt đọc
   * mới không còn thấy thứ đã tích thì DỪNG và bày lại bản xem trước — người dùng
   * tích lại trên số liệu đúng, thay vì để app ghi bừa. */
  const apply = useCallback(async () => {
    if (!snapshot || !picked) return;
    const startedFor = target;
    /* Vé cho lượt đọc lại. Dùng CHUNG bộ đếm với `preview()`: hai đường cùng ghi
       vào `snapshot`/`error`/`busy`, nên một bộ đếm riêng sẽ không thấy lượt kia
       đã thay đích. */
    const ticket = ++loadSequence.current;
    setBusy(true);
    setError("");
    setNote("");
    try {
      const fresh = await read(target);
      /* Huỷ trong lúc đang đọc lại: hộp thoại đã gỡ khỏi cây, nhưng phần tiếp sau
         của hàm bất đồng bộ này vẫn chạy và vẫn gọi được `onApply` — tức một lượt
         nhập ĐÃ HUỶ vẫn sửa bản nháp. */
      if (closed.current) return;
      /* Đích đã đổi trong lúc chờ — người dùng chọn bản vẽ khác, hoặc bản vẽ cũ
         đóng và hiệu ứng ở trên dời sang bản khác. Áp tiếp là ghi số liệu của
         nguồn này lên lựa chọn của nguồn kia. */
      if (currentTarget.current !== startedFor || ticket !== loadSequence.current) return;
      /* Lượt đọc lại giải ra một bản vẽ KHÁC. Chỉ xảy ra với bản vẽ chưa lưu —
         chúng chỉ định danh được bằng tiêu đề — nhưng hậu quả là áp lựa chọn của
         bản vẽ này lên bảng layer của bản vẽ kia. */
      /* Bản vẽ CHƯA LƯU chỉ định danh được bằng tiêu đề, nên thiếu `instance` là
         KHÔNG có cách nào biết lượt đọc lại có trúng đúng bản vẽ cũ không. Dừng
         hẳn — fail closed. Bản vẽ đã lưu thì đường dẫn đã là định danh duy nhất,
         không cần `instance`. */
      const unsaved = !(targetDoc?.file || "").trim();
      if (unsaved && (!snapshot.instance || !fresh.instance)) {
        setSnapshot(fresh);
        setNote(
          "Bản vẽ chưa lưu và plugin không cấp mã phiên, nên không xác nhận được "
          + "lượt đọc lại có trúng đúng bản vẽ ban đầu không. Lưu bản vẽ rồi thử "
          + "lại — nhập nhầm nguồn thì không có đường lùi.",
        );
        return;
      }
      if (snapshot.instance && fresh.instance && fresh.instance !== snapshot.instance) {
        setSnapshot(fresh);
        setNote(
          "Đích đã giải ra một bản vẽ khác so với lúc xem trước — thường là do một "
          + "bản vẽ chưa lưu trùng tiêu đề. Bảng dưới đây là số liệu vừa đọc lại; "
          + "kiểm rồi chọn lại.",
        );
        return;
      }
      const freshPlan = reconcileLayers(layers, fresh.layers);
      const freshKeys = new Set([
        ...freshPlan.add.map((l) => `add:${l.name}`),
        ...freshPlan.differ.map((r) => `diff:${r.name}`),
        ...freshPlan.gone.map((l) => `gone:${l.name}`),
      ]);
      const lost = [...picks].filter((key) => !freshKeys.has(key));
      if (lost.length) {
        setSnapshot(fresh);
        setNote(
          `Bản vẽ đã đổi kể từ lúc xem trước: ${lost.length} mục đã tích không còn `
          + "đúng nữa. Bảng dưới đây là số liệu vừa đọc lại — chọn lại rồi bấm Nhận.",
        );
        return;
      }
      const stillIncomplete = fresh.truncated || fresh.skipped > 0;
      const removing = [...picks].some((key) => key.startsWith("gone:"));
      if (stillIncomplete && removing) {
        setSnapshot(fresh);
        setNote(
          "Lượt đọc lại cho thấy bảng layer không đầy đủ, nên không đủ căn cứ để "
          + "xoá layer khỏi hồ sơ. Bỏ tích các dòng xoá rồi thử lại.",
        );
        return;
      }
      onApply(
        applyLayerReconcile(layers, freshPlan, picks),
        `Đã nhận ${picked} thay đổi từ “${target}” vào bản nháp — chưa lưu.`,
      );
    } catch (failure) {
      /* Chặn CẢ ở `catch` và `finally`, không chỉ ở đường thành công. Nguồn A bị
         đóng giữa chừng, hộp thoại dời sang B và nạp xong bản xem trước của B —
         rồi lượt đọc của A hỏng và ghi lỗi của A đè lên. Bản xem trước của B vẫn
         nằm đó nhưng bị giấu sau một thông báo lỗi không liên quan, và lượt nạp
         thành công thì không xoá lỗi. */
      if (ticket !== loadSequence.current) return;
      setError(daemonFailureText(failure));
    } finally {
      if (ticket === loadSequence.current) setBusy(false);
    }
  }, [snapshot, picked, picks, layers, target, targetDoc, read, onApply]);

  return (
    <Modal
      title="Lấy layer từ bản vẽ"
      sub="Đối chiếu bảng layer của bản vẽ với hồ sơ — chỉ dòng nào bạn tích mới đổi"
      wide
      /* Đang đọc lại thì KHOÁ mọi đường đóng — Esc và nền cũng đi qua đây. Đóng
         giữa chừng làm lượt nhập vẫn chạy tiếp rồi sửa bản nháp sau lưng. */
      onClose={busy ? () => {} : () => { closed.current = true; onCancel(); }}
      footer={
        <>
          <span className="hint">
            Bấm Nhận sẽ <b>đọc lại</b> bảng layer rồi mới áp — và kết quả vào{" "}
            <b>bản nháp</b>, bạn còn bấm “Lưu hồ sơ”.
          </span>
          <span className="spacer" />
          <Button disabled={busy}
            onClick={() => { closed.current = true; onCancel(); }}>Huỷ</Button>
          <Button variant="primary" disabled={!picked || busy || !snapshot}
            onClick={() => void apply()}>
            {busy ? "Đang đọc lại…"
              : picked ? `Nhận ${picked} thay đổi vào bản nháp`
              : "Chưa chọn thay đổi nào"}
          </Button>
        </>
      }
    >
      <label className="field" style={{ marginBottom: "var(--s4)" }}>
        <span>Bản vẽ nguồn</span>
        <select className="input" value={target} disabled={busy}
          onChange={(event) => setTarget(event.target.value)}>
          {!selectable.length
            ? <option value="">— không có bản vẽ nào chọn được —</option> : null}
          {selectable.map((doc) => {
            /* Hai bản vẽ cùng TÊN TỆP ở hai thư mục khác nhau phát cùng một
               `title`; chọn nhầm ở đây là nhập bảng layer của bản vẽ khác. Trùng
               thì hiện luôn đường dẫn — đường dẫn thì không trùng. */
            const path = targetOf(doc);
            const ambiguous = docs.filter(
              (other) => (other.title || "") === (doc.title || ""),
            ).length > 1;
            return (
              <option key={path} value={path}>
                {ambiguous ? path : doc.title || path}{doc.active ? " · đang mở" : ""}
              </option>
            );
          })}
        </select>
        <span className="hint">
          Màn Hồ sơ không gắn với bản vẽ nào, nên phải chọn nguồn ở đây.
        </span>
      </label>

      {error ? (
        <div className="banner" data-tone="hard">
          <span className="bm" />
          <span className="bt"><b>Không đọc được bảng layer.</b> {error}</span>
          <span className="actions">
            <Button onClick={() => void preview(target)}>Thử lại</Button>
          </span>
        </div>
      ) : null}

      {note ? (
        <div className="banner" data-tone="hard">
          <span className="bm" />
          <span className="bt">{note}</span>
        </div>
      ) : null}

      {busy ? <p className="hint">Đang đọc bảng layer…</p> : null}

      {ambiguousUnsaved.length ? (
        <div className="banner">
          <span className="bm" />
          <span className="bt">
            <b>{ambiguousUnsaved.length} bản vẽ chưa lưu bị bỏ khỏi danh sách.</b>{" "}
            Chúng trùng tiêu đề và chưa có đường dẫn, nên không có cách nào chỉ đích
            danh một cái — lượt đọc sẽ bị máy chủ từ chối vì mơ hồ. Lưu bản vẽ rồi
            thử lại.
          </span>
        </div>
      ) : null}

      {snapshot?.skipped ? (
        <div className="banner">
          <span className="bm" />
          <span className="bt">
            <b>{snapshot.skipped} dòng bị bỏ qua.</b> Chúng không mang đủ thuộc tính
            layer (màu, kiểu nét, bề dày), nên không có gì để nhập — điền giá trị
            mặc định vào rồi trình bày như thể đọc từ bản vẽ là bịa ra dữ liệu.
          </span>
        </div>
      ) : null}

      {snapshot?.truncated ? (
        <div className="banner" data-tone="hard">
          <span className="bm" />
          <span className="bt">
            <b>Bảng layer của bản vẽ đã bị cắt.</b> Plugin chỉ trả về tối đa 500
            dòng, nên danh sách dưới đây <b>chưa đủ</b>. Thêm và ghi đè vẫn đúng vì
            chúng chỉ chạm tới layer đọc được; riêng nhóm <b>xoá khỏi hồ sơ</b> bị
            ẩn, vì một danh sách cụt không đủ để kết luận layer nào không còn.
          </span>
        </div>
      ) : null}

      {!error && snapshot && snapshot.layers.length ? (
        <>
          <Group title="Chỉ có trong bản vẽ" count={plan.add.length}
            note="Thêm vào hồ sơ. Tích sẵn — đây là việc cộng thêm, không lấy đi gì.">
            {plan.add.map((layer) => (
              <tr key={layer.name}>
                <td style={{ width: 1 }}>
                  <Tick id={`Thêm ${layer.name}`} on={picks.has(`add:${layer.name}`)}
                    onChange={() => toggle(`add:${layer.name}`)}
                    disabled={busy} />
                </td>
                <td className="mono">{layer.name}</td>
                <td className="mono">{String(layer.color)}</td>
                <td className="mono">{layer.linetype}</td>
                <td className="mono">{String(layer.lineweight)}</td>
              </tr>
            ))}
          </Group>

          <Group title="Khác thuộc tính" count={plan.differ.length}
            note="Không tích sẵn — ghi đè là lấy đi giá trị bạn đã đặt. Cột 'bắt buộc' KHÔNG bị đụng tới.">
            {plan.differ.map((row) => (
              <tr key={row.name}>
                <td style={{ width: 1 }}>
                  <Tick id={`Ghi đè ${row.name}`} on={picks.has(`diff:${row.name}`)}
                    onChange={() => toggle(`diff:${row.name}`)}
                    disabled={busy} />
                </td>
                <td className="mono">{row.name}</td>
                <td colSpan={3}>
                  {row.fields.map((field) => (
                    <div key={field.label} style={{ fontSize: 11.5 }}>
                      <span className="hint">{field.label}</span>{" "}
                      <span className="mono" style={{
                        textDecoration: "line-through", color: "var(--muted)",
                      }}>{field.from}</span>
                      {" → "}
                      <span className="mono" style={{ fontWeight: 590 }}>{field.to}</span>
                    </div>
                  ))}
                </td>
              </tr>
            ))}
          </Group>

          {incomplete ? (
            <section style={{ marginTop: "var(--s5)" }}>
              <div className="row" style={{ gap: "var(--s2)", marginBottom: 4 }}>
                <b style={{ fontSize: 12.5 }}>Chỉ có trong hồ sơ</b>
                <span className="tag mono">tạm ẩn</span>
              </div>
              <p className="hint" style={{ margin: 0 }}>
                {snapshot.truncated
                  ? "Bản vẽ có quá nhiều layer nên plugin đã cắt danh sách. "
                  : `${snapshot.skipped} dòng không đọc được. `}
                Không đủ căn cứ để nói layer nào <em>không còn</em> trong bản vẽ,
                nên nhóm xoá bị ẩn — hai nhóm trên vẫn dùng được vì chúng chỉ chạm
                tới layer thật sự đọc được.
              </p>
            </section>
          ) : (
            <Group title="Chỉ có trong hồ sơ" count={plan.gone.length}
              note="Bản vẽ này không có chúng. Tích để XOÁ khỏi hồ sơ — không tích thì giữ nguyên.">
              {plan.gone.map((layer) => (
                <tr key={layer.name}>
                  <td style={{ width: 1 }}>
                    <Tick id={`Xoá ${layer.name}`} on={picks.has(`gone:${layer.name}`)}
                      onChange={() => toggle(`gone:${layer.name}`)}
                    disabled={busy} />
                  </td>
                  <td className="mono">{layer.name}</td>
                  <td colSpan={3}>
                    <span className="hint">Tích để xoá khỏi hồ sơ</span>
                  </td>
                </tr>
              ))}
            </Group>
          )}
        </>
      ) : null}
    </Modal>
  );
}

function Group({ title, count, note, children }: {
  title: string;
  count: number;
  note: string;
  children: ReactNode;
}) {
  return (
    <section style={{ marginTop: "var(--s5)" }}>
      <div className="row" style={{ gap: "var(--s2)", marginBottom: 4 }}>
        <b style={{ fontSize: 12.5 }}>{title}</b>
        <span className="tag mono">{count}</span>
      </div>
      <p className="hint" style={{ margin: "0 0 var(--s2)" }}>{note}</p>
      {count ? (
        <div className="tablewrap" style={{ maxHeight: 260, border: "1px solid var(--border)" }}>
          <table className="data"><tbody>{children}</tbody></table>
        </div>
      ) : (
        <p className="hint" style={{ margin: 0 }}>Không có dòng nào.</p>
      )}
    </section>
  );
}

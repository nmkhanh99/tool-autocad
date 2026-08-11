"use client";

/** Hồ sơ bản vẽ đang mở. **Chỉ đọc**, trừ bộ tạo thao tác ở cột phải.
 *
 * ## Ba chỗ cố tình lệch khỏi bộ mẫu
 *
 * **1. `extents` có thể bị giấu đi.** Bộ mẫu in EXTMIN/EXTMAX như một cặp toạ độ
 * lúc nào cũng có nghĩa. Trên bản vẽ thật thì `min` đến từ Model (toạ độ trắc
 * địa) còn `max` đến từ một layout (mm trên giấy), cho ra một khung rộng 3,8
 * **triệu** đơn vị. Khi bản vẽ có nhiều không gian, màn hình nói "không dùng
 * được" thay vì in ra con số đó.
 *
 * **2. Bộ tạo chọn ít lựa chọn hơn mẫu.** Mẫu có "theo kiểu đối tượng" và "đặt
 * màu theo layer"; backend không có cả hai. Xem `SelectionBuilder.tsx`.
 *
 * **3. Banner về snapshot `.cadweb` bị bỏ.** Mẫu nói khung xem web dựng từ
 * snapshot nên không hiện dimension/hatch/xref. Từ giai đoạn 5, `/workspace` đọc
 * hình học **trực tiếp** từ plugin và vẽ được cả dimension lẫn hatch. Giữ câu đó
 * là nói sai về chính app.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "../../../components/shell/AppShell";
import { Button } from "../../../components/ui/Button";
import { Tag } from "../../../components/ui/Tag";
import { ConfirmSheet } from "../../../components/ui/ConfirmSheet";
import { useDrawingInfo } from "../../../features/drawing-info/useDrawingInfo";
import { ObjectCatalog } from "../../../features/drawing-info/ObjectCatalog";
import {
  SelectionBuilder,
  type SelectionDraft,
} from "../../../features/drawing-info/SelectionBuilder";
import { fetchDocs, type AcadDocument } from "../../../lib/daemon/docs";
import { useAcadEvents } from "../../../features/acad-connection/events";
import {
  activateBlockedReason,
  activeDocFile,
  entityTotals,
  insUnitsLabel,
  savedState,
  layerColor,
  layerFlags,
  layerRows,
  lineweightLabel,
  normalize,
  operationTarget,
  record,
  profileStaleReason,
  typeBars,
  usableExtents,
} from "../../../features/drawing-info/model";
import { prepareSelectHandles } from "../../../features/staged-ops/selectHandles";
import {
  applyStagedOp,
  prepareStagedOp,
  rejectStagedOp,
  stagedErrorText,
} from "../../../features/staged-ops/prepareApplyReject";
import type { StagedOp } from "../../../features/staged-ops/types";
import { DAEMON_BASE, endpoints } from "../../../lib/daemon/endpoints";
import { daemonFailureText, daemonRecord } from "../../../lib/daemon/client";

export default function DrawingInfoPage() {
  const info = useDrawingInfo(DAEMON_BASE);
  const payload = info.data;

  /* Thẻ xác nhận mang theo CẢ thao tác lẫn thứ nó mô tả. Đọc lại state lúc thẻ
     hiện ra là mô tả một thứ khác với thứ sắp chạy — người dùng có thể đã bấm
     tiếp trong lúc chờ máy chủ. */
  const [pending, setPending] = useState<
    | { kind: "scope"; op: StagedOp; draft: SelectionDraft }
    | { kind: "activate"; op: StagedOp; title: string }
    | { kind: "handles"; op: StagedOp; count: number }
    | null
  >(null);
  const [docs, setDocs] = useState<AcadDocument[]>([]);
  const [docsAlive, setDocsAlive] = useState(false);
  /* Lời gọi `/docs` đã về CHƯA. Tách khỏi `docsAlive`: lúc mới mở, hai giá trị
     "chưa hỏi xong" và "hỏi xong, plugin chết" đều là `false`, nên chỉ nhìn
     `docsAlive` thì màn hình báo AutoCAD chưa phản hồi trong lúc câu hỏi còn
     đang bay — kèm nút "Mở AutoCAD" cho một AutoCAD đang chạy bình thường. */
  const [docsSettled, setDocsSettled] = useState(false);
  /* Có lời gọi `/docs` đang bay không. Khác `docsSettled`: sau một lần hỏng,
     mỗi sự kiện `pluginLoaded` mở một lượt hỏi lại — và trong lúc lượt đó chưa
     về, kết luận "AutoCAD chưa phản hồi" là kết luận CŨ. */
  const [docsPending, setDocsPending] = useState(true);
  const [rawOpen, setRawOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  /* MỘT chỗ chuẩn hoá cho cả hai dạng phản hồi — xem `normalize()`. Đọc thẳng
     `payload.settings` sẽ trống rỗng trên plugin chỉ phát dạng lồng. */
  const view = useMemo(() => normalize(payload), [payload]);
  const doc = record(view.document);
  const settings = record(view.settings);
  const tables = record(view.tables);
  const layers = useMemo(() => (payload ? layerRows(payload) : []), [payload]);
  const bars = useMemo(() => (payload ? typeBars(payload) : []), [payload]);
  const totals = useMemo(() => (payload ? entityTotals(payload) : null), [payload]);
  const extents = useMemo(() => (payload ? usableExtents(payload) : null), [payload]);
  const dictionaries = Array.isArray(view.dictionaries) ? view.dictionaries : [];
  const xrefs = Array.isArray(view.xrefs) ? view.xrefs : [];

  /* Số thứ tự lượt đọc. Sự kiện reactor tới thành chùm (mở bản vẽ phát vài cái
     liền nhau), nên nhiều lượt đọc chạy chồng nhau; lượt cũ về SAU sẽ ghi đè
     trạng thái mới hơn, và ô chọn lẫn dải cảnh báo trỏ nhầm bản vẽ cho tới sự
     kiện kế tiếp. Trên một màn hình mà bản vẽ hoạt động quyết định mọi lệnh ghi
     đi đâu, đó không phải nhấp nháy giao diện. */
  const docsSequence = useRef(0);
  const [opening, setOpening] = useState(false);
  /* Ô lỗi RIÊNG cho nút "Mở AutoCAD". Dùng chung `error` với bộ tạo chọn thì
     một lần mở hỏng hiện ra dưới nhãn "Không chuẩn bị được" ở cột bên kia — đọc
     ra như thao tác ghi hỏng, trong khi chưa có thao tác nào được tạo. */
  const [openError, setOpenError] = useState("");
  /* Ô lỗi RIÊNG cho lượt chọn theo handle — cùng lý do như `openError`: nút ở
     danh mục thì lỗi cũng phải hiện ở danh mục. */
  const [pickError, setPickError] = useState("");
  const openAutoCAD = useCallback(async () => {
    setOpening(true);
    setOpenError("");
    try {
      await daemonRecord(await fetch(endpoints.acadOpen(DAEMON_BASE), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        /* Không kèm `new: true`: tạo một bản vẽ trống là ghi ra một tệp scratch,
           và người dùng ở đây chỉ muốn mở lại AutoCAD để đọc bản vẽ của họ. */
        body: JSON.stringify({}),
      }));
    } catch (failure) {
      setOpenError(daemonFailureText(failure));
    } finally {
      setOpening(false);
    }
  }, []);

  const loadDocs = useCallback(() => {
    const ticket = ++docsSequence.current;
    setDocsPending(true);
    fetchDocs(DAEMON_BASE)
      .then((snapshot) => {
        if (ticket !== docsSequence.current) return;
        /* CHỈ ghi đè khi plugin thật sự trả lời. Daemon trả HTTP 200 kèm
           `{alive:false, docs:[]}` khi plugin im — nên nhánh này, chứ không
           phải `catch`, mới là cửa mà một lượt hỏng đi qua. Ghi đè ở đây là xoá
           sạch danh sách đúng lúc ta biết ít nhất về AutoCAD. */
        if (snapshot.alive) setDocs(snapshot.docs);
        setDocsAlive(snapshot.alive);
        setDocsSettled(true);
        setDocsPending(false);
      })
      .catch(() => {
        if (ticket !== docsSequence.current) return;
        /* GIỮ danh sách cũ, chỉ hạ cờ sống — cùng lối với `useDrawingInfo`. Một
           lượt đọc hỏng KHÔNG phải bằng chứng AutoCAD không còn bản vẽ nào.
           Nguy hiểm cụ thể: `move-to-layer` chạy xong phát `drawingModified`,
           lượt đọc do sự kiện đó mở có thể về SAU lượt của `reloadAll` và hỏng;
           xoá sạch ở đây là ném đi một câu trả lời đúng vừa nhận, rồi báo mất
           kết nối ngay sau một thao tác THÀNH CÔNG. */
        setDocsAlive(false);
        setDocsSettled(true);
        setDocsPending(false);
      });
  }, []);
  useEffect(() => { loadDocs(); }, [loadDocs]);
  /* Đọc MỘT LẦN lúc mở là không đủ: người dùng đổi tab trong AutoCAD sau đó thì
     ô chọn vẫn đánh dấu bản vẽ cũ và dải cảnh báo "hồ sơ không phải bản vẽ đang
     mở" không bao giờ hiện — đúng tình huống nó sinh ra để bắt.
     Dùng lại đúng cơ chế của shell: nghe sự kiện reactor thay vì dò theo nhịp.
     Danh sách bản vẽ là lời gọi NHẸ, khác hẳn hồ sơ 350 KB — nên nạp lại nó
     theo sự kiện là được, còn hồ sơ thì vẫn để người dùng bấm. */
  useAcadEvents(DAEMON_BASE, (event) => {
    /* `drawingModified` cũng phải nạp lại: `/docs` là nơi DUY NHẤT màn hình này
       thấy được revision hiện tại của bản vẽ, và revision là thứ cho biết danh
       mục đối tượng đã già. Lời gọi nhẹ, plugin chỉ phát sự kiện này một lần
       mỗi lệnh (gom cờ dirty), nên không có chuyện dội.

       `drawingSaved` cũng vậy, và không thừa: nó đến từ `saveComplete` của
       database reactor, không đi qua `commandEnded`. Một lượt lưu tự động hay
       QSAVE từ menu không phát `drawingModified`, nên bỏ nó ra là `dbmod` trên
       màn hình treo ở "chưa lưu" và revision đứng lại ở số cũ. */
    if (event.type.startsWith("doc")
      || event.type === "pluginLoaded"
      || event.type === "drawingModified"
      || event.type === "drawingSaved") loadDocs();
  });

  /* Bản vẽ đang hoạt động lấy từ DANH SÁCH bản vẽ, không từ hồ sơ: hai nguồn
     đọc ở hai thời điểm, và danh sách mới hơn. Lấy từ hồ sơ thì ô chọn hiện bản
     vẽ cũ sau khi người dùng đổi tab trong AutoCAD. */
  const activeFile = activeDocFile(docs) || operationTarget(payload);
  /* CHỈ chẩn đoán khi danh sách bản vẽ còn tin được. Từ lúc `loadDocs` giữ lại
     danh sách cũ khi đọc hỏng, danh sách đó có thể mô tả một trạng thái AutoCAD
     đã qua — đem so với hồ sơ sẽ cho ra một chẩn đoán tự tin mà sai, kiểu "bạn
     đang ở bản vẽ khác" trong khi thật ra ta không biết gì cả. Không biết thì
     nói không biết: `blockNote` bên dưới vẫn chặn, chỉ là chặn bằng lý do đúng. */
  const stale = docsAlive ? profileStaleReason(payload, docs) : null;
  /* Con đường chuỗi cho các component con: chúng chỉ cần biết CÓ chặn hay không
     và câu để hiện. Tiêu đề riêng chỉ dùng cho dải cảnh báo ở đây. */
  const staleNote = stale ? `${stale.title} ${stale.note}` : "";
  const saved = savedState(payload, docs, docsAlive);
  /* Plugin sống mà danh sách bản vẽ RỖNG: AutoCAD đang chạy nhưng không mở bản
     vẽ nào. `profileStaleReason` cố tình im ở đây — danh sách rỗng không phân
     biệt được "chưa đọc được" với "không có bản vẽ nào", nên nó nhường cho dải
     cảnh báo riêng bên dưới, thứ có `docsAlive` để phân biệt hai chuyện đó. */
  const noDocuments = docsAlive && docs.length === 0 && !info.loading;
  /* MỘT lý do chặn cho mọi nơi ghi. Danh sách bản vẽ là thứ DUY NHẤT màn hình
     này dùng để biết hồ sơ còn khớp bản vẽ không — nên khi nó chưa về hoặc đọc
     hỏng, câu trả lời không phải "khớp", mà là "chưa biết". Để bấm được trong
     quãng đó là mời người dùng ăn một lỗi `drawing_stale` từ máy chủ. */
  /* Daemon đòi ĐÚNG MỘT bản vẽ hoạt động. Không có cái nào, hoặc có nhiều hơn
     một, là trạng thái ta không hiểu — và mọi lệnh ghi sẽ bị từ chối. Chặn ở
     đây thay vì để người dùng bấm rồi ăn lỗi từ máy chủ. */
  const activeCount = docs.filter((d) => d.active === true).length;
  const blockNote = staleNote
    || (noDocuments ? "AutoCAD không mở bản vẽ nào." : "")
    || (docsAlive && docs.length && activeCount !== 1
      ? `AutoCAD đang mở ${docs.length} bản vẽ nhưng không xác định được bản nào `
        + "đang hoạt động. Bấm vào một tab bản vẽ trong AutoCAD rồi bấm “Đọc lại”."
      : "")
    || (!docsAlive
      ? "Chưa đọc được danh sách bản vẽ từ AutoCAD, nên không kiểm được hồ sơ "
        + "còn khớp bản vẽ hay không."
      : docsPending
        ? "Đang kiểm tra lại bản vẽ — chờ một nhịp rồi chọn."
        : "");

  const startActivate = useCallback(async (file: string) => {
    /* Chốt thứ hai, ở tầng logic: ô chọn đã khoá khi `busy`, nhưng một thẻ xác
       nhận đang mở cũng là một thao tác chưa xong — chồng lên nó là bỏ rơi một
       operation ở máy chủ. */
    if (busy || pending || info.refreshing) return;
    const doc = docs.find((d) => (d.file || d.title) === file);
    const blocked = activateBlockedReason({
      target: file,
      activeFile,
      alive: docsAlive,
    });
    if (blocked) { setError(blocked); return; }
    setBusy(true);
    setError("");
    try {
      const op = await prepareStagedOp(
        DAEMON_BASE,
        { action: "activate-document", target: file },
        { action: "activate-document", fallbackCount: 1 },
      );
      setPending({ kind: "activate", op, title: doc?.title || file });
    } catch (failure) {
      setError(stagedErrorText(failure));
    } finally {
      setBusy(false);
    }
  }, [docs, activeFile, docsAlive, busy, pending, info.refreshing]);

  /* Đọc lại là đọc lại TẤT CẢ. Chỉ gọi `info.reload()` thì khi danh sách bản vẽ
     đang rỗng vì lỡ một sự kiện `docOpened`, hồ sơ mới về được nhưng `docs` vẫn
     rỗng — màn hình tiếp tục nói "AutoCAD không mở bản vẽ nào" và khoá mọi thứ
     cho tới khi có một sự kiện khác. Nút gỡ kẹt mà không gỡ được. */
  const reloadAll = useCallback(() => {
    info.reload();
    loadDocs();
  }, [info, loadDocs]);

  const guard = useMemo(() => {
    const doc = record(normalize(payload).document);
    const instance = typeof doc.instance === "string" ? doc.instance : "";
    const revision = typeof doc.revision === "number" ? doc.revision : null;
    return instance && revision !== null ? { instance, revision } : null;
  }, [payload]);

  const pickHandles = useCallback(async (handles: string[]) => {
    if (busy || pending || info.refreshing || blockNote) return;
    setBusy(true);
    setPickError("");
    try {
      const op = await prepareSelectHandles(DAEMON_BASE, {
        target: operationTarget(payload),
        handles,
        /* Guard lấy từ CHÍNH hồ sơ đã sinh ra danh mục handle này. Ghép handle
           của lượt đọc này với guard của lượt khác là mở ra khoảng thời gian
           giữa hai lượt — bản vẽ đổi trong quãng đó thì handle trỏ sang đối
           tượng khác mà guard vẫn hợp lệ. */
        guard,
      });
      setPending({ kind: "handles", op, count: handles.length });
    } catch (failure) {
      setPickError(stagedErrorText(failure));
    } finally {
      setBusy(false);
    }
  }, [busy, pending, info.refreshing, blockNote, payload, guard]);

  const prepare = useCallback(async (draft: SelectionDraft) => {
    /* Chốt ở tầng logic, khớp với lý do khoá nút — xem `SelectionBuilder`. */
    if (busy || pending || info.refreshing || blockNote) return;
    setBusy(true);
    setError("");
    try {
      const op = await prepareStagedOp(
        DAEMON_BASE,
        {
          action: draft.action,
          target: operationTarget(payload),
          /* `scope` CHỈ gửi với `select`. Daemon bỏ qua nó ở `move-to-layer` và
             ghi lên bộ chọn hiện tại của AutoCAD — gửi kèm là tự tạo ra một
             hiểu nhầm giữa thứ mình gửi và thứ máy chủ làm. */
          ...(draft.action === "select"
            ? { scope: { kind: draft.scope, name: draft.value } }
            : { params: { layer: draft.targetLayer } }),
        },
        { action: draft.action },
      );
      setPending({ kind: "scope", op, draft });
    } catch (failure) {
      setError(stagedErrorText(failure));
    } finally {
      setBusy(false);
    }
  }, [payload, busy, pending, info.refreshing, blockNote]);

  const confirm = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await applyStagedOp(DAEMON_BASE, pending.op);
      setPending(null);
      /* Bản vẽ vừa đổi — hồ sơ trên màn hình đã cũ. Đọc lại để bảng layer và số
         đếm không mô tả một trạng thái không còn nữa. Đổi bản vẽ hoạt động thì
         phải đọc lại CẢ danh sách bản vẽ, vì cờ `active` vừa chuyển chỗ —
         `reloadAll` làm cả hai. */
      reloadAll();
    } catch (failure) {
      setError(stagedErrorText(failure));
      /* Apply là one-shot: hỏng thì id đó chết hẳn. Giữ thẻ xác nhận là mời
         người dùng bấm lại một id đã hỏng. */
      setPending(null);
    } finally {
      setBusy(false);
    }
  }, [pending, info, loadDocs]);

  return (
    <AppShell
      screen="drawing-info"
      title="Thông tin bản vẽ"
      sub={
        payload ? (
          <>
            <span className="mono">{String(doc.title ?? "")}</span>
            {totals ? ` · ${totals.entities} đối tượng · ${layers.length} layer` : ""}
          </>
        ) : info.loading ? "Đang đọc hồ sơ bản vẽ…" : "Chưa đọc được bản vẽ nào."
      }
      actions={
        <>
          {saved.modified ? <Tag>chưa lưu</Tag> : null}
          <Button onClick={reloadAll} disabled={info.refreshing}>
            {info.refreshing ? "Đang đọc…" : "Đọc lại"}
          </Button>
        </>
      }
    >
      <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
        {stale ? (
          <div className="banner" data-tone="hard">
            <span className="bm" />
            <span className="bt">
              <b>{stale.title}</b> {stale.note}
            </span>
            <span className="actions">
              <Button onClick={reloadAll} disabled={info.refreshing}>Đọc lại</Button>
            </span>
          </div>
        ) : null}

        {/* Không đọc được hồ sơ VÀ plugin không phản hồi thì gần như luôn là
            "AutoCAD chưa chạy". Panel legacy có nút mở AutoCAD ngay tại chỗ;
            xoá panel mà không mang nó sang là bắt người dùng quay về màn hình
            cũ chỉ để khởi động lại — một ngõ cụt tôi tự tạo ra khi dọn dẹp. */}
        {/* HAI trạng thái khác nhau, và gộp chúng là nói sai một trong hai:
            plugin không phản hồi (AutoCAD chưa chạy) so với plugin phản hồi
            nhưng KHÔNG có bản vẽ nào mở.
            Trường hợp thứ hai nguy hiểm hơn: `drawing-info` trả
            `active_document_not_found`, hook giữ lại hồ sơ của lượt trước, và
            màn hình tiếp tục trưng bảng layer của một bản vẽ đã đóng như thể nó
            vẫn đang mở. */}
        {noDocuments ? (
          <div className="banner" data-tone="hard">
            <span className="bm" />
            <span className="bt">
              <b>AutoCAD không mở bản vẽ nào.</b>{" "}
              {docsPending
                ? "Đang kiểm tra lại…"
                : payload
                  ? "Nội dung dưới đây là hồ sơ của lượt đọc TRƯỚC, không phải bản vẽ nào đang mở."
                  : "Mở một bản vẽ trong AutoCAD rồi bấm Đọc lại."}
              {openError ? ` Không mở được AutoCAD: ${openError}` : ""}
            </span>
            <span className="actions">
              <Button onClick={() => void openAutoCAD()} disabled={opening}>
                {opening ? "Đang mở…" : "Mở AutoCAD"}
              </Button>
              <Button onClick={reloadAll} disabled={info.refreshing}>Đọc lại</Button>
            </span>
          </div>
        ) : docsSettled && !docsAlive && !info.loading ? (
          /* GIỮ dải cảnh báo trong lúc hỏi lại, chỉ đổi chữ. Ẩn nó đi rồi hiện
             lại sau mỗi lượt hỏi là một nhịp nháy, và nháy thì đọc ra như đã
             kết nối được. Nói "đang kiểm tra lại" là đúng cả hai vế: kết luận
             cũ vẫn là AutoCAD chưa phản hồi, và câu trả lời mới chưa về. */
          <div className="banner" data-tone="hard">
            <span className="bm" />
            <span className="bt">
              <b>AutoCAD chưa phản hồi.</b>{" "}
              {docsPending
                ? "Đang kiểm tra lại…"
                : payload
                  ? "Nội dung dưới đây là lượt đọc trước đó."
                  : "Chưa đọc được hồ sơ nào — hãy mở AutoCAD rồi đọc lại."}
              {openError ? ` Không mở được AutoCAD: ${openError}` : ""}
            </span>
            <span className="actions">
              <Button onClick={() => void openAutoCAD()} disabled={opening || docsPending}>
                {opening ? "Đang mở…" : "Mở AutoCAD"}
              </Button>
            </span>
          </div>
        ) : null}

        {info.error ? (
          <div className="banner" data-tone="hard">
            <span className="bm" />
            <span className="bt">
              <b>Không đọc được hồ sơ.</b> {info.error}
              {payload ? " Nội dung dưới đây là lượt đọc trước đó." : ""}
            </span>
          </div>
        ) : null}

        <div className="info">
          <div className="cols">
            <div className="infopad">
              <section className="panel">
                <header><h2>Tệp &amp; phiên bản</h2></header>
                <dl className="kv">
                  <dt>Tên tệp</dt><dd>{String(doc.title ?? "—")}</dd>
                  <dt>Đường dẫn</dt><dd>{String(doc.file ?? "—")}</dd>
                  <dt>Revision database</dt><dd>{String(doc.revision ?? "—")}</dd>
                  <dt>Trạng thái lưu</dt>
                  <dd>
                    dbmod = {saved.dbmod ?? "—"}
                    {saved.modified === null
                      ? " · không đọc được trạng thái lưu"
                      : saved.modified ? " · có thay đổi chưa lưu" : " · đã lưu"}
                  </dd>
                  <dt>Chỉ đọc</dt><dd>{doc.readOnly === true ? "có" : "không"}</dd>
                </dl>
              </section>

              <section className="panel">
                <header><h2>Đơn vị &amp; phạm vi</h2></header>
                <dl className="kv">
                  <dt>INSUNITS</dt>
                  <dd>
                    {String(settings.INSUNITS ?? "—")}
                    {typeof settings.INSUNITS === "number"
                      ? ` · ${insUnitsLabel(settings.INSUNITS)}` : ""}
                  </dd>
                  <dt>MEASUREMENT</dt>
                  <dd>
                    {String(settings.MEASUREMENT ?? "—")}
                    {settings.MEASUREMENT === 1 ? " · metric" : settings.MEASUREMENT === 0 ? " · imperial" : ""}
                  </dd>
                  <dt>Layer hiện hành</dt><dd>{String(settings.CLAYER ?? "—")}</dd>
                  <dt>Không gian hiện hành</dt><dd>{String(settings.CTAB ?? "—")}</dd>
                  <dt>Khung bao</dt>
                  <dd>
                    {extents
                      ? `${extents.min.map((n) => n.toFixed(2)).join("  ")}  →  ${extents.max.map((n) => n.toFixed(2)).join("  ")}`
                      : "không dùng được"}
                  </dd>
                </dl>
                {!extents && payload ? (
                  <div style={{ padding: "var(--s3) var(--s4)", borderTop: "1px solid var(--border)" }}>
                    <p className="hint">
                      Bản vẽ có đối tượng ở <b>nhiều không gian</b>, mà AutoCAD gộp cả
                      Model lẫn layout vào một cặp min/max. Model ở toạ độ bản vẽ còn
                      layout tính bằng mm trên giấy, nên cặp số đó không mô tả cái gì có
                      thật. Xem khung bao theo từng không gian ở{" "}
                      <Link href="/workspace">Khung bản vẽ</Link>.
                    </p>
                  </div>
                ) : null}
              </section>

              <section className="panel">
                <header>
                  <h2>Đối tượng theo kiểu</h2>
                  <div className="actions">
                    {totals ? <span className="tag mono">{totals.entities} tổng</span> : null}
                    <span className="tag mono">{bars.length}</span>
                  </div>
                </header>
                <div className="bars">
                  {bars.map((bar) => (
                    <div className="bar" key={bar.type}>
                      <span className="nm">{bar.type}</span>
                      <span className="t"><i style={{ width: `${Math.max(2, bar.share * 100)}%` }} /></span>
                      <span className="c">{bar.count}</span>
                    </div>
                  ))}
                  {!bars.length ? <p className="hint">Chưa có số đếm nào.</p> : null}
                </div>
                {totals ? (
                  <div style={{ padding: "var(--s3) var(--s4)", borderTop: "1px solid var(--border)" }}>
                    <p className="hint">
                      {totals.model} ở Model · {totals.paper} trên các layout ·{" "}
                      {totals.blockRefs} lần chèn block. Database còn khoảng{" "}
                      <span className="mono">{totals.approxObjects.toLocaleString("vi-VN")}</span>{" "}
                      <b>object</b> — đó là bảng ký hiệu, từ điển và bản ghi mở rộng,
                      <b> không phải</b> đối tượng vẽ được.
                    </p>
                  </div>
                ) : null}
              </section>

              <section className="panel">
                <header>
                  <h2>Bảng layer</h2>
                  <div className="actions"><span className="tag mono">{layers.length} layer</span></div>
                </header>
                <div className="tablewrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Tên</th><th>Màu</th><th>Linetype</th>
                        <th className="n">Bề dày</th><th className="n">Đối tượng</th><th>Trạng thái</th>
                      </tr>
                    </thead>
                    <tbody>
                      {layers.map((row) => {
                        const color = layerColor(row);
                        const flags = layerFlags(row);
                        return (
                          <tr key={row.name}>
                            <td className="mono">{row.name}</td>
                            <td>
                              {color ? (
                                <span className="row" style={{ gap: 6, alignItems: "center" }}>
                                  {/* `.swatch` chỉ có kích thước bên trong `.layerrow` của bảng
                                      layer ở khung xem; ngoài đó nó rộng 0 và biến mất. Đặt cỡ
                                      tại chỗ thay vì thêm một quy tắc `.swatch` toàn cục có thể
                                      đè lên chỗ đang dùng. */}
                                  <span
                                    className="swatch"
                                    style={{
                                      background: color,
                                      width: 10,
                                      height: 10,
                                      borderRadius: 2,
                                      border: "1px solid var(--border)",
                                      flex: "none",
                                    }}
                                  />
                                  <span className="mono" style={{ fontSize: 11 }}>{row.aci}</span>
                                </span>
                              ) : (
                                /* Không đoán màu từ chỉ số ACI: một ô màu sai cạnh
                                   tên layer tệ hơn không có ô nào. */
                                <span className="mono" style={{ fontSize: 11 }}>ACI {row.aci}</span>
                              )}
                            </td>
                            <td className="mono">{row.linetype}</td>
                            <td className="n mono">{lineweightLabel(row.lineweight)}</td>
                            <td className="n mono">{row.count}</td>
                            <td>{flags.length ? flags.map((f) => <Tag key={f}>{f}</Tag>) : ""}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="panel">
                <header><h2>Bảng ký hiệu</h2></header>
                <dl className="kv">
                  <dt>Kiểu chữ</dt><dd>{countOf(tables.textStyles)}</dd>
                  <dt>Kiểu kích thước</dt>
                  <dd>{countOf(tables.dimStyles)} · hiện hành: {String(settings.DIMSTYLE ?? "—")}</dd>
                  <dt>Linetype</dt><dd>{countOf(tables.linetypes)}</dd>
                  <dt>Định nghĩa block</dt>
                  <dd>{countOf(tables.blocks)}{totals ? ` · ${totals.blockRefs} lần chèn` : ""}</dd>
                  <dt>Ứng dụng đã đăng ký</dt><dd>{countOf(tables.registeredApps)}</dd>
                </dl>
              </section>

              <section className="panel">
                <header><h2>Layout &amp; tham chiếu ngoài</h2></header>
                <dl className="kv">
                  <dt>Layout</dt>
                  <dd>
                    {Array.isArray(tables.layouts) && tables.layouts.length
                      ? tables.layouts.map((l) => String(record(l).name ?? l)).join(", ")
                      : "—"}
                  </dd>
                  <dt>Xref</dt>
                  <dd>
                    {xrefs.length
                      ? xrefs.map((x) => String(record(x).name ?? x)).join(", ")
                      : "không có"}
                  </dd>
                </dl>
                <div style={{ padding: "var(--s3) var(--s4)", borderTop: "1px solid var(--border)" }}>
                  <span className="needs-backend">Sửa xref chưa có endpoint</span>
                  <span className="hint" style={{ marginLeft: "var(--s2)" }}>
                    Xref đọc được nhưng không có đường ghi — phải xử lý trong AutoCAD.
                  </span>
                </div>
              </section>

              <ObjectCatalog
                payload={payload}
                /* Số lượt đọc, KHÔNG phải `collectedAt`: dấu thời gian của
                   plugin chỉ tới giây, nên đọc lại hai lần trong cùng một giây
                   cho cùng một khoá và danh mục giữ nguyên tập đã tích của lượt
                   trước — handle cũ đi kèm guard mới. */
                snapshotKey={String(info.readId)}
                staleNote={blockNote}
                guardReady={!!guard}
                busy={busy}
                profileLoading={info.refreshing}
                error={pickError}
                onPick={(handles) => void pickHandles(handles)}
              />

              <section className="panel">
                <header>
                  <h2>Từ điển đối tượng có tên</h2>
                  <div className="actions"><span className="tag mono">{dictionaries.length}</span></div>
                </header>
                <div style={{ padding: "var(--s3) var(--s4)" }}>
                  <p className="mono" style={{ fontSize: 11.5, lineHeight: 1.7, overflowWrap: "anywhere" }}>
                    {dictionaries.map((d) => String(d)).join(" · ") || "—"}
                  </p>
                </div>
              </section>
              {/* JSON thô. Không phải để người dùng đọc — để khi màn hình nói
                  một đằng và AutoCAD một nẻo thì có chỗ đối chiếu, thay vì phải
                  mở terminal gọi `curl`. Mặc định đóng: nó dài hàng nghìn dòng
                  và không ai cần nó cho việc thường ngày. */}
              {/* `open` phải là STATE, không để `<details>` tự quản: nội dung
                  bên trong vẫn được React dựng dù khối đang đóng, và
                  `JSON.stringify` một payload 350 KB ở mỗi lần render là cái giá
                  trả cho một khối không ai mở. */}
              <details
                className="panel"
                open={rawOpen}
                onToggle={(event) => setRawOpen((event.target as HTMLDetailsElement).open)}
              >
                <summary
                  style={{
                    padding: "var(--s3) var(--s4)",
                    cursor: "pointer",
                    fontSize: 13,
                    fontWeight: 620,
                  }}
                >
                  Dữ liệu thô (JSON)
                </summary>
                <div style={{ padding: "0 var(--s4) var(--s4)" }}>
                  <p className="hint" style={{ marginBottom: "var(--s2)" }}>
                    Nguyên văn phản hồi của <span className="mono">GET /api/acad/drawing-info</span>.
                    Dùng để đối chiếu khi màn hình và AutoCAD nói khác nhau.
                  </p>
                  <pre
                    className="mono"
                    style={{
                      maxHeight: 420,
                      overflow: "auto",
                      fontSize: 11.5,
                      lineHeight: 1.55,
                      padding: "var(--s3)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--r-2)",
                      background: "var(--bg)",
                      whiteSpace: "pre",
                    }}
                  >
                    {rawOpen && payload ? JSON.stringify(payload, null, 2) : "—"}
                  </pre>
                </div>
              </details>
            </div>
          </div>

          <SelectionBuilder
            payload={payload}
            docs={docs}
            activeFile={activeFile}
            busy={busy}
            profileLoading={info.refreshing}
            /* Không có bản vẽ nào mở cũng là một dạng "hồ sơ không khớp thực
               tế": mọi thao tác bên dưới sẽ nhắm vào một bản vẽ đã đóng. */
            staleNote={blockNote}
            error={error}
            onPrepare={(draft) => void prepare(draft)}
            onActivate={(file) => void startActivate(file)}
          />
        </div>
      </div>

      {pending?.kind === "activate" ? (
        <ConfirmSheet
          title="Đổi bản vẽ đang hoạt động"
          mode="selection"
          target={pending.op.target}
          summary={`AutoCAD sẽ chuyển sang ${pending.title}.`}
          confirmLabel="Xác nhận & chuyển"
          busy={busy}
          onConfirm={() => void confirm()}
          onCancel={() => {
            if (busy) return;
            void rejectStagedOp(DAEMON_BASE, pending.op);
            setPending(null);
          }}
        >
          <p className="hint">
            Không sửa bản vẽ nào. Nhưng nó đổi <b>thứ mà mọi lệnh ghi sau đó nhắm
            vào</b> — kể cả lệnh chuẩn bị từ màn hình khác.
          </p>
        </ConfirmSheet>
      ) : pending?.kind === "handles" ? (
        <ConfirmSheet
          title="Chọn đối tượng trong AutoCAD"
          mode="selection"
          target={pending.op.target}
          summary={`Đổi bộ chọn của AutoCAD sang ${pending.op.count ?? pending.count} đối tượng.`}
          confirmLabel="Xác nhận & chọn"
          busy={busy}
          onConfirm={() => void confirm()}
          onCancel={() => {
            if (busy) return;
            void rejectStagedOp(DAEMON_BASE, pending.op);
            setPending(null);
          }}
        >
          <p className="hint">
            {pending.count} đối tượng đã tích trong danh mục. Thao tác này{" "}
            <b>không sửa gì trong bản vẽ</b>.
          </p>
        </ConfirmSheet>
      ) : pending ? (
        <ConfirmSheet
          title={pending.draft.action === "select"
            ? "Chọn đối tượng trong AutoCAD"
            : "Gán đối tượng sang layer khác"}
          mode={pending.draft.action === "select" ? "selection" : "staged"}
          target={pending.op.target}
          summary={pending.draft.action === "select"
            ? `Đổi bộ chọn của AutoCAD sang ${pending.op.count ?? "?"} đối tượng.`
            : `Gán ${pending.op.count ?? "?"} đối tượng ĐANG ĐƯỢC CHỌN sang layer `
              + `${pending.draft.targetLayer}.`}
          confirmLabel={pending.draft.action === "select" ? "Xác nhận & chọn" : "Xác nhận & ghi"}
          busy={busy}
          onConfirm={() => void confirm()}
          onCancel={() => {
            /* `busy` chỉ khoá hai nút ở chân hộp thoại; phím Esc vẫn gọi được
               vào đây. Bỏ mà chạy song song với xác nhận thì lượt ghi vừa xác
               nhận hỏng với `operation_not_pending`. */
            if (busy) return;
            void rejectStagedOp(DAEMON_BASE, pending.op);
            setPending(null);
          }}
        >
          <dl className="props">
            {pending.draft.action === "select" ? (
              <>
                <dt>Phạm vi</dt>
                <dd>{pending.draft.scope === "layer" ? "layer" : "block"} · {pending.draft.value}</dd>
              </>
            ) : (
              <>
                {/* Nói rõ nguồn: thao tác này KHÔNG theo phạm vi ở cột bên. */}
                <dt>Đối tượng</dt><dd>bộ chọn hiện tại của AutoCAD</dd>
                <dt>Layer đích</dt><dd>{pending.draft.targetLayer}</dd>
              </>
            )}
          </dl>
        </ConfirmSheet>
      ) : null}
    </AppShell>
  );
}

function countOf(value: unknown): string {
  return Array.isArray(value) ? String(value.length) : "—";
}

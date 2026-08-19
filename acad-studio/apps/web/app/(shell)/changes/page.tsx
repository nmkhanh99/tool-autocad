"use client";

/** Thay đổi chờ duyệt — trục xoay của sản phẩm.
 *
 * Mọi thao tác ghi HAI PHA đều dừng ở đây — và chỉ chúng: sửa phát hiện ở
 * `/review` và chèn block ở `/library/blocks` ghi MỘT PHA, không đi qua hàng chờ
 * này. Nói "mọi lệnh ghi" là mời người ta coi màn này là sổ kiểm đầy đủ, rồi bỏ
 * sót đúng những lệnh không hoàn tác được.
 *
 * Trước giai đoạn 7, hàng chờ **không
 * nhìn thấy được**: `/prepare` trả về một id, và chỉ màn hình vừa gọi mới biết
 * id ấy. Chuẩn bị một thao tác ở màn Kiểm tra bản vẽ rồi chuyển sang màn khác là
 * nó biến mất khỏi tầm mắt — vẫn nằm trong hàng chờ của daemon, vẫn sẽ ghi khi
 * ai đó xác nhận, nhưng không ai liệt kê được. Một hàng chờ vô hình trên đường
 * ghi KHÔNG HOÀN TÁC ĐƯỢC là chỗ tệ nhất để giấu thông tin.
 *
 * ## Ba sự thật màn hình này phải nói ra
 *
 * 1. **Hàng chờ sống trong bộ nhớ daemon.** Khởi động lại là mất sạch — và
 *    không thao tác nào được ghi. An toàn, nhưng người dùng không đoán được.
 * 2. **Hết hạn tính khi ĐỌC**, không có bộ đếm giờ nền. Một mục còn `pending`
 *    trên màn hình vẫn có thể đã chết; đọc lại mới biết.
 * 3. **Ghi là một lần.** Hỏng thì phải chuẩn bị lại từ màn hình gốc, không bao
 *    giờ gọi lại cùng một id.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "../../../components/shell/AppShell";
import { Button } from "../../../components/ui/Button";
import { Tag } from "../../../components/ui/Tag";
import { ConfirmSheet } from "../../../components/ui/ConfirmSheet";
import { DAEMON_BASE } from "../../../lib/daemon/endpoints";
import { daemonFailureText } from "../../../lib/daemon/client";
import { setDrawTarget, stagedDrawPreviews, unwarnedPreviews } from "../../../lib/daemon/drawTarget";
import { type AcadDocument, documentMatchesTarget, fetchDocs } from "../../../lib/daemon/docs";
import {
  applyStagedOp,
  stagedErrorText,
} from "../../../features/staged-ops/prepareApplyReject";
import {
  applyBlockedReason,
  canReject,
  listStagedOps,
  rejectQueuedOp,
  scopeText,
  secondsLeft,
  type QueuedOp,
  type QueuedState,
} from "../../../features/staged-ops/queue";

const ACTION_LABEL: Record<string, string> = {
  "activate-document": "Chuyển bản vẽ hoạt động",
  "select": "Chọn đối tượng",
  "move-to-layer": "Chuyển layer",
};

/** Câu báo sau khi làm xong, theo TỪNG thao tác. */
const DONE_NOTE: Record<string, string> = {
  "activate-document": "Đã chuyển bản vẽ hoạt động. Không bản vẽ nào bị sửa.",
  "select": "Đã chọn đối tượng trong AutoCAD. Không bản vẽ nào bị sửa — bấm Esc để bỏ chọn.",
  "move-to-layer": "Đã ghi vào bản vẽ: chuyển layer.",
};

/** Vì sao không xác nhận được bản vẽ hoạt động — nói ra để người dùng biết đi
 * xem chỗ nào, thay vì nhận một lời từ chối không có lý do. */
function describeActives(alive: boolean, actives: readonly AcadDocument[]): string {
  if (!alive) return "không đọc được trạng thái AutoCAD";
  if (actives.length === 0) return "không bản vẽ nào đang hoạt động";
  if (actives.length > 1) return `${actives.length} bản vẽ cùng báo đang hoạt động`;
  return `đang mở: ${actives[0].title || actives[0].file || actives[0].instance}`;
}

const STATE_LABEL: Record<QueuedState, string> = {
  pending: "Chờ duyệt",
  applying: "Đang ghi",
  applied: "Đã ghi",
  rejected: "Đã bỏ",
  failed: "Hỏng",
  expired: "Quá hạn",
};

/** Thao tác nào ĐỔI bản vẽ, thao tác nào không.
 *
 * `select` chỉ đổi bộ chọn của phiên AutoCAD — gỡ ra bằng một phím Esc. Gọi nó
 * là "ghi" thì cảnh báo "không hoàn tác được" trở thành sai, và một cảnh báo sai
 * làm hỏng đúng thứ nó tồn tại để bảo vệ. */
function confirmModeFor(action: string): "staged" | "selection" | "document" {
  if (action === "move-to-layer") return "staged";
  if (action === "activate-document") return "document";
  return "selection";
}

const CONFIRM_LABEL: Record<string, string> = {
  staged: "Ghi vào bản vẽ",
  selection: "Chọn trong AutoCAD",
  document: "Chuyển sang bản vẽ này",
};

export default function ChangesPage() {
  const [ops, setOps] = useState<QueuedOp[]>([]);
  /* Hai loại lỗi, hai ô riêng. Gộp lại thì lượt đọc lại chạy trong `finally` sẽ
     XOÁ TRẮNG lý do lượt ghi vừa hỏng — mà mục hỏng lại bị bộ lọc mặc định giấu
     đi, nên người dùng mất cả lý do lẫn đường đi tiếp. */
  const [listError, setListError] = useState("");
  const [actionError, setActionError] = useState("");
  /* `loaded` = đã chạy xong một lượt đọc (dù hỏng). `hasData` = đã có một lượt
     đọc THÀNH CÔNG. Hai thứ khác nhau: mảng rỗng vì đọc hỏng không phải bằng
     chứng hàng chờ rỗng, và nói "0 thao tác đang chờ" cạnh một băng lỗi là khẳng
     định một điều chưa ai xác nhận. */
  const [loaded, setLoaded] = useState(false);
  const [hasData, setHasData] = useState(false);
  /** Lượt đọc gần nhất HỎNG: bảng còn đó nhưng nó là ảnh chụp cũ. */
  const [stale, setStale] = useState(false);
  const [busyId, setBusyId] = useState("");
  const [note, setNote] = useState("");
  const [confirmId, setConfirmId] = useState("");
  /* Chỉ hiện mục còn chờ, mặc định. Mục đã xong/đã bỏ vẫn giữ trong danh sách vì
     chúng trả lời câu "tôi vừa bấm xong, sao không thấy gì xảy ra". */
  const [onlyPending, setOnlyPending] = useState(true);
  /* Mốc thời gian của LƯỢT RENDER này. Đếm ngược và phép kiểm hết hạn phải dùng
     cùng một mốc, nếu không hai chỗ trên màn hình nói hai điều khác nhau. */
  const [now, setNow] = useState(() => Date.now());

  /* Bản xem trước của BỘ VẼ đang chờ trong AutoCAD — một hàng chờ KHÁC, màn hình
     này không hề bày ra. Xác nhận `activate-document` sẽ gọi `/draw/target`, mà
     đường đó **huỷ** mọi bản xem trước còn `staged`: nó gửi lệnh reject vào
     AutoCAD, tức là xoá hình đã vẽ, không hoàn tác được.

     Ba trạng thái, không phải hai. `"unknown"` (đọc hỏng) KHÔNG được rút về `0`:
     im lặng ở đây là hứa "không mất gì" cho một lượt bấm có thể xoá hình. */
  const [previews, setPreviews] = useState<
    { kind: "loading" } | { kind: "known"; ids: string[] } | { kind: "unknown" }
  >({ kind: "loading" });

  const sequence = useRef(0);
  const load = useCallback(async () => {
    const ticket = ++sequence.current;
    try {
      const list = await listStagedOps(DAEMON_BASE);
      if (ticket !== sequence.current) return;
      setOps(list);
      setHasData(true);
      setStale(false);
      setListError("");
    } catch (failure) {
      if (ticket !== sequence.current) return;
      /* Giữ danh sách cũ khi đọc hỏng — cùng lối với `/docs`: một lượt đọc lỗi
         không phải bằng chứng hàng chờ đã rỗng. */
      setListError(daemonFailureText(failure));
      /* Số đang hiện là của lượt đọc TRƯỚC. Giữ nguyên bảng (mất nó còn tệ hơn)
         nhưng thôi khẳng định nó là hiện tại — một màn hình an toàn không được
         bày một con số đã cũ như thể vừa đọc xong. */
      setStale(true);
    } finally {
      if (ticket === sequence.current) setLoaded(true);
    }
  }, []);

  /* Đọc lại theo nhịp, CÙNG nhịp với huy hiệu ở thanh trên. Không có nó thì một
     thao tác chuẩn bị ở tab khác làm huy hiệu nhảy lên 2 trong khi bảng ở đây vẫn
     trống — hai con số trên cùng một màn hình nói hai điều khác nhau, đúng thứ
     vừa sửa xong ở tầng chip. */
  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5_000);
    return () => clearInterval(timer);
  }, [load]);

  /* Nhịp một giây: hàng chờ hết hạn theo thời gian, nên một màn hình đứng im sẽ
     mời người dùng bấm vào thứ đã chết. Chỉ cập nhật ĐỒNG HỒ, không gọi mạng. */
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, []);

  const visible = useMemo(
    /* Bộ lọc mặc định giấu đúng hai thứ người dùng đã TỰ quyết: đã ghi, đã bỏ.
       `failed` và `expired` là kết cục họ KHÔNG chọn — một lượt ghi hỏng ở tab
       khác mà bảng này im lặng thì đúng bằng việc không có màn hình này. */
    () => (onlyPending
      ? ops.filter((op) => op.state !== "applied" && op.state !== "rejected")
      : ops),
    [ops, onlyPending],
  );
  const pendingCount = ops.filter((op) => op.state === "pending").length;
  const confirming = ops.find((op) => op.id === confirmId) ?? null;
  const confirmingActivate = confirming?.action === "activate-document";

  /* Đọc lúc MỞ thẻ, không phải lúc bấm: câu "xác nhận sẽ huỷ N bản xem trước"
     chỉ có nghĩa nếu nó nằm trước cái nút, chứ không phải trong lời báo sau khi
     hình đã bị xoá. Chỉ đọc cho `activate-document` — các thao tác khác không
     đụng tới `/draw/target`. */
  useEffect(() => {
    if (!confirmingActivate) return;
    let alive = true;
    setPreviews({ kind: "loading" });
    void (async () => {
      try {
        const ids = await stagedDrawPreviews(DAEMON_BASE);
        if (!alive) return;
        setPreviews(ids === undefined ? { kind: "unknown" } : { kind: "known", ids });
      } catch {
        if (!alive) return;
        setPreviews({ kind: "unknown" });
      }
    })();
    return () => { alive = false; };
    /* Đọc lại khi ĐỔI sang thao tác khác, không chỉ khi mở/đóng thẻ: bỏ `confirmId`
       ra khỏi đây là bấm mục thứ hai vẫn hiện con số của mục thứ nhất. */
  }, [confirmingActivate, confirmId]);

  const runApply = async (op: QueuedOp) => {
    if (applyBlockedReason(op, Date.now()) || busyId) return;
    setBusyId(op.id);
    setActionError("");
    /* Bao nhiêu bản xem trước của bộ vẽ THỰC SỰ bị xoá trong lượt này. Lời báo
       thành công phải nói ra: "Không bản vẽ nào bị sửa" ngay sau khi vừa xoá hình
       đã vẽ là câu sai, và nó sai đúng ở chỗ người dùng sẽ tin. */
    let discarded = 0;
    /* Mã của những bản xem trước sẽ bị xoá NẾU `setDrawTarget` chạy. Đọc ở phép
       kiểm trước lúc ghi, dùng lại ở lời báo — đọc thêm một lần nữa sau khi đã
       xoá thì chỉ nhận được danh sách rỗng. */
    let doomed: string[] = [];
    /* `/draw/target` huỷ TỪNG bản xem trước một, và trả lỗi ngay khi một cái
       hỏng — những cái trước đó thì đã bị xoá khỏi AutoCAD rồi. Nên "lời gọi
       hỏng" KHÔNG có nghĩa là "không mất gì": phải nói ra là không chắc, thay vì
       im lặng rồi để lời báo mặc định hứa rằng bản vẽ còn nguyên. */
    let previewsUncertain = false;
    try {
      /* Đọc lại hàng chờ bộ vẽ NGAY TRƯỚC khi ghi, và dừng nếu nó đã đổi kể từ
         lúc thẻ hiện ra. Một tab khác có thể vừa dựng một bản xem trước trong
         khoảng đó — người dùng khi ấy đã đồng ý với một câu cảnh báo không còn
         đúng nữa.
         Phải đặt TRƯỚC `applyStagedOp`: đây là điểm dừng sạch duy nhất. Xong lượt
         kích hoạt rồi mới bỏ `setDrawTarget` thì bản vẽ đã chuyển mà đích vẽ còn
         trỏ chỗ cũ — đúng cái hố mà bước đồng bộ này sinh ra để lấp. */
      if (op.action === "activate-document") {
        const current = await stagedDrawPreviews(DAEMON_BASE).catch(() => undefined);
        doomed = current ?? [];
        /* Đọc hỏng thì DỪNG, không đi tiếp. Hai phía không cân nhau: chặn nhầm
           thì người dùng thử lại, còn đi liều thì `/draw/target` xoá hình đã vẽ
           và không có đường về. Vả lại `/draw/ops` chỉ đọc một Map trong bộ nhớ
           — nó hỏng nghĩa là daemon đang có chuyện, và lượt ghi ngay sau đó nhiều
           khả năng cũng hỏng. */
        if (current === undefined) {
          setBusyId("");
          setActionError(
            "KHÔNG đọc được hàng chờ của bộ vẽ, nên chưa ghi gì cả: đổi bản vẽ sẽ "
            + "xoá mọi bản xem trước đang chờ, và lúc này không biết đang có những "
            + "gì. Kiểm tra daemon rồi thử lại.",
          );
          return;
        }
        /* So theo MÃ, không theo số lượng: một tab khác bỏ một bản xem trước rồi
           dựng cái mới thì con số y nguyên, nhưng thứ sắp bị xoá đã là thứ khác —
           người dùng đồng ý mất A rồi mất B. */
        const fresh = unwarnedPreviews(
          previews.kind === "known" ? previews.ids : [], current,
        );
        if (fresh.length) {
          setBusyId("");
          setConfirmId("");
          setActionError(
            `Bộ vẽ vừa có thêm ${fresh.length} bản xem trước mà thẻ xác nhận chưa `
            + "nói tới. KHÔNG ghi gì cả, vì đổi bản vẽ sẽ xoá chúng. Mở lại thao "
            + "tác này để xem hàng chờ mới rồi quyết.",
          );
          return;
        }
      }
      await applyStagedOp(DAEMON_BASE, op);
      /* Kích hoạt bản vẽ xong PHẢI đặt lại đích vẽ. Daemon giữ hai đích khác
         nhau, và `activate-document` chỉ đổi cái của AutoCAD — không đổi đích của
         `/draw/stage`. Bỏ bước này là lệnh vẽ tiếp theo ghi vào bản vẽ CŨ, trong
         khi thẻ xác nhận vừa hứa ngược lại. Lỗi ở đây báo riêng: bản vẽ đã chuyển
         thật, chỉ là đích vẽ chưa theo kịp — hai câu khác nhau. */
      if (op.action === "activate-document") {
        try {
          /* Đọc lại xem bản vẽ ĐANG hoạt động có đúng cái vừa kích hoạt không.
             Hai tab cùng mở màn này thì lượt của tab A có thể về SAU lượt của tab
             B: A ghi đè đích vẽ thành A trong khi bản vẽ đang mở là B, và lệnh vẽ
             kế tiếp đi nhầm chỗ.
             Chốt này THU HẸP cửa sổ chứ không đóng hẳn — vẫn còn khe giữa lúc đọc
             và lúc POST. Đóng hẳn phải gộp hai bước vào một giao dịch phía daemon;
             `/draw/target` hiện còn huỷ staged op và tự giải bản vẽ, nên gộp là
             một thay đổi chéo module có rủi ro riêng. Ghi vào ROADMAP. */
          const snapshot = await fetchDocs(DAEMON_BASE);
          const actives = snapshot.docs.filter((doc) => doc.active);
          /* So bằng CẢ BA dạng đích. `op.target` có thể là đường dẫn, MÃ PHIÊN
             (bản vẽ chưa lưu) hay tiêu đề — daemon chọn dạng nào là tuỳ năng lực
             plugin lúc chuẩn bị. Một phép so `file || title` sẽ LUÔN lệch với mã
             phiên, và khi đó chốt này nổ mỗi lần: nó bỏ qua `setDrawTarget` đúng
             ở nhóm bản vẽ chưa lưu, tức gây ra chính cái nó sinh ra để chặn. */
          /* Chốt ĐÓNG khi không biết, không phải mở. Bản trước hỏi "có chắc là
             SAI không" — nên đọc không ra bản vẽ hoạt động nào, hay đọc không
             tới AutoCAD, đều lọt xuống nhánh gọi. Mà nhánh gọi là nhánh XOÁ:
             `/draw/target` huỷ mọi bản xem trước đang chờ. Câu đúng phải là "có
             chắc là ĐÚNG không": một phản hồi sống, đúng MỘT bản vẽ hoạt động,
             và nó khớp đích. Thiếu bất kỳ vế nào thì không gọi.
             Nhiều bản vẽ cùng khai `active` cũng là không biết: `find` sẽ nhặt
             cái đầu danh sách, tức đoán bừa ngay trước một lệnh xoá. */
          const confirmed = snapshot.alive
            && actives.length === 1
            && documentMatchesTarget(actives[0], op.target);
          if (!confirmed) {
            setActionError(
              "Đã gửi lệnh chuyển bản vẽ, nhưng KHÔNG xác nhận được AutoCAD đang "
              + `mở đúng bản vẽ đó (${describeActives(snapshot.alive, actives)}). `
              + "KHÔNG đặt lại đích vẽ — bước đó còn huỷ mọi bản xem trước đang "
              + "chờ của bộ vẽ. Đọc lại rồi làm lại nếu vẫn cần.",
            );
          } else {
            previewsUncertain = doomed.length > 0;
            await setDrawTarget(DAEMON_BASE, op.target);
            previewsUncertain = false;
            /* `/draw/target` vừa gửi lệnh reject vào AutoCAD cho từng bản xem
               trước còn `staged`. Đếm để nói ra ở lời báo — chỉ ở nhánh này, vì
               nhánh trên KHÔNG gọi và do đó không xoá gì. */
            discarded = doomed.length;
          }
        } catch (failure) {
          setActionError(
            "Đã chuyển bản vẽ hoạt động, nhưng KHÔNG đặt được đích vẽ: "
            + `${daemonFailureText(failure)} — lệnh vẽ tiếp theo có thể ghi vào bản vẽ cũ.`
            + (previewsUncertain
              ? ` Ngoài ra ${doomed.length} bản xem trước của bộ vẽ CÓ THỂ đã bị `
                + "xoá một phần: bước đặt đích huỷ từng cái một và dừng giữa chừng "
                + "khi hỏng. Mở màn hình vẽ để xem còn lại những gì."
              : ""),
          );
        }
      }
      setConfirmId("");
      /* KHÔNG phải lúc nào cũng "Đã ghi": `select` chỉ đổi bộ chọn và
         `activate-document` chỉ đổi tab. Thẻ xác nhận vừa nói rõ "không sửa gì
         trong bản vẽ" — báo "Đã ghi" ngay sau đó là tự mâu thuẫn, và người dùng
         sẽ tin bản vẽ đã bị đổi. */
      /* Có bản xem trước bị xoá thì THAY câu, không phải nối thêm: "Không bản vẽ
         nào bị sửa. Đã huỷ 2 bản xem trước…" là hai vế chọi nhau trong một hơi,
         và người dùng sẽ tin vế đầu. */
      setNote(
        discarded
          ? `Đã chuyển bản vẽ hoạt động. Kèm theo đó, ${discarded} bản xem trước của `
            + "bộ vẽ đã bị huỷ — hình đó đã xoá khỏi AutoCAD và không lấy lại được."
          : previewsUncertain
            /* Hỏng giữa chừng: không biết đã xoá mấy cái. Câu mặc định ("không
               bản vẽ nào bị sửa") lúc này là lời trấn an sai. */
            ? "Đã chuyển bản vẽ hoạt động, nhưng bước đặt đích hỏng giữa chừng — "
              + "xem lời báo lỗi ở trên về các bản xem trước."
            : DONE_NOTE[op.action] ?? `Đã thực hiện: ${op.action}.`,
      );
    } catch (failure) {
      setConfirmId("");
      setActionError(stagedErrorText(failure));
      /* Lượt ghi hỏng thì mục đó chuyển sang `failed` — mà bộ lọc mặc định giấu
         nó đi. Mở bộ lọc ra để người dùng THẤY được thứ vừa hỏng. */
      setOnlyPending(false);
    } finally {
      setBusyId("");
      /* Đọc lại DÙ THÀNH CÔNG HAY HỎNG: trạng thái thật nằm ở daemon, và đoán
         nó từ phía này là bày ra một hàng chờ không khớp thực tế. */
      await load();
    }
  };

  const runReject = async (op: QueuedOp) => {
    if (busyId || !canReject(op, Date.now())) return;
    setBusyId(op.id);
    setActionError("");
    try {
      /* `rejectQueuedOp`, KHÔNG phải `rejectStagedOp`: bản kia cố ý nuốt lỗi vì
         nó chạy lúc rời màn hình. Ở đây người dùng vừa bấm "Bỏ" và đang chờ câu
         trả lời — báo "Đã bỏ" cho một lượt hỏng là nói sai, và thao tác đó vẫn
         nằm trong hàng chờ chờ ai đó xác nhận. */
      await rejectQueuedOp(DAEMON_BASE, op);
      setNote(`Đã bỏ: ${ACTION_LABEL[op.action] ?? op.action}.`);
    } catch (failure) {
      setActionError(stagedErrorText(failure));
    } finally {
      setBusyId("");
      await load();
    }
  };

  return (
    <AppShell
      screen="changes"
      title="Thay đổi chờ duyệt"
      sub={hasData
        ? `${pendingCount} thao tác bộ chọn đang chờ${stale ? " (số của lần đọc trước)" : ""}`
        : loaded
          ? "Chưa đọc được hàng chờ"
          : "Mọi lệnh ghi vào bản vẽ dừng ở đây chờ người xác nhận"}
      actions={
        <>
          <Button onClick={() => setOnlyPending((value) => !value)}
            aria-pressed={!onlyPending}>
            {onlyPending ? "Hiện cả mục đã xong" : "Ẩn mục đã xong"}
          </Button>
          <Button onClick={() => void load()}>Đọc lại</Button>
        </>
      }
    >
      <div className="stack">
        {actionError ? (
          <div className="banner" data-tone="hard">
            <span className="bt">{actionError}</span>
            <span className="actions">
              <Button onClick={() => setActionError("")}>Ẩn</Button>
            </span>
          </div>
        ) : null}
        {listError ? (
          <div className="banner">
            <span className="bt">Không đọc được hàng chờ: {listError}</span>
            <span className="actions">
              <Button onClick={() => void load()}>Thử lại</Button>
            </span>
          </div>
        ) : null}
        {note ? (
          <div className="banner">
            <span className="bt">{note}</span>
            <span className="actions">
              <Button onClick={() => setNote("")}>Ẩn</Button>
            </span>
          </div>
        ) : null}

        <section className="panel">
          <header>
            <h2>Hàng chờ</h2>
            <div className="actions">
              {/* Chưa đọc được lần nào thì KHÔNG hiện `0`: bảng rỗng vì lỗi
                  trông y hệt bảng rỗng vì hàng chờ trống, mà hai câu đó ngược
                  nhau — một bên là "không có gì phải làm", bên kia là "có thể
                  đang có một lệnh ghi chờ xác nhận". */}
              <span className="tag mono">{hasData ? visible.length : "—"}</span>
            </div>
          </header>

          {/* Hai sự thật người dùng không có cách nào tự đoán ra. */}
          <div style={{ padding: "var(--s3) var(--s4)", borderBottom: "1px solid var(--border)" }}>
            <p className="hint" style={{ margin: 0 }}>
              Hàng chờ sống trong <b>bộ nhớ của daemon</b>: khởi động lại daemon là
              mất sạch — và <b>không thao tác nào được ghi</b>. Mỗi thao tác cũng
              tự hết hạn sau vài phút.
            </p>
            {/* Nói ĐÚNG phạm vi. Daemon giữ nhiều hàng chờ rời nhau, và bảng này
                mới đọc được MỘT: hàng chờ của bộ chọn. Bản xem trước của bộ vẽ
                (`/draw/stage`) nằm trong một map khác và duyệt ở chỗ khác.
                Để câu "mọi lệnh ghi dừng ở đây" đứng nguyên là hứa một thứ màn
                hình chưa làm — và ở màn AN TOÀN thì lời hứa thừa nguy hiểm hơn
                một khoảng trống được nói rõ. */}
            <p className="hint" style={{ margin: "var(--s2) 0 0" }}>
              Bảng này liệt kê thao tác của <b>bộ chọn</b> — chọn đối tượng, chuyển
              layer, đổi bản vẽ hoạt động. <b>Bản xem trước của lệnh vẽ</b>{" "}
              (<span className="mono">/draw/stage</span>) là một hàng chờ riêng của
              máy chủ và <b>chưa hiện ở đây</b>; nó vẫn được duyệt ở màn hình cũ.
            </p>
          </div>

          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Thao tác</th><th>Bản vẽ</th><th className="n">Đối tượng</th>
                  <th>Trạng thái</th><th className="n">Còn lại</th><th></th>
                </tr>
              </thead>
              <tbody>
                {visible.map((op) => {
                  const blocked = applyBlockedReason(op, now);
                  const left = secondsLeft(op, now);
                  return (
                    <tr key={op.id}>
                      <td>
                        {ACTION_LABEL[op.action] ?? op.action}
                        {scopeText(op) ? <> · <code>{scopeText(op)}</code></> : null}
                        {op.toLayer ? <> → <code>{op.toLayer}</code></> : null}
                        {op.error ? (
                          <div className="hint" style={{ margin: 0 }}>{op.error}</div>
                        ) : null}
                      </td>
                      <td className="mono" title={op.target}>{op.documentTitle}</td>
                      {/* Thiếu số ĐẾM là "không biết", không phải 0 — xem
                          `countOf()`. Hiện `0` thay cho nó là nói với người dùng
                          một điều daemon chưa hề nói. */}
                      <td className="n mono">{op.count === undefined ? "—" : op.count}</td>
                      <td><Tag>{STATE_LABEL[op.state]}</Tag></td>
                      <td className="n mono">
                        {op.state === "pending" && left !== undefined ? `${left}s` : "—"}
                      </td>
                      <td>
                        <div className="actions">
                          <Button variant="primary"
                            disabled={!!blocked || !!busyId}
                            title={blocked || undefined}
                            onClick={() => setConfirmId(op.id)}>
                            Xác nhận
                          </Button>
                          {/* Daemon nhận `["pending","failed"]`. Khoá mục hỏng
                              là để nó nằm đó tới khi bị đẩy ra vì quá số lượng. */}
                          <Button
                            disabled={!!busyId || !canReject(op, now)}
                            onClick={() => void runReject(op)}>
                            Bỏ
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {loaded && !visible.length && !listError ? (
                  <tr><td colSpan={6}>
                    <span className="hint">
                      {onlyPending
                        ? "Không có thao tác nào đang chờ hay vừa hỏng."
                        : "Hàng chờ trống."}
                    </span>
                  </td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel">
          <header><h2>Chuẩn bị thao tác ở đâu</h2></header>
          <div style={{ padding: "var(--s3) var(--s4)" }}>
            <p className="hint" style={{ margin: 0 }}>
              Màn hình này chỉ <b>duyệt</b>. Thao tác được tạo ở nơi bạn đang làm
              việc: <Link href="/review/">Kiểm tra bản vẽ</Link> (chọn đối tượng
              từ một phát hiện), <Link href="/drawing-info/">Hồ sơ bản vẽ</Link>{" "}
              và <Link href="/workspace/">Không gian làm việc</Link>. Hỏng thì
              phải quay lại đúng chỗ đó chuẩn bị lại — <b>không gọi lại cùng một
              thao tác</b>.
            </p>
          </div>
        </section>
      </div>

      {confirming ? (
        <ConfirmSheet
          title="Xác nhận thao tác đã chuẩn bị"
          /* `staged` cho lệnh ĐỔI bản vẽ; `selection` cho lệnh chỉ đổi bộ chọn.
             Dùng chung một chế độ là nói sai một trong hai — và `ConfirmSheet`
             đã ghi rõ vì sao cảnh báo sai còn tệ hơn không cảnh báo. */
          mode={confirmModeFor(confirming.action)}
          /* Đích CHÍNH XÁC, không phải tiêu đề thân thiện: hai bản vẽ đang mở
             có thể trùng tiêu đề, và đây là bước xác nhận cuối của một lệnh
             MỘT LẦN. Bảng ở trên đã hiện tiêu đề cho dễ đọc; chỗ này cần thứ
             phân biệt được. */
          target={confirming.target || confirming.documentTitle}
          /* Phạm vi phải có mặt: hai đề xuất chọn trên CÙNG một bản vẽ trông y
             hệt nhau nếu chỉ có tên thao tác và số đối tượng — và đây là bước xác
             nhận cuối của một lệnh một lần. */
          summary={`${ACTION_LABEL[confirming.action] ?? confirming.action}`
            + `${scopeText(confirming) ? ` · ${scopeText(confirming)}` : ""}`
            + `${confirming.count === undefined ? "" : ` · ${confirming.count} đối tượng`}`
            + `${confirming.toLayer ? ` · sang layer ${confirming.toLayer}` : ""}`}
          confirmLabel={CONFIRM_LABEL[confirmModeFor(confirming.action)]}
          busy={busyId === confirming.id}
          /* Đang kiểm thì KHOÁ nút. Câu "sẽ huỷ N bản xem trước" chỉ bảo vệ
             được người dùng nếu nó kịp hiện trước lúc bấm — để nút sống trong
             lúc còn đang đọc là mở đúng cái cửa mà cảnh báo sinh ra để đóng. */
          blocked={applyBlockedReason(confirming, now)
            || (confirmingActivate && previews.kind === "loading"
              ? "Đang kiểm hàng chờ của bộ vẽ — xác nhận có thể xoá bản xem trước đang chờ."
              : "")
            /* Đọc hỏng cũng khoá, cùng lý do với phép kiểm lúc gửi: không biết
               đang có gì thì không được ghi một lượt sẽ xoá chúng. Để nút sống ở
               đây là hứa một điều lúc gửi sẽ từ chối — người dùng bấm rồi nhận
               lỗi, và không hiểu vì sao nút lại sáng. */
            || (confirmingActivate && previews.kind === "unknown"
              ? "Chưa đọc được hàng chờ của bộ vẽ. Kiểm tra daemon rồi mở lại thao tác này."
              : "")}
          onConfirm={() => void runApply(confirming)}
          onCancel={() => setConfirmId("")}
        >
          {/* Hàng chờ của BỘ VẼ, thứ màn hình này không bày ra. Xác nhận sẽ gọi
              `/draw/target`, và đường đó gửi lệnh reject vào AutoCAD cho mọi bản
              xem trước còn `staged` — hình đã vẽ bị xoá, không hoàn tác được.
              Người dùng vẫn có quyền làm việc đó; điều không được phép là làm mà
              không biết. */}
          {confirmingActivate && previews.kind === "loading" ? (
            <p className="hint">Đang kiểm hàng chờ của bộ vẽ…</p>
          ) : null}
          {confirmingActivate && previews.kind === "unknown" ? (
            /* Đọc hỏng KHÔNG được rút về "không có gì": im lặng ở đây là hứa
               "không mất gì" cho một lượt bấm có thể xoá hình đã vẽ. */
            <div className="banner" data-tone="hard" role="alert">
              <span className="bm" aria-hidden="true" />
              <span className="bt">
                <b>KHÔNG đọc được hàng chờ của bộ vẽ.</b> Nếu đang có bản xem
                trước chờ trong AutoCAD, xác nhận sẽ xoá nó và không hoàn tác được.
              </span>
            </div>
          ) : null}
          {confirmingActivate && previews.kind === "known" && previews.ids.length > 0 ? (
            <div className="banner" data-tone="hard" role="alert">
              <span className="bm" aria-hidden="true" />
              <span className="bt">
                <b>Sẽ huỷ {previews.ids.length} bản xem trước</b> đang chờ của bộ vẽ.
                Đổi bản vẽ sẽ xoá hình đã vẽ trong AutoCAD, không hoàn tác được.
                Muốn giữ thì đóng thẻ này và sang màn hình vẽ chốt chúng trước.
              </span>
            </div>
          ) : null}
        </ConfirmSheet>
      ) : null}
    </AppShell>
  );
}

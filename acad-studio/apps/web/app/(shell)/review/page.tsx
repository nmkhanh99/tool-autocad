"use client";

/** Quét bản vẽ theo hồ sơ quy tắc, rồi sửa các phát hiện đã chọn.
 *
 * ## Vì sao tách khỏi `/standards`
 *
 * Panel legacy gộp soạn hồ sơ và quét vào một hộp thoại. Hai việc đó khác nhau
 * ở chỗ quan trọng nhất: soạn hồ sơ không chạm vào bản vẽ, còn màn hình này
 * **ghi thẳng và không hoàn tác được**.
 *
 * ## Ghi MỘT PHA — khác mọi màn hình ghi khác của app
 *
 * `/standards/apply` dispatch LISP thẳng vào AutoCAD. Không có `prepare`, không
 * có id để huỷ, không có hàng chờ ở màn Thay đổi. Bấm xác nhận là AutoCAD sửa.
 * Vì vậy thẻ xác nhận ở đây dùng `mode="immediate"`, không phải `"staged"`.
 *
 * ## Ràng buộc nối với `/standards`
 *
 * Một lượt quét gắn với **phiên bản hồ sơ** lúc quét. Sửa hồ sơ ở màn kia là
 * giết mọi lượt quét đang mở ở đây — máy chủ trả 409. Panel cũ không bao giờ
 * gặp vì nó khoá nút quét khi hồ sơ còn thay đổi chưa lưu. Xem
 * `profileDriftNote()`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "../../../components/shell/AppShell";
import { Button } from "../../../components/ui/Button";
import { Tag } from "../../../components/ui/Tag";
import { ConfirmSheet } from "../../../components/ui/ConfirmSheet";
import { prepareSelectHandles } from "../../../features/staged-ops/selectHandles";
import {
  applyStagedOp, rejectStagedOp, stagedErrorText,
} from "../../../features/staged-ops/prepareApplyReject";
import type { StagedOp } from "../../../features/staged-ops/types";
import { Icon } from "../../../components/ui/icons";
import { WriteButton } from "../../../components/ui/WriteButton";
import { fetchDocs, type AcadDocument } from "../../../lib/daemon/docs";
import { useAcadEvents } from "../../../features/acad-connection/events";
import { DAEMON_BASE, endpoints } from "../../../lib/daemon/endpoints";
import { DaemonError, daemonFailureText, daemonRecord } from "../../../lib/daemon/client";
import {
  applyBlockedReason,
  dimspaceBlockedReason,
  issueAxis,
  applySummary,
  filterIssues,
  normalizeProfile,
  normalizeScan,
  pickBlockedReason,
  profileDriftNote,
  scanBlockedReason,
  severityCounts,
  sendTarget,
  severityLabel,
  targetOf,
  unsupportedFixReason,
  type Issue,
  type Scan,
  type Severity,
  type StandardsProfile,
} from "../../../features/standards/model";
import {
  chipKey,
  filterByScope,
  scopeChips,
  scopeLabel,
} from "../../../features/review/scopes";
import { RecognizedObjects } from "../../../features/standards/RecognizedObjects";
import { DimensionTable } from "../../../features/standards/DimensionTable";

const SEVERITIES: readonly (Severity | "all")[] = ["all", "error", "warning", "info"];

function shown(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Lỗi nói rằng BẢN VẼ đã đổi, tức handle của lượt quét chết hẳn.
 *
 * Hẹp hơn `isStale()` một cách có chủ ý. Tập đó còn gồm `selection_stale` /
 * `scope_stale` / `destination_stale` — những lỗi về **bộ chọn hiện hành**, thứ
 * người dùng đổi chỉ bằng cách bấm vào một đối tượng khác trong AutoCAD. Dùng cả
 * tập để đánh dấu lượt quét đã cũ là bắt quét lại toàn bộ vì một nguyên nhân
 * hoàn toàn vô hại, trong khi lượt quét vẫn còn đúng nguyên.
 */
const DRAWING_MOVED = new Set(["document_stale", "drawing_stale", "target_mismatch"]);
function drawingMoved(failure: unknown): boolean {
  return failure instanceof DaemonError && DRAWING_MOVED.has(failure.code);
}

export default function ReviewPage() {
  const [docs, setDocs] = useState<AcadDocument[]>([]);
  const [docsAlive, setDocsAlive] = useState(false);
  const [target, setTarget] = useState("");

  const [profiles, setProfiles] = useState<StandardsProfile[]>([]);
  const [profileId, setProfileId] = useState("");
  const [profilesError, setProfilesError] = useState("");

  const [scan, setScan] = useState<Scan | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState("");
  /* Bản vẽ đã đổi kể từ lượt quét. Nghe sự kiện reactor thay vì dò theo nhịp —
     lượt quét là việc NẶNG, chạy lại nó theo nhịp sẽ làm AutoCAD giật. */
  const [drawingChanged, setDrawingChanged] = useState(false);
  const scanDirtyRef = useRef(false);

  const [severity, setSeverity] = useState<Severity | "all">("all");
  /* Nhóm phát hiện đang lọc, hoặc `all`. Giữ nguyên khi đổi lượt quét: người dùng
     lọc "Hàng dim" rồi quét lại là muốn xem lại đúng nhóm đó. Nhóm biến mất khỏi
     lượt mới thì chip của nó về 0 và bảng rỗng — nói đúng sự thật, khác hẳn với
     việc tự nhảy về "Tất cả" rồi bày một danh sách người dùng không yêu cầu. */
  const [scope, setScope] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [detailId, setDetailId] = useState("");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
  /* Chọn đối tượng trong AutoCAD — cầu nối duy nhất từ danh sách phát hiện sang
     bản vẽ. Đi qua HAI PHA như mọi lệnh chạm vào AutoCAD, dù chọn KHÔNG ghi gì:
     backend bắt vậy, và người dùng đang nhìn một ảnh chụp nên "chọn cái gì" vẫn
     là câu đáng xác nhận. */
  const [pickOp, setPickOp] = useState<{ op: StagedOp; count: number; label: string } | null>(null);
  const [pickBusy, setPickBusy] = useState(false);
  const [pickError, setPickError] = useState("");
  /* DIM chuẩn cho lệnh căn hàng. Thuộc về LƯỢT QUÉT — dimension của lượt khác là
     handle khác — nên phải xoá khi lượt quét đổi. */
  const [dimBaseHandle, setDimBaseHandle] = useState("");
  /* Gương của `pickOp` cho hiệu ứng ở trên. Đưa `pickOp` vào deps là hiệu ứng
     chạy lại ngay khi vừa đặt nó, và `pickScanId` lúc đó đã bằng `scanId` hiện
     tại nên không huỷ nhầm — nhưng phụ thuộc thừa vào một giá trị đổi liên tục
     là mời một lỗi khó thấy về sau. */
  /* `scanId` của lượt quét ĐANG hiển thị. Dùng ở hai chỗ: chặn một thao tác
     chuẩn bị xong muộn sau khi đã có lượt quét mới, và huỷ thao tác đang chờ khi
     lượt quét đổi. Neo theo `scanId` chứ không theo tham chiếu `scan` — mọi lượt
     nạp lại hồ sơ đều tạo tham chiếu mới. */
  const scanIdRef = useRef("");
  const pickOpRef = useRef<{ op: StagedOp; count: number; label: string } | null>(null);
  /* Gương của `pickBusy` cho hiệu ứng huỷ-theo-`scanId`: hiệu ứng đó neo vào
     `scan?.scanId` nên không được phép có `pickBusy` trong deps. */
  const pickBusyRef = useRef(false);
  useEffect(() => { pickOpRef.current = pickOp; }, [pickOp]);
  useEffect(() => { pickBusyRef.current = pickBusy; }, [pickBusy]);
  const [applyNote, setApplyNote] = useState("");

  const docsSequence = useRef(0);
  /* Vé cho lượt quét. Ô chọn bản vẽ/hồ sơ vẫn bấm được trong lúc quét, và chúng
     vứt lượt quét cũ — nếu không có vé thì phản hồi của lượt quét CŨ sẽ ghi đè
     lên bối cảnh MỚI, tức bày một danh sách phát hiện của bản vẽ khác. */
  const scanSequence = useRef(0);
  const loadDocs = useCallback(() => {
    const ticket = ++docsSequence.current;
    fetchDocs(DAEMON_BASE)
      .then((snapshot) => {
        if (ticket !== docsSequence.current) return;
        /* Giữ danh sách cũ khi plugin không trả lời — cùng lối với
           `/drawing-info`: một lượt đọc hỏng không phải bằng chứng AutoCAD
           không còn bản vẽ nào. */
        if (snapshot.alive) setDocs(snapshot.docs);
        setDocsAlive(snapshot.alive);
      })
      .catch(() => {
        if (ticket !== docsSequence.current) return;
        setDocsAlive(false);
      });
  }, []);
  useEffect(loadDocs, [loadDocs]);

  const loadProfiles = useCallback(() => {
    setProfilesError("");
    fetch(endpoints.standardsProfiles(DAEMON_BASE), { cache: "no-store" })
      .then(daemonRecord)
      .then((body) => {
        const list = Array.isArray(body.profiles) ? body.profiles.map(normalizeProfile) : [];
        setProfiles(list);
        setProfileId((current) => current || String(body.activeProfileId || "") || list[0]?.id || "");
      })
      .catch((failure) => setProfilesError(daemonFailureText(failure)));
  }, []);
  useEffect(loadProfiles, [loadProfiles]);

  useAcadEvents(DAEMON_BASE, (event) => {
    if (event.type.startsWith("doc") || event.type === "pluginLoaded") loadDocs();
    /* Bản vẽ đổi thì kết quả quét đã cũ. KHÔNG tự quét lại: quét là việc nặng
       và người dùng có thể đang đọc dở danh sách phát hiện. Nói ra và để họ
       bấm. */
    if (event.type === "drawingModified" && !event.replay) {
      /* CHỈ giết lượt quét khi thay đổi thuộc đúng bản vẽ đã quét. Sửa một bản
         vẽ khác đang mở không làm kết quả của bản vẽ này sai, mà chặn nút sửa
         thì bắt người dùng quét lại một cách vô ích. Không biết `activeDoc` là
         gì (chuỗi rỗng) thì coi như có liên quan — chiều an toàn. */
      /* Hai bản vẽ trùng TÊN (`/a/plan.dwg` và `/b/plan.dwg`) phát cùng một
         tiêu đề, nên tiêu đề không phân biệt được chúng. Lúc đó coi như CÓ liên
         quan — chiều an toàn: chặn thừa thì quét lại, bỏ sót thì sửa lên một
         bản vẽ đã đổi. */
      const ambiguous = docs.filter(
        (doc) => (doc.title || "").trim() === scannedTitle,
      ).length > 1;
      const mine = ambiguous || !event.activeDoc || !scannedTitle
        || event.activeDoc.trim() === scannedTitle;
      if (!mine) return;
      setDrawingChanged(true);
      /* Ghi lại rằng bản vẽ đổi TRONG LÚC quét, để lượt quét về không xoá mất
         cảnh báo này. */
      if (scanBusy) scanDirtyRef.current = true;
    }
  });

  /* Bỏ lượt quét đang có (và lượt đang bay). BỐN việc phải làm cùng nhau, và
     làm thiếu một cái là một ngõ cụt riêng:
       · tăng vé      → phản hồi cũ không ghi đè bối cảnh mới
       · xoá kết quả  → không bày phát hiện của bản vẽ khác
       · xoá cờ bận   → nếu không, `finally` của lượt cũ bỏ qua vì vé đã lệch và
                        màn hình kẹt ở "Đang quét…" cho tới khi tải lại trang
       · xoá cờ bẩn   → cờ sót lại sẽ chặn nút sửa của lượt quét SẠCH tiếp theo */
  const abandonScan = useCallback(() => {
    scanSequence.current += 1;
    scanDirtyRef.current = false;
    setScan(null);
    setPicked(new Set());
    setDetailId("");
    setScanBusy(false);
  }, []);

  /* Đích để GỬI, không phải để so. `sendTarget()` ưu tiên mã phiên cho bản vẽ
     chưa lưu — thứ duy nhất chỉ đích danh được khi hai bản vẽ trùng tiêu đề — và
     chỉ làm vậy khi plugin công bố là nó nhận mã phiên. */
  const activeFile = useMemo(
    () => sendTarget(docs.find((doc) => doc.active) ?? {}),
    [docs],
  );

  /* Tiêu đề của bản vẽ ĐÃ QUÉT. Sự kiện reactor mang `activeDoc` là TIÊU ĐỀ,
     còn `scan.target` là đường dẫn tệp — so thẳng hai thứ đó là không bao giờ
     khớp, và mọi thay đổi ở mọi bản vẽ đều giết lượt quét.
     Ở đây dùng `targetOf` chứ KHÔNG phải `sendTarget`: daemon đặt `scan.target`
     bằng `file || title` của bản vẽ nó giải quyết được, bất kể ta gửi đích nào.
     Đổi sang `sendTarget` là phép so này không bao giờ khớp với bản vẽ chưa lưu. */
  /* Đích dạng SO SÁNH — `targetOf()`, không phải `sendTarget()`.
     `applyBlockedReason` so cả hai với `scan.target`, mà daemon đặt `scan.target`
     bằng `file || title` của bản vẽ nó giải quyết được. Đưa mã phiên vào đó là
     phép so không bao giờ khớp, và nút sửa không bao giờ bật cho bản vẽ chưa lưu. */
  const compareTarget = useMemo(() => {
    const doc = docs.find((item) => sendTarget(item) === target);
    return doc ? targetOf(doc) : target;
  }, [docs, target]);
  const activeCompare = useMemo(
    () => targetOf(docs.find((doc) => doc.active) ?? {}),
    [docs],
  );

  const scannedTitle = useMemo(() => {
    if (!scan) return "";
    const doc = docs.find((item) => targetOf(item) === scan.target);
    return (doc?.title || "").trim();
  }, [scan, docs]);
  useEffect(() => {
    /* Đích phải TRỎ TỚI một bản vẽ còn trong danh sách, không chỉ "khác rỗng".
       Nạp lại plugin AcadBridge trong lúc trang còn mở là mọi bản vẽ chưa lưu
       nhận mã phiên MỚI: đích đang giữ là mã cũ, không khớp mục nào trong ô
       chọn, và `scanBlockedReason` chặn quét cho tới khi người dùng tự chọn lại —
       không có gì trên màn hình nói cho họ biết vì sao.
       Chỉ đổi khi đích hiện tại thật sự đã chết. Đổi mỗi lần `docs` nạp lại sẽ
       cướp lựa chọn của người đang xem một bản vẽ không active. */
    setTarget((current) => {
      if (current && docs.some((doc) => sendTarget(doc) === current)) return current;
      return activeFile;
    });
  }, [activeFile, docs]);

  /* Chuẩn bị lệnh chọn. Chốt lấy từ CHÍNH lượt quét đã sinh ra handle, không đọc
     mới — xem `prepareSelectHandles`. */
  /* MỘT lý do chặn, dùng cho MỌI cửa vào: nút, thẻ xác nhận, và cả hai hàm xử
     lý. Trước đây mỗi cửa tự kiểm lấy và sáu vòng review liên tiếp đều ra cùng
     một dạng lỗi — chặn cửa này thì hở cửa kia. */
  const pickBlocked = pickBlockedReason({
    scan, scanBusy, drawingChanged, docsAlive,
    activeInstance: (docs.find((doc) => doc.active)?.instance || "").trim(),
  });

  const pickSequence = useRef(0);
  const pickHandles = useCallback(async (handles: readonly string[], label: string) => {
    if (pickBusy || pickOp || !scan || pickBlocked) return;
    const ticket = ++pickSequence.current;
    const scanId = scan.scanId;
    /* Vé của lượt QUÉT, không phải của `scanId`. Bấm "Quét lại" giữa lúc đang
       chuẩn bị thì `scanId` CHƯA đổi (lượt mới chưa về), nên kiểm theo `scanId`
       không bắt được — kết quả chuẩn bị về muộn vẫn mở thẻ ra giữa lúc đang quét. */
    const scanTicket = scanSequence.current;
    /* "Kết quả này còn thuộc về lượt đang xem không?" — dùng cho CẢ nhánh thành
       công lẫn nhánh lỗi. Trước đây chỉ nhánh thành công kiểm đủ ba vế, còn
       `catch` chỉ kiểm vé của chính nó: một lỗi `drawing_stale` về muộn từ lượt
       quét CŨ sẽ đánh dấu lượt quét MỚI là đã đổi và khoá nút chọn. */
    const stillCurrent = () =>
      ticket === pickSequence.current
      && scanIdRef.current === scanId
      && scanSequence.current === scanTicket;
    /* Tra bằng MÃ PHIÊN trước, tiêu đề chỉ là đường lùi.
       `targetOf()` cho ra tiêu đề với bản vẽ chưa lưu, mà hai bản vẽ như vậy
       trùng tiêu đề thì `find` trả về cái ĐẦU TIÊN — có thể là bản khác. Khi đó
       `sendTarget()` gửi mã phiên của bản sai, trong khi handle và chốt thuộc
       `scan.documentInstance`, và máy chủ từ chối một yêu cầu vốn hợp lệ. Lượt
       quét đã biết chính xác nó quét bản nào; dùng đúng thứ đó. */
    const scannedDoc =
      (scan.documentInstance
        && docs.find((doc) => (doc.instance || "") === scan.documentInstance))
      || docs.find((doc) => targetOf(doc) === scan.target);
    const pickTarget = scannedDoc ? sendTarget(scannedDoc) : scan.target;
    setPickBusy(true);
    setPickError("");
    try {
      const op = await prepareSelectHandles(DAEMON_BASE, {
        /* Đích đi qua `sendTarget()`, KHÔNG lấy thẳng `documentInstance`.
           `documentInstance` chỉ chứng minh bản vẽ CÓ mã phiên, không chứng minh
           plugin đang chạy NHẬN mã phiên làm đích — bản cũ trả `not_found`. Đây
           đúng là chỗ đã sai ba vòng ở loạt mã phiên: suy năng lực từ sự có mặt
           của dữ liệu. `sendTarget()` đọc cờ `targetsInstance` do plugin công bố.
           Không tìm thấy bản vẽ trong danh sách thì lùi về `scan.target` — kém
           chính xác hơn, nhưng vẫn là thứ đang chạy được. */
        target: pickTarget,
        handles,
        guard: scan.selectGuard,
      });
      /* Lượt quét đổi TRONG LÚC chờ máy chủ: thao tác vừa chuẩn bị mô tả bản vẽ
         của lượt cũ. Hiệu ứng huỷ-theo-scanId ở dưới không cứu được vì lúc đó
         `pickOpRef` còn rỗng. Vứt nó đi, và huỷ ở máy chủ luôn. */
      if (!stillCurrent()) {
        /* Huỷ ở máy chủ, nhưng KHÔNG viết gì lên màn hình. Lượt quét đang hiển
           thị không còn là lượt đã yêu cầu thao tác này, và hiệu ứng đổi
           `scanId` có thể vừa xoá thông báo cũ xong — viết vào đây là dựng lại
           một câu nói về lượt quét mà người dùng không còn nhìn thấy. Kết quả về
           muộn thì im lặng biến mất, đó mới là hành vi đúng. */
        void rejectStagedOp(DAEMON_BASE, op).catch(() => {});
        return;
      }
      setPickOp({ op, count: handles.length, label });
    } catch (failure) {
      if (stillCurrent()) {
        setPickError(stagedErrorText(failure));
        /* Lỗi "đã cũ" nghĩa là chốt và handle của lượt quét này CHẾT HẲN — bản vẽ
           đã đổi, hoặc đã đóng rồi mở lại. Chỉ hiện lỗi là để nút còn bấm được,
           và mỗi lần bấm lại lặp đúng lỗi đó: một ngõ cụt lặp vô hạn. Đánh dấu
           lượt quét đã cũ để nút tắt và người dùng biết phải quét lại. */
        if (drawingMoved(failure)) setDrawingChanged(true);
      }
    } finally {
      /* Vô điều kiện: guard ở đầu hàm (`pickBusy || pickOp`) đã chặn hai lượt
         chồng nhau, nên chỉ có đúng một lượt đang bay và nó phải trả `pickBusy`
         về. Kiểm vé ở đây tạo một nhánh không bao giờ chạy mà lại có thể để
         `pickBusy` kẹt `true` vĩnh viễn nếu guard kia đổi. */
      setPickBusy(false);
    }
  }, [pickBusy, pickOp, scan, docs, pickBlocked]);

  const applyPick = useCallback(async () => {
    if (!pickOp || pickBusy || pickBlocked) return;
    setPickBusy(true);
    setPickError("");
    try {
      await applyStagedOp(DAEMON_BASE, pickOp.op);
      setPickOp(null);
    } catch (failure) {
      /* Thao tác là MỘT LẦN: máy chủ đã nhận rồi đánh dấu hỏng/đã dùng. Giữ thẻ
         mở là mời bấm lại vào một id đã chết — lần hai chỉ nhận
         `operation_not_pending`, một lỗi không nói được gì. Đóng thẻ để người
         dùng chuẩn bị lại từ đầu. */
      setPickOp(null);
      setPickError(stagedErrorText(failure));
      /* Cùng lý do như ở bước chuẩn bị: lượt áp hỏng vì "đã cũ" thì chuẩn bị lại
         cũng hỏng y hệt. */
      if (drawingMoved(failure)) setDrawingChanged(true);
    } finally {
      setPickBusy(false);
    }
  }, [pickOp, pickBusy]);

  /* Lượt quét MỚI làm thao tác đã chuẩn bị thành vô nghĩa: handle của nó thuộc
     lượt cũ. Máy chủ sẽ từ chối vì chốt lệch, nhưng để thẻ mở là mời người dùng
     bấm vào một ngõ cụt. Huỷ ở máy chủ rồi nói lý do.
     Neo theo `scan.scanId`, không theo `scan`: mọi lượt đọc lại hồ sơ đều tạo
     một tham chiếu mới, và huỷ theo tham chiếu sẽ giết thao tác đang chờ mỗi lần
     danh sách hồ sơ nạp lại. */
  useEffect(() => {
    const id = scan?.scanId ?? "";
    /* KHÔNG huỷ khi đang áp. Đây đúng cái race vừa sửa cho `cancelPick`, chỉ
       khác nguồn kích hoạt: một lượt quét về giữa lúc `applyPick` đang chạy sẽ
       gửi lệnh huỷ song song với lệnh áp. Bỏ qua là an toàn — `applyPick` tự xoá
       `pickOp` khi xong, dù thành công hay hỏng. */
    if (scanIdRef.current && scanIdRef.current !== id && pickOpRef.current
      && !pickBusyRef.current) {
      void rejectStagedOp(DAEMON_BASE, pickOpRef.current.op).catch(() => {});
      setPickOp(null);
      setPickError(
        "Đã có lượt quét mới, nên lệnh chọn vừa chuẩn bị bị huỷ. Chọn lại từ "
        + "phát hiện của lượt quét mới.",
      );
    } else if (scanIdRef.current && scanIdRef.current !== id) {
      /* Lượt quét đổi mà không có thao tác nào đang chờ: vẫn phải xoá lỗi cũ.
         Giữ lại là bảng chi tiết của lượt MỚI hiện một lỗi do lượt TRƯỚC sinh ra. */
      setPickError("");
    }
    if (scanIdRef.current !== id) {
      /* Dimension của lượt quét khác là handle khác. Giữ lại là gửi một handle
         thuộc lượt cũ và máy chủ từ chối — hoặc tệ hơn, trúng một DIM khác. */
      setDimBaseHandle("");
    }
    scanIdRef.current = id;
  }, [scan?.scanId]);

  const cancelPick = useCallback(() => {
    /* `busy` chỉ khoá nút ở chân thẻ; `Modal` vẫn gọi `onClose` khi bấm Esc hay
       nền. Không chặn ở đây thì một phím Esc giữa lúc đang áp sẽ gửi lệnh huỷ
       chạy song song với lệnh áp, và cái nào tới trước thì thắng. */
    if (!pickOp || pickBusy) return;
    /* Huỷ ở MÁY CHỦ luôn, đừng chỉ đóng thẻ. Thao tác đã chuẩn bị nằm trong hàng
       chờ của daemon; bỏ nó lại đó là để một lệnh treo mà người dùng tưởng đã
       huỷ. */
    void rejectStagedOp(DAEMON_BASE, pickOp.op).catch(() => {});
    setPickOp(null);
    /* `pickBusy` PHẢI nằm trong deps. Thiếu nó thì phép chặn ở trên đọc giá trị
       của lượt dựng closure trước đó — tức luôn thấy `false` trong lúc đang áp,
       và cả cái chốt vừa viết thành vô hiệu. */
  }, [pickOp, pickBusy]);

  const profile = profiles.find((item) => item.id === profileId) ?? null;
  const driftNote = profileDriftNote(scan, profile);
  const issues = scan?.issues ?? [];
  const counts = severityCounts(issues);
  /* Ghép hai bộ lọc ở ĐÂY chứ không nhét nhóm vào `filterIssues()`:
     `filterIssues` sống ở `features/standards/`, và `check:boundaries` cấm feature
     import chéo feature. Ghép ở trang là chỗ duy nhất biết cả hai mà không phá
     ranh giới. */
  const visible = useMemo(
    () => filterByScope(filterIssues(issues, severity, query), scope),
    [issues, severity, query, scope],
  );
  const chips = useMemo(() => scopeChips(issues), [issues]);
  const pickedIssues = issues.filter((issue) => picked.has(issue.id));
  const detail = issues.find((issue) => issue.id === detailId) ?? null;

  const scanBlocked = scanBlockedReason({
    target, activeTarget: activeFile, profileId, docsAlive, busy: scanBusy,
  });
  /* Lô có mục căn hàng thì phải có DIM chuẩn, và chuẩn phải CÙNG TRỤC với lô.
     Thiếu chuẩn là máy chủ trả 400; sai trục thì tệ hơn — lệnh chạy êm và các
     DIM nằm sai chỗ. Cả hai chỉ lộ ra sau một nút ghi KHÔNG hoàn tác được. */
  const dimAxes = [...new Set(pickedIssues
    .filter((issue) => issue.action === "dimspace")
    .map(issueAxis)
    .filter(Boolean))];
  const dimNote = dimspaceBlockedReason({
    selected: pickedIssues,
    dimensions: scan?.dimensions ?? [],
    baseHandle: dimBaseHandle,
  });
  const applyBlocked = applyBlockedReason({
    scan, target: compareTarget, activeTarget: activeCompare,
    activeInstance: (docs.find((doc) => doc.active)?.instance || "").trim(),
    selected: picked.size,
    dimNote,
    driftNote, drawingChanged,
    /* `scanBusy` cũng là "bận": bấm Quét lại không xoá lô đã tích, nên nếu
       không tính nó thì thẻ xác nhận vẫn gửi được lô CŨ trong lúc lượt quét mới
       đang chạy. */
    busy: applyBusy || scanBusy,
  });

  /* Mục máy chủ đòi thêm tham số mà màn hình chưa hỏi được. Bỏ tích chúng ngay
     thay vì để người dùng bấm rồi ăn 400. */
  const unsupported = pickedIssues.map(unsupportedFixReason).find(Boolean) ?? "";

  const runScan = useCallback(async () => {
    if (scanBlocked) return;
    const ticket = ++scanSequence.current;
    /* Cờ bẩn thuộc về TỪNG lượt quét: một lượt hỏng để sót cờ sẽ chặn nút sửa
       của lượt sạch tiếp theo. */
    scanDirtyRef.current = false;
    setScanBusy(true);
    setScanError("");
    setApplyNote("");
    try {
      const body = await daemonRecord(
        await fetch(endpoints.standardsScan(DAEMON_BASE), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          /* `readOnly: true` bắt máy chủ kiểm lại bản vẽ có đang hoạt động
             không, và dispatch job KHÔNG kích hoạt tab. Chốt phía giao diện là
             chưa đủ: người dùng đổi tab trong AutoCAD giữa lúc bấm và lúc yêu
             cầu tới nơi thì daemon sẽ tự kích hoạt bản vẽ cũ sau lưng họ. */
          body: JSON.stringify({ target, profileId, readOnly: true }),
        }),
      );
      if (ticket !== scanSequence.current) return;
      const next = normalizeScan(body, target);
      if (!next.scanId) throw new Error("Kết quả quét thiếu mã phiên; không sửa được từ lượt này.");
      setScan(next);
      /* KHÔNG xoá trắng cờ "bản vẽ đã đổi": một thay đổi xảy ra SAU khi máy chủ
         kiểm lần cuối nhưng TRƯỚC khi phản hồi về đây là thay đổi thật, và xoá
         nó là mở lại nút sửa cho một lượt quét đã cũ. Chỉ xoá cờ do chính lượt
         quét này dựng lên. */
      setDrawingChanged(scanDirtyRef.current);
      scanDirtyRef.current = false;
      /* KHÔNG tự tích sẵn mọi phát hiện. Panel cũ làm vậy, và nút sửa hàng loạt
         nằm ngay cạnh — một cú bấm là ghi cả trăm thay đổi không hoàn tác được
         vào bản vẽ mà người dùng chưa kịp đọc dòng nào. */
      setPicked(new Set());
      setDetailId(next.issues[0]?.id ?? "");
    } catch (failure) {
      if (ticket !== scanSequence.current) return;
      scanDirtyRef.current = false;
      setScanError(daemonFailureText(failure));
      const code = failure instanceof DaemonError ? failure.code : "";
      /* Máy chủ nói bản vẽ đã đổi trong lúc quét. Kết quả CŨ còn trên màn hình
         vẫn bấm sửa được nếu không đánh dấu — và nó mô tả một trạng thái đã
         qua hai lần. */
      if (code === "drawing_stale") setDrawingChanged(true);
      if (code === "profile_stale") loadProfiles();
    } finally {
      if (ticket === scanSequence.current) setScanBusy(false);
    }
  }, [scanBlocked, target, profileId, loadProfiles]);

  /* KHÔNG `useCallback`. Hàm này đọc năm mẩu trạng thái và gửi một lượt ghi
     KHÔNG hoàn tác được; bọc `useCallback` là dựng một bản chụp trạng thái tại
     lượt render dựng nó, rồi phải chép tay danh sách phụ thuộc cho khớp. Thiếu
     một tên là gửi giá trị CŨ — và đây là lần thứ hai trong đúng tệp này:
     `cancelPick` từng đọc `pickBusy` cũ, rồi `applyPicked` gửi DIM chuẩn của
     lượt chọn TRƯỚC (chọn A → huỷ thẻ → chọn B → gửi A).
     Nơi duy nhất dùng nó là `onConfirm={() => …}` — một arrow mới mỗi lượt
     render, và không component nào trong dự án bọc `memo`. Nên `useCallback` ở
     đây không giữ được gì cả; nó chỉ giữ lại cái bẫy. */
  const applyPicked = async () => {
    if (applyBlocked || !scan) return;
    setApplyBusy(true);
    setScanError("");
    try {
      const body = await daemonRecord(
        await fetch(endpoints.standardsApply(DAEMON_BASE), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            scanId: scan.scanId,
            issueIds: [...picked],
            /* Chỉ gửi khi lô THẬT SỰ cần. Gửi thừa thì vô hại hôm nay, nhưng nó
               nói với máy chủ một điều không đúng về ý định của lô. */
            ...(pickedIssues.some((issue) => issue.action === "dimspace")
              ? { dimBaseHandle }
              : {}),
          }),
        }),
      );
      setConfirmOpen(false);
      setPicked(new Set());
      /* Bản vẽ vừa bị sửa → lượt quét này đã cũ. Đánh dấu ngay thay vì đợi sự
         kiện: người dùng không nên bấm sửa lần hai trên một danh sách đã chết. */
      setDrawingChanged(true);
      /* Máy chủ IM LẶNG bỏ qua mục nó không sửa được và trả `skippedIssueIds`.
         Không nói ra thì người dùng tưởng cả lô đã xong. */
      const skipped = Array.isArray(body.skippedIssueIds) ? body.skippedIssueIds.length : 0;
      setApplyNote(
        String(body.hint || body.message || "Đã gửi lệnh sửa vào AutoCAD.")
        + (skipped ? ` ${skipped} mục bị bỏ qua vì máy chủ không sửa tự động được.` : ""),
      );
    } catch (failure) {
      setConfirmOpen(false);
      const text = daemonFailureText(failure);
      setScanError(text);
      /* "Chưa hoàn tất" KHÔNG phải là hỏng: daemon hết hạn CHỜ, nhưng job vẫn
         chạy tiếp trong AutoCAD. Để người dùng bấm lại là xếp thêm một lượt ghi
         nữa lên cùng tập đối tượng — mà không lượt nào hoàn tác được. Đánh dấu
         lượt quét đã chết và bỏ tích, y như khi ghi thành công. */
      if (/chưa hoàn tất|pending|timeout/i.test(text)) {
        setPicked(new Set());
        setDrawingChanged(true);
      }
      /* Soi MÃ, không đoán chữ: câu tiếng Việt của máy chủ là "Mẫu quy chuẩn đã
         đổi; hãy quét lại" — một regex bắt theo chữ "hồ sơ" trượt hoàn toàn.
         Không nạp lại thì bản sao trên màn hình giữ revision cũ mãi, và cảnh
         báo lệch hồ sơ chặn nút sửa ở MỌI lượt quét sau đó. */
      const code = failure instanceof DaemonError ? failure.code : "";
      if (code === "profile_stale") loadProfiles();
      /* Bản vẽ đổi mà app lỡ mất sự kiện: lượt quét này đã chết, đừng để nó
         bấm lại được. */
      if (code === "drawing_stale") setDrawingChanged(true);
    } finally {
      setApplyBusy(false);
    }
  };

  const toggle = (id: string) => setPicked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const fixable = visible.filter((issue) => !unsupportedFixReason(issue));
  const allVisiblePicked = fixable.length > 0 && fixable.every((issue) => picked.has(issue.id));

  return (
    <AppShell
      screen="review"
      title="Kiểm tra bản vẽ"
      sub={scan
        ? `${issues.length} phát hiện · phiên ${scan.scanId}`
          + (scan.profileVersion > 0 ? ` · quét theo hồ sơ phiên bản ${scan.profileVersion}` : "")
        : "Chưa quét lượt nào"}
      actions={
        <>
          <Button onClick={() => void runScan()} disabled={!!scanBlocked}
            title={scanBlocked || undefined}>
            {/* Nhãn nói RÕ sẽ quét theo phiên bản nào khi hồ sơ đã đổi — người
                dùng đang nhìn một lượt quét cũ, và "Quét lại" trơn không cho
                biết lần này sẽ khác ở đâu. */}
            {scanBusy
              ? "Đang quét…"
              : !scan
                ? "Quét bản vẽ"
                : profile && profile.version > 0 && profile.version !== scan.profileVersion
                  ? `Quét lại theo phiên bản ${profile.version}`
                  : "Quét lại"}
          </Button>
          <WriteButton
            variant="primary"
            disabled={!!applyBlocked || !!unsupported}
            title={applyBlocked || unsupported || undefined}
            onClick={() => setConfirmOpen(true)}
          >
            Sửa {picked.size} mục đã chọn
          </WriteButton>
        </>
      }
    >
      <div className="stack">
        {profilesError ? (
          <div className="banner" data-tone="hard">
            <span className="bm" />
            <span className="bt">
              <b>Không đọc được hồ sơ quy tắc.</b> {profilesError}
            </span>
            <span className="actions"><Button onClick={loadProfiles}>Thử lại</Button></span>
          </div>
        ) : null}

        {driftNote ? (
          <div className="banner" data-tone="hard">
            <span className="bm" />
            <span className="bt"><b>Lượt quét đã cũ.</b> {driftNote}</span>
            <span className="actions">
              <Button
                /* Nạp lại HỒ SƠ trước rồi mới quét: nếu tab khác đã sửa nó, quét
                   lại một mình chỉ lấy về revision mới của máy chủ trong khi màn
                   hình vẫn giữ bản cũ — và cảnh báo này quay lại y nguyên, mãi
                   mãi, cho tới khi tải lại trang. */
                onClick={() => { loadProfiles(); void runScan(); }}
                disabled={!!scanBlocked}
              >
                {profile && profile.version > 0
                  ? `Quét lại theo phiên bản ${profile.version}`
                  : "Quét lại"}
              </Button>
            </span>
          </div>
        ) : null}

        {drawingChanged && scan && !driftNote ? (
          <div className="banner" data-tone="hard">
            <span className="bm" />
            <span className="bt">
              <b>Bản vẽ đã thay đổi sau lượt quét.</b> Các phát hiện bên dưới mô
              tả trạng thái cũ. Quét lại trước khi sửa.
            </span>
            <span className="actions">
              <Button onClick={() => void runScan()} disabled={!!scanBlocked}>Quét lại</Button>
            </span>
          </div>
        ) : null}

        {applyNote ? (
          <div className="banner">
            <span className="bm" />
            <span className="bt"><b>Đã gửi lệnh sửa.</b> {applyNote}</span>
            <span className="actions"><Button onClick={() => setApplyNote("")}>Đã hiểu</Button></span>
          </div>
        ) : null}

        {scanError ? (
          <div className="banner" data-tone="hard">
            <span className="bm" />
            <span className="bt"><b>Không quét/sửa được.</b> {scanError}</span>
          </div>
        ) : null}

        <section className="panel">
          <header>
            <h2>Lượt quét</h2>
            <div className="actions">
              {scan?.profileVersion ? (
                /* Hash để trong `title` cho ai cần đối chiếu — nó mới là thứ máy
                   chủ so khi áp dụng. Số đếm là thứ đọc được. */
                <span className="tag mono" title={scan.profileRevision}>
                  quét theo phiên bản {scan.profileVersion}
                </span>
              ) : null}
              {scan ? <span className="tag mono">{scan.scanId}</span> : null}
            </div>
          </header>
          <div className="row" style={{ padding: "var(--s3) var(--s4)", gap: "var(--s4)", flexWrap: "wrap" }}>
            <label className="field">
              <span>Bản vẽ</span>
              <select className="input" value={target}
                onChange={(event) => {
                  /* Lượt sửa gửi đi CHỈ có `scanId`, nên máy chủ dùng đích đã
                     lưu trong phiên quét. Giữ lượt quét cũ khi đổi ô chọn là mở
                     đường ghi vào bản vẽ A trong khi màn hình nói B. */
                  setTarget(event.target.value);
                  abandonScan();
                }}>
                <option value="">— chọn bản vẽ —</option>
                {docs.map((doc) => (
                  <option key={sendTarget(doc)} value={sendTarget(doc)}>
                    {doc.title || targetOf(doc)}{doc.active ? " · đang mở" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>Hồ sơ quy tắc</span>
              <select className="input" value={profileId}
                onChange={(event) => {
                  /* Đổi hồ sơ là lượt quét cũ hết nghĩa — nó đo theo bộ quy tắc
                     khác. `profileDriftNote` cũng bắt được, nhưng vứt luôn thì
                     màn hình không phải giải thích một thứ đã chết. */
                  setProfileId(event.target.value);
                  abandonScan();
                }}>
                <option value="">— chọn hồ sơ —</option>
                {profiles.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <span className="spacer" />
            <span className="hint">
              Sửa hồ sơ ở <Link href="/standards">Hồ sơ tiêu chuẩn</Link>. Sửa xong
              thì phải quét lại — lượt quét gắn với phiên bản hồ sơ lúc quét.
            </span>
          </div>
          {scanBlocked ? (
            <div style={{ padding: "0 var(--s4) var(--s3)" }}>
              <span className="hint">{scanBlocked}</span>
            </div>
          ) : null}
        </section>

        {scan ? (
          <>
            <section className="panel">
              <header>
                <h2>Phát hiện</h2>
                <div className="actions">
                  {SEVERITIES.map((level) => (
                    <Button key={level}
                      onClick={() => setSeverity(level)}
                      aria-pressed={severity === level}>
                      {level === "all" ? "Tất cả" : severityLabel(level)}{" "}
                      {level === "all" ? counts.all : counts[level]}
                    </Button>
                  ))}
                </div>
              </header>

              <div style={{ padding: "var(--s3) var(--s4)", borderBottom: "1px solid var(--border)" }}>
                <div className="searchfield">
                  <Icon name="search" />
                  <input className="input" value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Tìm theo mã phát hiện hoặc mô tả"
                    aria-label="Tìm phát hiện" />
                </div>
                {/* Lọc theo NHÓM. Sáu nhóm đã biết hiện kể cả khi đếm 0 — số 0 là
                    một câu trả lời ("không có vấn đề layer nào"), không phải chỗ
                    trống. Nhóm máy chủ phát mà bảng chưa biết cũng có chip riêng,
                    nên tổng các chip luôn bằng "Tất cả": một phát hiện KHÔNG BAO
                    GIỜ biến mất chỉ vì giao diện chưa có nhãn cho nó. Đó đúng là
                    cách hỏng của bộ lọc regex ở panel cũ. */}
                {/* `display: flex` khai TẠI ĐÂY. Hệ thiết kế chỉ cho `.actions`
                    thành flex dưới `.panel > header`, còn hàng này nằm trong THÂN
                    panel — nên `flexWrap` sẽ bị bỏ qua và bảy chip tràn thành một
                    dòng dài, đẩy các bộ lọc cuối ra ngoài màn hình hẹp. */}
                <div className="actions" style={{
                  display: "flex", flexWrap: "wrap",
                  gap: "var(--s2)", marginTop: "var(--s2)",
                }}>
                  {chips.map((chip) => (
                    <Button key={chipKey(chip)}
                      onClick={() => setScope(chip.scope)}
                      aria-pressed={scope === chip.scope}
                      title={chip.hint}>
                      {chip.label} {chip.count}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="tablewrap">
                <table className="data">
                  <thead>
                    <tr>
                      <th style={{ width: 32 }}>
                        <input type="checkbox" checked={allVisiblePicked}
                          disabled={!fixable.length || applyBusy}
                          aria-label="Tích các phát hiện đang hiện"
                          onChange={() => setPicked((prev) => {
                            const next = new Set(prev);
                            if (allVisiblePicked) {
                              for (const issue of visible) next.delete(issue.id);
                            } else {
                              /* Bỏ qua mục không sửa được — tích cả trang không
                                 được phép tạo ra một tập mà nút ghi từ chối. */
                              for (const issue of visible) {
                                if (!unsupportedFixReason(issue)) next.add(issue.id);
                              }
                            }
                            return next;
                          })} />
                      </th>
                      <th>Mức</th><th>Phạm vi</th><th>Mô tả</th><th className="n">Đối tượng</th><th>Ghi chú</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map((issue) => (
                      <tr key={issue.id}
                        onClick={() => setDetailId(issue.id)}
                        aria-selected={detailId === issue.id}>
                        <td>
                          <input type="checkbox" checked={picked.has(issue.id)}
                            /* Chặn NGAY ở ô tích, không chặn cả lô: tích được
                               rồi mới báo là bắt người dùng đi tìm xem mục nào
                               trong hai chục mục đã chọn là thủ phạm. */
                            disabled={applyBusy || !!unsupportedFixReason(issue)}
                            title={unsupportedFixReason(issue) || undefined}
                            onChange={() => toggle(issue.id)}
                            onClick={(event) => event.stopPropagation()}
                            aria-label={`Chọn ${issue.id}`} />
                        </td>
                        <td><Tag>{severityLabel(issue.severity)}</Tag></td>
                        {/* Nhãn tiếng Việt, nhưng vẫn giữ chuỗi thô ở `title`:
                            người dùng đọc nhãn, còn khi đi hỏi thì cần đúng tên
                            máy chủ phát ra. Nhóm ngoài bảng hiện thẳng tên thô. */}
                        <td title={issue.scope}>{scopeLabel(issue.scope)}</td>
                        <td>{issue.message}</td>
                        <td className="n mono">{issue.handles.length || "—"}</td>
                        <td className="hint">{unsupportedFixReason(issue)}</td>
                      </tr>
                    ))}
                    {!visible.length ? (
                      <tr><td colSpan={6}>
                        <span className="hint">
                          {issues.length
                            ? "Không có phát hiện nào khớp bộ lọc."
                            : "Bản vẽ khớp hồ sơ quy tắc — không có phát hiện nào."}
                        </span>
                      </td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>

              {applyBlocked || unsupported ? (
                <div style={{ padding: "var(--s3) var(--s4)", borderTop: "1px solid var(--border)" }}>
                  <span className="hint">{applyBlocked || unsupported}</span>
                </div>
              ) : null}
            </section>

            <section className="panel">
              <header><h2>Chi tiết phát hiện</h2></header>
              <div style={{ padding: "var(--s3) var(--s4)" }}>
                {detail ? (
                  <dl className="kv">
                    <dt>Mã</dt><dd className="mono">{detail.id}</dd>
                    <dt>Mức</dt><dd>{severityLabel(detail.severity)}</dd>
                    <dt>Phạm vi</dt><dd className="mono">{detail.scope}</dd>
                    <dt>Mô tả</dt><dd>{detail.message}</dd>
                    <dt>Hiện tại</dt><dd className="mono">{shown(detail.current)}</dd>
                    <dt>Theo hồ sơ</dt><dd className="mono">{shown(detail.expected)}</dd>
                    <dt>Đối tượng</dt>
                    <dd className="mono" style={{ overflowWrap: "anywhere" }}>
                      {detail.handles.join(" · ") || "không gắn với đối tượng cụ thể"}
                    </dd>
                  </dl>
                ) : (
                  <p className="hint">Bấm một dòng ở bảng trên để xem chi tiết.</p>
                )}
                {detail?.handles.length ? (
                  <div style={{ marginTop: "var(--s3)", display: "grid", gap: "var(--s2)" }}>
                    <div>
                      <Button
                        onClick={() => void pickHandles(
                          detail.handles,
                          `${detail.handles.length} đối tượng của “${detail.message}”`,
                        )}
                        /* Không có chốt thì KHÔNG cho bấm. Lượt quét thiếu định
                           danh bản vẽ nghĩa là không chứng minh được handle còn
                           trỏ đúng chỗ — máy chủ sẽ từ chối, và mở nút ra chỉ
                           đưa người dùng tới một lỗi khó hiểu. */
                        /* `scanBusy` cũng là "đang bận": một lượt quét mới đang
                           chạy thì `scan` trên màn hình vẫn là lượt CŨ, và chuẩn
                           bị từ nó là chuẩn bị theo một trạng thái sắp bị thay.
                           Vé hoàn thành chỉ chặn được sau khi `scanId` đã đổi. */
                        disabled={pickBusy || !!pickOp || !!pickBlocked}>
                        {pickBusy ? "Đang chuẩn bị…" : "Chọn trong AutoCAD"}
                      </Button>
                    </div>
                    {pickBlocked ? (
                      <p className="hint" style={{ margin: 0 }}>{pickBlocked}</p>
                    ) : (
                      <p className="hint" style={{ margin: 0 }}>
                        Chọn <b>không sửa</b> gì trong bản vẽ — nó chỉ đặt bộ chọn
                        của AutoCAD. Đối tượng nằm ngoài màn hình thì dùng lệnh
                        <span className="mono"> ZOOM</span> →
                        <span className="mono"> Object</span> trong AutoCAD để nhìn thấy.
                        {" "}Lượt quét gom đối tượng của <b>mọi</b> không gian, còn
                        lệnh chọn chỉ chọn được trong không gian đang mở
                        {scan?.scannedSpace ? (
                          <> — lúc quét là <b>{scan.scannedSpace}</b></>
                        ) : null}
                        . Phát hiện thuộc layout khác sẽ bị từ chối — và đổi tab
                        cũng làm bộ đếm phiên bản nhảy, nên sau khi chuyển tab bạn
                        cần <b>quét lại</b> rồi mới chọn được.
                      </p>
                    )}
                    {pickError ? <p className="hint" style={{ margin: 0 }}>{pickError}</p> : null}
                  </div>
                ) : null}
              </div>
            </section>

            {/* Ánh xạ lấy từ hồ sơ ĐANG CHỌN, không phải từ kết quả quét: một
                quy tắc bắt 0 đối tượng vắng mặt hoàn toàn khỏi `scan.objects`,
                mà đấy lại là dấu hiệu quy tắc sai rõ nhất.

                Nhưng khi hồ sơ đã đổi sau lượt quét thì đúng danh sách đó lại
                nói sai — `driftNote` chính là tín hiệu ấy. Băng cảnh báo ở đầu
                trang chỉ NHẮC; bảng thì vẫn phải thôi bịa. */}
            <RecognizedObjects scan={scan} mappings={profile?.mappings ?? []}
              mappingsStale={!!driftNote} />

            <DimensionTable scan={scan} baseHandle={dimBaseHandle}
              /* Trục của lô đang chọn. Hai phát hiện `dimspace` cùng lúc thì để
                 rỗng: lúc đó KHÔNG trục nào hợp lệ, và `applyBlocked` nói vì
                 sao — khoá cả bảng ở đây chỉ làm màn hình câm. */
              neededAxis={dimAxes.length === 1 ? dimAxes[0] : ""}
              disabled={applyBusy || scanBusy}
              onPickBase={setDimBaseHandle} />
          </>
        ) : null}
      </div>

      {confirmOpen && scan ? (
        <ConfirmSheet
          title="Sửa các phát hiện đã chọn"
          /* MỘT PHA. `/standards/apply` dispatch LISP thẳng — không có bước
             chuẩn bị, không có id để huỷ, không có hàng chờ ở màn Thay đổi.
             Dùng `staged` ở đây là hứa một bước rút lui không tồn tại. */
          mode="immediate"
          target={scan.target}
          summary={applySummary(pickedIssues)}
          confirmLabel="Sửa ngay trong AutoCAD"
          busy={applyBusy}
          /* Trạng thái đổi trong lúc thẻ đang mở — bản vẽ vừa bị sửa chẳng hạn.
             Không truyền vào thì nút vẫn sáng, bấm thì `applyPicked` lặng lẽ
             thoát ra và thẻ đứng im: một ngõ cụt không nói lý do. */
          blocked={applyBlocked || unsupported}
          onConfirm={() => void applyPicked()}
          onCancel={() => setConfirmOpen(false)}
        >
          <ul className="hint" style={{ margin: 0, paddingLeft: "1.2em" }}>
            {pickedIssues.slice(0, 8).map((issue) => (
              <li key={issue.id}>{severityLabel(issue.severity)} · {issue.message}</li>
            ))}
            {pickedIssues.length > 8 ? (
              <li>… và {pickedIssues.length - 8} mục nữa.</li>
            ) : null}
          </ul>
        </ConfirmSheet>
      ) : null}

      {pickOp && scan ? (
        <ConfirmSheet
          title="Chọn đối tượng trong AutoCAD"
          /* `selection`, không phải `staged`. `staged` hiện lời dặn về lệnh GHI
             không hoàn tác được và về `UNDO` — trái ngược với việc đang làm, vì
             chọn không sửa gì và `UNDO` không có gì để hoàn tác. `selection` là
             mode dựng riêng cho việc đổi bộ chọn, và nó nói đúng thứ người dùng
             cần biết: bấm Esc trong AutoCAD là bỏ chọn. */
          mode="selection"
          /* Đích của THAO TÁC ĐÃ CHUẨN BỊ, không phải `scan.target`.
             Hai bản vẽ chưa lưu trùng tiêu đề cho ra cùng `scan.target`, nên hiện
             nó ra là người dùng không xác minh được lệnh sẽ chạy trên bản vẽ nào
             — mà xác minh chính là việc của thẻ này. */
          target={pickOp.op.target || scan.target}
          summary={`${pickOp.count} đối tượng · ${pickOp.label}`}
          confirmLabel="Chọn trong AutoCAD"
          busy={pickBusy}
          /* Lượt quét hoá cũ TRONG LÚC thẻ đang mở — `drawingModified` bắn chẳng
             hạn. Nút bên dưới đã tắt, nhưng thẻ này thì không: người dùng vẫn
             bấm được, nhận `drawing_stale`, rồi thẻ mới đóng. Chặn ngay và nói
             lý do. */
          blocked={pickBlocked}
          onConfirm={() => void applyPick()}
          onCancel={cancelPick}
        >
          <p className="hint" style={{ margin: 0 }}>
            Lệnh này <b>không sửa</b> gì trong bản vẽ — nó đặt bộ chọn của AutoCAD,
            và <span className="mono">UNDO</span> không có gì để hoàn tác. Nếu bản
            vẽ đã đổi kể từ lượt quét, máy chủ sẽ <b>từ chối</b> thay vì chọn nhầm;
            lúc đó hãy quét lại.
          </p>
        </ConfirmSheet>
      ) : null}
    </AppShell>
  );
}

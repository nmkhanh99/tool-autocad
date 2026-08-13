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
import { Icon } from "../../../components/ui/icons";
import { WriteButton } from "../../../components/ui/WriteButton";
import { fetchDocs, type AcadDocument } from "../../../lib/daemon/docs";
import { useAcadEvents } from "../../../features/acad-connection/events";
import { DAEMON_BASE, endpoints } from "../../../lib/daemon/endpoints";
import { DaemonError, daemonFailureText, daemonRecord } from "../../../lib/daemon/client";
import {
  applyBlockedReason,
  applySummary,
  filterIssues,
  normalizeProfile,
  normalizeScan,
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
import { RecognizedObjects } from "../../../features/standards/RecognizedObjects";

const SEVERITIES: readonly (Severity | "all")[] = ["all", "error", "warning", "info"];

function shown(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
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
  const [query, setQuery] = useState("");
  const [picked, setPicked] = useState<ReadonlySet<string>>(new Set());
  const [detailId, setDetailId] = useState("");

  const [confirmOpen, setConfirmOpen] = useState(false);
  const [applyBusy, setApplyBusy] = useState(false);
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

  const profile = profiles.find((item) => item.id === profileId) ?? null;
  const driftNote = profileDriftNote(scan, profile);
  const issues = scan?.issues ?? [];
  const counts = severityCounts(issues);
  const visible = useMemo(
    () => filterIssues(issues, severity, query),
    [issues, severity, query],
  );
  const pickedIssues = issues.filter((issue) => picked.has(issue.id));
  const detail = issues.find((issue) => issue.id === detailId) ?? null;

  const scanBlocked = scanBlockedReason({
    target, activeTarget: activeFile, profileId, docsAlive, busy: scanBusy,
  });
  const applyBlocked = applyBlockedReason({
    scan, target: compareTarget, activeTarget: activeCompare,
    activeInstance: (docs.find((doc) => doc.active)?.instance || "").trim(),
    selected: picked.size,
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

  const applyPicked = useCallback(async () => {
    if (applyBlocked || !scan) return;
    setApplyBusy(true);
    setScanError("");
    try {
      const body = await daemonRecord(
        await fetch(endpoints.standardsApply(DAEMON_BASE), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scanId: scan.scanId, issueIds: [...picked] }),
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
  }, [applyBlocked, scan, picked, loadProfiles]);

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
                        <td className="mono">{issue.scope}</td>
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
    </AppShell>
  );
}

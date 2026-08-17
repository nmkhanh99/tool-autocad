"use client";

/** Soạn hồ sơ quy tắc bản vẽ.
 *
 * ## Màn hình này KHÔNG chạm vào bản vẽ
 *
 * Đó là lý do nó tách khỏi `/review`. Ở đây chỉ sửa một hồ sơ nằm trong daemon;
 * không có lệnh nào tới AutoCAD, không có gì để hoàn tác. Việc quét bản vẽ và
 * sửa theo phát hiện — thứ ghi thẳng và không hoàn tác được — nằm ở
 * **Kiểm tra bản vẽ**.
 *
 * ## Nhưng lưu ở đây có hệ quả ở màn kia
 *
 * `revision` của hồ sơ là **hash nội dung**. Đổi nội dung là đổi hash, và **mọi
 * lượt quét gắn với hash cũ lập tức hết giá trị**: `/standards/apply` trả 409.
 * Lưu mà không đổi gì thì hash y nguyên, nên lượt quét vẫn sống — đó là lý do
 * hash tốt hơn một bộ đếm ở đây.
 *
 * Panel legacy giấu ràng buộc này bằng cách khoá nút quét khi còn thay đổi chưa
 * lưu — hai việc ở chung một hộp thoại nên không thể lệch. Tách ra thì phải nói
 * ra.
 *
 * ## Ghi có kiểm tranh chấp
 *
 * `PUT /profiles/:id` nhận `if-match` là revision đang giữ. Gửi kèm nó nghĩa là
 * hai tab cùng sửa một hồ sơ sẽ có một bên bị từ chối thay vì im lặng ghi đè.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AppShell } from "../../../components/shell/AppShell";
import { Button } from "../../../components/ui/Button";
import { Tag } from "../../../components/ui/Tag";
import { ConfirmSheet } from "../../../components/ui/ConfirmSheet";
import { DAEMON_BASE, endpoints } from "../../../lib/daemon/endpoints";
import { DaemonError, daemonFailureText, daemonRecord } from "../../../lib/daemon/client";
import {
  LINEAR_FORMATS,
  applyProfileEdits,
  normalizeProfile,
  profileDeleteBlockedReason,
  profileDeleteSummary,
  profileSaveBlockedReason,
  readAciPalette,
  type AciPalette,
  type StandardsProfile,
} from "../../../features/standards/model";
import {
  DimensionExtras,
  LayerTable,
  MappingTable,
} from "../../../features/standards/ProfileTables";
import { ImportLayers } from "../../../features/standards/ImportLayers";
import { fetchDocs, type AcadDocument } from "../../../lib/daemon/docs";
import { useAcadEvents } from "../../../features/acad-connection/events";

/** Trường số: giữ chuỗi rỗng thành `undefined` thay vì `0`.
 *
 * `0` là một giá trị HỢP LỆ cho vài trường (precision), nên quy ô trống về `0`
 * là bịa ra một quy tắc người dùng không đặt — và lượt quét sẽ bắt lỗi bản vẽ
 * theo quy tắc bịa đó. */
function numberOrUndefined(raw: string): number | undefined {
  const trimmed = raw.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Ô số giữ NGUYÊN VĂN thứ người dùng đang gõ.
 *
 * Đọc lại từ `value` mỗi lần render thì `2.` bị chuẩn hoá về `2` ngay khi vừa
 * gõ dấu chấm, và không cách nào gõ được `2.5` — con trỏ nhảy, số thập phân
 * biến mất. Đây là lỗi chỉ lộ ra khi gõ thật, không lộ ra khi đọc mã.
 *
 * Trạng thái ngoài vẫn nhận giá trị đã phân tích ngay từng phím: bản nháp luôn
 * đúng, chỉ có phần HIỂN THỊ là bám theo văn bản thô.
 */
function NumberField({ label, value, onChange, hint }: {
  label: string;
  value: number | undefined;
  onChange: (next: number | undefined) => void;
  hint?: string;
}) {
  const [text, setText] = useState(value === undefined ? "" : String(value));

  /* Đồng bộ từ ngoài vào CHỈ khi giá trị thật lệch với thứ đang gõ — nếu không,
     mỗi lần cha render lại sẽ xoá dấu chấm vừa gõ. */
  useEffect(() => {
    if (numberOrUndefined(text) !== value) {
      setText(value === undefined ? "" : String(value));
    }
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <label className="field">
      <span>{label}</span>
      <input className="input" inputMode="decimal" value={text}
        onChange={(event) => {
          setText(event.target.value);
          onChange(numberOrUndefined(event.target.value));
        }} />
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

function TextField({ label, value, onChange, hint }: {
  label: string;
  value: string;
  onChange: (next: string) => void;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <input className="input" value={value}
        onChange={(event) => onChange(event.target.value)} />
      {hint ? <span className="hint">{hint}</span> : null}
    </label>
  );
}

export default function StandardsPage() {
  const [profiles, setProfiles] = useState<StandardsProfile[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<StandardsProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  /* Lỗi của lượt xoá phải hiện TRONG thẻ. `error` ở tầng trang nằm SAU thẻ, nên
     một lượt 409 sẽ trông như "bấm xong không có gì xảy ra": thẻ đứng im, nút
     vẫn bấm được, và câu giải thích thì bị chính thẻ che mất. */
  const [deleteError, setDeleteError] = useState("");
  /* Vé cho lượt nạp hồ sơ — xem `loadProfiles`. */
  const profilesSequence = useRef(0);
  const [error, setError] = useState("");
  const [savedNote, setSavedNote] = useState("");
  /* Màn này KHÔNG gắn với bản vẽ nào — nó chỉ sửa một hồ sơ trong daemon. Danh
     sách bản vẽ chỉ dùng cho một việc: hộp thoại nhập layer phải hỏi lấy từ đâu.
     Một lượt đọc hỏng không được làm gì ngoài việc khoá đúng cái nút đó. */
  const [docs, setDocs] = useState<AcadDocument[]>([]);
  /* Danh sách còn SỐNG hay không, tách khỏi nội dung danh sách. Giữ danh sách cũ
     khi một lượt đọc hỏng là đúng — nhưng nếu chỉ nhìn `docs.length` để bật nút
     nhập thì giao diện sẽ mời một đường dẫn có thể đã chết, và người dùng chỉ
     biết sau khi mở hộp thoại rồi ăn lỗi. */
  const [docsAlive, setDocsAlive] = useState(false);
  /* Bảng màu ACI thật, lấy từ chính AutoCAD. Đọc MỘT LẦN: nó tĩnh trong cả phiên
     AutoCAD, và plugin ghi nó ra một lần lúc nạp.
     `null` cho tới khi đọc được, và giữ `null` nếu plugin là bản cũ — lúc đó
     `aciHex()` lùi về 9 màu có quy ước cố định, còn chỉ số ngoài dải đó hiện
     bằng SỐ. Bịa màu cho chúng tệ hơn: người dùng dựa vào đúng ô màu ấy để tìm
     nhầm lẫn. */
  const [palette, setPalette] = useState<AciPalette | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  /** `throwOnFailure` cho đường LƯU: ở đó một lượt nạp lại hỏng KHÔNG được im
   *  lặng, vì bản nháp sẽ giữ `revision` cũ và lần lưu sau gửi `If-Match` đã
   *  chết — người dùng thấy "đã lưu" rồi ăn xung đột không hiểu từ đâu. */
  const loadProfiles = useCallback(async (preferId?: string, throwOnFailure = false) => {
    setError("");
    /* Vé. Nút "Thử lại" và lượt nạp lúc gắn KHÔNG đặt `busy`, nên một lượt nạp
       vẫn đang bay khi người dùng bấm Xoá — và nó về SAU lượt xoá, gọi
       `setProfiles` với ảnh chụp TRƯỚC khi xoá. Hồ sơ vừa xoá hiện lại trên bảng
       như chưa có gì xảy ra, bấm vào là mở bản nháp của thứ không còn tồn tại.
       Cùng lối với `/review`, và với `docsSequence` đã có sẵn ở đó. */
    const ticket = ++profilesSequence.current;
    try {
      const body = await daemonRecord(
        await fetch(endpoints.standardsProfiles(DAEMON_BASE), { cache: "no-store" }),
      );
      if (ticket !== profilesSequence.current) return;
      const list = Array.isArray(body.profiles) ? body.profiles.map(normalizeProfile) : [];
      setProfiles(list);
      setSelectedId((current) => {
        const wanted = preferId || current;
        return list.some((item) => item.id === wanted) ? wanted : list[0]?.id ?? "";
      });
    } catch (failure) {
      /* Lỗi của một lượt đã bị thay thế thì đừng viết lên màn hình: nó mô tả một
         yêu cầu không còn ai chờ. Nhưng VẪN ném tiếp khi nơi gọi đòi, vì nó đang
         `await` chính lượt này. */
      if (ticket === profilesSequence.current) setError(daemonFailureText(failure));
      if (throwOnFailure) throw failure;
    } finally {
      if (ticket === profilesSequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => { void loadProfiles(); }, [loadProfiles]);

  /* Đọc MỘT LẦN lúc gắn là không đủ: mở `/standards` trước khi AutoCAD sẵn sàng
     thì `docs` rỗng mãi và nút nhập layer khoá vĩnh viễn; mở hoặc đóng một bản vẽ
     trong lúc trang còn mở thì danh sách nguồn hoặc thiếu, hoặc mời một bản vẽ đã
     đóng. Bám bus sự kiện có sẵn — cùng cách `/review` làm. */
  /* Vé cho lượt đọc danh sách. Lượt đọc lúc gắn trang và lượt do sự kiện `doc*`
     kích hoạt có thể chồng nhau, và không có vé thì phản hồi CŨ ghi đè lên ảnh
     chụp MỚI — ô chọn nguồn sẽ bày một tệp đã đóng, hoặc đánh dấu nhầm bản vẽ
     đang hoạt động, rồi lượt nhập layer đọc từ sai nguồn. `/review` đã có vé
     `docsSequence` cho đúng chuyện này. */
  const docsSequence = useRef(0);
  const loadDocs = useCallback(() => {
    const ticket = ++docsSequence.current;
    fetchDocs(DAEMON_BASE)
      .then((snapshot) => {
        if (ticket !== docsSequence.current) return;
        /* Một lượt đọc hỏng KHÔNG phải bằng chứng AutoCAD không còn bản vẽ nào —
           giữ danh sách cũ thay vì xoá trắng vì một lần trục trặc. Nhưng cờ sống
           thì hạ xuống, và chính nó mới quyết nút nhập có bật hay không. */
        setDocsAlive(snapshot.alive);
        if (snapshot.alive) setDocs(snapshot.docs);
      })
      .catch(() => {
        if (ticket !== docsSequence.current) return;
        setDocsAlive(false);
      });
  }, []);
  useEffect(loadDocs, [loadDocs]);

  /* Bảng màu ACI: tĩnh trong MỘT phiên AutoCAD, nên đọc lại khi phiên đổi.
     Một lượt đọc duy nhất lúc gắn là sai ở hai đầu: mở trang TRƯỚC khi AutoCAD
     sẵn sàng thì không bao giờ có bảng màu cho tới lúc tải lại trang; nạp lại
     plugin trong lúc trang còn mở thì bảng màu ở lại từ phiên trước — và daemon
     nay từ chối bảng lệch phiên, nên nó sẽ thành `null` chứ không âm thầm sai.
     `no-store`: đây là một tài nguyên gắn với phiên, để trình duyệt đệm là quay
     lại đúng vấn đề vừa sửa.
     Đọc hỏng thì im lặng giữ `null` — không có bảng màu không chặn việc gì cả,
     giao diện hiện chỉ số bằng số. */
  const paletteSequence = useRef(0);
  const loadPalette = useCallback((refresh = false) => {
    const ticket = ++paletteSequence.current;
    /* Đọc LẠI thì xoá bảng cũ NGAY, đừng đợi phản hồi. Lượt đọc này hỏi plugin
       nên có thể mất vài giây, và trong quãng đó bảng của phiên AutoCAD TRƯỚC
       vẫn hiện — người dùng kịp chọn một ô màu cũ rồi lưu hồ sơ. Mất bảng màu
       vài giây chỉ làm chỉ số hiện bằng số; chọn nhầm màu thì đi vào hồ sơ.
       Lượt đọc ĐẦU không cần xoá (đang là `null` sẵn), và xoá ở đó cũng vô hại —
       tách ra chỉ để chỗ gọi nói rõ ý định. */
    if (refresh) setPalette(null);
    fetch(endpoints.aciPalette(DAEMON_BASE), { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (ticket !== paletteSequence.current) return;
        /* `readAciPalette(null)` là `null`, nên phản hồi lỗi (409 lệch phiên,
           404 chưa có) cũng đi qua đây và xoá bảng cũ. */
        setPalette(readAciPalette(body));
      })
      /* Đọc hỏng thì XOÁ, không giữ bảng cũ. Giữ lại là hiện màu của phiên
         AutoCAD TRƯỚC như thể của phiên này — đúng thứ mã phiên phía máy chủ vừa
         dựng ra để chặn, và chặn ở máy chủ rồi lại tự bịa lại ở client thì vô
         nghĩa. Mất bảng màu không mất dữ liệu gì: chỉ số hiện bằng số. */
      .catch(() => {
        if (ticket === paletteSequence.current) setPalette(null);
      });
  }, []);
  /* Bọc lại: `useEffect(loadPalette, …)` sẽ truyền thẳng đối số React gọi vào,
     và `loadPalette` nay nhận một cờ — để nguyên là lượt đọc đầu tự coi mình là
     lượt đọc lại. */
  useEffect(() => { loadPalette(); }, [loadPalette]);

  useAcadEvents(DAEMON_BASE, (event) => {
    /* `drawingSaved` cũng phải nghe. Plugin gọi `writeDocs()` rồi phát sự kiện đó
       ngay trong `saveComplete` — và một lượt "Save As" đổi ĐƯỜNG DẪN tệp, tức
       đúng thứ `targetOf()` ưu tiên. Không nghe thì danh sách nguồn giữ đường dẫn
       cũ, và mọi lượt đọc layer sau đó trả `not_found` cho tới lần mở/đóng bản vẽ
       kế tiếp. */
    /* Nghe rộng để ô chọn nguồn của hộp thoại nhập layer luôn đúng. Việc bảo
       đảm số liệu không cũ thì KHÔNG dựa vào đây — hộp thoại đọc lại ngay tại
       lúc bấm Nhận, nên không có khoảng thời gian nào để canh. */
    if (event.type.startsWith("doc") || event.type === "drawingSaved"
      || event.type === "drawingModified" || event.type === "pluginLoaded") loadDocs();
    /* Nạp lại plugin = phiên AutoCAD mới = bảng màu mới. Chỉ nghe đúng sự kiện
       đó; mở/đóng bản vẽ không đổi bảng màu nên đọc lại là phí. */
    if (event.type === "pluginLoaded") loadPalette(true);
  });

  const selected = profiles.find((item) => item.id === selectedId) ?? null;

  /* Bản nháp dựng lại khi ĐỔI hồ sơ, không phải khi danh sách đổi — nếu không,
     một lượt nạp lại danh sách sẽ xoá thứ người dùng đang gõ dở. */
  useEffect(() => {
    setDraft(selected ? { ...selected } : null);
  }, [selectedId, selected?.revision]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Xoá lời báo "đã lưu" khi ĐỔI hồ sơ, KHÔNG khi revision đổi. Lưu thành công
     làm revision đổi, nên gộp hai thứ này là tự xoá lời báo vừa đặt — và mọi
     lần lưu thật đều im lặng. */
  useEffect(() => { setSavedNote(""); }, [selectedId]);

  const dirty = useMemo(() => {
    if (!draft || !selected) return false;
    return JSON.stringify(draft) !== JSON.stringify(selected);
  }, [draft, selected]);

  const saveBlocked = draft
    ? profileSaveBlockedReason(draft, selected)
    : "Chưa chọn hồ sơ.";

  const patch = (next: Partial<StandardsProfile>) =>
    setDraft((current) => (current ? { ...current, ...next } : current));

  const save = useCallback(async () => {
    if (!draft?.id || !dirty || busy || saveBlocked) return;
    setBusy(true);
    setError("");
    try {
      const body = await daemonRecord(
        await fetch(endpoints.standardsProfile(DAEMON_BASE, draft.id), {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            /* Revision đang giữ. Máy chủ từ chối khi nó đã lệch, nên hai tab
               cùng sửa một hồ sơ sẽ có một bên bị chặn thay vì im lặng ghi đè
               lên nhau. */
            "If-Match": draft.revision,
          },
          /* VÁ lên bản ghi gốc, không gửi bản nháp phẳng — xem
             `applyProfileEdits()`. Gửi thẳng `draft` là xoá hơn 20 trường
             dimension mà form này chưa đụng tới. */
          body: JSON.stringify(applyProfileEdits(draft)),
        }),
      );
      const saved = normalizeProfile(body.profile);
      /* Cập nhật ngay từ phản hồi TRƯỚC khi nạp lại danh sách: PUT đã thành
         công, nên `revision` mới phải vào bản nháp dù lượt GET sau đó hỏng. */
      setDraft(saved);
      await loadProfiles(saved.id || draft.id, true);
      setSavedNote(
        saved.revision === draft.revision
          ? `Đã lưu “${saved.name || draft.name}”. Nội dung không đổi nên vẫn là `
            + `phiên bản ${saved.version} — lượt quét đang mở ở màn Kiểm tra vẫn `
            + "dùng được."
          : `Đã lưu “${saved.name || draft.name}” thành phiên bản ${saved.version}. `
            + "Mọi lượt quét ở màn Kiểm tra dựa trên phiên bản cũ đã hết giá trị "
            + "— phải quét lại trước khi sửa.",
      );
    } catch (failure) {
      setError(daemonFailureText(failure));
    } finally {
      setBusy(false);
    }
  }, [draft, dirty, busy, saveBlocked, loadProfiles]);

  const createProfile = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const body = await daemonRecord(
        await fetch(endpoints.standardsProfiles(DAEMON_BASE), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: draft ? `${draft.name} (bản sao)` : "Hồ sơ mới",
            ...(draft?.id ? { sourceId: draft.id } : {}),
          }),
        }),
      );
      const created = normalizeProfile(body.profile);
      await loadProfiles(created.id);
      setSavedNote(`Đã tạo “${created.name}”.`);
    } catch (failure) {
      setError(daemonFailureText(failure));
    } finally {
      setBusy(false);
    }
  }, [busy, draft, loadProfiles]);

  const deleteBlocked = profileDeleteBlockedReason({ selected, busy });

  /* Xoá theo `selected` — bản ĐÃ LƯU của máy chủ — chứ không theo `draft`.
     `draft` mang cả thay đổi đang gõ dở, và `revision` của nó không phải thứ máy
     chủ đang giữ; gửi nó trong `If-Match` là tự tạo ra một xung đột giả. */
  const removeProfile = async () => {
    if (deleteBlocked || !selected) return;
    setBusy(true);
    setError("");
    setDeleteError("");
    try {
      const response = await fetch(
        endpoints.standardsProfile(DAEMON_BASE, selected.id),
        {
          method: "DELETE",
          /* `If-Match` là chốt DUY NHẤT chặn việc xoá một bản mình chưa từng
             thấy: ai đó sửa hồ sơ ở tab khác thì máy chủ trả 409 thay vì xoá êm
             bản mới. Không gửi thì `deleteProfile()` bỏ qua phép so hoàn toàn. */
          headers: { "If-Match": selected.revision },
        },
      );
      await daemonRecord(response);
      setDeleteOpen(false);
      const name = selected.name;
      /* Chọn hồ sơ khác TRƯỚC khi nạp lại, và chọn theo VỊ TRÍ cũ: nạp lại với
         id vừa xoá sẽ rơi về hồ sơ đầu danh sách, tức nhảy đi một chỗ người dùng
         không yêu cầu. */
      const index = profiles.findIndex((item) => item.id === selected.id);
      const next = profiles[index + 1] ?? profiles[index - 1] ?? null;
      setSelectedId(next?.id ?? "");
      /* Bỏ hồ sơ khỏi danh sách NGAY, đừng đợi lượt nạp lại nói hộ. `loadProfiles`
         nuốt lỗi mạng và giữ nguyên danh sách cũ, nên một lượt nạp hỏng sau khi
         DELETE đã thành công sẽ để hồ sơ vừa xoá nằm lại trên bảng — bấm vào là
         mở một bản nháp của thứ không còn tồn tại. Máy chủ đã xác nhận xoá; đó
         mới là sự thật. */
      /* Vô hiệu mọi lượt nạp đang bay TRƯỚC khi sửa danh sách: một lượt nạp bắt
         đầu trước lượt xoá mang ảnh chụp còn hồ sơ này, và nó về sau thì hồ sơ
         vừa xoá hiện lại. */
      profilesSequence.current += 1;
      setProfiles((prev) => prev.filter((item) => item.id !== selected.id));
      await loadProfiles(next?.id ?? "");
      setSavedNote(`Đã xoá “${name}”.`);
    } catch (failure) {
      /* 404 nghĩa là hồ sơ ĐÃ không còn — ai đó vừa xoá ở tab khác. Kết quả người
         dùng muốn đã đạt, nên báo lỗi là sai: nó để lại dòng hồ sơ trên bảng, và
         đóng-mở thẻ rồi bấm lại chỉ gửi đúng yêu cầu đó thêm một lần nữa. DELETE
         vốn idempotent; xử như đã xong. */
      const gone = failure instanceof DaemonError
        && (failure.status === 404 || failure.code === "profile_not_found");
      if (gone) {
        setDeleteOpen(false);
        profilesSequence.current += 1;
        setProfiles((prev) => prev.filter((item) => item.id !== selected.id));
        setSelectedId((current) => (current === selected.id ? "" : current));
        await loadProfiles();
        setSavedNote(`“${selected.name}” đã bị xoá ở nơi khác.`);
      } else {
        /* Còn lại thì giữ thẻ MỞ và báo ngay trong đó. Hay gặp nhất là 409 — ai
           đó vừa SỬA hồ sơ ở nơi khác — và người dùng cần đọc được điều đó ở
           đúng chỗ họ đang nhìn. */
        setDeleteError(daemonFailureText(failure));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppShell
      screen="standards"
      title="Hồ sơ tiêu chuẩn"
      sub={draft
        ? `${draft.name}${draft.version ? ` · phiên bản ${draft.version}` : ""}`
          + `${dirty ? " · có thay đổi chưa lưu" : ""}`
        : "Chưa có hồ sơ nào"}
      actions={
        <>
          <Button
            onClick={() => void createProfile()}
            disabled={busy || dirty}
            /* Nhân bản gửi `sourceId`, nên máy chủ chép bản ĐÃ LƯU — thay đổi
               đang gõ dở bị bỏ lại, rồi màn hình nhảy sang bản sao và bản nháp
               biến mất. Mất việc trong im lặng. */
            title={dirty ? "Lưu hoặc bỏ thay đổi trước khi nhân bản." : undefined}
          >
            {draft ? "Nhân bản" : "Hồ sơ mới"}
          </Button>
          <Button onClick={() => { setDeleteError(""); setDeleteOpen(true); }}
            disabled={!!deleteBlocked}
            title={deleteBlocked || "Xoá hẳn hồ sơ đang chọn. Không lấy lại được."}>
            Xoá hồ sơ
          </Button>
          <Button variant="primary" onClick={() => void save()}
            disabled={!dirty || busy || !!saveBlocked}
            title={saveBlocked || (dirty ? undefined : "Chưa có thay đổi nào để lưu.")}>
            {busy ? "Đang lưu…" : "Lưu hồ sơ"}
          </Button>
        </>
      }
    >
      <div className="stack">
        <div className="banner">
          <span className="bm" />
          <span className="bt">
            <b>Màn hình này không chạm vào bản vẽ.</b> Nó chỉ sửa bộ quy tắc.
            Việc quét bản vẽ và sửa theo phát hiện nằm ở{" "}
            <Link href="/review">Kiểm tra bản vẽ</Link> — và <b>lưu ở đây làm
            mọi lượt quét đang mở bên đó hết giá trị</b>.
          </span>
        </div>

        {error ? (
          <div className="banner" data-tone="hard">
            <span className="bm" />
            <span className="bt"><b>Không đọc/ghi được hồ sơ.</b> {error}</span>
            <span className="actions">
              <Button onClick={() => {
                /* Nạp lại sẽ dựng lại bản nháp từ dữ liệu máy chủ. Sau một
                   xung đột, bản nháp ở đây đang GIỮ thứ người dùng gõ dở — nạp
                   thẳng là vứt nó đi không hỏi. */
                if (dirty && !window.confirm(
                  "Tải lại sẽ bỏ các thay đổi chưa lưu. Tiếp tục?")) return;
                void loadProfiles();
              }}>Thử lại</Button>
            </span>
          </div>
        ) : null}

        {dirty && saveBlocked ? (
          <div className="banner" data-tone="hard">
            <span className="bm" />
            <span className="bt"><b>Chưa lưu được.</b> {saveBlocked}</span>
          </div>
        ) : null}

        {savedNote ? (
          <div className="banner">
            <span className="bm" />
            <span className="bt">{savedNote}</span>
            <span className="actions">
              <Button onClick={() => setSavedNote("")}>Đã hiểu</Button>
            </span>
          </div>
        ) : null}

        <section className="panel">
          <header>
            <h2>Hồ sơ</h2>
            <div className="actions"><span className="tag mono">{profiles.length}</span></div>
          </header>
          <div className="tablewrap">
            <table className="data">
              <thead>
                <tr><th>Tên</th><th>Mã</th><th className="n">Phiên bản</th><th className="n">Layer</th></tr>
              </thead>
              <tbody>
                {profiles.map((item) => (
                  <tr key={item.id}
                    aria-selected={item.id === selectedId}
                    onClick={() => {
                      if (dirty && !window.confirm(
                        "Bỏ các thay đổi chưa lưu của hồ sơ đang mở?")) return;
                      setSelectedId(item.id);
                    }}>
                    <td>{item.name}{item.id === selectedId && dirty ? <> <Tag>chưa lưu</Tag></> : null}</td>
                    <td className="mono">{item.id}</td>
                    {/* Số đếm cho người đọc; hash để trong `title` cho ai cần
                        đối chiếu. Hash là của NỘI DUNG, nên hai hồ sơ giống hệt
                        nhau mang cùng một mã — tính năng, không phải trùng. */}
                    <td className="n mono" title={item.revision}>
                      {item.version || "—"}
                    </td>
                    <td className="n mono">{item.layers.length}</td>
                  </tr>
                ))}
                {!profiles.length && !loading ? (
                  <tr><td colSpan={4}>
                    <span className="hint">Chưa có hồ sơ nào. Bấm “Hồ sơ mới”.</span>
                  </td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        {draft ? (
          <>
            <section className="panel">
              <header><h2>Đơn vị bản vẽ</h2></header>
              <div className="row" style={{ padding: "var(--s3) var(--s4)", gap: "var(--s4)", flexWrap: "wrap" }}>
                <TextField label="Tên hồ sơ" value={draft.name}
                  onChange={(name) => patch({ name })} />
                <TextField label="Đơn vị" value={draft.unit}
                  onChange={(unit) => patch({ unit })} hint="mm, m, inch…" />
                <NumberField label="INSUNITS" value={draft.insunits}
                  onChange={(insunits) => patch({ insunits })}
                  hint="Mã đơn vị của AutoCAD. 4 = milimét." />
                <NumberField label="Số lẻ" value={draft.precision}
                  onChange={(precision) => patch({ precision })}
                  hint="Máy chủ đòi một số ở đây; 0 là giá trị hợp lệ, ô trống thì không." />
                {/* Panel cũ sửa được hai trường dưới đây, màn này thì không —
                    chúng sống sót qua mỗi lượt lưu nhờ phép vá, nên người dùng
                    không mất dữ liệu, nhưng cũng không biết chúng tồn tại. Cùng
                    một lỗi với 20 trường dimension, chỉ nhỏ hơn. */}
                <label className="field">
                  <span>Kiểu ghi số</span>
                  <input className="input" list="acad-linear-formats"
                    value={draft.linearFormat}
                    onChange={(event) => patch({ linearFormat: event.target.value })} />
                  <span className="hint">LUNITS. Năm tên, hoặc số 1–5.</span>
                </label>
                <datalist id="acad-linear-formats">
                  {LINEAR_FORMATS.map((name) => <option key={name} value={name} />)}
                </datalist>
                <NumberField label="Tỷ lệ model" value={draft.modelScale}
                  onChange={(modelScale) => patch({ modelScale })} />
              </div>
            </section>

            <section className="panel">
              <header><h2>Khổ khung tên</h2></header>
              <div className="row" style={{ padding: "var(--s3) var(--s4)", gap: "var(--s4)", flexWrap: "wrap" }}>
                <TextField label="Tên khổ" value={draft.paperName}
                  onChange={(paperName) => patch({ paperName })} hint="A3, A1…" />
                <NumberField label="Rộng" value={draft.paperWidth}
                  onChange={(paperWidth) => patch({ paperWidth })} />
                <NumberField label="Cao" value={draft.paperHeight}
                  onChange={(paperHeight) => patch({ paperHeight })} />
                <NumberField label="Dung sai khung (%)" value={draft.frameTolerancePercent}
                  onChange={(frameTolerancePercent) => patch({ frameTolerancePercent })}
                  hint="Khung lệch quá bao nhiêu phần trăm thì lượt quét báo lỗi. 0–100." />
              </div>
            </section>

            <section className="panel">
              <header><h2>Kích thước</h2></header>
              <div className="row" style={{ padding: "var(--s3) var(--s4)", gap: "var(--s4)", flexWrap: "wrap" }}>
                <TextField label="Tên dimstyle" value={draft.dimStyleName}
                  onChange={(dimStyleName) => patch({ dimStyleName })} />
                <NumberField label="Cao chữ" value={draft.dimTextHeight}
                  onChange={(dimTextHeight) => patch({ dimTextHeight })} />
                <NumberField label="Tỷ lệ tổng" value={draft.dimOverallScale}
                  onChange={(dimOverallScale) => patch({ dimOverallScale })} />
              </div>
              <div style={{ padding: "0 var(--s4) var(--s4)" }}>
                <DimensionExtras extras={draft.dimensionExtras} disabled={busy}
                  /* Kiểu từng trường lấy từ bản đã lưu — `draft` có thể đang
                     giữ một ô gõ dở, và kiểu của thứ gõ dở nói sai về trường. */
                  baseline={(selected ?? draft).dimensionExtras}
                  onChange={(dimensionExtras) => patch({ dimensionExtras })} />
              </div>
            </section>

            <LayerTable layers={draft.layers} disabled={busy} palette={palette}
              onChange={(layers) => patch({ layers })}
              /* Không có bản vẽ nào đang mở thì KHÔNG truyền hàm — nút sẽ mờ và
                 nói lý do, thay vì mở một hộp thoại rỗng rồi báo lỗi. */
              onImport={docsAlive && docs.length ? () => setImportOpen(true) : undefined} />

            <MappingTable mappings={draft.mappings} disabled={busy}
              onChange={(mappings) => patch({ mappings })} />
          </>
        ) : null}
      </div>

      {importOpen && draft ? (
        <ImportLayers
          layers={draft.layers}
          docs={docs}
          docsAlive={docsAlive}
          onCancel={() => setImportOpen(false)}
          onApply={(layers, summary) => {
            patch({ layers });
            setImportOpen(false);
            /* Nói rõ CHƯA LƯU. Kết quả vào bản nháp; nút Lưu hồ sơ vẫn là bước
               ghi thật, và `If-Match` vẫn chốt tranh chấp như mọi lần lưu khác. */
            setSavedNote(summary);
          }}
        />
      ) : null}

      {deleteOpen && selected ? (
        <ConfirmSheet
          title="Xoá hồ sơ quy chuẩn"
          /* `data`, KHÔNG phải `immediate`. Xoá hồ sơ không chạm bản vẽ nào, nên
             câu "gõ UNDO trong AutoCAD" của các chế độ kia là SAI ở đây — và một
             cảnh báo sai làm hỏng đúng thứ nó tồn tại để bảo vệ. */
          mode="data"
          summary={profileDeleteSummary(selected)}
          confirmLabel="Xoá hồ sơ"
          busy={busy}
          blocked={deleteBlocked}
          onConfirm={() => void removeProfile()}
          onCancel={() => { setDeleteError(""); setDeleteOpen(false); }}
        >
          <div className="stack" style={{ gap: "var(--s2)" }}>
            {deleteError ? (
              <div className="callout" data-kind="stop">
                <span className="lbl">Chưa xoá được</span>
                <p>{deleteError}</p>
              </div>
            ) : null}
            {dirty ? (
              <p className="hint">
                Hồ sơ này đang có <b>thay đổi chưa lưu</b>. Chúng mất luôn cùng
                bản đã lưu.
              </p>
            ) : null}
            {/* Lượt quét sống ở MÁY CHỦ và gắn với `profileRevision`, nên màn
                hình này không thấy được có ai đang mở lượt quét nào. Nói ra khả
                năng đó thay vì im lặng — người dùng là người biết họ có đang mở
                màn Kiểm tra hay không. */}
            <p className="hint">
              Lượt quét nào đang mở theo hồ sơ này ở màn <b>Kiểm tra bản vẽ</b> sẽ
              không sửa được nữa; phải quét lại bằng một hồ sơ khác.
            </p>
            {profiles.length === 1 ? (
              <p className="hint">
                Đây là hồ sơ <b>cuối cùng</b>. Xoá xong thì chưa quét được bản vẽ
                nào cho tới khi bạn bấm <b>Hồ sơ mới</b>.
              </p>
            ) : null}
          </div>
        </ConfirmSheet>
      ) : null}
    </AppShell>
  );
}

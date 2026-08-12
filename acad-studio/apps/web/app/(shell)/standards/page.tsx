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
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "../../../components/shell/AppShell";
import { Button } from "../../../components/ui/Button";
import { Tag } from "../../../components/ui/Tag";
import { DAEMON_BASE, endpoints } from "../../../lib/daemon/endpoints";
import { daemonFailureText, daemonRecord } from "../../../lib/daemon/client";
import {
  applyProfileEdits,
  normalizeProfile,
  profileSaveBlockedReason,
  type StandardsProfile,
} from "../../../features/standards/model";

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
  const [error, setError] = useState("");
  const [savedNote, setSavedNote] = useState("");

  /** `throwOnFailure` cho đường LƯU: ở đó một lượt nạp lại hỏng KHÔNG được im
   *  lặng, vì bản nháp sẽ giữ `revision` cũ và lần lưu sau gửi `If-Match` đã
   *  chết — người dùng thấy "đã lưu" rồi ăn xung đột không hiểu từ đâu. */
  const loadProfiles = useCallback(async (preferId?: string, throwOnFailure = false) => {
    setError("");
    try {
      const body = await daemonRecord(
        await fetch(endpoints.standardsProfiles(DAEMON_BASE), { cache: "no-store" }),
      );
      const list = Array.isArray(body.profiles) ? body.profiles.map(normalizeProfile) : [];
      setProfiles(list);
      setSelectedId((current) => {
        const wanted = preferId || current;
        return list.some((item) => item.id === wanted) ? wanted : list[0]?.id ?? "";
      });
    } catch (failure) {
      setError(daemonFailureText(failure));
      if (throwOnFailure) throw failure;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void loadProfiles(); }, [loadProfiles]);

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

  const saveBlocked = draft ? profileSaveBlockedReason(draft) : "Chưa chọn hồ sơ.";

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
          ? `Đã lưu “${saved.name || draft.name}”. Nội dung không đổi, nên lượt `
            + "quét đang mở ở màn Kiểm tra vẫn dùng được."
          : `Đã lưu “${saved.name || draft.name}”. Mọi lượt quét ở màn Kiểm tra `
            + "dựa trên hồ sơ này đã hết giá trị — phải quét lại trước khi sửa.",
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

  return (
    <AppShell
      screen="standards"
      title="Hồ sơ tiêu chuẩn"
      sub={draft
        ? `${draft.name}${dirty ? " · có thay đổi chưa lưu" : ""}`
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
                <tr><th>Tên</th><th>Mã</th><th>Phiên bản</th><th className="n">Layer</th></tr>
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
                    {/* Cắt hash cho đọc được. Nó là hash NỘI DUNG, nên hai hồ
                        sơ giống hệt nhau mang cùng một mã — đó là tính năng,
                        không phải trùng lặp. */}
                    <td className="mono" title={item.revision}>
                      {item.revision.slice(0, 8) || "—"}
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
            </section>

            <section className="panel">
              <header>
                <h2>Layer bắt buộc</h2>
                <div className="actions"><span className="tag mono">{draft.layers.length}</span></div>
              </header>
              <div className="tablewrap">
                <table className="data">
                  <thead>
                    <tr><th>Tên</th><th>Màu</th><th>Nét</th><th>Bề dày</th><th>Bắt buộc</th></tr>
                  </thead>
                  <tbody>
                    {draft.layers.map((layer, index) => (
                      <tr key={`${layer.name}-${index}`}>
                        <td className="mono">{layer.name}</td>
                        <td className="mono">{String(layer.color)}</td>
                        <td className="mono">{layer.linetype}</td>
                        <td className="mono">{String(layer.lineweight)}</td>
                        <td>{layer.required ? "có" : "không"}</td>
                      </tr>
                    ))}
                    {!draft.layers.length ? (
                      <tr><td colSpan={5}>
                        <span className="hint">Hồ sơ này chưa liệt kê layer nào.</span>
                      </td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: "var(--s3) var(--s4)", borderTop: "1px solid var(--border)" }}>
                <span className="needs-backend">Sửa danh sách layer chưa có ở màn này</span>
                <span className="hint" style={{ marginLeft: "var(--s2)" }}>
                  Đọc được nhưng chưa sửa được — dùng <Link href="/">màn hình cũ</Link> cho
                  tới khi phần soạn layer được dựng.
                </span>
              </div>
            </section>

            <section className="panel">
              <header>
                <h2>Ánh xạ đối tượng</h2>
                <div className="actions"><span className="tag mono">{draft.mappings.length}</span></div>
              </header>
              <div className="tablewrap">
                <table className="data">
                  <thead>
                    <tr><th>Nhãn</th><th>Loại</th><th>Mẫu layer</th><th>Mẫu block</th><th>Bắt buộc</th></tr>
                  </thead>
                  <tbody>
                    {draft.mappings.map((mapping) => (
                      <tr key={mapping.id}>
                        <td>{mapping.label || mapping.id}</td>
                        <td className="mono">{mapping.kind}</td>
                        <td className="mono">{mapping.layerPatterns.join(" · ") || "—"}</td>
                        <td className="mono">{mapping.blockPatterns.join(" · ") || "—"}</td>
                        <td>{mapping.required ? "có" : "không"}</td>
                      </tr>
                    ))}
                    {!draft.mappings.length ? (
                      <tr><td colSpan={5}>
                        <span className="hint">Hồ sơ này chưa có ánh xạ nào.</span>
                      </td></tr>
                    ) : null}
                  </tbody>
                </table>
              </div>
              <div style={{ padding: "var(--s3) var(--s4)", borderTop: "1px solid var(--border)" }}>
                <span className="needs-backend">Sửa ánh xạ chưa có ở màn này</span>
                <span className="hint" style={{ marginLeft: "var(--s2)" }}>
                  Ánh xạ quyết định đối tượng nào bị tính diện tích — sửa sai là
                  sai cả bảng bóc tách, nên phần soạn nó chưa được bê vội.
                </span>
              </div>
            </section>
          </>
        ) : null}
      </div>
    </AppShell>
  );
}

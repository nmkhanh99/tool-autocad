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
import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "../../../components/shell/AppShell";
import { Button } from "../../../components/ui/Button";
import { Tag } from "../../../components/ui/Tag";
import { ConfirmSheet } from "../../../components/ui/ConfirmSheet";
import { useDrawingInfo } from "../../../features/drawing-info/useDrawingInfo";
import {
  SelectionBuilder,
  type SelectionDraft,
} from "../../../features/drawing-info/SelectionBuilder";
import {
  entityTotals,
  insUnitsLabel,
  isModified,
  layerColor,
  layerFlags,
  layerRows,
  lineweightLabel,
  normalize,
  operationTarget,
  record,
  typeBars,
  usableExtents,
} from "../../../features/drawing-info/model";
import {
  applyStagedOp,
  prepareStagedOp,
  rejectStagedOp,
  stagedErrorText,
} from "../../../features/staged-ops/prepareApplyReject";
import type { StagedOp } from "../../../features/staged-ops/types";
import { DAEMON_BASE } from "../../../lib/daemon/endpoints";

export default function DrawingInfoPage() {
  const info = useDrawingInfo(DAEMON_BASE);
  const payload = info.data;

  const [pending, setPending] = useState<{ op: StagedOp; draft: SelectionDraft } | null>(null);
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

  const prepare = useCallback(async (draft: SelectionDraft) => {
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
      setPending({ op, draft });
    } catch (failure) {
      setError(stagedErrorText(failure));
    } finally {
      setBusy(false);
    }
  }, [payload]);

  const confirm = useCallback(async () => {
    if (!pending) return;
    setBusy(true);
    try {
      await applyStagedOp(DAEMON_BASE, pending.op);
      setPending(null);
      /* Bản vẽ vừa đổi — hồ sơ trên màn hình đã cũ. Đọc lại để bảng layer và số
         đếm không mô tả một trạng thái không còn nữa. */
      info.reload();
    } catch (failure) {
      setError(stagedErrorText(failure));
      /* Apply là one-shot: hỏng thì id đó chết hẳn. Giữ thẻ xác nhận là mời
         người dùng bấm lại một id đã hỏng. */
      setPending(null);
    } finally {
      setBusy(false);
    }
  }, [pending, info]);

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
          {payload && isModified(payload) ? <Tag>chưa lưu</Tag> : null}
          <Button onClick={info.reload} disabled={info.refreshing}>
            {info.refreshing ? "Đang đọc…" : "Đọc lại"}
          </Button>
        </>
      }
    >
      <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
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
                    dbmod = {String(doc.dbmod ?? "—")}
                    {payload ? (isModified(payload) ? " · có thay đổi chưa lưu" : " · đã lưu") : ""}
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
            </div>
          </div>

          <SelectionBuilder
            payload={payload}
            busy={busy}
            error={error}
            onPrepare={(draft) => void prepare(draft)}
          />
        </div>
      </div>

      {pending ? (
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

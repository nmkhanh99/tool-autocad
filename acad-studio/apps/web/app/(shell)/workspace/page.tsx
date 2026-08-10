"use client";

/** Khung bản vẽ — hình học thật của bản vẽ đang mở trong AutoCAD.
 *
 * ## Ba chỗ màn hình này CỐ TÌNH lệch khỏi bộ mẫu
 *
 * **1. Không có dải phiên bản snapshot.** `mau-thiet-ke/workspace.html` dựng
 * một thanh trượt r45 → r48 và một banner "snapshot cũ hơn bản vẽ". Backend
 * không có thứ gì như thế: không có lịch sử snapshot, `.cadweb` sync chưa có
 * máy chủ nhận, và hình học đọc TRỰC TIẾP từ plugin mỗi lượt. Dựng thanh trượt
 * ấy là vẽ ra một lịch sử không tồn tại. Thay bằng đúng một sự thật: đây là ảnh
 * chụp lúc mấy giờ, và nút đọc lại.
 *
 * **2. Không có hàng "Màu" và "Linetype".** Payload không mang. Xem
 * `Inspector.tsx`.
 *
 * **3. Có bộ chọn không gian, bộ mẫu thì không.** Bản vẽ thật có 5 không gian
 * (Model + 4 layout) với hệ toạ độ khác nhau hoàn toàn — Model ở toạ độ trắc
 * địa cách gốc 3,7 triệu đơn vị, layout tính bằng mm trên tờ giấy. Vẽ chung một
 * khung cho ra một khung vô nghĩa. Không có bộ chọn thì 34 đối tượng trên các
 * layout không có đường nào để xem.
 *
 * ## Điều màn hình phải nói ra
 *
 * Sau khi plugin xuất được nội dung định nghĩa block, khung xem vẽ ra đúng bản
 * vẽ — nhưng **không phải mọi nét đều là hình thật**. Trên Model của bản vẽ
 * as-built: 135 hình thật, 35 hình thiếu (tim ống MLINE), 54 chỗ chưa có hình
 * (hình bao của DIMENSION/HATCH/VIEWPORT, và block rỗng). Vẽ tất cả cùng một
 * màu rồi gọi đó là bản vẽ chính là `PreconstructionPanel` thứ hai. Dải đếm ở
 * thanh không gian và màu nét tồn tại để chặn đúng việc đó.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AppShell } from "../../../components/shell/AppShell";
import { Button } from "../../../components/ui/Button";
import { Tag } from "../../../components/ui/Tag";
import { Icon } from "../../../components/ui/icons";
import { Inspector } from "../../../features/workspace/Inspector";
import { LayerPane } from "../../../features/workspace/LayerPane";
import { PlanCanvas } from "../../../features/workspace/PlanCanvas";
import { useGeometry } from "../../../features/workspace/useGeometry";
import { prepareSelectHandles } from "../../../features/staged-ops/selectHandles";
import { ConfirmSheet } from "../../../components/ui/ConfirmSheet";
import {
  applyStagedOp,
  isStale,
  rejectStagedOp,
  stagedErrorText,
} from "../../../features/staged-ops/prepareApplyReject";
import type { StagedOp } from "../../../features/staged-ops/types";
import {
  catalogGuardOf,
  collectedAtLabel,
  countFidelity,
  countOutsideBounds,
  fitViewBox,
  layersOf,
  operationTarget,
  selectBlockedReason,
  spaceOrder,
  unionExtent,
  zoomPercent,
  zoomViewBox,
  type GeomEntity,
  type ViewBox,
} from "../../../features/workspace/model";
import { DAEMON_BASE } from "../../../lib/daemon/endpoints";

export default function WorkspacePage() {
  const geometry = useGeometry(DAEMON_BASE);
  const payload = geometry.data;

  const [space, setSpace] = useState("");
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [selected, setSelected] = useState("");
  const [panMode, setPanMode] = useState(false);
  /* `null` = "chưa ai dời khung", nên dùng khung vừa khít. Không thể khởi tạo
     bằng khung vừa khít: lúc mount chưa có dữ liệu để tính. */
  const [box, setBox] = useState<ViewBox | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  const spaces = useMemo(() => (payload ? spaceOrder(payload) : []), [payload]);
  const activeSpace = space && spaces.includes(space) ? space : spaces[0] ?? "";

  const inSpace = useMemo(
    () => (payload?.entities ?? []).filter((entity) => entity.sp === activeSpace),
    [payload, activeSpace],
  );
  const blocks = useMemo(() => payload?.blocks ?? {}, [payload]);
  const layers = useMemo(() => layersOf(inSpace, blocks), [inSpace, blocks]);
  /* Chỉ lọc cấp trên cùng ở đây; hình BÊN TRONG block do canvas tự lọc, vì layer
     của chúng phụ thuộc layer của lần chèn (quy tắc layer `0` của AutoCAD). Lọc
     hai chỗ là để giữ `outside`/`unionExtent` đếm đúng phần còn hiện. */
  const visible = useMemo(
    () => inSpace.filter((entity) => !hidden.has(entity.l)),
    [inSpace, hidden],
  );
  const fidelity = useMemo(() => countFidelity(inSpace, blocks), [inSpace, blocks]);

  const home = useMemo(
    () => fitViewBox(payload?.bounds?.[activeSpace]) ?? { x: 0, y: -100, w: 100, h: 100 },
    [payload, activeSpace],
  );
  const view = box ?? home;

  const selectedEntity = useMemo(
    () => inSpace.find((entity) => entity.h === selected) ?? null,
    [inSpace, selected],
  );

  /* Lượt đọc mới có thể là bản vẽ khác, hoặc cùng bản vẽ đã dời đi xa. `box` còn
     giữ khung cũ thì nó ĐÈ lên khung vừa khít mới tính, và người dùng thấy một
     canvas trống ở một góc toạ độ không còn gì — trông y như app hỏng. Mốc là
     tệp + `collectedAt`, không phải cả payload: `bounds` đổi vài đơn vị sau một
     thao tác nhỏ không đáng để vứt khung người dùng đang xem. */
  const snapshotKey = `${payload?.document?.file ?? ""}|${payload?.collectedAt ?? ""}`;
  const lastSnapshot = useRef(snapshotKey);
  useEffect(() => {
    if (lastSnapshot.current === snapshotKey) return;
    lastSnapshot.current = snapshotKey;
    setBox(null);
    setSelected("");
    /* Cả bộ lọc layer nữa. Giữ lại thì một layer trùng tên ở bản vẽ mới vẫn bị
       tắt im lặng, và bản vẽ vừa mở hiện ra thiếu mất một mảng. */
    setHidden(new Set());
  }, [snapshotKey]);

  const switchSpace = useCallback((next: string) => {
    setSpace(next);
    /* Khung, bộ lọc layer và đối tượng đang chọn đều thuộc về không gian cũ.
       Giữ lại nghĩa là mở sang layout rồi thấy màn hình trống ở một góc toạ độ
       cách đó ba triệu đơn vị, kèm một inspector mô tả đối tượng không còn
       nhìn thấy được. */
    setBox(null);
    setHidden(new Set());
    setSelected("");
  }, []);

  const zoomTo = useCallback(() => {
    if (!selectedEntity) return;
    const point = pointOf(selectedEntity);
    if (!point) return;
    /* Phóng quanh tâm đối tượng, giữ tỉ lệ 1/8 khung vừa khít — đủ gần để thấy
       chi tiết mà không mất hoàn toàn ngữ cảnh xung quanh. */
    const w = home.w / 8;
    setBox({ x: point.x - w / 2, y: -point.y - (home.h / 8) / 2, w, h: home.h / 8 });
  }, [selectedEntity, home]);

  const isolate = useCallback((layer: string) => {
    setHidden(new Set(layers.filter((row) => row.name !== layer).map((row) => row.name)));
  }, [layers]);

  /* Đối tượng ĐƯỢC VẼ mà nằm ngoài khung vừa màn hình. Trên bản vẽ as-built
     thật là 5 block bị đặt lạc cách bản vẽ hàng triệu đơn vị — xem
     `countOutsideBounds`. Không nói ra thì thanh trạng thái ghi "224/224 đang
     hiện" trong khi 5 cái nằm ngoài màn hình. */
  const outside = useMemo(
    () => countOutsideBounds(visible, payload?.bounds?.[activeSpace], blocks, hidden),
    [visible, payload, activeSpace, blocks, hidden],
  );

  const fitEverything = useCallback(() => {
    setBox(fitViewBox(unionExtent(visible, blocks, hidden) ?? undefined));
  }, [visible, blocks, hidden]);

  const warnings = payload?.warnings ?? [];
  /* Thao tác chọn đang chờ xác nhận. Đường DUY NHẤT từ màn hình này chạm tới
     AutoCAD, và nó vẫn đi qua hai pha như mọi thứ khác. */
  /* Giữ CẢ đối tượng đã chuẩn bị, không chỉ thao tác. Canvas vẫn bấm được trong
     lúc chờ máy chủ trả lời, nên `selectedEntity` có thể đã đổi sang thứ khác —
     hoặc về rỗng — khi thẻ xác nhận hiện ra. Đọc nó lúc đó là mô tả một đối
     tượng KHÁC với đối tượng sắp bị chọn, ngay trong hộp thoại tồn tại để người
     dùng kiểm lại. */
  const [pendingSelect, setPendingSelect] =
    useState<{ op: StagedOp; entity: GeomEntity } | null>(null);
  const [selectBusy, setSelectBusy] = useState(false);
  const [selectError, setSelectError] = useState("");

  const startSelect = useCallback(async () => {
    if (!selectedEntity) return;
    setSelectBusy(true);
    setSelectError("");
    try {
      const op = await prepareSelectHandles(DAEMON_BASE, {
        target: operationTarget(payload),
        handles: [selectedEntity.h],
        /* Guard lấy từ CHÍNH `payload` đã sinh ra handle này — xem
           `catalogGuardOf`. */
        guard: catalogGuardOf(payload),
      });
      setPendingSelect({ op, entity: selectedEntity });
    } catch (failure) {
      /* Ảnh chụp cũ thì máy chủ TỪ CHỐI (`document_stale`/`drawing_stale`) chứ
         không chọn nhầm — nói thêm cách gỡ, vì bản thân mã lỗi không nói. */
      const text = stagedErrorText(failure);
      setSelectError(isStale(failure) ? `${text} Bấm "Đọc lại" rồi chọn lại.` : text);
    } finally {
      setSelectBusy(false);
    }
  }, [selectedEntity, payload]);

  const confirmSelect = useCallback(async () => {
    if (!pendingSelect) return;
    setSelectBusy(true);
    try {
      await applyStagedOp(DAEMON_BASE, pendingSelect.op);
      setPendingSelect(null);
    } catch (failure) {
      setSelectError(stagedErrorText(failure));
      /* Apply là ONE-SHOT: hỏng thì id đó chết hẳn, phải chuẩn bị lại. Giữ thẻ
         xác nhận trên màn hình sẽ mời người dùng bấm lại một id đã hỏng. */
      setPendingSelect(null);
    } finally {
      setSelectBusy(false);
    }
  }, [pendingSelect]);

  const truncated = !!payload?.truncated;
  const scanCapped = warnings.includes("geometry_scan_cap_reached");
  /* Nội dung block bị cắt KHÔNG bật `truncated` ở cấp trên cùng — plugin chỉ
     phát cảnh báo. Không đọc hai mã này thì một bản vẽ lớn hiện ra như đã vẽ đủ,
     trong khi cả mảng hình bên trong block bị thiếu, và mỗi định nghĩa còn sót
     một phần vẫn được xếp là "hình thật". */
  const blocksCut = warnings.includes("block_geometry_truncated");
  const blocksDeep = warnings.includes("block_nesting_too_deep");

  return (
    <AppShell
      screen="workspace"
      title="Khung bản vẽ"
      sub={
        payload?.document?.title ? (
          <>
            <span className="mono">{payload.document.title}</span>
            {payload.counts?.emitted != null ? ` · ${payload.counts.emitted} đối tượng` : ""}
            {payload.collectedAt ? ` · đọc lúc ${collectedAtLabel(payload.collectedAt)}` : ""}
          </>
        ) : geometry.loading ? (
          "Đang đọc hình học từ AutoCAD…"
        ) : (
          "Chưa đọc được bản vẽ nào."
        )
      }
      actions={
        <>
          {payload ? <Tag>ảnh chụp một thời điểm</Tag> : null}
          <Button onClick={geometry.reload} disabled={geometry.refreshing}>
            {geometry.refreshing ? "Đang đọc…" : "Đọc lại"}
          </Button>
        </>
      }
    >
      {/* `AppShell` bọc children trong `.scroll`, mà `.workspace` cần CHIẾM HẾT
          chiều cao còn lại chứ không co theo nội dung — canvas không có chiều
          cao tự nhiên. Một cột flex cao 100% đưa lại đúng hành vi đó mà không
          phải sửa shell cho riêng một màn hình. */}
      <div style={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      {geometry.error ? (
        <div className="banner" data-tone="hard">
          <span className="bm" />
          <span className="bt">
            <b>Không đọc được hình học.</b> {geometry.error}
            {payload ? " Khung xem dưới đây vẫn là lượt đọc trước đó." : ""}
          </span>
        </div>
      ) : null}

      {truncated || scanCapped || blocksCut || blocksDeep ? (
        <div className="banner" data-tone="hard">
          <span className="bm" />
          <span className="bt">
            {truncated ? (
              <>
                <b>Bản vẽ chưa được vẽ hết.</b> Đợt đọc này dừng ở{" "}
                {payload?.counts?.emitted ?? "?"} đối tượng vì chạm trần xuất. Những gì
                thiếu không hiện ra ở đâu cả — đừng dùng khung xem này để kết luận bản
                vẽ có gì hay không có gì.{" "}
              </>
            ) : null}
            {scanCapped ? (
              <><b>Còn phần bản vẽ chưa được nhìn tới.</b> Lượt quét dừng trước khi đi
              hết bản vẽ. Lọc theo layer để thu hẹp phạm vi.{" "}</>
            ) : null}
            {blocksCut ? (
              <><b>Nội dung block chưa được xuất hết.</b> Những block bị cắt vẫn vẽ ra
              một phần, nên trông như đã đủ. Đừng đọc kích thước hay đếm thiết bị từ
              khung xem này.{" "}</>
            ) : null}
            {blocksDeep ? (
              <><b>Có block lồng sâu quá 8 lớp.</b> Phần sâu hơn không được xuất và
              không hiện ra ở đâu cả.</>
            ) : null}
          </span>
        </div>
      ) : null}

      {/* Thanh không gian thay cho dải phiên bản của bộ mẫu. */}
      {spaces.length > 0 ? (
        <div className="revstrip">
          <span className="rlabel">Không gian</span>
          <div className="track" role="group" aria-label="Chọn không gian" style={{ gap: "var(--s2)" }}>
            {spaces.map((name) => (
              <button
                key={name}
                className="btn btn--quiet"
                aria-pressed={name === activeSpace}
                data-active={name === activeSpace}
                style={name === activeSpace ? { color: "var(--accent)", background: "var(--acc-08)" } : undefined}
                onClick={() => switchSpace(name)}
              >
                {name === "Model" ? "Model" : `Layout ${name}`}
                <span className="mono" style={{ marginLeft: 6, opacity: 0.6, fontSize: 11 }}>
                  {payload?.spaces?.[name]}
                </span>
              </button>
            ))}
          </div>
          <span className="rlabel">
            {fidelity.exact} hình thật · {fidelity.reduced} thiếu · {fidelity.placeholder} chưa có hình
          </span>
        </div>
      ) : null}

      <section className="workspace">
        <LayerPane
          layers={layers}
          hidden={hidden}
          onToggle={(name) => setHidden((prev) => {
            const next = new Set(prev);
            if (next.has(name)) next.delete(name); else next.add(name);
            return next;
          })}
          onShowAll={() => setHidden(new Set())}
          onIsolate={isolate}
        />

        <div className={`canvaswrap${panMode ? " panning" : ""}`}>
          <div className="viewtools" role="toolbar" aria-label="Công cụ xem">
            <button
              aria-pressed={panMode}
              onClick={() => setPanMode((on) => !on)}
              title="Kéo màn hình (nút giữa chuột luôn kéo được)"
            >
              <Icon name="hand" />
            </button>
            <button onClick={() => setBox(zoomViewBox(view, view.x + view.w / 2, view.y + view.h / 2, 1.25, home))} title="Phóng to">
              <Icon name="zoomin" />
            </button>
            <button onClick={() => setBox(zoomViewBox(view, view.x + view.w / 2, view.y + view.h / 2, 1 / 1.25, home))} title="Thu nhỏ">
              <Icon name="zoomout" />
            </button>
            <button onClick={() => setBox(null)} title="Vừa màn hình">
              <Icon name="fit" />
            </button>
          </div>

          <div className="viewbadge mono">{zoomPercent(view, home)}%</div>

          {inSpace.length > 0 ? (
            <PlanCanvas
              entities={visible}
              blocks={blocks}
              hidden={hidden}
              box={view}
              home={home}
              selected={selected}
              panMode={panMode}
              onSelect={setSelected}
              onBoxChange={setBox}
              onHover={setCursor}
            />
          ) : (
            <div className="empty" style={{ height: "100%", display: "grid", placeContent: "center", textAlign: "center" }}>
              <strong>{geometry.loading ? "Đang đọc hình học…" : "Không có gì để vẽ"}</strong>
              <span>
                {geometry.loading
                  ? "Đây là một lượt quét trên main thread của AutoCAD."
                  : "Mở một bản vẽ trong AutoCAD rồi bấm Đọc lại."}
              </span>
            </div>
          )}

          <div className="cmdlog mono">
            <span>
              {cursor
                ? `X ${cursor.x.toFixed(2)}  Y ${cursor.y.toFixed(2)}`
                : `${visible.length}/${inSpace.length} đối tượng trong bộ lọc layer`}
            </span>
            {outside > 0 ? (
              <span>
                {" · "}{outside} nằm ngoài khung{" "}
                <button
                  className="btn btn--quiet"
                  style={{ height: 20, padding: "0 6px", fontSize: 11 }}
                  onClick={fitEverything}
                >
                  Thu hết
                </button>
              </span>
            ) : null}
          </div>
        </div>

        <Inspector
          entity={selectedEntity}
          blocks={blocks}
          selectBusy={selectBusy}
          selectBlocked={selectBlockedReason(selectedEntity, payload)}
          selectError={selectError}
          onSelectInAcad={() => void startSelect()}
          onIsolateLayer={isolate}
          onZoomTo={zoomTo}
          onClear={() => setSelected("")}
        />
      </section>

      {pendingSelect ? (
        <ConfirmSheet
          title="Chọn đối tượng trong AutoCAD"
          mode="selection"
          target={pendingSelect.op.target}
          summary={`Đổi bộ chọn của AutoCAD sang ${pendingSelect.op.count ?? 1} đối tượng.`}
          confirmLabel="Xác nhận & chọn"
          busy={selectBusy}
          onConfirm={() => void confirmSelect()}
          onCancel={() => {
            /* `busy` chỉ khoá hai nút ở chân hộp thoại; phím Esc và cú bấm ra
               nền vẫn gọi được vào đây. Bỏ qua trong lúc đang ghi, nếu không
               lệnh bỏ chạy song song với lệnh xác nhận — bỏ mà thắng thì lượt
               chọn người dùng VỪA xác nhận hỏng với `operation_not_pending`. */
            if (selectBusy) return;
            void rejectStagedOp(DAEMON_BASE, pendingSelect.op);
            setPendingSelect(null);
          }}
        >
          <dl className="props">
            <dt>Handle</dt><dd>{pendingSelect.entity.h}</dd>
            <dt>Kiểu</dt><dd>{pendingSelect.entity.t}</dd>
            <dt>Layer</dt><dd>{pendingSelect.entity.l}</dd>
            <dt>Không gian</dt><dd>{pendingSelect.entity.sp}</dd>
          </dl>
        </ConfirmSheet>
      ) : null}
      </div>
    </AppShell>
  );
}

/** Một điểm đại diện để phóng tới. Mỗi loại hình giữ toạ độ ở một trường khác
 * nhau — không có điểm chung nào để lấy. */
function pointOf(entity: GeomEntity): { x: number; y: number } | null {
  if (entity.c && entity.c.length >= 2) return { x: entity.c[0], y: entity.c[1] };
  if (entity.b && entity.b.length >= 4) {
    return { x: (entity.b[0] + entity.b[2]) / 2, y: (entity.b[1] + entity.b[3]) / 2 };
  }
  if (entity.p && entity.p.length >= 2) return { x: entity.p[0], y: entity.p[1] };
  return null;
}

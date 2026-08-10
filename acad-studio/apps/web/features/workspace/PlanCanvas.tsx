"use client";

/** Vẽ hình học bản vẽ ra SVG.
 *
 * ## Ba quy ước dễ sai nhất
 *
 * **Trục Y.** AutoCAD tính Y hướng lên, SVG tính Y hướng xuống. Cả cảnh nằm
 * trong một `scale(1,-1)`, nên toạ độ đỉnh giữ nguyên số của bản vẽ — không
 * phải đổi dấu ở từng đối tượng. Đổi lại, mọi thứ CÓ HƯỚNG bên trong cảnh (chữ,
 * góc xoay) phải tự lật ngược lại, nếu không chữ sẽ hiện ngược như soi gương.
 *
 * **Đơn vị góc.** Plugin trả `rotation()` của AutoCAD, tức **radian**; SVG
 * `rotate()` nhận **độ**. Truyền thẳng thì nhãn xoay 90° chỉ nghiêng 1,57° — sai
 * mà vẫn trông như "chữ hơi lệch". Mọi chỗ dùng góc đều đi qua `degrees()`.
 *
 * **Nét vẽ.** Đơn vị của cảnh là đơn vị bản vẽ — trên bản vẽ as-built này là
 * hàng chục nghìn. `stroke-width: 1` sẽ mảnh tới mức vô hình, còn đặt theo tỉ lệ
 * khung thì mỗi lần thu phóng lại phải tính lại. `vector-effect:
 * non-scaling-stroke` giải quyết cả hai.
 *
 * ## Vì sao dùng `<defs>` + `<use>`
 *
 * Bung thẳng nội dung block ra tại mỗi lần chèn cho **~38.000 node SVG** trên
 * bản vẽ as-built — đủ để treo cả tab, đã thử. Định nghĩa block dựng MỘT lần
 * trong `<defs>`, mỗi lần chèn là một `<use>`.
 *
 * Bên trong mỗi định nghĩa còn **gộp nét**: hình bên trong block không chọn
 * riêng được, nên 150 đoạn thẳng cùng kiểu nét gộp thành một `<path>` duy nhất.
 * Chỉ chữ và dấu chỗ đứng phải giữ phần tử riêng. Hai bước cộng lại đưa bản vẽ
 * as-built từ 38.000 node xuống vài trăm.
 *
 * `<use>` còn cho đúng hành vi chọn: nội dung của nó nằm trong shadow tree nên
 * `event.target` luôn là chính `<use>`, tức là **lần chèn** — bấm vào đâu trong
 * block cũng chọn block, đúng như AutoCAD. Hình bên trong định nghĩa không phải
 * đối tượng chọn được: handle của nó dùng chung cho cả 50 lần chèn.
 *
 * Khoá của `<defs>` là **tên block + layer của lần chèn**, không phải mỗi tên
 * block: đối tượng trên layer `0` bên trong block kế thừa layer của lần chèn
 * (quy tắc của AutoCAD), nên cùng một block chèn trên hai layer khác nhau có thể
 * bị bộ lọc layer ẩn khác nhau.
 *
 * ## Màu nói lên độ trung thực, không nói lên layer
 *
 * Bộ mẫu tô màu theo layer. Ở đây màu dành cho việc quan trọng hơn: **hình này
 * có thật không**. Kể cả sau khi bung nội dung block, Model của bản vẽ as-built
 * vẫn còn 35 hình thiếu và 54 chỗ chưa có hình. Vẽ tất cả cùng một màu trắng là
 * mời người dùng đọc kích thước từ một cái hình bao. Layer đã có bảng riêng bên
 * trái và có trong inspector.
 */
import {
  useCallback, useMemo, useRef,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import {
  MAX_BLOCK_DEPTH,
  arcPath,
  clientToViewBox,
  degrees,
  effectiveLayer,
  fidelityOf,
  pathDataOf,
  polylinePath,
  viewBoxToString,
  zoomViewBox,
  type BlockDefs,
  type Fidelity,
  type GeomEntity,
  type ViewBox,
} from "./model";

/** Nét theo độ trung thực. Nét đứt = "đây không phải hình của đối tượng". */
const STROKE: Record<Fidelity, { color: string; dash?: string }> = {
  exact: { color: "#ffffff" },
  reduced: { color: "#2997ff" },
  placeholder: { color: "#8c8c8c", dash: "6 6" },
};

export function PlanCanvas({
  entities, blocks, hidden, box, home, selected, panMode, onSelect, onBoxChange, onHover,
}: {
  entities: readonly GeomEntity[];
  /** Nội dung định nghĩa block. Thiếu nó thì mỗi lần chèn chỉ ra một cái dấu —
   * trên bản vẽ thật đó là mất 10.122/10.380 hình. */
  blocks: BlockDefs;
  /** Layer bị tắt trong khung xem. Phải áp dụng cả BÊN TRONG định nghĩa block,
   * nếu không thì tắt một layer chỉ ẩn được phần ở cấp trên cùng. */
  hidden: ReadonlySet<string>;
  box: ViewBox;
  /** Khung vừa khít — mốc để giới hạn thu phóng. */
  home: ViewBox;
  selected: string;
  panMode: boolean;
  onSelect: (handle: string) => void;
  onBoxChange: (box: ViewBox) => void;
  /** Toạ độ con trỏ theo hệ BẢN VẼ (Y đã trả về hướng lên). */
  onHover: (point: { x: number; y: number } | null) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);

  /* Dấu cho điểm và cho block KHÔNG có định nghĩa. Lấy theo khung vừa khít chứ
     không theo khung hiện tại: phụ thuộc khung hiện tại là mỗi lần lăn chuột lại
     dựng lại toàn bộ cảnh. */
  const marker = home.w / 160;

  const toBox = useCallback(
    (clientX: number, clientY: number) => {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return null;
      return clientToViewBox(box, rect, clientX, clientY);
    },
    [box],
  );

  const onWheel = useCallback(
    (event: React.WheelEvent<SVGSVGElement>) => {
      const point = toBox(event.clientX, event.clientY);
      if (!point) return;
      onBoxChange(zoomViewBox(box, point.x, point.y, event.deltaY < 0 ? 1.12 : 1 / 1.12, home));
    },
    [box, home, onBoxChange, toBox],
  );

  const onPointerDown = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      /* Nút giữa kéo màn hình kể cả khi không bật chế độ kéo — thói quen từ
         chính AutoCAD. */
      if (!panMode && event.button !== 1) return;
      const point = toBox(event.clientX, event.clientY);
      if (!point) return;
      drag.current = point;
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [panMode, toBox],
  );

  const onPointerMove = useCallback(
    (event: ReactPointerEvent<SVGSVGElement>) => {
      const point = toBox(event.clientX, event.clientY);
      if (!point) return;
      onHover({ x: point.x, y: -point.y });
      if (!drag.current) return;
      /* Dời khung ngược chiều con trỏ. Tính từ điểm bắt đầu trong hệ khung CŨ:
         cập nhật `drag.current` theo điểm mới sẽ cộng dồn sai số của chính phép
         dời vừa rồi, và bản vẽ trôi khỏi tay. */
      onBoxChange({ ...box, x: box.x - (point.x - drag.current.x), y: box.y - (point.y - drag.current.y) });
    },
    [box, onBoxChange, onHover, toBox],
  );

  const endDrag = useCallback((event: ReactPointerEvent<SVGSVGElement>) => {
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  /* Cảnh chỉ phụ thuộc DỮ LIỆU, không phụ thuộc khung nhìn: thu phóng và kéo chỉ
     đổi thuộc tính `viewBox`. */
  const scene = useMemo(
    () => buildScene(entities, blocks, hidden, marker),
    [entities, blocks, hidden, marker],
  );

  /* Tô đối tượng đang chọn bằng MỘT quy tắc CSS thay vì truyền `selected` xuống
     từng hình: đổi lựa chọn chỉ dựng lại thẻ <style>, không phải cả cảnh. Handle
     của AutoCAD là chuỗi hex; kiểm lại trước khi nhúng vào CSS, vì một giá trị
     lạ có thể đóng chuỗi rồi chèn thêm quy tắc. */
  const selectorSafe = /^[0-9A-Fa-f]+$/.test(selected) ? selected : "";

  return (
    <svg
      ref={svgRef}
      className="plan"
      viewBox={viewBoxToString(box)}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label="Khung xem hình học bản vẽ. Nhấp vào một đối tượng để đọc thuộc tính."
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={() => onHover(null)}
      onClick={(event) => {
        if (panMode) return;
        const node = (event.target as Element).closest?.("[data-entity]");
        onSelect(node?.getAttribute("data-entity") ?? "");
      }}
    >
      {selectorSafe ? (
        <style>
          {`.plan [data-entity="${selectorSafe}"],.plan [data-entity="${selectorSafe}"] *` +
           `{stroke:var(--accent-2);stroke-width:3}`}
        </style>
      ) : null}
      <defs>{scene.defs}</defs>
      {/* Lật trục Y một lần cho cả cảnh. */}
      <g transform="scale(1,-1)">{scene.body}</g>
    </svg>
  );
}

/* ------------------------------------------------------------------ *
 * Dựng cảnh
 * ------------------------------------------------------------------ */

/** Phép biến đổi của một lần chèn.
 *
 * `m` là ma trận của chính AutoCAD (`blockTransform`), đã gồm điểm chèn, điểm
 * gốc block, tỉ lệ âm và trục không vuông góc. Thiếu nó thì lùi về dịch chuyển
 * thuần: sai vị trí còn dễ nhận ra hơn sai tỉ lệ. */
function transformOf(entity: GeomEntity): string {
  const m = entity.m;
  return m && m.length === 6
    ? `matrix(${m[0]} ${m[1]}, ${m[2]} ${m[3]}, ${m[4]} ${m[5]})`
    : `translate(${entity.p?.[0] ?? 0} ${entity.p?.[1] ?? 0})`;
}

function buildScene(
  entities: readonly GeomEntity[],
  blocks: BlockDefs,
  hidden: ReadonlySet<string>,
  marker: number,
): { defs: ReactNode[]; body: ReactNode[] } {
  const defs: ReactNode[] = [];
  /* Khoá là tên block + layer thừa kế — xem chú thích đầu tệp về layer `0`.
     Giá trị rỗng nghĩa là "đã dựng thử, không ra hình nào". */
  const ids = new Map<string, string>();
  /* Đang dựng dở — chặn vòng lặp block A→B→A. Trần độ sâu không đủ: một vòng
     lặp ngắn vẫn nở ra 8 lớp trước khi dừng. */
  const building = new Set<string>();

  /** Dựng (hoặc lấy lại) định nghĩa block, trả id — hoặc `null` nếu không vẽ ra
   * được gì (rỗng, bị bộ lọc layer ẩn hết, lồng quá sâu, hoặc thành vòng). */
  function ensureDef(name: string, parentLayer: string, depth: number): string | null {
    const key = `${name} ${parentLayer}`;
    const known = ids.get(key);
    if (known !== undefined) return known || null;
    if (building.has(key) || depth >= MAX_BLOCK_DEPTH) return null;

    const def = blocks[name];
    if (!def || !def.length) return null;

    building.add(key);
    /* Gom `d` của mọi hình gộp được theo độ trung thực — nét khác nhau thì không
       gộp chung được, và độ trung thực là thứ quyết định nét. */
    const merged = new Map<Fidelity, string[]>();
    const children: ReactNode[] = [];
    for (const child of def) {
      const layer = effectiveLayer(child, parentLayer);
      if (hidden.has(layer)) continue;
      const nestedDef = child.k === "insert" && child.name
        ? ensureDef(child.name, layer, depth + 1)
        : null;
      if (nestedDef) {
        children.push(<use key={child.h} href={`#${nestedDef}`} transform={transformOf(child)} />);
        continue;
      }
      const d = pathDataOf(child, marker);
      if (d) {
        const fidelity = fidelityOf(child, blocks);
        const list = merged.get(fidelity);
        if (list) list.push(d); else merged.set(fidelity, [d]);
        continue;
      }
      const node = shapeOf(child, layer, depth + 1, false);
      if (node) children.push(node);
    }
    for (const [fidelity, list] of merged) {
      const style = STROKE[fidelity];
      children.push(
        <path
          key={`m${fidelity}`}
          data-fidelity={fidelity}
          d={list.join("")}
          stroke={style.color}
          strokeDasharray={style.dash}
          strokeWidth={1.4}
          strokeLinejoin="round"
          fill="none"
          vectorEffect="non-scaling-stroke"
        />,
      );
    }
    building.delete(key);

    if (!children.length) {
      ids.set(key, "");
      return null;
    }
    /* Id là số thứ tự, không phải tên block: tên của AutoCAD chứa `$`, khoảng
       trắng và dấu tiếng Việt, nhét thẳng vào `href="#…"` là selector hỏng. */
    const id = `blk${defs.length}`;
    defs.push(<g key={id} id={id}>{children}</g>);
    ids.set(key, id);
    return id;
  }

  /** Một hình. `top` = đối tượng ở cấp trên cùng, tức là thứ chọn được. */
  function shapeOf(
    entity: GeomEntity,
    layer: string,
    depth: number,
    top: boolean,
  ): ReactNode | null {
    if (hidden.has(layer)) return null;

    if (entity.k === "insert") {
      const def = entity.name ? blocks[entity.name] : undefined;
      const id = entity.name ? ensureDef(entity.name, layer, depth) : null;
      if (id) {
        return (
          <use
            key={entity.h}
            href={`#${id}`}
            transform={transformOf(entity)}
            {...(top ? { "data-entity": entity.h } : {})}
          />
        );
      }
      if (def && def.length && depth < MAX_BLOCK_DEPTH) {
        /* Có định nghĩa mà không dựng ra node nào nghĩa là bộ lọc layer đã ẩn
           sạch nội dung. Rơi xuống dấu chỗ đứng ở đây là để lại một cái dấu đặc
           cho MỖI lần chèn — tắt một layer bên trong block xong màn hình đầy
           dấu, trong khi lẽ ra phải trống. */
        return null;
      }
    }
    return <Shape key={entity.h} entity={entity} blocks={blocks} marker={marker} top={top} />;
  }

  const body = entities
    .map((entity) => shapeOf(entity, entity.l, 0, true))
    .filter((node): node is ReactNode => node !== null);

  return { defs, body };
}

function Shape({
  entity, blocks, marker, top,
}: {
  entity: GeomEntity;
  blocks: BlockDefs;
  marker: number;
  top: boolean;
}) {
  const fidelity = fidelityOf(entity, blocks);
  const style = STROKE[fidelity];
  /* `data-entity` chỉ gắn ở cấp TRÊN CÙNG — xem chú thích đầu tệp. */
  const common = {
    ...(top ? { "data-entity": entity.h } : {}),
    "data-fidelity": fidelity,
    stroke: style.color,
    strokeDasharray: style.dash,
    strokeWidth: 1.4,
    fill: "none",
    vectorEffect: "non-scaling-stroke" as const,
  };

  switch (entity.k) {
    case "line": {
      const p = entity.p ?? [];
      if (p.length < 4) return null;
      return <line {...common} x1={p[0]} y1={p[1]} x2={p[2]} y2={p[3]} />;
    }
    case "poly": {
      const d = polylinePath(entity.p ?? [], entity.bulge, !!entity.closed);
      return d ? <path {...common} d={d} strokeLinejoin="round" /> : null;
    }
    case "circle": {
      const c = entity.c ?? [];
      if (c.length < 2 || !entity.r) return null;
      return <circle {...common} cx={c[0]} cy={c[1]} r={entity.r} />;
    }
    case "arc": {
      const c = entity.c ?? [];
      if (c.length < 2 || !entity.r) return null;
      return <path {...common} d={arcPath(c[0], c[1], entity.r, entity.a0 ?? 0, entity.a1 ?? 0)} />;
    }
    case "ellipse": {
      const d = pathDataOf(entity, marker);
      return d ? <path {...common} d={d} /> : null;
    }
    case "box": {
      const b = entity.b ?? [];
      if (b.length < 4) return null;
      /* `b` là [minX,minY,maxX,maxY]; `<rect>` cần góc + kích thước. */
      return <rect {...common} x={b[0]} y={b[1]} width={Math.abs(b[2] - b[0])} height={Math.abs(b[3] - b[1])} />;
    }
    case "point": {
      const p = entity.p ?? [];
      if (p.length < 2) return null;
      return <circle {...common} cx={p[0]} cy={p[1]} r={marker / 3} />;
    }
    case "insert": {
      /* Tới được đây nghĩa là không có định nghĩa nào vẽ được: block rỗng, lượt
         xuất chạm trần, hoặc lồng quá sâu. Dấu chữ thập trong ô vuông, cố tình
         KHÔNG giống một hình vẽ thật. */
      const p = entity.p ?? [];
      if (p.length < 2) return null;
      const size = marker;
      return (
        <g {...common} transform={`translate(${p[0]} ${p[1]})`}>
          <rect x={-size / 2} y={-size / 2} width={size} height={size} />
          <path d={`M${-size / 2} 0H${size / 2}M0 ${-size / 2}V${size / 2}`} />
        </g>
      );
    }
    case "multi": {
      /* HATCH và hình bắt qua `worldDraw`: nhiều hình con nhưng vẫn là MỘT đối
         tượng chọn được. Nét gộp hết vào một `d`; chữ phải giữ phần tử riêng —
         `<path>` không mang được glyph. */
      const strokes = pathDataOf(entity, marker);
      const labels = (entity.g ?? []).filter((child) => child.k === "text");
      if (!strokes && !labels.length) return null;
      return (
        <g {...(top ? { "data-entity": entity.h } : {})} data-fidelity={fidelity}>
          {strokes ? (
            <path
              d={strokes}
              stroke={style.color}
              strokeDasharray={style.dash}
              strokeWidth={1.4}
              strokeLinejoin="round"
              fill="none"
              vectorEffect="non-scaling-stroke"
            />
          ) : null}
          {/* Chữ phải THỪA HƯỞNG độ trung thực của cụm cha: nó đến từ cùng một
              lượt bắt gần đúng. Không truyền xuống thì nhãn hiện màu "hình
              thật" ngay cạnh những nét cùng nguồn đang là "hình thiếu" — người
              dùng đọc ra là chữ đáng tin hơn hình, mà không phải. */}
          {labels.map((child, index) => (
            <Shape
              key={`${entity.h}t${index}`}
              entity={{ ...child, h: `${entity.h}t${index}`, a: entity.a, aw: entity.aw }}
              blocks={blocks}
              marker={marker}
              top={false}
            />
          ))}
        </g>
      );
    }
    case "text": {
      const p = entity.p ?? [];
      if (p.length < 2) return null;
      const size = entity.th && entity.th > 0 ? entity.th : marker;
      /* Lật lại lần nữa để chữ không soi gương: `scale(1,-1)` ở đây triệt tiêu
         `scale(1,-1)` của cảnh, nên phép biến đổi tổng lại thành một phép dời
         thuần. Góc đổi dấu vì trên màn hình trục Y hướng xuống, và đổi từ radian
         sang độ vì SVG không nhận radian. */
      return (
        <g
          {...(top ? { "data-entity": entity.h } : {})}
          data-fidelity={fidelity}
          transform={
            `translate(${p[0]} ${p[1]}) scale(1,-1) rotate(${-degrees(entity.rot)})` +
            /* Bề ngang co giãn riêng: `scale(xs,1)` SAU khi xoay, vì hệ số này
               đo dọc theo hướng đọc của chữ chứ không dọc theo trục X. */
            (entity.xs && entity.xs > 0 && entity.xs !== 1 ? ` scale(${entity.xs},1)` : "")
          }
        >
          <text
            fill={style.color}
            stroke="none"
            fontSize={size}
            fontFamily="var(--mono)"
            /* Điểm chèn của AutoCAD nằm ở ĐƯỜNG CHÂN chữ, đúng mặc định của
               SVG — không đặt `dominant-baseline`. */
          >
            {entity.txt}
          </text>
        </g>
      );
    }
    default:
      return null;
  }
}

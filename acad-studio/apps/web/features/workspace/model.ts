/** Đọc hiểu phản hồi của `GET /api/acad/geometry`.
 *
 * Thuần tính toán, không React, không fetch — để test được mà không cần AutoCAD.
 *
 * ## Điều quan trọng nhất ở tệp này
 *
 * Danh sách `entities` **không phải là bản vẽ**. Trên bản vẽ as-built của dự án,
 * cấp trên cùng chỉ có 258 đối tượng, trong đó 127 là lần chèn block — còn toàn
 * bộ mặt bằng (tường, cửa, trục, khung tên, hatch) nằm trong `blocks`, tức
 * **10.122 đối tượng** thuộc 147 định nghĩa. Bỏ `blocks` đi là mất 97% bản vẽ và
 * vẽ ra vài cái dấu.
 *
 * Kể cả khi đã bung block, vẫn còn hình không thật:
 *
 *  - **hình bao** (`aw:"bounding-box"`) — DIMENSION, HATCH, MULTILEADER, VIEWPORT.
 *  - **tim ống** (`aw:"mline-centerline"`) — MLINE mất hai đường thành.
 *  - **INSERT không có định nghĩa** — block rỗng, hoặc lượt xuất chạm trần.
 *
 * `fidelityOf()` và `countFidelity()` tồn tại để màn hình nói ra tỉ lệ đó, thay
 * vì vẽ tất cả cùng một màu rồi để người dùng tin mọi nét đều là hình thật —
 * đúng cái bẫy `PreconstructionPanel` mà ROADMAP cảnh báo.
 *
 * ⚠️ Hai chỗ dễ đọc sai:
 *  - INSERT **không** mang `a:1`. Cờ đó chỉ nói "hình bị chiếu sai", không nói
 *    "hình chưa được xuất".
 *  - INSERT có vẽ được hay không phụ thuộc `blocks`, nên `fidelityOf()` phải
 *    nhận `blocks`; gọi thiếu là mọi block bị tính là chưa có hình.
 */

/** Một đối tượng trong phản hồi. Tên trường ngắn vì payload đi qua tệp trung
 * gian và một bản vẽ lớn có hàng vạn dòng như thế này. */
export type GeomEntity = {
  /** Handle AutoCAD. Duy nhất trong bản vẽ — dùng làm khoá React và làm cầu
   * nối sang mọi API khác. */
  h: string;
  /** Tên kiểu của AutoCAD: `LWPOLYLINE`, `INSERT`, `MULTILEADER`… */
  t: string;
  /** Layer. */
  l: string;
  /** Không gian: `Model` hoặc tên layout. */
  sp: string;
  /** Hình được vẽ ra thuộc dạng nào. `multi` = nhiều hình con trong `g`, dùng
   * cho HATCH (nhiều vòng biên + hàng nghìn đoạn gạch nhưng vẫn là MỘT đối
   * tượng chọn được). */
  k: "line" | "poly" | "circle" | "arc" | "ellipse" | "point" | "insert" | "text" | "mtext"
   | "box" | "multi";
  /** `1` khi hình bị phép chiếu xuống XY làm sai. Xem `aw` để biết vì sao. */
  a?: number;
  /** Vì sao hình không thật: `bounding-box`, `mline-centerline`,
   * `projected-bulge`. */
  aw?: string;
  /** Toạ độ phẳng, [x0,y0,x1,y1,…]. `line`/`poly`/`point`/`insert`/`text`. */
  p?: number[];
  /** Tâm — `circle`/`arc`. */
  c?: number[];
  /** Bán kính — `circle`/`arc`. */
  r?: number;
  /** Bán trục lớn/nhỏ — `ellipse`. */
  rx?: number;
  ry?: number;
  /** Góc đầu/cuối theo radian, ngược chiều kim đồng hồ — `arc`.
   * Với `ellipse` đây là **tham số**, không phải góc thật:
   * `P(t) = C + rx·cos(t)·u + ry·sin(t)·v`. Đem `atan2` ra để tính lại là sai
   * ở mọi elip không tròn. */
  a0?: number;
  a1?: number;
  /** Độ cong từng đoạn của polyline (`tan(θ/4)`). */
  bulge?: number[];
  /** Polyline có khép kín không. */
  closed?: boolean;
  /** Hình bao [minX,minY,maxX,maxY] — chỉ `box`. */
  b?: number[];
  /** Góc xoay, độ, ngược chiều kim đồng hồ — `text`/`insert`. */
  rot?: number;
  /** Chiều cao chữ theo đơn vị bản vẽ — `text`. */
  th?: number;
  /** Hệ số **bề ngang** của chữ. Vắng mặt nghĩa là 1. Chiều cao đi theo `th`,
   * còn bề rộng của glyph trong SVG đi theo font — lệch nhau thì một dòng chữ
   * nén còn 0,7 sẽ vẽ ra rộng hơn thực tế 40%, đúng thứ kỹ sư nhìn để đoán chữ
   * có vừa ô không. */
  xs?: number;
  /** Nội dung chữ — `text`. */
  txt?: string;
  /** Từng dòng của `mtext`. MTEXT mang mã điều khiển ngay trong nội dung
   * (`\P` xuống dòng, `{}` nhóm, `\H` đổi cỡ…); plugin đã bóc mã và tách dòng,
   * nên đây là chữ đọc được. */
  lines?: string[];
  /** Neo NGANG theo quy ước `text-anchor` của SVG. Vắng mặt là `start`.
   *
   * ⚠️ Đi kèm với điểm neo: khi căn lề khác trái, `p` là **điểm căn lề** chứ
   * không phải điểm chèn. Bỏ qua `ha` mà vẫn dùng `p` là vẽ dòng chữ lệch đi
   * đúng bằng chiều dài của nó. */
  ha?: "start" | "middle" | "end";
  /** Neo DỌC theo quy ước `dominant-baseline` của SVG. Vắng mặt là
   * `alphabetic` — điểm chèn của AutoCAD nằm ở đường chân chữ.
   *
   * Liệt kê đúng bốn giá trị plugin phát ra, không để `string`: một giá trị lạ
   * lọt xuống `dominant-baseline` thì trình duyệt bỏ qua cả thuộc tính, và chữ
   * lệch dọc mà không có lỗi nào báo. */
  va?: "alphabetic" | "central" | "text-before-edge" | "text-after-edge";
  /** Khoảng cách dòng, tính bằng **bội của chiều cao chữ** — `mtext`. */
  ls?: number;
  /** Tên block — `insert`. */
  name?: string;
  /** Hệ số tỉ lệ [x,y] — `insert`. */
  sc?: number[];
  /** Hình con của `multi`. Chỉ mang phần hình học, không mang handle/layer —
   * chúng thuộc về đối tượng cha. */
  g?: GeomEntity[];
  /** Affine 2D `[a,b,c,d,e,f]` đưa toạ độ trong định nghĩa block về toạ độ bản
   * vẽ: `x' = a·x + c·y + e`, `y' = b·x + d·y + f`. Lấy thẳng từ
   * `blockTransform()` của AutoCAD nên đã gồm điểm chèn, điểm gốc của block, tỉ
   * lệ âm (block bị lật) và trục không vuông góc. Dựng lại từ `rot`+`sc` sẽ sai
   * ở đúng những trường hợp đó. */
  m?: number[];
};

/** Nội dung các định nghĩa block, gửi **một lần** mỗi block dù được chèn bao
 * nhiêu lần. Toạ độ bên trong là toạ độ của block, chưa biến đổi — mỗi lần chèn
 * mang ma trận `m` riêng. */
export type BlockDefs = Record<string, GeomEntity[]>;

export type GeometryResponse = {
  ok?: boolean;
  document?: {
    title?: string;
    file?: string;
    revision?: number;
    /** Mã phiên của tài liệu trong AutoCAD. Cùng với `revision` tạo thành cặp
     * guard cho lệnh chọn theo handle. */
    instance?: string;
    /** Không gian **hiện hành** của AutoCAD — không phải không gian đang xem
     * trên màn hình. Lệnh chọn theo handle chỉ chạy được với đối tượng ở không
     * gian này. */
    space?: string;
  };
  /** Số đối tượng theo từng không gian. */
  spaces?: Record<string, number>;
  /** Danh sách layout, thứ tự do bản vẽ quyết định. */
  layouts?: string[];
  /** [minX,minY,maxX,maxY] theo TỪNG không gian — không phải một khung chung.
   * Toạ độ giấy tính bằng mm; model có thể ở toạ độ trắc địa cách gốc hàng
   * triệu đơn vị. Gộp lại cho ra một khung vô nghĩa. */
  bounds?: Record<string, number[]>;
  counts?: {
    scanned?: number; emitted?: number; approx?: number; skipped?: number;
    blockDefs?: number; blockEntities?: number;
  };
  /** Nội dung định nghĩa block. Trên bản vẽ as-built của dự án, đây là **10.122
   * đối tượng** so với 258 ở cấp trên cùng — tức là gần như toàn bộ bản vẽ. */
  blocks?: BlockDefs;
  entities?: GeomEntity[];
  /** Còn đối tượng khớp mà chưa gửi. */
  truncated?: boolean;
  warnings?: string[];
  filter?: { space?: string; layer?: string; maxEntities?: number };
  /** Giây Unix. */
  collectedAt?: number;
  projection?: string;
};

/* ------------------------------------------------------------------ *
 * Độ trung thực
 * ------------------------------------------------------------------ */

/** Hình vẽ ra so với đối tượng thật.
 *
 *  - `exact` — đúng hình.
 *  - `placeholder` — CHƯA CÓ hình: block mới có vị trí, DIMENSION/HATCH mới có
 *    hình bao. Vẽ ra là một chỗ đứng, không phải đối tượng.
 *  - `reduced` — có hình nhưng thiếu phần: tim ống thiếu hai thành, cung tròn
 *    bị chiếu phẳng thành đường thẳng.
 */
export type Fidelity = "exact" | "placeholder" | "reduced";

export function fidelityOf(entity: GeomEntity, blocks?: BlockDefs): Fidelity {
  if (entity.k === "insert") {
    /* Có định nghĩa thì khung xem vẽ ĐÚNG nội dung block, không còn là một dấu
       chỗ đứng. Không có định nghĩa — block rỗng, hoặc lượt xuất chạm trần —
       thì vẫn chỉ là một điểm. */
    const def = entity.name ? blocks?.[entity.name] : undefined;
    return def && def.length ? "exact" : "placeholder";
  }
  if (entity.k === "box") return "placeholder";
  /* `multi` là HATCH đã dựng hình thật — vòng biên và đường gạch. Chỉ khi bị cắt
     bớt hoặc bị chiếu nghiêng mới là hình thiếu, và lúc đó `aw` có mặt. */
  if (entity.aw) return "reduced";
  /* `a:1` mà không có `aw` — plugin bảo hình bị chiếu sai nhưng không nói phần
     nào. Vẫn là hình thiếu, không phải hình đúng. */
  return entity.a ? "reduced" : "exact";
}

export function countFidelity(
  entities: readonly GeomEntity[],
  blocks?: BlockDefs,
): Record<Fidelity, number> {
  const out: Record<Fidelity, number> = { exact: 0, placeholder: 0, reduced: 0 };
  for (const entity of entities) out[fidelityOf(entity, blocks)]++;
  return out;
}

/** Câu giải thích cho từng lý do hình không thật. Gom về một chỗ để canvas,
 * inspector và dải cảnh báo không mô tả cùng một thứ theo ba kiểu. */
export function fidelityNote(entity: GeomEntity, blocks?: BlockDefs): string {
  if (entity.k === "insert") {
    const def = entity.name ? blocks?.[entity.name] : undefined;
    if (def && def.length) return "";
    return "Chỉ có vị trí block — định nghĩa của nó không có đối tượng nào vẽ được.";
  }
  if (entity.aw === "bounding-box") return "Chỉ có hình bao, không phải hình thật.";
  if (entity.aw === "mline-centerline") return "Chỉ có tim ống, không có hai đường thành.";
  if (entity.aw === "projected-bulge") return "Đoạn cong bị chiếu phẳng thành đường thẳng.";
  if (entity.aw === "hatch-truncated") return "Vùng gạch quá dày, chỉ vẽ được một phần đường gạch.";
  if (entity.aw === "projected-hatch") return "Vùng gạch nằm trên mặt phẳng nghiêng, hình bị chiếu sai.";
  if (entity.aw === "curve-sampled") return "Đường cong được lấy mẫu 48 điểm, không phải đường cong thật.";
  if (entity.aw === "projected-ellipse") return "Elip nằm trên mặt phẳng nghiêng, hình bị chiếu sai.";
  if (entity.aw === "mtext-truncated") return "Ghi chú quá dài, chỉ hiện được phần đầu.";
  if (entity.aw === "mtext-not-wrapped") {
    return "AutoCAD không bung được ghi chú này thành từng đoạn; chỗ xuống dòng có thể khác bản vẽ.";
  }
  if (entity.aw === "text-span-not-fitted") {
    return "Chữ kiểu căn hai đầu: vị trí đúng, nhưng không kéo/nén cho vừa đoạn được.";
  }
  if (entity.aw === "viewport-clipped") {
    return "Khung nhìn bị cắt theo một hình không phải chữ nhật; đây là biên ngoài của nó.";
  }
  if (entity.aw === "worlddraw") {
    return "Hình do AutoCAD vẽ ra rồi bắt lại: đủ để nhìn, nhưng cung tròn đã thành đoạn thẳng nên đừng đo trên nó.";
  }
  if (entity.aw === "worlddraw-truncated") {
    return "Hình do AutoCAD vẽ ra, và quá nhiều nên chỉ bắt được một phần.";
  }
  if (entity.aw === "hatch-boundary-partial") {
    return "Vùng gạch có đường viền plugin chưa đọc được; chỉ vẽ các đường gạch bên trong.";
  }
  if (entity.a) return "Hình bị phép chiếu xuống mặt phẳng XY làm sai.";
  return "";
}

/* ------------------------------------------------------------------ *
 * Không gian
 * ------------------------------------------------------------------ */

/** Thứ tự hiện các không gian: Model trước, rồi layout theo thứ tự bản vẽ.
 *
 * Lấy từ `spaces` chứ không từ `layouts`: `layouts` liệt kê mọi layout kể cả
 * layout RỖNG, mà một tab không vẽ được gì thì chọn vào chỉ thấy màn hình
 * trắng. `layouts` chỉ dùng để xếp thứ tự.
 */
export function spaceOrder(payload: GeometryResponse): string[] {
  const counts = payload.spaces ?? {};
  const names = Object.keys(counts).filter((name) => counts[name] > 0);
  const layouts = payload.layouts ?? [];
  return names.sort((left, right) => {
    if (left === "Model") return -1;
    if (right === "Model") return 1;
    const li = layouts.indexOf(left);
    const ri = layouts.indexOf(right);
    if (li === ri) return left.localeCompare(right);
    /* Layout không có trong `layouts` xuống cuối, chứ không lên đầu — `-1` từ
       `indexOf` mà đem so trực tiếp sẽ đẩy nó lên trước mọi layout có thật. */
    return (li < 0 ? Number.MAX_SAFE_INTEGER : li) - (ri < 0 ? Number.MAX_SAFE_INTEGER : ri);
  });
}

/* ------------------------------------------------------------------ *
 * Khung nhìn
 * ------------------------------------------------------------------ */

/** Khung nhìn SVG. Toạ độ đã lật trục Y sẵn: AutoCAD tính Y hướng lên, SVG tính
 * Y hướng xuống, nên cảnh được bọc trong `scale(1,-1)` và khung nhìn phải nói
 * theo hệ ĐÃ lật. */
export type ViewBox = { x: number; y: number; w: number; h: number };

export function viewBoxToString(box: ViewBox): string {
  return `${box.x} ${box.y} ${box.w} ${box.h}`;
}

/** Khung vừa khít một không gian, nới thêm `padRatio` mỗi phía.
 *
 * `bounds` là **[minX, minY, maxX, maxY]**, không phải [x, y, rộng, cao] —
 * đọc nhầm là mọi thứ lệch đi hàng triệu đơn vị.
 *
 * Trả `null` khi không có khung hợp lệ. Bản vẽ chỉ có một điểm duy nhất cũng
 * cho ra khung rộng 0; nới ra một khung tối thiểu thay vì chia cho 0.
 */
export function fitViewBox(bounds: number[] | undefined, padRatio = 0.04): ViewBox | null {
  if (!bounds || bounds.length < 4) return null;
  const [minX, minY, maxX, maxY] = bounds;
  if (![minX, minY, maxX, maxY].every((value) => Number.isFinite(value))) return null;

  const rawW = maxX - minX;
  const rawH = maxY - minY;
  if (rawW < 0 || rawH < 0) return null;

  /* Khung dẹt hoặc một điểm: lấy chiều còn lại làm cỡ, hết cả hai thì lấy 1.
     Không có bước này thì `w` bằng 0 và mọi phép chia sau đó ra vô cực. */
  const fallback = Math.max(rawW, rawH) || 1;
  const w = rawW || fallback;
  const h = rawH || fallback;
  const padX = w * padRatio;
  const padY = h * padRatio;

  return {
    x: minX - padX + (rawW ? 0 : (rawW - w) / 2),
    /* Sau `scale(1,-1)`, điểm có Y lớn nhất nằm TRÊN cùng, nên góc trên-trái
       của khung là `-maxY`. */
    y: -maxY - padY + (rawH ? 0 : (rawH - h) / 2),
    w: w + padX * 2,
    h: h + padY * 2,
  };
}

/** Thu/phóng quanh một điểm, giữ nguyên điểm đó dưới con trỏ.
 *
 * `factor` > 1 là phóng to. Giới hạn để không phóng tới mức số thực mất chính
 * xác, cũng không thu nhỏ tới mức bản vẽ thành một chấm.
 */
export function zoomViewBox(
  box: ViewBox,
  atX: number,
  atY: number,
  factor: number,
  home: ViewBox,
): ViewBox {
  const minW = home.w / 4000;
  const maxW = home.w * 8;
  const w = Math.min(maxW, Math.max(minW, box.w / factor));
  const scale = w / box.w;
  return {
    x: atX - (atX - box.x) * scale,
    y: atY - (atY - box.y) * scale,
    w,
    h: box.h * scale,
  };
}

/** Phần trăm so với khung vừa màn hình. 100% = vừa khít. */
export function zoomPercent(box: ViewBox, home: ViewBox): number {
  return Math.round((home.w / box.w) * 100);
}

function joinExtent(box: number[] | null, ext: number[] | null): number[] | null {
  if (!ext) return box;
  if (!box) return ext;
  return [
    Math.min(box[0], ext[0]), Math.min(box[1], ext[1]),
    Math.max(box[2], ext[2]), Math.max(box[3], ext[3]),
  ];
}

/** Khung bao sau khi biến đổi bằng affine `[a,b,c,d,e,f]`.
 *
 * Phải đưa cả **bốn góc** qua phép biến đổi rồi lấy min/max: block xoay 45° có
 * khung bao rộng hơn hẳn khung gốc, và chỉ biến đổi hai góc đối diện sẽ cho ra
 * một khung nhỏ hơn hình thật.
 */
function transformExtent(ext: number[], m: readonly number[]): number[] {
  const [a, b, c, d, e, f] = m;
  const corners: [number, number][] = [
    [ext[0], ext[1]], [ext[2], ext[1]], [ext[0], ext[3]], [ext[2], ext[3]],
  ];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of corners) {
    const px = a * x + c * y + e;
    const py = b * x + d * y + f;
    minX = Math.min(minX, px); maxX = Math.max(maxX, px);
    minY = Math.min(minY, py); maxY = Math.max(maxY, py);
  }
  return [minX, minY, maxX, maxY];
}

/** Khung bao của một định nghĩa block, theo toạ độ CỦA BLOCK.
 *
 * Nhớ kết quả theo tên: cùng một block được chèn 50 lần thì khung trong hệ toạ
 * độ của nó vẫn y hệt nhau. `stack` chặn vòng lặp A→B→A.
 */
function blockExtent(
  name: string,
  parentLayer: string,
  ctx: ExtentContext,
  stack: ReadonlySet<string>,
  depth: number,
): number[] | null {
  /* Khoá gồm cả layer thừa kế, giống hệt `<defs>` của canvas: con trên layer `0`
     lấy layer của lần chèn, nên cùng một block chèn trên hai layer có thể bị bộ
     lọc ẩn khác nhau — và khung bao vì thế cũng khác nhau. */
  const key = `${name}\u0000${parentLayer}`;
  if (ctx.memo.has(key)) return ctx.memo.get(key) ?? null;
  if (stack.has(key) || depth >= MAX_BLOCK_DEPTH) return null;
  const def = ctx.blocks?.[name];
  if (!def || !def.length) return null;

  const nested = new Set(stack);
  nested.add(key);
  let box: number[] | null = null;
  for (const child of def) {
    box = joinExtent(box, extentOf(child, effectiveLayer(child, parentLayer), ctx, nested, depth + 1));
  }
  ctx.memo.set(key, box);
  return box;
}

type ExtentContext = {
  blocks?: BlockDefs;
  /** Layer bị tắt trong khung xem. Phải áp dụng **giống hệt** canvas, nếu không
   * thì "thu hết" phóng ra để ôm cả thứ đang bị ẩn, và số đối tượng nằm ngoài
   * khung đếm cả hình không được vẽ. */
  hidden?: ReadonlySet<string>;
  memo: Map<string, number[] | null>;
};

function extentOf(
  entity: GeomEntity,
  layer: string,
  ctx: ExtentContext,
  stack: ReadonlySet<string>,
  depth: number,
): number[] | null {
  if (ctx.hidden?.has(layer)) return null;

  if (entity.k === "insert" && entity.name && ctx.blocks) {
    const def = ctx.blocks[entity.name];
    const inner = blockExtent(entity.name, layer, ctx, stack, depth);
    if (inner) {
      const m = entity.m;
      if (m && m.length === 6) return transformExtent(inner, m);
      const dx = entity.p?.[0] ?? 0;
      const dy = entity.p?.[1] ?? 0;
      return transformExtent(inner, [1, 0, 0, 1, dx, dy]);
    }
    /* Có định nghĩa mà không ra khung nào nghĩa là bộ lọc layer đã ẩn sạch nội
       dung — canvas cũng không vẽ gì, nên khung bao cũng phải là không có gì.
       Chỉ khi KHÔNG có định nghĩa mới rơi xuống điểm chèn, vì lúc đó canvas vẽ
       một cái dấu. */
    if (def && def.length && depth < MAX_BLOCK_DEPTH && !stack.has(`${entity.name}\u0000${layer}`)) {
      return null;
    }
  }
  if (entity.g && entity.g.length) {
    /* `multi` không có toạ độ của riêng nó — khung bao là hợp của các hình con.
       Bỏ qua thì HATCH biến mất khỏi "thu hết bản vẽ" và khỏi phép đếm nằm
       ngoài khung, dù nó là một trong những thứ to nhất trên bản vẽ. */
    let box: number[] | null = null;
    for (const child of entity.g) {
      box = joinExtent(box, extentOf(child, layer, ctx, stack, depth + 1));
    }
    if (box) return box;
  }
  if (entity.b && entity.b.length >= 4) {
    return [
      Math.min(entity.b[0], entity.b[2]), Math.min(entity.b[1], entity.b[3]),
      Math.max(entity.b[0], entity.b[2]), Math.max(entity.b[1], entity.b[3]),
    ];
  }
  if (entity.c && entity.c.length >= 2) {
    /* Elip: lấy bán kính lớn hơn cho cả hai chiều. Khung rộng hơn hình thật một
       chút, nhưng luôn CHỨA nó — khung thiếu thì "thu hết" cắt mất mép. */
    const r = Math.max(entity.r ?? 0, entity.rx ?? 0, entity.ry ?? 0);
    return [entity.c[0] - r, entity.c[1] - r, entity.c[0] + r, entity.c[1] + r];
  }
  const p = entity.p;
  if (!p || p.length < 2) return null;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (let i = 0; i + 1 < p.length; i += 2) {
    if (!Number.isFinite(p[i]) || !Number.isFinite(p[i + 1])) continue;
    minX = Math.min(minX, p[i]); maxX = Math.max(maxX, p[i]);
    minY = Math.min(minY, p[i + 1]); maxY = Math.max(maxY, p[i + 1]);
  }
  return Number.isFinite(minX) ? [minX, minY, maxX, maxY] : null;
}

/** Khung bao của một đối tượng, [minX,minY,maxX,maxY] theo toạ độ bản vẽ.
 *
 * Mỗi loại hình giữ toạ độ ở một trường khác nhau, và `text` chỉ có một điểm —
 * trả về một khung suy biến (rộng 0) chứ không trả `null`: điểm đó vẫn được VẼ
 * RA, nên vẫn phải tính là nằm trong hay ngoài khung nhìn.
 *
 * ⚠️ **Phải truyền `blocks`.** Một lần chèn chỉ có `p` là điểm chèn, còn hình
 * thật của nó nằm trong định nghĩa và trải rộng ra xung quanh. Bỏ `blocks` thì
 * "thu hết bản vẽ" cắt cụt mất phần lớn hình, và số đối tượng nằm ngoài khung
 * đếm ra 0 trong khi có cả mảng bản vẽ ở ngoài.
 */
export function entityExtent(
  entity: GeomEntity,
  blocks?: BlockDefs,
  hidden?: ReadonlySet<string>,
): number[] | null {
  return extentOf(entity, entity.l, { blocks, hidden, memo: new Map() }, new Set(), 0);
}

/** Khung bao của cả tập, hoặc `null` khi không đối tượng nào có toạ độ. */
export function unionExtent(
  entities: readonly GeomEntity[],
  blocks?: BlockDefs,
  hidden?: ReadonlySet<string>,
): number[] | null {
  /* Một bộ nhớ đệm dùng chung cho cả tập: 127 lần chèn trên bản vẽ thật chỉ có
     147 định nghĩa, nên tính lại từng lần là thừa hàng nghìn lượt duyệt. */
  const ctx: ExtentContext = { blocks, hidden, memo: new Map() };
  const empty = new Set<string>();
  let box: number[] | null = null;
  for (const entity of entities) {
    box = joinExtent(box, extentOf(entity, entity.l, ctx, empty, 0));
  }
  return box;
}

/** Số đối tượng ĐƯỢC VẼ mà nằm ngoài `bounds` của payload.
 *
 * Không phải chuyện lý thuyết: trên bản vẽ as-built của dự án có 5 block bị đặt
 * lạc cách bản vẽ hàng triệu đơn vị, và `bounds` không chứa chúng — plugin gom
 * khung từ `getGeomExtents()`, mà block rỗng thì hàm đó báo không hợp lệ nên
 * đối tượng bị bỏ khỏi khung dù vẫn được xuất ra.
 *
 * Hệ quả nếu không đếm: khung xem fit theo `bounds`, 5 đối tượng kia nằm ngoài
 * màn hình, mà thanh trạng thái vẫn ghi "224/224 đối tượng đang hiện". Màn hình
 * nói một câu sai về chính nó.
 */
export function countOutsideBounds(
  entities: readonly GeomEntity[],
  bounds: number[] | undefined,
  blocks?: BlockDefs,
  hidden?: ReadonlySet<string>,
): number {
  if (!bounds || bounds.length < 4) return 0;
  const [minX, minY, maxX, maxY] = bounds;
  /* Dung sai theo cỡ khung: so sánh số thực hàng triệu bằng dấu bằng tuyệt đối
     sẽ đếm nhầm những đối tượng nằm đúng trên mép. */
  const tol = Math.max(Math.abs(maxX - minX), Math.abs(maxY - minY)) * 1e-9;
  const ctx: ExtentContext = { blocks, hidden, memo: new Map() };
  const empty = new Set<string>();
  let outside = 0;
  for (const entity of entities) {
    const ext = extentOf(entity, entity.l, ctx, empty, 0);
    if (!ext) continue;
    if (ext[0] < minX - tol || ext[1] < minY - tol || ext[2] > maxX + tol || ext[3] > maxY + tol) {
      outside++;
    }
  }
  return outside;
}

/** Toạ độ pixel trong khung SVG → toạ độ của `viewBox`.
 *
 * Phải tự tính vì `preserveAspectRatio="xMidYMid meet"`: SVG lấy tỉ lệ NHỎ HƠN
 * của hai chiều rồi **căn giữa** phần thừa. Chia thẳng `px / rộng-phần-tử` sẽ
 * lệch đúng bằng nửa dải thừa — trên một bản vẽ dẹt, đó là lệch cả nửa màn
 * hình, và thu phóng bằng con lăn sẽ trôi đi mỗi lần lăn.
 *
 * Trả về trong hệ ĐÃ lật trục Y (hệ của `viewBox`). Muốn toạ độ bản vẽ thì đổi
 * dấu `y`.
 */
export function clientToViewBox(
  box: ViewBox,
  rect: { left: number; top: number; width: number; height: number },
  clientX: number,
  clientY: number,
): { x: number; y: number } {
  if (!rect.width || !rect.height || !box.w || !box.h) return { x: box.x, y: box.y };
  const scale = Math.min(rect.width / box.w, rect.height / box.h);
  const padX = (rect.width - box.w * scale) / 2;
  const padY = (rect.height - box.h * scale) / 2;
  return {
    x: box.x + (clientX - rect.left - padX) / scale,
    y: box.y + (clientY - rect.top - padY) / scale,
  };
}

/* ------------------------------------------------------------------ *
 * Dựng hình
 * ------------------------------------------------------------------ */

/** Đoạn thẳng nối các đỉnh, có tính `bulge`.
 *
 * `bulge` của AutoCAD là `tan(θ/4)` với θ là góc chắn cung, dương là ngược
 * chiều kim đồng hồ. Bỏ nó đi thì ống cong thành ống thẳng — sai hình mà trông
 * vẫn "hợp lý", kiểu sai tệ nhất.
 *
 * Công thức bán kính: nửa dây `d/2`, `θ = 4·atan(b)`, `R = (d/2)/sin(θ/2)`.
 * `sweep-flag` của SVG tính theo chiều kim đồng hồ trên màn hình, mà cảnh đã bị
 * `scale(1,-1)`, nên bulge dương (CCW trong bản vẽ) ứng với `sweep=0`.
 */
export function polylinePath(
  points: readonly number[],
  bulge: readonly number[] | undefined,
  closed: boolean,
): string {
  const n = Math.floor(points.length / 2);
  if (n < 2) return "";

  const x = (i: number) => points[i * 2];
  const y = (i: number) => points[i * 2 + 1];

  let d = `M${x(0)} ${y(0)}`;
  const last = closed ? n : n - 1;
  for (let i = 0; i < last; i++) {
    const j = (i + 1) % n;
    const b = bulge?.[i] ?? 0;
    if (!b) {
      d += `L${x(j)} ${y(j)}`;
      continue;
    }
    const dx = x(j) - x(i);
    const dy = y(j) - y(i);
    const chord = Math.hypot(dx, dy);
    const theta = 4 * Math.atan(b);
    const radius = chord / 2 / Math.sin(Math.abs(theta) / 2);
    if (!Number.isFinite(radius) || radius <= 0) {
      /* Hai đỉnh trùng nhau, hoặc bulge quá nhỏ để ra bán kính hữu hạn. Vẽ
         thẳng còn hơn sinh một `d` mà trình duyệt bỏ qua cả đường. */
      d += `L${x(j)} ${y(j)}`;
      continue;
    }
    const large = Math.abs(theta) > Math.PI ? 1 : 0;
    const sweep = b > 0 ? 0 : 1;
    d += `A${radius} ${radius} 0 ${large} ${sweep} ${x(j)} ${y(j)}`;
  }
  if (closed) d += "Z";
  return d;
}

/** Hình học của một đối tượng thành dữ liệu `d` của `<path>`, hoặc chuỗi rỗng
 * nếu loại đó không vẽ bằng path được (chữ, dấu chỗ đứng).
 *
 * Tồn tại để **gộp nét**: một định nghĩa block có 150 đoạn thẳng thì 150 phần tử
 * SVG chỉ khác nhau ở toạ độ — gộp thành một `<path>` duy nhất giữ nguyên hình
 * mà bớt 149 node. Trên bản vẽ as-built, đây là chênh lệch giữa hơn 10.000 node
 * và vài trăm.
 *
 * Chỉ gộp được thứ **không chọn riêng được**, tức là hình bên trong định nghĩa
 * block. Đối tượng ở cấp trên cùng phải giữ phần tử riêng để còn bấm vào.
 */
export function pathDataOf(entity: GeomEntity, marker: number): string {
  switch (entity.k) {
    case "line": {
      const p = entity.p ?? [];
      return p.length >= 4 ? `M${p[0]} ${p[1]}L${p[2]} ${p[3]}` : "";
    }
    case "poly":
      return polylinePath(entity.p ?? [], entity.bulge, !!entity.closed);
    case "circle": {
      const c = entity.c ?? [];
      if (c.length < 2 || !entity.r) return "";
      return circlePath(c[0], c[1], entity.r);
    }
    case "arc": {
      const c = entity.c ?? [];
      if (c.length < 2 || !entity.r) return "";
      return arcPath(c[0], c[1], entity.r, entity.a0 ?? 0, entity.a1 ?? 0);
    }
    case "ellipse": {
      const c = entity.c ?? [];
      if (c.length < 2 || !entity.rx || !entity.ry) return "";
      return ellipsePath(c[0], c[1], entity.rx, entity.ry, entity.rot ?? 0, entity.a0 ?? 0, entity.a1 ?? 0);
    }
    case "point": {
      const p = entity.p ?? [];
      return p.length >= 2 ? circlePath(p[0], p[1], marker / 3) : "";
    }
    case "box": {
      const b = entity.b ?? [];
      if (b.length < 4) return "";
      return `M${b[0]} ${b[1]}H${b[2]}V${b[3]}H${b[0]}Z`;
    }
    case "multi":
      /* Con nao khong ra path (chu) tra chuoi rong va bi loc di — noi goi phai
         tu dung phan tu rieng cho chung. */
      return (entity.g ?? []).map((child) => pathDataOf(child, marker)).filter(Boolean).join("");
    default:
      /* `insert` và `text` không gộp được: một cái là phép biến đổi, một cái là
         glyph. Nơi gọi phải tự dựng phần tử riêng cho chúng. */
      return "";
  }
}

/** Elip (hoặc cung elip) thành path.
 *
 * `t0`/`t1` là **tham số**, không phải góc: `P(t) = C + rx·cos(t)·u + ry·sin(t)·v`
 * với `u` xoay `rot` radian. Cung tham số ánh xạ 1-1 sang cung elip của SVG nên
 * đây là hình chính xác, không phải xấp xỉ.
 *
 * `sweep=0` vì AutoCAD đi ngược chiều kim đồng hồ còn cảnh đã bị `scale(1,-1)`.
 */
export function ellipsePath(
  cx: number, cy: number, rx: number, ry: number, rot: number, t0: number, t1: number,
): string {
  const TAU = Math.PI * 2;
  const at = (t: number) => {
    const x = rx * Math.cos(t);
    const y = ry * Math.sin(t);
    return [cx + x * Math.cos(rot) - y * Math.sin(rot), cy + x * Math.sin(rot) + y * Math.cos(rot)];
  };
  let sweep = t1 - t0;
  while (sweep <= 0) sweep += TAU;
  const deg = (rot * 180) / Math.PI;
  /* Trọn vòng: một cung elip từ điểm về chính nó là một lệnh RỖNG với SVG, nên
     phải tách đôi. Dung sai nhỏ vì `endAngle` của AutoCAD hay là 6.28318530717959
     chứ không đúng 2π. */
  if (sweep >= TAU - 1e-9) {
    const [ax, ay] = at(t0);
    const [bx, by] = at(t0 + Math.PI);
    return `M${ax} ${ay}A${rx} ${ry} ${deg} 1 0 ${bx} ${by}A${rx} ${ry} ${deg} 1 0 ${ax} ${ay}Z`;
  }
  const [ax, ay] = at(t0);
  const [bx, by] = at(t1);
  return `M${ax} ${ay}A${rx} ${ry} ${deg} ${sweep > Math.PI ? 1 : 0} 0 ${bx} ${by}`;
}

/** Đường tròn thành path — hai nửa cung, vì SVG không có lệnh "vẽ cả vòng". */
export function circlePath(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy}A${r} ${r} 0 1 0 ${cx + r} ${cy}A${r} ${r} 0 1 0 ${cx - r} ${cy}Z`;
}

/** Cung tròn thành đường SVG. Góc theo radian, ngược chiều kim đồng hồ, đúng
 * quy ước của AutoCAD. */
export function arcPath(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const TAU = Math.PI * 2;
  /* Cung đi CCW từ a0 tới a1; a1 nhỏ hơn a0 nghĩa là đã vượt qua 0. */
  let sweepAngle = a1 - a0;
  while (sweepAngle <= 0) sweepAngle += TAU;
  while (sweepAngle > TAU) sweepAngle -= TAU;

  const x0 = cx + r * Math.cos(a0);
  const y0 = cy + r * Math.sin(a0);
  const x1 = cx + r * Math.cos(a1);
  const y1 = cy + r * Math.sin(a1);
  const large = sweepAngle > Math.PI ? 1 : 0;
  /* CCW trong bản vẽ = `sweep=0` sau khi cảnh bị lật trục Y. */
  return `M${x0} ${y0}A${r} ${r} 0 ${large} 0 ${x1} ${y1}`;
}

/* ------------------------------------------------------------------ *
 * Layer
 * ------------------------------------------------------------------ */

/** Trần độ sâu khi bung block. Trùng với trần của plugin, nhưng phải có ở đây
 * nữa: payload hỏng hoặc block tự tham chiếu sẽ làm đệ quy vô hạn. */
export const MAX_BLOCK_DEPTH = 8;

/** Layer thật sự của một đối tượng nằm TRONG định nghĩa block.
 *
 * Quy tắc của AutoCAD, không phải quy ước của app: đối tượng đặt trên **layer
 * `0`** bên trong block **kế thừa layer của lần chèn**. Bỏ qua nó thì tắt một
 * layer sẽ ẩn nhầm thứ, và bảng layer đếm một đống "0" không có thật.
 */
export function effectiveLayer(entity: GeomEntity, parentLayer: string): string {
  return entity.l === "0" && parentLayer ? parentLayer : entity.l;
}

export type LayerRow = { name: string; count: number };

/** Layer có mặt trong đợt hình học này, kèm số hình **thật sự được vẽ ra**.
 *
 * Đếm từ chính payload chứ không lấy bảng layer của `drawing-info`: khung xem
 * chỉ vẽ được thứ đã tải về, nên một layer có 500 đối tượng trong bản vẽ mà đợt
 * này chỉ về 12 thì con số phải là 12. Lấy số của bản vẽ sẽ thành một bộ lọc
 * tắt đi mà chẳng thấy gì biến mất.
 *
 * **Phải bung nội dung block.** Trên bản vẽ as-built, 97% hình nằm trong định
 * nghĩa block; chỉ đếm cấp trên cùng thì bảng layer thiếu hẳn những layer chỉ
 * xuất hiện bên trong block, và tắt một layer có mặt ở cả hai nơi sẽ chỉ ẩn
 * được phần ở cấp trên.
 */
export function layersOf(
  entities: readonly GeomEntity[],
  blocks?: BlockDefs,
): LayerRow[] {
  const counts = new Map<string, number>();
  const bump = (name: string) => counts.set(name, (counts.get(name) ?? 0) + 1);

  const walk = (list: readonly GeomEntity[], parentLayer: string, depth: number) => {
    for (const entity of list) {
      const layer = depth === 0 ? entity.l : effectiveLayer(entity, parentLayer);
      const def = entity.k === "insert" && entity.name ? blocks?.[entity.name] : undefined;
      if (def && def.length && depth < MAX_BLOCK_DEPTH) {
        walk(def, layer, depth + 1);
        continue;
      }
      /* Lần chèn KHÔNG có định nghĩa vẫn vẽ ra một cái dấu, nên vẫn đếm. */
      bump(layer);
    }
  };
  walk(entities, "", 0);

  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/* ------------------------------------------------------------------ *
 * Cầu nối sang AutoCAD
 * ------------------------------------------------------------------ */

/** Cặp `{instance, revision}` rút từ **chính đợt đọc này**, để gửi kèm khi nhờ
 * AutoCAD chọn đối tượng theo handle.
 *
 * ⚠️ Phải lấy từ đợt đã sinh ra handle, không phải đọc thêm một lượt `/docs`
 * cho mới. Ghép handle của lượt này với guard của lượt khác là mở ra đúng
 * khoảng thời gian giữa hai lượt: bản vẽ đổi trong quãng đó thì handle trỏ sang
 * đối tượng khác, guard vẫn hợp lệ, và người dùng chọn nhầm thứ mình không nhìn
 * thấy.
 *
 * `null` khi đợt đọc thiếu `instance` — plugin bản cũ không phát trường này, và
 * đoán bừa một guard là cách chắc chắn nhất để chọn nhầm.
 */
/** Đích của một thao tác ghi: **đường dẫn tệp, hoặc tiêu đề nếu chưa lưu**.
 *
 * Bản vẽ chưa từng lưu không có đường dẫn. Gửi đích rỗng thì daemon tự phân
 * giải sang bản vẽ ĐANG HOẠT ĐỘNG — có thể là một bản vẽ khác hẳn nếu người
 * dùng chuyển tab AutoCAD sau khi trang đã tải. Đúng thứ tự `file || title` mà
 * daemon dùng. */
export function operationTarget(payload: GeometryResponse | null): string {
  const doc = payload?.document;
  const file = typeof doc?.file === "string" ? doc.file.trim() : "";
  if (file) return file;
  return typeof doc?.title === "string" ? doc.title.trim() : "";
}

export function catalogGuardOf(
  payload: GeometryResponse | null,
): { instance: string; revision: number } | null {
  const doc = payload?.document;
  const instance = typeof doc?.instance === "string" ? doc.instance : "";
  const revision = typeof doc?.revision === "number" ? doc.revision : null;
  return instance && revision !== null ? { instance, revision } : null;
}

/** Vì sao chưa chọn được đối tượng này trong AutoCAD — hoặc chuỗi rỗng nếu
 * chọn được.
 *
 * Ràng buộc thật của backend, đã thử trên bản vẽ as-built: chọn theo handle chỉ
 * chạy với đối tượng ở **không gian hiện hành** của AutoCAD; các không gian khác
 * trả `not a top-level entity in current space`. Khung xem lại cho phép xem mọi
 * không gian, nên hai thứ đó lệch nhau là chuyện bình thường.
 *
 * Nói trước, đừng để người dùng bấm rồi mới biết: một nút bấm được xong báo lỗi
 * là một ngõ cụt, còn một nút khoá kèm câu "AutoCAD đang ở Layout 01, chuyển
 * sang Model rồi thử lại" là một việc làm được.
 */
export function selectBlockedReason(
  entity: GeomEntity | null,
  payload: GeometryResponse | null,
): string {
  if (!entity) return "Chưa chọn đối tượng nào.";
  if (!catalogGuardOf(payload)) {
    return "Đợt đọc này không kèm mã phiên bản vẽ. Bấm Đọc lại.";
  }
  const current = payload?.document?.space ?? "";
  /* Không biết không gian hiện hành thì ĐỪNG chặn: plugin bản cũ không phát
     trường này, và khoá nút vì thiếu thông tin sẽ chặn cả trường hợp vốn chạy
     được. Cứ để máy chủ trả lời. */
  if (!current || current === entity.sp) return "";
  return `Đối tượng nằm ở ${entity.sp}, còn AutoCAD đang ở ${current}. `
    + `Chuyển sang ${entity.sp} trong AutoCAD rồi thử lại.`;
}

/* ------------------------------------------------------------------ *
 * Góc
 * ------------------------------------------------------------------ */

/** Radian → độ. Plugin trả `rotation()` của AutoCAD, tức **radian**; SVG
 * `rotate()` nhận **độ**. Truyền thẳng thì một nhãn xoay 90° chỉ nghiêng 1,57° —
 * sai mà vẫn trông như "chữ hơi lệch", nên rất dễ lọt. */
export function degrees(radians: number | undefined): number {
  return ((radians ?? 0) * 180) / Math.PI;
}

/* ------------------------------------------------------------------ *
 * Câu chữ
 * ------------------------------------------------------------------ */

export function kindLabel(kind: GeomEntity["k"]): string {
  const map: Record<GeomEntity["k"], string> = {
    line: "Đoạn thẳng",
    poly: "Đường nhiều đoạn",
    circle: "Đường tròn",
    arc: "Cung tròn",
    point: "Điểm",
    insert: "Block",
    text: "Chữ",
    ellipse: "Elip",
    mtext: "Chữ nhiều dòng",
    box: "Hình bao",
    multi: "Vùng gạch",
  };
  return map[kind] ?? kind;
}

/** Mô tả hình VẼ RA của một đối tượng.
 *
 * Khác `kindLabel`: một `multi` có thể là vùng gạch, có thể là một khối chữ đã
 * bung thành từng đoạn, có thể là hình bắt qua `worldDraw`. Gọi tất cả là "Vùng
 * gạch" thì inspector mô tả sai chính thứ người dùng vừa bấm vào.
 */
export function shapeLabel(entity: GeomEntity): string {
  if (entity.k !== "multi") return kindLabel(entity.k);
  if (entity.lines?.length) return "Chữ nhiều dòng";
  if (entity.aw?.startsWith("worlddraw")) return "Hình do AutoCAD vẽ";
  return "Vùng gạch";
}

export function fidelityLabel(fidelity: Fidelity): string {
  const map: Record<Fidelity, string> = {
    exact: "hình thật",
    reduced: "hình thiếu",
    placeholder: "chưa có hình",
  };
  return map[fidelity];
}

/** Giờ đọc dữ liệu, dạng HH:MM:SS theo giờ máy. `collectedAt` tính bằng GIÂY
 * Unix — nhân 1000 hay quên nhân là lệch nhau 56 năm. */
export function collectedAtLabel(collectedAt: number | undefined): string {
  if (!collectedAt || !Number.isFinite(collectedAt)) return "";
  return new Date(collectedAt * 1000).toLocaleTimeString("vi-VN");
}

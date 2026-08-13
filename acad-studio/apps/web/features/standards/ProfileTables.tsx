"use client";

/** Ba bảng sửa tại chỗ của màn soạn hồ sơ quy tắc.
 *
 * Tách khỏi `page.tsx` vì chúng là phần lớn nhất của màn hình và không dính gì
 * tới việc nạp/ghi hồ sơ — trang lo vòng đời dữ liệu, đây lo cách sửa nó.
 *
 * ## Vì sao dữ liệu AutoCAD không vừa với ô nhập thường
 *
 * **Mẫu nhận diện là một TẬP, không phải một chuỗi.** Nhập bằng ô text ngăn
 * cách dấu phẩy thì một dấu phẩy thừa tạo ra mẫu rỗng — thứ khớp mọi đối tượng,
 * và không ai nhìn ra vì nó vô hình.
 *
 * **Màu là chỉ số trong bảng 256 màu của AutoCAD**, không phải mã hex. Người
 * dùng đối chiếu màu bằng mắt để tìm layer sai, nên phải thấy được ô màu — mà
 * màu thật chỉ suy được cho những chỉ số có quy ước.
 *
 * **Bề dày nét có hai kiểu dữ liệu cùng lúc**: ba tên (`Default`, `ByLayer`,
 * `ByBlock`) lưu dạng chuỗi, phần còn lại là số milimét `0…2.11`. Gộp về một
 * kiểu là hỏng một nửa — xem `LINEWEIGHTS` trong `model.ts`.
 */
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/icons";
import {
  ACI_NAMED,
  LINEWEIGHTS,
  LINEWEIGHT_NAMES,
  ROOM_KIND,
  isHexColor,
  layerRowErrors,
  mappingRowErrors,
  type LayerRule,
  type MappingRule,
} from "./model";

/** Màu THẬT của một chỉ số ACI, hoặc `null` nếu không suy được.
 *
 * Chỉ 1–9 có quy ước cố định. Từ 10 trở đi là một bảng tra do AutoCAD định
 * nghĩa, và **đoán** nó bằng công thức HSL cho ra màu sai — mà một ô màu sai
 * cạnh tên layer tệ hơn không có ô màu nào, vì người dùng dựa vào đúng nó để
 * tìm nhầm lẫn. Trả `null` để giao diện hiện số thay vì bịa màu.
 */
export function aciColor(value: number): string | null {
  const known: Record<number, string> = {
    1: "#ff0000", 2: "#ffff00", 3: "#00ff00", 4: "#00ffff",
    5: "#0000ff", 6: "#ff00ff", 7: "#ffffff", 8: "#808080", 9: "#c0c0c0",
  };
  return known[value] ?? null;
}

function lineweightLabel(value: string | number): string {
  const found = LINEWEIGHTS.find((item) => String(item.value) === String(value));
  return found ? found.label : String(value);
}

/* ------------------------------------------------------------------ *
 * Ô nhập nhiều thẻ
 * ------------------------------------------------------------------ */

function TagInput({ values, onChange, label, disabled, placeholder }: {
  values: readonly string[];
  onChange: (next: string[]) => void;
  label: string;
  disabled: boolean;
  placeholder?: string;
}) {
  const [draft, setDraft] = useState("");

  const commit = (raw: string) => {
    /* Tách theo dấu phẩy để dán được cả danh sách, nhưng KẾT QUẢ vẫn là các thẻ
       rời — mẫu rỗng bị loại ngay tại đây, chứ không đi vào hồ sơ rồi khớp mọi
       thứ. Trùng lặp cũng loại: hai mẫu giống nhau không lọc chặt hơn một. */
    const parts = raw.split(",").map((part) => part.trim()).filter(Boolean);
    if (!parts.length) return;
    const next = [...values];
    for (const part of parts) if (!next.includes(part)) next.push(part);
    onChange(next);
    setDraft("");
  };

  return (
    <div className="taginput">
      {/* Xoá theo VỊ TRÍ, không theo giá trị. Ô này khử trùng lặp lúc thêm,
          nhưng dữ liệu máy chủ thì không — `stringList()` giữ nguyên mảng nhận
          được. Lọc theo giá trị là bấm × một thẻ làm biến mất cả thẻ song sinh
          của nó ở chỗ khác. */}
      {values.map((value, index) => (
        <span className="tg" key={`${index}-${value}`}>
          {value}
          <button type="button" aria-label={`Bỏ mẫu ${value}`} disabled={disabled}
            onClick={() => onChange(values.filter((_, i) => i !== index))}>
            <Icon name="close" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        aria-label={label}
        /* Khoá trong lúc PUT đang bay: lưu xong trang thay bản nháp bằng phản
           hồi máy chủ, nên một thẻ thêm vào giữa chừng biến mất không dấu vết. */
        disabled={disabled}
        placeholder={values.length ? "" : placeholder ?? "thêm mẫu…"}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            commit(draft);
          }
          /* Backspace trên ô rỗng gỡ thẻ cuối — nhanh hơn phải rê chuột tới
             đúng nút X của một thẻ nhỏ 14px. */
          if (event.key === "Backspace" && !draft && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        /* Rời ô mà còn chữ dở thì VẪN nhận: gõ xong rồi bấm Lưu là thao tác
           thường nhất, và mất chữ lúc đó là mất việc trong im lặng. */
        onBlur={() => commit(draft)}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Chọn màu ACI
 * ------------------------------------------------------------------ */

function AciPicker({ value, onChange, disabled }: {
  value: string | number;
  /* `string` là mã màu thật `#RRGGBB`. Khai cứng `number` ở đây từng là thứ chặn
     màu thật đi hết đường: `LayerRule.color` vốn đã nhận chuỗi, chỉ riêng ô chọn
     là không. */
  onChange: (next: string | number) => void;
  disabled: boolean;
}) {
  /* Neo theo toạ độ MÀN HÌNH, không theo ô cha.
     Bảng nằm trong `.tablewrap { overflow: auto }`, nên một popover
     `position: absolute` bị cắt cụt ngay tại mép bảng — và người dùng chỉ thấy
     một mẩu bảng màu không bấm được. `fixed` thoát khỏi mọi khung cuộn. */
  const [at, setAt] = useState<{ top: number; left: number } | null>(null);
  const wrap = useRef<HTMLSpanElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const numeric = typeof value === "number" ? value : Number(value);
  /* Màu thật đã là mã màu — tô thẳng, không đi qua bảng ACI. `Number("#FF8000")`
     là `NaN`, nên không chặn ở đây là ô màu bỏ trống đúng lúc đã biết chắc màu. */
  const hex = typeof value === "string" && isHexColor(value) ? value.trim() : null;
  const swatch = hex ?? (Number.isFinite(numeric) ? aciColor(numeric) : null);

  const open = () => {
    const box = wrap.current?.getBoundingClientRect();
    if (!box) return;
    /* Mở ở dưới trước, rồi ĐO và lật nếu tràn — xem `useLayoutEffect` dưới.
       Đoán sẵn chiều cao là sai: tôi đoán 260px, phần tử thật cao hơn 300px, và
       hàng layer cuối bảng mở ra một popover cụt đáy. */
    setAt({ top: box.bottom + 4, left: Math.min(box.left, window.innerWidth - 260) });
  };

  /* Lật lên trên khi phần tử THẬT đo được là tràn đáy. Chạy trước lượt vẽ nên
     người dùng không thấy nó nhảy. */
  useLayoutEffect(() => {
    if (!at || !pop.current) return;
    const box = pop.current.getBoundingClientRect();
    const overflow = box.bottom - (window.innerHeight - 8);
    if (overflow <= 0) return;
    const anchor = wrap.current?.getBoundingClientRect();
    const above = (anchor ? anchor.top : at.top) - box.height - 4;
    /* Không đủ chỗ cả trên lẫn dưới (cửa sổ thấp) thì ghim vào mép trên — cụt
       đầu còn mở được nút, cụt đáy thì ô nhập chỉ số nằm ngoài màn hình. */
    const top = Math.max(8, above >= 8 ? above : at.top - overflow);
    if (Math.abs(top - at.top) > 1) setAt({ ...at, top });
  }, [at]);

  useEffect(() => {
    if (!at) return;
    const away = (event: MouseEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setAt(null);
    };
    const key = (event: KeyboardEvent) => { if (event.key === "Escape") setAt(null); };
    /* Cuộn hay đổi cỡ là toạ độ đã tính không còn đúng — đóng thay vì để popover
       trôi khỏi ô nó thuộc về. */
    const shut = () => setAt(null);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", key);
    window.addEventListener("resize", shut);
    window.addEventListener("scroll", shut, true);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", key);
      window.removeEventListener("resize", shut);
      window.removeEventListener("scroll", shut, true);
    };
  }, [at]);

  return (
    <span ref={wrap} style={{ display: "inline-block" }}>
      <button type="button" className="aciswatch" disabled={disabled}
        onClick={() => (at ? setAt(null) : open())}
        aria-expanded={!!at} aria-label={`Màu ACI ${String(value)}`}>
        {/* Không suy được màu thì KHÔNG tô: một ô màu sai cạnh tên layer tệ hơn
            không có ô nào — người dùng dựa vào đúng nó để tìm nhầm lẫn. */}
        <i style={swatch
          ? { background: swatch }
          : { background: "transparent", borderStyle: "dashed" }} />
        {String(value)}
      </button>
      {at ? (
        <div className="pop" ref={pop} role="dialog" aria-label="Chọn màu ACI"
          style={{ top: at.top, left: at.left, width: 248 }}>
          <div className="pophead">Màu có tên</div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--s1)" }}>
            {ACI_NAMED.map((item) => (
              <Button key={item.value}
                onClick={() => { onChange(item.value); setAt(null); }}
                aria-pressed={numeric === item.value}>
                <span className="aciswatch" style={{ border: 0, padding: 0, height: "auto" }}>
                  <i style={{ background: aciColor(item.value) ?? "transparent" }} />
                  {item.value} · {item.label}
                </span>
              </Button>
            ))}
          </div>
          <div className="pophead" style={{ marginTop: "var(--s3)" }}>
            Chỉ số khác, hoặc màu thật
          </div>
          <input className="input" defaultValue={String(value)}
            aria-label="Chỉ số ACI hoặc mã màu #RRGGBB"
            onKeyDown={(event) => {
              if (event.key !== "Enter") return;
              event.preventDefault();
              const text = (event.target as HTMLInputElement).value.trim();
              /* Màu thật đi trước: `Number("#FF8000")` là `NaN`, nên nếu để phép
                 kiểm ACI chạy trước thì mọi mã màu đều rơi vào nhánh từ chối. */
              if (isHexColor(text)) { onChange(text.toUpperCase()); setAt(null); return; }
              const parsed = Number(text);
              /* Chặn ngay tại ô: ACI phải là số NGUYÊN 0–256. Nhận giá trị lẻ
                 rồi để máy chủ từ chối là bắt người dùng đi một vòng mới biết. */
              if (!Number.isInteger(parsed) || parsed < 0 || parsed > 256) return;
              onChange(parsed);
              setAt(null);
            }} />
          <p className="hint" style={{ margin: "var(--s2) 0 0" }}>
            Số nguyên 0–256, hoặc mã màu thật <b>#RRGGBB</b> (đủ 6 chữ số). Enter
            để nhận. Mã màu thật hiện đúng màu; trong dải ACI thì chỉ 1–9 hiện
            được — chỉ số khác app không đoán màu, vì đoán sai còn tệ hơn để
            trống.
            {/* Không CHẶN 0 và 256 — máy chủ nhận chúng. Nhưng `layerColor()` ép
                cả hai về 7 lúc áp dụng (một layer không thể kế thừa màu từ chính
                nó), nên im lặng ở đây là để người dùng đặt 256 rồi thấy layer
                hoá trắng mà không hiểu vì sao. */}
            {" "}<b>0</b> và <b>256</b> lưu được nhưng khi áp dụng sẽ thành{" "}
            <b>7</b>: một layer không kế thừa màu từ chính nó.
          </p>
        </div>
      ) : null}
    </span>
  );
}

/* ------------------------------------------------------------------ *
 * Bảng layer
 * ------------------------------------------------------------------ */

export function LayerTable({ layers, onChange, disabled, onImport }: {
  layers: readonly LayerRule[];
  onChange: (next: LayerRule[]) => void;
  disabled: boolean;
  /** Mở hộp thoại nhập layer từ bản vẽ. `undefined` = không có bản vẽ nào đang
   * mở, và nút phải nói lý do chứ không chỉ mờ đi. */
  onImport?: () => void;
}) {
  const errors = layerRowErrors(layers);
  /* Gợi ý lấy từ chính hồ sơ này, KHÔNG từ một danh sách linetype dựng sẵn.
     Màn này không mở bản vẽ nên không biết bản vẽ đã nạp những linetype nào;
     liệt kê `HIDDEN2`, `CENTER`… như thể chọn được là mời người dùng đặt một
     giá trị mà lượt áp dụng sẽ trượt. Gõ tự do vẫn được — đó mới là đường dùng
     tên mới. */
  const known = [...new Set(layers.map((layer) => String(layer.linetype)).filter(Boolean))];
  const patch = (index: number, next: Partial<LayerRule>) =>
    onChange(layers.map((layer, i) => (i === index ? { ...layer, ...next } : layer)));

  return (
    <section className="panel">
      <header>
        <h2>Layer bắt buộc</h2>
        <div className="actions">
          <span className="tag mono">{layers.length}</span>
          <Button disabled={disabled || !onImport}
            title={onImport ? undefined
              : "Bảng layer đọc từ một bản vẽ đang mở trong AutoCAD; hiện chưa có bản vẽ nào."}
            onClick={() => onImport?.()}>Lấy layer từ bản vẽ</Button>
          <Button disabled={disabled} onClick={() => onChange([...layers, {
            name: "", color: 7, linetype: "Continuous", lineweight: "Default", required: true,
          }])}>Thêm layer</Button>
        </div>
      </header>
      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr>
              <th>Tên</th><th style={{ width: 132 }}>Màu</th><th>Nét</th>
              <th style={{ width: 132 }}>Bề dày</th>
              <th style={{ width: 88 }}>Bắt buộc</th><th style={{ width: 44 }} />
            </tr>
          </thead>
          <tbody>
            {layers.map((layer, index) => (
              <tr key={index} data-invalid={errors[index] ? "true" : "false"}>
                <td>
                  <input className="cell mono" value={layer.name} disabled={disabled}
                    aria-label={`Tên layer dòng ${index + 1}`}
                    aria-invalid={errors[index] ? "true" : "false"}
                    onChange={(event) => patch(index, { name: event.target.value })} />
                  {errors[index] ? <span className="cellerr">{errors[index]}</span> : null}
                </td>
                <td>
                  <AciPicker value={layer.color} disabled={disabled}
                    onChange={(color) => patch(index, { color })} />
                </td>
                <td>
                  <input className="cell mono" value={String(layer.linetype)} disabled={disabled}
                    list="acad-linetypes" aria-label={`Kiểu nét dòng ${index + 1}`}
                    onChange={(event) => patch(index, { linetype: event.target.value })} />
                </td>
                <td>
                  <select className="cell mono" value={String(layer.lineweight)} disabled={disabled}
                    aria-label={`Bề dày dòng ${index + 1}`}
                    /* Giữ đúng KIỂU daemon lưu: ba tên là chuỗi, còn lại là số
                       milimét. Ghi tất cả thành chuỗi là mọi bề dày số bị từ
                       chối; ghi tất cả thành số là "Default" hoá `NaN`. */
                    onChange={(event) => patch(index, {
                      lineweight: LINEWEIGHT_NAMES.some((name) => name === event.target.value)
                        ? event.target.value
                        : Number(event.target.value),
                    })}>
                    {/* Giá trị đang lưu mà không có trong bảng vẫn phải hiện ra
                        — nếu không, chỉ mở hồ sơ lên đã lặng lẽ đổi bề dày của
                        layer sang mục đầu danh sách. */}
                    {LINEWEIGHTS.some((w) => String(w.value) === String(layer.lineweight))
                      ? null
                      : <option value={String(layer.lineweight)}>
                        {lineweightLabel(layer.lineweight)}
                      </option>}
                    {LINEWEIGHTS.map((item) => (
                      <option key={String(item.value)} value={String(item.value)}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </td>
                <td style={{ textAlign: "center" }}>
                  <input type="checkbox" checked={layer.required} disabled={disabled}
                    aria-label={`Bắt buộc dòng ${index + 1}`}
                    onChange={(event) => patch(index, { required: event.target.checked })} />
                </td>
                <td style={{ textAlign: "right" }}>
                  <Button disabled={disabled} aria-label={`Xoá layer dòng ${index + 1}`}
                    onClick={() => onChange(layers.filter((_, i) => i !== index))}>
                    Xoá
                  </Button>
                </td>
              </tr>
            ))}
            {!layers.length ? (
              <tr><td colSpan={6}>
                <span className="hint">
                  Hồ sơ này chưa liệt kê layer nào — lượt quét sẽ không kiểm layer.
                </span>
              </td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <datalist id="acad-linetypes">
        {known.map((name) => <option key={name} value={name} />)}
      </datalist>
      <div style={{ padding: "var(--s3) var(--s4)", borderTop: "1px solid var(--border)" }}>
        <p className="hint" style={{ margin: 0 }}>
          Kiểu nét gõ tự do: màn này không mở bản vẽ nên không biết bản vẽ đã nạp
          những kiểu nét nào. Đặt một tên chưa nạp thì lượt áp dụng ở màn Kiểm tra
          sẽ báo lỗi tại đó, không phải ở đây.
        </p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Bảng ánh xạ
 * ------------------------------------------------------------------ */

export function MappingTable({ mappings, onChange, disabled }: {
  mappings: readonly MappingRule[];
  onChange: (next: MappingRule[]) => void;
  disabled: boolean;
}) {
  const errors = mappingRowErrors(mappings);
  const patch = (index: number, next: Partial<MappingRule>) =>
    onChange(mappings.map((item, i) => (i === index ? { ...item, ...next } : item)));

  return (
    <section className="panel">
      <header>
        <h2>Ánh xạ đối tượng</h2>
        <div className="actions">
          <span className="tag mono">{mappings.length}</span>
          <Button disabled={disabled} onClick={() => onChange([...mappings, {
            /* `sourceId` rỗng: dòng mới chưa có bản ghi nào ở máy chủ để giữ. */
            id: `mapping-${mappings.length + 1}`, sourceId: "", label: "", kind: "object",
            layerPatterns: [], blockPatterns: [], textPatterns: [], entityTypes: [],
            required: false,
          }])}>Thêm ánh xạ</Button>
        </div>
      </header>

      <div className="banner">
        <span className="bm" />
        <span className="bt">
          <b>Ánh xạ quyết định đối tượng nào bị tính diện tích.</b> Sửa sai là sai
          cả bảng bóc tách, và app <b>không xem trước được</b> — máy chủ chưa có
          đường thử một quy tắc chưa lưu. Cách kiểm duy nhất: lưu, rồi quét ở màn
          Kiểm tra và đối chiếu số đối tượng.
          {" "}Mẫu để trống nghĩa là <b>khớp tất cả</b>, không phải “bỏ qua”.
        </span>
      </div>

      <datalist id="acad-mapping-kinds">
        {["object", ROOM_KIND, "frame", "cut-plane", "sheet"]
          .map((kind) => <option key={kind} value={kind} />)}
      </datalist>

      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr>
              <th style={{ width: 150 }}>Mã</th><th>Nhãn</th><th style={{ width: 110 }}>Loại</th>
              <th>Mẫu layer</th><th>Mẫu block</th>
              <th>Loại đối tượng</th>
              {/* Mẫu chữ chỉ được `acadstd:scan-room` đọc. Nói ra ở tiêu đề cột
                  chứ không để người dùng gõ đầy rồi mới biết nó nằm im. */}
              <th>Mẫu chữ <span className="hint">(chỉ {ROOM_KIND})</span></th>
              <th style={{ width: 80 }}>Bắt buộc</th><th style={{ width: 44 }} />
            </tr>
          </thead>
          <tbody>
            {mappings.map((mapping, index) => (
              /* Khoá theo `sourceId`, KHÔNG theo chỉ số: xoá một dòng phía trên
                 làm React tái dùng component của dòng dưới cho một ánh xạ khác,
                 mang theo cả chữ đang gõ dở trong ô thẻ. Cũng không khoá theo
                 `id` — nó sửa được, nên mỗi phím gõ sẽ dựng lại dòng và cướp
                 mất con trỏ. Dòng mới chưa có `sourceId` thì đành theo chỉ số;
                 chúng luôn nằm cuối nên không bị dịch bởi dòng phía trên. */
              <tr key={mapping.sourceId || `moi-${index}`}
                data-invalid={errors[index] ? "true" : "false"}>
                <td>
                  <input className="cell mono" value={mapping.id} disabled={disabled}
                    aria-label={`Mã ánh xạ dòng ${index + 1}`}
                    aria-invalid={errors[index] ? "true" : "false"}
                    onChange={(event) => patch(index, { id: event.target.value })} />
                  {errors[index] ? <span className="cellerr">{errors[index]}</span> : null}
                </td>
                <td>
                  <input className="cell" value={mapping.label} disabled={disabled}
                    aria-label={`Nhãn dòng ${index + 1}`}
                    onChange={(event) => patch(index, { label: event.target.value })} />
                </td>
                <td>
                  {/* Gõ TỰ DO kèm gợi ý, không phải danh sách đóng. Panel cũ
                      cho nhập bất kỳ chuỗi nào, và điều đó có ý nghĩa: bộ máy
                      nhận diện khung tên bằng regex `/frame|sheet|title.?block|
                      khung/` trên `kind`, nên `sheet` hay `khung-ten` đều dùng
                      được. Khoá thành select là lấy mất những cách gọi đó.
                      Riêng `room` mới đổi hành vi chương trình LISP.
                      KHÔNG gợi ý `text`: đó là loại tôi bịa ra ở bản trước, nó
                      hứa một cách khớp không tồn tại. */}
                  <input className="cell mono" value={mapping.kind} disabled={disabled}
                    list="acad-mapping-kinds"
                    aria-label={`Loại dòng ${index + 1}`}
                    onChange={(event) => patch(index, { kind: event.target.value })} />
                </td>
                <td>
                  <TagInput values={mapping.layerPatterns} disabled={disabled}
                    label={`Mẫu layer dòng ${index + 1}`}
                    onChange={(layerPatterns) => patch(index, { layerPatterns })} />
                </td>
                <td>
                  <TagInput values={mapping.blockPatterns} disabled={disabled}
                    label={`Mẫu block dòng ${index + 1}`}
                    onChange={(blockPatterns) => patch(index, { blockPatterns })} />
                </td>
                <td>
                  {/* Lọc theo loại DXF. Trống = mọi loại, nên nó là một trong ba
                      thứ duy nhất thu hẹp được quy tắc — không có cột này thì
                      không có cách nào đặt nó. */}
                  <TagInput values={mapping.entityTypes} disabled={disabled}
                    label={`Loại đối tượng dòng ${index + 1}`}
                    placeholder="LWPOLYLINE…"
                    onChange={(entityTypes) => patch(index, { entityTypes })} />
                </td>
                <td>
                  <TagInput values={mapping.textPatterns} disabled={disabled}
                    label={`Mẫu chữ dòng ${index + 1}`}
                    onChange={(textPatterns) => patch(index, { textPatterns })} />
                </td>
                <td style={{ textAlign: "center" }}>
                  <input type="checkbox" checked={mapping.required} disabled={disabled}
                    aria-label={`Bắt buộc dòng ${index + 1}`}
                    onChange={(event) => patch(index, { required: event.target.checked })} />
                </td>
                <td style={{ textAlign: "right" }}>
                  <Button disabled={disabled} aria-label={`Xoá ánh xạ dòng ${index + 1}`}
                    onClick={() => onChange(mappings.filter((_, i) => i !== index))}>
                    Xoá
                  </Button>
                </td>
              </tr>
            ))}
            {!mappings.length ? (
              <tr><td colSpan={9}>
                <span className="hint">Hồ sơ này chưa có ánh xạ nào.</span>
              </td></tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ *
 * Thiết lập kích thước nâng cao
 * ------------------------------------------------------------------ */

/** Một ô của bảng nâng cao, giữ NGUYÊN VĂN thứ đang gõ.
 *
 * Đọc lại từ giá trị đã phân tích mỗi lần render thì `2.` bị chuẩn hoá về `2`
 * ngay khi vừa gõ dấu chấm — `Number("2.")` là `2`, một số hữu hạn — và không
 * cách nào nhập được `2.5`. Tôi từng viết bình luận nói ô này giữ được `2.`;
 * bình luận đúng, mã thì không. `NumberField` ở `page.tsx` đã giải đúng bài này
 * từ trước, chỉ là tôi không mang cách giải sang đây.
 *
 * Trạng thái ngoài vẫn nhận giá trị đã phân tích ngay từng phím; chỉ phần HIỂN
 * THỊ là bám theo văn bản thô.
 */
function ExtraValueField({ name, numeric, value, onChange, disabled }: {
  name: string;
  numeric: boolean;
  value: unknown;
  onChange: (next: unknown) => void;
  disabled: boolean;
}) {
  const shown = value == null ? "" : String(value);
  const [text, setText] = useState(shown);

  /* Đồng bộ từ ngoài vào CHỈ khi giá trị thật lệch với thứ đang gõ — đổi hồ sơ,
     hoàn nguyên, nạp lại. Không có chốt này thì mỗi lần cha render lại sẽ xoá
     dấu chấm vừa gõ. */
  useEffect(() => {
    if (shown !== text) setText(shown);
  }, [shown]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <input className="cell mono" disabled={disabled}
      inputMode={numeric ? "decimal" : undefined}
      value={text}
      aria-label={`Giá trị ${name}`}
      onChange={(event) => {
        const raw = event.target.value;
        setText(raw);
        const parsed = Number(raw);
        /* Gửi ra ngoài dạng SỐ ngay khi phân tích được — bản nháp luôn đúng
           kiểu, kể cả khi ô còn đang hiện `2.`. Chuỗi không phân tích được thì
           gửi nguyên văn và `profileSaveBlockedReason()` chặn ở nút Lưu. */
        onChange(numeric && raw.trim() && Number.isFinite(parsed) ? parsed : raw);
      }} />
  );
}

export function DimensionExtras({ extras, baseline, onChange, disabled }: {
  extras: Record<string, unknown>;
  /** Cùng những trường đó nhưng của bản ĐÃ LƯU. Chỉ dùng để biết KIỂU từng
   * trường — máy chủ kiểm kiểu, và kiểu không suy được từ thứ đang gõ dở. */
  baseline: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  disabled: boolean;
}) {
  const keys = Object.keys(extras).sort();
  if (!keys.length) return null;

  return (
    <details className="adv">
      <summary>
        <span className="tw"><Icon name="chevron" /></span>
        <span>{keys.length} thiết lập kích thước nâng cao</span>
        <span className="sp"><span className="tag">sửa dạng bảng</span></span>
      </summary>
      <div className="advbody">
        <div className="tablewrap" style={{ maxHeight: 320 }}>
          <table className="data">
            <thead><tr><th style={{ width: 220 }}>Tên trường</th><th>Giá trị</th></tr></thead>
            <tbody>
              {keys.map((key) => {
                /* Kiểu lấy từ bản ĐÃ LƯU, không từ giá trị đang gõ.
                   Đọc `typeof extras[key]` là sai: xoá trắng một trường số làm
                   nó thành `""`, và từ đó mọi ký tự gõ vào đều được coi là chuỗi
                   — `numberValue()` của daemon từ chối thẳng chuỗi, nên người
                   dùng ăn 400 với một lời báo không chỉ về ô nào. */
                const kind = typeof baseline[key];
                if (kind === "boolean") {
                  return (
                    <tr key={key}>
                      <td className="mono">{key}</td>
                      <td>
                        {/* Ô tích, không phải ô chữ: gõ "false" vào ô chữ cho ra
                            CHUỖI "false" — thứ `booleanValue()` từ chối, và là
                            thứ trông đúng nhất khi nhìn. */}
                        <input type="checkbox" disabled={disabled}
                          checked={extras[key] === true}
                          aria-label={`Giá trị ${key}`}
                          onChange={(event) =>
                            onChange({ ...extras, [key]: event.target.checked })} />
                      </td>
                    </tr>
                  );
                }
                return (
                  <tr key={key}>
                    <td className="mono">{key}</td>
                    <td>
                      <ExtraValueField name={key} numeric={kind === "number"}
                        value={extras[key]} disabled={disabled}
                        onChange={(next) => onChange({ ...extras, [key]: next })} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div style={{ padding: "var(--s3) var(--s4)", borderTop: "1px solid var(--border)" }}>
          <p className="hint" style={{ margin: 0 }}>
            Bảng này dựng từ chính dữ liệu hồ sơ. Máy chủ thêm một trường mới thì
            nó tự xuất hiện ở đây — kể cả trường giao diện chưa biết cách trình
            bày, thay vì biến mất khỏi tầm mắt.
          </p>
        </div>
      </div>
    </details>
  );
}

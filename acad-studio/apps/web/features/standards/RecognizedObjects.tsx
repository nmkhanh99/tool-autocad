"use client";

/** Bảng đối tượng lượt quét nhận diện được, gộp theo ánh xạ.
 *
 * ## Vì sao bảng này quan trọng hơn nó trông
 *
 * Máy chủ **không có đường thử một quy tắc ánh xạ chưa lưu** — bảy route của
 * `drawingStandards.ts` không có dry-run nào. Nên vòng phản hồi duy nhất cho câu
 * *"ánh xạ của tôi có đúng không"* là: lưu → quét → **nhìn số đối tượng bắt
 * được**. Màn Hồ sơ đang khuyên người dùng đúng cách đó; trước bảng này thì lời
 * khuyên ấy không làm theo được.
 *
 * ## Gộp theo ánh xạ, không phải danh sách phẳng
 *
 * Câu hỏi thật không phải "bản vẽ có những đối tượng nào" mà "quy tắc *Phòng
 * khách* bắt được bao nhiêu cái, có hợp lý không". Số đếm mỗi nhóm là câu trả
 * lời; danh sách chi tiết chỉ để kiểm chứng, nên nó gập lại.
 *
 * Ánh xạ bắt **0 đối tượng** vẫn nằm nguyên trong bảng và được tô đậm — nó vắng
 * mặt hoàn toàn khỏi `scan.objects`, mà đấy lại là dấu hiệu quy tắc sai rõ nhất.
 */
import { Fragment, useState } from "react";
import { Button } from "../../components/ui/Button";
import { Icon } from "../../components/ui/icons";
import { groupObjectsByMapping, type MappingRule, type Scan } from "./model";

/** Số có dấu phẩy thập phân kiểu Việt, kèm ĐƠN VỊ MÁY CHỦ TRẢ VỀ.
 *
 * Không ghim `"m²"`: `metersPerUnit()` của daemon chỉ quy đổi được INSUNITS
 * 1/2/4/5/6 (inch, foot, mm, cm, m). Mọi giá trị khác — kể cả `0` là "không đơn
 * vị", rất thường gặp ở bản vẽ cũ — giữ số thô và được gắn nhãn
 * `drawing-unit²`. Viết "m²" lên số thô của một bản vẽ mm là sai gấp một triệu
 * lần, ngay tại con số người dùng dùng để bóc tách. */
function area(value: number | undefined, unit: string): string {
  /* `0` KHÔNG phải "không có diện tích" mà là "chưa đo được" — chương trình LISP
     trả 0 cho những gì nó không đo nổi. Hiện "0,00 m²" là bịa ra một vùng rỗng
     ngay tại con số dùng để bóc tách. */
  if (value === undefined || value <= 0) return "—";
  const shown = value.toLocaleString("vi-VN", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return unit ? `${shown} ${unit}` : shown;
}

function size(value: number | undefined): string {
  // Cùng lý do như `area()`: `0` là chưa đo được, không phải bề rộng bằng không.
  return value === undefined || value <= 0 ? "—" : value.toLocaleString("vi-VN");
}

export function RecognizedObjects({ scan, mappings, mappingsStale }: {
  scan: Scan;
  /** Ánh xạ của hồ sơ — CHỈ dùng để dựng những dòng bắt 0 đối tượng, vì một quy
   * tắc không khớp gì sẽ vắng mặt hoàn toàn khỏi `scan.objects`.
   *
   * Nhóm CÓ đối tượng không cần tới nó: mỗi đối tượng tự mang `label` và `kind`
   * mà máy chủ gắn **lúc quét**, nên nhãn luôn đúng với thời điểm quét. */
  mappings: readonly MappingRule[];
  /** Hồ sơ đã đổi sau lượt quét. Khi đó danh sách ánh xạ hiện tại **không phải**
   * danh sách đã sinh ra kết quả này: một quy tắc mới thêm sẽ hiện ra như "bắt
   * 0" dù nó chưa từng được quét, và một quy tắc vừa đổi tên sẽ dán nhãn mới lên
   * số liệu cũ. Lúc đó chỉ hiện thứ THẬT SỰ tìm được. */
  mappingsStale?: boolean;
}) {
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const groups = groupObjectsByMapping(scan.objects, mappingsStale ? [] : mappings);
  const total = groups.reduce((sum, group) => sum + group.count, 0);

  /* Bắt 0 đối tượng nghĩa là gì phụ thuộc HAI điều kiện, và bỏ qua điều nào cũng
     biến bảng này thành máy báo động giả:

     · **Ánh xạ tuỳ chọn** (`required: false`) bắt 0 là chuyện bình thường — bản
       vẽ này chỉ không có loại đó. Hồ sơ mặc định có hai ánh xạ như vậy, nên
       phiên bản đầu của bảng đã gắn "gần như chắc chắn sai" cho đúng hai dòng
       hoàn toàn lành.

     · **Danh sách bị cắt** thì số 0 KHÔNG có nghĩa là "không khớp gì", mà là
       "chưa quét tới". `acadstd:scan` chia một ngân sách 2.000 mục dùng CHUNG
       cho mọi ánh xạ, tiêu theo đúng thứ tự hồ sơ:
       `(if (< count maxItems) (scan-map … (- maxItems count)))`. Ánh xạ đầu ăn
       hết ngân sách là những ánh xạ sau không bao giờ được chạy. */
  const unknown = scan.objectsTruncated;
  const wrong = (group: { count: number; required: boolean }) =>
    group.count === 0 && group.required && !unknown;
  const alarms = groups.filter(wrong).length;

  const toggle = (id: string) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  return (
    <section className="panel">
      <header>
        <h2>Đối tượng đã nhận diện</h2>
        <div className="actions">
          {alarms ? <span className="tag">{alarms} quy tắc bắt buộc bắt 0</span> : null}
          <span className="tag mono">{total.toLocaleString("vi-VN")} đối tượng</span>
        </div>
      </header>

      {mappingsStale ? (
        <div style={{ padding: "var(--s3) var(--s4) 0" }}>
          <div className="banner">
            <span className="bm" />
            <span className="bt">
              <b>Chỉ hiện những gì lượt quét thật sự tìm được.</b> Hồ sơ đã đổi sau
              lượt quét này, nên danh sách ánh xạ hiện tại không phải danh sách đã
              sinh ra kết quả — quy tắc bắt 0 và cảnh báo đi kèm sẽ nói sai. Quét
              lại để thấy đủ.
            </span>
          </div>
        </div>
      ) : null}

      {scan.objectsTruncated ? (
        <div style={{ padding: "var(--s3) var(--s4) 0" }}>
          <div className="banner" data-tone="hard">
            <span className="bm" />
            <span className="bt">
              <b>
                Danh sách đã bị cắt ở {(scan.maxObjects || 2000).toLocaleString("vi-VN")}{" "}
                đối tượng.
              </b>{" "}
              Những con số dưới đây <b>không phải</b> tổng thật.
              {/* Bộ mẫu khuyên "quét lại trên phạm vi hẹp hơn". `/scan` chỉ nhận
                  `target` + `profileId` + `readOnly` — KHÔNG có tham số phạm vi,
                  nên lời khuyên đó chỉ ra một đường không tồn tại. Đường thật là
                  thu hẹp mẫu nhận diện ở màn Hồ sơ. */}
              {" "}Muốn con số đúng thì phải thu hẹp mẫu nhận diện của ánh xạ ở
              màn Hồ sơ tiêu chuẩn rồi quét lại — lượt quét không có tham số phạm
              vi để thu hẹp.
            </span>
          </div>
        </div>
      ) : null}

      <div className="tablewrap">
        <table className="data">
          <thead>
            <tr>
              <th>Ánh xạ</th>
              <th className="n">Đối tượng</th>
              <th className="n">Tổng diện tích</th>
              <th style={{ width: 44 }} />
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const zero = group.count === 0;
              const bad = wrong(group);
              const shown = open.has(group.id);
              return (
                /* Khoá đặt trên Fragment, không trên `<tr>` con: một nhóm sinh
                   ra HAI hàng, và React cần khoá ở phần tử ngoài cùng của map. */
                <Fragment key={group.id}>
                  <tr data-invalid={bad ? "true" : "false"}>
                    <td>
                      <b>{group.label}</b>{" "}
                      <span className="mono" style={{ color: "var(--muted)", fontSize: 11 }}>
                        {group.kind}
                      </span>
                      {bad ? (
                        <span className="cellerr">
                          Không bắt được đối tượng nào — quy tắc bắt buộc này gần
                          như chắc chắn sai
                        </span>
                      ) : null}
                      {zero && !bad ? (
                        <span className="hint" style={{ display: "block", marginTop: 2 }}>
                          {unknown
                            ? "Chưa rõ — danh sách bị cắt nên có thể quy tắc này "
                              + "chưa được quét tới, chứ không phải không khớp gì."
                            : "Không bắt được đối tượng nào. Quy tắc này không bắt "
                              + "buộc, nên có thể bản vẽ chỉ không có loại đó."}
                        </span>
                      ) : null}
                    </td>
                    <td className="n mono" style={bad ? { fontWeight: 650 } : undefined}>
                      {group.count.toLocaleString("vi-VN")}
                    </td>
                    <td className="n mono">{area(group.area, group.areaUnit)}</td>
                    <td style={{ textAlign: "right" }}>
                      {zero ? null : (
                        <Button onClick={() => toggle(group.id)} aria-expanded={shown}
                          aria-label={`Xem từng đối tượng của ${group.label}`}>
                          <Icon name="chevron" />
                        </Button>
                      )}
                    </td>
                  </tr>
                  {shown && !zero ? (
                    <tr>
                      <td colSpan={4} style={{ background: "var(--fg-02)", padding: 0 }}>
                        <div style={{ padding: "var(--s3) var(--s4)" }}>
                          <div className="tablewrap" style={{ maxHeight: 320 }}>
                            <table className="data">
                              <thead>
                                <tr>
                                  <th>Handle</th><th>Kiểu</th><th>Layer</th>
                                  <th className="n">Rộng</th><th className="n">Cao</th>
                                  <th className="n">Diện tích</th>
                                </tr>
                              </thead>
                              <tbody>
                                {group.objects.map((object, index) => (
                                  <tr key={`${object.handle}-${index}`}>
                                    <td className="mono">{object.handle || "—"}</td>
                                    <td className="mono">{object.type || "—"}</td>
                                    <td className="mono">{object.layer || "—"}</td>
                                    <td className="n mono">{size(object.width)}</td>
                                    <td className="n mono">{size(object.height)}</td>
                                    <td className="n mono">
                                      {area(object.area, object.areaUnit)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
            {!groups.length ? (
              <tr><td colSpan={4}>
                {/* Bảng rỗng có HAI nguyên nhân khác hẳn nhau, và bản vá lệch
                    phiên bản ở trên vừa tạo ra cái thứ hai: khi lệch, danh sách
                    ánh xạ truyền vào bị cố ý bỏ rỗng, nên một lượt quét không
                    tìm được gì sẽ rơi vào đúng nhánh này — rồi đi nói rằng hồ sơ
                    không có ánh xạ nào, trong khi nó có đủ. Sửa một lời nói dối
                    mà đẻ ra lời nói dối khác. */}
                <span className="hint">
                  {mappingsStale
                    ? "Lượt quét này không nhận diện được đối tượng nào. Các dòng "
                      + "quy tắc đã bị giữ lại vì hồ sơ đã đổi sau lượt quét — "
                      + "quét lại để thấy đủ."
                    : "Hồ sơ này chưa có ánh xạ nào, nên lượt quét không nhận diện "
                      + "đối tượng."}
                </span>
              </td></tr>
            ) : null}
          </tbody>
        </table>
      </div>

      <div style={{ padding: "var(--s3) var(--s4)", borderTop: "1px solid var(--border)" }}>
        <p className="hint" style={{ margin: 0 }}>
          Số đối tượng ở đây là cách <b>duy nhất</b> để kiểm một ánh xạ có đúng
          không — máy chủ chưa có đường thử một quy tắc chưa lưu. Rộng và cao theo
          đơn vị bản vẽ; diện tích theo đơn vị ghi cạnh số.
        </p>
      </div>
    </section>
  );
}

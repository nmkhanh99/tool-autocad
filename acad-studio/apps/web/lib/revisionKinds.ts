/** Bốn thứ khác nhau cùng tên "revision" — và không cái nào so được với cái nào.
 *
 * ## Vì sao cần một tệp riêng cho chuyện đặt tên
 *
 * Bốn khái niệm dưới đây có kiểu khác nhau, vòng đời khác nhau, và hỏng theo
 * những kiểu khác nhau. Chúng chỉ giống nhau ở đúng một điểm: cùng được gọi là
 * `revision`. Hệ quả không phải chuyện thẩm mỹ — nó là một lỗi **im lặng**:
 *
 * - Người viết mã đem `revision` của bản vẽ so với `revision` của hồ sơ. Hai bên
 *   luôn khác nhau, nên chốt nào dựa vào đó cũng nổ mọi lần, hoặc không bao giờ.
 * - Người dùng đọc hai chỗ ghi "Revision" với hai con số khác nhau trên cùng một
 *   màn hình, và không có cách nào biết đó là hai thứ khác nhau.
 *
 * `ROADMAP.md` ghi mục này là **chặn cho mọi màn hình viết sau**, và đây là thứ
 * gỡ chặn: một chỗ duy nhất đặt tên, để chỗ nào cần bày ra thì lấy nhãn ở đây.
 *
 * Cùng hình dạng với `lib/acadState.ts` — từ vựng tách khỏi cách đọc.
 */

export type RevisionKind =
  /** Bộ đếm của AutoCAD cho MỘT bản vẽ đang mở. Số nguyên. Chỉ có nghĩa khi kèm
   * `instance`: bộ đếm là của một phiên mở cụ thể, đóng rồi mở lại là một dãy số
   * khác hẳn.
   *
   * Nó **không** đo "người dùng đã sửa mấy lần". AutoCAD đẩy bộ đếm này lên cả
   * trong việc chỉ-đọc — `ssget "_X"` là một ví dụ. Dùng nó làm CHỐT ("thứ tôi
   * đọc lúc trước còn dùng được không") thì đúng; đọc nó thành "bản vẽ đã bị
   * sửa" thì màn hình báo một lượt sửa chưa từng xảy ra.
   *
   * Và dù là SỐ, nó vẫn không xếp được thứ tự: UNDO làm bộ đếm **lùi**. Chỉ so
   * bằng nhau, đừng bao giờ so lớn-bé. */
  | "document"
  /** Băm NỘI DUNG của hồ sơ quy tắc hoặc catalog block. Chuỗi. Cùng nội dung
   * cho ra cùng chuỗi, nên nó trả lời "nội dung có đổi không", KHÔNG trả lời
   * "cái nào mới hơn". Dùng cho `If-Match`. */
  | "content"
  /** Băm NỘI DUNG của một tài nguyên LISP: `sha256` trên mã nguồn + manifest +
   * **toàn bộ phụ thuộc lúc chạy**. Chuỗi. Cùng họ với `content` — chốt bằng
   * nhau, không xếp được thứ tự. Đổi một phụ thuộc cũng đổi mã này, dù chính
   * tài nguyên đó không sửa dòng nào. */
  | "manifest"
  /** Bản của MÔ HÌNH CadWeb, tiến theo mỗi delta và mỗi lượt chuyển epoch. Số
   * nguyên. **Không phải** phiên bản định dạng tệp — cái đó là
   * `manifest.formatVersion` (major.minor), một khái niệm khác hẳn. */
  | "cadweb";

export type RevisionLabel = {
  /** Nhãn ngắn cho bảng và danh sách. Phải ĐỌC ĐƯỢC MÀ KHÔNG cần ngữ cảnh —
   * chỉ ghi "Revision" là dựng lại đúng sự nhập nhằng tệp này sinh ra để dẹp. */
  label: string;
  /** Một câu nói nó đếm cái gì. Hiện khi rê chuột. */
  hint: string;
};

export const REVISION_LABELS: Record<RevisionKind, RevisionLabel> = {
  document: {
    label: "Mã chốt bản vẽ",
    hint: "Bộ đếm của AutoCAD cho bản vẽ đang mở này, dùng để biết dữ liệu đọc "
      + "lúc trước còn dùng được không. KHÔNG phải số lần sửa: cả thao tác "
      + "chỉ-đọc cũng làm nó nhảy. Đóng rồi mở lại là một dãy số khác.",
  },
  content: {
    label: "Mã nội dung hồ sơ",
    hint: "Băm nội dung của hồ sơ quy tắc hoặc catalog block. Nói được nội dung có "
      + "đổi hay không, KHÔNG nói được cái nào mới hơn.",
  },
  manifest: {
    label: "Mã chốt thư viện",
    hint: "Băm nội dung của tài nguyên LISP, tính cả phụ thuộc lúc chạy — đổi một "
      + "phụ thuộc là mã này đổi, dù tài nguyên không sửa dòng nào. Chốt bằng "
      + "nhau, KHÔNG xếp được thứ tự.",
  },
  cadweb: {
    label: "Bản mô hình CadWeb",
    hint: "Tiến theo mỗi delta và mỗi lượt chuyển epoch của mô hình. Không phải "
      + "phiên bản định dạng tệp — cái đó là formatVersion.",
  },
};

/** Nhãn của một loại. Dùng hàm chứ không tra thẳng bảng để chỗ gọi không phải
 * xử lý `undefined` — kiểu đã chặn giá trị lạ từ lúc biên dịch. */
export function revisionLabel(kind: RevisionKind): string {
  return REVISION_LABELS[kind].label;
}

export function revisionHint(kind: RevisionKind): string {
  return REVISION_LABELS[kind].hint;
}

/** So được thứ tự tới đâu — ba mức, không phải hai.
 *
 * `"none"`: băm nội dung. Chỉ trả lời "giống hay khác"; đem so lớn-bé là một
 * phép so vô nghĩa mà ngôn ngữ vẫn cho chạy.
 *
 * `"within-instance"`: bộ đếm bản vẽ. **Có** thứ tự, nhưng chỉ trong cùng một
 * `instance`. Plugin giữ nó trong `gDatabaseRevisions`, chỉ tăng (bốn chỗ `++`,
 * không chỗ nào giảm — kể cả UNDO, vì UNDO cũng chạy qua reactor) và **xoá** khi
 * bản vẽ đóng. Nên trong một phiên mở thì so lớn-bé đúng; qua hai phiên mở thì
 * bộ đếm bắt đầu lại từ đầu và phép so ra kết quả ngược.
 *
 * `"within-drawing-epoch"`: bản mô hình CadWeb. Tiến đều — mã CadWeb ném
 * `REVISION_MISMATCH` nếu một lượt chuyển epoch không đẩy số lên — nhưng chỉ
 * trong một `(drawingId, modelEpoch)`: `CadWebRevisionCursor` gồm đúng ba trường
 * đó, và mỗi bản vẽ bắt đầu `headRevision` từ 0. Bản 5 của bản vẽ này với bản 1
 * của bản vẽ kia không có quan hệ thứ tự nào.
 *
 * **Không có mức "toàn cục".** Cả hai loại có thứ tự đều kèm điều kiện, và tôi
 * đã vơ lấy "global" cho `cadweb` đúng vì nó là loại tôi chưa soi tới — cùng một
 * lối tắt, lặp hai lần trong hai vòng liền.
 *
 * Ba mức chứ không phải cờ đúng/sai, vì mức giữa mới là chỗ đã sai: tôi từng
 * viết `document` là "không xếp được" với lý do UNDO làm bộ đếm lùi — một khẳng
 * định tôi suy ra chứ không đo, và mã plugin nói ngược lại. Một cờ boolean thì
 * không có chỗ nào để nói ra điều kiện "cùng instance". */
export type RevisionOrdering = "none" | "within-instance" | "within-drawing-epoch";

export function revisionOrdering(kind: RevisionKind): RevisionOrdering {
  if (kind === "cadweb") return "within-drawing-epoch";
  if (kind === "document") return "within-instance";
  return "none";
}


/** Giá trị để bày ra, hoặc `"—"` khi chưa biết.
 *
 * `"—"` chứ không phải `0` hay chuỗi rỗng: một bộ đếm CHƯA ĐỌC ĐƯỢC khác hẳn
 * một bộ đếm bằng 0, và ở đây `0` là giá trị hợp lệ thật (bản vẽ vừa mở, chưa
 * sửa gì). Hai câu đó dẫn tới hai kết luận trái ngược về việc bản vẽ đã đổi hay
 * chưa. */
export function revisionText(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const text = String(value).trim();
  return text || "—";
}

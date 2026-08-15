/** Sáu nhóm phát hiện của lượt quét, tra bằng BẢNG chứ không bằng regex.
 *
 * ## Vì sao là bảng
 *
 * Panel cũ lọc theo tab bằng một regex tiếng Việt trên chính chuỗi `scope`:
 * `/frame|paper|scale|khung|tỷ lệ|ty le/`. Cách đó hỏng theo kiểu tệ nhất — máy
 * chủ đổi một chữ trong tên nhóm là phát hiện **biến mất khỏi màn hình mà không
 * báo gì**. Không phải lỗi đỏ, không phải danh sách rỗng: chỉ là vài dòng không
 * còn ở đó nữa, trong một màn hình người dùng dùng để tìm chỗ sai của bản vẽ.
 *
 * Bảng thì không tự sửa được chuyện đó — nhưng nó làm cho chuyện đó **kiểm được**:
 * `test-contract.mjs` so tập `scope:` trích từ `standardsEngine.ts` với tập `id`
 * ở đây, hai chiều. Máy chủ thêm nhóm mà quên thêm nhãn → đỏ. Bảng còn một hằng
 * số máy chủ không còn phát → cũng đỏ, vì một nhãn chết là một bộ lọc luôn rỗng.
 *
 * ## Nhóm LẠ không được làm biến mất phát hiện
 *
 * Đây là điểm quan trọng hơn cả bảng. Nếu một phát hiện mang `scope` không có
 * trong bảng, nó vẫn phải hiện ra — kèm chính tên thô của nhóm đó. Lọc bằng danh
 * sách CHO PHÉP là dựng lại đúng cái lỗi vừa dẹp, chỉ khác cơ chế. `normalizeIssue()`
 * còn có đường lùi riêng (`scope` rỗng → `"drawing"`), nên giá trị ngoài bảng là
 * chuyện có thật chứ không phải giả định.
 *
 * ## Không import `Issue`
 *
 * `check:boundaries` cấm feature import chéo feature, và bảng này thật sự không
 * cần biết một phát hiện gồm những gì — nó chỉ đọc `scope`. Kiểu cấu trúc tối
 * thiểu vừa tuân ranh giới vừa mô tả đúng phần phụ thuộc thật.
 */

/** Chỉ cần đúng một trường. Xem chú thích đầu tệp. */
export type HasScope = { scope: string };

export type ReviewScope = {
  /** Đúng chuỗi `scope` máy chủ phát ra. Khoá bằng bất biến ở `test-contract.mjs`. */
  id: string;
  label: string;
  /** Một câu nói nhóm này soi cái gì — hiện khi rê chuột lên chip. */
  hint: string;
};

/** Sáu nhóm, theo thứ tự từ "cả bản vẽ" xuống "từng đối tượng".
 *
 * Thứ tự có chủ ý: `unit` đổi thiết lập của **cả bản vẽ**, còn `mapping-required`
 * nói về những đối tượng lẻ. Người đọc quét từ trên xuống nên thứ gì ảnh hưởng
 * rộng nhất phải nằm trên cùng. */
export const REVIEW_SCOPES: readonly ReviewScope[] = [
  {
    id: "unit",
    label: "Đơn vị",
    hint: "Đơn vị, độ chính xác và định dạng số của cả bản vẽ.",
  },
  {
    id: "layer",
    label: "Layer",
    hint: "Layer thiếu, hoặc sai màu / nét / bề dày so với hồ sơ.",
  },
  {
    id: "dimstyle",
    label: "Kiểu kích thước",
    hint: "Dim style hiện hành và các DIM chưa theo mẫu.",
  },
  {
    id: "dim-row",
    label: "Hàng dim",
    hint: "DIM lệch khỏi hàng chuẩn — sửa bằng lệnh căn hàng.",
  },
  {
    id: "frame",
    label: "Khung tên",
    hint: "Khung bản vẽ so với khổ giấy trong hồ sơ.",
  },
  {
    id: "mapping-required",
    label: "Ánh xạ bắt buộc",
    hint: "Quy tắc ánh xạ khai là bắt buộc nhưng không bắt được đối tượng nào.",
  },
];

const BY_ID = new Map(REVIEW_SCOPES.map((scope) => [scope.id, scope]));

/** Nhãn của một nhóm, hoặc **chính tên thô** nếu bảng chưa biết nhóm đó.
 *
 * Trả tên thô chứ không trả "Khác": người dùng cần đọc được đúng chuỗi để đi
 * hỏi, và một nhóm gộp tên "Khác" giấu mất việc bảng đã lạc hậu. */
export function scopeLabel(scope: string): string {
  return BY_ID.get(scope)?.label ?? scope ?? "";
}

export function scopeHint(scope: string): string {
  return BY_ID.get(scope)?.hint ?? "Nhóm này chưa có trong bảng nhãn của giao diện.";
}

/** Một chip lọc. `scope: null` nghĩa là **không lọc**.
 *
 * `null` chứ không phải chuỗi `"all"`. Mọi giá trị chuỗi đều có thể là một
 * `scope` máy chủ phát ra thật — kể cả `"all"`, kể cả chuỗi RỖNG (`str()` trả
 * nguyên chuỗi rỗng chứ không rơi về mặc định, nên `scope: ""` đi thẳng tới đây).
 * Lấy một chuỗi làm cờ "không lọc" là biến đúng những nhóm đó thành thứ không
 * lọc được — bấm vào chip của chúng lại ra toàn bộ danh sách. `null` không phải
 * chuỗi nên không đụng được vào bất kỳ tên nhóm nào. */
export type ScopeChip = {
  /** `null` = chip "Tất cả". Ngoài ra là đúng chuỗi `scope` của phát hiện. */
  scope: string | null;
  label: string;
  hint: string;
  count: number;
  /** Nhóm này có trong bảng nhãn không. `false` = máy chủ phát ra thứ giao diện
   * chưa biết — vẫn hiện, vẫn lọc được, chỉ là mang tên thô. */
  known: boolean;
};

/** Chip lọc: "Tất cả", sáu nhóm đã biết, rồi mọi nhóm LẠ thật sự có trong danh sách.
 *
 * Sáu nhóm đã biết hiện **kể cả khi đếm 0** — số 0 là một câu trả lời ("bản vẽ
 * không có vấn đề layer nào"), không phải một chỗ trống. Nhóm lạ thì ngược lại,
 * chỉ hiện khi có thật: một chip trống mang tên máy móc là nhiễu.
 *
 * Tổng các chip nhóm LUÔN bằng chip "Tất cả". Đó là bất biến nhìn thấy được của
 * cái lỗi mà bảng này sinh ra để chặn — thiếu một phát hiện thì hai con số lệch.
 */
export function scopeChips(issues: readonly HasScope[]): ScopeChip[] {
  const counts = new Map<string, number>();
  for (const issue of issues) {
    counts.set(issue.scope, (counts.get(issue.scope) ?? 0) + 1);
  }
  const chips: ScopeChip[] = [
    {
      scope: null, label: "Tất cả", hint: "Mọi phát hiện của lượt quét.",
      count: issues.length, known: true,
    },
    ...REVIEW_SCOPES.map((scope) => ({
      scope: scope.id, label: scope.label, hint: scope.hint,
      count: counts.get(scope.id) ?? 0, known: true,
    })),
  ];
  for (const [id, count] of [...counts.entries()].sort()) {
    if (BY_ID.has(id)) continue;
    /* Nhãn của nhóm rỗng phải nói được thành lời — một chip không chữ thì không
       bấm được và không đọc được. */
    chips.push({
      scope: id,
      label: id === "" ? "(không có nhóm)" : id,
      hint: scopeHint(id),
      count,
      known: false,
    });
  }
  return chips;
}

/** Khoá React cho một chip. Chuỗi rỗng là khoá hợp lệ nhưng đụng với chip "Tất
 * cả" nếu cả hai cùng lùi về `""` — cho mỗi cái một tiền tố riêng. */
export function chipKey(chip: ScopeChip): string {
  return chip.scope === null ? "\u0000all" : `s:${chip.scope}`;
}

/** Lọc theo nhóm. `null` = không lọc.
 *
 * So giá trị BẰNG NHAU, không tra bảng: một `scope` ngoài bảng vẫn lọc được bằng
 * chính chip của nó, và không bao giờ bị loại chỉ vì bảng chưa biết nó. */
export function filterByScope<T extends HasScope>(
  issues: readonly T[],
  scope: string | null,
): T[] {
  if (scope === null) return [...issues];
  return issues.filter((issue) => issue.scope === scope);
}

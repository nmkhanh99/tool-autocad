"use client";

/** Sửa metadata một định nghĩa block.
 *
 * Ghi vào **thư viện**, không vào bản vẽ — không có AutoCAD nào bị chạm, không
 * có gì để `UNDO`, sửa lại là được. Vì thế nó KHÔNG dùng `ConfirmSheet`: đánh
 * đồng việc này với một lệnh ghi vào bản vẽ sẽ làm loãng cảnh báo ở đúng chỗ
 * cảnh báo cần có trọng lượng.
 *
 * Thứ nó phải làm tử tế thay vào đó là **không để mất công gõ**: nút Lưu chỉ
 * bật khi có thay đổi và dữ liệu hợp lệ, lỗi hiện ngay cạnh trường sai, và
 * người dùng huỷ được về bản gốc.
 */
import { useEffect, useId, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import {
  TECHNICAL_NAME_PATTERN,
  validateBlockDraft,
  type BlockDefinition,
  type BlockSpace,
} from "./model";

const SPACES: Array<{ value: BlockSpace; label: string }> = [
  { value: "model", label: "Model" },
  { value: "layout", label: "Layout" },
];

const splitTags = (text: string): string[] =>
  text.split(",").map((tag) => tag.trim()).filter(Boolean);

/** Bản nháp chỉ giữ ĐÚNG những trường form này sửa được — không phải cả
 * `BlockDefinition`.
 *
 * Đây là điều kiện để không mất công gõ. Danh mục được tải lại sau mỗi lệnh
 * `insert`/`sync`, và mỗi lần tải lại sinh ra object block hoàn toàn mới. Nếu
 * bản nháp là cả định nghĩa thì nó phải bị đặt lại theo object mới đó, và mọi
 * thứ đang gõ dở biến mất tuy người dùng không hề đổi sang block khác.
 *
 * Giữ hẹp lại cũng loại luôn một cái bẫy thứ hai: `syncStatus` do máy chủ quyết
 * định và tự đổi sau khi lưu (`synced` → `outdated`). Nếu nó nằm trong bản nháp
 * thì sau mỗi lượt lưu, nháp và máy chủ lệch nhau ở một trường người dùng không
 * sửa được, và nút Lưu sáng vĩnh viễn vì một "thay đổi" không ai tạo ra. */
type Draft = Pick<
  BlockDefinition,
  | "technicalName" | "displayName" | "description"
  | "defaultLayer" | "units" | "category" | "tags" | "allowedSpaces"
>;

const editableOf = (block: BlockDefinition): Draft => ({
  technicalName: block.technicalName,
  displayName: block.displayName,
  description: block.description,
  defaultLayer: block.defaultLayer,
  units: block.units,
  category: block.category,
  tags: block.tags,
  allowedSpaces: block.allowedSpaces,
});

export function BlockMetadataForm({ block, revision, saved, busy, onSave, onCancel }: {
  block: BlockDefinition;
  /** Revision của danh mục ở lần đọc gần nhất. */
  revision: string;
  /** Bản máy chủ VỪA GHI kèm revision mới, lấy thẳng từ phản hồi `PUT`. Đổi
   * identity đúng một lần cho mỗi lượt lưu thành công. */
  saved: { block: BlockDefinition; revision: string } | null;
  busy: boolean;
  onSave: (draft: BlockDefinition, expectedRevision: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => editableOf(block));
  /* Mốc để biết "đã sửa gì chưa". Không so thẳng với prop `block`: sau một lượt
     lưu thành công, `block` vẫn là bản CŨ cho tới khi danh mục tải lại xong. So
     với nó nghĩa là nút Lưu còn sáng suốt quãng đó — bấm lần nữa sẽ gửi
     `expectedRevision` cũ và ăn 409 — và nếu lần tải lại hỏng thì form không bao
     giờ về trạng thái sạch. */
  const [baseline, setBaseline] = useState<Draft>(() => editableOf(block));
  /* Revision mà bản nháp đang dựa trên — KHÔNG phải revision mới nhất của danh
     mục. Đây là chỗ khoá lại lỗ hổng ghi đè: nếu người khác sửa block này rồi
     danh mục được tải lại, `revision` mới về nhưng bản nháp vẫn là các giá trị
     cũ. Gửi kèm revision mới thì máy chủ chấp nhận và **xoá im lặng** thay đổi
     của người kia. Giữ revision của mốc thì máy chủ từ chối — đúng việc mà
     `expectedRevision` sinh ra để làm. */
  const [baselineRevision, setBaselineRevision] = useState(revision);
  /* `div.field` + `label htmlFor` là đúng cấu trúc của bộ mẫu. Bọc input trong
     một `<label>` thứ hai (label lồng label) là HTML không hợp lệ: trình duyệt
     đóng label ngoài sớm khi parse, hydrate lệch với cây React và mất luôn liên
     kết bấm-nhãn-để-focus. */
  const fieldId = useId();
  /* Ô Thẻ giữ NGUYÊN VĂN người dùng gõ, không phải `tags.join(", ")`.
     Render lại từ mảng đã tách sẽ nuốt đúng ký tự vừa gõ: gõ `van,` → tách ra
     `["van", ""]` → bỏ phần rỗng → render lại thành `van`, dấu phẩy biến mất
     trước khi kịp gõ thẻ thứ hai. Mảng `tags` vẫn cập nhật theo từng phím để
     `dirty` và validate chạy đúng; nguyên văn chỉ được chuẩn hoá khi rời ô. */
  const [tagsText, setTagsText] = useState(block.tags.join(", "));

  const merged: BlockDefinition = { ...block, ...draft };
  const dirty = JSON.stringify(draft) !== JSON.stringify(baseline);
  /* Các effect bên dưới cần đọc trạng thái mới nhất mà KHÔNG được phụ thuộc vào
     `draft` — phụ thuộc thì chúng chạy lại theo từng phím gõ. */
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const draftRef = useRef(draft);
  draftRef.current = draft;
  /** Bản nháp tại thời điểm bấm Lưu, để biết người dùng có gõ thêm trong lúc
   * chờ máy chủ trả lời không. */
  const submittedRef = useRef<Draft | null>(null);

  const adopt = (next: BlockDefinition, nextRevision: string) => {
    setDraft(editableOf(next));
    setBaseline(editableOf(next));
    setBaselineRevision(nextRevision);
    setTagsText(next.tags.join(", "));
  };

  /* Đổi định nghĩa: bỏ bản nháp cũ, kể cả khi đang sửa dở. Giữ lại là sửa nhầm
     block. Chỉ theo `block.id` — bám theo cả object sẽ đặt lại ở mọi lần tải
     lại danh mục, tức xoá phần đang gõ vì một việc người dùng không làm. */
  useEffect(() => {
    adopt(block, revision);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block.id]);

  /* Danh mục tải lại mà form KHÔNG sửa dở: nhận bản mới. Không có gì để mất, và
     bỏ qua nó nghĩa là form ngồi trên dữ liệu cũ rồi lưu đè lên thay đổi của
     người khác. Đang sửa dở thì giữ nguyên — cùng với `baselineRevision`, nên
     lượt lưu sau sẽ bị máy chủ từ chối thay vì ghi đè im lặng. */
  useEffect(() => {
    if (dirtyRef.current) return;
    adopt(block, revision);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [block, revision]);

  /* Sau một lượt lưu thành công thì dội bản nháp về đúng thứ máy chủ đã ghi.
     Máy chủ chuẩn hoá đầu vào (`sanitizeBlockDefinition` cắt khoảng trắng…),
     nên gõ `"Van "` rồi lưu sẽ để lại nháp `"Van "` bên cạnh bản đã ghi `"Van"`:
     nút Lưu sáng lại như thể còn thay đổi, và Hoàn tác thì đổi nội dung form
     một cách khó hiểu. Dùng phản hồi `PUT` chứ không đợi danh mục tải lại —
     lần tải lại đến sau và không phân biệt được nó với một lần tải lại bất kỳ. */
  useEffect(() => {
    if (!saved || saved.block.id !== block.id) return;
    /* Mốc và revision LUÔN theo máy chủ: lượt ghi đã xảy ra, revision đã tiến.
       Nhưng chỉ dội nội dung form khi người dùng chưa gõ thêm kể từ lúc bấm
       Lưu — ô nhập không bị khoá trong lúc chờ (không khoá được: `busy` dùng
       chung với `insert`, mà `insert` chờ tới 2 phút), nên dội vô điều kiện sẽ
       xoá đúng những gì họ vừa gõ. */
    setBaseline(editableOf(saved.block));
    setBaselineRevision(saved.revision);
    const typedMore = submittedRef.current !== null &&
      JSON.stringify(draftRef.current) !== JSON.stringify(submittedRef.current);
    submittedRef.current = null;
    if (typedMore) return;
    setDraft(editableOf(saved.block));
    setTagsText(saved.block.tags.join(", "));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  const invalid = validateBlockDraft(merged);
  const nameLooksWrong =
    draft.technicalName.length > 0 && !TECHNICAL_NAME_PATTERN.test(draft.technicalName.trim());

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));

  return (
    <div className="stack" style={{ gap: "var(--s3)" }}>
      <div className="eyebrow">Sửa metadata</div>

      <div className="field">
        <label htmlFor={`${fieldId}-technical`}>Tên kỹ thuật</label>
        <input
          id={`${fieldId}-technical`}
          className={nameLooksWrong ? "input invalid" : "input"}
          value={draft.technicalName}
          onChange={(event) => set("technicalName", event.target.value)}
          aria-invalid={nameLooksWrong || undefined}
        />
        <span className="hint">
          Tên này đi thẳng vào AutoCAD: chỉ ASCII, chữ/số/<code>.</code>/<code>_</code>/<code>-</code>.
        </span>
      </div>

      <div className="field">
        <label htmlFor={`${fieldId}-display`}>Tên hiển thị</label>
        <input
          id={`${fieldId}-display`}
          className="input"
          value={draft.displayName}
          onChange={(event) => set("displayName", event.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor={`${fieldId}-description`}>Mô tả</label>
        <textarea
          id={`${fieldId}-description`}
          className="input"
          rows={3}
          value={draft.description}
          onChange={(event) => set("description", event.target.value)}
        />
      </div>

      <div className="grid grid--2" style={{ gap: "var(--s3)" }}>
        <div className="field">
          <label htmlFor={`${fieldId}-layer`}>Layer mặc định</label>
          <input
            id={`${fieldId}-layer`}
            className="input"
            value={draft.defaultLayer}
            onChange={(event) => set("defaultLayer", event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor={`${fieldId}-units`}>Đơn vị</label>
          <input
            id={`${fieldId}-units`}
            className="input"
            value={draft.units}
            onChange={(event) => set("units", event.target.value)}
          />
        </div>
      </div>

      <div className="field">
        <label htmlFor={`${fieldId}-category`}>Nhóm</label>
        <input
          id={`${fieldId}-category`}
          className="input"
          value={draft.category}
          onChange={(event) => set("category", event.target.value)}
        />
      </div>

      <div className="field">
        <label htmlFor={`${fieldId}-tags`}>Thẻ</label>
        <input
          id={`${fieldId}-tags`}
          className="input"
          value={tagsText}
          onChange={(event) => {
            setTagsText(event.target.value);
            set("tags", splitTags(event.target.value));
          }}
          onBlur={() => setTagsText(splitTags(tagsText).join(", "))}
        />
        <span className="hint">Ngăn cách bằng dấu phẩy.</span>
      </div>

      <div className="field">
        <label>Không gian cho phép</label>
        <div className="row" style={{ gap: "var(--s3)" }}>
          {SPACES.map((space) => (
            <label className="check" key={space.value}>
              <input
                type="checkbox"
                checked={draft.allowedSpaces.includes(space.value)}
                onChange={(event) =>
                  set(
                    "allowedSpaces",
                    event.target.checked
                      ? [...draft.allowedSpaces, space.value]
                      : draft.allowedSpaces.filter((s) => s !== space.value),
                  )}
              />
              <span>{space.label}</span>
            </label>
          ))}
        </div>
      </div>

      {invalid && dirty ? (
        <div className="callout" data-kind="warn">
          <p>{invalid}</p>
        </div>
      ) : null}

      <div className="row" style={{ gap: "var(--s2)" }}>
        <Button
          variant="primary"
          disabled={!dirty || !!invalid || busy}
          onClick={() => {
            submittedRef.current = draft;
            onSave(merged, baselineRevision);
          }}
          title={!dirty ? "Chưa có thay đổi nào" : invalid || undefined}
        >
          {busy ? "Đang lưu…" : "Lưu metadata"}
        </Button>
        <Button
          disabled={!dirty || busy}
          /* Lấy bản MỚI NHẤT của máy chủ, không phải mốc cũ. Bình thường hai
             cái là một. Khác nhau đúng ở ca quan trọng: sau một lượt lưu bị từ
             chối vì người khác đã sửa, mốc là phiên bản không còn tồn tại — trả
             form về đó là kẹt lại trong vòng 409. Đây là đường ra duy nhất trên
             trang, nên nó phải dẫn tới bản đang có thật. */
          onClick={() => {
            adopt(block, revision);
            onCancel();
          }}
        >
          Hoàn tác
        </Button>
      </div>
    </div>
  );
}

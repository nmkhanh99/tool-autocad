"use client";

/** Nguồn thư viện block: xem danh sách và thêm nguồn mới.
 *
 * Bộ mẫu gọi đây là "thư mục nguồn" và có nút "Quét lại nguồn". Cả hai đều mô
 * tả sai việc backend làm — xem `features/blocks/sources.ts`. Màn hình này nói
 * đúng thứ đang xảy ra: một nguồn là **một file DWG** được ghi vào danh mục, và
 * nó chỉ có tác dụng khi một định nghĩa trỏ vào nó.
 *
 * Không dùng `ConfirmSheet`: ghi vào thư viện, không chạm bản vẽ nào.
 */
import { useId, useState } from "react";
import { Modal } from "../../components/ui/Modal";
import { Button } from "../../components/ui/Button";
import { sourceUsableForInsert } from "./sources";
import type { LibrarySource, LibrarySourceKind } from "./model";

const KINDS: Array<{ value: LibrarySourceKind; label: string }> = [
  { value: "dwg", label: "DWG — dùng để chèn được" },
  { value: "xtp", label: "XTP — chỉ ghi chú" },
  { value: "image", label: "Ảnh — chỉ ghi chú" },
];

export function SourcesDialog({ sources, busy, error, onAdd, onClose }: {
  sources: LibrarySource[];
  busy: boolean;
  /** Lỗi của lượt thêm gần nhất, hoặc rỗng. */
  error: string;
  /** Trả `true` khi máy chủ đã ghi. Form chỉ xoá trắng khi đó — hỏng hay gặp
   * nhất ở đây là 409, và bắt người dùng gõ lại một đường dẫn tuyệt đối dài chỉ
   * vì máy chủ bảo "tải lại rồi thử lại" là mất công vô cớ. */
  onAdd: (source: Omit<LibrarySource, "id">) => Promise<boolean>;
  onClose: () => void;
}) {
  const fieldId = useId();
  const [displayName, setDisplayName] = useState("");
  const [path, setPath] = useState("");
  const [kind, setKind] = useState<LibrarySourceKind>("dwg");

  const trimmedPath = path.trim();
  const pathLooksWrong = kind === "dwg" && trimmedPath.length > 0 && !/\.dwg$/i.test(trimmedPath);
  /* Chặn `~` ngay tại chỗ. Đây là phép kiểm ĐÁNG TIN: `linkedDwgSource()` gọi
     thẳng `existsSync(path)` và không có chỗ nào nở dấu ngã, nên một đường dẫn
     `~/...` chắc chắn hỏng — nhưng chỉ hỏng vào lúc chèn, cách đây nhiều thao
     tác, với thông điệp "không tìm thấy source DWG" chẳng nhắc gì tới dấu ngã. */
  const tildePath = trimmedPath.startsWith("~");
  const invalid = !displayName.trim()
    ? "Đặt tên cho nguồn để còn nhận ra nó trong danh sách."
    : !trimmedPath
      ? "Chưa có đường dẫn."
      : tildePath
        ? "Máy chủ không nở dấu ~ — viết đường dẫn tuyệt đối đầy đủ."
        : pathLooksWrong
          ? "Nguồn DWG phải trỏ tới một file .dwg, không phải thư mục."
          : "";

  return (
    <Modal
      title="Nguồn thư viện block"
      sub="GET · POST /api/acad/blocks/sources"
      wide
      onClose={onClose}
      footer={<Button onClick={onClose} disabled={busy}>Đóng</Button>}
    >
      <div className="stack" style={{ gap: "var(--s4)" }}>
        <div className="callout" data-kind="warn">
          <span className="lbl">Thêm nguồn không quét gì cả</span>
          <p>
            Máy chủ chỉ ghi đường dẫn vào danh mục — không có định nghĩa nào được
            tìm thấy hay nhập vào. Một nguồn chỉ có tác dụng khi bạn <strong>gán
            nó cho một định nghĩa</strong> ở ô “Nguồn DWG” trong phần sửa
            metadata. Khi đó, chèn định nghĩa ấy vào một bản vẽ chưa có nó sẽ lấy
            hình từ file này.
          </p>
        </div>

        <div>
          <div className="eyebrow">Đang có {sources.length} nguồn</div>
          {sources.length === 0 ? (
            <p className="hint">Chưa có nguồn nào.</p>
          ) : (
            <div className="stack" style={{ gap: "var(--s2)", marginTop: "var(--s2)" }}>
              {sources.map((source) => (
                <div key={source.id} className="panel" style={{ padding: "var(--s3)" }}>
                  <div className="row" style={{ gap: "var(--s2)", flexWrap: "wrap" }}>
                    <strong style={{ fontSize: 13 }}>{source.displayName}</strong>
                    <span className="tag tag--quiet">{source.kind}</span>
                    {sourceUsableForInsert(source) ? null : (
                      <span className="tag">không chèn được</span>
                    )}
                  </div>
                  <div className="mono hint" style={{ fontSize: 12 }}>{source.path}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="stack" style={{ gap: "var(--s3)" }}>
          <div className="eyebrow">Thêm nguồn</div>

          <div className="field">
            <label htmlFor={`${fieldId}-name`}>Tên nguồn</label>
            <input
              id={`${fieldId}-name`}
              className="input"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
            />
          </div>

          <div className="field">
            <label htmlFor={`${fieldId}-kind`}>Loại</label>
            <select
              id={`${fieldId}-kind`}
              className="select"
              value={kind}
              onChange={(event) => setKind(event.target.value as LibrarySourceKind)}
            >
              {KINDS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </div>

          <div className="field">
            <label htmlFor={`${fieldId}-path`}>Đường dẫn</label>
            <input
              id={`${fieldId}-path`}
              className={pathLooksWrong || tildePath ? "input invalid mono" : "input mono"}
              value={path}
              placeholder="/duong/dan/tuyet-doi/van-cong.dwg"
              onChange={(event) => setPath(event.target.value)}
              aria-invalid={pathLooksWrong || tildePath || undefined}
            />
            <span className="hint">
              Đường dẫn tuyệt đối tới <strong>một file</strong> trên máy này.
              Không dùng <code>~</code> — máy chủ kiểm bằng <code>existsSync</code>{" "}
              và không nở dấu ngã ra thành thư mục nhà. Đường dẫn cũng không được
              kiểm lúc lưu, nên viết sai chỉ lộ ra khi chèn.
            </span>
          </div>

          {error ? (
            <div className="callout" data-kind="stop">
              <span className="lbl">Không thêm được</span>
              <p>{error}</p>
            </div>
          ) : null}

          <div className="row" style={{ gap: "var(--s2)" }}>
            <Button
              variant="primary"
              disabled={!!invalid || busy}
              title={invalid || undefined}
              onClick={() => {
                void onAdd({ kind, displayName: displayName.trim(), path: trimmedPath })
                  .then((added) => {
                    if (!added) return;
                    setDisplayName("");
                    setPath("");
                  });
              }}
            >
              {busy ? "Đang thêm…" : "Thêm nguồn"}
            </Button>
            <span className="hint">Chưa có đường xoá nguồn — backend không có endpoint đó.</span>
          </div>
        </div>
      </div>
    </Modal>
  );
}

"use client";

/** Chuẩn bị lệnh **chọn đối tượng theo handle** trong AutoCAD.
 *
 * Đây là đường **hai pha** như mọi lệnh chạm vào AutoCAD: chuẩn bị → người xác
 * nhận → ghi. `POST /api/acad/highlight` cố tình trả 409 để không ai đi tắt.
 *
 * ## Vì sao guard phải lấy từ chính lượt đọc hình học
 *
 * `/selection/prepare` với `scope.kind = "handles"` đòi
 * `catalogGuard: {instance, revision}` và từ chối nếu lệch với bản vẽ hiện tại.
 * Guard đó **phải** là `document` của chính đợt hình học đã sinh ra handle —
 * không phải đọc thêm một lượt `/docs` cho mới. Ghép handle của lượt này với
 * guard của lượt khác là mở ra đúng khoảng thời gian giữa hai lượt: bản vẽ đổi
 * trong quãng đó thì handle trỏ sang đối tượng khác, guard vẫn hợp lệ, và người
 * dùng chọn nhầm thứ mình không nhìn thấy.
 *
 * Hệ quả có thật, phải nói ra ở giao diện: ảnh chụp cũ thì lệnh chọn **bị từ
 * chối** (`document_stale` / `drawing_stale`), không phải chọn nhầm. Đó là hành
 * vi đúng — nhưng người dùng cần biết cách gỡ là bấm "Đọc lại".
 *
 * ## Nó KHÔNG ghi vào bản vẽ
 *
 * Chọn chỉ đổi bộ chọn của phiên AutoCAD. Không sửa đối tượng nào, và `UNDO`
 * cũng không có gì để hoàn tác. Nhưng nó vẫn đi qua hàng chờ hai pha, vì backend
 * bắt vậy cho mọi thứ chạm vào tài liệu — và vì người dùng đang nhìn một ảnh
 * chụp, nên "chọn cái gì" là câu đáng để xác nhận.
 */
import { prepareStagedOp } from "./prepareApplyReject";
import type { StagedOp } from "./types";

/** Cặp guard mà `/selection/prepare` đòi khi chọn theo handle. */
export type CatalogGuard = { instance: string; revision: number };

/** Nhận **giá trị trần**, không nhận payload hình học: module này nằm ở
 * `staged-ops` nên không được biết gì về hình dạng dữ liệu của một feature khác.
 * Nơi gọi tự rút `handles` và `guard` ra từ đợt đọc của mình — và đó cũng là
 * chỗ duy nhất biết hai thứ đó có đến từ CÙNG một lượt đọc hay không. */
export function prepareSelectHandles(
  base: string,
  input: { target: string; handles: readonly string[]; guard: CatalogGuard | null },
): Promise<StagedOp> {
  if (!input.guard) {
    return Promise.reject(
      new Error(
        "Đợt đọc này không kèm mã phiên bản vẽ, nên không chọn an toàn được. Hãy đọc lại.",
      ),
    );
  }
  if (!input.handles.length) {
    return Promise.reject(new Error("Chưa chọn đối tượng nào."));
  }
  return prepareStagedOp(
    base,
    {
      action: "select",
      /* Đích là ĐƯỜNG DẪN TỆP, không phải tiêu đề: hai bản vẽ cùng tên mở cùng
         lúc là chuyện thường trong một bộ hồ sơ. */
      target: input.target,
      scope: { kind: "handles", handles: [...input.handles] },
      catalogGuard: input.guard,
    },
    { action: "select", fallbackCount: input.handles.length },
  );
}

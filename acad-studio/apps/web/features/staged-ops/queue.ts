/** Đọc hàng chờ ghi từ daemon — dữ liệu của màn "Thay đổi chờ duyệt".
 *
 * Tách khỏi `prepareApplyReject.ts` vì đó là **giao thức của một thao tác**,
 * còn đây là **cái nhìn toàn hàng chờ**. Hai việc khác nhau, và gộp lại sẽ kéo
 * mọi màn hình có nút ghi phải biết tới khái niệm danh sách.
 *
 * ## Hàng chờ sống trong bộ nhớ của daemon
 *
 * Không có tệp nào lưu nó. Khởi động lại daemon là mất sạch — và **không thao
 * tác nào được ghi**, nên đó là hành vi an toàn. Nhưng người dùng không đoán
 * được điều đó, nên màn hình phải nói ra.
 */
import { useEffect, useState } from "react";
import { asRecord, daemonRecord, type JsonRecord } from "../../lib/daemon/client";
import { DAEMON_BASE, endpoints } from "../../lib/daemon/endpoints";
import type { StagedAction, StagedOp } from "./types";

/** Trạng thái daemon phát ra. `applying` là cửa sổ hẹp giữa lúc nhận lệnh và
 * lúc AutoCAD trả lời — thấy nó nghĩa là có một lượt ghi ĐANG chạy. */
export type QueuedState =
  | "pending" | "applying" | "applied" | "rejected" | "failed" | "expired";

const STATES: readonly QueuedState[] = [
  "pending", "applying", "applied", "rejected", "failed", "expired",
];

export type QueuedOp = StagedOp & {
  state: QueuedState;
  /** Mốc hết hạn ISO. Daemon tính hết hạn **khi đọc**, không có bộ đếm giờ nền. */
  expiresAt: string;
  /** Tên bản vẽ để người đọc nhận ra; `target` là đường dẫn đầy đủ. */
  documentTitle: string;
  /** Layer đích của `move-to-layer`, nếu có. */
  toLayer: string;
  /** Phạm vi của `select`: `layer` / `block` / `handles`… và tên của nó.
   *
   * Thiếu nó thì hai đề xuất chọn trên CÙNG một bản vẽ trông y hệt nhau ở thẻ
   * xác nhận — người dùng không phân biệt được mình sắp chọn layer nào. */
  scopeKind: string;
  scopeName: string;
  error: string;
};

function str(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stateOf(value: unknown): QueuedState {
  const raw = str(value);
  return (STATES as readonly string[]).includes(raw) ? raw as QueuedState : "pending";
}

/** Số đối tượng, hoặc `undefined` khi daemon KHÔNG đếm được.
 *
 * Không quy về `0`: `0` nghĩa là "thao tác này không chạm đối tượng nào", còn
 * thiếu trường nghĩa là "không biết". Hai câu đó dẫn tới hai quyết định khác
 * nhau ở người sắp bấm một nút ghi không hoàn tác được. */
function countOf(operation: JsonRecord, action: string): number | undefined {
  /* `activate-document` KHÔNG chạm đối tượng nào. Daemon vẫn đặt
     `summary: { count: 1 }` ở đó, nhưng số 1 ấy là **bản vẽ**, không phải đối
     tượng — đọc chung một đường sẽ hiện "1 đối tượng" cho một lượt đổi tab. */
  if (action === "activate-document") return undefined;
  const summary = asRecord(operation.summary) || {};
  const raw = operation.subjectCount ?? summary.count ?? summary.subjectCount;
  if (raw === undefined || raw === null) return undefined;
  const count = Number(raw);
  return Number.isFinite(count) ? count : undefined;
}

export function normalizeQueuedOp(value: unknown): QueuedOp {
  const operation = asRecord(value) || {};
  const action = (str(operation.action) || "select") as StagedAction;
  const document = asRecord(operation.document) || {};
  const summary = asRecord(operation.summary) || {};
  return {
    id: str(operation.id),
    revision: str(operation.revision),
    action,
    target: str(operation.target),
    count: countOf(operation, action),
    state: stateOf(operation.state),
    expiresAt: str(operation.expiresAt),
    documentTitle: str(document.title) || str(operation.target),
    toLayer: str(summary.toLayer),
    scopeKind: str(summary.scopeKind) || str((asRecord(operation.scope) || {}).kind),
    scopeName: str(summary.scopeName) || str((asRecord(operation.scope) || {}).name),
    error: str(operation.error),
  };
}

/** Toàn bộ hàng chờ, mới nhất trước (daemon đã sắp). */
export async function listStagedOps(base: string): Promise<QueuedOp[]> {
  const body = await daemonRecord(
    await fetch(endpoints.selectionOperations(base), { cache: "no-store" }),
  );
  /* THIẾU `operations` là "máy chủ không trả lời được", không phải "hàng chờ
     rỗng". Rút về `[]` thì `load()` coi lượt đọc là thành công: nó xoá cờ cũ,
     dựng một bảng trống và nói rằng không có gì đang chờ — trong khi có thể đang
     có một lệnh ghi chờ xác nhận. Ném lỗi để nơi gọi GIỮ số liệu cũ và bày ra
     rằng lượt đọc hỏng. */
  if (!Array.isArray(body.operations)) {
    throw new Error("Phản hồi thiếu trường `operations` — không đọc được hàng chờ.");
  }
  return body.operations.map(normalizeQueuedOp).filter((operation) => operation.id);
}

/** Thao tác này còn xác nhận được không — và nếu không thì vì sao.
 *
 * Rỗng = ghi được. Một chỗ duy nhất cho cả nút lẫn thẻ xác nhận: mỗi cửa tự
 * kiểm lấy là mỗi cửa hở một kiểu, và ở đây cửa hở dẫn tới một lượt ghi chắc
 * chắn hỏng sau khi người dùng đã bấm.
 */
export function applyBlockedReason(op: QueuedOp, now: number): string {
  if (op.state === "applying") return "Lượt ghi này đang chạy trong AutoCAD.";
  if (op.state === "applied") return "Đã ghi rồi. Mỗi thao tác chỉ ghi được một lần.";
  if (op.state === "rejected") return "Đã bỏ. Chuẩn bị lại từ màn hình gốc nếu vẫn cần.";
  if (op.state === "failed") {
    return "Lượt ghi này đã hỏng. Không gọi lại cùng một id — chuẩn bị lại từ "
      + "màn hình gốc.";
  }
  if (op.state === "expired") return "Đã quá hạn. Chuẩn bị lại từ màn hình gốc.";
  /* Hết hạn tính khi ĐỌC ở phía daemon, nên một mục còn `pending` trên màn hình
     vẫn có thể đã chết. Kiểm lại theo đồng hồ của chính lượt render này. */
  if (isExpired(op.expiresAt, now)) {
    return "Đã quá hạn (danh sách này đọc lúc trước). Đọc lại rồi chuẩn bị lại.";
  }
  return "";
}

/** Bỏ được không. Daemon nhận `["pending", "failed"]` — mục hỏng cũng cần một
 * đường đóng lại, nếu không nó nằm đó tới khi bị đẩy ra vì quá số lượng. */
export function canReject(op: QueuedOp, now: number): boolean {
  if (op.state === "failed") return true;
  if (op.state !== "pending") return false;
  /* Còn `pending` trên màn hình KHÔNG đủ. Daemon tính hết hạn ngay đầu đường
     reject, rồi mới xét trạng thái — nên một mục để quá TTL sẽ nhận
     `operation_expired` chứ không bao giờ bỏ được. Nút sáng cho một lượt gọi
     chắc chắn hỏng là một ngõ cụt: người dùng bấm, thấy lỗi, và không hiểu vì
     sao "Bỏ" lại hỏng. */
  return !isExpired(op.expiresAt, now);
}

/** Mốc hết hạn này đã qua chưa — **theo đúng cách daemon tính**.
 *
 * Một chuỗi không đọc được (`Date.parse` ra `NaN`) là **chưa hết hạn**, vì
 * `NaN <= now` là `false` ở phía daemon: mục đó vẫn `pending` và vẫn bỏ được.
 * Suy ngược lại ở giao diện thì nút "Bỏ" tắt cho một thao tác máy chủ sẵn sàng
 * nhận — và người dùng không còn đường nào dọn nó đi.
 *
 * Tách ra vì hai nơi phải trả lời giống hệt nhau: `applyBlockedReason()` vốn đã
 * tính đúng (`NaN <= now` là `false` nên không chặn), còn `canReject()` thì viết
 * ngược (`NaN > now` cũng là `false` nên chặn). Hai hàm cạnh nhau trong cùng một
 * tệp mà nói ngược nhau: GHI thì được, BỎ thì không. */
function isExpired(expiresAt: string, now: number): boolean {
  if (!expiresAt) return false;
  return Date.parse(expiresAt) <= now;
}

/** Bỏ thao tác và **kiểm kết quả**.
 *
 * Khác `rejectStagedOp()` ở `prepareApplyReject.ts`: bản đó cố ý nuốt lỗi, vì
 * nó chạy lúc người dùng rời màn hình và khi đó không có gì để báo cho ai. Ở đây
 * người dùng **bấm nút "Bỏ"** và đang chờ câu trả lời — nuốt lỗi rồi báo "Đã bỏ"
 * là nói một điều có thể sai, và thao tác đó vẫn nằm trong hàng chờ chờ ai đó
 * xác nhận. */
export async function rejectQueuedOp(base: string, op: QueuedOp): Promise<void> {
  await daemonRecord(await fetch(endpoints.selectionOperationReject(base, op.id), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ revision: op.revision }),
  }));
}

/** Còn bao nhiêu giây, hoặc `undefined` khi không biết mốc hết hạn. */
export function secondsLeft(op: QueuedOp, now: number): number | undefined {
  if (!op.expiresAt) return undefined;
  const at = Date.parse(op.expiresAt);
  if (!Number.isFinite(at)) return undefined;
  return Math.max(0, Math.round((at - now) / 1000));
}

/** Số thao tác đang chờ, cho chip ở thanh trên và huy hiệu ở rail.
 *
 * Đọc từ **daemon**, cùng nguồn với màn "Thay đổi chờ duyệt". Trước đó hai chỗ
 * này đọc hai nguồn khác nhau — chip lấy từ một kho trong trình duyệt mà **không
 * hàm nào ghi vào**, nên nó vĩnh viễn bằng 0 trong khi hàng chờ thật có thể đầy.
 * Chú thích của chính kho đó đã viết: "cả ba phải đọc CÙNG một con số. Nếu chip
 * nói 2 mà màn hình nói 3 thì người dùng không còn tin được cái nào."
 *
 * Hỏi theo nhịp vì hàng chờ hết hạn theo thời gian và thao tác có thể được tạo
 * ở một tab khác. Lượt đọc hỏng thì **giữ số cũ**: một lần mạng trục trặc không
 * phải bằng chứng hàng chờ đã rỗng, và hiện `0` lúc đó là mời người dùng quên
 * mất một lệnh ghi đang chờ.
 */
/** Huy hiệu hàng chờ, dùng chung cho thanh trên và thanh điều hướng.
 *
 * Ba trạng thái, không phải hai — và trạng thái thứ ba là chỗ đã sai:
 *
 * - **Chưa đọc được lần nào** (`count === undefined`). Không có con số nào để
 *   nói, kể cả một con số cũ. Dán nhãn "số này của lần đọc trước" ở đây là bịa
 *   ra một lần đọc trước chưa từng có; người dùng sẽ đi tìm một con số không
 *   tồn tại. Và `—?` thì đọc như một giá trị hỏng, chứ không như "chưa biết".
 * - **Có số, lượt gần nhất hỏng.** Con số CÓ THẬT nhưng là của lượt trước, nên
 *   phải nói ra: `0` lúc này không chứng minh hàng chờ rỗng — một thao tác vừa
 *   chuẩn bị xong sẽ bị giấu sau đúng con số đó.
 * - **Có số, vừa đọc xong.** Nói thẳng con số.
 *
 * Gom vào một chỗ vì hai thanh cùng suy ra một thứ từ cùng một cặp dữ liệu: mỗi
 * nơi tự diễn giải là hai nơi lệch nhau, và lệch ở đây nghĩa là hai góc màn hình
 * nói hai điều khác nhau về cùng một hàng chờ. Ở đây còn kiểm được, trong
 * component thì không — dự án chưa có bộ dựng React trong test.
 */
export function pendingBadge(count: number | undefined, stale: boolean): {
  /** Chữ hiện trên huy hiệu. `"—"` = chưa đọc được lần nào. */
  text: string;
  /** Câu giải thích khi rê chuột. Rỗng = không có gì để nói thêm. */
  title: string;
  /** Nhãn cho trình đọc màn hình. Luôn thành câu, không bao giờ là ký hiệu. */
  aria: string;
  /** Sắc thái để CSS bắt. Ba giá trị, khớp đúng ba trạng thái ở trên.
   *
   * Cần một trường RIÊNG vì con số không diễn đạt được độ tin cậy: chip từng
   * dùng `data-count={pending ?? 0}`, nên `0` CŨ và `chưa đọc được` đều ra `"0"`
   * — và CSS lại tô `[data-count="0"]` thành màu "rỗng, yên tâm". Nghĩa là giao
   * diện trấn an người dùng đúng lúc con số không đáng tin. */
  tone: "empty" | "active" | "unsure";
} {
  if (count === undefined) {
    return {
      text: "—",
      title: stale ? "Chưa đọc được hàng chờ lần nào — lượt đọc gần nhất hỏng" : "",
      aria: "Chưa đọc được hàng chờ thay đổi",
      tone: "unsure",
    };
  }
  if (stale) {
    return {
      text: `${count}?`,
      title: "Lượt đọc gần nhất hỏng — số này của lần đọc trước",
      aria: `${count} thay đổi chờ duyệt (số của lần đọc trước)`,
      tone: "unsure",
    };
  }
  return {
    text: String(count),
    title: "",
    aria: `${count} thay đổi chờ duyệt`,
    tone: count > 0 ? "active" : "empty",
  };
}

/** Cổng "chỉ lượt đọc MỚI NHẤT được ghi kết quả".
 *
 * Nhịp đọc là `setInterval`, nên nó KHÔNG chờ lượt trước xong: một lượt chậm
 * hơn 5 giây là có hai lượt cùng bay. Chúng về theo thứ tự nào là chuyện của
 * mạng, không phải của thứ tự gửi — nên lượt CŨ về sau sẽ đè con số mới bằng
 * con số cũ. Trên thanh trên, cái đè đó có thể là `0` đè lên `1`, tức là giấu
 * mất một lệnh ghi đang chờ xác nhận. Cờ `stale` cũng vậy: một lượt cũ hỏng về
 * muộn sẽ dán nhãn "cũ" lên một con số vừa đọc xong.
 *
 * Tách khỏi hook vì hook không kiểm được — dự án chưa có bộ dựng React trong
 * test. Ở đây thì kiểm được, và đây mới là phần có logic.
 */
export function createLatestGate(): {
  /** Bắt đầu một lượt, trả về vé của nó. */
  begin: () => number;
  /** Vé này còn là lượt mới nhất không. */
  accepts: (ticket: number) => boolean;
} {
  let latest = 0;
  return {
    begin: () => ++latest,
    accepts: (ticket: number) => ticket === latest,
  };
}

export function usePendingOpsCount(intervalMs = 5_000): {
  count: number | undefined;
  /** Lượt đọc gần nhất HỎNG: số đang giữ là của lượt trước. */
  stale: boolean;
} {
  /* `undefined` = CHƯA BIẾT, khác hẳn `0` = "không có gì chờ". Khởi tạo bằng `0`
     là nói với người dùng rằng hàng chờ rỗng trước khi đọc được lần nào — và nếu
     lượt đọc đầu hỏng thì lời nói dối đó nằm mãi trên thanh trên, đúng chỗ sinh
     ra để nhắc rằng có một lệnh ghi đang chờ. */
  const [count, setCount] = useState<number | undefined>(undefined);
  const [stale, setStale] = useState(false);

  useEffect(() => {
    let alive = true;
    const gate = createLatestGate();
    const read = async () => {
      const ticket = gate.begin();
      try {
        const list = await listStagedOps(DAEMON_BASE);
        if (!alive || !gate.accepts(ticket)) return;
        setCount(list.filter((op) => op.state === "pending").length);
        setStale(false);
      } catch {
        /* Giữ số cũ — mất nó còn tệ hơn. Nhưng ĐÁNH DẤU là cũ: một thao tác
           chuẩn bị ngay trước lúc mạng trục trặc sẽ bị giấu đi sau con số `0` của
           lượt đọc trước, đúng chỗ sinh ra để nhắc đừng quên lệnh ghi. */
        if (!alive || !gate.accepts(ticket)) return;
        setStale(true);
      }
    };
    void read();
    const timer = setInterval(() => void read(), intervalMs);
    return () => { alive = false; clearInterval(timer); };
  }, [intervalMs]);

  return { count, stale };
}

/** Câu mô tả phạm vi, hoặc rỗng khi không có gì để nói.
 *
 * `layer A-WALL` đọc được ngay, còn `handles` thì tên không nói lên điều gì với
 * người dùng — lúc đó số đối tượng mới là thứ có nghĩa. */
export function scopeText(op: QueuedOp): string {
  const kind = op.scopeKind.trim();
  const name = op.scopeName.trim();
  if (!kind && !name) return "";
  if (kind === "handles") return "";
  const label = kind === "layer" ? "layer" : kind === "block" ? "block" : kind;
  return name ? `${label} ${name}` : label;
}

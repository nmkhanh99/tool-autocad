/** Bus sự kiện AutoCAD — kiểm phần dễ sai nhất: vòng đời đăng ký.
 *
 * Bus là primitive dùng chung, và lỗi của nó không lộ ra ngay: nó biểu hiện
 * thành "màn hình kia bỗng ngừng nhận sự kiện" nhiều thao tác về sau. Codex
 * review bắt được đúng một lỗi loại này (đăng ký trùng callback), nên phần vòng
 * đời được khoá bằng test thay vì bằng đọc code.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { subscribeAcadEvents, type AcadEvent } from "../features/acad-connection/events";

/* Bus chỉ gọi `new EventSource` lúc có subscriber đầu tiên, không lúc import —
 * nên gán global sau import tĩnh vẫn kịp, và không cần top-level await (output
 * CJS của tsx không hỗ trợ). */

type Frame = { data: string };

class FakeEventSource {
  static instances: FakeEventSource[] = [];
  onmessage: ((frame: Frame) => void) | null = null;
  onerror: (() => void) | null = null;
  closed = false;

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emit(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }

  emitRaw(data: string) {
    this.onmessage?.({ data });
  }

  static reset() {
    FakeEventSource.instances = [];
  }

  static get last(): FakeEventSource {
    const source = FakeEventSource.instances.at(-1);
    assert.ok(source, "chưa có EventSource nào được mở");
    return source;
  }
}

(globalThis as { EventSource?: unknown }).EventSource = FakeEventSource;

/** Mỗi test dùng một daemon URL riêng để bus không dính sang nhau. */
let counter = 0;
function freshDaemon(): string {
  counter += 1;
  FakeEventSource.reset();
  return `http://127.0.0.1:8788/#bus-${counter}`;
}

test("cùng một callback đăng ký hai lần thì huỷ độc lập", () => {
  const daemon = freshDaemon();
  const seen: string[] = [];
  const listener = () => seen.push("hit");

  const offFirst = subscribeAcadEvents(daemon, listener);
  const offSecond = subscribeAcadEvents(daemon, listener);
  const source = FakeEventSource.last;

  source.emit({ type: "drawingModified", t: 1 });
  assert.equal(seen.length, 2, "hai đăng ký thì nhận hai lần");

  offFirst();
  assert.equal(source.closed, false, "vẫn còn một đăng ký nên không được đóng kết nối");

  source.emit({ type: "drawingModified", t: 2 });
  assert.equal(seen.length, 3, "đăng ký còn lại phải tiếp tục nhận sự kiện");

  offSecond();
  assert.equal(source.closed, true, "hết đăng ký thì đóng kết nối");
});

test("gọi hàm huỷ hai lần không đóng nhầm kết nối của người khác", () => {
  const daemon = freshDaemon();
  const seen: string[] = [];

  const off = subscribeAcadEvents(daemon, () => seen.push("a"));
  subscribeAcadEvents(daemon, () => seen.push("b"));
  const source = FakeEventSource.last;

  off();
  off();
  assert.equal(source.closed, false, "huỷ lặp không được tính là hai lần rời đi");

  source.emit({ type: "docOpened", t: 3 });
  assert.deepEqual(seen, ["b"], "chỉ đăng ký chưa huỷ mới nhận sự kiện");
});

test("nhiều subscriber dùng chung một kết nối", () => {
  const daemon = freshDaemon();
  const off1 = subscribeAcadEvents(daemon, () => {});
  const off2 = subscribeAcadEvents(daemon, () => {});
  assert.equal(FakeEventSource.instances.length, 1, "chỉ được mở MỘT EventSource");
  off1();
  off2();
});

test("mở lại kết nối mới sau khi subscriber cuối rời đi", () => {
  const daemon = freshDaemon();
  subscribeAcadEvents(daemon, () => {})();
  assert.equal(FakeEventSource.instances[0].closed, true);

  const off = subscribeAcadEvents(daemon, () => {});
  assert.equal(FakeEventSource.instances.length, 2, "đăng ký sau phải mở kết nối mới");
  assert.equal(FakeEventSource.last.closed, false);
  off();
});

test("chuẩn hoá dấu thời gian: mili giây, giây, và thiếu", () => {
  const daemon = freshDaemon();
  const stamps: number[] = [];
  const off = subscribeAcadEvents(daemon, (event) => stamps.push(event.at));
  const source = FakeEventSource.last;

  source.emit({ type: "x", t: 1_700_000_000_000 }); // mili giây
  source.emit({ type: "x", t: 1_700_000_000 });     // giây
  const before = Date.now() / 1_000;
  source.emit({ type: "x" });                        // thiếu → giờ máy
  const after = Date.now() / 1_000;

  assert.equal(stamps[0], 1_700_000_000, "mili giây phải quy về giây");
  assert.equal(stamps[1], 1_700_000_000, "giây giữ nguyên");
  assert.ok(
    stamps[2] >= before && stamps[2] <= after,
    "thiếu dấu thời gian thì lấy giờ máy, không coi là 1970",
  );
  off();
});

test("một listener ném lỗi không làm câm listener khác", () => {
  const daemon = freshDaemon();
  const seen: string[] = [];
  const offBad = subscribeAcadEvents(daemon, () => { throw new Error("hỏng"); });
  const offGood = subscribeAcadEvents(daemon, () => seen.push("ok"));

  FakeEventSource.last.emit({ type: "drawingModified", t: 1 });
  assert.deepEqual(seen, ["ok"]);
  offBad();
  offGood();
});

test("khung không phải JSON không làm hỏng stream", () => {
  const daemon = freshDaemon();
  const seen: string[] = [];
  const off = subscribeAcadEvents(daemon, (event) => seen.push(event.type));
  const source = FakeEventSource.last;

  source.emitRaw("không phải json");
  source.emit({ type: "pluginLoaded", t: 1 });

  assert.deepEqual(seen, ["pluginLoaded"]);
  off();
});

test("trường thiếu được chuẩn hoá thành chuỗi rỗng, không phải undefined", () => {
  const daemon = freshDaemon();
  // Gom vào mảng thay vì gán biến `let … | null`: TypeScript không mô hình hoá
  // được việc callback đồng bộ gán biến, nên nó thu hẹp biến về `never` và mọi
  // truy cập trường sau đó đều là lỗi biên dịch.
  const received: AcadEvent[] = [];
  const off = subscribeAcadEvents(daemon, (event) => { received.push(event); });

  FakeEventSource.last.emit({ type: "docOpened", t: 1 });

  assert.equal(received.length, 1);
  const [event] = received;
  assert.deepEqual(
    { type: event.type, activeDoc: event.activeDoc, detail: event.detail },
    { type: "docOpened", activeDoc: "", detail: "" },
  );
  off();
});

test("mang theo số thứ tự và cờ phát lại", () => {
  /* Hai trường này là cách DUY NHẤT phân biệt một cú đổi tab thật với một dòng
     lịch sử daemon đẩy lại lúc mở kết nối. Dấu thời gian chỉ tới giây nên tự nó
     không phân biệt được — và nơi nào huỷ thao tác theo sự kiện sẽ huỷ oan một
     thao tác hợp lệ. */
  FakeEventSource.reset();
  const frames: AcadEvent[] = [];
  const stop = subscribeAcadEvents("http://daemon", (event) => frames.push(event));
  const source = FakeEventSource.last;

  source.emit({ t: 1700000000, n: 7, type: "layoutSwitched", detail: "02" });
  source.emit({ t: 1700000000, n: 7, type: "layoutSwitched", detail: "02", replay: true });
  assert.equal(frames[0].seq, 7);
  assert.equal(frames[0].replay, false);
  assert.equal(frames[1].replay, true);

  /* Plugin bản cũ không phát `n` → `0`. KHÔNG được bịa một số: hai sự kiện khác
     nhau mà cùng khoá thì một cái bị bỏ, và đó là cái có thể đang cần chặn. */
  source.emit({ t: 1700000001, type: "layoutSwitched", detail: "01" });
  assert.equal(frames[2].seq, 0);
  assert.equal(frames[2].replay, false);

  stop();
});

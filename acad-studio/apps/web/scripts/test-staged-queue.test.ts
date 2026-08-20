import assert from "node:assert/strict";
import test from "node:test";

import {
  applyBlockedReason,
  canReject,
  createLatestGate,
  pendingBadge,
  listStagedOps,
  normalizeQueuedOp,
  scopeText,
  secondsLeft,
} from "../features/staged-ops/queue";
import { documentMatchesTarget } from "../lib/daemon/docs";
import { ACAD_STATE_LABEL, busyText } from "../lib/acadState";
import { REVISION_LABELS, revisionOrdering, revisionText } from "../lib/revisionKinds";
import { stagedDrawPreviews, unwarnedPreviews } from "../lib/daemon/drawTarget";

const NOW = Date.parse("2026-08-18T10:00:00.000Z");
const at = (seconds: number) => new Date(NOW + seconds * 1000).toISOString();

test("số đối tượng: thiếu trường là KHÔNG BIẾT, không phải 0", () => {
  /* `0` nghĩa là "thao tác này không chạm đối tượng nào", còn thiếu trường nghĩa
     là "daemon không đếm được". Hai câu đó dẫn tới hai quyết định khác nhau ở
     người sắp bấm một nút ghi không hoàn tác được. */
  assert.equal(normalizeQueuedOp({ id: "a" }).count, undefined);
  assert.equal(normalizeQueuedOp({ id: "a", subjectCount: 0 }).count, 0);
  assert.equal(normalizeQueuedOp({ id: "a", summary: { count: 7 } }).count, 7);
  assert.equal(normalizeQueuedOp({ id: "a", subjectCount: "x" }).count, undefined);
});

test("trạng thái lạ không được đọc thành một trạng thái có thật", () => {
  assert.equal(normalizeQueuedOp({ id: "a", state: "applied" }).state, "applied");
  /* Bản daemon mới thêm trạng thái mà giao diện chưa biết: lùi về `pending` là
     lựa chọn AN TOÀN — nút ghi của nó vẫn đi qua `applyBlockedReason()`, và máy
     chủ mới là chốt cuối. */
  assert.equal(normalizeQueuedOp({ id: "a", state: "chua-tung-thay" }).state, "pending");
});

test("tên bản vẽ lùi về đường dẫn khi daemon không kèm document", () => {
  const withDoc = normalizeQueuedOp({
    id: "a", target: "/x/Ban ve.dwg", document: { title: "Ban ve.dwg" },
  });
  assert.equal(withDoc.documentTitle, "Ban ve.dwg");
  const bare = normalizeQueuedOp({ id: "a", target: "/x/Ban ve.dwg" });
  assert.equal(bare.documentTitle, "/x/Ban ve.dwg", "thà dài còn hơn trống");
});

test("một lý do chặn cho mọi cửa vào", () => {
  const base = normalizeQueuedOp({
    id: "a", revision: "r", state: "pending", expiresAt: at(60),
  });
  assert.equal(applyBlockedReason(base, NOW), "", "còn hạn thì ghi được");

  for (const [state, pattern] of [
    ["applying", /đang chạy/],
    ["applied", /một lần/],
    ["rejected", /Đã bỏ/],
    ["failed", /không gọi lại cùng một id|Không gọi lại cùng một id/],
    ["expired", /quá hạn/],
  ] as const) {
    assert.match(
      applyBlockedReason({ ...base, state }, NOW),
      pattern,
      `trạng thái ${state} phải nói đúng lý do của nó`,
    );
  }

  /* Daemon tính hết hạn KHI ĐỌC, nên một mục còn `pending` trên màn hình vẫn có
     thể đã chết từ lúc danh sách được tải. Không kiểm lại theo đồng hồ hiện tại
     thì nút sáng lên cho một lượt ghi chắc chắn bị từ chối. */
  assert.match(applyBlockedReason(base, NOW + 61_000), /quá hạn/);
  // Không biết mốc hết hạn thì KHÔNG kết luận là đã hết hạn.
  assert.equal(applyBlockedReason({ ...base, expiresAt: "" }, NOW + 999_000), "");
});

test("đếm ngược: không biết thì nói không biết", () => {
  const op = normalizeQueuedOp({ id: "a", expiresAt: at(90) });
  assert.equal(secondsLeft(op, NOW), 90);
  assert.equal(secondsLeft(op, NOW + 200_000), 0, "quá hạn thì 0, không âm");
  assert.equal(secondsLeft(normalizeQueuedOp({ id: "a" }), NOW), undefined);
  assert.equal(
    secondsLeft(normalizeQueuedOp({ id: "a", expiresAt: "hom qua" }), NOW),
    undefined,
    "mốc không phân tích được là KHÔNG BIẾT, không phải hết hạn",
  );
});

test("đổi bản vẽ KHÔNG phải là “1 đối tượng”", () => {
  /* Daemon đặt `summary: { count: 1 }` cho `activate-document`, nhưng số 1 ấy là
     BẢN VẼ chứ không phải đối tượng. Đọc chung một đường sẽ hiện "1 đối tượng"
     cho một lượt đổi tab — một con số đúng kiểu nhưng sai nghĩa, ở đúng chỗ
     người dùng đang cân nhắc có bấm hay không. */
  const activate = normalizeQueuedOp({
    id: "a", action: "activate-document", summary: { count: 1 },
  });
  assert.equal(activate.count, undefined);

  // Thao tác thật sự chạm đối tượng thì vẫn đếm như cũ.
  const move = normalizeQueuedOp({
    id: "b", action: "move-to-layer", summary: { count: 12 },
  });
  assert.equal(move.count, 12);
});

const at60 = () => new Date(NOW + 60_000).toISOString();

test("mục HỎNG cũng phải bỏ được", () => {
  /* Daemon nhận `["pending", "failed"]` ở đường reject. Khoá mục hỏng là để nó
     nằm lại trong danh sách tới khi bị đẩy ra vì quá số lượng — người dùng không
     có cách nào đóng nó lại. */
  const at = (state: string) => normalizeQueuedOp({ id: "a", state, expiresAt: at60() });
  assert.equal(canReject(at("pending"), NOW), true);
  assert.equal(canReject(at("failed"), NOW), true, "daemon nhận, giao diện cũng phải nhận");
  for (const dead of ["applied", "rejected", "expired", "applying"]) {
    assert.equal(canReject(at(dead), NOW), false, `${dead} không bỏ được`);
  }

  /* Còn `pending` trên màn hình KHÔNG đủ: daemon tính hết hạn ngay đầu đường
     reject rồi mới xét trạng thái, nên một mục quá TTL nhận `operation_expired`
     chứ không bao giờ bỏ được. Nút sáng cho một lượt gọi chắc chắn hỏng là ngõ
     cụt — người dùng bấm, thấy lỗi, và không hiểu vì sao "Bỏ" lại hỏng. */
  assert.equal(canReject(at("pending"), NOW + 61_000), false, "pending nhưng đã quá hạn");
  /* Không biết mốc hết hạn thì KHÔNG kết luận là đã hết hạn. */
  assert.equal(
    canReject(normalizeQueuedOp({ id: "a", state: "pending" }), NOW + 999_000),
    true,
  );
});

test("đích của thao tác so được ở CẢ BA dạng", () => {
  /* `op.target` có thể là đường dẫn, MÃ PHIÊN (bản vẽ chưa lưu, plugin có
     `targetsInstance`) hay tiêu đề — daemon chọn dạng nào là tuỳ năng lực plugin
     lúc chuẩn bị, và khách không suy ngược được.

     Một phép so `file || title` sẽ LUÔN lệch với mã phiên. Ở chỗ nó làm chốt an
     toàn thì "luôn lệch" nghĩa là chốt luôn nổ — chặn oan đúng nhóm bản vẽ chưa
     lưu mà nó sinh ra để bảo vệ. Đây là bẫy đã cắn nhiều lần trong dự án này. */
  const doc = {
    title: "Drawing1.dwg",
    file: "/x/Drawing1.dwg",
    instance: "AAA-001",
    active: true,
  };
  assert.equal(documentMatchesTarget(doc, "/x/Drawing1.dwg"), true, "theo đường dẫn");
  assert.equal(documentMatchesTarget(doc, "AAA-001"), true, "theo MÃ PHIÊN");
  assert.equal(documentMatchesTarget(doc, "Drawing1.dwg"), true, "theo tiêu đề");
  assert.equal(documentMatchesTarget(doc, "/x/Khac.dwg"), false);
  assert.equal(documentMatchesTarget(doc, ""), false, "đích rỗng không khớp gì cả");

  // Bản vẽ chưa lưu: không có `file`, chỉ có mã phiên và tiêu đề.
  const unsaved = { title: "Drawing1.dwg", instance: "BBB-002", active: true };
  assert.equal(documentMatchesTarget(unsaved, "BBB-002"), true);
  assert.equal(documentMatchesTarget(unsaved, "AAA-001"), false);
});

test("phạm vi phải đọc được, và im khi nó vô nghĩa", () => {
  /* Hai đề xuất CHỌN trên cùng một bản vẽ trông y hệt nhau nếu thẻ xác nhận chỉ
     có tên thao tác và số đối tượng. Đây là bước xác nhận cuối của một lệnh một
     lần — người dùng phải phân biệt được mình sắp chọn layer nào. */
  const layer = normalizeQueuedOp({
    id: "a", action: "select", summary: { scopeKind: "layer", scopeName: "A-WALL" },
  });
  assert.equal(scopeText(layer), "layer A-WALL");

  const block = normalizeQueuedOp({
    id: "b", action: "select", scope: { kind: "block", name: "VAN-DN80" },
  });
  assert.equal(scopeText(block), "block VAN-DN80", "đọc được cả từ `scope` lẫn `summary`");

  /* `handles` thì TÊN không nói lên điều gì với người dùng — số đối tượng mới là
     thứ có nghĩa, và bịa ra một nhãn ở đây chỉ làm rối. */
  const handles = normalizeQueuedOp({
    id: "c", action: "select", summary: { scopeKind: "handles", scopeName: "x" },
  });
  assert.equal(scopeText(handles), "");
  assert.equal(scopeText(normalizeQueuedOp({ id: "d" })), "", "không có gì thì im");
});

test("lượt đọc CŨ về muộn không được đè con số mới", () => {
  /* Nhịp đọc là `setInterval` nên nó không chờ lượt trước xong: một lượt chậm
     hơn 5 giây là có hai lượt cùng bay, và thứ tự VỀ là chuyện của mạng. Trên
     thanh trên, một con số cũ đè lên số mới có thể là `0` đè lên `1` — tức là
     giấu mất một lệnh ghi đang chờ xác nhận, đúng thứ thanh đó sinh ra để nhắc. */
  const gate = createLatestGate();

  const slow = gate.begin();
  const fast = gate.begin();

  assert.equal(gate.accepts(fast), true, "lượt mới nhất được ghi");
  assert.equal(gate.accepts(slow), false, "lượt cũ về sau thì bị bỏ");

  /* Kể cả khi lượt cũ HỎNG: dán cờ “số đang giữ là cũ” lên một con số vừa đọc
     xong là nói sai theo chiều ngược lại. Cùng một phép kiểm chặn cả hai. */
  assert.equal(gate.accepts(slow), false, "đường lỗi cũng đi qua đúng cổng này");

  /* Và lượt mới nhất vẫn ghi được nhiều lần — cổng không tự đóng sau một lượt,
     vì cùng một vé đi qua cả nhánh thành công lẫn nhánh lỗi. */
  assert.equal(gate.accepts(fast), true);

  const next = gate.begin();
  assert.equal(gate.accepts(fast), false, "có lượt mới thì lượt vừa rồi cũng hết hiệu lực");
  assert.equal(gate.accepts(next), true);
});

test("mỗi cổng đếm riêng — hai màn hình không cướp vé của nhau", () => {
  /* Cổng tạo TRONG effect, nên mỗi lần gắn là một cổng mới. Dùng chung một biến
     đếm toàn cục thì mở màn hình thứ hai là màn hình thứ nhất ngừng cập nhật. */
  const a = createLatestGate();
  const b = createLatestGate();
  const ticketA = a.begin();
  b.begin();
  assert.equal(a.accepts(ticketA), true, "cổng khác bấm vé không làm hỏng cổng này");
});

test("bản xem trước của bộ vẽ: đọc theo MÃ, và đọc hỏng ≠ rỗng", async () => {
  /* `POST /draw/target` gửi lệnh reject vào AutoCAD cho mọi bản xem trước còn
     `staged` — tức là XOÁ hình đã vẽ, không hoàn tác được. `/changes` gọi đường
     đó sau mỗi lượt `activate-document`, trên một hàng chờ nó không hề bày ra. */
  const real = globalThis.fetch;
  const reply = (body: unknown) => {
    globalThis.fetch = (async () => new Response(JSON.stringify(body), {
      status: 200, headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
  };
  try {
    reply({ ok: true, ops: [
      { opId: "b", state: "staged" },
      { opId: "x", state: "applied" },
      { opId: "a", state: "staged" },
      { opId: "y", state: "rejected" },
    ] });
    assert.deepEqual(await stagedDrawPreviews("http://x"), ["a", "b"],
      "chỉ mục còn staged, và sắp xếp để so được tập với tập");

    reply({ ok: true, ops: [] });
    assert.deepEqual(await stagedDrawPreviews("http://x"), [], "rỗng thật thì rỗng");

    /* Thiếu hẳn trường `ops` = máy chủ không trả lời được câu hỏi này. Khác hẳn
       một mảng rỗng, và hai câu đó dẫn tới hai quyết định khác nhau. */
    reply({ ok: true });
    assert.equal(await stagedDrawPreviews("http://x"), undefined,
      "thiếu trường = KHÔNG BIẾT, không phải rỗng");
  } finally {
    globalThis.fetch = real;
  }
});

test("thay một bản xem trước bằng cái khác thì SỐ không đổi — phải so bằng mã", () => {
  /* Đây là lý do phép so theo số lượng là sai. Người dùng đồng ý mất `a` và `b`;
     một tab khác bỏ `b` rồi dựng `c`. Vẫn hai bản xem trước, nhưng thứ sắp bị xoá
     đã khác — và `c` thì chưa ai cảnh báo về nó. */
  assert.deepEqual(unwarnedPreviews(["a", "b"], ["a", "c"]), ["c"],
    "mã lạ phải lộ ra dù tổng số y nguyên");

  /* Tập con thì đi tiếp được: mất ÍT hơn thứ người dùng đã đồng ý mất. */
  assert.deepEqual(unwarnedPreviews(["a", "b"], ["a"]), []);
  assert.deepEqual(unwarnedPreviews(["a", "b"], []), []);

  /* Chưa cảnh báo gì mà hàng chờ có thứ gì đó: mọi mã đều là mã lạ. */
  assert.deepEqual(unwarnedPreviews([], ["a"]), ["a"]);
  assert.deepEqual(unwarnedPreviews([], []), []);
});

test("chưa đọc được lần nào thì KHÔNG được nói “số của lần trước”", () => {
  /* Lượt đọc ĐẦU hỏng: chưa có con số nào tồn tại, kể cả một con số cũ. Trước
     đây thanh trên vẫn hiện `—?` kèm câu "số này của lần trước" — bịa ra một lần
     đọc chưa từng có, và người dùng đi tìm một con số không có thật. */
  const never = pendingBadge(undefined, true);
  assert.equal(never.text, "—", "`—?` đọc như một giá trị hỏng, không như “chưa biết”");
  assert.doesNotMatch(never.title, /lần đọc trước|lần trước/,
    "không được nhắc tới một lượt đọc trước chưa từng có");
  assert.match(never.title, /Chưa đọc được/, "nhưng vẫn phải nói là đang hỏng");
  assert.equal(never.aria, "Chưa đọc được hàng chờ thay đổi");

  /* Chưa đọc mà cũng chưa hỏng (lượt đầu đang bay): không có gì để nói thêm. */
  const loading = pendingBadge(undefined, false);
  assert.equal(loading.text, "—");
  assert.equal(loading.title, "", "đang đọc thì im lặng, không cảnh báo suông");

  /* CÓ số và lượt gần nhất hỏng: con số có thật, chỉ là cũ — phải nói ra. */
  const stale = pendingBadge(0, true);
  assert.equal(stale.text, "0?", "giữ con số, đánh dấu là cũ");
  assert.match(stale.title, /lần đọc trước/,
    "`0` cũ KHÔNG chứng minh hàng chờ rỗng — phải nói số này của lượt nào");

  const fresh = pendingBadge(3, false);
  assert.equal(fresh.text, "3");
  assert.equal(fresh.title, "");
  assert.equal(fresh.aria, "3 thay đổi chờ duyệt");
});

test("sắc thái không được suy từ con số — `0` cũ ≠ `0` thật", () => {
  /* Chip từng dùng `data-count={pending ?? 0}`, nên "0 CŨ" và "chưa đọc được lần
     nào" đều ra chuỗi `"0"`, và CSS tô `[data-count="0"]` thành màu "rỗng, yên
     tâm". Tức là giao diện trấn an người dùng đúng lúc con số không đáng tin —
     và cái nó giấu đi là một lệnh ghi đang chờ xác nhận. */
  assert.equal(pendingBadge(0, false).tone, "empty", "0 vừa đọc xong: rỗng thật");
  assert.equal(pendingBadge(0, true).tone, "unsure", "0 CŨ không được trông như rỗng");
  assert.equal(pendingBadge(undefined, false).tone, "unsure", "chưa đọc được cũng vậy");
  assert.equal(pendingBadge(undefined, true).tone, "unsure");
  assert.equal(pendingBadge(3, false).tone, "active");
  assert.equal(pendingBadge(3, true).tone, "unsure", "số cũ thì dù lớn cũng không chắc");
});

test("phản hồi THIẾU `operations` phải ném, không được hoá thành hàng chờ rỗng", async () => {
  /* `{ok: true}` mà không có `operations` là "máy chủ không trả lời được câu
     hỏi", không phải "không có gì đang chờ". Rút về `[]` thì màn hình coi lượt
     đọc là thành công: nó xoá cờ "số liệu cũ", dựng một bảng trống và nói rằng
     hàng chờ rỗng — trong khi có thể đang có một lệnh ghi chờ xác nhận. */
  const real = globalThis.fetch;
  const reply = (body: unknown) => {
    globalThis.fetch = (async () => new Response(JSON.stringify(body), {
      status: 200, headers: { "Content-Type": "application/json" },
    })) as typeof fetch;
  };
  try {
    reply({ ok: true });
    await assert.rejects(() => listStagedOps("http://x"), /operations/,
      "thiếu trường thì phải ném để nơi gọi giữ số liệu cũ");

    /* Mảng RỖNG thì khác hẳn: đó là một câu trả lời thật. */
    reply({ ok: true, operations: [] });
    assert.deepEqual(await listStagedOps("http://x"), [], "rỗng thật thì trả rỗng");

    reply({ ok: true, operations: [{ id: "op-1", action: "select", state: "pending" }] });
    assert.equal((await listStagedOps("http://x")).length, 1);
  } finally {
    globalThis.fetch = real;
  }
});

test("mốc hết hạn ĐỌC KHÔNG RA: bỏ được, và ghi cũng không bị chặn", () => {
  /* Daemon tính `Date.parse(expiresAt) <= now`, nên một chuỗi hỏng (`NaN`) là
     CHƯA hết hạn: mục đó vẫn `pending` và vẫn nhận lệnh bỏ. Giao diện suy ngược
     lại là tắt nút "Bỏ" cho một thao tác máy chủ sẵn sàng nhận — người dùng hết
     đường dọn nó đi.

     Nặng hơn nữa, hai hàm cạnh nhau từng nói ngược nhau: `applyBlockedReason`
     tính `NaN <= now` (false → cho ghi) còn `canReject` tính `NaN > now` (cũng
     false → cấm bỏ). GHI thì được mà BỎ thì không. */
  const now = Date.parse("2026-08-19T10:00:00.000Z");
  const broken = normalizeQueuedOp({ id: "a", state: "pending", expiresAt: "hôm qua" });

  assert.equal(canReject(broken, now), true, "đọc không ra mốc thì vẫn phải bỏ được");
  assert.equal(applyBlockedReason(broken, now), "", "và cũng không chặn ghi — hai bên phải khớp");

  /* Thiếu hẳn mốc cũng vậy: không có hạn thì không thể quá hạn. */
  const noExpiry = normalizeQueuedOp({ id: "a", state: "pending" });
  assert.equal(canReject(noExpiry, now), true);
  assert.equal(applyBlockedReason(noExpiry, now), "");

  /* Mốc ĐỌC ĐƯỢC và đã qua thì cả hai cùng chặn. */
  const dead = normalizeQueuedOp({ id: "a", state: "pending", expiresAt: "2026-08-19T09:00:00.000Z" });
  assert.equal(canReject(dead, now), false);
  assert.match(applyBlockedReason(dead, now), /quá hạn/);
});

test("lượt đọc ĐẦU chưa xong: rail và thanh trên phải nói cùng một điều", () => {
  /* Rail ẩn huy hiệu khi `pending === undefined && !stale`, trong khi thanh trên
     hiện `—`. Ở rail, "không có huy hiệu" đọc y hệt "không có gì chờ" — nên hai
     góc màn hình nói hai điều khác nhau về cùng một hàng chờ, đúng thứ
     `pendingBadge()` sinh ra để dẹp. Chỉ `empty` mới được ẩn. */
  assert.equal(pendingBadge(undefined, false).tone, "unsure", "lượt đọc đầu: chưa biết");
  assert.notEqual(pendingBadge(undefined, false).tone, "empty", "và KHÔNG được ẩn như hàng chờ rỗng");
  assert.equal(pendingBadge(0, false).tone, "empty", "chỉ 0 vừa đọc xong mới ẩn được");
});

test("trạng thái chờ không được CHẨN ĐOÁN thay daemon", () => {
  /* Daemon chỉ biết một điều: đã gửi job, chưa nhận `acad:write-result`. Hai
     chuyện rất khác nhau cùng ra trạng thái đó — job đang chạy thật, và job đã
     CHẾT giữa chừng (LISP lỗi, người dùng đóng hộp thoại) nên sẽ không bao giờ
     báo về. Ở ca thứ hai thì AutoCAD đang RẢNH, nên nhãn cũ "AutoCAD đang bận"
     chỉ sai chỗ, và người dùng đi tìm nhầm nguyên nhân. */
  assert.doesNotMatch(ACAD_STATE_LABEL.busy.label, /đang bận/,
    "nhãn không được khẳng định một nguyên nhân daemon không biết");
  assert.match(ACAD_STATE_LABEL.busy.label, /chờ/, "nói cái nó BIẾT: đang chờ kết quả");

  const now = Date.parse("2026-08-19T10:00:00.000Z");

  /* Có mốc thì nói ra: khác biệt giữa "app hỏng rồi" và "chờ thêm 40 giây nữa". */
  const withDeadline = busyText("2026-08-19T10:00:40.000Z", now);
  assert.match(withDeadline, /40 giây/);
  assert.match(withDeadline, /chậm nhất/,
    "mốc là cận TRÊN do nơi gửi khai — nói như một con số chính xác rồi vượt qua nó là nói dối");
  assert.match(withDeadline, /không phân biệt được/,
    "và phải nói thẳng là app KHÔNG biết đang ở ca nào");

  /* Không có mốc thì KHÔNG bịa một con số — hứa một cái hạn có thể không tới. */
  for (const missing of ["", undefined, "hôm qua"]) {
    assert.doesNotMatch(busyText(missing, now), /giây/,
      `mốc ${JSON.stringify(missing)} không đọc được thì không được đoán thời gian`);
  }
  /* Mốc đã qua cũng vậy: đếm ngược một khoá đã rụng là nói về lượt chờ không còn. */
  assert.doesNotMatch(busyText("2026-08-19T09:59:00.000Z", now), /giây/);
});


test("bốn loại “revision” phải có bốn NHÃN khác nhau", () => {
  /* Bốn khái niệm khác kiểu, khác vòng đời, hỏng theo bốn kiểu khác nhau — và
     giống nhau đúng một điểm: cùng tên `revision`. Hai chỗ trên cùng màn hình
     ghi "Revision" với hai con số khác nhau thì người đọc không có cách nào biết
     đó là hai thứ khác nhau. Trùng nhãn là dựng lại đúng chuyện đó. */
  const kinds = Object.keys(REVISION_LABELS) as (keyof typeof REVISION_LABELS)[];
  assert.equal(kinds.length, 4, "thêm/bớt một loại thì phải cập nhật cả mục nợ trong ROADMAP");

  const labels = kinds.map((kind) => REVISION_LABELS[kind].label);
  assert.equal(new Set(labels).size, labels.length, `nhãn trùng: ${labels}`);

  for (const kind of kinds) {
    const { label, hint } = REVISION_LABELS[kind];
    assert.ok(label.trim(), `${kind} thiếu nhãn`);
    assert.ok(hint.trim(), `${kind} thiếu câu giải thích`);
    /* Nhãn trần "Revision" là đúng thứ đang gây nhập nhằng — cấm nó ở đây, nếu
       không bảng này chỉ chép lại vấn đề vào một chỗ mới. */
    assert.notEqual(label.trim().toLowerCase(), "revision",
      `${kind}: nhãn phải nói nó đếm CÁI GÌ, không chỉ là "Revision"`);
  }
});

test("băm nội dung KHÔNG được đặt tên nghe như có thứ tự", () => {
  /* `content` và `manifest` đều là băm nội dung: chúng trả lời "giống hay khác",
     không trả lời "cái nào mới hơn". Đặt nhãn kiểu "Phiên bản …" là mời người
     đọc — và người viết — đem chúng so lớn-bé, một phép so vô nghĩa mà ngôn ngữ
     vẫn cho chạy.

     Đây không phải lo xa: tôi đã đặt đúng cái nhãn đó cho `manifest` ở bản đầu,
     trong khi nó là `sha256` trên nguồn + manifest + PHỤ THUỘC — đổi một phụ
     thuộc là mã đổi, dù tài nguyên không sửa dòng nào. */
  assert.equal(revisionOrdering("content"), "none");
  assert.equal(revisionOrdering("manifest"), "none");
  /* Ba mức chứ không phải cờ đúng/sai, vì mức GIỮA mới là chỗ tôi đã sai hai
     lần: đầu tiên để `document` là "có thứ tự" trơn (mời so giữa hai phiên mở),
     rồi sửa quá tay thành "không xếp được" với lý do UNDO làm bộ đếm lùi — một
     khẳng định tôi SUY RA chứ không đo. Mã plugin nói ngược: `gDatabaseRevisions`
     chỉ có `++` ở bốn chỗ, không chỗ nào giảm, và bị XOÁ khi bản vẽ đóng. Nên nó
     có thứ tự trong một phiên mở, và mất hết nghĩa qua hai phiên. */
  assert.equal(revisionOrdering("document"), "within-instance",
    "bộ đếm bản vẽ chỉ tăng, nhưng bắt đầu lại khi bản vẽ đóng — so trong CÙNG instance");
  /* Cũng CÓ ĐIỀU KIỆN: `CadWebRevisionCursor` gồm `(drawingId, modelEpoch,
     revision)` và mỗi bản vẽ bắt đầu từ 0, nên bản 5 của bản vẽ này với bản 1
     của bản vẽ kia không có quan hệ thứ tự nào. Không loại nào là toàn cục. */
  assert.equal(revisionOrdering("cadweb"), "within-drawing-epoch",
    "bản mô hình chỉ so được trong cùng một (drawingId, modelEpoch)");

  for (const kind of ["content", "manifest"] as const) {
    const { label, hint } = REVISION_LABELS[kind];
    assert.doesNotMatch(label, /[Pp]hiên bản|[Bb]ản dựng/,
      `${kind}: nhãn không được nghe như một phiên bản có thứ tự`);
    assert.match(hint, /KHÔNG|không xếp|không sửa dòng nào|giống hay khác|đổi hay không/,
      `${kind}: câu giải thích phải nói rõ nó không xếp được thứ tự`);
  }

  /* `cadweb` có thứ tự thật, nhưng nó đếm MÔ HÌNH chứ không phải TỆP: bản dựng
     của tệp là `manifest.formatVersion` (major.minor), một khái niệm khác hẳn.
     Gọi nó là "bản dựng .cadweb" thì một màn hình dòng thời gian viết sau sẽ bày
     ra sai loại phiên bản — đúng thứ bảng nhãn này sinh ra để chặn. Đây là nhãn
     tôi đặt sai ở bản đầu. */
  /* `document` có thứ tự, nhưng nó KHÔNG đếm số lần người dùng sửa: AutoCAD đẩy
     bộ đếm này lên cả trong việc chỉ-đọc (`ssget "_X"` là một ví dụ, xem
     `drawingChangedSince()` ở daemon). Gọi nó là "bản sửa" thì màn hình báo một
     lượt sửa chưa từng xảy ra — và người dùng đi tìm thứ mình không làm. Nó là
     một CHỐT: "dữ liệu tôi đọc lúc trước còn dùng được không". */
  const doc = REVISION_LABELS.document;
  assert.doesNotMatch(doc.label, /sửa/i,
    "nhãn document không được nói nó đếm số lần SỬA — thao tác chỉ-đọc cũng làm nó nhảy");
  assert.match(doc.hint, /KHÔNG phải số lần sửa|chỉ-đọc/,
    "câu giải thích phải nói rõ chỉ-đọc cũng làm nó nhảy");

  const cadweb = REVISION_LABELS.cadweb;
  assert.doesNotMatch(cadweb.label, /[Bb]ản dựng|\.cadweb|tệp/,
    "nhãn cadweb không được mô tả nó như phiên bản của TỆP");
  assert.match(cadweb.label, /mô hình/i, "phải nói rõ nó đếm mô hình");
  assert.match(cadweb.hint, /formatVersion/,
    "và câu giải thích phải chỉ ra formatVersion mới là phiên bản định dạng tệp");
});

test("`0` là một bộ đếm THẬT, không phải chưa biết", () => {
  /* Bản vẽ vừa mở chưa sửa gì thì `revision` đúng bằng `0`. Quy nó về "—" là
     nói "chưa đọc được" trong khi đã đọc được — và hai câu đó dẫn tới hai kết
     luận trái ngược về việc bản vẽ đã đổi hay chưa. */
  assert.equal(revisionText(0), "0");
  assert.equal(revisionText(121), "121");
  assert.equal(revisionText("abc123"), "abc123");

  for (const unknown of [null, undefined, "", "   "]) {
    assert.equal(revisionText(unknown), "—",
      `${JSON.stringify(unknown)} = chưa biết, phải hiện "—" chứ không phải rỗng`);
  }
});

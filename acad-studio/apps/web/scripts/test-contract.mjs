/** Bất biến của web app — những thứ không được phép hỏng trong lúc migrate.
 *
 * Bản trước đọc 6 file theo path cứng rồi assert trên nội dung chuỗi. Vấn đề:
 * mọi assert dạng PHỦ ĐỊNH (`!includes`, `doesNotMatch`) TỰ ĐỘNG XANH khi code
 * chuyển sang file khác — tức đúng những bất biến an toàn nhất sẽ âm thầm biến
 * mất đúng vào lúc chúng cần nhất, giữa một đợt di chuyển file.
 *
 * Bản này phân đôi theo bản chất của từng assert:
 *
 *   · PHỦ ĐỊNH  → chạy trên `all`, nối toàn bộ source. Di chuyển file không làm
 *     assert yếu đi; muốn tắt phải xoá dòng assert, và xoá thì thấy trong diff.
 *
 *   · KHẲNG ĐỊNH → chạy trên một file cụ thể, tra bằng ĐUÔI ĐƯỜNG DẪN thay vì
 *     path tuyệt đối. Di chuyển file làm nó đỏ, và đỏ ở đây là tín hiệu đúng,
 *     không phải phiền toái: người di chuyển phải xác nhận bất biến còn đúng.
 */
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const ROOTS = ["app", "components", "features", "lib"];

function walk(dir, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, acc);
    else if (/\.(tsx?|css)$/.test(full)) acc.push(full);
  }
  return acc;
}

const sources = ROOTS.flatMap((r) => walk(join(webDir, r))).map((full) => ({
  path: relative(webDir, full).split(sep).join("/"),
  text: readFileSync(full, "utf8"),
}));
assert.ok(sources.length > 0, "không tìm thấy source nào — kiểm tra ROOTS");

/** Toàn bộ source nối lại. Dùng cho assert phủ định: bất biến toàn dự án. */
const all = sources.map((s) => `/* ${s.path} */\n${s.text}`).join("\n");

/** Tra một file bằng đuôi đường dẫn. Đỏ khi file bị di chuyển là CỐ Ý. */
function sourceAt(suffix) {
  const hits = sources.filter((s) => s.path === suffix || s.path.endsWith(`/${suffix}`));
  assert.equal(
    hits.length,
    1,
    hits.length === 0
      ? `không thấy ${suffix}. Nếu file đã được di chuyển, sửa locator; nếu đã bị xoá có chủ ý,` +
        " xoá luôn các assert gắn với nó thay vì để chúng xanh một cách vô nghĩa."
      : `${suffix} khớp ${hits.length} file: ${hits.map((h) => h.path).join(", ")} — locator phải duy nhất`,
  );
  return hits[0].text;
}

/** Đếm số lần một mẫu xuất hiện trên toàn dự án. */
function countAll(pattern) {
  return [...all.matchAll(new RegExp(pattern, "g"))].length;
}

/** Bỏ comment trước khi đếm. Cần cho các bất biến dạng "chuỗi X chỉ được xuất
 * hiện đúng N lần": chính comment giải thích bất biến đó lại chứa chuỗi đó, nên
 * đếm thô sẽ luôn sai. Không bỏ `//` giữa dòng để không cắt nhầm URL. */
function stripComments(text) {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .join("\n");
}

const codeOnly = stripComments(all);

function countCode(pattern) {
  return [...codeOnly.matchAll(new RegExp(pattern, "g"))].length;
}

/** Như countCode nhưng bỏ qua những file được phép chứa mẫu đó. */
function countCodeExcept(pattern, ...allowed) {
  const text = sources
    .filter((s) => !allowed.includes(s.path))
    .map((s) => stripComments(s.text))
    .join("\n");
  return [...text.matchAll(new RegExp(pattern, "g"))].length;
}

const page = sourceAt("app/page.tsx");
const functions = sourceAt("functions.ts");
const preconstruction = sourceAt("PreconstructionPanel.tsx");
const styles = sourceAt("globals.css");

/* ── Thông tin bản vẽ: bất biến mang sang từ panel legacy ────────────────
 *
 * `DrawingInfoPanel.tsx` đã xoá (route `/drawing-info` thay). Phần lớn assert cũ
 * nói về kiến trúc cache-snapshot của riêng panel đó và chết theo nó. Bốn cái
 * dưới đây thì KHÔNG — chúng là ràng buộc về dữ liệu và về an toàn, đúng với bất
 * kỳ màn hình nào đọc `drawing-info`. */
const infoModel = sourceAt("features/drawing-info/model.ts");
const infoCatalog = sourceAt("features/drawing-info/ObjectCatalog.tsx");
const infoPage = sourceAt("app/(shell)/drawing-info/page.tsx");

assert.match(
  infoModel,
  /normalize\(raw\)\.selectionCatalog/,
  "danh mục đối tượng đọc từ một lượt quét không gian hiện hành",
);
assert.match(
  infoPage,
  /doc\.instance[\s\S]*?doc\.revision[\s\S]*?prepareSelectHandles/,
  "tập handle gửi đi bị ràng vào instance+revision của CHÍNH lượt đọc sinh ra nó",
);
assert.match(
  infoCatalog,
  /filterSubjects\([\s\S]*?pageOf\(/,
  "danh mục lớn được lọc và phân trang, không dựng hết một lúc",
);
assert.match(
  infoModel,
  /complete === true[\s\S]*?CHƯA đủ/,
  "danh mục quét dở không được trình bày như đã đủ",
);
assert.match(
  infoPage,
  /rawOpen && payload \? JSON\.stringify/,
  "JSON thô chỉ được dựng khi khối được mở",
);

/* ── Bất biến toàn dự án (phủ định) ─────────────────────────────────────── */

assert.doesNotMatch(
  all,
  /r\.results\.(?:filter|map)\(/,
  "error objects cannot reach an unchecked results operation",
);
for (const titleOnlyTarget of [
  "__target: act.title",
  "(docs.find((d: any) => d.active) || docs[0]).title",
  "(docs.find((d: any) => d.active) || docs[0] || {}).title",
  "value={d.title}",
]) {
  assert.ok(
    !all.includes(titleOnlyTarget),
    `no request targets a drawing by title alone: ${titleOnlyTarget}`,
  );
}
assert.doesNotMatch(all, /["'`]\/Users\//, "no source hardcodes a developer home path");
assert.doesNotMatch(
  all,
  /https?:\/\/(?:[^/\s]+\.)?(?:procore|acumatica|quickbooks)\b/i,
  "connector cards do not embed unreviewed external API endpoints",
);
assert.doesNotMatch(
  all,
  /\.precon-table td:last-child > button/,
  "last-column actions are not implicitly styled as destructive",
);
assert.doesNotMatch(
  all,
  /\[open, daemon, selectedTarget, refreshToken, reloadToken\]/,
  "generic AutoCAD change events do not trigger an automatic full scan",
);

/* MỘT luồng ghi duy nhất. Đây là bất biến an toàn quan trọng nhất của repo:
 * lệnh ghi vào bản vẽ KHÔNG HOÀN TÁC ĐƯỢC, và `confirmed: true` là thứ duy
 * nhất phân biệt "đã có người xem danh sách đối tượng và đồng ý" với "một lời
 * gọi HTTP nào đó". Ba bản sao (giai đoạn 2A gộp lại) nghĩa là ba chỗ có thể
 * lệch nhau mà không ai thấy. */
assert.equal(
  countCode("confirmed: true"),
  1,
  "chỉ features/staged-ops/prepareApplyReject.ts được gửi confirmed: true",
);
assert.ok(
  sources.some((s) =>
    s.path === "features/staged-ops/prepareApplyReject.ts" && s.text.includes("confirmed: true")),
  "luồng ghi phải nằm trong features/staged-ops/prepareApplyReject.ts",
);

/* Không màn hình nào được tự gọi thẳng endpoint hai pha. Nếu một màn hình dựng
 * lại lời gọi bằng tay, nó sẽ bỏ qua việc kiểm revision và câu chữ guard. */
assert.equal(
  countCodeExcept("/api/acad/selection/(?:prepare|operations)", "lib/daemon/endpoints.ts"),
  0,
  "prepare/apply/reject phải đi qua features/staged-ops, không gọi thẳng endpoint",
);

/* Chat sửa message theo ID, không theo vị trí. Mọi handler đều có dạng "thêm
 * chỗ giữ chỗ → await mạng → điền kết quả"; điền theo vị trí thì kết quả rơi
 * vào nhầm message ngay khi có gì chen vào giữa lúc await. */
assert.equal(countCode("patchLast\\("), 0, "không còn sửa message theo vị trí cuối");
assert.equal(
  countCode("messagesRef\\.current\\[") + countCode("bomIdxRef"),
  0,
  "không đọc message theo chỉ số mảng",
);
assert.doesNotMatch(
  codeOnly,
  /key=\{m\.id \|\|/,
  "key của message không được có fallback theo chỉ số — id là bắt buộc",
);
assert.match(
  page,
  /^  id: string;$/m,
  "Msg.id phải bắt buộc; `id?` mở lại đúng cửa cho lỗi kết quả rơi nhầm message",
);
/* `patchById` cố ý không làm gì khi ID đã biến mất. Nơi nào GIỮ một ID qua
 * nhiều thao tác phải tự kiểm sự hiện diện, nếu không tính năng tắt câm khi
 * người dùng đổi hội thoại. */
assert.match(
  page,
  /!messagesRef\.current\.some\(\(m\) => m\.id === id\)\) return liveBom\(\)/,
  "auto-BOM phải dựng thẻ mới khi thẻ cũ không còn trong hội thoại hiện tại",
);

/* ── Thẻ xác nhận KHÔNG được đóng khi lệnh còn đang bay ─────────────────────
 *
 * `busy` chỉ làm mờ nút ở chân thẻ; `Modal` vẫn gọi `onClose` khi bấm Esc hay
 * nền. Bấm xác nhận rồi bấm Esc là thẻ biến mất trong lúc yêu cầu còn đang bay —
 * rồi một lượt hỏng chỉ ghi vào chỗ hiển thị của chính thẻ đó, tức HỎNG TRONG IM
 * LẶNG trên một thao tác không hoàn tác được.
 *
 * Chốt ở PRIMITIVE, không ở từng nơi gọi: `/review` đã phải tự vá đúng cái này
 * một lần cho thẻ chọn đối tượng, và cửa thứ hai thì không ai nhớ. */
assert.match(
  sourceAt("ConfirmSheet.tsx"),
  /onClose=\{\(\) => \{ if \(!busy\) onCancel\(\); \}\}/,
  "ConfirmSheet không được huỷ khi đang gửi",
);

/** Đếm số lần một mẫu xuất hiện. Dùng thay `assert.match` ở những chốt có mặt ở
 * nhiều nhánh: hỏi "có xuất hiện không" thì gỡ mất chốt ở một nhánh vẫn xanh —
 * đã xảy ra ba lần trong đợt này. */
function occurrencesIn(source, pattern) {
  return [...source.matchAll(new RegExp(pattern, "g"))].length;
}

/* ── Xoá hồ sơ: ba đường hỏng phải xử đúng ──────────────────────────────────
 *
 * Cả ba đều là "hỏng mà trông như không hỏng", loại tệ nhất trên một thao tác
 * không lấy lại được. */
{
  const standards = sourceAt("app/(shell)/standards/page.tsx");
  /* 1. Lỗi phải hiện TRONG thẻ. `error` ở tầng trang nằm SAU thẻ, nên một lượt
        409 sẽ trông như "bấm xong không có gì xảy ra". */
  assert.match(
    standards,
    /catch \(failure\) \{[\s\S]{0,1400}?setDeleteError\(daemonFailureText\(failure\)\);/,
    "lượt xoá hỏng phải báo trong thẻ xác nhận, không phải sau lưng nó",
  );
  /* 2. Bỏ hồ sơ khỏi danh sách NGAY. `loadProfiles` nuốt lỗi mạng và giữ nguyên
        danh sách cũ, nên một lượt nạp hỏng sau khi DELETE đã thành công sẽ để hồ
        sơ vừa xoá nằm lại trên bảng. */
  assert.match(
    standards,
    /setProfiles\(\(prev\) => prev\.filter\(\(item\) => item\.id !== selected\.id\)\);/,
    "xoá xong phải bỏ hồ sơ khỏi danh sách ngay, không đợi lượt nạp lại",
  );
  /* 3. `If-Match` là chốt duy nhất chặn việc xoá một bản mình chưa từng thấy. */
  assert.match(
    standards,
    /"If-Match": selected\.revision/,
    "DELETE phải gửi If-Match theo bản ĐÃ LƯU",
  );

  /* 4. `/review` không được giữ một `profileId` đã biến mất khỏi danh sách —
        nút Quét sẽ sáng rồi ăn 404. */
  const review = sourceAt("app/(shell)/review/page.tsx");
  assert.match(
    review,
    /const chosen = preferId && list\.some\(\(item\) => item\.id === preferId\)/,
    "review phải bỏ hồ sơ đã chọn khi nó không còn trong danh sách",
  );
  /* 5. ĐỢI lượt nạp lại. Bỏ chạy nền thì hồ sơ cũ còn nguyên suốt lúc đang nạp,
        `driftNote` vẫn rỗng, và nút bật lại cho một lượt gửi nữa. */
  assert.match(
    review,
    /if \(code === "profile_stale" \|\| code === "profile_not_found"\) await loadProfiles\(\w+\);/,
    "nạp lại hồ sơ sau `profile_not_found` phải được `await`",
  );
  /* 6. Và nhớ lời máy chủ: một lượt nạp lại HỎNG làm `profilesKnown` thành false,
        rồi cảnh báo tắt và nút bật lại. Sự thật máy chủ đã nói không hết hạn theo
        lượt đọc danh sách. */
  /* Lời từ chối đi qua `rejectionNote()` — hàm THUẦN, có test hành vi — chứ không
     so `scanId` tại chỗ: nó còn phải hết hiệu lực khi hồ sơ quay về đúng nội dung
     lúc quét. */
  assert.match(
    review,
    /rejectionNote\(\{ scan, profile, rejected: scanRejected \}\)/,
    "lượt quét bị máy chủ từ chối phải đi qua rejectionNote()",
  );
  /* Và phải nhớ TRƯỚC khi nạp lại: lượt nạp có thể hỏng, và khi đó không còn gì
     nói cho người dùng biết lượt quét này đã chết. */
  assert.match(
    review,
    /if \(rejection\) setScanRejected\(\{ scanId: scan\.scanId, note: rejection \}\);\s*if \(rejection\) await loadProfiles/,
    "ghi nhớ lời từ chối TRƯỚC khi nạp lại danh sách",
  );
  /* Ba mã có ba nghĩa: dùng chung một câu là nói hồ sơ đã bị XOÁ trong khi nó
     chỉ vừa được SỬA. */
  assert.match(
    review,
    /code === "standards_revision_conflict"\s*\?\s*"Hồ sơ quy chuẩn đổi hoặc bị xoá trong lúc chờ/,
    "mã của chốt sau cửa khoá không được khẳng định là đã xoá",
  );
  /* 8. Nút "Quét lại" phải quét bằng id VỪA NẠP VỀ, không bằng closure.
        `setProfileId` chỉ xếp lịch một lượt cập nhật; hàm đang chạy giữ nguyên
        closure của lượt render đã dựng ra nó, nên `runScan()` trống tay quét
        bằng đúng cái id vừa chết. `await` không cứu được — chờ promise không làm
        closure mới ra đời. Phải CHUYỀN giá trị. */
  assert.match(
    review,
    /const loaded = await loadProfiles\(profileId\);[\s\S]{0,900}?if \(!loaded\.ok \|\| !loaded\.profileId\) return;[\s\S]{0,900}?await runScan\(loaded\.profileId\);/,
    "nút Quét lại phải dùng profileId do loadProfiles trả về",
  );
  /* 9. `loadProfiles` phải TRẢ VỀ sự thật của chính lượt đó. Đọc ngược lại từ
        state — hay từ một `ref` gán trong `useEffect` — là đọc một giá trị chưa
        tới. Đây là cái bẫy đã cắn nhiều lần trong tệp này. */
  assert.match(
    review,
    /Promise<\{ ok: boolean; profileId: string \}>/,
    "loadProfiles phải trả về { ok, profileId } thay vì để nơi gọi đọc lại state",
  );
  /* 11. Và phải tính id TRƯỚC mọi `setState`: hàm cập nhật của `setState` chạy ở
         lượt RENDER, nên gán vào biến ngoài rồi đọc lại ngay dòng sau là đọc một
         giá trị chưa được đặt. */
  assert.doesNotMatch(
    review,
    /setProfileId\(\(current\) => \{/,
    "đừng tính profileId bên trong updater rồi đọc lại — updater chạy lúc render",
  );
  /* 13. Override hồ sơ KHÔNG được bỏ qua các chốt khác. `overrideProfileId` sinh
         ra để nói "dùng hồ sơ NÀY", không phải để mở cửa cho một lượt quét chạy
         khi bản vẽ không còn hoạt động hay AutoCAD đã tắt. */
  /* Soi bản ĐÃ BỎ CHÚ THÍCH: chú thích ở đó trích nguyên văn dòng mã sai để giải
     thích vì sao nó sai, và một phép `doesNotMatch` trên nguyên văn sẽ bắt trúng
     chính lời giải thích ấy. */
  assert.doesNotMatch(
    stripComments(review),
    /if \(scanBlocked && !overrideProfileId\) return;/,
    "override hồ sơ không được bỏ qua mọi chốt quét",
  );
  assert.match(
    review,
    /if \(scanBlockedReason\(\{[\s\S]{0,200}?profileId: useProfileId,[\s\S]{0,120}?\}\)\) return;/,
    "runScan phải tính lại chốt với hồ sơ sắp dùng",
  );
  /* 16. Hai lượt nạp hồ sơ chồng nhau: lượt CŨ về muộn không được ghi đè lượt
         MỚI. Cùng lối vé với `docsSequence`/`scanSequence` đã có sẵn. */
  assert.match(
    review,
    /const ticket = \+\+profilesSequence\.current;/,
    "loadProfiles phải có vé chống phản hồi về muộn",
  );
  /* Kiểm ở CẢ HAI nhánh, và kiểm riêng từng cái: một phép so chung khớp được
     nhánh `catch` rồi báo xanh trong khi nhánh thành công đã mất chốt. */

  /* ĐẾM: mẫu này phải có ở CẢ HAI nhánh — thành công và lỗi. Một lượt nạp đã bị
     thay thế không có thẩm quyền gì, nên nó không được báo `ok` ở nhánh nào.
     Báo `ok: true` với một id mượn là để nơi gọi quét bằng hồ sơ có thể đã chết
     trong khi lượt mới còn đang chọn hồ sơ thay thế. */
  assert.equal(
    occurrencesIn(review, 'if \\(ticket !== profilesSequence\\.current\\) return \\{ ok: false, profileId: "" \\};'),
    2,
    "cả hai nhánh phải trả về THẤT BẠI khi lượt nạp đã bị thay thế",
  );
  /* Lượt quét hỏng chỉ kết luận về kết quả đang hiển thị khi nó dùng ĐÚNG hồ sơ
     vừa chết — quét bằng hồ sơ khác thì kết quả cũ có thể vẫn dùng được. */
  assert.match(
    review,
    /scannedProfileRef\.current === useProfileId/,
    "chỉ đánh dấu lượt quét đang hiển thị khi nó dùng đúng hồ sơ vừa chết",
  );
  /* 17. Chốt quét đọc từ GƯƠNG: `runScan` chạy qua một lượt `await` khi nút
         "Quét lại" nạp hồ sơ trước, nên closure giữ giá trị lúc bấm — mà AutoCAD
         tắt được và một lượt quét khác bắt đầu được trong quãng đó. */
  assert.match(
    review,
    /busy: scanBusyRef\.current,/,
    "chốt quét phải đọc cờ bận từ gương, không từ closure",
  );
  assert.match(
    review,
    /docsAlive: docsAliveRef\.current,/,
    "chốt quét phải đọc trạng thái plugin từ gương",
  );

  /* 14. Lượt nạp về muộn không được ghi đè lựa chọn MỚI của người dùng. */
  assert.match(
    review,
    /const now = profileIdRef\.current;\s*if \(now !== before\) \{/,
    "loadProfiles phải so với lựa chọn LÚC BẮT ĐẦU, không với kết quả nó tự chọn",
  );
  /* Bỏ chọn hồ sơ là hành động CÓ CHỦ Ý — "đừng quét gì cả". Một phép kiểm
     `if (now && …)` đọc nó thành "không đổi gì" rồi quét tiếp bằng hồ sơ cũ. */
  assert.match(
    review,
    /if \(!now\) return \{ ok: false, profileId: "" \};/,
    "bỏ chọn hồ sơ phải được hiểu là HUỶ, không phải là không đổi",
  );
  /* 15. Chốt chạy SAU cửa khoá job ném `standards_revision_conflict`; bỏ sót nó
         là để lượt quét đã chết nằm nguyên với nút Sửa còn sáng. */
  assert.match(
    review,
    /code === "standards_revision_conflict"/,
    "phải xử mã của chốt sau cửa khoá job",
  );

  /* 12. Bản vẽ đổi trong lúc chờ nạp hồ sơ thì bỏ lượt quét: closure giữ bản vẽ
         lúc bấm, và quét tiếp là bày kết quả của bản vẽ này dưới tên bản vẽ kia. */
  assert.match(
    review,
    /if \(targetRef\.current !== target\) return;/,
    "nút Quét lại phải bỏ cuộc khi bản vẽ đã đổi trong lúc chờ",
  );
  /* 10. Lượt QUÉT hỏng vì hồ sơ không còn thì KHÔNG được đánh dấu lượt quét đang
         HIỂN THỊ là chết — nó dùng hồ sơ khác, có thể vẫn sống. */
  assert.doesNotMatch(
    review,
    /setDeadProfileScan\(scan\?\.scanId/,
    "đừng gán cờ chết cho lượt quét đang hiển thị từ nhánh lỗi của lượt quét mới",
  );

  /* 18. `/standards` cũng phải có vé, và lượt XOÁ phải vô hiệu mọi lượt nạp đang
         bay TRƯỚC khi sửa danh sách. Nút "Thử lại" và lượt nạp lúc gắn không đặt
         `busy`, nên một lượt nạp vẫn bay được khi người dùng bấm Xoá — và nó về
         sau, mang ảnh chụp còn hồ sơ vừa xoá. */
  /* ĐẾM, đừng chỉ hỏi "có không". Hai lần trong đợt này một phép `assert.match`
     của tôi vẫn xanh sau khi đột biến gỡ mất chốt, chỉ vì cùng một mẫu còn xuất
     hiện ở một nhánh khác. */
  const occurrences = (source, pattern) =>
    [...source.matchAll(new RegExp(pattern, "g"))].length;

  assert.match(
    standards,
    /const ticket = \+\+profilesSequence\.current;/,
    "loadProfiles của /standards phải có vé",
  );
  assert.match(
    standards,
    /if \(ticket !== profilesSequence\.current\) return;/,
    "và phải KIỂM vé trước khi ghi danh sách — dựng vé mà không kiểm thì vô dụng",
  );
  /* Hai nhánh xoá — thành công và 404-đã-xoá-ở-nơi-khác — đều phải vô hiệu lượt
     nạp đang bay. Thiếu một nhánh là hồ sơ vừa xoá hiện lại ở đúng nhánh đó. */
  assert.equal(
    occurrences(standards, "profilesSequence\\.current \\+= 1;\\s*setProfiles\\(\\(prev\\) => prev\\.filter"),
    2,
    "cả hai nhánh xoá phải vô hiệu lượt nạp đang bay trước khi sửa danh sách",
  );

  /* 7. `/standards`: DELETE trả 404 nghĩa là ĐÃ xoá — báo lỗi là để lại dòng hồ
        sơ trên bảng và mời bấm lại đúng yêu cầu đó. */
  assert.match(
    standards,
    /failure\.status === 404 \|\| failure\.code === "profile_not_found"/,
    "DELETE 404 phải xử như đã xoá xong, không phải như lỗi",
  );
}

/* ── Xoá dữ liệu app KHÔNG được khoá theo trạng thái AutoCAD ────────────────
 *
 * `WriteButton` mờ đi khi AutoCAD chưa chạy hoặc đang bận — đúng cho lệnh ghi
 * vào bản vẽ, SAI cho một hồ sơ nằm trên đĩa của app. Dùng nhầm là nút Xoá hồ sơ
 * chết hẳn mỗi khi người dùng đóng AutoCAD, và không ai đoán ra vì sao.
 *
 * Khoá bằng mã nguồn vì dự án không có harness render React: đây là chỗ duy nhất
 * còn nói được. */
{
  const sheet = sourceAt("ConfirmSheet.tsx");
  assert.match(
    sheet,
    /mode === "data" \? \(\s*<Button/,
    "chế độ `data` phải dùng <Button>, không phải <WriteButton>",
  );
  /* KHÔNG neo vào dấu `;`: nó chỉ đúng khi `data` là chế độ CUỐI trong union, và
     thêm một chế độ mới ở sau làm phép kiểm này đỏ vì một lý do vô nghĩa. */
  assert.match(
    sheet,
    /\| "data"\n/,
    "ConfirmMode phải có chế độ `data` cho thao tác không chạm bản vẽ",
  );
  /* Đổi BẢN VẼ HOẠT ĐỘNG có chế độ riêng. Dùng chung `selection` là nói "bộ chọn
     sẽ đổi" và gắn nhãn nút "Chọn trong AutoCAD" — cả hai đều sai; dùng chung
     `session` thì câu "phiên chỉ trở lại như cũ khi đóng AutoCAD" cũng sai. */
  assert.match(
    sheet,
    /\| "document";/,
    "ConfirmMode phải có chế độ `document` cho việc đổi bản vẽ hoạt động",
  );
  assert.match(
    sourceAt("app/(shell)/changes/page.tsx"),
    /if \(action === "activate-document"\) return "document";/,
    "đổi bản vẽ hoạt động phải dùng chế độ xác nhận riêng",
  );

  /* Chip ở thanh trên, huy hiệu ở rail và màn "Thay đổi chờ duyệt" phải đọc CÙNG
     một nguồn. Trước giai đoạn 7 chip lấy số từ một kho trong trình duyệt mà
     KHÔNG hàm nào ghi vào — nó vĩnh viễn bằng 0 trong khi hàng chờ thật có thể
     đầy. Chú thích của chính kho đó đã viết ra bất biến này rồi. */
  /* `undefined` = CHƯA BIẾT, khác `0` = "không có gì chờ". Hiện `0` trước khi đọc
     được lần nào là nói dối ở đúng chỗ sinh ra để nhắc người dùng đừng quên một
     lệnh ghi đang chờ. */
  assert.match(
    sourceAt("features/staged-ops/queue.ts"),
    /useState<number \| undefined>\(undefined\)/,
    "số chờ duyệt phải bắt đầu ở CHƯA BIẾT, không phải 0",
  );
  /* Chữ trên huy hiệu giờ do `pendingBadge()` quyết — hành vi thật đã có test
     riêng ở `test-staged-queue.test.ts`, mạnh hơn phép so chuỗi này. Chỗ này chỉ
     còn chốt hai thanh CÙNG đi qua hàm đó: mỗi nơi tự diễn giải lại cặp
     `(pending, stale)` là hai góc màn hình nói hai điều khác nhau về cùng một
     hàng chờ — đúng cái đã xảy ra một lần (thanh trên hiện `—?` kèm câu "số của
     lần trước" khi chưa hề có lần trước nào). */
  for (const file of ["Titlebar.tsx", "Rail.tsx"]) {
    assert.match(
      sourceAt(file),
      /pendingBadge\(pending, !!pendingStale\)/,
      `${file} phải dùng chung pendingBadge, không tự diễn giải lại`,
    );
    assert.doesNotMatch(
      sourceAt(file),
      /pending === undefined \?/,
      `${file} không được tự quyết chữ cho trạng thái chưa biết`,
    );
  }
  /* Chip không được suy sắc thái từ con số: `pending ?? 0` biến cả "0 cũ" lẫn
     "chưa đọc được" thành `"0"`, và CSS tô giá trị đó thành "rỗng, yên tâm". */
  assert.doesNotMatch(
    sourceAt("Titlebar.tsx"),
    /data-count=\{pending \?\? 0\}/,
    "chip phải dùng data-tone của pendingBadge, không suy màu từ con số",
  );
  assert.match(
    sourceAt("app/design-system.css"),
    /\.stagedchip\[data-tone="unsure"\]/,
    "phải có kiểu riêng cho trạng thái không đáng tin",
  );
  /* Rail chỉ được ẩn huy hiệu khi hàng chờ CHẮC CHẮN rỗng. Suy từ
     `pending`/`pendingStale` thì lượt đọc ĐẦU (chưa có số, chưa hỏng) bị ẩn
     trong khi thanh trên hiện `—` — hai góc màn hình nói hai điều khác nhau về
     cùng một hàng chờ, và ở rail thì "không có huy hiệu" đọc như "không có gì". */
  assert.match(
    sourceAt("Rail.tsx"),
    /const showBadge = badge\.tone !== "empty";/,
    "rail chỉ được ẩn huy hiệu khi hàng chờ chắc chắn rỗng",
  );
  /* Lời báo thành công không được nói "không bản vẽ nào bị sửa" khi lượt vừa rồi
     đã xoá hình: `/draw/target` gửi lệnh reject vào AutoCAD cho từng bản xem
     trước còn `staged`. */
  assert.match(
    sourceAt("app/(shell)/changes/page.tsx"),
    /setNote\(\s*\n?\s*discarded/,
    "có bản xem trước bị huỷ thì lời báo phải nói ra, không dùng câu mặc định",
  );
  /* `/draw/target` huỷ TỪNG bản xem trước một và dừng ngay khi một cái hỏng —
     những cái trước đó đã bị xoá khỏi AutoCAD rồi. "Lời gọi hỏng" vì thế KHÔNG
     có nghĩa là "không mất gì", nên đường lỗi phải nói ra là không chắc thay vì
     để lời báo mặc định hứa rằng bản vẽ còn nguyên. */
  assert.match(
    sourceAt("app/(shell)/changes/page.tsx"),
    /previewsUncertain = doomed\.length > 0;\s*\n\s*await setDrawTarget/,
    "phải đánh dấu 'có thể đã xoá' TRƯỚC khi gọi đường huỷ",
  );
  assert.match(
    sourceAt("app/(shell)/changes/page.tsx"),
    /: previewsUncertain/,
    "hỏng giữa chừng thì lời báo không được dùng câu 'không bản vẽ nào bị sửa'",
  );
  /* Bảng rỗng vì LỖI trông y hệt bảng rỗng vì hàng chờ trống, mà hai câu đó
     ngược nhau. Chưa đọc được lần nào thì không hiện con số. */
  assert.match(
    sourceAt("app/(shell)/changes/page.tsx"),
    /\{hasData \? visible\.length : "—"\}/,
    "đếm ở tiêu đề bảng phải chờ đọc được rồi mới hiện",
  );
  /* Kích hoạt bản vẽ xong PHẢI đặt lại đích vẽ. Daemon giữ HAI đích khác nhau,
     và `activate-document` chỉ đổi cái của AutoCAD — bỏ bước này là lệnh vẽ tiếp
     theo ghi vào bản vẽ CŨ, trong khi thẻ xác nhận vừa hứa ngược lại. Màn hình
     legacy đã làm đúng từ lâu; màn mới thì không, cho tới khi review chỉ ra. */
  assert.match(
    sourceAt("app/(shell)/changes/page.tsx"),
    /if \(op\.action === "activate-document"\) \{[\s\S]{0,4000}?setDrawTarget\(DAEMON_BASE, op\.target\)/,
    "kích hoạt bản vẽ xong phải đặt lại đích vẽ",
  );
  /* Hai tab cùng mở màn này: lượt của tab A có thể về SAU lượt của tab B, ghi đè
     đích vẽ thành A trong khi bản vẽ đang mở là B. Kiểm bản vẽ ĐANG hoạt động
     trước khi đặt đích. */
  assert.match(
    sourceAt("app/(shell)/changes/page.tsx"),
    /snapshot\.docs\.filter\(\(doc\) => doc\.active\)/,
    "phải kiểm bản vẽ đang hoạt động trước khi đặt lại đích vẽ",
  );
  /* Chốt phải ĐÓNG khi không biết. Bản trước hỏi "có chắc là SAI không", nên đọc
     không ra bản vẽ hoạt động nào — hay đọc không tới AutoCAD — đều lọt xuống
     nhánh GỌI, mà nhánh gọi là nhánh xoá bản xem trước. `find` cũng không dùng
     được: nhiều bản vẽ cùng khai `active` thì nó nhặt cái đầu, tức đoán bừa ngay
     trước một lệnh không hoàn tác được. */
  assert.match(
    sourceAt("app/(shell)/changes/page.tsx"),
    /const confirmed = snapshot\.alive[\s\S]{0,200}?actives\.length === 1[\s\S]{0,200}?documentMatchesTarget\(actives\[0\], op\.target\)/,
    "chỉ đặt lại đích vẽ khi CHẮC CHẮN đúng: sống, đúng một bản vẽ hoạt động, và khớp đích",
  );
  assert.match(
    sourceAt("app/(shell)/changes/page.tsx"),
    /if \(!confirmed\) \{/,
    "không xác nhận được thì KHÔNG gọi đường xoá bản xem trước",
  );
  /* So bằng CẢ BA dạng đích. `file || title` luôn lệch với mã phiên, và chốt khi
     đó nổ mỗi lần — chặn oan đúng nhóm bản vẽ chưa lưu nó sinh ra để bảo vệ. */
  assert.match(
    sourceAt("app/(shell)/changes/page.tsx"),
    /documentMatchesTarget\(actives\[0\], op\.target\)/,
    "so đích phải dùng documentMatchesTarget, không phải file || title",
  );
  /* `/draw/target` HUỶ mọi bản xem trước còn `staged` của bộ vẽ — nó gửi lệnh
     reject vào AutoCAD, tức xoá hình đã vẽ, không hoàn tác được. Hàng chờ đó là
     một hàng chờ KHÁC, màn hình này không bày ra, nên nếu không nói trước thì một
     lượt xác nhận "chỉ đổi tab" lại âm thầm xoá hình của người dùng. Phải đọc và
     nói ra TRƯỚC nút bấm, không phải trong lời báo sau khi đã xoá. */
  assert.match(
    sourceAt("app/(shell)/changes/page.tsx"),
    /stagedDrawPreviews\(DAEMON_BASE\)/,
    "phải đọc hàng chờ bộ vẽ trước khi xác nhận activate-document",
  );
  assert.match(
    sourceAt("app/(shell)/changes/page.tsx"),
    /previews\.kind === "unknown"/,
    "đọc hỏng phải nói ra, không được im lặng như thể hàng chờ rỗng",
  );
  assert.match(
    sourceAt("app/(shell)/changes/page.tsx"),
    /Sẽ huỷ \{previews\.ids\.length\} bản xem trước/,
    "phải nói SỐ bản xem trước sắp bị huỷ, ngay trên thẻ xác nhận",
  );
  /* Cảnh báo chỉ bảo vệ được người dùng nếu nó KỊP hiện trước lúc bấm. Để nút
     sống trong lúc còn đang đọc `/draw/ops` là mở đúng cái cửa nó sinh ra để
     đóng: bấm nhanh là ghi mà chưa thấy câu nào. */
  assert.match(
    sourceAt("app/(shell)/changes/page.tsx"),
    /* Neo vào chính thuộc tính `blocked`. Bản đầu tôi viết chỉ khớp câu cảnh
       báo đang hiện ra — mà câu đó nằm ở chỗ khác trong cùng tệp, nên phép so
       vẫn xanh khi khoá bị gỡ. Đột biến bắt được; nếu không kiểm đột biến thì
       đây là một guardrail chỉ trông như đang canh.
       Giới hạn của nó: phép so nguồn chốt được CẤU TRÚC (nhánh còn nằm trong
       `blocked`), không chốt được HÀNH VI — chèn `false &&` vào giữa biểu thức
       thì nó vẫn xanh. Muốn chốt hành vi phải dựng component, mà dự án chưa có
       bộ dựng React trong test. Ghi ra đây để không ai tưởng nó mạnh hơn thật. */
    /blocked=\{applyBlockedReason\(confirming, now\)[\s\S]{0,200}?previews\.kind === "loading"/,
    "đang kiểm hàng chờ bộ vẽ thì phải KHOÁ nút xác nhận",
  );
  /* Đọc HỎNG cũng phải khoá, cùng lý do với phép kiểm lúc gửi. Để nút sống ở đây
     là hứa một điều lúc gửi sẽ từ chối: người dùng bấm, nhận lỗi, và không hiểu
     vì sao nút lại sáng. */
  assert.match(
    sourceAt("app/(shell)/changes/page.tsx"),
    /blocked=\{applyBlockedReason\(confirming, now\)[\s\S]{0,900}?previews\.kind === "unknown"/,
    "đọc hỏng hàng chờ bộ vẽ thì cũng phải KHOÁ nút xác nhận",
  );
  /* Và đọc lại NGAY TRƯỚC khi ghi: một tab khác có thể vừa dựng bản xem trước
     sau lúc thẻ hiện ra, nên câu người dùng đã đồng ý không còn đúng. Phải nằm
     TRƯỚC `applyStagedOp` — đó là điểm dừng sạch duy nhất. */
  assert.match(
    sourceAt("app/(shell)/changes/page.tsx"),
    /stagedDrawPreviews\(DAEMON_BASE\)\.catch[\s\S]{0,1800}?await applyStagedOp\(DAEMON_BASE, op\)/,
    "phải đọc lại hàng chờ bộ vẽ TRƯỚC khi ghi, không phải sau",
  );
  /* Đọc hỏng phải DỪNG. Hai phía không cân nhau: chặn nhầm thì người dùng thử
     lại, còn đi liều thì `/draw/target` xoá hình đã vẽ và không có đường về. */
  assert.match(
    sourceAt("app/(shell)/changes/page.tsx"),
    /if \(current === undefined\) \{[\s\S]{0,600}?return;/,
    "đọc hỏng hàng chờ bộ vẽ thì phải dừng, không được ghi tiếp",
  );
  /* So theo MÃ, không theo số lượng: một tab khác bỏ một bản xem trước rồi dựng
     cái mới thì con số y nguyên, nhưng thứ sắp bị xoá đã là thứ khác. */
  assert.match(
    sourceAt("app/(shell)/changes/page.tsx"),
    /unwarnedPreviews\(/,
    "phải so tập MÃ bản xem trước, không so số lượng",
  );
  assert.doesNotMatch(
    sourceAt("app/(shell)/changes/page.tsx"),
    /current > \(warned/,
    "phép so theo số lượng bỏ lọt trường hợp thay bản xem trước",
  );
  /* Thẻ xác nhận cuối phải chỉ ĐÚNG bản vẽ: hai bản vẽ đang mở có thể trùng tiêu
     đề, và đây là bước xác nhận của một lệnh MỘT LẦN. */
  assert.match(
    sourceAt("app/(shell)/changes/page.tsx"),
    /target=\{confirming\.target \|\| confirming\.documentTitle\}/,
    "thẻ xác nhận phải hiện đích chính xác, không phải tiêu đề có thể trùng",
  );
  /* Bộ lọc mặc định chỉ được giấu thứ người dùng đã TỰ quyết (đã ghi, đã bỏ).
     `failed`/`expired` là kết cục họ KHÔNG chọn — giấu chúng thì một lượt ghi
     hỏng ở tab khác đi qua trong im lặng, đúng bằng việc không có màn hình này. */
  assert.match(
    sourceAt("app/(shell)/changes/page.tsx"),
    /op\.state !== "applied" && op\.state !== "rejected"/,
    "bộ lọc mặc định không được giấu mục hỏng hay hết hạn",
  );

  /* Màn hình KHÔNG được hứa nhiều hơn nó làm. Daemon giữ nhiều hàng chờ rời
     nhau; bảng này mới đọc được một (bộ chọn). Bản xem trước của bộ vẽ nằm ở map
     khác — để câu "mọi lệnh ghi dừng ở đây" đứng nguyên là hứa thừa, và ở màn AN
     TOÀN thì lời hứa thừa nguy hiểm hơn một khoảng trống được nói rõ. */
  assert.match(
    sourceAt("app/(shell)/changes/page.tsx"),
    /chưa hiện ở đây/,
    "màn Thay đổi phải nói rõ hàng chờ của bộ vẽ chưa nằm trong bảng",
  );
  /* Huy hiệu ở rail cũng phải biết số đã cũ: `0` của một lượt đọc hỏng KHÔNG
     chứng minh hàng chờ rỗng. */
  assert.match(
    sourceAt("AppShell.tsx"),
    /pendingStale=\{pendingOps\.stale\}[\s\S]{0,200}?<Rail|<Rail[\s\S]{0,200}?pendingStale=\{pendingOps\.stale\}/,
    "rail cũng phải nhận tín hiệu số cũ",
  );

  /* Huy hiệu cũng phải nói khi số đã cũ — nếu không, một thao tác chuẩn bị ngay
     trước lúc mạng trục trặc bị giấu sau con số 0 của lượt đọc trước. */
  assert.match(
    sourceAt("features/staged-ops/queue.ts"),
    /setStale\(true\);/,
    "lượt đọc hỏng phải đánh dấu số là cũ",
  );
  /* Màn hình phải tự đọc lại: không thì huy hiệu (có nhịp) nói 2 trong khi bảng
     (một lượt duy nhất) vẫn trống — hai con số nói hai điều khác nhau. */
  assert.match(
    sourceAt("app/(shell)/changes/page.tsx"),
    /setInterval\(\(\) => void load\(\), 5_000\)/,
    "màn Thay đổi phải đọc lại theo nhịp, cùng nhịp với huy hiệu",
  );
  /* Lượt đọc lại hỏng thì số cũ phải được gắn nhãn là CŨ. */
  assert.match(
    sourceAt("app/(shell)/changes/page.tsx"),
    /stale \? " \(số của lần đọc trước\)" : ""/,
    "số của lượt đọc hỏng phải được gắn nhãn, không bày như số hiện tại",
  );

  /* Đọc hỏng thì không được khẳng định "0 thao tác đang chờ". */
  assert.match(
    sourceAt("app/(shell)/changes/page.tsx"),
    /sub=\{hasData/,
    "chỉ nói số khi đã có một lượt đọc THÀNH CÔNG",
  );

  /* `.banner` dùng `data-tone`; `data-kind` là của `.callout`. Gõ nhầm thì băng
     lỗi hiện ra như một băng thường — mất hẳn dấu hiệu mức độ. */
  assert.doesNotMatch(
    stripComments(sourceAt("app/(shell)/changes/page.tsx")),
    /className="banner" data-kind=/,
    "banner dùng data-tone, không phải data-kind",
  );
  /* Bẫy focus của `Modal` chỉ được đặt lại focus MỘT LẦN cho mỗi lượt mở. Để
     `onClose` trong deps là focus bị giật về ô đầu mỗi lần cha render lại. */
  assert.match(
    sourceAt("Modal.tsx"),
    /returnTo\?\.focus\?\.\(\);\s*\};\s*\}, \[\]\);/,
    "hiệu ứng bẫy focus của Modal không được phụ thuộc onClose",
  );

  assert.match(
    sourceAt("AppShell.tsx"),
    /usePendingOpsCount\(\)/,
    "huy hiệu hàng chờ phải đọc từ daemon, cùng nguồn với màn Thay đổi",
  );
  assert.equal(
    existsSync(join(webDir, "features/staged-ops/store.ts")),
    false,
    "kho hàng chờ trong trình duyệt đã chết (không ai ghi vào) — không được sống lại",
  );
  /* Và nó KHÔNG được nhắc `UNDO`: AutoCAD không biết gì về dữ liệu này, nên câu
     "gõ UNDO để hoàn tác" là một đường thoát không tồn tại. */
  const dataBranch = sheet.slice(
    sheet.indexOf('mode === "data" ? ('),
    sheet.indexOf('mode === "session" ? ('),
  );
  assert.ok(
    dataBranch.includes("không</strong> lấy lại được"),
    "cảnh báo của chế độ `data` phải nói rõ UNDO KHÔNG lấy lại được",
  );
}

/* ── Bất biến #7: bảng nhóm phát hiện = tập `scope` máy chủ thật sự phát ────
 *
 * Panel cũ lọc nhóm bằng regex tiếng Việt trên chính chuỗi `scope`, và cách đó
 * hỏng theo kiểu tệ nhất: máy chủ đổi một chữ là phát hiện biến mất khỏi màn
 * hình mà không báo gì. Bảng tra không tự chặn được chuyện đó — phép so HAI
 * CHIỀU dưới đây mới chặn.
 *
 * Chiều A (máy chủ → bảng): thêm nhóm mà quên thêm nhãn. Giao diện không giấu
 * phát hiện — `scopeChips()` dựng chip cho nhóm lạ — nhưng người dùng sẽ đọc một
 * tên máy móc, nên vẫn phải đỏ.
 * Chiều B (bảng → máy chủ): một hằng số máy chủ không còn phát là một chip vĩnh
 * viễn bằng 0 và một bộ lọc luôn rỗng. Nhãn chết còn tệ hơn không có nhãn. */
{
  const engine = readFileSync(
    join(webDir, "../daemon/src/standardsEngine.ts"), "utf8");
  const emitted = new Set(
    [...engine.matchAll(/scope: "([^"]+)"/g)].map((match) => match[1]));
  const table = new Set(
    [...sourceAt("features/review/scopes.ts").matchAll(/^\s+id: "([^"]+)",$/gm)]
      .map((match) => match[1]));

  assert.ok(emitted.size >= 6, `chỉ trích được ${emitted.size} scope từ standardsEngine.ts`
    + " — regex trích không còn khớp mã nguồn, và một phép so trên tập rỗng thì luôn xanh");
  const missing = [...emitted].filter((id) => !table.has(id)).sort();
  const dead = [...table].filter((id) => !emitted.has(id)).sort();
  assert.deepEqual(
    { missing, dead },
    { missing: [], dead: [] },
    `features/review/scopes.ts lệch với standardsEngine.ts — `
      + `thiếu nhãn: [${missing}] · nhãn chết: [${dead}]`,
  );
}

/* ── Bất biến #8: mọi nút "chạy thẳng vào AutoCAD" phải có handler thật ─────
 *
 * `functions.ts` khai `live: true` + `liveRecipe`; daemon dựng LISP trong
 * `opLisp()`. Recipe khai mà daemon không có `case` thì `/live` trả 400 và nút
 * đó **luôn báo lỗi** — không phải lúc AutoCAD trục trặc, mà mọi lần bấm.
 *
 * `ROADMAP.md` từng ghi ngờ đúng hai nút (`copyfloor`, `tagmeta`) là hỏng kiểu
 * này. Đối chiếu ra cả hai đều CÓ handler, và cả `livedraw` nữa; mục nợ đó viết
 * theo suy đoán chứ không theo đo đạc. Phép so này thay chỗ cho suy đoán.
 *
 * Ba cái bẫy khi tự đo, đã trả giá đủ cả ba:
 * 1. **Bóc chú thích trước.** Dòng khai kiểu có ghi `// … (mặc định "drawpipes")`
 *    — regex ngây thơ đếm nó thành một khai báo.
 * 2. **So nhãn `case`, đừng GỌI hàm.** `opLisp(id, {})` trả `null` cho cả id
 *    không tồn tại lẫn id tồn tại nhưng thiếu tham số. Gọi hàm với tham số đoán
 *    bừa thì hai chuyện khác hẳn nhau ra cùng một kết quả.
 * 3. **Nhớ giá trị mặc định.** Thiếu `liveRecipe` thì recipe là `"drawpipes"`;
 *    bỏ qua nó là báo oan một mục hoàn toàn lành. */
{
  const daemon = readFileSync(join(webDir, "../daemon/src/session.ts"), "utf8");
  const uncomment = (text) => text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  const opLispBody = uncomment(daemon.slice(
    daemon.indexOf("export function opLisp"),
    daemon.indexOf("export function recipeBody"),
  ));
  const handled = new Set([...opLispBody.matchAll(/case "([^"]+)"/g)].map((m) => m[1]));
  assert.ok(handled.size >= 5,
    `chỉ trích được ${handled.size} case từ opLisp() — regex trích không còn khớp mã`
    + " nguồn, và một phép so trên tập rỗng thì luôn xanh");

  /* Cắt theo mốc `{ id: "` nên mỗi mục dừng đúng ở mục kế — không có chuyện
     `live: true` của mục sau bị tính cho mục trước. */
  const entries = uncomment(sourceAt("app/functions.ts")).split(/\{\s*id:\s*"/).slice(1);
  assert.ok(entries.length >= 10,
    `chỉ đọc được ${entries.length} mục từ functions.ts — bộ tách không còn khớp`);

  const broken = [];
  for (const entry of entries) {
    const id = entry.slice(0, entry.indexOf('"'));
    if (!/live:\s*true/.test(entry)) continue;
    const declared = entry.match(/liveRecipe:\s*"([^"]+)"/);
    const recipe = declared ? declared[1] : "drawpipes";
    if (!handled.has(recipe)) broken.push(`${id} → ${recipe}`);
  }
  assert.deepEqual(broken, [],
    `nút live không có handler trong opLisp() — mỗi lần bấm là một lỗi 400: [${broken}]`);
}

/* Quyết định D6: nếu UI hiển thị trạng thái đã lưu / chưa lưu thì `/docs`
 * PHẢI trả `dbmod`, và plugin PHẢI phát trường đó. Ba nơi phải khớp nhau —
 * lệch một nơi là chấm xanh nói dối trên một bản vẽ chưa lưu. */
if (codeOnly.includes('data-saved=')) {
  const bridge = readFileSync(
    join(webDir, "../daemon/src/acadBridge.ts"), "utf8");
  assert.match(bridge, /dbmod\?: number;/, "OpenAcadDocument phải khai dbmod");
  assert.match(sourceAt("lib/daemon/docs.ts"), /dbmod\?: number;/, "AcadDocument phải khai dbmod");
  const plugin = readFileSync(
    join(webDir, "../../../objectarx/mepbridge.cpp"), "utf8");
  assert.match(plugin, /\\"dbmod\\":/, "writeDocs() của plugin phải phát dbmod");
  assert.match(
    sourceAt("Titlebar.tsx"),
    /doc\.dbmod === undefined \? "unknown"/,
    "thiếu dbmod phải hiện KHÔNG BIẾT, không được coi là đã lưu",
  );
  // Chấm chỉ đúng khi danh sách bản vẽ được nạp lại đúng lúc. Nghe thiếu một
  // trong ba sự kiện này là chấm treo ở trạng thái cũ mà không ai báo.
  for (const signal of ["drawingModified", "drawingSaved", "pluginLoaded"]) {
    assert.ok(
      sourceAt("AppShell.tsx").includes(signal),
      `shell phải nạp lại danh sách bản vẽ khi có sự kiện ${signal}`,
    );
  }
  assert.match(plugin, /emitEvent\("drawingSaved"/, "plugin phải phát drawingSaved sau khi lưu");
  assert.match(
    plugin,
    /acadDocumentModifiedKnown/,
    "dbmod phải có trạng thái KHÔNG BIẾT, không mặc định là đã lưu",
  );
}

/* Không phần tử nào của shell được dẫn tới một route chưa tồn tại — dẫn người
 * dùng tới 404 tệ hơn hẳn một liên kết mờ đi kèm lý do. Ba nơi điều hướng phải
 * hỏi CÙNG một nguồn là danh sách `BUILT` trong nav.ts. */
assert.match(sourceAt("Rail.tsx"), /item\.built \?/, "rail phải kiểm item.built");
assert.match(
  sourceAt("Titlebar.tsx"),
  /isRouteBuilt\("\/settings"\)[\s\S]*isRouteBuilt\("\/changes"\)/,
  "pill kết nối và chip thay đổi phải kiểm route tồn tại",
);
assert.match(
  sourceAt("CommandPalette.tsx"),
  /BUILT_ROUTES/,
  "bảng lệnh phải kiểm route tồn tại",
);

/* Địa chỉ daemon khai đúng một lần. Đặt tên biến môi trường khác ở một màn
 * hình nghĩa là màn hình đó trỏ sai địa chỉ trong bản đóng gói (scripts/package.mjs
 * chỉ set NEXT_PUBLIC_DAEMON_URL) trong khi mọi thứ khác vẫn chạy — kiểu lỗi chỉ
 * lộ ra sau khi giao hàng. */
assert.equal(
  countCodeExcept("NEXT_PUBLIC_", "lib/daemon/endpoints.ts"),
  0,
  "chỉ lib/daemon/endpoints.ts được đọc biến môi trường địa chỉ daemon",
);

/* Lệnh ghi MỘT PHA phải nói rõ là nó không qua hàng chờ. `/blocks/insert` và
 * `/blocks/sync` không có bước chuẩn bị phía máy chủ; gọi chúng là "xác nhận"
 * mà không phân biệt sẽ khiến người dùng tưởng còn một bước nữa để rút lui. */
assert.match(
  sourceAt("ConfirmSheet.tsx"),
  /mode === "immediate"[\s\S]*?Ghi ngay, không qua hàng chờ/,
  "ConfirmSheet phải cảnh báo riêng cho lệnh ghi một pha",
);
assert.match(
  sourceAt("ConfirmSheet.tsx"),
  /không hoàn tác được/,
  "ConfirmSheet phải nói rõ không có hoàn tác",
);
assert.match(
  sourceAt("blocks/page.tsx"),
  /mode="immediate"/,
  "thư viện block ghi một pha — phải dùng đúng chế độ cảnh báo",
);
/* `/blocks/sync` CHỈ ghi metadata lên một định nghĩa đã có trong bản vẽ
 * (`writeCadMetadata`); nó không nhập và không thay hình học. Mô tả nó là "đồng
 * bộ định nghĩa" là hứa một việc backend không làm — đúng loại lỗi cả bộ
 * guardrail này tồn tại để chặn. */
assert.match(
  sourceAt("blocks/page.tsx"),
  /Hình học của block không đổi/,
  "hộp xác nhận sync phải nói rõ hình học không đổi",
);
assert.doesNotMatch(
  stripComments(sourceAt("blocks/page.tsx")),
  /đè bản đang có|đổi hình theo/,
  "không được hứa sync thay hình học block",
);
/* Thao tác của thư viện block KHÔNG được đi qua hàng chờ: máy chủ không có
 * bước chuẩn bị cho chúng, nên một op staged cho hai verb này chỉ là ý định
 * trong localStorage. */
assert.doesNotMatch(
  stripComments(sourceAt("blocks/actions.ts")),
  /staged-ops/,
  "blocks/insert và blocks/sync không được đưa vào hàng chờ",
);

/* Sửa metadata ghi vào THƯ VIỆN, không vào bản vẽ — nên nó không được mượn hộp
 * xác nhận không-hoàn-tác. Cảnh báo dùng cho việc sửa lại được sẽ làm nhẹ đi
 * cảnh báo ở hai lệnh thật sự không rút lại được. */
assert.doesNotMatch(
  stripComments(sourceAt("blocks/BlockMetadataForm.tsx")),
  /ConfirmSheet|không hoàn tác/,
  "form sửa metadata không được dùng cảnh báo không-hoàn-tác",
);
/* Bản nháp phải đặt lại theo `block.id`, KHÔNG theo cả object `block`. Danh mục
 * được tải lại sau mỗi lệnh insert/sync và sinh object mới mỗi lần; bám theo
 * object nghĩa là xoá sạch thứ người dùng đang gõ dở vì một việc họ không làm. */
assert.match(
  stripComments(sourceAt("blocks/BlockMetadataForm.tsx")),
  /\},\s*\[block\.id\]\)/,
  "form metadata chỉ được đặt lại khi đổi định nghĩa, không phải mỗi lần tải lại",
);
/* `PUT /:id` đẩy một block đang `synced` về `outdated` khi metadata đổi
 * (`blockMetadataPayload(...).revision` khác nhau): bản vẽ nay giữ thông tin cũ.
 * Báo "đã lưu" rồi để thẻ trạng thái tự đổi là một bất ngờ im lặng. */
assert.match(
  stripComments(sourceAt("blocks/page.tsx")),
  /result\.saved\?\.block\.syncStatus === "outdated"/,
  "phải đọc syncStatus từ phản hồi PUT, không đoán phía client",
);
/* Lượt lưu phải mang revision mà BẢN NHÁP dựa trên, không phải revision mới
 * nhất của danh mục. Danh mục được tải lại sau mỗi lệnh insert/sync; nếu người
 * khác vừa sửa block này thì gửi revision mới nghĩa là máy chủ chấp nhận và xoá
 * im lặng thay đổi của họ — đúng thứ `expectedRevision` sinh ra để chặn. */
assert.match(
  stripComments(sourceAt("blocks/page.tsx")),
  /onSaveMetadata=\{\(draft, expectedRevision\)/,
  "lưu metadata phải dùng revision do form giữ",
);
assert.doesNotMatch(
  stripComments(sourceAt("blocks/page.tsx")),
  /saveBlockMetadata\([^)]*library\.revision/,
  "không được gửi revision mới nhất của danh mục khi lưu metadata",
);
/* Ghim revision đổi 409 từ "một lần hỏng" thành "hỏng mãi" nếu không tải lại:
 * form ngồi trên phiên bản không còn tồn tại và mọi lần lưu sau đều 409 y hệt.
 * Tải lại kể cả khi hỏng, và Hoàn tác phải dẫn tới bản đang có thật. */
assert.match(
  stripComments(sourceAt("blocks/page.tsx")),
  /\}\s*library\.reload\(\);/,
  "phải tải lại danh mục cả khi lưu metadata hỏng — lời gọi nằm NGOÀI nhánh ok",
);
assert.match(
  sourceAt("blocks/page.tsx"),
  /bấm Hoàn tác để lấy bản mới nhất/,
  "lưu hỏng phải chỉ đường ra, không chỉ báo lỗi",
);
assert.match(
  stripComments(sourceAt("blocks/BlockMetadataForm.tsx")),
  /adopt\(block, revision\);\s*onCancel\(\)/,
  "Hoàn tác phải lấy bản mới nhất của máy chủ, không phải mốc đã cũ",
);
/* Tải lại hỏng KHÔNG được xoá danh mục đang có: `selected` thành null thì form
 * unmount và phần đang gõ dở biến mất. Lần tải lại ngay sau một lượt lưu vừa là
 * lúc dễ hỏng nhất vừa là lúc có nhiều thứ để mất nhất. */
assert.doesNotMatch(
  stripComments(sourceAt("blocks/useBlockLibrary.ts")),
  /catch[\s\S]{0,200}?set(Blocks|Sources)\(\[\]\)/,
  "đọc danh mục hỏng thì không được xoá bản đang hiển thị",
);
/* Lượt đọc về muộn không được đè lên trạng thái mới hơn. Hai lệnh ghi liên tiếp
 * là đủ: reload của lệnh đầu có thể về SAU echo của lệnh sau, ghi đè revision
 * mới bằng revision cũ, và lệnh kế tiếp ăn 409 dù không ai sửa gì. */
assert.match(
  stripComments(sourceAt("blocks/useBlockLibrary.ts")),
  /const ticket = \+\+sequence\.current/,
  "mỗi lượt đọc danh mục phải mang số thứ tự",
);
assert.match(
  stripComments(sourceAt("blocks/useBlockLibrary.ts")),
  /applyServerEcho[\s\S]{0,200}?sequence\.current\+\+/,
  "nhận echo phải vô hiệu hoá mọi lượt đọc đang bay",
);
/* Gỡ nguồn phải gỡ CẢ `sourcePath`: `linkedDwgSource()` quay về `sourcePath` khi
 * không có `sourceId`, nên bỏ mỗi id thì block vẫn còn liên kết trong khi form
 * ghi "không gán nguồn". */
assert.match(
  stripComments(sourceAt("blocks/BlockMetadataForm.tsx")),
  /sourceId: _id, sourcePath: _path/,
  "gỡ nguồn phải gỡ cả liên kết sourcePath kiểu cũ",
);
/* Block đang chọn phải tra trong TOÀN danh mục. Chính lượt lưu đẩy nó từ
 * `synced` sang `outdated`, nên tra trong danh sách đã lọc nghĩa là bật bộ lọc
 * "Khớp thư viện" rồi lưu sẽ làm pane chi tiết biến mất ngay sau khi lưu. */
assert.match(
  stripComments(sourceAt("blocks/page.tsx")),
  /const selected = library\.blocks\.find/,
  "block đang chọn tra trong toàn danh mục, không phải danh sách đã lọc",
);

/* `-BLOCK` LẤY ĐI thứ đang có: nó gom các đối tượng đang chọn thành định nghĩa
 * rồi xoá chúng khỏi bản vẽ. Đây là lệnh ghi duy nhất trong app có tính chất đó,
 * và người dùng phải biết trước khi bấm, không phải sau. */
assert.match(
  sourceAt("blocks/CreateBlockDialog.tsx"),
  /xoá khỏi bản vẽ/,
  "hộp tạo block phải nói rõ đối tượng đang chọn bị xoá khỏi bản vẽ",
);
assert.match(
  sourceAt("blocks/CreateBlockDialog.tsx"),
  /OOPS/,
  "phải chỉ đường lấy lại đối tượng đã bị -BLOCK nuốt",
);
/* Guardstrip ở đây liệt kê ĐIỀU KIỆN app không kiểm được. Đánh dấu pass/fail sẽ
 * bịa ra một phép kiểm không tồn tại — chỉ `pending` là đúng sự thật. */
assert.doesNotMatch(
  stripComments(sourceAt("blocks/CreateBlockDialog.tsx")),
  /data-pass="(true|false)"/,
  "không được vẽ dấu tick/chéo cho điều kiện mà app không kiểm được",
);
/* Nguồn thư viện: bộ mẫu gọi là "thư mục" và có nút "quét lại nguồn". Backend
 * không quét gì cả — `POST /blocks/sources` chỉ ghi đường dẫn, và
 * `POST /blocks/scan` quét BẢN VẼ ĐANG MỞ chứ không quét nguồn. */
assert.match(
  sourceAt("blocks/SourcesDialog.tsx"),
  /Thêm nguồn không quét gì cả/,
  "màn nguồn phải nói rõ thêm nguồn không quét gì",
);
assert.doesNotMatch(
  stripComments(sourceAt("blocks/SourcesDialog.tsx")),
  /thư mục nguồn|Quét lại nguồn/,
  "không được mô tả nguồn là thư mục được quét",
);
/* Lệnh ghi phải nhận revision mới NGAY từ phản hồi, không đợi `reload()`. Đợi
 * nghĩa là cú bấm thứ hai trong quãng đó gửi `expectedRevision` cũ và ăn 409 —
 * một xung đột hoàn toàn tự gây ra, không có ai sửa thư viện cả. */
assert.match(
  stripComments(sourceAt("blocks/page.tsx")),
  /applyServerEcho\(\{ revision: result\.revision, sources: result\.sources \}\)/,
  "thêm nguồn phải áp revision mới ngay, không đợi tải lại",
);
assert.match(
  stripComments(sourceAt("blocks/page.tsx")),
  /if \(result\.revision\) library\.applyServerEcho/,
  "tạo block phải áp revision mới ngay, không đợi tải lại",
);
/* BỐN lệnh ghi vào danh mục: insert, sync, lưu metadata, thêm nguồn, tạo block —
 * `insert`/`sync` dùng chung một call site. Thiếu chỗ nào là chỗ đó để lại
 * revision cũ và làm lệnh ghi kế tiếp ăn 409 oan. */
assert.equal(
  stripComments(sourceAt("blocks/page.tsx")).match(/applyServerEcho/g)?.length,
  4,
  "mọi lệnh ghi vào danh mục đều phải áp revision từ phản hồi",
);

/* Chỉ xoá trắng form khi máy chủ đã ghi. Hỏng hay gặp nhất là 409, và bắt gõ lại
 * một đường dẫn tuyệt đối dài chỉ vì phải tải lại là mất công vô cớ. */
assert.match(
  stripComments(sourceAt("blocks/SourcesDialog.tsx")),
  /if \(!added\) return;/,
  "form nguồn chỉ được xoá trắng sau khi thêm thành công",
);
assert.match(
  sourceAt("blocks/page.tsx"),
  /Định nghĩa trong bản vẽ nay là bản cũ/,
  "lưu metadata làm mất đồng bộ thì phải nói ra và chỉ việc tiếp theo",
);

/* Thư viện LISP: duyệt là thao tác của app DESKTOP, không phải của web.
 * `POST /:id/approval-challenge` đòi chữ ký Ed25519 do preload của app desktop
 * tạo, và daemon chỉ kiểm được khi chính app đó khởi chạy nó
 * (`ACAD_REVIEW_PUBLIC_KEY`). Vẽ nút "Duyệt" ở màn hình web là vẽ một nút chắc
 * chắn ném lỗi. */
assert.doesNotMatch(
  stripComments(sourceAt("lisp/page.tsx")),
  /approval-challenge|signReview|approvalToken/,
  "màn LISP mới không được tự dựng luồng duyệt",
);
assert.match(
  sourceAt("lisp/page.tsx"),
  /app desktop, không phải của web/,
  "màn LISP phải nói rõ duyệt chỉ làm được ở app desktop",
);
/* …nhưng kết luận đó phải theo MÔI TRƯỜNG ĐANG CHẠY. Chính trang này cũng được
 * app desktop mở, và ở đó câu "web không duyệt được" là sai. */
assert.match(
  stripComments(sourceAt("lisp/page.tsx")),
  /signer === "present"/,
  "kết luận về khả năng duyệt phải theo môi trường đang chạy",
);
/* Ba trạng thái, không phải hai: lần render đầu chạy trên máy chủ rồi mới
 * hydrate, nên đoán "không có signer" ngay từ đầu sẽ hiện một câu sai trong
 * khoảnh khắc đầu ở app desktop. */
assert.match(
  stripComments(sourceAt("lisp/reviewSigner.ts")),
  /"unknown" \| "present" \| "absent"/,
  "trạng thái bộ ký phải có nhánh chưa-biết",
);
/* Có bộ ký MỚI LÀ NỬA điều kiện. Nửa còn lại (`ACAD_REVIEW_PUBLIC_KEY` của
 * daemon) client không nhìn thấy, nên giao diện không được kết luận thay. */
assert.match(
  sourceAt("lisp/page.tsx"),
  /nửa điều kiện đầu đã\s+đạt/,
  "có bộ ký thì phải nói rõ đó mới là nửa điều kiện",
);
/* Máy chủ cắt bớt lượt quét thì phải nói ra: im lặng nghĩa là người dùng kết
 * luận "không có script nào tên X" trong khi thật ra là chưa quét tới. */
assert.match(
  stripComments(sourceAt("lisp/page.tsx")),
  /library\.truncated/,
  "phải nói ra khi danh sách bị cắt bớt",
);
/* Nạp LISP KHÔNG ghi vào bản vẽ, nên không được dùng `mode="immediate"` —
 * chế độ đó bảo người dùng gõ `UNDO` để hoàn tác, mà `UNDO` không gỡ được mã đã
 * nạp. Chỉ một đường thoát không tồn tại còn tệ hơn không chỉ. */
assert.match(
  stripComments(sourceAt("lisp/LoadDialog.tsx")),
  /mode="session"/,
  "hộp nạp LISP phải dùng chế độ session, không phải immediate",
);
assert.match(
  stripComments(sourceAt("ConfirmSheet.tsx")),
  /mode === "session"[\s\S]{0,400}?UNDO<\/code> không gỡ được/,
  "chế độ session phải nói rõ UNDO không gỡ được",
);
/* Chế độ `session` không được kèm câu "ghi vào bản vẽ đang hoạt động" — nó mâu
 * thuẫn thẳng với cảnh báo phía trên, ngay trong hộp thoại người dùng đang cân
 * nhắc chuyện bảo mật. */
assert.match(
  stripComments(sourceAt("ConfirmSheet.tsx")),
  /mode === "session" \? \([\s\S]{0,300}?Không bản vẽ nào bị ghi/,
  "chế độ session phải nói rõ không bản vẽ nào bị ghi",
);
/* `manifestRevision` phải đọc lại theo mỗi lượt đọc danh mục. Bám mỗi `id` thì
 * một thay đổi từ bên ngoài khiến mọi lượt nạp sau ăn `revision_conflict` mãi,
 * không có đường thoát trên trang. */
assert.match(
  stripComments(sourceAt("lisp/useLispDetail.ts")),
  /\}, \[daemon, id, catalogVersion\]\)/,
  "revision chi tiết phải đọc lại khi danh mục đọc lại",
);

/* Ba thứ `load` đổi trong phiên AutoCAD, phải nói đủ: mã được THỰC THI, support
 * path và TRUSTEDPATHS bị thêm vào. Thiếu cái thứ ba là giấu một thay đổi về
 * BẢO MẬT — AutoCAD sẽ tin mã trong thư mục đó mà không hỏi nữa. */
assert.match(
  sourceAt("lisp/LoadDialog.tsx"),
  /TRUSTEDPATHS/,
  "hộp nạp phải nói rõ TRUSTEDPATHS bị đổi",
);
assert.match(
  sourceAt("lisp/LoadDialog.tsx"),
  /thực thi<\/strong> file ngay khi nạp/,
  "hộp nạp phải nói rõ nạp là chạy mã",
);
/* Phụ thuộc: app KHÔNG phân giải được tham chiếu thành tài nguyên, đó là logic
 * của máy chủ. Vẽ tick/chéo cho hàng đó là đoán. */
assert.match(
  stripComments(sourceAt("lisp/LoadDialog.tsx")),
  /dependencies\.length \? \([\s\S]{0,200}?data-pass="pending"/,
  "hàng phụ thuộc phải để pending — app không kiểm được",
);
/* Mã có tham số (`review_required:stale`) không tra được trong `guards.ts`.
 * Không dịch thì người dùng đọc đúng chuỗi thô của daemon. */
assert.match(
  stripComments(sourceAt("lisp/actions.ts")),
  /startsWith\("dependency_review_required:"\)/,
  "phải dịch các mã lỗi mang tham số của luồng nạp",
);

/* Hash gửi kèm lượt duyệt phải khớp `stableJson()` của daemon: máy chủ TỰ TÍNH
 * LẠI từ `{resourceId, baseRevision, manifest}` và 403 nếu khác. Hai bản băm
 * song song sẽ lệch, và thông điệp lỗi lại nói về "token thiếu hoặc hết hạn" —
 * sai hướng hoàn toàn. Nên chỉ được có MỘT chỗ băm. */
assert.equal(
  stripComments(sourceAt("lisp/fingerprint.ts")).match(/crypto\.subtle\.digest/g)?.length,
  1,
  "chỉ được một chỗ băm manifest",
);
assert.doesNotMatch(
  stripComments(sourceAt("lispProposal.ts")),
  /crypto\.subtle\.digest/,
  "chat legacy phải dùng chung phép băm, không tự băm lại",
);
/* `analysisCoverage` phải SUY RA từ việc có source hay không, không cho người
 * dùng khai. Khai được nghĩa là một lời khai sai nằm vĩnh viễn trong manifest. */
assert.doesNotMatch(
  stripComments(sourceAt("lisp/ApprovalDialog.tsx")),
  /setCoverage|onChange=\{[^}]*[Cc]overage/,
  "phạm vi đã đọc không được để người dùng tự chọn",
);
assert.match(
  stripComments(sourceAt("lisp/ApprovalDialog.tsx")),
  /coverageFor\(source\)/,
  "phạm vi đã đọc phải suy ra từ source",
);
/* Duyệt lại phải bắt đầu từ manifest ĐANG CÓ HIỆU LỰC. Đọc `baseManifest`
 * (sidecar gốc) sẽ âm thầm đánh rơi `guardrails`, `examples` và mọi phần đã sửa
 * — mất dữ liệu, không phải mất tiện nghi. */
assert.match(
  stripComments(sourceAt("lisp/useLispDetail.ts")),
  /asRecord\(resource\?\.manifest\) \?\? asRecord\(resource\?\.baseManifest\)/,
  "duyệt lại phải dựng từ manifest đang có hiệu lực",
);
/* Source rỗng vẫn là toàn bộ file. Chỉ `null` mới là "không đọc được". */
assert.match(
  stripComments(sourceAt("lisp/approval.ts")),
  /return typeof source === "string" \? "full-source"/,
  "chuỗi rỗng vẫn phải tính là đọc được toàn bộ source",
);
/* Duyệt ghi vào THƯ VIỆN, không chạm bản vẽ hay phiên AutoCAD — mượn
 * `ConfirmSheet` sẽ dán ba cảnh báo không đúng chỗ lên nó. */
assert.doesNotMatch(
  stripComments(sourceAt("lisp/ApprovalDialog.tsx")),
  /ConfirmSheet/,
  "hộp duyệt không được mượn cảnh báo của lệnh ghi vào bản vẽ",
);
/* Source phải HIỆN RA trước khi ký. Chữ ký xác nhận một con người đã đọc nội
 * dung; không hiện nội dung thì nó xác nhận một việc không xảy ra. */
assert.match(
  stripComments(sourceAt("lisp/ApprovalDialog.tsx")),
  /<pre[\s\S]*?\{source\}/,
  "hộp duyệt phải hiện source",
);
/* Hỏng thì GIỮ hộp thoại: người dùng vừa gõ tóm tắt và tích hai ô xác nhận. */
assert.match(
  stripComments(sourceAt("lisp/page.tsx")),
  /setApproveError\(result\.error\)/,
  "duyệt hỏng thì giữ hộp thoại và báo lý do tại chỗ",
);

/* Duyệt và nạp là hai việc khác nhau. Dùng chung một tiêu đề thông báo sẽ báo
 * "đã gửi lệnh nạp" cho một lượt duyệt không gửi lệnh nào — đúng loại nói sai
 * đã sửa một lần ở `/library/blocks`. */
assert.match(
  stripComments(sourceAt("lisp/page.tsx")),
  /notice\.kind === "approve"/,
  "thông báo phải phân biệt duyệt với nạp",
);

/* Nút quét đĩa phải khoá theo `refreshing`, không theo `loading`: `loading` chỉ
 * đúng ở lần đọc đầu, nên dùng nó thì nút mở lại ngay và cho bấm chồng nhiều
 * lượt quét đĩa — thao tác đắt nhất màn này. Và danh sách KHÔNG được dùng
 * `refreshing`, không thì mỗi lần làm mới lại xoá trắng chỗ đang xem. */
assert.match(
  stripComments(sourceAt("lisp/page.tsx")),
  /disabled=\{library\.refreshing\}/,
  "nút quét lại đĩa phải khoá theo refreshing",
);
assert.doesNotMatch(
  stripComments(sourceAt("lisp/page.tsx")),
  /library\.refreshing \?[\s\S]{0,80}?statebox/,
  "danh sách không được thay bằng trạng thái nạp khi chỉ đang làm mới",
);

/* Mã của daemon phải có nhãn tiếng Việt, và mã lạ trả lại nguyên văn thay vì
 * thành ô trống — khoá bằng `test-lisp-model.test.ts`. */
assert.match(
  stripComments(sourceAt("lisp/model.ts")),
  /return REVIEW_LABELS\[status as LispReviewStatus\] \|\| status/,
  "nhãn trạng thái duyệt phải lùi về chính mã khi gặp giá trị lạ",
);

/* Một EventSource duy nhất, và ở đúng chỗ. Chỉ đếm "= 1" thì không đủ: hôm
 * trước nó đã bằng 1 khi còn nằm trong page.tsx, nên tiêu chí đó pass mà không
 * đo được gì. Nhiều instance nghĩa là mỗi panel tự mở một kết nối SSE riêng. */
assert.equal(countCode("new EventSource"), 1, "chỉ được có MỘT EventSource trong toàn app");
assert.ok(
  sources.some((s) =>
    s.path === "features/acad-connection/events.ts" && s.text.includes("new EventSource")),
  "EventSource phải nằm trong features/acad-connection/events.ts",
);

/* Danh sách bản vẽ đang mở đọc qua một chỗ. Ba màn hình từng tự fetch và tự bóc
 * payload; quy tắc suy đích vẽ thì vẫn thuộc về từng màn hình (xem lib/daemon/docs.ts). */
assert.equal(
  countCodeExcept("/api/acad/(?:docs|events)", "lib/daemon/endpoints.ts"),
  0,
  "endpoint docs/events chỉ được khai trong lib/daemon/endpoints.ts",
);

/* Nút ghi phải là primitive Button (disabled thật + aria-disabled), không phải
 * thẻ <button> thô dựa vào CSS pointer-events — CSS không chặn Tab+Enter. */
assert.doesNotMatch(
  all,
  /<button[^>]*\sdata-write\b/,
  "nút ghi phải đi qua primitive Button, không đặt data-write lên <button> thô",
);

/* ── Bất biến gắn với một file cụ thể (khẳng định) ───────────────────────── */

assert.match(
  page,
  /const results = Array\.isArray\(r\?\.results\) \? r\.results : null;/,
  "function results validate the API array before rendering",
);
for (const resultKind of ["index", "table", "files"]) {
  assert.match(
    page,
    new RegExp(`\\{results && fn\\.result === "${resultKind}"`),
    `${resultKind} rendering is gated by a validated results array`,
  );
}
assert.match(
  page,
  /<option key=\{d\.file \|\| d\.title\} value=\{d\.file \|\| d\.title\}>/,
  "live document options use the exact path for identity and value",
);
assert.match(
  page,
  /data-screen="legacy"/,
  'route "/" mang mốc data-screen để test-route-serving khẳng định ai đang phục vụ nó',
);

assert.match(
  functions,
  /const fileField: Field = \{[^\n]*type: "file"/,
  "DWG inputs use the file picker",
);
assert.match(
  functions,
  /const outField: Field = \{[^\n]*type: "dir"/,
  "output directories use the folder picker",
);

/* Ba bất biến đầu của panel legacy (ô JSON `bounds` chưa commit, nút Lưu khoá
   theo nó, ô danh sách cập nhật draft từng phím) đi theo panel: bản mới không có
   ô JSON nào — `mappingRowErrors()` + `profileSaveBlockedReason()` thay chỗ, và
   cả hai là hàm THUẦN nên đã khoá bằng test hành vi ở
   `test-standards-model.test.ts`, chặt hơn một phép so mã nguồn.

   Bất biến thứ tư thì KHÔNG đi theo — nó nói về một lỗi thật, nên nó CHUYỂN chỗ:
   handle của một lượt quét chỉ có nghĩa với bản vẽ ở đúng trạng thái lúc quét,
   nên chốt gửi kèm phải lấy từ CHÍNH lượt đó (`scan.selectGuard`). Đọc mới một
   lượt `/docs` là ghép handle của lượt này với chốt của lượt khác, và bản vẽ đổi
   trong quãng đó thì handle trỏ sang đối tượng khác trong khi chốt vẫn hợp lệ. */
assert.match(
  sourceAt("app/(shell)/review/page.tsx"),
  /prepareSelectHandles\(DAEMON_BASE, \{[\s\S]*?handles,[\s\S]*?guard: scan\.selectGuard,/,
  "review passes the scan's own select guard, not a freshly read one",
);

/** Một khối lệnh trong file, tra bằng mốc đầu và mốc cuối. */
function blockBetween(source, startMark, endMark, label) {
  const start = source.indexOf(startMark);
  const end = source.indexOf(endMark, start);
  assert.ok(start >= 0 && end > start, `${label} block is present`);
  return source.slice(start, end);
}

/* Ba assert cũ ở đây đã chết cùng `DrawingInfoPanel`: chúng nói về vòng đời
   `refreshToken` của panel và về CSS riêng của bộ chọn đối tượng trong đó. Màn
   hình mới không có `refreshToken` (nó tự nghe sự kiện) và dùng bảng chung của
   design system. Bất biến còn giá trị đã chuyển lên đầu tệp. */


assert.match(
  page,
  /<PreconstructionPanel[\s\S]*?initialCadTarget=\{drawTarget\}[\s\S]*?onOpenReview=/,
  "the preconstruction workspace is wired to the active CAD target and review workspace",
);
assert.match(
  page,
  /<button type="button" className="fnbtn quickfn" onClick=\{\(\) => openPreconstruction\("overview"\)\}/,
  "the preconstruction function-panel entry is keyboard accessible",
);
for (const view of ["overview", "takeoff", "estimating", "field", "integrations", "automation"]) {
  assert.ok(preconstruction.includes(`"${view}"`), `preconstruction exposes the ${view} view`);
}
for (const capability of [
  "Diện tích", "Chiều dài", "Cung", "Mái dốc", "Thể tích", "Đếm", "Hao hụt",
  "Assembly", "Nhân công", "Overhead", "Markup", "Thuế", "Punch list",
  "Báo cáo ngày", "Procore", "Acumatica", "QuickBooks", "AutoCount",
  "AI Trade Takeoff", "Auto-naming", "Smart suggestions", "Template Library",
  "Auto-hyperlinking", "BUDGET VS ACTUAL", "Non-measured costs",
]) {
  assert.ok(
    preconstruction.includes(capability),
    `preconstruction surfaces the requested capability: ${capability}`,
  );
}
assert.match(
  preconstruction,
  /rateOverrides\[variant\][\s\S]*?\[variant\]: \{[\s\S]*?\[id\]: \{/,
  "alternate estimates keep independent per-variant rate overrides",
);
assert.match(
  preconstruction,
  /INITIAL_ESTIMATE_SETTINGS[\s\S]*?"Cơ sở"[\s\S]*?"Tối ưu chi phí"[\s\S]*?"Thi công nhanh"/,
  "the project contains three independently configured estimate alternatives",
);
assert.match(
  preconstruction,
  /function boundedNumber[\s\S]*?Math\.min\(max, Math\.max\(0, value\)\)/,
  "quantity and costing inputs share a non-negative bounded numeric guard",
);
assert.match(
  preconstruction,
  /URL\.createObjectURL\(file\)/,
  "uploaded drawings and photos retain local blob content",
);
assert.match(
  preconstruction,
  /URL\.revokeObjectURL\(url\)/,
  "local uploaded blob content is released on unmount",
);
for (const accessibilityState of ["aria-current", "aria-pressed", "aria-selected"]) {
  assert.ok(
    preconstruction.includes(accessibilityState),
    `preconstruction exposes ${accessibilityState} for keyboard and assistive technology users`,
  );
}
assert.match(
  styles,
  /\.precon-backdrop \{[\s\S]*?\.precon-panel \{[\s\S]*?@media \(max-width: 640px\)/,
  "the preconstruction workspace has scoped desktop and mobile styling",
);
assert.match(
  styles,
  /\.precon-table td > button\.precon-delete \{/,
  "destructive table styling is scoped to explicit delete buttons",
);
assert.match(
  styles,
  /\.precon-ai-table td:last-child button\.primary \{/,
  "approval actions preserve their primary styling",
);
assert.match(
  styles,
  /\.precon-punch-list > label \{[\s\S]*?grid-template-columns: 26px minmax\(0, 1fr\) auto;/,
  "punch-list content uses columns that match its in-flow children",
);
assert.match(
  styles,
  /\.precon-nav button \{[\s\S]*?position: relative;/,
  "navigation badges are positioned relative to their button",
);

/* Một cách đọc phản hồi daemon cho toàn app. Bốn bản cũ (`responseJson` ×3,
 * `responseRecord` ×1) ném `Error` trần ở ba trong bốn bản, nên mã lỗi có kiểu
 * bị vứt ngay tại chỗ nhận và UI không phân biệt được "bản vẽ đã đổi" với
 * "AutoCAD chưa chạy". */
for (const panel of [
  "BlockLibraryPanel.tsx",
  "LispLibraryPanel.tsx",
]) {
  const source = sourceAt(panel);
  assert.match(
    source,
    /from "\.\.\/lib\/daemon\/client";/,
    `${panel} dùng client daemon chung`,
  );
  assert.doesNotMatch(source, /function asRecord\(/, `${panel} has no local asRecord copy`);
}
assert.equal(
  countCode("async function response(?:Json|Record)\\("),
  0,
  "không panel nào được tự viết lại bộ đọc phản hồi daemon",
);

console.log(
  `✓ web contract: ${sources.length} file · bất biến phủ định chạy toàn dự án, khẳng định gắn file`,
);

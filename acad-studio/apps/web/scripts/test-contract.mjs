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
const standards = sourceAt("DrawingStandardsPanel.tsx");
const drawingInfo = sourceAt("DrawingInfoPanel.tsx");
const preconstruction = sourceAt("PreconstructionPanel.tsx");
const styles = sourceAt("globals.css");

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

assert.match(
  standards,
  /onPendingChange\(nextText !== serialized\);/,
  "bounds editor tracks uncommitted local JSON",
);
assert.match(
  standards,
  /!draft\?\.id \|\| !dirty \|\| profileBusy \|\| pendingBounds\.size > 0/,
  "profile save is disabled while bounds JSON is uncommitted or invalid",
);
assert.match(
  standards,
  /onChange\(commaList\(nextText\)\);/,
  "list editor updates the parent draft on each edit",
);
assert.match(
  standards,
  /const document = asRecord\(current\?\.document\);[\s\S]*?scope: \{ kind: "handles", handles \},[\s\S]*?catalogGuard: \{ instance, revision \}/,
  "standards scan handle selections are bound to the scanned document revision",
);

assert.match(
  drawingInfo,
  /selectionCatalogOf\(drawing\?\.selectionCatalog\)/,
  "drawing info reads the one-pass current-space object catalog",
);
assert.match(
  drawingInfo,
  /appendCatalogSubject\(index\.layerHandles, subject\.layerHandle[\s\S]*?appendCatalogSubject\(index\.blockHandles, subject\.blockHandle/,
  "catalog indexes layer and dynamic-block subjects once by stable table handles",
);
assert.match(
  drawingInfo,
  /function catalogRowsOf[\s\S]*?for \(const group of groups\)[\s\S]*?result\.push\([\s\S]*?selectableCount: group\.count/,
  "used catalog groups remain visible even when the plugin table is capped",
);
assert.match(
  drawingInfo,
  /scope: \{ kind: "handles", handles \},[\s\S]*?catalogGuard: picker\.catalogGuard,[\s\S]*?catalogScope:/,
  "the chooser binds its exact cached handle set to the catalog document revision",
);
assert.match(
  drawingInfo,
  /catalogScopeHandle[\s\S]*?catalogScopeConsistent[\s\S]*?selectedAll: picker\.complete && handles\.length === picker\.subjects\.length/,
  "cached handles retain their exact layer/block membership and all-vs-subset intent",
);
assert.match(
  drawingInfo,
  /plugin cũ cần kiểm tra[\s\S]*?scope: \{ kind, name, handle: String\(row\.handle \|\| ""\) \}/,
  "old plugins keep a visible compatibility action until AutoCAD can be restarted",
);
assert.match(
  drawingInfo,
  /catalogStale \|\| !selectionCatalog \|\| \(!selectionCatalog\.complete && !subjects\.length\)[\s\S]*?snapshot cũ, kiểm tra trực tiếp[\s\S]*?danh mục chưa đầy đủ, kiểm tra trực tiếp/,
  "stale and unknown rows remain usable through direct guarded resolution",
);
assert.match(
  drawingInfo,
  /!!selectionCatalog\?\.complete && rowCatalogSubjects\(kind, row\)\.length === 0/,
  "only an exact catalog disables rows that have no selectable subjects",
);
assert.match(
  drawingInfo,
  /!current\.complete \|\| current\.subjects\.length > CAD_SELECTION_MAX_SUBJECTS/,
  "select-all remains fail-closed for incomplete or oversized catalogs",
);
assert.match(
  drawingInfo,
  /const PICKER_PAGE_SIZE = 100;[\s\S]*?visiblePickerSubjects = filteredPickerSubjects\.slice/,
  "large object groups are searched and paged instead of fully rendered",
);
assert.match(
  drawingInfo,
  /prioritizeSelectable[\s\S]*?selectableCountOf\(right\)[\s\S]*?rowsWithObjects/,
  "layer and block rows with selectable objects are counted and shown first",
);
assert.match(
  drawingInfo,
  /selectableCountOf\(row\) === 0[\s\S]*?"Chưa xác định"/,
  "an incomplete catalog does not mislabel an unscanned row as zero objects",
);
assert.match(
  drawingInfo,
  /if \(loadedSnapshotKey\.current === requestKey\) return;/,
  "reopening the panel reuses its in-app snapshot",
);
assert.match(
  drawingInfo,
  /setCatalogStale\(true\);[\s\S]*?\}, \[refreshToken\]\);/,
  "AutoCAD change events mark the cached snapshot stale without fetching",
);

/** Một khối lệnh trong file, tra bằng mốc đầu và mốc cuối. */
function blockBetween(source, startMark, endMark, label) {
  const start = source.indexOf(startMark);
  const end = source.indexOf(endMark, start);
  assert.ok(start >= 0 && end > start, `${label} block is present`);
  return source.slice(start, end);
}

assert.doesNotMatch(
  blockBetween(
    drawingInfo,
    "if (seenRefreshToken.current === refreshToken) return;",
    "}, [refreshToken]);",
    "drawing-info refresh invalidation effect",
  ),
  /setObjectPicker\(null\)/,
  "a late AutoCAD event does not dismiss an already-open guarded picker",
);
assert.doesNotMatch(
  blockBetween(
    drawingInfo,
    "async function prepareCadAction(",
    "async function applyPendingCadAction()",
    "drawing-info prepare action",
  ),
  /setCatalogStale\(false\)/,
  "a prepared operation does not mark the global drawing snapshot fresh",
);

assert.match(
  page,
  /setDrawingInfoRefreshEventAt\(\(current\) => Math\.max\(current, event\.at\)\)[\s\S]*?refreshEventAt=\{drawingInfoRefreshEventAt\}/,
  "drawing-info receives the timestamp of its latest invalidating AutoCAD event",
);
assert.match(
  drawingInfo,
  /body\.snapshotCollectedAt \?\? body\.collectedAt[\s\S]*?latestRefreshEventAt\.current < snapshotCollectedAt[\s\S]*?setCatalogStale\(eventDuringScan && !eventCoveredBySnapshot\)/,
  "only an event strictly older than the snapshot is considered covered",
);
assert.match(
  drawingInfo,
  /Snapshot nền đã cũ; thao tác vừa được kiểm tra trực tiếp[\s\S]*?onClick=\{\(\) => void applyPendingCadAction\(\)\} disabled=\{!!cadActionBusy\}/,
  "a freshly resolved operation remains confirmable while the background snapshot is stale",
);
assert.match(
  drawingInfo,
  /Quét lại từ AutoCAD/,
  "the explicit one-way pull action is named Quét lại từ AutoCAD",
);
assert.match(
  drawingInfo,
  /function drawingInfoBusyCode[\s\S]*?document_not_quiescent[\s\S]*?const scanFailed = !response\.ok \|\| body\.ok === false \|\| !!busyCode \|\|[\s\S]*?sameTarget && !!catalogFailure/,
  "busy and non-quiescent responses cannot be committed as successful snapshots",
);
assert.match(
  drawingInfo,
  /function drawingInfoCatalogFailure[\s\S]*?selection_catalog_compat_failed[\s\S]*?sameTarget && !!catalogFailure/,
  "a failed compatibility enrichment cannot replace a good cached catalog",
);
assert.match(
  drawingInfo,
  /if \(sameTarget\) \{[\s\S]*?Giữ nguyên snapshot cũ vì lần quét mới chưa thành công[\s\S]*?\} else \{[\s\S]*?setData\(/,
  "a failed explicit rescan keeps the previous in-app snapshot",
);
assert.ok(
  drawingInfo.indexOf("if (scanFailed)") < drawingInfo.indexOf("loadedSnapshotKey.current = requestKey"),
  "only a successful scan is stored as the reusable snapshot",
);
assert.match(
  drawingInfo,
  /patchSelectionSummary\(asRecord\(result\.result\) \|\| \{\}\)/,
  "an app-originated selection patches the cached selection summary without a full scan",
);
assert.match(
  drawingInfo,
  /function RawJsonSection[\s\S]*?JSON\.stringify\(data, null, 2\)[\s\S]*?\{open && <div/,
  "the potentially large catalog JSON is formatted and mounted only when explicitly opened",
);
assert.match(
  drawingInfo,
  /window\.document\.addEventListener\("keydown", containFocus\)/,
  "the nested object chooser contains keyboard focus",
);
assert.match(
  styles,
  /\.drawing-object-picker-list \{[\s\S]*?overflow: auto;/,
  "the per-object chooser has a bounded scroll viewport",
);

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
  "DrawingInfoPanel.tsx",
  "DrawingStandardsPanel.tsx",
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

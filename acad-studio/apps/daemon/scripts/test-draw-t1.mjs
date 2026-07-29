#!/usr/bin/env node
/**
 * test-draw-t1 — kiểm tra sinh bước vẽ + LISP (KHÔNG cần AutoCAD).
 * Chạy: pnpm test:draw-t1
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
process.env.ACAD_PROJECT_ROOT ||= resolve(HERE, "../../../..");

const {
  buildDrawSteps, buildStageLisp, buildApplyLisp, buildRejectLisp,
  loadDrawRecipe, matchDrawStep, drawScenarioJson, previewLayer,
} = await import(resolve(HERE, "../src/drawT1.ts"));

let pass = 0, fail = 0;
const ok = (cond, msg) => {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.log(`  ✗ ${msg}`); }
};

console.log("\n── recipe ──");
const r = loadDrawRecipe();
ok(r.pipes.length === 35, `35 tuyến ống (thấy ${r.pipes.length})`);
ok(r.fittings.length === 90, `90 phụ kiện (thấy ${r.fittings.length})`);
ok(r.dims.length === 29, `29 kích thước (thấy ${r.dims.length})`);
ok(r.leaders.length === 20, `20 ghi chú dẫn (thấy ${r.leaders.length})`);
ok(r.dimstyles.length === 6, `6 dimstyle (thấy ${r.dimstyles.length})`);
ok(
  r.dims.every((d) => d.orient === "H" || d.orient === "V"),
  "mọi dim có hướng H/V (DIMLINEAR, không phải DIMALIGNED)",
);
ok(
  r.dimstyles.filter((d) => d.dimpost).length === 5,
  "5 dimstyle có DIMPOST -D<DN>",
);
const dnSet = [...new Set(r.pipes.map((p) => p.dn))].sort((a, b) => a - b);
ok(
  JSON.stringify(dnSet) === JSON.stringify([42, 90, 110, 125, 140]),
  `bộ DN = 42/90/110/125/140 (thấy ${dnSet.join("/")})`,
);

console.log("\n── steps ──");
const steps = buildDrawSteps(r);
ok(steps.length >= 30, `${steps.length} bước vẽ`);
ok(
  steps.every((s, i) => i === 0 || s.order >= steps[i - 1].order),
  "các bước sắp đúng thứ tự order tăng dần",
);
const iPipe = steps.findIndex((s) => s.phase === "III_pipes");
const iFit = steps.findIndex((s) => s.phase === "V_fittings");
const iDim = steps.findIndex((s) => s.phase === "VI_dims");
const iLead = steps.findIndex((s) => s.phase === "VII_leaders");
const iLayout = steps.findIndex((s) => s.phase === "XI_layout");
ok(iPipe < iFit, "ống trước phụ kiện");
ok(iFit < iDim, "phụ kiện trước kích thước");
ok(iDim < iLead, "kích thước trước ghi chú dẫn");
ok(iLayout === steps.length - 1, "layout là bước cuối");
const dnOrder = steps.filter((s) => s.phase === "III_pipes" && s.destLayer === "P-ThoatXi");
ok(
  dnOrder.length >= 2 && /DN140/.test(dnOrder[0].prompt),
  "ống thoát xí vẽ DN lớn trước (trục chính → nhánh)",
);
const totalExpect = steps.reduce((s, x) => s + x.expectCount, 0);
ok(totalExpect > 180, `tổng entity kỳ vọng ${totalExpect}`);

console.log("\n── match prompt ──");
ok(matchDrawStep("Vẽ ống thoát xí DN140")?.id.includes("dn140"), "khớp «Vẽ ống thoát xí DN140»");
ok(matchDrawStep("Vẽ ống thoát rửa DN90")?.destLayer === "P-ThoatRua", "khớp «Vẽ ống thoát rửa DN90»");
ok(matchDrawStep("vẽ bộ layer chuẩn hệ thoát nước")?.id === "setup_layers", "khớp không phân biệt hoa/thường");
ok(matchDrawStep("nấu phở") === null, "không khớp câu ngoài kịch bản");
const m140 = matchDrawStep("Vẽ ống thoát xí DN140");
const m110 = matchDrawStep("Vẽ ống thoát xí DN110");
ok(m140?.id !== m110?.id, "DN140 và DN110 khớp 2 bước khác nhau");

console.log("\n── LISP stage/apply/reject ──");
const step = steps.find((s) => s.id.includes("pipe") && s.destLayer === "P-ThoatXi");
const opId = "test1234";
const stage = buildStageLisp(step.id, opId, { resultPath: "/tmp/x.txt", recipe: r });
ok(stage.lisp.includes("dl:preview-begin"), "stage mở layer preview");
ok(stage.lisp.includes(previewLayer(opId)) === false, "stage dùng biến L, không hardcode tên layer preview");
ok(stage.lisp.includes("(dl:pipe L"), "stage vẽ ống lên biến layer preview L");
ok(!stage.lisp.includes("dl:preview-apply"), "stage KHÔNG chứa apply (hợp đồng wait-apply)");
ok(!stage.lisp.includes(`"${step.destLayer}"`) || stage.lisp.indexOf("destLayer") > 0,
   "stage không vẽ thẳng lên layer đích");

const apply = buildApplyLisp(step.id, opId, { resultPath: "/tmp/x.txt", recipe: r });
ok(apply.lisp.includes("dl:preview-apply"), "apply chuyển preview → layer đích");
ok(apply.lisp.includes(`"${step.destLayer}"`), `apply trỏ đúng layer đích ${step.destLayer}`);
ok(!apply.lisp.includes("dl:pipe"), "apply KHÔNG vẽ lại entity");

const reject = buildRejectLisp(step.id, opId, { resultPath: "/tmp/x.txt" });
ok(reject.lisp.includes("dl:preview-reject"), "reject xoá preview");

console.log("\n── LISP đúng cú pháp ──");
for (const s of steps) {
  const lisp = buildStageLisp(s.id, "op", { resultPath: "/tmp/x.txt", recipe: r }).lisp;
  const open = (lisp.match(/\(/g) || []).length;
  const close = (lisp.match(/\)/g) || []).length;
  if (open !== close) { fail++; console.log(`  ✗ ${s.id}: ngoặc lệch ${open}/${close}`); }
}
ok(true, `${steps.length} bước: ngoặc cân bằng`);
ok(
  !buildStageLisp(steps.find((s) => s.phase === "VI_dims").id, "op", { resultPath: "/tmp/x.txt", recipe: r })
    .lisp.includes("dl:dim-aligned"),
  "bước kích thước dùng dl:dim-linear (không phải dim-aligned)",
);

console.log("\n── chế độ live (vẽ vào bản vẽ đang mở) ──");
const liveStage = buildStageLisp(step.id, opId, { mode: "live", recipe: r }).lisp;
ok(liveStage.includes("acad:write-result"), "live: trả kết quả qua acad:write-result (bridge)");
ok(!liveStage.includes("dl:save"), "live: KHÔNG SAVEAS (giữ bản vẽ dirty cho user tự Save)");
ok(!liveStage.includes("dl:result"), "live: không ghi result file kiểu headless");
const hlStage = buildStageLisp(step.id, opId, {
  mode: "headless", resultPath: "/tmp/x.txt", savePath: "/tmp/a.dwg", recipe: r,
}).lisp;
ok(hlStage.includes("dl:result"), "headless: vẫn ghi result file");
ok(hlStage.includes("dl:save"), "headless: vẫn SAVEAS");
const liveApply = buildApplyLisp(step.id, opId, { mode: "live", recipe: r }).lisp;
ok(!liveApply.includes("dl:save"), "live apply: không SAVEAS");
ok(liveApply.includes("acad:write-result"), "live apply: trả kết quả qua bridge");

console.log("\n── draw_lib: không dùng lệnh có dấu nhắc ở hàm chạy live ──");
// Bài học: (command \"_.CHPROP\" …) hỏng giữa chừng trong session đang mở →
// 'Function cancelled' + AutoCAD KẸT ở dấu nhắc, mọi job sau treo.
const libSrc = readFileSync(
  resolve(HERE, "../../../../acad-lisp/headless/draw_lib.lsp"), "utf8",
);
function bodyOf(fn) {
  const i = libSrc.indexOf(`(defun ${fn} `);
  if (i < 0) return "";
  const next = libSrc.indexOf("\n(defun ", i + 1);
  return libSrc.slice(i, next < 0 ? undefined : next);
}
/** Bỏ chuỗi "…" (gồm docstring) và chú thích ; — chỉ còn CODE để soi. */
function codeOf(fn) {
  return bodyOf(fn)
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/;[^\n]*/g, "");
}
for (const fn of ["dl:preview-apply", "dl:preview-reject", "dl:layer"]) {
  const body = bodyOf(fn);
  ok(body.length > 0, `tìm thấy ${fn}`);
  ok(!/\(command\s/.test(codeOf(fn)), `${fn} không gọi (command …) — an toàn ở kênh live`);
}
ok(/entmod/.test(codeOf("dl:preview-apply")), "dl:preview-apply đổi layer bằng entmod");
ok(/entdel/.test(codeOf("dl:preview-reject")), "dl:preview-reject xoá bằng entdel");

console.log("\n── router guards ──");
const routerSrc = readFileSync(resolve(HERE, "../src/drawRouter.ts"), "utf8");
const targetStart = routerSrc.indexOf("else if (req.body?.target)");
const targetEnd = routerSrc.indexOf("if (t.kind === \"file\"", targetStart);
const targetSource = routerSrc.slice(targetStart, targetEnd);
ok(
  targetSource.includes("if (selected.ambiguous)") &&
    targetSource.includes("if (!hit)") &&
    targetSource.includes("return res.status(400)"),
  "explicit target không tồn tại trả lỗi thay vì fallback",
);
const rejectRouteStart = routerSrc.indexOf('r.post("/draw/reject"');
const rejectRouteEnd = routerSrc.indexOf('r.get("/draw/verify"', rejectRouteStart);
const rejectRoute = routerSrc.slice(rejectRouteStart, rejectRouteEnd);
const rejectStateGuard = rejectRoute.indexOf('op.state !== "staged"');
const rejectResultGuard = rejectRoute.indexOf("if (!out.ok)");
const rejectTransition = rejectRoute.indexOf('op.state = "rejected"');
ok(rejectStateGuard >= 0, "reject chỉ nhận op đang staged");
ok(
  rejectResultGuard >= 0 && rejectResultGuard < rejectTransition,
  "reject chỉ đổi state sau khi CAD trả thành công",
);
const discardStart = routerSrc.indexOf("async function discardStagedOps");
const targetRouteStart = routerSrc.indexOf('r.post("/draw/target"');
const targetRouteEnd = routerSrc.indexOf('r.post("/draw/new"', targetRouteStart);
const targetRoute = routerSrc.slice(targetRouteStart, targetRouteEnd);
const discardCall = targetRoute.indexOf("await discardStagedOps()");
const setTargetCall = targetRoute.indexOf("setDrawTarget(nextTarget)");
ok(discardStart >= 0, "đổi đích có helper dọn preview staged");
ok(
  discardCall >= 0 && setTargetCall > discardCall,
  "đổi đích chỉ diễn ra sau khi dọn preview cũ thành công",
);

console.log("\n── scenario JSON ──");
const sc = drawScenarioJson();
ok(sc.steps.length === steps.length, `scenario có ${sc.steps.length} bước`);
ok(sc.steps.every((s) => s.prompt.startsWith("Vẽ ")), "mọi prompt bắt đầu bằng «Vẽ »");
ok(/stage/.test(sc.contract) && /apply/.test(sc.contract), "scenario nêu hợp đồng stage→apply");

console.log(`\n${fail === 0 ? "PASS" : "FAIL"}: ${pass} pass, ${fail} fail\n`);
process.exit(fail === 0 ? 0 : 1);

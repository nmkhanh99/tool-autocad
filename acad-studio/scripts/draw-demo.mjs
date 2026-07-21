#!/usr/bin/env node
/**
 * draw-demo — DEMO VẼ THẬT bản vẽ "thoát nước tầng 1" theo kịch bản prompt.
 *
 * Vòng lặp mỗi bước:  prompt của user  →  agent STAGE (vẽ lên layer preview)
 *                     →  XÁC NHẬN  →  APPLY (chuyển sang layer đích)
 *
 * Dùng:
 *   node scripts/draw-demo.mjs                     # chạy toàn bộ, tự xác nhận
 *   node scripts/draw-demo.mjs --interactive       # hỏi Chấp nhận từng bước
 *   node scripts/draw-demo.mjs --steps 5           # chỉ 5 bước đầu
 *   node scripts/draw-demo.mjs --reject setup_layers,pipe_pthoatxi_dn140
 *   node scripts/draw-demo.mjs --out /abs/ra.dwg
 *   node scripts/draw-demo.mjs --list              # chỉ in kịch bản prompt
 */
import { createInterface } from "node:readline/promises";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
process.env.ACAD_PROJECT_ROOT ||= ROOT;

const {
  buildDrawSteps, buildStageLisp, buildApplyLisp, buildRejectLisp,
  buildVerifyLisp, loadDrawRecipe, matchDrawStep,
} = await import(resolve(HERE, "../apps/daemon/src/drawT1.ts"));
const {
  runHeadlessLisp, createBlankDwg, readReport, coreConsoleAvailable,
} = await import(resolve(HERE, "../apps/daemon/src/headlessDraw.ts"));

// ───────────────────────────────────────────────────────────────── options
const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, dflt) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : dflt;
};

const INTERACTIVE = flag("--interactive");
const LIST_ONLY = flag("--list");
const MAX_STEPS = Number(opt("--steps", "0")) || 0;
const REJECT = new Set(String(opt("--reject", "")).split(",").filter(Boolean));
const WORKDIR = opt("--workdir", join(ROOT, "acad-studio/.work"));
const OUT_DWG = resolve(opt("--out", join(WORKDIR, "T1-DEMO-VE-THAT.dwg")));

const C = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  c: (s) => `\x1b[36m${s}\x1b[0m`,
};

// ───────────────────────────────────────────────────────────────── kịch bản
const recipe = loadDrawRecipe();
let steps = buildDrawSteps(recipe);
if (MAX_STEPS > 0) steps = steps.slice(0, MAX_STEPS);

if (flag("--prompts")) {
  // Chỉ in câu prompt, mỗi dòng 1 câu — dán thẳng vào ô chat của app.
  for (const s of steps) console.log(s.prompt);
  process.exit(0);
}

if (LIST_ONLY) {
  console.log(C.b(`\nKỊCH BẢN DEMO — ${steps.length} prompt (nguồn: ${recipe.source_dwg})\n`));
  let phase = "";
  for (const s of steps) {
    if (s.phase !== phase) { phase = s.phase; console.log(C.c(`\n── ${phase} ──`)); }
    console.log(
      `${String(s.order).padStart(4)}  ${C.b(`«${s.prompt}»`)}\n` +
      `      ${C.dim(s.title)}  ${C.dim(`→ ${s.destLayer ?? "(không tạo entity)"}  ×${s.expectCount}`)}`,
    );
  }
  console.log();
  process.exit(0);
}

if (!coreConsoleAvailable()) {
  console.error(C.r("Không thấy AcCoreConsole — cần AutoCAD 2027 for Mac."));
  console.error(C.dim("Đặt ACAD_CORE_CONSOLE trỏ tới binary nếu cài ở chỗ khác."));
  process.exit(1);
}

// ─────────────────────────────────────────────────────────────────── chạy
mkdirSync(WORKDIR, { recursive: true });
const RES = join(WORKDIR, "draw-result.txt");
const REP = join(WORKDIR, "draw-report.txt");

const rl = INTERACTIVE
  ? createInterface({ input: process.stdin, output: process.stdout })
  : null;

async function confirm(step, staged) {
  if (REJECT.has(step.id)) return false;
  if (!INTERACTIVE) return true;
  const a = await rl.question(
    C.y(`   ❓ Chấp nhận ${staged} đối tượng của «${step.prompt}»? [Y/n] `),
  );
  return !/^n/i.test(a.trim());
}

console.log(C.b(`\n╔══ DEMO VẼ THẬT — ${steps.length} bước ══╗`));
console.log(`  Nguồn hình học : ${C.dim(recipe.source_dwg)}`);
console.log(`  Bản vẽ kết quả : ${C.dim(OUT_DWG)}`);
console.log(`  Chế độ         : ${INTERACTIVE ? "hỏi xác nhận từng bước" : "tự xác nhận"}`);
console.log(C.b(`╚${"═".repeat(28)}╝\n`));

console.log(C.dim("… tạo bản vẽ trống"));
if (existsSync(OUT_DWG)) rmSync(OUT_DWG, { force: true });
const blank = await createBlankDwg(OUT_DWG);
if (!blank.ok) {
  console.error(C.r(`Không tạo được bản vẽ trống: ${blank.error || blank.output.slice(-300)}`));
  process.exit(1);
}
console.log(C.g(`✓ Bản vẽ trống sẵn sàng\n`));

const log = [];
let applied = 0, rejected = 0, failed = 0;

for (const step of steps) {
  const opId = `s${String(step.order).padStart(4, "0")}`;
  console.log(C.b(`▸ [${step.order}] User: «${step.prompt}»`));
  console.log(C.dim(`   ${step.title}`));

  // ── 1. AGENT VẼ (stage lên layer preview) ────────────────────────────
  const stage = buildStageLisp(step.id, opId, { resultPath: RES, savePath: OUT_DWG, recipe });
  const sr = await runHeadlessLisp({ lisp: stage.lisp, dwg: OUT_DWG, resultPath: RES });
  if (!sr.ok) {
    console.log(C.r(`   ✗ stage lỗi: ${sr.error || sr.output.slice(-200)}`));
    failed++;
    log.push({ step: step.id, state: "stage_failed", error: sr.error });
    continue;
  }
  const staged = Number(sr.result.staged || 0);
  console.log(
    C.y(`   ⏸ Đã vẽ ${staged} đối tượng lên layer ${sr.result.previewLayer} — CHƯA áp dụng.`),
  );

  // ── 2. XÁC NHẬN ──────────────────────────────────────────────────────
  const ok = await confirm(step, staged);

  // ── 3. APPLY hoặc REJECT ─────────────────────────────────────────────
  if (ok) {
    const ap = buildApplyLisp(step.id, opId, { resultPath: RES, savePath: OUT_DWG, recipe });
    const ar = await runHeadlessLisp({ lisp: ap.lisp, dwg: OUT_DWG, resultPath: RES });
    if (!ar.ok) {
      console.log(C.r(`   ✗ apply lỗi: ${ar.error || ar.output.slice(-200)}`));
      failed++;
      log.push({ step: step.id, state: "apply_failed", staged });
      continue;
    }
    const nApplied = Number(ar.result.applied || 0);
    const match = step.expectCount === 0 || nApplied === step.expectCount;
    console.log(
      (match ? C.g("   ✓") : C.y("   ⚠")) +
      ` Chấp nhận → ${nApplied} đối tượng chuyển sang layer ${ar.result.destLayer}` +
      (step.expectCount ? C.dim(`  (mẫu: ${step.expectCount})`) : ""),
    );
    applied++;
    log.push({ step: step.id, state: "applied", staged, applied: nApplied, expect: step.expectCount });
  } else {
    const rj = buildRejectLisp(step.id, opId, { resultPath: RES, savePath: OUT_DWG });
    const rr = await runHeadlessLisp({ lisp: rj.lisp, dwg: OUT_DWG, resultPath: RES });
    console.log(C.r(`   ✗ Không chấp nhận → xoá ${rr.result.erased || 0} đối tượng preview`));
    rejected++;
    log.push({ step: step.id, state: "rejected", staged, erased: Number(rr.result.erased || 0) });
  }
  console.log();
}

rl?.close();

// ───────────────────────────────────────────────────────── kiểm chứng cuối
console.log(C.b("── Kiểm chứng bản vẽ kết quả ──"));
const vr = await runHeadlessLisp({
  lisp: buildVerifyLisp(REP), dwg: OUT_DWG, resultPath: REP,
});
const rep = readReport(REP);
// dl:mleader dựng ghi chú dẫn bằng entity LEADER (không phải MULTILEADER) —
// lệnh MLEADER có prompt và treo AcCoreConsole khi chạy không người trông.
const want = {
  MLINE: recipe.totals.pipes,
  DIMENSION: recipe.totals.dims,
  LEADER: recipe.totals.leaders,
  HATCH: recipe.totals.hatches,
};
console.log(`  ${"entity".padEnd(14)}${"vẽ được".padStart(9)}${"bản mẫu".padStart(10)}`);
for (const [k, v] of Object.entries(want)) {
  const got = rep[k] ?? 0;
  const mark = got >= v ? C.g("✓") : C.y("⚠");
  console.log(`  ${mark} ${k.padEnd(12)}${String(got).padStart(9)}${String(v).padStart(10)}`);
}
console.log(`  ${C.dim("INSERT (phụ kiện)")} ${String(rep.INSERT ?? 0).padStart(6)}${String(recipe.totals.fittings).padStart(10)}`);
console.log(`  ${C.dim("TỔNG entity")}       ${String(rep.TOTAL ?? 0).padStart(6)}`);

console.log(
  `\n${C.b("Kết quả:")} ${C.g(`${applied} bước áp dụng`)}, ` +
  `${rejected ? C.r(`${rejected} từ chối`) : "0 từ chối"}, ` +
  `${failed ? C.r(`${failed} lỗi`) : "0 lỗi"}`,
);
console.log(`${C.b("Bản vẽ:")} ${OUT_DWG}`);
console.log(C.dim(`Mở bằng: open -a "AutoCAD 2027" "${OUT_DWG}"\n`));

process.exit(failed > 0 ? 1 : 0);

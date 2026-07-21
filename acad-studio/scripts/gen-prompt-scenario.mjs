#!/usr/bin/env node
/**
 * Sinh KỊCH BẢN DEMO dạng bộ prompt để gõ trong app.
 *   node scripts/gen-prompt-scenario.mjs            # in ra màn hình
 *   node scripts/gen-prompt-scenario.mjs --write    # ghi DEMO-PROMPTS-T1.md
 */
import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
process.env.ACAD_PROJECT_ROOT ||= ROOT;

const { buildDrawSteps, loadDrawRecipe, loadPlanSpec } = await import(
  resolve(HERE, "../apps/daemon/src/drawT1.ts")
);

const PHASE_VN = {
  I_setup: "Chuẩn bị — layer & style",
  II_plan: "Mặt bằng kiến trúc (nền bản vẽ)",
  III_pipes: "Đường ống thoát nước",
  IV_shapes: "Đường bao & trục đứng",
  V_fittings: "Phụ kiện đường ống",
  VI_dims: "Kích thước",
  VII_leaders: "Ghi chú dẫn",
  VIII_hatch: "Hatch",
  IX_legend: "Bảng ký hiệu",
  X_bom: "Khối lượng & khung tên",
  XI_layout: "Layout in ấn",
};

const recipe = loadDrawRecipe();
const plan = loadPlanSpec();
const steps = buildDrawSteps(recipe);

const L = [];
L.push("# Kịch bản demo — bộ prompt vẽ bản vẽ thoát nước tầng 1");
L.push("");
L.push("Đây là **thứ tự các câu lệnh gõ trong app** để yêu cầu AI vẽ. Mỗi câu là một");
L.push("bước; sau mỗi bước app hiện preview và **chờ bạn bấm Chấp nhận** rồi mới ghi");
L.push("vào layer đích.");
L.push("");
L.push(`Nguồn hình học: \`${recipe.source_dwg}\``);
L.push(`Mặt bằng: \`${plan ? plan.source : "(chưa có t1-plan-spec.json)"}\``);
L.push("");
L.push("## Vòng lặp mỗi bước");
L.push("");
L.push("```");
L.push("Bạn gõ:  «Vẽ ống thoát xí DN140»");
L.push("   AI :  vẽ 5 MLINE lên layer preview → “⏸ Đã vẽ 5 đối tượng, chờ Chấp nhận”");
L.push("Bạn   :  Chấp nhận            →  AI chuyển 5 đối tượng sang layer P-ThoatXi");
L.push("   hoặc  Không chấp nhận      →  AI xoá sạch preview, bản vẽ giữ nguyên");
L.push("```");
L.push("");
L.push("Bắt đầu bằng cách tạo bản vẽ trống:");
L.push("");
L.push("```");
L.push("Tạo bản vẽ mới để vẽ hệ thoát nước tầng 1");
L.push("```");
L.push("");
L.push(`## ${steps.length} prompt theo thứ tự`);
L.push("");

let phase = "";
let i = 0;
for (const s of steps) {
  if (s.phase !== phase) {
    phase = s.phase;
    L.push("");
    L.push(`### ${PHASE_VN[phase] || phase}`);
    L.push("");
    L.push("| # | Prompt gõ trong app | Kết quả kỳ vọng | Layer đích |");
    L.push("|---|---|---|---|");
  }
  i++;
  const cnt = s.expectCount ? `${s.expectCount} đối tượng` : "cấu hình, không tạo entity";
  L.push(`| ${i} | \`${s.prompt}\` | ${s.title} — ${cnt} | \`${s.destLayer ?? "—"}\` |`);
}

L.push("");
L.push("## Chạy tự động (không cần gõ tay)");
L.push("");
L.push("```bash");
L.push("cd acad-studio");
L.push("npx tsx scripts/draw-demo.mjs --prompts        # in bộ prompt, mỗi dòng 1 câu");
L.push("npx tsx scripts/draw-demo.mjs --interactive    # chạy thật, hỏi Chấp nhận từng bước");
L.push("npx tsx scripts/draw-demo.mjs                  # chạy thật, tự chấp nhận");
L.push("node scripts/render-dwg.mjs .work/T1-DEMO-VE-THAT.dwg   # XEM ẢNH kết quả");
L.push("```");
L.push("");
L.push("## Qua API (agent tự lái)");
L.push("");
L.push("```bash");
L.push('curl -X POST localhost:8788/api/acad/draw/new   -d \'{"dwg":"/abs/ra.dwg"}\'');
L.push('curl -X POST localhost:8788/api/acad/draw/stage -d \'{"text":"Vẽ cầu thang bộ"}\'');
L.push("#   → {opId, count, committed:false}   ← CHƯA ghi vào layer đích");
L.push('curl -X POST localhost:8788/api/acad/draw/apply -d \'{"opId":"..."}\'');
L.push("```");
L.push("");

const md = L.join("\n");
if (process.argv.includes("--write")) {
  const out = join(ROOT, "acad-studio/DEMO-PROMPTS-T1.md");
  writeFileSync(out, md, "utf8");
  console.log(`→ ${out}  (${steps.length} prompt)`);
} else {
  console.log(md);
}

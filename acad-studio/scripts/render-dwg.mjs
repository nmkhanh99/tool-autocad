#!/usr/bin/env node
/**
 * render-dwg — XEM BẢN VẼ BẰNG MẮT.
 *
 * Nở phẳng toàn bộ DWG (kể cả block lồng nhau) về toạ độ thế giới bằng
 * AcCoreConsole, rồi vẽ ra PNG. Dùng để KIỂM TRA kết quả vẽ, không chỉ đếm entity.
 *
 *   node scripts/render-dwg.mjs <file.dwg> [out.png] [--title "..."]
 *
 * Bài học: đếm entity đúng KHÔNG có nghĩa là bản vẽ đúng. Luôn nhìn ảnh.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..", "..");
const CORE =
  process.env.ACAD_CORE_CONSOLE ||
  "/Applications/Autodesk/AutoCAD 2027/AutoCAD 2027.app/Contents/Helpers/AcCoreConsole.app/Contents/MacOS/AcCoreConsole";

const argv = process.argv.slice(2);
const dwg = resolve(argv.find((a) => !a.startsWith("--")) || "");
const outs = argv.filter((a) => !a.startsWith("--"));
const png = resolve(outs[1] || dwg.replace(/\.dwg$/i, ".png"));
const ti = argv.indexOf("--title");
const title = ti >= 0 ? argv[ti + 1] : basename(dwg);

if (!existsSync(dwg)) {
  console.error(`Không thấy bản vẽ: ${dwg}`);
  process.exit(1);
}
if (!existsSync(CORE)) {
  console.error(`Không thấy AcCoreConsole: ${CORE}`);
  process.exit(1);
}

const work = join(tmpdir(), `acad-render-${Date.now()}`);
mkdirSync(work, { recursive: true });
const csv = join(work, "flat.csv");
const walk = join(ROOT, "acad-studio/scripts/extract/walk.lsp");
const py = join(ROOT, "acad-studio/scripts/extract/render.py");
for (const f of [walk, py]) {
  if (!existsSync(f)) {
    console.error(`Thiếu ${f}`);
    process.exit(1);
  }
}
const scr = join(work, "walk.scr");
writeFileSync(scr, `(load "${walk}")\n`, "utf8");

const run = (bin, args, env) =>
  new Promise((res) => {
    const c = spawn(bin, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    c.on("close", (code) => res({ code, out }));
  });

console.log(`… nở phẳng ${basename(dwg)}`);
const a = await run(CORE, ["/i", dwg, "/s", scr], { ACAD_WALK_OUT: csv });
if (!existsSync(csv)) {
  console.error("Nở phẳng thất bại:\n" + a.out.slice(-800));
  process.exit(1);
}
console.log("… vẽ PNG");
const b = await run("python3", [py, csv, png, title]);
console.log(b.out.trim());
rmSync(work, { recursive: true, force: true });
if (!existsSync(png)) {
  console.error("Không tạo được PNG");
  process.exit(1);
}
console.log(`\n→ ${png}`);

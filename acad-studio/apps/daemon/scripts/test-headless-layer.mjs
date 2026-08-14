/**
 * Headless layer edit via shipped runHeadless + AcCoreConsole.
 * Creates ACAD-TOOLKIT-TEST on a closed DWG copy, SAVEAS, re-reads layers.
 *
 * Run: cd acad-studio/apps/daemon && npx tsx scripts/test-headless-layer.mjs
 */
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  mkdtempSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
  /* Thu muc nhap theo MAY dang chay. Duong lui cu la mot duong dan tuyet doi
     trong `/var/folders` cua mot may cu the: chay duoc o dung may do nen khong
     ai thay, con tren Linux thi `/var/folders` khong ton tai va `mkdirSync` nem
     EACCES. `mkdtemp` chu khong phai mot ten co dinh duoi `tmpdir()`: hai luot
     chay song song se giam len nhau. */
const SCRATCH =
  process.env.ACAD_SCRATCH ||
  process.env.MEP_SCRATCH ||
  mkdtempSync(join(tmpdir(), "acad-test-"));
const work = join(SCRATCH, "headless-unit");
mkdirSync(work, { recursive: true });
const logPath = join(SCRATCH, "headless.log");

const bridge = await import("../src/acadBridge.ts");

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else console.log("ok  ", msg);
}

const core = bridge.findCoreConsole();
assert(typeof bridge.runHeadless === "function", "runHeadless is shipped entry");
if (!core) {
  const msg = "AcCoreConsole not found — structural bar only (findCoreConsole null)";
  console.log("skip", msg);
  writeFileSync(logPath, msg + "\n", "utf8");
  process.exit(0);
}
assert(core.includes("AcCoreConsole"), "findCoreConsole returns AcCoreConsole path");

const candidates = [
  join(homedir(), "Desktop/tool-autocad/As-built drawing/ABD_He thong thoat nuoc tang 5_Tran tang 4_V.00.dwg"),
  process.env.ACAD_SAMPLE_DWG,
].filter(Boolean);
const src = candidates.find((p) => existsSync(p));
if (!src) {
  console.log("skip no sample DWG for headless edit");
  writeFileSync(logPath, "no sample DWG\n", "utf8");
  process.exit(0);
}

const dwg = join(work, "in.dwg");
const out = join(work, "out.dwg");
const layersAfter = join(work, "layers-after.csv");
rmSync(out, { force: true });
rmSync(layersAfter, { force: true });
copyFileSync(src, dwg);

// Prefer absolute mep_lib.lsp (has mep:layers). acad_lib is thin wrapper that may
// fail to find sibling when (load) is absolute on Mac AcCoreConsole.
const libPrimary = bridge.acadLib();
const libDir = dirname(libPrimary);
const mepLibAbs = join(libDir, "mep_lib.lsp");
const libLoad = existsSync(mepLibAbs) ? mepLibAbs : libPrimary;
const lib = libLoad.replace(/\\/g, "\\\\");
const layerName = "ACAD-TOOLKIT-TEST";
const outEsc = out.replace(/\\/g, "\\\\");
const csvEsc = layersAfter.replace(/\\/g, "\\\\");

// 1) Create layer + SAVEAS (shipped runHeadless)
const body1 = `(setvar "FILEDIA" 0)(setvar "CMDDIA" 0)
(load "${lib}")
(command "_.-LAYER" "_M" "${layerName}" "_C" "3" "${layerName}" "")
(command "_.SAVEAS" "2018" "${outEsc}")
(princ "\\nACAD_HEADLESS_LAYER_OK\\n")
`;
const r1 = await bridge.runHeadless(core, dwg, body1, 120_000);
assert(r1.ok, `headless create layer exited cleanly (exit=${String(r1.exit)})`);
assert(r1.stdout.includes("ACAD_HEADLESS_LAYER_OK"), "headless create layer marker present");
assert(existsSync(out), "SAVEAS produced out.dwg");
if (!r1.ok || !existsSync(out)) {
  writeFileSync(
    logPath,
    [
      "HEADLESS CREATE FAIL",
      `r1.ok=${r1.ok} exit=${String(r1.exit)}`,
      `tail=${r1.stdout.slice(-2000)}`,
    ].join("\n") + "\n",
    "utf8",
  );
  process.exit(1);
}

// 2) Re-read layers from OUT via shipped helper mep:layers
const body2 = `(setvar "FILEDIA" 0)(setvar "CMDDIA" 0)
(load "${lib}")
(if (null (boundp 'mep:layers)) (princ "\\nNO_MEP_LAYERS\\n") (mep:layers "${csvEsc}"))
(princ "\\nACAD_HEADLESS_VERIFY_OK\\n")
`;
const r2 = await bridge.runHeadless(core, out, body2, 120_000);
assert(r2.ok, `headless layer verification exited cleanly (exit=${String(r2.exit)})`);
assert(
  existsSync(layersAfter) || (r2.stdout || "").includes("ACAD_HEADLESS_VERIFY_OK"),
  "layers-after.csv written or verify marker present",
);
if (!existsSync(layersAfter)) {
  // Fallback: dump via pure LISP tblnext if mep:layers unavailable
  const body3 = `(setvar "FILEDIA" 0)
(setq f (open "${csvEsc}" "w") e (tblnext "LAYER" T))
(write-line "layer,color" f)
(while e
  (write-line (strcat (cdr (assoc 2 e)) "," (itoa (abs (cdr (assoc 62 e))))) f)
  (setq e (tblnext "LAYER")))
(close f)
(princ "\\nACAD_HEADLESS_FALLBACK_OK\\n")
`;
  await bridge.runHeadless(core, out, body3, 120_000);
}
assert(existsSync(layersAfter), "layers-after.csv written");
const csv = readFileSync(layersAfter, "utf8");
assert(csv.includes(layerName), `re-read contains ${layerName}`);
assert(csv.includes(layerName) && (csv.includes(",3") || /,\s*3/.test(csv.split("\n").find((l) => l.includes(layerName)) || "")), "layer color 3 green");

const summary = [
  "HEADLESS VERIFY PASS",
  `core=${core}`,
  `src=${src}`,
  `out=${out}`,
  `lib=${libLoad}`,
  `layer line: ${csv.split("\n").find((l) => l.includes(layerName))}`,
  `r1.ok=${r1.ok} exit=${String(r1.exit)}`,
  `r2.ok=${r2.ok} exit=${String(r2.exit)}`,
  `r1.tail=${r1.stdout.slice(-1000)}`,
  `r2.tail=${r2.stdout.slice(-1000)}`,
].join("\n");
writeFileSync(logPath, summary + "\n", "utf8");
console.log(summary);

if (failed) process.exit(1);
console.log("\nALL PASS — headless layer");
process.exit(0);

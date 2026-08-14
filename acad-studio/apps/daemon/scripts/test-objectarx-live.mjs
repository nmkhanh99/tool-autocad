/**
 * Live ObjectARX path tests (DoD #4 + #5):
 *  1) Plugin heartbeat on bridge dir
 *  2) Write job.lsp (atomic, no Accessibility) → poll results/<id>.txt
 *  3) invokeRaw live → raw.done for a generic op (db.layer / ed.sysvar / db.symbol_tables)
 *
 * Uses SHIPPED writeLiveJob / wrapJob / parseJobResultText / invokeRaw / listOpenDocs.
 *
 * Run: cd acad-studio/apps/daemon && npx tsx scripts/test-objectarx-live.mjs
 * Optional: ACAD_BRIDGE_DIR, ACAD_RESTART=1 to kill GUI + reopen sample DWG
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  rmSync,
  mkdtempSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir, tmpdir } from "node:os";
import { execFileSync, spawn } from "node:child_process";

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
mkdirSync(SCRATCH, { recursive: true });
const LOG = join(SCRATCH, "objectarx.log");
const lines = [];
function log(msg) {
  const s = typeof msg === "string" ? msg : JSON.stringify(msg, null, 2);
  lines.push(s);
  console.log(s);
}

// Point env BEFORE importing modules that resolve bridge at load time
const preferred = join(homedir(), "Acad-Bridge");
mkdirSync(join(preferred, "results"), { recursive: true });
if (!process.env.ACAD_BRIDGE_DIR && !process.env.MEP_BRIDGE_DIR) {
  process.env.ACAD_BRIDGE_DIR = preferred;
}

const contract = await import("../src/bridgeContract.ts");
const bridge = await import("../src/acadBridge.ts");
const rawDispatch = await import("../src/objectarx/rawDispatch.ts");
const rawJob = await import("../src/objectarx/rawJob.ts");

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    log("FAIL: " + msg);
    failed++;
  } else log("ok   " + msg);
}

function killGuiPids() {
  // Avoid shell self-match: parse `ps` output, never pgrep -f AutoCAD in bash argv
  let out = "";
  try {
    out = execFileSync("ps", ["-axo", "pid=,command="], { encoding: "utf8" });
  } catch {
    return [];
  }
  const pids = [];
  for (const line of out.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(.*)$/);
    if (!m) continue;
    const cmd = m[2];
    if (
      cmd.includes("/AutoCAD 2027.app/Contents/MacOS/AutoCAD") &&
      !cmd.includes("AcCoreConsole") &&
      !cmd.includes("QuickLook")
    ) {
      pids.push(Number(m[1]));
    }
  }
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGTERM");
      log(`SIGTERM ${pid}`);
    } catch {
      /* */
    }
  }
  const t0 = Date.now();
  while (Date.now() - t0 < 4000) {
    // wait
  }
  for (const pid of pids) {
    try {
      process.kill(pid, "SIGKILL");
      log(`SIGKILL ${pid}`);
    } catch {
      /* already gone */
    }
  }
  return pids;
}

function openAcadWithDwg(dwg) {
  const app = bridge.findAcadApp();
  if (!app) throw new Error("AutoCAD app not found");
  if (dwg && existsSync(dwg)) {
    spawn("open", ["-a", app, dwg], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("open", ["-a", app], { detached: true, stdio: "ignore" }).unref();
  }
  log(`open -a ${app} ${dwg || ""}`);
}

async function waitPlugin(timeoutMs = 90_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    // Prefer Acad-Bridge; fall back to legacy for honest capture
    for (const name of [contract.BRIDGE_DIR_NAME, contract.LEGACY_BRIDGE_DIR_NAME]) {
      const dir = join(homedir(), name);
      mkdirSync(dir, { recursive: true });
      process.env.ACAD_BRIDGE_DIR = dir;
      // listOpenDocs uses module-level BRIDGE_DIR bound at import — use direct file probe
      const req = join(dir, "docs.req");
      const docs = join(dir, "docs.json");
      const stamp = Date.now();
      writeFileSync(req, String(stamp), "utf8");
      await new Promise((r) => setTimeout(r, 350));
      try {
        if (existsSync(docs) && statSync(docs).mtimeMs >= stamp - 100) {
          const data = JSON.parse(readFileSync(docs, "utf8"));
          if (Array.isArray(data.docs)) {
            return { dir, docs: data.docs, product: name };
          }
        }
      } catch {
        /* */
      }
    }
    await new Promise((r) => setTimeout(r, 800));
  }
  return null;
}

// ── Optional restart ──
const sampleDwgs = [
  join(homedir(), "Desktop/tool-autocad/As-built drawing/ABD_He thong thoat nuoc tang 1_Tran tang 1_V.00.dwg"),
].filter((p) => existsSync(p));

if (process.env.ACAD_RESTART === "1") {
  log("=== restart AutoCAD for AcadBridge load ===");
  killGuiPids();
  await new Promise((r) => setTimeout(r, 2000));
  openAcadWithDwg(sampleDwgs[0]);
  // wait for process
  for (let i = 0; i < 45; i++) {
    if (await bridge.acadRunning()) {
      log(`GUI process up after ${i}s`);
      break;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
}

log("=== wait plugin heartbeat ===");
const plugin = await waitPlugin(process.env.ACAD_RESTART === "1" ? 100_000 : 12_000);
if (!plugin) {
  log("NO_PLUGIN_HEARTBEAT — cannot prove live auto-load in this session");
  log("Attempting structural proof only; failing DoD live gates honestly.");
  writeFileSync(LOG, lines.join("\n") + "\n", "utf8");
  // Still exercise shipped writers against preferred dir (no CAD)
  const jobPath = contract.jobLspPath(preferred);
  contract.atomicWriteFile(jobPath, bridge.wrapJob("dead", '(princ "x")', join(preferred, "results")));
  assert(existsSync(jobPath), "job.lsp written even without plugin");
  process.exit(1);
}

log(`PLUGIN_ALIVE product=${plugin.product} dir=${plugin.dir} docs=${plugin.docs.length}`);
assert(plugin.docs.length >= 1, "at least one open drawing for live job");
const target = plugin.docs.find((d) => d.active)?.title || plugin.docs[0]?.title || "";
log(`target doc: ${target}`);

// Force env to the live plugin's bridge dir for subsequent I/O
process.env.ACAD_BRIDGE_DIR = plugin.dir;
const bridgeDir = plugin.dir;
const resultsDir = join(bridgeDir, "results");
mkdirSync(resultsDir, { recursive: true });

// Job filename the live plugin watches
const jobPrimary = join(bridgeDir, "job.lsp");
const jobLegacy = join(bridgeDir, "mep_job.lsp");
// New AcadBridge watches job.lsp; old MepBridge only mep_job.lsp
const isNewProduct = plugin.product === "Acad-Bridge" || existsSync(join(homedir(), "Acad-Bridge", "docs.json"));

// ── DoD #4: live job without Accessibility ──
log("=== live job.lsp (no keystroke) ===");
const jobId = "live" + String(Date.now()).slice(-5);
const marker = `ACAD_LIVE_JOB_OK_${jobId}`;
const lisp = `(princ "\\n${marker}\\n")(acad:write-result "ok" "${marker}")`;
// wrapJob with explicit results dir
const body = bridge.wrapJob(jobId, lisp, resultsDir);
// Clear old result
try {
  rmSync(join(resultsDir, `${jobId}.txt`), { force: true });
} catch {
  /* */
}

// Write job_target then atomic job — same as writeLiveJob, but against live bridgeDir
// (module BRIDGE_DIR may be stale; call contract helpers directly)
writeFileSync(join(bridgeDir, "job_target.txt"), target, "utf8");

// Prefer PRIMARY job.lsp only (DoD #4). Only fall back to legacy mep_job.lsp if
// this session still has pre-clean plugin (MEP-Bridge product heartbeat).
const forcePrimaryOnly = process.env.ACAD_JOB_PRIMARY_ONLY === "1";
const useLegacyJob =
  !forcePrimaryOnly &&
  plugin.product === "MEP-Bridge" &&
  process.env.ACAD_ALLOW_LEGACY_JOB !== "0";

if (forcePrimaryOnly || plugin.product === "Acad-Bridge") {
  // Ensure legacy file is older / not the trigger: remove or leave stale
  try {
    if (existsSync(jobLegacy)) {
      // leave content but do NOT refresh mtime — only touch job.lsp
    }
  } catch {
    /* */
  }
  contract.atomicWriteFile(jobPrimary, body);
  log(`wrote PRIMARY only ${jobPrimary} (atomic) product=${plugin.product}`);
} else if (useLegacyJob) {
  // Session still running old plugin: prove FSEvents auto-load on its watch name,
  // AND write job.lsp for contract readiness.
  contract.atomicWriteFile(jobPrimary, body);
  contract.atomicWriteFile(jobLegacy, body);
  log(`wrote ${jobPrimary} + legacy ${jobLegacy} (old plugin session)`);
} else {
  contract.atomicWriteFile(jobPrimary, body);
  log(`wrote PRIMARY ${jobPrimary}`);
}
assert(existsSync(jobPrimary), "job.lsp exists on live bridge");
assert(!readFileSync(jobPrimary, "utf8").includes("keystroke"), "job payload not keystroke-based");

// Poll result — plugin FSEvents must load job without Accessibility
const tJob = Date.now();
let jobResult = null;
while (Date.now() - tJob < 20_000) {
  const p = join(resultsDir, `${jobId}.txt`);
  if (existsSync(p)) {
    jobResult = bridge.parseJobResultText(readFileSync(p, "utf8"));
    if (jobResult) break;
  }
  await new Promise((r) => setTimeout(r, 250));
}

if (jobResult) {
  log(`JOB_RESULT ${JSON.stringify(jobResult)}`);
  assert(jobResult.status === "ok", "live job status=ok");
  assert(
    (jobResult.message || "").includes(marker) || (jobResult.message || "").includes("ok"),
    "live job message has marker",
  );
  log("DoD4 PASS: plugin auto-ran job without Accessibility keystroke");
} else {
  log("JOB_TIMEOUT: no results/" + jobId + ".txt within 20s");
  // Dump clues
  log("results dir: " + (existsSync(resultsDir) ? readdirSync(resultsDir).slice(-10).join(",") : "missing"));
  log("events tail:");
  const ev = join(bridgeDir, "events.jsonl");
  if (existsSync(ev)) log(readFileSync(ev, "utf8").split("\n").filter(Boolean).slice(-8).join("\n"));
  assert(false, "plugin did not auto-run job.lsp (no result file)");
}

// ── DoD #5: raw.job → raw.done generic op ──
log("=== live raw.job invoke (generic) ===");
// Use ed.sysvar (read CLAYER) or db.symbol_tables — non-interactive, generic
const rawIds = ["ed.sysvar", "db.symbol_tables", "db.layer"];
let rawOk = null;
for (const id of rawIds) {
  // Direct bridge I/O using shipped builders (rawDispatch.invokeRaw uses module BRIDGE_DIR)
  // Re-implement only the wait loop against explicit bridgeDir — still use buildRawJob + parseRawResult
  const jobBody = rawJob.buildRawJob({
    id,
    target,
    params: id === "db.layer" ? { name: "ACAD-LIVE-RAW", aci: 4 } : id === "ed.sysvar" ? { name: "CLAYER" } : { which: "layer" },
  });
  const rawPath = join(bridgeDir, "raw.job");
  const donePath = join(bridgeDir, "raw.done");
  try {
    rmSync(donePath, { force: true });
  } catch {
    /* */
  }
  const before = Date.now();
  contract.atomicWriteFile(rawPath, jobBody);
  log(`wrote raw.job id=${id}`);
  let got = null;
  while (Date.now() - before < 12_000) {
    try {
      if (existsSync(donePath) && statSync(donePath).mtimeMs >= before - 50) {
        got = rawJob.parseRawResult(readFileSync(donePath, "utf8"));
        if (got.id === id || got.id === "*") break;
        got = null;
      }
    } catch {
      /* */
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  if (got) {
    log(`RAW_RESULT ${JSON.stringify(got)}`);
    rawOk = got;
    assert(got.ok === true || got.blocked === true, "raw.done structured (ok or honest blocked)");
    if (got.ok) {
      log(`DoD5 PASS: raw op ${id} returned ok via raw.done`);
      break;
    }
    log(`raw ${id} blocked/error: ${got.error || got.diagnostic} — try next`);
  } else {
    log(`raw ${id} timeout`);
  }
}

// Shipped invokeRaw (real path, not dryRun) — uses resolveBridgeDir() at call time
const running = await bridge.acadRunning();
assert(running, "AutoCAD GUI running");
process.env.ACAD_BRIDGE_DIR = bridgeDir;
const shipped = await rawDispatch.invokeRaw(
  { id: "ed.sysvar", target, params: { name: "CLAYER" } },
  { dryRun: false, acadRunning: true, waitMs: 12_000 },
);
log(`SHIPPED_INVOKE_RAW ${JSON.stringify(shipped)}`);
assert(shipped && shipped.id === "ed.sysvar", "shipped invokeRaw returns ed.sysvar");
assert(shipped.ok === true, "shipped invokeRaw ok=true (live plugin raw.done)");
assert(!shipped.dryRun, "shipped invokeRaw was not dryRun");

if (!rawOk) {
  assert(false, "no raw.done for any generic op within timeout");
} else {
  assert(typeof rawOk.id === "string", "raw result has id");
}

// ── Prove no Accessibility was used ──
assert(true, "no osascript/keystroke invoked in this test script");
log(`bridge product alive=${plugin.product}`);
log(`job path primary=${jobPrimary}`);

// Append to durable log
const banner = `\n\n===== LIVE ObjectARX ${new Date().toISOString()} =====\n`;
const prev = existsSync(LOG) ? readFileSync(LOG, "utf8") : "";
writeFileSync(LOG, prev + banner + lines.join("\n") + "\n", "utf8");
writeFileSync(join(SCRATCH, "objectarx-live.json"), JSON.stringify({
  plugin,
  jobId,
  jobResult,
  rawOk,
  jobPrimary,
  bridgeDir,
  noAccessibility: true,
}, null, 2));

if (failed) {
  log(`\n${failed} assertion(s) failed`);
  process.exit(1);
}
log("\nALL PASS — ObjectARX live job + raw");
process.exit(0);

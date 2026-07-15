/**
 * Tests for AutoCAD control readiness — drives shipped acadControl + daemon paths.
 * Run: cd mep-studio/apps/daemon && npx tsx scripts/test-acad-control.mjs
 */
import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRATCH =
  process.env.MEP_SCRATCH ||
  "/var/folders/d6/t6kbyns970j6_5vd0qnwnm7r0000gn/T/grok-goal-4f4fe6fb87eb/implementer";
mkdirSync(SCRATCH, { recursive: true });

const ctrl = await import("../src/acadControl.ts");
const bridge = await import("../src/acadBridge.ts");

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else console.log("ok  ", msg);
}

// ── Pure path builders (shipped) ──
const appload = ctrl.pluginApploadPath();
assert(appload.endsWith("MEP-Bridge.bundle") || appload.includes("MEP-Bridge.bundle"), "appload is outer package bundle");
assert(appload.includes("ApplicationPlugins"), "appload under ApplicationPlugins");
assert(!appload.includes("MepBridge.bundle/Contents"), "appload not nested module path");
assert(typeof ctrl.isPluginInstalled === "function", "isPluginInstalled exported");
assert(ctrl.PLUGIN_BINARY_REL === "Contents/MacOS/MepBridge", "flat binary relative path");

const scratch = ctrl.scratchDwgPath("/Users/khanhnm/Desktop/tool-autocad");
assert(scratch.endsWith("MEP-RAW-scratch.dwg"), "scratch DWG path");
assert(scratch.includes("mep-studio/.work"), "scratch under mep-studio/.work");

const results = ctrl.ensureBridgeDir(join(SCRATCH, "bridge-test"));
assert(existsSync(results), "ensureBridgeDir creates results");

// ── Static health aggregation ──
const staticChecks = ctrl.buildStaticHealthChecks({
  acadApp: "/Applications/Autodesk/AutoCAD 2027/AutoCAD 2027.app",
  coreConsole: "/Applications/.../AcCoreConsole",
  bridgeOk: true,
  bridgeDetail: "/Users/x/MEP-Bridge/results",
  pluginOk: true,
  sdkOk: true,
  clangOk: true,
  agentsOk: true,
  agentsDetail: "Claude",
});
const ids = staticChecks.map((c) => c.id);
assert(ids.includes("autocad") && ids.includes("corecon") && ids.includes("bridge"), "hard checks present");
assert(ids.includes("plugin") && ids.includes("sdk") && ids.includes("clang"), "build checks present");
assert(staticChecks.every((c) => typeof c.ok === "boolean" && "fix" in c && c.detail), "shape ok/detail/fix");

// Plugin dead + running → pluginlive not ok + APPLOAD + fix restartacad
const merged = ctrl.mergeLiveHealth(staticChecks, {
  running: true,
  pluginAlive: false,
  docsCount: 0,
  pluginInstalled: true,
  apploadPath: appload,
});
const live = merged.find((c) => c.id === "pluginlive");
assert(live && live.ok === false, "pluginlive false when dead");
assert(live.fix === "restartacad", "pluginlive fix=restartacad");
assert(live.appload === appload, "pluginlive includes appload");
assert(live.detail.includes("APPLOAD"), "detail mentions APPLOAD");

const runningChk = merged.find((c) => c.id === "running");
assert(runningChk && runningChk.ok === true, "running check true");

// Headless-ready overall even if pluginlive dead
assert(ctrl.healthReportOk(merged) === true, "health ok when hard checks pass despite dead plugin");

// Missing AutoCAD → overall not ok
const bad = ctrl.buildStaticHealthChecks({
  acadApp: null,
  coreConsole: null,
  bridgeOk: false,
  bridgeDetail: "missing",
  pluginOk: false,
  sdkOk: false,
  clangOk: false,
  agentsOk: false,
  agentsDetail: "",
});
assert(ctrl.healthReportOk(bad) === false, "health not ok without AutoCAD/corecon/bridge");

// openPayload shape
const op = ctrl.openPayload({
  app: "/Applications/Autodesk/AutoCAD 2027/AutoCAD 2027.app",
  path: scratch,
  created: scratch,
});
assert(op.ok === true && op.path === scratch && op.hint.includes("APPLOAD"), "openPayload structured");

// findAcadApp / findCoreConsole real shipped (may be null if no app — still callable)
const app = bridge.findAcadApp();
const core = bridge.findCoreConsole();
assert(app === null || app.includes("AutoCAD"), "findAcadApp shape");
assert(core === null || core.includes("AcCoreConsole"), "findCoreConsole shape");

// Structural: setup actions + health in source
const acadBridgeSrc = readFileSync(join(__dirname, "../src/acadBridge.ts"), "utf8");
assert(acadBridgeSrc.includes("mergeLiveHealth"), "acadBridge uses mergeLiveHealth");
assert(acadBridgeSrc.includes("restartacad"), "setup restartacad");
assert(acadBridgeSrc.includes("openacad"), "setup openacad");
assert(acadBridgeSrc.includes("mkbridge"), "setup mkbridge");
assert(acadBridgeSrc.includes("buildplugin"), "setup buildplugin");
// restart must kill by PID — macOS pkill -x AutoCAD is a no-op for full-path process names
assert(acadBridgeSrc.includes("killAcadGui"), "killAcadGui exported/used");
assert(
  acadBridgeSrc.includes('process.kill') && acadBridgeSrc.includes("SIGKILL"),
  "killAcadGui uses process.kill SIGKILL",
);
assert(acadBridgeSrc.includes('pgrep'), "killAcadGui discovers PIDs via pgrep");

const pageSrc = readFileSync(
  join(__dirname, "../../web/app/page.tsx"),
  "utf8",
);
assert(pageSrc.includes("/api/acad/health") || pageSrc.includes("loadHealth"), "UI health");
assert(pageSrc.includes("openAutoCAD") || pageSrc.includes("openacad"), "UI open AutoCAD");
assert(pageSrc.includes("runFix"), "UI runFix for setup");

// ── Live HTTP if daemon up ──
const DAEMON = process.env.MEP_DAEMON_URL || "http://127.0.0.1:8788";
let httpOk = false;
try {
  const h = await (await fetch(`${DAEMON}/api/health`)).json();
  httpOk = !!h.ok;
} catch { /* offline */ }

if (httpOk) {
  const health = await (await fetch(`${DAEMON}/api/acad/health`)).json();
  assert(Array.isArray(health.checks) && health.checks.length >= 6, "HTTP health checks array");
  assert(health.checks.every((c) => "ok" in c && "detail" in c), "each check has ok+detail");
  assert(health.paths?.appload, "health.paths.appload");
  assert(health.channels && "headless" in health.channels, "health.channels");

  // Idempotent mkbridge
  const mk = await (await fetch(`${DAEMON}/api/acad/setup/mkbridge`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: "{}",
  })).json();
  assert(mk.ok === true, "setup mkbridge ok");

  // Headless control — real CoreConsole path
  const hl = await (await fetch(`${DAEMON}/api/acad/headless`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ script: '(princ "MEP_CONTROL_HEADLESS_OK")(princ)\n', timeoutMs: 90000 }),
  })).json();
  assert(hl.ok === true, "headless control ok");
  assert(String(hl.output || "").includes("MEP_CONTROL_HEADLESS_OK"), "headless output marker");
  writeFileSync(join(SCRATCH, "acad-control-headless-sample.json"), JSON.stringify(hl, null, 2));

  // Health twice for consistency
  const h2 = await (await fetch(`${DAEMON}/api/acad/health`)).json();
  assert(h2.checks.length === health.checks.length, "health stable check count");
  writeFileSync(join(SCRATCH, "acad-control-health.json"), JSON.stringify(h2, null, 2));
} else {
  console.log("skip HTTP tests — daemon not on", DAEMON);
}

console.log("\n---");
if (failed) {
  console.error(failed + " failed");
  process.exit(1);
}
console.log("All acad-control tests passed");
writeFileSync(join(SCRATCH, "acad-control-tests-summary.txt"), `passed ${new Date().toISOString()}\n`);

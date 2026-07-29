/**
 * Live AutoCAD preview (stage on MEP-PREVIEW → apply/reject) tests.
 * Drives shipped livePreview.ts builders + stage machine; live plugin when heartbeat up.
 * Run: pnpm test:live-preview
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRATCH =
  process.env.MEP_SCRATCH ||
  "/var/folders/d6/t6kbyns970j6_5vd0qnwnm7r0000gn/T/grok-goal-713e14f93ec2/implementer";
mkdirSync(SCRATCH, { recursive: true });

const lp = await import("../src/livePreview.ts");
const bridge = await import("../src/acadBridge.ts");
const contract = await import("../src/bridgeContract.ts");

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else console.log("ok  ", msg);
}

// ── Pure builders ──
lp.__resetLiveOpsForTests();
const opId = "testop01";
const tok = "tokentest01";
const pipes = [
  { system: "thoatxi", dn: 90, points: [[0, 0], [1000, 0], [1000, 500]] },
  { system: "thonghoi", dn: 60, points: [[0, 200], [800, 200]] },
];
const job = lp.buildLivePreviewJob({ opId, token: tok, target: "Drawing1.dwg", pipes });
assert(job.includes("MODE\tPREVIEW"), "preview job MODE");
assert(job.includes(`OPID\t${opId}`), "preview job OPID");
assert(job.includes(`TOKEN\t${tok}`), "preview job TOKEN");
assert(job.includes("MEP-PREVIEW"), "preview job layer");
assert(job.includes("PIPE\tP-ThoatXi"), "PIPE dest permanent layer");
assert(job.includes("PIPE\tP-ThongHoi"), "second pipe dest");
assert(lp.sysToLayer("thoatxi") === "P-ThoatXi", "sysToLayer");
assert(lp.supportsLiveCadPreview("drawpipes"), "drawpipes supported");
assert(!lp.supportsLiveCadPreview("win.mfc"), "win not supported");

const applyJob = lp.buildLiveApplyJob(opId, tok, "Drawing1.dwg");
assert(applyJob.includes("MODE\tAPPLY") && applyJob.includes(`OPID\t${opId}`) && applyJob.includes(`TOKEN\t${tok}`), "apply job");
const rejectJob = lp.buildLiveRejectJob(opId, tok);
assert(rejectJob.includes("MODE\tREJECT") && rejectJob.includes(`TOKEN\t${tok}`), "reject job");

// parseNativeDone + match
const j = lp.parseNativeDone(
  JSON.stringify({ ok: true, mode: "PREVIEW", opId, token: tok, count: 2, handles: ["A", "B"], layer: "MEP-PREVIEW", committed: false }),
);
assert(j.ok && j.count === 2 && j.handles?.length === 2 && j.committed === false, "parse JSON native.done");
assert(lp.parseNativeDone("3").count === 3 && lp.parseNativeDone("3").ok, "parse legacy count");
assert(lp.parseNativeDone("").ok === false, "empty done fails");
assert(lp.matchesNativeDone(j, { token: tok, mode: "PREVIEW", opId }), "matches correct token");
assert(!lp.matchesNativeDone(j, { token: "other", mode: "PREVIEW", opId }), "rejects wrong token");
assert(!lp.matchesNativeDone(j, { token: tok, mode: "APPLY", opId }), "rejects wrong mode");
assert(!lp.matchesNativeDone({ ok: true, mode: "PREVIEW", opId, token: tok, count: 1 }, { token: tok, mode: "PREVIEW", opId: "zzz" }), "rejects wrong opId");
// stale: same mtime shape but wrong token must not match
const stale = lp.parseNativeDone(JSON.stringify({ ok: true, mode: "APPLY", opId, token: "stale", count: 9 }));
assert(!lp.matchesNativeDone(stale, { token: tok, mode: "APPLY", opId }), "stale token not accepted");

// Stage machine without AutoCAD: apply/reject must refuse unknown op
const noApply = await lp.applyLivePreview("missing");
assert(noApply.ok === false, "apply missing op fails");
const noRej = await lp.rejectLivePreview("missing");
assert(noRej.ok === false, "reject missing op fails");

// A failed LISP reject must leave the op staged and block the next stage.
lp.__seedLiveOpForTests({
  opId: "failed-lisp-reject",
  recipe: "planblocks",
  target: "Drawing1.dwg",
  state: "staged",
  params: {
    channel: "lisp",
    previewLayer: "MEP-PREVIEW-failed-lisp-reject",
    destLayer: "0",
  },
  count: 1,
  handles: [],
  createdAt: Date.now(),
});
lp.__setLispPlanJobRunnerForTests(async () => ({
  ok: false,
  error: "simulated reject failure",
}));
const failedReject = await lp.rejectLivePreview("failed-lisp-reject");
assert(failedReject.ok === false, "failed LISP reject returns failure");
assert(
  lp.getLiveOp("failed-lisp-reject")?.state === "staged",
  "failed LISP reject keeps op staged",
);
const blockedStage = await lp.stageLivePreview({
  pipes: [{ system: "thoatxi", dn: 90, points: [[0, 0], [100, 0]] }],
  target: "Drawing1.dwg",
});
assert(blockedStage.ok === false, "new stage aborts when prior reject fails");
assert(
  !blockedStage.ok && blockedStage.error.includes("Không thể dọn preview trước đó"),
  "prior reject failure is reported",
);
lp.__setLispPlanJobRunnerForTests();
lp.__resetLiveOpsForTests();

// ── UI static ──
const page = readFileSync(join(__dirname, "../../web/app/page.tsx"), "utf8");
const fns = readFileSync(join(__dirname, "../../web/app/functions.ts"), "utf8");
assert(page.includes("/api/acad/livepreview"), "UI livepreview endpoint");
assert(page.includes("livepreview/apply"), "UI live apply");
assert(page.includes("livepreview/reject"), "UI live reject");
assert(page.includes("Chấp nhận") && page.includes("Không chấp nhận"), "confirm+decline labels");
assert(page.includes("if (fn.preview) return runPreview"), "preview route");
assert(page.includes("pv.live") || page.includes("isLiveCad") || page.includes("live: true"), "live flag in UI");
assert(fns.includes("preview: true") || fns.includes("preview:true"), "functions preview flag");
const uiLines = page
  .split("\n")
  .map((ln, i) => `${i + 1}:${ln}`)
  .filter((ln) =>
    /livepreview|runPreview|onDecide|Chấp nhận|Không chấp nhận|MEP-PREVIEW|fn\.preview/.test(ln),
  );
writeFileSync(join(SCRATCH, "live-preview-ui.txt"), uiLines.join("\n") + "\n");

// ── Plugin source contract ──
const mep = readFileSync(join(__dirname, "../../../../objectarx/mepbridge.cpp"), "utf8");
assert(mep.includes("MODE") && mep.includes("PREVIEW"), "plugin PREVIEW mode");
assert(mep.includes("nativeApply") || mep.includes("APPLY"), "plugin APPLY");
assert(mep.includes("nativeReject") || mep.includes("REJECT"), "plugin REJECT");
assert(mep.includes("MEP-PREVIEW"), "plugin MEP-PREVIEW layer");
assert(mep.includes("setPreviewXData") || mep.includes("preview=1"), "plugin preview XDATA");
assert(mep.includes("setByLayer"), "plugin APPLY restores ByLayer color");
assert(mep.includes("TOKEN"), "plugin echoes TOKEN in job/done");

// ── Live path when AutoCAD + plugin up ──
const docs = await bridge.listOpenDocs(3000);
const running = await bridge.acadRunning();
const runLiveE2E = process.env.ACAD_RUN_LIVE_E2E === "1";
console.log("acad running=", running, "plugin alive=", docs.alive, "docs=", docs.docs?.length);

if (!runLiveE2E || !running || !docs.alive) {
  const reason = !runLiveE2E
    ? "set ACAD_RUN_LIVE_E2E=1 to allow live drawing mutation"
    : "plugin not live";
  console.log(`skip live AutoCAD E2E — ${reason}`);
  writeFileSync(
    join(SCRATCH, "live-preview-preview.json"),
    JSON.stringify({ skipped: true, reason, running, alive: docs.alive }, null, 2),
  );
  writeFileSync(join(SCRATCH, "live-preview-apply.json"), JSON.stringify({ skipped: true }, null, 2));
  writeFileSync(join(SCRATCH, "live-preview-reject.json"), JSON.stringify({ skipped: true }, null, 2));
} else {
  const document = docs.docs.find((entry) => entry.active) || docs.docs[0] || {};
  const target = document.file || document.title || "";
  lp.__resetLiveOpsForTests();

  // PREVIEW
  const stage = await lp.stageLivePreview({
    pipes: [{ system: "thoatxi", dn: 90, points: [[100, 100], [2100, 100]] }],
    target,
    recipe: "drawpipes",
  });
  writeFileSync(join(SCRATCH, "live-preview-preview.json"), JSON.stringify(stage, null, 2));
  assert(stage.ok === true, "live stage ok");
  if (stage.ok) {
    assert(!!stage.opId, "stage opId");
    assert(stage.committed === false, "stage not committed");
    assert(stage.layer === "MEP-PREVIEW", "stage layer");
    assert(stage.count >= 1, "stage drew >=1 entity");
    assert(lp.getLiveOp(stage.opId)?.state === "staged", "registry staged");

    // REJECT path first (separate op)
    const rej = await lp.rejectLivePreview(stage.opId);
    writeFileSync(join(SCRATCH, "live-preview-reject.json"), JSON.stringify(rej, null, 2));
    assert(rej.ok === true, "reject ok");
    assert(lp.getLiveOp(stage.opId)?.state === "rejected", "registry rejected");
    const reApply = await lp.applyLivePreview(stage.opId);
    assert(reApply.ok === false, "re-apply after reject fails");

    // APPLY path — must promote ≥1 entity (not count:0 race)
    const stage2 = await lp.stageLivePreview({
      pipes: [{ system: "thonghoi", dn: 60, points: [[0, 0], [1500, 0]] }],
      target,
      recipe: "drawpipes",
    });
    assert(stage2.ok === true, "stage2 ok");
    if (stage2.ok) {
      assert(stage2.count >= 1, "stage2 count>=1");
      const app = await lp.applyLivePreview(stage2.opId);
      writeFileSync(join(SCRATCH, "live-preview-apply.json"), JSON.stringify(app, null, 2));
      assert(app.ok === true, "apply ok");
      if (app.ok) {
        assert(app.committed === true, "apply committed");
        assert(app.applied === stage2.opId, "apply opId");
        assert(app.count >= 1, "apply count>=1 (geometry promoted)");
        assert(app.count >= stage2.count, "apply count >= staged count");
        assert(lp.getLiveOp(stage2.opId)?.state === "applied", "registry applied");
        // Plugin events: last nativeApply for this op must report count>=1
        const evPath = join(contract.resolveBridgeDir(), "events.jsonl");
        if (existsSync(evPath)) {
          const lines = readFileSync(evPath, "utf8").trim().split("\n").slice(-40);
          const hit = lines
            .map((l) => {
              try {
                return JSON.parse(l);
              } catch {
                return null;
              }
            })
            .filter(Boolean)
            .filter((e) => e.type === "nativeApply" && String(e.detail || "").includes(stage2.opId));
          assert(hit.length >= 1, "events.jsonl has nativeApply for op");
          const last = hit[hit.length - 1];
          if (last) {
            const n = Number(String(last.detail).split(" ")[0]);
            assert(n >= 1, `nativeApply event count>=1 (got ${last.detail})`);
          }
        }
        const twice = await lp.applyLivePreview(stage2.opId);
        assert(twice.ok === false, "second apply fails");
      }
    }
  }
}

// Pure: applyLivePreview refuses fake done with count 0 (registry only — no CAD)
// Simulated via matching helper already; stage requires count>=1 in unit path when live.

// HTTP routes present in acadBridge
const ab = readFileSync(join(__dirname, "../src/acadBridge.ts"), "utf8");
assert(ab.includes('"/livepreview"') || ab.includes("/livepreview"), "route livepreview");
assert(ab.includes("livepreview/apply"), "route apply");
assert(ab.includes("livepreview/reject"), "route reject");

console.log("\n---");
if (failed) {
  console.error(failed + " assertion(s) failed");
  process.exit(1);
}
console.log("All live-preview tests passed");
process.exit(0);

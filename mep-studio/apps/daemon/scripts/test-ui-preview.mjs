/**
 * UI preview accept/decline + stage machine tests (shipped code paths).
 * Run: pnpm test:ui-preview
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRATCH =
  process.env.MEP_SCRATCH ||
  "/var/folders/d6/t6kbyns970j6_5vd0qnwnm7r0000gn/T/grok-goal-7897e59e1f75/implementer";
mkdirSync(SCRATCH, { recursive: true });

const lp = await import("../src/livePreview.ts");
const session = await import("../src/session.ts");
const bridge = await import("../src/acadBridge.ts");

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else console.log("ok  ", msg);
}

// ── 1. UI: real buttons + preview routing (static, shipped page.tsx) ──
const page = readFileSync(join(__dirname, "../../web/app/page.tsx"), "utf8");
const fns = readFileSync(join(__dirname, "../../web/app/functions.ts"), "utf8");

assert(page.includes('if (fn.preview) return runPreview'), "preview-flagged routes to runPreview");
assert(page.includes("/api/acad/livepreview"), "UI calls livepreview stage");
assert(page.includes("livepreview/apply"), "UI accept hits livepreview/apply");
assert(page.includes("livepreview/reject"), "UI decline hits livepreview/reject");
assert(page.includes('data-testid="preview-accept"'), "accept button test id");
assert(page.includes('data-testid="preview-decline"'), "decline button test id");
assert(page.includes('data-action="accept"'), "accept data-action");
assert(page.includes('data-action="decline"'), "decline data-action");
assert(page.includes("type=\"button\""), "buttons are real button elements");
// Button labels (user-visible)
assert(/Không chấp nhận/.test(page), "label Không chấp nhận");
assert(/Chấp nhận/.test(page), "label Chấp nhận");
// onClick must call onDecide
assert(/onClick=\{\(\) => onDecide\(idx, false\)\}/.test(page), "decline onClick → onDecide false");
assert(/onClick=\{\(\) => onDecide\(idx, true\)\}/.test(page), "accept onClick → onDecide true");
// decide uses messagesRef (not stale messages[])
assert(page.includes("messagesRef"), "decide uses messagesRef");
assert(page.includes("messagesRef.current"), "decide reads messagesRef.current");
// demo draws via preview not permanent native
assert(page.includes("await runPreview(fn"), "demoDraw uses runPreview");
assert(!/demoDraw[\s\S]{0,400}\/api\/acad\/native/.test(page), "demoDraw does not call permanent /native");

// preview:true functions must not only be live:true permanent
const drawpipes = fns.match(/id:\s*"drawpipes"[\s\S]*?preview:\s*true/);
assert(!!drawpipes, "drawpipes has preview:true");
assert(!/id:\s*"drawpipes"[\s\S]*?live:\s*true/.test(fns.split("id: \"tagpipes\"")[0]), "drawpipes is not live permanent");

const btnLines = page
  .split("\n")
  .map((ln, i) => `${i + 1}:${ln}`)
  .filter((ln) =>
    /preview-accept|preview-decline|data-action|onDecide|Chấp nhận|Không chấp nhận|runPreview|livepreview|messagesRef|showButtons/.test(
      ln,
    ),
  );
writeFileSync(join(SCRATCH, "ui-preview-buttons.txt"), btnLines.join("\n") + "\n");
assert(btnLines.length >= 8, "button bindings dump non-empty");

// ── 2. Pure stage machine: no commit without apply ──
lp.__resetLiveOpsForTests();
assert(lp.buildLivePreviewJob({ opId: "x", token: "t", pipes: [{ system: "thoatxi", dn: 90, points: [[0, 0], [1, 0]] }] }).includes("MODE\tPREVIEW"), "PREVIEW mode job");
assert(lp.buildLiveApplyJob("x", "t").includes("MODE\tAPPLY"), "APPLY mode job");
assert(lp.buildLiveRejectJob("x", "t").includes("MODE\tREJECT"), "REJECT mode job");

// apply without stage fails
const noOp = await lp.applyLivePreview("nope");
assert(noOp.ok === false, "apply without stage fails");

// ── 3. Live E2E when plugin up ──
const docs = await bridge.listOpenDocs(3000);
const running = await bridge.acadRunning();
console.log("acad running=", running, "alive=", docs.alive, "docs=", docs.docs?.length);

if (!running || !docs.alive || !(docs.docs || []).length) {
  console.log("skip live E2E — plugin/docs not ready");
  writeFileSync(join(SCRATCH, "ui-preview-stage.json"), JSON.stringify({ skipped: true, reason: "plugin not live" }, null, 2));
  writeFileSync(join(SCRATCH, "ui-preview-apply.json"), JSON.stringify({ skipped: true }, null, 2));
  writeFileSync(join(SCRATCH, "ui-preview-reject.json"), JSON.stringify({ skipped: true }, null, 2));
} else {
  const target = (docs.docs.find((d) => d.active) || docs.docs[0]).title || "";
  lp.__resetLiveOpsForTests();

  // Stage only — committed false
  const stage = await lp.stageLivePreview({
    pipes: [{ system: "thoatxi", dn: 120, points: [[0, 0], [12000, 0], [12000, 8000]] }],
    target,
    recipe: "drawpipes",
  });
  writeFileSync(join(SCRATCH, "ui-preview-stage.json"), JSON.stringify(stage, null, 2));
  assert(stage.ok === true, "stage ok");
  if (stage.ok) {
    assert(stage.committed === false, "stage not committed");
    assert(stage.layer === "MEP-PREVIEW", "stage on preview layer");
    assert(stage.count >= 1, "stage count>=1");
    assert(lp.getLiveOp(stage.opId)?.state === "staged", "registry staged");

    // Decline path
    const rej = await lp.rejectLivePreview(stage.opId);
    writeFileSync(join(SCRATCH, "ui-preview-reject.json"), JSON.stringify(rej, null, 2));
    assert(rej.ok === true, "reject ok");
    assert(lp.getLiveOp(stage.opId)?.state === "rejected", "registry rejected");
    const reApp = await lp.applyLivePreview(stage.opId);
    assert(reApp.ok === false, "re-apply after decline fails");

    // Accept path (separate stage)
    const stage2 = await lp.stageLivePreview({
      pipes: [{ system: "thonghoi", dn: 90, points: [[0, 2000], [10000, 2000]] }],
      target,
      recipe: "drawpipes",
    });
    assert(stage2.ok === true && stage2.count >= 1, "stage2 ok");
    if (stage2.ok) {
      const app = await lp.applyLivePreview(stage2.opId);
      writeFileSync(join(SCRATCH, "ui-preview-apply.json"), JSON.stringify(app, null, 2));
      assert(app.ok === true, "apply ok");
      assert(app.committed === true, "apply committed");
      assert(app.count >= 1, "apply count>=1");
      assert(lp.getLiveOp(stage2.opId)?.state === "applied", "registry applied");
      const twice = await lp.applyLivePreview(stage2.opId);
      assert(twice.ok === false, "second apply fails");
    }
  }
}

// ── 4. Sandbox session also stages without commit (if CoreConsole present) ──
if (bridge.findCoreConsole()) {
  // lightweight: opLisp/preview body only if no fixture needed for pure
  assert(typeof session.previewOp === "function", "session.previewOp shipped");
  assert(typeof session.applyOp === "function" && typeof session.rejectOp === "function", "session apply/reject shipped");
}

console.log("\n---");
if (failed) {
  console.error(failed + " assertion(s) failed");
  process.exit(1);
}
console.log("All ui-preview tests passed");
process.exit(0);

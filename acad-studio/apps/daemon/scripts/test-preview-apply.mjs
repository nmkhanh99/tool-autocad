/**
 * Preview → confirm apply / reject tests against SHIPPED session module.
 * Run: cd acad-studio/apps/daemon && pnpm test:preview
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRATCH =
  process.env.MEP_SCRATCH ||
  "/var/folders/d6/t6kbyns970j6_5vd0qnwnm7r0000gn/T/grok-goal-fcfb56d9fc5d/implementer";
mkdirSync(SCRATCH, { recursive: true });

// Isolate sessions from user home
const SESSION_ROOT = join(SCRATCH, "sessions-test");
mkdirSync(SESSION_ROOT, { recursive: true });
process.env.MEP_SESSIONS_DIR = SESSION_ROOT;

const session = await import("../src/session.ts");
const bridge = await import("../src/acadBridge.ts");

let failed = 0;
function assert(cond, msg) {
  if (!cond) {
    console.error("FAIL:", msg);
    failed++;
  } else {
    console.log("ok  ", msg);
  }
}

function sha16(p) {
  return createHash("sha256").update(readFileSync(p)).digest("hex").slice(0, 16);
}

// ── 1. Pure diff (shipped) ──
const before = [
  { h: "A1", t: "LINE", l: "0", p: [[0, 0], [1, 0]] },
  { h: "A2", t: "MLINE", l: "P-ThoatXi", p: [[0, 0], [10, 0]], dn: 90 },
];
const after = [
  { h: "A1", t: "LINE", l: "0", p: [[0, 0], [2, 0]] }, // modified
  { h: "A3", t: "MLINE", l: "P-ThongHoi", p: [[0, 5], [10, 5]], dn: 60 }, // added
  // A2 removed
];
const d = session.diffGeoms(before, after);
assert(d.summary.added === 1, "diff added=1");
assert(d.summary.removed === 1, "diff removed=1");
assert(d.summary.modified === 1, "diff modified=1");
assert(d.added[0].h === "A3", "diff added handle A3");
assert(d.removed[0].h === "A2", "diff removed handle A2");
assert(d.modified[0].h === "A1", "diff modified handle A1");

// ── 2. recipeBody / opLisp ──
assert(session.opLisp("stdlayers", {})?.includes("mep:std-layers"), "opLisp stdlayers");
assert(session.opLisp("titlefix", { KHBV: "A-01" })?.includes("mep:set-title"), "opLisp titlefix");
assert(session.opLisp("titleform", { KHBV: "A-01" })?.includes("mep:set-title"), "opLisp titleform alias");
assert(session.opLisp("drawpipes", { pipes: [] }) === null, "opLisp empty pipes null");
const pipes = [{ system: "thoatxi", dn: 90, points: [[0, 0], [1000, 0], [1000, 500]] }];
const op = session.opLisp("drawpipes", { pipes });
assert(op?.includes("mep:draw-pipe"), "opLisp drawpipes has draw-pipe");
assert(op?.includes("P-ThoatXi"), "opLisp maps thoatxi layer");
const body = session.recipeBody("drawpipes", "/tmp/staged.dwg", { pipes });
assert(!!body && body.includes("SAVEAS") && body.includes("dump-geom"), "recipeBody SAVEAS+dump-geom");
assert(session.PREVIEW_RECIPES.includes("drawpipes"), "PREVIEW_RECIPES has drawpipes");

// ── 3. fingerprint helper ──
const fpFile = join(SCRATCH, "fp-probe.bin");
writeFileSync(fpFile, "hello-preview");
const fp1 = session.fileFingerprint(fpFile);
writeFileSync(fpFile, "hello-preview");
const fp2 = session.fileFingerprint(fpFile);
assert(fp1 === fp2, "fingerprint stable for same content");
writeFileSync(fpFile, "changed");
assert(session.fileFingerprint(fpFile) !== fp1, "fingerprint changes with content");

// ── 4. UI static: preview functions route through confirm ──
const pageSrc = readFileSync(join(__dirname, "../../web/app/page.tsx"), "utf8");
const fnSrc = readFileSync(join(__dirname, "../../web/app/functions.ts"), "utf8");
assert(fnSrc.includes("preview: true") || fnSrc.includes("preview:true"), "functions mark preview");
assert(pageSrc.includes("runPreview"), "UI runPreview");
assert(pageSrc.includes("/api/acad/preview"), "UI calls /preview");
assert(pageSrc.includes("/api/acad/apply") || pageSrc.includes('"apply"'), "UI apply endpoint");
assert(pageSrc.includes("/api/acad/reject") || pageSrc.includes('"reject"'), "UI reject endpoint");
assert(pageSrc.includes("Chấp nhận") || pageSrc.includes("onDecide"), "UI confirm control");
assert(pageSrc.includes("Không chấp nhận") || pageSrc.includes("onDecide"), "UI decline control");
assert(pageSrc.includes("PreviewView"), "UI PreviewView component");
// preview path must not call mep mutate-only for those fns
assert(pageSrc.includes("if (fn.preview) return runPreview"), "preview short-circuits direct mep");

// dump UI bindings for evidence
const uiLines = pageSrc
  .split("\n")
  .map((ln, i) => `${i + 1}:${ln}`)
  .filter((ln) =>
    /runPreview|onDecide|\/preview|\/apply|\/reject|PreviewView|Chấp nhận|Không chấp nhận|fn\.preview/.test(ln),
  );
writeFileSync(join(SCRATCH, "preview-apply-ui.txt"), uiLines.join("\n") + "\n");

// ── 5. Live headless E2E when AcCoreConsole present ──
const core = bridge.findCoreConsole();
if (!core) {
  console.log("skip headless E2E — no AcCoreConsole");
  writeFileSync(
    join(SCRATCH, "preview-apply-preview.json"),
    JSON.stringify({ skipped: true, reason: "no AcCoreConsole" }, null, 2),
  );
} else {
  // Prefer prebuilt blank fixture; else use project scratch DWG
  let fixture = join(SCRATCH, "fixture-blank.dwg");
  if (!existsSync(fixture)) {
    fixture = join(__dirname, "../../../.work/MEP-RAW-scratch.dwg");
  }
  assert(existsSync(fixture), `fixture DWG exists: ${fixture}`);

  // Working copy of original so tests never touch source fixture permanently
  const original = join(SCRATCH, "original-input.dwg");
  copyFileSync(fixture, original);
  const origSha = sha16(original);
  const origSize = statSync(original).size;

  session.__resetSessionsForTests();

  // open
  const opened = await session.openSession(original);
  assert(opened.ok === true, "openSession ok");
  if (!opened.ok) {
    console.error(opened);
  } else {
    const sessionId = opened.sessionId;
    const currentPath = join(opened.dir, "current.dwg");
    const currentShaOpen = sha16(currentPath);

    // preview drawpipes
    const preview = await session.previewOp(sessionId, "drawpipes", {
      pipes: [
        { system: "thoatxi", dn: 90, points: [[0, 0], [5000, 0], [5000, 3000]] },
        { system: "thonghoi", dn: 60, points: [[0, 500], [4000, 500]] },
      ],
    });
    writeFileSync(join(SCRATCH, "preview-apply-preview.json"), JSON.stringify(preview, null, 2));
    assert(preview.ok === true, "preview ok");
    if (preview.ok) {
      assert(!!preview.opId, "preview has opId");
      assert(preview.diff && typeof preview.diff.summary.added === "number", "preview has diff.summary");
      assert(Array.isArray(preview.geometry), "preview has geometry");
      assert(Array.isArray(preview.before), "preview has before");
      assert(preview.immutable.originalUnchanged === true, "preview leaves original unchanged");
      assert(preview.immutable.currentUnchanged === true, "preview leaves current unchanged");
      assert(sha16(original) === origSha, "original bytes unchanged after preview");
      assert(statSync(original).size === origSize, "original size unchanged after preview");
      assert(sha16(currentPath) === currentShaOpen, "current.dwg bytes unchanged after preview");
      assert(existsSync(join(opened.dir, "staged.dwg")), "staged.dwg exists after preview");
      // Accept geometry should still match open snapshot until apply
      const headBeforeApply = session.getSession(sessionId)?.head;
      assert(headBeforeApply === null, "head null until apply");

      // ── reject path (separate staged op) ──
      // First reject this staged op
      const rej = session.rejectOp(sessionId, preview.opId);
      writeFileSync(join(SCRATCH, "preview-apply-reject.json"), JSON.stringify(rej, null, 2));
      assert(rej.ok === true, "reject ok");
      assert(!existsSync(join(opened.dir, "staged.dwg")), "staged removed after reject");
      assert(sha16(currentPath) === currentShaOpen, "current still pre-preview after reject");
      assert(sha16(original) === origSha, "original still untouched after reject");
      // re-apply of rejected op must fail
      const reApply = session.applyOp(sessionId, preview.opId);
      assert(reApply.ok === false, "re-apply after reject fails");

      // ── apply path: preview again then apply ──
      const preview2 = await session.previewOp(sessionId, "drawpipes", {
        pipes: [{ system: "thoatxi", dn: 90, points: [[0, 0], [2000, 0]] }],
      });
      assert(preview2.ok === true, "preview2 ok");
      if (preview2.ok) {
        assert(preview2.immutable.currentUnchanged === true, "preview2 current unchanged");
        const applied = session.applyOp(sessionId, preview2.opId);
        writeFileSync(join(SCRATCH, "preview-apply-apply.json"), JSON.stringify(applied, null, 2));
        assert(applied.ok === true, "apply ok");
        if (applied.ok) {
          assert(applied.applied === preview2.opId, "applied opId");
          assert(!!applied.backup, "backup name present");
          assert(
            existsSync(join(opened.dir, "backups", applied.backup)),
            "backup file exists on disk",
          );
          assert(session.getSession(sessionId)?.head === preview2.opId, "head is applied op");
          // current should now differ from open snapshot when pipes were drawn
          const afterSha = sha16(currentPath);
          // original still never written
          assert(sha16(original) === origSha, "original untouched after apply");
          // staged consumed
          assert(!existsSync(join(opened.dir, "staged.dwg")), "staged gone after apply");
          // double-apply fails
          const twice = session.applyOp(sessionId, preview2.opId);
          assert(twice.ok === false, "second apply fails");
          // accepted geometry: snapshot current should reflect staged geometry roughly
          const curGeom = session.loadGeom(join(opened.dir, "snapshots", "current.json"));
          assert(Array.isArray(curGeom), "current snapshot after apply");
          console.log("    applied backup=", applied.backup, "current sha changed=", afterSha !== currentShaOpen);
        }
      }
    }
  }
}

// ── 6. Source contract: preview uses work copy ──
const sessSrc = readFileSync(join(__dirname, "../src/session.ts"), "utf8");
assert(sessSrc.includes("work-"), "session uses work- copy for preview");
assert(sessSrc.includes("fileFingerprint"), "session fingerprints for immutability");
assert(sessSrc.includes('o.state === "staged"'), "apply/reject gate on staged");
const promoteStart = sessSrc.indexOf("export function applyOp");
const promoteEnd = sessSrc.indexOf("export type RejectResult", promoteStart);
const promoteSource = sessSrc.slice(promoteStart, promoteEnd);
assert(promoteSource.includes("renameSync(staged, current)"), "apply promotes staged with rename");
assert(!promoteSource.includes("rmSync(current"), "apply does not unlink current before atomic rename");

console.log("\n---");
if (failed) {
  console.error(failed + " assertion(s) failed");
  process.exit(1);
}
console.log("All preview-apply tests passed");
process.exit(0);

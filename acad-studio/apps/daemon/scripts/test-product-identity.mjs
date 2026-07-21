/**
 * Product identity: UI/agent/control must not present MEP as primary product name.
 * Run: npx tsx scripts/test-product-identity.mjs
 */
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../../.."); // acad-studio
const SCRATCH =
  process.env.ACAD_SCRATCH ||
  process.env.MEP_SCRATCH ||
  "/var/folders/d6/t6kbyns970j6_5vd0qnwnm7r0000gn/T/grok-goal-1d8e955123dd/implementer";
mkdirSync(SCRATCH, { recursive: true });

let failed = 0;
function assert(c, m) {
  if (!c) {
    console.error("FAIL:", m);
    failed++;
  } else console.log("ok  ", m);
}

const page = readFileSync(join(root, "apps/web/app/page.tsx"), "utf8");
const layout = readFileSync(join(root, "apps/web/app/layout.tsx"), "utf8");
const agents = readFileSync(join(root, "apps/daemon/src/agents.ts"), "utf8");
const contract = readFileSync(join(root, "apps/daemon/src/bridgeContract.ts"), "utf8");

assert(page.includes('Acad<span>·</span>Studio') || page.includes("Acad·Studio"), "UI brand Acad·Studio");
assert(!page.includes("MEP<span>·</span>Studio") && !page.includes("MEP·Studio"), "UI brand not MEP·Studio");
assert(!page.includes("MepBridge"), "page.tsx no MepBridge primary");
assert(page.includes("AcadBridge"), "page.tsx names AcadBridge");
assert(layout.includes("AutoCAD Toolkit"), "layout title/desc toolkit");
assert(!layout.includes("AutoCAD MEP"), "layout not AutoCAD MEP product");
assert(agents.includes("AutoCAD Toolkit") && agents.includes("Acad Studio"), "agents prompt toolkit");
assert(!agents.includes("tool AutoCAD MEP (cơ điện)"), "agents not MEP product definition");
assert(contract.includes('BRIDGE_DIR_NAME = "Acad-Bridge"'), "bridge Acad-Bridge");
assert(contract.includes('JOB_LSP_NAME = "job.lsp"'), "job.lsp primary");

// Drive shipped PRODUCT export
const bc = await import("../src/bridgeContract.ts");
assert(bc.PRODUCT.plugin === "AcadBridge", "PRODUCT.plugin AcadBridge");
assert(bc.BRIDGE_DIR_NAME === "Acad-Bridge", "BRIDGE_DIR_NAME");

const log = join(SCRATCH, "product-identity.log");
writeFileSync(log, `PASS product identity ${new Date().toISOString()}\n`, "utf8");
console.log("wrote", log);
if (failed) process.exit(1);
console.log("\nALL PASS — product identity");

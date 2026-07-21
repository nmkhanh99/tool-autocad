/**
 * CLI: full-sheet clone using shipped fullSheet.cloneFullSheet.
 * Run from apps/daemon: pnpm exec tsx ../../scripts/fullsheet-clone.mjs
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";

const SCRATCH =
  process.env.MEP_SCRATCH ||
  "/var/folders/d6/t6kbyns970j6_5vd0qnwnm7r0000gn/T/grok-goal-a6190efc4586/implementer";

const { cloneFullSheet } = await import("../apps/daemon/src/fullSheet.ts");
const result = await cloneFullSheet({ scratchDir: SCRATCH, timeoutMs: 180000 });
writeFileSync(join(SCRATCH, "fullsheet-run.json"), JSON.stringify(result, null, 2));
if (!result.ok) {
  console.error(result.error);
  process.exit(1);
}
console.log("FULL SHEET OK →", result.workOutput, "bytes", result.size);
process.exit(0);

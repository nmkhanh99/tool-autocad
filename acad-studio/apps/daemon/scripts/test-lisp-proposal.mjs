import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  readLispProposal,
  proposalFingerprint,
  sameLispManifest,
  shownAssistantText,
} from "../../web/app/lispProposal.ts";
import { AGENTS } from "../src/agents.ts";
import { isAllowedBrowserOrigin } from "../src/originPolicy.ts";
import {
  validLispProposal,
  withoutLispProposal,
} from "../src/lispReviewProtocol.ts";
import { initDb } from "../src/db.ts";

const body = {
  resourceId: "res-123",
  baseRevision: "sha256:abc",
  summary: "Core bridge",
  manifest: { purpose: "Run reviewed jobs", commands: [{ name: "ACAD-RUN" }] },
};
const tagged = `Đã đọc source.\n<lisp-manifest-proposal>${JSON.stringify(body)}</lisp-manifest-proposal>`;
const proposalHash = await proposalFingerprint(body);
assert.match(proposalHash, /^[a-f0-9]{64}$/);

assert.equal(readLispProposal("<lisp-manifest-proposal>{")?.resourceId, undefined,
  "streaming fragment must remain inert");
assert.equal(readLispProposal(tagged)?.resourceId, "res-123");
assert.deepEqual(readLispProposal(tagged)?.manifest, body.manifest);
assert.equal(readLispProposal("<lisp-manifest-proposal>[]</lisp-manifest-proposal>"), undefined);
assert.equal(shownAssistantText(tagged), "Đã đọc source.");
assert.equal(validLispProposal(tagged, "res-123", "sha256:abc"), true);
assert.equal(validLispProposal(tagged, "other-resource", "sha256:abc"), false);
assert.equal(validLispProposal(tagged, "res-123", "other-revision"), false);
assert.equal(withoutLispProposal(tagged), "Đã đọc source.");
assert.equal(
  sameLispManifest(
    {
      commands: [{ name: "ACAD-RUN" }],
      purpose: "Run reviewed jobs",
      review: { status: "approved", reviewedBy: "user" },
    },
    body.manifest,
  ),
  true,
  "server-owned review attestation is ignored when restoring chat state",
);
assert.equal(
  sameLispManifest({ ...body.manifest, purpose: "Changed" }, body.manifest),
  false,
);
assert.equal(
  shownAssistantText("Giải thích\n<question-form id=\"x\">{}"),
  "Giải thích",
);

for (const agent of Object.values(AGENTS)) {
  const args = agent.buildArgs("[ACAD_LISP_REVIEW] inspect", null, { readOnly: true });
  assert.ok(!args.includes("--dangerously-bypass-approvals-and-sandbox"), `${agent.id} review bypassed sandbox`);
  assert.ok(!args.includes("--dangerously-skip-permissions"), `${agent.id} review bypassed permissions`);
  assert.ok(!args.includes("--always-approve"), `${agent.id} review auto-approved tools`);
}
assert.equal(AGENTS.claude.isolatedReview, true);
assert.equal(AGENTS.grok.isolatedReview, false);
assert.equal(AGENTS.codex.isolatedReview, false);
assert.equal(AGENTS.gemini.isolatedReview, false);
assert.deepEqual(
  AGENTS.codex.buildArgs("[ACAD_LISP_REVIEW] inspect", null, { readOnly: true }).slice(-3, -1),
  ["--sandbox", "read-only"],
);
assert.ok(AGENTS.claude.buildArgs("[ACAD_LISP_REVIEW] inspect", null, { readOnly: true }).includes("plan"));
assert.ok(AGENTS.grok.buildArgs("[ACAD_LISP_REVIEW] inspect", null, { readOnly: true }).includes("plan"));
for (const id of ["claude", "grok"]) {
  const args = AGENTS[id].buildArgs("[ACAD_LISP_REVIEW] inspect", null, { readOnly: true });
  const tools = args.indexOf("--tools");
  assert.ok(tools >= 0 && args[tools + 1] === "", `${id} review has no built-in tools`);
}
assert.ok(AGENTS.gemini.buildArgs("[ACAD_LISP_REVIEW] inspect", null, { readOnly: true }).includes("--sandbox"));
assert.equal(isAllowedBrowserOrigin(undefined, 8788), true);
assert.equal(isAllowedBrowserOrigin("http://127.0.0.1:8788", 8788), true);
assert.equal(isAllowedBrowserOrigin("http://localhost:3000", 8788), true);
assert.equal(isAllowedBrowserOrigin("https://malicious.example", 8788), false);

const decisionData = mkdtempSync(join(tmpdir(), "acad-lisp-decision-"));
const oldDataDir = process.env.ACAD_DATA_DIR;
const oldWasm = process.env.ACAD_SQLJS_WASM;
try {
  process.env.ACAD_DATA_DIR = decisionData;
  process.env.ACAD_SQLJS_WASM = fileURLToPath(
    new URL("../node_modules/sql.js/dist/sql-wasm.wasm", import.meta.url),
  );
  const store = await initDb();
  assert.equal(store.getLispProposalDecision("res-123", "sha256:abc", proposalHash), null);
  store.setLispProposalDecision("res-123", "sha256:abc", proposalHash, "rejected");
  assert.equal(
    store.getLispProposalDecision("res-123", "sha256:abc", proposalHash),
    "rejected",
  );
  assert.equal(
    store.getLispProposalDecision("res-123", "sha256:abc", "0".repeat(64)),
    null,
    "rejection is scoped to exact proposal content",
  );
} finally {
  if (oldDataDir === undefined) delete process.env.ACAD_DATA_DIR;
  else process.env.ACAD_DATA_DIR = oldDataDir;
  if (oldWasm === undefined) delete process.env.ACAD_SQLJS_WASM;
  else process.env.ACAD_SQLJS_WASM = oldWasm;
  rmSync(decisionData, { recursive: true, force: true });
}

console.log("✓ lisp proposal protocol: complete-tag parsing + safe display");

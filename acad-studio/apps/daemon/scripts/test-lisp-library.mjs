import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  LispLibrary,
  buildLibraryLoadLisp,
  inferLispSource,
  validateApprovedManifest,
} from "../src/lispLibrary.ts";

const shippedManifest = JSON.parse(readFileSync(
  new URL("../../../../acad-lisp/library.manifest.json", import.meta.url),
  "utf8",
));
for (const [path, manifest] of Object.entries(shippedManifest.resources || {})) {
  assert.doesNotThrow(
    () => validateApprovedManifest(manifest),
    `shipped manifest must remain approvable: ${path}`,
  );
}

const fixture = mkdtempSync(join(tmpdir(), "acad-lisp-library-"));
const project = join(fixture, "project");
const dataDir = join(fixture, "data");
const bridgeDir = join(fixture, "bridge");
const lispDir = join(project, "acad-lisp");
mkdirSync(lispDir, { recursive: true });

try {
  writeFileSync(
    join(lispDir, "main.lsp"),
    `; (defun c:COMMENTED () nil)
(defun c:MAIN-CMD ( / ) (princ))
(defun lib:public (value) value)
(load "dep.lsp")
(load_dialog "panel.dcl")
(setvar "CMDECHO" 0)
(command "_.ZOOM" "_E")
(vlax-get-acad-object)
(princ)
`,
  );
  writeFileSync(join(lispDir, "dep.lsp"), "(defun lib:dep () T)\n(princ)\n");
  writeFileSync(join(lispDir, "panel.dcl"), 'main : dialog { label = "Test"; }\n');
  writeFileSync(join(lispDir, "batch.scr"), "_.ZOOM\n_E\n");
  writeFileSync(join(lispDir, "compiled.fas"), Buffer.from([0, 1, 2, 3, 4]));
  writeFileSync(join(lispDir, "windows.vlx"), Buffer.from([5, 6, 7, 8]));
  writeFileSync(
    join(lispDir, "library.manifest.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        pathBase: "project-root",
        resources: {
          "acad-lisp/main.lsp": {
            title: "Main fixture",
            purpose: "Contract fixture",
            commands: [{ name: "DOCUMENTED-CMD" }],
            dependencies: [
              {
                kind: "runtime",
                path: "acad-lisp/dep.lsp",
                optional: false,
                preload: true,
              },
              { kind: "runtime-file", path: "acad-lisp/panel.dcl", optional: false },
            ],
            review: { status: "approved" },
          },
        },
      },
      null,
      2,
    ),
  );

  const inference = inferLispSource(readFileSync(join(lispDir, "main.lsp"), "utf8"));
  assert.deepEqual(inference.commands, ["MAIN-CMD"], "commented defun is ignored");
  assert.ok(inference.functions.includes("lib:public"));
  assert.deepEqual(inference.dependencies, ["dep.lsp", "panel.dcl"]);
  assert.deepEqual(inference.systemVariables, ["CMDECHO"]);
  assert.deepEqual(inference.cadCommands, ["ZOOM"]);
  assert.ok(inference.apiCalls.includes("vlax-get-acad-object"));
  assert.ok(inference.fileReferences.includes("panel.dcl"));

  const library = new LispLibrary({
    projectRoot: project,
    dataDir,
    bridgeDir,
    platform: "darwin",
    includeAutodeskRoots: false,
  });
  const catalog = library.catalog();
  assert.equal(catalog.counts.total, 6);
  assert.equal(catalog.roots.length, 1);

  const main = catalog.resources.find((resource) => resource.name === "main.lsp");
  const compiled = catalog.resources.find((resource) => resource.name === "compiled.fas");
  const vlx = catalog.resources.find((resource) => resource.name === "windows.vlx");
  const dcl = catalog.resources.find((resource) => resource.name === "panel.dcl");
  const dep = catalog.resources.find((resource) => resource.name === "dep.lsp");
  const scr = catalog.resources.find((resource) => resource.name === "batch.scr");
  assert.ok(main && compiled && vlx && dcl && dep && scr);
  assert.equal(main.pathLabel.includes(project), false, "catalog does not expose absolute project path");
  assert.ok(main.commands.includes("MAIN-CMD"));
  assert.ok(main.commands.includes("DOCUMENTED-CMD"));
  assert.equal(compiled.readable, false);
  assert.equal(compiled.loadable, true);
  assert.equal(vlx.loadable, false);
  assert.equal(vlx.loadBlockReason, "vlx_windows_only");
  assert.equal(dcl.loadBlockReason, "dcl_requires_load_dialog");
  assert.equal(scr.loadBlockReason, "scr_catalog_only");

  assert.equal(main.reviewStatus, "unreviewed",
    "a source-controlled manifest cannot self-attest approval");

  const initial = library.detail(main.id);
  assert.ok(initial);
  assert.ok(initial.resource.source.includes("MAIN-CMD"));
  assert.equal(
    initial.resource.sourceHash,
    createHash("sha256").update(Buffer.from(initial.resource.source, "utf8")).digest("hex"),
    "displayed UTF-8 source and review hash describe the same bytes",
  );
  assert.equal(initial.resource.baseManifest.title, "Main fixture");
  assert.equal(JSON.stringify(initial).includes(project), false, "detail does not expose absolute path");

  assert.throws(
    () =>
      library.saveManifest(
        main.id,
        initial.resource.manifestRevision,
        initial.resource.manifest,
        undefined,
      ),
    /approval_required/,
  );
  assert.throws(
    () =>
      library.saveManifest(
        main.id,
        initial.resource.manifestRevision,
        { commands: [] },
        true,
      ),
    /manifest_summary_required/,
  );
  for (const dependency of [dep, dcl]) {
    const detail = library.detail(dependency.id);
    const approved = library.saveManifest(
      dependency.id,
      detail.resource.manifestRevision,
      detail.resource.manifest,
      true,
    );
    assert.equal(approved.resource.reviewStatus, "approved");
  }
  const ready = library.detail(main.id);
  const saved = library.saveManifest(
    main.id,
    ready.resource.manifestRevision,
    {
      ...ready.resource.manifest,
      ai: { summary: "Reviewed fixture", whenToUse: ["test"] },
    },
    true,
  );
  assert.equal(saved.resource.reviewStatus, "approved");
  assert.equal(saved.resource.manifest.review.status, "approved");
  assert.equal(saved.resource.manifest.review.reviewedBy, "user");
  assert.equal(saved.resource.manifest.review.approvedSourceHash, main.sourceHash);

  const originalCopyAtomic = library.copyAtomic.bind(library);
  let tampered = false;
  library.copyAtomic = (source, destination) => {
    originalCopyAtomic(source, destination);
    if (!tampered && source.endsWith("main.lsp")) {
      tampered = true;
      writeFileSync(destination, "(princ \"changed after review\")\n");
    }
  };
  assert.throws(
    () => library.prepareLoad(main.id, saved.resource.manifestRevision),
    /resource_changed_during_stage/,
    "staged bytes are re-hashed before a load job is built",
  );
  library.copyAtomic = originalCopyAtomic;

  const prepared = library.prepareLoad(main.id, saved.resource.manifestRevision);
  assert.ok(existsSync(prepared.entryPath), "entry artifact staged");
  assert.ok(
    prepared.preloadPaths.some((path) => path.endsWith("dep.lsp")),
    "declared AutoLISP dependency is preloaded",
  );
  assert.ok(
    prepared.supportPaths.some((path) => path.endsWith("acad-lisp")),
    "staged resource directory is on scoped support paths",
  );
  const loader = buildLibraryLoadLisp({
    entryPath: prepared.entryPath,
    preloadPaths: prepared.preloadPaths,
    supportPaths: prepared.supportPaths,
    displayName: main.name,
    expectedTitle: "Fixture.dwg",
    expectedFile: "/tmp/Fixture.dwg",
  });
  assert.match(loader, /setenv "ACAD"/);
  assert.match(loader, /TRUSTEDPATHS/);
  assert.match(loader, /acadlib:old-acad/);
  assert.match(loader, /setenv "ACAD" \(if acadlib:old-acad/);
  assert.match(loader, /acad:write-result/);
  assert.match(loader, /DWGNAME/);
  assert.match(loader, /Ban ve dich da thay doi/);

  const oldRevision = saved.resource.manifestRevision;
  writeFileSync(join(lispDir, "main.lsp"), readFileSync(join(lispDir, "main.lsp"), "utf8") + "\n(princ)\n");
  const changed = library.detail(main.id);
  assert.notEqual(changed.resource.manifestRevision, oldRevision);
  assert.equal(changed.resource.reviewStatus, "stale");
  assert.throws(() => library.prepareLoad(main.id, oldRevision), /revision_conflict/);

  const custom = join(fixture, "custom");
  mkdirSync(custom);
  writeFileSync(join(custom, "custom.mnl"), "(defun c:CUSTOM () (princ))\n");
  const root = library.addRoot(custom, "Custom fixture");
  assert.equal(root.builtIn, false);
  assert.equal(library.catalog().counts.total, 7);

  console.log("✓ lisp library: catalog + manifest revision + stage/load contract");
} finally {
  const makeWritable = (directory) => {
    try { chmodSync(directory, 0o755); } catch { return; }
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const child = join(directory, entry.name);
      if (entry.isDirectory()) makeWritable(child);
      else try { chmodSync(child, 0o644); } catch { /* best effort */ }
    }
  };
  makeWritable(fixture);
  rmSync(fixture, { recursive: true, force: true });
}

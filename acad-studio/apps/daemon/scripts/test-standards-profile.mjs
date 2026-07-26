import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_PROFILE,
  STANDARDS_FILE_NAME,
  StandardsConflictError,
  createProfile,
  deleteProfile,
  duplicateProfile,
  loadStandardsState,
  sanitizeProfile,
  saveStandardsState,
  upsertProfile,
} from "../src/standardsProfile.ts";

const temporaryDirectory = mkdtempSync(join(tmpdir(), "acad-standards-profile-"));
const storage = { dataDir: temporaryDirectory };

try {
  assert.equal(DEFAULT_PROFILE.drawing.unit, "mm");
  assert.equal(DEFAULT_PROFILE.drawing.insunits, 4);
  assert.deepEqual(DEFAULT_PROFILE.drawing.paper, {
    name: "A3",
    width: 420,
    height: 297,
  });
  assert.equal(DEFAULT_PROFILE.dimension.fit, "Best fit");
  assert.equal(DEFAULT_PROFILE.dimension.paperTextHeight, 2.5);
  assert.equal(DEFAULT_PROFILE.dimension.offsetFromOrigin, 0.625);
  assert.ok(DEFAULT_PROFILE.layers.some((layer) => layer.name === "DIM"));
  assert.ok(DEFAULT_PROFILE.mappings.some((mapping) => mapping.label === "Khung vẽ"));
  assert.ok(DEFAULT_PROFILE.mappings.some((mapping) => mapping.label === "Phòng khách"));
  assert.match(DEFAULT_PROFILE.revision, /^[a-f0-9]{64}$/);

  const sanitized = sanitizeProfile({
    ...DEFAULT_PROFILE,
    ignoredTopLevel: "not persisted",
    drawing: {
      ...DEFAULT_PROFILE.drawing,
      ignoredDrawingField: true,
    },
    dimension: {
      ...DEFAULT_PROFILE.dimension,
      ignoredDimensionVariable: 123,
    },
  });
  assert.equal("ignoredTopLevel" in sanitized, false);
  assert.equal("ignoredDrawingField" in sanitized.drawing, false);
  assert.equal("ignoredDimensionVariable" in sanitized.dimension, false);
  assert.throws(
    () => sanitizeProfile({
      ...DEFAULT_PROFILE,
      dimension: {
        ...DEFAULT_PROFILE.dimension,
        precision: 99,
      },
    }),
    /precision/,
  );

  const sameContentNewTimestamp = sanitizeProfile({
    ...DEFAULT_PROFILE,
    updatedAt: "2030-01-01T00:00:00.000Z",
  });
  assert.equal(
    sameContentNewTimestamp.revision,
    DEFAULT_PROFILE.revision,
    "timestamps must not affect revision",
  );
  const changedContent = sanitizeProfile({
    ...DEFAULT_PROFILE,
    dimension: {
      ...DEFAULT_PROFILE.dimension,
      precision: 2,
    },
  });
  assert.notEqual(changedContent.revision, DEFAULT_PROFILE.revision);

  const initial = loadStandardsState(storage);
  assert.equal(initial.profiles.length, 1);
  assert.equal(initial.profiles[0]?.id, DEFAULT_PROFILE.id);
  assert.equal(existsSync(join(temporaryDirectory, STANDARDS_FILE_NAME)), false);

  saveStandardsState(initial, storage);
  assert.equal(existsSync(join(temporaryDirectory, STANDARDS_FILE_NAME)), true);
  assert.equal(
    readdirSync(temporaryDirectory).some((name) => name.endsWith(".tmp")),
    false,
    "atomic save must not leave a temporary file",
  );

  const created = createProfile("Kiểm tra A3", DEFAULT_PROFILE.id, storage);
  assert.equal(created.name, "Kiểm tra A3");
  assert.equal(loadStandardsState(storage).profiles.length, 2);

  const updated = upsertProfile({
    ...created,
    dimension: {
      ...created.dimension,
      rowSpacing: 12,
    },
  }, created.revision, storage);
  assert.equal(updated.dimension.rowSpacing, 12);
  assert.notEqual(updated.revision, created.revision);
  assert.throws(
    () => upsertProfile({
      ...created,
      dimension: {
        ...created.dimension,
        rowSpacing: 14,
      },
    }, created.revision, storage),
    StandardsConflictError,
  );

  const duplicated = duplicateProfile(updated.id, "Kiểm tra A3 bản sao", storage);
  assert.notEqual(duplicated.id, updated.id);
  assert.equal(loadStandardsState(storage).profiles.length, 3);
  assert.equal(deleteProfile(duplicated.id, duplicated.revision, storage), true);
  assert.equal(deleteProfile(duplicated.id, undefined, storage), false);
  assert.equal(loadStandardsState(storage).profiles.length, 2);

  saveStandardsState({ schemaVersion: 1, profiles: [] }, storage);
  assert.equal(
    loadStandardsState(storage).profiles.length,
    0,
    "an existing empty store must not recreate the default profile",
  );

  console.log("standards profile: ok");
} finally {
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

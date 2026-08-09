import assert from "node:assert/strict";
import test from "node:test";

import {
  fileNameFromPath,
  uniqueDrawingNames,
} from "../app/PreconstructionPanel";

test("fileNameFromPath handles POSIX and Windows paths", () => {
  assert.equal(fileNameFromPath("/tmp/project/A-101.dwg"), "A-101.dwg");
  assert.equal(fileNameFromPath("C:\\projects\\A-101.dwg"), "A-101.dwg");
  assert.equal(fileNameFromPath("A-101.dwg"), "A-101.dwg");
});

test("uniqueDrawingNames prevents duplicate labels and asset keys", () => {
  assert.deepEqual(
    uniqueDrawingNames(
      ["A-101.pdf", "A-101.pdf", "S-101.dwg"],
      ["A-101.pdf", "A-101 (2).pdf"],
    ),
    ["A-101 (3).pdf", "A-101 (4).pdf", "S-101.dwg"],
  );
});

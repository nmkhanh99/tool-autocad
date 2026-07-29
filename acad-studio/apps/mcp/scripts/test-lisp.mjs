import assert from "node:assert/strict";

import {
  buildLispOperation,
  finiteNumber,
  finitePoint,
  lispNumber,
  lispPoint,
  lispString,
  resultError,
  resultOk,
} from "../src/lisp.ts";

function codeOutsideStrings(source) {
  let output = "";
  let inString = false;
  let escaped = false;
  let inComment = false;

  for (const character of source) {
    if (inComment) {
      if (character === "\n") {
        inComment = false;
        output += "\n";
      } else {
        output += " ";
      }
      continue;
    }
    if (inString) {
      output += character === "\n" ? "\n" : " ";
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === ";") {
      inComment = true;
      output += " ";
    } else if (character === '"') {
      inString = true;
      output += " ";
    } else {
      output += character;
    }
  }

  assert.equal(inString, false, "generated AutoLISP has an unterminated string");
  return output;
}

function assertBalanced(source, label = "AutoLISP") {
  const code = codeOutsideStrings(source);
  let depth = 0;
  for (const character of code) {
    if (character === "(") depth += 1;
    if (character === ")") depth -= 1;
    assert.ok(depth >= 0, `${label} closes a list before it opens one`);
  }
  assert.equal(depth, 0, `${label} has unbalanced parentheses`);
}

function assertSupported(tool, input) {
  const result = buildLispOperation(tool, input);
  assert.equal(
    result.supported,
    true,
    `${tool}.${input.operation} should be supported: ${result.reason ?? ""}`,
  );
  assert.ok(result.lisp.endsWith("\n"));
  assert.match(result.lisp, /\(acad:write-result "ok"|\(acad:write-result "error"/);
  assertBalanced(result.lisp, `${tool}.${input.operation}`);
  return result;
}

function assertUnsupported(tool, input, code) {
  const result = buildLispOperation(tool, input);
  assert.equal(result.supported, false, `${tool}.${input.operation} should be unsupported`);
  assert.equal(result.code, code);
  assert.ok(result.reason.length > 0);
}

assert.equal(lispString('a"b\\c\n\tz'), '"a\\"b\\\\c\\n\\tz"');
assert.equal(lispNumber(-0), "0.0");
assert.equal(lispNumber(12), "12.0");
assert.equal(lispNumber(12.25), "12.25");
assert.deepEqual(finitePoint([1, 2]), [1, 2, 0]);
assert.equal(lispPoint([1, 2, 3]), "(list 1.0 2.0 3.0)");
assert.throws(() => finiteNumber(Number.POSITIVE_INFINITY), /finite number/);
assert.throws(() => finitePoint([1, Number.NaN]), /finite number/);
assert.throws(() => lispString("bad\u0000value"), /control character/);
assertBalanced(resultOk("done"));
assertBalanced(resultError("failed"));

const supportedCases = [
  ["drawing", { operation: "info" }],
  ["drawing", { operation: "save" }],
  ["drawing", { operation: "save", data: { path: "/tmp/test.dwg" } }],
  ["drawing", { operation: "save_as_dxf", data: { path: "/tmp/test.dxf" } }],
  ["drawing", { operation: "purge" }],
  ["drawing", { operation: "get_variables", data: { names: ["CLAYER", "INSUNITS"] } }],
  ["drawing", { operation: "undo" }],
  ["drawing", { operation: "redo" }],

  ["entity", { operation: "create_line", x1: 0, y1: 0, x2: 10, y2: 5, layer: "A-WALL" }],
  ["entity", { operation: "create_circle", data: { cx: 2, cy: 3, radius: 4 } }],
  ["entity", { operation: "create_polyline", points: [[0, 0], [4, 0], [4, 3]], data: { closed: true } }],
  ["entity", { operation: "create_rectangle", x1: 0, y1: 0, x2: 4, y2: 3 }],
  ["entity", { operation: "create_arc", data: { cx: 0, cy: 0, radius: 4, start_angle: 0, end_angle: 90 } }],
  ["entity", { operation: "create_ellipse", data: { cx: 0, cy: 0, major_x: 8, major_y: 1, ratio: 0.5 } }],
  ["entity", { operation: "create_mtext", data: { x: 1, y: 2, width: 30, text: "Note", height: 2.5 } }],
  ["entity", { operation: "create_hatch", entity_id: "A12", data: { pattern: "ANSI31" } }],
  ["entity", { operation: "list", layer: "A-WALL" }],
  ["entity", { operation: "count" }],
  ["entity", { operation: "get", entity_id: "A12" }],
  ["entity", { operation: "copy", entity_id: "A12", data: { dx: 2, dy: 3 } }],
  ["entity", { operation: "move", entity_id: "A12", data: { dx: 2, dy: 3 } }],
  ["entity", { operation: "rotate", entity_id: "A12", data: { cx: 0, cy: 0, angle: 30 } }],
  ["entity", { operation: "scale", entity_id: "A12", data: { cx: 0, cy: 0, factor: 2 } }],
  ["entity", { operation: "mirror", entity_id: "A12", x1: 0, y1: 0, x2: 0, y2: 10 }],
  ["entity", { operation: "offset", entity_id: "A12", data: { distance: 2, side_point: [0, 5] } }],
  ["entity", { operation: "array", entity_id: "A12", data: { rows: 2, cols: 3, row_dist: 20, col_dist: 30 } }],
  ["entity", { operation: "fillet", data: { id1: "A12", id2: "B34", radius: 2 } }],
  ["entity", { operation: "chamfer", data: { id1: "A12", id2: "B34", dist1: 2, dist2: 3 } }],
  ["entity", { operation: "erase", entity_id: "A12" }],

  ["layer", { operation: "list" }],
  ["layer", { operation: "create", data: { name: "M-PIPE", color: "cyan", linetype: "CONTINUOUS" } }],
  ["layer", { operation: "set_current", data: { name: "M-PIPE" } }],
  ["layer", { operation: "set_properties", data: { name: "M-PIPE", color: 4, lineweight: "0.25 mm" } }],
  ["layer", { operation: "freeze", data: { name: "M-PIPE" } }],
  ["layer", { operation: "thaw", data: { name: "M-PIPE" } }],
  ["layer", { operation: "lock", data: { name: "M-PIPE" } }],
  ["layer", { operation: "unlock", data: { name: "M-PIPE" } }],

  ["block", { operation: "list" }],
  ["block", { operation: "insert", data: { name: "PUMP", x: 1, y: 2, scale: 1, rotation: 0, block_id: "P-01" } }],
  ["block", { operation: "insert_with_attributes", data: { name: "PUMP", x: 1, y: 2, attributes: { TAG: "P-01" } } }],
  ["block", { operation: "get_attributes", data: { entity_id: "A12" } }],
  ["block", { operation: "update_attribute", data: { entity_id: "A12", tag: "TAG", value: "P-02" } }],
  ["block", {
    operation: "define",
    data: {
      name: "PUMP_DEF",
      entities: [
        { type: "LINE", x1: 0, y1: 0, x2: 10, y2: 0 },
        { type: "CIRCLE", cx: 5, cy: 5, radius: 2 },
        { type: "ATTDEF", tag: "ID", x: 0, y: -3, height: 2 },
      ],
    },
  }],
  ["block", { operation: "define", data: { name: "EMPTY_DEF", entities: [] } }],

  ["annotation", { operation: "create_text", data: { x: 1, y: 2, text: "Label" } }],
  ["annotation", { operation: "create_dimension_linear", data: { x1: 0, y1: 0, x2: 10, y2: 0, dim_x: 5, dim_y: 3 } }],
  ["annotation", { operation: "create_dimension_aligned", data: { x1: 0, y1: 0, x2: 10, y2: 5, offset: 3 } }],
  ["annotation", { operation: "create_dimension_angular", data: { cx: 0, cy: 0, x1: 10, y1: 0, x2: 0, y2: 10 } }],
  ["annotation", { operation: "create_dimension_radius", data: { cx: 0, cy: 0, radius: 10, angle: 30 } }],
  ["annotation", { operation: "create_leader", data: { points: [[0, 0], [4, 4]], text: "Leader" } }],

  ["pid", { operation: "setup_layers" }],
  ["pid", { operation: "list_symbols", data: { category: "VALVES" } }],
  ["pid", { operation: "insert_symbol", data: { category: "EQUIPMENT", symbol: "FILTER", x: 0, y: 0 } }],
  ["pid", { operation: "draw_process_line", data: { x1: 0, y1: 0, x2: 20, y2: 0 } }],
  ["pid", { operation: "connect_equipment", data: { x1: 0, y1: 0, x2: 20, y2: 10 } }],
  ["pid", { operation: "add_flow_arrow", data: { x: 10, y: 0, rotation: 45 } }],
  ["pid", { operation: "add_equipment_tag", data: { x: 0, y: 0, tag: "P-01", description: "Pump" } }],
  ["pid", { operation: "add_line_number", data: { x: 0, y: 0, line_num: "100", spec: "CS150" } }],
  ["pid", { operation: "insert_valve", data: { x: 0, y: 0, valve_type: "GATE", attributes: { TAG: "V-01" } } }],
  ["pid", { operation: "insert_instrument", data: { x: 0, y: 0, instrument_type: "PRESSURE", tag_id: "PI-01" } }],
  ["pid", { operation: "insert_pump", data: { x: 0, y: 0, pump_type: "CENTRIFUGAL", attributes: { TAG: "P-01" } } }],
  ["pid", { operation: "insert_tank", data: { x: 0, y: 0, tank_type: "VERTICAL", scale: 1.5 } }],

  ["view", { operation: "zoom_extents" }],
  ["view", { operation: "zoom_window", x1: 0, y1: 0, x2: 100, y2: 50 }],
];

for (const [tool, input] of supportedCases) assertSupported(tool, input);

for (const [tool, input] of supportedCases) {
  const result = buildLispOperation(tool, input);
  if (!result.supported || !result.lisp.includes('(setvar "OSMODE" 0)')) continue;
  const catchIndex = result.lisp.indexOf("(vl-catch-all-apply");
  const restoreIndex = result.lisp.indexOf('(setvar "OSMODE" mcp:osmode)');
  assert.ok(catchIndex >= 0, `${tool}.${input.operation} must catch command errors`);
  assert.ok(
    restoreIndex > catchIndex,
    `${tool}.${input.operation} must restore OSMODE after the protected command`,
  );
  if (result.lisp.includes('(setvar "ATTREQ" 0)')) {
    const attreqRestoreIndex = result.lisp.indexOf('(setvar "ATTREQ" mcp:attreq)');
    assert.ok(
      attreqRestoreIndex > catchIndex,
      `${tool}.${input.operation} must restore ATTREQ after the protected command`,
    );
  }
}

const unavailableLinetype = assertSupported("layer", {
  operation: "create",
  data: { name: "M-TEST", color: 7, linetype: "MCP-NOT-LOADED" },
});
const linetypeGuardIndex = unavailableLinetype.lisp.indexOf(
  '(if (not (tblsearch "LTYPE" "MCP-NOT-LOADED"))',
);
const ensureLayerIndex = unavailableLinetype.lisp.lastIndexOf(
  '(mcp:ensure-layer "M-TEST" 7 "MCP-NOT-LOADED")',
);
assert.ok(linetypeGuardIndex >= 0, "layer.create must check that its linetype is loaded");
assert.ok(
  ensureLayerIndex > linetypeGuardIndex,
  "layer.create must only create/update the layer after the linetype guard",
);
assert.match(unavailableLinetype.lisp, /Requested linetype MCP-NOT-LOADED was not loaded/);

const deterministicOffset = assertSupported("entity", {
  operation: "offset",
  entity_id: "A12",
  data: { distance: 2, side_point: [4, 6] },
});
assert.match(
  deterministicOffset.lisp,
  /\(command-s "_\.OFFSET" 2\.0 mcp:e \(list 4\.0 6\.0 0\.0\) ""\)/,
);

const rectangularArray = assertSupported("entity", {
  operation: "array",
  entity_id: "A12",
  data: { rows: 2, cols: 3, row_dist: -20, col_dist: 30 },
});
assert.doesNotMatch(rectangularArray.lisp, /_\.ARRAY/);
assert.match(rectangularArray.lisp, /\(setvar "COPYMODE" 1\)/);
assert.match(rectangularArray.lisp, /\(setvar "COPYMODE" mcp:copymode\)/);
assert.match(rectangularArray.lisp, /copies=.*rows=2 cols=3/);

const blockDefinition = assertSupported("block", {
  operation: "define",
  data: {
    name: "TEST_BLOCK",
    entities: [
      { type: "LINE", x1: 0, y1: 0, x2: 5, y2: 0 },
      { type: "CIRCLE", cx: 2, cy: 2, radius: 1 },
      { type: "ATTDEF", tag: "TAG_ID", x: 0, y: -2, height: 2 },
    ],
  },
});
assert.match(blockDefinition.lisp, /'\(0 \. "BLOCK"\)/);
assert.match(blockDefinition.lisp, /'\(70 \. 2\)/);
assert.match(blockDefinition.lisp, /'\(0 \. "LINE"\)/);
assert.match(blockDefinition.lisp, /'\(0 \. "CIRCLE"\)/);
assert.match(blockDefinition.lisp, /'\(0 \. "ATTDEF"\)/);
assert.match(blockDefinition.lisp, /'\(0 \. "ENDBLK"\)/);

const erasePostcondition = assertSupported("entity", {
  operation: "erase",
  entity_id: "A12",
});
assert.match(erasePostcondition.lisp, /\(setq mcp:deleted \(entdel mcp:e\)\)/);
assert.match(
  erasePostcondition.lisp,
  /\(and mcp:deleted \(null \(entget mcp:e\)\)\)/,
);
assert.match(erasePostcondition.lisp, /AutoCAD did not erase the entity/);

for (const input of [
  { operation: "fillet", data: { id1: "A12", id2: "B34", radius: 2 } },
  { operation: "chamfer", data: { id1: "A12", id2: "B34", dist1: 2, dist2: 3 } },
]) {
  const pairMutation = assertSupported("entity", input);
  assert.match(pairMutation.lisp, /\(setq mcp:before1 \(entget mcp:e1\)/);
  assert.match(pairMutation.lisp, /\(not \(equal mcp:before1 \(entget mcp:e1\)\)\)/);
  assert.match(pairMutation.lisp, /\(not \(equal mcp:before2 \(entget mcp:e2\)\)\)/);
  assert.match(pairMutation.lisp, /\(not \(eq mcp:before-last \(entlast\)\)\)/);
  assert.match(pairMutation.lisp, /completed without changing geometry/);
}

assert.match(unavailableLinetype.lisp, /\(and mcp:result mcp:actual/);
assert.match(unavailableLinetype.lisp, /\(if mcp:ready \(acad:write-result "ok"/);
assert.match(unavailableLinetype.lisp, /Could not create or update layer M-TEST/);

const layerPropertiesPostcondition = assertSupported("layer", {
  operation: "set_properties",
  data: { name: "M-PIPE", color: 4, linetype: "CONTINUOUS", lineweight: 25 },
});
assert.match(layerPropertiesPostcondition.lisp, /\(setq mcp:modified \(entmod mcp:d\)\)/);
assert.match(layerPropertiesPostcondition.lisp, /\(setq mcp:actual \(if mcp:modified \(entget mcp:e\)\)\)/);
assert.match(layerPropertiesPostcondition.lisp, /\(= 4 \(cdr \(assoc 62 mcp:actual\)\)\)/);
assert.match(layerPropertiesPostcondition.lisp, /\(null \(assoc 420 mcp:actual\)\)/);
assert.match(layerPropertiesPostcondition.lisp, /Could not update layer M-PIPE/);

for (const operation of ["freeze", "thaw", "lock", "unlock"]) {
  const layerFlagPostcondition = assertSupported("layer", {
    operation,
    data: { name: "M-PIPE" },
  });
  assert.match(layerFlagPostcondition.lisp, /\(setq mcp:modified \(entmod mcp:d\)\)/);
  assert.match(layerFlagPostcondition.lisp, /\(setq mcp:actual-flags \(if mcp:modified/);
  assert.match(layerFlagPostcondition.lisp, new RegExp(`Could not ${operation} layer M-PIPE`));
}

const attributePostcondition = assertSupported("block", {
  operation: "update_attribute",
  data: { entity_id: "A12", tag: "TAG", value: "P-02" },
});
assert.match(attributePostcondition.lisp, /\(if \(entmod mcp:d\)/);
const attributeEntmodIndex = attributePostcondition.lisp.indexOf("(if (entmod mcp:d)");
const attributeCountIndex = attributePostcondition.lisp.indexOf(
  "(setq mcp:count (1+ mcp:count))",
);
assert.ok(
  attributeCountIndex > attributeEntmodIndex,
  "attribute update count must only increment after entmod succeeds",
);

const leaderPostcondition = assertSupported("annotation", {
  operation: "create_leader",
  data: { points: [[0, 0], [4, 4]], text: "Leader" },
});
assert.match(leaderPostcondition.lisp, /\(if \(and mcp:e mcp:text\)/);
assert.match(leaderPostcondition.lisp, /Could not create complete leader/);

const compoundPidCases = [
  [
    { operation: "insert_symbol", data: { category: "EQUIPMENT", symbol: "FILTER", x: 0, y: 0 } },
    /\(if \(and mcp:e mcp:label\)/,
  ],
  [
    { operation: "add_equipment_tag", data: { x: 0, y: 0, tag: "P-01", description: "Pump" } },
    /\(if \(and mcp:e mcp:description\)/,
  ],
  [
    { operation: "insert_valve", data: { x: 0, y: 0, valve_type: "GATE" } },
    /\(if \(and mcp:e mcp:label\)/,
  ],
  [
    { operation: "insert_instrument", data: { x: 0, y: 0, instrument_type: "PRESSURE" } },
    /\(if \(and mcp:e mcp:cross mcp:label\)/,
  ],
  [
    { operation: "insert_pump", data: { x: 0, y: 0, pump_type: "CENTRIFUGAL" } },
    /\(if \(and mcp:e mcp:impeller mcp:label\)/,
  ],
  [
    { operation: "insert_tank", data: { x: 0, y: 0, tank_type: "VERTICAL" } },
    /\(if \(and mcp:e mcp:label\)/,
  ],
];
for (const [input, condition] of compoundPidCases) {
  const compound = assertSupported("pid", input);
  assert.match(compound.lisp, condition);
  assert.match(compound.lisp, /Could not create complete/);
}

const pidLayerPostcondition = assertSupported("pid", { operation: "setup_layers" });
assert.match(pidLayerPostcondition.lisp, /\(setq mcp:ok T\)/);
assert.match(pidLayerPostcondition.lisp, /\(if \(not \(mcp:ensure-layer/);
assert.match(pidLayerPostcondition.lisp, /Could not prepare all P&ID layers/);

const unsupportedCases = [
  ["drawing", { operation: "create" }, "backend_required"],
  ["drawing", { operation: "open", data: { path: "/tmp/a.dwg" } }, "backend_required"],
  ["drawing", { operation: "plot_pdf", data: { path: "/tmp/a.pdf" } }, "backend_required"],
  ["entity", { operation: "offset", entity_id: "A12", data: { distance: 2 } }, "ambiguous_operation"],
  ["view", { operation: "get_screenshot" }, "backend_required"],
  ["system", { operation: "execute_lisp", data: { code: "(alert \"unsafe\")" } }, "backend_required"],
];

for (const [tool, input, code] of unsupportedCases) assertUnsupported(tool, input, code);
assertUnsupported("unknown", { operation: "anything" }, "unsupported_tool");

const attack = 'safe");(alert "PWNED")\n;comment\n\\tail';
const injectionCases = [
  ["drawing", { operation: "save", data: { path: attack } }],
  ["entity", { operation: "create_mtext", data: { x: 0, y: 0, width: 10, text: attack }, layer: attack }],
  ["entity", { operation: "list", layer: attack }],
  ["layer", { operation: "create", data: { name: attack, color: 7, linetype: attack } }],
  ["block", { operation: "insert_with_attributes", data: { name: attack, x: 0, y: 0, attributes: { [attack]: attack } } }],
  ["block", { operation: "update_attribute", data: { entity_id: "A12", tag: attack, value: attack } }],
  ["block", {
    operation: "define",
    data: {
      name: "SAFE)(alert(PWNED)",
      entities: [{ type: "ATTDEF", tag: "TAG)(alert(PWNED)", x: 0, y: 0 }],
    },
  }],
  ["annotation", { operation: "create_text", data: { x: 0, y: 0, text: attack, layer: attack } }],
  ["pid", { operation: "insert_symbol", data: { category: attack, symbol: attack, x: 0, y: 0 } }],
];

for (const [tool, input] of injectionCases) {
  const result = assertSupported(tool, input);
  const executable = codeOutsideStrings(result.lisp);
  assert.doesNotMatch(executable, /\(\s*alert\b/i, `${tool} leaked an injected expression`);
  assert.doesNotMatch(executable, /\bPWNED\b/, `${tool} leaked injected source outside a string`);
}

const invalidNumber = buildLispOperation("entity", {
  operation: "create_line",
  x1: Number.NaN,
  y1: 0,
  x2: 1,
  y2: 1,
});
assert.equal(invalidNumber.supported, false);
assert.equal(invalidNumber.code, "invalid_input");

const invalidHandle = buildLispOperation("entity", {
  operation: "erase",
  entity_id: attack,
});
assert.equal(invalidHandle.supported, false);
assert.equal(invalidHandle.code, "invalid_input");

const invalidCases = [
  ["entity", { operation: "offset", entity_id: "A12", data: { distance: -2, side_point: [0, 1] } }],
  ["entity", { operation: "offset", entity_id: "A12", data: { distance: 2, side_point: [0] } }],
  ["entity", { operation: "array", entity_id: "A12", data: { rows: 2.5, cols: 2, row_dist: 1, col_dist: 1 } }],
  ["entity", { operation: "array", entity_id: "A12", data: { rows: 0, cols: 2, row_dist: 1, col_dist: 1 } }],
  ["entity", { operation: "array", entity_id: "A12", data: { rows: 101, cols: 100, row_dist: 1, col_dist: 1 } }],
  ["block", { operation: "define", data: { name: "BAD/NAME", entities: [] } }],
  ["block", { operation: "define", data: { name: "B", entities: [{ type: "ARC" }] } }],
  ["block", { operation: "define", data: { name: "B", entities: [{ type: "CIRCLE", radius: 0 }] } }],
  ["block", { operation: "define", data: { name: "B", entities: [{ type: "ATTDEF", tag: "BAD TAG" }] } }],
];

for (const [tool, input] of invalidCases) {
  const result = buildLispOperation(tool, input);
  assert.equal(result.supported, false, `${tool}.${input.operation} should reject invalid input`);
  assert.equal(result.code, "invalid_input");
}

console.log(
  `AutoLISP builder tests passed: ${supportedCases.length} supported operations, ` +
    `${unsupportedCases.length + 1} explicit unsupported cases, injection-safe strings.`,
);

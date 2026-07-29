/**
 * Pure AutoLISP builders for the MCP live backend.
 *
 * This module deliberately has no daemon/backend imports.  It only validates
 * JSON-like tool input and returns AutoLISP source that can be passed to the
 * daemon's existing job wrapper.
 */

export type LispParseMode = "text" | "tsv" | "json";

export type LispBuildResult =
  | {
      supported: true;
      lisp: string;
      parse?: LispParseMode;
    }
  | {
      supported: false;
      reason: string;
      code?: string;
    };

export type LispOperationInput = {
  operation: string;
  data?: Record<string, unknown>;
  target?: string;
  [key: string]: unknown;
};

type Point3 = [number, number, number];
type ToolData = Record<string, unknown>;

class InvalidLispInput extends Error {}

const PID_SYMBOLS: Record<string, string[]> = {
  ACTUATORS: ["ACT-BELLOWS_SPRING", "ACT-MOTOR", "ACT-SOLENOID", "ACT-SPRING_DIAPHRAGM"],
  ANNOTATION: ["ANNOT-EQUIP_TAG", "ANNOT-EQUIP_DESCR", "ANNOT-FLOWARROW", "ANNOT-LINE_NUMBER"],
  EQUIPMENT: [
    "EQUIP-CLARIFIER",
    "EQUIP-FILTER",
    "EQUIP-FILTER_PRESS",
    "EQUIP-HEAT_EXCH-GENERIC",
    "EQUIP-MOTOR",
    "EQUIP-SCREENBAR",
  ],
  "PUMPS-BLOWERS": [
    "PUMP-CENTRIF1",
    "PUMP-CENTRIF2",
    "PUMP-DIAPHRAGM",
    "PUMP-METERING",
    "PUMP-PROGRESSIVE_CAVITY",
    "PUMP-SUBMERSIBLE",
  ],
  TANKS: ["TANK-VERTICAL_OPEN", "TANK-VERTICAL_DOME", "TANK-HORIZONTAL", "TANK-CONE_BOTTOM_DOME"],
  VALVES: ["VA-GATE", "VA-GLOBE", "VA-CHECK", "VA-BALL", "VA-BUTTERFLY", "VA-KNIFEGATE"],
};

const DEFAULT_VARIABLES = [
  "ACADVER",
  "CLAYER",
  "DWGNAME",
  "DWGPREFIX",
  "INSUNITS",
  "MEASUREMENT",
  "LUNITS",
  "DIMSCALE",
];

function invalid(label: string, detail: string): never {
  throw new InvalidLispInput(`${label}: ${detail}`);
}

function dataOf(input: LispOperationInput): ToolData {
  if (input.data === undefined) return {};
  if (!input.data || typeof input.data !== "object" || Array.isArray(input.data)) {
    return invalid("data", "must be an object");
  }
  return input.data;
}

function argument(input: LispOperationInput, name: string): unknown {
  const data = dataOf(input);
  return Object.prototype.hasOwnProperty.call(data, name) ? data[name] : input[name];
}

function requiredString(input: LispOperationInput, name: string): string {
  const value = argument(input, name);
  if (typeof value !== "string" || value.length === 0) {
    return invalid(name, "must be a non-empty string");
  }
  return value;
}

function optionalString(input: LispOperationInput, name: string): string | undefined {
  const value = argument(input, name);
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return invalid(name, "must be a string");
  return value;
}

function requiredHandle(input: LispOperationInput, name = "entity_id"): string {
  const value = requiredString(input, name);
  if (!/^[0-9a-f]+$/i.test(value)) return invalid(name, "must be a hexadecimal AutoCAD handle");
  return value;
}

function requiredNumber(input: LispOperationInput, name: string): number {
  return finiteNumber(argument(input, name), name);
}

function optionalNumber(input: LispOperationInput, name: string, fallback: number): number {
  const value = argument(input, name);
  return value === undefined || value === null ? fallback : finiteNumber(value, name);
}

function optionalBoolean(input: LispOperationInput, name: string, fallback = false): boolean {
  const value = argument(input, name);
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "boolean") return invalid(name, "must be a boolean");
  return value;
}

function positive(value: number, label: string, allowZero = false): number {
  if (allowZero ? value < 0 : value <= 0) {
    return invalid(label, allowZero ? "must be zero or greater" : "must be greater than zero");
  }
  return value;
}

function positiveInteger(value: unknown, label: string): number {
  const number = finiteNumber(value, label);
  if (!Number.isSafeInteger(number) || number < 1) {
    return invalid(label, "must be a positive integer");
  }
  return number;
}

function pointsArgument(
  input: LispOperationInput,
  name = "points",
  minimum = 2,
): Point3[] {
  const value = argument(input, name);
  if (!Array.isArray(value) || value.length < minimum) {
    return invalid(name, `must contain at least ${minimum} points`);
  }
  return value.map((point, index) => finitePoint(point, `${name}[${index}]`));
}

function attributesArgument(input: LispOperationInput, name = "attributes"): Record<string, string> {
  const value = argument(input, name);
  if (value === undefined || value === null) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return invalid(name, "must be an object of string values");
  }
  const attributes: Record<string, string> = {};
  for (const [tag, attributeValue] of Object.entries(value)) {
    if (!tag) return invalid(name, "attribute tags cannot be empty");
    if (typeof attributeValue !== "string") {
      return invalid(`${name}.${tag}`, "must be a string");
    }
    attributes[tag] = attributeValue;
  }
  return attributes;
}

/** Serialize a value as one AutoLISP string literal. */
export function lispString(value: string): string {
  if (typeof value !== "string") throw new TypeError("lispString value must be a string");
  let escaped = "";
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (character === "\\") escaped += "\\\\";
    else if (character === '"') escaped += '\\"';
    else if (character === "\n") escaped += "\\n";
    else if (character === "\r") escaped += "\\r";
    else if (character === "\t") escaped += "\\t";
    else if (code < 0x20 || code === 0x7f) {
      throw new InvalidLispInput("string contains an unsupported control character");
    } else escaped += character;
  }
  return `"${escaped}"`;
}

/** Validate and return one finite JavaScript number. */
export function finiteNumber(value: unknown, label = "number"): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return invalid(label, "must be a finite number");
  }
  return Object.is(value, -0) ? 0 : value;
}

/** Validate a 2D/3D point and normalize it to three finite coordinates. */
export function finitePoint(value: unknown, label = "point"): Point3 {
  if (!Array.isArray(value) || (value.length !== 2 && value.length !== 3)) {
    return invalid(label, "must be [x, y] or [x, y, z]");
  }
  return [
    finiteNumber(value[0], `${label}.x`),
    finiteNumber(value[1], `${label}.y`),
    value.length === 3 ? finiteNumber(value[2], `${label}.z`) : 0,
  ];
}

/**
 * Serialize a finite number as an AutoLISP real literal.  Real literals are
 * used because DXF coordinate/value groups reject integer cons values.
 */
export function lispNumber(value: unknown, label = "number"): string {
  const number = finiteNumber(value, label);
  const literal = String(number);
  return /[.eE]/.test(literal) ? literal : `${literal}.0`;
}

/** Serialize a normalized 3D point as a `(list ...)` expression. */
export function lispPoint(value: unknown, label = "point"): string {
  const point = finitePoint(value, label);
  return `(list ${point.map((coordinate) => lispNumber(coordinate)).join(" ")})`;
}

/** Build one literal, injection-safe result write. */
export function resultText(status: "ok" | "error", message: string): string {
  return `(acad:write-result ${lispString(status)} ${lispString(message)})`;
}

export function resultOk(message: string): string {
  return resultText("ok", message);
}

export function resultError(message: string): string {
  return resultText("error", message);
}

function resultExpression(status: "ok" | "error", trustedExpression: string): string {
  return `(acad:write-result ${lispString(status)} ${trustedExpression})`;
}

function program(lines: string[]): string {
  return `${lines.join("\n")}\n`;
}

function supported(lisp: string, parse: LispParseMode = "text"): LispBuildResult {
  return { supported: true, lisp, parse };
}

function unsupported(reason: string, code = "unsupported_operation"): LispBuildResult {
  return { supported: false, reason, code };
}

function safely(build: () => LispBuildResult): LispBuildResult {
  try {
    return build();
  } catch (error) {
    if (error instanceof InvalidLispInput || error instanceof TypeError) {
      return unsupported(error.message, "invalid_input");
    }
    throw error;
  }
}

function radians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

function layerPair(layer: string | undefined): string {
  return `(cons 8 ${layer === undefined ? '(getvar "CLAYER")' : lispString(layer)})`;
}

function entityExpression(
  type: string,
  subclass: string,
  layer: string | undefined,
  pairs: string[],
): string {
  return `(entmakex (list '(0 . ${lispString(type)}) '(100 . "AcDbEntity") ${layerPair(layer)} ` +
    `'(100 . ${lispString(subclass)}) ${pairs.join(" ")}))`;
}

function entityResult(entityVariable = "mcp:e", kind = "entity"): string {
  return `(if ${entityVariable} ` +
    `${resultExpression(
      "ok",
      `(strcat ${lispString(`${kind}_id=`)} (cdr (assoc 5 (entget ${entityVariable}))))`,
    )} ${resultError(`Could not create ${kind}`)})`;
}

function compoundEntityResult(
  primaryVariable: string,
  requiredVariables: string[],
  kind: string,
): string {
  return `(if (and ${[primaryVariable, ...requiredVariables].join(" ")}) ` +
    `${resultExpression(
      "ok",
      `(strcat ${lispString(`${kind}_id=`)} (cdr (assoc 5 (entget ${primaryVariable}))))`,
    )} ${resultError(`Could not create complete ${kind}`)})`;
}

function createEntity(expression: string, kind = "entity"): LispBuildResult {
  return supported(
    program([
      `(setq mcp:e ${expression})`,
      entityResult("mcp:e", kind),
      "(princ)",
    ]),
  );
}

function lineExpression(
  p1: Point3,
  p2: Point3,
  layer: string | undefined,
): string {
  return entityExpression("LINE", "AcDbLine", layer, [
    `(cons 10 ${lispPoint(p1)})`,
    `(cons 11 ${lispPoint(p2)})`,
  ]);
}

function circleExpression(
  center: Point3,
  radius: number,
  layer: string | undefined,
): string {
  return entityExpression("CIRCLE", "AcDbCircle", layer, [
    `(cons 10 ${lispPoint(center)})`,
    `(cons 40 ${lispNumber(radius)})`,
  ]);
}

function polylineExpression(
  points: Point3[],
  closed: boolean,
  layer: string | undefined,
): string {
  const vertices = points.map((point) => `(cons 10 ${lispPoint(point)})`);
  return entityExpression("LWPOLYLINE", "AcDbPolyline", layer, [
    `(cons 90 ${points.length})`,
    `(cons 70 ${closed ? 1 : 0})`,
    ...vertices,
  ]);
}

function textExpression(
  point: Point3,
  text: string,
  height: number,
  rotationDegrees: number,
  layer: string | undefined,
): string {
  return entityExpression("TEXT", "AcDbText", layer, [
    `(cons 10 ${lispPoint(point)})`,
    `(cons 40 ${lispNumber(height)})`,
    `(cons 1 ${lispString(text)})`,
    `(cons 7 "Standard")`,
    `(cons 50 ${lispNumber(radians(rotationDegrees))})`,
    "'(100 . \"AcDbText\")",
  ]);
}

function mtextExpression(
  point: Point3,
  width: number,
  text: string,
  height: number,
  rotationDegrees: number,
  layer: string | undefined,
): string {
  return entityExpression("MTEXT", "AcDbMText", layer, [
    `(cons 10 ${lispPoint(point)})`,
    `(cons 40 ${lispNumber(height)})`,
    `(cons 41 ${lispNumber(width)})`,
    "'(71 . 1)",
    `(cons 1 ${lispString(text)})`,
    `(cons 7 "Standard")`,
    `(cons 50 ${lispNumber(radians(rotationDegrees))})`,
  ]);
}

function entityByHandle(handle: string): string {
  return `(handent ${lispString(handle)})`;
}

function commandEntity(lines: string[], failure: string): LispBuildResult {
  return supported(
    program([
      "(setq mcp:before (entlast))",
      ...lines,
      "(setq mcp:e (entlast))",
      `(if (eq mcp:before mcp:e) ${resultError(failure)} ${entityResult("mcp:e")})`,
      "(princ)",
    ]),
  );
}

function mutateOne(
  input: LispOperationInput,
  command: (entity: string) => string,
  successMessage: string,
): LispBuildResult {
  const handle = requiredHandle(input);
  return supported(
    program([
      `(setq mcp:e ${entityByHandle(handle)})`,
      `(if (null mcp:e) ${resultError(`Entity ${handle} was not found`)}`,
      "  (progn",
      '    (setq mcp:osmode (getvar "OSMODE"))',
      '    (setvar "OSMODE" 0)',
      "    (setq mcp:command-result",
      `      (vl-catch-all-apply (function (lambda () ${command("mcp:e")})) nil))`,
      '    (setvar "OSMODE" mcp:osmode)',
      "    (if (vl-catch-all-error-p mcp:command-result)",
      `      ${resultExpression(
        "error",
        '(strcat "AutoCAD command failed: " (vl-catch-all-error-message mcp:command-result))',
      )}`,
      `      ${resultOk(successMessage)})))`,
      "(princ)",
    ]),
  );
}

function entityCreateLine(input: LispOperationInput): LispBuildResult {
  const p1: Point3 = [requiredNumber(input, "x1"), requiredNumber(input, "y1"), 0];
  const p2: Point3 = [requiredNumber(input, "x2"), requiredNumber(input, "y2"), 0];
  return createEntity(lineExpression(p1, p2, optionalString(input, "layer")));
}

function entityCreateCircle(input: LispOperationInput): LispBuildResult {
  const center: Point3 = [requiredNumber(input, "cx"), requiredNumber(input, "cy"), 0];
  const radius = positive(requiredNumber(input, "radius"), "radius");
  return createEntity(circleExpression(center, radius, optionalString(input, "layer")));
}

function entityCreatePolyline(input: LispOperationInput): LispBuildResult {
  const points = pointsArgument(input);
  return createEntity(
    polylineExpression(points, optionalBoolean(input, "closed"), optionalString(input, "layer")),
  );
}

function entityCreateRectangle(input: LispOperationInput): LispBuildResult {
  const x1 = requiredNumber(input, "x1");
  const y1 = requiredNumber(input, "y1");
  const x2 = requiredNumber(input, "x2");
  const y2 = requiredNumber(input, "y2");
  if (x1 === x2 || y1 === y2) return invalid("rectangle", "must have non-zero width and height");
  return createEntity(
    polylineExpression(
      [[x1, y1, 0], [x2, y1, 0], [x2, y2, 0], [x1, y2, 0]],
      true,
      optionalString(input, "layer"),
    ),
  );
}

function entityCreateArc(input: LispOperationInput): LispBuildResult {
  const center: Point3 = [requiredNumber(input, "cx"), requiredNumber(input, "cy"), 0];
  const radius = positive(requiredNumber(input, "radius"), "radius");
  const start = radians(requiredNumber(input, "start_angle"));
  const end = radians(requiredNumber(input, "end_angle"));
  return createEntity(
    entityExpression("ARC", "AcDbCircle", optionalString(input, "layer"), [
      `(cons 10 ${lispPoint(center)})`,
      `(cons 40 ${lispNumber(radius)})`,
      "'(100 . \"AcDbArc\")",
      `(cons 50 ${lispNumber(start)})`,
      `(cons 51 ${lispNumber(end)})`,
    ]),
  );
}

function entityCreateEllipse(input: LispOperationInput): LispBuildResult {
  const center: Point3 = [requiredNumber(input, "cx"), requiredNumber(input, "cy"), 0];
  const majorX = requiredNumber(input, "major_x");
  const majorY = requiredNumber(input, "major_y");
  if (Math.hypot(majorX, majorY) === 0) return invalid("major axis", "must be non-zero");
  const ratio = positive(requiredNumber(input, "ratio"), "ratio");
  if (ratio > 1) return invalid("ratio", "must not exceed 1");
  return createEntity(
    entityExpression("ELLIPSE", "AcDbEllipse", optionalString(input, "layer"), [
      `(cons 10 ${lispPoint(center)})`,
      `(cons 11 ${lispPoint([majorX, majorY, 0])})`,
      `(cons 40 ${lispNumber(ratio)})`,
      "'(41 . 0.0)",
      `(cons 42 ${lispNumber(Math.PI * 2)})`,
    ]),
  );
}

function entityCreateMtext(input: LispOperationInput): LispBuildResult {
  const point: Point3 = [requiredNumber(input, "x"), requiredNumber(input, "y"), 0];
  const width = positive(requiredNumber(input, "width"), "width");
  const height = positive(optionalNumber(input, "height", 2.5), "height");
  const rotation = optionalNumber(input, "rotation", 0);
  return createEntity(
    mtextExpression(
      point,
      width,
      requiredString(input, "text"),
      height,
      rotation,
      optionalString(input, "layer"),
    ),
  );
}

function entityCreateHatch(input: LispOperationInput): LispBuildResult {
  const handle = requiredHandle(input);
  const pattern = optionalString(input, "pattern") || "ANSI31";
  const scale = positive(optionalNumber(input, "scale", 1), "scale");
  const angle = optionalNumber(input, "angle", 0);
  return supported(
    program([
      `(setq mcp:e ${entityByHandle(handle)})`,
      `(if (null mcp:e) ${resultError(`Boundary entity ${handle} was not found`)}`,
      "  (progn",
      "    (setq mcp:before (entlast))",
      `    (command-s "_.-HATCH" "_P" ${lispString(pattern)} ${lispNumber(scale)} ${lispNumber(angle)} "_S" mcp:e "" "")`,
      "    (setq mcp:hatch (entlast))",
      `    (if (eq mcp:before mcp:hatch) ${resultError("Could not create hatch")} ${entityResult("mcp:hatch")})))`,
      "(princ)",
    ]),
  );
}

function entityList(input: LispOperationInput): LispBuildResult {
  const layer = optionalString(input, "layer");
  const selection = layer
    ? `(ssget "_X" (list (cons 8 ${lispString(layer)})))`
    : '(ssget "_X")';
  return supported(
    program([
      `(setq mcp:ss ${selection} mcp:i 0 mcp:out "handle\\ttype\\tlayer")`,
      "(if mcp:ss",
      "  (while (< mcp:i (sslength mcp:ss))",
      "    (setq mcp:d (entget (ssname mcp:ss mcp:i)))",
      '    (setq mcp:out (strcat mcp:out "\\n" (cdr (assoc 5 mcp:d)) "\\t" (cdr (assoc 0 mcp:d)) "\\t" (cdr (assoc 8 mcp:d))))',
      "    (setq mcp:i (1+ mcp:i))))",
      resultExpression("ok", "mcp:out"),
      "(princ)",
    ]),
    "tsv",
  );
}

function entityCount(input: LispOperationInput): LispBuildResult {
  const layer = optionalString(input, "layer");
  const selection = layer
    ? `(ssget "_X" (list (cons 8 ${lispString(layer)})))`
    : '(ssget "_X")';
  return supported(
    program([
      `(setq mcp:ss ${selection})`,
      resultExpression("ok", '(itoa (if mcp:ss (sslength mcp:ss) 0))'),
      "(princ)",
    ]),
  );
}

function entityGet(input: LispOperationInput): LispBuildResult {
  const handle = requiredHandle(input);
  return supported(
    program([
      `(setq mcp:e ${entityByHandle(handle)})`,
      `(if mcp:e ${resultExpression("ok", "(vl-princ-to-string (entget mcp:e))")} ` +
        `${resultError(`Entity ${handle} was not found`)})`,
      "(princ)",
    ]),
  );
}

function entityCopy(input: LispOperationInput): LispBuildResult {
  const dx = requiredNumber(input, "dx");
  const dy = requiredNumber(input, "dy");
  const handle = requiredHandle(input);
  return supported(
    program([
      `(setq mcp:e ${entityByHandle(handle)})`,
      `(if (null mcp:e) ${resultError(`Entity ${handle} was not found`)}`,
      "  (progn",
      '    (setq mcp:osmode (getvar "OSMODE") mcp:before (entlast))',
      '    (setvar "OSMODE" 0)',
      "    (setq mcp:command-result",
      `      (vl-catch-all-apply (function (lambda () (command-s "_.COPY" mcp:e "" ` +
        `(list 0.0 0.0 0.0) ${lispPoint([dx, dy, 0])}))) nil))`,
      '    (setvar "OSMODE" mcp:osmode)',
      "    (if (vl-catch-all-error-p mcp:command-result)",
      `      ${resultExpression(
        "error",
        '(strcat "AutoCAD command failed: " (vl-catch-all-error-message mcp:command-result))',
      )}`,
      "      (progn",
      "        (setq mcp:copy (entlast))",
      `        (if (eq mcp:before mcp:copy) ${resultError("Could not copy entity")} ` +
        `${entityResult("mcp:copy")})))))`,
      "(princ)",
    ]),
  );
}

function entityMove(input: LispOperationInput): LispBuildResult {
  const dx = requiredNumber(input, "dx");
  const dy = requiredNumber(input, "dy");
  return mutateOne(
    input,
    (entity) => `(command-s "_.MOVE" ${entity} "" (list 0.0 0.0 0.0) ${lispPoint([dx, dy, 0])})`,
    "Entity moved",
  );
}

function entityRotate(input: LispOperationInput): LispBuildResult {
  const center: Point3 = [requiredNumber(input, "cx"), requiredNumber(input, "cy"), 0];
  const angle = requiredNumber(input, "angle");
  return mutateOne(
    input,
    (entity) => `(command-s "_.ROTATE" ${entity} "" ${lispPoint(center)} ${lispNumber(angle)})`,
    "Entity rotated",
  );
}

function entityScale(input: LispOperationInput): LispBuildResult {
  const center: Point3 = [requiredNumber(input, "cx"), requiredNumber(input, "cy"), 0];
  const factor = positive(requiredNumber(input, "factor"), "factor");
  return mutateOne(
    input,
    (entity) => `(command-s "_.SCALE" ${entity} "" ${lispPoint(center)} ${lispNumber(factor)})`,
    "Entity scaled",
  );
}

function entityMirror(input: LispOperationInput): LispBuildResult {
  const p1: Point3 = [requiredNumber(input, "x1"), requiredNumber(input, "y1"), 0];
  const p2: Point3 = [requiredNumber(input, "x2"), requiredNumber(input, "y2"), 0];
  if (p1[0] === p2[0] && p1[1] === p2[1]) return invalid("mirror axis", "must have two distinct points");
  return mutateOne(
    input,
    (entity) => `(command-s "_.MIRROR" ${entity} "" ${lispPoint(p1)} ${lispPoint(p2)} "_N")`,
    "Entity mirrored",
  );
}

function entityOffset(input: LispOperationInput): LispBuildResult {
  const handle = requiredHandle(input);
  const distance = positive(requiredNumber(input, "distance"), "distance");
  const sideValue = argument(input, "side_point");
  if (sideValue === undefined || sideValue === null) {
    return unsupported(
      "Offset distance does not determine a side; provide side_point: [x, y] or [x, y, z].",
      "ambiguous_operation",
    );
  }
  const sidePoint = finitePoint(sideValue, "side_point");
  return supported(
    program([
      `(setq mcp:e ${entityByHandle(handle)})`,
      `(if (null mcp:e) ${resultError(`Entity ${handle} was not found`)}`,
      "  (progn",
      '    (setq mcp:osmode (getvar "OSMODE") mcp:before (entlast))',
      '    (setvar "OSMODE" 0)',
      "    (setq mcp:command-result",
      `      (vl-catch-all-apply (function (lambda () (command-s "_.OFFSET" ` +
        `${lispNumber(distance)} mcp:e ${lispPoint(sidePoint)} ""))) nil))`,
      '    (setvar "OSMODE" mcp:osmode)',
      "    (if (vl-catch-all-error-p mcp:command-result)",
      `      ${resultExpression(
        "error",
        '(strcat "AutoCAD command failed: " (vl-catch-all-error-message mcp:command-result))',
      )}`,
      "      (progn",
      "        (setq mcp:offset (entlast))",
      `        (if (eq mcp:before mcp:offset) ${resultError("Could not offset entity")} ` +
        `${entityResult("mcp:offset")})))))`,
      "(princ)",
    ]),
  );
}

function entityArray(input: LispOperationInput): LispBuildResult {
  const handle = requiredHandle(input);
  const rows = positiveInteger(argument(input, "rows"), "rows");
  const columns = positiveInteger(argument(input, "cols"), "cols");
  const rowDistance = requiredNumber(input, "row_dist");
  const columnDistance = requiredNumber(input, "col_dist");
  if (rows * columns > 10_000) {
    return invalid("array", "cannot contain more than 10000 items");
  }
  return supported(
    program([
      `(setq mcp:e ${entityByHandle(handle)})`,
      `(if (null mcp:e) ${resultError(`Entity ${handle} was not found`)}`,
      "  (progn",
      '    (setq mcp:osmode (getvar "OSMODE") mcp:copymode (getvar "COPYMODE"))',
      '    (setvar "OSMODE" 0) (setvar "COPYMODE" 1)',
      `    (setq mcp:row 0 mcp:copies 0 mcp:array-error nil)`,
      `    (while (and (< mcp:row ${rows}) (null mcp:array-error))`,
      "      (setq mcp:col 0)",
      `      (while (and (< mcp:col ${columns}) (null mcp:array-error))`,
      "        (if (not (and (= mcp:row 0) (= mcp:col 0)))",
      "          (progn",
      "            (setq mcp:before (entlast))",
      "            (setq mcp:command-result",
      `              (vl-catch-all-apply (function (lambda () (command-s "_.COPY" mcp:e "" ` +
        `(list 0.0 0.0 0.0) (list (* mcp:col ${lispNumber(columnDistance)}) ` +
        `(* mcp:row ${lispNumber(rowDistance)}) 0.0)))) nil))`,
      "            (cond",
      "              ((vl-catch-all-error-p mcp:command-result)",
      '                (setq mcp:array-error (vl-catch-all-error-message mcp:command-result)))',
      "              ((eq mcp:before (entlast))",
      '                (setq mcp:array-error "AutoCAD did not create an array copy"))',
      "              (T (setq mcp:copies (1+ mcp:copies))))))",
      "        (setq mcp:col (1+ mcp:col)))",
      "      (setq mcp:row (1+ mcp:row)))",
      '    (setvar "COPYMODE" mcp:copymode) (setvar "OSMODE" mcp:osmode)',
      "    (if mcp:array-error",
      `      ${resultExpression("error", '(strcat "AutoCAD command failed: " mcp:array-error)')}`,
      `      ${resultExpression(
        "ok",
        `(strcat "copies=" (itoa mcp:copies) " rows=${rows} cols=${columns}")`,
      )})))`,
      "(princ)",
    ]),
  );
}

function entityErase(input: LispOperationInput): LispBuildResult {
  const handle = requiredHandle(input);
  return supported(
    program([
      `(setq mcp:e ${entityByHandle(handle)})`,
      `(if (or (null mcp:e) (null (entget mcp:e))) ${resultError(`Entity ${handle} was not found`)}`,
      "  (progn",
      "    (setq mcp:deleted (entdel mcp:e))",
      `    (if (and mcp:deleted (null (entget mcp:e))) ${resultOk("Entity erased")} ` +
        `${resultError("AutoCAD did not erase the entity")})))`,
      "(princ)",
    ]),
  );
}

function entityPairMutation(
  input: LispOperationInput,
  kind: "fillet" | "chamfer",
): LispBuildResult {
  const first = requiredHandle(input, "id1");
  const second = requiredHandle(input, "id2");
  if (first.toUpperCase() === second.toUpperCase()) {
    return invalid(kind, "requires two distinct entity handles");
  }
  const command = kind === "fillet"
    ? `(command-s "_.FILLET" "_R" ${lispNumber(positive(requiredNumber(input, "radius"), "radius", true))} mcp:e1 mcp:e2)`
    : `(command-s "_.CHAMFER" "_D" ` +
      `${lispNumber(positive(requiredNumber(input, "dist1"), "dist1", true))} ` +
      `${lispNumber(positive(requiredNumber(input, "dist2"), "dist2", true))} mcp:e1 mcp:e2)`;
  return supported(
    program([
      `(setq mcp:e1 ${entityByHandle(first)} mcp:e2 ${entityByHandle(second)})`,
      `(if (or (null mcp:e1) (null mcp:e2)) ${resultError("One or both entities were not found")}`,
      "  (progn",
      "    (setq mcp:before1 (entget mcp:e1) mcp:before2 (entget mcp:e2)",
      '          mcp:before-last (entlast) mcp:osmode (getvar "OSMODE"))',
      '    (setvar "OSMODE" 0)',
      "    (setq mcp:command-result",
      `      (vl-catch-all-apply (function (lambda () ${command})) nil))`,
      '    (setvar "OSMODE" mcp:osmode)',
      "    (if (vl-catch-all-error-p mcp:command-result)",
      `      ${resultExpression(
        "error",
        '(strcat "AutoCAD command failed: " (vl-catch-all-error-message mcp:command-result))',
      )}`,
      "      (if (or (not (equal mcp:before1 (entget mcp:e1)))",
      "              (not (equal mcp:before2 (entget mcp:e2)))",
      "              (not (eq mcp:before-last (entlast))))",
      `        ${resultOk(kind === "fillet" ? "Entities filleted" : "Entities chamfered")}`,
      `        ${resultError(
        kind === "fillet"
          ? "Fillet completed without changing geometry"
          : "Chamfer completed without changing geometry",
      )}))))`,
      "(princ)",
    ]),
  );
}

export function buildEntityLisp(input: LispOperationInput): LispBuildResult {
  return safely(() => {
    switch (input.operation) {
      case "create_line": return entityCreateLine(input);
      case "create_circle": return entityCreateCircle(input);
      case "create_polyline": return entityCreatePolyline(input);
      case "create_rectangle": return entityCreateRectangle(input);
      case "create_arc": return entityCreateArc(input);
      case "create_ellipse": return entityCreateEllipse(input);
      case "create_mtext": return entityCreateMtext(input);
      case "create_hatch": return entityCreateHatch(input);
      case "list": return entityList(input);
      case "count": return entityCount(input);
      case "get": return entityGet(input);
      case "copy": return entityCopy(input);
      case "move": return entityMove(input);
      case "rotate": return entityRotate(input);
      case "scale": return entityScale(input);
      case "mirror": return entityMirror(input);
      case "offset": return entityOffset(input);
      case "array": return entityArray(input);
      case "fillet": return entityPairMutation(input, "fillet");
      case "chamfer": return entityPairMutation(input, "chamfer");
      case "erase": return entityErase(input);
      default:
        return unsupported(`Unknown entity operation: ${input.operation}`);
    }
  });
}

function colorIndex(value: unknown, label = "color"): number {
  if (value === undefined || value === null) return 7;
  if (typeof value === "number") {
    const color = finiteNumber(value, label);
    if (!Number.isInteger(color) || color < 1 || color > 255) {
      return invalid(label, "must be an ACI integer from 1 to 255");
    }
    return color;
  }
  if (typeof value !== "string") return invalid(label, "must be an ACI number or color name");
  const named: Record<string, number> = {
    red: 1,
    yellow: 2,
    green: 3,
    cyan: 4,
    blue: 5,
    magenta: 6,
    white: 7,
    grey: 8,
    gray: 8,
  };
  const color = named[value.toLowerCase()];
  if (color === undefined) return invalid(label, `unknown color name '${value}'`);
  return color;
}

function lineweightCode(value: unknown): number | undefined {
  if (value === undefined || value === null) return undefined;
  const named: Record<string, number> = {
    bylayer: -1,
    byblock: -2,
    default: -3,
  };
  if (typeof value === "string" && named[value.toLowerCase()] !== undefined) {
    return named[value.toLowerCase()];
  }
  let number: number;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase().replace(/\s*mm$/, "");
    number = Number(normalized);
    if (!Number.isFinite(number)) return invalid("lineweight", "must be millimetres or BYLAYER/BYBLOCK/DEFAULT");
    number = Math.round(number * 100);
  } else {
    number = finiteNumber(value, "lineweight");
  }
  if (!Number.isInteger(number) || number < 0 || number > 211) {
    return invalid("lineweight", "must resolve to 0..211 hundredths of a millimetre");
  }
  return number;
}

function ensureLayerDefinition(): string[] {
  return [
    "(defun mcp:ensure-layer (mcp:name mcp:color mcp:ltype / mcp:record mcp:entity mcp:result mcp:actual)",
    "  (setq mcp:record (list '(0 . \"LAYER\") '(100 . \"AcDbSymbolTableRecord\")",
    "    '(100 . \"AcDbLayerTableRecord\") (cons 2 mcp:name) '(70 . 0) (cons 62 mcp:color)))",
    '  (if (tblsearch "LTYPE" mcp:ltype) (setq mcp:record (append mcp:record (list (cons 6 mcp:ltype)))))',
    '  (if (tblsearch "LAYER" mcp:name)',
    "    (progn",
    '      (setq mcp:entity (entget (tblobjname "LAYER" mcp:name)))',
    "      (setq mcp:entity (subst (cons 62 mcp:color) (assoc 62 mcp:entity) mcp:entity))",
    "      (if (assoc 420 mcp:entity) (setq mcp:entity (vl-remove (assoc 420 mcp:entity) mcp:entity)))",
    '      (if (and (tblsearch "LTYPE" mcp:ltype) (assoc 6 mcp:entity))',
    "        (setq mcp:entity (subst (cons 6 mcp:ltype) (assoc 6 mcp:entity) mcp:entity)))",
    "      (setq mcp:result (entmod mcp:entity)))",
    "    (setq mcp:result (entmake mcp:record)))",
    '  (setq mcp:actual (tblsearch "LAYER" mcp:name))',
    "  (and mcp:result mcp:actual",
    "    (= mcp:color (cdr (assoc 62 mcp:actual)))",
    "    (null (assoc 420 mcp:actual))",
    "    (= (strcase mcp:ltype) (strcase (cdr (assoc 6 mcp:actual))))))",
  ];
}

function layerList(): LispBuildResult {
  return supported(
    program([
      '(setq mcp:l (tblnext "LAYER" T) mcp:out "name\\tcolor\\tlinetype\\tfrozen\\tlocked\\tlineweight")',
      "(while mcp:l",
      "  (setq mcp:flags (cdr (assoc 70 mcp:l)))",
      '  (setq mcp:out (strcat mcp:out "\\n" (cdr (assoc 2 mcp:l)) "\\t"',
      '    (itoa (abs (cdr (assoc 62 mcp:l)))) "\\t" (cdr (assoc 6 mcp:l)) "\\t"',
      '    (if (= 0 (logand mcp:flags 1)) "false" "true") "\\t"',
      '    (if (= 0 (logand mcp:flags 4)) "false" "true") "\\t"',
      '    (if (assoc 370 mcp:l) (itoa (cdr (assoc 370 mcp:l))) "")))',
      '  (setq mcp:l (tblnext "LAYER")))',
      resultExpression("ok", "mcp:out"),
      "(princ)",
    ]),
    "tsv",
  );
}

function layerCreate(input: LispOperationInput): LispBuildResult {
  const name = requiredString(input, "name");
  const color = colorIndex(argument(input, "color"));
  const linetype = optionalString(input, "linetype") || "CONTINUOUS";
  return supported(
    program([
      ...ensureLayerDefinition(),
      `(if (not (tblsearch "LTYPE" ${lispString(linetype)}))`,
      `  ${resultError(`Requested linetype ${linetype} was not loaded`)}`,
      "  (progn",
      `    (setq mcp:ready (mcp:ensure-layer ${lispString(name)} ${color} ${lispString(linetype)}))`,
      `    (if mcp:ready ${resultOk(`Layer ${name} is ready`)} ` +
        `${resultError(`Could not create or update layer ${name}`)})))`,
      "(princ)",
    ]),
  );
}

function layerSetCurrent(input: LispOperationInput): LispBuildResult {
  const name = requiredString(input, "name");
  return supported(
    program([
      `(if (tblsearch "LAYER" ${lispString(name)})`,
      `  (progn (setvar "CLAYER" ${lispString(name)}) ${resultOk(`Current layer set to ${name}`)})`,
      `  ${resultError(`Layer ${name} was not found`)})`,
      "(princ)",
    ]),
  );
}

function layerSetProperties(input: LispOperationInput): LispBuildResult {
  const name = requiredString(input, "name");
  const rawColor = argument(input, "color");
  const color = rawColor === undefined || rawColor === null ? undefined : colorIndex(rawColor);
  const linetype = optionalString(input, "linetype");
  const lineweight = lineweightCode(argument(input, "lineweight"));
  if (color === undefined && linetype === undefined && lineweight === undefined) {
    return invalid("set_properties", "requires color, linetype, or lineweight");
  }
  const updates: string[] = [];
  if (color !== undefined) {
    updates.push("(setq mcp:d (mcp:assoc-set 62 " + color + " mcp:d))");
    updates.push("(if (assoc 420 mcp:d) (setq mcp:d (vl-remove (assoc 420 mcp:d) mcp:d)))");
  }
  if (linetype !== undefined) {
    updates.push(`(setq mcp:d (mcp:assoc-set 6 ${lispString(linetype)} mcp:d))`);
  }
  if (lineweight !== undefined) {
    updates.push(`(setq mcp:d (mcp:assoc-set 370 ${lineweight} mcp:d))`);
  }
  const linetypeCondition = linetype === undefined
    ? "T"
    : `(tblsearch "LTYPE" ${lispString(linetype)})`;
  const postconditions = [
    ...(color === undefined
      ? []
      : [`(= ${color} (cdr (assoc 62 mcp:actual)))`, "(null (assoc 420 mcp:actual))"]),
    ...(linetype === undefined
      ? []
      : [`(= (strcase ${lispString(linetype)}) (strcase (cdr (assoc 6 mcp:actual))))`]),
    ...(lineweight === undefined
      ? []
      : [`(= ${lineweight} (cdr (assoc 370 mcp:actual)))`]),
  ];
  return supported(
    program([
      "(defun mcp:assoc-set (mcp:code mcp:value mcp:data / mcp:old)",
      "  (if (setq mcp:old (assoc mcp:code mcp:data))",
      "    (subst (cons mcp:code mcp:value) mcp:old mcp:data)",
      "    (append mcp:data (list (cons mcp:code mcp:value)))))",
      `(setq mcp:e (tblobjname "LAYER" ${lispString(name)}))`,
      `(cond ((null mcp:e) ${resultError(`Layer ${name} was not found`)})`,
      `      ((not ${linetypeCondition}) ${resultError(`Requested linetype was not loaded`)})`,
      "      (T",
      "        (setq mcp:d (entget mcp:e))",
      ...updates.map((line) => `        ${line}`),
      "        (setq mcp:modified (entmod mcp:d))",
      "        (if mcp:modified (entupd mcp:e))",
      "        (setq mcp:actual (if mcp:modified (entget mcp:e)))",
      `        (if (and mcp:modified mcp:actual ${postconditions.join(" ")})`,
      `          ${resultOk(`Layer ${name} updated`)}`,
      `          ${resultError(`Could not update layer ${name}`)})))`,
      "(princ)",
    ]),
  );
}

function layerFlag(
  input: LispOperationInput,
  operation: "freeze" | "thaw" | "lock" | "unlock",
): LispBuildResult {
  const name = requiredString(input, "name");
  const bit = operation === "lock" || operation === "unlock" ? 4 : 1;
  const enable = operation === "freeze" || operation === "lock";
  const newFlags = enable
    ? `(if (= 0 (logand mcp:flags ${bit})) (+ mcp:flags ${bit}) mcp:flags)`
    : `(if (= 0 (logand mcp:flags ${bit})) mcp:flags (- mcp:flags ${bit}))`;
  const currentLayerGuard = operation === "freeze"
    ? `((= (strcase ${lispString(name)}) (strcase (getvar "CLAYER"))) ` +
      `${resultError("The current layer cannot be frozen")})`
    : "";
  return supported(
    program([
      `(setq mcp:e (tblobjname "LAYER" ${lispString(name)}))`,
      `(cond ((null mcp:e) ${resultError(`Layer ${name} was not found`)})`,
      ...(currentLayerGuard ? [`      ${currentLayerGuard}`] : []),
      "      (T",
      "        (setq mcp:d (entget mcp:e) mcp:flags (cdr (assoc 70 (entget mcp:e))))",
      `        (setq mcp:d (subst (cons 70 ${newFlags}) (assoc 70 mcp:d) mcp:d))`,
      "        (setq mcp:modified (entmod mcp:d))",
      "        (if mcp:modified (entupd mcp:e))",
      "        (setq mcp:actual-flags (if mcp:modified (cdr (assoc 70 (entget mcp:e)))))",
      `        (if (and mcp:modified ${
        enable
          ? `(/= 0 (logand mcp:actual-flags ${bit}))`
          : `(= 0 (logand mcp:actual-flags ${bit}))`
      })`,
      `          ${resultOk(`Layer ${name} ${operation} complete`)}`,
      `          ${resultError(`Could not ${operation} layer ${name}`)})))`,
      "(princ)",
    ]),
  );
}

export function buildLayerLisp(input: LispOperationInput): LispBuildResult {
  return safely(() => {
    switch (input.operation) {
      case "list": return layerList();
      case "create": return layerCreate(input);
      case "set_current": return layerSetCurrent(input);
      case "set_properties": return layerSetProperties(input);
      case "freeze":
      case "thaw":
      case "lock":
      case "unlock":
        return layerFlag(input, input.operation);
      default:
        return unsupported(`Unknown layer operation: ${input.operation}`);
    }
  });
}

function updateAttributesDefinition(): string[] {
  return [
    "(defun mcp:update-attributes (mcp:insert mcp:values / mcp:a mcp:d mcp:p mcp:count)",
    "  (setq mcp:count 0)",
    "  (if (= 1 (cdr (assoc 66 (entget mcp:insert)))) (setq mcp:a (entnext mcp:insert)))",
    '  (while (and mcp:a (not (= "SEQEND" (cdr (assoc 0 (setq mcp:d (entget mcp:a)))))))',
    '    (if (= "ATTRIB" (cdr (assoc 0 mcp:d)))',
    "      (progn",
    "        (setq mcp:p mcp:values)",
    "        (while mcp:p",
    "          (if (= (strcase (caar mcp:p)) (strcase (cdr (assoc 2 mcp:d))))",
    "            (progn",
    "              (setq mcp:d (subst (cons 1 (cdar mcp:p)) (assoc 1 mcp:d) mcp:d))",
    "              (if (entmod mcp:d)",
    "                (progn (entupd mcp:a) (setq mcp:count (1+ mcp:count))))",
    "              (setq mcp:p nil))",
    "            (setq mcp:p (cdr mcp:p))))))",
    "    (setq mcp:a (entnext mcp:a)))",
    "  mcp:count)",
  ];
}

function attributePairs(attributes: Record<string, string>): string {
  const pairs = Object.entries(attributes)
    .map(([tag, value]) => `(cons ${lispString(tag)} ${lispString(value)})`)
    .join(" ");
  return `(list ${pairs})`;
}

function blockList(): LispBuildResult {
  return supported(
    program([
      '(setq mcp:b (tblnext "BLOCK" T) mcp:out "name")',
      "(while mcp:b",
      "  (setq mcp:n (cdr (assoc 2 mcp:b)))",
      '  (if (not (= "*" (substr mcp:n 1 1))) (setq mcp:out (strcat mcp:out "\\n" mcp:n)))',
      '  (setq mcp:b (tblnext "BLOCK")))',
      resultExpression("ok", "mcp:out"),
      "(princ)",
    ]),
    "tsv",
  );
}

function blockInsert(input: LispOperationInput, withAttributes: boolean): LispBuildResult {
  const name = requiredString(input, "name");
  const point: Point3 = [requiredNumber(input, "x"), requiredNumber(input, "y"), 0];
  const scale = positive(optionalNumber(input, "scale", 1), "scale");
  const rotation = optionalNumber(input, "rotation", 0);
  const attributes = withAttributes ? attributesArgument(input) : {};
  const blockId = withAttributes ? undefined : optionalString(input, "block_id");
  if (blockId !== undefined) attributes.ID = blockId;
  return supported(
    program([
      ...updateAttributesDefinition(),
      `(if (not (tblsearch "BLOCK" ${lispString(name)})) ${resultError(`Block ${name} is not defined`)}`,
      "  (progn",
      '    (setq mcp:attreq (getvar "ATTREQ") mcp:osmode (getvar "OSMODE"))',
      '    (setvar "ATTREQ" 0) (setvar "OSMODE" 0)',
      "    (setq mcp:command-result",
      `      (vl-catch-all-apply (function (lambda () (command-s "_.-INSERT" ` +
        `${lispString(name)} ${lispPoint(point)} ${lispNumber(scale)} ${lispNumber(scale)} ` +
        `${lispNumber(rotation)}))) nil))`,
      '    (setvar "ATTREQ" mcp:attreq) (setvar "OSMODE" mcp:osmode)',
      "    (if (vl-catch-all-error-p mcp:command-result)",
      `      ${resultExpression(
        "error",
        '(strcat "AutoCAD command failed: " (vl-catch-all-error-message mcp:command-result))',
      )}`,
      "      (progn",
      "        (setq mcp:e (entlast))",
      `        (if (and mcp:e (= "INSERT" (cdr (assoc 0 (entget mcp:e)))))`,
      "          (progn",
      `            (setq mcp:updated (mcp:update-attributes mcp:e ${attributePairs(attributes)}))`,
      `            ${resultExpression(
        "ok",
        `(strcat "entity_id=" (cdr (assoc 5 (entget mcp:e))) " attributes_updated=" (itoa mcp:updated))`,
      )})`,
      `          ${resultError("Could not insert block")})))))`,
      "(princ)",
    ]),
  );
}

function blockGetAttributes(input: LispOperationInput): LispBuildResult {
  const handle = requiredHandle(input);
  return supported(
    program([
      `(setq mcp:e ${entityByHandle(handle)} mcp:out "tag\\tvalue")`,
      `(if (or (null mcp:e) (not (= "INSERT" (cdr (assoc 0 (entget mcp:e))))))`,
      `  ${resultError(`Entity ${handle} is not an INSERT`)}`,
      "  (progn",
      "    (if (= 1 (cdr (assoc 66 (entget mcp:e)))) (setq mcp:a (entnext mcp:e)))",
      '    (while (and mcp:a (not (= "SEQEND" (cdr (assoc 0 (setq mcp:d (entget mcp:a)))))))',
      '      (if (= "ATTRIB" (cdr (assoc 0 mcp:d)))',
      '        (setq mcp:out (strcat mcp:out "\\n" (cdr (assoc 2 mcp:d)) "\\t" (vl-princ-to-string (cdr (assoc 1 mcp:d))))))',
      "      (setq mcp:a (entnext mcp:a)))",
      `    ${resultExpression("ok", "mcp:out")}))`,
      "(princ)",
    ]),
    "tsv",
  );
}

function blockUpdateAttribute(input: LispOperationInput): LispBuildResult {
  const handle = requiredHandle(input);
  const tag = requiredString(input, "tag");
  const value = requiredString(input, "value");
  return supported(
    program([
      ...updateAttributesDefinition(),
      `(setq mcp:e ${entityByHandle(handle)})`,
      `(if (or (null mcp:e) (not (= "INSERT" (cdr (assoc 0 (entget mcp:e))))))`,
      `  ${resultError(`Entity ${handle} is not an INSERT`)}`,
      "  (progn",
      `    (setq mcp:updated (mcp:update-attributes mcp:e ${attributePairs({ [tag]: value })}))`,
      `    (if (> mcp:updated 0) ${resultOk(`Attribute ${tag} updated`)} ` +
        `${resultError(`Attribute ${tag} was not found`)})))`,
      "(princ)",
    ]),
  );
}

type BlockRecipe =
  | { type: "LINE"; p1: Point3; p2: Point3 }
  | { type: "CIRCLE"; center: Point3; radius: number }
  | { type: "ATTDEF"; point: Point3; tag: string; height: number };

function recipeNumber(
  recipe: Record<string, unknown>,
  name: string,
  fallback: number,
  index: number,
): number {
  const value = recipe[name];
  return value === undefined || value === null
    ? fallback
    : finiteNumber(value, `entities[${index}].${name}`);
}

function blockRecipes(input: LispOperationInput): BlockRecipe[] {
  const value = argument(input, "entities");
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) return invalid("entities", "must be an array");
  if (value.length > 256) return invalid("entities", "cannot contain more than 256 recipes");
  return value.map((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return invalid(`entities[${index}]`, "must be an object");
    }
    const recipe = item as Record<string, unknown>;
    const rawType = recipe.type ?? "LINE";
    if (typeof rawType !== "string") {
      return invalid(`entities[${index}].type`, "must be LINE, CIRCLE, or ATTDEF");
    }
    const type = rawType.toUpperCase();
    if (type === "LINE") {
      return {
        type,
        p1: [
          recipeNumber(recipe, "x1", 0, index),
          recipeNumber(recipe, "y1", 0, index),
          0,
        ],
        p2: [
          recipeNumber(recipe, "x2", 0, index),
          recipeNumber(recipe, "y2", 0, index),
          0,
        ],
      };
    }
    if (type === "CIRCLE") {
      return {
        type,
        center: [
          recipeNumber(recipe, "cx", 0, index),
          recipeNumber(recipe, "cy", 0, index),
          0,
        ],
        radius: positive(
          recipeNumber(recipe, "radius", 1, index),
          `entities[${index}].radius`,
        ),
      };
    }
    if (type === "ATTDEF") {
      const rawTag = recipe.tag ?? "TAG";
      if (typeof rawTag !== "string" || rawTag.length === 0 || /\s/u.test(rawTag)) {
        return invalid(`entities[${index}].tag`, "must be a non-empty string without whitespace");
      }
      return {
        type,
        point: [
          recipeNumber(recipe, "x", 0, index),
          recipeNumber(recipe, "y", 0, index),
          0,
        ],
        tag: rawTag,
        height: positive(
          recipeNumber(recipe, "height", 2.5, index),
          `entities[${index}].height`,
        ),
      };
    }
    return invalid(`entities[${index}].type`, "must be LINE, CIRCLE, or ATTDEF");
  });
}

function blockRecipeExpression(recipe: BlockRecipe): string {
  if (recipe.type === "LINE") {
    return `(entmake (list '(0 . "LINE") '(100 . "AcDbEntity") '(8 . "0") ` +
      `'(100 . "AcDbLine") (cons 10 ${lispPoint(recipe.p1)}) ` +
      `(cons 11 ${lispPoint(recipe.p2)})))`;
  }
  if (recipe.type === "CIRCLE") {
    return `(entmake (list '(0 . "CIRCLE") '(100 . "AcDbEntity") '(8 . "0") ` +
      `'(100 . "AcDbCircle") (cons 10 ${lispPoint(recipe.center)}) ` +
      `(cons 40 ${lispNumber(recipe.radius)})))`;
  }
  return `(entmake (list '(0 . "ATTDEF") '(100 . "AcDbEntity") '(8 . "0") ` +
    `'(100 . "AcDbText") (cons 10 ${lispPoint(recipe.point)}) ` +
    `(cons 40 ${lispNumber(recipe.height)}) '(1 . "") '(50 . 0.0) '(41 . 1.0) ` +
    `'(51 . 0.0) '(7 . "Standard") '(71 . 0) '(72 . 0) ` +
    `'(100 . "AcDbAttributeDefinition") (cons 3 ${lispString(recipe.tag)}) ` +
    `(cons 2 ${lispString(recipe.tag)}) '(70 . 0) '(73 . 0) '(74 . 0)))`;
}

function blockDefine(input: LispOperationInput): LispBuildResult {
  const name = requiredString(input, "name");
  if (/[\u0000-\u001f\u007f<>/\\":?*|,=`;]/u.test(name)) {
    return invalid("name", "contains a character that is not valid in a block name");
  }
  const recipes = blockRecipes(input);
  const flags = recipes.some((recipe) => recipe.type === "ATTDEF") ? 2 : 0;
  const recipeLines = recipes.flatMap((recipe) => [
    "        (if mcp:ok",
    `          (if ${blockRecipeExpression(recipe)}`,
    "            (setq mcp:count (1+ mcp:count))",
    "            (setq mcp:ok nil)))",
  ]);
  return supported(
    program([
      `(cond ((not (snvalid ${lispString(name)} 0)) ${resultError(`Block name ${name} is not valid`)})`,
      `      ((tblsearch "BLOCK" ${lispString(name)}) ${resultError(`Block ${name} is already defined`)})`,
      "      (T",
      `        (setq mcp:begin (entmake (list '(0 . "BLOCK") '(100 . "AcDbEntity") ` +
        `'(8 . "0") '(100 . "AcDbBlockBegin") (cons 2 ${lispString(name)}) ` +
        `'(70 . ${flags}) (list 10 0.0 0.0 0.0) (cons 3 ${lispString(name)}))))`,
      `        (if (null mcp:begin) ${resultError(`Could not begin block ${name}`)}`,
      "          (progn",
      "            (setq mcp:ok T mcp:count 0)",
      ...recipeLines,
      "            (if (not mcp:ok)",
      `              (progn (entmake) ${resultError(`Could not define block ${name}`)})`,
      "              (progn",
      `                (setq mcp:end (entmake (list '(0 . "ENDBLK") ` +
        `'(100 . "AcDbEntity") '(8 . "0") '(100 . "AcDbBlockEnd"))))`,
      `                (if mcp:end ${resultExpression(
        "ok",
        `(strcat ${lispString(`block=${name} entity_count=`)} (itoa mcp:count))`,
      )}`,
      `                  (progn (entmake) ${resultError(`Could not complete block ${name}`)}))))))))`,
      "(princ)",
    ]),
  );
}

export function buildBlockLisp(input: LispOperationInput): LispBuildResult {
  return safely(() => {
    switch (input.operation) {
      case "list": return blockList();
      case "insert": return blockInsert(input, false);
      case "insert_with_attributes": return blockInsert(input, true);
      case "get_attributes": return blockGetAttributes(input);
      case "update_attribute": return blockUpdateAttribute(input);
      case "define": return blockDefine(input);
      default:
        return unsupported(`Unknown block operation: ${input.operation}`);
    }
  });
}

function annotationText(input: LispOperationInput): LispBuildResult {
  const point: Point3 = [requiredNumber(input, "x"), requiredNumber(input, "y"), 0];
  const height = positive(optionalNumber(input, "height", 2.5), "height");
  return createEntity(
    textExpression(
      point,
      requiredString(input, "text"),
      height,
      optionalNumber(input, "rotation", 0),
      optionalString(input, "layer"),
    ),
    "text",
  );
}

function annotationLinear(input: LispOperationInput): LispBuildResult {
  const p1: Point3 = [requiredNumber(input, "x1"), requiredNumber(input, "y1"), 0];
  const p2: Point3 = [requiredNumber(input, "x2"), requiredNumber(input, "y2"), 0];
  const dim: Point3 = [requiredNumber(input, "dim_x"), requiredNumber(input, "dim_y"), 0];
  return commandEntity(
    [`(command-s "_.DIMLINEAR" ${lispPoint(p1)} ${lispPoint(p2)} ${lispPoint(dim)})`],
    "Could not create linear dimension",
  );
}

function annotationAligned(input: LispOperationInput): LispBuildResult {
  const p1: Point3 = [requiredNumber(input, "x1"), requiredNumber(input, "y1"), 0];
  const p2: Point3 = [requiredNumber(input, "x2"), requiredNumber(input, "y2"), 0];
  const offset = requiredNumber(input, "offset");
  const dx = p2[0] - p1[0];
  const dy = p2[1] - p1[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) return invalid("dimension", "extension points must be distinct");
  const location: Point3 = [
    (p1[0] + p2[0]) / 2 - (dy / length) * offset,
    (p1[1] + p2[1]) / 2 + (dx / length) * offset,
    0,
  ];
  return commandEntity(
    [`(command-s "_.DIMALIGNED" ${lispPoint(p1)} ${lispPoint(p2)} ${lispPoint(location)})`],
    "Could not create aligned dimension",
  );
}

function annotationAngular(input: LispOperationInput): LispBuildResult {
  const center: Point3 = [requiredNumber(input, "cx"), requiredNumber(input, "cy"), 0];
  const p1: Point3 = [requiredNumber(input, "x1"), requiredNumber(input, "y1"), 0];
  const p2: Point3 = [requiredNumber(input, "x2"), requiredNumber(input, "y2"), 0];
  const radius = Math.max(
    Math.hypot(p1[0] - center[0], p1[1] - center[1]),
    Math.hypot(p2[0] - center[0], p2[1] - center[1]),
  );
  if (radius === 0) return invalid("dimension", "angle rays must extend from the center");
  const first = Math.atan2(p1[1] - center[1], p1[0] - center[0]);
  const second = Math.atan2(p2[1] - center[1], p2[0] - center[0]);
  let delta = second - first;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta <= -Math.PI) delta += Math.PI * 2;
  const middle = first + delta / 2;
  const location: Point3 = [
    center[0] + Math.cos(middle) * radius * 1.2,
    center[1] + Math.sin(middle) * radius * 1.2,
    0,
  ];
  return commandEntity(
    [
      `(command-s "_.DIMANGULAR" "" ${lispPoint(center)} ${lispPoint(p1)} ` +
        `${lispPoint(p2)} ${lispPoint(location)})`,
    ],
    "Could not create angular dimension",
  );
}

function annotationRadius(input: LispOperationInput): LispBuildResult {
  const center: Point3 = [requiredNumber(input, "cx"), requiredNumber(input, "cy"), 0];
  const radius = positive(requiredNumber(input, "radius"), "radius");
  const angle = radians(requiredNumber(input, "angle"));
  const edge: Point3 = [
    center[0] + radius * Math.cos(angle),
    center[1] + radius * Math.sin(angle),
    0,
  ];
  const textPoint: Point3 = [
    center[0] + radius * 1.2 * Math.cos(angle),
    center[1] + radius * 1.2 * Math.sin(angle),
    0,
  ];
  return createEntity(
    `(entmakex (list '(0 . "DIMENSION") '(100 . "AcDbEntity") ${layerPair(optionalString(input, "layer"))} ` +
      `'(100 . "AcDbDimension") (cons 10 ${lispPoint(edge)}) (cons 11 ${lispPoint(textPoint)}) ` +
      `'(70 . 36) '(1 . "<>") '(3 . "Standard") '(100 . "AcDbRadialDimension") ` +
      `(cons 15 ${lispPoint(center)}) (cons 40 ${lispNumber(radius)})))`,
    "dimension",
  );
}

function annotationLeader(input: LispOperationInput): LispBuildResult {
  const points = pointsArgument(input);
  const text = requiredString(input, "text");
  const layer = optionalString(input, "layer");
  const height = positive(optionalNumber(input, "height", 2.5), "height");
  const last = points[points.length - 1];
  const vertices = points.map((point) => `(cons 10 ${lispPoint(point)})`).join(" ");
  return supported(
    program([
      `(setq mcp:e (entmakex (list '(0 . "LEADER") '(100 . "AcDbEntity") ${layerPair(layer)}`,
      `  '(100 . "AcDbLeader") '(3 . "Standard") '(71 . 1) '(72 . 0) '(73 . 3) '(74 . 0) '(75 . 0)`,
      `  (cons 76 ${points.length}) ${vertices})))`,
      `(setq mcp:text ${mtextExpression(
        [last[0] + height, last[1], last[2]],
        Math.max(30, text.length * height * 0.65),
        text,
        height,
        0,
        layer,
      )})`,
      compoundEntityResult("mcp:e", ["mcp:text"], "leader"),
      "(princ)",
    ]),
  );
}

export function buildAnnotationLisp(input: LispOperationInput): LispBuildResult {
  return safely(() => {
    switch (input.operation) {
      case "create_text": return annotationText(input);
      case "create_dimension_linear": return annotationLinear(input);
      case "create_dimension_aligned": return annotationAligned(input);
      case "create_dimension_angular": return annotationAngular(input);
      case "create_dimension_radius": return annotationRadius(input);
      case "create_leader": return annotationLeader(input);
      default:
        return unsupported(`Unknown annotation operation: ${input.operation}`);
    }
  });
}

function pidPreamble(layer: string, color: number): string[] {
  return [
    ...ensureLayerDefinition(),
    `(mcp:ensure-layer ${lispString(layer)} ${color} "CONTINUOUS")`,
  ];
}

function pidSetupLayers(): LispBuildResult {
  const layers: Array<[string, number]> = [
    ["PID-EQUIPMENT", 6],
    ["PID-PROCESS-PIPING", 4],
    ["PID-UTILITY-PIPING", 3],
    ["PID-INSTRUMENTS", 5],
    ["PID-ELECTRICAL", 1],
    ["PID-ANNOTATION", 7],
    ["PID-VALVES", 2],
  ];
  return supported(
    program([
      ...ensureLayerDefinition(),
      "(setq mcp:ok T)",
      ...layers.map(([name, color]) =>
        `(if (not (mcp:ensure-layer ${lispString(name)} ${color} "CONTINUOUS")) ` +
          `(setq mcp:ok nil))`),
      `(if mcp:ok ${resultOk(`${layers.length} P&ID layers are ready`)} ` +
        `${resultError("Could not prepare all P&ID layers")})`,
      "(princ)",
    ]),
  );
}

function pidListSymbols(input: LispOperationInput): LispBuildResult {
  const category = requiredString(input, "category").toUpperCase();
  const symbols = PID_SYMBOLS[category] || [];
  const message = ["symbol", ...symbols].join("\n");
  return supported(program([resultOk(message), "(princ)"]), "tsv");
}

function pidInsertSymbol(input: LispOperationInput): LispBuildResult {
  const category = requiredString(input, "category");
  const symbol = requiredString(input, "symbol");
  const x = requiredNumber(input, "x");
  const y = requiredNumber(input, "y");
  const scale = positive(optionalNumber(input, "scale", 1), "scale");
  const rotation = optionalNumber(input, "rotation", 0);
  const half = 5 * scale;
  const points: Point3[] = [
    [x - half, y - half, 0],
    [x + half, y - half, 0],
    [x + half, y + half, 0],
    [x - half, y + half, 0],
  ];
  return supported(
    program([
      ...pidPreamble("PID-EQUIPMENT", 6),
      ...pidPreamble("PID-ANNOTATION", 7),
      `(setq mcp:e ${polylineExpression(points, true, "PID-EQUIPMENT")})`,
      `(setq mcp:label ${textExpression(
        [x, y, 0],
        `${category}/${symbol}`,
        1.5 * scale,
        rotation,
        "PID-ANNOTATION",
      )})`,
      compoundEntityResult("mcp:e", ["mcp:label"], "symbol"),
      "(princ)",
    ]),
  );
}

function pidProcessLine(input: LispOperationInput): LispBuildResult {
  const p1: Point3 = [requiredNumber(input, "x1"), requiredNumber(input, "y1"), 0];
  const p2: Point3 = [requiredNumber(input, "x2"), requiredNumber(input, "y2"), 0];
  return supported(
    program([
      ...pidPreamble("PID-PROCESS-PIPING", 4),
      `(setq mcp:e ${lineExpression(p1, p2, "PID-PROCESS-PIPING")})`,
      entityResult(),
      "(princ)",
    ]),
  );
}

function pidConnectEquipment(input: LispOperationInput): LispBuildResult {
  const x1 = requiredNumber(input, "x1");
  const y1 = requiredNumber(input, "y1");
  const x2 = requiredNumber(input, "x2");
  const y2 = requiredNumber(input, "y2");
  const middle = (x1 + x2) / 2;
  return supported(
    program([
      ...pidPreamble("PID-PROCESS-PIPING", 4),
      `(setq mcp:e ${polylineExpression(
        [[x1, y1, 0], [middle, y1, 0], [middle, y2, 0], [x2, y2, 0]],
        false,
        "PID-PROCESS-PIPING",
      )})`,
      entityResult(),
      "(princ)",
    ]),
  );
}

function pidFlowArrow(input: LispOperationInput): LispBuildResult {
  const x = requiredNumber(input, "x");
  const y = requiredNumber(input, "y");
  const angle = radians(optionalNumber(input, "rotation", 0));
  const size = positive(optionalNumber(input, "scale", 1), "scale") * 2;
  const points: Point3[] = [
    [x + size * Math.cos(angle), y + size * Math.sin(angle), 0],
    [x + size * 0.5 * Math.cos(angle + 2.4), y + size * 0.5 * Math.sin(angle + 2.4), 0],
    [x + size * 0.5 * Math.cos(angle - 2.4), y + size * 0.5 * Math.sin(angle - 2.4), 0],
  ];
  return supported(
    program([
      ...pidPreamble("PID-ANNOTATION", 7),
      `(setq mcp:e ${polylineExpression(points, true, "PID-ANNOTATION")})`,
      entityResult("mcp:e", "flow_arrow"),
      "(princ)",
    ]),
  );
}

function pidEquipmentTag(input: LispOperationInput): LispBuildResult {
  const x = requiredNumber(input, "x");
  const y = requiredNumber(input, "y");
  const tag = requiredString(input, "tag");
  const description = optionalString(input, "description") || "";
  return supported(
    program([
      ...pidPreamble("PID-ANNOTATION", 7),
      `(setq mcp:e ${textExpression([x, y, 0], tag, 2.5, 0, "PID-ANNOTATION")})`,
      ...(description
        ? [`(setq mcp:description ${textExpression(
          [x, y - 3.5, 0],
          description,
          1.8,
          0,
          "PID-ANNOTATION",
        )})`]
        : []),
      description
        ? compoundEntityResult("mcp:e", ["mcp:description"], "tag")
        : entityResult("mcp:e", "tag"),
      "(princ)",
    ]),
  );
}

function pidLineNumber(input: LispOperationInput): LispBuildResult {
  const x = requiredNumber(input, "x");
  const y = requiredNumber(input, "y");
  const label = `${requiredString(input, "line_num")}-${requiredString(input, "spec")}`;
  return supported(
    program([
      ...pidPreamble("PID-ANNOTATION", 7),
      `(setq mcp:e ${textExpression([x, y, 0], label, 2, 0, "PID-ANNOTATION")})`,
      entityResult("mcp:e", "line_number"),
      "(princ)",
    ]),
  );
}

function attributesLabel(input: LispOperationInput): string {
  return Object.entries(attributesArgument(input))
    .map(([tag, value]) => `${tag}=${value}`)
    .join("; ");
}

function pidValve(input: LispOperationInput): LispBuildResult {
  const x = requiredNumber(input, "x");
  const y = requiredNumber(input, "y");
  const valve = requiredString(input, "valve_type");
  const rotation = radians(optionalNumber(input, "rotation", 0));
  const size = 3;
  const baseAngles = [Math.PI, Math.PI / 2, 0, -Math.PI / 2];
  const points: Point3[] = baseAngles.map((angle) => [
    x + size * Math.cos(angle + rotation),
    y + size * Math.sin(angle + rotation),
    0,
  ]);
  const attributeText = attributesLabel(input);
  return supported(
    program([
      ...pidPreamble("PID-VALVES", 2),
      ...pidPreamble("PID-ANNOTATION", 7),
      `(setq mcp:e ${polylineExpression(points, true, "PID-VALVES")})`,
      `(setq mcp:label ${textExpression(
        [x, y - size - 2, 0],
        attributeText ? `${valve}; ${attributeText}` : valve,
        1.5,
        0,
        "PID-ANNOTATION",
      )})`,
      compoundEntityResult("mcp:e", ["mcp:label"], "valve"),
      "(princ)",
    ]),
  );
}

function pidInstrument(input: LispOperationInput): LispBuildResult {
  const x = requiredNumber(input, "x");
  const y = requiredNumber(input, "y");
  const instrument = requiredString(input, "instrument_type");
  const tag = optionalString(input, "tag_id") || instrument;
  const range = optionalString(input, "range_value") || "";
  return supported(
    program([
      ...pidPreamble("PID-INSTRUMENTS", 5),
      ...pidPreamble("PID-ANNOTATION", 7),
      `(setq mcp:e ${circleExpression([x, y, 0], 4, "PID-INSTRUMENTS")})`,
      `(setq mcp:cross ${lineExpression([x - 4, y, 0], [x + 4, y, 0], "PID-INSTRUMENTS")})`,
      `(setq mcp:label ${textExpression(
        [x, y - 6, 0],
        range ? `${tag} ${range}` : tag,
        1.5,
        0,
        "PID-ANNOTATION",
      )})`,
      compoundEntityResult("mcp:e", ["mcp:cross", "mcp:label"], "instrument"),
      "(princ)",
    ]),
  );
}

function pidPump(input: LispOperationInput): LispBuildResult {
  const x = requiredNumber(input, "x");
  const y = requiredNumber(input, "y");
  const pump = requiredString(input, "pump_type");
  const angle = radians(optionalNumber(input, "rotation", 0));
  const attributes = attributesLabel(input);
  const triangle: Point3[] = [
    [x + 6 * Math.cos(angle + 0.5), y + 6 * Math.sin(angle + 0.5), 0],
    [x + 8 * Math.cos(angle), y + 8 * Math.sin(angle), 0],
    [x + 6 * Math.cos(angle - 0.5), y + 6 * Math.sin(angle - 0.5), 0],
  ];
  return supported(
    program([
      ...pidPreamble("PID-EQUIPMENT", 6),
      ...pidPreamble("PID-ANNOTATION", 7),
      `(setq mcp:e ${circleExpression([x, y, 0], 6, "PID-EQUIPMENT")})`,
      `(setq mcp:impeller ${polylineExpression(triangle, true, "PID-EQUIPMENT")})`,
      `(setq mcp:label ${textExpression(
        [x, y - 8, 0],
        attributes ? `${pump}; ${attributes}` : pump,
        1.5,
        0,
        "PID-ANNOTATION",
      )})`,
      compoundEntityResult("mcp:e", ["mcp:impeller", "mcp:label"], "pump"),
      "(princ)",
    ]),
  );
}

function pidTank(input: LispOperationInput): LispBuildResult {
  const x = requiredNumber(input, "x");
  const y = requiredNumber(input, "y");
  const tank = requiredString(input, "tank_type");
  const scale = positive(optionalNumber(input, "scale", 1), "scale");
  const attributes = attributesLabel(input);
  const width = 10 * scale;
  const height = 15 * scale;
  return supported(
    program([
      ...pidPreamble("PID-EQUIPMENT", 6),
      ...pidPreamble("PID-ANNOTATION", 7),
      `(setq mcp:e ${polylineExpression(
        [[x - width, y, 0], [x + width, y, 0], [x + width, y + height, 0], [x - width, y + height, 0]],
        true,
        "PID-EQUIPMENT",
      )})`,
      `(setq mcp:label ${textExpression(
        [x, y + height + 2, 0],
        attributes ? `${tank}; ${attributes}` : tank,
        2 * scale,
        0,
        "PID-ANNOTATION",
      )})`,
      compoundEntityResult("mcp:e", ["mcp:label"], "tank"),
      "(princ)",
    ]),
  );
}

export function buildPidLisp(input: LispOperationInput): LispBuildResult {
  return safely(() => {
    switch (input.operation) {
      case "setup_layers": return pidSetupLayers();
      case "list_symbols": return pidListSymbols(input);
      case "insert_symbol": return pidInsertSymbol(input);
      case "draw_process_line": return pidProcessLine(input);
      case "connect_equipment": return pidConnectEquipment(input);
      case "add_flow_arrow": return pidFlowArrow(input);
      case "add_equipment_tag": return pidEquipmentTag(input);
      case "add_line_number": return pidLineNumber(input);
      case "insert_valve": return pidValve(input);
      case "insert_instrument": return pidInstrument(input);
      case "insert_pump": return pidPump(input);
      case "insert_tank": return pidTank(input);
      default:
        return unsupported(`Unknown pid operation: ${input.operation}`);
    }
  });
}

export function buildViewLisp(input: LispOperationInput): LispBuildResult {
  return safely(() => {
    switch (input.operation) {
      case "zoom_extents":
        return supported(program([
          '(command-s "_.ZOOM" "_E")',
          resultOk("Zoom extents complete"),
          "(princ)",
        ]));
      case "zoom_window": {
        const p1: Point3 = [requiredNumber(input, "x1"), requiredNumber(input, "y1"), 0];
        const p2: Point3 = [requiredNumber(input, "x2"), requiredNumber(input, "y2"), 0];
        if (p1[0] === p2[0] || p1[1] === p2[1]) {
          return invalid("zoom window", "must have non-zero width and height");
        }
        return supported(program([
          `(command-s "_.ZOOM" "_W" ${lispPoint(p1)} ${lispPoint(p2)})`,
          resultOk("Zoom window complete"),
          "(princ)",
        ]));
      }
      case "get_screenshot":
        return unsupported(
          "Screenshot capture is a GUI/backend capability, not a safe AutoLISP operation.",
          "backend_required",
        );
      default:
        return unsupported(`Unknown view operation: ${input.operation}`);
    }
  });
}

function drawingInfo(): LispBuildResult {
  return supported(
    program([
      '(setq mcp:ss (ssget "_X") mcp:layers 0 mcp:blocks 0)',
      '(setq mcp:l (tblnext "LAYER" T))',
      '(while mcp:l (setq mcp:layers (1+ mcp:layers) mcp:l (tblnext "LAYER")))',
      '(setq mcp:b (tblnext "BLOCK" T))',
      '(while mcp:b (setq mcp:blocks (1+ mcp:blocks) mcp:b (tblnext "BLOCK")))',
      resultExpression(
        "ok",
        '(strcat "name=" (getvar "DWGNAME") "\\npath=" (getvar "DWGPREFIX")' +
          ' "\\nentities=" (itoa (if mcp:ss (sslength mcp:ss) 0))' +
          ' "\\nlayers=" (itoa mcp:layers) "\\nblocks=" (itoa mcp:blocks)' +
          ' "\\nextmin=" (vl-princ-to-string (getvar "EXTMIN"))' +
          ' "\\nextmax=" (vl-princ-to-string (getvar "EXTMAX")))',
      ),
      "(princ)",
    ]),
  );
}

function drawingSave(input: LispOperationInput): LispBuildResult {
  const path = optionalString(input, "path");
  if (!path) {
    return supported(program([
      '(command-s "_.QSAVE")',
      resultOk("Drawing saved"),
      "(princ)",
    ]));
  }
  return supported(program([
    `(if (findfile ${lispString(path)})`,
    `  (command-s "_.SAVEAS" "2018" ${lispString(path)} "_Y")`,
    `  (command-s "_.SAVEAS" "2018" ${lispString(path)}))`,
    resultOk(`Drawing saved to ${path}`),
    "(princ)",
  ]));
}

function drawingDxf(input: LispOperationInput): LispBuildResult {
  const path = requiredString(input, "path");
  return supported(program([
    `(if (findfile ${lispString(path)})`,
    `  (command-s "_.DXFOUT" ${lispString(path)} "_Y" "_V" "2018" "16")`,
    `  (command-s "_.DXFOUT" ${lispString(path)} "_V" "2018" "16"))`,
    resultOk(`DXF written to ${path}`),
    "(princ)",
  ]));
}

function drawingVariables(input: LispOperationInput): LispBuildResult {
  const raw = argument(input, "names");
  let names: string[];
  if (raw === undefined || raw === null) names = DEFAULT_VARIABLES;
  else {
    if (!Array.isArray(raw) || raw.length === 0 || raw.length > 64) {
      return invalid("names", "must be an array containing 1..64 variable names");
    }
    names = raw.map((name, index) => {
      if (typeof name !== "string" || !/^[A-Za-z][A-Za-z0-9_]{0,31}$/.test(name)) {
        return invalid(`names[${index}]`, "must be an AutoCAD variable identifier");
      }
      return name.toUpperCase();
    });
  }
  const list = `(list ${names.map(lispString).join(" ")})`;
  return supported(
    program([
      `(setq mcp:names ${list} mcp:out "name\\tvalue")`,
      "(foreach mcp:name mcp:names",
      "  (setq mcp:value (vl-catch-all-apply 'getvar (list mcp:name)))",
      "  (setq mcp:out (strcat mcp:out \"\\n\" mcp:name \"\\t\"",
      '    (if (vl-catch-all-error-p mcp:value) "<unavailable>" (vl-princ-to-string mcp:value)))))',
      resultExpression("ok", "mcp:out"),
      "(princ)",
    ]),
    "tsv",
  );
}

export function buildDrawingLisp(input: LispOperationInput): LispBuildResult {
  return safely(() => {
    switch (input.operation) {
      case "info": return drawingInfo();
      case "save": return drawingSave(input);
      case "save_as_dxf": return drawingDxf(input);
      case "purge":
        return supported(program([
          '(command-s "_.-PURGE" "_All" "*" "_N")',
          resultOk("Purge complete"),
          "(princ)",
        ]));
      case "get_variables": return drawingVariables(input);
      case "undo":
        return supported(program([
          '(command-s "_.UNDO" "1")',
          resultOk("Undo complete"),
          "(princ)",
        ]));
      case "redo":
        return supported(program([
          '(command-s "_.REDO")',
          resultOk("Redo complete"),
          "(princ)",
        ]));
      case "plot_pdf":
        return unsupported(
          "PDF export is not available through deterministic AutoLISP on AutoCAD for macOS.",
          "backend_required",
        );
      case "create":
      case "open":
        return unsupported(
          `${input.operation} changes the active document and must be handled by the backend target/session layer.`,
          "backend_required",
        );
      default:
        return unsupported(`Unknown drawing operation: ${input.operation}`);
    }
  });
}

/**
 * Canonical entry point consumed by the MCP backend.
 *
 * Arbitrary system.execute_lisp is intentionally not routed through this safe
 * builder: callers must use an explicitly reviewed/raw execution capability.
 */
export function buildLispOperation(
  tool: string,
  input: LispOperationInput,
): LispBuildResult {
  if (!input || typeof input !== "object" || typeof input.operation !== "string" || !input.operation) {
    return unsupported("operation must be a non-empty string", "invalid_input");
  }
  switch (tool) {
    case "entity": return buildEntityLisp(input);
    case "layer": return buildLayerLisp(input);
    case "block": return buildBlockLisp(input);
    case "annotation": return buildAnnotationLisp(input);
    case "pid": return buildPidLisp(input);
    case "view": return buildViewLisp(input);
    case "drawing": return buildDrawingLisp(input);
    case "system":
      return unsupported(
        "System lifecycle and arbitrary LISP execution are backend responsibilities.",
        "backend_required",
      );
    default:
      return unsupported(`Unknown MCP tool: ${tool}`, "unsupported_tool");
  }
}

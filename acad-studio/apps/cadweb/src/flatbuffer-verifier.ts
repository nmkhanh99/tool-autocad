import { CadWebError } from "./errors";

const MAX_VERIFY_ITEMS = 5_000_000;
const utf8 = new TextDecoder("utf-8", { fatal: true });

type TableName = "GeometryBuffer" | "Entity" | "BlockDefinition" | "Attribute";

type FieldSpec =
  | { type: "scalar"; size: 1 | 4 | 8; alignment: 1 | 4 | 8; boolean?: true; required?: true }
  | { type: "string"; required?: true }
  | { type: "struct"; size: 24 | 128; alignment: 8; required?: true }
  | { type: "vector-scalar"; elementSize: 8; elementAlignment: 8; required?: true }
  | { type: "vector-struct"; elementSize: 24; elementAlignment: 8; required?: true }
  | { type: "vector-table"; table: TableName; required?: true };

interface TableSpec {
  fields: readonly FieldSpec[];
}

const scalar = (
  size: 1 | 4 | 8,
  alignment: 1 | 4 | 8,
  boolean = false,
): FieldSpec => ({ type: "scalar", size, alignment, ...(boolean ? { boolean: true } : {}) });
const string = (required = false): FieldSpec => ({
  type: "string",
  ...(required ? { required: true } : {}),
});
const struct = (size: 24 | 128): FieldSpec => ({ type: "struct", size, alignment: 8 });
const scalarVector: FieldSpec = {
  type: "vector-scalar",
  elementSize: 8,
  elementAlignment: 8,
};
const vec3Vector: FieldSpec = {
  type: "vector-struct",
  elementSize: 24,
  elementAlignment: 8,
};
const tableVector = (table: TableName): FieldSpec => ({ type: "vector-table", table });

function inlineSize(field: FieldSpec): number {
  if (field.type === "scalar" || field.type === "struct") return field.size;
  return 4;
}

function inlineAlignment(field: FieldSpec): number {
  if (field.type === "scalar" || field.type === "struct") return field.alignment;
  return 4;
}

const geometryFields: readonly FieldSpec[] = [
  scalar(4, 4),
  scalar(1, 1),
  tableVector("Entity"),
  tableVector("BlockDefinition"),
];

const attributeFields: readonly FieldSpec[] = [
  string(true),
  string(true),
  string(),
  struct(24),
  scalar(8, 8),
  scalar(8, 8),
];

const entityFields: readonly FieldSpec[] = [
  string(true),
  string(),
  scalar(1, 1),
  string(true),
  scalar(1, 1),
  scalar(1, 1, true),
  scalar(4, 4),
  scalar(1, 1),
  scalar(4, 4),
  string(),
  scalar(4, 4),
  vec3Vector,
  scalarVector,
  scalarVector,
  scalarVector,
  scalar(8, 8),
  scalar(1, 1, true),
  struct(24),
  scalar(8, 8),
  scalar(8, 8),
  scalar(8, 8),
  struct(24),
  string(),
  struct(24),
  scalar(8, 8),
  scalar(8, 8),
  string(),
  struct(128),
  tableVector("Attribute"),
  scalar(1, 1),
  scalar(1, 1),
  scalar(1, 1),
  scalar(1, 1),
];

const blockFields: readonly FieldSpec[] = [
  string(true),
  string(),
  string(true),
  struct(24),
  tableVector("Entity"),
];

const tableSpecs: Readonly<Record<TableName, TableSpec>> = {
  GeometryBuffer: { fields: geometryFields },
  Entity: { fields: entityFields },
  BlockDefinition: { fields: blockFields },
  Attribute: { fields: attributeFields },
};

interface ClaimedRange {
  start: number;
  end: number;
  kind: string;
}

class StructuralVerifier {
  private readonly view: DataView;
  private readonly verifiedTables = new Set<string>();
  private readonly verifiedObjects = new Set<string>();
  private readonly ranges: ClaimedRange[] = [];
  private remaining: number;

  constructor(private readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.remaining = Math.min(MAX_VERIFY_ITEMS, Math.max(10_000, bytes.byteLength * 4));
  }

  verify(): void {
    this.ensureRange(0, 8, "buffer header");
    if (
      this.bytes[4] !== 0x43 ||
      this.bytes[5] !== 0x57 ||
      this.bytes[6] !== 0x45 ||
      this.bytes[7] !== 0x42
    ) {
      this.fail("file identifier must be CWEB");
    }
    const root = this.view.getUint32(0, true);
    if (root < 8) this.fail("root table uoffset points into the buffer header");
    this.verifyTable(root, "GeometryBuffer", "root");
    this.verifyNonOverlappingRanges();
  }

  private fail(message: string): never {
    throw new CadWebError("GEOMETRY_INVALID", `invalid FlatBuffers structure: ${message}`);
  }

  private take(count: number, label: string): void {
    if (!Number.isSafeInteger(count) || count < 0 || count > this.remaining) {
      this.fail(`${label} exceeds the verification item limit`);
    }
    this.remaining -= count;
  }

  private ensureRange(offset: number, length: number, label: string): void {
    if (
      !Number.isSafeInteger(offset) ||
      !Number.isSafeInteger(length) ||
      offset < 0 ||
      length < 0 ||
      offset > this.bytes.byteLength ||
      length > this.bytes.byteLength - offset
    ) {
      this.fail(`${label} is outside the buffer`);
    }
  }

  private ensureAligned(offset: number, alignment: number, label: string): void {
    if (offset % alignment !== 0) this.fail(`${label} is not ${alignment}-byte aligned`);
  }

  private claimRange(start: number, end: number, kind: string): void {
    this.ensureRange(start, end - start, kind);
    this.ranges.push({ start, end, kind });
  }

  private verifyNonOverlappingRanges(): void {
    this.ranges.sort((left, right) => left.start - right.start || left.end - right.end);
    let previous: ClaimedRange | undefined;
    for (const range of this.ranges) {
      if (
        previous &&
        range.start === previous.start &&
        range.end === previous.end &&
        range.kind === previous.kind
      ) {
        continue;
      }
      if (previous && range.start < previous.end) {
        this.fail(`${range.kind} overlaps ${previous.kind}`);
      }
      previous = range;
    }
  }

  private verifyTable(offset: number, name: TableName, label: string): void {
    const key = `${name}:${offset}`;
    if (this.verifiedTables.has(key)) return;
    this.take(1, label);
    this.ensureAligned(offset, 4, `${label} table`);
    this.ensureRange(offset, 4, `${label} table header`);
    const vtableDistance = this.view.getInt32(offset, true);
    if (vtableDistance === 0) this.fail(`${label} has a zero vtable offset`);
    const vtable = offset - vtableDistance;
    this.ensureAligned(vtable, 2, `${label} vtable`);
    this.ensureRange(vtable, 4, `${label} vtable header`);
    const vtableSize = this.view.getUint16(vtable, true);
    const objectSize = this.view.getUint16(vtable + 2, true);
    const spec = tableSpecs[name];
    if (
      vtableSize < 4 ||
      vtableSize % 2 !== 0
    ) {
      this.fail(`${label} has an invalid vtable size`);
    }
    if (objectSize < 4 || objectSize % 4 !== 0) {
      this.fail(`${label} has an invalid table object size`);
    }
    this.ensureRange(vtable, vtableSize, `${label} vtable`);
    this.ensureRange(offset, objectSize, `${label} table`);
    this.claimRange(vtable, vtable + vtableSize, `vtable@${vtable}`);
    this.claimRange(offset, offset + objectSize, `${name} table@${offset}`);
    this.verifiedTables.add(key);

    const occupied: Array<{ start: number; end: number; index: number }> = [];
    for (let index = 0; index < spec.fields.length; index += 1) {
      const field = spec.fields[index]!;
      const vtableEntry = 4 + index * 2;
      const relative = vtableEntry < vtableSize
        ? this.view.getUint16(vtable + vtableEntry, true)
        : 0;
      if (relative === 0) {
        if (field.required) this.fail(`${label} is missing required field ${index}`);
        continue;
      }
      const size = inlineSize(field);
      if (relative < 4 || relative > objectSize - size) {
        this.fail(`${label} field ${index} is outside its table object`);
      }
      const position = offset + relative;
      this.ensureAligned(position, inlineAlignment(field), `${label} field ${index}`);
      for (const prior of occupied) {
        if (position < prior.end && prior.start < position + size) {
          this.fail(`${label} fields ${prior.index} and ${index} overlap`);
        }
      }
      occupied.push({ start: position, end: position + size, index });
      this.verifyField(field, position, offset + objectSize, `${label}.field[${index}]`);
    }
    const encodedFieldCount = (vtableSize - 4) / 2;
    this.take(Math.max(0, encodedFieldCount - spec.fields.length), `${label} unknown fields`);
    for (let index = spec.fields.length; index < encodedFieldCount; index += 1) {
      const relative = this.view.getUint16(vtable + 4 + index * 2, true);
      if (relative === 0) continue;
      if (relative < 4 || relative >= objectSize) {
        this.fail(`${label} unknown field ${index} is outside its table object`);
      }
      const position = offset + relative;
      for (const prior of occupied) {
        if (position >= prior.start && position < prior.end) {
          this.fail(`${label} unknown field ${index} overlaps field ${prior.index}`);
        }
      }
      occupied.push({ start: position, end: position + 1, index });
    }
  }

  private verifyField(field: FieldSpec, position: number, objectEnd: number, label: string): void {
    if (field.type === "scalar") {
      if (field.boolean && this.view.getUint8(position) > 1) this.fail(`${label} is not a boolean`);
      return;
    }
    if (field.type === "struct") return;

    const target = this.readUOffset(position, objectEnd, label);
    if (field.type === "string") {
      this.verifyString(target, label);
    } else if (field.type === "vector-scalar") {
      this.verifyInlineVector(target, field.elementSize, field.elementAlignment, label);
    } else if (field.type === "vector-struct") {
      this.verifyInlineVector(target, field.elementSize, field.elementAlignment, label);
    } else {
      this.verifyTableVector(target, field.table, label);
    }
  }

  private readUOffset(position: number, minimumTarget: number, label: string): number {
    this.ensureRange(position, 4, `${label} uoffset`);
    const relative = this.view.getUint32(position, true);
    if (relative === 0) this.fail(`${label} has a zero uoffset`);
    const target = position + relative;
    if (!Number.isSafeInteger(target) || target < minimumTarget) {
      this.fail(`${label} uoffset points into its parent object`);
    }
    this.ensureRange(target, 4, `${label} target`);
    this.ensureAligned(target, 4, `${label} target`);
    return target;
  }

  private verifyString(offset: number, label: string): void {
    const key = `string:${offset}`;
    if (this.verifiedObjects.has(key)) return;
    this.take(1, label);
    const length = this.view.getUint32(offset, true);
    if (length > this.bytes.byteLength - offset - 5) this.fail(`${label} string is truncated`);
    const end = offset + 4 + length;
    if (this.bytes[end] !== 0) this.fail(`${label} string is missing its null terminator`);
    this.claimRange(offset, end + 1, `string@${offset}`);
    try {
      utf8.decode(this.bytes.subarray(offset + 4, end));
    } catch {
      this.fail(`${label} string is not valid UTF-8`);
    }
    this.verifiedObjects.add(key);
  }

  private verifyInlineVector(
    offset: number,
    elementSize: number,
    elementAlignment: number,
    label: string,
  ): void {
    const kind = `vector:${elementSize}:${elementAlignment}`;
    const key = `${kind}:${offset}`;
    if (this.verifiedObjects.has(key)) return;
    const count = this.view.getUint32(offset, true);
    this.take(count, label);
    const data = offset + 4;
    if (count > 0) this.ensureAligned(data, elementAlignment, `${label} vector data`);
    if (count > Math.floor((this.bytes.byteLength - data) / elementSize)) {
      this.fail(`${label} vector is truncated`);
    }
    const end = data + count * elementSize;
    this.claimRange(offset, end, `${kind}@${offset}`);
    this.verifiedObjects.add(key);
  }

  private verifyTableVector(offset: number, table: TableName, label: string): void {
    const key = `vector-table:${table}:${offset}`;
    if (this.verifiedObjects.has(key)) return;
    const count = this.view.getUint32(offset, true);
    this.take(count, label);
    const data = offset + 4;
    this.ensureAligned(data, 4, `${label} vector data`);
    if (count > Math.floor((this.bytes.byteLength - data) / 4)) {
      this.fail(`${label} vector is truncated`);
    }
    const end = data + count * 4;
    this.claimRange(offset, end, `vector-table:${table}@${offset}`);
    this.verifiedObjects.add(key);
    for (let index = 0; index < count; index += 1) {
      const position = data + index * 4;
      const target = this.readUOffset(position, end, `${label}[${index}]`);
      this.verifyTable(target, table, `${label}[${index}]`);
    }
  }
}

export function verifyGeometryBufferStructure(bytes: Uint8Array): void {
  new StructuralVerifier(bytes).verify();
}

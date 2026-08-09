# ADR 0001: CadWeb version 1 contract

- Status: accepted for implementation
- Date: 2026-08-09
- Contract version: 1.0

## Decision

CadWeb version 1 is a ZIP archive with a manifest, layer catalog, FlatBuffers
geometry, and an export report. The required entries are:

```text
manifest.json
layers.json
entities.bin
export-report.json
```

`blocks.bin` is required when the drawing contains a block definition or block
reference. `properties.json`, `preview.png`, and redistributable files below
`fonts/` are optional. Every payload referenced by the manifest records its
uncompressed byte size and lowercase SHA-256 digest. The manifest does not hash
itself.

Version 1 makes these semantic choices:

- Coordinates are stored in WCS with Z as the up axis. Geometry is serialized
  as IEEE-754 doubles. A viewer rebases coordinates around the manifest origin
  before converting them to GPU floats.
- `INSUNITS` is recorded as a name and a conversion to metres. Unitless
  drawings use the name `unitless` and a null conversion rather than guessing
  a physical scale.
- Model and paper/layout space are explicit on each top-level entity. Phase 1
  exports model space; omitted spaces are reported, never silently discarded.
- Block definitions and references stay separate. A reference stores its full
  4x4 WCS transform in row-major order, matching `AcGeMatrix3d(row, column)`;
  points are treated as homogeneous column vectors. Readers must detect
  dangling references and cycles, and must not recursively expand an unbounded
  graph.
- An entity stable ID combines the drawing fingerprint and source handle.
  Handles remain available for traceability but are not treated as globally
  unique.
- Analytic parameters are retained for lines, polylines, arcs, circles, text,
  and block references. Tessellation is a viewer concern for version 1.
- External references use `reference-only` policy by default. Absolute source
  paths are not written to the archive.
- Writers sort layers, block definitions, and entities by stable ID so semantic
  comparisons do not depend on AutoCAD traversal order.
- Unsupported and failed entities are listed in `export-report.json` with type,
  handle, optional extents, and a reason.
- Phase 1 preserves block-attribute tag/value metadata. Because version 1 has
  no per-attribute visibility or rich-MText fields, those display semantics are
  flattened and explicitly reported as warnings rather than silently dropping
  hidden values.

## Archive security profile

A conforming reader validates the central directory before extracting payloads.
It rejects encrypted or symbolic-link entries, duplicate normalized paths,
absolute paths, backslashes, NUL bytes, `.`/`..` segments, and entries not
declared by the manifest. Default desktop limits are 128 entries, 256 MiB for
the archive, 128 MiB per entry, 256 MiB total uncompressed data, and a 100:1
compression ratio. The manifest is capped at 1 MiB and each JSON payload at
16 MiB. Callers may lower those limits but must not silently raise them for
untrusted input.

The reader validates payload size and checksum before decoding JSON or
FlatBuffers. It rejects a major version other than 1 and ignores unknown
optional fields for version 1.

## Selected export

A selected export includes selected top-level entities and every block
definition transitively referenced by those entities. Attributes remain owned
by their block reference. Subentity paths are outside version 1 and are
reported as unsupported if supplied.

## Consequences

The native Windows and macOS modules can share DTO and writer code, while each
still requires its own ObjectARX build and runtime test. The web viewer can parse
the same archive without checking `producer.platform`. Future support for
hatches, dimensions, splines, viewports, embedded Xrefs, and rich MText requires
minor-version additions or a new major version when compatibility cannot be
preserved.

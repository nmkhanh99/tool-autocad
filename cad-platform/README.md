# CadWeb platform

This directory contains the operating-system-neutral CadWeb contract and C++
core. AutoCAD adapters may depend on this directory; code in this directory
must not include ObjectARX, Win32, or Cocoa types.

The version-1 decisions are recorded in
[`docs/0001-cadweb-v1-contract.md`](docs/0001-cadweb-v1-contract.md). The
machine-readable contract lives in `schema/`.

The proposed Save-triggered revision/delta extension and its executable rollout
plan are documented separately:

- [`docs/0002-cadweb-revision-delta-contract.md`](docs/0002-cadweb-revision-delta-contract.md)
- [`docs/cadweb-sync-implementation-plan.md`](docs/cadweb-sync-implementation-plan.md)

These documents define the SaveSync contract and rollout status; host-runtime
and production release gates remain tracked in the implementation plan.

Implemented phase-1 slices:

- `core/`: portable C++17 DTO, FlatBuffers/JSON serialization, SHA-256 and
  deterministic ZIP-store writer.
- `objectarx/common/`: shared AutoCAD database adapter for line, lightweight
  polyline, arc, circle, Text/MText, block reference/attribute and layers.
- `objectarx/macos/`: dedicated AutoCAD 2027 universal export and SaveSync bundle.
- `objectarx/windows/`: AutoCAD 2027 x64 Visual Studio build target.
- `objectarx/package/`: staged two-OS autoloader package target.
- `../acad-studio/apps/cadweb/`: TypeScript contract reader and security tests.
- `../acad-studio/apps/web/app/CadWebViewerPanel.tsx`: Web Worker/WebGL2 viewer.

Run the platform-neutral gates from the repository root:

```sh
python3 -m unittest cad-platform/tests/test_package_commands.py -v
make -C cad-platform/tests/native test
pnpm --dir acad-studio --filter @acad/cadweb test
pnpm --dir acad-studio --filter @acad/cadweb test:native-cross-read ../../../cad-platform/tests/native/build/native-sample.cadweb
pnpm --dir acad-studio --filter @acad/web test:cadweb-viewer
pnpm --dir acad-studio --filter @acad/web build
```

Build the dedicated macOS exporter without installing it:

```sh
(cd cad-platform/objectarx/macos && ./build.sh --build-only)
```

The Windows project and nested multi-OS package remain release gates until
they are built and loaded in AutoCAD 2027 on their respective platforms.

## Compatibility policy

- Readers reject an unsupported `formatVersion.major`.
- Readers accept unknown optional fields within a supported major version.
- Writers emit deterministic payload ordering and lowercase SHA-256 digests.
- JSON is UTF-8. Geometry uses FlatBuffers doubles and little-endian byte
  order.
- `.cadweb` is a ZIP container transported as `application/zip`.

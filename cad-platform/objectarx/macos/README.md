# macOS ObjectARX build

This target builds a dedicated `CadWebExporter.bundle` with explicit export
commands and the CadWeb SaveSync reactor. It links the macOS entry point, the
shared CadWeb commands, AcDb adapter and SaveSync implementation, and the
portable C++ core. It does not link or load the unrelated `AcadBridge` file
watcher, drawing mutators, or MEP commands.

Prerequisites:

1. AutoCAD 2027 for Mac at its standard application path.
2. ObjectARX 2027 headers at `/Library/Developer/Autodesk/ObjectARX 2027`.
3. Xcode command-line tools with `clang++`, `lipo`, and `codesign`.

Build without installing:

```bash
./build.sh --build-only
```

Override non-standard installations with `AUTOCAD_APP` and
`OBJECTARX_SDK_ROOT`. The output is the universal, ad-hoc-signed
`build/CadWebExporter.bundle`; the script verifies both `x86_64` and `arm64`
slices and the exported `_acrxEntryPoint` symbol.

`./build.sh --install` replaces only
`~/Library/Application Support/Autodesk/ApplicationPlugins/CadWebExporter.bundle`.
It never modifies `Acad-Bridge.bundle`, so both plug-ins can be installed. The
CadWeb commands use their own `CADWEB_EXPORTER` command group.

Before release, load the bundle in AutoCAD 2027 for Mac and exercise
`CADWEBEXPORT`, `CADWEBEXPORTSELECTED`, `CADWEBSETTINGS`, `CADWEBSYNCSTATUS`, and
the automatic SaveSync path against representative drawings. Ad-hoc signing is
suitable for local development, not a substitute for the distribution
signing/notarization policy.

For a non-mutating command-registration smoke test, build first, choose fresh
absolute paths for the marker and temporary sync root, then launch AutoCAD with
the bundle and script directly (no plug-in installation is required):

```bash
LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 \
CADWEB_RUNTIME_SMOKE_RESULT=/absolute/path/to/result.txt \
CADWEB_SYNC_ROOT=/absolute/path/to/temporary-sync-root \
"/Applications/Autodesk/AutoCAD 2027/AutoCAD 2027.app/Contents/MacOS/AutoCAD" \
  -nologo -ld "$PWD/build/CadWebExporter.bundle" \
  -b "$PWD/runtime-smoke.scr"
```

The script writes `status=passed` only after `CADWEBSETTINGS` and
`CADWEBSYNCSTATUS` both return successfully, then exits AutoCAD. It does not save
or mutate the new drawing. Keep a UTF-8 locale when launching the executable
directly; AutoCAD 2027 aborts before plug-in initialization under `LC_ALL=C`.
AutoCAD still updates its normal per-user startup and licensing state, so this is
a host-runtime test rather than a hermetic unit test.

For the mutating Save/Undo gate, use only a copied, named DWG and a fresh absolute
`CADWEB_SYNC_ROOT`. Provision its exact fingerprint at
`bindings/<canonical-fingerprint>.json`, then launch the copied drawing before the
switches and keep `-b` last. `runtime-save-gate.scr` performs the initial raw
`QSAVE`; after its snapshot has been verified and ACKed as revision 1,
`runtime-undo-gate.scr` creates one line, runs raw `U`, and saves again. The second
item must be a snapshot at `baseRevision=1` with the same `resultStateHash` as the
initial snapshot. The scripts deliberately keep `QSAVE`, `U`, and `QUIT` as raw
script commands so Save provenance is not hidden inside `command-s`.

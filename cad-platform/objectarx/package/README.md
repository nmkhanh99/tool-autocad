# Cross-platform autoloader package

`PackageContents.xml` declares separate AutoCAD 2027 components for `Win64`
and `Mac`. The outer `CadWebExporter.bundle` is an autoloader directory; the
nested macOS artifact is itself a loadable code bundle containing a Mach-O
executable.

After both native artifacts have passed their platform tests, stage them with:

```bash
./stage-package.sh \
  --mac ../macos/build/CadWebExporter.bundle \
  --windows ../windows/build/Release/CadWebExporter.arx
```

This script stages files only; it does not install them. Its macOS input is the
dedicated CadWeb export and SaveSync bundle from `../macos`; the unrelated
`Acad-Bridge` bundle is deliberately rejected. The nested, two-OS layout must
still pass an AutoCAD 2027 autoloader smoke test on macOS, and the `.arx` must be
built and exercised on Windows, before this combined package is released.
Staging fails if the output bundle already exists or is created concurrently;
it reserves the exact output directory before copying and never treats an
existing directory as a parent or replaces a previously staged artifact
implicitly. A failed copy removes only the output directory reserved by that
invocation.

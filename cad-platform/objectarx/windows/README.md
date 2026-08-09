# Windows ObjectARX build

This project builds the same CadWeb adapter and portable writer used by the Mac
module. It intentionally contains no second entity-reader implementation.

Prerequisites:

1. Full AutoCAD 2027 for Windows and the matching ObjectARX 2027 Windows SDK.
2. The Visual C++ toolset required by that SDK release.
3. An `OBJECTARX_SDK_ROOT` environment variable pointing at the extracted SDK
directory that contains `inc/` and `lib-x64/`.

The project links both the database/core import libraries and `acad.lib`
because the shared command wrapper uses AcEd/ADS entry points. Its module
definition exports both `acrxEntryPoint` and the ObjectARX API-version symbol.

From a Visual Studio developer prompt:

```powershell
msbuild CadWebExporter.vcxproj /m /p:Configuration=Release /p:Platform=x64
```

The expected artifact is `build/Release/CadWebExporter.arx`. Build and runtime
testing on Windows are mandatory before distribution; the macOS build cannot
prove Windows binary compatibility. If Autodesk changes the versioned library
names for the selected SDK package, update `AdditionalDependencies` from the
actual `lib-x64/` contents rather than linking libraries from another release.

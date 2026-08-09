#!/usr/bin/env bash
set -euo pipefail

INSTALL=0
case "${1:---build-only}" in
  --build-only) ;;
  --install) INSTALL=1 ;;
  *) echo "Usage: $0 [--build-only|--install]"; exit 2 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PLATFORM_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
COMMON_DIR="$PLATFORM_ROOT/objectarx/common"
CORE_DIR="$PLATFORM_ROOT/core"
AUTOCAD_APP_DIR="${AUTOCAD_APP:-/Applications/Autodesk/AutoCAD 2027/AutoCAD 2027.app}"
OBJECTARX_ROOT="${OBJECTARX_SDK_ROOT:-/Library/Developer/Autodesk/ObjectARX 2027}"
FRAMEWORKS_DIR="$AUTOCAD_APP_DIR/Contents/Frameworks"
SDK_INCLUDE_DIR="$OBJECTARX_ROOT/inc"
BUILD_DIR="$SCRIPT_DIR/build"
BUNDLE="$BUILD_DIR/CadWebExporter.bundle"
BINARY="$BUNDLE/Contents/MacOS/CadWebExporter"

SOURCES=(
  "$SCRIPT_DIR/MacEntryPoint.cpp"
  "$COMMON_DIR/CadWebCommands.cpp"
  "$COMMON_DIR/CadWebAcDbAdapter.cpp"
  "$COMMON_DIR/CadWebSaveReactor.cpp"
  "$CORE_DIR/src/CadWebChangeTracker.cpp"
  "$CORE_DIR/src/CadWebOutbox.cpp"
  "$CORE_DIR/src/CadWebDurableStore.cpp"
  "$CORE_DIR/src/CadWebRevisionPlanner.cpp"
  "$CORE_DIR/src/CadDeltaWriter.cpp"
  "$CORE_DIR/src/CadWebWriter.cpp"
  "$CORE_DIR/src/detail/Sha256.cpp"
  "$CORE_DIR/src/detail/ZipStore.cpp"
)

[ -d "$FRAMEWORKS_DIR" ] || { echo "Missing AutoCAD frameworks: $FRAMEWORKS_DIR"; exit 1; }
[ -f "$SDK_INCLUDE_DIR/rxregsvc.h" ] || { echo "Missing ObjectARX SDK headers: $SDK_INCLUDE_DIR"; exit 1; }
for SOURCE in "${SOURCES[@]}"; do
  [ -f "$SOURCE" ] || { echo "Missing source: $SOURCE"; exit 1; }
done

rm -rf "$BUNDLE"
mkdir -p "$BUNDLE/Contents/MacOS"

clang++ -std=c++17 -arch x86_64 -arch arm64 \
  -fvisibility=hidden -fvisibility-inlines-hidden \
  -O2 -mmacosx-version-min=14.0 \
  -D_ADESK_MAC_ -DOSX_SYSTEM -D_NATIVE_WCHAR_T_DEFINED -DUNICODE -DACDB_EXT -DNDEBUG \
  -Wno-extra-tokens -Wno-parentheses -Wno-unused -Wno-comment -Wno-switch-enum \
  -I"$SDK_INCLUDE_DIR" \
  -I"$COMMON_DIR" \
  -I"$CORE_DIR/include" \
  -I"$CORE_DIR/src" \
  -I"$CORE_DIR/generated" \
  -I"$CORE_DIR/third_party/flatbuffers/include" \
  -bundle \
  -L"$FRAMEWORKS_DIR" -lacdb -laccore -lgelib -lAcPal -lacfirst -lwinapi \
  -framework CoreFoundation \
  -Wl,-rpath,"$FRAMEWORKS_DIR" -Wl,-headerpad_max_install_names \
  -o "$BINARY" \
  "${SOURCES[@]}"

cp "$SCRIPT_DIR/Info.plist" "$BUNDLE/Contents/Info.plist"
cp "$SCRIPT_DIR/PackageContents.xml" "$BUNDLE/Contents/PackageContents.xml"
codesign --force --sign - --timestamp=none --deep "$BUNDLE"

plutil -lint "$BUNDLE/Contents/Info.plist"
lipo "$BINARY" -verify_arch x86_64 arm64
nm -gU "$BINARY" | grep -q ' _acrxEntryPoint$' || {
  echo "CadWebExporter does not export _acrxEntryPoint"; exit 1;
}
codesign --verify --deep --strict "$BUNDLE"

if [ "$INSTALL" -eq 1 ]; then
  USER_HOME_DIR="${HOME:?HOME is required for --install}"
  INSTALL_DIR="$USER_HOME_DIR/Library/Application Support/Autodesk/ApplicationPlugins"
  INSTALLED_BUNDLE="$INSTALL_DIR/CadWebExporter.bundle"
  mkdir -p "$INSTALL_DIR"
  rm -rf "$INSTALLED_BUNDLE"
  cp -R "$BUNDLE" "$INSTALLED_BUNDLE"
  codesign --verify --deep --strict "$INSTALLED_BUNDLE"
  echo "Installed: $INSTALLED_BUNDLE"
else
  echo "Build-only: no AutoCAD plug-in directories were changed."
fi

file "$BINARY"
echo "Built: $BUNDLE"

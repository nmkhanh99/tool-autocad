#!/usr/bin/env bash
# build.sh — ObjectARX "AcadBridge" for AutoCAD 2027 Mac (flat .bundle with acrxEntryPoint).
# Layout (required so ApplicationAddins/APPLOAD find the entry point):
#   Acad-Bridge.bundle/
#     Contents/
#       Info.plist          CFBundleExecutable=AcadBridge
#       MacOS/AcadBridge    Mach-O BUNDLE with _acrxEntryPoint
#       PackageContents.xml Autoloader metadata
set -euo pipefail

AC_APP="/Applications/Autodesk/AutoCAD 2027/AutoCAD 2027.app"
FW="$AC_APP/Contents/Frameworks"
SDK_INC="/Library/Developer/Autodesk/ObjectARX 2027/inc"

SRC="mepbridge.cpp"
RAW="mepraw.cpp"
XML="PackageContents.xml"
PKG_NAME="Acad-Bridge"
MOD_NAME="AcadBridge"
BUILD="build"
PKG="$BUILD/$PKG_NAME.bundle"
DEST_PLUGINS="$HOME/Library/Application Support/Autodesk/ApplicationPlugins"
DEST_ADDINS="$HOME/Library/Application Support/Autodesk/ApplicationAddins"

[ -d "$FW" ]      || { echo "!! Missing Frameworks: $FW"; exit 1; }
[ -d "$SDK_INC" ] || { echo "!! Missing ObjectARX SDK: $SDK_INC"; exit 1; }
[ -f "$SRC" ]     || { echo "!! Missing $SRC"; exit 1; }
[ -f "$RAW" ]     || { echo "!! Missing $RAW"; exit 1; }
[ -f "$XML" ]     || { echo "!! Missing $XML"; exit 1; }

rm -rf "$PKG"
mkdir -p "$PKG/Contents/MacOS"

echo "== compile (universal) =="
clang++ -std=c++17 -arch x86_64 -arch arm64 \
  -fvisibility=hidden -fvisibility-inlines-hidden \
  -O2 -mmacosx-version-min=14.0 \
  -D_ADESK_MAC_ -DOSX_SYSTEM -D_NATIVE_WCHAR_T_DEFINED -DUNICODE -DACDB_EXT -DNDEBUG \
  -Wno-extra-tokens -Wno-parentheses -Wno-unused -Wno-comment -Wno-switch-enum \
  -I"$SDK_INC" \
  -bundle \
  -L"$FW" -lacdb -laccore -lgelib -lAcPal -lacfirst -lwinapi \
  -framework CoreServices -framework CoreFoundation \
  -Wl,-rpath,"$FW" -Wl,-headerpad_max_install_names \
  -o "$PKG/Contents/MacOS/$MOD_NAME" "$SRC" "$RAW"

cat > "$PKG/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundlePackageType</key><string>BNDL</string>
  <key>CFBundleExecutable</key><string>$MOD_NAME</string>
  <key>CFBundleIdentifier</key><string>io.smartcorex.$MOD_NAME</string>
  <key>CFBundleName</key><string>$MOD_NAME</string>
  <key>CFBundleShortVersionString</key><string>1.3.0</string>
  <key>CFBundleVersion</key><string>5</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
</dict>
</plist>
PLIST

cp "$XML" "$PKG/Contents/PackageContents.xml"

# Sign the whole package (outer bundle) so Addins/APPLOAD accept it
codesign --force --sign - --timestamp=none --deep "$PKG"

echo "== verify acrxEntryPoint on OUTER package =="
file "$PKG/Contents/MacOS/$MOD_NAME"
nm -gU "$PKG/Contents/MacOS/$MOD_NAME" | grep acrxEntryPoint \
  || { echo "!! FAIL: no _acrxEntryPoint in package binary"; exit 1; }
# Confirm nested wrong layout is gone
if [ -d "$PKG/Contents/MacOS/$MOD_NAME.bundle" ]; then
  echo "!! FAIL: nested .bundle still present (causes missing acrxEntryPoint)"
  exit 1
fi
codesign -dv "$PKG" 2>&1 | head -5 || true

for D in "$DEST_PLUGINS" "$DEST_ADDINS"; do
  mkdir -p "$D"
  rm -rf "$D/$PKG_NAME.bundle"
  # Remove legacy package name so only Acad-Bridge remains active
  rm -rf "$D/MEP-Bridge.bundle"
  cp -R "$PKG" "$D/"
  # Verify installed binary has entry point
  nm -gU "$D/$PKG_NAME.bundle/Contents/MacOS/$MOD_NAME" | grep -q acrxEntryPoint \
    || { echo "!! install verify failed: $D"; exit 1; }
  echo "Da cai: $D/$PKG_NAME.bundle"
done

echo ""
echo "OK. Flat package exports acrxEntryPoint."
echo "APPLOAD path: $DEST_PLUGINS/$PKG_NAME.bundle"
echo "-> Restart AutoCAD 2027. Expect [AcadBridge] on command line."
echo "-> Commands: ACADARX / ACADRAW / ACADDOCS / ACADWATCH (legacy MEP* still work)"

#!/usr/bin/env bash
set -euo pipefail

usage() {
  echo "Usage: $0 --mac /path/CadWebExporter.bundle --windows /path/CadWebExporter.arx [--output /path/CadWebExporter.bundle]"
}

MAC_BUNDLE=""
WINDOWS_ARX=""
OUTPUT="$(cd "$(dirname "$0")" && pwd)/dist/CadWebExporter.bundle"
while [ "$#" -gt 0 ]; do
  case "$1" in
    --mac) MAC_BUNDLE="${2:-}"; shift 2 ;;
    --windows) WINDOWS_ARX="${2:-}"; shift 2 ;;
    --output) OUTPUT="${2:-}"; shift 2 ;;
    *) usage; exit 2 ;;
  esac
done

[ "$(basename "$MAC_BUNDLE")" = "CadWebExporter.bundle" ] || {
  echo "macOS input must be the dedicated CadWebExporter.bundle"; exit 1;
}
[ -f "$MAC_BUNDLE/Contents/MacOS/CadWebExporter" ] || {
  echo "Invalid macOS CadWebExporter code bundle: $MAC_BUNDLE"; exit 1;
}
[ -f "$WINDOWS_ARX" ] || { echo "Missing Windows ARX: $WINDOWS_ARX"; exit 1; }
[ "$(basename "$OUTPUT")" = "CadWebExporter.bundle" ] || {
  echo "Output must end in CadWebExporter.bundle"; exit 1;
}

if [ -e "$OUTPUT" ] || [ -L "$OUTPUT" ]; then
  echo "Output already exists; choose a new --output path: $OUTPUT"
  exit 1
fi

OUTPUT_PARENT="$(dirname "$OUTPUT")"
mkdir -p "$OUTPUT_PARENT"
STAGE_ROOT="$(mktemp -d "$OUTPUT_PARENT/.cadweb-stage.XXXXXX")"
STAGED_BUNDLE="$STAGE_ROOT/CadWebExporter.bundle"
OUTPUT_RESERVED=0
OUTPUT_COMPLETE=0
cleanup() {
  rm -rf "$STAGE_ROOT"
  if [ "$OUTPUT_RESERVED" -eq 1 ] && [ "$OUTPUT_COMPLETE" -eq 0 ]; then
    rm -rf "$OUTPUT"
  fi
}
trap cleanup EXIT

mkdir -p "$STAGED_BUNDLE/Contents/Windows/2027" \
  "$STAGED_BUNDLE/Contents/MacOS/2027"
cp "$(dirname "$0")/PackageContents.xml" "$STAGED_BUNDLE/PackageContents.xml"
cp "$WINDOWS_ARX" \
  "$STAGED_BUNDLE/Contents/Windows/2027/CadWebExporter.arx"
cp -R "$MAC_BUNDLE" \
  "$STAGED_BUNDLE/Contents/MacOS/2027/CadWebExporter.bundle"

# Reserve the exact directory atomically. This second check, unlike a
# check-then-mv sequence, fails if another process creates the destination
# after the friendly precheck above and never treats it as a parent directory.
mkdir "$OUTPUT" || {
  echo "Could not reserve output; it may exist or be inaccessible. Nothing was overwritten: $OUTPUT"
  exit 1
}
OUTPUT_RESERVED=1
cp "$STAGED_BUNDLE/PackageContents.xml" "$OUTPUT/"
cp -R "$STAGED_BUNDLE/Contents" "$OUTPUT/"
OUTPUT_COMPLETE=1

echo "Staged: $OUTPUT"
echo "Required before release: Windows load/export test and macOS nested-autoloader smoke test."

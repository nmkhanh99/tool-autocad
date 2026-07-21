#!/usr/bin/env bash
# Trích "draw recipe" từ một bản vẽ as-built bằng AcCoreConsole.
#
#   ./extract-recipe.sh "/abs/path/ban-ve.dwg" [thư-mục-dump]
#
# Kết quả: <repo>/acad-studio/demo/t1-draw-recipe.json
# (đổi đích bằng biến môi trường ACAD_RECIPE_OUT)
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DWG="${1:?Cần đường dẫn tuyệt đối tới file .dwg}"
export ACAD_DUMP_OUT="${2:-/tmp/acad-dump}"

CORE="${ACAD_CORE_CONSOLE:-/Applications/Autodesk/AutoCAD 2027/AutoCAD 2027.app/Contents/Helpers/AcCoreConsole.app/Contents/MacOS/AcCoreConsole}"
[ -x "$CORE" ] || { echo "Không thấy AcCoreConsole: $CORE" >&2; exit 1; }
[ -f "$DWG" ]  || { echo "Không thấy bản vẽ: $DWG" >&2; exit 1; }

mkdir -p "$ACAD_DUMP_OUT"
SCR="$(mktemp -d)"

for lsp in dump-tables dump-detail dump-dims; do
  echo "▸ $lsp"
  printf '(load "%s/%s.lsp")\n' "$HERE" "$lsp" > "$SCR/$lsp.scr"
  # AcCoreConsole cần đường dẫn tuyệt đối cho cả .scr lẫn (load …)
  "$CORE" /i "$DWG" /s "$SCR/$lsp.scr" 2>&1 | grep -E "DUMP.*-OK|; error:" || true
done
rm -rf "$SCR"

echo "▸ mkrecipe"
python3 "$HERE/mkrecipe.py"

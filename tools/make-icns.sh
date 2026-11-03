#!/bin/bash
# 由 1024 PNG 生成 macOS 的 .icns（macOS 自带 sips / iconutil，无需额外依赖）
#   bash tools/make-icns.sh build/icon-1024.png
set -e
SRC="${1:-build/icon-1024.png}"
OUT="${2:-build/icon.icns}"
TMP="$(mktemp -d)"
DIR="$TMP/icon.iconset"
mkdir -p "$DIR"
for s in 16 32 64 128 256 512; do
  sips -z $s $s "$SRC" --out "$DIR/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) "$SRC" --out "$DIR/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$DIR" -o "$OUT"
rm -rf "$TMP"
echo "写出 $OUT"

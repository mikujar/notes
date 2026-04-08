#!/usr/bin/env bash
# 从 public/favicon.svg 生成 Capacitor/Android/iOS 应用图标（macOS：qlmanage + sips）。
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC_SVG="$ROOT/public/favicon.svg"
TMP="$ROOT/scripts/.tmp-favicon-raster.png"
RES="$ROOT/android/app/src/main/res"
IOS_ICON="$ROOT/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png"

if [[ ! -f "$SRC_SVG" ]]; then
  echo "missing $SRC_SVG" >&2
  exit 1
fi

mkdir -p "$(dirname "$TMP")"
qlmanage -t -s 1024 -o "$(dirname "$TMP")" "$SRC_SVG" >/dev/null
mv "$(dirname "$TMP")/favicon.svg.png" "$TMP"

# Adaptive foreground
sips -z 108 108 "$TMP" --out "$RES/mipmap-mdpi/ic_launcher_foreground.png"
sips -z 162 162 "$TMP" --out "$RES/mipmap-hdpi/ic_launcher_foreground.png"
sips -z 216 216 "$TMP" --out "$RES/mipmap-xhdpi/ic_launcher_foreground.png"
sips -z 324 324 "$TMP" --out "$RES/mipmap-xxhdpi/ic_launcher_foreground.png"
sips -z 432 432 "$TMP" --out "$RES/mipmap-xxxhdpi/ic_launcher_foreground.png"

for spec in mdpi:48 hdpi:72 xhdpi:96 xxhdpi:144 xxxhdpi:192; do
  dpi="${spec%%:*}"
  w="${spec##*:}"
  sips -z "$w" "$w" "$TMP" --out "$RES/mipmap-$dpi/ic_launcher.png"
  sips -z "$w" "$w" "$TMP" --out "$RES/mipmap-$dpi/ic_launcher_round.png"
done

cp "$TMP" "$IOS_ICON"
rm -f "$TMP"
rmdir "$(dirname "$TMP")" 2>/dev/null || true
echo "OK: Android mipmaps + iOS AppIcon-512@2x.png"

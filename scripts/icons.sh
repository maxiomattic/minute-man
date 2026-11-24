#!/usr/bin/env bash
# Regenerate Android/iOS app icons and splash images from public/icon.svg.
# Usage: scripts/icons.sh   (pulls librsvg + imagemagick via nix shell)
set -euo pipefail
if ! command -v rsvg-convert >/dev/null || ! command -v magick >/dev/null; then
  exec nix shell nixpkgs#librsvg nixpkgs#imagemagick -c "$0" "$@"
fi
cd "$(dirname "$0")/.."
BG='#0e6b4e'
RES=android/app/src/main/res
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# Glyph only (ballot box, no rounded background), from public/icon.svg.
glyph=$(sed -E 's#<rect width="64" height="64"[^>]*/>##; s#<svg [^>]*>##; s#</svg>##' public/icon.svg)
# Adaptive foreground: 108dp canvas, glyph kept well inside the 66dp safe zone.
printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-12 -12 88 88">%s</svg>' "$glyph" > "$TMP/fg.svg"
# Full-bleed square (iOS icon, no alpha / no rounded corners; iOS masks it).
printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="%s"/>%s</svg>' "$BG" "$glyph" > "$TMP/square.svg"
# Round legacy icon.
printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="32" fill="%s"/>%s</svg>' "$BG" "$glyph" > "$TMP/round.svg"
# Splash glyph (smaller in frame).
printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-48 -48 160 160">%s</svg>' "$glyph" > "$TMP/splash.svg"

for d in mdpi:1 hdpi:1.5 xhdpi:2 xxhdpi:3 xxxhdpi:4; do
  name=${d%%:*}; s=${d##*:}
  fg=$(awk "BEGIN{print int(108*$s)}"); ic=$(awk "BEGIN{print int(48*$s)}")
  rsvg-convert -w "$fg" -h "$fg" "$TMP/fg.svg" -o "$RES/mipmap-$name/ic_launcher_foreground.png"
  rsvg-convert -w "$ic" -h "$ic" public/icon.svg -o "$RES/mipmap-$name/ic_launcher.png"
  rsvg-convert -w "$ic" -h "$ic" "$TMP/round.svg" -o "$RES/mipmap-$name/ic_launcher_round.png"
done
cat > "$RES/values/ic_launcher_background.xml" <<XML
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <color name="ic_launcher_background">$BG</color>
</resources>
XML

# Splash images: keep each existing file's size, green background, centered glyph.
rsvg-convert -w 1024 -h 1024 "$TMP/splash.svg" -o "$TMP/splash.png"
splash() { # file
  local size; size=$(magick identify -format '%wx%h' "$1")
  local short; short=$(magick identify -format '%[fx:min(w,h)]' "$1")
  magick -size "$size" "xc:$BG" \( "$TMP/splash.png" -resize "${short}x${short}" \) -gravity center -composite "$1"
}
for f in "$RES"/drawable*/splash.png ios/App/App/Assets.xcassets/Splash.imageset/*.png; do splash "$f"; done

rsvg-convert -w 1024 -h 1024 "$TMP/square.svg" | magick - -background "$BG" -alpha remove -alpha off \
  ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
echo "icons + splash regenerated"

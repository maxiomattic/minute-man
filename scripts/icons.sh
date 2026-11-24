#!/usr/bin/env bash
# Regenerate Android/iOS app icons and splash images from public/icon.svg.
# Usage: scripts/icons.sh   (pulls librsvg + imagemagick via nix shell)
set -euo pipefail
if ! command -v rsvg-convert >/dev/null || ! command -v magick >/dev/null; then
  exec nix shell nixpkgs#librsvg nixpkgs#imagemagick -c "$0" "$@"
fi
cd "$(dirname "$0")/.."
BG='#1a2848'
RES=android/app/src/main/res
TMP=$(mktemp -d); trap 'rm -rf "$TMP"' EXIT

# The minuteman glyph (no tile), from public/icon.svg, plus a brass strip that runs the
# coat off the bottom edge wherever the shape is masked (adaptive, round, splash).
glyph=$(sed -nE 's#.*(<g id="minuteman">.*</g>).*#\1#p' public/icon.svg)
coat='<path fill="#c8962f" d="M9.5 62H54.5C60 70 66 80 72 112H-8C-2 80 4 70 9.5 62Z"/>'
# Badge: navy disc centered on (32,35), r 38, glyph and coat clipped to it.
disc() { # extra-svg
  printf '<defs><clipPath id="d"><circle cx="32" cy="35" r="38"/></clipPath></defs><circle cx="32" cy="35" r="38" fill="%s"/><g clip-path="url(#d)">%s%s</g>%s' "$BG" "$coat" "$glyph" "${1:-}"
}
# Adaptive foreground: 108dp canvas = 108 units, centered on (32,33). The hat stays in the
# 66dp safe circle and the bayonet inside the 72dp visible circle; the coat runs off the edge.
printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-22 -21 108 108">%s%s</svg>' "$coat" "$glyph" > "$TMP/fg.svg"
# Full-bleed square (iOS icon, no alpha / no rounded corners; iOS masks it).
printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="%s"/>%s%s</svg>' "$BG" "$coat" "$glyph" > "$TMP/square.svg"
# Round legacy icon.
printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-6 -3 76 76">%s</svg>' "$(disc)" > "$TMP/round.svg"
# Splash: the badge with a brass ring, small in frame.
printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-88 -85 240 240">%s</svg>' \
  "$(disc '<circle cx="32" cy="35" r="38" fill="none" stroke="#c8962f" stroke-width="2.5"/>')" > "$TMP/splash.svg"
# Web maskable icon: full-bleed navy, figure inside the 80% safe circle.
printf '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-16 -13 96 96"><rect x="-16" y="-13" width="96" height="96" fill="%s"/>%s%s</svg>\n' "$BG" "$coat" "$glyph" > public/icon-maskable.svg
[[ -n "${ICON_PREVIEW:-}" ]] && { cp "$TMP"/*.svg "$ICON_PREVIEW"/; exit 0; }

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

# Splash images: keep each existing file's size, navy background, centered glyph.
rsvg-convert -w 1024 -h 1024 "$TMP/splash.svg" -o "$TMP/splash.png"
splash() { # file
  local size; size=$(magick identify -format '%wx%h' "$1")
  local short; short=$(magick identify -format '%[fx:min(w,h)]' "$1")
  magick -size "$size" "xc:$BG" \( "$TMP/splash.png" -resize "${short}x${short}" \) -gravity center -composite "$1"
}
for f in "$RES"/drawable*/splash.png ios/App/App/Assets.xcassets/Splash.imageset/*.png; do splash "$f"; done

rsvg-convert -w 1024 -h 1024 "$TMP/square.svg" | magick - -background "$BG" -alpha remove -alpha off \
  ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png
# PNG web icons for the manifest and apple-touch-icon.
for n in 192 512; do rsvg-convert -w $n -h $n public/icon.svg -o public/icon-$n.png; done
rsvg-convert -w 512 -h 512 public/icon-maskable.svg -o public/icon-maskable-512.png
rsvg-convert -w 180 -h 180 "$TMP/square.svg" -o public/apple-touch-icon.png
echo "icons + splash regenerated"

#!/usr/bin/env bash
#
# build_media.sh — regenerate web-optimized media derivatives.
#
# Workflow: drop a full-size original into assets/photos/ (.jpg/.jpeg/.png) or
# assets/clips/ (.mp4), then run `./build_media.sh`. Originals are the source of
# truth and are never modified; everything the site actually serves is written
# into the sibling web/ folders and is safe to delete and rebuild.
#
# Derivatives (by convention, so index.html can derive paths without a manifest):
#   photos/<name>.jpg  -> photos/web/<name>.webp        (full, <=2048w, q82)
#                         photos/web/<name>.thumb.webp  (gallery thumb, 500w, q80)
#   clips/<name>.mp4   -> clips/web/<name>.poster.webp  (poster frame, <=720h)
#
# Note: the source clips are already efficiently H.264-encoded at low bitrate,
# already audioless, and already +faststart (moov atom up front), so there is
# nothing to gain by re-encoding or remuxing them — re-encoding only makes them
# larger. The clip is served as-is; the only derivative we need is a poster frame
# so the video tile paints instantly instead of sitting black until it loads.
#
# Requires: cwebp, ffmpeg, sips (all preinstalled on this machine).
set -euo pipefail

cd "$(dirname "$0")"
PHOTO_SRC="assets/photos"
CLIP_SRC="assets/clips"
PHOTO_OUT="$PHOTO_SRC/web"
CLIP_OUT="$CLIP_SRC/web"
mkdir -p "$PHOTO_OUT" "$CLIP_OUT"

# Rebuild only when the source is newer than the derivative (or it's missing).
needs_build() { [ ! -f "$2" ] || [ "$1" -nt "$2" ]; }

echo "== Photos =="
shopt -s nullglob nocaseglob
for src in "$PHOTO_SRC"/*.jpg "$PHOTO_SRC"/*.jpeg "$PHOTO_SRC"/*.png; do
  name="$(basename "$src")"; name="${name%.*}"
  full="$PHOTO_OUT/$name.webp"
  thumb="$PHOTO_OUT/$name.thumb.webp"
  if needs_build "$src" "$full"; then
    cwebp -quiet -q 82 -resize 2048 0 -metadata none "$src" -o "$full" 2>/dev/null \
      || cwebp -quiet -q 82 -metadata none "$src" -o "$full"   # already <2048w
    echo "  full  $name.webp  ($(du -h "$full" | cut -f1))"
  fi
  if needs_build "$src" "$thumb"; then
    cwebp -quiet -q 80 -resize 500 0 -metadata none "$src" -o "$thumb"
    echo "  thumb $name.thumb.webp  ($(du -h "$thumb" | cut -f1))"
  fi
done
shopt -u nocaseglob

echo "== Clips =="
for src in "$CLIP_SRC"/*.mp4; do
  name="$(basename "$src")"; name="${name%.*}"
  poster="$CLIP_OUT/$name.poster.webp"
  if needs_build "$src" "$poster"; then
    # Poster from ~1s in (avoids black opening frames), <=720h, as WebP.
    ffmpeg -nostdin -loglevel error -y -ss 1 -i "$src" -frames:v 1 \
      -vf "scale=-2:'min(720,ih)'" /tmp/_poster_$$.png
    cwebp -quiet -q 75 -metadata none /tmp/_poster_$$.png -o "$poster"
    rm -f /tmp/_poster_$$.png
    echo "  poster $name.poster.webp  ($(du -h "$poster" | cut -f1))"
  fi
done

echo "Done."

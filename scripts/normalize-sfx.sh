#!/usr/bin/env bash
# Normalizes the repo's sound effects (public/sfx/*.mp3) so none clips or pops at a cut: DC removed (20 Hz high-pass),
# peaks brought down to about -3 dBFS (never boosted) with a limiter, a 3 ms fade-in and a 15 ms fade-out.
# Usage: bash scripts/normalize-sfx.sh   (needs ffmpeg / ffprobe; rewrites the files in place)
set -euo pipefail
cd "$(dirname "$0")/.."
tmp=$(mktemp -d)
for src in public/sfx/*.mp3; do
  name=$(basename "$src")
  peak=$(ffmpeg -nostdin -hide_banner -i "$src" -af "highpass=f=20,volumedetect" -f null - 2>&1 | sed -n 's/.*max_volume: \(-\{0,1\}[0-9.]*\) dB.*/\1/p')
  gain=$(python3 -c "print(min(0.0, round(-3 - float('$peak'), 2)))")
  dur=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$src")
  st=$(python3 -c "print(max(0, $dur - 0.015))")
  ffmpeg -nostdin -loglevel error -y -i "$src" \
    -af "highpass=f=20,volume=${gain}dB,alimiter=limit=0.66:level=disabled:attack=1:release=20,afade=t=in:st=0:d=0.003,afade=t=out:st=${st}:d=0.015" \
    -c:a libmp3lame -q:a 2 "$tmp/$name"
  mv "$tmp/$name" "$src"
  echo "$name: peak $peak dB, gain ${gain} dB"
done

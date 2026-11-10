#!/usr/bin/env bash
# Generates two synthetic 9:16 test drafts with ffmpeg so you can try the app
# without your own footage. Draft A has a slow, silent opening and a long static
# hold; Draft B is the "tightened" edit of the same idea.
set -euo pipefail
OUT="${1:-samples}"
mkdir -p "$OUT"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# seg <name> <kind: move|still> <seconds> <audio: tone|quiet|silent> <color> <freq>
seg() {
  local name=$1 kind=$2 dur=$3 audio=$4 color=$5 freq=$6
  local v a
  if [ "$kind" = move ]; then v="testsrc2=s=540x960:r=30:d=$dur"; else v="color=c=$color:s=540x960:r=30:d=$dur"; fi
  case $audio in
    tone)   a="sine=frequency=$freq:sample_rate=44100:d=$dur,volume=0.5" ;;
    quiet)  a="sine=frequency=$freq:sample_rate=44100:d=$dur,volume=0.004" ;;
    silent) a="anullsrc=r=44100:cl=mono,atrim=0:$dur" ;;
  esac
  ffmpeg -v error -y -f lavfi -i "$v" -f lavfi -i "$a" -shortest \
    -c:v libx264 -preset veryfast -pix_fmt yuv420p -c:a aac -ac 1 -ar 44100 "$TMP/$name.mp4"
  echo "file '$TMP/$name.mp4'" >> "$TMP/$LIST"
}

LIST=a.txt
seg a1 still 3 silent 0x223344 0      # slow, silent opening
seg a2 move 6 tone 0 440
seg a3 still 6 quiet 0x664422 0       # long static hold with dead air
seg a4 move 8 tone 0 550
seg a5 still 3 tone 0x226644 330
seg a6 move 6 tone 0 660
seg a7 still 10 quiet 0x442266 0      # drawn-out ending
ffmpeg -v error -y -f concat -safe 0 -i "$TMP/a.txt" -c copy "$OUT/draft_A_slow_open.mp4"

LIST=b.txt
seg b1 move 6 tone 0 440              # opens on motion + sound
seg b2 still 2 tone 0x664422 520
seg b3 move 8 tone 0 550
seg b4 still 3 tone 0x226644 330
seg b5 move 6 tone 0 660
seg b6 still 2 tone 0x442266 300
ffmpeg -v error -y -f concat -safe 0 -i "$TMP/b.txt" -c copy "$OUT/draft_B_tight.mp4"

echo "Wrote $OUT/draft_A_slow_open.mp4 and $OUT/draft_B_tight.mp4"

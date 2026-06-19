#!/bin/sh
# Build .jsdos bundles + a manifest from a mounted /data dir, then serve the site.
#
# Mount your own Duke Nukem files at /data (one subdir per game, or flat):
#   /data/duke1/DN1.EXE DN2.EXE DN3.EXE *.DN1 *.DN2 *.DN3 ...   (Duke Nukem 1, all episodes)
#   /data/duke2/NUKEM2.EXE NUKEM2.CMP NUKEM2.F* ...             (Duke Nukem II, registered)
# A full Duke Nukem 1 folder yields three games (episodes 1/2/3). When any game
# is detected, the launcher shows ONLY the server games and hides the upload UI.
# Commercial/registered data is never baked into the image.
set -e

WEB=/usr/share/nginx/html
GAMES="$WEB/games"
DATA=/data

# All Duke games present in a dir (echoes space-separated keys). Duke Nukem 1's
# episodes share one folder, so a full DN1 dir matches duke1 + duke1ep2 + duke1ep3.
detect_in_dir() {
  src="$1"; out=""
  has() { find "$src" -maxdepth 1 -iname "$1" 2>/dev/null | grep -q .; }
  has "DN1.EXE"    && has "*.DN1"        && out="$out duke1"
  has "DN2.EXE"    && has "*.DN2"        && out="$out duke1ep2"
  has "DN3.EXE"    && has "*.DN3"        && out="$out duke1ep3"
  has "NUKEM2.EXE" && has "NUKEM2.CMP"   && out="$out duke2"
  echo "$out"
}

run_for() {
  case "$1" in
    duke1)    echo "DN1.EXE" ;;
    duke1ep2) echo "DN2.EXE" ;;
    duke1ep3) echo "DN3.EXE" ;;
    duke2)    echo "NUKEM2.EXE" ;;
  esac
}
title_for() {
  case "$1" in
    duke1)    echo "Duke Nukem — Episode 1: Shrapnel City" ;;
    duke1ep2) echo "Duke Nukem — Episode 2: Mission: Moonbase" ;;
    duke1ep3) echo "Duke Nukem — Episode 3: Trapped in the Future!" ;;
    duke2)    echo "Duke Nukem II" ;;
  esac
}

# build_game <key> <src_dir> -> writes games/<key>.jsdos with the dir's whole data set.
build_game() {
  key="$1"; src="$2"
  runcmd=$(run_for "$key")
  work=$(mktemp -d)
  mkdir -p "$work/.jsdos"
  for f in "$src"/*; do
    [ -f "$f" ] || continue
    bn=$(basename "$f" | tr '[:lower:]' '[:upper:]')
    cp "$f" "$work/$bn"
  done

  cat > "$work/.jsdos/dosbox.conf" <<CONF
[sdl]
autolock=false
fullscreen=false
output=surface
mapperfile=mapper-jsdos.map
usescancodes=true
[dosbox]
machine=svga_s3
memsize=16
[cpu]
core=auto
cputype=auto
cycles=auto
[mixer]
nosound=false
rate=44100
[sblaster]
sbtype=sb16
oplmode=auto
oplrate=44100
[speaker]
pcspeaker=true
[dos]
xms=true
ems=true
umb=true
[autoexec]
echo off
mount c .
c:
$runcmd
CONF
  printf '[cpu]\ncycles=auto\n' > "$work/dosbox.conf"

  # rm first: zip appends to an existing archive (the image ships the shareware
  # bundles), which would corrupt the bundle when rebuilding from /data.
  rm -f "$GAMES/$key.jsdos"
  ( cd "$work" && zip -rq -X "$GAMES/$key.jsdos" . )
  rm -rf "$work"
}

games_json=""
add_game() {
  key="$1"
  [ -n "$games_json" ] && games_json="$games_json,"
  # Content hash in the URL so js-dos (which caches bundles by URL) re-fetches on change.
  h=$(md5sum "$GAMES/$key.jsdos" 2>/dev/null | cut -c1-8)
  title=$(title_for "$key")
  games_json="$games_json{\"key\":\"$key\",\"title\":\"$title\",\"bundle\":\"games/$key.jsdos?v=$h\"}"
}

built=""
if [ -d "$DATA" ]; then
  echo "[duke-wasm] scanning $DATA for Duke Nukem data..."
  for d in "$DATA" "$DATA"/*; do
    [ -d "$d" ] || continue
    for key in $(detect_in_dir "$d"); do
      echo "$built" | grep -qw "$key" && continue
      if build_game "$key" "$d"; then
        echo "[duke-wasm] built $key from $d"
        add_game "$key"
        built="$built $key"
      fi
    done
  done
fi

# Fall back to the bundled shareware for any game /data didn't supply.
for key in duke1 duke2; do
  if [ -f "$GAMES/$key.jsdos" ] && ! echo "$built" | grep -qw "$key"; then
    add_game "$key"
  fi
done

if [ -n "$games_json" ]; then
  printf '{"serverMode":true,"games":[%s]}\n' "$games_json" > "$GAMES/manifest.json"
  echo "[duke-wasm] manifest: $(cat "$GAMES/manifest.json")"
else
  rm -f "$GAMES/manifest.json"
  echo "[duke-wasm] no game data found; running in bring-your-own-data mode"
fi

exec nginx -g 'daemon off;'

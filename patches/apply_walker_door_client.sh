#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
PARTS=(patches/walker-keyed-door.index.html.patch.gz.b64.part0
       patches/walker-keyed-door.index.html.patch.gz.b64.part1
       patches/walker-keyed-door.index.html.patch.gz.b64.part2)
for p in "${PARTS[@]}"; do
  [[ -f "$p" ]] || { echo "missing $p"; exit 1; }
done
cat "${PARTS[@]}" | base64 -d | gunzip > patches/walker-keyed-door.index.html.patch
patch -p1 < patches/walker-keyed-door.index.html.patch
grep -q DOOR_URL index.html
grep -q doorKeyBox index.html
grep -q '0.9.4' index.html
echo "OK walker keyed door client applied (0.9.4)"

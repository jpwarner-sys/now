#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
if [[ ! -f patches/walker-keyed-door.index.html.patch ]]; then
  echo "Missing patches/walker-keyed-door.index.html.patch"
  echo "Assemble: cat patches/p?? > patches/walker-keyed-door.index.html.patch"
  echo "Or copy from Deep Scan box: /workspace/walker-door-ticket/index.html.walker_door.patch"
  exit 1
fi
patch -p1 < patches/walker-keyed-door.index.html.patch
grep -q DOOR_URL index.html
grep -q doorKeyBox index.html
grep -q '0.9.4' index.html
echo "OK walker keyed door client applied (0.9.4)"

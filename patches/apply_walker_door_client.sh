#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
cat patches/index.html.patched.gz.b64.part0 patches/index.html.patched.gz.b64.part1 patches/index.html.patched.gz.b64.part2 | base64 -d | gzip -d > index.html
echo "Wrote index.html ($(wc -c < index.html) bytes)"

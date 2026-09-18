#!/usr/bin/env bash
# Apply walker-keyed-door client onto index.html
set -euo pipefail
cd "$(dirname "$0")/.."
base64 -d patches/index.html.patched.gz.b64 | gzip -d > index.html
echo "Wrote index.html ($(wc -c < index.html) bytes)"

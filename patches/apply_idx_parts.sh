#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
cat patches/idx.part?? > index.html
echo "Wrote index.html ($(wc -c < index.html) bytes)"
echo "expected sha256 af5628ba38c40d244ce35644be68ccfcf5569d73457af8f50ecc9fe56ee56670"
sha256sum index.html

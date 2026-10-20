#!/bin/sh
# Builds remote-radar-<version>.zip for the Chrome Web Store (extension files only, manifest.json at the zip root).
set -e
cd "$(dirname "$0")/.."
node test/rules.test.js >/dev/null
v=$(node -p "require('./manifest.json').version")
out="remote-radar-$v.zip"
rm -f "$out"
zip -q -r "$out" manifest.json rules.js content.js content.css popup.html popup.css popup.js icons -x '*.DS_Store'
echo "Built $out"
unzip -l "$out"

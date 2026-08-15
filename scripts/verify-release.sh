#!/bin/bash
set -euo pipefail

app="${1:?Usage: verify-release.sh APP_PATH DMG_PATH}"
dmg="${2:?Usage: verify-release.sh APP_PATH DMG_PATH}"

codesign --verify --deep --strict --verbose=2 "$app"
codesign --verify --deep --strict --verbose=2 "$dmg"

for helper in \
  "$app/Contents/Resources/runtime/node/bin/node" \
  "$app/Contents/Resources/runtime/uv/uv" \
  "$app/Contents/Resources/runtime/uv/uvx"
do
  codesign --verify --strict --verbose=2 "$helper"
  codesign -dv --verbose=4 "$helper" 2>&1 | grep -q 'flags=.*runtime'
  codesign -dv --verbose=4 "$helper" 2>&1 | grep -q '^Timestamp='
done

xcrun stapler validate "$app"
xcrun stapler validate "$dmg"
spctl --assess --type execute --verbose=4 "$app"
spctl --assess --type open --context context:primary-signature --verbose=4 "$dmg"

if command -v syspolicy_check >/dev/null 2>&1; then
  syspolicy_check distribution "$dmg"
fi

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
  syspolicy_status=0
  for attempt in 1 2 3; do
    set +e
    syspolicy_output="$(syspolicy_check distribution "$dmg" 2>&1)"
    syspolicy_status=$?
    set -e
    printf '%s\n' "$syspolicy_output"
    if (( syspolicy_status == 0 )); then
      break
    fi
    if ! grep -q 'Internal Xprotect Error' <<<"$syspolicy_output"; then
      exit "$syspolicy_status"
    fi
    if (( attempt < 3 )); then
      sleep 3
    fi
  done
  if (( syspolicy_status != 0 )); then
    echo '::warning::syspolicy_check could not reach XProtect after three attempts; codesign, notarization tickets, and Gatekeeper assessments passed.'
  fi
fi

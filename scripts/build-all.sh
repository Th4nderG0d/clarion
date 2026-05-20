#!/usr/bin/env bash
# Local mirror of the CI pipeline: typecheck, Android build, iOS build.
# Fails fast on the first error so you can see exactly what broke.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "▶  Installing workspace dependencies…"
pnpm install --frozen-lockfile

echo "▶  Typecheck (6 packages)…"
pnpm -r typecheck

echo "▶  Building TS → lib/…"
pnpm -r build

echo "▶  Android: assembleDebug for recorder + recognizer + example app…"
(cd example/android && ./gradlew \
  :clarionhq_recorder:assembleDebug \
  :clarionhq_recognizer:assembleDebug \
  :app:assembleDebug)

if [ "$(uname)" = "Darwin" ]; then
  echo "▶  iOS: pod install + xcodebuild build…"
  (cd example/ios && LANG=en_US.UTF-8 pod install >/dev/null)
  SIM_UDID=$(xcrun simctl list devices available --json | python3 -c "
import json, sys
data = json.load(sys.stdin)
for runtime, devices in data['devices'].items():
    if 'iOS' not in runtime: continue
    for d in devices:
        if d.get('isAvailable') and 'iPhone' in d.get('name', ''):
            print(d['udid']); sys.exit()
")
  xcodebuild \
    -workspace example/ios/ClarionExample.xcworkspace \
    -scheme ClarionExample \
    -sdk iphonesimulator \
    -destination "platform=iOS Simulator,id=$SIM_UDID" \
    -configuration Debug \
    build CODE_SIGNING_ALLOWED=NO | tail -5
else
  echo "▶  iOS: skipped (not macOS)."
fi

echo "✅  All checks passed."

#!/usr/bin/env bash
# Smoke test the example app on an iOS Simulator.
# Boots a default iPhone, builds + installs the example, launches the app,
# and streams filtered logs. Override DEVICE_UDID to target a specific sim.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXAMPLE="$ROOT/example"
BUNDLE_ID="dev.clarionhq.example"
DEFAULT_SIM_NAME="${DEFAULT_SIM_NAME:-iPhone 16 Pro}"

# 1. Pick a simulator. Honor DEVICE_UDID if exported; otherwise find the first
#    available iPhone matching DEFAULT_SIM_NAME, preferring booted ones.
if [ -z "${DEVICE_UDID:-}" ]; then
  DEVICE_UDID=$(xcrun simctl list devices available --json | python3 -c "
import json, sys
data = json.load(sys.stdin)
booted, candidate = None, None
for runtime, devices in data['devices'].items():
    if 'iOS' not in runtime: continue
    for d in devices:
        if not d.get('isAvailable'): continue
        if '${DEFAULT_SIM_NAME}' not in d.get('name', ''): continue
        if d.get('state') == 'Booted':
            booted = d['udid']; break
        candidate = candidate or d['udid']
print(booted or candidate or '')
")
fi

if [ -z "$DEVICE_UDID" ]; then
  echo "No iOS simulator found matching '$DEFAULT_SIM_NAME'." >&2
  echo "Run: xcrun simctl list devices" >&2
  exit 1
fi
echo "▶  Using sim $DEVICE_UDID"

# 2. Boot if not already.
if ! xcrun simctl list devices booted | grep -q "$DEVICE_UDID"; then
  echo "▶  Booting sim…"
  xcrun simctl boot "$DEVICE_UDID"
  open -a Simulator
  until xcrun simctl list devices booted | grep -q "$DEVICE_UDID"; do sleep 2; done
fi

# 3. Build (if needed) — use the existing DerivedData app if present.
APP=$(find "$HOME/Library/Developer/Xcode/DerivedData" \
  -name 'ClarionExample.app' \
  -path '*Debug-iphonesimulator*' -type d 2>/dev/null | head -1 || true)

if [ -z "$APP" ] || [ "${FORCE_BUILD:-0}" = "1" ]; then
  echo "▶  Building example…"
  (cd "$EXAMPLE/ios" && LANG=en_US.UTF-8 pod install >/dev/null)
  xcodebuild \
    -workspace "$EXAMPLE/ios/ClarionExample.xcworkspace" \
    -scheme ClarionExample \
    -sdk iphonesimulator \
    -destination "platform=iOS Simulator,id=$DEVICE_UDID" \
    -configuration Debug \
    build CODE_SIGNING_ALLOWED=NO | tail -10
  APP=$(find "$HOME/Library/Developer/Xcode/DerivedData" \
    -name 'ClarionExample.app' \
    -path '*Debug-iphonesimulator*' -type d 2>/dev/null | head -1)
fi
echo "▶  App: $APP"

# 4. Install + relaunch.
xcrun simctl install "$DEVICE_UDID" "$APP"
xcrun simctl terminate "$DEVICE_UDID" "$BUNDLE_ID" 2>/dev/null || true
sleep 1
xcrun simctl launch "$DEVICE_UDID" "$BUNDLE_ID"
echo "▶  Launched. Streaming logs (Ctrl+C to stop)…"

# 5. Stream filtered logs.
exec xcrun simctl spawn "$DEVICE_UDID" log stream \
  --predicate 'process == "ClarionExample" OR subsystem == "com.apple.speech.localspeechrecognition"' \
  --level=default

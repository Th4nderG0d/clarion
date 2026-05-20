#!/usr/bin/env bash
# Smoke test the example app on an Android emulator.
# Boots Pixel_9_Pro on port 5556 (override with AVD_NAME / EMULATOR_PORT),
# builds the APK, installs, sets the Metro reverse-tunnel, launches the app,
# and tails a filtered logcat.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
EXAMPLE="$ROOT/example"
PKG="dev.clarionhq.example"
AVD_NAME="${AVD_NAME:-Pixel_9_Pro}"
EMULATOR_PORT="${EMULATOR_PORT:-5556}"
SDK="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
ADB="$SDK/platform-tools/adb"
EMU="$SDK/emulator/emulator"
SERIAL="emulator-$EMULATOR_PORT"

if [ ! -x "$ADB" ]; then
  echo "adb not found at $ADB. Set ANDROID_HOME." >&2
  exit 1
fi

# 1. Boot AVD if not running.
if ! $ADB devices | grep -q "^$SERIAL"; then
  echo "▶  Booting $AVD_NAME on port $EMULATOR_PORT…"
  "$EMU" -avd "$AVD_NAME" -port "$EMULATOR_PORT" -no-snapshot-load >/dev/null 2>&1 &
  until $ADB -s "$SERIAL" shell getprop sys.boot_completed 2>/dev/null | grep -q 1; do sleep 3; done
  echo "▶  Booted."
fi

# 2. Build APK.
echo "▶  Building APK…"
(cd "$EXAMPLE/android" && ./gradlew :app:assembleDebug -q)
APK="$EXAMPLE/android/app/build/outputs/apk/debug/app-debug.apk"

# 3. Install + reverse-tunnel + launch.
$ADB -s "$SERIAL" uninstall "$PKG" >/dev/null 2>&1 || true
$ADB -s "$SERIAL" install -r "$APK"
$ADB -s "$SERIAL" reverse tcp:8081 tcp:8081 >/dev/null
$ADB -s "$SERIAL" logcat -c
$ADB -s "$SERIAL" shell am start -n "$PKG/.MainActivity"
echo "▶  Launched. Streaming logcat (Ctrl+C to stop)…"

# 4. Filtered logcat.
exec $ADB -s "$SERIAL" logcat \
  'ReactNativeJS:V' 'ClarionRecognizer:V' 'Clarion:V' \
  'SpeechRecognizer:V' 'AndroidRuntime:E' '*:S'

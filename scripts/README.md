# scripts/

Quick-action scripts for the Clarion monorepo. All paths inside resolve from the repo root, so you can invoke from anywhere.

## `build-all.sh`

Local mirror of CI. Runs typecheck, builds TS to `lib/`, builds the Android library modules + example APK, and (on macOS) does `pod install` + `xcodebuild` for the iOS example. Fails fast.

```sh
./scripts/build-all.sh
```

Use before pushing to catch what CI would catch — without waiting on the GitHub Actions queue.

## `smoke-android.sh`

Boots the **Pixel 9 Pro** AVD on port 5556, builds + installs the example APK, sets the Metro reverse-tunnel, launches the app, then tails a filtered logcat.

```sh
./scripts/smoke-android.sh
# Or target a different AVD/port:
AVD_NAME=Pixel_Tab-_16kb EMULATOR_PORT=5558 ./scripts/smoke-android.sh
```

Make sure `pnpm start` is running from `example/` in a separate terminal so Metro is up.

## `smoke-ios.sh`

Boots an **iPhone 16 Pro** simulator (override with `DEFAULT_SIM_NAME`), builds + installs the example app, launches, and streams filtered `log stream` output.

```sh
./scripts/smoke-ios.sh
# Or pin a specific UDID:
DEVICE_UDID=A35C6FE7-29DB-47C8-A1DE-4FE60424EECA ./scripts/smoke-ios.sh
# Force a rebuild even if an existing DerivedData app exists:
FORCE_BUILD=1 ./scripts/smoke-ios.sh
```

By default it skips the build step if a `ClarionExample.app` is already in DerivedData — set `FORCE_BUILD=1` to override.

## Notes

- The iOS speech recognizer requires the requested locale to be present in the sim's dictation languages. Check Settings → General → Keyboard → Dictation → Dictation Languages.
- Android's `SpeechRecognizer` requires Google Play services in the AVD image. Pixel AVDs include them; AOSP-only AVDs do not.

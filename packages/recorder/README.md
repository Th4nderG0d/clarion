# @clarionhq/recorder

React Native microphone capture → AAC `.m4a`. Built on the New Architecture with [Nitro Modules](https://nitro.margelo.com). 16 KB page-size compliant.

```tsx
import { RecorderEngine } from '@clarionhq/recorder';

const engine = new RecorderEngine({ emitAudioLevel: true });
engine.on(e => {
  if (e.type === 'state') setState(e.state);
  if (e.type === 'audio-level') setRms(e.rms);
  if (e.type === 'recording-complete') console.log(e.result.uri);
});

await engine.start();   // permission, prepare and record — one call
// later…
await engine.stop();    // finalizes the m4a and resets to `idle`
```

## Install

```sh
pnpm add @clarionhq/recorder @clarionhq/core react-native-nitro-modules
cd ios && pod install
```

## Requirements

| | |
|---|---|
| React Native | 0.77+ with New Architecture + Hermes |
| Android | API 26+ |
| iOS | 15.1+ |
| Expo | bare workflow only (prebuild) |

## Permissions

**Android** — `RECORD_AUDIO` is auto-merged into your manifest. Request at runtime:

```tsx
await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
```

**iOS** — add `NSMicrophoneUsageDescription` to `Info.plist`. The library prompts the user automatically on first `start()`.

## API

### `new RecorderEngine(options?)`

```ts
type RecorderEngineOptions = {
  outputDirectory?: string;       // default: app cache dir / 'clarion-recorder'
  filenamePrefix?: string;        // default: 'clarion'
  rotateAfterMs?: number;         // split into chunks every N ms
  emitAudioLevel?: boolean;       // default: false
  audioLevelIntervalMs?: number;  // default: 50
  aacBitrate?: number;            // default: 32_000
};
```

### Lifecycle

| Method | Behavior |
|---|---|
| `start()` | Begin recording. Auto-handles permission + `prepare()` from `idle`/`error`. |
| `pause()` / `resume()` | Gapless pause — audio session stays warm. |
| `stop()` | Finalize the m4a → fire `recording-complete` → state → `idle`. |
| `discard()` | Abort and delete the partial file → state → `idle`. |
| `release()` | Permanently dispose. Engine cannot be reused after this. |
| `prepare()` | Optional. Pre-warm the audio session before showing your record UI. |

### Events

```ts
type ClarionEvent =
  | { type: 'state'; state: EngineState }
  | { type: 'audio-level'; rms: number; peak: number }   // 0..1 linear (not dB)
  | { type: 'chunk'; uri: string; startMs: number; endMs: number; sizeBytes: number }
  | { type: 'recording-complete'; result: RecorderResult }
  | { type: 'error'; error: ClarionError };
```

States: `idle → preparing → ready → starting → recording → paused → stopping → idle`, plus `error` and `released` as terminals. Method calls from invalid states throw `ClarionError({ code: 'INVALID_STATE' })`; runtime errors arrive via the `error` event. See [`@clarionhq/core/errors`](https://github.com/Th4nderG0d/clarion/blob/main/packages/core/src/errors.ts) for the full code list.

### React cleanup

```tsx
useEffect(() => {
  const engine = new RecorderEngine();
  const off = engine.on(handle);
  return () => { off(); engine.release(); };   // important — frees the mic
}, []);
```

## Limitations

- **No background recording.** App suspending mid-recording will truncate the file. Callers who need background must configure `UIBackgroundModes: audio` (iOS) + a foreground service (Android) themselves; opt-in support may land in v0.2.
- **No playback.** Use [`expo-av`](https://docs.expo.dev/versions/latest/sdk/audio/) or [`react-native-track-player`](https://rntp.dev) — Clarion produces m4a files that play cleanly in both.
- **No managed Expo support.** Bare workflow / prebuild only until a config plugin ships.

## Troubleshooting

| Symptom | Fix |
|---|---|
| iOS build: `fmt` library `consteval` errors on Xcode 26 | Add `FMT_USE_CONSTEVAL=0` patch to your `Podfile` post_install (see `example/ios/Podfile` in the repo). |
| `PERMISSION_DENIED` fires repeatedly | iOS: confirm `NSMicrophoneUsageDescription` is in Info.plist. Android: confirm `PermissionsAndroid.request(RECORD_AUDIO)` returned `granted` before calling `start()`. |

## License

MIT

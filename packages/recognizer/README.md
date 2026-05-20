# @clarionhq/recognizer

React Native wrapper for the platform speech recognizer — `SFSpeechRecognizer` on iOS, `SpeechRecognizer` on Android. Built on the New Architecture with [Nitro Modules](https://nitro.margelo.com). 16 KB page-size compliant.

```tsx
import { RecognizerEngine } from '@clarionhq/recognizer';

const engine = new RecognizerEngine({ language: 'en-US', emitPartials: true });
engine.on(e => {
  if (e.type === 'partial') setLive(e.result.text);
  if (e.type === 'final')   setFinal(e.result.text);
  if (e.type === 'error')   console.warn(e.error.code, e.error.message);
});

await engine.start();   // permission + prepare + listen — one call
// later…
await engine.stop();    // emits the final transcript, returns to `idle`
```

## Install

```sh
pnpm add @clarionhq/recognizer @clarionhq/core react-native-nitro-modules
cd ios && pod install
```

## Requirements

| | |
|---|---|
| React Native | 0.77+ with New Architecture + Hermes |
| Android | API 26+ (recognition service must be present — Google's by default) |
| iOS | 15.1+ |
| Expo | bare workflow only (prebuild) |

## Permissions

### iOS — add to `Info.plist`

```xml
<key>NSSpeechRecognitionUsageDescription</key>
<string>We use speech recognition to transcribe your voice.</string>
<key>NSMicrophoneUsageDescription</key>
<string>We use the microphone to capture your voice.</string>
```

Both prompts fire automatically on the first `start()`. On the **iOS Simulator** speech recognition needs the requested locale to be downloaded under Settings → General → Keyboard → Dictation → Dictation Languages.

### Android — already merged into your manifest

The library ships `RECORD_AUDIO`, `INTERNET`, and the Android 11+ `<queries><intent>` for `android.speech.RecognitionService` (without this query block, `SpeechRecognizer.isRecognitionAvailable()` returns false on apps targeting SDK 30+). Request at runtime:

```tsx
await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
```

## Availability checks

Use these **before** `start()` to fail fast with a clear message:

```tsx
import { RecognizerEngine } from '@clarionhq/recognizer';

const locales = await RecognizerEngine.supportedLocales();
const ok = await RecognizerEngine.isAvailable('en-US');
if (!ok) console.warn('en-US not installed. Available:', locales);
```

## API

### `new RecognizerEngine(options?)`

```ts
type RecognizerEngineOptions = {
  language?: string;              // BCP-47 tag, default 'en-US'
  emitPartials?: boolean;         // default: true — fires `partial` events
  emitAudioLevel?: boolean;       // default: false
  audioLevelIntervalMs?: number;  // default: 50
  preferOnDevice?: boolean;       // iOS: prefer on-device model; default: false
};
```

### Lifecycle

| Method | Behavior |
|---|---|
| `start()` | Begin listening. Auto-handles permission + `prepare()` from `idle`/`error`. |
| `stop()` | Finalize → emit `final` event → state → `idle`. |
| `discard()` | Cancel the session, no final emitted, state → `idle`. |
| `release()` | Permanently dispose. Engine cannot be reused after this. |
| `prepare()` | Optional. Pre-warm the audio session + recognizer before showing UI. |
| `pause()` / `resume()` | Throw `INVALID_STATE` — speech recognizers can't pause without losing context. Call `stop()` and `start()` instead. |

### Events

```ts
type ClarionEvent =
  | { type: 'state';       state: EngineState }
  | { type: 'audio-level'; rms: number; peak: number }   // 0..1
  | { type: 'partial';     result: TranscriptResult }    // interim transcript
  | { type: 'final';       result: TranscriptResult }    // committed transcript
  | { type: 'error';       error: ClarionError };
```

### `TranscriptResult`

```ts
type TranscriptResult = {
  id: string;             // UUID per emission
  sessionId: string;      // shared across all partials + final of one start→stop
  timestamp: number;      // wall-clock ms when received
  text: string;
  isFinal: boolean;
  language?: string;      // BCP-47
  confidence?: number;    // 0..1, omitted if not reported
  offsetMs?: number;      // ms since session start
  durationMs?: number;    // iOS only
  segments?: TranscriptSegment[];  // iOS only — per-word timing + confidence
};
```

iOS populates `segments[]` from `SFTranscriptionSegment` (text, startMs, durationMs, confidence, alternatives). Android's standard `SpeechRecognizer` does **not** expose per-word timings, so `segments` is omitted on Android.

States: `idle → preparing → ready → starting → recording → stopping → idle`, plus `error` and `released` as terminals. See [`@clarionhq/core/errors`](https://github.com/Th4nderG0d/clarion/blob/main/packages/core/src/errors.ts) for the full error-code list.

### React cleanup

```tsx
useEffect(() => {
  const engine = new RecognizerEngine({ language: 'en-US' });
  const off = engine.on(handle);
  return () => { off(); engine.release(); };
}, []);
```

## Limitations

- **No pause/resume.** Speech recognizers lose context on pause. Use `stop()` + `start()`.
- **No speaker diarization.** Reserved as a future field; today `speakerId` is unset.
- **No word-level timings on Android.** iOS-only via `segments`.
- **No managed Expo support.** Bare workflow / prebuild only until a config plugin ships.
- **Simulator caveats.** iOS Simulator's SFSpeech often errors with `kLSRErrorDomain 300` if the requested locale's dictation language isn't downloaded — we surface this as `UNSUPPORTED_LANGUAGE`. Test on a real device for reliable results.

## Troubleshooting

| Symptom | Fix |
|---|---|
| `error[UNSUPPORTED_LANGUAGE]` on iOS Simulator | Add the language under Settings → General → Keyboard → Dictation → Dictation Languages. |
| `error[ENGINE_NOT_READY]` on Android emulator | Some emulator images ship without Google's speech service. Test on a real device or an image that includes Google Play services. |
| `error[NO_SPEECH]` keeps firing on Android emulator | The emulator mic may be muted on your host Mac. Check System Settings → Privacy → Microphone. |
| Build: missing `<queries>` on Android 11+ | The library already ships this in its manifest. If you see `isRecognitionAvailable=false`, check that your app's manifest merge produced the `<queries><intent>` block. |

## License

MIT

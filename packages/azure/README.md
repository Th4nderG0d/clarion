# @clarionhq/azure

React Native wrapper for the **Microsoft Cognitive Services Speech SDK** — high-quality streaming speech-to-text with per-word timestamps, speaker diarization, custom vocab, mid-session resilience, and structured errors. Built on the New Architecture with [Nitro Modules](https://nitro.margelo.com). 16 KB page-size compliant.

```tsx
import { AzureEngine } from '@clarionhq/azure';

const engine = new AzureEngine({
  auth: { subscriptionKey: process.env.AZURE_SPEECH_KEY!, region: 'eastus' },
  recognition: { language: 'en-US' },
});

engine.on(e => {
  if (e.type === 'partial')         setLive(e.result.text);
  if (e.type === 'final')           appendPhrase(e.result);
  if (e.type === 'speech-started')  showRecordingIndicator();
  if (e.type === 'speech-ended')    hideRecordingIndicator();
  if (e.type === 'error')           handleError(e.error);
  if (e.type === 'warning')         logWarning(e.warning);
});

await engine.start();   // permission + prepare + listen — one call
// later…
await engine.stop();    // returns immediately; final transcript arrives via 'final'
```

## Install

```sh
pnpm add @clarionhq/azure @clarionhq/core react-native-nitro-modules
cd ios && pod install
```

Optional companion packages (gracefully degraded if missing):

```sh
pnpm add @react-native-community/netinfo   # enables mid-session network drop detection
```

The pod resolves `MicrosoftCognitiveServicesSpeech-iOS ~> 1.40` automatically. On Android, `com.microsoft.cognitiveservices.speech:client-sdk:1.40.0` is pulled via Maven Central — no extra setup.

## Requirements

| | |
|---|---|
| React Native | 0.77+ with New Architecture + Hermes |
| Android | API 26+, `INTERNET` (auto-merged) |
| iOS | 15.1+ |
| Network | Required at all times (Azure is server-side) |

## Permissions

### iOS — add to `Info.plist`

```xml
<key>NSMicrophoneUsageDescription</key>
<string>We use the microphone for transcription.</string>
```

For backgrounding support, also:

```xml
<key>UIBackgroundModes</key>
<array><string>audio</string></array>
```

### Android — already merged into your manifest

`RECORD_AUDIO`, `INTERNET`, `ACCESS_NETWORK_STATE` come in automatically. You're responsible for requesting `RECORD_AUDIO` at runtime — see [`PermissionsAndroid`](https://reactnative.dev/docs/permissionsandroid).

## Configuration

The constructor takes a single grouped object: `{ auth, recognition, advanced?, telemetry? }`.

### Auth (pick one variant)

```ts
// Simplest — ships the key in the app. Fine for prototypes.
{ auth: { subscriptionKey: '...', region: 'eastus' } }

// Recommended for production — short-lived token from your server.
{ auth: { authToken: '...', region: 'eastus' } }

// Best for production — token provider callback the engine calls when fresh tokens are needed.
{ auth: {
    tokenProvider: async () => fetch('/api/azure-token').then(r => r.text()),
    region: 'eastus',
    tokenTtlMs: 10 * 60 * 1000,   // optional — defaults to Azure's 10-minute TTL
  } }

// Custom endpoint — sovereign clouds, private endpoints, custom speech models.
{ auth: { endpoint: 'wss://...', subscriptionKey: '...' } }
```

With `tokenProvider`, the engine **proactively refreshes** the token ~60 s before expiry, and **on-demand** when a `TOKEN_EXPIRED` error surfaces mid-session. You also get `warning[TOKEN_NEAR_EXPIRY]` events for observability.

### Recognition

```ts
{
  language: 'en-US',                          // BCP-47, required
  emitPartials: true,                         // interim transcripts as user speaks
  partialDebounceMs: 100,                     // smooth flicker by throttling partials
  outputFormat: 'detailed',                   // 'simple' | 'detailed' (enables word segments)
  profanity: 'masked',                        // 'masked' | 'removed' | 'raw' | 'none'
  silenceTimeoutMs: 0,                        // auto-stop after N ms silence (0 = off)
  lowConfidenceThreshold: 0,                  // emit 'audio-confidence' below this (0 = off)
  phraseHints: ['Clarionhq', 'Margelo'],      // bias recognition on custom vocab
  enableSpeakerDiarization: false,            // S0 + en-US only
  degradeOnTierMismatch: false,               // if diarization unavailable, fall back silently
  autoDetectLanguages: ['en-US', 'es-MX'],    // empty = disabled
}
```

### Advanced

```ts
{
  emitAudioLevel: false,                      // Azure ignores (SDK owns the mic)
  audioLevelIntervalMs: 50,
  prepareTimeoutMs: 15_000,                   // hard timeout for prepare() handshake
  allowMultipleInstances: false,              // 2nd instance throws by default
  autoStopOnBackground: true,                 // stop on AppState='background'
  maxClockSkewMs: 5 * 60 * 1000,              // 0 = disable check
  skipAuthPreflight: false,                   // disable JS-side /issueToken check (sovereign clouds, etc.)
  autoRetry: {                                // exponential backoff on transient errors
    maxAttempts: 2,
    baseDelayMs: 500,
    retryOn: ['NETWORK_DROPPED', 'SERVICE_DOWN', 'NETWORK_UNAVAILABLE'],
  },
  persistFinals: {                            // recover transcripts across app crashes
    storage: AsyncStorage,                    // any { getItem, setItem, removeItem }
  },
}
```

### Telemetry

```ts
{
  onSessionStart: ({ sessionId, language }) => track('azure_session_start', { sessionId }),
  onSessionEnd:   summary => track('azure_session_end', summary),
  onError:        error   => track('azure_error',       error.toJSON()),
  onWarning:      warn    => track('azure_warning',     warn),
  onUsageUpdate:  ({ sessionId, elapsedMs }) => updateUsageMeter(sessionId, elapsedMs),
}
```

## API

`AzureEngine` implements the shared [`ClarionEngine`](https://github.com/Th4nderG0d/clarion/tree/main/packages/core) interface.

```ts
class AzureEngine implements ClarionEngine {
  readonly kind = 'azure-recognizer';
  readonly state: EngineState;
  readonly options: Readonly<AzureEngineOptions>;

  // One-shot probe — builds the config without contacting the service.
  static isAvailable(options: AzureEngineOptions): Promise<boolean>;

  prepare(): Promise<void>;       // optional; start() auto-prepares
  start(): Promise<void>;
  stop(): Promise<void>;          // optimistic — emits 'final' immediately, tail finals continue ~2s
  discard(): Promise<void>;
  release(): Promise<void>;       // idempotent

  updateAuthToken(token: string): Promise<void>;
  replay(sessionId: string): Promise<number>;   // re-emit persisted finals

  on(listener: (e: ClarionEvent) => void): Unsubscribe;
}
```

### Events

| Event | When |
|---|---|
| `state` | Lifecycle transitions: `idle → preparing → ready → starting → recording → stopping → idle` |
| `partial` | Mid-phrase interim transcripts (debounced) |
| `final` | One per phrase during the session; also a session-stitched final from `stop()` |
| `speech-started` | Recognizer detected the start of speech |
| `speech-ended` | Recognizer detected the end of speech |
| `audio-confidence` | Phrase final's confidence is below `lowConfidenceThreshold` |
| `audio-level` | RMS + peak meter ticks (Azure-side: no-op) |
| `warning` | Non-fatal advisory (token-near-expiry, retry-attempted, backgrounded, network blip) |
| `error` | Typed `ClarionError` (see below) |

### Errors

Every error is a `ClarionError` with:

```ts
interface ClarionError {
  code: ErrorCode;             // typed enum below
  message: string;             // technical, safe to log
  userMessage?: string;        // non-technical, safe to show
  recoverable: boolean;        // true for transient errors the caller can retry
  retryAfterMs?: number;       // backoff hint when recoverable
  openSettings?: boolean;      // true for permission errors (deep-link helper)
  where?: ErrorOrigin;         // 'prepare' | 'start' | 'mid-session' | ...
  details?: { sessionId, nativeCode, nativeDomain, ... };
  toJSON(): Record<string, unknown>;
}
```

| Code | Meaning |
|---|---|
| `INVALID_CONFIG` | Bad option (region shape, key length, missing auth) — caught at construction |
| `PERMISSION_DENIED` / `PERMISSION_REVOKED` | Mic permission not granted / revoked mid-session |
| `AUTH_FAILED` / `TOKEN_EXPIRED` | Bad key / expired token |
| `NETWORK_UNAVAILABLE` / `NETWORK_TIMEOUT` / `NETWORK_DROPPED` / `DNS_FAILURE` | Connectivity |
| `SERVICE_DOWN` / `QUOTA_EXCEEDED` | Azure-side |
| `UNSUPPORTED_LANGUAGE` / `UNSUPPORTED_FORMAT` / `TIER_INSUFFICIENT` | Feature not available on this tier / locale |
| `AUDIO_BUSY` / `AUDIO_SESSION_INTERRUPTED` / `AUDIO_ROUTE_CHANGED` | Mic in use / phone call / BT swap |
| `STORAGE_FULL` | Recorder only — not relevant to Azure |
| `ENGINE_NOT_READY` / `INVALID_STATE` | API misuse |
| `INTERRUPTED` / `CANCELLED` | Session terminated mid-flight |
| `INTERNAL_ERROR` / `UNKNOWN` | Catch-all |

Use [`openAppSettings()`](https://github.com/Th4nderG0d/clarion/tree/main/packages/core/src/settings.ts) from `@clarionhq/core` to deep-link to system Settings when `error.openSettings === true`.

## Regions

```ts
import { AZURE_REGIONS, AZURE_DIARIZATION_REGIONS, isKnownAzureRegion } from '@clarionhq/azure';

// AZURE_REGIONS  — 30+ curated slugs, IDE autocomplete
// AZURE_DIARIZATION_REGIONS — subset that confirmed-host conversation transcriber
```

The validator only **shape-checks** region slugs, so future regions still work — these constants are for autocomplete + sensible defaults.

## Cost

Azure Speech billing as of writing: **$1 / audio-hour** on Standard. 5 free hours/month on the F0 tier. See [azure.microsoft.com/pricing](https://azure.microsoft.com/pricing/details/cognitive-services/speech-services).

Tips:

- Always `release()` when the user navigates away — a hung session keeps billing.
- Set `silenceTimeoutMs` for hands-free UIs to auto-end sessions.
- Use `telemetry.onUsageUpdate` to surface "X of 5 free hours used" to your users.
- Use `@clarionhq/hybrid` (sibling package) to route to native recognizer when offline.

## Production checklist

See [`PRODUCTION.md`](./PRODUCTION.md) for the full pre-ship checklist (token-server pattern, observability wiring, region selection, etc.).

## Smoke test

Step-by-step verification matrix in [`SMOKE_TEST.md`](./SMOKE_TEST.md).

## Migration from 0.1.x

The 0.2.0 release reshaped the constructor from flat to grouped. The flat shape is still accepted with a one-time deprecation warning. To migrate:

```ts
// 0.1.x (still works, deprecated)
new AzureEngine({
  subscriptionKey: '...', region: 'eastus', language: 'en-US',
  emitPartials: true, outputFormat: 'detailed',
});

// 0.2.x (preferred)
new AzureEngine({
  auth: { subscriptionKey: '...', region: 'eastus' },
  recognition: { language: 'en-US', emitPartials: true, outputFormat: 'detailed' },
});
```

All other behavior is backward-compatible. See [`CHANGELOG.md`](./CHANGELOG.md) for the full list.

## License

MIT

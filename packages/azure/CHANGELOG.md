# Changelog

All notable changes to `@clarionhq/azure`.

## 0.2.0

Major hardening pass: **structured errors, mid-session resilience, lifecycle observers, custom-vocab biasing, silence detection, speaker-boundary events, token-provider auth, production observability.**

### Breaking

- **Constructor reshape** — options grouped into `{ auth, recognition, advanced?, telemetry? }`.

  Old flat shape still works (with one-time `console.warn`), will be removed in 1.0.

  ```ts
  // 0.1.x (deprecated)
  new AzureEngine({ subscriptionKey, region, language, emitPartials: true });

  // 0.2.x
  new AzureEngine({
    auth: { subscriptionKey, region },
    recognition: { language, emitPartials: true },
  });
  ```

### Added — Auth + tokens

- `auth.tokenProvider` callback variant — engine fetches fresh tokens on demand and **auto-refreshes** ~60 s before expiry.
- `engine.updateAuthToken(token)` for manual rotation.
- `warning[TOKEN_NEAR_EXPIRY]` event ahead of every refresh.
- `auth.tokenTtlMs` override (default: Azure's 10-minute TTL).

### Added — Resilience

- `advanced.autoRetry: { maxAttempts, baseDelayMs, retryOn }` — exponential-backoff retry on transient errors in `prepare()` / `start()`. Each retry emits `warning[RETRY_ATTEMPTED]`.
- `advanced.prepareTimeoutMs` (default 15 s) — hard cap on the WebSocket handshake. Rejects with `NETWORK_TIMEOUT` instead of hanging.
- `advanced.maxClockSkewMs` (default 5 min) — pre-flight clock-skew sanity check. Catches the common "device set to 1970" failure mode.
- `advanced.allowMultipleInstances` (default `false`) — second `AzureEngine` instance throws `INVALID_STATE` with an actionable hint.
- `advanced.autoStopOnBackground` (default `true`) — JS `AppState` observer stops the session cleanly when the app backgrounds. Emits `warning[BACKGROUNDED]`.
- **Network drop detection** via optional `@react-native-community/netinfo`. Brief blips emit a warning; sustained drops (>2 s grace) emit `error[NETWORK_DROPPED]` with `recoverable: true`.
- **JS auth pre-flight** in `prepare()` — POSTs to `https://{region}.api.cognitive.microsoft.com/sts/v1.0/issueToken` to validate `subscriptionKey + region` before audio opens. Bad key → instant `AUTH_FAILED`, wrong region → `INVALID_CONFIG`, 429 → `QUOTA_EXCEEDED`. Opt out via `advanced.skipAuthPreflight: true`.

### Added — Live UX

- `recognition.partialDebounceMs` (default 100 ms) — smooth `'partial'` event flicker without losing freshness.
- `recognition.silenceTimeoutMs` — server-side VAD; auto-stops the session after N ms of silence.
- `recognition.lowConfidenceThreshold` + new `'audio-confidence'` event — surface "audio looks unclear" hints to your UI.
- `recognition.phraseHints: string[]` — bias recognition on custom vocabulary via `SPXPhraseListGrammar` / `PhraseListGrammar`.
- New `'speech-started'` / `'speech-ended'` events — useful for "pulsing mic" UIs.

### Added — Production observability

- `telemetry.onSessionStart` / `onSessionEnd` / `onError` / `onWarning` / `onUsageUpdate` — structured callbacks for analytics + monitoring without re-binding the event listener.
- `engine.options` readonly getter — introspect what the engine was constructed with.
- `engine.replay(sessionId)` — re-emit persisted phrase finals after an app crash.
- `advanced.persistFinals: { storage }` — opt-in persistence to AsyncStorage / MMKV / any `{ getItem, setItem, removeItem }` shape.

### Added — Diarization

- `recognition.degradeOnTierMismatch` — if diarization init fails (e.g. F0 tier), fall back to non-diarization mode silently + emit a DEGRADED_MODE notice instead of failing `prepare()`.

### Added — Error shape

- `ClarionError` extended with:
  - `userMessage?: string` — non-technical, safe for UI.
  - `where?: ErrorOrigin` — `'config-validation' | 'prepare' | 'start' | 'mid-session' | …`
  - `retryAfterMs?: number` — backoff hint.
  - `openSettings?: boolean` — true for permission errors; pairs with `openAppSettings()` from `@clarionhq/core`.
  - `details: { sessionId, nativeCode, nativeDomain, region, requestId, … }` — JSON-safe payload for analytics.
  - `.toJSON()` for log pipelines.
- New typed error codes: `PERMISSION_REVOKED`, `TOKEN_EXPIRED`, `INVALID_CONFIG`, `AUDIO_SESSION_INTERRUPTED`, `AUDIO_ROUTE_CHANGED`, `NETWORK_DROPPED`, `DNS_FAILURE`, `SERVICE_DOWN`, `STORAGE_FULL`, `TIER_INSUFFICIENT`.

### Added — `'warning'` event type

Non-fatal advisory channel. Codes: `RETRY_ATTEMPTED`, `TOKEN_NEAR_EXPIRY`, `NETWORK_SLOW`, `AUDIO_ROUTE_CHANGED`, `DEGRADED_MODE`, `BACKGROUNDED`, `UNKNOWN`.

### Added — Region helpers

- `AZURE_REGIONS` constant — 30+ curated region slugs for autocomplete.
- `AZURE_DIARIZATION_REGIONS` — subset confirmed to host conversation transcriber.
- `isKnownAzureRegion(slug)` predicate.

### Added — Settings deep-link

- `openAppSettings()` from `@clarionhq/core` — wraps `Linking.openSettings()` for use in permission-error handlers.

### Fixed

- NSException from `SPXConversationTranscriber` init (diarization on unsupported tier) now caught via Obj-C trampoline and converted to a typed `UNSUPPORTED_FORMAT` error — no more app crashes.
- `release()` is fully idempotent.
- `stop()` no longer hangs on tail-event flush — resolves immediately, late phrase finals continue to surface as `'final'` events for ~2 s.
- Pre-warm via `SPXConnection.open()` was attempted, then removed — the SDK raises `SIGTRAP` (C++ abort) on some configs which can't be caught by Obj-C/Swift exception handlers. First `start()` carries the ~500 ms handshake instead; the JS auth pre-flight catches the common "bad key/region" issue earlier than that anyway.

### Internal

- `AzureSession` (iOS + Android) is now engine-agnostic via `AzureRecognizerEngine` protocol — same code path for `SPXSpeechRecognizer` and `SPXConversationTranscriber`.

---

## 0.1.0

Initial public release. Live speech-to-text via Microsoft Cognitive Services SDK; basic prepare/start/stop/discard/release lifecycle; iOS + Android.

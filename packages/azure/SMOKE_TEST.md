# Azure smoke-test checklist

End-to-end manual verification before declaring a release "ready." Run on each platform you ship.

Estimated time: **20 minutes per platform.**

## Pre-flight

- [ ] `pnpm -r typecheck` clean
- [ ] `pnpm -r build` clean
- [ ] `cd example/ios && pod install` (iOS) — required after any native source addition
- [ ] Gradle sync (Android) — required after any new Maven dep or AndroidManifest change
- [ ] Sim / device booted, mic permission unset (revoke + reinstall if needed)
- [ ] **F0 Azure key** + region in clipboard (don't paste in chat — paste straight in the app)
- [ ] Network: WiFi connected, can `ping eastus.stt.speech.microsoft.com`

## 1. Config validation (no native calls — should fail fast)

| Step | Expected |
|---|---|
| Paste subscription key `x` (too short) → Connect | `error[INVALID_CONFIG]: subscriptionKey looks too short` |
| Type region `East US` (uppercase + space) → Connect | `error[INVALID_CONFIG]: region "East US" doesn't look like an Azure region slug` |
| Type language `English` (not BCP-47) → Connect | `error[INVALID_CONFIG]: language "English" is not a BCP-47 tag` |
| Leave key empty → Connect | `error[INVALID_CONFIG]: Azure auth needs one of …` |
| Type endpoint `not-a-url` → Connect | `error[INVALID_CONFIG]: endpoint … is not a valid …` |

**Pass criteria**: all 5 fail at construction time, **before** any "connecting" UI appears.

## 2. Happy path

| Step | Expected |
|---|---|
| Paste valid F0 key + `eastus` + `en-US` → Connect | `pre-warmed: connection open, ready to start` within ~1 s |
| Tap Start | State flows `idle → preparing → ready → starting → recording`, all within ~300 ms |
| Speak: *"Hello, this is a test."* | Live partial updates (smoothed by the 100 ms debounce), phrase final appears |
| Speak more: *"Phrase number two."* | Second phrase final appears in the list |
| Tap Stop | State → `stopping → idle` instantly (optimistic stop), session-final shows stitched text |
| Detail panel | `LANG=en-US`, `CONF=` 70-100%, `OFFSET=` reasonable, `SEGMENTS=` count > 0 |

**Pass criteria**: end-to-end transcription with smooth UI; no errors in log.

## 3. Resilience — auto-retry

| Step | Expected |
|---|---|
| In credentials: paste an obviously wrong region (e.g. `eastusxyz`) | `error[NETWORK_UNAVAILABLE]` after a 1-2s retry sequence — log shows `warning[RETRY_ATTEMPTED]` lines first |
| Restore valid region → Connect again | Recovers cleanly |

**Pass criteria**: retry warnings visible in log; eventual surfacing of typed error after the budget is exhausted.

## 4. Resilience — prepareTimeoutMs (hard timeout)

| Step | Expected |
|---|---|
| Disable WiFi mid-Connect (after tapping but before "pre-warmed") | After ~15 s: `error[NETWORK_TIMEOUT]: prepare() timed out after 15000 ms.` |
| Re-enable WiFi → Connect again | Recovers |

**Pass criteria**: prepare doesn't hang forever; clean typed error surfaces.

## 5. Resilience — mid-session network drop

| Step | Expected |
|---|---|
| Start recording, speak | Phrase finals arriving |
| Disable WiFi while recording | First a brief `warning[UNKNOWN]: Network blip…`, then after ~2 s `error[NETWORK_DROPPED]` |
| Re-enable WiFi | `warning[UNKNOWN]: Network reconnected.` |

**Pass criteria**: NetInfo grace period works; warning before error.
**Note**: requires `@react-native-community/netinfo` installed; otherwise just a startup `warning` saying network monitoring is disabled.

## 6. Resilience — backgrounding

| Step | Expected |
|---|---|
| Start recording, speak | Phrase finals arriving |
| Background the app (Cmd+H on sim, home button on device) | `warning[BACKGROUNDED]`, state → `stopping → idle` |
| Foreground the app | No auto-resume (by design); start again to record more |

**Pass criteria**: app doesn't silently keep recording in background; clean stop on background event.

## 7. Singleton lock

| Step | Expected |
|---|---|
| In a JS test or hot-reload scenario, two `new AzureEngine({...})` calls without releasing | Second throws `error[INVALID_STATE]: Another AzureEngine instance is already alive.` |

**Pass criteria**: typed error with actionable hint.

## 8. Diarization

### 8a. Without diarization (default)
| Step | Expected |
|---|---|
| Connect → Start → speak | Phrase finals have `speakerId = ""` (no tag in UI) |

### 8b. With diarization on F0 (not supported)
| Step | Expected |
|---|---|
| Toggle "Speaker diarization" → Connect | `error[UNSUPPORTED_FORMAT]`: clear message about S0 tier requirement |

### 8c. With `degradeOnTierMismatch: true`
| Step | Expected |
|---|---|
| (Programmatically) set `recognition.degradeOnTierMismatch: true` + diarization on with F0 key | Engine connects in non-diarization mode + emits a `DEGRADED_MODE`-style error/warning |

### 8d. With diarization on S0 (if available)
| Step | Expected |
|---|---|
| Connect with S0 key → Start → speak in one voice, then change pitch noticeably | Two speaker tags appear (e.g. `Guest-1`, `Guest-2`), color-coded |

## 9. Silence-detection auto-stop

| Step | Expected |
|---|---|
| Set `recognition.silenceTimeoutMs: 3000` programmatically; Start; speak; then **stay silent for 4 s** | Session auto-ends without user tapping Stop; `'final'` event fires; state → `idle` |

**Pass criteria**: no need to manually stop after silence; clean termination.

## 10. Phrase hints

| Step | Expected |
|---|---|
| Set `recognition.phraseHints: ['Clarionhq', 'Margelo', 'Nitro']`; speak those terms | Service is biased toward exact spellings (compare without hints — those words are likely misrecognized) |

## 11. Token-provider mode

| Step | Expected |
|---|---|
| Configure `auth: { tokenProvider: async () => fetchTokenFromBackend(), region: 'eastus' }` | Engine calls `tokenProvider` on prepare. Connect → start → speak → success |
| After ~9 minutes | `warning[TOKEN_NEAR_EXPIRY]`; tokenProvider called again; session continues |
| Make tokenProvider throw | `error[AUTH_FAILED]: tokenProvider returned…` |

## 12. Persisted finals + replay

| Step | Expected |
|---|---|
| Configure `advanced.persistFinals: { storage: AsyncStorage }`; Start, speak 3 phrases, force-quit the app | Persisted in storage |
| Relaunch app, construct engine, call `engine.replay(sessionId)` | All 3 phrase finals re-emitted as `'final'` events |

## 13. Stress: rapid stop/start cycles

| Step | Expected |
|---|---|
| Loop 20× quickly: `await engine.start(); await engine.stop();` | No memory leaks, no crashes, no orphan WebSockets |

## 14. Custom endpoint

| Step | Expected |
|---|---|
| If you have a custom Azure speech endpoint (sovereign cloud / custom speech model): `auth: { endpoint: 'https://...', subscriptionKey: '...' }` | Engine connects + recognizes against the custom endpoint |

## 15. Real device (NOT just simulator)

| Platform | Notes |
|---|---|
| iOS device | Speech recognition tends to work the same as sim, but mic permission flow + audio session behavior is more representative |
| Android device | Same — and confirms 16 KB page-alignment works on the actual ABI |

**Pass criteria**: all of 1-13 pass on real hardware before declaring 1.0.

---

## Failure escalation

If any test fails, capture:
- The exact `error[CODE]: message` from the in-app event log
- The native log stream (iOS: `xcrun simctl spawn <udid> log stream --predicate 'process == "ClarionExample"'`; Android: `adb logcat | grep ClarionAzure`)
- The git SHA you're testing against

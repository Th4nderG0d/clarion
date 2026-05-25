# `@clarionhq/azure` — production checklist

Run through this before shipping Azure-backed transcription to real users. ~20 minutes if everything's in place; flag anything you skip so you remember to come back.

## 1. Auth — never ship the subscription key

✅ **Use a token-server pattern.** Your backend holds the subscription key; mobile fetches a short-lived (10 min default) token.

```ts
// Backend (Node.js mini-example)
app.post('/api/azure-token', requireAuth, async (req, res) => {
  const resp = await fetch(
    `https://${AZURE_REGION}.api.cognitive.microsoft.com/sts/v1.0/issueToken`,
    {
      method: 'POST',
      headers: { 'Ocp-Apim-Subscription-Key': process.env.AZURE_SPEECH_KEY },
    },
  );
  if (!resp.ok) return res.status(502).end();
  res.set('content-type', 'text/plain').send(await resp.text());
});

// Mobile
new AzureEngine({
  auth: {
    tokenProvider: async () => {
      const r = await fetchAuthorized('/api/azure-token');
      return r.text();
    },
    region: 'eastus',
  },
  recognition: { language: 'en-US' },
});
```

The engine auto-refreshes the token ~60 s before expiry. You get `warning[TOKEN_NEAR_EXPIRY]` for every refresh.

❌ Don't bundle `subscriptionKey` in the app — anyone running mitmproxy reads it.

## 2. Pick the right region

| User base | Recommended primary region |
|---|---|
| US | `eastus`, `westus2` |
| Europe | `westeurope`, `northeurope` |
| India | `centralindia` |
| Asia-Pacific | `southeastasia`, `japaneast` |
| LATAM | `brazilsouth`, `eastus` |

Latency to the region dominates first-connect time. Pick the closest one to **your users**, not your office. F0 is available in most regions.

```ts
import { AZURE_REGIONS, isKnownAzureRegion } from '@clarionhq/azure';
```

## 3. Wire telemetry

```ts
new AzureEngine({
  // ...
  telemetry: {
    onSessionStart: ({ sessionId, language }) => analytics.track('azure_session_start', { sessionId, language }),
    onSessionEnd:   summary => analytics.track('azure_session_end', summary),
    onError:        error   => analytics.track('azure_error', error.toJSON()),
    onWarning:      warn    => analytics.track('azure_warning', warn),
    onUsageUpdate:  ({ sessionId, elapsedMs }) => updateUsageMeter(sessionId, elapsedMs),
  },
});
```

Bin `onError.code` in your analytics tool so you can see "% of sessions hitting `NETWORK_DROPPED`" etc.

## 4. Enable auto-retry

```ts
{
  advanced: {
    autoRetry: {
      maxAttempts: 2,
      baseDelayMs: 500,
      retryOn: ['NETWORK_DROPPED', 'SERVICE_DOWN', 'NETWORK_UNAVAILABLE'],
    },
  },
}
```

Caller still sees retry attempts via `warning[RETRY_ATTEMPTED]` — surface a "retrying…" spinner if you want.

## 5. Handle backgrounding

The engine auto-stops on background by default and emits `warning[BACKGROUNDED]`. Show the user a "recording stopped" message and a "Resume" button (since auto-resume isn't safe — audio state is uncertain).

To opt out (rare):

```ts
{ advanced: { autoStopOnBackground: false } }
```

If you do this, also add `UIBackgroundModes: ['audio']` to Info.plist on iOS, otherwise the OS will suspend you anyway.

## 6. Surface permission errors with a deep-link

```ts
import { openAppSettings } from '@clarionhq/core';

engine.on(e => {
  if (e.type === 'error' && e.error.openSettings) {
    showAlert({
      title: 'Permission required',
      body: e.error.userMessage ?? e.error.message,
      primary: { label: 'Open Settings', onPress: () => openAppSettings() },
      secondary: { label: 'Cancel' },
    });
  }
});
```

## 7. Use silence-detection for hands-free UIs

```ts
{ recognition: { silenceTimeoutMs: 3000 } }
```

Auto-stops after 3 seconds of silence. Pairs well with `'speech-started'` / `'speech-ended'` events for "Tap to talk" UX where the user holds the button while speaking.

## 8. Boost custom vocabulary

If your app deals with product names, medical terms, jargon — pass them as `phraseHints`:

```ts
{ recognition: { phraseHints: ['Clarionhq', 'WHO', 'TSH', 'mg/dL'] } }
```

These get added to an `SPXPhraseListGrammar` and bias both partials + finals toward the exact spelling.

## 9. Recover from app crashes

```ts
import AsyncStorage from '@react-native-async-storage/async-storage';

new AzureEngine({
  // ...
  advanced: {
    persistFinals: { storage: AsyncStorage },
  },
});
```

On every phrase final the engine writes the accumulated list. On next launch, call `engine.replay(sessionId)` to re-emit them as `'final'` events. Store the `sessionId` in your own UI state.

## 10. Set realistic timeouts

```ts
{
  advanced: {
    prepareTimeoutMs: 10_000,  // tighter than the default 15s if you want faster failures on bad networks
  },
}
```

## 11. Cost guard

The F0 free tier gives 5 hours/month. Standard S0 is $1/audio-hour. Surface usage to your end user:

```ts
{
  telemetry: {
    onUsageUpdate: ({ sessionId, elapsedMs }) => {
      const minsThisMonth = recordTotal(elapsedMs);
      if (minsThisMonth > 4 * 60) showQuotaWarning();   // 4-of-5-hours warning
    },
  },
}
```

## 12. Always `release()` on unmount

```tsx
useEffect(() => {
  const engine = new AzureEngine({...});
  return () => { engine.release().catch(() => {}); };
}, []);
```

`release()` is idempotent — safe to double-call. **A hung session keeps billing.**

## 13. Add `@react-native-community/netinfo` (optional but recommended)

```sh
pnpm add @react-native-community/netinfo
cd ios && pod install
```

The engine auto-detects whether NetInfo is installed and turns on mid-session network drop detection if available. Without it, you'll still get errors on drops — just slower (you wait for Azure's WebSocket to time out instead of getting a fast NetInfo-based `NETWORK_DROPPED`).

## 14. iOS — Info.plist final state

```xml
<key>NSMicrophoneUsageDescription</key>
<string>Used to transcribe speech to text.</string>

<!-- Only if you set autoStopOnBackground: false -->
<key>UIBackgroundModes</key>
<array><string>audio</string></array>
```

## 15. Android — Manifest already correct

Nothing to add — `RECORD_AUDIO`, `INTERNET`, `ACCESS_NETWORK_STATE` are auto-merged. You DO need to request `RECORD_AUDIO` at runtime via `PermissionsAndroid`.

## 16. Test the smoke checklist

Run [`SMOKE_TEST.md`](./SMOKE_TEST.md) against a real device on each platform before shipping. ~20 min/platform.

---

## Quick rollout plan

For a soft launch:

1. Deploy token-server endpoint.
2. Ship to internal users with `telemetry.onError` wired to your error tracker.
3. Watch errors for 24-48h — common ones are `NETWORK_DROPPED` (expected on mobile, usually recoverable) and `AUDIO_SESSION_INTERRUPTED` (phone calls).
4. Roll forward.

The library is designed so the **only** non-recoverable errors are config bugs (`INVALID_CONFIG`) and tier-mismatches (`TIER_INSUFFICIENT`). Everything else is transient and should retry or degrade cleanly.

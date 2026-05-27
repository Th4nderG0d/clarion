# Clarion

[![Typecheck](https://github.com/Th4nderG0d/clarion/actions/workflows/typecheck.yml/badge.svg)](https://github.com/Th4nderG0d/clarion/actions/workflows/typecheck.yml)
[![Android](https://github.com/Th4nderG0d/clarion/actions/workflows/android.yml/badge.svg)](https://github.com/Th4nderG0d/clarion/actions/workflows/android.yml)
[![iOS](https://github.com/Th4nderG0d/clarion/actions/workflows/ios.yml/badge.svg)](https://github.com/Th4nderG0d/clarion/actions/workflows/ios.yml)

Pluggable audio + speech engines for React Native. One `ClarionEngine` interface across recording, on-device recognition, Azure cloud STT, shared mic fan-out, and hybrid routing. iOS + Android, New Architecture only, 16 KB compliant, built on [Nitro Modules](https://nitro.margelo.com).

A suite of composable engines behind one consistent interface — record to file, transcribe on-device, hit Microsoft Azure for cloud STT, share one mic across multiple consumers, or let the hybrid engine route between them automatically.

## Packages

| Package | Version | Purpose |
|---|---|---|
| [`@clarionhq/core`](packages/core) | `0.2.0` | Shared types, state machine, error taxonomy, telemetry contracts. Imported by every engine. |
| [`@clarionhq/recorder`](packages/recorder) | `0.1.2` | Microphone → AAC `.m4a`. Gapless pause/resume, audio-level meter, file rotation. |
| [`@clarionhq/recognizer`](packages/recognizer) | `0.1.0` | Platform speech recognition — `SFSpeechRecognizer` (iOS) / `SpeechRecognizer` (Android). Partial + final transcripts, per-word segments on iOS. |
| [`@clarionhq/azure`](packages/azure) | `0.2.0` | Microsoft Cognitive Services Speech SDK wrapper. Subscription key or token-provider auth, diarization, mid-session network-drop recovery. |
| [`@clarionhq/hybrid`](packages/hybrid) | _coming 0.1.0_ | Combines the above — connectivity-routed, race (fast partials + accurate finals), and capture-and-recognize modes. |
| [`@clarionhq/audio-tap`](packages/audio-tap) | _coming 0.1.0_ | Shared microphone fan-out: open the mic once, route PCM to multiple consumers. Used internally by `hybrid`. |

## Why

The React Native audio-and-speech ecosystem hadn't caught up to the New Architecture, Android 15's 16 KB page-size mandate, or modern Hermes / Fabric requirements. Clarion is built from scratch on top of Nitro Modules — no legacy bridge, no compatibility shims, no `requireNativeComponent`. Every engine shares the same `ClarionEngine` interface and event stream from `@clarionhq/core`, so swapping recorder for recognizer for azure is a config change.

Install and quick-start docs live in each package README.

## Repo

```
packages/
  core/        # @clarionhq/core
  recorder/    # @clarionhq/recorder
  …
example/       # bare RN app (also used for end-to-end testing)
```

Local development uses pnpm workspaces:

```sh
pnpm install
pnpm typecheck
cd example && pnpm start
```

## License

MIT

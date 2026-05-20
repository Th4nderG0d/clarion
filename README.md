# Clarion

[![Typecheck](https://github.com/Th4nderG0d/clarion/actions/workflows/typecheck.yml/badge.svg)](https://github.com/Th4nderG0d/clarion/actions/workflows/typecheck.yml)
[![Android](https://github.com/Th4nderG0d/clarion/actions/workflows/android.yml/badge.svg)](https://github.com/Th4nderG0d/clarion/actions/workflows/android.yml)
[![iOS](https://github.com/Th4nderG0d/clarion/actions/workflows/ios.yml/badge.svg)](https://github.com/Th4nderG0d/clarion/actions/workflows/ios.yml)

React Native audio and speech packages for Android and iOS. New Architecture only.

## Packages

| Package | Status | Purpose |
|---|---|---|
| [`@clarionhq/core`](packages/core) | **0.1** | Shared types, state machine, error taxonomy. Imported by every engine. |
| [`@clarionhq/recorder`](packages/recorder) | **0.1** | Microphone → AAC `.m4a`. 16 KB compliant. Gapless pause/resume, audio-level meter, file rotation. |
| [`@clarionhq/recognizer`](packages/recognizer) | **dev** | Platform speech recognition — `SFSpeechRecognizer` (iOS) / `SpeechRecognizer` (Android). Partial + final transcripts, per-word segments (iOS), availability checks. |

More engines are in development; this repo is the monorepo they will live in.

## Why

The React Native audio-recording ecosystem hadn't caught up to the New Architecture, Android 15's 16 KB page-size mandate, or modern Hermes / Fabric requirements. Clarion is built from scratch on top of [Nitro Modules](https://nitro.margelo.com) — no legacy bridge, no compatibility shims.

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

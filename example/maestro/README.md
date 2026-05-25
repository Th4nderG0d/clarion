# Clarion example — Maestro E2E flows

End-to-end smoke flows for the example app. Run on a booted simulator or device.

## Setup

```sh
# 1. Boot a sim/device first, then build + install the example app:
#    iOS:     pnpm --filter clarion-example run ios
#    Android: pnpm --filter clarion-example run android
# 2. Export your F0 key (don't commit it):
export CLARION_AZURE_KEY=...
export CLARION_AZURE_REGION=eastus
```

## Run

```sh
# Single flow:
maestro test example/maestro/azure-config-validation.yaml

# All flows:
maestro test example/maestro
```

## What's covered

| Flow | Smoke § | What it does |
|---|---|---|
| `azure-config-validation.yaml` | §1 | Pastes a too-short key, asserts inline error appears |
| `azure-happy-path.yaml` | §2 | Real key + region → expect transition to `recording`, stop, idle |
| `azure-bad-region.yaml` | §1/§3 | Wrong region → INVALID_CONFIG via pre-flight |
| `azure-singleton.yaml` | §7 | Hot-reload twice without release → second throws |
| `azure-reset-creds.yaml` | UX | Lock during recording, reset link disabled |

## What's NOT covered (still manual)

- Real speech transcription quality (§2 transcript accuracy, §10 phrase hints)
- Diarization on S0 tier (§8d)
- Custom endpoint / sovereign clouds (§14)
- Real device behaviors that differ from sim (§15)

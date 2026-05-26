# Changelog

## 0.1.0 — Unreleased

Initial scaffold. Real implementation lands across Phase A.2–A.6:

- Nitro spec for `ClarionAudioTap` (start/stop/format/consumer registry, PCM frame events)
- iOS native (`AVAudioEngine` input-node tap, ring buffer, multi-consumer fan-out)
- Android native (`AudioRecord` reader thread, ring buffer, fan-out)
- JS wrapper with consumer-handle API
- Vitest coverage for consumer lifecycle, backpressure, format negotiation

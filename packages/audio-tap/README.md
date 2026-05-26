# @clarionhq/audio-tap

Shared microphone fan-out for React Native: open the mic **once**, route the PCM stream to multiple consumers.

> **Status: scaffold (0.1.0 in progress).** Real surface lands across Phase A.2–A.6. This README will be filled in then.

## Why

iOS `AVAudioSession` and Android `AudioRecord` are single-consumer by design. If you want to record to a file **and** transcribe at the same time, or run two recognizers in parallel, you need a shared tap.

`@clarionhq/audio-tap` opens the mic once at the native layer, buffers PCM into a ring, and fans frames out to all registered consumers. Slow consumers drop frames — they don't stall the producer.

Used internally by [`@clarionhq/hybrid`](../hybrid). Can also be used standalone.

## License

MIT

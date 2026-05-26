export type {
  ClarionAudioTap,
  NativeAudioTapFormat,
  NativeAudioTapFrame,
  NativeAudioTapStats,
  NativeAudioTapError,
  FrameListener,
  StateListener,
  StatsListener,
  ErrorListener,
} from './specs/ClarionAudioTap.nitro';

export { AudioTap } from './AudioTap';
export type {
  AudioTapState,
  AudioTapFrame,
  AudioTapStats,
  AudioTapConsumer,
  DetachConsumer,
} from './AudioTap';

export {
  resolveAudioTapFormat,
  DEFAULT_AUDIO_TAP_OPTIONS,
} from './AudioTapConfig';
export type {
  AudioTapOptions,
  AudioTapSampleRate,
  AudioTapChannels,
  AudioTapFrameDurationMs,
} from './AudioTapConfig';

export const PACKAGE_NAME = '@clarionhq/audio-tap';

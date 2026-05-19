export type SampleRate = 8000 | 16000 | 22050 | 44100 | 48000;
export type ChannelCount = 1 | 2;
export type BitDepth = 16 | 24 | 32;

export interface AudioFormat {
  sampleRate: SampleRate;
  channels: ChannelCount;
  bitDepth: BitDepth;
}

export const DEFAULT_AUDIO_FORMAT: AudioFormat = {
  sampleRate: 16000,
  channels: 1,
  bitDepth: 16,
};

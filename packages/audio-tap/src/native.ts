import { NitroModules } from 'react-native-nitro-modules';
import type { ClarionAudioTap } from './specs/ClarionAudioTap.nitro';

/**
 * Construct a fresh native `ClarionAudioTap` instance. Each instance owns
 * its own microphone open — only call this once per logical tap.
 */
export const createNativeAudioTap = (): ClarionAudioTap =>
  NitroModules.createHybridObject<ClarionAudioTap>('ClarionAudioTap');

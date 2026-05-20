import { NitroModules } from 'react-native-nitro-modules';
import type { ClarionRecognizer } from './specs/ClarionRecognizer.nitro';

export const createNativeRecognizer = (): ClarionRecognizer =>
  NitroModules.createHybridObject<ClarionRecognizer>('ClarionRecognizer');

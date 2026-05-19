import { NitroModules } from 'react-native-nitro-modules';
import type { ClarionRecorder } from './specs/ClarionRecorder.nitro';

export const createNativeRecorder = (): ClarionRecorder =>
  NitroModules.createHybridObject<ClarionRecorder>('ClarionRecorder');

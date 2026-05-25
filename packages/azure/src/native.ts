import { NitroModules } from 'react-native-nitro-modules';
import type { ClarionAzure } from './specs/ClarionAzure.nitro';

export const createNativeAzure = (): ClarionAzure =>
  NitroModules.createHybridObject<ClarionAzure>('ClarionAzure');

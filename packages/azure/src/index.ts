export type {
  ClarionAzure,
  NativeAzureConfig,
  NativeAzureError,
  NativeTranscriptResult,
  NativeTranscriptSegment,
} from './specs/ClarionAzure.nitro';

export { AzureEngine, isAzureAvailable } from './AzureEngine';

export {
  AZURE_REGIONS,
  AZURE_DIARIZATION_REGIONS,
  isKnownAzureRegion,
} from './AzureRegions';
export type { AzureRegion } from './AzureRegions';

// Grouped option types (new 0.2.x surface — preferred).
export type {
  AzureEngineOptions,
  AzureAuth,
  AzureRecognition,
  AzureAdvanced,
  AzureAutoRetryConfig,
  AzureTelemetry,
  AzureOutputFormat,
  AzureProfanityFilter,
  /** @deprecated Flat 0.1.x options shape — accepted for back-compat, will be removed in 1.0. */
  FlatAzureEngineOptions,
} from './AzureEngine';

export const PACKAGE_NAME = '@clarionhq/azure';

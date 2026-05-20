export type {
  ClarionRecognizer,
  NativeRecognizerConfig,
  NativeTranscriptResult,
  NativeTranscriptSegment,
  NativeRecognizerError,
} from './specs/ClarionRecognizer.nitro';

export {
  RecognizerEngine,
  isRecognizerAvailable,
  supportedRecognizerLocales,
} from './RecognizerEngine';
export type { RecognizerEngineOptions } from './RecognizerEngine';

export const PACKAGE_NAME = '@clarionhq/recognizer';

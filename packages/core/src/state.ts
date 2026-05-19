export type EngineState =
  | 'idle'
  | 'preparing'
  | 'ready'
  | 'starting'
  | 'recording'
  | 'paused'
  | 'stopping'
  | 'error'
  | 'released';

export type EngineKind =
  | 'recorder'
  | 'native-recognizer'
  | 'azure-recognizer'
  | 'hybrid';

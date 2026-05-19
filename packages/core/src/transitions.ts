import { ClarionError } from './errors';
import type { EngineState } from './state';

const TRANSITIONS: Record<EngineState, readonly EngineState[]> = {
  idle: ['preparing', 'released'],
  preparing: ['ready', 'error', 'released'],
  ready: ['starting', 'released', 'error'],
  starting: ['recording', 'error', 'released'],
  recording: ['paused', 'stopping', 'error', 'released'],
  paused: ['recording', 'stopping', 'error', 'released'],
  stopping: ['ready', 'idle', 'error', 'released'],
  error: ['idle', 'released'],
  released: [],
};

export const canTransition = (from: EngineState, to: EngineState): boolean =>
  TRANSITIONS[from].includes(to);

export const assertTransition = (from: EngineState, to: EngineState): void => {
  if (!canTransition(from, to)) {
    throw new ClarionError({
      code: 'INVALID_STATE',
      message: `Illegal state transition: ${from} → ${to}`,
    });
  }
};

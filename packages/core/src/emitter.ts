import type { ClarionEvent, Listener, Unsubscribe } from './events';

export class ClarionEmitter {
  private listeners = new Set<Listener<ClarionEvent>>();

  on(listener: Listener<ClarionEvent>): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit(event: ClarionEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // Listener errors must not break the emit loop or other listeners.
      }
    }
  }

  removeAll(): void {
    this.listeners.clear();
  }

  get listenerCount(): number {
    return this.listeners.size;
  }
}

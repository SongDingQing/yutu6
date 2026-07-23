import { useSyncExternalStore } from 'react';

const listeners = new Set<() => void>();
let now = Date.now();
let timer: number | null = null;

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  if (timer === null) {
    timer = window.setInterval(() => {
      now = Date.now();
      for (const notify of listeners) notify();
    }, 1000);
  }
  return () => {
    listeners.delete(listener);
    if (!listeners.size && timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
  };
}

function getSnapshot(): number {
  return now;
}

export function useNow(): number {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

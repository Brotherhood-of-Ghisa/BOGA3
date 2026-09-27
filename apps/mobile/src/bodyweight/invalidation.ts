// Reading writes and applied sync pulls invalidate derived views after commit.
const listeners = new Set<() => void>();
export const subscribeToBodyWeightContext = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const invalidateBodyWeightContext = (): void => {
  for (const listener of listeners) {
    try { listener(); } catch { /* A view cannot fail a committed mutation. */ }
  }
};

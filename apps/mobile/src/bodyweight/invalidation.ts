// Reading, session-time, bodyweight and effort-policy changes invalidate
// every personal calculation projection.
const listeners = new Set<() => void>();
let revision = 0;

export const getBodyWeightContextRevision = (): number => revision;

export const subscribeToBodyWeightContext = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
};
export const invalidateBodyWeightContext = (): void => {
  revision += 1;
  for (const listener of listeners) {
    try { listener(); } catch { /* A view cannot fail a committed mutation. */ }
  }
};

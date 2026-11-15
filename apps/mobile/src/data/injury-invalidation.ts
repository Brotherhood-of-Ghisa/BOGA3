const listeners = new Set<() => void>();
let revision = 0;

export const getInjuriesRevision = (): number => revision;

export const subscribeToInjuries = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const invalidateInjuries = (): void => {
  revision += 1;
  for (const listener of listeners) {
    try {
      listener();
    } catch {
      // Listeners cannot fail a committed mutation.
    }
  }
};

type InvalidationListener = () => void;

const listeners = new Set<InvalidationListener>();

export const subscribeToExerciseCatalogInvalidation = (
  listener: InvalidationListener
): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const invalidateExerciseCatalogCache = (): void => {
  for (const listener of listeners) {
    listener();
  }
};

export const __resetExerciseCatalogInvalidationForTests = (): void => {
  listeners.clear();
};

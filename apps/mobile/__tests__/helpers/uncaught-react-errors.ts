/**
 * Collects the errors React reports through `window.dispatchEvent` so an
 * `afterEach` can fail the test that caused them. Wired up in `jest.setup.ts`,
 * which explains why the shim is needed at all.
 *
 * The sink never drops an error: one error is rethrown as itself, keeping its
 * message and stack, and several become an `AggregateError` that names every
 * one. A React error with nowhere to go is a bug, not noise.
 */
export type UncaughtErrorSink = {
  /**
   * Stands in for `window.dispatchEvent`, so it takes whatever event is
   * dispatched and keeps the `error` off it when there is one. `false` is the
   * DOM meaning of "preventDefault was called", which stops React
   * `console.error`-ing the error on top of the failure this produces.
   */
  record: (event: unknown) => false;
  /** Empties the sink: `null` when it held nothing, otherwise what to throw. */
  drain: () => unknown;
};

const describeError = (error: unknown): string =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

export const createUncaughtErrorSink = (): UncaughtErrorSink => {
  const errors: unknown[] = [];

  return {
    record: (event) => {
      const carriesError = typeof event === 'object' && event !== null && 'error' in event;
      errors.push(carriesError ? (event as { error?: unknown }).error : event);
      return false;
    },
    drain: () => {
      if (errors.length === 0) return null;
      const drained = errors.splice(0, errors.length);
      if (drained.length === 1) return drained[0];
      return new AggregateError(
        drained,
        `${String(drained.length)} uncaught React errors in one test: ${drained
          .map(describeError)
          .join('; ')}`
      );
    },
  };
};

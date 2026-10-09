import { waitFor } from '@testing-library/react-native';

type WaitForOptions = Parameters<typeof waitFor>[1];

/**
 * Waits until `query` finds nothing: `null` from a `queryBy*`, an empty array
 * from a `queryAllBy*`, or an array of several of those.
 *
 *   await waitForGone(() => screen.queryByTestId('today-progress-loading'));
 *   await waitForGone(() => [screen.queryByText('A'), screen.queryByText('B')]);
 *
 * Never `waitFor(() => expect(screen.queryBy…(…)).toBeNull())`: each failed
 * poll pretty-prints the found element's whole React fiber, which on a slow
 * runner outlasts waitFor's timeout — green locally, red on CI. This poll throws
 * a one-line error instead.
 */
export function waitForGone(query: () => unknown, options?: WaitForOptions): Promise<void> {
  return waitFor(() => {
    if (isPresent(query())) throw new Error(`Still on screen: ${String(query)}`);
  }, options);
}

const isPresent = (found: unknown): boolean => (Array.isArray(found) ? found.some(isPresent) : found != null);

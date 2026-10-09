import { waitFor } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

type WaitForOptions = Parameters<typeof waitFor>[1];

/**
 * Waits until `query` finds nothing: `null` from a `queryBy*`, an empty array
 * from a `queryAllBy*`, or an array of several of those. Any falsy value counts
 * as nothing, so a guarded query (`() => open && screen.queryBy…()`) works.
 *
 *   await waitForGone(() => screen.queryByTestId('today-progress-loading'));
 *   await waitForGone(() => [screen.queryByText('A'), screen.queryByText('B')]);
 *
 * Never `waitFor(() => expect(screen.queryBy…(…)).toBeNull())`: each failed
 * poll pretty-prints the found element's whole React fiber, which on a slow
 * runner outlasts waitFor's timeout — green locally, red on CI. This poll throws
 * a one-line error naming each element still found, never its subtree:
 * `Still on screen: <Text testID="leaving">A</Text>`.
 */
export function waitForGone(query: () => unknown, options?: WaitForOptions): Promise<void> {
  return waitFor(() => {
    const found = stillFound(query());
    if (found.length > 0) throw new Error(`Still on screen: ${found.map(describe).join(', ')}`);
  }, options);
}

const stillFound = (found: unknown): unknown[] => (Array.isArray(found) ? found.flatMap(stillFound) : found ? [found] : []);

const MAX_TEXT = 40;

/** Type, testID, accessibility label and (truncated) text of one element. */
function describe(found: unknown): string {
  if (!isElement(found)) return String(found);
  const type = typeof found.type === 'string' ? found.type : 'Composite';
  const { testID, accessibilityLabel } = found.props as { testID?: unknown; accessibilityLabel?: unknown };
  const label = found.props['aria-label'] ?? accessibilityLabel;
  const attributes = [
    typeof testID === 'string' ? ` testID="${testID}"` : '',
    typeof label === 'string' ? ` label="${label}"` : '',
  ].join('');
  const text = textOf(found);
  return `<${type}${attributes}>${text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT)}…` : text}</${type}>`;
}

const isElement = (found: unknown): found is ReactTestInstance =>
  typeof found === 'object' && found !== null && 'type' in found && 'props' in found && 'children' in found;

const textOf = (element: ReactTestInstance): string =>
  element.children.map((child) => (typeof child === 'string' ? child : textOf(child))).join('');

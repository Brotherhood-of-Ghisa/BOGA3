/**
 * `waitForGone` (helpers/wait-for-gone.ts): waits until a query finds nothing,
 * and fails with a one-line message rather than a printed fiber.
 */

import { render, screen } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import { Text } from 'react-native';

import { waitForGone } from './helpers/wait-for-gone';

function Leaves({ after }: { after: number }) {
  const [shown, setShown] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setShown(false), after);
    return () => clearTimeout(timer);
  }, [after]);
  return shown ? <Text testID="leaving">A</Text> : null;
}

it('resolves once a queryBy finds nothing', async () => {
  render(<Leaves after={20} />);
  expect(screen.getByTestId('leaving')).toBeTruthy();
  await waitForGone(() => screen.queryByTestId('leaving'));
});

it('treats an empty queryAllBy, or an array of empty queries, as gone', async () => {
  render(<Leaves after={20} />);
  await waitForGone(() => screen.queryAllByText('A'));
  await waitForGone(() => [screen.queryByText('A'), screen.queryAllByTestId('leaving')]);
});

it('fails with the query, not the element, when something stays on screen', async () => {
  render(<Leaves after={60_000} />);
  const wait = waitForGone(() => [null, screen.queryByTestId('leaving')], { timeout: 50 });
  await expect(wait).rejects.toThrow(/^Still on screen: .*queryByTestId\('leaving'\)/);
});

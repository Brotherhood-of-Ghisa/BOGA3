/**
 * `waitForGone` (helpers/wait-for-gone.ts): waits until a query finds nothing,
 * and fails with a one-line message naming what remains rather than a printed
 * fiber.
 */

import { render, screen } from '@testing-library/react-native';
import { useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

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

it('treats a falsy guarded query as gone', async () => {
  render(<Leaves after={60_000} />);
  for (const guard of [false, 0, '', undefined]) {
    await waitForGone(() => guard && screen.queryByTestId('leaving'), { timeout: 50 });
  }
  await waitForGone(() => [false, screen.queryAllByText('B')], { timeout: 50 });
});

it('fails naming each element still on screen, not the query or its fiber', async () => {
  render(
    <View>
      <Leaves after={60_000} />
      <Pressable accessibilityLabel="Select exercise Bench Press">
        <Text>Bench Press {'x'.repeat(60)}</Text>
      </Pressable>
    </View>
  );
  // A closure-built query: its source says nothing about what it found.
  const rows = (...names: string[]) => () => names.map((name) => screen.queryByLabelText(`Select exercise ${name}`));
  const wait = waitForGone(() => [null, screen.queryByTestId('leaving'), rows('Deadlift', 'Bench Press')()], { timeout: 50 });
  await expect(wait).rejects.toMatchObject({
    message: `Still on screen: <Text testID="leaving">A</Text>, <View label="Select exercise Bench Press">Bench Press ${'x'.repeat(28)}…</View>`,
  });
});

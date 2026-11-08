import { screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { Line } from 'react-native-svg';

import { RmCurveContent, type CurveScope } from '@/components/rm-curve/content';
import { DEFAULT_APPEARANCE } from '@/components/ui/theme-presets';
import { loadRmCurve } from '@/src/rm-curve/repository';

import wave from './fixtures/rm-curve-weekly-wave.json';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';
import { seedWaveHistory } from './helpers/rm-curve-history';
import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';

// The curve page draws in the roles of the saved appearance, so a save repaints
// the chart's gridlines, its legend dot and its text where they stand.

let mockFixture: InMemoryDatabaseFixture;
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: async () => mockFixture.database }));

const query = { exerciseDefinitionId: 'curve', start: new Date(wave.scenarios.plateau[0].startedAt),
  end: new Date(wave.scenarios.plateau.at(-1)!.completedAt + 1), historyLookbackWeeks: 52, gym: { gymId: 'synthetic-gym' } };
const scope: CurveScope = { range: 'history', gym: { gymId: 'synthetic-gym' }, rir: null };

const SLATE_DARK = { theme: 'slate', mode: 'dark', custom: null } as const;
const launch = rolesFor(DEFAULT_APPEARANCE);
const slate = rolesFor(SLATE_DARK);

beforeEach(() => { mockFixture = createInMemoryDatabase(); seedWaveHistory(mockFixture.database); });
afterEach(() => { mockFixture.close(); });

it('repaints the chart gridlines and the page text when the theme is saved', async () => {
  const model = (await loadRmCurve(query))!;
  const { UNSAFE_getAllByType } = renderWithTheme(
    <RmCurveContent scope={scope} onScope={jest.fn()} dateFormat="YYYY-MM-DD" historyWeeks={52} progressWeeks={4}
      read={{ status: 'ready', data: model, retry: jest.fn() }} />,
  );
  const label = () => StyleSheet.flatten(screen.getByText('REPS + RIR').props.style);
  expect(UNSAFE_getAllByType(Line)[0].props.stroke).toBe(launch.ruleSoft);
  expect(label().color).toBe(launch.inkMuted);

  await switchTheme(SLATE_DARK);

  expect(UNSAFE_getAllByType(Line)[0].props.stroke).toBe(slate.ruleSoft);
  expect(label().color).toBe(slate.inkMuted);
  expect(slate.inkMuted).not.toBe(launch.inkMuted);
});

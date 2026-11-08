import { screen } from '@testing-library/react-native';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';

import { ExerciseVolumeCard } from '@/components/session-complete/exercise-volume-card';
import { RecordBand } from '@/components/session-detail/record-band';
import { SetSummaryRow } from '@/components/session-detail/set-summary-row';
import { SessionSummaryLine } from '@/components/session-list/session-summary-line';
import { DEFAULT_APPEARANCE, type AppearanceChoice } from '@/components/ui/theme-presets';
import type { ExerciseVolumeComparison } from '@/src/session-insights';
import { formatSetRow } from '@/src/session-recorder/session-view-model';

import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';

// The session summary, the session detail and the session list repaint when a
// theme is saved: the roles they draw come from the provider, so a saved
// choice changes their colours without a remount.

const SLATE_DARK: AppearanceChoice = { theme: 'slate', mode: 'dark', custom: null };

const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as TextStyle & ViewStyle;

const distribution: ExerciseVolumeComparison = {
  exerciseDefinitionId: 'bench', exerciseName: 'Bench Press', sessionExerciseIds: ['bench'], sessionExerciseOrderIndex: 0,
  workingSetCount: 2, currentVolume: 500, historicalSessionCount: 6,
  medianVolume: 400, percentile25Volume: 300, percentile75Volume: 600, state: 'distribution',
};

describe('session summary, detail and list: live theme', () => {
  afterEach(async () => {
    await switchTheme(DEFAULT_APPEARANCE);
  });

  it('repaints the volume card in the session summary', async () => {
    const before = rolesFor(DEFAULT_APPEARANCE);
    const after = rolesFor(SLATE_DARK);
    expect(after.ink).not.toBe(before.ink);

    renderWithTheme(<ExerciseVolumeCard comparison={distribution} testID="card" />);
    const current = () => flat(screen.getByTestId('card-current', { includeHiddenElements: true }));
    expect(current().backgroundColor).toBe(before.ink);
    expect(flat(screen.getByText('Vol')).color).toBe(before.inkFaint);
    expect(flat(screen.getByText('25% above median')).color).toBe(before.gain);

    await switchTheme(SLATE_DARK);

    expect(current().backgroundColor).toBe(after.ink);
    expect(flat(screen.getByText('Vol')).color).toBe(after.inkFaint);
    expect(flat(screen.getByText('25% above median')).color).toBe(after.gain);
  });

  it('repaints a set row and the record band in the session detail', async () => {
    const before = rolesFor(DEFAULT_APPEARANCE);
    const after = rolesFor(SLATE_DARK);
    expect(after.recordWash).not.toBe(before.recordWash);
    const row = formatSetRow({ id: 'set', weight: 60, reps: 8, setType: 'rir_2', done: true });

    renderWithTheme(
      <>
        <SetSummaryRow row={row} testID="row" />
        <RecordBand lines={[{ key: 'a', label: 'New 1RM record · 116.7', set: '100.0 × 5', spoken: '' }]} placement="footer" testID="band" />
      </>,
    );
    expect(flat(screen.getByTestId('row-values')).color).toBe(before.ink);
    expect(flat(screen.getByTestId('band')).backgroundColor).toBe(before.recordWash);

    await switchTheme(SLATE_DARK);

    expect(flat(screen.getByTestId('row-values')).color).toBe(after.ink);
    expect(flat(screen.getByTestId('band')).backgroundColor).toBe(after.recordWash);
  });

  it('repaints the summary line of a session in the session list', async () => {
    const before = rolesFor(DEFAULT_APPEARANCE);
    const after = rolesFor(SLATE_DARK);
    expect(after.ink).not.toBe(before.ink);

    renderWithTheme(
      <SessionSummaryLine
        dateFormat="DD-MM-YYYY"
        session={{
          id: 's1', startedAt: '2026-02-20T17:30:00.000Z', status: 'completed', completedAt: '2026-02-20T18:15:00.000Z',
          durationSec: 2700, durationDisplay: '45m', gymName: 'Westside Barbell Club', exerciseCount: 4, setCount: 14,
          totalWeight: 6125, deletedAt: null, records: [],
        }}
        testIdPrefix="line"
      />,
    );
    const gym = () => flat(screen.getByText('Westside Barbell Club'));
    expect(gym().color).toBe(before.ink);

    await switchTheme(SLATE_DARK);

    expect(gym().color).toBe(after.ink);
  });
});

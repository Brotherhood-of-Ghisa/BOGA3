/* eslint-disable import/first */

/**
 * Bodyweight logging over real data: the production exercise page and session
 * view over the migrated in-memory SQLite database (helpers/local-data.ts),
 * seeded through the Maestro harness with the `bodyweight-rm-volume` fixture —
 * one Bodyweight Pull-Up (100% contribution) whose one performed set is
 * 0 kg × 10, in an active session that starts ten minutes ahead so a reading
 * saved now applies to it. Readings and the private preference go through
 * their real repositories; nothing in the data layer is faked.
 *
 * With calculations on and an 82 kg reading the set is 82 kg × 10: Volume 820
 * and a 1RM of 28.5 (the Wathan estimate less the bodyweight share). Off, or
 * with no reading, it is the ordinary 0 kg set: 1RM 0.0 and Volume 0.
 */

import * as mockReact from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

jest.mock('expo-router', () => ({
  Stack: { Screen: () => null },
  useRouter: () => ({ back: jest.fn(), canGoBack: () => true, push: jest.fn(), replace: jest.fn(), dismissTo: jest.fn() }),
  useNavigation: () => ({ addListener: () => () => undefined, dispatch: jest.fn() }),
  useLocalSearchParams: () => ({}),
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => callback(), [callback]);
  },
}));

import { ExercisePageScreen } from '@/components/exercise-page/exercise-page-screen';
import { SessionViewScreen } from '@/app/session/[sessionId]/index';
import {
  __resetBodyweightCalculationPreferenceForTests,
  setBodyweightCalculationsEnabled,
} from '@/src/bodyweight/calculation-preference';
import { deleteBodyWeightReading, saveBodyWeightReading } from '@/src/data/bodyweight';
import { userSettings } from '@/src/data/schema';
import { loadSessionSnapshotById } from '@/src/data/session-drafts';
import {
  bootLocalApp,
  closeLocalData,
  loadMaestroFixture,
  localDatabase,
  resetLocalData,
} from './helpers/local-data';

// A reading or preference write invalidates the exercise catalog, whose reload
// runs on Jest's synchronous SQLite driver: it can hold the event loop past
// waitFor's 1 s default when the full suite runs in parallel.
const AFTER_WRITE = { timeout: 5000 };

const SESSION = 'maestro_bw_active';
const EXERCISE = 'maestro_bw_exercise';
const ROW = `session-view-exercise-${EXERCISE}-set-1`;

const seed = async ({ calculations, readingKg }: { calculations: boolean; readingKg?: string }) => {
  await loadMaestroFixture('bodyweight-rm-volume');
  await act(async () => {
    await setBodyweightCalculationsEnabled(calculations);
    if (readingKg) await saveBodyWeightReading({ weightValue: readingKg, measuredAt: new Date() });
  });
  await bootLocalApp();
};

const openExercisePage = async () => {
  render(<ExercisePageScreen sessionId={SESSION} sessionExerciseId={EXERCISE} />);
  fireEvent.press(await screen.findByTestId('exercise-set-1-open'));
  return screen.findByTestId('exercise-set-logger-preview');
};

const setCalculations = async (enabled: boolean) => {
  await act(async () => {
    await setBodyweightCalculationsEnabled(enabled);
  });
};

const expectOrdinaryLogger = () => {
  expect(screen.getByText('Weight · kg')).toBeTruthy();
  expect(screen.getByLabelText('Set 1 weight in kilograms')).toBeTruthy();
  expect(screen.getByTestId('exercise-set-logger-weight').props.value).toBe('0');
  expect(screen.queryByTestId('exercise-set-unit-lb')).toBeNull();
  // No calculation-only field, reading, or session prompt on the logger.
  expect(screen.queryByText(/Added|External|Effective load|Body weight|Unavailable|missing/i)).toBeNull();
};

// The row's Stat figures read as one accessible label, e.g. `Vol 820`.
const rowFigure = (part: '1rm' | 'vol') => screen.getByTestId(`${ROW}-${part}`).props.accessibilityLabel;

const storedSet = async () => (await loadSessionSnapshotById(SESSION))?.exercises[0].sets[0];

describe('bodyweight logging over real data', () => {
  beforeEach(() => {
    resetLocalData();
    __resetBodyweightCalculationPreferenceForTests();
  });
  afterEach(closeLocalData);

  it('logs an ordinary kg set with numeric-zero figures while calculations are off', async () => {
    await seed({ calculations: false, readingKg: '82' });
    expect(await openExercisePage()).toHaveTextContent('1RM 0.0 · VOL 0');
    expectOrdinaryLogger();
  });

  it('recalculates only the figures, never the raw Weight, from the applicable dated reading', async () => {
    await seed({ calculations: true, readingKg: '82' });
    expect(await openExercisePage()).toHaveTextContent('1RM 28.5 · VOL 820');
    expectOrdinaryLogger();
    expect(await storedSet()).toMatchObject({ weightValue: '0', repsValue: '10' });
  });

  it('falls back to the ordinary figures without a warning when no reading applies', async () => {
    await seed({ calculations: true });
    expect(await openExercisePage()).toHaveTextContent('1RM 0.0 · VOL 0');
    expectOrdinaryLogger();
  });

  it('switches the figures silently across repeated off/on cycles and persists the preference', async () => {
    await seed({ calculations: true, readingKg: '82' });
    const preview = await openExercisePage();
    const stored = () => localDatabase().select().from(userSettings).get()?.bodyweightCalculationsEnabled;

    for (const [enabled, figures] of [[false, '1RM 0.0 · VOL 0'], [true, '1RM 28.5 · VOL 820'],
      [false, '1RM 0.0 · VOL 0'], [true, '1RM 28.5 · VOL 820']] as const) {
      await setCalculations(enabled);
      expect(preview).toHaveTextContent(figures);
      expect(stored()).toBe(enabled);
    }
    expect(await storedSet()).toMatchObject({ weightValue: '0', repsValue: '10' });
  });

  it('shows the session view row in the ordinary vocabulary and geometry, recalculating as readings change', async () => {
    await seed({ calculations: false });
    render(<SessionViewScreen sessionId={SESSION} />);
    await waitFor(() => expect(rowFigure('vol')).toBe('Vol 0'));
    const ordinaryStyle = screen.getByTestId(ROW).props.style;

    await setCalculations(true);
    let readingId = '';
    await act(async () => {
      readingId = (await saveBodyWeightReading({ weightValue: '82', measuredAt: new Date() })).id;
    });
    await waitFor(() => expect(rowFigure('vol')).toBe('Vol 820'), AFTER_WRITE);
    expect(screen.getByTestId(`${ROW}-values`)).toHaveTextContent('0.0 × 10');
    expect(rowFigure('1rm')).toBe('1RM 28.5');
    expect(screen.getByTestId(ROW).props.style).toEqual(ordinaryStyle);
    expect(screen.queryByText(/Added 1RM|BW \+|Effective load|Body weight/i)).toBeNull();

    // Editing or deleting the reading recalculates the open session, unprompted.
    await act(async () => {
      await saveBodyWeightReading({ id: readingId, weightValue: '90', measuredAt: new Date() });
    });
    await waitFor(() => expect(rowFigure('vol')).toBe('Vol 900'), AFTER_WRITE);
    await act(async () => {
      await deleteBodyWeightReading(readingId);
    });
    await waitFor(() => expect(rowFigure('vol')).toBe('Vol 0'), AFTER_WRITE);
    expect(screen.getByTestId(`${ROW}-values`)).toHaveTextContent('0.0 × 10');
  });
});

import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { eq } from 'drizzle-orm';
import { RmCurveScreen } from '@/components/rm-curve/screen';
import { bodyWeightMeasurements, exerciseDefinitions, exerciseSets, userSettings } from '@/src/data/schema';
import { notifyLocalWrite } from '@/src/sync/write-nudge';
import { updatePreferences } from '@/src/preferences/hooks';
import { loadRmCurve } from '@/src/rm-curve/repository';
import { rmCurveWindow } from '@/src/rm-curve/model';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';
import { seedWaveHistory } from './helpers/rm-curve-history';
import { waitForGone } from './helpers/wait-for-gone';
import wave from './fixtures/rm-curve-weekly-wave.json';

let mockFixture: InMemoryDatabaseFixture;
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: async () => mockFixture.database }));
const now = new Date(wave.scenarios.plateau.at(-1)!.completedAt + 1);
beforeEach(() => { mockFixture = createInMemoryDatabase(); seedWaveHistory(mockFixture.database); });
afterEach(() => mockFixture.close());

it('keeps the route exercise without a picker through effort/range changes and deletion refresh', async () => {
  mockFixture.database.insert(exerciseDefinitions).values({ id: 'empty', name: 'No history exercise' }).run();
  render(<RmCurveScreen exerciseDefinitionId="curve" now={now} />);
  await screen.findByTestId('rm-curve-plot');
  expect(screen.queryByLabelText(/^exercise:/)).toBeNull();
  expect(screen.queryByText('No history exercise')).toBeNull();
  expect(screen.getByLabelText('range: 12 weeks')).toBeTruthy(); expect(screen.queryByTestId('rm-curve-details')).toBeNull();
  fireEvent(screen.getByTestId('rm-curve-plot'), 'accessibilityTap');
  expect(screen.getByTestId('rm-curve-details')).toBeTruthy();
  fireEvent.press(screen.getByLabelText('effort: All known RIR')); fireEvent.press(screen.getByRole('radio', { name: 'RIR 4' }));
  await waitForGone(() => screen.queryByTestId('rm-curve-details'));
  await screen.findByTestId('rm-curve-plot');
  fireEvent.press(screen.getByLabelText('range: 12 weeks')); fireEvent.press(screen.getByRole('radio', { name: '4 weeks' }));
  await screen.findByText('3 sets · 1 session');
  expect(screen.getByTestId('rm-curve-plot')).toBeTruthy();
  act(() => {
    mockFixture.database.update(exerciseDefinitions).set({ deletedAt: now }).where(eq(exerciseDefinitions.id, 'curve')).run();
    notifyLocalWrite();
  });
  await screen.findByText('This exercise isn’t available'); expect(screen.queryByTestId('rm-curve-plot')).toBeNull();
  expect(screen.getByText('Return to History and choose an exercise.')).toBeTruthy();
  expect(screen.queryByLabelText(/^exercise:/)).toBeNull();
  expect(screen.queryByRole('button', { name: 'Choose exercise' })).toBeNull();
});

it('labels dated bodyweight-inclusive per-side Load separately from raw Weight and ordinary 1RM', async () => {
  const db = mockFixture.database;
  db.update(exerciseDefinitions).set({ loadInputMode: 'per_side_load', bodyweightContribution: 0.25 }).run();
  db.insert(userSettings).values({ id: 'settings', bodyweightCalculationsEnabled: true }).run();
  db.insert(bodyWeightMeasurements).values({ id: 'bodyweight', measuredAt: new Date(2025, 0, 1), weightKg: 80 }).run();
  render(<RmCurveScreen exerciseDefinitionId="curve" now={now} />);
  await screen.findByTestId('rm-curve-plot'); expect(screen.getByText('LOAD (WITH DATED BODYWEIGHT) · PER SIDE')).toBeTruthy();
  const model = (await loadRmCurve({ ...rmCurveWindow(52, now), exerciseDefinitionId: 'curve', gym: 'latest' }))!;
  fireEvent(screen.getByTestId('rm-curve-plot'), 'accessibilityTap');
  expect(screen.getByText('WEIGHT / 1RM · PER SIDE')).toBeTruthy();
  act(() => updatePreferences({ dateFormat: 'YYYY-MM-DD' }));
  await screen.findByText(/2026-06-15 · block 1, set 1/);
  act(() => { db.update(exerciseSets).set({ deletedAt: now }).where(eq(exerciseSets.id, model.observations[0].setId)).run(); notifyLocalWrite(); });
  await waitForGone(() => screen.queryByTestId('rm-curve-details'));
  await screen.findByTestId('rm-curve-plot');
});

it('keeps the chart and durable History limit available after unrelated preference validation fails', async () => {
  act(() => updatePreferences({ historyLookbackWeeks: 8 }));
  render(<RmCurveScreen exerciseDefinitionId="curve" now={now} />);
  await screen.findByTestId('rm-curve-plot');
  expect(screen.getByLabelText('range: 8 weeks (History limit)')).toBeTruthy();
  act(() => updatePreferences({ weeklyWorkingSetTarget: -1 }));
  const message = 'Weekly working-set target must be a positive whole number.';
  expect(screen.getByText(message)).toBeTruthy();
  expect(screen.getByTestId('rm-curve-plot')).toBeTruthy();
  fireEvent.press(screen.getByText('Retry'));
  expect(await screen.findByLabelText('range: 8 weeks (History limit)')).toBeTruthy();
  expect(screen.getByTestId('rm-curve-plot')).toBeTruthy();
  act(() => updatePreferences({ weeklyWorkingSetTarget: 12 }));
  await waitForGone(() => screen.queryByText(message));
});

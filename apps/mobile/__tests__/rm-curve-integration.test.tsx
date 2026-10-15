import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { eq } from 'drizzle-orm';
import { RmCurveContent } from '@/components/rm-curve/content';
import { RmCurveScreen } from '@/components/rm-curve/screen';
import { setDescription } from '@/components/rm-curve/details';
import { invalidateBodyWeightContext } from '@/src/bodyweight/invalidation';
import { bodyWeightMeasurements, exerciseDefinitions, exerciseSets, sessionExercises, sessions, userSettings } from '@/src/data/schema';
import { __resetExerciseCatalogCacheForTests } from '@/src/exercise-catalog/cache';
import { formatOneRepMax, formatWeight } from '@/src/exercise-calculations/format';
import { loadRmCurve } from '@/src/rm-curve/repository';
import { rmCurveWindow } from '@/src/rm-curve/model';
import { useRmCurve } from '@/src/rm-curve/use-rm-curve';
import { notifyLocalWrite } from '@/src/sync/write-nudge';
import { formatShortDate } from '@/src/utils/local-time';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';
import { seedWaveHistory } from './helpers/rm-curve-history';
import { waitForGone } from './helpers/wait-for-gone';
import wave from './fixtures/rm-curve-weekly-wave.json';
import oracle from './fixtures/rm-curve-weekly-wave-oracle.json';

let mockFixture: InMemoryDatabaseFixture;
let mockReadFailure = false;
// Only the unseedable storage failure is injected; successful reads use migrated SQLite.
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: async () => {
  if (mockReadFailure) throw new Error('Storage temporarily unavailable');
  return mockFixture.database;
} }));
const now = new Date(wave.scenarios.plateau.at(-1)!.completedAt + 1);
beforeEach(() => { mockFixture = createInMemoryDatabase(); mockReadFailure = false; __resetExerciseCatalogCacheForTests(); });
afterEach(() => mockFixture.close());

it('hides stale connected-screen values on storage failure and restores the selected set and filters on Retry', async () => {
  seedWaveHistory(mockFixture.database);
  render(<RmCurveScreen exerciseDefinitionId="curve" now={now} />);
  await screen.findByTestId('rm-curve-plot');
  const model = (await loadRmCurve({ ...rmCurveWindow(52, now), exerciseDefinitionId: 'curve' }))!;
  const selected = model.observations[0];
  fireEvent.press(screen.getByText('View sets'));
  fireEvent.press(screen.getByLabelText(setDescription(selected, 'DD-MM-YYYY')));
  const before = mockFixture.database.select().from(exerciseSets).all();
  act(() => { mockReadFailure = true; notifyLocalWrite(); });
  await screen.findByText('Couldn’t load sets');
  expect(screen.queryByTestId('rm-curve-plot')).toBeNull();
  expect(screen.queryByTestId('rm-curve-details')).toBeNull();
  expect(screen.getByLabelText('gym: Synthetic gym')).toBeTruthy();
  expect(screen.getByLabelText('range: 12 weeks')).toBeTruthy();
  mockReadFailure = false;
  fireEvent.press(screen.getByText('Retry'));
  await screen.findByTestId('rm-curve-details');
  expect(screen.getByText(`${formatShortDate(selected.completedAt, 'DD-MM-YYYY')} · block ${selected.blockOrder + 1}, set ${selected.setOrder + 1}`)).toBeTruthy();
  expect(screen.getByText(`${selected.reps} / ${selected.rir}`)).toBeTruthy();
  expect(screen.getByTestId('rm-selection-caret')).toBeTruthy();
  expect(mockFixture.database.select().from(exerciseSets).all()).toEqual(before);
});

it('keeps Unspecified gym separate and changes both plotted and fitting populations when the gym or effort changes', async () => {
  const db = mockFixture.database; seedWaveHistory(db);
  db.insert(sessions).values({ id: 'unspecified', startedAt: new Date(now.getTime() + 10000), completedAt: new Date(now.getTime() + 30000), status: 'completed' }).run();
  db.insert(sessionExercises).values({ id: 'unspecified-block', sessionId: 'unspecified', exerciseDefinitionId: 'curve', name: 'Synthetic exercise', orderIndex: 0 }).run();
  db.insert(exerciseSets).values({ id: 'unspecified-set', sessionExerciseId: 'unspecified-block', orderIndex: 0, weightValue: '10', repsValue: '5', setType: 'rir_1' }).run();
  render(<RmCurveScreen exerciseDefinitionId="curve" now={new Date(now.getTime() + 60000)} />);
  await screen.findByText('1 set · 1 session');
  expect(screen.getByLabelText('gym: Unspecified gym')).toBeTruthy();
  await screen.findByText('Exploratory fit');
  fireEvent.press(screen.getByLabelText('gym: Unspecified gym'));
  fireEvent.press(screen.getByRole('radio', { name: 'Synthetic gym' }));
  await screen.findByText('36 sets · 12 sessions');
  await screen.findByTestId('rm-fit-all');
  expect(screen.queryByTestId('rm-reference-line')).toBeNull();
  expect(screen.queryByTestId('rm-point-unspecified-set')).toBeNull();
  fireEvent.press(screen.getByLabelText('effort: All known RIR'));
  fireEvent.press(screen.getByRole('radio', { name: 'RIR 4' }));
  await screen.findByText('Exploratory fit');
  expect(screen.getByTestId('rm-curve-plot')).toBeTruthy();
  expect(screen.queryByTestId('rm-reference-line')).toBeNull();
  fireEvent.press(screen.getByLabelText('gym: Synthetic gym'));
  fireEvent.press(screen.getByRole('radio', { name: 'Unspecified gym' }));
  await screen.findByText('No sets match these filters');
  expect(screen.queryByTestId('rm-curve-plot')).toBeNull();
});

it('refreshes a selected bodyweight/per-side readout after a dated reading edit without rewriting logged sets', async () => {
  const db = mockFixture.database; seedWaveHistory(db);
  db.update(exerciseDefinitions).set({ loadInputMode: 'per_side_load', bodyweightContribution: 0.25 }).run();
  db.insert(userSettings).values({ id: 'settings', bodyweightCalculationsEnabled: true }).run();
  db.insert(bodyWeightMeasurements).values({ id: 'dated', measuredAt: new Date(2025, 0, 1), weightKg: 80 }).run();
  render(<RmCurveScreen exerciseDefinitionId="curve" now={now} />);
  await screen.findByTestId('rm-curve-plot');
  const query = { ...rmCurveWindow(52, now), exerciseDefinitionId: 'curve' };
  const initial = (await loadRmCurve(query))!.observations[0];
  fireEvent.press(screen.getByText('View sets')); fireEvent.press(screen.getByLabelText(setDescription(initial, 'DD-MM-YYYY')));
  const before = db.select().from(exerciseSets).all();
  act(() => { db.update(bodyWeightMeasurements).set({ weightKg: 90 }).where(eq(bodyWeightMeasurements.id, 'dated')).run(); invalidateBodyWeightContext(); });
  const updated = (await loadRmCurve(query))!.observations[0];
  expect(updated.loadKg - initial.loadKg).toBeCloseTo(1.25, 10);
  await screen.findByText(`${formatWeight(initial.weightKg)} / ${formatOneRepMax(updated.existingOneRepMax)}`);
  expect(screen.getByText(`Equivalent reps ${updated.equivalentReps} · Load ${formatWeight(updated.loadKg)} kg per side`)).toBeTruthy();
  expect(screen.getByTestId('rm-selection-caret')).toBeTruthy();
  expect(db.select().from(exerciseSets).all()).toEqual(before);
  act(() => { db.update(bodyWeightMeasurements).set({ deletedAt: now }).where(eq(bodyWeightMeasurements.id, 'dated')).run(); invalidateBodyWeightContext(); });
  await waitForGone(() => screen.queryByText('LOAD (WITH DATED BODYWEIGHT) · KG PER SIDE'));
  await screen.findByTestId('rm-curve-details');
  expect(screen.getByText('LOAD · KG PER SIDE')).toBeTruthy();
  expect(db.select().from(exerciseSets).all()).toEqual(before);
});

function PrefixPreview({ name, week }: { name: keyof typeof wave.scenarios; week: number }) {
  const read = useRmCurve({ exerciseDefinitionId: 'curve', start: new Date(wave.scenarios[name][0].startedAt),
    end: new Date(wave.scenarios[name][week * 3 - 1].completedAt + 1), historyLookbackWeeks: 52, accountRevision: 0 });
  return <RmCurveContent read={read} scope={{ exerciseId: 'curve', range: 24, rir: null }} onScope={() => undefined}
    exercises={[{ id: 'curve', name: 'Synthetic exercise' }]} catalogStatus="ready" retryCatalog={() => undefined} dateFormat="YYYY-MM-DD" historyWeeks={52} />;
}

it.each(['plateau', 'stable', 'gradual'] as const)('connects %s prefix views to real SQLite while fitting the current scope and preserving actual set details', async name => {
  seedWaveHistory(mockFixture.database, name);
  for (const week of [2, 14, 22]) {
    const expected = oracle.oracle.find(control => control.name === name)!.weekly[week - 1];
    const component = render(<PrefixPreview name={name} week={week} />);
    await screen.findByText(`${expected.sets} sets · ${expected.sessions} sessions`);
    await screen.findByText('Exploratory fit');
    expect(screen.queryByText(/Reference/)).toBeNull();
    expect(screen.queryByTestId('rm-point-week-24:1')).toBeNull();
    const first = wave.scenarios[name][(week - 1) * 3];
    const date = formatShortDate(new Date(first.completedAt), 'YYYY-MM-DD');
    fireEvent.press(screen.getByText('View sets'));
    fireEvent.press(screen.getByLabelText(new RegExp(`^${date} · block 1, set 1\\.`)));
    expect(screen.getByText(`${first.repsValue} / ${first.rir}`)).toBeTruthy();
    expect(screen.getByText(`${formatWeight(Number(first.weightValue))} / ${formatOneRepMax(first.rm)}`)).toBeTruthy();
    expect(screen.getByText(`Equivalent reps ${Number(first.repsValue) + first.rir} · Load ${formatWeight(Number(first.weightValue))} kg`)).toBeTruthy();
    expect(screen.queryByText(/structural break|significant|strength gain/i)).toBeNull();
    component.unmount();
  }
});

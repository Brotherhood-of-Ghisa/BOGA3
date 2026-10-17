import { fireEvent, render, screen } from '@testing-library/react-native';
import { periodColour } from '@/components/rm-curve/chart';
import { RmCurveScreen } from '@/components/rm-curve/screen';
import { loadRmCurve } from '@/src/rm-curve/repository';
import { ALL_GYMS, rmCurveWindow } from '@/src/rm-curve/model';
import { EXERCISE_PAGE_FIXTURE } from '@/src/maestro/exercise-page-fixture';
import { seedStrengthRegimesFixture } from '@/src/maestro/strength-regimes-fixture';
import { resetLocalData, closeLocalData, localDataClient } from './helpers/local-data';

jest.mock('@/src/data/bootstrap', () => require('./helpers/local-data').localDataBootstrapModule());
beforeEach(async () => { await resetLocalData(); });
afterEach(() => closeLocalData());

it('fits both temporal regimes over migrated SQLite, pools gyms, preserves selected logged metrics and leaves the active workout intact', async () => {
  const now = new Date(2026, 9, 15, 12);
  await seedStrengthRegimesFixture(now);
  const before = localDataClient().prepare('SELECT * FROM exercise_sets ORDER BY id').all();
  render(<RmCurveScreen exerciseDefinitionId={EXERCISE_PAGE_FIXTURE.benchExerciseId} now={now} />);
  await screen.findByTestId('rm-curve-plot');
  fireEvent.press(screen.getByLabelText('gym: Gym B'));
  fireEvent.press(screen.getByRole('radio', { name: 'All gyms' }));
  await screen.findByText('103 sets · 34 sessions');
  fireEvent.press(screen.getByTestId('rm-mode-two'));
  await screen.findByTestId('rm-fit-newer', {}, {timeout: 10000});
  expect(screen.getByTestId('rm-fit-older').props.stroke).not.toBe(screen.getByTestId('rm-fit-newer').props.stroke);
  expect(screen.getByTestId('rm-fit-newer').props.strokeDasharray).toBeTruthy();
  expect(screen.getByText('Exploratory fit')).toBeTruthy();
  const model = (await loadRmCurve({ ...rmCurveWindow(52, now), exerciseDefinitionId: EXERCISE_PAGE_FIXTURE.benchExerciseId, gymId: ALL_GYMS }))!;
  const newer = model.observations.find(p => p.setId === 'maestro_regime_31_set_0')!;
  fireEvent(screen.getByTestId('rm-curve-plot'), 'accessibilityTap');
  for (let i = 0; i < model.observations.indexOf(newer); i++) fireEvent.press(screen.getByLabelText('Previous set'));
  expect(screen.getByTestId('rm-selected-period').props.children).toMatch(/^From /);
  expect(screen.getByTestId('rm-selected-period').props.style).toContainEqual({ color: periodColour('newer') });
  fireEvent.press(screen.getByTestId('rm-method-joint'));
  // Identity is cleared immediately while the other method is fitting.
  expect(screen.queryByTestId('rm-selected-period')).toBeNull();
  await screen.findByTestId('rm-fit-newer', {}, { timeout: 10000 });
  expect(screen.getByTestId('rm-selected-period').props.children).toMatch(/^From /);
  expect(localDataClient().prepare('SELECT * FROM exercise_sets ORDER BY id').all()).toEqual(before);
});

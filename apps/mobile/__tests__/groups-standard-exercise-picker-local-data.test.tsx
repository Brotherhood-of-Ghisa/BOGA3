/* eslint-disable import/first */
jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- native database boundary.
  require('./helpers/local-data').localDataBootstrapModule());

/**
 * The group "From catalogue" search over the user's real muscle rows: it reads
 * the catalogue cache's muscle setup, so under Broad a merged entry matches by
 * its muscle and an untracked one not at all ([[muscle.no-breakdown]]). The
 * matching rules themselves are groups-exercise-view-model.test.ts.
 */
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { StandardExercisePicker } from '@/components/groups';
import { setMuscleReportPreset, setMuscleTracked } from '@/src/data/muscle-report-settings';
import { closeLocalData, resetLocalData } from './helpers/local-data';

beforeEach(() => resetLocalData());
afterEach(() => closeLocalData());

const search = async (query: string) => {
  fireEvent.changeText(screen.getByTestId('group-standard-exercise-search'), query);
  await act(async () => {});
};

it('matches the user\'s muscles: Detailed by entry, Broad by muscle, an untracked muscle not at all', async () => {
  render(<StandardExercisePicker onPick={jest.fn()} selectedId={null} />);
  await search('lats');
  expect(await screen.findByText('Lat Pulldown')).toBeTruthy();

  await act(async () => { await setMuscleReportPreset('broad'); });
  await search('lats');
  expect(screen.queryByText('Lat Pulldown')).toBeNull();
  await search('back pulldown');
  expect(await screen.findByText('Lat Pulldown')).toBeTruthy();

  await search('calves');
  expect(await screen.findByText('Standing Calf Raise')).toBeTruthy();
  await act(async () => { await setMuscleTracked(['calves', 'tibialis_anterior'], false); });
  await search('calves');
  expect(screen.queryByText('Standing Calf Raise')).toBeNull();
});

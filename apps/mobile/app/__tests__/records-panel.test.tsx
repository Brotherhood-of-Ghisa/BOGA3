/**
 * The exercise page's records panel, rendered directly with each records state:
 * loading and unavailable (which real data cannot hold still), the collapsed
 * Records / Last summaries, the expanded record lines, the last session's
 * detail, and both empty messages. The screen-level journey (switching views,
 * the History link, the gym filter) is in `exercise-page-screen.test.tsx`.
 */

import { render, screen, within } from '@testing-library/react-native';

import { RecordsPanel, type RecordsView } from '@/components/exercise-page/records-panel';
import type { ExerciseRecords, LastSession } from '@/src/session-recorder/exercise-records';
import type { ExerciseRecordsState } from '@/src/session-recorder/use-exercise-records';

const SEP_12 = new Date(2026, 8, 12, 18, 0);
const SEP_10 = new Date(2026, 8, 10, 18, 0);
const NOW = new Date(2026, 8, 14, 9, 0);

const NO_RECORDS: ExerciseRecords = { oneRepMax: null, maxWeight: null, volume: null };
const ALL_RECORDS: ExerciseRecords = {
  oneRepMax: { value: 142.5, completedAt: SEP_12, weight: 130, reps: 3, gymName: 'Iron Den' },
  maxWeight: { weight: 135, reps: 1, completedAt: SEP_10, gymName: 'Iron Den' },
  volume: { value: 3210.4, completedAt: SEP_12, setCount: 5, gymName: null },
};

const lastSession = (over: Partial<LastSession> = {}): LastSession => ({
  completedAt: SEP_12,
  gymName: 'Iron Den',
  oneRepMax: 140,
  volume: 1800,
  sets: [
    { setType: 'warm_up', weight: 60, reps: 8, oneRepMax: 75, volume: 480 },
    { setType: null, weight: 100, reps: 5, oneRepMax: 116.7, volume: null },
  ],
  ...over,
});

const ready = (records: ExerciseRecords, last: LastSession | null): ExerciseRecordsState => ({
  status: 'ready',
  summary: { records, last },
});

const renderPanel = (
  state: ExerciseRecordsState,
  { view = 'records', expanded = false, isFilteredByGym }: { view?: RecordsView; expanded?: boolean; isFilteredByGym?: boolean } = {},
) =>
  render(
    <RecordsPanel
      dateFormat="YYYY-MM-DD"
      expanded={expanded}
      isFilteredByGym={isFilteredByGym}
      now={NOW}
      onOpenHistory={jest.fn()}
      onSelectView={jest.fn()}
      onToggleExpanded={jest.fn()}
      state={state}
      view={view}
    />,
  );

const collapsedValues = () =>
  ['exercise-records-1rm', 'exercise-records-max', 'exercise-records-vol'].map((testID) =>
    within(screen.getByTestId(testID)).getAllByText(/./).map((node) => node.props.children).join(' '),
  );

const recordLabels = () =>
  ['exercise-record-1rm', 'exercise-record-max', 'exercise-record-vol'].map(
    (testID) => screen.getByTestId(testID).props.accessibilityLabel,
  );

describe('records panel while loading or unavailable', () => {
  it('shows dashes collapsed and a loading message expanded', () => {
    renderPanel({ status: 'loading' });
    expect(collapsedValues()).toEqual(['1RM —', 'Max —', 'Vol —']);
    expect(screen.queryByTestId('exercise-records-message')).toBeNull();

    renderPanel({ status: 'loading' }, { expanded: true });
    expect(screen.getByTestId('exercise-records-message')).toHaveTextContent('Loading records…');
  });

  it.each([false, true])('says records are unavailable after a failed read (expanded: %s)', (expanded) => {
    renderPanel({ status: 'error' }, { expanded });
    expect(screen.getByTestId('exercise-records-message')).toHaveTextContent('Records unavailable.');
    expect(screen.queryByTestId('exercise-records-collapsed')).toBeNull();
  });
});

describe('collapsed records panel', () => {
  it('sums up the all-time records', () => {
    renderPanel(ready(ALL_RECORDS, null));
    expect(collapsedValues()).toEqual(['1RM 142.5', 'Max 135.0', 'Vol 3210']);
  });

  it('shows dashes when there are no records', () => {
    renderPanel(ready(NO_RECORDS, null));
    expect(collapsedValues()).toEqual(['1RM —', 'Max —', 'Vol —']);
  });

  it('sums up the last session: best 1RM, heaviest set, volume', () => {
    renderPanel(ready(ALL_RECORDS, lastSession()), { view: 'last' });
    expect(collapsedValues()).toEqual(['1RM 140.0', 'Max 100.0', 'Vol 1800']);
    expect(screen.queryByTestId('exercise-records-volume-coverage')).toBeNull();
  });

  it('shows dashes and no coverage note when there is no last session', () => {
    renderPanel(ready(ALL_RECORDS, null), { view: 'last' });
    expect(collapsedValues()).toEqual(['1RM —', 'Max —', 'Vol —']);
    expect(screen.queryByTestId('exercise-records-volume-coverage')).toBeNull();
  });

  it('notes incomplete volume when the last session has sets of unknown load', () => {
    renderPanel(ready(ALL_RECORDS, lastSession({ oneRepMax: null, volume: null, knownVolume: 480, sets: [] })), {
      view: 'last',
    });
    expect(collapsedValues()).toEqual(['1RM —', 'Max —', 'Vol —']);
    expect(screen.getByTestId('exercise-records-volume-coverage')).toHaveTextContent('Volume: 480 · incomplete');
  });
});

describe('expanded records view', () => {
  it('lists each record with its date, gym and set', () => {
    renderPanel(ready(ALL_RECORDS, null), { expanded: true });
    expect(recordLabels()).toEqual([
      '1RM record 142.5, 2026-09-12 · Iron Den · 130.0 × 3',
      'Max record 135.0, 2026-09-10 · Iron Den · 1 reps',
      'Vol record 3210, 2026-09-12 · 5 sets',
    ]);
  });

  it('shows a dash and no detail for a missing record', () => {
    renderPanel(ready({ oneRepMax: null, maxWeight: ALL_RECORDS.maxWeight, volume: null }, null), { expanded: true });
    expect(recordLabels()).toEqual(['1RM record —', 'Max record 135.0, 2026-09-10 · Iron Den · 1 reps', 'Vol record —']);
  });

  it('shows dashes for missing Max and Vol records beside a 1RM', () => {
    renderPanel(ready({ oneRepMax: ALL_RECORDS.oneRepMax, maxWeight: null, volume: null }, null), { expanded: true });
    expect(recordLabels()).toEqual(['1RM record 142.5, 2026-09-12 · Iron Den · 130.0 × 3', 'Max record —', 'Vol record —']);
  });

  it('omits the gym when a record has none', () => {
    renderPanel(
      ready({ oneRepMax: { ...ALL_RECORDS.oneRepMax!, gymName: null }, maxWeight: { ...ALL_RECORDS.maxWeight!, gymName: undefined }, volume: { ...ALL_RECORDS.volume!, gymName: 'Home' } }, null),
      { expanded: true },
    );
    expect(recordLabels()).toEqual([
      '1RM record 142.5, 2026-09-12 · 130.0 × 3',
      'Max record 135.0, 2026-09-10 · 1 reps',
      'Vol record 3210, 2026-09-12 · Home · 5 sets',
    ]);
  });

  it.each<[boolean | undefined, string]>([
    [undefined, 'No completed sessions with this exercise yet.'],
    [true, 'No completed sessions for this gym yet.'],
  ])('shows the empty message when there are no records (filtered by gym: %s)', (isFilteredByGym, message) => {
    renderPanel(ready(NO_RECORDS, null), { expanded: true, isFilteredByGym });
    expect(screen.getByTestId('exercise-records-empty')).toHaveTextContent(message);
    expect(screen.queryByTestId('exercise-records-list')).toBeNull();
  });
});

describe('expanded last-session view', () => {
  it('shows the date, gym, age, best 1RM, volume and every set', () => {
    renderPanel(ready(ALL_RECORDS, lastSession()), { view: 'last', expanded: true });
    const last = screen.getByTestId('exercise-records-last');
    expect(within(last).getByText('2026-09-12 · Iron Den · 2d ago')).toBeTruthy();
    expect(within(last).getByText('1RM 140.0 · VOL 1800')).toBeTruthy();
    expect(within(screen.getByTestId('exercise-records-last-set-0')).getByText('60.0 × 8')).toBeTruthy();
    expect(within(screen.getByTestId('exercise-records-last-set-1')).getByText('100.0 × 5')).toBeTruthy();
  });

  it('omits the gym and dashes a missing 1RM, with incomplete volume', () => {
    renderPanel(ready(ALL_RECORDS, lastSession({ gymName: null, oneRepMax: null, volume: null, knownVolume: 480 })), {
      view: 'last',
      expanded: true,
    });
    const last = screen.getByTestId('exercise-records-last');
    expect(within(last).getByText('2026-09-12 · 2d ago')).toBeTruthy();
    expect(within(last).getByText('1RM — · VOL 480 · incomplete')).toBeTruthy();
  });

  it.each<[boolean | undefined, string]>([
    [undefined, 'No completed sessions with this exercise yet.'],
    [true, 'No completed sessions for this gym yet.'],
  ])('shows the empty message when there is no last session (filtered by gym: %s)', (isFilteredByGym, message) => {
    renderPanel(ready(ALL_RECORDS, null), { view: 'last', expanded: true, isFilteredByGym });
    expect(screen.getByTestId('exercise-records-empty')).toHaveTextContent(message);
  });
});

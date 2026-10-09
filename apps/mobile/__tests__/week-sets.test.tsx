import React from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';

import { WeekSetList } from '@/components/stats/week-set-list';
import { exerciseWeekBlocks, formatWeekDay, muscleWeekBlocks, useWeekSets, weekSetGroups, type WeekSetsTarget } from '@/components/stats/week-sets';
import type { CompletedSessionDetailCard } from '@/src/session-recorder/completed-session-detail-model';
import type { ExerciseHistorySessionEntry, MuscleSetContribution } from '@/src/data';
import { seedTodayProgressFixture } from '@/src/maestro/today-progress-fixture';
import { localWeekBounds } from '@/src/utils/calendar-weeks';

import { bootLocalApp, closeLocalData, resetLocalData } from './helpers/local-data';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule());

beforeEach(() => resetLocalData());
afterEach(() => closeLocalData());

const local = (day: number, hour = 8) => new Date(2026, 9, day, hour);

describe('week blocks and groups', () => {
  const contribution = (over: Partial<MuscleSetContribution>): MuscleSetContribution => ({
    working: true, volumeIncluded: true, setIdentity: 'set', muscleGroupId: 'chest', role: 'primary', roleWeight: 1,
    weightedVolume: 500, setVolume: 500, metrics: {} as MuscleSetContribution['metrics'], enteredWeightKg: 100,
    sessionId: 's1', sessionCompletedAt: local(7), sessionExerciseId: 'se1', exerciseDefinitionId: 'bench',
    exerciseName: 'Bench Press', setId: 'set', setOrderIndex: 0, setType: 'rir_2', weightValue: '100', repsValue: '5', ...over,
  });
  const card = (id: string, name: string, record: CompletedSessionDetailCard['record'] = []): CompletedSessionDetailCard =>
    ({ id, name, setCount: 2, rows: [], record });

  it('lists a muscle week once per block that worked it, titled by the card\'s exercise', () => {
    const blocks = muscleWeekBlocks([
      contribution({ setIdentity: 'a' }),
      contribution({ setIdentity: 'b' }),
      contribution({ setIdentity: 'c', sessionId: 's0', sessionExerciseId: 'se0', sessionCompletedAt: local(5) }),
    ]);
    expect(blocks.map(block => [block.sessionExerciseId, block.title, block.detail])).toEqual([
      ['se1', undefined, 'Wed 7 Oct'], ['se0', undefined, 'Mon 5 Oct'],
    ]);
    const band = [{ key: 'volume', label: 'New volume record · 1500', set: null, spoken: 'new volume record 1500' }];
    const groups = weekSetGroups(blocks, new Map([['s1', [card('se1', 'Bench Press', band)]], ['s0', [card('se0', 'Incline Press')]]]));
    expect(groups.map(group => [group.key, group.title, group.detail, group.record])).toEqual([
      ['se0', 'Incline Press', 'Mon 5 Oct', []],
      ['se1', 'Bench Press', 'Wed 7 Oct', band],
    ]);
  });

  it('lists an exercise week by day with its gym, leaving out a block without a card', () => {
    const entry = (sessionExerciseId: string, completedAt: Date, gymName: string | null) =>
      ({ sessionId: `s-${sessionExerciseId}`, sessionExerciseId, completedAt, gymName }) as unknown as ExerciseHistorySessionEntry;
    const blocks = exerciseWeekBlocks([entry('late', local(9), ' '), entry('early', local(6), 'Canal Street'), entry('empty', local(8), null)]);
    const groups = weekSetGroups(blocks, new Map([['s-late', [card('late', 'Bench')]], ['s-early', [card('early', 'Bench')]], ['s-empty', []]]));
    expect(groups.map(group => [group.title, group.detail, group.workingSetCount])).toEqual([
      ['Tue 6 Oct', 'Canal Street', 2],
      ['Fri 9 Oct', 'No gym', 2],
    ]);
    expect(formatWeekDay(local(11))).toBe('Sun 11 Oct');
  });

  it('bounds a week from its local Monday to the next, exclusive', () => {
    expect(localWeekBounds('2026-10-05')).toEqual({ start: new Date(2026, 9, 5), end: new Date(2026, 9, 12) });
  });
});

describe('useWeekSets over local data', () => {
  // 9 Oct 2026 10:00 is a Friday: this month's sessions on the 1st, 3rd, 5th, 7th and this morning.
  const seed = async () => {
    await bootLocalApp();
    await act(async () => { await seedTodayProgressFixture({ now: new Date(2026, 9, 9, 10) }); });
  };

  it('reads the selected week of an exercise, then of a muscle', async () => {
    await seed();
    const { result, rerender } = renderHook(({ target, week }: { target: WeekSetsTarget; week: string | null }) => useWeekSets(target, week),
      { initialProps: { target: { exerciseDefinitionId: 'seed_barbell_bench_press' }, week: '2026-10-05' } });
    await waitFor(() => expect(result.current.groups).toHaveLength(3));
    expect(result.current.groups.map(group => [group.title, group.detail, group.workingSetCount, group.rows.length])).toEqual([
      ['Mon 5 Oct', 'Canal Street Gym', 3, 3], ['Wed 7 Oct', 'Canal Street Gym', 3, 3], ['Fri 9 Oct', 'Canal Street Gym', 3, 3],
    ]);
    // Bench steps up to 87.5 on 5 Oct: as on View Session, the record set is highlighted and the card's band
    // carries one line for it (1RM and top weight) and a separate Volume line; the repeats that week hold none.
    const [first, second, third] = result.current.groups;
    expect(first.record.map(line => line.label)).toEqual([expect.stringMatching(/^New 1RM · [\d.]+ \+ top weight$/), expect.stringMatching(/^New volume record · /)]);
    expect(first.record[0].set).toBe('87.5 × 5');
    expect(first.rows.map(row => [row.oneRepMaxRecord, row.weightRecord])).toEqual([[true, true], [false, false], [false, false]]);
    expect([second.record, third.record]).toEqual([[], []]);

    rerender({ target: { muscleGroupIds: ['chest'] }, week: '2026-09-28' });
    expect(result.current.loading).toBe(true);
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.groups.map(group => [group.title, group.detail])).toEqual([
      ['Barbell Bench Press', 'Tue 29 Sep'], ['Barbell Bench Press', 'Thu 1 Oct'], ['Barbell Bench Press', 'Sat 3 Oct'],
    ]);

    rerender({ target: { muscleGroupIds: ['chest'] }, week: null });
    expect(result.current).toEqual({ groups: [], loading: false, error: null });
  });
});

describe('WeekSetList', () => {
  const group = { key: 'se1', sessionId: 's1', title: 'Mon 5 Oct', detail: 'Canal Street Gym', workingSetCount: 1,
    record: [{ key: 'r1', label: 'New top weight', set: '80.0 × 5', spoken: 'new top weight 80.0 × 5' }],
    rows: [{ id: 'r1', typeLabel: 'RIR 2', weightReps: '80.0 × 5', oneRepMax: '93.3', volume: '400', done: true, oneRepMaxRecord: false, weightRecord: false }] };

  it('opens a card\'s session', () => {
    const onOpenSession = jest.fn();
    render(<WeekSetList groups={[group]} loading={false} error={null} onOpenSession={onOpenSession} testID="week" />);
    expect(screen.getByTestId('week-card-se1-count')).toHaveTextContent('1 set');
    expect(screen.getByText('New top weight')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Open session from Mon 5 Oct, Canal Street Gym'));
    expect(onOpenSession).toHaveBeenCalledWith('s1');
  });

  it('shows loading, an error with retry, and an empty week', () => {
    const onRetry = jest.fn();
    const { rerender } = render(<WeekSetList groups={[]} loading error={null} onOpenSession={jest.fn()} testID="week" />);
    expect(screen.getByTestId('week-loading')).toBeTruthy();
    rerender(<WeekSetList groups={[]} loading={false} error="disk full" onOpenSession={jest.fn()} onRetry={onRetry} testID="week" />);
    fireEvent.press(screen.getByTestId('week-retry'));
    expect(onRetry).toHaveBeenCalled();
    rerender(<WeekSetList groups={[]} loading={false} error={null} onOpenSession={jest.fn()} testID="week" />);
    expect(screen.getByTestId('week-empty')).toHaveTextContent('No sets this week');
  });
});

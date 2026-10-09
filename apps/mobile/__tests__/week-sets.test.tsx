import React from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';

import { WeekSetList } from '@/components/stats/week-set-list';
import { exerciseWeekGroups, formatWeekDay, muscleWeekGroups, useWeekSets, type WeekSetsTarget } from '@/components/stats/week-sets';
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

describe('week set builders', () => {
  const contribution = (over: Partial<MuscleSetContribution>): MuscleSetContribution => ({
    working: true, volumeIncluded: true, setIdentity: 'set', muscleGroupId: 'chest', role: 'primary', roleWeight: 1,
    weightedVolume: 500, setVolume: 500, metrics: {} as MuscleSetContribution['metrics'], enteredWeightKg: 100,
    sessionId: 's1', sessionCompletedAt: local(7), sessionExerciseId: 'se1', exerciseDefinitionId: 'bench',
    exerciseName: 'Bench Press', setId: 'set', setOrderIndex: 0, setType: 'rir_2', weightValue: '100', repsValue: '5', ...over,
  });

  it('cards a muscle week per exercise block, oldest first, each set once and in order', () => {
    const groups = muscleWeekGroups([
      contribution({ setIdentity: 'b', setId: 'b', setOrderIndex: 1, weightValue: '105' }),
      contribution({ setIdentity: 'a', setId: 'a', setOrderIndex: 0 }),
      contribution({ setIdentity: 'a', setId: 'a', setOrderIndex: 0 }), // the same physical set again
      contribution({ setIdentity: 'w', setId: 'w', setOrderIndex: 2, working: false, setType: 'warmup' }),
      contribution({ setIdentity: 'c', setId: 'c', sessionId: 's0', sessionExerciseId: 'se0', sessionCompletedAt: local(5), exerciseName: null }),
    ]);
    expect(groups.map(group => [group.key, group.title, group.detail, group.workingSetCount, group.rows.map(row => row.id)])).toEqual([
      ['se0', 'Exercise', 'Mon 5 Oct', 1, ['c']],
      ['se1', 'Bench Press', 'Wed 7 Oct', 2, ['a', 'b', 'w']],
    ]);
    expect(groups[1].rows[1].weightReps).toBe('105.0 × 5');
  });

  it('cards an exercise week per session block, oldest first, titled by its day', () => {
    const entry = (sessionExerciseId: string, completedAt: Date, gymName: string | null) => ({
      sessionId: `s-${sessionExerciseId}`, sessionExerciseId, completedAt, gymName, tagIds: [], workingSetCount: 1,
      estimatedOneRepMax: null, totalVolume: null, topWeightSet: null,
      sets: [{ setId: `${sessionExerciseId}-1`, orderIndex: 0, weightValue: '60', repsValue: '8', setType: 'rir_2', isWorking: true }],
    }) as unknown as ExerciseHistorySessionEntry;
    expect(exerciseWeekGroups([entry('late', local(9), ' '), entry('early', local(6), 'Canal Street')])
      .map(group => [group.title, group.detail, group.rows.map(row => row.weightReps)])).toEqual([
      ['Tue 6 Oct', 'Canal Street', ['60.0 × 8']],
      ['Fri 9 Oct', 'No gym', ['60.0 × 8']],
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
    rows: [{ id: 'r1', typeLabel: 'RIR 2', weightReps: '80.0 × 5', oneRepMax: '93.3', volume: '400', done: true, oneRepMaxRecord: false, weightRecord: false }] };

  it('opens a card\'s session', () => {
    const onOpenSession = jest.fn();
    render(<WeekSetList groups={[group]} loading={false} error={null} onOpenSession={onOpenSession} testID="week" />);
    expect(screen.getByTestId('week-card-se1-count')).toHaveTextContent('1 set');
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

import React from 'react';
import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react-native';

import { WEEK_SETS_LOADING_DELAY_MS, WeekSetList } from '@/components/stats/week-set-list';
import { exerciseWeekBlocks, formatWeekDay, muscleWeekBlocks, useWeekSets, weekSetGroups, type WeekSetsTarget } from '@/components/stats/week-sets';
import type { CompletedSessionDetailCard } from '@/src/session-recorder/completed-session-detail-model';
import type { ExerciseHistorySessionEntry, MuscleSetContribution } from '@/src/data';
import { seedTodayProgressFixture } from '@/src/maestro/today-progress-fixture';
import { localWeekBounds } from '@/src/utils/calendar-weeks';
import * as sessionFacts from '@/src/data/exercise-session-facts';

import { bootLocalApp, closeLocalData, localDatabase, resetLocalData } from './helpers/local-data';
import { and, eq, gte, lt } from 'drizzle-orm';
import { sessions } from '@/src/data/schema';

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule());

beforeEach(() => resetLocalData());
afterEach(() => {
  jest.restoreAllMocks();
  closeLocalData();
});

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
    ], 'DD-MM-YYYY');
    expect(blocks.map(block => [block.sessionExerciseId, block.title, block.detail, block.role])).toEqual([
      ['se1', undefined, '07-10-2026', 'primary'], ['se0', undefined, '05-10-2026', 'primary'],
    ]);
    const band = [{ key: 'volume', label: 'New volume record · 1500', set: null, spoken: 'new volume record 1500' }];
    const groups = weekSetGroups(blocks, new Map([['s1', [card('se1', 'Bench Press', band)]], ['s0', [card('se0', 'Incline Press')]]]));
    // Newest first.
    expect(groups.map(group => [group.key, group.title, group.detail, group.record, group.exerciseDefinitionId])).toEqual([
      ['se1', 'Bench Press', '07-10-2026', band, 'bench'],
      ['se0', 'Incline Press', '05-10-2026', [], 'bench'],
    ]);
  });

  it('marks a muscle block primary when any of its sets worked the muscle as primary, else secondary', () => {
    const blocks = muscleWeekBlocks([
      contribution({ setIdentity: 'a', role: 'secondary' }),
      contribution({ setIdentity: 'b', role: 'primary' }),
      contribution({ setIdentity: 'c', sessionExerciseId: 'se2', role: 'secondary' }),
      contribution({ setIdentity: 'd', sessionExerciseId: 'se3', role: 'stabilizer' }),
    ], 'DD-MM-YYYY');
    expect(blocks.map(block => [block.sessionExerciseId, block.role])).toEqual([
      ['se1', 'primary'], ['se2', 'secondary'], ['se3', 'secondary'],
    ]);
    const groups = weekSetGroups(blocks, new Map([['s1', [card('se1', 'Bench'), card('se2', 'Dip'), card('se3', 'Fly')]]]));
    expect(groups.map(group => group.role)).toEqual(['primary', 'secondary', 'secondary']);
  });

  it('lists an exercise week by day with its gym, leaving out a block without a card', () => {
    const entry = (sessionExerciseId: string, completedAt: Date, gymName: string | null) =>
      ({ sessionId: `s-${sessionExerciseId}`, sessionExerciseId, completedAt, gymName }) as unknown as ExerciseHistorySessionEntry;
    const blocks = exerciseWeekBlocks([entry('late', local(9), ' '), entry('early', local(6), 'Canal Street'), entry('empty', local(8), null)], 'DD-MM-YYYY');
    const groups = weekSetGroups(blocks, new Map([['s-late', [card('late', 'Bench')]], ['s-early', [card('early', 'Bench')]], ['s-empty', []]]));
    // An exercise's own list links to no exercise: the page is that exercise's.
    expect(groups.map(group => [group.title, group.detail, group.exerciseDefinitionId, group.role])).toEqual([
      ['09-10-2026', 'No gym', null, null],
      ['06-10-2026', 'Canal Street', null, null],
    ]);
    expect(formatWeekDay(local(11), 'DD-MM-YYYY')).toBe('11-10-2026');
  });

  it('bounds a week from its local Monday to the next, exclusive', () => {
    expect(localWeekBounds('2026-10-05')).toEqual({ start: new Date(2026, 9, 5), end: new Date(2026, 9, 12) });
  });
});

describe('useWeekSets over local data', () => {
  // 9 Oct 2026 10:00 is a Friday in the 4-week period from 5 Oct: sessions on the 5th, 7th and this morning;
  // the previous period's every third day from 8 Sep reaches 29 Sep and 2 Oct.
  const seed = async () => {
    await bootLocalApp();
    await act(async () => { await seedTodayProgressFixture({ now: new Date(2026, 9, 9, 10), periodWeeks: 4 }); });
  };

  it('reads the selected week of an exercise, then of a muscle', async () => {
    await seed();
    const { result, rerender } = renderHook(({ target, week }: { target: WeekSetsTarget; week: string | null }) => useWeekSets(target, week),
      { initialProps: { target: { exerciseDefinitionId: 'seed_barbell_bench_press' }, week: '2026-10-05' } });
    await waitFor(() => expect(result.current.groups).toHaveLength(3));
    expect(result.current.groups.map(group => [group.title, group.detail, group.rows.length])).toEqual([
      ['09-10-2026', 'Canal Street Gym', 3], ['07-10-2026', 'Canal Street Gym', 3], ['05-10-2026', 'Canal Street Gym', 3],
    ]);
    // Bench steps up to 87.5 this morning: as on View Session, the record set is highlighted and the card's band
    // carries one line for it (1RM and top weight) and a separate Volume line; the earlier sessions that week hold none.
    const [third, second, first] = result.current.groups;
    expect(third.record.map(line => line.label)).toEqual([expect.stringMatching(/^New 1RM · [\d.]+ \+ top weight$/), expect.stringMatching(/^New volume record · /)]);
    expect(third.record[0].set).toBe('87.5 × 5');
    expect(third.rows.map(row => [row.oneRepMaxRecord, row.weightRecord])).toEqual([[true, true], [false, false], [false, false]]);
    expect([first.record, second.record]).toEqual([[], []]);

    rerender({ target: { exerciseDefinitionId: 'seed_barbell_bench_press' }, week: '2026-09-28' });
    // The same subject's last cards stay listed until the next week's read lands.
    expect(result.current.loading).toBe(true);
    expect(result.current.groups.map(group => group.title)).toEqual(['09-10-2026', '07-10-2026', '05-10-2026']);
    await waitFor(() => expect(result.current.loading).toBe(false));

    rerender({ target: { muscleGroupIds: ['chest'] }, week: '2026-09-28' });
    // Another subject never shows this one's cards.
    expect(result.current).toMatchObject({ loading: true, groups: [] });
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.groups.map(group => [group.title, group.detail, group.role])).toEqual([
      ['Barbell Bench Press', '02-10-2026', 'primary'], ['Barbell Bench Press', '29-09-2026', 'primary'],
    ]);

    rerender({ target: { muscleGroupIds: ['chest'] }, week: null });
    expect(result.current).toEqual({ groups: [], loading: false, error: null });
  });

  it('keeps an exercise week to its page\'s gym: every gym unset, no gym, or one gym', async () => {
    await seed();
    const midweek = and(gte(sessions.completedAt, local(7, 0)), lt(sessions.completedAt, local(8, 0)));
    const gymId = localDatabase().select({ gymId: sessions.gymId }).from(sessions).where(midweek).get()?.gymId;
    expect(gymId).toEqual(expect.any(String));
    localDatabase().update(sessions).set({ gymId: null }).where(midweek).run();
    const days = (groups: { title: string }[]) => groups.map(group => group.title);
    const { result, rerender } = renderHook(({ target }: { target: WeekSetsTarget }) => useWeekSets(target, '2026-10-05'),
      { initialProps: { target: { exerciseDefinitionId: 'seed_barbell_bench_press' } as WeekSetsTarget } });
    await waitFor(() => expect(days(result.current.groups)).toEqual(['09-10-2026', '07-10-2026', '05-10-2026']));
    expect(result.current.groups[1].detail).toBe('No gym');

    rerender({ target: { exerciseDefinitionId: 'seed_barbell_bench_press', gymId: null } });
    await waitFor(() => expect(days(result.current.groups)).toEqual(['07-10-2026']));
    rerender({ target: { exerciseDefinitionId: 'seed_barbell_bench_press', gymId: gymId! } });
    await waitFor(() => expect(days(result.current.groups)).toEqual(['09-10-2026', '05-10-2026']));
    rerender({ target: { muscleGroupIds: ['chest'], gymId: null } });
    await waitFor(() => expect(result.current.groups.map(group => group.detail)).toEqual(['07-10-2026']));
    rerender({ target: { muscleGroupIds: ['chest'], gymId: gymId! } });
    await waitFor(() => expect(result.current.groups.map(group => group.detail)).toEqual(['09-10-2026', '05-10-2026']));
    rerender({ target: { muscleGroupIds: ['chest'] } });
    await waitFor(() => expect(result.current.groups).toHaveLength(3));
  });

  it('still lists the cards, without records, when the records read fails', async () => {
    await seed();
    jest.spyOn(sessionFacts, 'loadEarlierBestsByDefinition').mockRejectedValue(new Error('facts unavailable'));
    const { result } = renderHook(() => useWeekSets({ exerciseDefinitionId: 'seed_barbell_bench_press' }, '2026-10-05'));
    await waitFor(() => expect(result.current.groups).toHaveLength(3));
    expect(result.current.error).toBeNull();
    expect(result.current.groups.flatMap(group => group.record)).toEqual([]);
  });
});

describe('WeekSetList', () => {
  const group = { key: 'se1', sessionId: 's1', title: '05-10-2026', detail: 'Canal Street Gym', exerciseDefinitionId: null, role: null,
    record: [{ key: 'r1', label: 'New top weight', set: '80.0 × 5', spoken: 'new top weight 80.0 × 5' }],
    rows: [{ id: 'r1', typeLabel: 'RIR 2', weightReps: '80.0 × 5', oneRepMax: '93.3', volume: '400', done: true, oneRepMaxRecord: false, weightRecord: false }] };

  it('opens a card\'s session', () => {
    const onOpenSession = jest.fn();
    render(<WeekSetList groups={[group]} loading={false} error={null} onOpenSession={onOpenSession} testID="week" />);
    // The header carries the detail in place of a set count.
    expect(screen.getByTestId('week-card-se1-count')).toHaveTextContent('Canal Street Gym');
    expect(screen.queryByTestId(/role-/, { includeHiddenElements: true })).toBeNull();
    expect(screen.getByText('New top weight')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Open session from 05-10-2026, Canal Street Gym'));
    expect(onOpenSession).toHaveBeenCalledWith('s1');
    // Without an exercise link the card offers nothing else.
    expect(screen.queryByTestId('week-card-se1-exercise')).toBeNull();
    expect(screen.getByTestId('week-card-se1').props.accessibilityActions).toBeUndefined();
  });

  describe('on a muscle\'s list', () => {
    const muscleGroup = { ...group, title: 'Bench Press', detail: '05-10-2026', exerciseDefinitionId: 'bench', role: 'primary' as const };
    const link = (canOpen: boolean) => ({ canOpen: jest.fn(() => canOpen), open: jest.fn() });

    it('opens the card\'s exercise from its progress button, and its session from the rest of the card', () => {
      const onOpenSession = jest.fn();
      const exerciseLink = link(true);
      render(<WeekSetList groups={[muscleGroup]} loading={false} error={null} exerciseLink={exerciseLink}
        onOpenSession={onOpenSession} testID="week" />);
      expect(exerciseLink.canOpen).toHaveBeenCalledWith('bench');
      fireEvent.press(screen.getByLabelText('Open Bench Press progress'));
      expect(exerciseLink.open).toHaveBeenCalledWith('bench');
      expect(onOpenSession).not.toHaveBeenCalled();
      fireEvent.press(screen.getByLabelText('Open session from Bench Press, 05-10-2026, Primary'));
      expect(onOpenSession).toHaveBeenCalledWith('s1');
      expect(exerciseLink.open).toHaveBeenCalledTimes(1);
    });

    it('offers VoiceOver the button as the card\'s action, since the card reads as one element', () => {
      const exerciseLink = link(true);
      render(<WeekSetList groups={[muscleGroup]} loading={false} error={null} exerciseLink={exerciseLink}
        onOpenSession={jest.fn()} testID="week" />);
      const card = screen.getByTestId('week-card-se1');
      expect(card).toHaveProp('accessibilityActions', [{ name: 'openExercise', label: 'Open Bench Press progress' }]);
      fireEvent(card, 'accessibilityAction', { nativeEvent: { actionName: 'magicTap' } });
      expect(exerciseLink.open).not.toHaveBeenCalled();
      fireEvent(card, 'accessibilityAction', { nativeEvent: { actionName: 'openExercise' } });
      expect(exerciseLink.open).toHaveBeenCalledWith('bench');
    });

    it('offers no button for an exercise the catalogue no longer holds, or a block without one', () => {
      render(<WeekSetList groups={[muscleGroup, { ...group, key: 'se2', exerciseDefinitionId: null }]} loading={false}
        error={null} exerciseLink={link(false)} onOpenSession={jest.fn()} testID="week" />);
      expect(screen.queryByTestId('week-card-se1-exercise')).toBeNull();
      expect(screen.getByTestId('week-card-se1').props.accessibilityActions).toBeUndefined();
      expect(screen.queryByTestId('week-card-se2-exercise')).toBeNull();
    });

    it('marks the block\'s primary or secondary work in its header, beside the date', () => {
      render(<WeekSetList groups={[muscleGroup, { ...muscleGroup, key: 'se2', role: 'secondary' }]} loading={false}
        error={null} exerciseLink={link(true)} onOpenSession={jest.fn()} testID="week" />);
      expect(screen.getByTestId('week-card-se1-count')).toHaveTextContent('05-10-2026');
      // Drawn inside the card, which reads as one element: its label names the role.
      expect(screen.getByTestId('week-card-se1-role-primary', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.getByTestId('week-card-se2-role-secondary', { includeHiddenElements: true })).toBeTruthy();
      expect(screen.getByLabelText('Open session from Bench Press, 05-10-2026, Secondary')).toBeTruthy();
    });
  });

  it('shows loading only for a read slower than its delay, keeps the last cards while loading, and shows an error with retry and an empty week', () => {
    jest.useFakeTimers();
    try {
      const { rerender } = render(<WeekSetList groups={[]} loading error={null} onOpenSession={jest.fn()} testID="week" />);
      // A quick read never draws the panel.
      expect(screen.queryByTestId('week-loading')).toBeNull();
      act(() => jest.advanceTimersByTime(WEEK_SETS_LOADING_DELAY_MS));
      expect(screen.getByTestId('week-loading')).toBeTruthy();
      rerender(<WeekSetList groups={[group]} loading error={null} onOpenSession={jest.fn()} testID="week" />);
      expect(screen.queryByTestId('week-loading')).toBeNull();
      expect(screen.getByTestId('week-card-se1')).toBeTruthy();
    } finally {
      jest.useRealTimers();
    }
  });

  it('shows an error with retry, and an empty week', () => {
    const onRetry = jest.fn();
    const { rerender } = render(<WeekSetList groups={[]} loading={false} error={null} onOpenSession={jest.fn()} testID="week" />);
    rerender(<WeekSetList groups={[]} loading={false} error="disk full" onOpenSession={jest.fn()} onRetry={onRetry} testID="week" />);
    fireEvent.press(screen.getByTestId('week-retry'));
    expect(onRetry).toHaveBeenCalled();
    rerender(<WeekSetList groups={[]} loading={false} error={null} onOpenSession={jest.fn()} testID="week" />);
    expect(screen.getByTestId('week-empty')).toHaveTextContent('No sets this week');
  });
});

/**
 * Today's progress figures, pure. The suite runs in Europe/London
 * (jest.config.js), so the windows are local calendar weeks there.
 * Which sets count, and which sessions load, are covered over a real database
 * in `progress-summary-repository.test.ts`.
 */
import type { StatsAggregationInput } from '@/src/data/stats';
import {
  deriveTodayProgress,
  todayProgressLoadWindow,
  workingSetsBySession,
  type LatestSessionSummary,
  type ProgressSession,
  type TodayProgress,
} from '@/src/progress-summary';

const local = (year: number, month: number, day: number, hour = 0, minute = 0) =>
  new Date(year, month - 1, day, hour, minute);
const justBefore = (instant: Date) => new Date(instant.getTime() - 1);

const LATEST: LatestSessionSummary = {
  id: 'latest',
  startedAt: local(2026, 3, 14, 17),
  completedAt: local(2026, 3, 14, 18),
  durationSec: 3600,
  gymName: 'Home',
  workingSets: 12,
  exerciseCount: 3,
  records: [{ kind: 'oneRepMax', exerciseName: 'Bench Press', value: 102.5, reps: null }],
};

const session = (id: string, completedAt: Date, workingSets: number): ProgressSession => ({ id, completedAt, workingSets });

const ready = (progress: TodayProgress) => {
  if (progress.status !== 'ready') throw new Error('expected a ready summary');
  return progress;
};

describe('deriveTodayProgress', () => {
  it('returns an explicit empty state when there is no completed session', () => {
    expect(deriveTodayProgress({ progressWeeks: 4, now: local(2026, 3, 15), sessions: [], prAchievedAt: [], latest: null }))
      .toEqual({ status: 'empty' });
  });

  it('counts this week until now and the whole previous calendar week, PRs on the boundary included once', () => {
    const now = local(2026, 3, 18, 12); // Wednesday; this week starts Monday 16 March
    const monday = local(2026, 3, 16);
    const { week } = ready(deriveTodayProgress({ progressWeeks: 4,
      now,
      sessions: [
        session('last-mon', local(2026, 3, 9, 7), 10),
        session('last-sun', justBefore(monday), 8),
        session('this-mon', monday, 5),
        session('this-wed', local(2026, 3, 18, 9), 6),
        session('at-now', now, 40),
        session('later-today', local(2026, 3, 18, 18), 40),
        session('older', justBefore(local(2026, 3, 9)), 99),
        session('after-today', local(2026, 3, 19), 40), // later this week, e.g. another device's clock
      ],
      prAchievedAt: [justBefore(monday), monday, monday, local(2026, 3, 9), now, local(2026, 3, 18, 18), local(2026, 3, 19)],
      latest: LATEST,
    }));

    expect(week.window).toEqual({ start: monday, end: local(2026, 3, 23) });
    expect(week.current).toEqual({ sessions: 2, workingSets: 11, prs: 2 });
    expect(week.previous).toEqual({ sessions: 2, workingSets: 18, prs: 2 });
  });

  it('uses the configured progress block, its preceding block and matching elapsed days', () => {
    const now = local(2026, 3, 10, 20);
    const { period } = ready(deriveTodayProgress({
      progressWeeks: 3, now, latest: LATEST,
      sessions: [
        session('prior-first', local(2026, 2, 2), 4),
        session('prior-same-day', local(2026, 2, 17, 23, 59), 6),
        session('prior-later', local(2026, 2, 18), 7),
        session('first', local(2026, 2, 23), 8),
        session('last', local(2026, 3, 10, 9), 12),
        session('future', now, 99),
      ],
      prAchievedAt: [local(2026, 2, 2), local(2026, 2, 23), now],
    }));
    expect(period.window).toEqual({ start: local(2026, 2, 23), end: local(2026, 3, 16) });
    expect([period.weeks, period.elapsedDays, period.totalDays]).toEqual([3, 16, 21]);
    expect(period.toDate).toEqual({ sessions: 2, workingSets: 20, prs: 1 });
    expect(period.cumulativeWorkingSets).toEqual([8, ...Array(14).fill(8), 20]);
    expect(period.projectedWorkingSets).toBe(26);
    expect(period.previous.window).toEqual({ start: local(2026, 2, 2), end: local(2026, 2, 23) });
    expect(period.previous.toSameDay).toEqual({ sessions: 2, workingSets: 10, prs: 1 });
    expect(period.previous.total.workingSets).toBe(17);
  });

  it.each([local(2026, 3, 29, 12), local(2026, 10, 25, 12)])('keeps daily indices and week lengths across DST: %s', now => {
    const { period } = ready(deriveTodayProgress({ progressWeeks: 1, now, latest: LATEST,
      sessions: [session('saturday', new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 18), 7)], prAchievedAt: [] }));
    expect([period.elapsedDays, period.totalDays]).toEqual([7, 7]);
    expect(period.cumulativeWorkingSets).toEqual([0, 0, 0, 0, 0, 7, 7]);
    expect(period.projectedWorkingSets).toBe(7);
  });

  it('projects from day one and shows zeros when the block has no training', () => {
    const input = { progressWeeks: 1, now: local(2026, 4, 6, 9), latest: LATEST, prAchievedAt: [] };
    const dayOne = ready(deriveTodayProgress({ ...input, sessions: [session('first', local(2026, 4, 6, 8), 20)] }));
    expect(dayOne.period.projectedWorkingSets).toBe(140);
    const quiet = ready(deriveTodayProgress({ ...input, sessions: [] }));
    expect(quiet.period.toDate).toEqual({ sessions: 0, workingSets: 0, prs: 0 });
    expect(quiet.period.cumulativeWorkingSets).toEqual([0]);
  });
});

describe('todayProgressLoadWindow', () => {
  it('covers the configured blocks through now, across month and year boundaries', () => {
    const now = local(2026, 10, 1, 9);
    expect(todayProgressLoadWindow(now, 3)).toEqual({ start: local(2026, 8, 24), end: now });
    const january = local(2027, 1, 1, 9);
    expect(todayProgressLoadWindow(january, 1)).toEqual({ start: local(2026, 12, 21), end: january });
  });
});

describe('workingSetsBySession', () => {
  it('lists each counted session with its working sets; a session without one is no session', () => {
    const input: StatsAggregationInput = {
      sessions: [
        { id: 'a', completedAt: local(2026, 3, 2) },
        { id: 'b', completedAt: local(2026, 3, 3) },
        { id: 'empty', completedAt: local(2026, 3, 4) },
        { id: 'warm-up-only', completedAt: local(2026, 3, 5) },
      ],
      sessionExercises: [
        { id: 'a-1', sessionId: 'a', exerciseDefinitionId: 'bench' },
        { id: 'a-2', sessionId: 'a', exerciseDefinitionId: null }, // unlinked legacy exercise still counts
        { id: 'b-1', sessionId: 'b', exerciseDefinitionId: 'bench' },
        { id: 'w-1', sessionId: 'warm-up-only', exerciseDefinitionId: 'bench' },
      ],
      exerciseSets: [
        { sessionExerciseId: 'a-1', setType: 'warm_up', weightValue: '60', repsValue: '5' },
        { sessionExerciseId: 'a-1', setType: 'rir_2', weightValue: '100', repsValue: '5' },
        { sessionExerciseId: 'a-1', setType: null, weightValue: '100', repsValue: '5' },
        { sessionExerciseId: 'a-2', setType: 'rir_1', weightValue: '20', repsValue: '10' },
        { sessionExerciseId: 'b-1', setType: 'rir_2', weightValue: '100', repsValue: '5', performanceStatus: 'planned' },
        { sessionExerciseId: 'b-1', setType: 'rir_2', weightValue: '100', repsValue: '' },
        { sessionExerciseId: 'b-1', setType: 'rir_0', weightValue: '', repsValue: '8' },
        { sessionExerciseId: 'orphan', setType: 'rir_2', weightValue: '100', repsValue: '5' },
        { sessionExerciseId: 'w-1', setType: 'warm_up', weightValue: '60', repsValue: '5' },
      ],
      muscleMappings: [],
      muscleGroups: [],
    };

    expect(workingSetsBySession(input).map(({ id, workingSets }) => [id, workingSets]))
      .toEqual([['a', 3], ['b', 1]]);
  });
});

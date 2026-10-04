/**
 * Today's progress figures, pure. The suite runs in Europe/London
 * (jest.config.js), so the windows are local calendar weeks and months there.
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
  prs: 1,
};

const session = (id: string, completedAt: Date, workingSets: number): ProgressSession => ({ id, completedAt, workingSets });

const ready = (progress: TodayProgress) => {
  if (progress.status !== 'ready') throw new Error('expected a ready summary');
  return progress;
};

describe('deriveTodayProgress', () => {
  it('returns an explicit empty state when there is no completed session', () => {
    expect(deriveTodayProgress({ now: local(2026, 3, 15), sessions: [], prAchievedAt: [], latest: null }))
      .toEqual({ status: 'empty' });
  });

  it('counts this week through today and the whole previous calendar week, PRs on the boundary included once', () => {
    const now = local(2026, 3, 18, 12); // Wednesday; this week starts Monday 16 March
    const monday = local(2026, 3, 16);
    const { week } = ready(deriveTodayProgress({
      now,
      sessions: [
        session('last-mon', local(2026, 3, 9, 7), 10),
        session('last-sun', justBefore(monday), 8),
        session('this-mon', monday, 5),
        session('this-wed', local(2026, 3, 18, 9), 6),
        session('older', justBefore(local(2026, 3, 9)), 99),
        session('after-today', local(2026, 3, 19), 40), // later this week, e.g. another device's clock
      ],
      prAchievedAt: [justBefore(monday), monday, monday, local(2026, 3, 9), local(2026, 3, 19)],
      latest: LATEST,
    }));

    expect(week.window).toEqual({ start: monday, end: local(2026, 3, 23) });
    expect(week.current).toEqual({ sessions: 2, workingSets: 11, prs: 2 });
    expect(week.previous).toEqual({ sessions: 2, workingSets: 18, prs: 2 });
  });

  it('builds this month by day to today, the previous month by day in full, and compares at the same day', () => {
    const now = local(2026, 3, 10, 20);
    const progress = ready(deriveTodayProgress({
      now,
      sessions: [
        session('feb-1', local(2026, 2, 1), 4), // the month's first instant
        session('feb-3', local(2026, 2, 3, 18), 6),
        session('feb-10-late', local(2026, 2, 10, 23, 59), 5), // still the same day
        session('feb-11', local(2026, 2, 11), 7), // past the same day
        session('feb-28', justBefore(local(2026, 3, 1)), 3),
        session('mar-1', local(2026, 3, 1), 8),
        session('mar-4', local(2026, 3, 4, 18), 12),
        session('mar-10', local(2026, 3, 10, 9), 10),
        session('mar-11', local(2026, 3, 11, 9), 50), // after today: not "to date"
      ],
      prAchievedAt: [local(2026, 2, 3, 18), local(2026, 2, 11), local(2026, 3, 1), local(2026, 3, 4, 18)],
      latest: LATEST,
    }));
    const { month } = progress;

    expect(month.window).toEqual({ start: local(2026, 3, 1), end: local(2026, 4, 1) });
    expect([month.dayOfMonth, month.daysInMonth]).toEqual([10, 31]);
    expect(month.cumulativeWorkingSets).toEqual([8, 8, 8, 20, 20, 20, 20, 20, 20, 30]);
    expect(month.toDate).toEqual({ sessions: 3, workingSets: 30, prs: 2 });
    expect(month.projectedWorkingSets).toBe(93); // 30 / 10 days × 31

    expect(month.previous.window).toEqual({ start: local(2026, 2, 1), end: local(2026, 3, 1) });
    expect(month.previous.daysInMonth).toBe(28);
    expect(month.previous.cumulativeWorkingSets).toHaveLength(28);
    expect(month.previous.cumulativeWorkingSets.slice(0, 11)).toEqual([4, 4, 10, 10, 10, 10, 10, 10, 10, 15, 22]);
    expect(month.previous.cumulativeWorkingSets[27]).toBe(25);
    expect(month.previous.toSameDay).toEqual({ sessions: 3, workingSets: 15, prs: 1 });
    expect(month.previous.total).toEqual({ sessions: 5, workingSets: 25, prs: 2 });
    expect(progress.latest).toBe(LATEST);
  });

  it('compares against the previous month\'s last day when that month is shorter', () => {
    const { month } = ready(deriveTodayProgress({
      now: local(2026, 3, 31, 8),
      sessions: [session('feb-28', local(2026, 2, 28, 18), 9), session('mar-31', local(2026, 3, 31, 7), 4)],
      prAchievedAt: [],
      latest: LATEST,
    }));

    expect(month.cumulativeWorkingSets).toHaveLength(31);
    expect(month.cumulativeWorkingSets[30]).toBe(4);
    expect(month.previous.toSameDay).toEqual(month.previous.total);
    expect(month.previous.toSameDay.workingSets).toBe(9);
    expect(month.projectedWorkingSets).toBe(4);
  });

  it('projects from the first day and reports zero with nothing logged this month', () => {
    const dayOne = ready(deriveTodayProgress({
      now: local(2026, 4, 1, 9),
      sessions: [session('apr-1', local(2026, 4, 1, 8), 20)],
      prAchievedAt: [],
      latest: LATEST,
    }));
    expect(dayOne.month.projectedWorkingSets).toBe(600); // 20 × 30 days

    const quiet = ready(deriveTodayProgress({ now: local(2026, 4, 12), sessions: [], prAchievedAt: [], latest: LATEST }));
    expect(quiet.month.toDate).toEqual({ sessions: 0, workingSets: 0, prs: 0 });
    expect(quiet.month.projectedWorkingSets).toBe(0);
    expect(quiet.month.cumulativeWorkingSets).toEqual(new Array(12).fill(0));
  });
});

describe('todayProgressLoadWindow', () => {
  it('starts at the previous month, which always holds last week\'s Monday', () => {
    // Thursday 1 Oct: last week starts Monday 21 Sep.
    expect(todayProgressLoadWindow(local(2026, 10, 1, 9))).toEqual({ start: local(2026, 9, 1), end: local(2026, 11, 1) });
    // Monday 1 March 2027: last week starts Monday 22 Feb.
    expect(todayProgressLoadWindow(local(2027, 3, 1))).toEqual({ start: local(2027, 2, 1), end: local(2027, 4, 1) });
  });

  it('runs to the end of a week that crosses into next month', () => {
    // Thursday 29 Oct 2026: this week ends Monday 2 Nov.
    expect(todayProgressLoadWindow(local(2026, 10, 29, 9))).toEqual({ start: local(2026, 9, 1), end: local(2026, 11, 2) });
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

/**
 * Today's progress figures, pure. The suite runs in Europe/London
 * (jest.config.js), so the windows are local calendar weeks and periods there.
 * Which sets count, and which sessions load, are covered over a real database
 * in `progress-summary-repository.test.ts`.
 */
import type { StatsAggregationInput } from '@/src/data/stats';
import {
  buildSessionExerciseLines,
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
  exercises: [],
};

const session = (id: string, completedAt: Date, workingSets: number): ProgressSession => ({ id, completedAt, workingSets });

const ready = (progress: TodayProgress) => {
  if (progress.status !== 'ready') throw new Error('expected a ready summary');
  return progress;
};

describe('deriveTodayProgress', () => {
  it('returns an explicit empty state when there is no completed session', () => {
    expect(deriveTodayProgress({ now: local(2026, 3, 15), periodWeeks: 4, sessions: [], prAchievedAt: [], latest: null }))
      .toEqual({ status: 'empty' });
  });

  it('counts this week until now and the whole previous calendar week, PRs on the boundary included once', () => {
    const now = local(2026, 3, 18, 12); // Wednesday; this week starts Monday 16 March
    const monday = local(2026, 3, 16);
    const { week } = ready(deriveTodayProgress({
      now,
      periodWeeks: 4,
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

  it('builds this period by day to today, the previous period by day in full, and compares at the same day', () => {
    // Friday 23 October 2026, 4-week periods: this one runs 5 Oct – 1 Nov, the previous 7 Sep – 4 Oct.
    const now = local(2026, 10, 23, 20);
    const progress = ready(deriveTodayProgress({
      now,
      periodWeeks: 4,
      sessions: [
        session('before', justBefore(local(2026, 9, 7)), 99),
        session('sep-7', local(2026, 9, 7), 4), // the previous period's first instant
        session('sep-9', local(2026, 9, 9, 18), 6),
        session('sep-25-late', local(2026, 9, 25, 23, 59), 5), // day 19, still the same day
        session('sep-26', local(2026, 9, 26), 7), // past the same day
        session('oct-4', justBefore(local(2026, 10, 5)), 3),
        session('oct-5', local(2026, 10, 5), 8),
        session('oct-8', local(2026, 10, 8, 18), 12),
        session('oct-23', local(2026, 10, 23, 9), 10),
        session('oct-24', local(2026, 10, 24, 9), 50), // after today: not "to date"
      ],
      prAchievedAt: [local(2026, 9, 9, 18), local(2026, 9, 26), local(2026, 10, 5), local(2026, 10, 8, 18)],
      latest: LATEST,
    }));
    const { period } = progress;

    expect(period.window).toEqual({ start: local(2026, 10, 5), end: local(2026, 11, 2) });
    expect([period.weeks, period.dayOfPeriod, period.daysInPeriod]).toEqual([4, 19, 28]);
    expect(period.cumulativeWorkingSets).toEqual([8, 8, 8, ...Array(15).fill(20), 30]);
    expect(period.toDate).toEqual({ sessions: 3, workingSets: 30, prs: 2 });
    expect(period.projectedWorkingSets).toBe(44); // 30 / 19 days × 28

    expect(period.previous.window).toEqual({ start: local(2026, 9, 7), end: local(2026, 10, 5) });
    expect(period.previous.cumulativeWorkingSets).toHaveLength(28);
    expect(period.previous.cumulativeWorkingSets.slice(0, 20)).toEqual([4, 4, ...Array(16).fill(10), 15, 22]);
    expect(period.previous.cumulativeWorkingSets[27]).toBe(25);
    expect(period.previous.toSameDay).toEqual({ sessions: 3, workingSets: 15, prs: 1 });
    expect(period.previous.total).toEqual({ sessions: 5, workingSets: 25, prs: 2 });
    expect(progress.latest).toBe(LATEST);
  });

  it.each([
    [1, local(2026, 10, 19), local(2026, 10, 26), 5],
    [6, local(2026, 10, 19), local(2026, 11, 30), 5],
  ])('takes its length from the Progress period: %i weeks', (periodWeeks, start, end, dayOfPeriod) => {
    const { period } = ready(deriveTodayProgress({
      now: local(2026, 10, 23, 9), periodWeeks, sessions: [], prAchievedAt: [], latest: LATEST,
    }));
    expect(period.window).toEqual({ start, end });
    expect(period.previous.window.end).toEqual(start);
    expect(period.dayOfPeriod).toBe(dayOfPeriod);
    expect(period.previous.cumulativeWorkingSets).toHaveLength(periodWeeks * 7);
  });

  it.each([local(2026, 3, 29, 12), local(2026, 10, 25, 12)])('keeps day indices across DST: %s', now => {
    const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 18);
    const { period } = ready(deriveTodayProgress({
      now, periodWeeks: 4, latest: LATEST, prAchievedAt: [],
      sessions: [session('yesterday', yesterday, 7), session('today', now, 3)],
    }));
    expect(period.cumulativeWorkingSets).toEqual([...Array(period.dayOfPeriod - 2).fill(0), 7, 10]);
    expect(period.toDate.workingSets).toBe(10);
  });

  it('projects from the first day and reports zero with nothing logged this period', () => {
    const dayOne = ready(deriveTodayProgress({
      now: local(2026, 11, 2, 9), // Monday: a new 4-week period
      periodWeeks: 4,
      sessions: [session('nov-2', local(2026, 11, 2, 8), 20)],
      prAchievedAt: [],
      latest: LATEST,
    }));
    expect(dayOne.period.dayOfPeriod).toBe(1);
    expect(dayOne.period.projectedWorkingSets).toBe(560); // 20 × 28 days

    const quiet = ready(deriveTodayProgress({ now: local(2026, 11, 13), periodWeeks: 4, sessions: [], prAchievedAt: [], latest: LATEST }));
    expect(quiet.period.toDate).toEqual({ sessions: 0, workingSets: 0, prs: 0 });
    expect(quiet.period.projectedWorkingSets).toBe(0);
    expect(quiet.period.cumulativeWorkingSets).toEqual(new Array(12).fill(0));
  });
});

describe('todayProgressLoadWindow', () => {
  it('runs from the previous period\'s first day to the end of this one', () => {
    expect(todayProgressLoadWindow(local(2026, 10, 23, 9), 4)).toEqual({ start: local(2026, 9, 7), end: local(2026, 11, 2) });
    expect(todayProgressLoadWindow(local(2026, 11, 2), 4)).toEqual({ start: local(2026, 10, 5), end: local(2026, 11, 30) });
  });

  it('is last week and this week when a period is one week', () => {
    // Thursday 29 Oct 2026: last week starts Monday 19 Oct; this week ends Monday 2 Nov.
    expect(todayProgressLoadWindow(local(2026, 10, 29, 9), 1)).toEqual({ start: local(2026, 10, 19), end: local(2026, 11, 2) });
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

describe("a session's exercise lines", () => {
  const fact = (exerciseDefinitionId: string, workingSets: number, bestE1rmSetId: string | null, ownPrE1rm = false) => ({
    exerciseDefinitionId,
    workingSets,
    bestE1rmKg: bestE1rmSetId ? 116.64 : null,
    bestE1rmSetId,
    ownPrE1rm,
  });
  const bestSets = new Map([['bench-best', { weightKg: 100, reps: 5 }], ['row-best', { weightKg: 70, reps: 8 }]]);

  it('keeps session order, one line per exercise, where it first appears, its best set the highest-1RM working set', () => {
    const lines = buildSessionExerciseLines(
      [
        { exerciseDefinitionId: 'bench', name: ' Bench Press ' },
        { exerciseDefinitionId: 'row', name: 'Row' },
        { exerciseDefinitionId: 'bench', name: 'Bench Press (again)' },
      ],
      [fact('row', 2, 'row-best'), fact('bench', 5, 'bench-best', true)],
      bestSets,
    );
    expect(lines).toEqual([
      { name: 'Bench Press', workingSets: 5, bestSet: { weightKg: 100, reps: 5, oneRepMaxKg: 116.64 }, oneRepMaxRecord: true },
      { name: 'Row', workingSets: 2, bestSet: { weightKg: 70, reps: 8, oneRepMaxKg: 116.64 }, oneRepMaxRecord: false },
    ]);
  });

  it('has no best set, and no PR, without a working set', () => {
    const lines = buildSessionExerciseLines(
      [
        { exerciseDefinitionId: 'curl', name: 'Curl' },
        { exerciseDefinitionId: 'press', name: 'Press' },
        { exerciseDefinitionId: null, name: 'Legacy lift' },
        { exerciseDefinitionId: null, name: 'Another legacy lift' },
      ],
      // Volume-only: a fact with no working set. A best set missing from the read.
      [fact('curl', 0, null, true), fact('press', 3, 'gone', true)],
      bestSets,
    );
    expect(lines.map((line) => [line.name, line.workingSets, line.bestSet, line.oneRepMaxRecord])).toEqual([
      ['Curl', 0, null, false],
      ['Press', 3, null, false],
      ['Legacy lift', 0, null, false],
      ['Another legacy lift', 0, null, false],
    ]);
  });
});

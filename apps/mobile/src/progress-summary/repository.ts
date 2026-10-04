// Today's progress read: the stats aggregation for sessions and working sets,
// the exercise session facts for 1RM PRs, and one small query for the latest
// completed session. Nothing here replays history.

import { and, count, desc, eq, isNotNull, isNull } from 'drizzle-orm';

import { bootstrapLocalDataLayer } from '@/src/data/bootstrap';
import { loadFlaggedExerciseSessionFacts } from '@/src/data/exercise-session-facts';
import { gyms, sessionExercises, sessions } from '@/src/data/schema';
import { createDrizzleStatsStore, type StatsStore } from '@/src/data/stats';
import { isInWindow, type LocalWindow } from '@/src/utils/local-calendar';

import {
  deriveTodayProgress,
  todayProgressLoadWindow,
  workingSetsBySession,
  type TodayProgress,
} from './calculations';

export type LatestCompletedSessionRow = {
  id: string;
  startedAt: Date;
  completedAt: Date;
  durationSec: number | null;
  gymName: string | null;
  /** Live exercises. */
  exerciseCount: number;
};

export type PrE1rmFact = { sessionId: string; achievedAt: Date };

export type ProgressSummaryStore = {
  loadAggregationInput: StatsStore['loadAggregationInput'];
  /** 1RM PR facts with `start <= completed_at < end`. */
  loadPrE1rmFacts(window: LocalWindow): Promise<PrE1rmFact[]>;
  /** The completed, non-deleted session with the latest `completed_at`. */
  loadLatestCompletedSession(): Promise<LatestCompletedSessionRow | null>;
};

export const createDrizzleProgressSummaryStore = (
  statsStore: Pick<StatsStore, 'loadAggregationInput'> = createDrizzleStatsStore(),
): ProgressSummaryStore => ({
  loadAggregationInput: statsStore.loadAggregationInput,
  async loadPrE1rmFacts({ start, end }) {
    const facts = await loadFlaggedExerciseSessionFacts({ from: start, to: end });
    return facts
      .filter((fact) => fact.prE1rm)
      .map((fact) => ({ sessionId: fact.sessionId, achievedAt: fact.achievedAt }));
  },
  async loadLatestCompletedSession() {
    const database = await bootstrapLocalDataLayer();
    const row = database
      .select({
        id: sessions.id,
        startedAt: sessions.startedAt,
        completedAt: sessions.completedAt,
        durationSec: sessions.durationSec,
        gymName: gyms.name,
      })
      .from(sessions)
      .leftJoin(gyms, eq(sessions.gymId, gyms.id))
      .where(and(eq(sessions.status, 'completed'), isNull(sessions.deletedAt), isNotNull(sessions.completedAt)))
      .orderBy(desc(sessions.completedAt), desc(sessions.id))
      .limit(1)
      .get();
    if (!row || row.completedAt === null) return null;
    const exercises = database
      .select({ value: count() })
      .from(sessionExercises)
      // Removed exercises stay as tombstones.
      .where(and(eq(sessionExercises.sessionId, row.id), isNull(sessionExercises.deletedAt)))
      .get();
    return { ...row, completedAt: row.completedAt, exerciseCount: exercises?.value ?? 0 };
  },
});

/** The window holding exactly one session's `completed_at`. */
const instantWindow = (instant: Date): LocalWindow => ({
  start: instant,
  end: new Date(instant.getTime() + 1),
});

export const createTodayProgressRepository = (
  store: ProgressSummaryStore = createDrizzleProgressSummaryStore(),
) => ({
  async loadTodayProgress(now: Date = new Date()): Promise<TodayProgress> {
    const latest = await store.loadLatestCompletedSession();
    if (latest === null) return deriveTodayProgress({ now, sessions: [], prAchievedAt: [], latest: null });

    const range = todayProgressLoadWindow(now);
    const [aggregation, prFacts] = await Promise.all([
      store.loadAggregationInput(range),
      store.loadPrE1rmFacts(range),
    ]);
    const sessionsInRange = workingSetsBySession(aggregation);
    // The latest session is nearly always inside the range; read it alone only when older.
    const [latestSessions, latestPrFacts] = isInWindow(latest.completedAt, range)
      ? [sessionsInRange, prFacts]
      : await Promise.all([
          store.loadAggregationInput(instantWindow(latest.completedAt)).then(workingSetsBySession),
          store.loadPrE1rmFacts(instantWindow(latest.completedAt)),
        ]);
    return deriveTodayProgress({
      now,
      sessions: sessionsInRange,
      prAchievedAt: prFacts.map((fact) => fact.achievedAt),
      latest: {
        ...latest,
        workingSets: latestSessions.find((session) => session.id === latest.id)?.workingSets ?? 0,
        prs: latestPrFacts.filter((fact) => fact.sessionId === latest.id).length,
      },
    });
  },
});

const defaultTodayProgressRepository = createTodayProgressRepository();

export const loadTodayProgress = defaultTodayProgressRepository.loadTodayProgress;

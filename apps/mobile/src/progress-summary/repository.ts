// Today's progress read: the stats aggregation for sessions and working sets,
// the exercise session facts for PRs (every record kind), and one small query
// for the latest completed session. Nothing here replays history.

import { and, count, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import { bootstrapLocalDataLayer } from '@/src/data/bootstrap';
import { loadFlaggedExerciseSessionFacts, type ExerciseSessionFactRow } from '@/src/data/exercise-session-facts';
import { exerciseDefinitions, exerciseSets, gyms, sessionExercises, sessions } from '@/src/data/schema';
import { createDrizzleStatsStore, type StatsStore } from '@/src/data/stats';
import { parseSetReps } from '@/src/exercise-calculations/parse';
import { sessionRecordKinds, type RecordKind } from '@/src/exercise-calculations/records';
import { isInWindow, type LocalWindow } from '@/src/utils/local-calendar';

import {
  deriveTodayProgress,
  todayProgressLoadWindow,
  workingSetsBySession,
  type SessionPersonalRecord,
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

/** One PR: a session, an exercise and one record kind it took. */
export type PersonalRecordFact = SessionPersonalRecord & { sessionId: string; achievedAt: Date };

export type ProgressSummaryStore = {
  loadAggregationInput: StatsStore['loadAggregationInput'];
  /** The PRs with `start <= completed_at < end`, one per record kind, in PR-history order. */
  loadRecordFacts(window: LocalWindow): Promise<PersonalRecordFact[]>;
  /** The completed, non-deleted session with the latest `completed_at`. */
  loadLatestCompletedSession(): Promise<LatestCompletedSessionRow | null>;
};

export const createDrizzleProgressSummaryStore = (
  statsStore: Pick<StatsStore, 'loadAggregationInput'> = createDrizzleStatsStore(),
): ProgressSummaryStore => ({
  loadAggregationInput: statsStore.loadAggregationInput,
  async loadRecordFacts({ start, end }) {
    const facts = await loadFlaggedExerciseSessionFacts({ from: start, to: end });
    if (facts.length === 0) return [];
    const database = await bootstrapLocalDataLayer();
    const definitionIds = [...new Set(facts.map((fact) => fact.exerciseDefinitionId))];
    const names = new Map(database
      .select({ id: exerciseDefinitions.id, name: exerciseDefinitions.name })
      .from(exerciseDefinitions)
      .where(inArray(exerciseDefinitions.id, definitionIds))
      .all()
      .map((row) => [row.id, row.name]));
    const weightSetIds = facts.flatMap((fact) => (fact.prWeight && fact.topWeightSetId ? [fact.topWeightSetId] : []));
    const reps = new Map(weightSetIds.length === 0 ? [] : database
      .select({ id: exerciseSets.id, repsValue: exerciseSets.repsValue })
      .from(exerciseSets)
      .where(inArray(exerciseSets.id, weightSetIds))
      .all()
      .map((row) => [row.id, parseSetReps(row.repsValue)]));
    return facts.flatMap((fact) => factRecordKinds(fact).map((kind) => ({
      sessionId: fact.sessionId,
      achievedAt: fact.achievedAt,
      kind,
      exerciseName: names.get(fact.exerciseDefinitionId) ?? '',
      value: recordValue(fact, kind),
      reps: kind === 'weight' && fact.topWeightSetId ? (reps.get(fact.topWeightSetId) ?? null) : null,
    })));
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

const factRecordKinds = (fact: ExerciseSessionFactRow): RecordKind[] =>
  sessionRecordKinds({ oneRepMax: fact.prE1rm, weight: fact.prWeight, volume: fact.prVolume });

// A flag implies its value: nothing beats a missing or zero best (§3).
const recordValue = (fact: ExerciseSessionFactRow, kind: RecordKind): number => {
  if (kind === 'oneRepMax') return fact.bestE1rmKg ?? 0;
  if (kind === 'weight') return fact.topWeightKg ?? 0;
  return fact.volumeKg ?? 0;
};

const withoutPlacement = ({ kind, exerciseName, value, reps }: PersonalRecordFact): SessionPersonalRecord =>
  ({ kind, exerciseName, value, reps });

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
    const [aggregation, recordFacts] = await Promise.all([
      store.loadAggregationInput(range),
      store.loadRecordFacts(range),
    ]);
    const sessionsInRange = workingSetsBySession(aggregation);
    // The latest session is nearly always inside the range; read it alone only when older.
    const [latestSessions, latestRecordFacts] = isInWindow(latest.completedAt, range)
      ? [sessionsInRange, recordFacts]
      : await Promise.all([
          store.loadAggregationInput(instantWindow(latest.completedAt)).then(workingSetsBySession),
          store.loadRecordFacts(instantWindow(latest.completedAt)),
        ]);
    return deriveTodayProgress({
      now,
      sessions: sessionsInRange,
      prAchievedAt: recordFacts.map((fact) => fact.achievedAt),
      latest: {
        ...latest,
        workingSets: latestSessions.find((session) => session.id === latest.id)?.workingSets ?? 0,
        records: latestRecordFacts.filter((fact) => fact.sessionId === latest.id).map(withoutPlacement),
      },
    });
  },
});

const defaultTodayProgressRepository = createTodayProgressRepository();

export const loadTodayProgress = defaultTodayProgressRepository.loadTodayProgress;

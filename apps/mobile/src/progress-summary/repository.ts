// Today's progress read: the stats aggregation for sessions and working sets,
// the exercise session facts for PRs (every record kind), and one small query
// for the completed session shown (the latest, or one stepped back to). Nothing here replays history.

import { and, asc, count, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';

import { bootstrapLocalDataLayer } from '@/src/data/bootstrap';
import {
  loadFlaggedExerciseSessionFacts,
  loadSessionExerciseFacts,
  type ExerciseSessionFactRow,
} from '@/src/data/exercise-session-facts';
import { exerciseDefinitions, exerciseSets, gyms, sessionExercises, sessions } from '@/src/data/schema';
import { createDrizzleStatsStore, type StatsStore } from '@/src/data/stats';
import { parseSetReps, parseSetWeight } from '@/src/exercise-calculations/parse';
import { sessionRecordKinds, type RecordKind } from '@/src/exercise-calculations/records';
import { isInWindow, type LocalWindow } from '@/src/utils/local-calendar';

import {
  buildSessionExerciseLines,
  deriveTodayProgress,
  todayProgressLoadWindow,
  workingSetsBySession,
  type SessionExerciseLine,
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
  /**
   * The completed, non-deleted session `offset` places before the one with
   * the latest `completed_at` (0 is the latest), and whether an older one exists.
   */
  loadCompletedSession(offset: number): Promise<{ session: LatestCompletedSessionRow; hasOlder: boolean } | null>;
  /** The session's exercise lines, in session order. */
  loadSessionExercises(sessionId: string): Promise<SessionExerciseLine[]>;
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
    const weightSetIds = facts.flatMap((fact) => (fact.ownPrWeight && fact.topWeightSetId ? [fact.topWeightSetId] : []));
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
  async loadCompletedSession(offset) {
    const database = await bootstrapLocalDataLayer();
    // The session asked for and the next older one, which says whether there is one.
    const [row, older] = database
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
      .limit(2)
      .offset(offset)
      .all();
    if (!row || row.completedAt === null) return null;
    const exercises = database
      .select({ value: count() })
      .from(sessionExercises)
      // Removed exercises stay as tombstones.
      .where(and(eq(sessionExercises.sessionId, row.id), isNull(sessionExercises.deletedAt)))
      .get();
    return { session: { ...row, completedAt: row.completedAt, exerciseCount: exercises?.value ?? 0 }, hasOlder: older !== undefined };
  },
  async loadSessionExercises(sessionId) {
    const facts = await loadSessionExerciseFacts(sessionId);
    const database = await bootstrapLocalDataLayer();
    const exercises = database
      .select({ exerciseDefinitionId: sessionExercises.exerciseDefinitionId, name: sessionExercises.name })
      .from(sessionExercises)
      .where(and(eq(sessionExercises.sessionId, sessionId), isNull(sessionExercises.deletedAt)))
      .orderBy(asc(sessionExercises.orderIndex), asc(sessionExercises.id))
      .all();
    const setIds = facts.flatMap((fact) => (fact.bestE1rmSetId ? [fact.bestE1rmSetId] : []));
    const bestSets = new Map(setIds.length === 0 ? [] : database
      .select({ id: exerciseSets.id, weightValue: exerciseSets.weightValue, repsValue: exerciseSets.repsValue })
      .from(exerciseSets)
      .where(inArray(exerciseSets.id, setIds))
      .all()
      .map((row) => [row.id, { weightKg: parseSetWeight(row.weightValue) ?? 0, reps: parseSetReps(row.repsValue) ?? 0 }]));
    return buildSessionExerciseLines(exercises, facts, bestSets);
  },
});

// A session's own PRs: on a split exercise, its gym's ([[gym.split]]).
const factRecordKinds = (fact: ExerciseSessionFactRow): RecordKind[] =>
  sessionRecordKinds({ oneRepMax: fact.ownPrE1rm, weight: fact.ownPrWeight, volume: fact.ownPrVolume });

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
  /**
   * `compareBack` picks the compared period (1, the previous, by default);
   * `sessionOffset` the session shown (0, the latest). An offset past the
   * oldest session, as after a delete, shows the latest again.
   */
  async loadTodayProgress(now: Date, periodWeeks: number, options: TodayProgressOptions = {}): Promise<TodayProgress> {
    const { compareBack = 1, sessionOffset = 0 } = options;
    const stepped = sessionOffset > 0 ? await store.loadCompletedSession(sessionOffset) : null;
    const latestOffset = stepped ? sessionOffset : 0;
    const found = stepped ?? (await store.loadCompletedSession(0));
    if (found === null) return deriveTodayProgress({ now, periodWeeks, sessions: [], prAchievedAt: [], latest: null });
    const latest = found.session;

    const range = todayProgressLoadWindow(now, periodWeeks, compareBack);
    const [aggregation, recordFacts, exercises] = await Promise.all([
      // The workout in progress counts in this week and month (§2).
      store.loadAggregationInput({ ...range, now }),
      store.loadRecordFacts(range),
      store.loadSessionExercises(latest.id),
    ]);
    const sessionsInRange = workingSetsBySession(aggregation);
    // The shown session is nearly always inside the range; read it alone only when older.
    const [latestSessions, latestRecordFacts] = isInWindow(latest.completedAt, range)
      ? [sessionsInRange, recordFacts]
      : await Promise.all([
          store.loadAggregationInput(instantWindow(latest.completedAt)).then(workingSetsBySession),
          store.loadRecordFacts(instantWindow(latest.completedAt)),
        ]);
    return deriveTodayProgress({
      now,
      periodWeeks,
      compareBack,
      latestOffset,
      hasOlderSession: found.hasOlder,
      sessions: sessionsInRange,
      prAchievedAt: recordFacts.map((fact) => fact.achievedAt),
      latest: {
        ...latest,
        workingSets: latestSessions.find((session) => session.id === latest.id)?.workingSets ?? 0,
        records: latestRecordFacts.filter((fact) => fact.sessionId === latest.id).map(withoutPlacement),
        exercises,
      },
    });
  },
});

export type TodayProgressOptions = { compareBack?: number; sessionOffset?: number };

const defaultTodayProgressRepository = createTodayProgressRepository();

export const loadTodayProgress = defaultTodayProgressRepository.loadTodayProgress;

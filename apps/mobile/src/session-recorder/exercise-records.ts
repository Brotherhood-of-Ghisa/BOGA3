import type { ExerciseHistorySessionEntry } from '@/src/data/exercise-history';
import type { ExerciseBests } from '@/src/data/exercise-session-facts';
import type { SessionSetTypeValue } from '@/src/data/set-types';
import { parseSetReps, parseSetWeight } from '@/src/exercise-calculations';
import { addFiniteVolume, calculateAnalyticsSetMetrics, ordinaryLoadContext } from '@/src/exercise-calculations/analytics';

import { canonicalizeWeightForReps, isWorkingSet, isVolumeSet } from '@/src/exercise-calculations/set-semantics';

import type { ExerciseRecordBaseline } from './exercise-page-model';

/**
 * The exercise page's records panel (`ux-rules` §14a.4): the
 * lifter's all-time 1RM, heaviest weight and best session volume for one
 * exercise, each with where it was set, and the sets of the previous session.
 * The records come from the exercise session facts (`ExerciseBests`); `Last`
 * is built from that one session's completed history entries. Only working
 * sets count toward strength records; Volume has its own policy. Every set keeps its line
 * in `Last`, and a session with no working set is not one for this exercise.
 */

export type RecordSet = {
  setType: SessionSetTypeValue;
  weight: number;
  reps: number;
  oneRepMax: number | null;
  volume: number | null;
};

export type ExerciseRecords = {
  oneRepMax: {
    value: number;
    completedAt: Date;
    weight: number;
    reps: number;
    gymId?: string | null;
    gymName?: string | null;
  } | null;
  maxWeight: {
    weight: number;
    reps: number;
    completedAt: Date;
    gymId?: string | null;
    gymName?: string | null;
  } | null;
  volume: {
    value: number;
    completedAt: Date;
    setCount: number;
    gymId?: string | null;
    gymName?: string | null;
  } | null;
};

export type LastSession = {
  completedAt: Date;
  gymId?: string | null;
  gymName?: string | null;
  oneRepMax: number | null;
  /** The heaviest working set's entered weight. */
  maxWeight: number | null;
  volume: number | null;
  /** Every performed line; aggregate figures apply the two independent policies. */
  sets: RecordSet[];
  knownVolume?: number | null;
  volumeComplete?: boolean;
};

export type ExerciseRecordsSummary = {
  records: ExerciseRecords;
  last: LastSession | null;
};

type SessionBlock = {
  sessionId: string;
  completedAt: Date;
  gymId: string | null;
  gymName: string | null;
  /** Every line, warm-ups included. */
  sets: RecordSet[];
  /** The lines that count toward records and summaries. */
  workingSets: RecordSet[];
  volumeSets: RecordSet[];
};

type HistorySet = ExerciseHistorySessionEntry['sets'][number];

const toRecordSet = (set: HistorySet, entry: ExerciseHistorySessionEntry): RecordSet | null => {
  const rawWeight = parseSetWeight(canonicalizeWeightForReps(set.weightValue, set.repsValue));
  const reps = parseSetReps(set.repsValue);
  if (rawWeight === null || reps === null) return null;
  const context = entry.loadContext ?? ordinaryLoadContext();
  const metric = calculateAnalyticsSetMetrics({ ...set, ...context });
  return {
    setType: set.setType,
    weight: rawWeight,
    reps,
    oneRepMax: metric.estimatedOneRepMaxKg,
    volume: metric.volumeKgReps,
  };
};

// One exercise can appear twice in a session; a record or "last session" is
// about the whole session, so its blocks are joined in their order.
const groupBySession = (entries: ExerciseHistorySessionEntry[]): SessionBlock[] => {
  const blocks = new Map<string, SessionBlock>();
  for (const entry of entries) {
    const block = blocks.get(entry.sessionId) ?? {
      sessionId: entry.sessionId,
      completedAt: entry.completedAt,
      gymId: entry.gymId ?? null,
      gymName: entry.gymName ?? null,
      sets: [],
      workingSets: [],
      volumeSets: [],
    };
    for (const set of entry.sets) {
      const recordSet = toRecordSet(set, entry);
      if (!recordSet) continue;
      block.sets.push(recordSet);
      if (isWorkingSet({ weight: set.weightValue, reps: set.repsValue, setType: set.setType }, entry.loadContext?.effortPolicy)) {
        block.workingSets.push(recordSet);
      }
      if (isVolumeSet({ weight: set.weightValue, reps: set.repsValue, setType: set.setType }, entry.loadContext?.effortPolicy)) {
        block.volumeSets.push(recordSet);
      }
    }
    blocks.set(entry.sessionId, block);
  }
  return [...blocks.values()]
    .filter((block) => block.workingSets.length > 0)
    .sort((left, right) => right.completedAt.getTime() - left.completedAt.getTime());
};

const sumVolume = (sets: RecordSet[]): number | null => {
  if (sets.some(set => set.volume === null)) return null;
  const total = sets.reduce((sum, set) => sum + (set.volume ?? 0), 0);
  return Number.isFinite(total) ? total : null;
};

const bestOneRepMax = (sets: RecordSet[]) =>
  sets.reduce<number | null>(
    (best, set) => (set.oneRepMax !== null && (best === null || set.oneRepMax > best) ? set.oneRepMax : best),
    null
  );

const sessionOf = (best: { completedAt: Date; gymId: string | null; gymName: string | null }) => ({
  completedAt: best.completedAt,
  gymId: best.gymId,
  gymName: best.gymName,
});

export const exerciseRecordsFrom = (bests: ExerciseBests): ExerciseRecords => ({
  oneRepMax: bests.oneRepMax
    ? { ...sessionOf(bests.oneRepMax), value: bests.oneRepMax.value, weight: bests.oneRepMax.weight, reps: bests.oneRepMax.reps }
    : null,
  maxWeight: bests.topWeight
    ? { ...sessionOf(bests.topWeight), weight: bests.topWeight.weight, reps: bests.topWeight.reps }
    : null,
  volume: bests.volume
    ? { ...sessionOf(bests.volume), value: bests.volume.value, setCount: bests.volume.volumeSets ?? bests.volume.workingSets }
    : null,
});

/** `entries` in any order; the newest session with a working set is `Last`. */
export const deriveLastSession = (entries: ExerciseHistorySessionEntry[]): LastSession | null => {
  const newest = groupBySession(entries)[0];
  if (!newest) return null;
  const volume = sumVolume(newest.volumeSets);
  return {
    completedAt: newest.completedAt,
    gymId: newest.gymId,
    gymName: newest.gymName,
    oneRepMax: bestOneRepMax(newest.workingSets),
    maxWeight: Math.max(...newest.workingSets.map((set) => set.weight)),
    volume,
    knownVolume: newest.volumeSets.reduce<number | null>((sum, set) => addFiniteVolume(sum, set.volume ?? 0), 0),
    volumeComplete: volume !== null,
    sets: newest.sets,
  };
};

export const recordBaselineOf = (records: ExerciseRecords): ExerciseRecordBaseline => ({
  oneRepMax: records.oneRepMax?.value ?? null,
  weight: records.maxWeight ? { weight: records.maxWeight.weight, reps: records.maxWeight.reps } : null,
});

const DAY_MS = 24 * 60 * 60 * 1000;

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();

/** Whole calendar days between `date` and `now`, never negative. */
export const daysAgo = (date: Date, now: Date = new Date()): number =>
  Math.max(0, Math.round((startOfDay(now) - startOfDay(date)) / DAY_MS));

export const formatDaysAgo = (date: Date, now: Date = new Date()): string => {
  const days = daysAgo(date, now);
  return days === 0 ? 'today' : `${days}d ago`;
};

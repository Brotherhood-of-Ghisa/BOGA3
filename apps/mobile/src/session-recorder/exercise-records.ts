import type { ExerciseHistorySessionEntry } from '@/src/data/exercise-history';
import type { SessionSetTypeValue } from '@/src/data/set-types';
import { parseSetReps, parseSetWeight } from '@/src/exercise-calculations';
import { addFiniteVolume, calculateAnalyticsSetMetrics, ordinaryLoadContext } from '@/src/exercise-calculations/analytics';

import { canonicalizeWeightForReps } from './set-semantics';

import type { ExerciseRecordBaseline } from './exercise-page-model';

/**
 * The exercise page's records panel (`ux-rules` §14a.4): the
 * lifter's all-time 1RM, heaviest weight and best session volume for one
 * exercise, each with where it was set, and the sets of the previous session.
 * Derived from the completed history `loadExercisePerformanceHistory` returns
 * (confirmed performed sets only, the active session excluded), under the same
 * rules as History: warm-ups count like any other set.
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
  volume: number | null;
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
  sets: RecordSet[];
};

const toRecordSet = (set: ExerciseHistorySessionEntry['sets'][number], entry: ExerciseHistorySessionEntry): RecordSet | null => {
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
    };
    for (const set of entry.sets) {
      const recordSet = toRecordSet(set, entry);
      if (recordSet) block.sets.push(recordSet);
    }
    blocks.set(entry.sessionId, block);
  }
  return [...blocks.values()]
    .filter((block) => block.sets.length > 0)
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

/** `entries` in any order; the newest session is `last`. */
export const deriveExerciseRecords = (entries: ExerciseHistorySessionEntry[]): ExerciseRecordsSummary => {
  const blocks = groupBySession(entries);
  const records: ExerciseRecords = {
    oneRepMax: null,
    maxWeight: null,
    volume: null,
  };

  // Oldest first, so a tie keeps the session that set the value first.
  for (const block of [...blocks].reverse()) {
    for (const set of block.sets) {
      if (set.oneRepMax !== null && (records.oneRepMax === null || set.oneRepMax > records.oneRepMax.value)) {
        records.oneRepMax = {
          value: set.oneRepMax,
          completedAt: block.completedAt,
          weight: set.weight,
          reps: set.reps,
          gymId: block.gymId,
          gymName: block.gymName,
        };
      }
      const max = records.maxWeight;
      if (max === null || set.weight > max.weight || (set.weight === max.weight && set.reps > max.reps)) {
        records.maxWeight = {
          weight: set.weight,
          reps: set.reps,
          completedAt: block.completedAt,
          gymId: block.gymId,
          gymName: block.gymName,
        };
      }
    }
    const volume = sumVolume(block.sets);
    if (volume !== null && (records.volume === null || volume > records.volume.value)) {
      records.volume = {
        value: volume,
        completedAt: block.completedAt,
        setCount: block.sets.length,
        gymId: block.gymId,
        gymName: block.gymName,
      };
    }
  }

  const newest = blocks[0];
  return {
    records,
    last: newest
      ? {
          completedAt: newest.completedAt,
          gymId: newest.gymId,
          gymName: newest.gymName,
          oneRepMax: bestOneRepMax(newest.sets),
          volume: sumVolume(newest.sets),
          knownVolume: newest.sets.reduce<number | null>((sum, set) => addFiniteVolume(sum, set.volume ?? 0), 0),
          volumeComplete: sumVolume(newest.sets) !== null,
          sets: newest.sets,
        }
      : null,
  };
};

export const recordBaselineOf = (records: ExerciseRecords): ExerciseRecordBaseline => ({
  oneRepMax: records.oneRepMax?.value ?? null,
  weight: records.maxWeight?.weight ?? null,
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

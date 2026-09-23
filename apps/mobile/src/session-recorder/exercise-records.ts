import type { ExerciseHistorySessionEntry } from '@/src/data/exercise-history';
import type { SessionSetTypeValue } from '@/src/data/set-types';
import {
  computeSetVolume,
  estimateOneRepMax,
  parseSetReps,
  parseSetWeight,
} from '@/src/exercise-calculations';

import type { ExerciseRecordBaseline } from './exercise-page-model';

/**
 * The exercise page's records panel (build spec, "Exercise page" §1): the
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
  volume: number;
};

export type ExerciseRecords = {
  oneRepMax: {
    value: number;
    completedAt: Date;
    weight: number;
    reps: number;
  } | null;
  maxWeight: { weight: number; reps: number; completedAt: Date } | null;
  volume: { value: number; completedAt: Date; setCount: number } | null;
};

export type LastSession = {
  completedAt: Date;
  oneRepMax: number | null;
  volume: number;
  sets: RecordSet[];
};

export type ExerciseRecordsSummary = {
  records: ExerciseRecords;
  last: LastSession | null;
};

type SessionBlock = {
  sessionId: string;
  completedAt: Date;
  sets: RecordSet[];
};

const toRecordSet = (set: ExerciseHistorySessionEntry['sets'][number]): RecordSet | null => {
  const weight = parseSetWeight(set.weightValue);
  const reps = parseSetReps(set.repsValue);
  if (weight === null || reps === null) return null;
  return {
    setType: set.setType,
    weight,
    reps,
    oneRepMax: estimateOneRepMax(weight, reps),
    volume: computeSetVolume(weight, reps),
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
      sets: [],
    };
    for (const set of entry.sets) {
      const recordSet = toRecordSet(set);
      if (recordSet) block.sets.push(recordSet);
    }
    blocks.set(entry.sessionId, block);
  }
  return [...blocks.values()]
    .filter((block) => block.sets.length > 0)
    .sort((left, right) => right.completedAt.getTime() - left.completedAt.getTime());
};

const sumVolume = (sets: RecordSet[]) => sets.reduce((total, set) => total + set.volume, 0);

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
        };
      }
      const max = records.maxWeight;
      if (max === null || set.weight > max.weight || (set.weight === max.weight && set.reps > max.reps)) {
        records.maxWeight = {
          weight: set.weight,
          reps: set.reps,
          completedAt: block.completedAt,
        };
      }
    }
    const volume = sumVolume(block.sets);
    if (records.volume === null || volume > records.volume.value) {
      records.volume = {
        value: volume,
        completedAt: block.completedAt,
        setCount: block.sets.length,
      };
    }
  }

  const newest = blocks[0];
  return {
    records,
    last: newest
      ? {
          completedAt: newest.completedAt,
          oneRepMax: bestOneRepMax(newest.sets),
          volume: sumVolume(newest.sets),
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

import { formatOneRepMax, formatVolume, formatWeight } from '@/src/exercise-calculations/format';
import { summarizeVolume, type LoadContext, type SetMetrics } from '@/src/exercise-calculations/load-metrics';
import { calculateAnalyticsSetMetrics, ordinaryLoadContext, sessionVolumeSummary } from '@/src/exercise-calculations/analytics';
import type { Session, SessionSet } from '@/components/session-recorder/types';
import { formatSessionSetType, normalizeSessionSetType } from '@/src/data/set-types';
import { parseSetReps, parseSetWeight } from '@/src/exercise-calculations';
import type { RecordBaseline } from '@/src/exercise-calculations/records';
import { deriveExercisePersonalRecord, type ExercisePersonalRecord } from '@/src/session-insights';
import { recordBand, type RecordBand } from '@/src/session-insights/record-band';

import { hasPlannedTarget, toSessionInsightExercises } from './session-model';
import {
  canonicalizeWeightForReps, hasValidActualValues, isConfirmedPerformedSet, isWorkingSet, isVolumeSet,
} from '@/src/exercise-calculations/set-semantics';

/**
 * The read-only session view's presentation model: one
 * card per exercise with its set rows, a done count and a
 * record, plus the independent working-set and Volume totals. Pure — the route loads the
 * draft and the history and renders what this returns.
 */

export const EMPTY_FIGURE = '—';

export type SessionViewSetRow = {
  id: string;
  // `W-Up`, `RIR 2`; the em dash when no effort is set.
  typeLabel: string;
  weightReps: string;
  oneRepMax: string;
  volume: string;
  // A confirmed performed set; every other row is shown faded as planned.
  done: boolean;
  // The session's record set (`training-metrics-contract.md` §3): its 1RM,
  // and its Weight, when they beat the records — the only figures a card
  // highlights. A 1RM record set may also set the Weight record.
  oneRepMaxRecord: boolean;
  weightRecord: boolean;
};

export type SessionViewExerciseCard = {
  id: string;
  name: string;
  doneCount: number;
  totalCount: number;
  rows: SessionViewSetRow[];
  // The card's `record` band when the exercise's record set is in it.
  record: RecordBand | null;
};

export type SessionViewModel = {
  cards: SessionViewExerciseCard[];
  // The summary's `Sets`: the performed working sets (`training-metrics-contract.md` "Counted set").
  workingSetCount: number;
  volume: string;
  volumeNote?: string;
};


export type SetRowInput = {
  id: string;
  weight: number | null;
  reps: number | null;
  setType: unknown;
  done: boolean;
  oneRepMaxRecord?: boolean;
  weightRecord?: boolean;
  loadContext?: LoadContext;
};

/**
 * One set as the design language shows it (`type · weight × reps · 1RM · VOL`),
 * from plain values: the session view, View Session and the group session view
 * all format a row here, so a set reads the same on each.
 */
export const formatSetRow = ({
  id, weight, reps, setType, done, oneRepMaxRecord = false, weightRecord = false, loadContext = ordinaryLoadContext(),
}: SetRowInput): SessionViewSetRow => {
  let oneRepMax = EMPTY_FIGURE;
  let volume = EMPTY_FIGURE;
  if (weight !== null && reps !== null) {
    const metric = calculateAnalyticsSetMetrics({
      ...loadContext,
      weightValue: String(weight),
      repsValue: String(reps),
    });
    const estimate = metric.estimatedOneRepMaxKg;
    oneRepMax = estimate === null ? EMPTY_FIGURE : formatOneRepMax(estimate);
    volume = metric.volumeKgReps === null ? EMPTY_FIGURE : formatVolume(metric.volumeKgReps);
  }
  return {
    id,
    typeLabel: formatSessionSetType(setType) ?? EMPTY_FIGURE,
    // Bodyweight changes derived metrics, never entered-load copy or geometry.
    weightReps: `${weight === null ? EMPTY_FIGURE : formatWeight(weight)} × ${reps === null ? EMPTY_FIGURE : reps}`,
    oneRepMax,
    volume,
    done,
    oneRepMaxRecord,
    weightRecord,
  };
};

/** A row's record flags: whether it is the card's record set, and which figures it highlights. */
export const recordFlagsFor = (
  record: ExercisePersonalRecord | null,
  setId: string,
): Pick<SessionViewSetRow, 'oneRepMaxRecord' | 'weightRecord'> => {
  const isRecordSet = record !== null && record.setId === setId;
  return {
    oneRepMaxRecord: isRecordSet && record.kind === 'oneRepMax',
    weightRecord: isRecordSet && record.weightRecord,
  };
};

/** The card's band: only on the block holding the exercise's record set. */
export const cardRecordBand = (record: ExercisePersonalRecord | null, blockId: string): RecordBand | null =>
  record !== null && record.sessionExerciseId === blockId ? recordBand(record) : null;

type ShownValues = { weight: number | null; reps: number | null; setType: string | null };

// A done or entered row shows what was lifted; an untouched planned row its
// prescription; a blank row nothing.
const shownValues = (set: SessionSet): ShownValues => {
  if (hasValidActualValues(set) || !hasPlannedTarget(set)) {
    return {
      weight: parseSetWeight(canonicalizeWeightForReps(set.weight, set.reps)),
      reps: parseSetReps(set.reps),
      setType: normalizeSessionSetType(set.setType),
    };
  }
  return {
    weight: parseSetWeight(canonicalizeWeightForReps(set.plannedWeight ?? '', set.plannedReps ?? '')),
    reps: parseSetReps(set.plannedReps),
    setType: normalizeSessionSetType(set.plannedSetType),
  };
};

type RowFigures = {
  set: SessionSet;
  done: boolean;
  shown: ShownValues;
  metric: SetMetrics;
};

const toRowFigures = (set: SessionSet, context: LoadContext): RowFigures => {
  const shown = shownValues(set);
  return {
    set,
    done: isConfirmedPerformedSet(set),
    shown,
    metric: calculateAnalyticsSetMetrics({
      ...context,
      weightValue: set.weight,
      repsValue: set.reps,
      performanceStatus: set.performanceStatus,
    }),
  };
};

export const buildSessionViewModel = (
  session: Session,
  // Each exercise definition's records in the sessions before this one;
  // absent without an earlier record, while history loads or when it failed,
  // which shows no record rather than a wrong one.
  recordBaselineByDefinitionId: ReadonlyMap<string, RecordBaseline>
): SessionViewModel => {
  const insightExercises = toSessionInsightExercises(session, new Map());
  const volumeMetrics: SetMetrics[] = [];
  let workingSetCount = 0;

  const cards = session.exercises.map((exercise): SessionViewExerciseCard => {
    const context = exercise.loadContext ?? ordinaryLoadContext();
    const figures = exercise.sets.map(set => toRowFigures(set, context));
    // One record set per exercise, across every block of it in the session.
    const record = deriveExercisePersonalRecord({
      exerciseDefinitionId: exercise.exerciseDefinitionId,
      exercises: insightExercises,
      baseline: recordBaselineByDefinitionId.get(exercise.exerciseDefinitionId) ?? null,
    });

    const rows = figures.map((row): SessionViewSetRow => {
      if (isWorkingSet(row.set, context.effortPolicy)) workingSetCount += 1;
      if (isVolumeSet(row.set, context.effortPolicy)) volumeMetrics.push(row.metric);
      return formatSetRow({
        id: row.set.id,
        ...row.shown,
        loadContext: context,
        done: row.done,
        ...recordFlagsFor(record, row.set.id),
      });
    });

    return {
      id: exercise.id,
      name: exercise.name,
      doneCount: figures.filter((row) => row.done).length,
      totalCount: figures.length,
      rows,
      record: cardRecordBand(record, exercise.id),
    };
  });

  return { cards, workingSetCount, ...sessionVolumeSummary(summarizeVolume(volumeMetrics)) };
};

/** Elapsed time as `m:ss`, or `h:mm:ss` from an hour. */
export const formatElapsed = (startedAt: Date, now: Date): string => {
  const totalSeconds = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = `${totalSeconds % 60}`.padStart(2, '0');
  return hours > 0 ? `${hours}:${`${minutes}`.padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
};

/**
 * The active session's title from its local start hour: `Morning training`
 * (05–11), `Afternoon training` (12–16), `Evening training` (17–20), else
 * `Night training`.
 */
export const sessionTitleForStart = (startedAt: Date): string => {
  const hour = startedAt.getHours();
  if (hour >= 5 && hour < 12) return 'Morning training';
  if (hour >= 12 && hour < 17) return 'Afternoon training';
  if (hour >= 17 && hour < 21) return 'Evening training';
  return 'Night training';
};

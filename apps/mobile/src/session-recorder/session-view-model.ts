import { summarizeVolume, type LoadContext, type SetMetrics } from '@/src/exercise-calculations/load-metrics';
import { calculateAnalyticsSetMetrics, ordinaryLoadContext, sessionVolumeSummary } from '@/src/exercise-calculations/analytics';
import type { Session, SessionSet } from '@/components/session-recorder/types';
import { formatSessionSetType, normalizeSessionSetType } from '@/src/data/set-types';
import { parseSetReps, parseSetWeight } from '@/src/exercise-calculations';
import { deriveExercisePersonalRecord } from '@/src/session-insights';

import { hasPlannedTarget, toSessionInsightExercises } from './session-model';
import {
  canonicalizeWeightForReps, hasValidActualValues, isConfirmedPerformedSet, isWorkingSetType,
} from '@/src/exercise-calculations/set-semantics';

/**
 * The read-only session view's presentation model (`ux-rules` §14b): one
 * card per exercise with its set rows, a done count and a
 * record, plus the summary totals (Volume reads working sets only). Pure — the route loads the
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
  // This set's 1RM is an all-time best — the only figure the card highlights.
  oneRepMaxRecord: boolean;
};

export type SessionViewExerciseCard = {
  id: string;
  name: string;
  doneCount: number;
  totalCount: number;
  rows: SessionViewSetRow[];
  // The record 1RM, formatted, when a set in this card is an all-time best.
  recordOneRepMax: string | null;
};

export type SessionViewModel = {
  cards: SessionViewExerciseCard[];
  // The summary's `Sets`: the performed working sets (`ux-rules.md` §5.11).
  workingSetCount: number;
  volume: string;
  volumeNote?: string;
};

// Weights keep what was entered, with one decimal on whole numbers so a column
// of `60.0` / `82.5` reads alike; no unit suffix (design-language §6).
export const formatWeightFigure = (weight: number): string =>
  Number.isInteger(weight) ? weight.toFixed(1) : String(weight);

export const formatOneRepMaxFigure = (value: number): string => value.toFixed(1);

// No thousands separators (design-language §6).
export const formatVolumeFigure = (value: number): string => String(Math.round(value));

export type SetRowInput = {
  id: string;
  weight: number | null;
  reps: number | null;
  setType: unknown;
  done: boolean;
  oneRepMaxRecord?: boolean;
  loadContext?: LoadContext;
};

/**
 * One set as the design language shows it (`type · weight × reps · 1RM · VOL`),
 * from plain values: the session view, View Session and the group session view
 * all format a row here, so a set reads the same on each.
 */
export const formatSetRow = ({ id, weight, reps, setType, done, oneRepMaxRecord = false, loadContext = ordinaryLoadContext() }: SetRowInput): SessionViewSetRow => {
  let oneRepMax = EMPTY_FIGURE;
  let volume = EMPTY_FIGURE;
  if (weight !== null && reps !== null) {
    const metric = calculateAnalyticsSetMetrics({
      ...loadContext,
      weightValue: String(weight),
      repsValue: String(reps),
    });
    const estimate = metric.estimatedOneRepMaxKg;
    oneRepMax = estimate === null ? EMPTY_FIGURE : formatOneRepMaxFigure(estimate);
    volume = metric.volumeKgReps === null ? EMPTY_FIGURE : formatVolumeFigure(metric.volumeKgReps);
  }
  return {
    id,
    typeLabel: formatSessionSetType(setType) ?? EMPTY_FIGURE,
    // Bodyweight changes derived metrics, never entered-load copy or geometry.
    weightReps: `${weight === null ? EMPTY_FIGURE : formatWeightFigure(weight)} × ${reps === null ? EMPTY_FIGURE : reps}`,
    oneRepMax,
    volume,
    done,
    oneRepMaxRecord,
  };
};

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
  // The best 1RM of each exercise definition in the sessions before this one;
  // absent without an earlier 1RM, while history loads or when it failed,
  // which shows no record rather than a wrong one.
  historicalBestByDefinitionId: ReadonlyMap<string, number>
): SessionViewModel => {
  const insightExercises = toSessionInsightExercises(session, new Map());
  const workingMetrics: SetMetrics[] = [];

  const cards = session.exercises.map((exercise): SessionViewExerciseCard => {
    const context = exercise.loadContext ?? ordinaryLoadContext();
    const figures = exercise.sets.map(set => toRowFigures(set, context));
    const historicalBest = historicalBestByDefinitionId.get(exercise.exerciseDefinitionId);
    const record =
      historicalBest === undefined
        ? null
        : deriveExercisePersonalRecord({
            exerciseDefinitionId: exercise.exerciseDefinitionId,
            exercises: insightExercises,
            historicalBestEstimatedOneRepMax: historicalBest,
          });
    const recordSetId = record && record.sessionExerciseId === exercise.id ? record.setId : null;

    const rows = figures.map((row): SessionViewSetRow => {
      if (row.done && isWorkingSetType(row.set.setType)) workingMetrics.push(row.metric);
      return formatSetRow({
        id: row.set.id,
        ...row.shown,
        loadContext: context,
        done: row.done,
        oneRepMaxRecord: row.set.id === recordSetId,
      });
    });

    return {
      id: exercise.id,
      name: exercise.name,
      doneCount: figures.filter((row) => row.done).length,
      totalCount: figures.length,
      rows,
      recordOneRepMax: record && recordSetId ? formatOneRepMaxFigure(record.estimatedOneRepMax) : null,
    };
  });

  return { cards, workingSetCount: workingMetrics.length, ...sessionVolumeSummary(summarizeVolume(workingMetrics)) };
};

/** Elapsed time as `m:ss`, or `h:mm:ss` from an hour. */
export const formatElapsed = (startedAt: Date, now: Date): string => {
  const totalSeconds = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = `${totalSeconds % 60}`.padStart(2, '0');
  return hours > 0 ? `${hours}:${`${minutes}`.padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
};

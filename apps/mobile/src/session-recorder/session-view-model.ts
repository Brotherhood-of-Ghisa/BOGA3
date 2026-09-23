import type { Session, SessionSet } from '@/components/session-recorder/types';
import type { ExerciseBlockHistoryBlock } from '@/src/data';
import { formatSessionSetType, normalizeSessionSetType } from '@/src/data/set-types';
import { computeSetVolume, estimateOneRepMax, parseSetReps, parseSetWeight } from '@/src/exercise-calculations';
import { deriveExercisePersonalRecord } from '@/src/session-insights';

import { hasPlannedTarget, toSessionInsightExercises } from './session-model';
import { hasValidActualValues, isConfirmedPerformedSet } from './set-semantics';

/**
 * The read-only session view's presentation model (build spec, "Session
 * view"): one card per exercise with its set rows, a done count and a
 * record, plus the summary totals. Pure — the route loads the
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
  performedSetCount: number;
  volume: string;
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
};

/**
 * One set as the design language shows it (`type · weight × reps · 1RM · VOL`),
 * from plain values: the session view, View Session and the group session view
 * all format a row here, so a set reads the same on each.
 */
export const formatSetRow = ({ id, weight, reps, setType, done, oneRepMaxRecord = false }: SetRowInput): SessionViewSetRow => {
  let oneRepMax = EMPTY_FIGURE;
  let volume = EMPTY_FIGURE;
  if (weight !== null && reps !== null) {
    // A zero-weight set has a volume but no 1RM.
    const estimate = estimateOneRepMax(weight, reps);
    oneRepMax = estimate === null ? EMPTY_FIGURE : formatOneRepMaxFigure(estimate);
    volume = formatVolumeFigure(computeSetVolume(weight, reps));
  }
  return {
    id,
    typeLabel: formatSessionSetType(setType) ?? EMPTY_FIGURE,
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
      weight: parseSetWeight(set.weight),
      reps: parseSetReps(set.reps),
      setType: normalizeSessionSetType(set.setType),
    };
  }
  return {
    weight: parseSetWeight(set.plannedWeight),
    reps: parseSetReps(set.plannedReps),
    setType: normalizeSessionSetType(set.plannedSetType),
  };
};

type RowFigures = {
  set: SessionSet;
  done: boolean;
  shown: ShownValues;
  volume: number | null;
};

const toRowFigures = (set: SessionSet): RowFigures => {
  const shown = shownValues(set);
  const computable = shown.weight !== null && shown.reps !== null;
  return {
    set,
    done: isConfirmedPerformedSet(set),
    shown,
    volume: computable ? computeSetVolume(shown.weight as number, shown.reps as number) : null,
  };
};

/** The historical best 1RM the recorder compares against, from completed history. */
export const historicalBestOneRepMax = (blocks: ExerciseBlockHistoryBlock[]): number | null => {
  const values = blocks
    .map((block) => block.estimatedOneRepMax)
    .filter((value): value is number => value !== null && Number.isFinite(value));
  return values.length > 0 ? Math.max(...values) : null;
};

export const buildSessionViewModel = (
  session: Session,
  // Keyed by exercise definition; absent while history loads or when it failed,
  // which shows no record rather than a wrong one.
  historicalBestByDefinitionId: ReadonlyMap<string, number | null>
): SessionViewModel => {
  const insightExercises = toSessionInsightExercises(session, new Map());
  let performedSetCount = 0;
  let volume = 0;

  const cards = session.exercises.map((exercise): SessionViewExerciseCard => {
    const figures = exercise.sets.map(toRowFigures);
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
      if (row.done) {
        performedSetCount += 1;
        volume += row.volume ?? 0;
      }
      return formatSetRow({
        id: row.set.id,
        ...row.shown,
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

  return { cards, performedSetCount, volume: formatVolumeFigure(volume) };
};

/** Elapsed time as `m:ss`, or `h:mm:ss` from an hour. */
export const formatElapsed = (startedAt: Date, now: Date): string => {
  const totalSeconds = Math.max(0, Math.floor((now.getTime() - startedAt.getTime()) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = `${totalSeconds % 60}`.padStart(2, '0');
  return hours > 0 ? `${hours}:${`${minutes}`.padStart(2, '0')}:${seconds}` : `${minutes}:${seconds}`;
};

import type { Session, SessionSet } from '@/components/session-recorder/types';
import type { ExerciseBlockHistoryBlock } from '@/src/data';
import { normalizeSessionSetType } from '@/src/data/set-types';
import { computeSetVolume, estimateOneRepMax, parseSetReps, parseSetWeight } from '@/src/exercise-calculations';
import { deriveExercisePersonalRecord } from '@/src/session-insights';

import { hasPlannedTarget, SET_TYPE_MENU_LABELS, toSessionInsightExercises } from './session-model';
import { hasValidActualValues, isConfirmedPerformedSet } from './set-semantics';

/**
 * The read-only session view's presentation model (build spec, "Session
 * view"): one card per exercise with its set rows, a done count, per-column
 * bests and a record, plus the summary totals. Pure — the route loads the
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
  // The best of this exercise today, per column (build spec, "Set row").
  bestWeight: boolean;
  bestVolume: boolean;
  oneRepMaxEmphasis: 'none' | 'best' | 'record';
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
  oneRepMax: number | null;
  volume: number | null;
};

const toRowFigures = (set: SessionSet): RowFigures => {
  const shown = shownValues(set);
  const computable = shown.weight !== null && shown.reps !== null;
  return {
    set,
    done: isConfirmedPerformedSet(set),
    shown,
    oneRepMax: computable ? estimateOneRepMax(shown.weight as number, shown.reps as number) : null,
    volume: computable ? computeSetVolume(shown.weight as number, shown.reps as number) : null,
  };
};

// The id of the first done row holding the column's maximum.
const bestDoneRowId = (rows: RowFigures[], value: (row: RowFigures) => number | null): string | null => {
  let best: { id: string; value: number } | null = null;
  for (const row of rows) {
    if (!row.done) continue;
    const candidate = value(row);
    if (candidate === null || !Number.isFinite(candidate)) continue;
    if (best === null || candidate > best.value) {
      best = { id: row.set.id, value: candidate };
    }
  }
  return best?.id ?? null;
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
    const bestWeightId = bestDoneRowId(figures, (row) => row.shown.weight);
    const bestOneRepMaxId = bestDoneRowId(figures, (row) => row.oneRepMax);
    const bestVolumeId = bestDoneRowId(figures, (row) => row.volume);

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
      const { weight, reps, setType } = row.shown;
      return {
        id: row.set.id,
        typeLabel: setType ? SET_TYPE_MENU_LABELS[setType as keyof typeof SET_TYPE_MENU_LABELS] : EMPTY_FIGURE,
        weightReps: `${weight === null ? EMPTY_FIGURE : formatWeightFigure(weight)} × ${
          reps === null ? EMPTY_FIGURE : reps
        }`,
        oneRepMax: row.oneRepMax === null ? EMPTY_FIGURE : formatOneRepMaxFigure(row.oneRepMax),
        volume: row.volume === null ? EMPTY_FIGURE : formatVolumeFigure(row.volume),
        done: row.done,
        bestWeight: row.set.id === bestWeightId,
        bestVolume: row.set.id === bestVolumeId,
        oneRepMaxEmphasis:
          row.set.id === recordSetId ? 'record' : row.set.id === bestOneRepMaxId ? 'best' : 'none',
      };
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

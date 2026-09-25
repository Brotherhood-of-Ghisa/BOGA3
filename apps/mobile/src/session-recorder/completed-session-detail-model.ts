import { parseSetReps, parseSetWeight, computeSetVolume } from '@/src/exercise-calculations';
import { deriveExercisePersonalRecord, type SessionInsightExerciseInput } from '@/src/session-insights';

import {
  formatOneRepMaxFigure,
  formatSetRow,
  formatVolumeFigure,
  type SessionViewSetRow,
} from './session-view-model';
import { isConfirmedPerformedSet, type SessionSetPerformanceStatus } from './set-semantics';

/**
 * View Session's presentation model: what a finished session did, set by set.
 * Only confirmed sets with valid values are shown, and an exercise with none is
 * left out. A record is the session view's (`session-view-model.ts`): a set
 * whose 1RM beats every other completed session of that exercise. Pure — the
 * route loads the session and the history and renders what this returns.
 */

export type CompletedSessionDetailSetInput = {
  id: string;
  weight: string;
  reps: string;
  setType: unknown;
  performanceStatus?: SessionSetPerformanceStatus;
};

export type CompletedSessionDetailExerciseInput = {
  id: string;
  exerciseDefinitionId?: string | null;
  name: string;
  sets: CompletedSessionDetailSetInput[];
};

export type CompletedSessionDetailCard = {
  id: string;
  name: string;
  setCount: number;
  rows: SessionViewSetRow[];
  // The record 1RM, formatted, when a set in this exercise is an all-time best.
  recordOneRepMax: string | null;
};

export type CompletedSessionDetailModel = {
  cards: CompletedSessionDetailCard[];
  performedSetCount: number;
  volume: string;
};

const performedFigures = (set: CompletedSessionDetailSetInput) => {
  if (!isConfirmedPerformedSet({ weight: set.weight, reps: set.reps, performanceStatus: set.performanceStatus })) {
    return null;
  }
  const weight = parseSetWeight(set.weight);
  const reps = parseSetReps(set.reps);
  return weight === null || reps === null ? null : { weight, reps };
};

const toInsightExercises = (exercises: CompletedSessionDetailExerciseInput[]): SessionInsightExerciseInput[] =>
  exercises.map((exercise, exerciseIndex) => ({
    id: exercise.id,
    orderIndex: exerciseIndex,
    exerciseDefinitionId: exercise.exerciseDefinitionId ?? null,
    exerciseName: exercise.name,
    sets: exercise.sets.map((set, setIndex) => ({
      id: set.id,
      orderIndex: setIndex,
      weightValue: set.weight,
      repsValue: set.reps,
      setType: typeof set.setType === 'string' ? set.setType : null,
      performanceStatus: set.performanceStatus,
    })),
  }));

export const buildCompletedSessionDetailModel = (
  exercises: CompletedSessionDetailExerciseInput[],
  // Keyed by exercise definition; absent while history loads or when it failed,
  // which shows no record rather than a wrong one.
  historicalBestByDefinitionId: ReadonlyMap<string, number | null>
): CompletedSessionDetailModel => {
  const insightExercises = toInsightExercises(exercises);
  let performedSetCount = 0;
  let volume = 0;

  const cards = exercises.flatMap((exercise): CompletedSessionDetailCard[] => {
    const performed = exercise.sets.flatMap((set) => {
      const figures = performedFigures(set);
      return figures ? [{ set, ...figures }] : [];
    });
    if (performed.length === 0) return [];

    const definitionId = exercise.exerciseDefinitionId ?? null;
    const historicalBest = definitionId === null ? undefined : historicalBestByDefinitionId.get(definitionId);
    const record =
      definitionId === null || historicalBest === undefined
        ? null
        : deriveExercisePersonalRecord({
            exerciseDefinitionId: definitionId,
            exercises: insightExercises,
            historicalBestEstimatedOneRepMax: historicalBest,
          });
    const recordSetId = record && record.sessionExerciseId === exercise.id ? record.setId : null;

    performedSetCount += performed.length;
    for (const { weight, reps } of performed) {
      volume += computeSetVolume(weight, reps);
    }

    return [
      {
        id: exercise.id,
        name: exercise.name,
        setCount: performed.length,
        rows: performed.map(({ set, weight, reps }) =>
          formatSetRow({
            id: set.id,
            weight,
            reps,
            setType: set.setType,
            done: true,
            oneRepMaxRecord: set.id === recordSetId,
          })
        ),
        recordOneRepMax: record && recordSetId ? formatOneRepMaxFigure(record.estimatedOneRepMax) : null,
      },
    ];
  });

  return { cards, performedSetCount, volume: formatVolumeFigure(volume) };
};

import { summarizeVolume, type LoadContext, type SetMetrics } from '@/src/exercise-calculations/load-metrics';
import { calculateAnalyticsSetMetrics, ordinaryLoadContext, sessionVolumeSummary } from '@/src/exercise-calculations/analytics';
import { parseSetReps, parseSetWeight } from '@/src/exercise-calculations';
import type { RecordBaseline } from '@/src/exercise-calculations/records';
import { deriveExercisePersonalRecord, type SessionInsightExerciseInput } from '@/src/session-insights';
import type { RecordLine } from '@/src/session-insights/record-band';

import {
  cardRecordBand,
  formatSetRow,
  recordFlagsFor,
  type SessionViewSetRow,
} from './session-view-model';
import {
  canonicalizeWeightForReps, isConfirmedPerformedSet, isWorkingSet, isVolumeSet, type SessionSetPerformanceStatus,
} from '@/src/exercise-calculations/set-semantics';

/**
 * View Session's presentation model: what a finished session did, set by set.
 * Only confirmed sets with valid values are shown, and an exercise with none is
 * left out. Records are the session view's (`session-view-model.ts`): the
 * exercise's records against every completed session before this one. Pure — the
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
  loadContext?: LoadContext;
  sets: CompletedSessionDetailSetInput[];
};

export type CompletedSessionDetailCard = {
  id: string;
  name: string;
  // The card's `<n> sets`: its working sets (`training-metrics-contract.md` "Counted set").
  setCount: number;
  rows: SessionViewSetRow[];
  // The card's `record` band: a line per record it holds, empty without one.
  record: RecordLine[];
};

export type CompletedSessionDetailModel = {
  cards: CompletedSessionDetailCard[];
  // The summary's `Sets`: the performed working sets.
  workingSetCount: number;
  volume: string;
  volumeNote?: string;
};

const performedFigures = (set: CompletedSessionDetailSetInput) => {
  if (!isConfirmedPerformedSet({ weight: set.weight, reps: set.reps, performanceStatus: set.performanceStatus })) {
    return null;
  }
  const weight = parseSetWeight(canonicalizeWeightForReps(set.weight, set.reps));
  const reps = parseSetReps(set.reps);
  return weight === null || reps === null ? null : { weight, reps };
};

const toInsightExercises = (exercises: CompletedSessionDetailExerciseInput[]): SessionInsightExerciseInput[] =>
  exercises.map((exercise, exerciseIndex) => ({
    id: exercise.id,
    orderIndex: exerciseIndex,
    exerciseDefinitionId: exercise.exerciseDefinitionId ?? null,
    exerciseName: exercise.name,
    loadContext: exercise.loadContext,
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
  // Each exercise definition's records in the sessions before this one;
  // absent without an earlier record, while history loads or when it failed,
  // which shows no record rather than a wrong one.
  recordBaselineByDefinitionId: ReadonlyMap<string, RecordBaseline>
): CompletedSessionDetailModel => {
  const insightExercises = toInsightExercises(exercises);
  const metrics: SetMetrics[] = [];
  let workingSetCount = 0;

  const cards = exercises.flatMap((exercise): CompletedSessionDetailCard[] => {
    const performed = exercise.sets.flatMap((set) => {
      const figures = performedFigures(set);
      return figures ? [{ set, ...figures }] : [];
    });
    if (performed.length === 0) return [];

    const definitionId = exercise.exerciseDefinitionId ?? null;
    const record = definitionId === null
      ? null
      : deriveExercisePersonalRecord({
          exerciseDefinitionId: definitionId,
          exercises: insightExercises,
          baseline: recordBaselineByDefinitionId.get(definitionId) ?? null,
        });

    // Count working sets and sum independently included volume; each row
    // retains its own figures.
    const working = performed.filter(({ set }) => isWorkingSet(set, exercise.loadContext?.effortPolicy));
    workingSetCount += working.length;
    for (const { set } of performed.filter(({ set }) => isVolumeSet(set, exercise.loadContext?.effortPolicy))) {
      metrics.push(calculateAnalyticsSetMetrics({
        ...(exercise.loadContext ?? ordinaryLoadContext()),
        weightValue: set.weight,
        repsValue: set.reps,
        performanceStatus: set.performanceStatus,
      }));
    }

    return [
      {
        id: exercise.id,
        name: exercise.name,
        setCount: working.length,
        rows: performed.map(({ set, weight, reps }) =>
          formatSetRow({
            id: set.id,
            weight,
            reps,
            loadContext: exercise.loadContext,
            setType: set.setType,
            done: true,
            ...recordFlagsFor(record, set.id),
          })
        ),
        record: cardRecordBand(record, exercise.id),
      },
    ];
  });

  return { cards, workingSetCount, ...sessionVolumeSummary(summarizeVolume(metrics)) };
};

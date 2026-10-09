import {
  loadSessionSnapshotById,
  normalizeSessionSetType,
  type SessionDraftExerciseSnapshot,
} from '@/src/data';
import { loadEarlierBestsByDefinition, recordBaselinesOf } from '@/src/data/exercise-session-facts';
import type { RecordBaseline } from '@/src/exercise-calculations/records';

import {
  buildCompletedSessionDetailModel,
  type CompletedSessionDetailCard,
} from './completed-session-detail-model';

/** A stored session's exercises as View Session's model reads them. */
export const toCompletedSessionDetailExercises = (exercises: SessionDraftExerciseSnapshot[]) =>
  exercises.map((exercise) => ({
    id: exercise.id,
    exerciseDefinitionId: exercise.exerciseDefinitionId,
    name: exercise.name,
    loadContext: exercise.loadContext,
    sets: exercise.sets.map((set) => ({
      id: set.id,
      weight: set.weightValue,
      reps: set.repsValue,
      setType: normalizeSessionSetType(set.setType),
      performanceStatus: set.performanceStatus,
    })),
  }));

/** Each exercise's records in the completed sessions before this one. */
export const loadSessionRecordBaselines = async (
  session: { sessionId: string; completedAt: Date },
  exerciseDefinitionIds: string[]
) => recordBaselinesOf(await loadEarlierBestsByDefinition(session, exerciseDefinitionIds));

/**
 * One completed session's exercise cards exactly as View Session draws them
 * ([[set.row-figures]], `training-metrics-contract.md` §3). Empty for a
 * session that is not completed.
 */
export const loadCompletedSessionCards = async (sessionId: string): Promise<CompletedSessionDetailCard[]> => {
  const graph = await loadSessionSnapshotById(sessionId);
  if (!graph || graph.status !== 'completed') return [];
  const exercises = toCompletedSessionDetailExercises(graph.exercises);
  const definitionIds = [...new Set(exercises.flatMap((exercise) => exercise.exerciseDefinitionId ? [exercise.exerciseDefinitionId] : []))];
  // Records are optional enrichment, as on View Session: a failed read shows
  // the cards without them rather than no cards.
  const baselines = await loadSessionRecordBaselines(
    { sessionId, completedAt: graph.completedAt ?? graph.startedAt },
    definitionIds
  ).catch(() => new Map<string, RecordBaseline>());
  return buildCompletedSessionDetailModel(exercises, baselines).cards;
};

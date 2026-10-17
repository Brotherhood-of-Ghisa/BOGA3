import { useBodyWeightContextRevision } from '@/src/bodyweight/use-context-revision';
import { useCallback, useState } from 'react';
import { useFocusEffect } from 'expo-router';

import { loadExerciseSessionEntries } from '@/src/data/exercise-history';
import { loadExerciseBests, type ExerciseBestsScope } from '@/src/data/exercise-session-facts';

import type { PastRecordsGymScope } from '@/src/exercise-catalog/list-model';

import { deriveLastSession, exerciseRecordsFrom, type ExerciseRecordsSummary } from './exercise-records';

export type ExerciseRecordsState =
  { status: 'loading' } | { status: 'error' } | { status: 'ready'; summary: ExerciseRecordsSummary };

/**
 * Records from the exercise session facts; `Last` is the newest fact row in
 * scope, and only that session's sets are loaded.
 */
export const loadExerciseRecords = async (scope: ExerciseBestsScope): Promise<ExerciseRecordsSummary> => {
  const bests = await loadExerciseBests(scope);
  const entries = bests.latest
    ? await loadExerciseSessionEntries({
        exerciseDefinitionId: scope.exerciseDefinitionId,
        sessionId: bests.latest.sessionId,
      })
    : [];
  return { records: exerciseRecordsFrom(bests), last: deriveLastSession(entries) };
};

export type LoadExerciseRecords = typeof loadExerciseRecords;

/**
 * Where the panel is being read from: the session on screen, that session's
 * gym, and the account's gym-filter choice. The session is not a filter — its
 * gym picks the bucket an exercise split per gym reports ([[gym.split]]) —
 * while `scope` alone decides whether the one gym filter is on.
 */
export type ExerciseRecordsGymFilter = {
  scope: PastRecordsGymScope;
  /** The viewing session's gym; `null` when it has none. */
  currentGymId: string | null;
  /** The viewing session. Omitted by a caller reading outside one. */
  sessionId?: string | null;
};

/**
 * All-time records and the previous session for one exercise definition.
 * `beforeSessionId` names a completed session being edited: only the sessions
 * before it count, the session view's live record rule.
 */
export const useExerciseRecords = (
  exerciseDefinitionId: string | null,
  load: LoadExerciseRecords = loadExerciseRecords,
  beforeSessionId: string | null = null,
  gymFilter?: ExerciseRecordsGymFilter,
  refreshKey: string | number = 0
): ExerciseRecordsState => {
  const [state, setState] = useState<ExerciseRecordsState>({
    status: 'loading',
  });

  const datedWeightRevision = useBodyWeightContextRevision();
  const filterScope = gymFilter?.scope ?? 'all';
  const filterGymId = gymFilter?.currentGymId ?? null;
  const inSessionId = gymFilter?.sessionId ?? null;

  useFocusEffect(useCallback(() => {
    if (!exerciseDefinitionId) return;
    let cancelled = false;
    setState({ status: 'loading' });
    void load({
      exerciseDefinitionId,
      beforeSessionId,
      inSessionId,
      ...(filterScope === 'current-gym' && filterGymId ? { gymId: filterGymId } : {}),
    })
      .then((summary) => {
        if (!cancelled) setState({ status: 'ready', summary });
      })
      .catch(() => {
        if (!cancelled) setState({ status: 'error' });
      });
    return () => {
      cancelled = true;
    };
  // The explicit revision invalidates history after a saved-weight or load review.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beforeSessionId, exerciseDefinitionId, filterGymId, filterScope, inSessionId, load, refreshKey, datedWeightRevision]));

  return state;
};

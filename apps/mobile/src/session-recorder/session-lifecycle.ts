import type { Session } from '@/components/session-recorder/types';
import { getAuthSnapshot } from '@/src/auth';
import {
  completeSessionDraft,
  loadLatestSessionDraftSnapshot,
  persistSessionDraftSnapshot,
  setSessionDeletedState,
  upsertLocalGym,
  type ExerciseBlockHistorySuggestedPlan,
} from '@/src/data';
import { logEvent } from '@/src/logging';

import {
  appendSuggestedPlan,
  createExercise,
  mapDraftSnapshotToSession,
  parseSessionDateTime,
  toPersistCompletedExercises,
  toPersistDraftExercises,
} from './session-model';

/**
 * Ends an active session the way the recorder always has: persist the
 * completed-history graph (confirmed sets only) over the draft, then mark it
 * completed, which stamps `completedAt` and materialises `durationSec`.
 * Shared by the recorder and the session view so both write the tables alike.
 */
export const completeActiveSession = async (input: {
  sessionId: string | undefined;
  gymId: string | null;
  startedAt: Date;
  completedHistorySession: Session;
}): Promise<string> => {
  const persisted = await persistSessionDraftSnapshot({
    sessionId: input.sessionId,
    gymId: input.gymId,
    startedAt: input.startedAt,
    status: 'active',
    exercises: toPersistCompletedExercises(input.completedHistorySession),
  });

  await completeSessionDraft(persisted.sessionId);
  return persisted.sessionId;
};

/**
 * Abandons an active session: the same soft delete the Sessions list's
 * "Delete active session" performs, so it syncs as a tombstone.
 */
export const abandonActiveSession = (sessionId: string): Promise<void> =>
  setSessionDeletedState(sessionId, true);

export type ActiveSessionGraph = {
  sessionId: string;
  gymId: string | null;
  startedAt: Date;
  session: Session;
};

/** The persisted active draft, if it is still `sessionId`. */
export const loadActiveSessionGraph = async (sessionId: string): Promise<ActiveSessionGraph | null> => {
  const snapshot = await loadLatestSessionDraftSnapshot();
  if (!snapshot || snapshot.sessionId !== sessionId) {
    return null;
  }
  const session = mapDraftSnapshotToSession(snapshot);
  return {
    sessionId: snapshot.sessionId,
    gymId: snapshot.gymId,
    // The recorder persists its minute-precision start field; read it back the
    // same way so both screens write the same `startedAt` and `durationSec`.
    startedAt: parseSessionDateTime(session.dateTime) ?? snapshot.startedAt,
    session,
  };
};

const persistActiveSessionGraph = (graph: ActiveSessionGraph, session: Session, gymId = graph.gymId) =>
  persistSessionDraftSnapshot({
    sessionId: graph.sessionId,
    gymId,
    startedAt: graph.startedAt,
    status: 'active',
    exercises: toPersistDraftExercises(session),
  });

const requireActiveSessionGraph = async (sessionId: string): Promise<ActiveSessionGraph> => {
  const graph = await loadActiveSessionGraph(sessionId);
  if (!graph) {
    throw new Error('This session is no longer active.');
  }
  return graph;
};

/**
 * Sets the active session's gym, or clears it with `null`. A seeded gym is
 * written to the local `gyms` table first, as the recorder's autosave does, so
 * the session's `gymId` always names a local row.
 */
export const setActiveSessionGym = async (
  sessionId: string,
  gym: { id: string; name: string } | null
): Promise<void> => {
  const graph = await requireActiveSessionGraph(sessionId);
  if (gym) {
    await upsertLocalGym({ id: gym.id, name: gym.name });
  }
  await persistActiveSessionGraph(graph, graph.session, gym?.id ?? null);
};

/**
 * Adds an exercise with one empty set to the persisted active draft — the
 * recorder's "Add empty set", written straight to the draft because the session
 * view holds no in-memory copy.
 */
export const addExerciseToActiveSession = async (
  sessionId: string,
  exercise: { id: string; name: string }
): Promise<string> => {
  const graph = await requireActiveSessionGraph(sessionId);
  const added = createExercise(exercise.id, exercise.name);
  await persistActiveSessionGraph(graph, {
    ...graph.session,
    exercises: [...graph.session.exercises, added],
  });

  void logEvent({
    level: 'info',
    source: 'app',
    event: 'session.exercise_added',
    message: 'A session exercise was added to the active workout log.',
    userId: getAuthSnapshot().user?.id ?? null,
    context: { exerciseDefinitionId: exercise.id, exerciseName: exercise.name },
  });
  return added.id;
};

/** The recorder's "Append plan", written straight to the persisted draft. */
export const appendPlanToActiveSession = async (
  sessionId: string,
  exercise: { id: string; name: string },
  suggestion: ExerciseBlockHistorySuggestedPlan
): Promise<string> => {
  const graph = await requireActiveSessionGraph(sessionId);
  const { session, targetExerciseId } = appendSuggestedPlan(graph.session, exercise, suggestion.sets);
  await persistActiveSessionGraph(graph, session);

  void logEvent({
    level: 'info',
    source: 'app',
    event: 'session.exercise_plan_appended',
    message: 'A historical exercise plan was appended to the active workout log.',
    userId: getAuthSnapshot().user?.id ?? null,
    context: {
      exerciseDefinitionId: exercise.id,
      exerciseName: exercise.name,
      sourceSessionId: suggestion.sessionId,
      targetExerciseId,
      setCount: suggestion.sets.length,
    },
  });
  return targetExerciseId;
};

import type { Session } from '@/components/session-recorder/types';
import { getAuthSnapshot } from '@/src/auth';
import {
  completeSessionDraft,
  loadLatestSessionDraftSnapshot,
  loadSessionSnapshotById,
  persistCompletedSessionSnapshot,
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
import type { SessionTimes } from './session-times';

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

/**
 * A session the session view can edit: the active draft, or a completed
 * session (the recorder's completed edit, now on the session view). A
 * completed one keeps its persisted instants.
 */
export type EditableSessionGraph = ActiveSessionGraph &
  ({ status: 'active'; completedAt: null } | { status: 'completed'; completedAt: Date });

/** The active draft if it is still `sessionId`, else that completed session. */
export const loadEditableSessionGraph = async (sessionId: string): Promise<EditableSessionGraph | null> => {
  const active = await loadActiveSessionGraph(sessionId);
  if (active) {
    return { ...active, status: 'active', completedAt: null };
  }
  const snapshot = await loadSessionSnapshotById(sessionId);
  if (!snapshot || snapshot.status !== 'completed' || snapshot.deletedAt !== null) {
    return null;
  }
  return {
    sessionId: snapshot.sessionId,
    gymId: snapshot.gymId,
    startedAt: snapshot.startedAt,
    status: 'completed',
    completedAt: snapshot.completedAt ?? snapshot.startedAt,
    session: mapDraftSnapshotToSession(snapshot),
  };
};

/**
 * Writes the whole graph back with every row kept (autosave semantics), as an
 * active draft or as the completed session it is — never replaying completion.
 */
const persistSessionGraph = (
  graph: EditableSessionGraph,
  session: Session,
  { gymId = graph.gymId, times }: { gymId?: string | null; times?: SessionTimes } = {}
) =>
  graph.status === 'completed'
    ? persistCompletedSessionSnapshot({
        sessionId: graph.sessionId,
        gymId,
        startedAt: times?.startedAt ?? graph.startedAt,
        completedAt: times?.completedAt ?? graph.completedAt,
        exercises: toPersistDraftExercises(session),
      })
    : persistSessionDraftSnapshot({
        sessionId: graph.sessionId,
        gymId,
        startedAt: graph.startedAt,
        status: 'active',
        exercises: toPersistDraftExercises(session),
      });

const requireEditableSessionGraph = async (sessionId: string): Promise<EditableSessionGraph> => {
  const graph = await loadEditableSessionGraph(sessionId);
  if (!graph) {
    throw new Error('This session can no longer be edited.');
  }
  return graph;
};

const requireCompletedSessionGraph = async (sessionId: string) => {
  const graph = await requireEditableSessionGraph(sessionId);
  if (graph.status !== 'completed') {
    throw new Error('This session is not completed.');
  }
  return graph;
};

/**
 * Sets the session's gym, or clears it with `null`. A seeded gym is written to
 * the local `gyms` table first, as the recorder's autosave does, so the
 * session's `gymId` always names a local row.
 */
export const setSessionGym = async (sessionId: string, gym: { id: string; name: string } | null): Promise<void> => {
  const graph = await requireEditableSessionGraph(sessionId);
  if (gym) {
    await upsertLocalGym({ id: gym.id, name: gym.name });
  }
  await persistSessionGraph(graph, graph.session, { gymId: gym?.id ?? null });
};

/**
 * Adds an exercise with one empty set to the persisted session — the
 * recorder's "Add empty set", written straight to the graph because the
 * session view holds no in-memory copy.
 */
export const addExerciseToSession = async (
  sessionId: string,
  exercise: { id: string; name: string }
): Promise<string> => {
  const graph = await requireEditableSessionGraph(sessionId);
  const added = createExercise(exercise.id, exercise.name);
  await persistSessionGraph(graph, {
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

/** The recorder's "Append plan", written straight to the persisted session. */
export const appendPlanToSession = async (
  sessionId: string,
  exercise: { id: string; name: string },
  suggestion: ExerciseBlockHistorySuggestedPlan
): Promise<string> => {
  const graph = await requireEditableSessionGraph(sessionId);
  const { session, targetExerciseId } = appendSuggestedPlan(graph.session, exercise, suggestion.sets);
  await persistSessionGraph(graph, session);

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

/** Autosaves a completed session's edited Start/End; its rows are kept as persisted. */
export const setCompletedSessionTimes = async (sessionId: string, times: SessionTimes): Promise<void> => {
  const graph = await requireCompletedSessionGraph(sessionId);
  await persistSessionGraph(graph, graph.session, { times });
};

/**
 * Done on a completed edit: the recorder's completed-edit save. Writes the
 * completed-history graph (confirmed sets only, after the submit cleanup) with
 * the edited times; the session stays completed and completion is not replayed.
 */
export const saveCompletedSessionEdit = async (input: {
  sessionId: string;
  gymId: string | null;
  times: SessionTimes;
  completedHistorySession: Session;
}): Promise<void> => {
  await persistCompletedSessionSnapshot({
    sessionId: input.sessionId,
    gymId: input.gymId,
    startedAt: input.times.startedAt,
    completedAt: input.times.completedAt,
    exercises: toPersistCompletedExercises(input.completedHistorySession),
  });
};

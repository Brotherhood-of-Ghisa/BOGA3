import {
  loadSessionSnapshotById,
  persistCompletedSessionSnapshot,
  persistSessionDraftSnapshot,
  type SessionDraftExerciseSnapshot,
  type SessionDraftExerciseInput,
  type SessionGraphSnapshot,
} from '@/src/data/session-drafts';

/**
 * One session exercise of an active draft or a completed session, read and
 * written through the same repository the recorder uses. The repository saves a
 * whole session graph, so a write reads the latest persisted graph and replaces
 * only this exercise: the page never writes other exercises back from its own
 * (possibly stale) copy. A completed session is written back as completed, with
 * its times as persisted, and every row kept (`05-data-model.md`: completed-edit
 * autosave is lossless; only the session view's Done drops unconfirmed rows).
 */

export type SessionExerciseDraftClient = {
  loadSessionSnapshotById: (sessionId: string) => Promise<SessionGraphSnapshot | null>;
  persistSessionDraftSnapshot: typeof persistSessionDraftSnapshot;
  persistCompletedSessionSnapshot: typeof persistCompletedSessionSnapshot;
};

export const defaultSessionExerciseDraftClient: SessionExerciseDraftClient = {
  loadSessionSnapshotById,
  persistSessionDraftSnapshot,
  persistCompletedSessionSnapshot,
};

// `not-editable`: the session was abandoned or deleted.
export type SessionExerciseDraftLoadError = 'missing-session' | 'not-editable' | 'missing-exercise';

export type SessionExerciseDraftLoad =
  | {
      status: 'ready';
      exercise: SessionDraftExerciseSnapshot;
      sessionStatus: SessionGraphSnapshot['status'];
    }
  | { status: SessionExerciseDraftLoadError };

export class SessionExerciseDraftError extends Error {
  constructor(readonly reason: SessionExerciseDraftLoadError) {
    super(`Cannot save the session exercise: ${reason}`);
    this.name = 'SessionExerciseDraftError';
  }
}

const isEditable = (session: SessionGraphSnapshot) =>
  (session.status === 'active' || session.status === 'completed') && session.deletedAt === null;

export const loadSessionExerciseDraft = async (
  sessionId: string,
  sessionExerciseId: string,
  client: SessionExerciseDraftClient = defaultSessionExerciseDraftClient
): Promise<SessionExerciseDraftLoad> => {
  const session = await client.loadSessionSnapshotById(sessionId);
  if (!session) return { status: 'missing-session' };
  if (!isEditable(session)) return { status: 'not-editable' };
  const exercise = session.exercises.find((candidate) => candidate.id === sessionExerciseId);
  return exercise ? { status: 'ready', exercise, sessionStatus: session.status } : { status: 'missing-exercise' };
};

export const toSessionExerciseInput = (exercise: SessionDraftExerciseSnapshot): SessionDraftExerciseInput => ({
  id: exercise.id,
  exerciseDefinitionId: exercise.exerciseDefinitionId,
  name: exercise.name,
  machineName: exercise.machineName,
  sets: exercise.sets.map((set) => ({
    id: set.id,
    weightValue: set.weightValue,
    repsValue: set.repsValue,
    setType: set.setType,
    plannedWeightValue: set.plannedWeightValue,
    plannedRepsValue: set.plannedRepsValue,
    plannedSetType: set.plannedSetType,
    performanceStatus: set.performanceStatus,
  })),
});

/**
 * Writes `exercise` into its session, or removes the exercise when `null` is
 * passed with its id. Throws `SessionExerciseDraftError` rather than recreate a
 * session or exercise that is gone (abandoned, deleted or removed elsewhere),
 * or write into a session whose status is no longer the one the page loaded
 * (an active session finished elsewhere is history, not a draft).
 */
export const saveSessionExerciseDraft = async (
  sessionId: string,
  change: {
    sessionExerciseId: string;
    exercise: SessionDraftExerciseSnapshot | null;
    // The status the page loaded the session with.
    sessionStatus: SessionGraphSnapshot['status'];
  },
  client: SessionExerciseDraftClient = defaultSessionExerciseDraftClient
): Promise<void> => {
  const session = await client.loadSessionSnapshotById(sessionId);
  if (!session) throw new SessionExerciseDraftError('missing-session');
  if (!isEditable(session) || session.status !== change.sessionStatus) {
    throw new SessionExerciseDraftError('not-editable');
  }
  if (!session.exercises.some((exercise) => exercise.id === change.sessionExerciseId)) {
    throw new SessionExerciseDraftError('missing-exercise');
  }

  const exercises = session.exercises.flatMap((exercise) => {
    if (exercise.id !== change.sessionExerciseId) return [exercise];
    return change.exercise ? [change.exercise] : [];
  });

  const graph = {
    sessionId: session.sessionId,
    gymId: session.gymId,
    startedAt: session.startedAt,
    exercises: exercises.map(toSessionExerciseInput),
  };
  if (session.status === 'completed') {
    await client.persistCompletedSessionSnapshot({
      ...graph,
      completedAt: session.completedAt ?? session.startedAt,
    });
    return;
  }
  await client.persistSessionDraftSnapshot({ ...graph, status: 'active' });
};

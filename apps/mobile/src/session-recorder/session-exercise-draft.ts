import {
  loadSessionSnapshotById,
  persistSessionDraftSnapshot,
  type SessionDraftExerciseSnapshot,
  type SessionDraftExerciseInput,
  type SessionGraphSnapshot,
} from '@/src/data/session-drafts';

/**
 * One session exercise of an active draft, read and written through the same
 * repository the recorder uses. The repository saves a whole session graph, so
 * a write reads the latest persisted graph and replaces only this exercise:
 * the page never writes other exercises back from its own (possibly stale)
 * copy.
 */

export type SessionExerciseDraftClient = {
  loadSessionSnapshotById: (sessionId: string) => Promise<SessionGraphSnapshot | null>;
  persistSessionDraftSnapshot: typeof persistSessionDraftSnapshot;
};

export const defaultSessionExerciseDraftClient: SessionExerciseDraftClient = {
  loadSessionSnapshotById,
  persistSessionDraftSnapshot,
};

export type SessionExerciseDraftLoadError = 'missing-session' | 'not-active' | 'missing-exercise';

export type SessionExerciseDraftLoad =
  { status: 'ready'; exercise: SessionDraftExerciseSnapshot } | { status: SessionExerciseDraftLoadError };

export class SessionExerciseDraftError extends Error {
  constructor(readonly reason: SessionExerciseDraftLoadError) {
    super(`Cannot save the session exercise: ${reason}`);
    this.name = 'SessionExerciseDraftError';
  }
}

const isActive = (session: SessionGraphSnapshot) => session.status === 'active' && session.deletedAt === null;

export const loadSessionExerciseDraft = async (
  sessionId: string,
  sessionExerciseId: string,
  client: SessionExerciseDraftClient = defaultSessionExerciseDraftClient
): Promise<SessionExerciseDraftLoad> => {
  const session = await client.loadSessionSnapshotById(sessionId);
  if (!session) return { status: 'missing-session' };
  if (!isActive(session)) return { status: 'not-active' };
  const exercise = session.exercises.find((candidate) => candidate.id === sessionExerciseId);
  return exercise ? { status: 'ready', exercise } : { status: 'missing-exercise' };
};

const toInput = (exercise: SessionDraftExerciseSnapshot): SessionDraftExerciseInput => ({
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
 * session or exercise that is gone (finished, abandoned or removed elsewhere).
 */
export const saveSessionExerciseDraft = async (
  sessionId: string,
  change: {
    sessionExerciseId: string;
    exercise: SessionDraftExerciseSnapshot | null;
  },
  client: SessionExerciseDraftClient = defaultSessionExerciseDraftClient
): Promise<void> => {
  const session = await client.loadSessionSnapshotById(sessionId);
  if (!session) throw new SessionExerciseDraftError('missing-session');
  if (!isActive(session)) throw new SessionExerciseDraftError('not-active');
  if (!session.exercises.some((exercise) => exercise.id === change.sessionExerciseId)) {
    throw new SessionExerciseDraftError('missing-exercise');
  }

  const exercises = session.exercises.flatMap((exercise) => {
    if (exercise.id !== change.sessionExerciseId) return [exercise];
    return change.exercise ? [change.exercise] : [];
  });

  await client.persistSessionDraftSnapshot({
    sessionId: session.sessionId,
    gymId: session.gymId,
    startedAt: session.startedAt,
    status: 'active',
    exercises: exercises.map(toInput),
  });
};

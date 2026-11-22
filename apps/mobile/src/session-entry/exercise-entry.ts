import { getAccountLocalPreferenceAccountRevision } from '@/src/preferences/account-local';
import { listExerciseCatalogExercises } from '@/src/data/exercise-catalog';
import { loadSuggestedExercisePlan } from '@/src/data/exercise-block-history';
import { loadSessionSnapshotById, persistSessionDraftSnapshot } from '@/src/data/session-drafts';
import { createExercise, createPlannedSetFromSuggestedSet, mapDraftSnapshotToSession, toPersistDraftExercises } from '@/src/session-recorder/session-model';

export type ExerciseEntryMode = 'empty' | 'repeat';
export type ExerciseEntryInput = { exerciseDefinitionId: string; mode: ExerciseEntryMode };
export type ExerciseEntryResult = {
  kind: 'started' | 'resumed';
  sessionId: string;
  sessionExerciseId: string;
  setId: string;
};

/** One graph save: a failed first add cannot leave an empty started workout. */
export async function enterSessionFromExercise(
  input: ExerciseEntryInput,
  activeSessionId: string | null,
): Promise<ExerciseEntryResult> {
  const accountRevision = getAccountLocalPreferenceAccountRevision();
  const initial = activeSessionId ? await loadSessionSnapshotById(activeSessionId) : null;
  if (activeSessionId && (!initial || initial.status !== 'active' || initial.deletedAt)) {
    throw new Error('The workout changed. Try again.');
  }
  const suggestion = input.mode === 'repeat'
    ? await loadSuggestedExercisePlan({ exerciseDefinitionId: input.exerciseDefinitionId, ...(activeSessionId ? { inSessionId: activeSessionId } : {}) })
    : null;
  if (input.mode === 'repeat' && !suggestion?.sets.length) throw new Error('No earlier workout to repeat.');

  const exercise = (await listExerciseCatalogExercises()).find(row => row.id === input.exerciseDefinitionId);
  if (!exercise) throw new Error('This exercise is no longer available.');
  // History can await several reads. Append to the fresh graph, never its earlier copy.
  const snapshot = activeSessionId ? await loadSessionSnapshotById(activeSessionId) : null;
  if (activeSessionId && (!snapshot || snapshot.status !== 'active' || snapshot.deletedAt || snapshot.gymId !== initial?.gymId)) {
    throw new Error('The workout changed. Try again.');
  }
  const startedAt = snapshot?.startedAt ?? new Date();
  const session = snapshot ? mapDraftSnapshotToSession(snapshot) : { dateTime: '', locationId: null, exercises: [] };
  const added = createExercise(exercise.id, exercise.name, exercise.recordingMode);
  if (suggestion) added.sets = suggestion.sets.map(createPlannedSetFromSuggestedSet);
  // The target card follows [[exercise.quick-entry]].
  const target = [...session.exercises].reverse().find(card => card.exerciseDefinitionId === exercise.id);
  const next = {
    ...session,
    exercises: target
      ? session.exercises.map(card => card.id === target.id ? { ...card, sets: [...card.sets, ...added.sets] } : card)
      : [...session.exercises, added],
  };
  if (accountRevision !== getAccountLocalPreferenceAccountRevision()) throw new Error('The account changed. Try again.');
  const saved = await persistSessionDraftSnapshot({
    sessionId: activeSessionId ?? undefined,
    gymId: snapshot?.gymId ?? null,
    startedAt,
    status: 'active',
    editBaseline: snapshot?.editBaseline,
    mergeRevisions: snapshot ? Object.fromEntries(snapshot.exercises.map(card => [card.id, card.mergeRevision ?? 0])) : undefined,
    exercises: toPersistDraftExercises(next),
  }, { requireNoActiveSession: !activeSessionId });
  return { kind: activeSessionId ? 'resumed' : 'started', sessionId: saved.sessionId,
    sessionExerciseId: target?.id ?? added.id, setId: added.sets[0].id };
}

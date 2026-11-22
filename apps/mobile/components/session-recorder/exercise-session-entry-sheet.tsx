import { useEffect, useRef, useState } from 'react';

import { useOpenActiveWorkout } from '@/components/navigation/use-open-main-tab';
import { ActionButton } from '@/components/ui/action-button';
import { Notice } from '@/components/ui/notice';
import { Sheet } from '@/components/ui/sheet';
import { loadSuggestedExercisePlan } from '@/src/data/exercise-block-history';
import { getAccountLocalPreferenceAccountRevision } from '@/src/preferences/account-local';
import { DEFAULT_SESSION_ENTRY_COORDINATOR, loadActiveSessionId, type ExerciseEntryMode, type ExerciseEntryResult } from '@/src/session-entry';
import type { ExercisePickerPreselectionState } from './types';
import { PickerPreselectionCard } from './picker-preselection-card';

type ExerciseTarget = { id: string; name: string };

/** The shared choice and write state for [[exercise.quick-entry]]. */
export function ExerciseSessionEntrySheet({ exercise, onDismiss }: {
  exercise: ExerciseTarget | null;
  onDismiss: () => void;
}) {
  const openWorkout = useOpenActiveWorkout();
  const [preview, setPreview] = useState<Pick<ExercisePickerPreselectionState, 'status' | 'suggestion'>>({ status: 'loading', suggestion: null });
  const [attempt, setAttempt] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState<ExerciseEntryResult | null>(null);
  const writing = useRef(false);
  const generation = useRef(0);
  const exerciseId = exercise?.id;

  const [previousExerciseId, setPreviousExerciseId] = useState(exerciseId);
  if (previousExerciseId !== exerciseId) {
    setPreviousExerciseId(exerciseId);
    setPreview({ status: 'loading', suggestion: null });
    setNotice(null);
    setSaved(null);
  }

  useEffect(() => {
    const request = ++generation.current;
    if (!exerciseId) return;
    void (async () => {
      const activeSessionId = await loadActiveSessionId();
      return loadSuggestedExercisePlan({ exerciseDefinitionId: exerciseId,
        ...(activeSessionId ? { inSessionId: activeSessionId } : {}) });
    })().then(
      suggestion => { if (generation.current === request) setPreview({ status: 'ready', suggestion }); },
      () => { if (generation.current === request) setPreview({ status: 'error', suggestion: null }); },
    );
    return () => { generation.current += 1; };
  }, [exerciseId, attempt]);

  const choose = async (mode: ExerciseEntryMode) => {
    if (!exercise || writing.current) return;
    writing.current = true;
    setBusy(true);
    setNotice(null);
    const request = generation.current;
    const accountRevision = getAccountLocalPreferenceAccountRevision();
    try {
      const result = await DEFAULT_SESSION_ENTRY_COORDINATOR.startFromExercise({ exerciseDefinitionId: exercise.id, mode });
      if (request === generation.current && accountRevision === getAccountLocalPreferenceAccountRevision()) setSaved(result);
    } catch (error) {
      if (request === generation.current) setNotice(error instanceof Error ? error.message : "Couldn't add this exercise. Try again.");
    } finally {
      writing.current = false;
      if (request === generation.current) setBusy(false);
    }
  };

  return (
    <Sheet dismissLabel="Dismiss add to session" onDismiss={() => { if (!writing.current) onDismiss(); }}
      onDismissed={() => {
        if (!saved) return;
        onDismiss();
        openWorkout(saved.sessionId, { sessionExerciseId: saved.sessionExerciseId, setId: saved.setId });
      }} testID="exercise-session-entry-sheet" title="Add to session" visible={exercise !== null && saved === null}>
      {exercise ? <PickerPreselectionCard state={{ exercise, ...preview }} disabled={busy}
        repeatDisabled={preview.status !== 'ready' || !preview.suggestion?.sets.length}
        onAddEmptySet={() => void choose('empty')} onRepeat={() => void choose('repeat')} /> : null}
      {preview.status === 'error' ? <ActionButton disabled={busy} label="Retry" onPress={() => { setPreview({ status: 'loading', suggestion: null }); setAttempt(value => value + 1); }}
        testID="exercise-session-entry-retry" variant="text" /> : null}
      {notice ? <Notice live message={notice} testID="exercise-session-entry-error" tone="danger" /> : null}
    </Sheet>
  );
}

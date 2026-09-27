import { useBodyWeightContextRevision } from '@/src/bodyweight/use-context-revision';
import { useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import type { SessionBodyWeightSnapshot, SessionDraftExerciseSnapshot, SessionGraphSnapshot } from '@/src/data/session-drafts';

import { createDraftAutosaveController, type DraftAutosaveController } from './draft-autosave';
import { createSessionRecorderLifecycleHelpers } from './lifecycle-helpers';
import {
  defaultSessionExerciseDraftClient,
  loadSessionExerciseDraft,
  saveSessionExerciseDraft,
  type SessionExerciseDraftClient,
  type SessionExerciseDraftLoadError,
} from './session-exercise-draft';

/**
 * The exercise page's persistence: loads one session exercise and keeps it
 * saved with the recorder's own autosave controller and lifecycle helpers —
 * the same debounce, structural writes, background/blur flushes and
 * flush-on-dispose — so the two screens cannot drift on when a draft is saved.
 */

export type SessionExerciseDraftState =
  | { status: 'loading' }
  | { status: 'error'; reason: SessionExerciseDraftLoadError | 'load-failed' }
  | {
      status: 'ready';
      exercise: SessionDraftExerciseSnapshot;
      // A completed session is edited in place (history, not a draft).
      sessionStatus: SessionGraphSnapshot['status'];
      bodyWeight: SessionBodyWeightSnapshot;
      gymId: string | null;
    };

// `text`: typing, saved after the debounce. `structural`: a commit, toggle,
// add, swap or complete, saved at once.
export type SessionExerciseMutationKind = 'text' | 'structural';

export type UseSessionExerciseDraft = {
  state: SessionExerciseDraftState;
  // The last save failure, cleared by the next successful save.
  saveError: string | null;
  update: (
    recipe: (exercise: SessionDraftExerciseSnapshot) => SessionDraftExerciseSnapshot,
    kind: SessionExerciseMutationKind
  ) => void;
  // Resolves once every pending change is written; `false` if the write failed.
  flush: () => Promise<boolean>;
  // Removes the exercise from its session. Pending edits are dropped.
  remove: () => Promise<void>;
  reload: () => Promise<boolean>;
  setBodyWeight: (snapshot: SessionBodyWeightSnapshot) => void;
};

const describeSaveError = (error: unknown) =>
  error instanceof Error ? error.message : 'Changes could not be saved.';

export const useSessionExerciseDraft = ({
  sessionId,
  sessionExerciseId,
  client = defaultSessionExerciseDraftClient,
}: {
  sessionId: string;
  sessionExerciseId: string;
  client?: SessionExerciseDraftClient;
}): UseSessionExerciseDraft => {
  const [state, setState] = useState<SessionExerciseDraftState>({
    status: 'loading',
  });
  const [saveError, setSaveError] = useState<string | null>(null);
  const exerciseRef = useRef<SessionDraftExerciseSnapshot | null>(null);
  const sessionStatusRef = useRef<SessionGraphSnapshot['status']>('active');
  const bodyWeightRef = useRef<SessionBodyWeightSnapshot>({});
  const gymIdRef = useRef<string | null>(null);
  const saveFailedRef = useRef(false);
  const isMountedRef = useRef(true);
  const autosaveRef = useRef<DraftAutosaveController | null>(null);
  const navigation = useNavigation();

  if (!autosaveRef.current) {
    autosaveRef.current = createDraftAutosaveController({
      persistDraft: async () => {
        const exercise = exerciseRef.current;
        if (!exercise) return;
        await saveSessionExerciseDraft(
          sessionId,
          { sessionExerciseId, exercise, sessionStatus: sessionStatusRef.current },
          client
        );
        saveFailedRef.current = false;
        if (isMountedRef.current) setSaveError(null);
      },
      onError: (error) => {
        saveFailedRef.current = true;
        if (isMountedRef.current) setSaveError(describeSaveError(error));
      },
    });
  }
  const autosave = autosaveRef.current;
  const lifecycle = useMemo(() => createSessionRecorderLifecycleHelpers(autosave), [autosave]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      void lifecycle.onAppStateChange(nextState);
    });
    return () => subscription.remove();
  }, [lifecycle]);

  useEffect(
    () => () => {
      isMountedRef.current = false;
      void lifecycle.onRouteChange();
      void autosave.dispose({ flushDirty: true });
    },
    [autosave, lifecycle]
  );

  // Leaving the page writes pending edits before the screen goes, so the
  // session view it returns to reads them.
  useEffect(() => {
    if (!navigation || typeof navigation.addListener !== 'function') return;
    let replaying = false;
    return navigation.addListener('beforeRemove', (event) => {
      if (replaying || !autosave.isDirty()) return;
      event.preventDefault();
      void autosave.flushNow().finally(() => {
        replaying = true;
        navigation.dispatch(event.data.action);
      });
    });
  }, [autosave, navigation]);

  const update = useCallback<UseSessionExerciseDraft['update']>(
    (recipe, kind) => {
      const current = exerciseRef.current;
      if (!current) return;
      const next = recipe(current);
      if (next === current) return;
      exerciseRef.current = next;
      setState({ status: 'ready', exercise: next, sessionStatus: sessionStatusRef.current, bodyWeight: bodyWeightRef.current, gymId: gymIdRef.current });
      if (kind === 'text') {
        autosave.markTextMutation();
      } else {
        void autosave.markStructuralMutation();
      }
    },
    [autosave]
  );

  const flush = useCallback(async () => {
    await autosave.flushNow();
    return !saveFailedRef.current;
  }, [autosave]);

  const remove = useCallback(async () => {
    await autosave.dispose({ flushDirty: false });
    await saveSessionExerciseDraft(
      sessionId,
      { sessionExerciseId, exercise: null, sessionStatus: sessionStatusRef.current },
      client
    );
  }, [autosave, client, sessionExerciseId, sessionId]);

  const setBodyWeight = useCallback((snapshot: SessionBodyWeightSnapshot) => {
    bodyWeightRef.current = snapshot;
    setState(current => current.status === 'ready' ? { ...current, bodyWeight: snapshot } : current);
  }, []);
  const datedWeightRevision = useBodyWeightContextRevision();
  const reload = useCallback(async () => {
    if (!await flush()) return false;
    const prior = exerciseRef.current;
    try {
    const result = await loadSessionExerciseDraft(sessionId, sessionExerciseId, client);
    if (!isMountedRef.current || prior !== exerciseRef.current) return false;
    if (result.status === 'ready') {
      exerciseRef.current = result.exercise; sessionStatusRef.current = result.sessionStatus;
      bodyWeightRef.current = result.bodyWeight;
      gymIdRef.current = result.gymId;
      setState({ status: 'ready', exercise: result.exercise, sessionStatus: result.sessionStatus, bodyWeight: result.bodyWeight, gymId: result.gymId });
    } else setState({ status: 'error', reason: result.status });
    return result.status === 'ready';
    } catch (error) {
      if (isMountedRef.current) { setState({ status: 'error', reason: 'load-failed' }); setSaveError(describeSaveError(error)); }
      return false;
    }
  }, [client, flush, sessionExerciseId, sessionId]);
  useFocusEffect(useCallback(() => {
    void reload();
    return () => { void lifecycle.onScreenBlur(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- A committed timeline change must reload the focused projection.
  }, [lifecycle, reload, datedWeightRevision]));
  return { state, saveError, update, flush, remove, reload, setBodyWeight };
};

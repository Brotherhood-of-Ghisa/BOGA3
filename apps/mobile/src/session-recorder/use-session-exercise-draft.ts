import { useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import type { SessionBodyWeightSnapshot, SessionDraftExerciseSnapshot, SessionGraphSnapshot } from '@/src/data/session-drafts';

import { createDraftAutosaveController } from './draft-autosave';
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

// What the autosave controller writes, kept outside React state so the
// controller — created once, on first render — always writes the latest.
type ExerciseDraftLive = {
  exercise: SessionDraftExerciseSnapshot | null;
  sessionStatus: SessionGraphSnapshot['status'];
  bodyWeight: SessionBodyWeightSnapshot;
  gymId: string | null;
  saveFailed: boolean;
  mounted: boolean;
};

const createExerciseDraftPersistence = ({
  sessionId,
  sessionExerciseId,
  client,
  setSaveError,
}: {
  sessionId: string;
  sessionExerciseId: string;
  client: SessionExerciseDraftClient;
  setSaveError: (message: string | null) => void;
}) => {
  const live: ExerciseDraftLive = {
    exercise: null,
    sessionStatus: 'active',
    bodyWeight: {},
    gymId: null,
    saveFailed: false,
    mounted: true,
  };
  const autosave = createDraftAutosaveController({
    persistDraft: async () => {
      const exercise = live.exercise;
      if (!exercise) return;
      await saveSessionExerciseDraft(
        sessionId,
        { sessionExerciseId, exercise, sessionStatus: live.sessionStatus },
        client
      );
      live.saveFailed = false;
      if (live.mounted) setSaveError(null);
    },
    onError: (error) => {
      live.saveFailed = true;
      if (live.mounted) setSaveError(describeSaveError(error));
    },
  });
  return {
    live: live as Readonly<ExerciseDraftLive>,
    setLive: (patch: Partial<ExerciseDraftLive>) => {
      Object.assign(live, patch);
    },
    autosave,
    lifecycle: createSessionRecorderLifecycleHelpers(autosave),
  };
};

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
  const navigation = useNavigation();
  const [{ live, setLive, autosave, lifecycle }] = useState(() =>
    createExerciseDraftPersistence({ sessionId, sessionExerciseId, client, setSaveError })
  );

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      void lifecycle.onAppStateChange(nextState);
    });
    return () => subscription.remove();
  }, [lifecycle]);

  useEffect(
    () => () => {
      setLive({ mounted: false });
      void lifecycle.onRouteChange();
      void autosave.dispose({ flushDirty: true });
    },
    [autosave, lifecycle, setLive]
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
      const current = live.exercise;
      if (!current) return;
      const next = recipe(current);
      if (next === current) return;
      setLive({ exercise: next });
      setState({ status: 'ready', exercise: next, sessionStatus: live.sessionStatus, bodyWeight: live.bodyWeight, gymId: live.gymId });
      if (kind === 'text') {
        autosave.markTextMutation();
      } else {
        void autosave.markStructuralMutation();
      }
    },
    [autosave, live, setLive]
  );

  const flush = useCallback(async () => {
    await autosave.flushNow();
    return !live.saveFailed;
  }, [autosave, live]);

  const remove = useCallback(async () => {
    await autosave.dispose({ flushDirty: false });
    await saveSessionExerciseDraft(
      sessionId,
      { sessionExerciseId, exercise: null, sessionStatus: live.sessionStatus },
      client
    );
  }, [autosave, client, live, sessionExerciseId, sessionId]);

  const setBodyWeight = useCallback((snapshot: SessionBodyWeightSnapshot) => {
    setLive({ bodyWeight: snapshot });
    setState(current => current.status === 'ready' ? { ...current, bodyWeight: snapshot } : current);
  }, [setLive]);
  const reload = useCallback(async () => {
    if (!await flush()) return false;
    const prior = live.exercise;
    try {
    const result = await loadSessionExerciseDraft(sessionId, sessionExerciseId, client);
    if (!live.mounted || prior !== live.exercise) return false;
    if (result.status === 'ready') {
      setLive({ exercise: result.exercise, sessionStatus: result.sessionStatus, bodyWeight: result.bodyWeight, gymId: result.gymId });
      setState({ status: 'ready', exercise: result.exercise, sessionStatus: result.sessionStatus, bodyWeight: result.bodyWeight, gymId: result.gymId });
    } else setState({ status: 'error', reason: result.status });
    return result.status === 'ready';
    } catch (error) {
      if (live.mounted) { setState({ status: 'error', reason: 'load-failed' }); setSaveError(describeSaveError(error)); }
      return false;
    }
  }, [client, flush, live, sessionExerciseId, setLive, sessionId]);
  useFocusEffect(useCallback(() => {
    void reload();
    return () => { void lifecycle.onScreenBlur(); };
  }, [lifecycle, reload]));
  return { state, saveError, update, flush, remove, reload, setBodyWeight };
};

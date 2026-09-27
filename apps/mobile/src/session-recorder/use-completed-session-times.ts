import { useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { createDraftAutosaveController } from './draft-autosave';
import { createSessionRecorderLifecycleHelpers } from './lifecycle-helpers';
import { setCompletedSessionTimes } from './session-lifecycle';
import {
  formatSessionTimes,
  resolveSessionTimes,
  TIMES_AUTOSAVE_PAUSED_NOTICE,
  validateSessionTimes,
  type SessionTimes,
  type SessionTimesText,
  type SessionTimesValidation,
} from './session-times';

/**
 * The editable Start/End of a completed session on the session view, saved
 * with the recorder's autosave controller and lifecycle helpers (debounced
 * typing, flush on field blur, screen blur, background and leaving). While the
 * times are invalid nothing is written: autosave pauses and says so, as the
 * recorder's completed edit did. A field's error shows once it has been left,
 * or once Done asks for the times.
 */

export type UseCompletedSessionTimes = {
  text: SessionTimesText;
  // Messages to show now (a field's only once it was left, or after Done).
  errors: SessionTimesValidation;
  notice: string | null;
  saveError: string | null;
  setStart: (text: string) => void;
  setEnd: (text: string) => void;
  commitStart: () => void;
  commitEnd: () => void;
  // For Done: the valid times, or `null` after revealing every error.
  submit: () => SessionTimes | null;
  // Resolves once pending valid times are written; `false` if the write failed.
  flush: () => Promise<boolean>;
};

const EMPTY_TEXT: SessionTimesText = { start: '', end: '' };

const describeSaveError = (error: unknown) =>
  error instanceof Error ? error.message : 'Changes could not be saved.';

// What the autosave controller writes, kept outside React state so the
// controller — created once, on first render — always writes the latest.
type SessionTimesLive = {
  text: SessionTimesText;
  // The instants first loaded: a field left showing them keeps them exactly.
  initial: SessionTimes | null;
  saveFailed: boolean;
  mounted: boolean;
};

const createSessionTimesPersistence = ({
  sessionId,
  save,
  setPaused,
  setSaveError,
}: {
  sessionId: string | null;
  save: (sessionId: string, times: SessionTimes) => Promise<void>;
  setPaused: (paused: boolean) => void;
  setSaveError: (message: string | null) => void;
}) => {
  const live: SessionTimesLive = { text: EMPTY_TEXT, initial: null, saveFailed: false, mounted: true };
  const autosave = createDraftAutosaveController({
    persistDraft: async () => {
      const initial = live.initial;
      if (!sessionId || !initial) return;
      const times = resolveSessionTimes(live.text, initial);
      if (!times) {
        if (live.mounted) setPaused(true);
        return;
      }
      await save(sessionId, times);
      live.saveFailed = false;
      if (live.mounted) {
        setPaused(false);
        setSaveError(null);
      }
    },
    onError: (error) => {
      live.saveFailed = true;
      if (live.mounted) setSaveError(describeSaveError(error));
    },
  });
  return {
    live: live as Readonly<SessionTimesLive>,
    setLive: (patch: Partial<SessionTimesLive>) => {
      Object.assign(live, patch);
    },
    autosave,
    lifecycle: createSessionRecorderLifecycleHelpers(autosave),
  };
};

export const useCompletedSessionTimes = ({
  sessionId,
  persisted,
  save = setCompletedSessionTimes,
}: {
  sessionId: string | null;
  // `null` until a completed session has loaded (and for an active one).
  persisted: SessionTimes | null;
  save?: (sessionId: string, times: SessionTimes) => Promise<void>;
}): UseCompletedSessionTimes => {
  const [text, setText] = useState<SessionTimesText>(EMPTY_TEXT);
  const [touched, setTouched] = useState({ start: false, end: false });
  const [paused, setPaused] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  // The instants first loaded: a field left showing them keeps them exactly.
  const [initial, setInitial] = useState<SessionTimes | null>(null);
  const navigation = useNavigation();
  const [{ live, setLive, autosave, lifecycle }] = useState(() =>
    createSessionTimesPersistence({ sessionId, save, setPaused, setSaveError })
  );

  // Filled once: later reloads of the session must not overwrite the fields.
  if (!initial && persisted) {
    setInitial(persisted);
    setText(formatSessionTimes(persisted));
  }
  useEffect(() => {
    if (initial) setLive({ initial, text: formatSessionTimes(initial) });
  }, [initial, setLive]);

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (nextState) => {
      void lifecycle.onAppStateChange(nextState);
    });
    return () => subscription.remove();
  }, [lifecycle]);

  useFocusEffect(
    useCallback(
      () => () => {
        void lifecycle.onScreenBlur();
      },
      [lifecycle]
    )
  );

  useEffect(
    () => () => {
      setLive({ mounted: false });
      void autosave.dispose({ flushDirty: true });
    },
    [autosave, setLive]
  );

  // Leaving writes pending valid times first, so the screen below reads them.
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

  const change = (field: keyof SessionTimesText, value: string) => {
    const next = { ...live.text, [field]: value };
    setLive({ text: next });
    setText(next);
    autosave.markTextMutation();
  };

  const commit = (field: keyof SessionTimesText) => {
    setTouched((current) => ({ ...current, [field]: true }));
    void autosave.flushInputCommit();
  };

  const validation = validateSessionTimes(text);
  const invalid = Boolean(validation.start || validation.end);

  return {
    text,
    errors: {
      start: touched.start ? validation.start : null,
      end: touched.end ? validation.end : null,
    },
    notice: invalid && (paused || touched.start || touched.end) ? TIMES_AUTOSAVE_PAUSED_NOTICE : null,
    saveError,
    setStart: (value) => change('start', value),
    setEnd: (value) => change('end', value),
    commitStart: () => commit('start'),
    commitEnd: () => commit('end'),
    submit: () => {
      const times = initial ? resolveSessionTimes(live.text, initial) : null;
      if (!times) setTouched({ start: true, end: true });
      return times;
    },
    flush: async () => {
      await autosave.flushNow();
      return !live.saveFailed;
    },
  };
};

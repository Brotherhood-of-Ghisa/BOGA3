import { useFocusEffect, useNavigation } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { createDraftAutosaveController, type DraftAutosaveController } from './draft-autosave';
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
  const textRef = useRef(text);
  // The instants first loaded: a field left showing them keeps them exactly.
  const persistedRef = useRef<SessionTimes | null>(null);
  const saveFailedRef = useRef(false);
  const isMountedRef = useRef(true);
  const autosaveRef = useRef<DraftAutosaveController | null>(null);
  const navigation = useNavigation();

  // Filled once: later reloads of the session must not overwrite the fields.
  useEffect(() => {
    if (persistedRef.current || !persisted) return;
    persistedRef.current = persisted;
    textRef.current = formatSessionTimes(persisted);
    setText(textRef.current);
  }, [persisted]);

  if (!autosaveRef.current) {
    autosaveRef.current = createDraftAutosaveController({
      persistDraft: async () => {
        const initial = persistedRef.current;
        if (!sessionId || !initial) return;
        const times = resolveSessionTimes(textRef.current, initial);
        if (!times) {
          if (isMountedRef.current) setPaused(true);
          return;
        }
        await save(sessionId, times);
        saveFailedRef.current = false;
        if (isMountedRef.current) {
          setPaused(false);
          setSaveError(null);
        }
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
      isMountedRef.current = false;
      void autosave.dispose({ flushDirty: true });
    },
    [autosave]
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
    const next = { ...textRef.current, [field]: value };
    textRef.current = next;
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
      const initial = persistedRef.current;
      const times = initial ? resolveSessionTimes(textRef.current, initial) : null;
      if (!times) setTouched({ start: true, end: true });
      return times;
    },
    flush: async () => {
      await autosave.flushNow();
      return !saveFailedRef.current;
    },
  };
};

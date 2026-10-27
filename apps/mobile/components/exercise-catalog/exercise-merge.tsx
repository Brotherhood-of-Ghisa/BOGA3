import { useEffect, useRef, useState } from 'react';
import { useNavigation } from 'expo-router';
import { Alert } from 'react-native';

import { ExerciseSwapSheet } from '@/components/exercise-page/exercise-swap-sheet';
import { StatePanel } from '@/components/ui/state-panel';
import type { ExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import { executeExerciseMerge, mergeConfirmationText, prepareExerciseMerge } from '@/src/exercise-catalog/merge';
import type { MergePreview } from '@/src/exercise-core/merge-types';

type Props = { source: ExerciseCatalogExercise; onDismiss: () => void };

// Catalogue-only controller: the browser is gone before the destructive alert.
export function ExerciseMerge({ source, onDismiss }: Props) {
  const [visible, setVisible] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirmation = useRef<MergePreview | null>(null);
  const retry = useRef<(() => Promise<void>) | null>(null);
  const alive = useRef(true);
  const writing = useRef(false);
  const navigation = useNavigation();
  useEffect(() => {
    alive.current = true;
    const guarded = navigation as unknown as {
      addListener: (event: 'beforeRemove', callback: (event: { preventDefault: () => void }) => void) => () => void;
    };
    const remove = guarded.addListener('beforeRemove', event => { if (writing.current) event.preventDefault(); });
    return () => { alive.current = false; remove(); };
  }, [navigation]);

  const submit = async (preview: MergePreview) => {
    if (writing.current) return;
    writing.current = true;
    setBusy(true); setError(null);
    retry.current = () => submit(preview);
    try {
      await executeExerciseMerge(preview);
      if (alive.current) onDismiss();
    } catch (failure) {
      if (alive.current) {
        setError(failure instanceof Error ? failure.message : 'Unable to merge exercises.');
        if (failure instanceof Error && /MERGE_STALE|VALIDATION|NOT_FOUND/.test(failure.message)) {
          retry.current = async () => { setError(null); setVisible(true); };
        }
      }
    } finally {
      writing.current = false;
      if (alive.current) setBusy(false);
    }
  };

  const select = async (destination: ExerciseCatalogExercise) => {
    setBusy(true); setError(null);
    retry.current = () => select(destination);
    try {
      const preview = await prepareExerciseMerge(source.id, destination.id);
      if (!alive.current) return;
      confirmation.current = preview;
      setVisible(false);
    } catch (failure) {
      if (alive.current) setError(failure instanceof Error ? failure.message : 'Unable to prepare this merge.');
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const confirm = () => {
    const preview = confirmation.current;
    confirmation.current = null;
    if (preview) Alert.alert('Merge exercises?', mergeConfirmationText(preview), [
      { text: 'Cancel', style: 'cancel', onPress: onDismiss },
      { text: 'Merge', style: 'destructive', onPress: () => { void submit(preview); } },
    ], { cancelable: false });
  };
  const state = error ? <StatePanel kind="error" body={error} fill={false}
    action={{ label: 'Retry', onPress: () => { void retry.current?.(); } }} testID="exercise-merge-error" /> :
    busy ? <StatePanel kind="loading" body={visible ? 'Preparing merge…' : 'Merging…'} fill={false} /> : null;
  return <>
    {!visible ? state : null}
    <ExerciseSwapSheet visible={visible} currentExerciseDefinitionId={source.id}
      onSelect={exercise => { if (!busy) void select(exercise); }} onDismiss={onDismiss}
      onDismissed={confirm} title="Merge into…" testIDPrefix="exercise-merge"
      dismissDisabled={busy} notice={state} />
  </>;
}

import { useRef, useState } from 'react';
import { Alert } from 'react-native';

import { unlinkExercise } from '@/src/data/exercise-group-links';

import { describeUnlinkConfirm, describeUnlinkSuccess, type ExerciseUnlinkContext } from './link-view-model';
import { useMountedRef } from './use-mounted-ref';

export type ExerciseUnlinkTarget = ExerciseUnlinkContext & {
  personalExerciseId: string;
  groupId: string;
  groupExerciseId: string;
};
export type ExerciseUnlinkNotice = { tone: 'success' | 'error'; message: string };

/** Local-only unlink shared by the group row and the catalogue/exercise-page Link screen. */
export function useExerciseUnlink({ offline, reloadLinks, onNotice }: {
  offline: boolean;
  reloadLinks: () => Promise<void>;
  onNotice: (notice: ExerciseUnlinkNotice | null) => void;
}) {
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const confirmingRef = useRef(false);
  const mounted = useMountedRef();
  const offlineRef = useRef(offline);
  offlineRef.current = offline;

  const confirmUnlink = (target: ExerciseUnlinkTarget, onClose?: () => void) => {
    if (pendingRef.current || confirmingRef.current || !mounted.current) return;
    confirmingRef.current = true;
    const close = () => {
      confirmingRef.current = false;
      if (mounted.current) onClose?.();
    };
    const perform = async () => {
      if (pendingRef.current || !mounted.current) return;
      pendingRef.current = true;
      confirmingRef.current = false;
      setPending(true);
      onNotice(null);
      try {
        let wrote: boolean;
        try {
          wrote = await unlinkExercise(target.personalExerciseId, target.groupId, undefined, target.groupExerciseId);
        } catch {
          if (mounted.current) onNotice({ tone: 'error', message: "Couldn't unlink this exercise. Nothing was changed. Try again using Unlink…" });
          return;
        }
        if (!mounted.current) return;
        onNotice(wrote
          ? { tone: 'success', message: describeUnlinkSuccess(target, offlineRef.current) }
          : { tone: 'error', message: 'This link changed since you selected it. Nothing was unlinked. Check the refreshed links and try again.' });
        // A committed write remains successful even if the subsequent read fails.
        // Read hooks own their separate unknown-status / retry surface.
        await reloadLinks();
      } finally {
        pendingRef.current = false;
        if (mounted.current) {
          setPending(false);
          onClose?.();
        }
      }
    };
    const confirmation = describeUnlinkConfirm(target);
    Alert.alert(confirmation.title, confirmation.message, [
      { text: 'Cancel', style: 'cancel', onPress: close },
      { text: 'Unlink', style: 'destructive', onPress: () => void perform() },
    ], { cancelable: true, onDismiss: close });
  };

  return { pending, confirmUnlink };
}

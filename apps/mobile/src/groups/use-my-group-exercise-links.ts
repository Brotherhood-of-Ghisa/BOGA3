// My live links into one group, read from the local synced rows (M25-T03,
// `exercise_group_links`), so the Exercises segment shows link status offline.
// Reloads on every focus (links change on other screens — the Link screen,
// M25-T07 — and sync can pull new ones) and after a link written here.
// It also hands the pick sheet my exercises and all my live links, which it
// needs for its suggestion and the one-link-per-group rule.

import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';

import { listExerciseCatalogExercises } from '@/src/data/exercise-catalog';
import { listLinks } from '@/src/data/exercise-group-links';

import type { MyGroupExerciseLink } from './exercise-view-model';
import type { LinkRef, LinkableExercise } from './link-view-model';

export type MyGroupExerciseLinksState = {
  /** My links into this group; null until the first read settles, and after a failed read. */
  links: MyGroupExerciseLink[] | null;
  /** Every exercise of mine (deleted ones included; the pick sheet offers live ones only). */
  exercises: LinkableExercise[];
  /** All my live links, in every group. */
  allLinks: LinkRef[];
  /** The local read failed; the screen says so rather than showing "Not linked". */
  failed: boolean;
  /** Re-reads after a local link write. Never rejects. */
  reload: () => Promise<void>;
};

type LoadedState = Omit<MyGroupExerciseLinksState, 'reload'>;

export function useMyGroupExerciseLinks(groupId: string): MyGroupExerciseLinksState {
  const [state, setState] = useState<LoadedState>({ links: null, exercises: [], allLinks: [], failed: false });
  const mountedRef = useRef(true);
  const seqRef = useRef(0);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    // Only the latest read may land: an older one finishing last would show pre-link state.
    const seq = ++seqRef.current;
    try {
      const [links, exercises] = await Promise.all([listLinks(), listExerciseCatalogExercises({ includeDeleted: true })]);
      if (!mountedRef.current || seq !== seqRef.current) return;
      const names = new Map(exercises.map((exercise) => [exercise.id, exercise.name]));
      setState({
        links: links
          .filter((link) => link.groupId === groupId)
          .map((link) => ({
            groupExerciseId: link.groupExerciseId,
            exerciseName: names.get(link.exerciseDefinitionId) ?? null,
          })),
        exercises: exercises.map(({ id, name, loadInputMode, deletedAt }) => ({ id, name, loadInputMode, deletedAt })),
        allLinks: links.map(({ exerciseDefinitionId, groupId: linkGroupId, groupExerciseId }) => ({
          exerciseDefinitionId,
          groupId: linkGroupId,
          groupExerciseId,
        })),
        failed: false,
      });
    } catch {
      if (!mountedRef.current || seq !== seqRef.current) return;
      setState((current) => ({ ...current, links: null, failed: true }));
    }
  }, [groupId]);

  useFocusEffect(
    useCallback(() => {
      void reload();
    }, [reload]),
  );

  return { ...state, reload };
}

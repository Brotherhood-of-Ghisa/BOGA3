// My live links into one group, read from the local synced rows (M25-T03,
// `exercise_group_links`), so the Exercises segment shows link status offline.
// Reloads on every focus: links change on other screens (the Link screen,
// M25-T07) and sync can pull new ones.

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { listExerciseCatalogExercises } from '@/src/data/exercise-catalog';
import { listLinks } from '@/src/data/exercise-group-links';

import type { MyGroupExerciseLink } from './exercise-view-model';

export type MyGroupExerciseLinksState = {
  /** Null until the first read settles, and after a failed read. */
  links: MyGroupExerciseLink[] | null;
  /** The local read failed; the screen says so rather than showing "Not linked". */
  failed: boolean;
};

export function useMyGroupExerciseLinks(groupId: string): MyGroupExerciseLinksState {
  const [state, setState] = useState<MyGroupExerciseLinksState>({ links: null, failed: false });

  useFocusEffect(
    useCallback(() => {
      let active = true;
      void Promise.all([listLinks(), listExerciseCatalogExercises({ includeDeleted: true })]).then(
        ([links, exercises]) => {
          if (!active) return;
          const names = new Map(exercises.map((exercise) => [exercise.id, exercise.name]));
          setState({
            links: links
              .filter((link) => link.groupId === groupId)
              .map((link) => ({
                groupExerciseId: link.groupExerciseId,
                exerciseName: names.get(link.exerciseDefinitionId) ?? null,
              })),
            failed: false,
          });
        },
        () => {
          if (!active) return;
          setState({ links: null, failed: true });
        },
      );
      return () => {
        active = false;
      };
    }, [groupId]),
  );

  return state;
}

import { useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';

import { listLinks } from '@/src/data/exercise-group-links';

const NONE: ReadonlySet<string> = new Set();

/**
 * The ids of my exercises with a link to a group exercise, read from the
 * local synced `exercise_group_links` on every focus (so a link made on the
 * Link page shows on return). Local only: marking linked rows never reaches
 * the group server. A failed read marks nothing, never a guess.
 */
export function useLinkedExerciseIds(userId: string | null): ReadonlySet<string> {
  const [read, setRead] = useState<{ userId: string; ids: ReadonlySet<string> } | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (!userId) return undefined;
      let live = true;
      listLinks()
        .then((links) => {
          if (live) setRead({ userId, ids: new Set(links.map((link) => link.exerciseDefinitionId)) });
        })
        .catch(() => {
          if (live) setRead({ userId, ids: NONE });
        });
      return () => {
        live = false;
      };
    }, [userId]),
  );
  return userId && read?.userId === userId ? read.ids : NONE;
}

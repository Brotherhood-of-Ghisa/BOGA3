import { useEffect, useSyncExternalStore } from 'react';

import {
  listExerciseCatalogExercises,
  listExerciseCatalogMuscleGroups,
  type ExerciseCatalogExercise,
  type ExerciseCatalogMuscleGroup,
} from '@/src/data/exercise-catalog';

import {
  buildExerciseCatalogSearchText,
  indexExerciseCatalogMuscleGroupsById,
  type IndexedExerciseCatalogExercise,
} from './search';

export type ExerciseCatalogCacheStatus = 'idle' | 'loading' | 'ready' | 'error';

export type ExerciseCatalogCacheSnapshot = {
  status: ExerciseCatalogCacheStatus;
  exercises: IndexedExerciseCatalogExercise[];
  muscleGroups: ExerciseCatalogMuscleGroup[];
  muscleGroupsById: Record<string, ExerciseCatalogMuscleGroup>;
  lastError: string | null;
};

type Listener = () => void;

const EMPTY_SNAPSHOT: ExerciseCatalogCacheSnapshot = {
  status: 'idle',
  exercises: [],
  muscleGroups: [],
  muscleGroupsById: {},
  lastError: null,
};

const listeners = new Set<Listener>();

let snapshot: ExerciseCatalogCacheSnapshot = EMPTY_SNAPSHOT;
let inFlightReload: Promise<void> | null = null;
let pendingReload = false;
let drainScheduled = false;

const emit = () => {
  for (const listener of listeners) {
    listener();
  }
};

const setSnapshot = (next: ExerciseCatalogCacheSnapshot) => {
  snapshot = next;
  emit();
};

const buildIndexedExercises = (
  exercises: ExerciseCatalogExercise[],
  muscleGroupsById: Record<string, ExerciseCatalogMuscleGroup>
): IndexedExerciseCatalogExercise[] =>
  exercises.map((exercise) => ({
    ...exercise,
    searchText: buildExerciseCatalogSearchText(exercise, muscleGroupsById),
  }));

const reload = async (): Promise<void> => {
  setSnapshot({
    ...snapshot,
    status: 'loading',
    lastError: null,
  });

  try {
    const [loadedExercises, loadedMuscleGroups] = await Promise.all([
      listExerciseCatalogExercises({ includeDeleted: true }),
      listExerciseCatalogMuscleGroups(),
    ]);
    const muscleGroupsById = indexExerciseCatalogMuscleGroupsById(loadedMuscleGroups);
    setSnapshot({
      status: 'ready',
      exercises: buildIndexedExercises(loadedExercises, muscleGroupsById),
      muscleGroups: loadedMuscleGroups,
      muscleGroupsById,
      lastError: null,
    });
  } catch (error) {
    setSnapshot({
      ...snapshot,
      status: 'error',
      lastError: error instanceof Error ? error.message : 'Unable to load exercise catalog.',
    });
  }
};

const drain = async (): Promise<void> => {
  // Keep `drainScheduled` true while we own the reload loop so that
  // invalidations arriving during an in-flight reload coalesce into the
  // current drain's next iteration instead of spawning a concurrent drain.
  try {
    while (pendingReload) {
      pendingReload = false;
      inFlightReload = reload();
      try {
        await inFlightReload;
      } finally {
        inFlightReload = null;
      }
    }
  } finally {
    drainScheduled = false;
  }
};

const scheduleDrain = () => {
  if (drainScheduled) {
    return;
  }
  drainScheduled = true;
  queueMicrotask(() => {
    void drain();
  });
};

export const getExerciseCatalogSnapshot = (): ExerciseCatalogCacheSnapshot => snapshot;

export const subscribeToExerciseCatalog = (listener: Listener): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const ensureExerciseCatalogLoaded = async (): Promise<void> => {
  if (snapshot.status === 'ready') {
    return;
  }
  if (inFlightReload) {
    return inFlightReload;
  }
  pendingReload = true;
  scheduleDrain();
  // Wait for the drain to start the reload and resolve it.
  await new Promise<void>((resolve) => {
    queueMicrotask(() => {
      if (inFlightReload) {
        inFlightReload.then(resolve, () => resolve());
      } else {
        resolve();
      }
    });
  });
};

export const invalidateExerciseCatalogCache = (): void => {
  pendingReload = true;
  scheduleDrain();
};

export const __resetExerciseCatalogCacheForTests = (): void => {
  listeners.clear();
  snapshot = EMPTY_SNAPSHOT;
  inFlightReload = null;
  pendingReload = false;
  drainScheduled = false;
};

export const useExerciseCatalog = (): ExerciseCatalogCacheSnapshot => {
  const current = useSyncExternalStore(
    subscribeToExerciseCatalog,
    getExerciseCatalogSnapshot,
    getExerciseCatalogSnapshot
  );

  useEffect(() => {
    void ensureExerciseCatalogLoaded();
  }, []);

  return current;
};

import { useEffect, useSyncExternalStore } from 'react';

import {
  listExerciseCatalogExercises,
  listExerciseCatalogMuscleGroups,
  type ExerciseCatalogExercise,
  type ExerciseCatalogMuscleGroup,
} from '@/src/data/exercise-catalog';

import { subscribeToExerciseCatalogInvalidation } from './invalidation';
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
let drainPromise: Promise<void> | null = null;

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
  while (pendingReload) {
    pendingReload = false;
    inFlightReload = reload();
    try {
      await inFlightReload;
    } finally {
      inFlightReload = null;
    }
  }
};

const ensureDrain = (): Promise<void> => {
  if (drainPromise) {
    // A drain is already running; it will pick up the latest
    // `pendingReload` on its next iteration. Callers can await this
    // promise to know when the drain (and all its reloads) finishes.
    return drainPromise;
  }
  drainPromise = drain().finally(() => {
    drainPromise = null;
    // A late invalidation may have landed between the while-loop exit
    // and this finally. Kick off another drain so the flag isn't stranded.
    if (pendingReload) {
      void ensureDrain();
    }
  });
  return drainPromise;
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
  pendingReload = true;
  await ensureDrain();
};

subscribeToExerciseCatalogInvalidation(() => {
  pendingReload = true;
  void ensureDrain();
});

export const __resetExerciseCatalogCacheForTests = (): void => {
  listeners.clear();
  snapshot = EMPTY_SNAPSHOT;
  inFlightReload = null;
  pendingReload = false;
  drainPromise = null;
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

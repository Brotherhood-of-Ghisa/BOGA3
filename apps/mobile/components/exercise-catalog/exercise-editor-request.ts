import { useRouter } from 'expo-router';
import { useCallback } from 'react';

import type { ExerciseCatalogExercise } from '@/src/data/exercise-catalog';
import type { ExerciseEditorPrefill } from '@/src/exercise-catalog/editor-model';
import { exerciseEditHref } from '@/src/navigation/routes';

import type { ExerciseEditorSaveInput } from './use-exercise-editor-form';

export type { ExerciseEditorPrefill } from '@/src/exercise-catalog/editor-model';
export type { ExerciseEditorSaveInput } from './use-exercise-editor-form';

/**
 * What a caller hands the exercise editor page beyond the exercise's id: a
 * new exercise's prefill, a title, a custom save, and what to do once saved.
 * Callbacks cannot travel in a URL, so the page reads them from this
 * in-memory registry by the `request` param. A page opened without one (a
 * deep link, a reload) edits by id, or creates a blank exercise, with the
 * default save.
 */
export type ExerciseEditorRequest = {
  /** Edit this exercise; omit to create one. */
  exerciseDefinitionId?: string | null;
  /** Prefills a new exercise (ignored while editing). */
  prefill?: ExerciseEditorPrefill | null;
  title?: string;
  /** Replaces the default save (`saveExerciseCatalogExercise`); a rejection shows inline like any save error. */
  onSave?: (input: ExerciseEditorSaveInput) => Promise<ExerciseCatalogExercise>;
  /** Runs after a save, as the page closes; the caller is mounted beneath it. */
  onSaved?: (exercise: ExerciseCatalogExercise) => void;
  /**
   * The page was opened for a request no longer in memory (the route was
   * restored or remounted): it refuses to edit rather than save without the
   * caller's `onSave` (an "Add as new" would lose its group link).
   */
  lost?: boolean;
};

const requests = new Map<string, ExerciseEditorRequest>();
let nextRequestId = 0;

export const registerExerciseEditorRequest = (request: ExerciseEditorRequest): string => {
  nextRequestId += 1;
  const token = `editor-${nextRequestId}`;
  requests.set(token, request);
  return token;
};

export const readExerciseEditorRequest = (token: string | null): ExerciseEditorRequest | null =>
  (token ? requests.get(token) : undefined) ?? null;

/** For tests: forget the double-tap guard. */
export const resetExerciseEditorOpenGuard = () => {
  lastOpenedAt = -Infinity;
};

export const releaseExerciseEditorRequest = (token: string | null) => {
  if (token) requests.delete(token);
};

// A second open within this window is a double tap, not a second editor.
const REOPEN_GUARD_MS = 800;
let lastOpenedAt = -Infinity;

/** Opens the exercise editor page (`/exercise-edit`) for a request; a double tap opens one. */
export function useOpenExerciseEditor() {
  const router = useRouter();
  return useCallback(
    (request: ExerciseEditorRequest = {}) => {
      const now = Date.now();
      if (now - lastOpenedAt < REOPEN_GUARD_MS) return;
      lastOpenedAt = now;
      const token = registerExerciseEditorRequest(request);
      router.push(exerciseEditHref({ exerciseDefinitionId: request.exerciseDefinitionId ?? null, request: token }));
    },
    [router],
  );
}

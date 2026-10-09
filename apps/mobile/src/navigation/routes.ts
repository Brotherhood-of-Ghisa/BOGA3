import type { Href } from 'expo-router';

export const SIGN_IN_ROUTE = '/sign-in';
export const EXERCISE_LINK_ROUTE = '/exercise-link';
// The Gyms screen, from the session view's gym sheet (`Manage gyms`). More
// opens it as `/gyms?source=more`, which adds its `Back to More`.
export const GYMS_ROUTE = '/gyms';
export const BODY_WEIGHT_ROUTE = '/body-weight';

/** The Link screen for one of my exercises (E0.3). */
export const exerciseLinkHref = (exerciseDefinitionId: string): Href =>
  `${EXERCISE_LINK_ROUTE}?exerciseDefinitionId=${encodeURIComponent(exerciseDefinitionId)}` as Href;
export const THEME_COLOUR_ROUTE = '/theme-colour';

/** One muscle's or one exercise's effort history, pushed from Progress. */
export const PROGRESS_HISTORY_ROUTE = '/progress-history';
export const progressHistoryHref = (
  subject: { muscleGroupId: string } | { exerciseDefinitionId: string }
): Href =>
  ('muscleGroupId' in subject
    ? `${PROGRESS_HISTORY_ROUTE}?muscleGroupId=${encodeURIComponent(subject.muscleGroupId)}`
    : `${PROGRESS_HISTORY_ROUTE}?exerciseDefinitionId=${encodeURIComponent(subject.exerciseDefinitionId)}`) as Href;

import type { Href } from 'expo-router';

export const SIGN_IN_ROUTE = '/sign-in';
export const EXERCISE_LINK_ROUTE = '/exercise-link';
// The Gyms screen, from the session view's gym sheet (`Manage gyms`). More
// opens it as `/gyms?source=more`, which adds its `Back to More`.
export const GYMS_ROUTE = '/gyms';
export const BODY_WEIGHT_ROUTE = '/body-weight';

/** The Link screen for one of my exercises (M25-T07; product E0.3). */
export const exerciseLinkHref = (exerciseDefinitionId: string): Href =>
  `${EXERCISE_LINK_ROUTE}?exerciseDefinitionId=${encodeURIComponent(exerciseDefinitionId)}` as Href;

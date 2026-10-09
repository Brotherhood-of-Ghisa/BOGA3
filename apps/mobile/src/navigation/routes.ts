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

/** One completed session's view. */
export const completedSessionHref = (sessionId: string): Href =>
  `/completed-session/${encodeURIComponent(sessionId)}` as Href;

/** Sessions, listing only the local week that holds `dateKey` (`YYYY-MM-DD`). */
export const sessionsWeekHref = (dateKey: string): Href =>
  `/sessions?week=${encodeURIComponent(dateKey)}` as Href;

/** Sessions, listing only the local day `dateKey` (`YYYY-MM-DD`). */
export const sessionsDayHref = (dateKey: string): Href =>
  `/sessions?day=${encodeURIComponent(dateKey)}` as Href;

/**
 * Where a history day leads: its one session, or Sessions for that day when it
 * holds several. A day without a session leads nowhere.
 */
export const historyDayHref = (dateKey: string, sessionIds: readonly string[]): Href | null => {
  if (sessionIds.length === 0) return null;
  return sessionIds.length === 1 ? completedSessionHref(sessionIds[0]) : sessionsDayHref(dateKey);
};

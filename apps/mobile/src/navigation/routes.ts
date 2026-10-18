import type { Href } from 'expo-router';

import type { HeatmapView, ProgressMetric } from '@/src/preferences/model';
import { encodeGymRouteParam } from '@/src/utils/gym-scope-route';

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

/** The selected exercise's descriptive RM chart, pushed from History. */
export const rmCurveHref = (exerciseDefinitionId: string): Href =>
  `/rm-curve?exerciseDefinitionId=${encodeURIComponent(exerciseDefinitionId)}` as Href;

/** `?metric=` on the history page: Progress's Sets / Volume choice, carried over. */
export const PROGRESS_HISTORY_METRIC_PARAMS: Record<ProgressMetric, string> = {
  totalVolume: 'volume',
  workingSetCount: 'sets',
};

/**
 * An exercise's page may open on a gym: `gymId` is three-state
 * (`src/utils/gym-scope-route.ts`), and unset — every gym — sends no param.
 */
export const progressHistoryHref = (
  subject: { muscleGroupId: string } | { exerciseDefinitionId: string; gymId?: string | null },
  metric?: ProgressMetric,
  view?: HeatmapView
): Href => {
  const id = 'muscleGroupId' in subject
    ? `muscleGroupId=${encodeURIComponent(subject.muscleGroupId)}`
    : `exerciseDefinitionId=${encodeURIComponent(subject.exerciseDefinitionId)}`;
  const gym = 'exerciseDefinitionId' in subject ? encodeGymRouteParam(subject.gymId) : undefined;
  const carried = metric ? `&metric=${PROGRESS_HISTORY_METRIC_PARAMS[metric]}` : '';
  return `${PROGRESS_HISTORY_ROUTE}?${id}${carried}${gym === undefined ? '' : `&gymId=${encodeURIComponent(gym)}`}${view ? `&view=${view}` : ''}` as Href;
};

/** One completed session's view. */
export const completedSessionHref = (sessionId: string): Href =>
  `/completed-session/${encodeURIComponent(sessionId)}` as Href;

/** Sessions, opened at the local week that holds `dateKey` (`YYYY-MM-DD`). */
export const sessionsWeekHref = (dateKey: string): Href =>
  `/sessions?week=${encodeURIComponent(dateKey)}` as Href;

/** Sessions, opened at the local day `dateKey` (`YYYY-MM-DD`). */
export const sessionsDayHref = (dateKey: string): Href =>
  `/sessions?day=${encodeURIComponent(dateKey)}` as Href;

/** Where a history day leads; null for a day without a session. */
export const historyDayHref = (dateKey: string, sessionIds: readonly string[]): Href | null => {
  if (sessionIds.length === 0) return null;
  return sessionIds.length === 1 ? completedSessionHref(sessionIds[0]) : sessionsDayHref(dateKey);
};

import type { Href } from 'expo-router';

import type { HeatmapView, ProgressMetric } from '@/src/preferences/model';
import { sessionViewHref } from './active-session-entry';
import { encodeGymRouteParam } from '@/src/utils/gym-scope-route';

export const SIGN_IN_ROUTE = '/sign-in';
export const EXERCISE_LINK_ROUTE = '/exercise-link';
// The Gyms screen, from the session view's gym sheet (`Manage gyms`) and More.
export const GYMS_ROUTE = '/gyms';
export const BODY_WEIGHT_ROUTE = '/body-weight';

/** Settings' sub pages, one per Settings row; Bodyweight's is `BODY_WEIGHT_ROUTE`. */
export const SETTINGS_SUB_PAGES = {
  restTimer: '/settings-rest-timer',
  progress: '/settings-progress',
  muscles: '/settings-muscles',
  muscleTargets: '/settings-muscle-targets',
  enabledMuscles: '/settings-enabled-muscles',
  effort: '/settings-effort',
  appearance: '/settings-appearance',
  notifications: '/settings-notifications',
  everythingElse: '/settings-everything-else',
  dataSync: '/settings-data-sync',
  reviewChanges: '/settings-review-changes',
} as const;

/** The Link screen for one of my exercises (E0.3). */
export const exerciseLinkHref = (exerciseDefinitionId: string): Href =>
  `${EXERCISE_LINK_ROUTE}?exerciseDefinitionId=${encodeURIComponent(exerciseDefinitionId)}` as Href;

/** The exercise editor page: edit one of my exercises by id, or create one. `request` names the caller's in-memory request (prefill, save callbacks). */
export const EXERCISE_EDIT_ROUTE = '/exercise-edit';
export const exerciseEditHref = ({ exerciseDefinitionId, request }: { exerciseDefinitionId?: string | null; request?: string | null }): Href => {
  const params = [
    exerciseDefinitionId ? `exerciseDefinitionId=${encodeURIComponent(exerciseDefinitionId)}` : null,
    request ? `request=${encodeURIComponent(request)}` : null,
  ].filter(Boolean);
  return `${EXERCISE_EDIT_ROUTE}${params.length > 0 ? `?${params.join('&')}` : ''}` as Href;
};
export const THEME_COLOUR_ROUTE = '/theme-colour';

/** One muscle's or one exercise's effort history, pushed from Progress. */
export const PROGRESS_HISTORY_ROUTE = '/progress-history';

/** Session-by-session exercise history, carrying Progress's selected gym. */
export const exerciseHistoryHref = (exerciseDefinitionId: string, gymId?: string | null): Href => {
  const gym = encodeGymRouteParam(gymId);
  return `/exercise-history?exerciseDefinitionId=${encodeURIComponent(exerciseDefinitionId)}${gym === undefined ? '' : `&gymId=${encodeURIComponent(gym)}`}` as Href;
};

/** The selected exercise's descriptive RM chart, pushed from History. */
export const rmCurveHref = (exerciseDefinitionId: string): Href =>
  `/rm-curve?exerciseDefinitionId=${encodeURIComponent(exerciseDefinitionId)}` as Href;

/** `?metric=` on the history page: Progress's Sets / Volume choice, carried over. */
export const PROGRESS_HISTORY_METRIC_PARAMS: Record<ProgressMetric, string> = {
  totalVolume: 'volume',
  workingSetCount: 'sets',
};

/** `?secondary=` on a muscle's history: Progress counted primary work only ([[muscle.secondary-filter]]). */
export const PROGRESS_HISTORY_PRIMARY_ONLY_PARAM = 'hidden';

/**
 * Either subject may open on a gym: `gymId` is three-state
 * (`src/utils/gym-scope-route.ts`), and unset — every gym — sends no param.
 * A muscle may open counting primary work only; counting secondary sends none.
 */
export const progressHistoryHref = (
  subject: ({ muscleGroupId: string; countSecondary?: boolean; countSecondaryVolume?: boolean } | { exerciseDefinitionId: string }) & { gymId?: string | null },
  metric?: ProgressMetric,
  view?: HeatmapView
): Href => {
  const id = 'muscleGroupId' in subject
    ? `muscleGroupId=${encodeURIComponent(subject.muscleGroupId)}`
    : `exerciseDefinitionId=${encodeURIComponent(subject.exerciseDefinitionId)}`;
  const gym = encodeGymRouteParam(subject.gymId);
  const carried = metric ? `&metric=${PROGRESS_HISTORY_METRIC_PARAMS[metric]}` : '';
  const secondary = 'muscleGroupId' in subject && subject.countSecondary !== undefined
    ? `&secondary=${subject.countSecondary ? 'shown' : PROGRESS_HISTORY_PRIMARY_ONLY_PARAM}` : '';
  const volume = 'muscleGroupId' in subject && subject.countSecondaryVolume !== undefined
    ? `&secondaryVolume=${subject.countSecondaryVolume ? 'shown' : PROGRESS_HISTORY_PRIMARY_ONLY_PARAM}` : '';
  return `${PROGRESS_HISTORY_ROUTE}?${id}${carried}${gym === undefined ? '' : `&gymId=${encodeURIComponent(gym)}`}${secondary}${volume}${view ? `&view=${view}` : ''}` as Href;
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
export const historyDayHref = (dateKey: string, sessionIds: readonly string[], activeSessionId: string | null = null): Href | null => {
  if (sessionIds.length === 0) return null;
  if (sessionIds.length > 1) return sessionsDayHref(dateKey);
  return sessionIds[0] === activeSessionId ? sessionViewHref(sessionIds[0]) : completedSessionHref(sessionIds[0]);
};


/** CoW links carry public identity and one opening metric, never a score/context. */
export const coWsHref = (groupId: string, cowId?: string, metric?: string): Href => {
  const query = [cowId ? `cowId=${encodeURIComponent(cowId)}` : null, metric ? `metric=${encodeURIComponent(metric)}` : null].filter(Boolean).join('&');
  return `/group/${encodeURIComponent(groupId)}/cows${query ? `?${query}` : ''}` as Href;
};
export const coWStandingsHref = (groupId: string, cowId: string, metric: string): Href =>
  `/group/${encodeURIComponent(groupId)}/cows/${encodeURIComponent(cowId)}?metric=${encodeURIComponent(metric)}` as Href;
export const coWScheduleHref = (groupId: string, cowId?: string): Href =>
  `/group/${encodeURIComponent(groupId)}/cows/schedule${cowId ? `?cowId=${encodeURIComponent(cowId)}` : ''}` as Href;

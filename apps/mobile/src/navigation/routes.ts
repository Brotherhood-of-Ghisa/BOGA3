import type { Href } from 'expo-router';

export const SIGN_IN_ROUTE = '/sign-in';
export const MAESTRO_HARNESS_ROUTE = '/maestro-harness';
export const EXERCISE_LINK_ROUTE = '/exercise-link';
// The Gyms screen, from the session view's gym sheet (`Manage gyms`). More
// opens it as `/gyms?source=more`, which adds its `Back to More`.
export const GYMS_ROUTE = '/gyms';

/** The Link screen for one of my exercises (M25-T07; product E0.3). */
export const exerciseLinkHref = (exerciseDefinitionId: string): Href =>
  `${EXERCISE_LINK_ROUTE}?exerciseDefinitionId=${encodeURIComponent(exerciseDefinitionId)}` as Href;

const normalizePathname = (pathname: string | null | undefined): string => {
  if (!pathname) {
    return '';
  }

  const [withoutQuery] = pathname.split(/[?#]/, 1);
  const withLeadingSlash = withoutQuery.startsWith('/') ? withoutQuery : `/${withoutQuery}`;
  const withoutTrailingSlash =
    withLeadingSlash.length > 1 ? withLeadingSlash.replace(/\/+$/, '') : withLeadingSlash;

  return withoutTrailingSlash.replace(/^\/--(?=\/|$)/, '') || '/';
};

export const isSignInRoutePathname = (pathname: string | null | undefined) =>
  normalizePathname(pathname) === SIGN_IN_ROUTE;

export const isMaestroHarnessRoutePathname = (pathname: string | null | undefined) =>
  normalizePathname(pathname) === MAESTRO_HARNESS_ROUTE;

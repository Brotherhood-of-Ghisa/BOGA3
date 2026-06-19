export const SIGN_IN_ROUTE = '/sign-in';
export const MAESTRO_HARNESS_ROUTE = '/maestro-harness';

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

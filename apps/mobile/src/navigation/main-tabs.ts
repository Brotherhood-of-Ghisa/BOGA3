export const MAIN_TAB_KEYS = ['today', 'train', 'progress', 'more'] as const;

export type MainTabKey = (typeof MAIN_TAB_KEYS)[number];

export type MainTabDefinition = {
  key: MainTabKey;
  label: string;
  accessibilityLabel: string;
  testID: `top-level-tab-${MainTabKey}`;
  href: `/${MainTabKey}`;
};

/**
 * Canonical M26 top-level navigation model.
 *
 * T01 keeps this model dormant while the four destination surfaces are built.
 * The production shell continues to use the legacy tabs until the M26 cutover.
 */
export const MAIN_TAB_DEFINITIONS: readonly MainTabDefinition[] = [
  {
    key: 'today',
    label: 'Today',
    accessibilityLabel: 'Open Today',
    testID: 'top-level-tab-today',
    href: '/today',
  },
  {
    key: 'train',
    label: 'Train',
    accessibilityLabel: 'Open Train',
    testID: 'top-level-tab-train',
    href: '/train',
  },
  {
    key: 'progress',
    label: 'Progress',
    accessibilityLabel: 'Open Progress',
    testID: 'top-level-tab-progress',
    href: '/progress',
  },
  {
    key: 'more',
    label: 'More',
    accessibilityLabel: 'Open More',
    testID: 'top-level-tab-more',
    href: '/more',
  },
] as const;

const SEGMENT_TO_MAIN_TAB: Readonly<Record<string, MainTabKey>> = {
  today: 'today',
  train: 'train',
  progress: 'progress',
  more: 'more',
  // Legacy tab roots keep an explicit ownership mapping during migration.
  'session-recorder': 'train',
  'stats-history': 'progress',
  'exercise-catalog': 'more',
  groups: 'more',
  settings: 'more',
};

const normalizedRouteSegments = (segments: readonly string[]): string[] =>
  segments.filter((segment) => segment.length > 0 && !segment.startsWith('('));

/**
 * Resolve the nearest canonical or legacy-owned tab from an Expo Router segment
 * path. Scanning from the leaf keeps nested routes anchored to their owner.
 * Unknown routes intentionally return null instead of selecting a misleading
 * default tab.
 */
export function resolveMainTab(segments: readonly string[]): MainTabKey | null {
  const routeSegments = normalizedRouteSegments(segments);

  for (let index = routeSegments.length - 1; index >= 0; index -= 1) {
    const resolved = SEGMENT_TO_MAIN_TAB[routeSegments[index]];
    if (resolved) {
      return resolved;
    }
  }

  return null;
}

/** Focused recorder work owns the full viewport and suppresses persistent tabs. */
export function isMainNavigationSuppressed(segments: readonly string[]): boolean {
  return normalizedRouteSegments(segments).includes('session-recorder');
}

/**
 * A single visibility contract for the future shell. Root/detail navigators can
 * stay tabless by returning null; recognized tab-owned routes render the bar
 * unless they are focused recorder work.
 */
export function shouldShowMainNavigation(segments: readonly string[]): boolean {
  return !isMainNavigationSuppressed(segments) && resolveMainTab(segments) !== null;
}

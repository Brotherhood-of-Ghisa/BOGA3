export const MAIN_TAB_KEYS = ['today', 'train', 'progress', 'groups', 'more'] as const;

export type MainTabKey = (typeof MAIN_TAB_KEYS)[number];

export type MainTabDefinition = {
  key: MainTabKey;
  label: string;
  accessibilityLabel: string;
  testID: `top-level-tab-${MainTabKey}`;
  href: `/${MainTabKey}`;
  // `label`: a micro-label in the tab card. `overflow`: the ⋮ beside it (More).
  presentation: 'label' | 'overflow';
};

/** Canonical top-level navigation model. */
export const MAIN_TAB_DEFINITIONS: readonly MainTabDefinition[] = [
  {
    key: 'today',
    label: 'Today',
    accessibilityLabel: 'Open Today',
    testID: 'top-level-tab-today',
    href: '/today',
    presentation: 'label',
  },
  {
    key: 'train',
    label: 'Train',
    accessibilityLabel: 'Open Train',
    testID: 'top-level-tab-train',
    href: '/train',
    presentation: 'label',
  },
  {
    key: 'progress',
    label: 'Progress',
    accessibilityLabel: 'Open Progress',
    testID: 'top-level-tab-progress',
    href: '/progress',
    presentation: 'label',
  },
  {
    key: 'groups',
    label: 'Groups',
    accessibilityLabel: 'Open Groups',
    testID: 'top-level-tab-groups',
    href: '/groups',
    presentation: 'label',
  },
  {
    key: 'more',
    label: 'More',
    accessibilityLabel: 'Open More',
    testID: 'top-level-tab-more',
    href: '/more',
    presentation: 'overflow',
  },
] as const;

const MAIN_TAB_BY_KEY = Object.fromEntries(
  MAIN_TAB_DEFINITIONS.map((tab) => [tab.key, tab]),
) as Readonly<Record<MainTabKey, MainTabDefinition>>;

export function mainTabHref(tab: MainTabKey): MainTabDefinition['href'] {
  return MAIN_TAB_BY_KEY[tab].href;
}

const SEGMENT_TO_MAIN_TAB: Readonly<Record<string, MainTabKey>> = {
  today: 'today',
  train: 'train',
  progress: 'progress',
  groups: 'groups',
  more: 'more',
  // A preserved legacy root and More's root-stack destinations that keep the
  // tab bar (`TabOwnedPage`) each have an explicit canonical owner.
  'stats-history': 'progress',
  'exercise-catalog': 'more',
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

import type { IconName } from '@/components/ui/icon-glyphs';

export type MoreDestinationKey =
  | 'groups'
  | 'connect-agent'
  | 'connected-agents'
  | 'developer-logs'
  | 'exercise-database'
  | 'gyms'
  | 'settings';

export type MoreRoute =
  | '/groups'
  | '/connected-agents'
  | '/dev-logs'
  | '/exercise-catalog?source=more'
  | '/gyms?source=more'
  | '/settings?source=more';

export type MoreDestination = {
  key: MoreDestinationKey;
  label: string;
  icon: IconName;
  accessibilityHint: string;
  testID: `more-${MoreDestinationKey}-row`;
  action: { type: 'route'; href: MoreRoute } | { type: 'connect-agent' };
  requiresUser?: boolean;
  developerOnly?: boolean;
};

export type MoreSection = {
  key: 'community' | 'tools' | 'library-account';
  title: string;
  destinations: readonly MoreDestination[];
};

const MORE_SECTIONS: readonly MoreSection[] = [
  {
    key: 'community',
    title: 'Community',
    destinations: [
      {
        key: 'groups',
        label: 'Groups',
        icon: 'users',
        accessibilityHint: 'Opens group discovery and management',
        testID: 'more-groups-row',
        action: { type: 'route', href: '/groups' },
      },
    ],
  },
  {
    key: 'tools',
    title: 'Tools',
    destinations: [
      {
        key: 'connect-agent',
        label: 'Connect an AI coach',
        icon: 'sparkles',
        accessibilityHint: 'Opens MCP setup instructions in your system browser',
        testID: 'more-connect-agent-row',
        action: { type: 'connect-agent' },
      },
      {
        key: 'connected-agents',
        label: 'Connected agents',
        icon: 'shield-check',
        accessibilityHint: 'Opens the list of authorized coaching agents',
        testID: 'more-connected-agents-row',
        action: { type: 'route', href: '/connected-agents' },
        requiresUser: true,
      },
      {
        key: 'gyms',
        label: 'Gyms',
        icon: 'location',
        accessibilityHint: 'Opens gym management',
        testID: 'more-gyms-row',
        action: { type: 'route', href: '/gyms?source=more' },
      },
      {
        key: 'developer-logs',
        label: 'Developer logs',
        icon: 'code',
        accessibilityHint: 'Opens the development-only in-app log viewer',
        testID: 'more-developer-logs-row',
        action: { type: 'route', href: '/dev-logs' },
        developerOnly: true,
      },
    ],
  },
  {
    key: 'library-account',
    title: 'Library & account',
    destinations: [
      {
        key: 'exercise-database',
        label: 'Exercise database',
        icon: 'database',
        accessibilityHint: 'Opens exercise database management',
        testID: 'more-exercise-database-row',
        action: { type: 'route', href: '/exercise-catalog?source=more' },
      },
      {
        key: 'settings',
        label: 'Settings & account',
        icon: 'settings',
        accessibilityHint: 'Opens settings and account management',
        testID: 'more-settings-row',
        action: { type: 'route', href: '/settings?source=more' },
      },
    ],
  },
] as const;

export function getMoreSections({
  hasUser,
  isDeveloper,
}: {
  hasUser: boolean;
  isDeveloper: boolean;
}): MoreSection[] {
  return MORE_SECTIONS.map((section) => ({
    ...section,
    destinations: section.destinations.filter(
      (destination) =>
        (!destination.requiresUser || hasUser) &&
        (!destination.developerOnly || isDeveloper),
    ),
  })).filter((section) => section.destinations.length > 0);
}

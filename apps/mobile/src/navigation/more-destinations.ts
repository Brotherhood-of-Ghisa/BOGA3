import type { IconName } from '@/components/ui/icon-glyphs';

export type MoreDestinationKey = 'groups' | 'exercises' | 'gyms' | 'connect-ai' | 'settings';

export type MoreRoute =
  | '/groups'
  | '/exercise-catalog?source=more'
  | '/gyms?source=more'
  | '/settings?source=more';

export type MoreDestination = {
  key: MoreDestinationKey;
  label: string;
  icon: IconName;
  testID: `more-${MoreDestinationKey}-row`;
  // `connect-ai` resolves its target at press time: the connected agents when
  // there is one, else the setup instructions in the system browser.
  action: { type: 'route'; href: MoreRoute } | { type: 'connect-ai' };
};

/** More's two cards, top to bottom; no group is titled. */
export const MORE_GROUPS: readonly (readonly MoreDestination[])[] = [
  [
    {
      key: 'groups',
      label: 'Groups',
      icon: 'users',
      testID: 'more-groups-row',
      action: { type: 'route', href: '/groups' },
    },
    {
      key: 'exercises',
      label: 'Exercises',
      icon: 'database',
      testID: 'more-exercises-row',
      action: { type: 'route', href: '/exercise-catalog?source=more' },
    },
    {
      key: 'gyms',
      label: 'Gyms',
      icon: 'location',
      testID: 'more-gyms-row',
      action: { type: 'route', href: '/gyms?source=more' },
    },
  ],
  [
    {
      key: 'connect-ai',
      label: 'Connect an AI',
      icon: 'sparkles',
      testID: 'more-connect-ai-row',
      action: { type: 'connect-ai' },
    },
    {
      key: 'settings',
      label: 'Settings',
      icon: 'settings',
      testID: 'more-settings-row',
      action: { type: 'route', href: '/settings?source=more' },
    },
  ],
];

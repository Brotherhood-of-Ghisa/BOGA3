import type { IconName } from '@/components/ui/icon-glyphs';

export type MoreDestinationKey = 'exercises' | 'gyms' | 'connect-ai' | 'settings';

export type MoreRoute =
  | '/exercise-catalog'
  | '/gyms'
  | '/settings';

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
      key: 'exercises',
      label: 'Exercises',
      icon: 'database',
      testID: 'more-exercises-row',
      action: { type: 'route', href: '/exercise-catalog' },
    },
    {
      key: 'gyms',
      label: 'Gyms',
      icon: 'location',
      testID: 'more-gyms-row',
      action: { type: 'route', href: '/gyms' },
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
      action: { type: 'route', href: '/settings' },
    },
  ],
];

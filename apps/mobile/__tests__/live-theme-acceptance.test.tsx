/* eslint-disable import/first */

/**
 * The live theme end to end: Today, a group page and the exercise page stay
 * mounted, as they stand in the stack behind Settings, while Settings →
 * Appearance saves a theme and a mode. One save repaints all of them in one
 * provider, native UI is re-pinned to the new mode, and nothing remounts: a
 * value typed on the exercise page survives the switch.
 *
 * Each screen runs over real data: the migrated in-memory SQLite database
 * (helpers/local-data.ts) seeded with the `exercise-page` fixture. Replaced:
 * the router, the auth hook, the group read RPCs and the bodyweight row and
 * sync-status panel on Settings (their own specs). Today and the exercise page
 * render as their screen components rather than their routes, which add only
 * router params, focus and the live group card (`today-group-card.test.tsx`).
 */

jest.mock('@/src/data/bootstrap', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- hoisted mock factory.
  require('./helpers/local-data').localDataBootstrapModule()
);

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: () => () => undefined },
}));

jest.mock('expo-router', () => {
  const mockReact = jest.requireActual('react');
  return {
    useRouter: () => ({ push: jest.fn(), back: jest.fn(), replace: jest.fn(), canGoBack: () => true, dismissTo: jest.fn() }),
    useNavigation: () => ({ getState: () => ({ routes: [] }), isFocused: () => true, setOptions: jest.fn() }),
    useLocalSearchParams: () => ({ groupId: 'group-a' }),
    useFocusEffect: (callback: () => void | (() => void)) => {
      mockReact.useEffect(() => callback(), [callback]);
    },
    Stack: { Screen: () => null },
  };
});

jest.mock('@/src/auth', () => ({
  ...jest.requireActual('@/src/auth'),
  useAuth: () => ({ isConfigured: true, user: { id: 'user-me' } }),
}));

jest.mock('@/src/groups/api', () => ({
  ...jest.requireActual('@/src/groups/api'),
  getGroup: jest.fn(async () => ({
    group: { group_id: 'group-a', name: 'Garage Gym', description: 'Early crew', member_count: 1, my_role: 'owner', bodyweight_calculations_enabled: false },
    members: [{ user_id: 'user-me', username: 'me', role: 'owner' }],
  })),
  listCompetitionExercises: jest.fn(async () => ({ contract_version: 4, exercises: [] })),
}));

jest.mock('@/src/notifications/api', () => ({
  ...jest.requireActual('@/src/notifications/api'),
  getGroupNotificationPreferences: jest.fn(async () => ({ activity: true, bests: true, ranks: true, muted: false })),
}));

jest.mock('@/components/bodyweight/settings-row', () => ({ BodyWeightSettingsRow: () => null }));
jest.mock('@/components/sync-status/sync-status-panel', () => ({ SyncStatusPanel: () => null }));

import { fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Appearance, processColor, StyleSheet } from 'react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import type { UiRoles } from '@/components/ui/theme';
import { DEFAULT_APPEARANCE, type AppearanceChoice } from '@/components/ui/theme-presets';
import { ExercisePageScreen } from '@/components/exercise-page/exercise-page-screen';
import { EXERCISE_PAGE_FIXTURE } from '@/src/maestro/exercise-page-fixture';

import { bootLocalApp, closeLocalData, loadMaestroFixture, resetLocalData } from './helpers/local-data';
import { renderWithTheme, rolesFor } from './helpers/theme';
import { waitForGone } from './helpers/wait-for-gone';

import { TodayScreen } from '../app/(tabs)/today';
import GroupScreenRoute from '../app/group/[groupId]/index';
import SettingsAppearanceRoute from '../app/settings-appearance';

const SLATE_DARK: AppearanceChoice = { theme: 'slate', mode: 'dark', custom: null };

// Every colour a host view under `root` is drawn in, as the number native
// receives (`processColor`): its style's colours, the colour props it hands to
// native views, and the `fill` / `stroke` of the svg an `<Icon>` or a chart
// draws, which react-native-svg has already turned into `{ type: 0, payload }`.
const COLOUR_KEYS = [
  'color', 'backgroundColor', 'borderColor', 'borderTopColor', 'borderBottomColor', 'borderLeftColor', 'borderRightColor',
  'shadowColor', 'textDecorationColor', 'tintColor',
] as const;
const SVG_PAINTS = ['fill', 'stroke'] as const;

const colourNumber = (colour: string): number => processColor(colour) as number;

type Drawn = { all: Set<number>; svg: Set<number> };

function coloursUnder(root: ReactTestInstance): Drawn {
  const drawn: Drawn = { all: new Set(), svg: new Set() };
  for (const node of root.findAll((candidate) => typeof candidate.type === 'string')) {
    const style = (StyleSheet.flatten(node.props.style) ?? {}) as Record<string, unknown>;
    for (const key of COLOUR_KEYS) if (typeof style[key] === 'string') drawn.all.add(colourNumber(style[key] as string));
    for (const prop of ['color', 'placeholderTextColor', ...SVG_PAINTS]) {
      if (typeof node.props[prop] === 'string') drawn.all.add(colourNumber(node.props[prop]));
    }
    for (const prop of SVG_PAINTS) {
      const paint = node.props[prop] as { type?: number; payload?: unknown } | undefined;
      if (paint?.type === 0 && typeof paint.payload === 'number') {
        drawn.all.add(paint.payload);
        drawn.svg.add(paint.payload);
      }
    }
  }
  return drawn;
}

// The colours a light page draws that the dark one does not: a screen still
// showing one of them after the switch did not repaint.
const staleColours = (before: UiRoles, after: UiRoles): number[] => {
  const kept = new Set(Object.values(after).map(colourNumber));
  return [...new Set(Object.values(before).map(colourNumber))].filter((colour) => !kept.has(colour));
};

// The screens behind Appearance. Appearance itself draws every preset's
// swatch in that preset's own colours, so only its ink is checked.
const SCREENS = ['today-screen', 'group-screen', 'exercise-page'] as const;

beforeEach(() => {
  resetLocalData();
  jest.spyOn(Appearance, 'getColorScheme').mockReturnValue('light');
  jest.spyOn(Appearance, 'setColorScheme').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  closeLocalData();
});

it('repaints Today, a group page and the exercise page behind Appearance on one save, pins native UI, and keeps their state', async () => {
  await loadMaestroFixture('exercise-page');
  await bootLocalApp();
  renderWithTheme(
    <>
      <TodayScreen groupState={{ status: 'signed-out' }} />
      <GroupScreenRoute />
      <ExercisePageScreen
        sessionExerciseId={EXERCISE_PAGE_FIXTURE.benchSessionExerciseId}
        sessionId={EXERCISE_PAGE_FIXTURE.activeSessionId}
      />
      <SettingsAppearanceRoute />
    </>,
  );
  await waitForGone(() => screen.queryByTestId('today-progress-loading'));
  await screen.findByTestId('group-screen-name');
  await screen.findByTestId('exercise-page');

  const before = rolesFor(DEFAULT_APPEARANCE);
  const after = rolesFor(SLATE_DARK);
  const stale = staleColours(before, after);
  expect(stale).toContain(colourNumber(before.ink));
  expect(stale).toContain(colourNumber(before.paper));
  // Each screen draws light-only colours in its styles and in its svg (icons,
  // charts), so the check after the switch covers both.
  for (const testID of SCREENS) {
    const { all, svg } = coloursUnder(screen.getByTestId(testID));
    expect({ screen: testID, styles: [...all].some((colour) => stale.includes(colour)), svg: [...svg].some((colour) => stale.includes(colour)) })
      .toEqual({ screen: testID, styles: true, svg: true });
  }

  // State a remount would lose: a weight typed but not committed.
  fireEvent.changeText(screen.getByTestId('exercise-set-logger-weight'), '97.5');
  jest.mocked(Appearance.setColorScheme).mockClear();

  fireEvent.press(screen.getByTestId('settings-appearance-option-slate'));
  fireEvent.press(screen.getByTestId('settings-appearance-mode-dark'));

  await waitFor(() => expect(Appearance.setColorScheme).toHaveBeenLastCalledWith('dark'));
  for (const testID of SCREENS) {
    const { all, svg } = coloursUnder(screen.getByTestId(testID));
    expect({ screen: testID, stale: [...all].filter((colour) => stale.includes(colour)) }).toEqual({ screen: testID, stale: [] });
    expect({ screen: testID, ink: all.has(colourNumber(after.ink)), svg: svg.size > 0 }).toEqual({ screen: testID, ink: true, svg: true });
  }
  expect(coloursUnder(screen.getByTestId('settings-appearance-screen')).all.has(colourNumber(after.ink))).toBe(true);
  expect(screen.getByTestId('exercise-set-logger-weight')).toHaveProp('value', '97.5');
  expect(within(screen.getByTestId('group-screen')).getByText('Garage Gym')).toBeTruthy();
  expect(screen.queryByText(/next launch/i)).toBeNull();
});

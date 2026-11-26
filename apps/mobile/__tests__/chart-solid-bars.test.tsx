/**
 * Solid bars (`docs/specs/ui/design-language.md` §2, "Custom"): a custom
 * theme's Chart part can draw every bar mark — Today's and a group's board
 * bars, the week figures' lap bars and the recovery card's trained days — in
 * the ramp's end (`viz4`) instead of its steps. Off (and on every preset),
 * each mark keeps its step. The leader keeps its label and the laps their
 * overlap and figures. Heatmap tiles keep the ramp, so they are not here.
 */
import { fireEvent, screen } from '@testing-library/react-native';

import { GroupHomeBoard } from '@/components/groups/group-home-board';
import { listGalleryMembers, listGalleryWeekBoard } from '@/components/pattern-gallery/list-fixtures';
import { TodayPlanCards } from '@/components/today/plan-cards';
import { TodayWeekBoardCard } from '@/components/today/today-week-board';
import { ShareBar, WeekFigure } from '@/components/today/week-figures';
import { defaultThemeSeeds } from '@/components/ui/theme';
import { barFills } from '@/components/ui/theme-context';
import { chartOf, customFromSeeds, type CustomColours } from '@/components/ui/theme-custom';
import { appearanceSolidBars, DEFAULT_APPEARANCE, themePresets, type AppearanceChoice } from '@/components/ui/theme-presets';
import { buildGroupHomeBoard } from '@/src/groups/home-view-model';
import type { TodayPlan } from '@/src/today-plan';

import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';

const BASE = customFromSeeds(defaultThemeSeeds, 'light');
const custom = (chart: Partial<ReturnType<typeof chartOf>> | null): AppearanceChoice => {
  const colours: CustomColours = chart === null ? BASE : { ...BASE, chart: { ...chartOf(BASE), ...chart } };
  return { theme: 'custom', mode: 'light', custom: colours };
};
const STEPS = custom({ solid: false });
const SOLID = custom({ solid: true });
// A ramp of the user's own, so the end is not the page's `viz4`.
const CHOSEN_SOLID = custom({
  follow: false,
  solid: true,
  start: { hue: 200, strength: 30, lightness: 85 },
  end: { hue: 320, strength: 80, lightness: 40 },
});

const fill = (testID: string) => screen.getByTestId(testID);

describe('which choices draw solid bars', () => {
  it('is a custom theme with Solid bars on, never a preset or a theme saved before the chart part', () => {
    expect(themePresets.map((preset) => appearanceSolidBars({ theme: preset.id, mode: 'light', custom: null }))).not.toContain(true);
    expect(appearanceSolidBars(custom(null))).toBe(false);
    expect(appearanceSolidBars(STEPS)).toBe(false);
    expect(appearanceSolidBars(SOLID)).toBe(true);
  });

  it('fills every step with the end, and keeps the theme’s own steps otherwise', () => {
    const roles = rolesFor(CHOSEN_SOLID);
    expect(barFills(roles, false)).toMatchObject({ viz2: roles.viz2, viz3: roles.viz3, viz4: roles.viz4 });
    expect(barFills(roles, true)).toEqual({ viz2: roles.viz4, viz3: roles.viz4, viz4: roles.viz4 });
    expect(barFills(roles, true)).toBe(barFills(roles, true));
  });
});

describe.each([
  ['Today’s group board', 'today-group-board-row'],
  ['a group’s home board', 'group-home-board-row'],
])('%s', (_name, prefix) => {
  const renderBoard = () => {
    const board = listGalleryWeekBoard('ready', false);
    if (prefix === 'today-group-board-row') {
      return renderWithTheme(<TodayWeekBoardCard accessibilityRange="this week" board={board} header={null} onOpenGroup={() => {}} range="26–1 Nov" />);
    }
    const home = buildGroupHomeBoard({ members: listGalleryMembers('ready', false), metric: 'sets', myUserId: 'me' });
    return renderWithTheme(<GroupHomeBoard board={home} metric="sets" />);
  };

  it('draws the bars in `viz3` and the leader in `viz4` with Solid bars off', async () => {
    renderBoard();
    await switchTheme(STEPS);
    const roles = rolesFor(STEPS);
    expect(roles.viz3).not.toBe(roles.viz4);
    expect(fill(`${prefix}-u0-fill`)).toHaveStyle({ backgroundColor: roles.viz4 });
    expect(fill(`${prefix}-u1-fill`)).toHaveStyle({ backgroundColor: roles.viz3 });
  });

  it.each([
    ['the page’s ramp', SOLID],
    ['a chosen ramp', CHOSEN_SOLID],
  ])('draws every bar in the end with Solid bars on, on %s, and keeps the names and figures', async (_ramp, appearance) => {
    renderBoard();
    await switchTheme(appearance);
    const { viz4 } = rolesFor(appearance);
    ['u0', 'u1', 'u2'].forEach((id) => expect(fill(`${prefix}-${id}-fill`)).toHaveStyle({ backgroundColor: viz4 }));
    expect(screen.getByTestId(`${prefix}-u0-name`)).toHaveTextContent('Alex');
    expect(screen.getByTestId(`${prefix}-u0-rank`)).toHaveTextContent('1');
  });
});

describe('the week figures’ lap bars', () => {
  it('fill each lap in its own step with Solid bars off', async () => {
    renderWithTheme(<ShareBar current={5} previous={2} testID="bar" />);
    await switchTheme(STEPS);
    const roles = rolesFor(STEPS);
    // A third lap: over the second's full `viz3`, in `viz4`.
    expect(fill('bar')).toHaveStyle({ backgroundColor: roles.viz3 });
    expect(fill('bar-fill')).toHaveStyle({ backgroundColor: roles.viz4, width: '50%' });
  });

  it('fill every lap in the end with Solid bars on, keeping the overlap and the figures', async () => {
    renderWithTheme(<WeekFigure current={3} label="Sets" previous={2} testID="sets" />);
    await switchTheme(CHOSEN_SOLID);
    const { viz4, well } = rolesFor(CHOSEN_SOLID);
    expect(fill('sets-bar')).toHaveStyle({ backgroundColor: viz4 });
    expect(fill('sets-bar-fill')).toHaveStyle({ backgroundColor: viz4, width: '50%' });
    expect(well).not.toBe(viz4);
    expect(screen.getByTestId('sets')).toHaveTextContent(/3/);
    expect(screen.getByTestId('sets')).toHaveTextContent(/2/);
  });
});

describe('the recovery card’s trained days', () => {
  const day = (offset: number) => new Date(2026, 9, 27 + offset);
  const plan: TodayPlan = {
    recoveryDays: [day(0), day(1), day(2), day(3)],
    today: day(3),
    muscles: [{ muscleGroupId: 'chest', name: 'Chest', familyName: 'Chest', days: [4, null, 2, null], today: null, weekSets: 6, target: 10 }],
    week: [],
    next: [],
  };
  // Rows are grouped by family by default: the family opens to its muscles.
  const renderCards = () => {
    renderWithTheme(<TodayPlanCards now={day(3)} onOpenMuscle={() => {}} onOpenPlan={() => {}} onOpenProgress={() => {}}
      plan={plan} countSecondary={false} onChangeCountSecondary={() => {}} />);
    const family = screen.queryByTestId('today-plan-group-Chest');
    if (family) fireEvent.press(family);
  };

  it('fills a trained day in `viz2` with Solid bars off, and a rest day in `inset`', async () => {
    renderCards();
    await switchTheme(STEPS);
    const roles = rolesFor(STEPS);
    expect(fill('today-plan-muscle-chest-day-0')).toHaveStyle({ backgroundColor: roles.viz2 });
    expect(fill('today-plan-muscle-chest-day-1')).toHaveStyle({ backgroundColor: roles.inset });
  });

  it('fills a trained day in the end with Solid bars on, keeping its figure', async () => {
    renderCards();
    await switchTheme(SOLID);
    const roles = rolesFor(SOLID);
    expect(fill('today-plan-muscle-chest-day-0')).toHaveStyle({ backgroundColor: roles.viz4 });
    expect(fill('today-plan-muscle-chest-day-0')).toHaveTextContent('4');
    expect(fill('today-plan-muscle-chest-day-1')).toHaveStyle({ backgroundColor: roles.inset });
  });
});

it('draws the default theme’s bars in its steps', () => {
  renderWithTheme(<ShareBar current={1} previous={2} testID="bar" />);
  expect(fill('bar-fill')).toHaveStyle({ backgroundColor: rolesFor(DEFAULT_APPEARANCE).viz2 });
});

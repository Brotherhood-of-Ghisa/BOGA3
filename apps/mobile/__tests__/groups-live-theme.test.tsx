import { screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { Polyline } from 'react-native-svg';

import { GroupRankChart } from '@/components/groups/group-rank-chart';
import { GroupComparisonBoundary } from '@/components/groups/group-comparison-boundary';
import { GroupBoardRow } from '@/components/groups/group-board-row';
import { GroupSummaryRow } from '@/components/groups/group-summary-row';
import { DEFAULT_APPEARANCE, type AppearanceChoice } from '@/components/ui/theme-presets';
import type { BoardRowViewModel } from '@/src/groups/board-view-model';

import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';

// The Groups screens repaint when the theme is saved
// (`components/ui/theme-context.tsx`): a `makeStyles` sheet, a text role and a
// colour prop each take the new roles without a remount.

const SLATE_DARK: AppearanceChoice = { theme: 'slate', mode: 'dark', custom: null };
const LIGHT = rolesFor(DEFAULT_APPEARANCE);
const DARK = rolesFor(SLATE_DARK);

afterEach(async () => {
  await switchTheme(DEFAULT_APPEARANCE);
});

jest.mock('@/src/groups', () => ({
  ...jest.requireActual('@/src/groups'),
  useGroupResource: () => ({ data: null, lostAccess: true, error: null, offline: false, refresh: jest.fn() }),
}));

const row: BoardRowViewModel = {
  key: 'sam', rank: 1, rankLabel: '1', memberLabel: 'Sam', isMe: false, former: false,
  valueLabel: '142.5', detailLabel: 'Weight 140.0 × 1', dateLabel: '12-10-2026', certification: null,
  accessibilityLabel: 'Sam',
};

describe('the board row', () => {
  it('repaints its text roles and its card when the theme changes', async () => {
    renderWithTheme(<GroupBoardRow count={1} index={0} row={row} />);
    expect(screen.getByTestId('group-board-row-1-detail')).toHaveStyle({ color: LIGHT.inkMuted });
    expect(screen.getByTestId('group-board-row-1-value')).toHaveStyle({ color: LIGHT.ink });

    await switchTheme(SLATE_DARK);

    expect(screen.getByTestId('group-board-row-1-detail')).toHaveStyle({ color: DARK.inkMuted });
    expect(screen.getByTestId('group-board-row-1-value')).toHaveStyle({ color: DARK.ink });
    expect(DARK.ink).not.toBe(LIGHT.ink);
  });
});

describe('the rank chart', () => {
  it('repaints a colour it hands to its svg when the theme changes', async () => {
    const view = renderWithTheme(
      <GroupRankChart
        accessibilityLabel="Place over time"
        columnLabels={['1 Oct', '8 Oct']}
        onSelect={jest.fn()}
        selectedIndex={0}
        series={{ periods: [], lines: [{ userId: 'me', name: 'Dino', initial: 'D', isMe: true, ranks: [1, 2] }], depth: 2 }}
      />,
    );
    const strokes = () => view.UNSAFE_getAllByType(Polyline).map((node) => node.props.stroke);
    expect(strokes()).toContain(LIGHT.ink);

    await switchTheme(SLATE_DARK);

    expect(strokes()).toContain(DARK.ink);
    expect(strokes()).not.toContain(LIGHT.ink);
  });
});

describe('the My groups row', () => {
  it('repaints a muted line and its chevron when the theme changes', async () => {
    renderWithTheme(
      <GroupSummaryRow
        divider={false}
        group={{ group_id: 'g1', name: 'Garage Gym', description: 'Lifts', member_count: 5, my_role: 'owner', bodyweight_calculations_enabled: false }}
        onPress={jest.fn()}
      />,
    );
    expect(screen.getByText('Lifts')).toHaveStyle({ color: LIGHT.inkMuted });

    await switchTheme(SLATE_DARK);

    expect(screen.getByText('Lifts')).toHaveStyle({ color: DARK.inkMuted });
  });
});

describe('a group page', () => {
  it('repaints the ground it stands on when the theme changes', async () => {
    const view = renderWithTheme(
      <GroupComparisonBoundary exerciseId="e1" groupId="g1" userId="u1">{() => null}</GroupComparisonBoundary>,
    );
    const grounds = () =>
      view.UNSAFE_root.findAll((node) => typeof node.type === 'string').map((node) => (StyleSheet.flatten(node.props.style) as { backgroundColor?: string } | undefined)?.backgroundColor);
    expect(screen.getByTestId('group-board-lost-access')).toBeTruthy();
    expect(grounds()).toContain(LIGHT.paper);

    await switchTheme(SLATE_DARK);

    expect(grounds()).toContain(DARK.paper);
    expect(grounds()).not.toContain(LIGHT.paper);
    expect(DARK.paper).not.toBe(LIGHT.paper);
  });
});

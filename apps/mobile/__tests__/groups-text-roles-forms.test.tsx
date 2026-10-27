/**
 * The Groups and Sessions pieces on the shared text roles
 * (`design-language.md` §3, "Text roles"): row names are `bodyStrong`, titles
 * `title`, controls and headings `label`; words never take Plex Mono, only
 * the figures inside them do (`FigureText`).
 */
import { render, screen, within } from '@testing-library/react-native';
import { StyleSheet, type TextStyle } from 'react-native';
import { Text as SvgText } from 'react-native-svg';

import { GroupCycleButton } from '@/components/groups/group-cycle-button';
import { GroupExerciseRow } from '@/components/groups/group-exercise-row';
import { GroupHeaderCard } from '@/components/groups/group-header-card';
import { GroupRankChart } from '@/components/groups/group-rank-chart';
import { GroupSummaryRow } from '@/components/groups/group-summary-row';
import { PickerGroupSectionList } from '@/components/groups/picker-group-section';
import { SessionSummaryLine } from '@/components/session-list/session-summary-line';
import { SessionSummaryRow } from '@/components/today/session-summary-row';
import { WeekFigure } from '@/components/today/week-figures';
import { uiFonts, uiRoles, uiTypography } from '@/components/ui/tokens';
import type { PickerGroupRow } from '@/src/groups';

const style = (node: { props: { style?: unknown } }): TextStyle => StyleSheet.flatten(node.props.style as never) as TextStyle;

const BODY_STRONG = { fontFamily: uiFonts.body.family, fontWeight: '600', fontSize: uiTypography.size.base, lineHeight: uiTypography.lineHeight.base };
const META = { fontFamily: uiFonts.body.family, fontWeight: '400', fontSize: uiTypography.size.sm, lineHeight: uiTypography.lineHeight.sm };
const LABEL = { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.xxs, textTransform: 'uppercase' };

describe('Groups: names and titles', () => {
  it('names a My groups row in bodyStrong, not Archivo', () => {
    render(
      <GroupSummaryRow
        divider={false}
        group={{ group_id: 'g1', name: 'Garage Gym', description: null, member_count: 5, my_role: 'owner', bodyweight_calculations_enabled: false }}
        onPress={jest.fn()}
      />,
    );
    expect(style(screen.getByText('Garage Gym'))).toMatchObject(BODY_STRONG);
  });

  it('names a group exercise row in bodyStrong', () => {
    render(
      <GroupExerciseRow
        row={{ groupExerciseId: 'ge1', name: 'Bench Press', loadInputModeLabel: 'Total', archived: false, linkStatus: 'Not linked', linkable: false, personalLinks: [] }}
      />,
    );
    expect(style(screen.getByTestId('group-exercise-name-ge1'))).toMatchObject(BODY_STRONG);
  });

  it('names a picker group row in bodyStrong, its group and status quieter in full roles of their own', () => {
    const row = {
      key: 'g1:ge1',
      groupId: 'g1',
      groupName: 'Garage Gym',
      groupExercise: { group_exercise_id: 'ge1', name: 'Bench Press' } as PickerGroupRow['groupExercise'],
      linkedExercises: [],
      statusLabel: 'not linked',
    };
    render(<PickerGroupSectionList onPressRow={jest.fn()} sections={[{ groupId: 'g1', groupName: 'Garage Gym', rows: [row] }]} />);
    const name = screen.getByText(/^Bench Press/);
    expect(style(name)).toMatchObject(BODY_STRONG);
    // The nested group name resets the weight its parent would hand down.
    expect(style(within(name).getByText(/Garage Gym/))).toMatchObject({ fontFamily: uiFonts.body.family, fontWeight: '400', color: uiRoles.inkMuted });
    expect(style(screen.getByText('not linked'))).toMatchObject(META);
  });

  it('titles the group header card at the title size, its counts in the figure face', () => {
    render(<GroupHeaderCard meta="5 members · Owner" metaTestID="meta" name="Garage Gym" nameTestID="name" />);
    expect(style(screen.getByTestId('name'))).toMatchObject({ fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.lg });
    const meta = screen.getByTestId('meta');
    expect(style(meta).fontFamily).toBe(uiFonts.body.family);
    expect(style(within(meta).getByText('5'))).toMatchObject({ fontFamily: uiFonts.figure.family });
  });

  it('labels a filter pill as a micro-label in ink', () => {
    render(
      <GroupCycleButton
        accessibilityLabel="Section"
        onChange={jest.fn()}
        options={[{ value: 'a', label: 'Stream' }, { value: 'b', label: 'Leaderboards' }]}
        testID="pill"
        value="a"
      />,
    );
    expect(style(screen.getByText('Stream'))).toMatchObject({ ...LABEL, color: uiRoles.ink });
  });

  it('draws the rank chart\'s initials in Archivo, not Plex Mono: they are letters', () => {
    const view = render(
      <GroupRankChart
        accessibilityLabel="Place"
        columnLabels={['5 Oct']}
        onSelect={jest.fn()}
        selectedIndex={0}
        series={{ periods: [], lines: [{ userId: 'u', name: 'Marco', initial: 'M', isMe: false, ranks: [1] }], depth: 1 }}
      />,
    );
    const initials = view.UNSAFE_getAllByType(SvgText);
    expect(initials.length).toBeGreaterThan(0);
    initials.forEach((node) => expect(node.props).toMatchObject({ fontFamily: uiFonts.display.family, fontWeight: '700' }));
  });
});

describe('Sessions and week figures: words out of Plex Mono', () => {
  it('reads an active session\'s counts as words, with only the figures in Plex Mono', () => {
    render(
      <SessionSummaryLine
        dateFormat="DD-MM-YYYY"
        session={{
          id: 's1',
          startedAt: '2026-10-27T07:00:00.000Z',
          status: 'completed',
          completedAt: null,
          durationSec: 3600,
          durationDisplay: '1h',
          gymName: 'Canal Street Gym',
          exerciseCount: 4,
          setCount: 12,
          totalWeight: 0,
          deletedAt: null,
          records: [],
        }}
        testIdPrefix="row"
      />,
    );
    const sets = screen.getByTestId('row-sets');
    expect(style(sets)).toMatchObject(META);
    expect(style(within(sets).getByText('12'))).toMatchObject({ fontFamily: uiFonts.figure.family });
    expect(style(screen.getByTestId('row-start'))).toMatchObject({ fontFamily: uiFonts.figure.family, fontSize: uiTypography.size.sm, color: uiRoles.ink });
    expect(style(screen.getByTestId('row-gym'))).toMatchObject({ ...META, fontWeight: '600', color: uiRoles.ink });
  });

  it('reads a history row\'s `sets · exercises` line as words, its figures in Plex Mono', () => {
    render(
      <SessionSummaryRow
        accessibilityHint=""
        accessibilityLabel=""
        duration="1h"
        figures="18 sets · 6 exercises"
        gym={null}
        onPress={jest.fn()}
        record={null}
        stamp="27-10-2026 07:00"
        testID="row"
      />,
    );
    const figures = screen.getByTestId('row-figures');
    expect(style(figures)).toMatchObject(META);
    expect(style(within(figures).getByText('18'))).toMatchObject({ fontFamily: uiFonts.figure.family });
  });

  it('keeps `vs … last wk` in words, the previous figure alone in Plex Mono', () => {
    render(<WeekFigure current={3} label="Sets" previous={4} testID="fig" />);
    const previous = screen.getByTestId('fig-previous');
    expect(style(previous)).toMatchObject(META);
    expect(previous).toHaveTextContent('vs 4 last wk');
    expect(style(within(previous).getByText('4'))).toMatchObject({ fontFamily: uiFonts.figure.family });
  });
});

/**
 * A saved theme repaints the session planner and the programme screens
 * (`components/ui/theme-context.tsx`): a `makeStyles` sheet, a text tone, an
 * icon named by role and the mode a native picker is told, all without a
 * remount.
 */
import { screen } from '@testing-library/react-native';
import { Platform, StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { Path } from 'react-native-svg';

import { NextProgrammeBlockCard } from '@/components/session-planner/next-programme-block-card';
import { PlanBlockEditor } from '@/components/session-planner/plan-block-editor';
import { PlanScheduleSheet } from '@/components/session-planner/plan-schedule-sheet';
import { PlanSessionAction } from '@/components/session-planner/plan-sections';
import { DEFAULT_APPEARANCE, type AppearanceChoice } from '@/components/ui/theme-presets';
import type { PlanBlockView } from '@/src/session-planner';

import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';

const SLATE_DARK: AppearanceChoice = { theme: 'slate', mode: 'dark', custom: null };
const before = rolesFor(DEFAULT_APPEARANCE);
const after = rolesFor(SLATE_DARK);

const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as TextStyle & ViewStyle;

const nextBlock: PlanBlockView = {
  id: 'b1',
  planId: 'p1',
  exerciseDefinitionId: null,
  name: 'Bench Press',
  orderIndex: 0,
  progressStatus: 'pending',
  status: 'pending',
  attachedSessionId: null,
  targets: [],
} as unknown as PlanBlockView;

describe('session planner: live theme', () => {
  const originalPlatform = Platform.OS;

  afterEach(async () => {
    Platform.OS = originalPlatform;
    await switchTheme(DEFAULT_APPEARANCE);
  });

  it('repaints a block editor card, a text tone and an icon when the theme is saved', async () => {
    expect(after.surface).not.toBe(before.surface);
    expect(after.inkFaint).not.toBe(before.inkFaint);

    const { UNSAFE_getAllByType } = renderWithTheme(
      <>
        <PlanBlockEditor
          block={{ id: 'fb1', sourceBlockId: null, exerciseDefinitionId: null, name: 'Bench Press', loadInputMode: null, sets: [] }}
          count={1}
          errors={new Map()}
          index={0}
          onAddSets={jest.fn()}
          onChangeSet={jest.fn()}
          onMoveBlock={jest.fn()}
          onPickExercise={jest.fn()}
          onRemoveBlock={jest.fn()}
          onRemoveSet={jest.fn()}
        />
        <NextProgrammeBlockCard blockCounts={{ pending: 1, attached: 0, completed: 0, skipped: 0 }} nextBlock={nextBlock} onAdd={jest.fn()} onSkip={jest.fn()} />
        <PlanSessionAction onPress={jest.fn()} />
      </>,
    );
    expect(flat(screen.getByTestId('plan-form-block-1'))).toMatchObject({ backgroundColor: before.surface, borderColor: before.rule });
    expect(flat(screen.getByText('Next up')).color).toBe(before.inkFaint);
    expect(UNSAFE_getAllByType(Path).some((path) => path.props.stroke === before.ink)).toBe(true);

    await switchTheme(SLATE_DARK);

    expect(flat(screen.getByTestId('plan-form-block-1'))).toMatchObject({ backgroundColor: after.surface, borderColor: after.rule });
    expect(flat(screen.getByText('Next up')).color).toBe(after.inkFaint);
    expect(UNSAFE_getAllByType(Path).some((path) => path.props.stroke === after.ink)).toBe(true);
  });

  it('tells the native schedule picker the new mode when the theme is saved', async () => {
    Platform.OS = 'ios';
    renderWithTheme(<PlanScheduleSheet currentSchedule={null} onConfirm={jest.fn()} onDismiss={jest.fn()} visible />);
    expect(screen.getByTestId('plan-schedule-picker-native').props.themeVariant).toBe('light');

    await switchTheme(SLATE_DARK);

    expect(screen.getByTestId('plan-schedule-picker-native').props.themeVariant).toBe('dark');
  });
});

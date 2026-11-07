import { screen } from '@testing-library/react-native';
import { StyleSheet, type TextStyle, type ViewStyle } from 'react-native';
import { Path } from 'react-native-svg';

import { FilterChip } from '@/components/exercise-catalog/exercise-list-controls';
import { ExerciseTopBar } from '@/components/exercise-page/exercise-top-bar';
import { SetLogger } from '@/components/exercise-page/set-logger';
import { DEFAULT_APPEARANCE, type AppearanceChoice } from '@/components/ui/theme-presets';

import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';

// The exercise page and the exercise list repaint when a theme is saved: the
// roles they draw come from the provider, so a saved choice changes their
// colours without a remount.

const SLATE_DARK: AppearanceChoice = { theme: 'slate', mode: 'dark', custom: null };

const flat = (node: { props: { style?: unknown } }) => StyleSheet.flatten(node.props.style as never) as TextStyle & ViewStyle;

describe('exercise page and exercise list: live theme', () => {
  afterEach(async () => {
    await switchTheme(DEFAULT_APPEARANCE);
  });

  it('repaints the exercise page title bar and logger when the theme is saved', async () => {
    const before = rolesFor(DEFAULT_APPEARANCE);
    const after = rolesFor(SLATE_DARK);
    expect(after.accent).not.toBe(before.accent);

    const { UNSAFE_getAllByType } = renderWithTheme(
      <>
        <ExerciseTopBar onBack={jest.fn()} onOpenSwitcher={jest.fn()} title="Barbell Bench Press" />
        <SetLogger
          loadContext={{ policy: 'personal', bodyweightContribution: 0, loadInputMode: 'total_load' }}
          number={3}
          onChangeReps={jest.fn()}
          onChangeWeight={jest.fn()}
          onCommit={jest.fn()}
          onCycleEffort={jest.fn()}
          onOpenEffort={jest.fn()}
          repsValue="6"
          setType="rir_1"
          weightValue="82.5"
        />
      </>,
    );
    expect(flat(screen.getByText('Barbell Bench Press')).color).toBe(before.ink);
    expect(flat(screen.getByText('Set 3')).color).toBe(before.accent);
    expect(flat(screen.getByTestId('exercise-set-logger')).backgroundColor).toBe(before.accentWash);

    await switchTheme(SLATE_DARK);

    expect(flat(screen.getByText('Barbell Bench Press')).color).toBe(after.ink);
    expect(flat(screen.getByText('Set 3')).color).toBe(after.accent);
    expect(flat(screen.getByTestId('exercise-set-logger')).backgroundColor).toBe(after.accentWash);
    // The chevron beside the title is an Icon named by role, so it repaints too.
    expect(UNSAFE_getAllByType(Path).some((path) => path.props.stroke === after.inkMuted)).toBe(true);
  });

  it('repaints a selected filter chip when the theme is saved', async () => {
    const before = rolesFor(DEFAULT_APPEARANCE);
    const after = rolesFor(SLATE_DARK);
    renderWithTheme(
      <FilterChip accessibilityLabel="Never-done" accessibilityRole="checkbox" label="Never-done" on onPress={jest.fn()} testID="chip" />,
    );
    expect(flat(screen.getByTestId('chip'))).toMatchObject({ backgroundColor: before.ink, borderColor: before.ink });
    expect(flat(screen.getByText('Never-done')).color).toBe(before.onInk);

    await switchTheme(SLATE_DARK);

    expect(flat(screen.getByTestId('chip'))).toMatchObject({ backgroundColor: after.ink, borderColor: after.ink });
    expect(flat(screen.getByText('Never-done')).color).toBe(after.onInk);
    expect(after.ink).not.toBe(before.ink);
  });
});

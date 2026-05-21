import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { TopLevelTabs } from '@/components/navigation/top-level-tabs';
import { UiButton, UiSurface, UiText, uiColors, uiRadius } from '@/components/ui';

describe('UI primitives', () => {
  it('renders semantic tab buttons with selected accessibility state and press handling', () => {
    const onPressStatsHistory = jest.fn();
    const onPressLog = jest.fn();
    const onPressExercises = jest.fn();
    const onPressSettings = jest.fn();

    render(
      <TopLevelTabs
        activeTab="stats-history"
        onPressStatsHistory={onPressStatsHistory}
        onPressLog={onPressLog}
        onPressExercises={onPressExercises}
        onPressSettings={onPressSettings}
      />
    );

    const statsHistoryTab = screen.getByLabelText('Open Stats and History');
    const logTab = screen.getByLabelText('Open Log');
    const exercisesTab = screen.getByLabelText('Open Exercises');
    const settingsButton = screen.getByLabelText('Open Settings');

    expect(statsHistoryTab.props.accessibilityState.selected).toBe(true);
    expect(logTab.props.accessibilityState.selected).toBe(false);
    expect(exercisesTab.props.accessibilityState.selected).toBe(false);

    fireEvent.press(logTab);
    fireEvent.press(exercisesTab);
    fireEvent.press(settingsButton);
    expect(onPressLog).toHaveBeenCalledTimes(1);
    expect(onPressExercises).toHaveBeenCalledTimes(1);
    expect(onPressSettings).toHaveBeenCalledTimes(1);
    expect(onPressStatsHistory).not.toHaveBeenCalled();
  });

  it('does not fire onPress for disabled buttons', () => {
    const onPress = jest.fn();

    render(
      <UiButton
        accessibilityLabel="Delete item"
        disabled
        label="Delete"
        onPress={onPress}
        variant="danger"
      />
    );

    fireEvent.press(screen.getByLabelText('Delete item'));
    expect(onPress).not.toHaveBeenCalled();
  });

  it('applies token-backed styles for surface and text variants', () => {
    render(
      <UiSurface testID="surface" variant="panelMuted">
        <UiText variant="bodyMuted">Muted body</UiText>
      </UiSurface>
    );

    const surface = screen.getByTestId('surface');
    const text = screen.getByText('Muted body');

    const surfaceStyle = StyleSheet.flatten(surface.props.style);
    const textStyle = StyleSheet.flatten(text.props.style);

    expect(surfaceStyle.borderRadius).toBe(uiRadius.lg);
    expect(textStyle.color).toBe(uiColors.textMuted);
  });

  it('matches the current top-level tabs snapshot after primitive migration', () => {
    const { toJSON } = render(
      <TopLevelTabs
        activeTab="exercises"
        onPressStatsHistory={jest.fn()}
        onPressLog={jest.fn()}
        onPressExercises={jest.fn()}
        onPressSettings={jest.fn()}
      />
    );

    expect(toJSON()).toMatchSnapshot();
  });
});

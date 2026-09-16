import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { MainTabs } from '@/components/navigation/main-tabs';
import { UiButton, UiSurface, UiText, uiColors, uiRadius } from '@/components/ui';

describe('UI primitives', () => {
  it('renders semantic tab buttons with selected accessibility state and press handling', () => {
    const onSelect = jest.fn();

    render(<MainTabs activeTab="today" onSelect={onSelect} />);

    const todayTab = screen.getByLabelText('Open Today');
    const trainTab = screen.getByLabelText('Open Train');
    const progressTab = screen.getByLabelText('Open Progress');
    const moreTab = screen.getByLabelText('Open More');

    expect(todayTab.props.accessibilityState.selected).toBe(true);
    expect(trainTab.props.accessibilityState.selected).toBe(false);
    expect(progressTab.props.accessibilityState.selected).toBe(false);
    expect(moreTab.props.accessibilityState.selected).toBe(false);

    fireEvent.press(trainTab);
    fireEvent.press(progressTab);
    fireEvent.press(moreTab);
    expect(onSelect.mock.calls.map(([tab]) => tab)).toEqual([
      'train',
      'progress',
      'more',
    ]);
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
      <MainTabs activeTab="progress" onSelect={jest.fn()} />
    );

    expect(toJSON()).toMatchSnapshot();
  });
});

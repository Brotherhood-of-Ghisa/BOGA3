import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { UiButton, UiSurface, UiText, uiColors, uiRadius } from '@/components/ui';

// The legacy primitives, until DLM-T15 deletes them. `MainTabs` moved to
// `main-tabs.test.tsx` with its design-language restyle (DLM-T02).
describe('UI primitives', () => {
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

    expect(surfaceStyle.borderRadius).toBe(uiRadius.md);
    expect(textStyle.color).toBe(uiColors.textMuted);
  });

});

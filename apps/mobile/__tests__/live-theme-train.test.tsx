import { screen } from '@testing-library/react-native';

import { StartDisc } from '@/components/train/start-disc';
import { DEFAULT_APPEARANCE, type AppearanceChoice } from '@/components/ui/theme-presets';

import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';

// Train's start disc follows a saved appearance: its disc, ring and label are
// drawn in the roles the app is in now, not the ones it launched in.

const SLATE_DARK: AppearanceChoice = { theme: 'slate', mode: 'dark', custom: null };

describe('the start disc on a saved appearance', () => {
  it('repaints the disc, its ring and its label', async () => {
    renderWithTheme(<StartDisc accessibilityLabel="Start" label="Start" onPress={jest.fn()} testID="start" />);
    const before = rolesFor(DEFAULT_APPEARANCE);
    expect(screen.getByTestId('start')).toHaveStyle({ backgroundColor: before.accent });
    expect(screen.getByTestId('start-ring')).toHaveStyle({ borderColor: before.rule });
    expect(screen.getByText('Start')).toHaveStyle({ color: before.onAccent });

    await switchTheme(SLATE_DARK);
    const after = rolesFor(SLATE_DARK);
    expect(after.accent).not.toBe(before.accent);
    expect(after.rule).not.toBe(before.rule);
    expect(screen.getByTestId('start')).toHaveStyle({ backgroundColor: after.accent });
    expect(screen.getByTestId('start-ring')).toHaveStyle({ borderColor: after.rule });
    expect(screen.getByText('Start')).toHaveStyle({ color: after.onAccent });
  });
});

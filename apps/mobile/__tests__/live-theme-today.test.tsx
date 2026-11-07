import { screen } from '@testing-library/react-native';

import { ShareBar } from '@/components/today';
import { SessionSummaryRow } from '@/components/today/session-summary-row';
import { DEFAULT_APPEARANCE, type AppearanceChoice } from '@/components/ui/theme-presets';

import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';

// Today's cards follow a saved appearance: the share bar's ramp and a summary
// row's text tones are drawn in the roles the app is in now, not the ones it
// launched in.

const SLATE_DARK: AppearanceChoice = { theme: 'slate', mode: 'dark', custom: null };

describe('Today on a saved appearance', () => {
  it('repaints the share bar track and lap fill', async () => {
    renderWithTheme(<ShareBar current={2} previous={3} testID="bar" />);
    const before = rolesFor(DEFAULT_APPEARANCE);
    expect(screen.getByTestId('bar')).toHaveStyle({ backgroundColor: before.viz0 });
    expect(screen.getByTestId('bar-fill')).toHaveStyle({ backgroundColor: before.viz2 });

    await switchTheme(SLATE_DARK);
    const after = rolesFor(SLATE_DARK);
    expect(after.viz0).not.toBe(before.viz0);
    expect(screen.getByTestId('bar')).toHaveStyle({ backgroundColor: after.viz0 });
    expect(screen.getByTestId('bar-fill')).toHaveStyle({ backgroundColor: after.viz2 });
  });

  it('repaints a session summary row’s record line', async () => {
    renderWithTheme(
      <SessionSummaryRow
        accessibilityHint="Opens the session"
        accessibilityLabel="Session"
        duration="1h 12m"
        figures="18 sets · 5 exercises"
        gym={null}
        onPress={jest.fn()}
        record={{ kind: 'many', count: '3 PRs' }}
        stamp="10/16 06:10"
        testID="row"
      />,
    );
    expect(screen.getByText('3 PRs')).toHaveStyle({ color: rolesFor(DEFAULT_APPEARANCE).record });

    await switchTheme(SLATE_DARK);
    expect(rolesFor(SLATE_DARK).record).not.toBe(rolesFor(DEFAULT_APPEARANCE).record);
    expect(screen.getByText('3 PRs')).toHaveStyle({ color: rolesFor(SLATE_DARK).record });
  });
});

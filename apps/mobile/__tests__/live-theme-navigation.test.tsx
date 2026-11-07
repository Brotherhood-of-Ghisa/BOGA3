import { screen } from '@testing-library/react-native';
import { Text } from 'react-native';

import { headerStyleOptions, useHeaderStyleOptions } from '@/components/navigation/header-style';
import { MainTabBar } from '@/components/navigation/main-tab-bar';
import { navigationTheme, useNavigationTheme } from '@/components/navigation/navigation-theme';
import { DEFAULT_APPEARANCE, type AppearanceChoice } from '@/components/ui/theme-presets';

import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';

// The navigation folder follows a saved appearance: the tab bar's sheet, the
// navigators' theme and the header style are drawn in the roles the app is in
// now, not the ones it launched in.

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

const SLATE_DARK: AppearanceChoice = { theme: 'slate', mode: 'dark', custom: null };

function Probe() {
  const theme = useNavigationTheme();
  const header = useHeaderStyleOptions();
  return <Text testID="probe">{`${String(theme.colors.background)}|${String(header.headerTintColor)}`}</Text>;
}

describe('the navigation folder on a saved appearance', () => {
  it('repaints the tab bar', async () => {
    renderWithTheme(<MainTabBar activeTab="today" onSelect={jest.fn()} />);
    expect(screen.getByTestId('main-tab-bar')).toHaveStyle({ backgroundColor: rolesFor(DEFAULT_APPEARANCE).paper });

    await switchTheme(SLATE_DARK);
    expect(rolesFor(SLATE_DARK).paper).not.toBe(rolesFor(DEFAULT_APPEARANCE).paper);
    expect(screen.getByTestId('main-tab-bar')).toHaveStyle({ backgroundColor: rolesFor(SLATE_DARK).paper });
  });

  it('hands the navigators the roles and mode in force', async () => {
    renderWithTheme(<Probe />);
    await switchTheme(SLATE_DARK);
    const roles = rolesFor(SLATE_DARK);
    expect(screen.getByTestId('probe')).toHaveTextContent(`${String(navigationTheme(roles, "dark").colors.background)}|${roles.ink}`);
  });

  it('draws the header in the roles it is given', () => {
    const roles = rolesFor(SLATE_DARK);
    expect(headerStyleOptions(roles)).toMatchObject({
      headerStyle: { backgroundColor: roles.paper },
      headerTintColor: roles.ink,
      headerTitleStyle: { color: roles.ink },
    });
  });
});

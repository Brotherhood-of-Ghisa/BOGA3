/* eslint-disable import/first */

const mockUseAuth = jest.fn();

jest.mock('@/src/auth', () => ({
  useAuth: () => mockUseAuth(),
}));

jest.mock('expo-router', () => {
  const Stack = () => null;
  Stack.displayName = 'MockStack';
  const StackScreen = () => null;
  StackScreen.displayName = 'MockStackScreen';
  Stack.Screen = StackScreen;
  return { Stack };
});

import { screen } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import type { AppearanceChoice } from '@/components/ui/theme-presets';

import SignInScreen from '../app/sign-in';
import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';

// The sign-in route draws its ground from a `makeStyles` sheet, so saving
// another appearance repaints it without a remount.

const SLATE_DARK: AppearanceChoice = { theme: 'slate', mode: 'dark', custom: null };

describe('app routes follow the live theme', () => {
  beforeEach(() => {
    mockUseAuth.mockReturnValue({
      clearAuthError: jest.fn(),
      disabledReason: null,
      isConfigured: true,
      lastError: null,
      session: null,
      signInWithPassword: jest.fn().mockResolvedValue({}),
      status: 'ready',
    });
  });

  it('repaints the sign-in ground when the appearance changes', async () => {
    renderWithTheme(<SignInScreen />);
    const ground = () => StyleSheet.flatten(screen.getByTestId('sign-in-screen').props.style).backgroundColor;
    const before = ground();

    await switchTheme(SLATE_DARK);

    expect(rolesFor(SLATE_DARK).paper).not.toBe(before);
    expect(ground()).toBe(rolesFor(SLATE_DARK).paper);
  });
});

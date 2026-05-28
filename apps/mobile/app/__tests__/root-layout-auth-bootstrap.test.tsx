/* eslint-disable import/first */

import type { ReactNode } from 'react';

const mockBootstrapLocalDataLayer = jest.fn();
const mockBootstrapAuthState = jest.fn();
const mockEnsureExerciseCatalogLoaded = jest.fn();

jest.mock('@/src/data', () => ({
  bootstrapLocalDataLayer: (...args: unknown[]) => mockBootstrapLocalDataLayer(...args),
}));

jest.mock('@/src/auth', () => {
  const AuthProvider = ({ children }: { children: ReactNode }) => children;
  AuthProvider.displayName = 'MockAuthProvider';

  return {
    AuthProvider,
    bootstrapAuthState: (...args: unknown[]) => mockBootstrapAuthState(...args),
  };
});

jest.mock('@/src/exercise-catalog/cache', () => ({
  ensureExerciseCatalogLoaded: (...args: unknown[]) => mockEnsureExerciseCatalogLoaded(...args),
}));

jest.mock('expo-status-bar', () => ({
  StatusBar: () => null,
}));

jest.mock('expo-router', () => {
  const { View: MockView } = jest.requireActual('react-native');
  const Stack = ({ children }: { children: ReactNode }) => <MockView testID="root-stack">{children}</MockView>;
  const StackScreen = ({ name }: { name: string }) => <MockView testID={`screen-${name}`} />;

  Stack.displayName = 'MockStack';
  StackScreen.displayName = 'MockStackScreen';
  Stack.Screen = StackScreen;

  return {
    Stack,
  };
});

import { render, screen, waitFor } from '@testing-library/react-native';

import RootLayout from '../_layout';

describe('RootLayout auth bootstrap wiring', () => {
  beforeEach(() => {
    mockBootstrapLocalDataLayer.mockReset();
    mockBootstrapAuthState.mockReset();
    mockEnsureExerciseCatalogLoaded.mockReset();
    mockBootstrapLocalDataLayer.mockResolvedValue(undefined);
    mockBootstrapAuthState.mockResolvedValue(undefined);
    mockEnsureExerciseCatalogLoaded.mockResolvedValue(undefined);
  });

  it('starts local data bootstrap and auth bootstrap on mount', async () => {
    render(<RootLayout />);

    await waitFor(() => {
      expect(mockBootstrapLocalDataLayer).toHaveBeenCalledTimes(1);
    });
    expect(mockBootstrapAuthState).toHaveBeenCalledTimes(1);
    expect(mockEnsureExerciseCatalogLoaded).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('root-stack')).toBeTruthy();
    // Tab roots (incl. settings) live in the `(tabs)` group registered as a single screen
    expect(screen.getByTestId('screen-(tabs)')).toBeTruthy();
    expect(screen.getByTestId('screen-profile')).toBeTruthy();
  });
});

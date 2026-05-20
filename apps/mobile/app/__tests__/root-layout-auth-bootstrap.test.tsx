/* eslint-disable import/first */

import type { ReactNode } from 'react';

const mockBootstrapLocalDataLayer = jest.fn();
const mockBootstrapAuthState = jest.fn();
const mockSetDefaultSyncCadenceContextFromPathname = jest.fn();
const mockStartSyncRuntime = jest.fn();
const mockStartDefaultSyncScheduler = jest.fn();
const mockStopSyncRuntime = jest.fn();
const mockStopDefaultSyncScheduler = jest.fn();

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

jest.mock('@/src/sync', () => ({
  setDefaultSyncCadenceContextFromPathname: (...args: unknown[]) =>
    mockSetDefaultSyncCadenceContextFromPathname(...args),
  startSyncRuntime: (...args: unknown[]) => mockStartSyncRuntime(...args),
  startDefaultSyncScheduler: (...args: unknown[]) => mockStartDefaultSyncScheduler(...args),
  stopSyncRuntime: (...args: unknown[]) => mockStopSyncRuntime(...args),
  stopDefaultSyncScheduler: (...args: unknown[]) => mockStopDefaultSyncScheduler(...args),
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
    usePathname: () => '/session-list',
  };
});

import { render, screen, waitFor } from '@testing-library/react-native';

import RootLayout from '../_layout';

describe('RootLayout auth bootstrap wiring', () => {
  beforeEach(() => {
    mockBootstrapLocalDataLayer.mockReset();
    mockBootstrapAuthState.mockReset();
    mockSetDefaultSyncCadenceContextFromPathname.mockReset();
    mockStartSyncRuntime.mockReset();
    mockStartDefaultSyncScheduler.mockReset();
    mockStopSyncRuntime.mockReset();
    mockStopDefaultSyncScheduler.mockReset();
    mockBootstrapLocalDataLayer.mockResolvedValue(undefined);
    mockBootstrapAuthState.mockResolvedValue(undefined);
  });

  it('starts local data bootstrap and auth bootstrap on mount', async () => {
    render(<RootLayout />);

    await waitFor(() => {
      expect(mockBootstrapLocalDataLayer).toHaveBeenCalledTimes(1);
    });
    expect(mockBootstrapAuthState).toHaveBeenCalledTimes(1);
    expect(mockStartSyncRuntime).toHaveBeenCalledTimes(1);
    expect(mockStartDefaultSyncScheduler).toHaveBeenCalledTimes(1);
    expect(mockSetDefaultSyncCadenceContextFromPathname).toHaveBeenCalledWith('/session-list');
    expect(screen.getByTestId('root-stack')).toBeTruthy();
    // Tab roots (incl. settings) live in the `(tabs)` group registered as a single screen
    expect(screen.getByTestId('screen-(tabs)')).toBeTruthy();
    expect(screen.getByTestId('screen-profile')).toBeTruthy();
  });
});

/* eslint-disable import/first */

/**
 * M25-T07: the linking hook is inert while signed out. With a null user it
 * never subscribes to NetInfo, never opens the local database, never reads
 * links, and never calls a group RPC — so the exercise page and the catalogue can
 * host it unconditionally. `useGroupLinkingUserId` is signed-in-and-configured
 * only.
 */

import * as mockReact from 'react';
import { act, renderHook } from '@testing-library/react-native';

const mockAddEventListener = jest.fn(() => () => undefined);
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: (...args: unknown[]) => (mockAddEventListener as jest.Mock)(...args) },
}));

const mockBootstrap = jest.fn();
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: () => mockBootstrap() }));

const mockListLinks = jest.fn();
jest.mock('@/src/data/exercise-group-links', () => ({ listLinks: () => mockListLinks() }));

jest.mock('expo-router', () => ({
  useFocusEffect: (callback: () => void | (() => void)) => {
    mockReact.useEffect(() => callback(), [callback]);
  },
}));

let mockSnapshot: { isConfigured: boolean; user: { id: string } | null } = { isConfigured: false, user: null };
jest.mock('@/src/auth', () => ({
  getAuthSnapshot: () => mockSnapshot,
  subscribeToAuthState: () => () => undefined,
}));

jest.mock('@/src/groups/api', () => ({
  ...jest.requireActual('@/src/groups/api'),
  listMyGroups: jest.fn(),
  listGroupExercises: jest.fn(),
}));

import * as groupsApi from '@/src/groups/api';
import { useGroupExerciseLinking, useGroupLinkingUserId } from '@/src/groups/use-group-exercise-linking';

const api = groupsApi as jest.Mocked<typeof groupsApi>;

afterEach(() => {
  jest.clearAllMocks();
});

describe('useGroupExerciseLinking signed out', () => {
  it('touches nothing: no NetInfo, no database, no links, no group RPC', async () => {
    const { result } = renderHook(() => useGroupExerciseLinking({ userId: null }));
    await act(async () => {});

    expect(result.current).toMatchObject({ catalogs: null, links: [], hydrated: true, offline: false, error: null });

    await act(async () => {
      await result.current.refresh();
      await result.current.reloadLinks();
    });

    expect(mockAddEventListener).not.toHaveBeenCalled();
    expect(mockBootstrap).not.toHaveBeenCalled();
    expect(mockListLinks).not.toHaveBeenCalled();
    expect(api.listMyGroups).not.toHaveBeenCalled();
    expect(api.listGroupExercises).not.toHaveBeenCalled();
  });
});

describe('useGroupLinkingUserId', () => {
  it('is the user id only when auth is configured and a user is signed in', () => {
    mockSnapshot = { isConfigured: false, user: { id: 'u1' } };
    expect(renderHook(() => useGroupLinkingUserId()).result.current).toBeNull();

    mockSnapshot = { isConfigured: true, user: null };
    expect(renderHook(() => useGroupLinkingUserId()).result.current).toBeNull();

    mockSnapshot = { isConfigured: true, user: { id: 'u1' } };
    expect(renderHook(() => useGroupLinkingUserId()).result.current).toBe('u1');
  });
});

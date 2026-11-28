/* eslint-disable import/first */

/**
 * Group Edit's Predictions row (group predictions contract, "Member screens"): shown only to owners and
 * admins under `isDevMode()`; reads the setting and writes it through the set RPC, online only.
 */

import * as mockReact from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

let mockFixture: InMemoryDatabaseFixture;
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: () => Promise.resolve(mockFixture.database) }));

type MockNetInfoListener = (state: { isConnected: boolean | null }) => void;
const mockNetInfoListeners = new Set<MockNetInfoListener>();
jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: (listener: MockNetInfoListener) => { mockNetInfoListeners.add(listener); return () => { mockNetInfoListeners.delete(listener); }; } },
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => ({ groupId: 'group-a' }),
  useFocusEffect: (callback: () => void | (() => void)) => { mockReact.useEffect(() => callback(), [callback]); },
  Stack: { Screen: () => null },
}));
jest.mock('@/src/auth', () => ({ useAuth: () => ({ isConfigured: true, user: { id: 'user-me' } }) }));
let mockDevMode = true;
jest.mock('@/src/utils/isDevMode', () => ({ isDevMode: () => mockDevMode }));
jest.mock('@/src/groups/api', () => ({
  ...jest.requireActual('@/src/groups/api'),
  ...jest.requireActual('./helpers/cow-fixtures').coWReadMocks(),
  getGroup: jest.fn(), listCompetitionExercises: jest.fn(), getPredictionSetting: jest.fn(), setPredictionSetting: jest.fn(),
}));

import * as groupsApi from '@/src/groups/api';
import { GROUP_OFFLINE_ACTION_MESSAGE, GroupApiError, groupCacheKeys, readGroupCache, type GroupGetResult, type GroupRole } from '@/src/groups';
import EditGroupRoute from '../app/group/[groupId]/edit';

const api = groupsApi as jest.Mocked<typeof groupsApi>;
const GROUP = 'group-a';
const detail = (role: GroupRole): GroupGetResult => ({
  group: { group_id: GROUP, name: 'Garage Gym', description: null, member_count: 2, my_role: role, bodyweight_calculations_enabled: false },
  members: [{ user_id: 'user-me', username: 'me', role }],
});
const setting = (enabled: boolean) => ({ group_id: GROUP, enabled });
const emitNetInfo = (isConnected: boolean) => act(() => { for (const listener of mockNetInfoListeners) listener({ isConnected }); });
const row = () => screen.getByTestId('group-edit-predictions');

beforeEach(() => {
  mockFixture = createInMemoryDatabase();
  mockNetInfoListeners.clear();
  mockDevMode = true;
  for (const fn of [api.getGroup, api.listCompetitionExercises, api.getPredictionSetting, api.setPredictionSetting]) fn.mockReset();
  api.getGroup.mockResolvedValue(detail('owner'));
  api.listCompetitionExercises.mockResolvedValue({ contract_version: 4, exercises: [] });
  api.getPredictionSetting.mockResolvedValue(setting(false));
});
afterEach(() => mockFixture.close());

describe('Group Edit: the Predictions row', () => {
  it.each<GroupRole>(['owner', 'admin'])('shows %s the row, off by default, and reads the setting', async role => {
    api.getGroup.mockResolvedValue(detail(role));
    render(<EditGroupRoute />);
    await screen.findByTestId('group-edit-predictions');
    expect(api.getPredictionSetting).toHaveBeenCalledWith(GROUP);
    expect(row()).toHaveProp('accessibilityState', { checked: false });
    expect(screen.getByText('Predictions')).toBeTruthy();
  });

  it('shows the setting as on when it is on', async () => {
    api.getPredictionSetting.mockResolvedValue(setting(true));
    render(<EditGroupRoute />);
    await screen.findByTestId('group-edit-predictions');
    expect(row()).toHaveProp('accessibilityState', { checked: true });
  });

  it('is not rendered outside dev mode, and asks the server nothing', async () => {
    mockDevMode = false;
    render(<EditGroupRoute />);
    await screen.findByTestId('group-form');
    expect(screen.queryByTestId('group-edit-predictions')).toBeNull();
    expect(api.getPredictionSetting).not.toHaveBeenCalled();
  });

  it('is not rendered for a plain member', async () => {
    api.getGroup.mockResolvedValue(detail('member'));
    render(<EditGroupRoute />);
    await screen.findByTestId('group-edit-forbidden');
    expect(screen.queryByTestId('group-edit-predictions')).toBeNull();
    expect(api.getPredictionSetting).not.toHaveBeenCalled();
  });

  it('turns predictions on through the set RPC and reads the setting back', async () => {
    api.setPredictionSetting.mockResolvedValue(setting(true));
    render(<EditGroupRoute />);
    await screen.findByTestId('group-edit-predictions');
    api.getPredictionSetting.mockResolvedValue(setting(true));
    await act(async () => { fireEvent.press(row()); });
    expect(api.setPredictionSetting).toHaveBeenCalledWith(GROUP, true);
    await waitFor(() => expect(row()).toHaveProp('accessibilityState', { checked: true }));
    expect(readGroupCache(mockFixture.database, groupCacheKeys.predictionSetting(GROUP), 'user-me')?.payload).toEqual(setting(true));
  });

  it('turns predictions off again', async () => {
    api.getPredictionSetting.mockResolvedValue(setting(true));
    api.setPredictionSetting.mockResolvedValue(setting(false));
    render(<EditGroupRoute />);
    await screen.findByTestId('group-edit-predictions');
    api.getPredictionSetting.mockResolvedValue(setting(false));
    await act(async () => { fireEvent.press(row()); });
    expect(api.setPredictionSetting).toHaveBeenCalledWith(GROUP, false);
    await waitFor(() => expect(row()).toHaveProp('accessibilityState', { checked: false }));
  });

  it('refuses offline: no write, the row says why and keeps its state', async () => {
    render(<EditGroupRoute />);
    await screen.findByTestId('group-edit-predictions');
    emitNetInfo(false);
    await act(async () => { fireEvent.press(row()); });
    expect(api.setPredictionSetting).not.toHaveBeenCalled();
    expect(screen.getByTestId('group-edit-predictions-error')).toHaveTextContent(GROUP_OFFLINE_ACTION_MESSAGE);
    expect(row()).toHaveProp('accessibilityState', { checked: false });
  });

  it('shows a refused write and re-reads the setting', async () => {
    api.setPredictionSetting.mockRejectedValue(new GroupApiError('FORBIDDEN', 'only owners and admins can change predictions'));
    render(<EditGroupRoute />);
    await screen.findByTestId('group-edit-predictions');
    const reads = api.getPredictionSetting.mock.calls.length;
    await act(async () => { fireEvent.press(row()); });
    expect(screen.getByTestId('group-edit-predictions-error')).toBeTruthy();
    expect(api.getPredictionSetting.mock.calls.length).toBeGreaterThan(reads);
  });

  it('offers a retry while the setting cannot be read, and no row before it loads', async () => {
    api.getPredictionSetting.mockRejectedValueOnce(new GroupApiError('INTERNAL', 'broken')).mockResolvedValue(setting(false));
    render(<EditGroupRoute />);
    expect(await screen.findByTestId('group-edit-predictions-error-state')).toBeTruthy();
    expect(screen.queryByTestId('group-edit-predictions')).toBeNull();
    await act(async () => { fireEvent.press(screen.getByTestId('group-edit-predictions-error-state-retry')); });
    await screen.findByTestId('group-edit-predictions');
  });

  it('says it is offline when the setting has never loaded', async () => {
    api.getPredictionSetting.mockRejectedValue(new GroupApiError('NETWORK', 'down'));
    render(<EditGroupRoute />);
    expect(await screen.findByTestId('group-edit-predictions-offline-empty-state')).toBeTruthy();
  });
});

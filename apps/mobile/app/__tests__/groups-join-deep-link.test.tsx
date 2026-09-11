/* eslint-disable import/first */

/**
 * M22-T05 AC3: the invite link `boga3://group/join?code=…` resolves through
 * the real Expo Router to the Join screen (the static `group/join` route wins
 * over `group/[groupId]`) with the code prefilled from the route params. The
 * device-level link is covered by Maestro in M22-T06.
 */

import { screen } from '@testing-library/react-native';
import { renderRouter } from 'expo-router/testing-library';

import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';

let fixture: InMemoryDatabaseFixture;
const mockCurrentDatabase = () => fixture.database;

jest.mock('@/src/data/bootstrap', () => ({
  bootstrapLocalDataLayer: () => Promise.resolve(mockCurrentDatabase()),
}));

jest.mock('@react-native-community/netinfo', () => ({
  __esModule: true,
  default: { addEventListener: () => () => undefined },
}));

jest.mock('@/src/auth', () => ({ useAuth: () => ({ isConfigured: true, user: { id: 'user-me' } }) }));

jest.mock('@/src/auth/profile', () => ({
  loadUserProfile: jest.fn(async () => ({
    profile: { id: 'user-me', username: 'me', createdAt: '', updatedAt: '' },
    wasProvisioned: false,
  })),
  saveUsername: jest.fn(),
}));

jest.mock('@/src/groups/api', () => ({
  ...jest.requireActual('@/src/groups/api'),
  previewGroupInvite: jest.fn(async () => ({ group_id: 'group-a', name: 'Garage Gym', member_count: 3, already_member: false })),
}));

import * as groupsApi from '@/src/groups/api';

import GroupScreenRoute from '../group/[groupId]/index';
import JoinGroupRoute from '../group/join';

beforeEach(() => {
  fixture = createInMemoryDatabase();
});

afterEach(() => {
  fixture.close();
});

it('opens /group/join?code=ABCD2345 on the Join screen with the code prefilled and previewed', async () => {
  renderRouter(
    { 'group/join': JoinGroupRoute, 'group/[groupId]/index': GroupScreenRoute },
    { initialUrl: '/group/join?code=ABCD2345' },
  );

  expect(await screen.findByTestId('group-join-preview-name')).toHaveTextContent('Garage Gym');
  expect(screen).toHavePathname('/group/join');
  expect(screen).toHaveSearchParams({ code: 'ABCD2345' });
  expect(screen.getByTestId('group-join-code-input').props.value).toBe('ABCD2345');
  expect(groupsApi.previewGroupInvite).toHaveBeenCalledWith('ABCD2345');
});

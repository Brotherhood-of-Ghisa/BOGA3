/* eslint-disable import/first */
import * as mockReact from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';
import { competitionGroupDetail, competitionExercise } from './helpers/competition-fixtures';
import { meetDetailFixture, meetFixture, meetStreamFixture } from './helpers/meet-fixtures';
let mockFixture: InMemoryDatabaseFixture;
let mockParams: Record<string, string> = { groupId: 'g1', meetId: 'm1' };
let mockOnline = true;
const mockListeners = new Set<(v: { isConnected: boolean; isInternetReachable: boolean }) => void>();
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: () => Promise.resolve(mockFixture.database) }));
jest.mock('@/src/auth', () => ({ useAuth: () => ({ isConfigured: true, user: { id: 'u1' } }) }));
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: (listener: (v: { isConnected: boolean; isInternetReachable: boolean }) => void) => {
  mockListeners.add(listener); listener({ isConnected: mockOnline, isInternetReachable: mockOnline }); return () => mockListeners.delete(listener);
} } }));
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams, Stack: { Screen: () => null }, useFocusEffect: (callback: () => void | (() => void)) => mockReact.useEffect(callback, [callback]) }));
jest.mock('expo-location', () => ({ geocodeAsync: jest.fn(), reverseGeocodeAsync: jest.fn(), getForegroundPermissionsAsync: jest.fn() }));
jest.mock('@/src/groups/api', () => ({ ...jest.requireActual('@/src/groups/api'), getGroup: jest.fn(), listMeets: jest.fn(), getMeet: jest.fn(), getCoWCalendar: jest.fn(),
  listCompetitionExercises: jest.fn(), createMeet: jest.fn(), updateMeet: jest.fn(), cancelMeet: jest.fn(), setMeetJoined: jest.fn(), saveMeetChallenge: jest.fn(), removeMeetChallenge: jest.fn() }));
const mockRunSyncCycle = jest.fn();
jest.mock('@/src/sync/cycle', () => ({ runSyncCycle: () => mockRunSyncCycle() }));
jest.mock('@/src/sync/write-nudge', () => ({ notifyLocalWrite: jest.fn() }));
import * as groupApi from '@/src/groups/api';
import { sessionMeetLinks, sessions } from '@/src/data/schema';
import * as Location from 'expo-location';
import { forgetGroupCacheMemory, groupCacheKeys, writeGroupCache } from '@/src/groups/cache';
import MeetRoute from '@/app/group/[groupId]/meets/[meetId]';
import MeetScheduleRoute from '@/app/group/[groupId]/meets/schedule';
import MeetsRoute from '@/app/group/[groupId]/meets';
import { MeetGroupPreview } from '@/components/groups/meet-group-preview';
import { MeetStreamCard } from '@/components/groups/meet-stream-card';
import { DEFAULT_APPEARANCE, type AppearanceChoice } from '@/components/ui/theme-presets';
import { renderWithTheme, rolesFor, switchTheme } from './helpers/theme';
const api = groupApi as jest.Mocked<typeof groupApi>;
const online = (value: boolean) => act(() => { mockOnline = value; mockListeners.forEach(listener => listener({ isConnected: value, isInternetReachable: value })); });
beforeEach(() => {
  mockFixture = createInMemoryDatabase(); forgetGroupCacheMemory(); jest.clearAllMocks(); mockRunSyncCycle.mockReset().mockResolvedValue('converged'); mockListeners.clear(); mockOnline = true; mockParams = { groupId: 'g1', meetId: 'm1' };
  api.getGroup.mockResolvedValue({ ...competitionGroupDetail, group: { ...competitionGroupDetail.group, my_role: 'owner' } }); api.getMeet.mockResolvedValue(meetDetailFixture());
  api.listMeets.mockResolvedValue({ upcoming: [meetFixture()], past: [], next_cursor: null });
  api.getCoWCalendar.mockResolvedValue({ time_zone: 'Europe/London', revision: 1, next_week_start: '2027-01-04' });
  api.listCompetitionExercises.mockResolvedValue({ contract_version: 4, exercises: [competitionExercise] });
  api.setMeetJoined.mockResolvedValue({ meet_id: 'm1', joined: true });
  api.saveMeetChallenge.mockResolvedValue({ challenge: meetDetailFixture().challenges[0] });
  api.updateMeet.mockResolvedValue({ meet: meetFixture({ version: 2 }) });
});
afterEach(() => mockFixture.close());
it('renders the cached browser offline with its navigation and admin schedule action', async () => {
  writeGroupCache(mockFixture.database, { cacheKey: groupCacheKeys.meets('g1'), userId: 'u1', payload: { upcoming: [meetFixture()], past: [], next_cursor: null }, fetchedAtMs: Date.now() });
  writeGroupCache(mockFixture.database, { cacheKey: groupCacheKeys.group('g1'), userId: 'u1', payload: competitionGroupDetail, fetchedAtMs: Date.now() });
  mockOnline = false; renderWithTheme(<MeetsRoute />);
  fireEvent.press(await screen.findByTestId('meet-summary-m1')); expect(mockRouter.push).toHaveBeenCalledWith('/group/g1/meets/m1');
  expect(await screen.findByText(/Offline/)).toBeTruthy(); const count = api.listMeets.mock.calls.length; fireEvent(screen.getByTestId('meets-screen'), 'refresh'); await act(async () => undefined); expect(api.listMeets).toHaveBeenCalledTimes(count);
});
it.each(['owner', 'member'] as const)('shows the meet preview to %s, reserving schedule for admins', async role => {
  renderWithTheme(<MeetGroupPreview groupId="g1" userId="u1" role={role} />); await screen.findByTestId('meet-summary-m1');
  expect(!!screen.queryByTestId('group-meets-schedule')).toBe(role === 'owner');
});
it('joins online and refuses the write when offline', async () => {
  const detail = meetDetailFixture(); detail.viewer.joined = false; api.getMeet.mockResolvedValue(detail);
  renderWithTheme(<MeetRoute />); fireEvent.press(await screen.findByText('Join meet'));
  await waitFor(() => expect(api.setMeetJoined).toHaveBeenCalledWith('g1', 'm1', true));
  online(false); fireEvent.press(screen.getByText('Join meet')); await screen.findByText(/Connect to the internet/);
  expect(api.setMeetJoined).toHaveBeenCalledTimes(1);
});
it('keeps conflicting input, requires status review and rebases only explicitly', async () => {
  api.updateMeet.mockRejectedValueOnce(new groupApi.GroupApiError('CONFLICT', 'changed'));
  renderWithTheme(<MeetScheduleRoute />); const title = await screen.findByTestId('meet-form-title');
  fireEvent.changeText(title, 'My retained title'); fireEvent.press(screen.getByTestId('meet-form-submit'));
  await screen.findByText(/Your input is kept/); expect(screen.getByTestId('meet-form-title').props.value).toBe('My retained title');
  expect(screen.getByTestId('meet-form-submit')).toBeDisabled(); fireEvent.press(screen.getByText('Check status'));
  await screen.findByText('Review your input before saving again.'); expect(screen.getByTestId('meet-form-title').props.value).toBe('My retained title');
  fireEvent.press(screen.getByTestId('meet-form-submit')); await waitFor(() => expect(mockRouter.replace).toHaveBeenCalledWith('/group/g1/meets/m1'));
});
it('saves typed text without coordinates offline/no-match and discards stale geocoding', async () => {
  let resolve!: (value: { latitude: number; longitude: number }[]) => void;
  jest.mocked(Location.geocodeAsync).mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  jest.mocked(Location.reverseGeocodeAsync).mockResolvedValue([]);
  renderWithTheme(<MeetScheduleRoute />); const address = await screen.findByTestId('meet-form-address');
  fireEvent.changeText(address, 'Old address'); fireEvent(address, 'blur'); await waitFor(() => expect(Location.geocodeAsync).toHaveBeenCalled());
  fireEvent.changeText(address, 'New address'); await act(async () => resolve([{ latitude: 51, longitude: 0 }]));
  fireEvent.press(screen.getByTestId('meet-form-submit'));
  await waitFor(() => expect(api.updateMeet).toHaveBeenCalledWith('g1', 'm1', 1, expect.objectContaining({ address: 'New address', latitude: null, longitude: null })));
});
it('keeps challenge choices with DUPLICATE, and locks meet fields after end', async () => {
  const detail = meetDetailFixture(); const end = Date.now() - 1000; detail.meet = meetFixture({ starts_at_ms: end - 10800000, ends_at_ms: end, cutoff_at_ms: end + 86400000, state: 'finalizing' });
  api.getMeet.mockResolvedValue(detail); api.saveMeetChallenge.mockRejectedValueOnce(new groupApi.GroupApiError('DUPLICATE', 'already exists'));
  renderWithTheme(<MeetScheduleRoute />); expect(await screen.findByTestId('meet-form-title')).toBeDisabled();
  expect(screen.queryByTestId('meet-form-submit')).toBeNull(); await waitFor(() => expect(screen.getByTestId('meet-add-challenge')).toBeEnabled()); fireEvent.press(screen.getByTestId('meet-add-challenge'));
  fireEvent.press(await screen.findByText('Pull-up')); fireEvent.press(screen.getByText('Save challenge'));
  await screen.findByText('This exercise and metric already has a challenge.'); expect(screen.getByText('Save challenge')).toBeTruthy();
});
it.each(['scheduled', 'on', 'results', 'cancelled', 'results_refreshed', 'challenge_changed'] as const)('renders %s stream card and exact meet link', event => {
  renderWithTheme(<MeetStreamCard item={meetStreamFixture(event)} groupId="g1" />); fireEvent.press(screen.getByTestId('meet-stream-0001'));
  expect(mockRouter.push).toHaveBeenCalledWith('/group/g1/meets/m1');
});
it('does not evict the group when a meet target disappears', async () => {
  api.getMeet.mockRejectedValueOnce(new groupApi.GroupApiError('NOT_FOUND', 'meet not found'));
  writeGroupCache(mockFixture.database, { cacheKey: groupCacheKeys.group('g1'), userId: 'u1', payload: competitionGroupDetail, fetchedAtMs: Date.now() });
  renderWithTheme(<MeetRoute />); await screen.findByText('Meet unavailable');
  expect(mockFixture.client.prepare('select cache_key from group_cache where cache_key = ?').get(groupCacheKeys.group('g1'))).toMatchObject({ cache_key: groupCacheKeys.group('g1') });
});

it('lists every roster row as going: joined, link-only and former members', async () => {
  const detail = meetDetailFixture();
  detail.roster = [...detail.roster,
    { member: { user_id: 'u2', username: 'Sam' }, joined: false, joined_at_ms: null, linked: true, current_member: true },
    { member: { user_id: 'u3', username: 'Kim' }, joined: true, joined_at_ms: 1700000001000, linked: false, current_member: false }];
  api.getMeet.mockResolvedValue(detail); renderWithTheme(<MeetRoute />);
  expect(await screen.findByTestId('meet-going-u1')).toHaveTextContent('Alex');
  expect(screen.getByTestId('meet-going-u2')).toHaveTextContent('Sam');
  expect(screen.getByTestId('meet-going-u3')).toHaveTextContent('Kim · Former member');
  expect(screen.queryByText('No one yet')).toBeNull();
});
it('confirms Leave and refuses its online RPC when offline', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    renderWithTheme(<MeetRoute />); fireEvent.press(await screen.findByText('Leave meet'));
    expect(api.setMeetJoined).not.toHaveBeenCalled();
    const confirm = () => alert.mock.calls.at(-1)![2]!.find(button => button.text === 'Leave meet')!.onPress!();
    await act(async () => confirm()); expect(api.setMeetJoined).toHaveBeenCalledWith('g1', 'm1', false);
    online(false); fireEvent.press(screen.getByText('Leave meet')); await act(async () => confirm());
    await screen.findByText(/Connect to the internet/); expect(api.setMeetJoined).toHaveBeenCalledTimes(1);
  } finally { alert.mockRestore(); }
});
describe('Leave also detaches this member\'s sessions', () => {
  const seedLinks = () => {
    const db = mockFixture.database; const at = new Date();
    for (const id of ['s1', 's2']) db.insert(sessions).values({ id, status: 'completed', startedAt: new Date(1800000000000), completedAt: new Date(1800003600000) }).run();
    for (const [id, sessionId, meetId] of [['m1:s1', 's1', 'm1'], ['m1:s2', 's2', 'm1'], ['other:s1', 's1', 'other']])
      db.insert(sessionMeetLinks).values({ id, sessionId, meetId, createdAt: at, updatedAt: at }).run();
  };
  const liveIds = () => mockFixture.database.select().from(sessionMeetLinks).all().filter(l => l.deletedAt === null).map(l => l.id);
  const leave = async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
    try {
      jest.spyOn(Date, 'now').mockReturnValue(1799999000000);
      renderWithTheme(<MeetRoute />); fireEvent.press(await screen.findByText('Leave meet'));
      expect(alert.mock.calls.at(-1)![1]).toBe('Your sessions will be removed from this meet.');
      expect(liveIds()).toHaveLength(3);
      await act(async () => alert.mock.calls.at(-1)![2]!.find(button => button.text === 'Leave meet')!.onPress!());
    } finally { alert.mockRestore(); }
  };
  afterEach(() => jest.restoreAllMocks());
  it('tombstones the links this device holds for that meet after the online leave, and no other meet\'s', async () => {
    seedLinks(); await leave();
    await waitFor(() => expect(liveIds()).toEqual(['other:s1']));
    expect(api.setMeetJoined).toHaveBeenCalledWith('g1', 'm1', false); expect(mockRunSyncCycle).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId('meet-leave-note')).toBeNull();
  });
  it('still detaches what is here when the pull fails, and says other devices\' sessions may still count', async () => {
    seedLinks(); mockRunSyncCycle.mockRejectedValue(new Error('offline')); await leave();
    await waitFor(() => expect(liveIds()).toEqual(['other:s1']));
    expect(await screen.findByTestId('meet-leave-note')).toHaveTextContent(/another device may still count/);
  });
  it('leaves the links alone when the online leave is refused', async () => {
    seedLinks(); api.setMeetJoined.mockRejectedValue(new groupApi.GroupApiError('CONFLICT', 'changed')); await leave();
    await screen.findByText(/This meet changed/); expect(liveIds()).toHaveLength(3); expect(mockRunSyncCycle).not.toHaveBeenCalled();
  });
});
it('retires each saved staged challenge after partial failure and reconciles uncertain rows before retry', async () => {
  mockParams = { groupId: 'g1' };
  api.listCompetitionExercises.mockResolvedValue({ contract_version: 4, exercises: [competitionExercise, { ...competitionExercise, group_exercise_id: 'ge2', name: 'Bench' }] });
  const persisted = meetDetailFixture(); persisted.challenges = [];
  api.createMeet.mockImplementation(async (_groupId, id, fields) => { persisted.meet = { ...meetFixture(), ...fields, cutoff_at_ms: fields.ends_at_ms + 86400_000, meet_id: id }; return { meet: persisted.meet }; });
  api.getMeet.mockImplementation(async () => persisted);
  let requests = 0;
  api.saveMeetChallenge.mockImplementation(async input => {
    const saved = { ...meetDetailFixture().challenges[0], challenge_id: input.challengeId, meet_id: input.meetId,
      group_exercise_id: input.exerciseId, exercise_name: input.exerciseId === 'ge2' ? 'Bench' : 'Pull-up', metric: input.metric };
    persisted.challenges = [...persisted.challenges, saved]; requests++;
    if (requests === 2) throw new groupApi.GroupApiError('NETWORK', 'Lost reply');
    return { challenge: saved };
  });
  renderWithTheme(<MeetScheduleRoute />); fireEvent.changeText(await screen.findByTestId('meet-form-venue'), 'My gym');
  for (const name of ['Pull-up', 'Bench']) {
    await waitFor(() => expect(screen.getByText('Add challenge')).toBeEnabled()); fireEvent.press(screen.getByText('Add challenge'));
    fireEvent.press(await screen.findByText(name)); fireEvent.press(screen.getByText('Save challenge'));
    await waitFor(() => expect(screen.queryByText('Save challenge')).toBeNull());
  }
  fireEvent.press(screen.getByTestId('meet-form-submit'));
  await screen.findByText(/Couldn't confirm the change/);
  // First confirmed row is now persisted; unresolved local intent is locked.
  expect(screen.getByTestId('meet-form-submit')).toBeDisabled();
  fireEvent.press(screen.getByText('Check status'));
  await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
  expect(api.createMeet).toHaveBeenCalledTimes(1); expect(api.saveMeetChallenge).toHaveBeenCalledTimes(2);
  expect(persisted.challenges.map(c => c.exercise_name)).toEqual(['Pull-up', 'Bench']);
});

it('removes confirmed and unsaved challenges through their respective server and draft actions after a partial save', async () => {
  mockParams = { groupId: 'g1' };
  api.listCompetitionExercises.mockResolvedValue({ contract_version: 4, exercises: [competitionExercise, { ...competitionExercise, group_exercise_id: 'ge2', name: 'Bench' }] });
  const persisted = meetDetailFixture(); persisted.challenges = [];
  api.createMeet.mockImplementation(async (_groupId, id, fields) => { persisted.meet = { ...meetFixture(), ...fields, cutoff_at_ms: fields.ends_at_ms + 86400_000, meet_id: id }; return { meet: persisted.meet }; });
  api.updateMeet.mockImplementation(async (_groupId, _id, _version, fields) => ({ meet: { ...persisted.meet, ...fields } }));
  api.getMeet.mockImplementation(async () => ({ ...persisted, challenges: [...persisted.challenges] }));
  api.saveMeetChallenge.mockImplementation(async input => {
    if (input.exerciseId === 'ge2') throw new groupApi.GroupApiError('VALIDATION', 'archived meanwhile');
    const saved = { ...meetDetailFixture().challenges[0], challenge_id: input.challengeId, meet_id: input.meetId };
    persisted.challenges.push(saved); return { challenge: saved };
  });
  api.removeMeetChallenge.mockImplementation(async (_groupId, _meetId, id) => { persisted.challenges = persisted.challenges.filter(c => c.challenge_id !== id); return { challenge_id: id, removed: true }; });
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  try {
    renderWithTheme(<MeetScheduleRoute />); fireEvent.changeText(await screen.findByTestId('meet-form-venue'), 'My gym');
    for (const name of ['Pull-up', 'Bench']) {
      await waitFor(() => expect(screen.getByText('Add challenge')).toBeEnabled()); fireEvent.press(screen.getByText('Add challenge'));
      fireEvent.press(await screen.findByText(name)); fireEvent.press(screen.getByText('Save challenge'));
      await waitFor(() => expect(screen.queryByText('Save challenge')).toBeNull());
    }
    fireEvent.press(screen.getByTestId('meet-form-submit')); await screen.findByText('Check the fields and try again.');
    const savedId = persisted.challenges[0].challenge_id;
    const savedRow = await screen.findByTestId(`meet-challenge-${savedId}`);
    expect(screen.queryByTestId(`meet-staged-${savedId}`)).toBeNull();
    const draftRow = screen.getAllByTestId(/^meet-staged-/)[0]; fireEvent.press(within(draftRow).getByText('Remove challenge'));
    expect(api.removeMeetChallenge).not.toHaveBeenCalled();
    fireEvent.press(within(savedRow).getByText('Remove challenge'));
    await act(async () => { alert.mock.calls.at(-1)![2]!.find(b => b.text === 'Remove')!.onPress!(); });
    await waitFor(() => expect(screen.queryByTestId(`meet-challenge-${savedId}`)).toBeNull());
    fireEvent.press(screen.getByTestId('meet-form-submit')); await waitFor(() => expect(mockRouter.replace).toHaveBeenCalled());
    expect(persisted.challenges).toEqual([]); expect(api.createMeet).toHaveBeenCalledTimes(1);
  } finally { alert.mockRestore(); }
});

it('repaints page headings and empty-state copy with page inks on Ink + paper', async () => {
  api.listMeets.mockResolvedValue({ upcoming: [], past: [], next_cursor: null });
  renderWithTheme(<MeetsRoute />); await screen.findByText('Nothing scheduled');
  const appearance: AppearanceChoice = { theme: 'ink-paper', mode: 'light', custom: null };
  try {
    await switchTheme(appearance); const roles = rolesFor(appearance);
    expect(screen.getByText('Next meets')).toHaveStyle({ color: roles.pageInkMuted });
    expect(screen.getByText('Past meets')).toHaveStyle({ color: roles.pageInkMuted });
    expect(screen.getByText('Nothing scheduled')).toHaveStyle({ color: roles.pageInk });
    expect(screen.getByText('No past meets')).toHaveStyle({ color: roles.pageInk });
  } finally { await switchTheme(DEFAULT_APPEARANCE); }
});

it('keeps the schedule time zone readable on the contrasting page ground', async () => {
  renderWithTheme(<MeetScheduleRoute />); await screen.findByTestId('meet-form-title');
  const appearance: AppearanceChoice = { theme: 'ink-paper', mode: 'light', custom: null };
  try { await switchTheme(appearance); expect(screen.getByText('Europe/London')).toHaveStyle({ color: rolesFor(appearance).pageInkMuted }); }
  finally { await switchTheme(DEFAULT_APPEARANCE); }
});

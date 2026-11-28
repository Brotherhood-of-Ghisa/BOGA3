/* eslint-disable import/first */
import * as mockReact from 'react';
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react-native';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';
import { competitionGroupDetail } from './helpers/competition-fixtures';
import { leaderboardFixture, meetDetailFixture, meetFixture, meetResultsFixture, trophiesFixture } from './helpers/meet-fixtures';
let mockFixture: InMemoryDatabaseFixture;
let mockOnline = true;
const mockListeners = new Set<(v: { isConnected: boolean; isInternetReachable: boolean }) => void>();
const mockRouter = { push: jest.fn(), replace: jest.fn(), back: jest.fn() };
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: () => Promise.resolve(mockFixture.database) }));
jest.mock('@/src/auth', () => ({ useAuth: () => ({ isConfigured: true, user: { id: 'u1' } }) }));
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: (listener: (v: { isConnected: boolean; isInternetReachable: boolean }) => void) => {
  mockListeners.add(listener); listener({ isConnected: mockOnline, isInternetReachable: mockOnline }); return () => mockListeners.delete(listener);
} } }));
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => ({ groupId: 'g1', meetId: 'm1' }), Stack: { Screen: ({ options }: { options?: { headerRight?: () => unknown } }) => options?.headerRight?.() ?? null },
  useFocusEffect: (callback: () => void | (() => void)) => mockReact.useEffect(callback, [callback]) }));
jest.mock('expo-location', () => ({ geocodeAsync: jest.fn(), reverseGeocodeAsync: jest.fn(), getForegroundPermissionsAsync: jest.fn() }));
jest.mock('@/src/groups/api', () => ({ ...jest.requireActual('@/src/groups/api'), getGroup: jest.fn(), listMeets: jest.fn(), getMeet: jest.fn(),
  listCompetitionExercises: jest.fn(), getMeetResults: jest.fn(), refreshMeetResults: jest.fn(), getMeetLeaderboard: jest.fn(), listMeetTrophies: jest.fn() }));
import * as groupApi from '@/src/groups/api';
import { forgetGroupCacheMemory, groupCacheKeys, writeGroupCache } from '@/src/groups/cache';
import MeetRoute from '@/app/group/[groupId]/meets/[meetId]';
import MeetsRoute from '@/app/group/[groupId]/meets';
import { TodayMeetCard } from '@/components/today/group-meet-card';
import { renderWithTheme } from './helpers/theme';
const api = groupApi as jest.Mocked<typeof groupApi>;
const online = (value: boolean) => act(() => { mockOnline = value; mockListeners.forEach(listener => listener({ isConnected: value, isInternetReachable: value })); });
const OWNER = { ...competitionGroupDetail, group: { ...competitionGroupDetail.group, my_role: 'owner' as const } };
const ended = () => { const end = Date.now() - 3600_000; return meetFixture({ starts_at_ms: end - 10800_000, ends_at_ms: end, cutoff_at_ms: end + 86400_000, state: 'finalizing' }); };
const detailFor = (meet = meetFixture(), role: 'owner' | 'member' = 'owner') => ({ ...meetDetailFixture(), meet, viewer: { role, joined: true } });
beforeEach(() => {
  mockFixture = createInMemoryDatabase(); forgetGroupCacheMemory(); jest.clearAllMocks(); mockListeners.clear(); mockOnline = true;
  api.getGroup.mockResolvedValue(OWNER); api.getMeet.mockResolvedValue(detailFor()); api.listMeets.mockResolvedValue({ upcoming: [meetFixture()], past: [], next_cursor: null });
  api.getMeetResults.mockResolvedValue(meetResultsFixture()); api.getMeetLeaderboard.mockResolvedValue(leaderboardFixture());
  api.listMeetTrophies.mockResolvedValue(trophiesFixture());
});
afterEach(() => mockFixture.close());

describe('meet page results', () => {
  it('shows each challenge podium and full standings with the certified mark and who added it', async () => {
    renderWithTheme(<MeetRoute />);
    const podium = await screen.findByTestId('meet-standings-c1-podium');
    expect(within(podium).getAllByTestId(/^group-board-row-\d+$/)).toHaveLength(3);
    expect(within(podium).getByTestId('group-board-row-1-mark')).toBeTruthy();
    expect(within(podium).getAllByTestId('group-board-row-2-member').map(n => n.props.children)).toEqual(['Blake', 'Casey']);
    expect(within(screen.getByTestId('meet-standings-c1-rest')).getByText('Dana (former)')).toBeTruthy();
    expect(screen.getByText('Added by Alex')).toBeTruthy();
  });
  it.each([['live', /^Live$/], ['so_far', /^Standings so far · final at/], ['final', /^Final$/], ['refreshed', /^Results refreshed/]] as const)('captions the %s state from the server', async (state, caption) => {
    api.getMeetResults.mockResolvedValue(meetResultsFixture({ state, refreshed_at_ms: state === 'refreshed' ? Date.now() : null }));
    renderWithTheme(<MeetRoute />); await screen.findByTestId('meet-standings-c1');
    expect(screen.getByTestId('meet-caption').props.children).toMatch(caption);
  });
  it('lists the counting sessions with their links and the records set at the meet', async () => {
    renderWithTheme(<MeetRoute />); fireEvent.press(await screen.findByTestId('meet-session-x-u2'));
    expect(mockRouter.push).toHaveBeenCalledWith('/group-session/u2/x-u2?groupId=g1');
    expect(screen.getByTestId('meet-records')).toHaveTextContent(/Squat\s+·\s+You/); expect(screen.getByTestId('meet-records')).toHaveTextContent(/1RM\s+142\.5/);
  });
  it('says so when nothing counted, and shows no extras for a cancelled meet', async () => {
    api.getMeetResults.mockResolvedValue({ ...meetResultsFixture(), sessions: [], records: [], challenges: [{ ...meetResultsFixture().challenges[0], standings: [] }] });
    renderWithTheme(<MeetRoute />); await screen.findByTestId('meet-sessions-empty'); expect(screen.getByTestId('meet-records-empty')).toBeTruthy();
    expect(screen.getByTestId('meet-standings-c1-empty')).toHaveTextContent('No qualifying sets yet');
  });
  it.each([['scheduled', 'Standings appear once the meet starts'], ['cancelled', 'This meet was cancelled']] as const)('explains empty %s standings', async (state, copy) => {
    api.getMeetResults.mockResolvedValue({ ...meetResultsFixture({ state }), challenges: [{ ...meetResultsFixture().challenges[0], standings: [] }] });
    renderWithTheme(<MeetRoute />); expect(await screen.findByText(copy)).toBeTruthy(); expect(screen.queryByTestId('meet-sessions')).toBe(state === 'cancelled' ? null : screen.queryByTestId('meet-sessions'));
    if (state === 'cancelled') expect(screen.queryByTestId('meet-records')).toBeNull();
  });
  it('never draws standings from the cache: offline it says they need a connection', async () => {
    api.getMeetResults.mockRejectedValue(new groupApi.GroupApiError('NETWORK', 'offline'));
    writeGroupCache(mockFixture.database, { cacheKey: groupCacheKeys.meet('g1', 'm1'), userId: 'u1', payload: detailFor(), fetchedAtMs: Date.now() });
    mockOnline = false; renderWithTheme(<MeetRoute />);
    expect(await screen.findByTestId('meet-results-offline')).toBeTruthy(); expect(screen.queryByTestId('meet-standings-c1')).toBeNull();
  });
  it('shows a retry when the results read fails', async () => {
    api.getMeetResults.mockRejectedValueOnce(new groupApi.GroupApiError('INTERNAL', 'boom'));
    renderWithTheme(<MeetRoute />); fireEvent.press(await within(await screen.findByTestId('meet-results-error')).findByText(/Try again|Retry/));
    await screen.findByTestId('meet-standings-c1');
  });
});

describe('Refresh results', () => {
  const options = async () => { renderWithTheme(<MeetRoute />); await screen.findByTestId('meet-caption'); };
  it.each([['owner', true], ['member', false]] as const)('is offered to a %s only after the end: %s', async (role, shown) => {
    const meet = ended(); api.getMeet.mockResolvedValue(detailFor(meet, role)); api.getMeetResults.mockResolvedValue(meetResultsFixture({ state: 'so_far' }, meet));
    await options(); expect(screen.queryByTestId('meet-refresh-results')).toBeNull();
  });
  it('refreshes through the admin overflow and rereads the results', async () => {
    const meet = ended(); api.getMeet.mockResolvedValue(detailFor(meet)); api.getMeetResults.mockResolvedValue(meetResultsFixture({ state: 'final' }, meet));
    api.refreshMeetResults.mockResolvedValue(meetResultsFixture({ state: 'refreshed', refreshed_at_ms: Date.now() }, meet));
    await options(); api.getMeetResults.mockResolvedValue(meetResultsFixture({ state: 'refreshed', refreshed_at_ms: Date.now() }, meet));
    const calls = api.getMeetResults.mock.calls.length;
    fireEvent.press(screen.getByLabelText('Meet options')); fireEvent.press(await screen.findByTestId('meet-refresh-results'));
    await waitFor(() => expect(api.refreshMeetResults).toHaveBeenCalledWith('g1', 'm1'));
    await waitFor(() => expect(api.getMeetResults.mock.calls.length).toBeGreaterThan(calls));
    await waitFor(() => expect(screen.getByTestId('meet-caption').props.children).toMatch(/^Results refreshed/));
  });
  it('is hidden before the end and refused offline without calling the server', async () => {
    await options(); fireEvent.press(screen.getByLabelText('Meet options')); expect(screen.queryByTestId('meet-refresh-results')).toBeNull();
  });
  it('refuses offline and words a server conflict', async () => {
    const meet = ended(); api.getMeet.mockResolvedValue(detailFor(meet)); api.getMeetResults.mockResolvedValue(meetResultsFixture({ state: 'so_far' }, meet));
    api.refreshMeetResults.mockRejectedValueOnce(new groupApi.GroupApiError('CONFLICT', 'still being calculated'));
    await options(); fireEvent.press(screen.getByLabelText('Meet options')); fireEvent.press(await screen.findByTestId('meet-refresh-results'));
    await screen.findByText('Results are not ready to refresh yet. Try again shortly.');
    online(false); fireEvent.press(screen.getByLabelText('Meet options')); fireEvent.press(await screen.findByTestId('meet-refresh-results'));
    await screen.findByText(/Connect to the internet/); expect(api.refreshMeetResults).toHaveBeenCalledTimes(1);
  });
});

describe('Meets leaderboard', () => {
  it('pins ranked trophy counts on the Meets page with a former member marked and shared ranks', async () => {
    renderWithTheme(<MeetsRoute />); const board = await screen.findByTestId('meet-leaderboard');
    expect(within(board).getByTestId('meet-leaderboard-row-u1')).toBeTruthy(); expect(within(board).getByText('Meets leaderboard')).toBeTruthy();
    fireEvent.press(within(board).getByTestId('meet-leaderboard-toggle'));
    expect(within(screen.getByTestId('meet-leaderboard')).getByLabelText('4th, Dana, Former, Gold 0, Silver 0, Bronze 2')).toBeTruthy();
    for (const name of ['Blake', 'Casey']) expect(screen.getByLabelText(`2nd, ${name}, Gold 1, Silver 1, Bronze 0`)).toBeTruthy();
  });
  it('shows an empty board', async () => {
    api.getMeetLeaderboard.mockResolvedValue({ rows: [] }); renderWithTheme(<MeetsRoute />);
    expect(await screen.findByText('No trophies yet')).toBeTruthy();
  });
  it('draws from the cache offline', async () => {
    writeGroupCache(mockFixture.database, { cacheKey: groupCacheKeys.meetLeaderboard('g1'), userId: 'u1', payload: leaderboardFixture(), fetchedAtMs: Date.now() });
    writeGroupCache(mockFixture.database, { cacheKey: groupCacheKeys.meets('g1'), userId: 'u1', payload: { upcoming: [], past: [], next_cursor: null }, fetchedAtMs: Date.now() });
    mockOnline = false; renderWithTheme(<MeetsRoute />); expect(await screen.findByTestId('meet-leaderboard-row-u1')).toBeTruthy();
  });
  it('offers a retry when it never loaded and the read failed', async () => {
    api.getMeetLeaderboard.mockRejectedValue(new groupApi.GroupApiError('INTERNAL', 'boom')); renderWithTheme(<MeetsRoute />);
    await screen.findByTestId('meet-leaderboard-error-state');
  });
  it('opens a member\'s trophies with a link to each meet, and pages more', async () => {
    api.listMeetTrophies.mockResolvedValueOnce(trophiesFixture('next')).mockResolvedValueOnce({ trophies: [{ ...trophiesFixture().trophies[0], challenge_id: 'c9', meet_id: 'm9', place: 3 }], next_cursor: null });
    renderWithTheme(<MeetsRoute />); fireEvent.press(await screen.findByTestId('meet-leaderboard-row-u1'));
    await screen.findByTestId('meet-trophy-c1'); expect(api.listMeetTrophies).toHaveBeenCalledWith('g1', 'u1', null);
    fireEvent.press(screen.getByTestId('meet-trophies-more')); await screen.findByTestId('meet-trophy-c9');
    expect(api.listMeetTrophies).toHaveBeenLastCalledWith('g1', 'u1', 'next');
    fireEvent.press(screen.getByTestId('meet-trophy-c9')); expect(mockRouter.push).toHaveBeenCalledWith('/group/g1/meets/m9');
  });
  it('says when a member has no trophies', async () => {
    api.listMeetTrophies.mockResolvedValue({ trophies: [], next_cursor: null });
    renderWithTheme(<MeetsRoute />); fireEvent.press(await screen.findByTestId('meet-leaderboard-row-u1')); await screen.findByTestId('meet-trophies-empty');
  });
});

describe('Today meet card', () => {
  const at = Date.now(); const week = 7 * 24 * 3600_000;
  const meetAt = (id: string, starts: number, patch = {}) => meetFixture({ meet_id: id, starts_at_ms: starts, ends_at_ms: starts + 3 * 3600_000, cutoff_at_ms: starts + 27 * 3600_000, ...patch });
  const show = async (upcoming: ReturnType<typeof meetAt>[], past: ReturnType<typeof meetAt>[] = []) => {
    api.listMeets.mockResolvedValue({ upcoming, past, next_cursor: null }); renderWithTheme(<TodayMeetCard groupId="g1" userId="u1" />);
    await waitFor(() => expect(api.listMeets).toHaveBeenCalled()); await act(async () => undefined);
  };
  it('shows an upcoming meet inside the window and opens it', async () => {
    await show([meetAt('up', at + week - 60_000)]); fireEvent.press(await screen.findByTestId('meet-summary-up'));
    expect(mockRouter.push).toHaveBeenCalledWith('/group/g1/meets/up'); expect(screen.getByText('Scheduled')).toBeTruthy();
  });
  it.each([['more than 7 days before', at + week + 120_000, 'upcoming'], ['more than 7 days after', at - week - 3 * 3600_000 - 120_000, 'past']] as const)('hides a meet %s', async (_name, starts, list) => {
    await show(list === 'upcoming' ? [meetAt('x', starts)] : [], list === 'past' ? [meetAt('x', starts)] : []);
    expect(screen.queryByTestId('today-meet-card')).toBeNull();
  });
  it('shows a past meet still inside 7 days after its end, with its state', async () => {
    await show([], [meetAt('done', at - 3 * 24 * 3600_000)]); expect(await screen.findByText('Final')).toBeTruthy();
  });
  it('shows standings so far while finalizing', async () => {
    await show([], [meetAt('fin', at - 4 * 3600_000)]); expect(await screen.findByText(/^Standings so far · final at/)).toBeTruthy();
  });
  it('hides a cancelled meet', async () => { await show([meetAt('c', at + 3600_000, { cancelled_at_ms: 1, state: 'cancelled' })]); expect(screen.queryByTestId('today-meet-card')).toBeNull(); });
  it('shows the live meet over a nearer upcoming one', async () => {
    await show([meetAt('soon', at + 600_000), meetAt('live', at - 3600_000)]); expect(await screen.findByText('Live')).toBeTruthy(); expect(screen.queryByTestId('meet-summary-soon')).toBeNull();
  });
  it('takes no space when the read fails or nothing is scheduled', async () => {
    api.listMeets.mockRejectedValue(new groupApi.GroupApiError('INTERNAL', 'boom')); renderWithTheme(<TodayMeetCard groupId="g1" userId="u1" />);
    await act(async () => undefined); expect(screen.queryByTestId('today-meet-card')).toBeNull();
  });
});

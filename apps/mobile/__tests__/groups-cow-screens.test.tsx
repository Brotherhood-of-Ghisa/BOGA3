/* eslint-disable import/first */
import * as mockReact from 'react';
import { AccessibilityInfo, Alert, Modal } from 'react-native';
import * as Native from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { createInMemoryDatabase, type InMemoryDatabaseFixture } from './helpers/in-memory-db';
import { cowResult, cowSummary } from './helpers/cow-fixtures';
import { competitionExercise, competitionGroupDetail } from './helpers/competition-fixtures';

let mockFixture: InMemoryDatabaseFixture;
let mockParams: Record<string, string> = {};
let mockFocused = true;
let mockOnline = true;
const mockListeners = new Set<(value: { isConnected: boolean; isInternetReachable: boolean }) => void>();
const mockRouter = { push: jest.fn(), back: jest.fn(), replace: jest.fn(), setParams: jest.fn() };
const mockUseAuth = jest.fn();
jest.mock('@/src/data/bootstrap', () => ({ bootstrapLocalDataLayer: () => Promise.resolve(mockFixture.database) }));
jest.mock('@/src/auth', () => ({ useAuth: () => mockUseAuth() }));
jest.mock('@react-native-community/netinfo', () => ({ __esModule: true, default: { addEventListener: (listener: (value: unknown) => void) => {
  mockListeners.add(listener); listener({ isConnected: mockOnline, isInternetReachable: mockOnline }); return () => mockListeners.delete(listener);
} } }));
jest.mock('expo-router', () => ({ useRouter: () => mockRouter, useLocalSearchParams: () => mockParams, Stack: { Screen: () => null },
  useFocusEffect: (callback: () => void | (() => void)) => { mockReact.useEffect(() => mockFocused ? callback() : undefined, [callback, mockFocused]); } }));
jest.mock('@/src/groups/api', () => ({ ...jest.requireActual('@/src/groups/api'), getGroup: jest.fn(), listCompetitionExercises: jest.fn(),
  getCoWSummary: jest.fn(), getCoWCalendar: jest.fn(), listCoWs: jest.fn(), getCoW: jest.fn(), getCoWResults: jest.fn(),
  createCoW: jest.fn(), updateCoW: jest.fn(), cancelCoW: jest.fn(), setCoWCalendar: jest.fn() }));
jest.mock('@/components/groups/cow-time-zone', () =>
  jest.requireActual('./helpers/react-compiler').requireWithReactCompiler('components/groups/cow-time-zone.tsx'));
import * as groupApi from '@/src/groups/api';
import { GroupApiError } from '@/src/groups/api';
import type { CoWDefinitionWire, CoWResultWire } from '@/src/groups/cow-wire';
import { createCoWId } from '@/src/groups/cow-draft';
import { ChoiceRow } from '@/components/ui';
import { CoWPreview } from '@/components/groups/cow-preview';
import { CoWGroupPreview } from '@/components/groups/cow-group-preview';
import CoWsRoute from '@/app/group/[groupId]/cows';
import CoWStandingsRoute from '@/app/group/[groupId]/cows/[cowId]';
import CoWScheduleRoute from '@/app/group/[groupId]/cows/schedule';
import GroupRoute from '@/app/group/[groupId]';
import EditGroupRoute from '@/app/group/[groupId]/edit';
import { waitForGone } from './helpers/wait-for-gone';

const api = groupApi as jest.Mocked<typeof groupApi>;
const NOW = new Date(2026, 9, 30, 12);
const current = (): CoWResultWire => {
  const result = cowResult();
  result.rankings[0].entry_count = 3;
  result.rankings[0].entries = [
    { rank: 1, member: { user_id: 'u2', username: 'Alex' }, former: false, state: 'ranked', value: 150 },
    { rank: 2, member: { user_id: 'u1', username: 'Me' }, former: false, state: 'ranked', value: 140 },
    { rank: 3, member: { user_id: 'u3', username: 'Jules' }, former: true, state: 'ranked', value: 130 },
  ];
  result.rankings[1] = { ...result.rankings[1], entry_count: 1, entries: [{ rank: 1, member: { user_id: 'u3', username: 'Jules' }, former: false, state: 'ranked', value: 1800 }] };
  result.rankings[2] = { ...result.rankings[2], entry_count: 1, entries: [{ rank: 1, member: { user_id: 'u2', username: 'Alex' }, former: false, state: 'ranked', value: -5 }] };
  return result;
};
const scheduled = (): CoWDefinitionWire => ({ ...current().cow, cow_id: 'next', state: 'scheduled', week_start: '2026-11-02',
  starts_at_us: current().cow.ends_at_us, ends_at_us: current().cow.ends_at_us + 7 * 86400 * 1000000, metrics: ['e1rm', 'volume'] });
const past = (): CoWDefinitionWire => ({ ...current().cow, cow_id: 'past', state: 'final', week_start: '2026-10-19',
  starts_at_us: current().cow.starts_at_us - 7 * 86400 * 1000000, ends_at_us: current().cow.starts_at_us });
const summary = () => ({ ...cowSummary(), observed_at_us: Date.now() * 1000, result: current() });
const calendar = () => ({ time_zone: 'UTC', revision: 1, next_week_start: '2026-11-02' });
const bench = { ...competitionExercise, group_exercise_id: 'ge2', name: 'Bench press' };
const archived = { ...competitionExercise, group_exercise_id: 'old', name: 'Archived squat', archived_at_ms: 1 };
const emitNetwork = (online: boolean) => act(() => { mockOnline = online; mockListeners.forEach(listener => listener({ isConnected: online, isInternetReachable: online })); });

beforeEach(() => {
  mockFixture = createInMemoryDatabase(); jest.clearAllMocks(); mockListeners.clear(); mockOnline = true; mockFocused = true; mockParams = { groupId: 'g1' };
  jest.useFakeTimers({ doNotFake: ['setTimeout','clearTimeout','setInterval','clearInterval','setImmediate','clearImmediate','nextTick','performance','queueMicrotask','hrtime'] }).setSystemTime(NOW);
  for (const value of Object.values(api)) if (jest.isMockFunction(value)) value.mockReset();
  mockUseAuth.mockReturnValue({ isConfigured: true, user: { id: 'u1' } });
  api.getGroup.mockImplementation(async groupId => ({ ...competitionGroupDetail, group: { ...competitionGroupDetail.group, group_id: groupId, my_role: 'owner' } }));
  api.listCompetitionExercises.mockResolvedValue({ contract_version: 4, exercises: [competitionExercise, bench, archived] });
  api.getCoWSummary.mockResolvedValue(summary()); api.getCoWCalendar.mockResolvedValue(calendar());
  api.listCoWs.mockResolvedValue({ cows: [current().cow, past()], next_cursor: null });
  api.getCoW.mockImplementation(async (_groupId, id) => {
    if (id === 'cow1') return { cow: current().cow };
    if (id === 'next') return { cow: scheduled() };
    throw new GroupApiError('NOT_FOUND', 'CoW not found');
  });
  api.getCoWResults.mockImplementation(async (_groupId, _cow, metric) => ({ ...current(), rankings: current().rankings.filter(row => row.metric === metric) }));
  api.createCoW.mockImplementation(async (_groupId, input) => ({ cow: { ...scheduled(), cow_id: input.cowId, group_exercise_id: input.groupExerciseId, metrics: input.metrics } }));
  api.updateCoW.mockImplementation(async (_groupId, cowId, input) => ({ cow: { ...scheduled(), cow_id: cowId, revision: input.revision + 1, group_exercise_id: input.groupExerciseId, metrics: input.metrics } }));
  api.cancelCoW.mockResolvedValue({ cow: { ...scheduled(), state: 'cancelled', revision: 2 } });
  api.setCoWCalendar.mockResolvedValue({ ...calendar(), revision: 2 });
});
afterEach(() => { mockFixture.close(); jest.useRealTimers(); });

async function chooseBench() {
  fireEvent.press(await screen.findByTestId('cow-form-exercise'));
  fireEvent.changeText(await screen.findByTestId('cow-exercise-search'), 'bench');
  expect(screen.queryByTestId('cow-picker-old')).toBeNull();
  fireEvent.press(await screen.findByTestId('cow-picker-ge2'));
}
async function prepareCreate() {
  render(<CoWScheduleRoute />); await chooseBench();
  fireEvent.press(screen.getByTestId('cow-form-metric-e1rm'));
  fireEvent.press(screen.getByTestId('cow-form-metric-volume'));
  await waitFor(() => expect(screen.getByTestId('cow-form-submit')).toBeEnabled());
}

it('uses existing units, independent top-three metrics and exact identity on navigation', () => {
  const onOpen = jest.fn(); const onBrowse = jest.fn();
  render(<CoWPreview result={current()} userId="u1" dateFormat="DD-MM-YYYY" onOpen={onOpen} onBrowse={onBrowse} testID="preview" />);
  expect(screen.getByTestId('preview-open').props.accessibilityLabel).toContain('26-10-2026');
  expect(screen.getByTestId('preview-open').props.accessibilityLabel).toContain('Live');
  expect(screen.getByText('1RM %BW')).toBeTruthy(); expect(screen.getByText('You')).toBeTruthy(); expect(screen.getByText('Jules (former)')).toBeTruthy();
  fireEvent.press(screen.getByTestId('preview-metric-volume')); expect(screen.getByText('Volume %BW·reps')).toBeTruthy();
  expect(screen.getByText('1800')).toBeTruthy(); expect(onOpen).not.toHaveBeenCalled();
  fireEvent.press(screen.getByTestId('preview-browse')); expect(onBrowse).toHaveBeenCalledWith('volume');
  fireEvent.press(screen.getByTestId('preview-open')); expect(onOpen).toHaveBeenCalledWith('volume');
  fireEvent.press(screen.getByTestId('preview-metric-improvement')); expect(screen.getByText('−5.0%')).toBeTruthy();
});
it('shows only enabled metrics and never substitutes the viewer into a short podium', () => {
  const result = current(); result.cow.metrics = ['volume']; result.rankings = [result.rankings[1]];
  render(<CoWPreview result={result} userId="u1" dateFormat="DD-MM-YYYY" onOpen={jest.fn()} testID="preview" />);
  expect(screen.queryByTestId('preview-metric-e1rm')).toBeNull(); expect(screen.queryByText('You')).toBeNull(); expect(screen.getByText('Jules')).toBeTruthy();
});
it.each(['pending','unavailable','empty'] as const)('keeps current %s distinct from absence', async state => {
  const value = summary();
  value.result.rankings.forEach(row => { row.entries = []; });
  if (state !== 'empty') { value.result.state = state; if (state === 'pending') value.result.publication_id = null; }
  api.getCoWSummary.mockResolvedValue(value);
  render(<CoWGroupPreview groupId="g1" userId="u1" today />);
  expect(await screen.findByTestId('today-cow')).toBeTruthy(); expect(screen.getByText('Pull-up')).toBeTruthy();
  expect(screen.getAllByText(state === 'pending' ? 'Updating' : state === 'unavailable' ? 'Group comparisons unavailable' : 'No qualifying results').length).toBeGreaterThan(0);
});
it.each([true, false])('hides confirmed absence without a gap (today: %s)', async today => {
  api.getCoWSummary.mockResolvedValue({ ...summary(), selection: 'none', result: null });
  const view = render(<CoWGroupPreview groupId="g1" userId="u1" today={today} />);
  await waitForGone(() => screen.queryByTestId(`${today ? 'today' : 'group'}-cow-section`));
  expect(view.toJSON()).toBeNull();
});
it('labels a stored fallback with its own date and preserves selected metric/group/CoW on open', async () => {
  const value = summary(); value.selection = 'previous_final' as typeof value.selection;
  value.result.cow = past(); value.result.publication_id = 'stored';
  api.getCoWSummary.mockResolvedValue(value);
  render(<CoWGroupPreview groupId="g1" userId="u1" today />);
  expect(await screen.findByText('Last week · Final')).toBeTruthy(); expect(screen.getByText('19 – 25 Oct 26')).toBeTruthy();
  fireEvent.press(screen.getByTestId('today-cow-metric-volume')); fireEvent.press(screen.getByTestId('today-cow-open'));
  expect(mockRouter.push).toHaveBeenCalledWith('/group/g1/cows?cowId=past&metric=volume');
});
it('shows retry on failed reads and offline state without declaring absence', async () => {
  api.getCoWSummary.mockRejectedValue(new GroupApiError('INTERNAL', 'failed'));
  render(<CoWGroupPreview groupId="g1" userId="u1" today />);
  expect(await screen.findByTestId('today-cow-error-state')).toBeTruthy();
  expect(screen.getByText('Please try again.')).toBeTruthy(); expect(screen.queryByText('failed')).toBeNull();
  expect(screen.queryByText('No CoW this week')).toBeNull();
});
it('opens the group preview without a View CoWs row or scheduling controls', async () => {
  render(<GroupRoute />);
  expect(await screen.findByTestId('group-cow-open')).toBeTruthy(); expect(screen.queryByTestId('cows-schedule')).toBeNull();
  expect(screen.queryByText('View CoWs')).toBeNull();
  fireEvent.press(await screen.findByTestId('group-cow-metric-improvement')); fireEvent.press(screen.getByTestId('group-cow-open'));
  expect(mockRouter.push).toHaveBeenCalledWith('/group/g1/cows?cowId=cow1&metric=improvement');
});
it('keeps group summary failures retryable without a View CoWs row', async () => {
  api.getCoWSummary.mockRejectedValue(new GroupApiError('INTERNAL', 'failed'));
  render(<GroupRoute />);
  expect(await screen.findByTestId('group-cow-error-state')).toBeTruthy();
  expect(screen.queryByText('View CoWs')).toBeNull();
  api.getCoWSummary.mockResolvedValue(summary());
  fireEvent.press(screen.getByTestId('group-cow-error-state-retry'));
  expect(await screen.findByTestId('group-cow-open')).toBeTruthy();
});
it('browses current, next and past with archived names retained, and management only for admins', async () => {
  api.listCoWs.mockResolvedValue({ cows: [scheduled(), current().cow, { ...past(), group_exercise_id: 'old' }], next_cursor: null });
  render(<CoWsRoute />);
  expect(await screen.findByTestId('cows-preview')).toBeTruthy(); expect(await screen.findByTestId('cows-next')).toBeTruthy();
  expect(screen.getByText('Archived squat')).toBeTruthy();
  fireEvent.press(screen.getByTestId('cows-schedule')); expect(mockRouter.push).toHaveBeenCalledWith('/group/g1/cows/schedule?cowId=next');
  expect(screen.getByText('Full standings')).toBeTruthy();
});
it('members browse without management controls', async () => {
  api.getGroup.mockResolvedValue({ ...competitionGroupDetail, group: { ...competitionGroupDetail.group, my_role: 'member' } });
  render(<CoWsRoute />); await screen.findByTestId('cows-preview');
  expect(screen.queryByTestId('cows-schedule')).toBeNull();
});
it('does not turn a failed list into an empty next/history section', async () => {
  api.listCoWs.mockRejectedValue(new GroupApiError('INTERNAL', 'failed list'));
  render(<CoWsRoute />); await screen.findByTestId('cows-preview');
  expect(await screen.findByTestId('cows-list-error-state')).toBeTruthy(); expect(screen.queryByText('Nothing scheduled')).toBeNull(); expect(screen.queryByText('No past CoWs')).toBeNull();
});
it('uses online full pages and generic unranked rows without inventing a baseline reason', async () => {
  mockParams = { groupId: 'g1', cowId: 'cow1', metric: 'improvement' };
  api.getCoWResults.mockImplementation(async (_g, _c, metric) => ({ ...current(), rankings: [{ ...current().rankings.find(row => row.metric === metric)!,
    entries: [{ rank: null, member: { user_id: 'u1', username: 'Me' }, former: false, state: 'unranked', value: null }] }] }));
  render(<CoWStandingsRoute />);
  expect(await screen.findByText('Not ranked')).toBeTruthy(); expect(screen.queryByText(/No pre-week baseline/)).toBeNull();
  fireEvent.press(screen.getByTestId('cow-standings-metric-volume'));
  await waitFor(() => expect(api.getCoWResults).toHaveBeenLastCalledWith('g1', 'cow1', 'volume', null));
});
it('a missing CoW is unavailable rather than a false loss of group membership', async () => {
  mockParams = { groupId: 'g1', cowId: 'missing' }; render(<CoWStandingsRoute />);
  expect(await screen.findByTestId('cow-missing')).toBeTruthy(); expect(screen.queryByTestId('cow-lost-access')).toBeNull();
});
it('keeps Upcoming in the heading without an empty status panel or Refresh button', async () => {
  mockParams = { groupId: 'g1', cowId: 'next' };
  api.getCoWResults.mockResolvedValue({ ...current(), cow: scheduled(), state: 'pending', publication_id: null,
    rankings: [{ ...current().rankings[0], entries: [] }] });
  render(<CoWStandingsRoute />);
  expect(await screen.findByText('Upcoming')).toBeTruthy();
  expect(screen.getAllByText('Upcoming')).toHaveLength(1);
  expect(screen.queryByTestId('cow-standings-state')).toBeNull();
  expect(screen.queryByText('Refresh')).toBeNull();
  const calls = api.getCoWResults.mock.calls.length;
  await act(async () => { await screen.getByTestId('cow-standings').props.refreshControl.props.onRefresh(); });
  expect(api.getCoWResults.mock.calls.length).toBeGreaterThan(calls);
});
it.each(['pending', 'unavailable'] as const)('keeps the %s message without a Refresh button', async state => {
  mockParams = { groupId: 'g1', cowId: 'cow1' };
  api.getCoWResults.mockResolvedValue({ ...current(), state, publication_id: null,
    rankings: [{ ...current().rankings[0], entries: [] }] });
  render(<CoWStandingsRoute />);
  expect(await screen.findByTestId('cow-standings-state')).toBeTruthy();
  expect(screen.getAllByText(state === 'pending' ? 'Updating' : 'Group comparisons unavailable').length).toBeGreaterThan(0);
  expect(screen.queryByText('Refresh')).toBeNull();
});
it('retains stale standings feedback without a Refresh button', async () => {
  mockParams = { groupId: 'g1', cowId: 'cow1' };
  api.getCoWResults.mockImplementation(async (_group, _cow, _metric, before) => {
    if (before) throw new GroupApiError('CONFLICT', 'publication changed');
    return { ...current(), rankings: [{ ...current().rankings[0], next_cursor: 'next-page' }] };
  });
  render(<CoWStandingsRoute />);
  fireEvent.press(await screen.findByTestId('cow-standings-more'));
  expect(await screen.findByTestId('cow-standings-stale')).toBeTruthy();
  expect(screen.queryByText('Refresh')).toBeNull();
  await act(async () => { screen.getByTestId('cow-standings').props.refreshControl.props.onRefresh(); });
  await waitForGone(() => screen.queryByTestId('cow-standings-stale'));
  expect(screen.getByTestId('cow-standings-more')).toBeTruthy();
});
it('renders server Finalizing without calling it Final and suppresses unsafe figures', async () => {
  mockParams = { groupId: 'g1', cowId: 'cow1' };
  api.getCoWResults.mockResolvedValue({ ...current(), cow: { ...current().cow, state: 'finalizing' }, state: 'pending', publication_id: null,
    rankings: [{ ...current().rankings[0], entries: [] }] });
  render(<CoWStandingsRoute />);
  expect(await screen.findByTestId('cow-standings-state')).toBeTruthy(); expect(screen.queryByText('Final')).toBeNull(); expect(screen.queryByText('150.0')).toBeNull();
});
it('validates empty choices near their fields before sending a write', async () => {
  render(<CoWScheduleRoute />); await screen.findByTestId('cow-form-exercise');
  await waitFor(() => expect(screen.getByTestId('cow-form-submit')).toBeEnabled());
  fireEvent.press(screen.getByTestId('cow-form-submit'));
  expect(await screen.findByText('Choose an exercise.')).toBeTruthy(); expect(screen.getByText('Choose at least one leaderboard.')).toBeTruthy(); expect(api.createCoW).not.toHaveBeenCalled();
});
it('schedules next week with the chosen comparison, independent metrics and one stable UUID', async () => {
  await prepareCreate(); fireEvent.press(screen.getByTestId('cow-form-submit'));
  await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
  expect(api.createCoW).toHaveBeenCalledWith('g1', { cowId: expect.stringMatching(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/),
    groupExerciseId: 'ge2', metrics: ['e1rm','volume'], calendarRevision: 1, weekStart: '2026-11-02' });
  expect(createCoWId()).not.toBe(createCoWId());
});
it('searches only active comparisons and dismissal leaves metric and exercise selections intact', async () => {
  await prepareCreate(); fireEvent.press(screen.getByTestId('cow-form-exercise'));
  expect(screen.getByTestId('cow-picker-ge2').props.accessibilityState.checked).toBe(true);
  fireEvent.changeText(screen.getByTestId('cow-exercise-search'), 'not found'); expect(screen.getByText('No matching exercises')).toBeTruthy();
  fireEvent.press(screen.getByTestId('cow-exercise-picker-backdrop', { includeHiddenElements: true }));
  expect(screen.getByTestId('cow-form-metric-volume').props.accessibilityState.checked).toBe(true); expect(screen.getByLabelText('Exercise: Bench press')).toBeTruthy();
});
it('picker distinguishes failed reads, no active choices and empty search', async () => {
  api.listCompetitionExercises.mockResolvedValue({ contract_version: 4, exercises: [archived] });
  render(<CoWScheduleRoute />); fireEvent.press(await screen.findByTestId('cow-form-exercise'));
  expect(await screen.findByText('No active group exercises')).toBeTruthy(); expect(screen.queryByText('No matching exercises')).toBeNull();
});
it('refuses an offline write visibly without queuing it', async () => {
  await prepareCreate(); emitNetwork(false); fireEvent.press(screen.getByTestId('cow-form-submit'));
  expect(await screen.findByText("You're offline. Connect to the internet and try again.")).toBeTruthy(); expect(api.createCoW).not.toHaveBeenCalled();
});
it('blocks duplicate create after an uncertain response and confirms the original identity with Check status', async () => {
  api.createCoW.mockRejectedValueOnce(new GroupApiError('NETWORK', 'lost reply'));
  await prepareCreate(); fireEvent.press(screen.getByTestId('cow-form-submit'));
  const check = await screen.findByTestId('cow-form-check-status'); expect(screen.getByTestId('cow-form-submit')).toBeDisabled();
  const id = api.createCoW.mock.calls[0][1].cowId;
  api.getCoW.mockResolvedValueOnce({ cow: { ...scheduled(), cow_id: id } });
  fireEvent.press(check); await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
  expect(api.getCoW).toHaveBeenCalledWith('g1', id); expect(api.createCoW).toHaveBeenCalledTimes(1);
});
it('keeps input and retry identity after status establishes that the first create was absent', async () => {
  api.createCoW.mockRejectedValueOnce(new GroupApiError('NETWORK', 'lost reply'));
  await prepareCreate(); fireEvent.press(screen.getByTestId('cow-form-submit'));
  fireEvent.press(await screen.findByTestId('cow-form-check-status'));
  await screen.findByText('No CoW was created. Review next week and try again.');
  fireEvent.press(screen.getByTestId('cow-form-submit')); await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
  expect(api.createCoW.mock.calls[1]).toEqual(api.createCoW.mock.calls[0]);
});
it('resolves a competing scheduled slot before permitting another create', async () => {
  api.createCoW.mockRejectedValueOnce(new GroupApiError('NETWORK', 'lost reply'));
  api.listCoWs.mockResolvedValue({ cows: [scheduled()], next_cursor: null });
  await prepareCreate(); fireEvent.press(screen.getByTestId('cow-form-submit')); fireEvent.press(await screen.findByTestId('cow-form-check-status'));
  expect(await screen.findByText('A CoW is already scheduled.')).toBeTruthy(); expect(screen.getByTestId('cow-form-submit')).toBeDisabled();
});
it('retains edits through a revision conflict and uses the checked revision only after status review', async () => {
  mockParams.cowId = 'next'; api.updateCoW.mockRejectedValueOnce(new GroupApiError('CONFLICT', 'changed'));
  render(<CoWScheduleRoute />); await chooseBench(); fireEvent.press(screen.getByTestId('cow-form-submit'));
  await screen.findByTestId('cow-form-check-status'); api.getCoW.mockResolvedValue({ cow: { ...scheduled(), revision: 2 } });
  fireEvent.press(screen.getByTestId('cow-form-check-status')); await screen.findByText('Review your selections before saving again.');
  fireEvent.press(screen.getByTestId('cow-form-submit')); await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
  expect(api.updateCoW).toHaveBeenLastCalledWith('g1', 'next', { revision: 2, groupExerciseId: 'ge2', metrics: ['e1rm','volume'] });
});
it('cancels before start through a native destructive confirmation', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined); mockParams.cowId = 'next';
  render(<CoWScheduleRoute />); fireEvent.press(await screen.findByTestId('cow-form-cancel'));
  expect(api.cancelCoW).not.toHaveBeenCalled();
  await act(async () => alert.mock.calls[0][2]!.find(button => button.style === 'destructive')!.onPress!());
  await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1)); expect(api.cancelCoW).toHaveBeenCalledWith('g1', 'next', 1); alert.mockRestore();
});
it('never shows edit controls after start or after a role loss', async () => {
  mockParams.cowId = 'cow1'; render(<CoWScheduleRoute />);
  expect(await screen.findByTestId('cow-form-read-only')).toBeTruthy(); expect(screen.queryByTestId('cow-form-cancel')).toBeNull(); expect(api.updateCoW).not.toHaveBeenCalled();
});
it('handles live role loss without discarding the user draft or navigating', async () => {
  api.createCoW.mockRejectedValueOnce(new GroupApiError('FORBIDDEN', 'role changed'));
  await prepareCreate(); api.getGroup.mockResolvedValue({ ...competitionGroupDetail, group: { ...competitionGroupDetail.group, my_role: 'member' } });
  fireEvent.press(screen.getByTestId('cow-form-submit')); expect(await screen.findByTestId('cow-form-forbidden')).toBeTruthy(); expect(mockRouter.back).not.toHaveBeenCalled();
});
it('blocks unset scheduling without zone setup controls and revalidates on focus', async () => {
  api.getCoWCalendar.mockResolvedValue({ time_zone: null, revision: 1, next_week_start: null });
  const view = render(<CoWScheduleRoute />); await chooseBench(); fireEvent.press(screen.getByTestId('cow-form-metric-volume'));
  expect(await screen.findByTestId('cow-form-zone-unset')).toBeTruthy();
  expect(screen.getByTestId('cow-form-submit')).toBeDisabled();
  expect(screen.queryByText('Set group time zone')).toBeNull(); expect(mockRouter.push).not.toHaveBeenCalled();
  mockFocused = false; view.rerender(<CoWScheduleRoute />); api.getCoWCalendar.mockResolvedValue({ ...calendar(), revision: 2 });
  mockFocused = true; view.rerender(<CoWScheduleRoute />); await waitFor(() => expect(screen.getByTestId('cow-form-submit')).toBeEnabled());
  expect(screen.getByLabelText('Exercise: Bench press')).toBeTruthy(); expect(screen.getByTestId('cow-form-metric-volume').props.accessibilityState.checked).toBe(true);
});
it('opens compiled time-zone setup while its calendar loads, then saves only after an explicit press', async () => {
  let resolveCalendar!: (value: ReturnType<typeof calendar>) => void;
  api.getCoWCalendar.mockImplementationOnce(() => new Promise(resolve => { resolveCalendar = resolve; }));
  mockParams.focusTimeZone = '1';
  render(<EditGroupRoute />);
  expect(await screen.findByTestId('cow-zone-loading')).toBeTruthy();
  expect(api.setCoWCalendar).not.toHaveBeenCalled();
  await act(async () => resolveCalendar({ ...calendar(), revision: 7 }));
  const input = await screen.findByTestId('cow-zone-input');
  expect(input.props.autoFocus).toBe(true);
  expect(api.setCoWCalendar).not.toHaveBeenCalled();
  fireEvent.changeText(input, ' Europe/London ');
  fireEvent.press(screen.getByTestId('cow-zone-save'));
  expect(await screen.findByTestId('cow-zone-saved')).toBeTruthy();
  expect(api.setCoWCalendar).toHaveBeenCalledWith('g1', 7, 'Europe/London');
});
it('saves a validated group calendar explicitly from group Edit while retaining invalid text', async () => {
  api.setCoWCalendar.mockRejectedValueOnce(new GroupApiError('VALIDATION', 'invalid zone'));
  render(<EditGroupRoute />); const input = await screen.findByTestId('cow-zone-input');
  fireEvent.changeText(input, 'Not/AZone'); fireEvent.press(screen.getByTestId('cow-zone-save'));
  expect(await screen.findByText('Check the time zone and try again.')).toBeTruthy(); expect(screen.getByTestId('cow-zone-input').props.value).toBe('Not/AZone');
  fireEvent.changeText(input, ' Europe/London '); fireEvent.press(screen.getByTestId('cow-zone-save'));
  expect(await screen.findByTestId('cow-zone-saved')).toBeTruthy(); expect(api.setCoWCalendar).toHaveBeenLastCalledWith('g1', 1, 'Europe/London');
});

it('drops a delayed summary from the previous group/account and resets in-card metric selection', async () => {
  let release!: (value: ReturnType<typeof summary>) => void;
  api.getCoWSummary.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
  const view = render(<CoWGroupPreview groupId="g1" userId="u1" today />);
  await waitFor(() => expect(api.getCoWSummary).toHaveBeenCalledWith('g1'));
  const next = summary(); next.group_id = 'g2'; next.result.cow = { ...next.result.cow, cow_id: 'cow2', group_id: 'g2' };
  next.result.exercise = { ...next.result.exercise!, name: 'New group exercise' };
  api.getCoWSummary.mockResolvedValue(next);
  view.rerender(<CoWGroupPreview groupId="g2" userId="u2" today />);
  expect(await screen.findByText('New group exercise')).toBeTruthy();
  await act(async () => release(summary()));
  expect(screen.getByText('New group exercise')).toBeTruthy(); expect(screen.queryByText('Pull-up')).toBeNull();
});
it('returns focus to the Exercise field after the native sheet dismissal event', async () => {
  const focus = jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
  render(<CoWScheduleRoute />); fireEvent.press(await screen.findByTestId('cow-form-exercise'));
  screen.UNSAFE_getByType(ChoiceRow).props.ref.current = { canonical: { nativeTag: 77 } };
  const modal = screen.UNSAFE_getAllByType(Modal).find(node => node.props.testID === 'cow-exercise-picker-modal')!;
  act(() => { modal.props.onRequestClose(); });
  act(() => { modal.props.onDismiss(); });
  expect(focus).toHaveBeenLastCalledWith(77);
  expect(screen.getByTestId('cow-form-exercise')).toBeTruthy(); expect(api.createCoW).not.toHaveBeenCalled();
  focus.mockRestore();
});
it('keeps a failed exercise read distinct from an empty picker and offers Retry', async () => {
  api.listCompetitionExercises.mockRejectedValue(new GroupApiError('INTERNAL', 'exercise read failed'));
  render(<CoWScheduleRoute />); fireEvent.press(await screen.findByTestId('cow-form-exercise'));
  expect(await screen.findByTestId('cow-picker-error-state')).toBeTruthy();
  expect(screen.queryByText('No active group exercises')).toBeNull();
  api.listCompetitionExercises.mockResolvedValue({ contract_version: 4, exercises: [bench] });
  fireEvent.press(screen.getByTestId('cow-picker-error-state-retry')); expect(await screen.findByTestId('cow-picker-ge2')).toBeTruthy();
});
it('blocks a previously selected exercise that was archived while the form was away', async () => {
  const view = render(<CoWScheduleRoute />); await chooseBench(); fireEvent.press(screen.getByTestId('cow-form-metric-e1rm'));
  mockFocused = false; view.rerender(<CoWScheduleRoute />);
  api.listCompetitionExercises.mockResolvedValue({ contract_version: 4, exercises: [{ ...bench, archived_at_ms: 1 }] });
  mockFocused = true; view.rerender(<CoWScheduleRoute />);
  await waitFor(() => expect(api.listCompetitionExercises.mock.calls.length).toBeGreaterThan(1));
  fireEvent.press(await screen.findByTestId('cow-form-submit'));
  expect(await screen.findByText('Choose an available group exercise.')).toBeTruthy(); expect(api.createCoW).not.toHaveBeenCalled();
});
it('does not navigate twice if the user leaves while a write is in flight', async () => {
  let finish!: (value: Awaited<ReturnType<typeof groupApi.createCoW>>) => void;
  api.createCoW.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const view = render(<CoWScheduleRoute />); await chooseBench(); fireEvent.press(screen.getByTestId('cow-form-metric-volume'));
  fireEvent.press(screen.getByTestId('cow-form-submit')); await waitFor(() => expect(api.createCoW).toHaveBeenCalled()); view.unmount();
  await act(async () => finish({ cow: scheduled() })); expect(mockRouter.back).not.toHaveBeenCalled();
});
it('refreshes list and calendar at group-week rollover so an upcoming row cannot remain in Next week', async () => {
  jest.useFakeTimers().setSystemTime(current().cow.ends_at_us / 1000 - 1000);
  api.getCoWSummary.mockResolvedValue(summary()); api.listCoWs.mockResolvedValue({ cows: [scheduled(), current().cow], next_cursor: null });
  render(<CoWsRoute />); expect(await screen.findByTestId('cows-next')).toBeTruthy();
  const next = summary(); next.result.cow = { ...scheduled(), state: 'active' }; next.result.exercise = bench;
  next.result.cow.group_exercise_id = bench.group_exercise_id; next.valid_until_us = next.result.cow.ends_at_us;
  api.getCoWSummary.mockResolvedValue(next); api.listCoWs.mockResolvedValue({ cows: [next.result.cow, { ...current().cow, state: 'final' }], next_cursor: null });
  api.getCoWCalendar.mockResolvedValue({ ...calendar(), next_week_start: '2026-11-09' });
  await act(async () => { jest.advanceTimersByTime(1500); });
  await waitForGone(() => screen.queryByTestId('cows-next'));
  expect(api.getCoWCalendar.mock.calls.length).toBeGreaterThan(1); expect(api.listCoWs.mock.calls.length).toBeGreaterThan(1);
});

it('refreshes next-week bounds after a stale-calendar rejection while retaining choices', async () => {
  await prepareCreate();
  api.createCoW.mockRejectedValueOnce(new GroupApiError('VALIDATION', 'next week changed'));
  api.getCoWCalendar.mockResolvedValue({ time_zone: 'UTC', revision: 2, next_week_start: '2026-11-09' });
  fireEvent.press(screen.getByTestId('cow-form-submit'));
  await screen.findByText('Week changed. Review the new dates.');
  await waitFor(() => expect(screen.getByText('9–15 Nov 2026')).toBeTruthy());
  expect(screen.getByLabelText('Exercise: Bench press')).toBeTruthy();
  expect(screen.getByTestId('cow-form-metric-volume').props.accessibilityState.checked).toBe(true);
  expect(api.createCoW).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByLabelText('Review new dates'));
  expect(api.createCoW).toHaveBeenCalledTimes(1);
  fireEvent.press(screen.getByLabelText('Schedule CoW'));
  await waitFor(() => expect(api.createCoW).toHaveBeenCalledTimes(2));
  expect(api.createCoW.mock.calls[1][1]).toMatchObject({ calendarRevision: 2, weekStart: '2026-11-09' });
  expect(api.createCoW.mock.calls[1][1].cowId).toBe(api.createCoW.mock.calls[0][1].cowId);
});

it('keeps the published upcoming zone after the group calendar changes', async () => {
  api.listCoWs.mockResolvedValue({ cows: [{ ...scheduled(), time_zone: 'America/New_York' }], next_cursor: null });
  api.getCoWCalendar.mockResolvedValue({ time_zone: 'Pacific/Auckland', revision: 2, next_week_start: '2026-11-09' });
  render(<CoWsRoute />); await screen.findByTestId('cows-next');
  expect(screen.getByText('2–8 Nov 2026 · America/New_York')).toBeTruthy();
  expect(screen.queryByText(/Pacific\/Auckland/)).toBeNull();
});

it('requires date review after returning across a calendar rollover', async () => {
  const view = render(<CoWScheduleRoute />); await chooseBench(); fireEvent.press(screen.getByTestId('cow-form-metric-e1rm'));
  mockFocused = false; view.rerender(<CoWScheduleRoute />);
  api.getCoWCalendar.mockResolvedValue({ ...calendar(), next_week_start: '2026-11-09' });
  mockFocused = true; view.rerender(<CoWScheduleRoute />);
  const review = await screen.findByLabelText('Review new dates');
  expect(screen.getByText('Week changed. Review the new dates.')).toBeTruthy();
  fireEvent.press(review); expect(api.createCoW).not.toHaveBeenCalled();
  fireEvent.press(screen.getByLabelText('Schedule CoW'));
  await waitFor(() => expect(api.createCoW).toHaveBeenCalledTimes(1));
  expect(api.createCoW.mock.calls[0][1]).toMatchObject({ weekStart: '2026-11-09', groupExerciseId: 'ge2' });
});
it('omits Full standings when the selected preview metric has no rows', () => {
  const result = current(); result.rankings[0].entries = [];
  render(<CoWPreview result={result} userId="u1" dateFormat="DD-MM-YYYY" onOpen={jest.fn()} onBrowse={jest.fn()} browseLabel="Full standings" testID="preview" />);
  expect(screen.queryByText('Full standings')).toBeNull();
  fireEvent.press(screen.getByTestId('preview-metric-volume')); expect(screen.getByText('Full standings')).toBeTruthy();
});

it('moves accessibility focus to the first invalid field after submit', async () => {
  const handle = jest.spyOn(Native, 'findNodeHandle').mockReturnValue(101);
  const focus = jest.spyOn(AccessibilityInfo, 'setAccessibilityFocus').mockImplementation(() => undefined);
  render(<CoWScheduleRoute />);
  await screen.findByTestId('cow-form-submit');
  screen.UNSAFE_getByType(ChoiceRow).props.ref.current = { canonical: { nativeTag: 101 } };
  fireEvent.press(screen.getByTestId('cow-form-submit'));
  await waitFor(() => expect(focus).toHaveBeenCalledWith(101));
  expect(screen.getByText('Choose an exercise.')).toBeTruthy(); expect(api.createCoW).not.toHaveBeenCalled();
  handle.mockRestore(); focus.mockRestore();
});

it('checks the original identity after a committed create has a malformed reply', async () => {
  const malformed = new GroupApiError('INTERNAL', 'Malformed response', true);
  api.createCoW.mockRejectedValueOnce(malformed); await prepareCreate();
  fireEvent.press(screen.getByTestId('cow-form-submit'));
  const check = await screen.findByTestId('cow-form-check-status'); expect(screen.getByTestId('cow-form-submit')).toBeDisabled();
  const cowId = api.createCoW.mock.calls[0][1].cowId;
  api.getCoW.mockResolvedValueOnce({ cow: { ...scheduled(), cow_id: cowId } });
  fireEvent.press(check); await waitFor(() => expect(mockRouter.back).toHaveBeenCalledTimes(1));
  expect(api.getCoW).toHaveBeenCalledWith('g1', cowId); expect(api.createCoW).toHaveBeenCalledTimes(1);
});

it('keeps the tallest measured podium when switching to a shorter metric', () => {
  render(<CoWPreview result={current()} userId="u1" dateFormat="DD-MM-YYYY" onOpen={jest.fn()} testID="preview" />);
  fireEvent(screen.getByTestId('preview-podium-e1rm'), 'layout', { nativeEvent: { layout: { height: 180 } } });
  fireEvent(screen.getByTestId('preview-podium-volume', { includeHiddenElements: true }), 'layout', { nativeEvent: { layout: { height: 70 } } });
  fireEvent.press(screen.getByTestId('preview-metric-volume'));
  expect(screen.getByTestId('preview-podium')).toHaveStyle({ minHeight: 180 });
  expect(screen.getByText('1800')).toBeTruthy(); expect(screen.queryByText('150.0')).toBeNull();
});


it.each(['owner', 'admin', 'member'] as const)('shows the current calendar to %s with setup only for managers above CoW', async role => {
  api.getGroup.mockResolvedValue({ ...competitionGroupDetail, group: { ...competitionGroupDetail.group, my_role: role } });
  const view = render(<GroupRoute />);
  const zone = await screen.findByTestId('group-screen-time-zone-value');
  expect(zone).toHaveTextContent('UTC'); // The published preview remains Europe/London.
  expect(screen.getByText('Group time zone')).toBeTruthy();
  if (role === 'member') {
    expect(screen.queryByTestId('group-screen-set-time-zone')).toBeNull();
  } else {
    fireEvent.press(screen.getByTestId('group-screen-set-time-zone'));
    expect(mockRouter.push).toHaveBeenCalledWith('/group/g1/edit?focusTimeZone=1');
    expect(screen.getByTestId('group-screen-invite-button')).toHaveProp('accessibilityRole', 'button');
    const tree = JSON.stringify(view.toJSON(), (key, value) => key === 'props' ? { testID: value.testID } : value);
    expect(tree.indexOf('group-screen-edit-button')).toBeLessThan(tree.indexOf('group-screen-time-zone-value'));
    expect(tree.indexOf('group-screen-time-zone-value')).toBeLessThan(tree.indexOf('group-screen-set-time-zone'));
    expect(tree.indexOf('group-screen-set-time-zone')).toBeLessThan(tree.indexOf('group-cow-section'));
  }
});
it('only declares Not set after a successful calendar read confirms it', async () => {
  let finish!: (value: Awaited<ReturnType<typeof groupApi.getCoWCalendar>>) => void;
  api.getCoWCalendar.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  render(<GroupRoute />);
  await screen.findByTestId('group-screen-time-zone-loading');
  expect(screen.queryByText('Not set')).toBeNull();
  const unset = { time_zone: null, revision: 1, next_week_start: null };
  api.getCoWCalendar.mockResolvedValue(unset);
  await act(async () => finish(unset));
  expect(await screen.findByTestId('group-screen-time-zone-value')).toHaveTextContent('Not set');
});
it('offers calendar retry without implying an unset zone after a read failure', async () => {
  api.getCoWCalendar.mockRejectedValue(new GroupApiError('INTERNAL', 'failed'));
  render(<GroupRoute />);
  await screen.findByTestId('group-screen-time-zone-error-state');
  api.getCoWCalendar.mockResolvedValue(calendar());
  fireEvent.press(screen.getByTestId('group-screen-time-zone-error-state-retry'));
  expect(screen.queryByText('Not set')).toBeNull();
  expect(await screen.findByTestId('group-screen-time-zone-value')).toHaveTextContent('UTC');
});
it('keeps an unavailable offline calendar distinct from Not set', async () => {
  api.getCoWCalendar.mockRejectedValue(new GroupApiError('NETWORK', 'offline'));
  render(<GroupRoute />);
  expect(await screen.findByTestId('group-screen-time-zone-offline-empty-state')).toBeTruthy();
  expect(screen.queryByText('Not set')).toBeNull();
});
it('retains the saved zone beside refresh failure and retry, and during offline use', async () => {
  const view = render(<GroupRoute />);
  await screen.findByTestId('group-screen-time-zone-value');
  mockFocused = false; view.rerender(<GroupRoute />);
  api.getCoWCalendar.mockRejectedValueOnce(new GroupApiError('INTERNAL', 'failed'));
  mockFocused = true; view.rerender(<GroupRoute />);
  fireEvent.press(await screen.findByTestId('group-screen-time-zone-error-retry'));
  await waitForGone(() => screen.queryByTestId('group-screen-time-zone-error'));
  emitNetwork(false);
  expect(screen.getByTestId('group-screen-time-zone-value')).toHaveTextContent('UTC');
  expect(screen.getAllByTestId('groups-offline-banner').length).toBeGreaterThan(0);
});
it('refreshes the current group zone on first and subsequent editor returns', async () => {
  api.getCoWCalendar.mockResolvedValue({ time_zone: null, revision: 1, next_week_start: null });
  const view = render(<GroupRoute />);
  expect(await screen.findByTestId('group-screen-time-zone-value')).toHaveTextContent('Not set');
  for (const [index, time_zone] of ['Europe/London', 'Pacific/Auckland'].entries()) {
    fireEvent.press(screen.getByTestId('group-screen-set-time-zone'));
    expect(mockRouter.push).toHaveBeenLastCalledWith('/group/g1/edit?focusTimeZone=1');
    mockFocused = false; view.rerender(<GroupRoute />);
    api.getCoWCalendar.mockResolvedValue({ time_zone, revision: index + 2, next_week_start: '2026-11-02' });
    mockFocused = true; view.rerender(<GroupRoute />);
    await waitFor(() => expect(screen.getByTestId('group-screen-time-zone-value')).toHaveTextContent(time_zone));
  }
});
it('focuses the existing editor and can save consecutive zone changes', async () => {
  mockParams = { groupId: 'g1', focusTimeZone: '1' };
  render(<EditGroupRoute />);
  const input = await screen.findByTestId('cow-zone-input');
  expect(input.props.autoFocus).toBe(true);
  for (const [index, time_zone] of ['Europe/London', 'Pacific/Auckland'].entries()) {
    fireEvent.changeText(input, time_zone);
    api.setCoWCalendar.mockImplementationOnce(async () => {
      const saved = { time_zone, revision: index + 2, next_week_start: '2026-11-02' };
      api.getCoWCalendar.mockResolvedValue(saved);
      return saved;
    });
    fireEvent.press(screen.getByTestId('cow-zone-save'));
    await screen.findByTestId('cow-zone-saved');
    await waitFor(() => expect(api.getCoWCalendar).toHaveBeenCalledTimes(index + 2));
    expect(api.setCoWCalendar).toHaveBeenLastCalledWith('g1', index + 1, time_zone);
  }
});
it('hides management and cached content after a calendar read loses membership', async () => {
  api.getCoWCalendar.mockRejectedValue(new GroupApiError('NOT_FOUND', 'Group not found'));
  render(<GroupRoute />);
  expect(await screen.findByTestId('group-screen-lost-access')).toBeTruthy();
  expect(screen.queryByTestId('group-screen-set-time-zone')).toBeNull();
});
it('keeps calendar input on conflict, refreshes its revision and saves only online', async () => {
  api.setCoWCalendar.mockRejectedValueOnce(new GroupApiError('CONFLICT', 'changed'));
  render(<EditGroupRoute />);
  fireEvent.changeText(await screen.findByTestId('cow-zone-input'), 'Pacific/Auckland');
  api.getCoWCalendar.mockResolvedValue({ ...calendar(), revision: 2 });
  fireEvent.press(screen.getByTestId('cow-zone-save'));
  await screen.findByText('Check the time zone and try again.');
  await waitFor(() => expect(api.getCoWCalendar).toHaveBeenCalledTimes(2));
  expect(screen.getByTestId('cow-zone-input').props.value).toBe('Pacific/Auckland');
  emitNetwork(false); fireEvent.press(screen.getByTestId('cow-zone-save'));
  await screen.findByText("You're offline. Connect to save.");
  expect(api.setCoWCalendar).toHaveBeenCalledTimes(1);
  emitNetwork(true); fireEvent.press(screen.getByTestId('cow-zone-save'));
  await screen.findByTestId('cow-zone-saved');
  expect(api.setCoWCalendar).toHaveBeenLastCalledWith('g1', 2, 'Pacific/Auckland');
});
it.each(['FORBIDDEN', 'NOT_FOUND'] as const)('refreshes editor access after %s without another write', async code => {
  render(<EditGroupRoute />);
  fireEvent.changeText(await screen.findByTestId('cow-zone-input'), 'Pacific/Auckland');
  api.setCoWCalendar.mockRejectedValueOnce(new GroupApiError(code, 'access changed'));
  if (code === 'NOT_FOUND') api.getGroup.mockRejectedValue(new GroupApiError(code, 'Group not found'));
  else api.getGroup.mockResolvedValue({ ...competitionGroupDetail, group: { ...competitionGroupDetail.group, my_role: 'member' } });
  fireEvent.press(screen.getByTestId('cow-zone-save'));
  expect(await screen.findByTestId(code === 'NOT_FOUND' ? 'group-edit-lost-access' : 'group-edit-forbidden')).toBeTruthy();
  expect(screen.queryByTestId('cow-zone-save')).toBeNull();
  expect(api.setCoWCalendar).toHaveBeenCalledTimes(1);
});
it('has no calendar setup controls in the CoW browser', async () => {
  api.getCoWCalendar.mockResolvedValue({ time_zone: null, revision: 1, next_week_start: null });
  render(<CoWsRoute />); await screen.findByTestId('cows-schedule');
  expect(screen.queryByText('Set time zone')).toBeNull(); expect(screen.queryByText('Set group time zone')).toBeNull();
});

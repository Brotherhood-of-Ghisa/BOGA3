/**
 * The metric record sheet on its own: what it shows for each certification
 * state and read-only reason, which actions it offers to whom, and the write
 * and read races. The certification RPCs and connectivity are faked (the
 * server and the network are the states under test); the screens that open
 * the sheet are covered in `groups-metric-screens.test.tsx`.
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';

import { GroupMetricRecordSheet } from '@/components/groups/group-metric-record-sheet';
import { GroupMetricStreamRecordSheet } from '@/components/groups/group-metric-stream-record-sheet';
import { competitionExercise,competitionRow,competitionCertification,competitionEvent } from './helpers/competition-fixtures';
import { GroupApiError } from '@/src/groups/api';
import type { CompetitionBoardRowWire, CompetitionCertificationWire, CompetitionExerciseWire } from '@/src/groups/competition-wire';

const mockCertify = jest.fn();
const mockEnd = jest.fn();
const mockRead = jest.fn();
jest.mock('@/src/groups/api', () => ({
  ...jest.requireActual('@/src/groups/api'),
  certifyCompetition: (...args: unknown[]) => mockCertify(...args),
  endCompetitionCertification: (...args: unknown[]) => mockEnd(...args),
  getCompetitionCertification: (...args: unknown[]) => mockRead(...args),
}));

let mockOnline: boolean | null = true;
jest.mock('@/src/groups/use-network-online', () => ({ useNetworkOnline: () => mockOnline }));

const mockPush = jest.fn();
jest.mock('expo-router', () => ({ useRouter: () => ({ push: mockPush }) }));

/** 12 Sep 2026, local noon. */
const NOW = new Date(2026, 8, 12, 12, 0).getTime();
const SEP_10 = new Date(2026, 8, 10, 9, 0).getTime();
const SEP_11 = new Date(2026, 8, 11, 9, 0).getTime();
const ME = 'me';

type Deferred<T> = { promise: Promise<T>; resolve: (value: T) => void; reject: (error: unknown) => void };
const deferred = <T,>(): Deferred<T> => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const EXERCISE: CompetitionExerciseWire = { ...competitionExercise,group_exercise_id: 'pull' };
const PERFORMANCE = { ...competitionRow.performance,session_id: 'session',set_id: 'set',achieved_at_ms: SEP_10 };
const ROW: CompetitionBoardRowWire = { ...competitionRow,value: 23.3,member: { user_id: 'dave',username: 'Dave' },
  performance: PERFORMANCE,write_token: 'pin-1' };
const certification = (over: Partial<CompetitionCertificationWire> = {}): CompetitionCertificationWire => ({
  ...competitionCertification,certification_id: 'cert-1',observed_rules_revision: 2,
  certified_by: { user_id: 'kim',username: 'Kim' },certified_at_ms: SEP_11,...over });
const certifiedRow = (over: Partial<CompetitionBoardRowWire> = {}): CompetitionBoardRowWire => ({
  ...ROW,certification: certification(),...over } as CompetitionBoardRowWire);

type SheetProps = Parameters<typeof GroupMetricRecordSheet>[0];
const onClose = jest.fn();
const onChanged = jest.fn<Promise<void>, []>();

const baseProps = (over: Partial<SheetProps> = {}): SheetProps => ({
  row: ROW,
  exercise: EXERCISE,
  groupId: 'group',
  userId: ME,
  myRole: 'member',
  onClose,
  onChanged,
  ...over,
});

const renderSheet = (over: Partial<SheetProps> = {}) => {
  const view = render(<GroupMetricRecordSheet {...baseProps(over)} />);
  return { ...view, rerenderWith: (next: Partial<SheetProps>) => view.rerender(<GroupMetricRecordSheet {...baseProps(next)} />) };
};

const status = () => screen.getByTestId('group-metric-record-status');
const text = (content: string) => screen.queryByText(content);
const flush = () => act(async () => {});

let alertSpy: jest.SpyInstance;
beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  mockOnline = true;
  mockCertify.mockReset();
  mockEnd.mockReset();
  mockRead.mockReset().mockReturnValue(new Promise(() => {}));
  mockPush.mockReset();
  onClose.mockReset();
  onChanged.mockReset().mockResolvedValue(undefined);
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

/** Presses the destructive button of the last confirmation shown. */
const confirmAlert = async (buttonText: string) => {
  const buttons = alertSpy.mock.calls[alertSpy.mock.calls.length - 1][2] as AlertButton[];
  await act(async () => {
    buttons.find((button) => button.text === buttonText)?.onPress?.();
  });
};

describe('what the sheet shows', () => {
  it('keeps the historic stream score visible while certifying with its current rule token', async () => {
    mockCertify.mockResolvedValue({ contract_version: 4, certification: certification() });
    render(<GroupMetricStreamRecordSheet record={{ ...competitionEvent,group: { group_id: 'group',name: 'Lifters' },
      member: ROW.member,set_id: 'set',values: [{ ...competitionEvent.values[0],value: 23.3 }],
      record_context: { exercise: EXERCISE,former: false,metrics: [{ metric: 'e1rm',write_token: 'current-pin',eligible: true,certification: null }] }
    }} userId={ME} myRole="member" onClose={onClose} onChanged={onChanged} />);
    expect(text('1RM 23.3 %BW')).toBeTruthy();
    await act(async () => fireEvent.press(screen.getByTestId('group-metric-record-certify')));
    expect(mockCertify).toHaveBeenCalledWith(expect.objectContaining({ token: 'current-pin', setId: 'set' }));
    expect(text('1RM 23.3 %BW')).toBeTruthy();
  });
  it('shows the score, who and when, the raw set, the rules and the strength note for 1RM', () => {
    renderSheet();
    expect(text('23.3 %BW')).toBeTruthy();
    expect(text('Dave · 10 Sep')).toBeTruthy();
    expect(screen.getByTestId('group-metric-record-raw')).toHaveTextContent('As logged: 5 reps');
    expect(screen.queryByText(/Rules 2 · 100% contribution · Bodyweight scoring On/)).toBeTruthy();
    expect(text('Certification attests this logged performance. Rule changes preserve it; corrections can invalidate it.')).toBeTruthy();
    expect(text('Strength values are estimates. Scores use the group’s rules, independently of personal exercise settings.')).toBeTruthy();
    expect(status()).toHaveTextContent('Uncertified');
    expect(screen.queryByTestId('group-metric-record-metric-e1rm')).toBeNull();
    expect(screen.queryByTestId('group-metric-record-history')).toBeNull();
  });

  it('drops the strength note for Weight', () => {
    renderSheet({ row: { ...ROW,metric: 'volume',unit: 'percent_bw_reps',value: 20 } });
    expect(text('Scores use the group’s rules, independently of personal exercise settings.')).toBeTruthy();
  });

  it('shows "Certified" for a certified row while its certification loads', () => {
    mockRead.mockReturnValue(new Promise(() => {}));
    renderSheet({ row: certifiedRow() });
    expect(status()).toHaveTextContent('Certified by Kim · 11 Sep');
    expect(mockRead).toHaveBeenCalledWith('group', 'cert-1', 'e1rm');
  });

  it.each<[string, CompetitionCertificationWire, string]>([
    ['the certifier and date', certification(), 'Certified by Kim · 11 Sep'],
    ['"a group member" for an unknown certifier', certification({ certified_by: null }), 'Certified by a group member · 11 Sep'],
    ['how an ended certification ended', certification({ ended_at_ms: SEP_11, end_reason: 'withdrawn' }), 'Certification ended'],
  ])('shows %s', async (_label, loaded, expected) => {
    mockRead.mockResolvedValue({ contract_version: 4, certification: loaded });
    renderSheet({ row: certifiedRow() });
    await waitFor(() => expect(status()).toHaveTextContent(expected));
  });

  it('notes a certification observed under earlier rules', () => {
    renderSheet({ row: ROW, initialCertification: certification({ observed_rules_revision: 1 }) });
    expect(text('Observed under rules 1; unchanged performance inputs remain attested.')).toBeTruthy();
  });

  it.each<[string, Partial<SheetProps>, string]>([
    ['the reason it was given', { readOnlyReason: 'you left the group' }, 'Read-only · you left the group'],
    ['a former member', { row: { ...ROW, former: true } }, 'Read-only · former member'],
    ['recalculating rules', { exercise: { ...EXERCISE, rebuilding: true } }, 'Read-only · rules are recalculating'],
    ['an archived exercise', { exercise: { ...EXERCISE, archived_at_ms: SEP_10 } }, 'Read-only · archived or earlier rules'],
    ['earlier rules', { readOnlyReason: 'archived or earlier rules' }, 'Read-only · archived or earlier rules'],
  ])('is read-only for %s, without a Certify action', (_label, props, line) => {
    renderSheet(props);
    expect(text(line)).toBeTruthy();
    expect(screen.queryByTestId('group-metric-record-certify')).toBeNull();
  });

  it('asks to reconnect offline, disables Certify and reads nothing', () => {
    mockOnline = false;
    renderSheet({ row: ROW });
    expect(text('Reconnect to change certification.')).toBeTruthy();
    expect(screen.getByTestId('group-metric-record-certify')).toBeDisabled();
    expect(mockRead).not.toHaveBeenCalled();
  });

  it('tells me another member can certify my own performance, and offers no Certify', () => {
    renderSheet({ row: { ...ROW, member: { user_id: ME, username: 'me' } } });
    expect(text('Another group member can certify your performance.')).toBeTruthy();
    expect(screen.queryByTestId('group-metric-record-certify')).toBeNull();
  });

  it('switches metric, opens history and opens the full session', () => {
    const onSelectMetric = jest.fn();
    const onHistory = jest.fn();
    renderSheet({ metricOptions: ['volume', 'e1rm'], onSelectMetric, onHistory });
    fireEvent.press(screen.getByTestId('group-metric-record-metric-volume'));
    expect(onSelectMetric).toHaveBeenCalledWith('volume');
    fireEvent.press(screen.getByTestId('group-metric-record-history'));
    expect(onHistory).toHaveBeenCalledTimes(1);
    fireEvent.press(screen.getByTestId('group-metric-record-session'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith('/group-session/dave/session?groupId=group');
  });

  it('hides the metric switch without a handler', () => {
    renderSheet({ metricOptions: ['volume', 'e1rm'] });
    expect(screen.queryByTestId('group-metric-record-metric-volume')).toBeNull();
  });
});

describe('certifying', () => {
  it('certifies with the shown revision and pin, then refreshes and re-reads', async () => {
    mockCertify.mockResolvedValue({ contract_version: 4, certification: certification({ certified_by: { user_id: ME, username: 'me' } }) });
    mockRead.mockResolvedValue({ contract_version: 4, certification: certification({ certified_by: { user_id: ME, username: 'me' } }) });
    renderSheet();
    await act(async () => fireEvent.press(screen.getByTestId('group-metric-record-certify')));
    expect(mockCertify).toHaveBeenCalledWith({
      groupId: 'group',exerciseId: 'pull',metric: 'e1rm',memberId: 'dave',setId: 'set',revision: 2,token: 'pin-1',
    });
    expect(screen.getByTestId('group-metric-record-notice')).toHaveTextContent('Performance certified.');
    expect(onChanged).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(mockRead).toHaveBeenCalledWith('group', 'cert-1', 'e1rm'));
    expect(status()).toHaveTextContent('Certified by me · 11 Sep');
    expect(screen.queryByTestId('group-metric-record-certify')).toBeNull();
  });

  it('disables Certify while the write is pending, so a second press sends nothing', async () => {
    const write = deferred<unknown>();
    mockCertify.mockReturnValue(write.promise);
    renderSheet();
    fireEvent.press(screen.getByTestId('group-metric-record-certify'));
    expect(screen.getByTestId('group-metric-record-certify')).toBeDisabled();
    fireEvent.press(screen.getByTestId('group-metric-record-certify'));
    expect(mockCertify).toHaveBeenCalledTimes(1);
    await act(async () => write.resolve({ contract_version: 4, certification: certification() }));
  });

  it.each(['CONFLICT', 'VALIDATION'] as const)('asks for a review after a %s refusal, and blocks Certify until then', async (code) => {
    mockCertify.mockRejectedValue(new GroupApiError(code, 'The board changed. Review it before certifying.'));
    renderSheet();
    await act(async () => fireEvent.press(screen.getByTestId('group-metric-record-certify')));
    expect(screen.getByTestId('group-metric-record-notice')).toHaveTextContent('The score changed. Refresh and review before retrying. Nothing was changed.');
    expect(screen.getByTestId('group-metric-record-certify')).toBeDisabled();
    expect(onChanged).not.toHaveBeenCalled();
    await act(async () => fireEvent.press(screen.getByTestId('group-metric-record-refresh')));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('shows any other failure without asking for a review', async () => {
    mockCertify.mockRejectedValue(new Error('socket closed'));
    renderSheet();
    await act(async () => fireEvent.press(screen.getByTestId('group-metric-record-certify')));
    expect(screen.getByTestId('group-metric-record-notice')).toHaveTextContent('Could not change certification. Nothing was changed.');
    expect(screen.queryByTestId('group-metric-record-refresh')).toBeNull();
    expect(screen.getByTestId('group-metric-record-certify')).not.toBeDisabled();
  });

  it.each(['FORBIDDEN', 'NOT_FOUND'] as const)('refreshes the screen after a %s refusal', async (code) => {
    mockCertify.mockRejectedValue(new GroupApiError(code, 'Gone.'));
    renderSheet();
    await act(async () => fireEvent.press(screen.getByTestId('group-metric-record-certify')));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('clears the notice and the review when another performance is shown', async () => {
    mockCertify.mockRejectedValue(new GroupApiError('CONFLICT', 'Changed.'));
    const { rerenderWith } = renderSheet();
    await act(async () => fireEvent.press(screen.getByTestId('group-metric-record-certify')));
    expect(screen.getByTestId('group-metric-record-refresh')).toBeTruthy();
    rerenderWith({ row: { ...ROW, write_token: 'pin-2' } });
    expect(screen.queryByTestId('group-metric-record-notice')).toBeNull();
    expect(screen.queryByTestId('group-metric-record-refresh')).toBeNull();
    expect(screen.getByTestId('group-metric-record-certify')).not.toBeDisabled();
  });

  it('still refreshes the screen when the sheet closes mid-write', async () => {
    const write = deferred<unknown>();
    mockCertify.mockReturnValue(write.promise);
    const { unmount } = renderSheet();
    fireEvent.press(screen.getByTestId('group-metric-record-certify'));
    unmount();
    await act(async () => write.resolve({ contract_version: 4, certification: certification() }));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('still refreshes the screen when the sheet closes before a FORBIDDEN refusal', async () => {
    const write = deferred<unknown>();
    mockCertify.mockReturnValue(write.promise);
    const { unmount } = renderSheet();
    fireEvent.press(screen.getByTestId('group-metric-record-certify'));
    unmount();
    await act(async () => write.reject(new GroupApiError('FORBIDDEN', 'No access.')));
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});

describe('ending a certification', () => {
  it('lets the certifier withdraw after confirming', async () => {
    const mine = certification({ certified_by: { user_id: ME, username: 'me' } });
    mockRead.mockResolvedValue({ contract_version: 4, certification: mine });
    mockEnd.mockResolvedValue({ contract_version: 4, certification: { ...mine, ended_at_ms: SEP_11, end_reason: 'withdrawn' } });
    renderSheet({ row: certifiedRow(), myRole: 'owner' });
    await waitFor(() => expect(screen.getByTestId('group-metric-record-withdraw')).toBeTruthy());
    expect(screen.queryByTestId('group-metric-record-cancel')).toBeNull();
    fireEvent.press(screen.getByTestId('group-metric-record-withdraw'));
    expect(alertSpy).toHaveBeenCalledWith(
      'Withdraw certification?',
      'This performance will leave the Certified board. Its logged set stays available on All.',
      expect.any(Array),
    );
    await confirmAlert('Withdraw');
    expect(mockEnd).toHaveBeenCalledWith('group', 'cert-1','e1rm', 'withdraw');
    expect(screen.getByTestId('group-metric-record-notice')).toHaveTextContent('Certification ended.');
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it.each(['owner', 'admin'] as const)("lets an %s cancel another member's certification after confirming", async (myRole) => {
    mockRead.mockResolvedValue({ contract_version: 4, certification: certification() });
    mockEnd.mockResolvedValue({ contract_version: 4, certification: certification({ ended_at_ms: SEP_11, end_reason: 'cancelled' }) });
    renderSheet({ row: certifiedRow(), myRole });
    await waitFor(() => expect(screen.getByTestId('group-metric-record-cancel')).toBeTruthy());
    expect(screen.queryByTestId('group-metric-record-withdraw')).toBeNull();
    fireEvent.press(screen.getByTestId('group-metric-record-cancel'));
    expect(alertSpy.mock.calls[0][0]).toBe('Cancel certification?');
    await confirmAlert('Cancel certification');
    expect(mockEnd).toHaveBeenCalledWith('group', 'cert-1','e1rm', 'cancel');
  });

  it.each<[string, Partial<SheetProps>]>([
    ['a member', { myRole: 'member' }],
    ['someone without a role', { myRole: null }],
    ['a read-only sheet', { myRole: 'owner', readOnlyReason: 'archived' }],
  ])('offers no Cancel to %s', async (_label, props) => {
    renderSheet({ row: certifiedRow(), initialCertification: certification(), ...props });
    await flush();
    expect(screen.queryByTestId('group-metric-record-cancel')).toBeNull();
    expect(screen.queryByTestId('group-metric-record-withdraw')).toBeNull();
  });

  it('does nothing when the confirmation is dismissed with Keep', async () => {
    renderSheet({ row: ROW, initialCertification: certification({ certified_by: { user_id: ME, username: 'me' } }) });
    fireEvent.press(screen.getByTestId('group-metric-record-withdraw'));
    await confirmAlert('Keep');
    expect(mockEnd).not.toHaveBeenCalled();
  });

  // The confirmation keeps the certification it was opened for: the server, not
  // the sheet, refuses ending a certification that has already ended.
  it('still asks the server to end the certification the confirmation was opened for', async () => {
    const read = deferred<unknown>();
    mockRead.mockReturnValue(read.promise);
    const mine = certification({ certified_by: { user_id: ME, username: 'me' } });
    renderSheet({ row: certifiedRow(), initialCertification: mine });
    fireEvent.press(screen.getByTestId('group-metric-record-withdraw'));
    await act(async () => read.resolve({ contract_version: 4, certification: { ...mine, ended_at_ms: SEP_11, end_reason: 'voided' } }));
    expect(status()).toHaveTextContent('Certification ended');
    mockEnd.mockRejectedValue(new GroupApiError('CONFLICT', 'This certification already ended.'));
    await confirmAlert('Withdraw');
    expect(mockEnd).toHaveBeenCalledWith('group', 'cert-1','e1rm', 'withdraw');
    expect(screen.getByTestId('group-metric-record-notice')).toHaveTextContent('The score changed. Refresh and review before retrying. Nothing was changed.');
  });
});

describe('reading the certification', () => {
  it('shows a failed read and offers to refresh and review', async () => {
    mockRead.mockRejectedValueOnce(new GroupApiError('NETWORK', 'Groups are unavailable.'));
    renderSheet({ row: certifiedRow() });
    await waitFor(() => expect(screen.getByTestId('group-metric-record-notice')).toHaveTextContent('Could not refresh certification. Try again.'));
    mockRead.mockResolvedValueOnce({ contract_version: 4, certification: certification() });
    await act(async () => fireEvent.press(screen.getByTestId('group-metric-record-refresh')));
    expect(onChanged).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(status()).toHaveTextContent('Certified by Kim · 11 Sep'));
    expect(mockRead).toHaveBeenCalledTimes(2);
  });

  it('ignores a read that finishes after another performance is shown', async () => {
    const first = deferred<unknown>();
    const second = deferred<unknown>();
    mockRead.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { rerenderWith } = renderSheet({ row: certifiedRow() });
    rerenderWith({ row: certifiedRow({ certification: certification({ certification_id: 'cert-2' }),write_token: 'pin-2' }) });
    await act(async () => second.resolve({ contract_version: 4, certification: certification({ certification_id: 'cert-2', certified_by: { user_id: 'sam', username: 'Sam' } }) }));
    await act(async () => first.resolve({ contract_version: 4, certification: certification() }));
    expect(status()).toHaveTextContent('Certified by Sam · 11 Sep');
  });

  it('ignores a failed read that finishes after another performance is shown', async () => {
    const first = deferred<unknown>();
    mockRead.mockReturnValueOnce(first.promise).mockReturnValueOnce(new Promise(() => {}));
    const { rerenderWith } = renderSheet({ row: certifiedRow() });
    rerenderWith({ row: certifiedRow({ certification: certification({ certification_id: 'cert-2' }),write_token: 'pin-2' }) });
    await act(async () => first.reject(new GroupApiError('NETWORK', 'Late failure.')));
    expect(screen.queryByTestId('group-metric-record-notice')).toBeNull();
  });

  it('ignores a read that finishes after a write started', async () => {
    const read = deferred<unknown>();
    mockRead.mockReturnValueOnce(read.promise).mockReturnValue(new Promise(() => {}));
    mockCertify.mockResolvedValue({
      contract_version: 4,
      certification: certification({ certification_id: 'cert-0', certified_by: { user_id: ME, username: 'me' } }),
    });
    renderSheet({ row: certifiedRow({ certification: certification({ certification_id: 'cert-0' }) }),initialCertification: certification({ certification_id: 'cert-0',ended_at_ms: SEP_10,end_reason: 'withdrawn' }) });
    await act(async () => fireEvent.press(screen.getByTestId('group-metric-record-certify')));
    await act(async () => read.resolve({ contract_version: 4, certification: certification({ certification_id: 'cert-0', ended_at_ms: SEP_10, end_reason: 'voided' }) }));
    expect(status()).toHaveTextContent('Certified by me · 11 Sep');
  });

  it('ignores reads that finish after the sheet closes', async () => {
    const read = deferred<unknown>();
    const failed = deferred<unknown>();
    mockRead.mockReturnValueOnce(read.promise);
    const first = renderSheet({ row: certifiedRow() });
    first.unmount();
    await act(async () => read.resolve({ contract_version: 4, certification: certification() }));
    mockRead.mockReturnValueOnce(failed.promise);
    const second = renderSheet({ row: certifiedRow() });
    second.unmount();
    await act(async () => failed.reject(new GroupApiError('NETWORK', 'Late.')));
    expect(mockRead).toHaveBeenCalledTimes(2);
  });
});

describe('what a write is remembered as', () => {
  const certifyMine = async () => {
    const mine = certification({ certified_by: { user_id: ME, username: 'me' } });
    mockCertify.mockResolvedValue({ contract_version: 4, certification: mine });
    mockRead.mockResolvedValue({ contract_version: 4, certification: mine });
    const view = renderSheet();
    await act(async () => fireEvent.press(screen.getByTestId('group-metric-record-certify')));
    await waitFor(() => expect(status()).toHaveTextContent('Certified by me · 11 Sep'));
    return { view, mine };
  };

  it('keeps showing my certification while the board catches up', async () => {
    const { view } = await certifyMine();
    mockOnline = false;
    view.rerenderWith({});
    expect(status()).toHaveTextContent('Certified by me · 11 Sep');
  });

  it('keeps the server end state of my certification across a connectivity change', async () => {
    const { view, mine } = await certifyMine();
    mockRead.mockResolvedValue({ contract_version: 4, certification: { ...mine, ended_at_ms: SEP_11, end_reason: 'cancelled' } });
    mockOnline = null;
    view.rerenderWith({});
    await waitFor(() => expect(status()).toHaveTextContent('Certification ended'));
    mockOnline = false;
    view.rerenderWith({});
    expect(status()).toHaveTextContent('Certification ended');
  });

  it('keeps showing the certification read from the server when it is not mine', async () => {
    const { view } = await certifyMine();
    mockRead.mockResolvedValue({ contract_version: 4, certification: certification({ certification_id: 'cert-9' }) });
    view.rerenderWith({ row: certifiedRow({ certification: certification({ certification_id: 'cert-9' }) }) });
    await waitFor(() => expect(status()).toHaveTextContent('Certified by Kim · 11 Sep'));
  });

  it('forgets it when the performance changes', async () => {
    const { view } = await certifyMine();
    view.rerenderWith({ row: { ...ROW, write_token: 'pin-2' } });
    expect(status()).toHaveTextContent('Uncertified');
  });

  it('forgets it when the sheet turns read-only with no certification on the row', async () => {
    const { view } = await certifyMine();
    view.rerenderWith({ readOnlyReason: 'you left the group', initialCertification: null });
    expect(status()).toHaveTextContent('Uncertified');
  });
});

describe('current target and confirmed outcomes', () => {
  it('refuses a saved native confirmation after an account switch', async () => {
    const mine=certification({ certified_by: { user_id: ME,username: 'me' } });
    const view=renderSheet({ row: certifiedRow({ certification: mine }),initialCertification: mine });
    fireEvent.press(screen.getByTestId('group-metric-record-withdraw'));
    view.rerenderWith({ userId: 'different-account',row: certifiedRow({ certification: mine }),initialCertification: mine });
    await confirmAlert('Withdraw');
    expect(mockEnd).not.toHaveBeenCalled();
  });
  it.each<[string,Partial<SheetProps>]>([
    ['offline',{}],['archived',{ exercise: { ...EXERCISE,archived_at_ms: SEP_11 } }],
    ['rebuilding',{ exercise: { ...EXERCISE,rebuilding: true,published_revision: 1 } }],
    ['read-only',{ readOnlyReason: 'you left the group' }],['former',{ row: certifiedRow({ former: true }) }],
  ])('refuses a saved native confirmation after becoming %s',async(kind,changed)=>{
    const mine=certification({ certified_by: { user_id: ME,username: 'me' } });
    const view=renderSheet({ row: certifiedRow({ certification: mine }),initialCertification: mine });
    fireEvent.press(screen.getByTestId('group-metric-record-withdraw'));
    if(kind==='offline') mockOnline=false;
    view.rerenderWith({ row: certifiedRow({ certification: mine }),initialCertification: mine,...changed });
    await confirmAlert('Withdraw');
    expect(mockEnd).not.toHaveBeenCalled();
  });
  it('refuses a saved native confirmation after closing the sheet', async () => {
    const mine=certification({ certified_by: { user_id: ME,username: 'me' } });
    const view=renderSheet({ row: certifiedRow({ certification: mine }),initialCertification: mine });
    fireEvent.press(screen.getByTestId('group-metric-record-withdraw'));
    view.unmount();
    await confirmAlert('Withdraw');
    expect(mockEnd).not.toHaveBeenCalled();
  });
  it('keeps a server-observed terminal certification ended through connectivity changes', async () => {
    mockRead.mockResolvedValue({ contract_version: 4,certification: certification({ ended_at_ms: SEP_11,end_reason: 'voided' }) });
    const view=renderSheet({ row: certifiedRow() });
    await waitFor(() => expect(status()).toHaveTextContent('Certification ended'));
    mockOnline=false;
    view.rerenderWith({ row: certifiedRow() });
    expect(status()).toHaveTextContent('Certification ended');
    expect(screen.queryByTestId('group-metric-record-withdraw')).toBeNull();
  });
  it('preserves a confirmed success when its following refresh fails', async () => {
    mockCertify.mockResolvedValue({ contract_version: 4,certification: certification() });
    onChanged.mockRejectedValue(new GroupApiError('NETWORK','refresh failed'));
    renderSheet();
    await act(async () => fireEvent.press(screen.getByTestId('group-metric-record-certify')));
    expect(status()).toHaveTextContent('Certified by Kim · 11 Sep');
    expect(screen.getByTestId('group-metric-record-notice')).toHaveTextContent('Certification changed. Could not refresh the view. Refresh and review.');
    expect(screen.getByTestId('group-metric-record-refresh')).toBeOnTheScreen();
  });
  it('requires verification after an uncertain transport result', async () => {
    mockCertify.mockRejectedValue(new GroupApiError('NETWORK','response lost'));
    renderSheet();
    await act(async () => fireEvent.press(screen.getByTestId('group-metric-record-certify')));
    expect(screen.getByTestId('group-metric-record-notice')).toHaveTextContent('Could not confirm the result. Reconnect and refresh before retrying.');
    expect(screen.getByTestId('group-metric-record-certify')).toBeDisabled();
  });
});

it('blocks a second metric write while the first target is still pending', async () => {
  const write=deferred<unknown>();
  mockCertify.mockReturnValue(write.promise);
  const view=renderSheet();
  fireEvent.press(screen.getByTestId('group-metric-record-certify'));
  const volume: CompetitionBoardRowWire={ ...ROW,metric: 'volume',unit: 'percent_bw_reps',value: 500 };
  view.rerenderWith({ row: volume });
  fireEvent.press(screen.getByTestId('group-metric-record-certify'));
  view.rerenderWith({ row: ROW });
  fireEvent.press(screen.getByTestId('group-metric-record-certify'));
  expect(mockCertify).toHaveBeenCalledTimes(1);
  await act(async () => write.resolve({ contract_version: 4,certification: certification() }));
});

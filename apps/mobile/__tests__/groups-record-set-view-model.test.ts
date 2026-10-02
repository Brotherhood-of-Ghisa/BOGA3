/**
 * M25-T10 record set row detail (card AC4, AC5 wording; product E2, P10–P13,
 * D3–D5; groups contract §4.6): the detail built from a board row or a stream
 * record, the action matrix for every relationship × state, the sheet's lines,
 * and the wording of every write outcome.
 */

import {
  GroupApiError,
  buildRecordSetSheet,
  certificationRefFrom,
  describeCertificationEndSuccess,
  describeCertificationError,
  describeCertifySuccess,
  formatLoggedValue,
  recordSetActionsFor,
  recordSetFromBoardRow,
  recordSetFromStreamRecord,
  shouldRefreshAfterCertificationError,
  WRITTEN_CERTIFICATION_HOLD_MS,
  writtenCertificationSettled,
  GROUP_OFFLINE_ACTION_MESSAGE,
  type BoardRow,
  type GroupExercise,
  type GroupRole,
  type RecordSetDetail,
} from '@/src/groups';

import { RECORD_AT_MS, certificationPayload, recordItem, sessionCardItem } from './helpers/group-record-fixtures';

const exercise: GroupExercise = {
  group_exercise_id: 'ge-bench',
  name: 'Bench Press',
  load_input_mode: 'per_side_load',
  source_exercise_id: null,
  archived_at_ms: null,
};

const boardRow = (overrides: Partial<BoardRow> = {}): BoardRow => ({
  rank: 1,
  member: { user_id: 'u2', username: 'dave' },
  former: false,
  value_kg: 51.25,
  weight_kg: 51.25,
  reps: 5,
  e1rm_kg: 59.79,
  entered_weight_kg: 102.5,
  load_factor: 0.5,
  achieved_at_ms: RECORD_AT_MS,
  session_id: 's1',
  set_id: 'set-1',
  exercise_name: 'Bench Press',
  certified: false,
  certification: null,
  ...overrides,
});

const CERT = { certification_id: 'cert-1', certified_by: { user_id: 'cert', username: 'sam' }, certified_at_ms: RECORD_AT_MS };

describe('record set detail sources', () => {
  it('builds from a board row with the archive and former flags', () => {
    expect(recordSetFromBoardRow('g1', { ...exercise, archived_at_ms: 5 }, boardRow({ former: true }))).toEqual({
      groupId: 'g1',
      groupExerciseId: 'ge-bench',
      groupExerciseName: 'Bench Press',
      archived: true,
      member: { user_id: 'u2', username: 'dave' },
      weightKg: 51.25,
      reps: 5,
      e1rmKg: 59.79,
      enteredWeightKg: 102.5,
      loadFactor: 0.5,
      achievedAtMs: RECORD_AT_MS,
      sessionId: 's1',
      setId: 'set-1',
      exerciseName: 'Bench Press',
      certification: null,
      voidedReason: null,
      provisional: false,
      former: true,
    });
  });

  it('builds from a stream record; certification counts only when `certified`', () => {
    const detail = recordSetFromStreamRecord(
      recordItem({ provisional: true, voided: { key: 'v', reason: 'edited', occurred_at_ms: 1 }, certification: CERT }),
    );
    expect(detail).toMatchObject({
      groupId: 'g1',
      archived: null,
      exerciseName: null,
      certification: null,
      voidedReason: 'edited',
      provisional: true,
      former: false,
    });
    expect(recordSetFromStreamRecord(recordItem({ certified: true, certification: CERT })).certification).toEqual(CERT);
  });

  it('maps a returned certification: active → ref, ended → null', () => {
    expect(certificationRefFrom(certificationPayload())).toEqual({
      certification_id: 'cert-1',
      certified_by: { user_id: 'me', username: 'me' },
      certified_at_ms: RECORD_AT_MS + 600_000,
    });
    expect(certificationRefFrom(certificationPayload({ ended_at_ms: 1, end_reason: 'withdrawn' }))).toBeNull();
  });
});

describe('recordSetActionsFor (P10–P11, D3–D5)', () => {
  const base = recordSetFromStreamRecord(recordItem());
  const states: Record<string, Partial<RecordSetDetail>> = {
    uncertified: {},
    certified: { certification: CERT },
    voided: { voidedReason: 'deleted' },
    archived: { archived: true },
    former: { former: true },
  };
  const viewers: Record<string, { me: string; role: GroupRole }> = {
    lifter: { me: 'u2', role: 'member' },
    certifier: { me: 'cert', role: 'member' },
    certifierAdmin: { me: 'cert', role: 'admin' },
    owner: { me: 'owner', role: 'owner' },
    admin: { me: 'admin', role: 'admin' },
    member: { me: 'other', role: 'member' },
  };
  const expected: Record<string, Record<string, string[]>> = {
    uncertified: { lifter: [], certifier: ['certify'], certifierAdmin: ['certify'], owner: ['certify'], admin: ['certify'], member: ['certify'] },
    certified: { lifter: [], certifier: ['withdraw'], certifierAdmin: ['withdraw'], owner: ['cancel'], admin: ['cancel'], member: [] },
    voided: { lifter: [], certifier: [], certifierAdmin: [], owner: [], admin: [], member: [] },
    archived: { lifter: [], certifier: [], certifierAdmin: [], owner: [], admin: [], member: [] },
    former: { lifter: [], certifier: [], certifierAdmin: [], owner: [], admin: [], member: [] },
  };

  for (const [stateName, state] of Object.entries(states)) {
    for (const [viewerName, viewer] of Object.entries(viewers)) {
      it(`${stateName} set, ${viewerName}: ${expected[stateName][viewerName].join(', ') || 'nothing'}`, () => {
        expect(recordSetActionsFor({ ...base, ...state }, viewer.me, viewer.role)).toEqual(expected[stateName][viewerName]);
      });
    }
  }

  it('an unknown role hides Cancel; no user offers nothing', () => {
    expect(recordSetActionsFor({ ...base, certification: CERT }, 'owner', null)).toEqual([]);
    expect(recordSetActionsFor(base, null, 'owner')).toEqual([]);
  });

  it('a certification whose certifier account is gone can only be cancelled', () => {
    const orphaned = { ...base, certification: { ...CERT, certified_by: null } };
    expect(recordSetActionsFor(orphaned, 'owner', 'owner')).toEqual(['cancel']);
    expect(recordSetActionsFor(orphaned, 'other', 'member')).toEqual([]);
  });
});

describe('the sheet (E2)', () => {
  const now = new Date(2026, 8, 17).getTime();

  it('converted board row: value with 1RM, the logged line, date, logged-as, certify', () => {
    expect(
      buildRecordSetSheet(recordSetFromBoardRow('g1', exercise, boardRow()), {
        myUserId: 'me',
        myRole: 'owner',
        session: null,
        sessionMissing: false,
        nowMs: now,
      }),
    ).toEqual({
      title: 'dave · Bench Press',
      valueLabel: '51.25 × 5 · 1RM 59.8',
      setFigure: '51.25 × 5',
      oneRepMaxFigure: '59.8',
      loggedLabel: 'Logged 102.5 kg total · counted as 51.25 kg per side',
      dateLabel: '12 Sep 2026',
      loggedAsLabel: 'Logged as "Bench Press"',
      provisionalLabel: null,
      statusLabel: 'Not certified yet',
      status: 'uncertified',
      lifterNote: null,
      actions: ['certify'],
      canViewSession: true,
    });
  });

  it('stream record: gym and logged-as from the session detail; certified line with date; lifter note', () => {
    const session = { ...sessionCardItem(), gym_name: ' Iron Temple ' };
    const detail = recordSetFromStreamRecord(recordItem({ e1rm_kg: null, provisional: true }));
    const mine = buildRecordSetSheet(
      { ...detail, member: { user_id: 'me', username: 'me' } },
      { myUserId: 'me', myRole: 'member', session, sessionMissing: false, nowMs: now },
    );
    expect(mine).toMatchObject({
      title: 'You · Bench Press',
      valueLabel: '140.0 × 1',
      setFigure: '140.0 × 1',
      oneRepMaxFigure: null,
      loggedLabel: null,
      dateLabel: '12 Sep 2026 · Iron Temple',
      loggedAsLabel: 'Logged as "Bench (comp grip)"',
      provisionalLabel: 'Session in progress',
      lifterNote: 'Other members can certify this set.',
      actions: [],
    });

    const certified = buildRecordSetSheet(
      { ...detail, certification: CERT },
      { myUserId: 'me', myRole: 'member', session: null, sessionMissing: false, nowMs: now },
    );
    expect(certified).toMatchObject({
      statusLabel: 'Certified by sam · 12 Sep',
      status: 'certified',
      loggedAsLabel: null,
      lifterNote: null,
    });
  });

  it('hides View full session for a deleted set or a missing session; words voided', () => {
    const detail = recordSetFromStreamRecord(recordItem({ voided: { key: 'v', reason: 'deleted', occurred_at_ms: 1 } }));
    expect(
      buildRecordSetSheet(detail, { myUserId: 'me', myRole: 'owner', session: null, sessionMissing: false, nowMs: now }),
    ).toMatchObject({ statusLabel: 'Voided · set deleted', status: 'voided', canViewSession: false, actions: [] });
    expect(
      buildRecordSetSheet(recordSetFromStreamRecord(recordItem()), {
        myUserId: 'me',
        myRole: 'owner',
        session: null,
        sessionMissing: true,
        nowMs: now,
      }).canViewSession,
    ).toBe(false);
  });

  it('words the logged value for each load factor', () => {
    expect(formatLoggedValue({ enteredWeightKg: 70, weightKg: 140, loadFactor: 2 })).toBe('Logged 70 kg per side · counted as 140 kg total');
    expect(formatLoggedValue({ enteredWeightKg: 140, weightKg: 70, loadFactor: 0.5 })).toBe('Logged 140 kg total · counted as 70 kg per side');
    expect(formatLoggedValue({ enteredWeightKg: 140, weightKg: 140, loadFactor: 1 })).toBeNull();
    expect(formatLoggedValue({ enteredWeightKg: 1, weightKg: 3, loadFactor: 3 })).toBe('Logged 1 kg · counted as 3 kg');
  });
});

describe('write outcomes', () => {
  const lifter = { user_id: 'u2', username: 'dave' };

  it('words a new certification, an existing one, and a removal', () => {
    expect(describeCertifySuccess({ certification: certificationPayload(), created: true }, 'me')).toBe(
      'Certified. Certified boards update in a few seconds.',
    );
    expect(
      describeCertifySuccess(
        { certification: certificationPayload({ certified_by: { user_id: 'u3', username: 'sam' } }), created: false },
        'me',
      ),
    ).toBe('Already certified by sam.');
    expect(describeCertifySuccess({ certification: certificationPayload(), created: false }, 'me')).toBe('Already certified by you.');
    expect(describeCertifySuccess({ certification: certificationPayload({ certified_by: null }), created: false }, 'me')).toBe(
      'Already certified.',
    );

    const ended = (end_reason: 'withdrawn' | 'cancelled' | 'voided', endedBy: string | null) =>
      certificationPayload({ ended_at_ms: 1, end_reason, ended_by: endedBy ? { user_id: endedBy, username: null } : null });
    expect(describeCertificationEndSuccess('withdraw', ended('withdrawn', 'me'), 'me')).toBe('Your certification was removed.');
    expect(describeCertificationEndSuccess('cancel', ended('cancelled', 'me'), 'me')).toBe('Certification cancelled.');
    expect(describeCertificationEndSuccess('cancel', ended('cancelled', 'u9'), 'me')).toBe('This certification was already removed.');
    expect(describeCertificationEndSuccess('withdraw', ended('voided', null), 'me')).toBe('This certification was already removed.');
  });

  it('words every failure and says which ones refresh the host', () => {
    const cases: [GroupApiError, 'certify' | 'withdraw' | 'cancel', string, boolean][] = [
      [new GroupApiError('CONFLICT', 'the set changed; refresh and try again'), 'certify', 'This set changed since it loaded. Nothing was certified — refresh and try again.', true],
      [new GroupApiError('NOT_FOUND', 'record set not found'), 'certify', 'This set is no longer a record. Nothing was certified.', true],
      [new GroupApiError('NOT_FOUND', 'member not found'), 'certify', "dave is no longer a member, so this set can't be certified.", true],
      [new GroupApiError('NOT_FOUND', 'certification not found'), 'withdraw', 'This certification no longer exists.', true],
      [new GroupApiError('NOT_FOUND', 'group exercise not found'), 'certify', 'This exercise is no longer in this group. Nothing was changed.', true],
      [new GroupApiError('NOT_FOUND', 'group not found'), 'cancel', "You're no longer a member of this group.", false],
      [new GroupApiError('FORBIDDEN', 'only the owner or an admin can cancel a certification'), 'cancel', 'Only owners and admins can cancel a certification.', true],
      [new GroupApiError('FORBIDDEN', 'only the certifier can withdraw a certification'), 'withdraw', 'Only the certifier can remove it.', true],
      [new GroupApiError('VALIDATION', 'an archived group exercise is read-only; unarchive it first'), 'certify', 'This exercise is archived. Its boards are read-only.', true],
      [new GroupApiError('VALIDATION', 'you cannot certify your own set'), 'certify', 'you cannot certify your own set', true],
      [new GroupApiError('NETWORK', GROUP_OFFLINE_ACTION_MESSAGE), 'certify', GROUP_OFFLINE_ACTION_MESSAGE, false],
      [new GroupApiError('NETWORK', 'Failed to fetch'), 'certify', "Couldn't reach the server. Nothing was changed — try again when you're online.", false],
      [new GroupApiError('INTERNAL', 'boom'), 'certify', 'Something went wrong. Nothing was changed.', false],
      [new GroupApiError('AUTH_REQUIRED', 'x'), 'certify', 'Sign in again to continue.', false],
    ];
    for (const [error, action, message, refresh] of cases) {
      expect(describeCertificationError(error, action, lifter)).toBe(message);
      expect(shouldRefreshAfterCertificationError(error)).toBe(refresh);
    }
  });
});

describe('the written certification settles', () => {
  const written = { setKey: 'ge:u2:set-1', certification: CERT, writtenAtMs: 1_000 };
  const cleared = { ...written, certification: null };

  it('once the host data agrees, or the set is not loaded and the hold has passed', () => {
    expect(writtenCertificationSettled(written, CERT, 1_001)).toBe(true);
    expect(writtenCertificationSettled(cleared, null, 1_001)).toBe(true);
    // A stale read (still uncertified, or a different certification) does not settle it yet.
    expect(writtenCertificationSettled(written, null, 1_001)).toBe(false);
    expect(writtenCertificationSettled(cleared, CERT, 1_001)).toBe(false);
    expect(writtenCertificationSettled(written, { ...CERT, certification_id: 'other' }, 1_001)).toBe(false);
    expect(writtenCertificationSettled(written, undefined, 1_001)).toBe(false);
    // After the hold the host's data wins.
    expect(writtenCertificationSettled(written, null, 1_000 + WRITTEN_CERTIFICATION_HOLD_MS + 1)).toBe(true);
  });
});

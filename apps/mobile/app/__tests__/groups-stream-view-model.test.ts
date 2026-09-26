/**
 * Pure stream presentation (groups contract §6.1): C7.2 status wording, C7.3
 * membership sentences, the "Unnamed member" fallback, kg formatting, the
 * filter chips, and (M25-T10, card AC3) record cards, record-removed and link
 * sentences, records grouped under their session card, and paging over every
 * item kind.
 */

import {
  UNNAMED_MEMBER_LABEL,
  buildStreamFilterChips,
  buildStreamItemViewModel,
  buildStreamViewModel,
  formatClockTime,
  formatGroupDateTime,
  formatKg,
  formatMemberCount,
  formatMyRole,
  formatOfflineMarker,
  groupsStreamPath,
  resolveSelectedGroupId,
  formatStreamStartedAt,
  formatMemberName,
  formatMembershipSentence,
  formatSessionStatusLabel,
  formatVolumeKg,
  mergeStreamPages,
  type GroupSessionSet,
  type StreamRecordCardViewModel,
  type StreamSessionCardViewModel,
  type StreamMembershipItem,
  type StreamSessionItem,
} from '@/src/groups';

import { holder, linkItem, recordItem, sessionCardItem, voidedItem } from './helpers/group-record-fixtures';

const DAY_MS = 24 * 60 * 60 * 1000;

const rawSet = (
  setId: string,
  weight: string,
  reps: string,
  overrides: Partial<GroupSessionSet> = {},
): GroupSessionSet => ({
  set_id: setId,
  order_index: 0,
  weight_value: weight,
  reps_value: reps,
  set_type: 'working',
  performance_status: null,
  ...overrides,
});

const sessionItem = (overrides: Partial<StreamSessionItem> = {}): StreamSessionItem => ({
  kind: 'session',
  key: 'u2:s1',
  sort_at_ms: 1_757_500_000_000,
  member: { user_id: 'u2', username: 'dana' },
  session_id: 's1',
  groups: [
    { group_id: 'g1', name: 'Crew' },
    { group_id: 'g2', name: 'Gym pals' },
  ],
  gym_name: 'Iron Temple',
  status: 'completed',
  started_at_ms: 1_757_500_000_000,
  completed_at_ms: 1_757_503_900_000,
  duration_sec: 3_900,
  exercises: [
    {
      session_exercise_id: 'e1',
      name: 'Bench Press',
      machine_name: null,
      order_index: 0,
      sets: [
        rawSet('s1', '102.5', '5'),
        rawSet('s2', '110', '5', { order_index: 1, performance_status: 'planned' }),
        rawSet('s3', '60', '10', { order_index: 2, set_type: 'warm_up' }),
      ],
    },
    { session_exercise_id: 'e2', name: 'Barbell Row', machine_name: null, order_index: 1, sets: [rawSet('s4', '80', '8')] },
  ],
  ...overrides,
});

const membershipItem = (overrides: Partial<StreamMembershipItem> = {}): StreamMembershipItem => ({
  kind: 'membership',
  key: 'm1:joined',
  sort_at_ms: 1_757_400_000_000,
  event: 'joined',
  group: { group_id: 'g1', name: 'Crew' },
  member: { user_id: 'u2', username: 'dana' },
  ...overrides,
});

describe('group stream view model', () => {
  describe('session status (C7.2)', () => {
    it('reads "Training now" for an active session regardless of age', () => {
      const now = Date.now();
      const statuses = [0, 1, 30].map((daysAgo) =>
        formatSessionStatusLabel(
          sessionItem({ status: 'active', started_at_ms: now - daysAgo * DAY_MS, completed_at_ms: null, duration_sec: null }),
        ),
      );

      expect(statuses).toEqual(['Training now', 'Training now', 'Training now']);
    });

    it('reads "Completed · <compact duration>" for a completed session', () => {
      expect(formatSessionStatusLabel(sessionItem({ duration_sec: 3_900 }))).toBe('Completed · 1h 5m');
      expect(formatSessionStatusLabel(sessionItem({ duration_sec: 45 * 60 }))).toBe('Completed · 45m');
      expect(formatSessionStatusLabel(sessionItem({ duration_sec: 2 * 3_600 }))).toBe('Completed · 2h');
    });

    it('derives the duration from the timestamps when duration_sec is null', () => {
      expect(
        formatSessionStatusLabel(sessionItem({ duration_sec: null, started_at_ms: 0, completed_at_ms: 90 * 60 * 1000 })),
      ).toBe('Completed · 1h 30m');
    });

    it('reads plain "Completed" when no duration can be known', () => {
      expect(formatSessionStatusLabel(sessionItem({ duration_sec: null, completed_at_ms: null }))).toBe('Completed');
    });
  });

  describe('member names', () => {
    it('falls back to "Unnamed member" for a null or blank username', () => {
      expect(formatMemberName(null)).toBe(UNNAMED_MEMBER_LABEL);
      expect(formatMemberName('   ')).toBe('Unnamed member');
      expect(formatMemberName('  dana ')).toBe('dana');
    });
  });

  describe('membership sentences (C7.3)', () => {
    it('uses the contract wording for each event', () => {
      expect(formatMembershipSentence('joined', 'dana')).toBe('dana joined');
      expect(formatMembershipSentence('left', 'dana')).toBe('dana left the group');
      expect(formatMembershipSentence('removed', 'dana')).toBe('dana was removed');
    });

    it('uses the fallback name for a null username', () => {
      expect(formatMembershipSentence('removed', null)).toBe('Unnamed member was removed');
    });
  });

  describe('kg formatting', () => {
    it('formats volume in kg with no thousands separators and at most two decimals', () => {
      expect(formatVolumeKg(5230.5)).toBe('5230.5 kg');
      expect(formatVolumeKg(0)).toBe('0 kg');
      expect(formatVolumeKg(1_234_567.891)).toBe('1234567.89 kg');
      expect(formatVolumeKg(999)).toBe('999 kg');
      expect(formatKg(62.25)).toBe('62.25');
      expect(formatKg(Number.NaN)).toBe('-');
    });
  });

  describe('item view models', () => {
    it('builds a session card with status, device-computed metrics, and groups', () => {
      expect(buildStreamItemViewModel(sessionItem())).toEqual({
        kind: 'session',
        key: 'u2:s1',
        memberUserId: 'u2',
        sessionId: 's1',
        memberName: 'dana',
        isTrainingNow: false,
        statusLabel: 'Completed · 1h 5m',
        startedAtLabel: formatStreamStartedAt(1_757_500_000_000),
        gymName: 'Iron Temple',
        groupNames: ['Crew', 'Gym pals'],
        setsLabel: '3 sets',
        volumeLabel: '1752.5 kg',
        exercisesLabel: '2 exercises',
        recordsLabel: null,
      });
    });

    it('pluralizes single counts and flags an active card', () => {
      const card = buildStreamItemViewModel(
        sessionItem({
          status: 'active',
          completed_at_ms: null,
          duration_sec: null,
          member: { user_id: 'u2', username: null },
          exercises: [
            { session_exercise_id: 'e1', name: 'Curl', machine_name: null, order_index: 0, sets: [rawSet('s1', '60', '1')] },
          ],
        }),
      );

      expect(card).toMatchObject({
        memberName: 'Unnamed member',
        isTrainingNow: true,
        statusLabel: 'Training now',
        setsLabel: '1 set',
        exercisesLabel: '1 exercise',
        volumeLabel: '60 kg',
      });
    });

    it('builds membership items and keeps stream order', () => {
      const models = buildStreamViewModel([
        sessionItem(),
        membershipItem({ key: 'm1:ended', event: 'left' }),
        membershipItem(),
      ]);

      expect(models.map((model) => model.key)).toEqual(['u2:s1', 'm1:ended', 'm1:joined']);
      expect(models[1]).toEqual({ kind: 'membership', key: 'm1:ended', sentence: 'dana left the group', groupId: 'g1', groupName: 'Crew' });
    });
  });

  describe('time, offline marker, and role wording', () => {
    const at = new Date(2026, 8, 7, 6, 4).getTime();

    it('formats local times for cards, the friend view, and the offline marker (contract §7)', () => {
      expect(formatClockTime(at)).toBe('06:04');
      expect(formatStreamStartedAt(at)).toBe('9/7 06:04');
      expect(formatGroupDateTime(at)).toBe('2026-09-07 06:04');
      expect(formatOfflineMarker(at)).toBe('Offline · last updated 06:04');
      expect(formatOfflineMarker(null)).toBe('Offline');
    });

    it('words member counts and my role', () => {
      expect([formatMemberCount(1), formatMemberCount(3)]).toEqual(['1 member', '3 members']);
      expect(['owner', 'admin', 'member'].map((role) => formatMyRole(role as 'owner'))).toEqual([
        "You're the owner",
        "You're an admin",
        "You're a member",
      ]);
    });
  });

  describe('filter chips', () => {
    const groups = [
      { group_id: 'g1', name: 'Crew' },
      { group_id: 'g2', name: 'Gym pals' },
    ];

    it('is one chip per group, with no All chip', () => {
      expect(buildStreamFilterChips(groups, 'g1')).toEqual([
        { key: 'g1', label: 'Crew', groupId: 'g1', selected: true },
        { key: 'g2', label: 'Gym pals', groupId: 'g2', selected: false },
      ]);
      expect(buildStreamFilterChips([], null)).toEqual([]);
    });

    it('selects the chosen group', () => {
      expect(buildStreamFilterChips(groups, 'g2').map((chip) => chip.selected)).toEqual([false, true]);
    });

    it('resolves the shown group: the first candidate still in My groups, else the first group', () => {
      expect(resolveSelectedGroupId(groups, 'g2', 'g1')).toBe('g2');
      expect(resolveSelectedGroupId(groups, 'gone', 'g2')).toBe('g2');
      expect(resolveSelectedGroupId(groups, null, undefined)).toBe('g1');
      expect(resolveSelectedGroupId([], 'g1')).toBeNull();
    });

    it('links to the Groups screen with a group selected', () => {
      expect(groupsStreamPath('g2')).toBe('/groups?groupId=g2');
    });
  });
});

describe('board stream items (M25-T10)', () => {
  const card = (item: Parameters<typeof buildStreamItemViewModel>[0], me: string | null = 'me') =>
    buildStreamItemViewModel(item, me) as StreamRecordCardViewModel;
  const sentence = (item: Parameters<typeof buildStreamItemViewModel>[0], me: string | null = 'me') =>
    (buildStreamItemViewModel(item, me) as { sentence: string }).sentence;

  describe('record cards (E3, P14, P15)', () => {
    it('titles a group record, lists badges Weight then 1RM, and shows the 1RM figure', () => {
      expect(card(recordItem())).toMatchObject({
        kind: 'record',
        title: 'dave — group record',
        exerciseLabel: 'Bench Press',
        valueLabel: '140.0 × 1 · 1RM 142.5',
        badges: ['PR · Weight', 'Group record · Weight', 'PR · 1RM'],
        statusLabel: 'Not certified yet',
        status: 'uncertified',
        provisionalLabel: null,
        voided: false,
        canCertify: true,
        groupId: 'g1',
        groupName: 'Crew',
      });
    });

    it('a PR without a 1RM board shows the set only; my own record reads You and offers no Certify', () => {
      const mine = card(
        recordItem({
          member: { user_id: 'me', username: 'me' },
          boards: [{ metric: 'weight', value_kg: 140, previous_value_kg: null, group_record: false }],
        }),
      );
      expect(mine).toMatchObject({ title: 'You — PR', valueLabel: '140.0 × 1', badges: ['PR · Weight'], canCertify: false });
      expect(card(recordItem(), null).canCertify).toBe(false);
    });

    it('words certified by another member, by me, and by a deleted account', () => {
      const certified = (certifiedBy: { user_id: string; username: string | null } | null) =>
        card(
          recordItem({
            certified: true,
            certification: { certification_id: 'c1', certified_by: certifiedBy, certified_at_ms: 1 },
          }),
        );
      expect(certified({ user_id: 'u3', username: 'sam' })).toMatchObject({
        statusLabel: 'Certified by sam',
        status: 'certified',
        canCertify: false,
      });
      expect(certified({ user_id: 'me', username: 'me' }).statusLabel).toBe('Certified by you');
      expect(certified({ user_id: 'u3', username: null }).statusLabel).toBe('Certified by Unnamed member');
      expect(certified(null).statusLabel).toBe('Certified');
    });

    it('marks provisional and voided cards; a voided card is never certifiable', () => {
      expect(card(recordItem({ provisional: true })).provisionalLabel).toBe('Session in progress');
      for (const reason of ['edited', 'deleted'] as const) {
        expect(
          card(recordItem({ provisional: true, voided: { key: 'v1', reason, occurred_at_ms: 2 }, certified: true })),
        ).toMatchObject({
          statusLabel: `Voided · set ${reason}`,
          status: 'voided',
          voided: true,
          canCertify: false,
          provisionalLabel: null,
        });
      }
    });
  });

  describe('record-removed sentences (D15)', () => {
    it('names each board\'s new holder, Weight first, or nobody', () => {
      expect(sentence(voidedItem())).toBe(
        "dave's Bench Press record removed (140 kg × 1) — set edited · Now #1 on Weight: sam 138 kg · No one holds #1 on 1RM",
      );
    });

    it('reads Your / You for me and words a deleted set', () => {
      expect(
        sentence(
          voidedItem({
            member: { user_id: 'me', username: 'me' },
            reason: 'deleted',
            leaders: [{ metric: 'e1rm', leader: holder('me', 'me', 120.25) }],
          }),
        ),
      ).toBe('Your Bench Press record removed (140 kg × 1) — set deleted · Now #1 on 1RM: You 120.25 kg');
    });
  });

  describe('link sentences (P16)', () => {
    it('merges a shared rank across both metrics', () => {
      expect(sentence(linkItem())).toBe('dave linked Bench (comp grip) to Bench Press — now #1 on Weight and 1RM');
    });

    it('lists mixed ranks and boards left, and words an unlink', () => {
      expect(
        sentence(
          linkItem({
            exercises: [
              { exercise_definition_id: 'a', name: 'Bench' },
              { exercise_definition_id: 'b', name: null },
            ],
            effects: [
              { metric: 'e1rm', before: null, after: { rank: 1, value_kg: 150 } },
              { metric: 'weight', before: null, after: { rank: 2, value_kg: 140 } },
            ],
          }),
        ),
      ).toBe('dave linked Bench, an exercise to Bench Press — now #2 on Weight, #1 on 1RM');
      expect(
        sentence(
          linkItem({
            event: 'unlink',
            member: { user_id: 'me', username: 'me' },
            exercises: [],
            effects: [
              { metric: 'weight', before: { rank: 1, value_kg: 140 }, after: null },
              { metric: 'e1rm', before: { rank: 1, value_kg: 142.5 }, after: { rank: 3, value_kg: 120 } },
            ],
          }),
        ),
      ).toBe('You unlinked an exercise from Bench Press — now #3 on 1RM, off the Weight board');
      expect(sentence(linkItem({ effects: [] }))).toBe('dave linked Bench (comp grip) to Bench Press');
    });

    it('carries the group for All', () => {
      expect(buildStreamItemViewModel(linkItem(), 'me')).toMatchObject({ kind: 'link', key: 'ev-link-1', groupId: 'g1', groupName: 'Crew' });
      expect(buildStreamItemViewModel(voidedItem(), 'me')).toMatchObject({ kind: 'record_voided', groupName: 'Crew' });
    });
  });

  describe('records sit under their session card (E3)', () => {
    it('moves loaded records below their session, keeps orphans in place, and counts non-voided record sets', () => {
      const first = recordItem({ key: 'r1', set_id: 'set-1' });
      const sameSetOtherGroup = recordItem({ key: 'r2', set_id: 'set-1', group: { group_id: 'g2', name: 'Pals' } });
      const second = recordItem({ key: 'r3', set_id: 'set-2' });
      const voidedRecord = recordItem({ key: 'r4', set_id: 'set-3', voided: { key: 'v', reason: 'deleted', occurred_at_ms: 1 } });
      const orphan = recordItem({ key: 'r5', session_id: 's-gone' });
      const models = buildStreamViewModel(
        [linkItem(), first, sameSetOtherGroup, second, voidedRecord, sessionCardItem(), orphan, voidedItem()],
        'me',
      );

      expect(models.map((model) => `${model.kind}:${model.key}`)).toEqual([
        'link:ev-link-1',
        'session:u2:s1',
        'record:r1',
        'record:r2',
        'record:r3',
        'record:r4',
        'record:r5',
        'record_voided:ev-void-1',
      ]);
      expect((models[1] as StreamSessionCardViewModel).recordsLabel).toBe('2 records');
    });

    it('reads "1 record", and nothing without records', () => {
      const one = buildStreamViewModel([recordItem(), sessionCardItem()], 'me');
      expect((one[0] as StreamSessionCardViewModel).recordsLabel).toBe('1 record');
      const none = buildStreamViewModel([sessionCardItem()], 'me');
      expect((none[0] as StreamSessionCardViewModel).recordsLabel).toBeNull();
    });

    it('leaves records before their session card is paged in where the server put them', () => {
      const models = buildStreamViewModel([sessionCardItem({ key: 'u9:s9', member: { user_id: 'u9', username: 'x' }, session_id: 's9' }), recordItem()], 'me');
      expect(models.map((model) => model.kind)).toEqual(['session', 'record']);
    });
  });

  describe('paging over every kind (card AC2)', () => {
    it('an old cached first page without board kinds merges with an older page that has them', () => {
      const oldCached = {
        items: [sessionCardItem({ key: 'u2:s2', session_id: 's2', sort_at_ms: 9_000 })],
        next_cursor: { sort_at_ms: 9_000, kind: 'session', key: 'u2:s2' },
        has_more: true,
      };
      const older = {
        items: [
          sessionCardItem({ key: 'u2:s2', session_id: 's2', sort_at_ms: 9_000 }),
          linkItem({ sort_at_ms: 8_000 }),
          recordItem({ sort_at_ms: 7_000 }),
          sessionCardItem({ sort_at_ms: 7_000 }),
        ],
        cursor: null,
        hasMore: false,
      };
      const merged = mergeStreamPages(oldCached, older);
      expect(merged.map((item) => `${item.kind}:${item.key}`)).toEqual([
        'session:u2:s2',
        'link:ev-link-1',
        'record:ev-record-1',
        'session:u2:s1',
      ]);
      expect(buildStreamViewModel(merged, 'me').map((model) => model.kind)).toEqual(['session', 'link', 'session', 'record']);
    });
  });
});

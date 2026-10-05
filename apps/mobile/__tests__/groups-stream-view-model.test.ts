/**
 * Pure stream presentation (groups contract): status wording,
 * membership sentences, the "Unnamed member" fallback, the filter chips, and
 * paging over every item kind.
 */

import {
  UNNAMED_MEMBER_LABEL,
  buildStreamFilterChips,
  formatClockTime,
  formatGroupDateTime,
  formatMemberCount,
  formatMyRole,
  formatOfflineMarker,
  groupsStreamPath,
  resolveSelectedGroupId,
  formatStreamStartedAt,
  formatMemberName,
  formatMembershipSentence,
  formatSessionStatusLabel,
  mergeStreamPages,
  type GroupSessionSet,
  type StreamSessionItem,
} from '@/src/groups';

import { competitionStream,competitionEvent,competitionRow } from './helpers/competition-fixtures';

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

describe('group stream view model', () => {
  describe('session status', () => {
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

  describe('membership sentences', () => {
    it('uses the contract wording for each event', () => {
      expect(formatMembershipSentence('joined', 'dana')).toBe('dana joined');
      expect(formatMembershipSentence('left', 'dana')).toBe('dana left the group');
      expect(formatMembershipSentence('removed', 'dana')).toBe('dana was removed');
    });

    it('uses the fallback name for a null username', () => {
      expect(formatMembershipSentence('removed', null)).toBe('Unnamed member was removed');
    });
  });

  describe('time, offline marker, and role wording', () => {
    const at = new Date(2026, 8, 7, 6, 4).getTime();

    it('formats local times for cards, the friend view, and the offline marker (contract)', () => {
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

describe('competition stream paging', () => {
  it('deduplicates across opaque cursors and retains server order for event kind ties', () => {
    const session={ ...competitionStream.items[0],key: 'session-9',sort_at_ms: 9000 };
    const first={ ...competitionStream,items: [session],next_cursor: 'opaque',has_more: true };
    const link={ kind: 'competition' as const,key: 'link-8',sort_at_ms: 8000,event: { ...competitionEvent,kind: 'link' as const } };
    const record={ kind: 'competition' as const,key: 'record-7',sort_at_ms: 7000,event: competitionEvent };
    const merged=mergeStreamPages(first,{ items: [session,link,record],cursor: null,hasMore: false });
    expect(merged.map(item=>item.key)).toEqual(['session-9','link-8','record-7']);
    const tiedFirst={ ...first,items: [{ ...record,sort_at_ms: 8000 } ] };
    const membership={ kind: 'membership' as const,key: 'member-8',sort_at_ms: 8000,event: 'joined' as const,
      group: { group_id: 'g1',name: 'Crew' },member: competitionRow.member };
    expect(mergeStreamPages(tiedFirst,{ items: [link,membership,{ ...session,sort_at_ms: 8000 }],cursor: null,hasMore: false }).map(item=>item.key))
      .toEqual(['record-7','session-9']);
  });
});

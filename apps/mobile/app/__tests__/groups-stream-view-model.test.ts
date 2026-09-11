/**
 * Pure stream presentation (groups contract §6.1): C7.2 status wording, C7.3
 * membership sentences, the "Unnamed member" fallback, kg formatting, and the
 * filter chips.
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
  formatStreamStartedAt,
  formatMemberName,
  formatMembershipSentence,
  formatSessionStatusLabel,
  formatVolumeKg,
  type StreamMembershipItem,
  type StreamSessionItem,
} from '@/src/groups';

const DAY_MS = 24 * 60 * 60 * 1000;

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
  metrics: { performed_sets: 12, total_volume_kg: 5230.5, exercise_count: 4 },
  highlights: { prs: [{ exercise_name: 'Bench Press', weight_kg: 100, reps: 5, e1rm_kg: 112.4 }] },
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
    it('formats volume in kg with grouping and at most two decimals', () => {
      expect(formatVolumeKg(5230.5)).toBe('5,230.5 kg');
      expect(formatVolumeKg(0)).toBe('0 kg');
      expect(formatVolumeKg(1_234_567.891)).toBe('1,234,567.89 kg');
      expect(formatVolumeKg(999)).toBe('999 kg');
      expect(formatKg(62.25)).toBe('62.25');
      expect(formatKg(Number.NaN)).toBe('-');
    });
  });

  describe('item view models', () => {
    it('builds a session card with status, metrics, groups, and PR labels', () => {
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
        setsLabel: '12 sets',
        volumeLabel: '5,230.5 kg',
        exercisesLabel: '4 exercises',
        prLabels: ['PR · Bench Press 100 kg × 5'],
      });
    });

    it('pluralizes single counts and flags an active card', () => {
      const card = buildStreamItemViewModel(
        sessionItem({
          status: 'active',
          completed_at_ms: null,
          duration_sec: null,
          member: { user_id: 'u2', username: null },
          metrics: { performed_sets: 1, total_volume_kg: 60, exercise_count: 1 },
          highlights: { prs: [] },
        }),
      );

      expect(card).toMatchObject({
        memberName: 'Unnamed member',
        isTrainingNow: true,
        statusLabel: 'Training now',
        setsLabel: '1 set',
        exercisesLabel: '1 exercise',
        volumeLabel: '60 kg',
        prLabels: [],
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

    it('is All plus one chip per group, with All selected by default', () => {
      expect(buildStreamFilterChips(groups, null)).toEqual([
        { key: 'all', label: 'All', groupId: null, selected: true },
        { key: 'g1', label: 'Crew', groupId: 'g1', selected: false },
        { key: 'g2', label: 'Gym pals', groupId: 'g2', selected: false },
      ]);
    });

    it('selects the chosen group', () => {
      expect(buildStreamFilterChips(groups, 'g2').map((chip) => chip.selected)).toEqual([false, false, true]);
    });

    it('is only All when the user has no groups', () => {
      expect(buildStreamFilterChips([], null)).toEqual([{ key: 'all', label: 'All', groupId: null, selected: true }]);
    });
  });
});

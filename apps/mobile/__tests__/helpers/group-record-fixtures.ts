// Stream board-kind items (groups contract §4.2, M25-T05/T06) for the M25-T10
// stream, row detail, and certification tests.

import type {
  BoardHolder,
  GroupCertification,
  StreamLinkItem,
  StreamRecordItem,
  StreamRecordVoidedItem,
  StreamSessionItem,
} from '@/src/groups';

export const RECORD_AT_MS = new Date(2026, 8, 12, 18, 30).getTime();

export const recordItem = (overrides: Partial<StreamRecordItem> = {}): StreamRecordItem => ({
  kind: 'record',
  key: 'ev-record-1',
  sort_at_ms: RECORD_AT_MS,
  group: { group_id: 'g1', name: 'Crew' },
  member: { user_id: 'u2', username: 'dave' },
  group_exercise: { group_exercise_id: 'ge-bench', name: 'Bench Press', load_input_mode: 'total_load' },
  session_id: 's1',
  set_id: 'set-1',
  weight_kg: 140,
  reps: 1,
  e1rm_kg: 142.5,
  entered_weight_kg: 140,
  load_factor: 1,
  achieved_at_ms: RECORD_AT_MS,
  boards: [
    { metric: 'e1rm', value_kg: 142.5, previous_value_kg: 138, group_record: false },
    { metric: 'weight', value_kg: 140, previous_value_kg: 135, group_record: true },
  ],
  provisional: false,
  voided: null,
  certified: false,
  certification: null,
  ...overrides,
});

export const holder = (userId: string, username: string | null, valueKg: number): BoardHolder => ({
  member_user_id: userId,
  member: { user_id: userId, username },
  value_kg: valueKg,
  weight_kg: valueKg,
  reps: 1,
  e1rm_kg: valueKg,
  achieved_at_ms: RECORD_AT_MS,
  set_id: `set-${userId}`,
  session_id: `s-${userId}`,
});

export const voidedItem = (overrides: Partial<StreamRecordVoidedItem> = {}): StreamRecordVoidedItem => ({
  kind: 'record_voided',
  key: 'ev-void-1',
  sort_at_ms: RECORD_AT_MS + 60_000,
  group: { group_id: 'g1', name: 'Crew' },
  member: { user_id: 'u2', username: 'dave' },
  group_exercise: { group_exercise_id: 'ge-bench', name: 'Bench Press', load_input_mode: 'total_load' },
  record_key: 'ev-record-1',
  reason: 'edited',
  record: { weight_kg: 140, reps: 1, e1rm_kg: 142.5 },
  leaders: [
    { metric: 'e1rm', leader: null },
    { metric: 'weight', leader: holder('u3', 'sam', 138) },
  ],
  ...overrides,
});

export const linkItem = (overrides: Partial<StreamLinkItem> = {}): StreamLinkItem => ({
  kind: 'link',
  key: 'ev-link-1',
  sort_at_ms: RECORD_AT_MS + 120_000,
  event: 'link',
  group: { group_id: 'g1', name: 'Crew' },
  member: { user_id: 'u2', username: 'dave' },
  group_exercise: { group_exercise_id: 'ge-bench', name: 'Bench Press', load_input_mode: 'total_load' },
  exercises: [{ exercise_definition_id: 'ex-1', name: 'Bench (comp grip)' }],
  effects: [
    { metric: 'e1rm', before: null, after: { rank: 1, value_kg: 142.5 } },
    { metric: 'weight', before: null, after: { rank: 1, value_kg: 140 } },
  ],
  ...overrides,
});

export const sessionCardItem = (overrides: Partial<StreamSessionItem> = {}): StreamSessionItem => ({
  kind: 'session',
  key: 'u2:s1',
  sort_at_ms: RECORD_AT_MS,
  member: { user_id: 'u2', username: 'dave' },
  session_id: 's1',
  groups: [{ group_id: 'g1', name: 'Crew' }],
  gym_name: 'Iron Temple',
  status: 'completed',
  started_at_ms: RECORD_AT_MS,
  completed_at_ms: RECORD_AT_MS + 3_600_000,
  duration_sec: 3_600,
  exercises: [
    {
      session_exercise_id: 'se-1',
      name: 'Bench (comp grip)',
      machine_name: null,
      order_index: 0,
      sets: [
        { set_id: 'set-1', order_index: 0, weight_value: '140', reps_value: '1', set_type: 'working', performance_status: null },
      ],
    },
  ],
  ...overrides,
});

export const certificationPayload = (overrides: Partial<GroupCertification> = {}): GroupCertification => ({
  certification_id: 'cert-1',
  group_id: 'g1',
  group_exercise_id: 'ge-bench',
  member: { user_id: 'u2', username: 'dave' },
  set_id: 'set-1',
  session_id: 's1',
  certified_by: { user_id: 'me', username: 'me' },
  certified_at_ms: RECORD_AT_MS + 600_000,
  pinned: { weight_value: '140', reps_value: '1', performance_status: null, weight_kg: 140, reps: 1, e1rm_kg: 142.5 },
  ended_at_ms: null,
  end_reason: null,
  ended_by: null,
  ...overrides,
});

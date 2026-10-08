// Wire types for the group RPCs (`docs/specs/tech/groups-contract.md`).
// Field names are the server's snake_case JSON keys, unchanged: these types
// describe payloads exactly as they arrive and are cached.

import type { LoadInputMode } from '../exercise-core/index.ts';

export type GroupRole = 'owner' | 'admin' | 'member';

/** `group_get` member row: active members only. */
export type GroupMember = {
  user_id: string;
  /** Null when the member cleared their username after joining. */
  username: string | null;
  role: GroupRole;
};

export type GroupSummary = {
  group_id: string;
  name: string;
  description: string | null;
  /** Active members only. */
  member_count: number;
  my_role: GroupRole;
  bodyweight_calculations_enabled: boolean;
};

export type GroupRef = {
  group_id: string;
  name: string;
};

export type GroupMemberRef = {
  user_id: string;
  username: string | null;
};

export type GroupSessionStatus = 'active' | 'completed';

export type StreamSessionItem = {
  kind: 'session';
  /** `<member_user_id>:<session_id>` */
  key: string;
  /** = `sessions.started_at` */
  sort_at_ms: number;
  member: GroupMemberRef;
  session_id: string;
  /** The caller's in-scope groups holding the share. */
  groups: GroupRef[];
  gym_name: string | null;
  status: GroupSessionStatus;
  started_at_ms: number;
  /** Null while active. */
  completed_at_ms: number | null;
  /** Null while active. */
  duration_sec: number | null;
  /** Every live exercise and set, raw; the device computes the card metrics. */
  exercises: GroupSessionExercise[];
};

export type GroupMembershipEvent = 'joined' | 'left' | 'removed';

/** A live set row as synced: raw text values, no parsing or performed filter (§4.2). */
export type GroupSessionSet = {
  set_id: string;
  order_index: number;
  weight_value: string;
  reps_value: string;
  set_type: string | null;
  performance_status: string | null;
};

export type GroupSessionExercise = {
  exercise_definition_id?: string | null;
  load_input_mode?: string | null;
  session_exercise_id: string;
  /** The member's own exercise name (`session_exercises.name`). */
  name: string;
  machine_name: string | null;
  order_index: number;
  /** Every live set, in `order_index` order; the device selects the performed ones. */
  sets: GroupSessionSet[];
};

// ---- RPC results ----------------------------------------------------------

export type GroupListMineResult = { groups: GroupSummary[] };
export type GroupGetResult = { group: GroupSummary; members: GroupMember[] };
export type GroupInvitePreviewResult = {
  group_id: string;
  name: string;
  member_count: number;
  already_member: boolean;
};
export type GroupCreateResult = { group_id: string };
export type GroupUpdateResult = { group: GroupSummary };
export type GroupInviteCodeResult = { code: string };
export type GroupJoinResult = { group_id: string; joined: boolean };
/** `group_leave`: the group the caller left. */
export type GroupLeaveResult = { group_id: string };
/**
 * `group_remove_member`, `group_set_role`, `group_transfer_ownership`: the
 * post-write `group_get` payload (contract).
 */
export type GroupMemberWriteResult = GroupGetResult;

// ---- Group exercises (contract) ------------------------------

/** A group's comparison exercise. Its `name` + `load_input_mode` are an `ExerciseCore`. */
export type GroupExercise = {
  group_exercise_id: string;
  name: string;
  load_input_mode: LoadInputMode;
  /** The standard-catalogue id it was copied from (e.g. `seed_barbell_bench_press`); null for a custom exercise. */
  source_exercise_id: string | null;
  /** Null while active. Archived: keeps its links and a read-only board, not offered for new links (D8). */
  archived_at_ms: number | null;
  /** The group's shared rules line (`describeCompetitionRules`), shown wherever a member links to it. */
  standard: string;
};

// ---- Errors -----------------------------------------------------------------

/** Tokens the server raises as `'<TOKEN>: <message>'` (contract). */
export const GROUP_SERVER_ERROR_CODES = [
  'UPDATE_REQUIRED',
  'AUTH_REQUIRED',
  'AGENT_FORBIDDEN',
  'NOT_FOUND',
  'FORBIDDEN',
  'VALIDATION',
  'USERNAME_REQUIRED',
  'INVITE_INVALID',
  'OWNER_MUST_TRANSFER',
  /** The state moved on since the caller saw it (certifying a set edited ahead of the evaluator). */
  'CONFLICT',
] as const;

export type GroupServerErrorCode = (typeof GROUP_SERVER_ERROR_CODES)[number];

/** Server tokens plus the client-only `NETWORK` (transport) and `INTERNAL` (anything else). */
export type GroupErrorCode = GroupServerErrorCode | 'NETWORK' | 'INTERNAL';

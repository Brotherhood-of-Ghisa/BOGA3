// Wire types for the M22 group RPCs (`docs/specs/tech/groups-contract.md` §4).
// Field names are the server's snake_case JSON keys, unchanged: these types
// describe payloads exactly as they arrive and are cached.

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
  /** Every live exercise and set, raw; the device computes the card metrics (§5). */
  exercises: GroupSessionExercise[];
};

export type GroupMembershipEvent = 'joined' | 'left' | 'removed';

export type StreamMembershipItem = {
  kind: 'membership';
  /** `<membership_id>:joined` or `<membership_id>:ended` */
  key: string;
  sort_at_ms: number;
  event: GroupMembershipEvent;
  group: GroupRef;
  member: GroupMemberRef;
};

export type StreamItem = StreamSessionItem | StreamMembershipItem;

/** The last item's ordering triple; a page returns items strictly after it. */
export type StreamCursor = {
  sort_at_ms: number;
  kind: StreamItem['kind'];
  key: string;
};

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
  session_exercise_id: string;
  /** The member's own exercise name (`session_exercises.name`). */
  name: string;
  machine_name: string | null;
  order_index: number;
  /** Every live set, in `order_index` order; the device selects the performed ones (§5). */
  sets: GroupSessionSet[];
};

export type GroupSessionDetail = {
  member: GroupMemberRef;
  session_id: string;
  gym_name: string | null;
  status: GroupSessionStatus;
  started_at_ms: number;
  completed_at_ms: number | null;
  duration_sec: number | null;
  exercises: GroupSessionExercise[];
};

// ---- RPC results ----------------------------------------------------------

export type GroupListMineResult = { groups: GroupSummary[] };
export type GroupGetResult = { group: GroupSummary; members: GroupMember[] };
export type GroupStreamResult = {
  items: StreamItem[];
  next_cursor: StreamCursor | null;
  has_more: boolean;
};
export type GroupSessionDetailResult = { session: GroupSessionDetail };
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
 * post-write `group_get` payload (M22-T01 as-built, contract §4.3).
 */
export type GroupMemberWriteResult = GroupGetResult;

// ---- Errors -----------------------------------------------------------------

/** Tokens the server raises as `'<TOKEN>: <message>'` (contract §4). */
export const GROUP_SERVER_ERROR_CODES = [
  'AUTH_REQUIRED',
  'AGENT_FORBIDDEN',
  'NOT_FOUND',
  'FORBIDDEN',
  'VALIDATION',
  'USERNAME_REQUIRED',
  'INVITE_INVALID',
  'OWNER_MUST_TRANSFER',
] as const;

export type GroupServerErrorCode = (typeof GROUP_SERVER_ERROR_CODES)[number];

/** Server tokens plus the client-only `NETWORK` (transport) and `INTERNAL` (anything else). */
export type GroupErrorCode = GroupServerErrorCode | 'NETWORK' | 'INTERNAL';

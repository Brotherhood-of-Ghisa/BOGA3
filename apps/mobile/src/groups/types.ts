// Wire types for the group RPCs (`docs/specs/tech/groups-contract.md` §4).
// Field names are the server's snake_case JSON keys, unchanged: these types
// describe payloads exactly as they arrive and are cached.

import type { LoadInputMode } from '@/src/exercise-core';

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

/** Server stream kinds this build does not render; `getGroupStream` drops them (M25-T05). */
export type UnrenderedStreamKind = 'record' | 'record_voided' | 'link';

/**
 * The last item's ordering triple; a page returns items strictly after it. The
 * server's `next_cursor` may name an item kind this build drops.
 */
export type StreamCursor = {
  sort_at_ms: number;
  kind: StreamItem['kind'] | UnrenderedStreamKind;
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

// ---- Group exercises (M25-T01, contract §4.4) ------------------------------

/** A group's comparison exercise. Its `name` + `load_input_mode` are an `ExerciseCore`. */
export type GroupExercise = {
  group_exercise_id: string;
  name: string;
  load_input_mode: LoadInputMode;
  /** The standard-catalogue id it was copied from (e.g. `seed_barbell_bench_press`); null for a custom exercise. */
  source_exercise_id: string | null;
  /** Null while active. Archived: keeps its links and a read-only board, not offered for new links (D8). */
  archived_at_ms: number | null;
};

/** `group_exercise_list`: active first, then by name case-insensitively; archived ones flagged by `archived_at_ms`. */
export type GroupExerciseListResult = { exercises: GroupExercise[] };
/** `group_exercise_create`, `_update`, `_archive`, `_unarchive`: the exercise after the write. */
export type GroupExerciseWriteResult = { exercise: GroupExercise };

// ---- Boards (M25-T05, contract §4.5) -----------------------------------------

export type GroupBoardMetric = 'weight' | 'e1rm';

/** One member's best counting set on a board, at its absolute rank. Values are converted to the group exercise's mode (D6). */
export type BoardRow = {
  rank: number;
  member: GroupMemberRef;
  /** No longer an active member; still ranked (P7). */
  former: boolean;
  /** The ranked value: `weight_kg` on Weight, `e1rm_kg` on e1RM. */
  value_kg: number;
  weight_kg: number;
  reps: number;
  e1rm_kg: number | null;
  /** As logged, before conversion. */
  entered_weight_kg: number;
  load_factor: number;
  achieved_at_ms: number;
  session_id: string;
  set_id: string;
  /** The member's live `session_exercises.name`, or null. */
  exercise_name: string | null;
  /** An active certification pinned to this row's set (M25-T06), on All and Certified alike. */
  certified: boolean;
  certification: GroupBoardCertificationRef | null;
};

/** The active certification behind a certified row (M25-T06, §4.5). */
export type GroupBoardCertificationRef = {
  certification_id: string;
  /** Null when the certifier's account is gone. */
  certified_by: GroupMemberRef | null;
  certified_at_ms: number;
};

export type GroupBoardPodiumExercise = {
  exercise: GroupExercise;
  /** Ranks 1–3 at most. */
  podium: BoardRow[];
  /** The caller's row whenever ranked. */
  me: BoardRow | null;
  entry_count: number;
  /** The same metric on All. */
  all_entry_count: number;
};

/** `group_board_podiums`: every group exercise in `group_exercise_list` order (archived last). */
export type GroupBoardPodiumsResult = {
  metric: GroupBoardMetric;
  certified: boolean;
  exercises: GroupBoardPodiumExercise[];
};

/** The last row of a `group_board` page, in rank order. Sent back verbatim as `p_after`. */
export type GroupBoardCursor = {
  value_kg: number;
  achieved_at_ms: number;
  member_user_id: string;
};

export type GroupBoardResult = {
  exercise: GroupExercise;
  metric: GroupBoardMetric;
  certified: boolean;
  rows: BoardRow[];
  next_cursor: GroupBoardCursor | null;
  has_more: boolean;
};

/** A board holder (`Holder` + member, §2.11). */
export type BoardHolder = {
  member_user_id: string;
  member: GroupMemberRef;
  value_kg: number;
  weight_kg: number;
  reps: number;
  e1rm_kg: number | null;
  achieved_at_ms: number;
  set_id: string;
  session_id: string;
};

export type GroupBoardHistoryRelated =
  | { kind: 'record'; key: string; set_id: string; weight_kg: number; reps: number; e1rm_kg: number | null }
  | {
      kind: 'record_voided';
      key: string;
      reason: 'edited' | 'deleted';
      record: { weight_kg: number; reps: number; e1rm_kg: number | null };
    }
  | {
      kind: 'link';
      key: string;
      event: 'link' | 'unlink';
      exercises: { exercise_definition_id: string; name: string | null }[];
    }
  | {
      /** M25-T06: the certification that moved a Certified board, read live. */
      kind: 'certification';
      key: string;
      event: 'certified' | 'withdrawn' | 'cancelled' | 'voided';
      certified_by: GroupMemberRef | null;
      ended_by: GroupMemberRef | null;
      set_id: string;
      weight_kg: number;
      reps: number;
      e1rm_kg: number | null;
    };

/** Known lead-change reasons; a later server may send more, which render a fallback sentence. */
export type GroupBoardHistoryReason = 'record' | 'void' | 'link' | 'certification';

export type GroupBoardHistoryItem = {
  key: string;
  seq: number;
  occurred_at_ms: number;
  reason: GroupBoardHistoryReason | (string & {});
  /** Null when the board emptied. */
  leader: BoardHolder | null;
  previous: BoardHolder | null;
  related: GroupBoardHistoryRelated | null;
};

export type GroupBoardHistoryCursor = { seq: number };

export type GroupBoardHistoryResult = {
  items: GroupBoardHistoryItem[];
  next_cursor: GroupBoardHistoryCursor | null;
  has_more: boolean;
};

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

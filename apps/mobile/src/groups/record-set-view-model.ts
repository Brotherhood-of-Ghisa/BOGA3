// The record set row detail (product E2, P10–P13; groups contract §4.5, §4.6):
// one model built from a board row or a stream record card, the certification
// actions my relationship to the set allows, and the wording of every write
// outcome. Pure: no React, no I/O.

import {
  isCertificationNotFound,
  isGroupMemberNotFound,
  isGroupNotFound,
  isRecordSetNotFound,
  type GroupApiError,
} from './api';
import { formatOneRepMaxFigure } from '@/src/session-recorder/session-view-model';

import { formatBoardDate } from './board-view-model';
import {
  RECORD_PROVISIONAL_LABEL,
  RECORD_UNCERTIFIED_LABEL,
  type RecordCertificationStatus,
  formatCertifiedBy,
  formatKg,
  formatSetFigure,
  formatSetValue,
  formatStreamPersonName,
  formatVoidedLabel,
} from './stream-view-model';
import type {
  BoardRow,
  GroupBoardCertificationRef,
  GroupCertification,
  GroupExercise,
  GroupMemberRef,
  GroupRole,
  GroupSessionDetail,
  StreamRecordItem,
  StreamRecordVoidReason,
} from './types';
import { describeGroupWriteError } from './write-view-model';

export type RecordSetDetail = {
  groupId: string;
  groupExerciseId: string;
  groupExerciseName: string;
  /** Known from a board payload; null from a stream item (the server refuses certify on archived, §4.6). */
  archived: boolean | null;
  /** The lifter. */
  member: GroupMemberRef;
  /** Converted to the group exercise's mode (D6). */
  weightKg: number;
  reps: number;
  e1rmKg: number | null;
  /** As logged, in the lifter's own mode. */
  enteredWeightKg: number;
  loadFactor: number;
  achievedAtMs: number;
  sessionId: string;
  setId: string;
  /** The lifter's live exercise name (board rows only). */
  exerciseName: string | null;
  /** The active certification, or null. */
  certification: GroupBoardCertificationRef | null;
  voidedReason: StreamRecordVoidReason | null;
  provisional: boolean;
  /** The lifter is no longer a member (board rows only). */
  former: boolean;
};

export const recordSetFromBoardRow = (groupId: string, exercise: GroupExercise, row: BoardRow): RecordSetDetail => ({
  groupId,
  groupExerciseId: exercise.group_exercise_id,
  groupExerciseName: exercise.name,
  archived: exercise.archived_at_ms !== null,
  member: row.member,
  weightKg: row.weight_kg,
  reps: row.reps,
  e1rmKg: row.e1rm_kg,
  enteredWeightKg: row.entered_weight_kg,
  loadFactor: row.load_factor,
  achievedAtMs: row.achieved_at_ms,
  sessionId: row.session_id,
  setId: row.set_id,
  exerciseName: row.exercise_name,
  certification: row.certified ? row.certification : null,
  voidedReason: null,
  provisional: false,
  former: row.former,
});

export const recordSetFromStreamRecord = (item: StreamRecordItem): RecordSetDetail => ({
  groupId: item.group.group_id,
  groupExerciseId: item.group_exercise.group_exercise_id,
  groupExerciseName: item.group_exercise.name,
  archived: null,
  member: item.member,
  weightKg: item.weight_kg,
  reps: item.reps,
  e1rmKg: item.e1rm_kg,
  enteredWeightKg: item.entered_weight_kg,
  loadFactor: item.load_factor,
  achievedAtMs: item.achieved_at_ms,
  sessionId: item.session_id,
  setId: item.set_id,
  exerciseName: null,
  certification: item.certified ? item.certification : null,
  voidedReason: item.voided?.reason ?? null,
  provisional: item.provisional,
  former: false,
});

/** The active certification a write returned, as a detail's `certification` (null once ended). */
export const certificationRefFrom = (certification: GroupCertification): GroupBoardCertificationRef | null =>
  certification.ended_at_ms === null
    ? {
        certification_id: certification.certification_id,
        certified_by: certification.certified_by,
        certified_at_ms: certification.certified_at_ms,
      }
    : null;

// ---- Actions ------------------------------------------------------------------------

export type RecordSetAction = 'certify' | 'withdraw' | 'cancel';

export const RECORD_SET_ACTION_LABELS: Record<RecordSetAction, string> = {
  certify: 'Certify',
  withdraw: 'Remove my certification',
  cancel: 'Cancel certification',
};

/**
 * P10–P11, D3–D5, §4.6: `certify` for any member but the lifter on an
 * uncertified, standing record set of an active exercise and a current lifter;
 * `withdraw` for the certifier; `cancel` for the owner or an admin who is not the
 * certifier. The server enforces all of it regardless.
 */
export const recordSetActionsFor = (
  detail: RecordSetDetail,
  myUserId: string | null,
  myRole: GroupRole | null,
): RecordSetAction[] => {
  if (myUserId === null) return [];
  if (detail.certification === null) {
    const certifiable =
      detail.voidedReason === null && detail.archived !== true && !detail.former && detail.member.user_id !== myUserId;
    return certifiable ? ['certify'] : [];
  }
  if (detail.certification.certified_by?.user_id === myUserId) return ['withdraw'];
  return myRole === 'owner' || myRole === 'admin' ? ['cancel'] : [];
};

export const DESTRUCTIVE_RECORD_SET_ACTIONS: ReadonlySet<RecordSetAction> = new Set(['withdraw', 'cancel']);

/** The confirmation for a destructive action (08 pattern 3). */
export const recordSetActionConfirmation = (
  action: Exclude<RecordSetAction, 'certify'>,
  detail: RecordSetDetail,
): { title: string; message: string; confirmLabel: string } =>
  action === 'withdraw'
    ? {
        title: 'Remove your certification?',
        message: `${detail.groupExerciseName} ${formatSetValue(detail.weightKg, detail.reps)} will leave the Certified boards unless someone else certifies it.`,
        confirmLabel: 'Remove',
      }
    : {
        title: 'Cancel this certification?',
        message: `${detail.groupExerciseName} ${formatSetValue(detail.weightKg, detail.reps)} will leave the Certified boards. Members can certify it again.`,
        confirmLabel: 'Cancel certification',
      };

// ---- The sheet ------------------------------------------------------------------------

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Local "12 Sep 2026". */
export const formatRecordSetDate = (epochMs: number): string => {
  const date = new Date(epochMs);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}`;
};

/** The as-logged value when the board converted it (D6); null when unconverted. */
export const formatLoggedValue = (detail: Pick<RecordSetDetail, 'enteredWeightKg' | 'weightKg' | 'loadFactor'>): string | null => {
  if (detail.loadFactor === 1) return null;
  const entered = `${formatKg(detail.enteredWeightKg)} kg`;
  const counted = `${formatKg(detail.weightKg)} kg`;
  if (detail.loadFactor === 2) return `Logged ${entered} per side · counted as ${counted} total`;
  if (detail.loadFactor === 0.5) return `Logged ${entered} total · counted as ${counted} per side`;
  return `Logged ${entered} · counted as ${counted}`;
};

export const LIFTER_CERTIFY_NOTE = 'Other members can certify this set.';

export type RecordSetSheetViewModel = {
  title: string;
  /** "140.0 × 1 · 1RM 142.5": the two figures below, in words for screen readers. */
  valueLabel: string;
  /** "140.0 × 1" (figures: no unit, design-language §6). */
  setFigure: string;
  /** "142.5"; null when the set has no estimate. */
  oneRepMaxFigure: string | null;
  loggedLabel: string | null;
  /** "12 Sep 2026 · Iron Temple". */
  dateLabel: string;
  /** 'Logged as "Bench (comp grip)"'. */
  loggedAsLabel: string | null;
  provisionalLabel: string | null;
  /** "Certified by sam · 12 Sep", "Not certified yet", or "Voided · set edited". */
  statusLabel: string;
  /** The state `statusLabel` puts in words, for the glyph drawn beside it. */
  status: RecordCertificationStatus;
  /** For the lifter on their own uncertified, standing set. */
  lifterNote: string | null;
  actions: RecordSetAction[];
  /** Hidden for a deleted set's void or a session the server no longer shows. */
  canViewSession: boolean;
};

const exerciseNameFromSession = (session: GroupSessionDetail | null, setId: string): string | null =>
  session?.exercises.find((exercise) => exercise.sets.some((set) => set.set_id === setId))?.name ?? null;

export const buildRecordSetSheet = (
  detail: RecordSetDetail,
  {
    myUserId,
    myRole,
    session,
    sessionMissing,
    nowMs = Date.now(),
  }: {
    myUserId: string | null;
    myRole: GroupRole | null;
    /** `group_session_detail` for the set's session, once read (gym, "Logged as"). */
    session: GroupSessionDetail | null;
    /** The session read returned `NOT_FOUND`. */
    sessionMissing: boolean;
    nowMs?: number;
  },
): RecordSetSheetViewModel => {
  const setFigure = formatSetFigure(detail.weightKg, detail.reps);
  const oneRepMaxFigure = detail.e1rmKg === null ? null : formatOneRepMaxFigure(detail.e1rmKg);
  const gym = session?.gym_name?.trim() || null;
  const loggedAs = detail.exerciseName ?? exerciseNameFromSession(session, detail.setId);
  let statusLabel = RECORD_UNCERTIFIED_LABEL;
  let status: RecordCertificationStatus = 'uncertified';
  if (detail.voidedReason) {
    statusLabel = formatVoidedLabel(detail.voidedReason);
    status = 'voided';
  } else if (detail.certification) {
    status = 'certified';
    statusLabel = `${formatCertifiedBy(detail.certification.certified_by, myUserId)} · ${formatBoardDate(
      detail.certification.certified_at_ms,
      nowMs,
    )}`;
  }
  const isLifter = myUserId !== null && detail.member.user_id === myUserId;
  return {
    title: `${formatStreamPersonName(detail.member, myUserId)} · ${detail.groupExerciseName}`,
    valueLabel: oneRepMaxFigure === null ? setFigure : `${setFigure} · 1RM ${oneRepMaxFigure}`,
    setFigure,
    oneRepMaxFigure,
    loggedLabel: formatLoggedValue(detail),
    dateLabel: gym ? `${formatRecordSetDate(detail.achievedAtMs)} · ${gym}` : formatRecordSetDate(detail.achievedAtMs),
    loggedAsLabel: loggedAs ? `Logged as "${loggedAs}"` : null,
    provisionalLabel: detail.provisional && detail.voidedReason === null ? RECORD_PROVISIONAL_LABEL : null,
    statusLabel,
    status,
    lifterNote: isLifter && detail.certification === null && detail.voidedReason === null ? LIFTER_CERTIFY_NOTE : null,
    actions: recordSetActionsFor(detail, myUserId, myRole),
    canViewSession: detail.voidedReason !== 'deleted' && !sessionMissing,
  };
};

// ---- Write outcomes ---------------------------------------------------------------------

export const CERTIFIED_BOARDS_DELAY_NOTE = 'Certified. Certified boards update in a few seconds.';
export const CERTIFICATION_ALREADY_REMOVED = 'This certification was already removed.';

/** A successful `group_certify`: a new certification, or one that already existed (P10). */
export const describeCertifySuccess = (
  result: { certification: GroupCertification; created: boolean },
  myUserId: string | null,
): string => {
  if (result.created) return CERTIFIED_BOARDS_DELAY_NOTE;
  const by = result.certification.certified_by;
  if (!by) return 'Already certified.';
  return by.user_id === myUserId ? 'Already certified by you.' : `Already certified by ${formatStreamPersonName(by, myUserId)}.`;
};

/** A successful withdraw / cancel. An already-ended certification comes back unchanged (§4.6). */
export const describeCertificationEndSuccess = (
  action: 'withdraw' | 'cancel',
  certification: GroupCertification,
  myUserId: string | null,
): string => {
  const expected = action === 'withdraw' ? 'withdrawn' : 'cancelled';
  if (certification.end_reason !== expected || certification.ended_by?.user_id !== myUserId) {
    return CERTIFICATION_ALREADY_REMOVED;
  }
  return action === 'withdraw' ? 'Your certification was removed.' : 'Certification cancelled.';
};

export const CERTIFICATION_CONFLICT_MESSAGE = 'This set changed since it loaded. Nothing was certified — refresh and try again.';

/** How a failed certification write reads (08 pattern 9: nothing changed). */
export const describeCertificationError = (
  error: GroupApiError,
  action: RecordSetAction,
  lifter: GroupMemberRef,
): string => {
  if (error.code === 'CONFLICT') return CERTIFICATION_CONFLICT_MESSAGE;
  if (isGroupNotFound(error)) return "You're no longer a member of this group.";
  if (isRecordSetNotFound(error)) return 'This set is no longer a record. Nothing was certified.';
  if (isGroupMemberNotFound(error)) {
    return `${formatStreamPersonName(lifter, null)} is no longer a member, so this set can't be certified.`;
  }
  if (isCertificationNotFound(error)) return 'This certification no longer exists.';
  switch (error.code) {
    case 'NOT_FOUND':
      return 'This exercise is no longer in this group. Nothing was changed.';
    case 'FORBIDDEN':
      if (action === 'cancel') return 'Only owners and admins can cancel a certification.';
      if (action === 'withdraw') return 'Only the certifier can remove it.';
      return error.message;
    case 'VALIDATION':
      return /archived/i.test(error.message) ? 'This exercise is archived. Its boards are read-only.' : error.message;
    case 'INTERNAL':
      return 'Something went wrong. Nothing was changed.';
    default:
      return describeGroupWriteError(error);
  }
};

/** The data moved on (or my role did): the host should re-read what it shows. */
export const shouldRefreshAfterCertificationError = (error: GroupApiError): boolean =>
  !isGroupNotFound(error) &&
  (error.code === 'CONFLICT' || error.code === 'NOT_FOUND' || error.code === 'FORBIDDEN' || error.code === 'VALIDATION');

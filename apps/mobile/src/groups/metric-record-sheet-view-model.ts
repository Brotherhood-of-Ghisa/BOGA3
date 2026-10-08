// The metric record sheet, as plain data: certification status, why it is
// read-only, and which actions it offers. The server enforces all of it again.
import { formatBoardDate } from './board-view-model';
import type { CompetitionBoardRowWire as GroupMetricBoardRowWire,CompetitionCertificationWire as GroupMetricCertificationWire,CompetitionExerciseWire as GroupMetricExerciseWire } from './competition-wire';
import type { GroupRole } from './types';
import { canManageGroup } from './write-view-model';

export type MetricCertificationEndAction = 'withdraw' | 'cancel';
export type MetricRecordSheetNotice = { tone: 'error' | 'success'; message: string };

export type MetricCertificationTarget = Pick<GroupMetricBoardRowWire,
  'metric' | 'member' | 'former' | 'write_token' | 'certification'> & { performance: Pick<GroupMetricBoardRowWire['performance'], 'set_id'> };

export type MetricRecordSheetInput = {
  row: MetricCertificationTarget;
  exercise: GroupMetricExerciseWire;
  userId: string;
  myRole: GroupRole | null;
  certification: GroupMetricCertificationWire | null;
  readOnlyReason?: string;
  online: boolean | null;
  pending: boolean;
  needsReview: boolean;
  notice: MetricRecordSheetNotice | null;
};

export type MetricRecordSheetModel = {
  /** The certification still in force, if any. */
  active: GroupMetricCertificationWire | null;
  certified: boolean;
  readOnly: boolean;
  /** Writes are refused while one is pending, offline, read-only or awaiting review. */
  blocked: boolean;
  statusText: string;
  readOnlyNote: string | null;
  offlineNote: string | null;
  ownPerformanceNote: string | null;
  showRefresh: boolean;
  canCertify: boolean;
  canWithdraw: boolean;
  canCancel: boolean;
};

const isReadOnly = ({ row, exercise, readOnlyReason }: MetricRecordSheetInput): boolean =>
  Boolean(readOnlyReason) || row.former || exercise.archived_at_ms !== null || exercise.rebuilding;

const readOnlyCause = ({ row, exercise, readOnlyReason }: MetricRecordSheetInput): string => {
  if (readOnlyReason) return readOnlyReason;
  if (row.former) return 'former member';
  return exercise.rebuilding ? 'rules are recalculating' : 'archived or earlier rules';
};

const describeStatus = (
  active: GroupMetricCertificationWire | null,
  certification: GroupMetricCertificationWire | null,
  certified: boolean,
): string => {
  if (active) return `Certified by ${active.certified_by?.username ?? 'a group member'} · ${formatBoardDate(active.certified_at_ms)}`;
  if (certification?.end_reason) return 'Certification ended';
  return certified ? 'Certified' : 'Uncertified';
};

type CertificationState = {
  active: GroupMetricCertificationWire | null;
  certified: boolean;
  readOnly: boolean;
  isMine: boolean;
};

const describeNotes = (input: MetricRecordSheetInput, { active, certified, readOnly, isMine }: CertificationState) => ({
  readOnlyNote: readOnly ? `Read-only · ${readOnlyCause(input)}` : null,
  offlineNote: input.online === false ? 'Reconnect to change certification.' : null,
  ownPerformanceNote: isMine && !certified ? 'Another group member can certify your performance.' : null,
});

/** Certify someone else's uncertified set; withdraw my own certification; owners and admins cancel others'. */
const availableActions = ({ userId, myRole }: MetricRecordSheetInput, { active, certified, readOnly, isMine }: CertificationState) => {
  const certifiedByMe = active?.certified_by?.user_id === userId;
  return {
    canCertify: myRole !== null && !certified && !isMine && !readOnly,
    canWithdraw: certifiedByMe && !readOnly,
    canCancel: active !== null && myRole !== null && canManageGroup(myRole) && !certifiedByMe && !readOnly,
  };
};

export function buildMetricRecordSheetModel(input: MetricRecordSheetInput): MetricRecordSheetModel {
  const { row, userId, certification, online, pending, needsReview, notice } = input;
  const active = certification?.ended_at_ms === null ? certification : null;
  // Until the certification is read, the board row says whether it is certified.
  const certified = certification ? active !== null : row.certification !== null;
  const state: CertificationState = { active, certified, readOnly: isReadOnly(input), isMine: row.member.user_id === userId };
  return {
    active,
    certified,
    readOnly: state.readOnly,
    blocked: pending || online === false || state.readOnly || needsReview,
    statusText: describeStatus(active, certification, certified),
    ...describeNotes(input, state),
    // A refused write, or a certification the row names that could not be read.
    showRefresh: needsReview || Boolean(row.certification?.certification_id && notice?.tone === 'error'),
    ...availableActions(input, state),
  };
}

export const metricCertificationEndConfirmation = (action: MetricCertificationEndAction) => ({
  title: action === 'withdraw' ? 'Withdraw certification?' : 'Cancel certification?',
  message: 'This performance will leave the Certified board. Its logged set stays available on All.',
  confirmLabel: action === 'withdraw' ? 'Withdraw' : 'Cancel certification',
});

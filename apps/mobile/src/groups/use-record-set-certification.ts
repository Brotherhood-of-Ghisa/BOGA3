// Certify / remove my certification / cancel a certification on one record set
// (product P10–P13, P18; groups contract §4.6, §7). Every write goes through
// `useGroupAction`: refused before any request while offline, never queued or
// retried, and `group_cache` is never touched. The host re-reads what it shows:
// `onChanged` after a success, or after a failure that means the data (or my
// role) moved on; `onLostAccess` after a group `NOT_FOUND`, once the group's
// cache entries are evicted.

import { useCallback, useState } from 'react';

import {
  cancelGroupCertification,
  certifyGroupSet,
  isGroupNotFound,
  withdrawGroupCertification,
  type GroupApiError,
} from './api';
import { evictGroupFromDevice } from './evict-local';
import {
  certificationRefFrom,
  describeCertificationEndSuccess,
  describeCertificationError,
  describeCertifySuccess,
  shouldRefreshAfterCertificationError,
  type RecordSetAction,
  type RecordSetDetail,
} from './record-set-view-model';
import type { GroupBoardCertificationRef } from './types';
import { useGroupAction } from './use-group-action';
import { useMountedRef } from './use-mounted-ref';

/** The last write's outcome, for the set it was made on (`setKey`). */
export type RecordSetWriteNotice = { tone: 'success' | 'error'; message: string; setKey: string };

export type RecordSetCertificationOptions = {
  myUserId: string | null;
  /** Re-read the board / stream / podium this set is shown on. */
  onChanged: () => void;
  /** The caller lost access to the set's group (its cache is already evicted). */
  onLostAccess?: (groupId: string) => void;
};

export type RecordSetCertificationState = {
  certify: (detail: RecordSetDetail) => Promise<void>;
  withdraw: (detail: RecordSetDetail) => Promise<void>;
  cancel: (detail: RecordSetDetail) => Promise<void>;
  /** The set the latest write is running for, or null. */
  pendingSetKey: string | null;
  /** The last outcome, inline beside the actions. */
  notice: RecordSetWriteNotice | null;
  /**
   * The certification the last successful write returned, for the set it was
   * made on (`setKey`); `undefined` until then. Shown instead of the host's
   * (possibly not yet refreshed) data.
   */
  written: WrittenCertification | undefined;
  /** Clears the notice and the written certification. */
  reset: () => void;
  /** Clears only the written certification (the host's data has caught up). */
  clearWritten: () => void;
};

export type WrittenCertification = {
  setKey: string;
  certification: GroupBoardCertificationRef | null;
  writtenAtMs: number;
};

/**
 * How long the written certification may disagree with the host's data before
 * the host's data wins: a read already in flight when the write committed can
 * land with the old state, but the next poll (30 s) reads after the write, so a
 * later change made elsewhere shows at most one poll late.
 */
export const WRITTEN_CERTIFICATION_HOLD_MS = 45_000;

/**
 * Whether the host's live data for the written set has caught up with (or,
 * after the hold, superseded) the written certification. `live` is the set's
 * certification in the host's current data (`undefined` when the set is not
 * loaded).
 */
export const writtenCertificationSettled = (
  written: WrittenCertification,
  live: GroupBoardCertificationRef | null | undefined,
  nowMs: number = Date.now(),
): boolean => {
  if (live !== undefined && (live?.certification_id ?? null) === (written.certification?.certification_id ?? null)) {
    return true;
  }
  return nowMs - written.writtenAtMs > WRITTEN_CERTIFICATION_HOLD_MS;
};

/** One board target's set: certification is per (group exercise, member, set). */
export const recordSetKey = (detail: Pick<RecordSetDetail, 'groupExerciseId' | 'member' | 'setId'>): string =>
  `${detail.groupExerciseId}:${detail.member.user_id}:${detail.setId}`;

export function useRecordSetCertification({
  myUserId,
  onChanged,
  onLostAccess,
}: RecordSetCertificationOptions): RecordSetCertificationState {
  const certifyAction = useGroupAction(certifyGroupSet);
  const withdrawAction = useGroupAction(withdrawGroupCertification);
  const cancelAction = useGroupAction(cancelGroupCertification);
  const mounted = useMountedRef();
  const [notice, setNotice] = useState<RecordSetWriteNotice | null>(null);
  const [written, setWritten] = useState<RecordSetCertificationState['written']>(undefined);
  const [pendingSetKey, setPendingSetKey] = useState<string | null>(null);

  const fail = useCallback(
    async (error: GroupApiError, action: RecordSetAction, detail: RecordSetDetail) => {
      if (mounted.current) {
        setNotice({ tone: 'error', message: describeCertificationError(error, action, detail.member), setKey: recordSetKey(detail) });
      }
      if (isGroupNotFound(error)) {
        await evictGroupFromDevice(detail.groupId);
        onLostAccess?.(detail.groupId);
      } else if (shouldRefreshAfterCertificationError(error)) {
        onChanged();
      }
    },
    [mounted, onChanged, onLostAccess],
  );

  const runCertify = certifyAction.run;
  const certify = useCallback(
    async (detail: RecordSetDetail) => {
      setNotice(null);
      setPendingSetKey(recordSetKey(detail));
      const result = await runCertify({
        groupId: detail.groupId,
        groupExerciseId: detail.groupExerciseId,
        memberUserId: detail.member.user_id,
        setId: detail.setId,
      });
      if (mounted.current) setPendingSetKey((key) => (key === recordSetKey(detail) ? null : key));
      if (!result.ok) {
        await fail(result.error, 'certify', detail);
        return;
      }
      if (mounted.current) {
        setWritten({
          setKey: recordSetKey(detail),
          certification: certificationRefFrom(result.value.certification),
          writtenAtMs: Date.now(),
        });
        setNotice({ tone: 'success', message: describeCertifySuccess(result.value, myUserId), setKey: recordSetKey(detail) });
      }
      onChanged();
    },
    [fail, mounted, myUserId, onChanged, runCertify],
  );

  const runWithdraw = withdrawAction.run;
  const runCancel = cancelAction.run;
  const end = useCallback(
    async (action: 'withdraw' | 'cancel', detail: RecordSetDetail) => {
      const certificationId = detail.certification?.certification_id;
      if (!certificationId) return;
      setNotice(null);
      setPendingSetKey(recordSetKey(detail));
      const run = action === 'withdraw' ? runWithdraw : runCancel;
      const result = await run(detail.groupId, certificationId);
      if (mounted.current) setPendingSetKey((key) => (key === recordSetKey(detail) ? null : key));
      if (!result.ok) {
        await fail(result.error, action, detail);
        return;
      }
      if (mounted.current) {
        setWritten({
          setKey: recordSetKey(detail),
          certification: certificationRefFrom(result.value.certification),
          writtenAtMs: Date.now(),
        });
        setNotice({
          tone: 'success',
          message: describeCertificationEndSuccess(action, result.value.certification, myUserId),
          setKey: recordSetKey(detail),
        });
      }
      onChanged();
    },
    [fail, mounted, myUserId, onChanged, runCancel, runWithdraw],
  );

  const withdraw = useCallback((detail: RecordSetDetail) => end('withdraw', detail), [end]);
  const cancel = useCallback((detail: RecordSetDetail) => end('cancel', detail), [end]);

  const reset = useCallback(() => {
    setNotice(null);
    setWritten(undefined);
  }, []);
  const clearWritten = useCallback(() => setWritten(undefined), []);

  return {
    certify,
    withdraw,
    cancel,
    pendingSetKey,
    notice,
    written,
    reset,
    clearWritten,
  };
}

/** The detail as the user should see it: the last write's result for this set, else the host's data. */
export const applyWrittenCertification = (
  detail: RecordSetDetail,
  written: RecordSetCertificationState['written'],
): RecordSetDetail =>
  written && written.setKey === recordSetKey(detail) ? { ...detail, certification: written.certification } : detail;

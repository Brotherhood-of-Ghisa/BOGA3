import { useEffect, useLayoutEffect, useRef, useState } from 'react';

import { certifyCompetition, endCompetitionCertification, getCompetitionCertification, toGroupApiError } from './api';
import type { MetricCertificationTarget, MetricCertificationEndAction, MetricRecordSheetNotice } from './metric-record-sheet-view-model';
import type { CompetitionCertificationWire as GroupMetricCertificationWire,CompetitionExerciseWire as GroupMetricExerciseWire } from './competition-wire';
import { useMountedRef } from './use-mounted-ref';

type MetricCertificationInput = {
  groupId: string;
  userId: string;
  row: MetricCertificationTarget;
  exercise: GroupMetricExerciseWire;
  online: boolean | null;
  readOnlyReason?: string;
  initialCertification?: GroupMetricCertificationWire | null;
  onChanged: () => Promise<void>;
};

/** What the render that offered the action saw: a write is refused or ends that certification. */
type WriteGuard = { blocked: boolean; active: GroupMetricCertificationWire | null };

/**
 * The certification behind one metric board row: read from the server, and
 * written (certify, withdraw, cancel) with the revision and random write token shown.
 *
 * Reads and writes race; `sequence` lets only the latest one land. A write is
 * remembered (`written`) so the sheet keeps showing it while the board
 * catches up, until the row shows another performance or certification.
 */
export function useMetricCertification({
  groupId, userId,row, exercise, online, readOnlyReason, initialCertification, onChanged,
}: MetricCertificationInput) {
  const [certification, setCertification] = useState<GroupMetricCertificationWire | null>(initialCertification ?? row.certification ?? null);
  const [pending, setPending] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const [notice, setNotice] = useState<MetricRecordSheetNotice | null>(null);
  const [reload, setReload] = useState(0);
  const sequence = useRef(0);
  const pendingTarget = useRef<string | null>(null);
  const written = useRef<GroupMetricCertificationWire | null>(null);
  const writtenPin = useRef<string | null>(null);
  const mounted = useMountedRef();
  const rowKey = JSON.stringify([userId,groupId,row.metric,row.member.user_id,row.write_token,exercise.rules.rules_revision]);
  const targetRef=useRef(rowKey);
  const writesBlocked=online===false || Boolean(readOnlyReason) || row.former || exercise.archived_at_ms!==null || exercise.rebuilding || needsReview;
  const writesBlockedRef=useRef(writesBlocked);
  useLayoutEffect(()=>{writesBlockedRef.current=writesBlocked;},[writesBlocked]);
  useLayoutEffect(()=>{
    if(targetRef.current!==rowKey){written.current=null;writtenPin.current=null;}
    targetRef.current=rowKey;
  },[rowKey]);
  const rowCertification=row.certification;
  useEffect(() => {
    const request = ++sequence.current;
    let activeRead = true;
    if (writtenPin.current !== row.write_token ||
      (rowCertification?.certification_id && written.current && rowCertification?.certification_id !== written.current.certification_id) ||
      (readOnlyReason && initialCertification === null && !rowCertification?.certification_id)) {
      written.current = null;
    }
    const known = written.current ?? initialCertification ?? rowCertification ?? null;
    setCertification(known);
    const certificateId = written.current?.certification_id ?? rowCertification?.certification_id;
    if (!certificateId || online === false) return;
    void getCompetitionCertification(groupId, certificateId, row.metric).then(result => {
      if (activeRead && mounted.current && sequence.current === request) {
        // Keep the latest server end state across connectivity changes; a
        // successful write must not resurrect an attestation already cancelled.
        written.current = result.certification;
        writtenPin.current = row.write_token;
        setCertification(result.certification);
      }
    }).catch(() => {
      if (activeRead && mounted.current && sequence.current === request) setNotice({ tone: 'error', message: 'Could not refresh certification. Try again.' });
    });
    return () => { activeRead = false; };
  }, [groupId,userId, rowCertification, row.write_token, row.metric, online, reload, initialCertification, readOnlyReason, mounted]);

  // Another performance or rules revision starts without the last one's review or notice.
  const [shownRowKey, setShownRowKey] = useState(rowKey);
  if (shownRowKey !== rowKey) {
    setShownRowKey(rowKey); setNeedsReview(false); setNotice(null);
    setCertification(initialCertification ?? rowCertification ?? null);
  }

  const perform = async (action: 'certify' | MetricCertificationEndAction, { blocked, active }: WriteGuard) => {
    if (blocked || writesBlockedRef.current || !mounted.current || targetRef.current !== rowKey || pendingTarget.current !== null) return;
    pendingTarget.current = rowKey;
    setPending(true); setNotice(null); sequence.current++; const requestTarget = rowKey;
    let confirmed = false;
    try {
      const result = action === 'certify'
        ? await certifyCompetition({ groupId,exerciseId: exercise.group_exercise_id,metric: row.metric,memberId: row.member.user_id,
            setId: row.performance.set_id,revision: exercise.rules.rules_revision,token: row.write_token })
        : active ? await endCompetitionCertification(groupId,active.certification_id,row.metric,action) : null;
      if (!result) return;
      confirmed = true;
      if (mounted.current && targetRef.current === requestTarget) {
        written.current = result.certification;
        writtenPin.current = row.write_token;
        setCertification(result.certification);
        setNotice({ tone: 'success', message: action === 'certify' ? 'Performance certified.' : 'Certification ended.' });
      }
      await onChanged();
      if (mounted.current && targetRef.current === requestTarget) setReload(value => value + 1);
    } catch (caught) {
      const error = toGroupApiError(caught);
      if (mounted.current && targetRef.current === requestTarget) {
        setNeedsReview(confirmed || error.code === 'NETWORK' || error.code === 'CONFLICT' || error.code === 'VALIDATION');
        setNotice({ tone: confirmed ? 'success' : 'error',message: confirmed
          ? 'Certification changed. Could not refresh the view. Refresh and review.' : certificationWriteFailure(error.code) });
      }
      if (error.code === 'FORBIDDEN' || error.code === 'NOT_FOUND') await onChanged();
    } finally {
      if (pendingTarget.current === requestTarget) pendingTarget.current = null;
      if (mounted.current) setPending(false);
    }
  };

  const refresh = () => { setReload(n => n + 1); void onChanged(); };

  return { certification, pending, needsReview, notice, perform, refresh };
}

function certificationWriteFailure(code: string): string {
  if (code === 'CONFLICT' || code === 'VALIDATION') return 'The score changed. Refresh and review before retrying. Nothing was changed.';
  if (code === 'NETWORK') return 'Could not confirm the result. Reconnect and refresh before retrying.';
  if (code === 'OFFLINE') return "You're offline. Nothing was changed.";
  if (code === 'FORBIDDEN') return 'You no longer have permission. Nothing was changed.';
  if (code === 'NOT_FOUND') return 'The performance is no longer available. Nothing was changed.';
  if (code === 'UPDATE_REQUIRED') return 'Groups are unavailable in this version. Nothing was changed.';
  return 'Could not change certification. Nothing was changed.';
}

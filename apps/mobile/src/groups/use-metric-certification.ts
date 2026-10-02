import { useEffect, useRef, useState } from 'react';

import { certifyGroupMetric, endGroupMetricCertification, getGroupMetricCertification, toGroupApiError } from './api';
import type { MetricCertificationEndAction, MetricRecordSheetNotice } from './metric-record-sheet-view-model';
import type { GroupMetricBoardRowWire, GroupMetricCertificationWire, GroupMetricExerciseWire } from './metric-wire';
import { useMountedRef } from './use-mounted-ref';

type MetricCertificationInput = {
  groupId: string;
  row: GroupMetricBoardRowWire;
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
 * written (certify, withdraw, cancel) with the revision and pin shown.
 *
 * Reads and writes race; `sequence` lets only the latest one land. A write is
 * remembered (`written`) so the sheet keeps showing it while the board
 * catches up, until the row shows another performance or certification.
 */
export function useMetricCertification({
  groupId, row, exercise, online, readOnlyReason, initialCertification, onChanged,
}: MetricCertificationInput) {
  const [certification, setCertification] = useState<GroupMetricCertificationWire | null>(initialCertification ?? null);
  const [pending, setPending] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const [notice, setNotice] = useState<MetricRecordSheetNotice | null>(null);
  const [reload, setReload] = useState(0);
  const sequence = useRef(0);
  const written = useRef<GroupMetricCertificationWire | null>(null);
  const writtenPin = useRef<string | null>(null);
  const mounted = useMountedRef();
  useEffect(() => {
    const request = ++sequence.current;
    let activeRead = true;
    if (writtenPin.current !== row.fingerprint ||
      (row.certification_id && written.current && row.certification_id !== written.current.certification_id) ||
      (readOnlyReason && initialCertification === null && !row.certification_id)) {
      written.current = null;
    }
    const known = written.current ?? initialCertification ?? null;
    setCertification(known);
    const certificateId = written.current?.certification_id ?? row.certification_id;
    if (!certificateId || online === false) return;
    void getGroupMetricCertification(groupId, certificateId).then(result => {
      if (activeRead && mounted.current && sequence.current === request) {
        // Keep the latest server end state across connectivity changes; a
        // successful write must not resurrect an attestation already cancelled.
        if (written.current?.certification_id === result.certification.certification_id) {
          written.current = result.certification;
        }
        setCertification(result.certification);
      }
    }).catch(error => {
      if (activeRead && mounted.current && sequence.current === request) setNotice({ tone: 'error', message: toGroupApiError(error).message });
    });
    return () => { activeRead = false; };
  }, [groupId, row.certification_id, row.fingerprint, online, reload, initialCertification, readOnlyReason, mounted]);

  // Another performance or rules revision starts without the last one's review or notice.
  const rowKey = JSON.stringify([row.fingerprint, row.rules_revision]);
  const [shownRowKey, setShownRowKey] = useState(rowKey);
  if (shownRowKey !== rowKey) { setShownRowKey(rowKey); setNeedsReview(false); setNotice(null); }

  const perform = async (action: 'certify' | MetricCertificationEndAction, { blocked, active }: WriteGuard) => {
    if (blocked) return;
    setPending(true); setNotice(null); sequence.current++;
    try {
      const result = action === 'certify'
        ? await certifyGroupMetric({ groupId, groupExerciseId: exercise.group_exercise_id,
            metric: row.metric, certified: false, memberUserId: row.member.user_id, setId: row.set_id,
            expectedRevision: row.rules_revision, expectedFingerprint: row.fingerprint })
        : active ? await endGroupMetricCertification(groupId, active.certification_id, action) : null;
      if (!result) return;
      if (mounted.current) {
        written.current = result.certification;
        writtenPin.current = row.fingerprint;
        setCertification(result.certification);
        setNotice({ tone: 'success', message: action === 'certify' ? 'Performance certified.' : 'Certification ended.' });
      }
      await onChanged();
      if (mounted.current) setReload(value => value + 1);
    } catch (caught) {
      const error = toGroupApiError(caught);
      if (mounted.current) {
        setNeedsReview(error.code === 'CONFLICT' || error.code === 'VALIDATION');
        setNotice({ tone: 'error', message: error.message });
      }
      if (error.code === 'FORBIDDEN' || error.code === 'NOT_FOUND') await onChanged();
    } finally { if (mounted.current) setPending(false); }
  };

  const refresh = () => { setReload(n => n + 1); void onChanged(); };

  return { certification, pending, needsReview, notice, perform, refresh };
}

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'expo-router';
import { Alert, ScrollView } from 'react-native';

import { ActionButton, ListRow, SegmentedControl, Sheet, Stat, UiText, uiSpace } from '@/components/ui';
import { canManageGroup, formatBoardDate, formatBoardMemberLabel, useNetworkOnline, type GroupRole } from '@/src/groups';
import { certifyGroupMetric, endGroupMetricCertification, getGroupMetricCertification, toGroupApiError } from '@/src/groups/api';
import { describeGroupPerformanceWeight, describeGroupRules, formatGroupMetricValue, formatGroupRawPerformance, GROUP_METRIC_LABELS, GROUP_METRIC_SHORT_LABELS } from '@/src/groups/metric-view-model';
import type { GroupMetric } from '@/src/groups/metric-contract';
import type { GroupMetricBoardRowWire, GroupMetricCertificationWire, GroupMetricExerciseWire } from '@/src/groups/metric-wire';
import { GroupWriteNotice } from './write-notice';

/** A metric attestation always submits the revision and dependency pin shown here. */
export function GroupMetricRecordSheet({ row, exercise, groupId, userId, myRole, onClose, onChanged, readOnlyReason, initialCertification, metricOptions, onSelectMetric, onHistory }: {
  row: GroupMetricBoardRowWire; exercise: GroupMetricExerciseWire; groupId: string; userId: string;
  readOnlyReason?: string; initialCertification?: GroupMetricCertificationWire | null;
  metricOptions?: GroupMetric[]; onSelectMetric?: (metric: GroupMetric) => void; onHistory?: () => void;
  myRole: GroupRole | null; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const router = useRouter();
  const online = useNetworkOnline();
  const [certification, setCertification] = useState<GroupMetricCertificationWire | null>(initialCertification ?? null);
  const [pending, setPending] = useState(false);
  const [needsReview, setNeedsReview] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'error' | 'success'; message: string } | null>(null);
  const [reload, setReload] = useState(0);
  const sequence = useRef(0);
  const written = useRef<GroupMetricCertificationWire | null>(null);
  const writtenPin = useRef<string | null>(null);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
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
  }, [groupId, row.certification_id, row.fingerprint, online, reload, initialCertification, readOnlyReason]);
  useEffect(() => { setNeedsReview(false); setNotice(null); }, [row.fingerprint, row.rules_revision]);

  const active = certification?.ended_at_ms === null ? certification : null;
  const certified = certification ? active !== null : row.certified;
  const readOnly = Boolean(readOnlyReason) || row.former || exercise.archived_at_ms !== null || exercise.rebuilding || row.rules_revision !== exercise.rules_revision;
  const isMine = row.member.user_id === userId;
  const includesWeight = row.metric === 'relative_strength' || row.metric === 'absolute_strength';
  const blocked = pending || online === false || readOnly || needsReview;
  const perform = async (action: 'certify' | 'withdraw' | 'cancel') => {
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
  const confirmEnd = (action: 'withdraw' | 'cancel') => Alert.alert(
    action === 'withdraw' ? 'Withdraw certification?' : 'Cancel certification?',
    'This performance will leave the Certified board. Its logged set stays available on All.',
    [{ text: 'Keep', style: 'cancel' }, { text: action === 'withdraw' ? 'Withdraw' : 'Cancel certification',
      style: 'destructive', onPress: () => void perform(action) }]);

  return <Sheet visible title={`${exercise.name} · ${GROUP_METRIC_LABELS[row.metric]}`} dismissLabel="Close set details"
    onDismiss={onClose} testID="group-metric-record-sheet">
    <ScrollView contentContainerStyle={{ padding: uiSpace.lg, gap: uiSpace.md }}>
      {metricOptions && onSelectMetric ? <SegmentedControl accessibilityLabel="Record metric" value={row.metric}
        options={metricOptions.map(value => ({ value, label: GROUP_METRIC_SHORT_LABELS[value] }))}
        onChange={onSelectMetric} testIDPrefix="group-metric-record-metric" /> : null}
      <Stat emphasis="record" label={GROUP_METRIC_LABELS[row.metric]} value={formatGroupMetricValue(row)} />
      <UiText>{formatBoardMemberLabel(row.member, row.former, userId)} · {formatBoardDate(row.achieved_at_ms)}</UiText>
      <UiText testID="group-metric-record-raw">As logged: {formatGroupRawPerformance(row.performance)}</UiText>
      <UiText testID="group-metric-record-weight">Session body weight: {describeGroupPerformanceWeight(row.performance)}</UiText>
      {row.effective_resistance_kg !== null ? <UiText>Effective resistance: {Number(row.effective_resistance_kg.toFixed(3))} kg</UiText> : null}
      {row.external_adjustment_kg !== null ? <UiText>External adjustment: {Number(row.external_adjustment_kg.toFixed(3))} kg
        {row.added_percent_bodyweight !== null ? ` · ${Number(row.added_percent_bodyweight.toFixed(2))}% of session body weight` : ''}</UiText> : null}
      <UiText variant="bodyMuted">{describeGroupRules(exercise)}</UiText>
      <UiText variant="bodyMuted">{includesWeight
        ? 'Certification pins this set’s entered load, mode, reps, performed status and saved body weight with its source. Corrections can invalidate it.'
        : 'Certification pins this set’s entered load, mode, reps and performed status. Session body weight is not part of this metric’s certification.'}</UiText>
      <UiText variant="bodyMuted">Strength values are estimates under the group’s declared rules. Personal exercise settings do not change these scores.</UiText>
      <UiText testID="group-metric-record-status">{active
        ? `Certified by ${active.certified_by?.username ?? 'a group member'} · ${formatBoardDate(active.certified_at_ms)}`
        : certification?.end_reason ? `Certification ${certification.end_reason}` : certified ? 'Certified' : 'Uncertified'}</UiText>
      {active && active.rules_revision !== row.rules_revision ? <UiText variant="bodyMuted">Observed under rules {active.rules_revision}; unchanged performance inputs remain attested.</UiText> : null}
      {readOnly ? <UiText variant="bodyMuted">Read-only · {readOnlyReason ?? (row.former ? 'former member' : exercise.rebuilding ? 'rules are recalculating' : 'archived or earlier rules')}</UiText> : null}
      {online === false ? <UiText variant="bodyMuted">Reconnect to change certification.</UiText> : null}
      {isMine && !certified ? <UiText variant="bodyMuted">Another group member can certify your performance.</UiText> : null}
      {notice ? <GroupWriteNotice {...notice} testID="group-metric-record-notice" /> : null}
      {needsReview || (row.certification_id && !certification && notice?.tone === 'error') ? <ActionButton label="Refresh and review"
        disabled={pending || online === false} onPress={() => { setReload(n => n + 1); void onChanged(); }} variant="outline"
        testID="group-metric-record-refresh" /> : null}
      {!certified && !isMine && !readOnly ? <ActionButton label={`Certify ${GROUP_METRIC_LABELS[row.metric]}`}
        disabled={blocked} onPress={() => void perform('certify')} variant="primary" testID="group-metric-record-certify" /> : null}
      {active?.certified_by?.user_id === userId && !readOnly ? <ListRow label="Withdraw certification" disabled={blocked}
        onPress={() => confirmEnd('withdraw')} tone="danger" testID="group-metric-record-withdraw" /> : null}
      {active && myRole && canManageGroup(myRole) && active.certified_by?.user_id !== userId && !readOnly ? <ListRow
        label="Cancel certification" disabled={blocked} onPress={() => confirmEnd('cancel')} tone="danger" testID="group-metric-record-cancel" /> : null}
      {onHistory ? <ListRow label="View rules history" onPress={onHistory} testID="group-metric-record-history" /> : null}
      <ListRow label="View full session" onPress={() => { onClose(); router.push(`/group-session/${row.member.user_id}/${row.performance.session_id}`); }}
        testID="group-metric-record-session" />
    </ScrollView>
  </Sheet>;
}

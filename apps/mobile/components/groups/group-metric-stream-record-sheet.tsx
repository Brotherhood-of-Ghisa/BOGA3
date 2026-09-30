import { useState } from 'react';
import { useRouter } from 'expo-router';

import type { GroupRole } from '@/src/groups';
import type { GroupMetric } from '@/src/groups/metric-contract';
import type { GroupMetricBoardRowWire, GroupMetricStreamItemWire } from '@/src/groups/metric-wire';
import { GroupMetricRecordSheet } from './group-metric-record-sheet';

export type MetricStreamRecord = Extract<GroupMetricStreamItemWire, { kind: 'record' }>;

/** Current context does not replace the event's score, revision or performance snapshot. */
export function GroupMetricStreamRecordSheet({ record, userId, myRole, onClose, onChanged }: {
  record: MetricStreamRecord; userId: string; myRole: GroupRole | null; onClose: () => void; onChanged: () => Promise<void>;
}) {
  const router = useRouter();
  const [pickedMetric, setPickedMetric] = useState<GroupMetric>(record.boards.some(b => b.metric === record.group_exercise.default_metric)
    ? record.group_exercise.default_metric : record.boards[0].metric);
  const score = record.boards.find(b => b.metric === pickedMetric) ?? record.boards[0];
  const context = record.record_context;
  const detail = context?.metrics.find(item => item.metric === score.metric && item.fingerprint === score.fingerprint);
  const certificate = detail?.certification ?? null;
  const exercise = { ...(context?.exercise ?? { legacy: false, source_exercise_id: null, archived_at_ms: null,
    published_revision: record.rules_revision, rebuilding: false }), ...record.group_exercise };
  const readOnlyReason = !context ? 'refresh this record to load its current certification state'
    : record.voided ? 'record removed' : context.former ? 'former member'
    : context.exercise.rules_revision !== record.rules_revision ? 'earlier rules revision'
    : context.exercise.archived_at_ms !== null ? 'archived comparison'
    : context.exercise.rebuilding ? 'rules are recalculating' : !detail?.eligible ? 'performance changed; refresh to review' : undefined;
  const row: GroupMetricBoardRowWire = { ...score, rank: 1, member: record.member ?? { user_id: '', username: null },
    former: context?.former ?? false, achieved_at_ms: record.performance.achieved_at_ms, rules_revision: record.rules_revision,
    set_id: record.set_id, performance: record.performance,
    certified: certificate !== null, certification_id: certificate?.certification_id ?? null };
  return <GroupMetricRecordSheet key={`${record.key}:${score.metric}`} row={row} exercise={exercise} groupId={record.group.group_id}
    userId={userId} myRole={myRole} onClose={onClose} onChanged={onChanged} readOnlyReason={readOnlyReason}
    initialCertification={certificate} metricOptions={record.boards.map(board => board.metric)} onSelectMetric={setPickedMetric}
    onHistory={() => { onClose(); router.push(`/group/${record.group.group_id}/leaderboards/${record.group_exercise_id}/history?metric=${score.metric}&scope=all&revision=${record.rules_revision}`); }} />;
}

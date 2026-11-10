import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';

import { SubPage } from '@/components/settings/sub-page';
import { ActionButton, ActionRow, FormSection, Notice, StatePanel, ValueRow } from '@/components/ui';
import { loadMergeReview, recoverExerciseMerge, resolveMergeReview } from '@/src/exercise-catalog/merge';
import type { MergeReviewItem, MergeValue } from '@/src/exercise-core/merge-types';
import { formatSessionSetType } from '@/src/data/set-types';
import { useDateFormat } from '@/src/preferences/hooks';
import { formatLocalDateTime } from '@/src/utils/local-time';

const SET_FIELDS = [
  ['weight_value', 'Weight'], ['reps_value', 'Reps'], ['planned_weight_value', 'Planned weight'],
  ['planned_reps_value', 'Planned reps'], ['planned_set_type', 'Planned effort'], ['set_type', 'Effort'], ['performance_status', 'State'],
  ['order_index', 'Position'],
] as const;
function display(value: MergeValue | undefined, key: string): string {
  if (value === undefined) return 'Empty';
  if (key === 'set_type' || key === 'planned_set_type') return formatSessionSetType(value) ?? 'Unspecified';
  if (key === 'order_index') return String(Number(value) + 1);
  if (key === 'performance_status') return value === null ? 'Performed' : String(value);
  return value === null || value === undefined || value === '' ? 'Empty' : String(value);
}
function changes(item: MergeReviewItem, dateFormat: Parameters<typeof formatLocalDateTime>[1]) {
  const fields: readonly (readonly [string, string])[] = item.type === 'exercise_sets' ? SET_FIELDS :
    item.type === 'sessions' ? [['gym_name', 'Gym'], ['started_at', 'Start'], ['completed_at', 'End']] :
    item.type === 'session_exercises' ? [['machine_name', 'Machine'], ['order_index', 'Position']] :
      [['tag_name', 'Tag']];
  const value = (row: MergeReviewItem['current'], key: string) => {
    const raw = row?.[key];
    if (!['started_at', 'completed_at'].includes(key) || typeof raw !== 'number') return display(raw, key);
    const formatted = formatLocalDateTime(raw, dateFormat);
    const a = item.current?.[key], b = item.saved?.[key];
    if (typeof a !== 'number' || typeof b !== 'number' || a === b ||
        formatLocalDateTime(a, dateFormat) !== formatLocalDateTime(b, dateFormat)) return formatted;
    // Show the stored difference when minute-rounded labels would look equal.
    const date = new Date(raw);
    return formatted + ':' + String(date.getSeconds()).padStart(2, '0') + '.' + String(date.getMilliseconds()).padStart(3, '0');
  };
  const rows = fields.filter(([key]) => key === 'gym_name' ? item.current?.gym_id !== item.saved?.gym_id
    : item.current?.[key] !== item.saved?.[key]).map(([key, label]) => {
    const current = value(item.current, key), saved = value(item.saved, key);
    return { label, current, saved: key === 'gym_name' && current === saved ? saved + ' (different gym)' : saved };
  });
  if (!item.current || Boolean(item.current.deleted_at) !== Boolean(item.saved?.deleted_at)) {
    rows.push({ label: 'History', current: !item.current ? 'Absent' : item.current.deleted_at ? 'Removed' : 'Kept',
      saved: item.saved?.deleted_at ? 'Removed' : 'Kept' });
  }
  return rows;
}

const confirmRemoval = (onConfirm: () => void) =>
  Alert.alert('Apply saved removal?', 'The saved removal replaces your current history.', [
    { text: 'Cancel', style: 'cancel' },
    { text: 'Apply', style: 'destructive', onPress: onConfirm },
  ]);

// Settings → Data & sync → Review changes. Recovery only: every Apply is
// checked again against the current server graph.
export function ExerciseMergeReviewScreen() {
  const [items, setItems] = useState<MergeReviewItem[]>([]);
  const [pending, setPending] = useState(0);
  const [operation, setOperation] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lifetime = useRef({ active: false });
  const dateFormat = useDateFormat();
  const reload = useCallback(async () => {
    setBusy(true);
    try {
      const next = await loadMergeReview();
      if (lifetime.current.active) {
        setItems(next.items); setPending(next.pending); setOperation(next.operation);
        setError(next.error ?? null);
      }
    } catch (failure) {
      if (lifetime.current.active) setError(failure instanceof Error ? failure.message : 'Unable to load saved changes.');
    } finally { if (lifetime.current.active) setBusy(false); }
  }, []);
  useEffect(() => {
    const current = lifetime.current;
    current.active = true;
    void Promise.resolve().then(() => { if (current.active) void reload(); });
    return () => { current.active = false; };
  }, [reload]);

  const resolve = async (item: MergeReviewItem, keep: boolean) => {
    setBusy(true); setError(null);
    try {
      await resolveMergeReview(item, keep);
      await reload();
    } catch (failure) {
      if (failure instanceof Error && failure.message.includes('MERGE_STALE')) await reload();
      if (lifetime.current.active) setError(failure instanceof Error && failure.message.includes('MERGE_STALE') ?
        'History changed on another device. Review the refreshed values before applying.' :
        failure instanceof Error ? failure.message : 'Unable to apply saved changes.');
    } finally { if (lifetime.current.active) setBusy(false); }
  };
  const recover = async () => {
    setBusy(true); setError(null);
    try { await recoverExerciseMerge(); await reload(); }
    catch (failure) { if (lifetime.current.active) setError(failure instanceof Error ? failure.message : 'Unable to check the merge.'); }
    finally { if (lifetime.current.active) setBusy(false); }
  };

  return <SubPage testID="exercise-merge-review">
    {error ? <Notice tone="danger" live message={error} testID="exercise-merge-review-error"
      action={<ActionButton label="Retry" variant="text" disabled={busy} onPress={() => { void reload(); }} />} /> : null}
    {pending ? <Notice message="Saved changes are waiting to sync." testID="exercise-merge-review-pending"
      action={<ActionButton label="Retry" variant="text" disabled={busy} onPress={() => { void reload(); }} />} /> : null}
    {operation ? <FormSection title="Merge">
      <ActionRow kind="act" label="Check merge result" disabled={busy}
        onPress={() => { void recover(); }} testID="exercise-merge-recover" />
    </FormSection> : null}
    {busy ? <StatePanel kind="loading" body="Checking saved changes…" fill={false} /> : null}
    {items.map(item => {
      const removal = Boolean(item.saved?.deleted_at);
      const apply = () => { void resolve(item, false); };
      const fieldChanges = changes(item, dateFormat);
      const noMetadata = item.type === 'sessions' && ['gym_id', 'started_at', 'completed_at']
        .every(key => item.current?.[key] === item.saved?.[key]);
      const lifecycle = item.current?.deleted_at ? 'deleted' : item.current?.status === 'completed' ? 'finished' : 'active';
      const notice = noMetadata ? 'No metadata changes need applying. Reopen or restore the workout in the app.'
        : item.type === 'sessions' ? `Applying saved metadata keeps this workout ${lifecycle}.`
        : item.notice;
      return <FormSection key={item.id} title={item.exerciseName} testID={'exercise-merge-conflict-' + item.id}
        error={item.invalid ? item.notice ?? 'These saved values need correction before they can be applied.' : null}>
        {item.sessionStartedAt ? <ValueRow label="Session" value={formatLocalDateTime(item.sessionStartedAt, dateFormat)} /> : null}
        {item.type === 'sessions' ? <ValueRow divider label="Workout" value={lifecycle === 'finished' ? 'Finished' : lifecycle === 'deleted' ? 'Deleted' : 'Active'} /> : null}
        {notice && !item.invalid ? <Notice message={notice} /> : null}
        {fieldChanges.map((change, index) => <ValueRow key={change.label}
          divider={index > 0 || Boolean(item.sessionStartedAt)} label={change.label}
          value={change.current + ' → ' + change.saved}
          accessibilityLabel={change.label + ': current ' + change.current + ', saved ' + change.saved} />)}
        <ActionRow divider kind="act" label="Keep current history" disabled={busy}
          onPress={() => { void resolve(item, true); }} testID={'exercise-merge-keep-' + item.id} />
        <ActionRow divider kind={removal ? 'danger' : 'act'} label={removal ? 'Apply saved removal' : 'Apply saved changes'}
          disabled={busy || item.invalid || noMetadata} onPress={removal ? () => confirmRemoval(apply) : apply}
          testID={'exercise-merge-apply-' + item.id} />
      </FormSection>;
    })}
    {!busy && !items.length && !pending && !operation && !error ?
      <StatePanel body="No changes need review." fill={false} /> : null}
  </SubPage>;
}

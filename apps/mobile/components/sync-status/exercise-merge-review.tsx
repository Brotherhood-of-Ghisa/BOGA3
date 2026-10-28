import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton, Card, FigureText, Notice, PageSheet, StatePanel, uiSpace, uiText } from '@/components/ui';
import { loadMergeReview, recoverExerciseMerge, resolveMergeReview } from '@/src/exercise-catalog/merge';
import type { MergeReviewItem, MergeValue } from '@/src/exercise-core/merge-types';
import { formatSessionSetType } from '@/src/data/set-types';
import { useDateFormat } from '@/src/preferences/hooks';
import { formatLocalDateTime } from '@/src/utils/local-time';

type Props = { visible: boolean; onDismiss: () => void; onChanged: () => void };

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
function changes(item: MergeReviewItem) {
  const fields: readonly (readonly [string, string])[] = item.type === 'exercise_sets' ? SET_FIELDS :
    item.type === 'session_exercises' ? [['machine_name', 'Machine'], ['order_index', 'Position']] :
      [['tag_name', 'Tag']];
  const rows = fields.filter(([key]) => item.current?.[key] !== item.saved?.[key]).map(([key, label]) => ({
    label, current: display(item.current?.[key], key), saved: display(item.saved?.[key], key),
  }));
  if (!item.current || Boolean(item.current.deleted_at) !== Boolean(item.saved?.deleted_at)) {
    rows.push({ label: 'History', current: !item.current ? 'Absent' : item.current.deleted_at ? 'Removed' : 'Kept',
      saved: item.saved?.deleted_at ? 'Removed' : 'Kept' });
  }
  return rows;
}

// Recovery only: every Apply is checked again against the current server graph.
export function ExerciseMergeReview({ visible, onDismiss, onChanged }: Props) {
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
    current.active = visible;
    if (visible) void Promise.resolve().then(() => { if (current.active) void reload(); });
    return () => { current.active = false; };
  }, [reload, visible]);

  const resolve = async (item: MergeReviewItem, keep: boolean) => {
    setBusy(true); setError(null);
    try {
      await resolveMergeReview(item, keep);
      await reload();
      onChanged();
    } catch (failure) {
      if (failure instanceof Error && failure.message.includes('MERGE_STALE')) await reload();
      if (lifetime.current.active) setError(failure instanceof Error && failure.message.includes('MERGE_STALE') ?
        'History changed on another device. Review the refreshed values before applying.' :
        failure instanceof Error ? failure.message : 'Unable to apply saved changes.');
    } finally { if (lifetime.current.active) setBusy(false); }
  };
  const recover = async () => {
    setBusy(true); setError(null);
    try { await recoverExerciseMerge(); await reload(); onChanged(); }
    catch (failure) { if (lifetime.current.active) setError(failure instanceof Error ? failure.message : 'Unable to check the merge.'); }
    finally { if (lifetime.current.active) setBusy(false); }
  };

  return <PageSheet title="Review changes" closeLabel="Close review changes" visible={visible}
    onDismiss={onDismiss} dismissDisabled={busy} testID="exercise-merge-review">
    <ScrollView contentContainerStyle={styles.content} testID="exercise-merge-review-list">
      {error ? <Notice tone="danger" live message={error} testID="exercise-merge-review-error" /> : null}
      {operation ? <Card><ActionButton label="Check merge result" variant="outline" disabled={busy}
        onPress={() => { void recover(); }} testID="exercise-merge-recover" /></Card> : null}
      {pending ? <StatePanel kind="error" body="Saved changes are waiting to sync." fill={false}
        action={{ label: 'Retry', onPress: () => { void reload(); } }} /> : null}
      {busy ? <StatePanel kind="loading" body="Checking saved changes…" fill={false} /> : null}
      {items.map(item => <Card key={item.id} style={styles.card} testID={'exercise-merge-conflict-' + item.id}>
        <Text allowFontScaling={false} style={uiText.bodyStrong}>{item.exerciseName}</Text>
        {item.sessionStartedAt ? <Text allowFontScaling={false} style={uiText.figureSmall}>
          {formatLocalDateTime(item.sessionStartedAt, dateFormat)}
        </Text> : null}
        <View style={styles.row}><Text allowFontScaling={false} style={[uiText.label, styles.column]}>Current</Text>
          <Text allowFontScaling={false} style={[uiText.label, styles.column]}>Saved</Text></View>
        {changes(item).map(change => <View key={change.label}>
          <Text allowFontScaling={false} style={uiText.label}>{change.label}</Text>
          <View style={styles.row} accessibilityLabel={change.label + ': current ' + change.current + ', saved ' + change.saved}>
            <Text allowFontScaling={false} style={[uiText.body, styles.column]}><FigureText>{change.current}</FigureText></Text>
            <Text allowFontScaling={false} style={[uiText.body, styles.column]}><FigureText>{change.saved}</FigureText></Text>
          </View>
        </View>)}
        {item.invalid ? <Notice tone="danger" message="These saved values need correction before they can be applied." /> : null}
        <ActionButton label="Keep current history" variant="outline" disabled={busy}
          onPress={() => { void resolve(item, true); }} testID={'exercise-merge-keep-' + item.id} />
        <ActionButton label={item.saved?.deleted_at ? 'Apply saved removal' : 'Apply saved changes'}
          variant={item.saved?.deleted_at ? 'outline' : 'primary'} tone={item.saved?.deleted_at ? 'danger' : 'default'}
          disabled={busy || item.invalid} onPress={() => { void resolve(item, false); }} testID={'exercise-merge-apply-' + item.id} />
      </Card>)}
      {!busy && !items.length && !pending && !operation && !error ?
        <StatePanel body="No changes need review." fill={false} /> : null}
      {error ? <ActionButton label="Retry" variant="outline" disabled={busy} onPress={() => { void reload(); }} /> : null}
    </ScrollView>
  </PageSheet>;
}
const styles = StyleSheet.create({
  content: { padding: uiSpace.lg, gap: uiSpace.md },
  card: { padding: uiSpace.md, gap: uiSpace.sm },
  row: { flexDirection: 'row', gap: uiSpace.md },
  column: { flex: 1 },
});

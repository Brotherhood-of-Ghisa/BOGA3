import { useCallback, useEffect, useRef, useState } from 'react';
import { ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { ActionButton, Card, FormField, Icon, ListRow, Notice, Sheet, StatePanel, uiRoles } from '@/components/ui';
import { parseBackfillRange, type BackfillRange } from '@/src/bodyweight/backfill';
import { sessionWeightSourceLabel } from '@/src/bodyweight/weight-entry';
import { applySessionWeightBackfill, loadSessionWeightBackfill, previewSessionWeightBackfill,
  type SessionWeightBackfillInventory, type SessionWeightBackfillPreview } from '@/src/data/bodyweight-backfill';
import { formatCurrentDateTime } from '@/src/session-recorder/session-model';
import { weightStyles as styles } from './styles';

export function SessionWeightBackfillSheet({ visible, onDismiss, onAfterDismiss, onAddReading }: {
  visible: boolean; onDismiss: () => void; onAfterDismiss?: () => void; onAddReading: () => void;
}) {
  const { height } = useWindowDimensions();
  const [from, setFrom] = useState('');
  const [through, setThrough] = useState('');
  const [rangeChanged, setRangeChanged] = useState(false);
  const [inventory, setInventory] = useState<SessionWeightBackfillInventory | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [preview, setPreview] = useState<SessionWeightBackfillPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ filled: number; skipped: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const generation = useRef(0);
  const scroll = useRef<ScrollView>(null);
  // Loads the sessions in `range` for request `current`; stale answers are dropped.
  const fetchInventory = useCallback((range: BackfillRange, current: number) =>
    loadSessionWeightBackfill(range).then(next => {
      if (current !== generation.current) return;
      setInventory(next); setRangeChanged(false);
      setSelected(next.rows.filter(row => row.status === 'ready').map(row => row.sessionId));
    }, cause => {
      if (current === generation.current) {
        setError(cause instanceof Error ? cause.message : 'Could not load sessions.');
        scroll.current?.scrollTo({ y: 0, animated: false });
      }
    }), []);
  const load = (start: string, end: string) => {
    const current = ++generation.current;
    setError(null); setPreview(null); setResult(null);
    let range: BackfillRange;
    try {
      range = parseBackfillRange(start, end);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load sessions.');
      scroll.current?.scrollTo({ y: 0, animated: false });
      return;
    }
    setInventory(null);
    void fetchInventory(range, current);
  };
  // Opening starts from an empty range, reset in the render that opens.
  const [shownVisible, setShownVisible] = useState(false);
  if (visible !== shownVisible) {
    setShownVisible(visible);
    if (visible) {
      setFrom(''); setThrough(''); setRangeChanged(false); setInventory(null);
      setError(null); setPreview(null); setResult(null);
    }
  }
  useEffect(() => {
    if (!visible) return;
    scroll.current?.scrollTo({ y: 0, animated: false });
    void fetchInventory(parseBackfillRange('', ''), ++generation.current);
    return () => { generation.current += 1; };
  }, [fetchInventory, visible]);

  const prepare = () => {
    if (!inventory) return;
    setError(null);
    try {
      if (rangeChanged) throw new Error('Apply the date range before previewing.');
      setPreview(previewSessionWeightBackfill(inventory, selected));
      scroll.current?.scrollTo({ y: 0, animated: false });
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not preview these sessions.'); }
  };
  const apply = async () => {
    if (!preview || busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try {
      setResult(await applySessionWeightBackfill(preview));
      setPreview(null);
      scroll.current?.scrollTo({ y: 0, animated: false });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Nothing was filled. Refresh the preview and try again.');
      scroll.current?.scrollTo({ y: 0, animated: false });
    } finally { busyRef.current = false; setBusy(false); }
  };
  const estimated = preview?.rows.filter(row => row.status === 'ready' && row.snapshot.bodyWeightSource === 'historical_estimate').length ?? 0;

  return <Sheet visible={visible} onDismissed={onAfterDismiss} title="Fill session weights" testID="bodyweight-backfill" keyboardAvoiding
    dismissLabel="Cancel filling session weights" onDismiss={() => { if (!busyRef.current) onDismiss(); }}>
    <ScrollView ref={scroll} style={{ maxHeight: height * 0.8, flexGrow: 0 }} contentContainerStyle={styles.form}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" testID="bodyweight-backfill-scroll">
      {error ? <Notice tone="danger" live message={error} testID="bodyweight-backfill-error" /> : null}
      {result ? <>
        <Notice live testID="bodyweight-backfill-result"
          message={`${result.filled} session ${result.filled === 1 ? 'weight' : 'weights'} filled. ${result.skipped} already filled or deleted ${result.skipped === 1 ? 'session was' : 'sessions were'} skipped.`} />
        <Text allowFontScaling={false} style={styles.body}>These weights are saved on the sessions. Later readings or edits to the source readings will not change them.</Text>
        <ActionButton label="Done" variant="primary" onPress={onDismiss} testID="bodyweight-backfill-done" />
      </> : preview ? <>
        <Text allowFontScaling={false} style={styles.label} testID="bodyweight-backfill-count">{`${preview.rows.length} ${preview.rows.length === 1 ? 'session' : 'sessions'} · ${estimated} estimated`}</Text>
        <Text allowFontScaling={false} style={styles.body}>Review each source date. Estimated values use the earliest available reading, taken after the workout. No interpolation is used.</Text>
        {preview.rows.map(row => row.status === 'ready' ? <Card key={row.sessionId}>
          <View style={styles.cardBody} testID={`bodyweight-backfill-preview-${row.sessionId}`}>
            <Text allowFontScaling={false} style={styles.label}>{formatCurrentDateTime(row.startedAt)}</Text>
            <Text allowFontScaling={false} style={styles.body}>{`${row.snapshot.bodyWeightKg} kg · ${sessionWeightSourceLabel(row.snapshot)}`}</Text>
          </View>
        </Card> : null)}
        <Notice message="This recalculates bodyweight-dependent personal metrics and group scores. Affected strength certifications need review. Existing session weights are left unchanged." />
        <ActionButton label={busy ? 'Filling…' : 'Fill selected session weights'} variant="primary" disabled={busy}
          testID="bodyweight-backfill-apply" onPress={() => { void apply(); }} />
        <ActionButton label="Change selection" variant="outline" disabled={busy} onPress={() => { setPreview(null); scroll.current?.scrollTo({ y: 0 }); }} />
      </> : <>
        <Text allowFontScaling={false} style={styles.body}>Choose completed sessions with no saved body weight. Each uses the latest reading at its start, or the earliest later reading as a labelled estimate. Nothing changes until you apply the preview.</Text>
        <FormField label="From date (optional)" value={from} face="text" placeholder="YYYY-MM-DD" autoCorrect={false}
          testID="bodyweight-backfill-from" accessibilityLabel="Fill session weights from date"
          onChangeText={value => { setFrom(value); setRangeChanged(true); }} />
        <FormField label="Through date (optional)" value={through} face="text" placeholder="YYYY-MM-DD" autoCorrect={false}
          testID="bodyweight-backfill-through" accessibilityLabel="Fill session weights through date"
          onChangeText={value => { setThrough(value); setRangeChanged(true); }} />
        <ActionButton label="Apply date range" variant="outline" testID="bodyweight-backfill-range"
          onPress={() => load(from, through)} />
        {!inventory && !error ? <StatePanel kind="loading" body="Loading missing session weights…" /> : null}
        {inventory && !inventory.hasReadings ? <StatePanel title="Add a reading first" body="A reading is needed to preview weights. You can also set an individual session weight from its detail screen."
          testID="bodyweight-backfill-no-readings" action={{ label: 'Add reading', onPress: onAddReading }} /> : null}
        {inventory?.rows.length === 0 ? <StatePanel body="No completed sessions with missing weights in this range." testID="bodyweight-backfill-empty" /> : null}
        {inventory && inventory.rows.length > 0 ? <>
          <Text allowFontScaling={false} style={styles.label}>{`${selected.length} selected`}</Text>
          <Card>{inventory.rows.map((row, index) => <ListRow key={row.sessionId} divider={index > 0}
            selected={selected.includes(row.sessionId)} testID={`bodyweight-backfill-select-${row.sessionId}`}
            onPress={row.status === 'ready' ? () => setSelected(current => current.includes(row.sessionId)
              ? current.filter(id => id !== row.sessionId) : [...current, row.sessionId]) : undefined}
            leading={row.status === 'ready' ? <Icon name={selected.includes(row.sessionId) ? 'check' : 'plus'} color={uiRoles.ink} /> : undefined}>
            <Text allowFontScaling={false} style={styles.body}>{formatCurrentDateTime(row.startedAt)}</Text>
            <Text allowFontScaling={false} style={styles.body}>{row.status === 'ready'
              ? `${row.snapshot.bodyWeightKg} kg · ${sessionWeightSourceLabel(row.snapshot)}` : row.reason}</Text>
          </ListRow>)}</Card>
          <ActionButton label="Preview selected sessions" variant="primary" disabled={rangeChanged || selected.length === 0}
            testID="bodyweight-backfill-preview" onPress={prepare} />
        </> : null}
      </>}
      {!busy && !result ? <ActionButton label="Refresh preview" variant="outline" testID="bodyweight-backfill-refresh"
        onPress={() => load(from, through)} /> : null}
      {!busy && !result ? <ActionButton label="Cancel" variant="outline" testID="bodyweight-backfill-cancel" onPress={onDismiss} /> : null}
    </ScrollView>
  </Sheet>;
}

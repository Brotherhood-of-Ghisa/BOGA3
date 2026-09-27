import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { ActionButton, Card, Icon, ListRow, Notice, SegmentedControl, Sheet, StatePanel, uiRoles } from '@/components/ui';
import { sessionWeightSourceLabel } from '@/src/bodyweight/weight-entry';
import { type LegacyLoadChoice, type LegacyLoadInterpretation } from '@/src/bodyweight/legacy-load';
import { applyLegacyLoadReview, listLegacyLoads, previewLegacyLoads, type LegacyLoadInventory,
  type LegacyLoadPreview } from '@/src/data/legacy-load-review';
import { formatCurrentDateTime } from '@/src/session-recorder/session-model';
import { weightStyles as styles } from './styles';

const meanings: { value: LegacyLoadInterpretation; label: string; description: string }[] = [
  { value: 'added', label: 'Added weight', description: 'External load only; body weight was not included.' },
  { value: 'assistance', label: 'Assistance', description: 'A known counterweight or machine assistance amount.' },
  { value: 'total', label: 'Total resistance', description: 'Body weight was already included.' },
  { value: 'unquantified_assistance', label: 'Unquantified', description: 'Assistance such as a band, without a kilogram equivalent.' },
];
const loadLabel = (mode: string) => mode === 'added' ? 'Added' : mode === 'assistance' ? 'Assistance' : 'Unquantified';

type LegacyLoadReviewProps = {
  exerciseId: string;
  visible: boolean;
  onDismiss: () => void;
  onApplied?: () => void;
};

export function LegacyLoadReviewSheet(props: LegacyLoadReviewProps) {
  const busy = useRef(false);
  return <Sheet visible={props.visible} title="Review original loads" testID="legacy-load-review"
    dismissLabel="Leave old loads unresolved" onDismiss={() => { if (!busy.current) props.onDismiss(); }}>
    <LegacyLoadReviewContent {...props} onBusyChange={value => { busy.current = value; }} />
  </Sheet>;
}

/** The exercise editor hosts this panel in its existing native sheet. */
export function LegacyLoadReviewContent({ exerciseId, visible, onDismiss, onApplied, onBusyChange }: LegacyLoadReviewProps & {
  onBusyChange?: (busy: boolean) => void;
}) {
  const { height } = useWindowDimensions();
  const [inventory, setInventory] = useState<LegacyLoadInventory | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [choices, setChoices] = useState<Record<string, LegacyLoadChoice>>({});
  const replacingMetadata = inventory?.candidates.some(row => !row.metadataKnown) ?? false;
  const [unit, setUnit] = useState<'kg' | 'lb' | ''>('');
  const [meaning, setMeaning] = useState<LegacyLoadInterpretation | null>(null);
  const [preview, setPreview] = useState<LegacyLoadPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);

  // Opening, or Refresh, starts a fresh review, reset in the render that asks for it.
  const reviewKey = visible ? JSON.stringify([exerciseId, refresh]) : null;
  const [shownReviewKey, setShownReviewKey] = useState<string | null>(null);
  if (reviewKey !== shownReviewKey) {
    setShownReviewKey(reviewKey);
    if (reviewKey !== null) {
      setInventory(null); setPreview(null); setSelected([]); setError(null); setResult(null);
      setUnit(''); setMeaning(null); setChoices({});
    }
  }
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    void listLegacyLoads(exerciseId).then(data => { if (!cancelled) setInventory(data); })
      .catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not load old sets.'); });
    return () => { cancelled = true; };
  }, [exerciseId, visible, refresh]);

  const keepChoices = () => {
    setError(null);
    if (!selected.length || !unit || !meaning) {
      setError('Select loads and choose their original unit and meaning first.'); return;
    }
    setChoices(current => ({ ...current, ...Object.fromEntries(selected.map(key =>
      [key, { unit, interpretation: meaning }])) }));
    setSelected([]); setUnit(''); setMeaning(null);
  };
  const prepare = () => {
    if (!inventory) return;
    setError(null);
    if (replacingMetadata && selected.length > 0) {
      setError('Keep the choices for your current selection before previewing.'); return;
    }
    if (!replacingMetadata && (!unit || !meaning)) {
      setError('Choose the original unit and what the selected values meant.'); return;
    }
    try {
      const selections = replacingMetadata ? Object.entries(choices).map(([key, choice]) => ({ key, choice }))
        : selected.map(key => ({ key, choice: { unit: unit as 'kg' | 'lb', interpretation: meaning! } }));
      setPreview(previewLegacyLoads(inventory, selections));
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not preview these loads.'); }
  };
  const apply = async () => {
    if (!preview || busyRef.current) return;
    busyRef.current = true; setBusy(true); onBusyChange?.(true); setError(null);
    try {
      const count = await applyLegacyLoadReview(preview);
      setResult(`${count} ${count === 1 ? 'load reviewed' : 'loads reviewed'}. Unselected loads remain unresolved.`);
      setPreview(null);
      onApplied?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not apply the review. Nothing was converted.');
    } finally { busyRef.current = false; setBusy(false); onBusyChange?.(false); }
  };

  return <ScrollView style={{ maxHeight: height * 0.8, flexGrow: 0 }} contentContainerStyle={styles.form}
      testID="legacy-load-review-scroll" keyboardShouldPersistTaps="handled">
      {error ? <Notice tone="danger" live message={error} testID="legacy-load-error" /> : null}
      {!inventory && !error ? <StatePanel kind="loading" body="Loading original sets…" /> : null}
      {result ? <>
        <Notice tone="neutral" message={result} testID="legacy-load-result" />
        <ActionButton label="Done" onPress={onDismiss} variant="primary" />
      </> : inventory ? <>
        <Text allowFontScaling={false} style={styles.body}>
          {inventory.exerciseName}: old numbers do not reveal whether they meant added weight, assistance or total resistance. Original units were not always retained by imports. Confirm the source unit yourself. No conversion happens until Apply.
        </Text>
        {replacingMetadata ? <Notice testID="legacy-load-replace-metadata"
          message="Saved load settings are unavailable on this device. Sync first to recover settings saved elsewhere, or review them here. Applying this review intentionally replaces those settings. Review every nonempty actual and planned part of each chosen set, using separate choices when their units or meanings differ. Empty parts have no load meaning. Nothing changes before Apply." /> : null}
        {preview ? <>
          <Text allowFontScaling={false} style={styles.label}>{`${preview.rows.length} selected loads`}</Text>
          {preview.rows.map(({ original, reviewed }) => <Card key={original.key}>
            <View style={styles.cardBody}>
              <Text allowFontScaling={false} style={styles.label}>{`${formatCurrentDateTime(original.startedAt)} · Set ${original.setNumber} · ${original.part}`}</Text>
              <Text allowFontScaling={false} style={styles.body}>{`Original: ${original.weightValue || '(blank → 0 with reps)'} ${reviewed.weightUnit} × ${original.repsValue || '—'}`}</Text>
              <Text allowFontScaling={false} style={styles.body} testID={`legacy-load-preview-${original.key}`}>
                {reviewed.externalLoadMode === 'unquantified_assistance' ? 'Unquantified assistance · no load score' :
                  `${loadLabel(reviewed.externalLoadMode)}: ${reviewed.weightValue} ${reviewed.weightUnit} · Effective load ${reviewed.resistanceKg === null ? 'unavailable' : `${Number(reviewed.resistanceKg.toFixed(3))} kg`}`}
              </Text>
              <Text allowFontScaling={false} style={styles.body}>{`Session weight: ${original.bodyWeightKg ?? 'unknown'}${original.bodyWeightKg === null ? '' : ' kg'} · ${sessionWeightSourceLabel(original)}`}</Text>
            </View>
          </Card>)}
          <Text allowFontScaling={false} style={styles.body}>
            Total conversion subtracts this exercise’s bodyweight contribution, then divides only external load for per-side entry. Personal metrics and group scores may change; affected certifications need review. Set confirmation stays unchanged.
          </Text>
          <ActionButton label={busy ? 'Applying…' : 'Apply reviewed loads'} disabled={busy} onPress={() => { void apply(); }}
            testID="legacy-load-apply" variant="primary" />
          <ActionButton label="Change selection" disabled={busy} onPress={() => setPreview(null)} variant="outline" />
        </> : <>
          {inventory.candidates.length === 0 ? <StatePanel body="No unresolved loads for this exercise." /> : <>
            <Text allowFontScaling={false} style={styles.label}>Choose what the selected values meant</Text>
            <Card>{meanings.map((option, index) => <ListRow key={option.value} label={option.label} description={option.description}
              accessibilityLabel={`${option.label}. ${option.description}`} divider={index > 0}
              onPress={() => setMeaning(option.value)} selected={meaning === option.value}
              leading={<Icon name={meaning === option.value ? 'radio-on' : 'radio-off'} color={uiRoles.ink} />}
              testID={`legacy-load-meaning-${option.value}`} />)}</Card>
            <Text allowFontScaling={false} style={styles.label}>Confirm original unit</Text>
            <SegmentedControl options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]}
              value={unit} onChange={value => setUnit(value as 'kg' | 'lb')} style={styles.unitControl} testIDPrefix="legacy-load-unit" />
            <Text allowFontScaling={false} style={styles.label}>{`${selected.length} selected · select only loads with this meaning and unit`}</Text>
            <Card>{inventory.candidates.map((row, index) => <ListRow key={row.key} divider={index > 0}
              onPress={() => setSelected(current => current.includes(row.key) ? current.filter(key => key !== row.key) : [...current, row.key])}
              selected={selected.includes(row.key)} testID={`legacy-load-select-${row.key}`}
              leading={<Icon name={selected.includes(row.key) ? 'check' : 'plus'} color={uiRoles.ink} />}>
              <Text allowFontScaling={false} style={styles.body}>{`${formatCurrentDateTime(row.startedAt)} · Set ${row.setNumber} · ${row.part}`}</Text>
              <Text allowFontScaling={false} style={styles.body}>{`Original ${row.weightValue || '(blank)'} × ${row.repsValue || '—'} · unit unverified`}</Text>
              {choices[row.key] ? <Text allowFontScaling={false} style={styles.body}
                testID={`legacy-load-choice-${row.key}`}>{`Review choice: ${meanings.find(option => option.value === choices[row.key].interpretation)?.label} · ${choices[row.key].unit}`}</Text> : null}
              <Text allowFontScaling={false} style={styles.body}>{`Session weight: ${row.bodyWeightKg === null ? 'unknown' : `${row.bodyWeightKg} kg`} · ${sessionWeightSourceLabel(row)}`}</Text>
            </ListRow>)}</Card>
            {replacingMetadata ? <>
              <ActionButton label="Keep choices for selected loads" onPress={keepChoices}
                testID="legacy-load-keep-choices" variant="outline" />
              <Text allowFontScaling={false} style={styles.body}>{`${Object.keys(choices).length} loads have review choices. Select more loads to give them a different unit or meaning.`}</Text>
              {Object.keys(choices).length > 0 ? <ActionButton label="Clear review choices" variant="outline"
                onPress={() => { setChoices({}); setSelected([]); setUnit(''); setMeaning(null); setError(null); }} /> : null}
            </> : null}
            <ActionButton label={replacingMetadata ? 'Preview reviewed loads' : 'Preview selected loads'}
              onPress={prepare} testID="legacy-load-preview" variant="primary" />
          </>}
        </>}
      </> : null}
      {!busy && !result ? <ActionButton label="Refresh review" onPress={() => setRefresh(value => value + 1)} variant="outline" /> : null}
      {!busy && !result ? <ActionButton label="Leave unresolved" onPress={onDismiss} variant="outline" testID="legacy-load-cancel" /> : null}
    </ScrollView>;
}

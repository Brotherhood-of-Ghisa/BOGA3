import { useBodyWeightContextRevision } from '@/src/bodyweight/use-context-revision';
import { isValidBodyWeightReading, sessionWeightSourceLabel } from '@/src/bodyweight/weight-entry';
import { useEffect, useMemo, useRef, useState } from 'react';
import { Keyboard, ScrollView, Text, useWindowDimensions, View } from 'react-native';
import { ActionButton, Card, FormField, ListRow, Notice, SegmentedControl, Sheet, StatePanel, Stat } from '@/components/ui';
import { loadExercisePerformanceHistory } from '@/src/data/exercise-history';
import { readCurrentBodyWeight } from '@/src/data/bodyweight';
import type { ExternalLoadProjection, LoadContext, WeightUnit } from '@/src/exercise-calculations/effective-load';
import { loadingEstimateSources, projectLoadingEstimate, type LoadingEstimateSource } from '@/src/bodyweight/loading-estimate';
import { formatCurrentDateTime } from '@/src/session-recorder/session-model';
import { weightStyles as styles } from './styles';

type Projection = Extract<ExternalLoadProjection, { status: 'known' }>;
const sourceDescription = (source: LoadingEstimateSource) =>
  `${formatCurrentDateTime(source.completedAt)} · Added ${source.weightValue} ${source.weightUnit}${source.loadInputMode === 'per_side_load' ? '/side' : ''} × ${source.reps}`;

export function LoadingEstimateSheet({ visible, exerciseId, context, onDismiss }: {
  visible: boolean; exerciseId: string | null; context: LoadContext; onDismiss: () => void;
}) {
  const datedWeightRevision = useBodyWeightContextRevision();
  const { height } = useWindowDimensions();
  const scroll = useRef<ScrollView>(null);
  const [sources, setSources] = useState<LoadingEstimateSource[]>([]);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [choosingSource, setChoosingSource] = useState(false);
  const [reps, setReps] = useState('8');
  const [bodyWeight, setBodyWeight] = useState('');
  const [unit, setUnit] = useState<WeightUnit>('kg');
  const [weightHint, setWeightHint] = useState('');
  const [currentReading, setCurrentReading] = useState<{ weightKg: number; measuredAt: Date } | null>(null);
  const [currentReadingInvalid, setCurrentReadingInvalid] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const [result, setResult] = useState<Projection | null>(null);
  const [loadedRequestKey, setLoadedRequestKey] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const initializedExercise = useRef<string | null>(null);
  const targetWeightEdited = useRef(false);
  const source = useMemo(() => sources.find(row => row.id === sourceId) ?? null, [sources, sourceId]);
  const bodyweight = context.bodyweightCoefficient > 0;
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [visible, choosingSource]);
  // Opening, a new target, or Try again starts a fresh load, reset in the render that asks for it.
  const formKey = visible && exerciseId
    ? JSON.stringify([exerciseId, context.bodyweightCoefficient, context.loadInputMode, context.bodyWeightKg, retry])
    : null;
  const requestKey = formKey === null ? null : JSON.stringify([formKey, datedWeightRevision]);
  const [shownFormKey, setShownFormKey] = useState<string | null>(null);
  if (formKey !== shownFormKey) {
    setShownFormKey(formKey);
    if (formKey !== null) {
      setLoadError(null); setInputError(null); setResult(null); setChoosingSource(false); setUnit('kg');
    }
  }
  const [shownRequestKey, setShownRequestKey] = useState<string | null>(null);
  if (requestKey !== shownRequestKey) {
    setShownRequestKey(requestKey);
    if (requestKey !== null) { setLoadError(null); setResult(null); }
  }
  const loading = requestKey !== null && requestKey !== loadedRequestKey;
  useEffect(() => {
    if (!visible || !exerciseId) { initializedExercise.current = null; return; }
    const initialize = initializedExercise.current !== exerciseId;
    const currentRequestKey = JSON.stringify([JSON.stringify([exerciseId, context.bodyweightCoefficient, context.loadInputMode, context.bodyWeightKg, retry]), datedWeightRevision]);
    let cancelled = false;
    if (initialize) targetWeightEdited.current = false;
    void Promise.all([loadExercisePerformanceHistory({ exerciseDefinitionId: exerciseId, period: 'all' }), readCurrentBodyWeight()])
      .then(([history, current]) => {
        if (cancelled) return;
        const candidates = loadingEstimateSources(history?.sessions ?? []);
        setSources(candidates);
        if (initialize) { setSourceId(candidates[0]?.id ?? null); setReps(String(candidates[0]?.reps ?? 8)); }
        else setSourceId(previous => candidates.some(row => row.id === previous) ? previous : null);
        initializedExercise.current = exerciseId;
        const validCurrent = current !== null && isValidBodyWeightReading(current);
        setCurrentReading(validCurrent ? current : null);
        setCurrentReadingInvalid(current !== null && !validCurrent);
        setLoadedRequestKey(currentRequestKey);
        const targetHasWeight = context.bodyWeightKg != null && Number.isFinite(context.bodyWeightKg) && context.bodyWeightKg > 0;
        if (!targetWeightEdited.current) {
        setBodyWeight(targetHasWeight ? String(context.bodyWeightKg) : '');
        setWeightHint(targetHasWeight ? 'Prefilled from this session’s dated body weight. Edit for a different target.'
          : 'Enter a target body weight or choose a current reading. Saved performances stay unchanged.');
        }
      }).catch(cause => {
        if (!cancelled) {
          setLoadError(cause instanceof Error ? cause.message : 'Could not load source performances.');
          setLoadedRequestKey(currentRequestKey);
        }
      });
    return () => { cancelled = true; };
  }, [visible, exerciseId, context.bodyweightCoefficient, context.loadInputMode, context.bodyWeightKg, retry, datedWeightRevision]);
  const clearResult = () => { setResult(null); setInputError(null); };
  const calculate = () => {
    if (!source || loading || loadError) return;
    Keyboard.dismiss();
    try { setResult(projectLoadingEstimate(source, context, { reps, bodyWeightKg: bodyWeight, unit })); setInputError(null); }
    catch (cause) { setResult(null); setInputError(cause instanceof Error ? cause.message : 'Check your target values.'); }
  };
  return <Sheet visible={visible} title={choosingSource ? 'Choose source performance' : 'Loading estimate'} keyboardAvoiding
    onDismiss={onDismiss} dismissLabel="Dismiss loading estimate" testID="loading-estimate-sheet">
    <ScrollView ref={scroll} style={{ maxHeight: height * 0.8, flexGrow: 0 }} contentContainerStyle={styles.form}
      keyboardShouldPersistTaps="handled" keyboardDismissMode="on-drag" testID="loading-estimate-scroll">
      {loading ? <StatePanel kind="loading" body="Loading performed sets…" /> : loadError ? <StatePanel kind="error" body={loadError}
        action={{ label: 'Try again', onPress: () => setRetry(value => value + 1) }} /> : sources.length === 0 ?
        <StatePanel title="No usable source performance" body="A completed, performed set with a known load is needed. For bodyweight exercises, add a reading on or before that session first." testID="loading-estimate-empty" /> :
        choosingSource ? <>
          <Card>{sources.map((candidate, index) => <ListRow key={candidate.id} divider={index > 0}
            selected={candidate.id === sourceId} testID={`loading-estimate-source-${candidate.id}`}
            onPress={() => { setSourceId(candidate.id); setChoosingSource(false); clearResult(); }}>
            <Text allowFontScaling={false} style={styles.body}>{sourceDescription(candidate)}</Text>
            <Text allowFontScaling={false} style={styles.body}>{`${bodyweight ? 'Added-weight ' : ''}estimated 1RM ${candidate.estimatedOneRepMaxKg.toFixed(1)} kg${bodyweight ? ` · dated body weight ${candidate.bodyWeightKg ?? 'unknown'} kg · ${sessionWeightSourceLabel(candidate)}` : ''}`}</Text>
          </ListRow>)}</Card>
          <ActionButton label="Back to estimate" variant="outline" onPress={() => setChoosingSource(false)} />
        </> : source ? <>
          <Text allowFontScaling={false} style={styles.label}>Source performance</Text>
          <Text allowFontScaling={false} style={styles.body} testID="loading-estimate-source-description">{sourceDescription(source)}</Text>
          <Text allowFontScaling={false} style={styles.body}>{`${bodyweight ? 'Added-weight ' : ''}estimated 1RM ${source.estimatedOneRepMaxKg.toFixed(1)} kg from ${source.effectiveLoadKg.toFixed(1)} kg effective load${bodyweight ? ` and dated session weight ${source.bodyWeightKg} kg` : ''}.`}</Text>
          {bodyweight ? <Text allowFontScaling={false} style={styles.body}>{sessionWeightSourceLabel(source)}</Text> : null}
          <ActionButton label="Choose another performance" variant="outline" testID="loading-estimate-choose-source" onPress={() => setChoosingSource(true)} />
          <FormField label="Target reps" value={reps} keyboardType="number-pad" testID="loading-estimate-reps"
            onChangeText={value => { setReps(value); clearResult(); }} />
          {bodyweight ? <FormField label="Target body weight (kg)" value={bodyWeight} keyboardType="decimal-pad" hint={weightHint}
            testID="loading-estimate-bodyweight" onChangeText={value => {
              targetWeightEdited.current = true; setBodyWeight(value); setWeightHint('Using your entered target weight. Saved performances stay unchanged.'); clearResult();
            }} /> : null}
          {bodyweight && currentReadingInvalid ? <Notice message="Your current reading needs review in Settings. Enter a target weight here to continue." testID="loading-estimate-invalid-reading" /> : null}
          {bodyweight && currentReading ? <ActionButton
            label={`Use current reading · ${currentReading.weightKg} kg`}
            variant="outline" testID="loading-estimate-current-reading"
            onPress={() => { targetWeightEdited.current = true; setBodyWeight(String(currentReading.weightKg));
              setWeightHint(`Using your reading on ${formatCurrentDateTime(currentReading.measuredAt)}. Saved performances stay unchanged.`); clearResult(); }} /> : null}
          <SegmentedControl options={[{ value: 'kg', label: 'kg' }, { value: 'lb', label: 'lb' }]} value={unit}
            onChange={value => { setUnit(value as WeightUnit); clearResult(); }} testIDPrefix="loading-estimate-unit" />
          {inputError ? <Notice tone="danger" live message={inputError} testID="loading-estimate-error" /> : null}
          <ActionButton label="Calculate estimate" variant="primary" disabled={loading} onPress={calculate} testID="loading-estimate-calculate" />
          {result ? <View testID="loading-estimate-result">
            <Stat label={`Added load${context.loadInputMode === 'per_side_load' ? ' per side' : ''} · ${unit}`}
              value={result.enteredAmount.toFixed(2)} testID="loading-estimate-amount" />
            <Text allowFontScaling={false} style={styles.body}>{`Estimated ${bodyweight ? 'total resistance' : 'entered load'} ${result.predictedResistanceKg.toFixed(2)} kg for ${result.targetReps} reps.`}</Text>
            <Text allowFontScaling={false} style={styles.body}>Shown to two decimals; no plate increment has been applied. This estimate does not change the source performance or any dated session weight.</Text>
            {result.targetReps === 1 ? <Notice message="For one rep, this uses the source’s estimated 1RM capacity directly. The multi-rep estimates use the inverse Wathan formula." /> : null}
            {result.targetReps > 15 || source.reps > 15 ? <Notice message="High-rep estimate, not a measured maximum." /> : null}
          </View> : null}
        </> : <StatePanel title="Source performance changed" body="The selected performance is no longer usable. Choose another source."
          action={{ label: 'Choose source performance', onPress: () => setChoosingSource(true) }} />}
      <ActionButton label="Done" variant="outline" onPress={onDismiss} testID="loading-estimate-done" />
    </ScrollView>
  </Sheet>;
}

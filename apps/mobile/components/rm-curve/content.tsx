import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, findNodeHandle, FlatList, Platform, Text, View, type ViewInstance } from 'react-native';
import { Card, Icon, ListRow, ScreenScroll, SegmentedControl, Sheet, StatePanel } from '@/components/ui';
import type { ExerciseDateFormat } from '@/src/preferences/model';
import type { CurveMode, UncertaintyMethod } from '@/src/strength-regimes/assessment';
import type { RmCurveModel, RmCurveRange } from '@/src/rm-curve/model';
import type { RmCurveGym } from '@/src/rm-curve/repository';
import { ALL_GYMS_LABEL, gymOptionLabel, gymScopeLabel } from '@/src/utils/gym-scope-route';
import { formatShortDate } from '@/src/utils/local-time';
import { useRegimeAssessment } from '@/src/strength-regimes/use-assessment';
import { periodLabel, RmRegimes, selectedPeriod } from './regimes';
import { RmCurveDetails, setDescription } from './details';
import { curveStyles as styles } from './styles';

export type CurveScope = { exerciseId: string; range: RmCurveRange; gym: RmCurveGym; rir: number | null };
export type RmCurveContentProps = {
  read: { status: 'loading' | 'ready' | 'error'; data: RmCurveModel | null; retry: () => void };
  scope: CurveScope; onScope: (scope: CurveScope) => void;
  exercises: { id: string; name: string }[];
  catalogStatus: 'idle' | 'loading' | 'ready' | 'error'; retryCatalog: () => void;
  dateFormat: ExerciseDateFormat; historyWeeks: number;
};
type Picker = 'exercise' | 'gym' | 'range' | 'effort';
type Choice = { id: string; label: string; checked?: boolean; choose: () => void };

function excludedMessage(model: RmCurveModel) {
  const e = model.excluded;
  const invalid = e.invalid_metrics + e.equivalent_reps_overflow;
  return [e.missing_effort ? `${e.missing_effort} missing effort` : '', e.unknown_effort ? `${e.unknown_effort} unknown effort` : '',
    invalid ? `${invalid} invalid observations` : ''].filter(Boolean).join('; ');
}

const rangeLabel = (range: RmCurveRange, historyWeeks: number) => range === 'history'
  ? `History look-back (${historyWeeks} weeks)` : `${Math.min(range, historyWeeks)} weeks${range > historyWeeks ? ' (History limit)' : ''}`;

/** Reusable page body: scope is controlled, selection is local. No production route.
 * Error/loading hides retained read data; only a resolved scope can prune selection.
 * Chart activation opens inline details; Previous/Next reaches overlapping sets.
 */
export function RmCurveContent({ read, scope, onScope, exercises, catalogStatus, retryCatalog, dateFormat, historyWeeks }: RmCurveContentProps) {
  const [mode, setMode] = useState<CurveMode>('one');
  const [method, setMethod] = useState<UncertaintyMethod>('fixed');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const origin = useRef<ViewInstance | null>(null);
  const refs = useRef<Partial<Record<Picker, ViewInstance | null>>>({});
  const model = read.status === 'ready' ? read.data : null;
  const point = model?.observations.find(p => p.setId === selectedId);
  if (read.status === 'ready' && selectedId !== null && !point) setSelectedId(null);
  useEffect(() => {
    if (point) AccessibilityInfo.announceForAccessibility(`Selected set. ${setDescription(point, dateFormat)}`);
  }, [point, dateFormat]);
  const open = (next: Picker) => { origin.current = refs.current[next] ?? null; setPicker(next); };
  const close = () => setPicker(null);
  const restoreFocus = () => {
    if (Platform.OS === 'web') { origin.current?.focus(); return; }
    const handle = origin.current ? findNodeHandle(origin.current) : null;
    if (typeof handle === 'number') AccessibilityInfo.setAccessibilityFocus(handle);
  };
  const apply = (patch: Partial<CurveScope>) => {
    if (patch.exerciseId !== undefined && patch.exerciseId !== scope.exerciseId) setSelectedId(null);
    onScope({ ...scope, ...patch }); close();
  };
  const filter = (kind: Picker, label: string, full = false) => <Card style={full ? styles.full : styles.filter} key={kind}>
    <ListRow ref={node => { refs.current[kind] = node; }} density="list" divider={false} onPress={() => open(kind)}
      accessibilityLabel={`${kind}: ${label}`} trailing={<Icon name="chevron-down" />}>
      <Text allowFontScaling={false} style={styles.filterLabel}>{label}</Text>
    </ListRow>
  </Card>;
  const choices: Record<Picker, Choice[]> = {
    exercise: exercises.map(e => ({ id: e.id, label: e.name, checked: e.id === scope.exerciseId,
      choose: () => apply({ exerciseId: e.id, gym: 'latest' }) })),
    gym: [{ id: 'all-gyms', label: ALL_GYMS_LABEL, checked: model !== null && model.gymId === undefined, choose: () => apply({ gym: {} }) },
      ...(model?.gyms ?? []).map(g => ({ id: g.gymId ?? 'no-gym', label: gymOptionLabel(g), checked: g.gymId === model?.gymId,
        choose: () => apply({ gym: { gymId: g.gymId } }) }))],
    range: ([4, 12, 24, 'history'] as const).map(r => ({ id: String(r),
      label: r === 'history' ? rangeLabel(r, historyWeeks) : `${r} weeks${r > historyWeeks ? ' (limited to History)' : ''}`,
      checked: r === scope.range, choose: () => apply({ range: r }) })),
    effort: [null, ...(model?.effortOptions ?? [])].map(r => ({ id: String(r), label: r === null ? 'All known RIR' : `RIR ${r}`,
      checked: r === scope.rir, choose: () => apply({ rir: r }) })),
  };
  const labelModel = read.data;
  // The default names the gym it resolved to once a read lands.
  const gymLabel = scope.gym === 'latest'
    ? labelModel ? gymScopeLabel(labelModel.gymId, labelModel.gyms) : 'Latest trained gym'
    : gymScopeLabel(scope.gym.gymId, labelModel?.gyms ?? []);
  return <>
    <ScreenScroll testID="rm-curve-content">
      {filter('exercise', exercises.find(e => e.id === scope.exerciseId)?.name ?? model?.definition.name ?? 'Selected exercise', true)}
      <View style={styles.filters}>{filter('gym', gymLabel)}{filter('range', rangeLabel(scope.range, historyWeeks))}
        {filter('effort', scope.rir === null ? 'All known RIR' : `RIR ${scope.rir}`, true)}</View>
      <SegmentedControl testIDPrefix="rm-mode" accessibilityLabel="Curves" value={mode} onChange={setMode}
        options={[{ value: 'one', label: 'One curve' }, { value: 'two', label: 'Two curves' }]} />
      <SegmentedControl testIDPrefix="rm-method" accessibilityLabel="Model" value={method} onChange={setMethod}
        options={[{ value: 'fixed', label: 'Parsimonious' }, { value: 'joint', label: 'Rich' }]} />
      {read.status === 'loading' ? <StatePanel kind="loading" title="Loading sets" fill={false} />
        : read.status === 'error' ? <StatePanel kind="error" title="Couldn’t load sets" body="Your filters are retained. Retry to load the chart and details."
          action={{ label: 'Retry', onPress: read.retry }} fill={false} />
          : model ? <CurveResult mode={mode} method={method} model={model} pointId={point?.setId ?? null} dateFormat={dateFormat} onSelect={setSelectedId}
            onPick={ids => { if (ids.length) setSelectedId(ids[0]); }} onFilters={() => open('effort')} />
            : <StatePanel title="This exercise isn’t available" body="Choose another exercise or return to History." fill={false}
              action={{ label: 'Choose exercise', onPress: () => open('exercise') }} />}
    </ScreenScroll>
    <CurveChoices picker={picker} choices={picker ? choices[picker] : []} catalogStatus={catalogStatus}
      retryCatalog={retryCatalog} close={close} restoreFocus={restoreFocus} />
  </>;
}

function CurveChoices({ picker, choices, catalogStatus, retryCatalog, close, restoreFocus }: {
  picker: Picker | null; choices: Choice[]; catalogStatus: RmCurveContentProps['catalogStatus'];
  retryCatalog: () => void; close: () => void; restoreFocus: () => void;
}) {
  return <Sheet visible={picker !== null} title={picker ? picker[0].toUpperCase() + picker.slice(1) : ''}
    dismissLabel="Dismiss choices" onDismiss={close} onDismissed={restoreFocus} testID="rm-curve-sheet">
      {picker === 'exercise' && catalogStatus !== 'ready' ? <StatePanel fill={false}
        kind={catalogStatus === 'error' ? 'error' : 'loading'} title={catalogStatus === 'error' ? 'Couldn’t load exercises' : 'Loading exercises'}
        action={catalogStatus === 'error' ? { label: 'Retry', onPress: retryCatalog } : undefined} />
        : <FlatList data={choices} keyExtractor={choice => choice.id} renderItem={({ item: choice }) => <ListRow checked={choice.checked}
          onPress={choice.choose} accessibilityLabel={choice.label}
          leading={choice.checked !== undefined ? <Icon name={choice.checked ? 'radio-on' : 'radio-off'} /> : undefined}>
          <Text allowFontScaling={false} style={styles.body}>{choice.label}</Text>
        </ListRow>} />}
    </Sheet>;
}

function CurveResult({ mode, method, model, pointId, dateFormat, onSelect, onPick, onFilters }: {
  mode: CurveMode; method: UncertaintyMethod; model: RmCurveModel; pointId: string | null; dateFormat: ExerciseDateFormat; onSelect: (id: string) => void;
  onPick: (ids: string[]) => void; onFilters: () => void;
}) {
  const result = useRegimeAssessment(model, mode, method);
  const points = model.observations, point = points.find(p => p.setId === pointId);
  if (!points.length) {
    const noEffort = model.excluded.missing_effort + model.excluded.unknown_effort > 0;
    return <StatePanel fill={false} title={model.rir !== null ? 'No sets match these filters' : noEffort ? 'No sets with known RIR' : excludedMessage(model) ? 'No qualifying observations' : 'No completed sets'}
      body={excludedMessage(model) || 'Choose another effort, gym or time range.'} action={{ label: 'Change filters', onPress: onFilters }} />;
  }
  const period = point ? selectedPeriod(point.completedAt, result?.data) : undefined;
  const factor = model.definition.loadInputMode === 'per_side_load' ? 2 : 1;
  const sessionsCount = new Set(points.map(p => p.sessionId)).size;
  return <>
    <Text allowFontScaling={false} style={styles.figure}>{points.length} {points.length === 1 ? 'set' : 'sets'} · {sessionsCount} {sessionsCount === 1 ? 'session' : 'sessions'}</Text>
    <Card style={styles.card}>
      <Text allowFontScaling={false} style={styles.micro}>LOAD{points.some(p => p.loadKg !== p.weightKg) ? ' (WITH DATED BODYWEIGHT)' : ''}{factor === 2 ? ' · PER SIDE' : ''}</Text>
      <RmRegimes result={result} dateFormat={dateFormat} model={model} selectedId={pointId} onPick={onPick} />
      <View style={styles.dates}><Text allowFontScaling={false} style={styles.figure}>{formatShortDate(points.at(-1)!.completedAt, dateFormat)}</Text>
        <Text allowFontScaling={false} style={styles.figure}>{formatShortDate(points[0].completedAt, dateFormat)}</Text></View>

    </Card>
    {point ? <RmCurveDetails period={period} periodLabel={period ? periodLabel(period, result?.data?.boundary ?? null, dateFormat) : undefined} model={model} point={point} dateFormat={dateFormat} onSelect={onSelect} />
      : null}
    {excludedMessage(model) ? <Text allowFontScaling={false} style={styles.body}>{excludedMessage(model)}</Text> : null}
  </>;
}

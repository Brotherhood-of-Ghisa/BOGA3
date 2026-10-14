import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, findNodeHandle, FlatList, Platform, Text, View, type ViewInstance } from 'react-native';
import { Card, Icon, ListRow, ScreenScroll, Sheet, StatePanel } from '@/components/ui';
import { formatOneRepMax, formatWeight } from '@/src/exercise-calculations/format';
import type { ExerciseDateFormat } from '@/src/preferences/model';
import type { RmCurveModel, RmCurveRange } from '@/src/rm-curve/model';
import { formatShortDate } from '@/src/utils/local-time';
import { RmCurveChart } from './chart';
import { RmCurveDetails, setDescription } from './details';
import { curveStyles as styles } from './styles';

export type CurveScope = { exerciseId: string; range: RmCurveRange; gymId?: string | null; rir: number | null };
export type RmCurveContentProps = {
  read: { status: 'loading' | 'ready' | 'error'; data: RmCurveModel | null; retry: () => void };
  scope: CurveScope; onScope: (scope: CurveScope) => void;
  exercises: { id: string; name: string }[];
  catalogStatus: 'idle' | 'loading' | 'ready' | 'error'; retryCatalog: () => void;
  dateFormat: ExerciseDateFormat; historyWeeks: number;
};
type Picker = 'exercise' | 'gym' | 'range' | 'effort' | 'sets';
type Choice = { id: string; label: string; detail?: string; title?: string; checked?: boolean; choose: () => void };

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
 * All points are available as dated rows; the plot never moves overlapping data.
 */
export function RmCurveContent({ read, scope, onScope, exercises, catalogStatus, retryCatalog, dateFormat, historyWeeks }: RmCurveContentProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [picker, setPicker] = useState<Picker | null>(null);
  const [candidates, setCandidates] = useState<string[] | null>(null);
  const origin = useRef<ViewInstance | null>(null);
  const refs = useRef<Partial<Record<Picker | 'plot', ViewInstance | null>>>({});
  const model = read.status === 'ready' ? read.data : null;
  const point = model?.observations.find(p => p.setId === selectedId);
  if (read.status === 'ready' && selectedId !== null && !point) setSelectedId(null);
  useEffect(() => {
    if (point) AccessibilityInfo.announceForAccessibility(`Selected set. ${setDescription(point, dateFormat)}`);
  }, [point, dateFormat]);
  const open = (next: Picker) => { origin.current = refs.current[next] ?? null; setCandidates(null); setPicker(next); };
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
  const candidateIds = candidates ? new Set(candidates) : null;
  const choices: Record<Picker, Choice[]> = {
    exercise: exercises.map(e => ({ id: e.id, label: e.name, checked: e.id === scope.exerciseId,
      choose: () => apply({ exerciseId: e.id, gymId: undefined }) })),
    gym: (model?.gyms ?? []).map(g => ({ id: g.gymId ?? 'unspecified', label: g.name ?? 'Unspecified gym', checked: g.gymId === model?.gymId,
      choose: () => apply({ gymId: g.gymId }) })),
    range: ([4, 12, 24, 'history'] as const).map(r => ({ id: String(r),
      label: r === 'history' ? rangeLabel(r, historyWeeks) : `${r} weeks${r > historyWeeks ? ' (limited to History)' : ''}`,
      checked: r === scope.range, choose: () => apply({ range: r }) })),
    effort: [null, ...(model?.effortOptions ?? [])].map(r => ({ id: String(r), label: r === null ? 'All known RIR' : `RIR ${r}`,
      checked: r === scope.rir, choose: () => apply({ rir: r }) })),
    sets: (picker === 'sets' ? model?.observations ?? [] : []).filter(p => !candidateIds || candidateIds.has(p.setId)).map(p => ({ id: p.setId,
      label: setDescription(p, dateFormat), title: `${formatShortDate(p.completedAt, dateFormat)} · block ${p.blockOrder + 1}, set ${p.setOrder + 1}`,
      detail: `${p.reps} reps · RIR ${p.rir} · Load ${formatWeight(p.loadKg)} kg${p.loadContext.loadInputMode === 'per_side_load' ? ' per side' : ''}`,
      choose: () => { setSelectedId(p.setId); close(); } })),
  };
  const labelModel = read.data;
  const gymLabel = scope.gymId === undefined ? labelModel ? labelModel.gyms.find(g => g.gymId === labelModel.gymId)?.name ?? 'Unspecified gym' : 'Latest trained gym'
    : scope.gymId === null ? 'Unspecified gym' : labelModel?.gyms.find(g => g.gymId === scope.gymId)?.name ?? 'Selected gym';
  return <>
    <ScreenScroll testID="rm-curve-content">
      {filter('exercise', exercises.find(e => e.id === scope.exerciseId)?.name ?? model?.definition.name ?? 'Selected exercise', true)}
      <View style={styles.filters}>{filter('gym', gymLabel)}{filter('range', rangeLabel(scope.range, historyWeeks))}
        {filter('effort', scope.rir === null ? 'All known RIR' : `RIR ${scope.rir}`, true)}</View>
      {read.status === 'loading' ? <StatePanel kind="loading" title="Loading sets" fill={false} />
        : read.status === 'error' ? <StatePanel kind="error" title="Couldn’t load sets" body="Your filters are retained. Retry to load the chart and details."
          action={{ label: 'Retry', onPress: read.retry }} fill={false} />
          : model ? <CurveResult model={model} pointId={point?.setId ?? null} dateFormat={dateFormat} onSelect={setSelectedId}
            onPick={ids => { if (ids.length === 1) setSelectedId(ids[0]); else if (ids.length > 1) { origin.current = refs.current.plot ?? null; setCandidates(ids); setPicker('sets'); } }}
            plotRef={node => { refs.current.plot = node; }}
            onFilters={() => open('effort')} onSets={() => open('sets')} setListRef={node => { refs.current.sets = node; }} />
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
  return <Sheet visible={picker !== null} title={picker === 'sets' ? 'Observed sets · newest first' : picker ? picker[0].toUpperCase() + picker.slice(1) : ''}
    dismissLabel="Dismiss choices" onDismiss={close} onDismissed={restoreFocus} testID="rm-curve-sheet">
      {picker === 'exercise' && catalogStatus !== 'ready' ? <StatePanel fill={false}
        kind={catalogStatus === 'error' ? 'error' : 'loading'} title={catalogStatus === 'error' ? 'Couldn’t load exercises' : 'Loading exercises'}
        action={catalogStatus === 'error' ? { label: 'Retry', onPress: retryCatalog } : undefined} />
        : <FlatList data={choices} keyExtractor={choice => choice.id} renderItem={({ item: choice }) => <ListRow checked={choice.checked}
          onPress={choice.choose} accessibilityLabel={choice.label}
          leading={choice.checked !== undefined ? <Icon name={choice.checked ? 'radio-on' : 'radio-off'} /> : undefined}>
          <Text allowFontScaling={false} style={picker === 'sets' ? styles.figure : styles.body}>{choice.title ?? choice.label}</Text>
          {choice.detail ? <Text allowFontScaling={false} style={styles.figure}>{choice.detail}</Text> : null}
        </ListRow>} />}
    </Sheet>;
}

function CurveResult({ model, pointId, dateFormat, onSelect, onPick, onFilters, onSets, setListRef, plotRef }: {
  model: RmCurveModel; pointId: string | null; dateFormat: ExerciseDateFormat; onSelect: (id: string) => void;
  onPick: (ids: string[]) => void; onFilters: () => void; onSets: () => void; setListRef: (node: ViewInstance | null) => void;
  plotRef: (node: ViewInstance | null) => void;
}) {
  const points = model.observations, point = points.find(p => p.setId === pointId);
  if (!points.length) {
    const noEffort = model.excluded.missing_effort + model.excluded.unknown_effort > 0;
    return <StatePanel fill={false} title={model.rir !== null ? 'No sets match these filters' : noEffort ? 'No sets with known RIR' : excludedMessage(model) ? 'No qualifying observations' : 'No completed sets'}
      body={excludedMessage(model) || 'Choose another effort, gym or time range.'} action={{ label: 'Change filters', onPress: onFilters }} />;
  }
  const factor = model.definition.loadInputMode === 'per_side_load' ? 2 : 1;
  const sessionsCount = new Set(points.map(p => p.sessionId)).size;
  return <>
    <Text allowFontScaling={false} style={styles.figure}>{points.length} {points.length === 1 ? 'set' : 'sets'} · {sessionsCount} {sessionsCount === 1 ? 'session' : 'sessions'}</Text>
    <Card style={styles.card}>
      <Text allowFontScaling={false} style={styles.micro}>LOAD{points.some(p => p.loadKg !== p.weightKg) ? ' (WITH DATED BODYWEIGHT)' : ''} · KG{factor === 2 ? ' PER SIDE' : ''}</Text>
      <RmCurveChart model={model} selectedId={pointId} onPick={onPick} plotRef={plotRef} />
      <View style={styles.dates}><Text allowFontScaling={false} style={styles.figure}>{formatShortDate(points.at(-1)!.completedAt, dateFormat)}</Text>
        <Text allowFontScaling={false} style={styles.figure}>{formatShortDate(points[0].completedAt, dateFormat)}</Text></View>
      <Text allowFontScaling={false} style={styles.body}>{model.reference.totalRm === null ? `Reference unavailable · ${Math.min(6, model.reference.qualifyingSessions)} of 6 prior sessions`
        : `Reference ${formatOneRepMax(model.reference.totalRm / factor)} kg${factor === 2 ? ' per side' : ''} · 6 prior sessions`}</Text>
    </Card>
    {point ? <RmCurveDetails model={model} point={point} dateFormat={dateFormat} onSelect={onSelect} />
      : <Text allowFontScaling={false} style={styles.body}>Tap a point or open View sets to inspect an observation.</Text>}
    <Card><ListRow ref={setListRef} divider={false} label="View sets" onPress={onSets} trailing={<Icon name="chevron-down" />} /></Card>
    {excludedMessage(model) ? <Text allowFontScaling={false} style={styles.body}>{excludedMessage(model)}</Text> : null}
  </>;
}

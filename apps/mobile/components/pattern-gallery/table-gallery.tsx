import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Notice, ScreenScroll, SegmentedControl, StatePanel, SwitchRow, ToggleChip, uiSpace } from '@/components/ui';
import { ProgressTables, nextMuscleSortMode, type MuscleSortMode, type ProgressTableMetric } from '@/components/stats/progress-tables';
import { ProgressMuscleView } from '@/components/stats/progress-muscle-view';
import { CompactRowComparison } from './compact-row-fixtures';
import { tableGalleryMuscles } from './table-fixtures';

const SAMPLES = [{ value: 'muscles', label: 'Muscles' }, { value: 'single', label: 'One muscle' }, { value: 'rows', label: 'Rows' }] as const;
const STATES = [{ value: 'ready', label: 'Ready' }, { value: 'empty', label: 'Empty' }, { value: 'contributors-empty', label: 'No contributors' },
  { value: 'values', label: 'Zero / missing' }, { value: 'loading', label: 'Loading' }, { value: 'error', label: 'Error' }] as const;

/** Production Progress presenters; fixture controls keep sorting/disclosure state with the caller. */
export function TableGallery({ initialSample, initialState, initialLong = false, review = false }: {
  initialSample?: string; initialState?: string; initialLong?: boolean; review?: boolean;
}) {
  const [sample, setSample] = useState(() => SAMPLES.find(item => item.value === initialSample)?.value ?? 'muscles');
  const [state, setState] = useState(() => STATES.find(item => item.value === initialState)?.value ?? 'ready');
  const [long, setLong] = useState(initialLong);
  const [selectedId, setSelectedId] = useState<string | null>('back_lats');
  const [sortMode, setSortMode] = useState<MuscleSortMode>('now-desc');
  const [metric, setMetric] = useState<ProgressTableMetric>(initialLong || initialState === 'values' ? 'totalVolume' : 'workingSetCount');
  const [action, setAction] = useState('');
  const muscles = state === 'empty' ? [] : tableGalleryMuscles(long, state);
  const props = { muscles, metric, selectedId, sortMode,
    onSort: (header: Parameters<typeof nextMuscleSortMode>[1]) => setSortMode(mode => nextMuscleSortMode(mode, header)),
    onSelect: (id: string) => setSelectedId(current => current === id ? null : id),
    onMuscleHistory: (row: { displayName: string }) => setAction(`Muscle history · ${row.displayName}`),
    onExerciseHistory: (row: { displayName: string }) => setAction(`Exercise history · ${row.displayName}`) };
  return <ScreenScroll testID={`ui-gallery-table-${sample}-${state}-${long ? 'long' : 'normal'}`}>
    {!review ? <>
      <SegmentedControl options={SAMPLES} value={sample} onChange={setSample} accessibilityLabel="Table example" testIDPrefix="table-gallery-sample" />
      <View style={styles.controls}><ToggleChip options={STATES} value={state} onChange={setState} accessibilityLabel="Example state" testID="table-gallery-state" />
        <ToggleChip options={[{ value: 'workingSetCount', label: 'Sets' }, { value: 'totalVolume', label: 'Volume' }]} value={metric} onChange={setMetric}
          accessibilityLabel="Table metric" testID="table-gallery-metric" /></View>
      <SwitchRow label="Long content" value={long} onValueChange={setLong} testID="table-gallery-long" />
    </> : null}
    {state === 'error' ? <StatePanel fill={false} kind="error" title="Could not load progress" testID="table-gallery-error"
      action={{ label: 'Retry', testID: 'table-gallery-retry', onPress: () => { setState('ready'); setAction('Retry'); } }} />
    : state === 'loading' ? <StatePanel fill={false} kind="loading" body="Loading progress…" testID="table-gallery-loading" />
    : sample === 'rows' ? <CompactRowComparison onAction={setAction} />
    : sample === 'single' ? <ProgressMuscleView {...props} muscleLayout="3d" /> : <ProgressTables {...props} />}
    {action ? <Notice live message={action} testID="table-gallery-action" /> : null}
  </ScreenScroll>;
}
const styles = StyleSheet.create({ controls: { flexDirection: 'row', gap: uiSpace.sm } });

import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SegmentedControl, uiSpace } from '@/components/ui';
import { useUiText } from '@/components/ui/text-roles';
import { hasComparisonMetric, resolveComparisonLayout } from './comparison-columns';
import { StatsTable, statsTableStyles } from './stats-table';
import { MuscleBodyCard } from './muscle-body-card';
import type { MuscleSetTargets } from './muscle-body-projection';
import { HISTORY_VIEW_OPTIONS } from './history-view';
import { ProgressTables, ProgressContributionRows, type ProgressTablesProps } from './progress-tables';

import type { MuscleReportAssignment } from '@/src/data/muscle-analytics';
import type { ProgressMuscleLayout } from '@/src/preferences/model';
type Props = ProgressTablesProps & { muscleLayout: ProgressMuscleLayout; report?: MuscleReportAssignment; setTargets?: MuscleSetTargets };

// Settings chooses the layout; both share contribution rows and selection.
export function ProgressMuscleView(props: Props) {
  const { muscles, metric, selectedId, muscleLayout, onSelect, onMuscleHistory, onExerciseHistory, report } = props;
  const text = useUiText();
  const { width } = useWindowDimensions();
  if (muscleLayout === 'list') return <ProgressTables {...props} />;
  const selected = muscles.find(row => row.muscleGroupId === selectedId);
  const exercises = selected?.exercises.filter(row => hasComparisonMetric(row, metric)) ?? [];
  const layout = resolveComparisonLayout(width, exercises, metric, false, { compact: true });
  return <View style={styles.body}>
    <MuscleBodyCard muscles={muscles} metric={metric} selectedId={selectedId} onSelect={onSelect} report={report} setTargets={props.setTargets} />
    {selected ? <StatsTable testID="stats-contributions">
      <View style={statsTableStyles.sectionHeader}>
        <Text allowFontScaling={false} accessibilityRole="header" style={[text.title, styles.heading]}>{selected.displayName}</Text>
        <SegmentedControl accessibilityLabel={`Open ${selected.displayName} history`} density="compact" layout="inline"
          hitSlop={uiSpace.md} options={HISTORY_VIEW_OPTIONS.map(option => ({ ...option,
            accessibilityLabel: `Open ${selected.displayName} ${option.value === 'daily' ? 'Daily Heatmap' : option.value === 'weekly' ? 'Weekly Heatmap' : 'Timeline'}` }))}
          testIDPrefix="stats-contributions-view" onNavigate={(view, target) => onMuscleHistory(selected, target, view)} />
      </View>
      <ProgressContributionRows axis={false} splitByEffort muscle={selected} metric={metric} layout={layout} onHistory={onExerciseHistory} />
    </StatsTable> : null}
  </View>;
}

const styles = StyleSheet.create({
  body: { gap: uiSpace.lg },
  heading: { flex: 1 },
});

import { useState } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SegmentedControl, uiSpace } from '@/components/ui';
import { useUiText } from '@/components/ui/text-roles';
import { hasComparisonMetric, resolveComparisonLayout } from './comparison-columns';
import { StatsTable, statsTableStyles } from './stats-table';
import { MuscleBodyCard } from './muscle-body-card';
import type { MuscleSetTargets } from './muscle-body-projection';
import type { MuscleView } from './muscle-view-sheet';
import { HISTORY_VIEW_OPTIONS } from './history-view';
import { ProgressTables, ProgressContributionRows, type ProgressTablesProps } from './progress-tables';

import type { MuscleReportAssignment } from '@/src/data/muscle-analytics';
import type { ProgressMuscleLayout } from '@/src/preferences/model';
import { TissueReloadCard } from '@/components/injuries/tissue-reload-card';
import { useTissueReloadMetrics } from '@/src/injuries/use-tissue-reload';
import type { InjuryView } from '@/src/data/injuries';
import type { TissueReloadMetrics } from '@/src/injuries/tissue-reload';

type Props = ProgressTablesProps & {
  muscleLayout: ProgressMuscleLayout;
  muscleView?: MuscleView;
  report?: MuscleReportAssignment;
  setTargets?: MuscleSetTargets;
  activeInjuries?: readonly InjuryView[];
  reloadMetrics?: readonly TissueReloadMetrics[];
};

// Both layouts share contribution rows and selection.
// In 3D, one measured container and all displayed figures size both surfaces.
export function ProgressMuscleView(props: Props) {
  const {
    muscles,
    metric,
    selectedId,
    muscleLayout,
    muscleView,
    onSelect,
    onMuscleHistory,
    onExerciseHistory,
    report,
    activeInjuries: propInjuries,
    reloadMetrics: propMetrics,
  } = props;
  const text = useUiText();
  const { width } = useWindowDimensions();
  const [containerWidth, setContainerWidth] = useState(0);
  const activeInjuries = propInjuries ?? [];
  const reloadMetrics = useTissueReloadMetrics(activeInjuries, propMetrics);

  if (muscleLayout === 'list') return <ProgressTables {...props} />;
  const selected = muscles.find(row => row.muscleGroupId === selectedId);
  const exercises = selected?.exercises.filter(row => hasComparisonMetric(row, metric)) ?? [];
  const layout = resolveComparisonLayout(containerWidth || width - uiSpace.lg * 2,
    selected ? [selected, ...exercises] : [], metric, false, { compact: true, outerInset: 0 });
  return (
    <View style={styles.body} testID="stats-muscle-3d"
      onLayout={event => setContainerWidth(event.nativeEvent.layout.width)}>
      <MuscleBodyCard
        comparisonLayout={layout}
        activeInjuries={activeInjuries}
        metric={metric}
        muscles={muscles}
        onSelect={onSelect}
        overlay={muscleView === 'list' ? undefined : muscleView}
        report={report}
        selectedId={selectedId}
        setTargets={props.setTargets}
      />
      {reloadMetrics.length > 0 ? (
        <TissueReloadCard
          metrics={reloadMetrics}
          onSelectMuscle={onSelect}
          selectedMuscleId={selectedId}
        />
      ) : null}
      {selected ? (
        <StatsTable testID="stats-contributions">
          <View style={statsTableStyles.sectionHeader}>
            <Text accessibilityRole="header" allowFontScaling={false} style={[text.title, styles.heading]}>
              Exercises
            </Text>
            <SegmentedControl
              accessibilityLabel={`Open ${selected.displayName} history`}
              density="compact"
              hitSlop={uiSpace.md}
              layout="inline"
              onNavigate={(view, target) => onMuscleHistory(selected, target, view)}
              options={HISTORY_VIEW_OPTIONS.map(option => ({
                ...option,
                accessibilityLabel: `Open ${selected.displayName} ${
                  option.value === 'daily' ? 'Daily Heatmap' : option.value === 'weekly' ? 'Weekly Heatmap' : 'Timeline'
                }`,
              }))}
              testIDPrefix="stats-contributions-view"
            />
          </View>
          <ProgressContributionRows
            axis={false}
            layout={layout}
            metric={metric}
            muscle={selected}
            onHistory={onExerciseHistory}
            splitByEffort
          />
        </StatsTable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { gap: uiSpace.lg },
  heading: { flex: 1 },
});

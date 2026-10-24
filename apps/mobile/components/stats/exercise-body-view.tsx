import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import type { ProgressMuscleComparison } from '@/src/data';
import type { MuscleReportAssignment } from '@/src/data/muscle-analytics';
import type { ProgressMetric } from '@/src/preferences/model';
import type { ExerciseBodyMuscleDetail, ExerciseContributionEntry } from './exercise-body-data';
import { MuscleBodyCard } from './muscle-body-card';

/** 3D anatomical exercise explorer: shades muscles from filtered exercises and scopes the exercise table on muscle tap. */
export function ExerciseBodyView({
  muscles,
  metric,
  selectedMuscleId,
  selectedMuscle,
  onSelectMuscle,
  renderAll,
  renderDetail,
  report,
}: {
  muscles: readonly ProgressMuscleComparison[];
  metric: ProgressMetric;
  selectedMuscleId: string | null;
  selectedMuscle: ExerciseBodyMuscleDetail | null;
  onSelectMuscle: (muscleGroupId: string) => void;
  renderAll: () => ReactNode;
  renderDetail: (entries: ExerciseContributionEntry[], secondary?: readonly ExerciseContributionEntry[]) => ReactNode;
  report?: MuscleReportAssignment;
}) {
  return <View style={styles.body}>
    <MuscleBodyCard muscles={muscles} metric={metric} selectedId={selectedMuscleId} onSelect={onSelectMuscle} report={report} />
    {selectedMuscle ? <View testID="stats-exercise-body-detail" style={styles.detail}>
      <Text allowFontScaling={false} accessibilityRole="header" style={styles.heading}>{selectedMuscle.displayName}</Text>
      {renderDetail(selectedMuscle.exercises, selectedMuscle.secondary)}
    </View> : renderAll()}
  </View>;
}

const styles = StyleSheet.create({
  body: { gap: uiSpace.lg },
  detail: { gap: uiSpace.sm },
  heading: { fontFamily: uiFonts.display.family, fontWeight: '700', fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base, color: uiRoles.ink },
});

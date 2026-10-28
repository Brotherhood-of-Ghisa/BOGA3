import { useDateFormat } from '@/src/preferences/hooks';
import { formatLocalDateTime } from '@/src/utils/local-time';
import type { ExerciseDateFormat } from '@/src/preferences/model';
import { StyleSheet, Text, View } from 'react-native';

import { Card, FigureText, IconButton, ListRow, uiSpace, uiText, uiTextTone } from '@/components/ui';
import type { PlanDetailView } from '@/src/session-planner';

export type ProgrammePlanListProps = {
  plans: PlanDetailView[];
  onOpenPlan: (planId: string) => void;
  onReorderPlans?: (orderedPlanIds: string[]) => void;
};

const formatSchedule = (date: Date | null, dateFormat: ExerciseDateFormat): string => {
  if (date === null) return 'Unscheduled';
  return formatLocalDateTime(date.getTime(), dateFormat);
};

const planProgressWord = (progress: PlanDetailView['progress']): string => {
  switch (progress) {
    case 'in_progress':
      return 'In progress';
    case 'completed':
      return 'Completed';
    case 'planned':
    default:
      return 'Planned';
  }
};

export function ProgrammePlanList({
  plans,
  onOpenPlan,
  onReorderPlans,
}: ProgrammePlanListProps) {
  const dateFormat = useDateFormat();
  const movePlan = (index: number, step: -1 | 1) => {
    if (!onReorderPlans) return;
    const targetIndex = index + step;
    if (targetIndex < 0 || targetIndex >= plans.length) return;
    const reordered = [...plans];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    onReorderPlans(reordered.map((p) => p.id));
  };

  return (
    <View style={styles.container} testID="programme-plan-list">
      <Text allowFontScaling={false} accessibilityRole="header" style={[uiText.label, uiTextTone.faint]}>
        Sessions ({plans.length})
      </Text>

      <Card>
        {plans.map((plan, index) => {
          const totalBlocks =
            plan.blockCounts.pending +
            plan.blockCounts.attached +
            plan.blockCounts.completed +
            plan.blockCounts.skipped;

          return (
            <ListRow
              accessibilityLabel={`${plan.title}, ${formatSchedule(plan.scheduledFor, dateFormat)}, ${planProgressWord(plan.progress)}`}
              density="list"
              divider={index > 0}
              key={plan.id}
              onPress={() => onOpenPlan(plan.id)}
              testID={`programme-plan-row-${plan.id}`}
              trailing={
                onReorderPlans ? (
                  <View style={styles.reorderActions}>
                    <IconButton
                      accessibilityLabel={`Move session ${plan.title} earlier`}
                      disabled={index === 0}
                      name="arrow-up"
                      onPress={() => movePlan(index, -1)}
                      size="sm"
                      testID={`programme-plan-row-${plan.id}-up`}
                    />
                    <IconButton
                      accessibilityLabel={`Move session ${plan.title} later`}
                      disabled={index === plans.length - 1}
                      name="arrow-down"
                      onPress={() => movePlan(index, 1)}
                      size="sm"
                      testID={`programme-plan-row-${plan.id}-down`}
                    />
                  </View>
                ) : undefined
              }>
              <View style={styles.rowText}>
                <View style={styles.rowTitleLine}>
                  <Text allowFontScaling={false} numberOfLines={1} style={[uiText.bodyStrong, styles.title]}>
                    {plan.title}
                  </Text>
                  <Text allowFontScaling={false} style={uiText.label}>
                    {planProgressWord(plan.progress)}
                  </Text>
                </View>
                <Text allowFontScaling={false} numberOfLines={1} style={uiText.meta}>
                  <FigureText>{`${formatSchedule(plan.scheduledFor, dateFormat)} · ${totalBlocks} ${totalBlocks === 1 ? 'block' : 'blocks'}`}</FigureText>
                </Text>
              </View>
            </ListRow>
          );
        })}
      </Card>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    gap: uiSpace.sm,
  },
  rowText: {
    flex: 1,
    paddingVertical: uiSpace.xs,
    gap: uiSpace.xs,
  },
  rowTitleLine: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  title: {
    flex: 1,
  },
  reorderActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
});

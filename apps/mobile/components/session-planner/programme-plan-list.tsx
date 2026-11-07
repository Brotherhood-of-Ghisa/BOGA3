import { useDateFormat } from '@/src/preferences/hooks';
import { StyleSheet, Text, View } from 'react-native';

import { Card, FigureText, IconButton, ListRow, Tag, uiSpace, useUiText, useUiTextTone } from '@/components/ui';
import type { PlanDetailView } from '@/src/session-planner';
import { blockCountsLabel, planDateLabel, planOutcomeLabel } from './progress-labels';

export type ProgrammePlanListProps = {
  plans: PlanDetailView[];
  onOpenPlan: (planId: string) => void;
  onReorderPlans?: (orderedPlanIds: string[]) => void;
};

export function ProgrammePlanList({
  plans,
  onOpenPlan,
  onReorderPlans,
}: ProgrammePlanListProps) {
  const text = useUiText();
  const tone = useUiTextTone();
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
      <Text allowFontScaling={false} accessibilityRole="header" style={[text.label, tone.faint]}>
        Sessions ({plans.length})
      </Text>

      <Card>
        {plans.map((plan, index) => (
          <ListRow
            accessibilityLabel={[plan.title, planDateLabel(plan, dateFormat), planOutcomeLabel(plan), blockCountsLabel(plan.blockCounts).replace(/ · /g, ', ')].filter(Boolean).join(', ')}
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
                <Text allowFontScaling={false} numberOfLines={1} style={[text.bodyStrong, styles.title]}>
                  {plan.title}
                </Text>
                {plan.progress === 'completed' ? <Tag label={planOutcomeLabel(plan)} /> : (
                  <Text allowFontScaling={false} style={text.label}>
                    {planOutcomeLabel(plan)}
                  </Text>
                )}
              </View>
              <Text allowFontScaling={false} style={text.meta}>
                <FigureText>{[planDateLabel(plan, dateFormat), blockCountsLabel(plan.blockCounts)].filter(Boolean).join(' · ')}</FigureText>
              </Text>
            </View>
          </ListRow>
        ))}
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
    minWidth: 0,
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

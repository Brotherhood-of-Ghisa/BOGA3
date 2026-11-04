import { StyleSheet, Text, View } from 'react-native';

import { ActionButton, Card, FigureText, Tag, uiSpace, uiText } from '@/components/ui';
import type { ProgrammeDetailView } from '@/src/session-planner';
import { planOutcomeLabel, progressLabel } from './progress-labels';

export type ProgrammeDetailHeaderProps = {
  detail: ProgrammeDetailView;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

export function ProgrammeDetailHeader({
  detail,
  onEdit,
  onDuplicate,
  onDelete,
}: ProgrammeDetailHeaderProps) {
  const completed = detail.plans.filter((plan) => planOutcomeLabel(plan) === 'Completed').length;
  const skipped = detail.plans.filter((plan) => planOutcomeLabel(plan) === 'Skipped').length;

  return (
    <Card style={styles.card} testID="programme-detail-header">
      <View style={styles.topRow}>
        <View style={styles.meta}>
          <Text allowFontScaling={false} accessibilityRole="header" style={uiText.title}>
            {detail.name}
          </Text>
          {detail.description ? (
            <Text allowFontScaling={false} style={uiText.meta}>
              {detail.description}
            </Text>
          ) : null}
        </View>

        <Tag
          label={progressLabel(detail.progress)}
          testID="programme-detail-progress-badge"
          tone={detail.progress === 'completed' ? 'neutral' : 'faint'}
        />
      </View>

      <Text allowFontScaling={false} style={uiText.meta} testID="programme-detail-stats">
        <FigureText>
          {`${detail.planCount} ${detail.planCount === 1 ? 'session' : 'sessions'} · ${completed} completed · ${skipped} skipped`}
        </FigureText>
      </Text>

      <View style={styles.actionsRow}>
        <ActionButton
          accessibilityLabel="Edit programme metadata"
          label="Edit"
          onPress={onEdit}
          testID="programme-detail-edit"
          variant="outline"
        />
        <ActionButton
          accessibilityLabel="Duplicate programme"
          label="Duplicate"
          onPress={onDuplicate}
          testID="programme-detail-duplicate"
          variant="text"
        />
        <ActionButton
          accessibilityLabel="Delete programme"
          label="Delete"
          onPress={onDelete}
          testID="programme-detail-delete"
          tone="danger"
          variant="text"
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: uiSpace.md,
    gap: uiSpace.sm,
  },
  topRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  meta: {
    flex: 1,
    gap: uiSpace.xs,
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingTop: uiSpace.xs,
  },
});

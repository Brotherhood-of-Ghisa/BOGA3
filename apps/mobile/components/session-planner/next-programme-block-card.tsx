import { StyleSheet, Text, View } from 'react-native';

import { ActionButton, Card, uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import type { PlanBlockView, PlanTargetView } from '@/src/session-planner';

export type NextProgrammeBlockCardProps = {
  nextBlock: PlanBlockView | null;
  /** The programme's derived block counts, so the empty card can tell an
   *  all-attached programme from a fully completed one. */
  blockCounts: { pending: number; attached: number; completed: number; skipped: number };
  onAdd: (block: PlanBlockView) => void;
  onSkip: (block: PlanBlockView) => void;
};

/** The empty card's message from the programme's block counts — `nextBlock` is
 *  null both when nothing is left to do and when every unresolved block is
 *  already attached to a session. */
const emptyMessage = (counts: NextProgrammeBlockCardProps['blockCounts']): string => {
  if (counts.attached > 0) {
    return 'Every remaining block is already attached to a session.';
  }
  if (counts.completed + counts.skipped > 0) {
    return 'All blocks in this programme have been completed or skipped.';
  }
  return 'No blocks are available to add right now.';
};

const formatTargetLine = (targets: PlanTargetView[]): string => {
  if (targets.length === 0) return 'No target sets';
  const setsStr = `${targets.length} ${targets.length === 1 ? 'target set' : 'target sets'}`;
  const first = targets[0];
  const weightStr = first.targetWeightValue ? ` @ ${first.targetWeightValue} kg` : '';
  const firstPreview = `${first.targetReps} reps${weightStr}`;
  return targets.length === 1 ? firstPreview : `${setsStr} · starts at ${firstPreview}`;
};

export function NextProgrammeBlockCard({
  nextBlock,
  blockCounts,
  onAdd,
  onSkip,
}: NextProgrammeBlockCardProps) {
  if (nextBlock === null) {
    return (
      <Card style={styles.emptyCard} testID="programme-next-block-empty">
        <Text allowFontScaling={false} accessibilityRole="header" style={styles.microLabel}>
          Next block
        </Text>
        <Text allowFontScaling={false} style={styles.emptyText} testID="programme-next-block-empty-text">
          {emptyMessage(blockCounts)}
        </Text>
      </Card>
    );
  }

  return (
    <Card style={styles.card} testID="programme-next-block-card">
      <View style={styles.headerRow}>
        <Text allowFontScaling={false} accessibilityRole="header" style={styles.microLabel}>
          Next up
        </Text>
      </View>

      <View style={styles.content}>
        <Text allowFontScaling={false} numberOfLines={1} style={styles.exerciseName} testID="programme-next-block-name">
          {nextBlock.name}
        </Text>
        <Text allowFontScaling={false} numberOfLines={1} style={styles.targetLine} testID="programme-next-block-targets">
          {formatTargetLine(nextBlock.targets)}
        </Text>
      </View>

      <View style={styles.actions}>
        <ActionButton
          accessibilityLabel={`Add ${nextBlock.name} block to active session`}
          label="Add to session"
          onPress={() => onAdd(nextBlock)}
          testID="programme-next-block-add"
          variant="primary"
        />
        <ActionButton
          accessibilityLabel={`Skip ${nextBlock.name} block`}
          label="Skip"
          onPress={() => onSkip(nextBlock)}
          testID="programme-next-block-skip"
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
  emptyCard: {
    padding: uiSpace.md,
    gap: uiSpace.xs,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  microLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkFaint,
  },
  content: {
    gap: uiSpace.xs,
  },
  exerciseName: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.ink,
  },
  targetLine: {
    fontFamily: uiFonts.display.family,
    fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs,
    color: uiRoles.inkMuted,
  },
  emptyText: {
    fontFamily: uiFonts.display.family,
    fontSize: uiTypography.size.sm,
    color: uiRoles.inkMuted,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingTop: uiSpace.xs,
  },
});

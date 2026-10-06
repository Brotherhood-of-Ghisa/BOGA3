import { StyleSheet, Text, View } from 'react-native';

import { ActionButton, Card, IconButton, uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui';
import type { PlanDetailView } from '@/src/session-planner';

export type PlanDetailSummaryProps = {
  detail: PlanDetailView;
  /** Delete shows while no block pins the plan. */
  deletable: boolean;
  onStartAll: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
};

const PROVENANCE_LABEL: Record<PlanDetailView['provenance'], string | null> = {
  human: null,
  agent: 'Coached plan',
};

const formatSchedule = (at: Date): string => {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
};

const progressLine = (detail: PlanDetailView): string => {
  const counts = detail.blockCounts;
  const done = counts.completed + counts.skipped;
  const total = done + counts.pending + counts.attached;
  if (total === 0) return 'No blocks yet';
  return `${done} of ${total} blocks done`;
};

/**
 * The plan detail's summary card: title, schedule, derived progress and the
 * quiet provenance line, with the plan's actions — Start all, and Delete
 * while lifecycle permits; Edit and Duplicate sit on the header row.
 */
export function PlanDetailSummary({ detail, deletable, onStartAll, onEdit, onDuplicate, onDelete }: PlanDetailSummaryProps) {
  return (
    <Card testID="plan-detail-summary">
      <View style={styles.summaryRow}>
        <View style={styles.summaryText}>
          <Text allowFontScaling={false} accessibilityRole="header" style={styles.title} testID="plan-detail-title">
            {detail.title}
          </Text>
          <Text allowFontScaling={false} style={styles.meta} testID="plan-detail-schedule">
            {detail.scheduledFor !== null ? `Scheduled ${formatSchedule(detail.scheduledFor)}` : 'Unscheduled'}
          </Text>
          <Text allowFontScaling={false} style={styles.meta} testID="plan-detail-progress">
            {progressLine(detail)}
          </Text>
          {PROVENANCE_LABEL[detail.provenance] ? (
            <Text allowFontScaling={false} style={styles.meta} testID="plan-detail-provenance">
              {PROVENANCE_LABEL[detail.provenance]}
            </Text>
          ) : null}
        </View>
        <IconButton
          accessibilityLabel="Edit this plan"
          name="pencil"
          onPress={onEdit}
          testID="plan-detail-edit"
        />
        <IconButton
          accessibilityLabel="Duplicate this plan"
          name="more-vertical"
          onPress={onDuplicate}
          testID="plan-detail-duplicate"
        />
      </View>
      <ActionButton
        accessibilityLabel="Start every available block of this plan"
        label="Start all"
        onPress={onStartAll}
        testID="plan-detail-start-all"
        variant="primary"
      />
      {deletable ? (
        <ActionButton
          accessibilityLabel="Delete this plan"
          label="Delete"
          onPress={onDelete}
          testID="plan-detail-delete"
          variant="outline"
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: uiSpace.sm,
  },
  summaryText: {
    flex: 1,
    gap: uiSpace.xs,
  },
  title: {
    fontFamily: uiFonts.display.family,
    fontWeight: '800',
    fontSize: uiTypography.size.xl,
    lineHeight: uiTypography.lineHeight.xl,
    color: uiRoles.ink,
  },
  meta: {
    fontFamily: uiFonts.display.family,
    fontWeight: '400',
    fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs,
    color: uiRoles.inkMuted,
  },
});

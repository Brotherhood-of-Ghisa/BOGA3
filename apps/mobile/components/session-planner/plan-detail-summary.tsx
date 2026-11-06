import { useDateFormat } from '@/src/preferences/hooks';
import { formatLocalDateTime, formatShortDate } from '@/src/utils/local-time';
import { StyleSheet, Text, View } from 'react-native';

import { ActionButton, Card, FigureText, IconButton, Tag, uiSpace, uiText } from '@/components/ui';
import type { PlanDetailView } from '@/src/session-planner';
import { blockCountsLabel, planOutcomeLabel } from './progress-labels';
import { routineDateLabel, routineOutcomeLine } from './progress-labels';
import type { ReactNode } from 'react';

export type PlanDetailSummaryProps = {
  detail: PlanDetailView;
  /** Delete shows while no block pins the plan. */
  deletable: boolean;
  onStartAll: () => void;
  onEdit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  onSkipRoutine?: () => void;
  busy?: boolean;
  notice?: ReactNode;
};

const PROVENANCE_LABEL: Record<PlanDetailView['provenance'], string | null> = {
  human: null,
  agent: 'Coached plan',
};

/**
 * The plan detail's summary card: title, schedule, derived progress and the
 * quiet provenance line, with the plan's actions — Start all, and Delete
 * while lifecycle permits; Edit and Duplicate sit on the header row.
 */
export function PlanDetailSummary({ detail, deletable, onStartAll, onEdit, onDuplicate, onDelete, onSkipRoutine, busy, notice }: PlanDetailSummaryProps) {
  const dateFormat = useDateFormat();
  const setCount = detail.blocks.reduce((count, block) => count + block.targets.length, 0);
  return (
    <Card style={styles.card} testID="plan-detail-summary">
      <View style={styles.summaryRow}>
        <View style={styles.summaryText}>
          <Text allowFontScaling={false} accessibilityRole="header" style={uiText.title} testID="plan-detail-title">
            {detail.title}
          </Text>
          {!detail.isRoutine && detail.progress === 'completed' ? (
            <View style={styles.completion}>
              <Tag label={planOutcomeLabel(detail)} testID="plan-detail-completed-tag" />
              {detail.completedAt !== null ? (
                <Text allowFontScaling={false} accessibilityLabel={`${planOutcomeLabel(detail)} ${formatShortDate(detail.completedAt, dateFormat)}`} style={uiText.meta} testID="plan-detail-completed-date">
                  <FigureText>{formatShortDate(detail.completedAt, dateFormat)}</FigureText>
                </Text>
              ) : null}
            </View>
          ) : null}
          <Text allowFontScaling={false} style={uiText.meta} testID="plan-detail-schedule">
            <FigureText>
              {detail.isRoutine ? 'Routine · Anytime' : detail.scheduledFor !== null ? `Scheduled ${formatLocalDateTime(detail.scheduledFor.getTime(), dateFormat)}` : 'Unscheduled'}
            </FigureText>
          </Text>
          <Text allowFontScaling={false} style={uiText.meta} testID="plan-detail-progress">
            <FigureText>{detail.isRoutine
              ? `${detail.blocks.length} ${detail.blocks.length === 1 ? 'exercise' : 'exercises'} · ${setCount} ${setCount === 1 ? 'target' : 'targets'}`
              : blockCountsLabel(detail.blockCounts)}</FigureText>
          </Text>
          {detail.programmeId !== null ? (
            <Text allowFontScaling={false} style={uiText.meta} testID="plan-detail-programme-badge">
              <FigureText>{`Programme session${detail.programmeOrderIndex !== null ? ` · Session ${detail.programmeOrderIndex + 1}` : ''}`}</FigureText>
            </Text>
          ) : null}
          {PROVENANCE_LABEL[detail.provenance] ? (
            <Text allowFontScaling={false} style={uiText.meta} testID="plan-detail-provenance">
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
          name="duplicate"
          onPress={onDuplicate}
          testID="plan-detail-duplicate"
        />
      </View>
      {detail.routine ? <RoutineDates routine={detail.routine} /> : null}
      {notice}
      <ActionButton
        accessibilityLabel={detail.routine?.activeSessionId ? 'Resume this Routine use' : 'Start every available block of this plan'}
        disabled={busy}
        label={detail.routine?.activeSessionId ? 'Resume' : 'Start all'}
        onPress={onStartAll}
        testID="plan-detail-start-all"
        variant="primary"
      />
      {detail.isRoutine && !detail.routine?.activeSessionId ? <ActionButton
        accessibilityLabel="Skip one use of this Routine"
        disabled={busy}
        label="Skip"
        onPress={() => onSkipRoutine?.()}
        testID="plan-detail-skip-routine"
        variant="outline"
      /> : null}
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

function RoutineDates({ routine }: { routine: NonNullable<PlanDetailView['routine']> }) {
  const dateFormat = useDateFormat();
  return <View style={styles.routineDates}>
    {routine.lastCompletedAt !== undefined ? <RoutineDate label="Last completed" value={routineDateLabel(routine.lastCompletedAt, dateFormat)} testID="plan-detail-last-completed" /> : null}
    {routine.lastSkippedAt !== undefined ? <RoutineDate label="Last skipped" value={routineDateLabel(routine.lastSkippedAt, dateFormat)} testID="plan-detail-last-skipped" /> : null}
    {routine.lastCompletedAt === undefined && routine.lastSkippedAt === undefined
      ? <Text allowFontScaling={false} style={uiText.meta} testID="plan-detail-routine-unused">{routineOutcomeLine(routine, dateFormat)}</Text> : null}
  </View>;
}

function RoutineDate({ label, value, testID }: { label: string; value: string; testID: string }) {
  return <View accessible accessibilityLabel={`${label}, ${value}`} style={styles.dateRow} testID={testID}>
    <Text allowFontScaling={false} style={uiText.meta}>{label}</Text>
    <Text allowFontScaling={false} style={uiText.meta}><FigureText>{value}</FigureText></Text>
  </View>;
}

const styles = StyleSheet.create({
  routineDates: { gap: uiSpace.sm },
  dateRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', gap: uiSpace.sm },
  card: {
    padding: uiSpace.md,
    gap: uiSpace.md,
  },
  summaryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: uiSpace.sm,
  },
  summaryText: {
    flex: 1,
    gap: uiSpace.xs,
  },
  completion: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
});

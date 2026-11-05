import { useDateFormat } from '@/src/preferences/hooks';
import { formatShortDate } from '@/src/utils/local-time';
import type { ExerciseDateFormat } from '@/src/preferences/model';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { Card } from '@/components/ui/card';
import { FigureText } from '@/components/ui/figure-text';
import { Tag } from '@/components/ui/tag';
import { uiText, uiTextTone } from '@/components/ui/text-roles';
import { uiRoles, uiSpace } from '@/components/ui/tokens';
import { planQueries, type PlanSummaryView, type ProgrammeSummaryView } from '@/src/session-planner';
import { blockCountsLabel, planDateLabel, planOutcomeLabel } from './progress-labels';

/**
 * The Sessions screen partitions exhaustive reads into unfinished **Upcoming**
 * and **Unscheduled** queues, followed by optional **Completed plans**. Programme
 * children resolve independently; unfinished programmes show session outcomes
 * under [[planner.progress-outcomes]].
 * Queue management stays here; the Today landing page owns surfacing the next
 * scheduled workout or programme block, and programmes join these sections
 * with their own screens. Derived only — nothing here writes plan tables.
 */

const programmeCompletionLabel = (programme: ProgrammeSummaryView, dateFormat: ExerciseDateFormat): string =>
  (programme.progress === 'completed'
    ? `, Completed${programme.completedAt === null ? '' : ` ${formatShortDate(programme.completedAt, dateFormat)}`}`
    : `, ${programme.completedSessionCount} of ${programme.planCount} sessions completed`) +
  (programme.skippedSessionCount > 0 ? `, ${programme.skippedSessionCount} skipped` : '');

export type PlanSectionProps = {
  label: string;
  plans: PlanSummaryView[];
  programmes?: ProgrammeSummaryView[];
  testID: string;
  onOpenPlan: (planId: string) => void;
  onOpenProgramme?: (programmeId: string) => void;
};

/** One planning section: its micro-label, the rows in one card, or nothing. */
export function PlanSection({
  label,
  plans,
  programmes = [],
  testID,
  onOpenPlan,
  onOpenProgramme,
}: PlanSectionProps) {
  const dateFormat = useDateFormat();
  if (plans.length === 0 && programmes.length === 0) {
    return null;
  }
  return (
    <View style={styles.section} testID={testID}>
      <Text allowFontScaling={false} accessibilityRole="header" style={[uiText.label, uiTextTone.faint]}>
        {label}
      </Text>
      <Card>
        {programmes.map((programme, index) => (
          <ListRow
            accessibilityLabel={`Programme ${programme.name}, ${programme.planCount} sessions${programmeCompletionLabel(programme, dateFormat)}`}
            density="list"
            divider={index > 0}
            key={programme.id}
            onPress={() => onOpenProgramme?.(programme.id)}
            testID={`${testID}-programme-${programme.id}`}>
            <View style={styles.rowText}>
              <View style={styles.titleRow}>
                <Text allowFontScaling={false} numberOfLines={1} style={[uiText.bodyStrong, styles.title]}>
                  {programme.name}
                </Text>
                <Tag label={programme.progress === 'completed' ? 'Completed' : `${programme.completedSessionCount}/${programme.planCount} completed`} />
              </View>
              <Text allowFontScaling={false} style={uiText.meta}>
                <FigureText>{`Programme · ${programme.planCount} ${programme.planCount === 1 ? 'session' : 'sessions'}${programme.skippedSessionCount > 0 ? ` · ${programme.skippedSessionCount} skipped` : ''}${programme.progress === 'completed' && programme.completedAt !== null ? ` · ${formatShortDate(programme.completedAt, dateFormat)}` : ''}`}</FigureText>
              </Text>
            </View>
          </ListRow>
        ))}
        {plans.map((plan, index) => (
          <ListRow
            accessibilityLabel={plan.progress === 'completed'
              ? [plan.title, planOutcomeLabel(plan), planDetailLine(plan, dateFormat)].join(', ')
              : `${plan.title}, ${planDateLabel(plan, dateFormat)}`}
            density="list"
            divider={programmes.length > 0 || index > 0}
            key={plan.id}
            onPress={() => onOpenPlan(plan.id)}
            testID={`${testID}-row-${plan.id}`}>
            <View style={styles.rowText}>
              <View style={styles.titleRow}>
                <Text allowFontScaling={false} numberOfLines={1} style={[uiText.bodyStrong, styles.title]}>
                  {plan.title}
                </Text>
                {plan.progress === 'completed' ? <Tag label={planOutcomeLabel(plan)} /> : null}
              </View>
              <Text allowFontScaling={false} style={uiText.meta}>
                <FigureText>{planDetailLine(plan, dateFormat)}</FigureText>
              </Text>
            </View>
          </ListRow>
        ))}
      </Card>
    </View>
  );
}

const planDetailLine = (plan: PlanSummaryView, dateFormat: ExerciseDateFormat): string => {
  const counts = plan.blockCounts;
  const blocks = counts.pending + counts.attached + counts.completed + counts.skipped;
  const blockLine = plan.progress === 'completed' ? blockCountsLabel(counts) : `${blocks} ${blocks === 1 ? 'block' : 'blocks'}`;
  return [planDateLabel(plan, dateFormat), blockLine].filter(Boolean).join(' · ');
};

/** The quiet Plan session action: the hub's persistent entry and the empty states' one. */
export function PlanSessionAction({ onPress, testID = 'plan-session-action' }: { onPress: () => void; testID?: string }) {
  return (
    <ListRow
      accessibilityLabel="Plan a session"
      density="list"
      divider={false}
      leading={<Icon color={uiRoles.ink} name="plus" size="xs" />}
      label="Plan session"
      onPress={onPress}
      testID={testID}
    />
  );
}

/** The New programme action: the hub's entry for authoring multi-session programmes. */
export function NewProgrammeAction({ onPress, testID = 'sessions-new-programme-action' }: { onPress: () => void; testID?: string }) {
  return (
    <ListRow
      accessibilityLabel="New training programme"
      density="list"
      divider={false}
      leading={<Icon color={uiRoles.ink} name="plus" size="xs" />}
      label="New programme"
      onPress={onPress}
      testID={testID}
    />
  );
}

export type PlanSectionsState = {
  upcoming: PlanSummaryView[];
  unscheduled: PlanSummaryView[];
  programmes: ProgrammeSummaryView[];
  isLoading: boolean;
  loadErrorMessage: string | null;
  reload: () => Promise<void>;
};

/** Loads the planning sections on mount and whenever the host refocuses. */
export const usePlanSections = (): PlanSectionsState => {
  const [state, setState] = useState<{
    upcoming: PlanSummaryView[];
    unscheduled: PlanSummaryView[];
    programmes: ProgrammeSummaryView[];
    isLoading: boolean;
    loadErrorMessage: string | null;
  }>({ upcoming: [], unscheduled: [], programmes: [], isLoading: true, loadErrorMessage: null });

  const load = useCallback(async () => {
    // The previous load's rows stay visible across a refocus reload; the
    // first load starts with the hook's own loading state.
    try {
      const [upcoming, unscheduled, programmes] = await Promise.all([
        planQueries.listUpcomingPlans(),
        planQueries.listUnscheduledPlans(),
        planQueries.listProgrammeSummaries(),
      ]);
      setState({ upcoming, unscheduled, programmes, isLoading: false, loadErrorMessage: null });
    } catch {
      setState((current) => ({
        ...current,
        isLoading: false,
        loadErrorMessage: "Couldn't load your plans.",
      }));
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  return { ...state, reload: load };
};

const styles = StyleSheet.create({
  section: {
    gap: uiSpace.sm,
    paddingBottom: uiSpace.md,
  },
  rowText: {
    flex: 1,
    minWidth: 0,
    paddingVertical: uiSpace.sm,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  title: {
    flex: 1,
  },
});

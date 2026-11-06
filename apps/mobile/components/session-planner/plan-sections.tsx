import { useDateFormat } from '@/src/preferences/hooks';
import type { ExerciseDateFormat } from '@/src/preferences/model';
import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { Card } from '@/components/ui/card';
import { FigureText } from '@/components/ui/figure-text';
import { Tag } from '@/components/ui/tag';
import { StatePanel } from '@/components/ui/state-panel';
import { uiText, uiTextTone } from '@/components/ui/text-roles';
import { uiRoles, uiSpace } from '@/components/ui/tokens';
import { planQueries, type PlanSummaryView, type ProgrammeSummaryView } from '@/src/session-planner';
import { blockCountsLabel, planDateLabel, planOutcomeLabel, routineOutcomeLine } from './progress-labels';

/**
 * The Sessions screen partitions exhaustive reads into unfinished **Upcoming**
 * and **Unscheduled** queues, followed by optional **Completed plans**. Programme
 * children resolve independently; unfinished programmes show session outcomes
 * under [[planner.progress-outcomes]].
 * Queue management stays here; the Today landing page owns surfacing the next
 * scheduled workout or programme block, and programmes join these sections
 * with their own screens. Derived only — nothing here writes plan tables.
 */

const programmeCompletionLabel = (programme: ProgrammeSummaryView): string =>
  (programme.progress === 'completed'
    ? ', Completed'
    : `, ${programme.completedSessionCount} of ${programme.planCount} sessions completed`) +
  (programme.skippedSessionCount > 0 ? `, ${programme.skippedSessionCount} skipped` : '');

export type PlanSectionProps = {
  label: string;
  plans: PlanSummaryView[];
  programmes?: ProgrammeSummaryView[];
  testID: string;
  onOpenPlan: (planId: string) => void;
  onOpenProgramme?: (programmeId: string) => void;
  emptyMessage?: string;
  isLoading?: boolean;
  errorMessage?: string | null;
  onRetry?: () => void;
};

/** One planning section: its micro-label, the rows in one card, or nothing. */
export function PlanSection({
  label,
  plans,
  programmes = [],
  testID,
  onOpenPlan,
  onOpenProgramme,
  emptyMessage,
  isLoading = false,
  errorMessage,
  onRetry,
}: PlanSectionProps) {
  const dateFormat = useDateFormat();
  const empty = plans.length === 0 && programmes.length === 0;
  if (empty && !emptyMessage && !isLoading && !errorMessage) {
    return null;
  }
  return (
    <View style={styles.section} testID={testID}>
      <Text allowFontScaling={false} accessibilityRole="header" style={[uiText.label, uiTextTone.faint]}>
        {label}
      </Text>
      {errorMessage ? <StatePanel action={onRetry ? { label: 'Retry', onPress: onRetry, testID: `${testID}-retry` } : undefined}
        body={errorMessage} fill={false} kind="error" testID={`${testID}-error`} /> : null}
      {empty && isLoading ? <Card><StatePanel body="Loading routines..." fill={false} kind="loading" testID={`${testID}-loading`} /></Card> : null}
      {empty && !isLoading && !errorMessage ? <Card><StatePanel body={emptyMessage} fill={false} testID={`${testID}-empty`} /></Card> : null}
      {!empty ? <Card>
        {programmes.map((programme, index) => (
          <ListRow
            accessibilityLabel={`Programme ${programme.name}, ${programme.planCount} sessions${programmeCompletionLabel(programme)}`}
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
                <Tag label={programme.progress === 'completed' ? 'Completed' : `${programme.completedSessionCount} over ${programme.planCount}`} />
              </View>
              <Text allowFontScaling={false} style={uiText.meta}>
                <FigureText>{`Programme · ${programme.planCount} ${programme.planCount === 1 ? 'session' : 'sessions'}${programme.skippedSessionCount > 0 ? ` · ${programme.skippedSessionCount} skipped` : ''}`}</FigureText>
              </Text>
            </View>
          </ListRow>
        ))}
        {plans.map((plan, index) => (
          <ListRow
            accessibilityLabel={plan.routine ? [plan.title, 'Routine', routineOutcomeLine(plan.routine, dateFormat),
              plan.routine.activeSessionId ? 'In progress' : ''].filter(Boolean).join(', ') : plan.progress === 'completed'
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
                {plan.routine?.activeSessionId ? <Tag label="In progress" /> : !plan.isRoutine && plan.progress === 'completed' ? <Tag label={planOutcomeLabel(plan)} /> : null}
              </View>
              <Text allowFontScaling={false} style={uiText.meta}>
                <FigureText>{planDetailLine(plan, dateFormat)}</FigureText>
              </Text>
            </View>
          </ListRow>
        ))}
      </Card> : null}
    </View>
  );
}

const planDetailLine = (plan: PlanSummaryView, dateFormat: ExerciseDateFormat): string => {
  if (plan.routine) return routineOutcomeLine(plan.routine, dateFormat);
  const counts = plan.blockCounts;
  const blocks = counts.pending + counts.attached + counts.completed + counts.skipped;
  const blockLine = plan.progress === 'completed' ? blockCountsLabel(counts) : `${blocks} ${blocks === 1 ? 'block' : 'blocks'}`;
  return [plan.progress === 'completed' ? '' : planDateLabel(plan, dateFormat), blockLine].filter(Boolean).join(' · ');
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
  routines: PlanSummaryView[];
  upcoming: PlanSummaryView[];
  unscheduled: PlanSummaryView[];
  programmes: ProgrammeSummaryView[];
  isLoading: boolean;
  loadErrorMessage: string | null;
  reload: () => Promise<void>;
};

/** The reusable-intent section stays visible across empty, loading and failed reads. */
export function RoutinePlanSection({ state, onOpenPlan }: { state: PlanSectionsState; onOpenPlan: (id: string) => void }) {
  return <PlanSection
    emptyMessage="No routines yet."
    errorMessage={state.loadErrorMessage}
    isLoading={state.isLoading}
    label="Routines"
    onOpenPlan={onOpenPlan}
    onRetry={() => void state.reload()}
    plans={state.routines}
    testID="sessions-plan-section-routines"
  />;
}

/** Loads the planning sections on mount and whenever the host refocuses. */
export const usePlanSections = (): PlanSectionsState => {
  const [state, setState] = useState<{
    routines: PlanSummaryView[];
    upcoming: PlanSummaryView[];
    unscheduled: PlanSummaryView[];
    programmes: ProgrammeSummaryView[];
    isLoading: boolean;
    loadErrorMessage: string | null;
  }>({ routines: [], upcoming: [], unscheduled: [], programmes: [], isLoading: true, loadErrorMessage: null });

  const load = useCallback(async () => {
    // The previous load's rows stay visible across a refocus reload; the
    // first load starts with the hook's own loading state.
    try {
      const [upcoming, unscheduled, programmes, routines] = await Promise.all([
        planQueries.listUpcomingPlans(),
        planQueries.listUnscheduledPlans(),
        planQueries.listProgrammeSummaries(),
        planQueries.listRoutines(),
      ]);
      setState({ routines, upcoming, unscheduled, programmes, isLoading: false, loadErrorMessage: null });
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

import { useCallback, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { Icon } from '@/components/ui/icon';
import { ListRow } from '@/components/ui/list-row';
import { Card } from '@/components/ui/card';
import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { planQueries, type PlanSummaryView, type ProgrammeSummaryView } from '@/src/session-planner';

/**
 * The Sessions screen's planning sections: **Upcoming** (scheduled one-off
 * and programme-child plans, soonest first) and **Unscheduled** (standalone plans
 * and training programmes, most recently updated first), over the plan queries.
 * Queue management stays here; the Today landing page owns surfacing the next
 * scheduled workout or programme block, and programmes join these sections
 * with their own screens. Derived only — nothing here writes plan tables.
 */

/** Formats the quiet schedule line under a plan's title. */
const scheduleLine = (plan: PlanSummaryView): string => {
  if (plan.scheduledFor !== null) {
    const at = plan.scheduledFor;
    const pad = (value: number) => String(value).padStart(2, '0');
    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
  }
  return 'Unscheduled';
};

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
  if (plans.length === 0 && programmes.length === 0) {
    return null;
  }
  return (
    <View style={styles.section} testID={testID}>
      <Text allowFontScaling={false} accessibilityRole="header" style={styles.microLabel}>
        {label}
      </Text>
      <Card>
        {programmes.map((programme, index) => (
          <ListRow
            accessibilityLabel={`Programme ${programme.name}, ${programme.planCount} sessions`}
            density="list"
            divider={index > 0}
            key={programme.id}
            onPress={() => onOpenProgramme?.(programme.id)}
            testID={`${testID}-programme-${programme.id}`}>
            <View style={styles.rowText}>
              <Text allowFontScaling={false} numberOfLines={1} style={styles.title}>
                {programme.name}
              </Text>
              <Text allowFontScaling={false} numberOfLines={1} style={styles.detail}>
                Programme · {programme.planCount} {programme.planCount === 1 ? 'session' : 'sessions'}
              </Text>
            </View>
          </ListRow>
        ))}
        {plans.map((plan, index) => (
          <ListRow
            accessibilityLabel={`${plan.title}, ${scheduleLine(plan)}`}
            density="list"
            divider={programmes.length > 0 || index > 0}
            key={plan.id}
            onPress={() => onOpenPlan(plan.id)}
            testID={`${testID}-row-${plan.id}`}>
            <View style={styles.rowText}>
              <Text allowFontScaling={false} numberOfLines={1} style={styles.title}>
                {plan.title}
              </Text>
              <Text allowFontScaling={false} numberOfLines={1} style={styles.detail}>
                {planDetailLine(plan)}
              </Text>
            </View>
          </ListRow>
        ))}
      </Card>
    </View>
  );
}

const planDetailLine = (plan: PlanSummaryView): string => {
  const counts = plan.blockCounts;
  const blocks = counts.pending + counts.attached + counts.completed + counts.skipped;
  return `${scheduleLine(plan)} · ${blocks} ${blocks === 1 ? 'block' : 'blocks'}`;
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
  microLabel: {
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.xxs,
    lineHeight: uiTypography.lineHeight.xxs,
    letterSpacing: uiTypography.size.xxs * uiGeometry.microLabelTracking,
    textTransform: 'uppercase',
    color: uiRoles.inkFaint,
  },
  rowText: {
    paddingVertical: uiSpace.sm,
  },
  title: {
    fontFamily: uiFonts.display.family,
    fontWeight: '600',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.ink,
  },
  detail: {
    fontFamily: uiFonts.display.family,
    fontWeight: '400',
    fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs,
    color: uiRoles.inkMuted,
  },
});

import { Stack, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  NewProgrammeAction,
  PlanSection,
  PlanSessionAction,
  RoutinePlanSection,
  usePlanSections,
} from '@/components/session-planner/plan-sections';
import {
  IconButton,
  Screen,
  ScreenScroll,
  Sheet,
  SwitchRow,
  uiSpace,
} from '@/components/ui';

export type PlannerScreenProps = {
  initialShowCompletedPlans?: boolean;
};

/**
 * Dedicated planner and scheduled session space: Routines, Upcoming scheduled workouts,
 * Unscheduled backlog (standalone plans and programmes), and optional Completed plans.
 */
export function PlannerScreen({
  initialShowCompletedPlans = false,
}: PlannerScreenProps) {
  const router = useRouter();
  const [showCompletedPlans, setShowCompletedPlans] = useState(initialShowCompletedPlans);
  const [optionsVisible, setOptionsVisible] = useState(false);

  const planSections = usePlanSections();
  const upcoming = planSections.upcoming.filter((plan) => plan.progress !== 'completed');
  const unscheduled = planSections.unscheduled.filter((plan) => plan.progress !== 'completed');
  const programmes = planSections.programmes.filter((programme) => programme.progress !== 'completed');
  const completedPlans = showCompletedPlans
    ? [
        ...new Map(
          [
            ...planSections.upcoming,
            ...planSections.unscheduled,
            ...planSections.programmes.flatMap((programme) =>
              programme.plans.filter((plan) => plan.scheduledFor === null),
            ),
          ]
            .filter((plan) => plan.progress === 'completed')
            .map((plan) => [plan.id, plan]),
        ).values(),
      ]
    : [];
  const completedProgrammes = showCompletedPlans
    ? [
        ...new Map(
          planSections.programmes
            .filter((programme) => programme.progress === 'completed')
            .map((programme) => [programme.id, programme]),
        ).values(),
      ]
    : [];

  const openPlanNew = () => {
    router.push('/session-plan/new' as Href);
  };

  const openPlan = (planId: string) => {
    router.push(`/session-plan/${encodeURIComponent(planId)}` as Href);
  };

  const openProgrammeNew = () => {
    router.push('/programme/new' as Href);
  };

  const openProgramme = (programmeId: string) => {
    router.push(`/programme/${encodeURIComponent(programmeId)}` as Href);
  };

  return (
    <Screen testID="planner-screen">
      <Stack.Screen
        options={{
          title: 'Planner',
          headerRight: () => (
            <IconButton
              accessibilityLabel="Planner options"
              name="more-vertical"
              onPress={() => setOptionsVisible(true)}
              testID="planner-options-button"
            />
          ),
        }}
      />
      <ScreenScroll
        contentContainerStyle={styles.content}
        testID="planner-scroll">
        <PlanSessionAction onPress={openPlanNew} testID="planner-plan-session-action" />
        <NewProgrammeAction onPress={openProgrammeNew} testID="planner-new-programme-action" />
        <RoutinePlanSection onOpenPlan={openPlan} state={planSections} testID="planner-plan-section-routines" />
        <PlanSection
          label="Upcoming"
          onOpenPlan={openPlan}
          plans={upcoming}
          testID="planner-plan-section-upcoming"
        />
        <PlanSection
          label="Unscheduled"
          onOpenPlan={openPlan}
          onOpenProgramme={openProgramme}
          plans={unscheduled}
          programmes={programmes}
          testID="planner-plan-section-unscheduled"
        />
        <PlanSection
          label="Completed plans"
          onOpenPlan={openPlan}
          onOpenProgramme={openProgramme}
          plans={completedPlans as typeof planSections.upcoming}
          programmes={completedProgrammes as typeof planSections.programmes}
          testID="planner-plan-section-completed"
        />
      </ScreenScroll>
      <Sheet
        dismissLabel="Close planner options"
        onDismiss={() => setOptionsVisible(false)}
        testID="planner-options-sheet"
        visible={optionsVisible}>
        <View style={styles.options}>
          <SwitchRow
            label="Show completed plans"
            onValueChange={setShowCompletedPlans}
            testID="toggle-completed-plans"
            value={showCompletedPlans}
          />
        </View>
      </Sheet>
    </Screen>
  );
}

export default function PlannerRoute() {
  return <PlannerScreen />;
}

const styles = StyleSheet.create({
  content: {
    gap: uiSpace.md,
    paddingBottom: uiSpace.xl,
  },
  options: {
    paddingBottom: uiSpace.lg,
  },
});

import { Stack, useLocalSearchParams, useRouter, type Href } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';

import {
  NewProgrammeAction,
  PlanSection,
  PlanSessionAction,
  RoutinePlanSection,
  usePlanSections,
  type PlanSectionsState,
} from '@/components/session-planner/plan-sections';
import { PlannerWeekStrip } from '@/components/session-planner/planner-week-strip';
import {
  Card,
  IconButton,
  Screen,
  ScreenScroll,
  SegmentedControl,
  type SegmentedControlOption,
  Sheet,
  StatePanel,
  SwitchRow,
  uiSpace,
} from '@/components/ui';
import { useDateFormat } from '@/src/preferences/hooks';
import type { PlanSummaryView, ProgrammeSummaryView } from '@/src/session-planner';
import { localDateKey } from '@/src/utils/calendar-weeks';
import { formatDayMonth } from '@/src/utils/local-time';

export type PlannerScope = 'all' | 'schedule' | 'routines' | 'programmes';

export type PlannerScreenProps = {
  initialShowCompletedPlans?: boolean;
  initialScope?: PlannerScope;
};

const SCOPE_OPTIONS: readonly SegmentedControlOption<PlannerScope>[] = [
  { value: 'all', label: 'All' },
  { value: 'schedule', label: 'Schedule' },
  { value: 'routines', label: 'Routines' },
  { value: 'programmes', label: 'Programmes' },
];

const extractCompletedPlans = (sections: PlanSectionsState): PlanSummaryView[] => [
  ...new Map(
    [
      ...sections.upcoming,
      ...sections.unscheduled,
      ...sections.programmes.flatMap((programme) =>
        programme.plans.filter((plan) => plan.scheduledFor === null),
      ),
    ]
      .filter((plan) => plan.progress === 'completed')
      .map((plan) => [plan.id, plan]),
  ).values(),
];

const extractCompletedProgrammes = (programmes: ProgrammeSummaryView[]): ProgrammeSummaryView[] => [
  ...new Map(
    programmes
      .filter((programme) => programme.progress === 'completed')
      .map((programme) => [programme.id, programme]),
  ).values(),
];

function PlannerAllContent({
  openPlanNew,
  openProgrammeNew,
  openPlan,
  openProgramme,
  onSelectDate,
  upcoming,
  unscheduled,
  programmes,
  completedPlans,
  completedProgrammes,
  planSections,
  selectedDate,
}: {
  openPlanNew: () => void;
  openProgrammeNew: () => void;
  openPlan: (id: string) => void;
  openProgramme: (id: string) => void;
  onSelectDate: (dateKey: string | null) => void;
  upcoming: PlanSummaryView[];
  unscheduled: PlanSummaryView[];
  programmes: ProgrammeSummaryView[];
  completedPlans: PlanSummaryView[];
  completedProgrammes: ProgrammeSummaryView[];
  planSections: PlanSectionsState;
  selectedDate: string | null;
}) {
  return (
    <>
      <PlanSessionAction onPress={openPlanNew} testID="planner-plan-session-action" />
      <NewProgrammeAction onPress={openProgrammeNew} testID="planner-new-programme-action" />
      <PlannerWeekStrip
        onSelectDate={onSelectDate}
        plans={upcoming}
        selectedDate={selectedDate}
        testID="planner-week-strip"
      />
      <RoutinePlanSection onOpenPlan={openPlan} state={planSections} testID="planner-plan-section-routines" />
      <PlanSection label="Upcoming" onOpenPlan={openPlan} plans={upcoming} testID="planner-plan-section-upcoming" />
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
        plans={completedPlans}
        programmes={completedProgrammes}
        testID="planner-plan-section-completed"
      />
    </>
  );
}

function PlannerScheduleContent({
  openPlanNew,
  openPlan,
  openProgramme,
  onSelectDate,
  upcoming,
  filteredUpcoming,
  unscheduled,
  completedPlans,
  selectedDate,
  selectedDayLabel,
}: {
  openPlanNew: () => void;
  openPlan: (id: string) => void;
  openProgramme: (id: string) => void;
  onSelectDate: (dateKey: string | null) => void;
  upcoming: PlanSummaryView[];
  filteredUpcoming: PlanSummaryView[];
  unscheduled: PlanSummaryView[];
  completedPlans: PlanSummaryView[];
  selectedDate: string | null;
  selectedDayLabel: string;
}) {
  return (
    <>
      <PlanSessionAction onPress={openPlanNew} testID="planner-plan-session-action" />
      <PlannerWeekStrip
        onSelectDate={onSelectDate}
        plans={upcoming}
        selectedDate={selectedDate}
        testID="planner-week-strip"
      />
      {selectedDate && filteredUpcoming.length === 0 ? (
        <Card testID="planner-day-empty-card">
          <StatePanel
            action={{ label: 'Plan a session', onPress: openPlanNew, testID: 'planner-plan-for-day' }}
            body={`No workouts scheduled for ${selectedDayLabel}.`}
            fill={false}
          />
        </Card>
      ) : (
        <PlanSection
          label={selectedDate ? `Scheduled · ${selectedDayLabel}` : 'Upcoming'}
          onOpenPlan={openPlan}
          plans={filteredUpcoming}
          testID="planner-plan-section-upcoming"
        />
      )}
      <PlanSection
        label="Unscheduled backlog"
        onOpenPlan={openPlan}
        onOpenProgramme={openProgramme}
        plans={unscheduled}
        programmes={[]}
        testID="planner-plan-section-unscheduled"
      />
      <PlanSection
        label="Completed scheduled plans"
        onOpenPlan={openPlan}
        plans={completedPlans}
        testID="planner-plan-section-completed"
      />
    </>
  );
}

function PlannerRoutinesContent({
  openPlanNew,
  openPlan,
  planSections,
  completedPlans,
}: {
  openPlanNew: () => void;
  openPlan: (id: string) => void;
  planSections: PlanSectionsState;
  completedPlans: PlanSummaryView[];
}) {
  return (
    <>
      <PlanSessionAction
        accessibilityLabel="Create a new routine"
        label="Create routine"
        onPress={openPlanNew}
        testID="planner-plan-session-action"
      />
      <RoutinePlanSection onOpenPlan={openPlan} state={planSections} testID="planner-plan-section-routines" />
      <PlanSection
        label="Completed routines"
        onOpenPlan={openPlan}
        plans={completedPlans}
        testID="planner-plan-section-completed"
      />
    </>
  );
}

function PlannerProgrammesContent({
  openProgrammeNew,
  openPlan,
  openProgramme,
  programmes,
  completedProgrammes,
}: {
  openProgrammeNew: () => void;
  openPlan: (id: string) => void;
  openProgramme: (id: string) => void;
  programmes: ProgrammeSummaryView[];
  completedProgrammes: ProgrammeSummaryView[];
}) {
  return (
    <>
      <NewProgrammeAction onPress={openProgrammeNew} testID="planner-new-programme-action" />
      <PlanSection
        emptyMessage="No active programmes."
        label="Programmes"
        onOpenPlan={openPlan}
        onOpenProgramme={openProgramme}
        plans={[]}
        programmes={programmes}
        testID="planner-plan-section-programmes"
      />
      <PlanSection
        label="Completed programmes"
        onOpenPlan={openPlan}
        onOpenProgramme={openProgramme}
        plans={[]}
        programmes={completedProgrammes}
        testID="planner-plan-section-completed"
      />
    </>
  );
}

/**
 * Dedicated planner and scheduled session space with scoped tabs (All, Schedule,
 * Routines, Programmes), interactive 7-day week agenda context, and completed plans toggle.
 */
export function PlannerScreen({
  initialShowCompletedPlans = false,
  initialScope = 'all',
}: PlannerScreenProps) {
  const router = useRouter();
  const dateFormat = useDateFormat();
  const [scope, setScope] = useState<PlannerScope>(initialScope);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [showCompletedPlans, setShowCompletedPlans] = useState(initialShowCompletedPlans);
  const [optionsVisible, setOptionsVisible] = useState(false);

  const planSections = usePlanSections();
  const upcoming = planSections.upcoming.filter((plan) => plan.progress !== 'completed');
  const unscheduled = planSections.unscheduled.filter((plan) => plan.progress !== 'completed');
  const programmes = planSections.programmes.filter((programme) => programme.progress !== 'completed');

  const filteredUpcoming = selectedDate
    ? upcoming.filter((plan) => plan.scheduledFor && localDateKey(plan.scheduledFor) === selectedDate)
    : upcoming;
  const selectedDayDate = selectedDate ? new Date(`${selectedDate}T12:00:00`) : null;
  const selectedDayLabel = selectedDayDate ? formatDayMonth(selectedDayDate, dateFormat) : '';

  const completedPlans = showCompletedPlans ? extractCompletedPlans(planSections) : [];
  const completedProgrammes = showCompletedPlans ? extractCompletedProgrammes(planSections.programmes) : [];

  const openPlanNew = () => router.push('/session-plan/new' as Href);
  const openPlan = (planId: string) => router.push(`/session-plan/${encodeURIComponent(planId)}` as Href);
  const openProgrammeNew = () => router.push('/programme/new' as Href);
  const openProgramme = (programmeId: string) =>
    router.push(`/programme/${encodeURIComponent(programmeId)}` as Href);

  const handleSelectDateFromAll = (dateKey: string | null) => {
    setSelectedDate(dateKey);
    if (dateKey !== null) setScope('schedule');
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
      <ScreenScroll contentContainerStyle={styles.content} testID="planner-scroll">
        <SegmentedControl
          density="compact"
          layout="fill"
          onChange={setScope}
          options={SCOPE_OPTIONS}
          testIDPrefix="planner-scope"
          value={scope}
        />
        {scope === 'all' ? (
          <PlannerAllContent
            completedPlans={completedPlans}
            completedProgrammes={completedProgrammes}
            onSelectDate={handleSelectDateFromAll}
            openPlan={openPlan}
            openPlanNew={openPlanNew}
            openProgramme={openProgramme}
            openProgrammeNew={openProgrammeNew}
            planSections={planSections}
            programmes={programmes}
            selectedDate={selectedDate}
            unscheduled={unscheduled}
            upcoming={upcoming}
          />
        ) : null}
        {scope === 'schedule' ? (
          <PlannerScheduleContent
            completedPlans={completedPlans}
            filteredUpcoming={filteredUpcoming}
            onSelectDate={setSelectedDate}
            openPlan={openPlan}
            openPlanNew={openPlanNew}
            openProgramme={openProgramme}
            selectedDate={selectedDate}
            selectedDayLabel={selectedDayLabel}
            unscheduled={unscheduled}
            upcoming={upcoming}
          />
        ) : null}
        {scope === 'routines' ? (
          <PlannerRoutinesContent
            completedPlans={completedPlans}
            openPlan={openPlan}
            openPlanNew={openPlanNew}
            planSections={planSections}
          />
        ) : null}
        {scope === 'programmes' ? (
          <PlannerProgrammesContent
            completedProgrammes={completedProgrammes}
            openPlan={openPlan}
            openProgramme={openProgramme}
            openProgrammeNew={openProgrammeNew}
            programmes={programmes}
          />
        ) : null}
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
  const params = useLocalSearchParams<{ scope?: PlannerScope }>();
  const validScopes: PlannerScope[] = ['all', 'schedule', 'routines', 'programmes'];
  const initialScope = params.scope && validScopes.includes(params.scope) ? params.scope : 'all';
  return <PlannerScreen initialScope={initialScope} />;
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

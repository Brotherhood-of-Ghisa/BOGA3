import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { localDateKey } from '@/src/utils/calendar-weeks';
import type { NextPlannedSession, PlanWeekDay, RecoveryRow, TodayPlan } from '@/src/today-plan';
import { formatClockTime, formatCompactDate } from '@/src/utils/local-time';

import { todayText } from './text-styles';

export type TodayPlanCardsProps = {
  plan: TodayPlan;
  /** Opens one muscle's progress history. */
  onOpenMuscle: (muscleGroupId: string) => void;
  onOpenProgress: () => void;
  onOpenPlan: (planId: string) => void;
  /** The cards layout: the recovery card shows its first rows and scrolls the rest. */
  fill?: boolean;
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdayLetter = (date: Date) => WEEKDAYS[date.getDay()].charAt(0);
const weekdayShort = (date: Date) => WEEKDAYS[date.getDay()].slice(0, 3);
const spokenDate = (date: Date) => `${WEEKDAYS[date.getDay()]} ${formatCompactDate(date)}`;
const sets = (count: number) => `${count} ${count === 1 ? 'set' : 'sets'}`;
// A plan's rows are targets, never working sets ([[set.count-display]]).
const targetSets = (count: number) => `${count} ${count === 1 ? 'target set' : 'target sets'}`;

// No sets that day reads as a rest day ([[copy.blank-history]]).
const recoveryRowLabel = (row: RecoveryRow, days: Date[]) =>
  [
    row.name,
    ...row.days.map((count, index) => `${spokenDate(days[index])}: ${count === null ? 'rest' : sets(count)}`),
    `this week ${row.weekSets} of ${row.target} sets`,
  ].join(', ');

function DayCell({ count, testID }: { count: number | null; testID: string }) {
  return (
    <View style={[styles.dayCell, count === null ? styles.dayCellRest : styles.dayCellTrained]} testID={testID}>
      <Text allowFontScaling={false} style={styles.dayCellFigure}>
        {count === null ? '' : count}
      </Text>
    </View>
  );
}

function RecoveryMuscleRow({ row, days, onPress }: { row: RecoveryRow; days: Date[]; onPress: () => void }) {
  const testID = `today-plan-muscle-${row.muscleGroupId}`;
  const met = row.weekSets >= row.target;
  return (
    <Pressable
      accessibilityHint="Opens its progress"
      accessibilityLabel={recoveryRowLabel(row, days)}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.muscleRow, pressed ? styles.pressed : null]}
      testID={testID}>
      <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={styles.muscleName}>
        {row.name}
      </Text>
      {row.days.map((count, index) => (
        <DayCell count={count} key={days[index].getTime()} testID={`${testID}-day-${index}`} />
      ))}
      <Text allowFontScaling={false} style={styles.weekCell} testID={`${testID}-week`}>
        <Text allowFontScaling={false} style={[styles.weekFigure, met ? styles.weekFigureMet : null]}>{row.weekSets}</Text>
        <Text allowFontScaling={false} style={styles.weekTarget}>{`/${row.target}`}</Text>
      </Text>
      <Icon color={uiRoles.inkGhost} name="chevron-right" size="sm" />
    </Pressable>
  );
}

// Each muscle's sets on the last three days and this week against its weekly
// target ([[muscle.weekly-targets]]), least trained first.
function RecoveryCard({ plan, onOpenMuscle, onOpenProgress, fill }: Omit<TodayPlanCardsProps, 'onOpenPlan'>) {
  const label = [todayText.microLabel, todayText.microLabelFaint];
  const rows = plan.muscles.map((row) => (
    <RecoveryMuscleRow
      days={plan.recoveryDays}
      key={row.muscleGroupId}
      onPress={() => onOpenMuscle(row.muscleGroupId)}
      row={row}
    />
  ));
  return (
    <Card style={[styles.card, fill ? styles.fillCard : null]} testID="today-plan-recovery-card">
      <View style={styles.header}>
        <Text accessibilityRole="header" allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelStrong]}>
          Recovery
        </Text>
        <ActionButton label="Progress" onPress={onOpenProgress} testID="today-plan-progress-button" variant="text" />
      </View>
      <View style={[styles.columns, styles.muscleRowLayout]}>
        <Text allowFontScaling={false} style={[...label, styles.muscleName]}>Muscle</Text>
        {plan.recoveryDays.map((day) => (
          <Text allowFontScaling={false} key={day.getTime()} style={[...label, styles.dayLabel]}>
            {weekdayShort(day)}
          </Text>
        ))}
        <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelStrong, styles.weekCell]}>Week</Text>
        <View style={styles.chevronSpace} />
      </View>
      {fill ? (
        <ScrollView alwaysBounceVertical={false} nestedScrollEnabled style={styles.fillRows} testID="today-plan-recovery-rows">
          {rows}
        </ScrollView>
      ) : (
        rows
      )}
    </Card>
  );
}

function WeekDayCell({ day }: { day: PlanWeekDay }) {
  const state = day.trained ? 'trained' : day.planned ? 'planned' : 'nothing';
  const spoken = `${spokenDate(day.date)}${day.isToday ? ', today' : ''}: ${day.trained ? 'trained' : day.planned ? 'planned' : 'nothing'}`;
  return (
    <View accessibilityLabel={spoken} accessible style={[styles.weekDay, day.isToday ? styles.weekDayToday : null]} testID={`today-plan-week-day-${day.date.getDay()}`}>
      <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelFaint]}>
        {weekdayLetter(day.date)}
      </Text>
      <Text allowFontScaling={false} style={[styles.weekDate, day.isToday ? styles.weekDateToday : null]}>
        {day.date.getDate()}
      </Text>
      <View style={[styles.mark, markStyles[state]]} testID={`today-plan-week-day-${day.date.getDay()}-${state}`} />
    </View>
  );
}

const plannedDay = (session: NextPlannedSession, now: Date) =>
  localDateKey(session.scheduledFor) === localDateKey(now) ? 'Today' : weekdayShort(session.scheduledFor);

function PlannedRow({ session, now, onPress }: { session: NextPlannedSession; now: Date; onPress: () => void }) {
  const testID = `today-plan-next-${session.planId}`;
  const day = plannedDay(session, now);
  const time = formatClockTime(session.scheduledFor.getTime());
  const figures = `${session.exerciseCount} ex · ${targetSets(session.setCount)}`;
  const muscles = session.muscles.join(' · ');
  return (
    <Pressable
      accessibilityHint="Opens the plan"
      accessibilityLabel={[session.title, `${day === 'Today' ? 'today' : spokenDate(session.scheduledFor)} ${time}`,
        `${session.exerciseCount} ${session.exerciseCount === 1 ? 'exercise' : 'exercises'}`, targetSets(session.setCount), ...session.muscles].join(', ')}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.plannedRow, pressed ? styles.pressed : null]}
      testID={testID}>
      <View style={styles.plannedWhen}>
        <Text allowFontScaling={false} style={styles.plannedDay} testID={`${testID}-day`}>{day}</Text>
        <Text allowFontScaling={false} style={styles.plannedTime}>{time}</Text>
      </View>
      <View style={styles.plannedBody}>
        <View style={styles.plannedTop}>
          <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={styles.plannedTitle}>{session.title}</Text>
          <Text allowFontScaling={false} style={styles.plannedFigures} testID={`${testID}-figures`}>{figures}</Text>
        </View>
        {muscles ? (
          <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={styles.plannedMuscles} testID={`${testID}-muscles`}>
            {muscles}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

// This week's trained and planned days, then the next planned sessions.
function PlanWeekCard({ plan, now, onOpenPlan }: { plan: TodayPlan; now: Date; onOpenPlan: (planId: string) => void }) {
  return (
    <Card style={styles.card} testID="today-plan-week-card">
      <View style={styles.header}>
        <Text accessibilityRole="header" allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelStrong]}>
          Plan
        </Text>
      </View>
      <View style={styles.week}>
        {plan.week.map((day) => (
          <WeekDayCell day={day} key={day.date.getTime()} />
        ))}
      </View>
      {plan.next.length === 0 ? (
        <Text allowFontScaling={false} style={[todayText.mutedLine, styles.empty]} testID="today-plan-next-empty">
          Nothing planned this week.
        </Text>
      ) : (
        <View style={styles.planned}>
          {plan.next.map((session) => (
            <PlannedRow key={session.planId} now={now} onPress={() => onOpenPlan(session.planId)} session={session} />
          ))}
        </View>
      )}
    </Card>
  );
}

/** Today's Plan page: the recovery card over the week's plan. */
export function TodayPlanCards({ now, ...props }: TodayPlanCardsProps & { now: Date }) {
  return (
    <View style={[styles.stack, props.fill ? styles.fill : null]}>
      <RecoveryCard {...props} />
      <PlanWeekCard now={now} onOpenPlan={props.onOpenPlan} plan={props.plan} />
    </View>
  );
}

// The least trained rows that show in the cards layout before the rest scroll,
// leaving the plan card room below; a phone too short for both scrolls the page.
export const VISIBLE_MUSCLE_ROWS = 10;
const DAY_CELL = 30;
const DAY_CELL_HEIGHT = 22;
const WEEK_WIDTH = 56;
const ROW_HEIGHT = 32;
const MARK = 8;
const PLANNED_WHEN_WIDTH = 52;
const figure = { fontFamily: uiFonts.figure.family, fontWeight: '500' as const };

const markStyles = StyleSheet.create({
  trained: { backgroundColor: uiRoles.ink },
  planned: { borderWidth: 2, borderColor: uiRoles.accent },
  nothing: { backgroundColor: uiRoles.ruleSoft },
});

const styles = StyleSheet.create({
  stack: {
    gap: uiSpace.sm,
  },
  fill: {
    flex: 1,
    minHeight: 0,
  },
  fillCard: {
    flexShrink: 1,
    minHeight: 0,
  },
  // A fixed row height, so the rows that show are exactly `VISIBLE_MUSCLE_ROWS * ROW_HEIGHT`.
  fillRows: {
    flexShrink: 1,
    maxHeight: VISIBLE_MUSCLE_ROWS * ROW_HEIGHT,
  },
  card: {
    paddingHorizontal: uiSpace.md,
    paddingBottom: uiSpace.md,
  },
  // The title and the Progress link share one tap-height row.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: uiGeometry.tapTarget,
    marginRight: -uiSpace.sm,
  },
  columns: {
    paddingBottom: uiSpace.xs,
  },
  muscleRowLayout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  muscleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
    height: ROW_HEIGHT,
    borderTopWidth: 1,
    borderTopColor: uiRoles.ruleSoft,
  },
  pressed: {
    backgroundColor: uiRoles.paper,
  },
  muscleName: {
    flex: 1,
    minWidth: 0,
    fontFamily: uiFonts.body.family,
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  dayLabel: {
    width: DAY_CELL,
    textAlign: 'center',
  },
  dayCell: {
    width: DAY_CELL,
    height: DAY_CELL_HEIGHT,
    borderRadius: uiGeometry.radius.control,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCellRest: {
    backgroundColor: uiRoles.paper,
  },
  dayCellTrained: {
    backgroundColor: uiRoles.viz2,
  },
  dayCellFigure: {
    ...figure,
    fontWeight: '600',
    fontSize: uiTypography.size.sm,
    color: uiRoles.ink,
  },
  weekCell: {
    width: WEEK_WIDTH,
    textAlign: 'right',
  },
  weekFigure: {
    ...figure,
    fontWeight: '700',
    fontSize: uiTypography.size.base,
    color: uiRoles.inkMuted,
  },
  weekFigureMet: {
    color: uiRoles.ink,
  },
  weekTarget: {
    ...figure,
    fontSize: uiTypography.size.base,
    color: uiRoles.inkFaint,
  },
  chevronSpace: {
    width: 16,
  },
  week: {
    flexDirection: 'row',
    gap: uiSpace.xs,
  },
  weekDay: {
    flex: 1,
    alignItems: 'center',
    gap: uiSpace.xs,
    paddingVertical: uiSpace.xs,
    borderRadius: uiGeometry.radius.control,
  },
  weekDayToday: {
    backgroundColor: uiRoles.accentWash,
  },
  weekDate: {
    ...figure,
    fontWeight: '600',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.ink,
  },
  weekDateToday: {
    color: uiRoles.accent,
  },
  mark: {
    width: MARK,
    height: MARK,
    borderRadius: uiGeometry.radius.control,
  },
  empty: {
    paddingTop: uiSpace.md,
  },
  planned: {
    paddingTop: uiSpace.sm,
  },
  plannedRow: {
    flexDirection: 'row',
    gap: uiSpace.sm,
    paddingVertical: uiSpace.sm,
    borderTopWidth: 1,
    borderTopColor: uiRoles.ruleSoft,
  },
  plannedWhen: {
    width: PLANNED_WHEN_WIDTH,
  },
  plannedDay: {
    ...figure,
    fontWeight: '600',
    fontSize: uiTypography.size.md,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.ink,
  },
  plannedTime: {
    ...figure,
    fontSize: uiTypography.size.xs,
    lineHeight: uiTypography.lineHeight.xs,
    color: uiRoles.inkMuted,
  },
  plannedBody: {
    flex: 1,
    minWidth: 0,
  },
  plannedTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
  },
  plannedTitle: {
    flexShrink: 1,
    fontFamily: uiFonts.display.family,
    fontWeight: '700',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.ink,
  },
  plannedFigures: {
    ...figure,
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.inkMuted,
  },
  plannedMuscles: {
    fontFamily: uiFonts.body.family,
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
});

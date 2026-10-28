import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { Card } from '@/components/ui/card';
import { FigureText } from '@/components/ui/figure-text';
import { uiText, uiTextTone } from '@/components/ui/text-roles';
import { uiGeometry, uiRoles, uiSpace } from '@/components/ui/tokens';
import { localDateKey } from '@/src/utils/calendar-weeks';
import { localWeekWindow } from '@/src/utils/local-calendar';
import type { NextPlannedSession, PlanWeekDay, RecoveryRow, TodayPlan } from '@/src/today-plan';
import { formatClockTime, formatCompactDate } from '@/src/utils/local-time';

export type TodayPlanCardsProps = {
  plan: TodayPlan;
  /** Opens one muscle's progress history. */
  onOpenMuscle: (muscleGroupId: string) => void;
  onOpenProgress: () => void;
  onOpenPlan: (planId: string) => void;
  /** Opens Sessions, where sessions are planned and the plans listed. */
  onOpenSessions: () => void;
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const weekdayLetter = (date: Date) => WEEKDAYS[date.getDay()].charAt(0);
const weekdayShort = (date: Date) => WEEKDAYS[date.getDay()].slice(0, 3);
const spokenDate = (date: Date) => `${WEEKDAYS[date.getDay()]} ${formatCompactDate(date)}`;
const sets = (count: number) => `${count} ${count === 1 ? 'set' : 'sets'}`;
// A plan's rows are targets, never working sets ([[set.count-display]]).
const targetSets = (count: number) => `${count} ${count === 1 ? 'target set' : 'target sets'}`;
// The grid shows whole sets, rounded down, so a total reads at its target only
// when it is met; a lone secondary's half set shows as ½, never as 0.
// Spoken labels keep the exact half-steps ([[muscle.set-count]]).
export const wholeSets = (count: number) => (count > 0 && count < 1 ? '½' : String(Math.floor(count)));

// No sets that day reads as a rest day ([[copy.blank-history]]); none yet today, as none.
const recoveryRowLabel = (row: RecoveryRow, days: Date[]) =>
  [
    row.name,
    ...row.days.map((count, index) => `${spokenDate(days[index])}: ${count === null ? 'rest' : sets(count)}`),
    `today: ${row.today === null ? 'none yet' : sets(row.today)}`,
    `this week ${row.weekSets} of ${row.target} sets`,
  ].join(', ');

// A wider gutter only at the Monday boundary; the line stays centred in it.
function RecoveryDayColumn({ children, weekStart = false, heading = false }: { children: ReactNode; weekStart?: boolean; heading?: boolean }) {
  return (
    <View style={[styles.dayColumn, weekStart ? styles.weekStartColumn : null]}>
      {children}
      {weekStart ? (
        <View
          pointerEvents="none"
          style={[styles.weekDivider, heading ? styles.weekDividerHeading : null]}
          testID={heading ? 'today-plan-recovery-week-boundary' : undefined}
        />
      ) : null}
    </View>
  );
}

function DayCell({ count, weekStart, testID }: { count: number | null; weekStart: boolean; testID: string }) {
  return (
    <RecoveryDayColumn weekStart={weekStart}>
      <View style={[styles.dayCell, count === null ? styles.dayCellRest : styles.dayCellTrained]} testID={testID}>
        <Text allowFontScaling={false} style={[uiText.figureSmall, uiTextTone.ink]}>
          {count === null ? '' : wholeSets(count)}
        </Text>
      </View>
    </RecoveryDayColumn>
  );
}

function RecoveryMuscleRow({ row, days, weekStartIndex, onPress }: { row: RecoveryRow; days: Date[]; weekStartIndex: number; onPress: () => void }) {
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
      <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={[uiText.body, styles.nameCell]}>
        {row.name}
      </Text>
      {row.days.map((count, index) => (
        <DayCell count={count} key={days[index].getTime()} testID={`${testID}-day-${index}`} weekStart={index === weekStartIndex} />
      ))}
      <DayCell count={row.today} testID={`${testID}-today`} weekStart={days.length === weekStartIndex} />
      <Text allowFontScaling={false} style={[uiText.figure, styles.weekCell]} testID={`${testID}-week`}>
        <Text allowFontScaling={false} style={met ? uiTextTone.gain : uiTextTone.ink}>{wholeSets(row.weekSets)}</Text>
        <Text allowFontScaling={false} style={uiTextTone.muted}>{`/${row.target}`}</Text>
      </Text>
    </Pressable>
  );
}

// Each muscle's sets on the last three days, today so far, and this week
// against its weekly Target ([[muscle.weekly-targets]]), least trained first.
// A neutral gutter divides last week's days from this week's, only when both
// appear. Today has an accent label and border-free cells. At/above-target
// totals turn green; the numeric ratio also communicates whether it is met.
// The first rows show and the rest scroll, with no indicator over the targets.
function RecoveryCard({ plan, onOpenMuscle, onOpenProgress }: Omit<TodayPlanCardsProps, 'onOpenPlan' | 'onOpenSessions'>) {
  const label = [uiText.label, uiTextTone.faint];
  const weekStart = localWeekWindow(plan.today).start;
  const firstCurrentDay = [...plan.recoveryDays, plan.today].findIndex((day) => day >= weekStart);
  const weekStartIndex = firstCurrentDay > 0 ? firstCurrentDay : -1;
  const rows = plan.muscles.map((row) => (
    <RecoveryMuscleRow
      days={plan.recoveryDays}
      weekStartIndex={weekStartIndex}
      key={row.muscleGroupId}
      onPress={() => onOpenMuscle(row.muscleGroupId)}
      row={row}
    />
  ));
  return (
    <Card style={[styles.card, styles.fillCard]} testID="today-plan-recovery-card">
      <View style={styles.header}>
        <Text accessibilityRole="header" allowFontScaling={false} style={[uiText.label, uiTextTone.ink]}>
          Recovery
        </Text>
        <ActionButton label="Progress" onPress={onOpenProgress} testID="today-plan-progress-button" variant="link" />
      </View>
      <View style={[styles.columns, styles.muscleRowLayout]}>
        <Text allowFontScaling={false} style={[...label, styles.nameCell]}>Muscle</Text>
        {plan.recoveryDays.map((day, index) => (
          <RecoveryDayColumn heading key={day.getTime()} weekStart={index === weekStartIndex}>
            <Text allowFontScaling={false} style={[...label, styles.dayLabel]}>{weekdayLetter(day)}</Text>
          </RecoveryDayColumn>
        ))}
        <RecoveryDayColumn heading weekStart={plan.recoveryDays.length === weekStartIndex}>
          <Text allowFontScaling={false} style={[...label, styles.dayLabel, uiTextTone.accent]} testID="today-plan-recovery-today">
            {weekdayLetter(plan.today)}
          </Text>
        </RecoveryDayColumn>
        <Text allowFontScaling={false} style={[...label, styles.weekCell]}>Target</Text>
      </View>
      <ScrollView alwaysBounceVertical={false} nestedScrollEnabled showsVerticalScrollIndicator={false} style={styles.fillRows} testID="today-plan-recovery-rows">
        {rows}
      </ScrollView>
    </Card>
  );
}

function WeekDayCell({ day }: { day: PlanWeekDay }) {
  const state = day.trained ? 'trained' : day.planned ? 'planned' : 'nothing';
  const spoken = `${spokenDate(day.date)}${day.isToday ? ', today' : ''}: ${day.trained ? 'trained' : day.planned ? 'planned' : 'nothing'}`;
  return (
    <View accessibilityLabel={spoken} accessible style={[styles.weekDay, day.isToday ? styles.weekDayToday : null]} testID={`today-plan-week-day-${day.date.getDay()}`}>
      <Text allowFontScaling={false} style={[uiText.label, uiTextTone.faint]}>
        {weekdayLetter(day.date)}
      </Text>
      <Text allowFontScaling={false} style={[uiText.figure, day.isToday ? uiTextTone.accent : null]}>
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
        <Text allowFontScaling={false} style={uiText.bodyStrong} testID={`${testID}-day`}>{day}</Text>
        <Text allowFontScaling={false} style={uiText.figureSmall}>{time}</Text>
      </View>
      <View style={styles.plannedBody}>
        <View style={styles.plannedTop}>
          <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={[uiText.bodyStrong, styles.plannedTitle]}>{session.title}</Text>
          <Text allowFontScaling={false} style={uiText.meta} testID={`${testID}-figures`}><FigureText>{figures}</FigureText></Text>
        </View>
        {muscles ? (
          <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={uiText.meta} testID={`${testID}-muscles`}>
            {muscles}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

// This week's trained and planned days, then the next planned sessions; the
// Sessions link opens them all, where they are planned.
function PlanWeekCard({ plan, now, onOpenPlan, onOpenSessions }: {
  plan: TodayPlan;
  now: Date;
  onOpenPlan: (planId: string) => void;
  onOpenSessions: () => void;
}) {
  return (
    <Card style={styles.card} testID="today-plan-week-card">
      <View style={styles.header}>
        <Text accessibilityRole="header" allowFontScaling={false} style={[uiText.label, uiTextTone.ink]}>
          Plan
        </Text>
        <ActionButton label="Sessions" onPress={onOpenSessions} testID="today-plan-sessions-button" variant="link" />
      </View>
      <View style={styles.week}>
        {plan.week.map((day) => (
          <WeekDayCell day={day} key={day.date.getTime()} />
        ))}
      </View>
      {plan.next.length === 0 ? (
        <Text allowFontScaling={false} style={[uiText.meta, styles.empty]} testID="today-plan-next-empty">
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
    <View style={[styles.stack, styles.fill]}>
      <RecoveryCard {...props} />
      <PlanWeekCard now={now} onOpenPlan={props.onOpenPlan} onOpenSessions={props.onOpenSessions} plan={props.plan} />
    </View>
  );
}

// The least trained rows that show before the rest scroll,
// leaving the plan card room below; a phone too short for both scrolls the page.
export const VISIBLE_MUSCLE_ROWS = 10;
const DAY_CELL = 26;
const DAY_CELL_HEIGHT = 22;
const WEEK_WIDTH = 64;
const ROW_HEIGHT = 32;
const MARK = 8;
const PLANNED_WHEN_WIDTH = 52;

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
  // Gutters either side of the day grid keep it clear of the name and the target.
  nameCell: {
    flex: 1,
    minWidth: 0,
    marginRight: uiSpace.sm,
  },
  dayColumn: {
    width: DAY_CELL,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
  weekStartColumn: {
    marginLeft: uiSpace.sm,
  },
  weekDivider: {
    position: 'absolute',
    left: -(uiSpace.sm + uiSpace.xs) / 2,
    top: -1,
    bottom: 0,
    width: 1,
    backgroundColor: uiRoles.rule,
  },
  weekDividerHeading: {
    bottom: -uiSpace.xs,
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
  weekCell: {
    width: WEEK_WIDTH,
    marginLeft: uiSpace.md,
    textAlign: 'right',
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
  },
});

import { useDateFormat } from '@/src/preferences/hooks';
import type { ExerciseDateFormat } from '@/src/preferences/model';
import { useState, type ReactNode } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { Card } from '@/components/ui/card';
import { FigureText } from '@/components/ui/figure-text';
import { Icon } from '@/components/ui/icon';
import { uiTextEmphasis, useUiText, useUiTextTone } from '@/components/ui/text-roles';
import { makeStyles } from '@/components/ui/theme-context';
import { uiGeometry, uiIconSize, uiSpace } from '@/components/ui/tokens';
import { useAccountLocalPreferenceState } from '@/src/preferences/hooks';
import { formatWholeSetCount, formatWorkingSetCount } from '@/src/exercise-calculations/format';
import { localDateKey } from '@/src/utils/calendar-weeks';
import { localWeekWindow } from '@/src/utils/local-calendar';
import { groupRecoveryRows, type NextPlannedSession, type PlanWeekDay, type RecoveryRow, type RecoverySection, type TodayPlan } from '@/src/today-plan';
import { formatClockTime, formatShortDate } from '@/src/utils/local-time';

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
const spokenDate = (date: Date, dateFormat: ExerciseDateFormat) => `${WEEKDAYS[date.getDay()]} ${formatShortDate(date, dateFormat)}`;
const sets = (count: number) => {
  const figure = formatWorkingSetCount(count);
  return `${figure} ${figure === '1' ? 'set' : 'sets'}`;
};
// A plan's rows are targets, never working sets ([[set.count-display]]).
const targetSets = (count: number) => `${count} ${count === 1 ? 'target set' : 'target sets'}`;
// The grid shows whole sets ([[muscle.set-count]]); spoken labels keep one decimal.
export const wholeSets = formatWholeSetCount;

// No sets that day reads as a rest day ([[copy.blank-history]]); none yet today, as none.
const recoveryRowLabel = (row: RecoveryRow, days: Date[], dateFormat: ExerciseDateFormat) =>
  [
    row.name,
    ...row.days.map((count, index) => `${spokenDate(days[index], dateFormat)}: ${count === null ? 'rest' : sets(count)}`),
    `today: ${row.today === null ? 'none yet' : sets(row.today)}`,
    `this week ${formatWorkingSetCount(row.weekSets)} of ${row.target} sets`,
  ].join(', ');

const recoveryGroupLabel = (section: RecoverySection, days: Date[], dateFormat: ExerciseDateFormat) =>
  [
    `${section.name}, ${sets(section.weekSets)} this week`,
    ...section.days.map((count, index) => `${spokenDate(days[index], dateFormat)}: ${sets(count)}`),
    `today: ${sets(section.today)}`,
  ].join(', ');

// A wider gutter only at the Monday boundary; the line stays centred in it.
function RecoveryDayColumn({ children, weekStart = false, heading = false, edge }: {
  children: ReactNode; weekStart?: boolean; heading?: boolean; edge?: 'start' | 'end';
}) {
  const styles = useStyles();
  return (
    <View style={[styles.dayColumn, weekStart ? styles.weekStartColumn : null]}>
      {children}
      {edge ? <View pointerEvents="none" style={[styles.gridEdge, edge === 'start' ? styles.gridStart : styles.gridEnd]} /> : null}
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

function DayCell({ count, weekStart, testID, aggregate = false, edge }: {
  count: number | null; weekStart: boolean; testID: string; aggregate?: boolean; edge?: 'start' | 'end';
}) {
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  return (
    <RecoveryDayColumn edge={edge} weekStart={weekStart}>
      <View style={[styles.dayCell, aggregate ? (count ? styles.groupCellTrained : styles.groupCellZero)
        : count === null ? styles.dayCellRest : styles.dayCellTrained]} testID={testID}>
        <Text allowFontScaling={false} style={[text.figureSmall, tone.ink,
          aggregate ? [uiTextEmphasis.strong, count ? styles.groupFigureTrained : tone.accent] : null]}>
          {count === null ? '' : wholeSets(count)}
        </Text>
      </View>
    </RecoveryDayColumn>
  );
}

function RecoveryMuscleRow({ row, days, weekStartIndex, grouped, onPress }: {
  row: RecoveryRow; days: Date[]; weekStartIndex: number; grouped: boolean; onPress: () => void;
}) {
  const dateFormat = useDateFormat();
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  const testID = `today-plan-muscle-${row.muscleGroupId}`;
  const met = row.weekSets >= row.target;
  return (
    <Pressable
      accessibilityHint="Opens its progress"
      accessibilityLabel={recoveryRowLabel(row, days, dateFormat)}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.muscleRow}
      testID={testID}>
      <Text allowFontScaling={false} style={[text.body, styles.nameCell, grouped ? styles.childName : null]}>
        {row.name}
      </Text>
      {row.days.map((count, index) => (
        <DayCell count={count} edge={grouped && index === 0 ? 'start' : undefined} key={days[index].getTime()}
          testID={`${testID}-day-${index}`} weekStart={index === weekStartIndex} />
      ))}
      <DayCell count={row.today} edge={grouped ? 'end' : undefined} testID={`${testID}-today`} weekStart={days.length === weekStartIndex} />
      <Text allowFontScaling={false} style={[text.figure, styles.weekCell]} testID={`${testID}-week`}>
        <Text allowFontScaling={false} style={met ? tone.gain : tone.ink}>{wholeSets(row.weekSets)}</Text>
        <Text allowFontScaling={false} style={tone.muted}>{`/${row.target}`}</Text>
      </Text>
      {grouped ? <View style={styles.chevronGutter} /> : null}
    </Pressable>
  );
}

// A full-width header owns expansion, never child navigation. Collapsed children
// unmount, so neither touch nor accessibility can reach them. All start collapsed.
function RecoveryRows({ plan, weekStartIndex, grouped, onOpenMuscle }: {
  plan: TodayPlan; weekStartIndex: number; grouped: boolean; onOpenMuscle: TodayPlanCardsProps['onOpenMuscle'];
}) {
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  const dateFormat = useDateFormat();
  const [expandedGroups, setExpandedGroups] = useState<ReadonlySet<string>>(new Set());
  const renderRow = (row: RecoveryRow) => <RecoveryMuscleRow
    days={plan.recoveryDays} grouped={grouped} key={row.muscleGroupId}
    onPress={() => onOpenMuscle(row.muscleGroupId)} row={row} weekStartIndex={weekStartIndex} />;
  if (!grouped) return <>{plan.muscles.map(renderRow)}</>;
  return <>{groupRecoveryRows(plan.muscles).map(section => {
    const expanded = expandedGroups.has(section.name);
    const figure = wholeSets(section.weekSets);
    const testID = `today-plan-group-${section.name}`;
    return <View key={section.name}>
      <Pressable accessibilityRole="button" accessibilityLabel={recoveryGroupLabel(section, plan.recoveryDays, dateFormat)}
        accessibilityState={{ expanded }} testID={testID}
        onPress={() => setExpandedGroups(previous => {
          const next = new Set(previous);
          if (next.has(section.name)) next.delete(section.name);
          else next.add(section.name);
          return next;
        })}
        style={styles.groupHeader}>
        <Text allowFontScaling={false} style={[text.label, tone.ink, styles.nameCell]}>{section.name}</Text>
        {section.days.map((count, index) => <DayCell aggregate count={count} edge={index === 0 ? 'start' : undefined}
          key={plan.recoveryDays[index].getTime()} testID={`${testID}-day-${index}`} weekStart={index === weekStartIndex} />)}
        <DayCell aggregate count={section.today} edge="end" testID={`${testID}-today`} weekStart={plan.recoveryDays.length === weekStartIndex} />
        <Text allowFontScaling={false} style={styles.weekCell} testID={`${testID}-total`}>
          <Text allowFontScaling={false} style={text.figure}>{figure}</Text>
          <Text allowFontScaling={false} style={[text.body, tone.muted]}>{figure === '1' ? ' set' : ' sets'}</Text>
        </Text>
        <Icon name={expanded ? 'chevron-down' : 'chevron-right'} size="sm" testID={`${testID}-${expanded ? 'expanded' : 'collapsed'}`} />
      </Pressable>
      {expanded ? <View>
        <View pointerEvents="none" style={styles.childConnector} />
        {section.muscles.map(renderRow)}
      </View> : null}
    </View>;
  })}</>;
}

// Each muscle's sets on the last three days, today so far, and this week
// against its weekly Target ([[muscle.weekly-targets]]): under target first,
// then fewest this week.
// Settings' family grouping adds initially collapsed sections over the same
// reported muscles, preserving recovery order within each. Family tiles sum
// unrounded daily child contributions, including numeric zeros, and stay when
// collapsed; their trailing total remains weekly ([[muscle.set-count]]).
// A neutral gutter divides last week's days from this week's, only when both
// appear. Today has an accent label and border-free cells. At/above-target
// totals turn green; the numeric ratio also communicates whether it is met.
// The first rows show and the rest scroll, with no indicator over the targets.
function RecoveryCard({ plan, onOpenMuscle, onOpenProgress }: Omit<TodayPlanCardsProps, 'onOpenPlan' | 'onOpenSessions'>) {
  const { accountRevision, values: { progressGrouped: grouped } } = useAccountLocalPreferenceState();
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  const label = [text.label, tone.faint];
  const weekStart = localWeekWindow(plan.today).start;
  const firstCurrentDay = [...plan.recoveryDays, plan.today].findIndex((day) => day >= weekStart);
  const weekStartIndex = firstCurrentDay > 0 ? firstCurrentDay : -1;
  return (
    <Card style={[styles.card, styles.fillCard]} testID="today-plan-recovery-card">
      <View style={styles.header}>
        <Text accessibilityRole="header" allowFontScaling={false} style={[text.label, tone.ink]}>
          Recovery
        </Text>
        <ActionButton label="Progress" onPress={onOpenProgress} testID="today-plan-progress-button" variant="link" />
      </View>
      <View style={[styles.columns, styles.muscleRowLayout]}>
        <Text allowFontScaling={false} style={[...label, styles.nameCell]}>Muscle</Text>
        {plan.recoveryDays.map((day, index) => (
          <RecoveryDayColumn edge={grouped && index === 0 ? 'start' : undefined} heading key={day.getTime()} weekStart={index === weekStartIndex}>
            <Text allowFontScaling={false} style={[...label, styles.dayLabel]}>{weekdayLetter(day)}</Text>
          </RecoveryDayColumn>
        ))}
        <RecoveryDayColumn edge={grouped ? 'end' : undefined} heading weekStart={plan.recoveryDays.length === weekStartIndex}>
          <Text allowFontScaling={false} style={[...label, styles.dayLabel, tone.accent]} testID="today-plan-recovery-today">
            {weekdayLetter(plan.today)}
          </Text>
        </RecoveryDayColumn>
        <Text allowFontScaling={false} style={[...label, styles.weekCell]}>Target</Text>
        {grouped ? <View style={styles.chevronGutter} /> : null}
      </View>
      <ScrollView alwaysBounceVertical={false} contentContainerStyle={styles.rowsContent} nestedScrollEnabled
        showsVerticalScrollIndicator={false} style={styles.fillRows} testID="today-plan-recovery-rows">
        <RecoveryRows grouped={grouped} key={`${accountRevision}-${grouped}`} onOpenMuscle={onOpenMuscle}
          plan={plan} weekStartIndex={weekStartIndex} />
      </ScrollView>
    </Card>
  );
}

function WeekDayCell({ day }: { day: PlanWeekDay }) {
  const dateFormat = useDateFormat();
  const styles = useStyles();
  const markStyles = useMarkStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  const state = day.trained ? 'trained' : day.planned ? 'planned' : 'nothing';
  const spoken = `${spokenDate(day.date, dateFormat)}${day.isToday ? ', today' : ''}: ${day.trained ? 'trained' : day.planned ? 'planned' : 'nothing'}`;
  return (
    <View accessibilityLabel={spoken} accessible style={[styles.weekDay, day.isToday ? styles.weekDayToday : null]} testID={`today-plan-week-day-${day.date.getDay()}`}>
      <Text allowFontScaling={false} style={[text.label, tone.faint]}>
        {weekdayLetter(day.date)}
      </Text>
      <Text allowFontScaling={false} style={[text.figure, day.isToday ? tone.accent : null]}>
        {day.date.getDate()}
      </Text>
      <View style={[styles.mark, markStyles[state]]} testID={`today-plan-week-day-${day.date.getDay()}-${state}`} />
    </View>
  );
}

const plannedDay = (session: NextPlannedSession, now: Date) =>
  localDateKey(session.scheduledFor) === localDateKey(now) ? 'Today' : weekdayShort(session.scheduledFor);

function PlannedRow({ session, now, onPress }: { session: NextPlannedSession; now: Date; onPress: () => void }) {
  const dateFormat = useDateFormat();
  const styles = useStyles();
  const text = useUiText();
  const testID = `today-plan-next-${session.planId}`;
  const day = plannedDay(session, now);
  const time = formatClockTime(session.scheduledFor.getTime());
  const figures = `${session.exerciseCount} ex · ${targetSets(session.setCount)}`;
  const muscles = session.muscles.join(' · ');
  return (
    <Pressable
      accessibilityHint="Opens the plan"
      accessibilityLabel={[session.title, `${day === 'Today' ? 'today' : spokenDate(session.scheduledFor, dateFormat)} ${time}`,
        `${session.exerciseCount} ${session.exerciseCount === 1 ? 'exercise' : 'exercises'}`, targetSets(session.setCount), ...session.muscles].join(', ')}
      accessibilityRole="button"
      onPress={onPress}
      style={styles.plannedRow}
      testID={testID}>
      <View style={styles.plannedWhen}>
        <Text allowFontScaling={false} style={text.bodyStrong} testID={`${testID}-day`}>{day}</Text>
        <Text allowFontScaling={false} style={text.figureSmall}>{time}</Text>
      </View>
      <View style={styles.plannedBody}>
        <View style={styles.plannedTop}>
          <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={[text.bodyStrong, styles.plannedTitle]}>{session.title}</Text>
          <Text allowFontScaling={false} style={text.meta} testID={`${testID}-figures`}><FigureText>{figures}</FigureText></Text>
        </View>
        {muscles ? (
          <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={text.meta} testID={`${testID}-muscles`}>
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
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  return (
    <Card style={styles.card} testID="today-plan-week-card">
      <View style={styles.header}>
        <Text accessibilityRole="header" allowFontScaling={false} style={[text.label, tone.ink]}>
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
        <Text allowFontScaling={false} style={[text.meta, styles.empty]} testID="today-plan-next-empty">
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
  const styles = useStyles();
  return (
    <View style={[styles.stack, styles.fill]}>
      <RecoveryCard {...props} />
      <PlanWeekCard now={now} onOpenPlan={props.onOpenPlan} onOpenSessions={props.onOpenSessions} plan={props.plan} />
    </View>
  );
}

// The first rows (under target, fewest this week) that show before the rest scroll,
// leaving the plan card room below; a phone too short for both scrolls the page.
export const VISIBLE_MUSCLE_ROWS = 10;
const DAY_CELL = 26;
const DAY_CELL_HEIGHT = 22;
const WEEK_WIDTH = 64;
const ROW_HEIGHT = 32;
const MARK = 8;
const PLANNED_WHEN_WIDTH = 52;
const GROUP_BLEED = uiSpace.sm;

const useMarkStyles = makeStyles((roles) => ({
  trained: { backgroundColor: roles.ink },
  planned: { borderWidth: 2, borderColor: roles.accent },
  nothing: { backgroundColor: roles.ruleSoft },
}));

const useStyles = makeStyles((roles) => ({
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
  // The scroller reaches into the card's side padding, so a group header's wash
  // can too (a clipped scroller would cut it); the rows' own width is unchanged.
  fillRows: {
    flexShrink: 1,
    maxHeight: VISIBLE_MUSCLE_ROWS * ROW_HEIGHT,
    marginHorizontal: -GROUP_BLEED,
  },
  rowsContent: { paddingHorizontal: GROUP_BLEED },
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
  // Rows take no pressed fill: a tap goes straight to its destination.
  muscleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
    minHeight: ROW_HEIGHT,
    borderTopWidth: 1,
    borderTopColor: roles.ruleSoft,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
    minHeight: ROW_HEIGHT,
    // The wash insets its name and chevron from its edges without moving a column;
    // the band itself separates the groups, so no hairline.
    marginHorizontal: -GROUP_BLEED,
    paddingHorizontal: GROUP_BLEED,
    borderRadius: uiGeometry.radius.card,
    backgroundColor: roles.accentWash,
  },
  childName: { paddingLeft: uiSpace.md },
  childConnector: {
    position: 'absolute',
    left: 0,
    top: uiSpace.xs,
    bottom: uiSpace.xs,
    width: 2,
    backgroundColor: roles.accent,
    borderRadius: uiGeometry.radius.control,
  },
  chevronGutter: { width: uiIconSize.sm },
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
  gridEdge: {
    position: 'absolute',
    top: -1,
    bottom: -1,
    width: 1,
    backgroundColor: roles.ruleSoft,
  },
  gridStart: { left: -uiSpace.xs / 2 },
  gridEnd: { right: -uiSpace.md / 2 },
  weekDivider: {
    position: 'absolute',
    left: -(uiSpace.sm + uiSpace.xs) / 2,
    top: -1,
    bottom: 0,
    width: 1,
    backgroundColor: roles.rule,
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
    backgroundColor: roles.paper,
  },
  dayCellTrained: {
    backgroundColor: roles.viz2,
  },
  groupCellTrained: {
    backgroundColor: roles.accent,
  },
  groupCellZero: {
    backgroundColor: roles.surface,
    borderWidth: 1,
    borderColor: roles.accent,
  },
  groupFigureTrained: { color: roles.onAccent },
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
    backgroundColor: roles.accentWash,
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
    borderTopColor: roles.ruleSoft,
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
}));

import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { Card } from '@/components/ui/card';
import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { formatOneRepMax } from '@/src/exercise-calculations/format';
import type { LatestSessionSummary, SessionExerciseLine } from '@/src/progress-summary';
import { formatClockTime, formatCompactDate } from '@/src/utils/local-time';

import { formatBestSet, todaySessionAccessibilityLabel } from './progress-format';
import { StepAround } from './step-arrows';
import { todayText } from './text-styles';

export type TodaySessionCardProps = {
  session: LatestSessionSummary;
  /** How many completed sessions are newer than `session`: 0 is the latest. */
  offset: number;
  hasOlderSession: boolean;
  onOpenSession: (sessionId: string) => void;
  onOpenSessions: () => void;
  /** Shows the completed session this many places before the latest. */
  onShowSession?: (offset: number) => void;
  /** The cards layout: four exercises show, more scroll inside the card. */
  fill?: boolean;
};

// Four exercise rows show in the cards layout before the rows scroll; on a
// phone too short for them the card gives way first, scrolling sooner, so the
// progress card's chart keeps its floor.
export const VISIBLE_EXERCISE_ROWS = 4;
const ROW_HEIGHT = 32;

function ExerciseRow({ line, index }: { line: SessionExerciseLine; index: number }) {
  const testID = `today-latest-session-exercise-${index}`;
  return (
    <View style={[styles.row, styles.exerciseRow]} testID={testID}>
      <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={styles.name}>
        {line.name}
      </Text>
      <Text allowFontScaling={false} style={[styles.figure, styles.sets, styles.muted]} testID={`${testID}-sets`}>
        {line.workingSets}
      </Text>
      {/* No working set: the best-set cells stay blank ([[copy.blank-history]]). */}
      <Text allowFontScaling={false} style={[styles.figure, styles.best]} testID={`${testID}-best`}>
        {line.bestSet ? formatBestSet(line.bestSet) : ''}
      </Text>
      <Text
        allowFontScaling={false}
        style={[styles.figure, styles.oneRepMax, line.oneRepMaxRecord ? styles.record : null]}
        testID={`${testID}-1rm`}>
        {line.bestSet ? formatOneRepMax(line.bestSet.oneRepMaxKg) : ''}
      </Text>
    </View>
  );
}

function SummaryLine({ session }: { session: LatestSessionSummary }) {
  const gym = session.gymName?.trim();
  const prs = session.records.length;
  return (
    <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={styles.summary} testID="today-latest-session-figures">
      <Text allowFontScaling={false} style={styles.summaryFigure}>{session.exerciseCount}</Text>
      {session.exerciseCount === 1 ? ' exercise' : ' exercises'}
      <Text allowFontScaling={false} style={styles.separator}> · </Text>
      <Text allowFontScaling={false} style={styles.summaryFigure}>{session.workingSets}</Text>
      {session.workingSets === 1 ? ' set' : ' sets'}
      <Text allowFontScaling={false} style={styles.separator}> · </Text>
      <Text allowFontScaling={false} style={prs > 0 ? styles.recordLabel : null} testID="today-latest-session-prs">
        <Text allowFontScaling={false} style={styles.summaryFigure}>{prs}</Text>
        {prs === 1 ? ' PR' : ' PRs'}
      </Text>
      {gym ? (
        <>
          <Text allowFontScaling={false} style={styles.separator}> @ </Text>
          <Text allowFontScaling={false} style={styles.gym}>{gym}</Text>
        </>
      ) : null}
    </Text>
  );
}

// Exercise, sets, best set, 1RM; in the cards layout the rows past four scroll.
function ExerciseTable({ lines, fill }: { lines: SessionExerciseLine[]; fill: boolean }) {
  if (lines.length === 0) return null;
  const rows = lines.map((line, index) => <ExerciseRow index={index} key={`${index}:${line.name}`} line={line} />);
  const label = [todayText.microLabel, todayText.microLabelFaint];
  return (
    <View style={fill ? styles.fillTable : null}>
      <View style={[styles.row, styles.tableHeader]}>
        <Text allowFontScaling={false} style={[...label, styles.nameCell]}>Exercise</Text>
        <Text allowFontScaling={false} style={[...label, styles.sets]}>Sets</Text>
        <Text allowFontScaling={false} style={[...label, styles.best]}>Best set</Text>
        <Text allowFontScaling={false} style={[...label, styles.oneRepMax]}>1RM</Text>
      </View>
      {fill ? (
        <ScrollView alwaysBounceVertical={false} nestedScrollEnabled style={styles.fillRows} testID="today-latest-session-rows">
          {rows}
        </ScrollView>
      ) : (
        rows
      )}
    </View>
  );
}

/**
 * Today's session card: the session's start between the arrows that step
 * through completed sessions, the Sessions link, then a summary line and one
 * row per exercise (working sets, best set, its 1RM; a 1RM PR in `record`).
 * The summary and rows open the session.
 */
export function TodaySessionCard({
  session,
  offset,
  hasOlderSession,
  onOpenSession,
  onOpenSessions,
  onShowSession,
  fill = false,
}: TodaySessionCardProps) {
  const stamp = (
    <Text allowFontScaling={false} numberOfLines={1} style={styles.stamp} testID="today-latest-session-start">
      {formatCompactDate(session.startedAt)}
      <Text allowFontScaling={false} style={styles.time}>{` ${formatClockTime(session.startedAt.getTime())}`}</Text>
    </Text>
  );
  return (
    <Card style={[styles.card, fill ? styles.fillCard : null]} testID="today-session-card">
      <View style={styles.header}>
        {onShowSession ? (
          <StepAround
            noun="session"
            onNewer={offset > 0 ? () => onShowSession(offset - 1) : null}
            onOlder={hasOlderSession ? () => onShowSession(offset + 1) : null}
            testID="today-latest-session-step">
            {stamp}
          </StepAround>
        ) : (
          stamp
        )}
        <ActionButton label="Sessions" onPress={onOpenSessions} testID="today-sessions-button" variant="text" />
      </View>
      <Pressable
        accessibilityHint="Opens the completed session"
        accessibilityLabel={todaySessionAccessibilityLabel(session)}
        accessibilityRole="button"
        onPress={() => onOpenSession(session.id)}
        style={({ pressed }) => [styles.body, fill ? styles.fillBody : null, pressed ? styles.pressed : null]}
        testID="today-latest-session">
        <SummaryLine session={session} />
        <ExerciseTable fill={fill} lines={session.exercises} />
      </Pressable>
    </Card>
  );
}

const figure = { fontFamily: uiFonts.figure.family, fontWeight: '500' as const };

const styles = StyleSheet.create({
  // Three sections, a clear step apart: the stepped start, the summary, the exercises.
  card: {
    paddingHorizontal: uiSpace.md,
    paddingBottom: uiSpace.md,
    gap: uiSpace.sm,
  },
  fillCard: {
    flexShrink: 1,
    minHeight: 0,
  },
  // The stepped start and the Sessions link share one tap-height row.
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: uiSpace.sm,
    marginLeft: -uiSpace.sm,
    marginRight: -uiSpace.sm,
  },
  stamp: {
    ...figure,
    fontWeight: '600',
    fontSize: uiTypography.size.lg,
    lineHeight: uiTypography.lineHeight.lg,
    color: uiRoles.ink,
  },
  time: {
    fontWeight: '500',
    color: uiRoles.inkMuted,
  },
  body: {
    gap: uiSpace.lg,
  },
  fillBody: {
    flexShrink: 1,
  },
  pressed: {
    opacity: 0.7,
  },
  summary: {
    fontFamily: uiFonts.body.family,
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  summaryFigure: figure,
  separator: {
    color: uiRoles.inkFaint,
  },
  gym: {
    fontWeight: '600',
  },
  recordLabel: {
    color: uiRoles.record,
  },
  nameCell: {
    flex: 1,
    minWidth: 0,
  },
  fillTable: {
    flexShrink: 1,
  },
  fillRows: {
    flexShrink: 1,
    maxHeight: VISIBLE_EXERCISE_ROWS * ROW_HEIGHT,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
  },
  tableHeader: {
    paddingBottom: uiSpace.xs,
  },
  // A fixed height, so four rows are exactly `VISIBLE_EXERCISE_ROWS * ROW_HEIGHT`.
  exerciseRow: {
    height: ROW_HEIGHT,
    borderTopWidth: 1,
    borderTopColor: uiRoles.ruleSoft,
  },
  name: {
    flex: 1,
    minWidth: 0,
    fontFamily: uiFonts.body.family,
    fontSize: uiTypography.size.base,
    color: uiRoles.ink,
  },
  figure: {
    ...figure,
    fontSize: uiTypography.size.md,
    color: uiRoles.ink,
  },
  muted: {
    color: uiRoles.inkMuted,
  },
  record: {
    fontWeight: '700',
    color: uiRoles.record,
  },
  sets: {
    width: 32,
    textAlign: 'right',
  },
  best: {
    width: 80,
    textAlign: 'right',
  },
  oneRepMax: {
    width: 48,
    textAlign: 'right',
  },
});

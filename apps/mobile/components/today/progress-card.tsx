import { Pressable, StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { Card } from '@/components/ui/card';
import { Icon } from '@/components/ui/icon';
import { uiFonts, uiGeometry, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { LatestSessionSummary, TodayProgress } from '@/src/progress-summary';
import { formatMonthDayTime } from '@/src/utils/local-time';

import { MonthPace } from './month-pace';
import {
  formatLatestDuration,
  formatLatestFigures,
  formatPrCount,
  latestSessionAccessibilityLabel,
} from './progress-format';
import { todayText } from './text-styles';
import { WeekFigures } from './week-figures';

type ReadyProgress = Extract<TodayProgress, { status: 'ready' }>;

export type TodayProgressCardProps = {
  progress: ReadyProgress;
  onOpenSessions: () => void;
  onOpenSession: (sessionId: string) => void;
};

// The most recent completed session as one link row. No in-progress state:
// an active workout is reached from Train.
function LatestSessionRow({ latest, onPress }: { latest: LatestSessionSummary; onPress: () => void }) {
  const gym = latest.gymName?.trim();
  return (
    <Pressable
      accessibilityHint="Opens the completed session"
      accessibilityLabel={latestSessionAccessibilityLabel(latest)}
      accessibilityRole="button"
      onPress={onPress}
      style={({ pressed }) => [styles.latestRow, pressed ? styles.pressed : null]}
      testID="today-latest-session">
      <View style={styles.latestCopy}>
        <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={styles.summaryLine}>
          <Text allowFontScaling={false} style={styles.summaryFigure} testID="today-latest-session-start">
            {formatMonthDayTime(latest.startedAt.getTime())}
          </Text>
          <Text allowFontScaling={false} style={styles.separator}> · </Text>
          <Text allowFontScaling={false} style={styles.summaryFigure}>{formatLatestDuration(latest)}</Text>
          {gym ? (
            <>
              <Text allowFontScaling={false} style={styles.separator}> @ </Text>
              <Text allowFontScaling={false} style={styles.gym}>{gym}</Text>
            </>
          ) : null}
        </Text>
        <Text allowFontScaling={false} style={todayText.detailFigure} testID="today-latest-session-figures">
          {formatLatestFigures(latest)}
        </Text>
        {latest.exerciseNames.length > 0 ? (
          <Text
            allowFontScaling={false}
            ellipsizeMode="tail"
            numberOfLines={1}
            style={todayText.mutedLine}
            testID="today-latest-session-exercises">
            {latest.exerciseNames.join(', ')}
          </Text>
        ) : null}
        {latest.prs > 0 ? (
          <View style={styles.prRow} testID="today-latest-session-prs">
            <Icon color={uiRoles.record} name="arrow-up" size="xs" />
            <Text allowFontScaling={false} style={[todayText.record, styles.prText]}>
              {formatPrCount(latest.prs)}
            </Text>
          </View>
        ) : null}
      </View>
      <Icon color={uiRoles.inkFaint} name="chevron-right" size="sm" />
    </Pressable>
  );
}

// Today's Progress card (`design-targets/today-landing.md`): this week against
// last week, the month against the previous month's pace, the latest session.
export function TodayProgressCard({ progress, onOpenSessions, onOpenSession }: TodayProgressCardProps) {
  return (
    <Card style={styles.card} testID="today-progress-card">
      <WeekFigures week={progress.week} />
      <View style={styles.divider} />
      <MonthPace month={progress.month} />
      <View style={styles.divider} />
      <View style={styles.latestHeading}>
        <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelStrong]}>
          Latest session
        </Text>
        <ActionButton label="All sessions" onPress={onOpenSessions} testID="today-all-sessions-button" variant="text" />
      </View>
      <LatestSessionRow latest={progress.latest} onPress={() => onOpenSession(progress.latest.id)} />
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: uiSpace.md,
    gap: uiSpace.md,
  },
  // A `rule-soft` hairline across the card, edge to edge.
  divider: {
    height: 1,
    marginHorizontal: -uiSpace.md,
    backgroundColor: uiRoles.ruleSoft,
  },
  // The text button's tap target is taller than the label; pull it into the
  // card's rhythm as the target does.
  latestHeading: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginVertical: -uiSpace.sm,
  },
  latestRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.md,
    minHeight: uiGeometry.tapTarget,
  },
  // A pressed row takes the `paper` ground, as `ListRow` does.
  pressed: {
    backgroundColor: uiRoles.paper,
  },
  latestCopy: {
    flex: 1,
    minWidth: 0,
    gap: uiSpace.xs,
  },
  summaryLine: {
    fontFamily: uiFonts.body.family,
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.base,
    color: uiRoles.ink,
  },
  summaryFigure: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
  },
  separator: {
    color: uiRoles.inkFaint,
  },
  gym: {
    fontWeight: '600',
  },
  prRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.xs,
  },
  prText: {
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
  },
});

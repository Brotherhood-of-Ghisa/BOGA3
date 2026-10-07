import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { Card } from '@/components/ui/card';
import { uiRoles, uiSpace } from '@/components/ui/tokens';
import type { LatestSessionSummary, TodayProgress } from '@/src/progress-summary';
import { formatMonthDayTime } from '@/src/utils/local-time';

import { MonthPace } from './month-pace';
import {
  formatLatestDuration,
  formatLatestFigures,
  latestRecordLine,
  latestSessionAccessibilityLabel,
} from './progress-format';
import { SessionSummaryRow } from './session-summary-row';
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
  return (
    <SessionSummaryRow
      accessibilityHint="Opens the completed session"
      accessibilityLabel={latestSessionAccessibilityLabel(latest)}
      duration={formatLatestDuration(latest)}
      figures={formatLatestFigures(latest)}
      gym={latest.gymName}
      onPress={onPress}
      record={latestRecordLine(latest)}
      stamp={formatMonthDayTime(latest.startedAt.getTime())}
      testID="today-latest-session"
    />
  );
}

// Today's Progress card: this week against last week, the month against the
// previous month's pace, the latest session.
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
});

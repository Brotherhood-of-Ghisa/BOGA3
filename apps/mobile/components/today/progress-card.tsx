import { StyleSheet, Text, View } from 'react-native';

import { ActionButton } from '@/components/ui/action-button';
import { Card } from '@/components/ui/card';
import { uiRoles, uiSpace } from '@/components/ui/tokens';
import { useExerciseListPreferences } from '@/src/exercise-catalog/list-preferences';
import type { ExerciseDateFormat } from '@/src/preferences/model';
import type { LatestSessionSummary, TodayProgress } from '@/src/progress-summary';
import { formatMonthDayTime } from '@/src/utils/local-time';

import { PeriodPace } from './period-pace';
import {
  formatSessionSummaryDuration,
  formatSessionSummaryFigures,
  sessionSummaryRecordLine,
  sessionSummaryAccessibilityLabel,
} from './progress-format';
import { SessionSummaryRow } from './session-summary-row';
import { todayText } from './text-styles';
import { WeekFigures } from './week-figures';

type ReadyProgress = Extract<TodayProgress, { status: 'ready' }>;

export type TodayProgressCardProps = {
  progress: ReadyProgress;
  onOpenSessions: () => void;
  onOpenSession: (sessionId: string) => void;
  dateFormat?: ExerciseDateFormat;
  /** The cards layout: no card of its own (the page is one), the chart taking the height left. */
  fill?: boolean;
};

// The most recent completed session as one link row. No in-progress state:
// an active workout is reached from Train.
function LatestSessionRow({
  latest,
  dateFormat,
  onPress,
}: {
  latest: LatestSessionSummary;
  dateFormat: ExerciseDateFormat;
  onPress: () => void;
}) {
  return (
    <SessionSummaryRow
      accessibilityHint="Opens the completed session"
      accessibilityLabel={sessionSummaryAccessibilityLabel(latest, dateFormat)}
      duration={formatSessionSummaryDuration(latest)}
      figures={formatSessionSummaryFigures(latest)}
      gym={latest.gymName}
      onPress={onPress}
      record={sessionSummaryRecordLine(latest)}
      stamp={formatMonthDayTime(latest.startedAt.getTime(), dateFormat)}
      testID="today-latest-session"
    />
  );
}

// Today's Progress card: this week against last week, the period against the
// previous period day by day, the latest session.
export function TodayProgressCard({ progress, onOpenSessions, onOpenSession, dateFormat, fill = false }: TodayProgressCardProps) {
  const [listPreferences] = useExerciseListPreferences();
  const resolvedDateFormat = dateFormat ?? listPreferences.dateFormat;
  const body = (
    <>
      <WeekFigures week={progress.week} />
      <View style={styles.divider} />
      <PeriodPace fill={fill} period={progress.period} />
      <View style={styles.divider} />
      <View style={styles.latestHeading}>
        <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelStrong]}>
          Latest session
        </Text>
        <ActionButton label="All sessions" onPress={onOpenSessions} testID="today-all-sessions-button" variant="text" />
      </View>
      <LatestSessionRow
        dateFormat={resolvedDateFormat}
        latest={progress.latest}
        onPress={() => onOpenSession(progress.latest.id)}
      />
    </>
  );
  if (fill) {
    return (
      <View style={[styles.card, styles.fill]} testID="today-progress-card">
        {body}
      </View>
    );
  }
  return (
    <Card style={styles.card} testID="today-progress-card">
      {body}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    padding: uiSpace.md,
    gap: uiSpace.md,
  },
  fill: {
    flex: 1,
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

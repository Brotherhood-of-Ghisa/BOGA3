import { StyleSheet, View } from 'react-native';

import { Card } from '@/components/ui/card';
import { uiRoles, uiSpace } from '@/components/ui/tokens';
import type { TodayProgress } from '@/src/progress-summary';

import { PeriodPace } from './period-pace';
import { TodaySessionCard } from './session-card';
import { WeekFigures } from './week-figures';

type ReadyProgress = Extract<TodayProgress, { status: 'ready' }>;

export type TodayProgressCardProps = {
  progress: ReadyProgress;
  onOpenSession: (sessionId: string) => void;
  onOpenSessions: () => void;
  /** Compares the period against the one this many periods back. */
  onShowCompared?: (periodsBack: number) => void;
  /** Shows the completed session this many places before the latest. */
  onShowSession?: (offset: number) => void;
};

// Today's You page: the progress card (this week against last week, the
// period against the previous period, or an earlier one, day by day) over
// the session card (the latest session, or an earlier one stepped back to).
// The progress card takes the height the session card leaves, the chart filling it.
export function TodayProgressCard({
  progress,
  onOpenSession,
  onOpenSessions,
  onShowCompared,
  onShowSession,
}: TodayProgressCardProps) {
  return (
    <View style={[styles.stack, styles.fill]}>
      <Card style={[styles.card, styles.fillProgress]} testID="today-progress-card">
        <WeekFigures week={progress.week} />
        <View style={styles.divider} />
        <PeriodPace onShowCompared={onShowCompared} period={progress.period} />
      </Card>
      <TodaySessionCard
        hasOlderSession={progress.hasOlderSession}
        offset={progress.latestOffset}
        onOpenSession={onOpenSession}
        onOpenSessions={onOpenSessions}
        onShowSession={onShowSession}
        session={progress.latest}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  stack: {
    gap: uiSpace.sm,
  },
  card: {
    padding: uiSpace.md,
    gap: uiSpace.md,
  },
  fill: {
    flex: 1,
    minHeight: 0,
  },
  // Its own height (the chart at its floor) never shrinks; it grows into what the session card leaves.
  fillProgress: {
    flexGrow: 1,
    flexShrink: 0,
  },
  // A `rule-soft` hairline across the card, edge to edge.
  divider: {
    height: 1,
    marginHorizontal: -uiSpace.md,
    backgroundColor: uiRoles.ruleSoft,
  },
});

import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FigureText, ScreenScroll, ToggleChip, uiSpace, useUiText } from '@/components/ui';
import { useDateFormat } from '@/src/preferences/hooks';
import { formatCalendarWeekHeading, formatCompactDate } from '@/src/utils/local-time';
import { formatVolume, formatWholeSetCount } from '@/src/exercise-calculations/format';
import { addFiniteVolume } from '@/src/exercise-calculations/analytics';

import { MUSCLE_HISTORY_METRIC_OPTIONS, type MuscleHistoryMetric } from './history-view';
import type { HistorySubject } from './use-history';
import { WeekSetList, type WeekSetExerciseLink } from './week-set-list';
import { usePeriodSets, type SetPeriod } from './week-sets';

// The day/week drill-down reuses Timeline's exercise cards. Each card opens
// its full session; its progress action opens the exercise. Only the selected
// metric's contributing sets appear, under the inherited muscle/gym/role scope.
export function MusclePeriodDetail({ subject, period, metric, onSelectMetric, filters, onOpenSession,
  exerciseLink, accountRevision, revision, lookbackWeeks }: {
  subject: Extract<HistorySubject, { kind: 'muscle' }>;
  period: SetPeriod;
  metric: MuscleHistoryMetric;
  onSelectMetric: (metric: MuscleHistoryMetric) => void;
  filters: ReactNode;
  onOpenSession: (sessionId: string) => void;
  exerciseLink?: WeekSetExerciseLink;
  accountRevision: number;
  revision: number;
  lookbackWeeks: number;
}) {
  const text = useUiText();
  const dateFormat = useDateFormat();
  const [refresh, setRefresh] = useState(0);
  const visited = useRef(false);
  useFocusEffect(useCallback(() => {
    if (visited.current) setRefresh(value => value + 1);
    visited.current = true;
  }, []));
  const sets = usePeriodSets({ muscleGroupIds: [subject.id], gymId: subject.gymId,
    countSecondary: subject.countSecondary, countSecondaryVolume: subject.countSecondaryVolume, metric },
  period, refresh + revision, accountRevision, lookbackWeeks);
  // A focus refresh must not shrink the scroll content before Back settles.
  const groups = sets.sameScope ? sets.groups : [];
  const volume = groups.reduce<number | null>((sum, group) => addFiniteVolume(sum, group.contribution ? group.contribution.volume : 0), 0);
  const count = groups.reduce((sum, group) => sum + (group.contribution?.sets ?? 0), 0);
  const value = metric === 'totalVolume' ? volume === null ? '—' : formatVolume(volume) : formatWholeSetCount(count);
  const label = metric === 'totalVolume' ? 'Volume' : value === '1' ? 'Set' : 'Sets';
  const heading = period.dayKey ? formatCompactDate(new Date(`${period.dayKey}T12:00:00`), dateFormat)
    : formatCalendarWeekHeading(period.weekKey, dateFormat);
  return <View style={styles.body} testID="muscle-period-detail">
    <View style={styles.controls}>
      <ToggleChip accessibilityLabel="Effort metric" onChange={onSelectMetric} options={MUSCLE_HISTORY_METRIC_OPTIONS}
        testID="muscle-period-detail-metric" value={metric} />
      {filters}
    </View>
    <ScreenScroll testID="muscle-period-detail-scroll">
      <View style={styles.heading}>
        <Text allowFontScaling={false} accessibilityRole="header" style={[text.title, styles.date]} testID="muscle-period-detail-date">
          <FigureText strong>{heading}</FigureText>
        </Text>
        {!sets.loading && !sets.error ? <View style={styles.total} accessibilityLabel={`${value} ${label}`} testID="muscle-period-detail-total">
          <Text allowFontScaling={false} style={text.figure}>{value}</Text>
          <Text allowFontScaling={false} style={text.label}>{label}</Text>
        </View> : null}
      </View>
      <WeekSetList {...sets} groups={groups} contributionMetric={metric} exerciseLink={exerciseLink}
        onOpenSession={onOpenSession} onRetry={() => setRefresh(value => value + 1)} period={period.dayKey ? 'day' : 'week'}
        testID="muscle-period-detail-sets" />
    </ScreenScroll>
  </View>;
}

const styles = StyleSheet.create({
  body: { flex: 1 },
  controls: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm,
    paddingHorizontal: uiSpace.lg, paddingVertical: uiSpace.md },
  heading: { flexDirection: 'row', alignItems: 'baseline', gap: uiSpace.md, paddingBottom: uiSpace.md },
  date: { flex: 1 },
  total: { flexDirection: 'row', alignItems: 'baseline', gap: uiSpace.xs },
});

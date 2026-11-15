import { useFocusEffect } from 'expo-router';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FigureText, ScreenScroll, ToggleChip, uiSpace, useUiText } from '@/components/ui';
import { useDateFormat } from '@/src/preferences/hooks';
import { formatCalendarWeekHeading, formatCompactDate } from '@/src/utils/local-time';
import { formatVolume, formatWholeSetCount } from '@/src/exercise-calculations/format';
import { addFiniteVolume } from '@/src/exercise-calculations/analytics';

import type { CalendarHeatmapMetric } from '@/src/data';
import { EXERCISE_HISTORY_METRIC_OPTIONS, MUSCLE_HISTORY_METRIC_OPTIONS } from './history-view';
import type { HistorySubject } from './use-history';
import { WeekSetList, type WeekSetExerciseLink } from './week-set-list';
import { usePeriodSets, type SetPeriod } from './week-sets';

// The day/week drill-down reuses Timeline's exercise cards. Each card opens
// its workout; its progress action opens the exercise. Muscle detail limits rows
// to metric contributors; exercise detail keeps every performed set at the gym.
export function HistoryPeriodDetail({ subject, period, metric, onSelectMetric, filters, onOpenSession,
  exerciseLink, accountRevision, revision, lookbackWeeks }: {
  subject: HistorySubject;
  period: SetPeriod;
  metric: CalendarHeatmapMetric;
  onSelectMetric: (metric: CalendarHeatmapMetric) => void;
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
  const muscleMetric = metric === 'totalVolume' ? 'totalVolume' as const : 'workingSetCount' as const;
  const target = subject.kind === 'muscle'
    ? { muscleGroupIds: [subject.id], gymId: subject.gymId, countSecondary: subject.countSecondary,
      countSecondaryVolume: subject.countSecondaryVolume, metric: muscleMetric }
    : { exerciseDefinitionId: subject.id, gymId: subject.gymId };
  const sets = usePeriodSets({ ...target, includeInProgress: true },
  period, refresh + revision, accountRevision, lookbackWeeks);
  // A focus refresh must not shrink the scroll content before Back settles.
  const groups = sets.sameScope ? sets.groups : [];
  const volume = groups.reduce<number | null>((sum, group) => addFiniteVolume(sum, group.contribution ? group.contribution.volume : 0), 0);
  const count = groups.reduce((sum, group) => sum + (group.contribution?.sets ?? 0), 0);
  const value = metric === 'totalVolume' ? volume === null ? '—' : formatVolume(volume) : formatWholeSetCount(count);
  const label = metric === 'totalVolume' ? 'Volume' : value === '1' ? 'Set' : 'Sets';
  const heading = period.dayKey ? formatCompactDate(new Date(`${period.dayKey}T12:00:00`), dateFormat)
    : formatCalendarWeekHeading(period.weekKey, dateFormat);
  const testID = `${subject.kind}-period-detail`;
  return <View style={styles.body} testID={testID}>
    <View style={styles.controls}>
      <ToggleChip accessibilityLabel="Effort metric" onChange={onSelectMetric}
        options={subject.kind === 'muscle' ? MUSCLE_HISTORY_METRIC_OPTIONS : EXERCISE_HISTORY_METRIC_OPTIONS}
        testID={`${testID}-metric`} value={metric} />
      {filters}
    </View>
    <ScreenScroll testID={`${testID}-scroll`}>
      <View style={styles.heading}>
        <Text allowFontScaling={false} accessibilityRole="header" style={[text.title, styles.date]} testID={`${testID}-date`}>
          <FigureText strong>{heading}</FigureText>
        </Text>
        {subject.kind === 'muscle' && !sets.loading && !sets.error ? <View style={styles.total} accessibilityLabel={`${value} ${label}`} testID={`${testID}-total`}>
          <Text allowFontScaling={false} style={text.figure}>{value}</Text>
          <Text allowFontScaling={false} style={text.label}>{label}</Text>
        </View> : null}
      </View>
      <WeekSetList {...sets} groups={groups} contributionMetric={subject.kind === 'muscle' ? muscleMetric : undefined} exerciseLink={exerciseLink}
        onOpenSession={onOpenSession} onRetry={() => setRefresh(value => value + 1)} period={period.dayKey ? 'day' : 'week'}
        testID={`${testID}-sets`} />
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

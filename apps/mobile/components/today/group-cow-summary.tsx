import { useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Card, CompactHeader, FigureText, Icon, IconButton, makeStyles, uiGeometry, uiSpace, useUiText } from '@/components/ui';
import { CoWRows } from '@/components/groups/cow-preview';
import { GroupInlineError, GroupMissingDataState, pickInlineError } from '@/components/groups/group-state-view';
import { GroupOfflineBanner } from '@/components/groups/offline-banner';
import { coWAccessibleDates, coWDateRange, coWStatus } from '@/src/groups/cow-presentation';
import type { CoWMetric } from '@/src/groups/cow-scoring';
import type { CoWRankingWire, CoWResultWire, CoWSummaryWire } from '@/src/groups/cow-wire';
import { useCoWSummary } from '@/src/groups/use-cow-summary';
import type { GroupResourceState } from '@/src/groups/use-group-resource';
import { coWsHref } from '@/src/navigation/routes';
import { useDateFormat } from '@/src/preferences/hooks';
import type { ExerciseDateFormat } from '@/src/preferences/model';

/** Today ranks by 1RM; a CoW without it shows its first metric. */
export const todayCoWRanking = (result: CoWResultWire): CoWRankingWire | undefined =>
  result.rankings.find(ranking => ranking.metric === 'e1rm') ?? result.rankings.find(ranking => ranking.metric === result.cow.metrics[0]);

type CardProps = {
  resource: GroupResourceState<CoWSummaryWire>;
  /** Shows last week's CoW; the title and testIDs follow. */
  previous: boolean;
  dateFormat: ExerciseDateFormat;
  userId: string;
  /** Present while the other week can be shown: `‹` steps to last week, `›` back to this one. */
  onEarlier?: () => void;
  onLater?: () => void;
  onOpen: (result: CoWResultWire, metric: CoWMetric) => void;
  onRetry: () => void;
};

function WeekStepper({ label, accessibilityLabel, onEarlier, onLater, testID }: {
  label: string; accessibilityLabel: string; onEarlier?: () => void; onLater?: () => void; testID: string;
}) {
  const styles = useStyles();
  const text = useUiText();
  return <View style={styles.stepper}>
    <IconButton accessibilityLabel="Last week's CoW" disabled={!onEarlier} name="chevron-left" onPress={() => onEarlier?.()}
      testID={`${testID}-earlier`} tone="muted" />
    <Text allowFontScaling={false} numberOfLines={1} accessibilityLabel={accessibilityLabel} style={text.meta} testID={`${testID}-dates`}>
      <FigureText>{label}</FigureText>
    </Text>
    <IconButton accessibilityLabel="This week's CoW" disabled={!onLater} name="chevron-right" onPress={() => onLater?.()}
      testID={`${testID}-later`} tone="muted" />
  </View>;
}

/**
 * One CoW in its own card: the title and week between `‹ ›`, the exercise
 * (opening that CoW), then its 1RM podium as the summary carries it — server
 * places and figures only, never a runner-up promoted over a redacted rank one.
 */
export function TodayCoWCard({ resource, previous, dateFormat, userId, onEarlier, onLater, onOpen, onRetry }: CardProps) {
  const styles = useStyles();
  const text = useUiText();
  const { data, offline, error, lastUpdatedAtMs } = resource;
  const prefix = previous ? 'today-cow-previous' : 'today-cow-current';
  const result = data?.result ?? null;
  const title = previous || data?.selection === 'previous_final' ? 'Last Week CoW' : 'Current CoW';
  const inlineError = pickInlineError(error);
  const ranking = result ? todayCoWRanking(result) : undefined;
  const status = result ? (previous ? 'Last week · Final' : coWStatus(result.cow, result.state)) : null;
  // Confirmed absence takes no space.
  if (data && !result) return null;
  return <Card testID="today-cow-card">
    <View style={styles.content} testID={prefix}>
      {offline && result ? <GroupOfflineBanner lastUpdatedAtMs={lastUpdatedAtMs} /> : null}
      {inlineError && result ? <GroupInlineError error={inlineError} onRetry={onRetry} testID={`${prefix}-error`} /> : null}
      <View style={styles.heading}>
        <View style={styles.title}><CompactHeader label={title} accessibilityRole="header" /></View>
        <WeekStepper label={result ? coWDateRange(result.cow.week_start, dateFormat, true) : '—'}
          accessibilityLabel={result ? coWAccessibleDates(result.cow.week_start, dateFormat) : 'Dates unavailable'}
          onEarlier={onEarlier} onLater={onLater} testID="today-cow-week" />
      </View>
      {result ? <>
        <Pressable accessibilityRole="button" accessibilityHint="Opens this challenge in the group"
          accessibilityLabel={`${title}, ${result.exercise?.name ?? 'Exercise unavailable'}, ${coWAccessibleDates(result.cow.week_start, dateFormat)}, ${status}`}
          onPress={() => onOpen(result, ranking?.metric ?? result.cow.metrics[0])} style={styles.open} testID={`${prefix}-open`}>
          <Text allowFontScaling={false} numberOfLines={1} ellipsizeMode="tail" style={[text.bodyStrong, styles.name]}
            testID={`${prefix}-exercise`}>{result.exercise?.name ?? 'Exercise unavailable'}</Text>
          <Text allowFontScaling={false} style={text.meta}>{status}</Text>
          <Icon name="chevron-right" colorRole="inkMuted" size="sm" />
        </Pressable>
        {result.state === 'ready' && ranking ? <CoWRows ranking={ranking} userId={userId} testID={`${prefix}-rows`} />
          : <Text allowFontScaling={false} style={text.meta} testID={`${prefix}-state`}>
            {result.state === 'unavailable' ? 'Group comparisons unavailable' : result.state === 'ready' ? 'Unavailable' : coWStatus(result.cow, result.state)}
          </Text>}
      </> : <GroupMissingDataState error={inlineError} offline={offline} onRetry={onRetry} testIDPrefix={prefix} />}
    </View>
  </Card>;
}

/**
 * Today's CoW card: this week's CoW, and last week's behind `‹`. Each week is
 * its own cached summary read; last week's shows only while both reads agree
 * on the week and calendar. Confirmed absence in both weeks takes no space.
 */
export function TodayCoWSummaries({ groupId, userId }: { groupId: string; userId: string }) {
  const router = useRouter();
  const dateFormat = useDateFormat();
  const current = useCoWSummary(groupId, userId);
  const previous = useCoWSummary(groupId, userId, true);
  const [picked, setPicked] = useState<'current' | 'previous'>('current');
  const refreshCurrent = current.refresh;
  const refreshPrevious = previous.refresh;
  const retry = useCallback(() => { void Promise.all([refreshCurrent(), refreshPrevious()]); }, [refreshCurrent, refreshPrevious]);
  const mismatch = current.data && previous.data && (current.data.week_start !== previous.data.week_start ||
    current.data.calendar_revision !== previous.data.calendar_revision);
  useEffect(() => { if (mismatch) retry(); }, [mismatch, retry]);
  if (current.lostAccess || previous.lostAccess) return null;
  const currentNone = current.data?.selection === 'none';
  const previousNone = previous.data?.selection === 'none';
  if (currentNone && previousNone) return null;
  // A current read that is itself last week's final (a legacy fallback) has no other week to step to.
  const steps = current.data?.selection !== 'previous_final' && !previousNone;
  const showPrevious = steps && (picked === 'previous' || currentNone);
  const open = (result: CoWResultWire, metric: CoWMetric) => router.push(coWsHref(groupId, result.cow.cow_id, metric));
  return showPrevious
    ? <TodayCoWCard resource={{ ...previous, data: !mismatch ? previous.data : null }} previous dateFormat={dateFormat} userId={userId}
      onLater={currentNone ? undefined : () => setPicked('current')} onOpen={open} onRetry={retry} />
    : <TodayCoWCard resource={current} previous={false} dateFormat={dateFormat} userId={userId}
      onEarlier={steps ? () => setPicked('previous') : undefined} onOpen={open} onRetry={retry} />;
}

const useStyles = makeStyles(() => ({
  content: { paddingHorizontal: uiSpace.md, paddingVertical: uiSpace.sm, gap: uiSpace.xs },
  heading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: uiSpace.sm },
  title: { flexShrink: 1 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 0 },
  open: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm, minHeight: uiGeometry.tapTarget },
  name: { flex: 1, minWidth: 0 },
}));

import { useRouter } from 'expo-router';
import { useCallback, useEffect } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { FigureText, Icon, ListRow, uiBorder, uiRoles, uiSpace, uiText } from '@/components/ui';
import { GroupInlineError, GroupMissingDataState, pickInlineError } from '@/components/groups/group-state-view';
import { GroupOfflineBanner } from '@/components/groups/offline-banner';
import { formatBoardMemberLabel } from '@/src/groups/board-view-model';
import { COW_METRIC_LABELS, coWAccessibleDates, coWDateRange, coWStatus } from '@/src/groups/cow-presentation';
import type { CoWResultWire, CoWSummaryWire } from '@/src/groups/cow-wire';
import { useCoWSummary } from '@/src/groups/use-cow-summary';
import type { GroupResourceState } from '@/src/groups/use-group-resource';
import { coWsHref } from '@/src/navigation/routes';
import { useDateFormat } from '@/src/preferences/hooks';
import type { ExerciseDateFormat } from '@/src/preferences/model';

/** Rank-one identity survives figure redaction; never promote a visible runner-up. */
function WinnerRows({ result }: { result: CoWResultWire }) {
  if (result.cow.state !== 'final' || result.state !== 'ready') {
    return <Text allowFontScaling={false} style={uiText.meta}>{coWStatus(result.cow, result.state)}</Text>;
  }
  return result.cow.metrics.map(metric => {
    const ranking = result.rankings.find(row => row.metric === metric);
    const winner = ranking?.entries.find(row => row.rank === 1);
    const name = winner ? formatBoardMemberLabel(winner.member, winner.former, null)
      : !ranking ? 'Unavailable' : 'No qualifying results';
    const suffix = `[${COW_METRIC_LABELS[metric]}]`;
    return <View key={metric} accessible accessibilityLabel={`${name} ${suffix}`} style={styles.winner}
      testID={`today-cow-winner-${metric}`}>
      <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={[uiText.body, styles.name]}
        testID={`today-cow-winner-${metric}-name`}>{name}</Text>
      <Text allowFontScaling={false} numberOfLines={1} style={[uiText.body, styles.metric]}><FigureText>{suffix}</FigureText></Text>
    </View>;
  });
}

type SectionProps = {
  resource: GroupResourceState<CoWSummaryWire>;
  previous: boolean;
  dateFormat: ExerciseDateFormat;
  onOpen: (result: CoWResultWire) => void;
  onRetry: () => void;
};

function CoWSummarySection({ resource, previous, dateFormat, onOpen, onRetry }: SectionProps) {
  const { data, offline, error, lastUpdatedAtMs } = resource;
  const prefix = previous ? 'today-cow-previous' : 'today-cow-current';
  const result = data?.result;
  if (data && (!result || !previous && data.selection !== 'current')) return null;
  const title = previous ? 'Last Week CoW' : 'Current CoW';
  const exercise = result?.exercise?.name ?? 'Exercise unavailable';
  const metrics = result?.cow.metrics.map(metric => COW_METRIC_LABELS[metric]).join(' · ');
  const inlineError = pickInlineError(error);
  const label = result ? `${title}, ${exercise}, ${metrics}, ${coWAccessibleDates(result.cow.week_start, dateFormat)}` : title;
  return <>
    {offline && result ? <GroupOfflineBanner lastUpdatedAtMs={lastUpdatedAtMs} /> : null}
    {inlineError && result ? <GroupInlineError error={inlineError} onRetry={onRetry} testID={`${prefix}-error`} /> : null}
    <ListRow density="list" divider accessibilityLabel={!previous ? label : undefined}
    accessibilityHint={!previous && result ? 'Opens this challenge in the group' : undefined}
    onPress={!previous && result ? () => onOpen(result) : undefined}
    trailing={!previous && result ? <Icon name="chevron-right" color={uiRoles.inkMuted} size="sm" /> : undefined}
    testID={prefix}>
    <View style={styles.content}>
      <Text allowFontScaling={false} accessibilityRole="header" style={uiText.title}>{title}</Text>
      {result ? <>
        <Text allowFontScaling={false} style={uiText.figureSmall}>{coWDateRange(result.cow.week_start, dateFormat, true)}</Text>
        <Text allowFontScaling={false} numberOfLines={1} ellipsizeMode="tail" style={uiText.bodyStrong}
          accessibilityLabel={exercise} testID={`${prefix}-exercise`}>{exercise}</Text>
        {previous ? <WinnerRows result={result} /> : <Text allowFontScaling={false} style={uiText.body}>
          <FigureText>{metrics ?? ''}</FigureText>
        </Text>}
      </> : <GroupMissingDataState error={inlineError} offline={offline} onRetry={onRetry} testIDPrefix={prefix} />}
    </View>
    </ListRow>
  </>;
}

/** Today's compact summaries sit above its unchanged weekly board, inside the same card. */
export function TodayCoWSummaries({ groupId, userId }: { groupId: string; userId: string }) {
  const router = useRouter();
  const dateFormat = useDateFormat();
  const current = useCoWSummary(groupId, userId);
  const previous = useCoWSummary(groupId, userId, true);
  const refreshCurrent = current.refresh;
  const refreshPrevious = previous.refresh;
  const retry = useCallback(() => { void Promise.all([refreshCurrent(), refreshPrevious()]); }, [refreshCurrent, refreshPrevious]);
  const mismatch = current.data && previous.data && (current.data.week_start !== previous.data.week_start ||
    current.data.calendar_revision !== previous.data.calendar_revision);
  useEffect(() => { if (mismatch) retry(); }, [mismatch, retry]);
  if (current.lostAccess || previous.lostAccess) return null;
  if (current.data?.selection === 'none' && previous.data?.selection === 'none') return null;
  const open = (result: CoWResultWire) => router.push(coWsHref(groupId, result.cow.cow_id, result.cow.metrics[0]));
  return <View style={styles.sections} testID="today-cow-summaries">
    <CoWSummarySection resource={current} previous={false} dateFormat={dateFormat} onOpen={open} onRetry={retry} />
    <CoWSummarySection resource={{ ...previous, data: !mismatch ? previous.data : null }}
      previous dateFormat={dateFormat} onOpen={open} onRetry={retry} />
  </View>;
}

const styles = StyleSheet.create({
  sections: { borderBottomWidth: uiBorder.width, borderBottomColor: uiRoles.ruleSoft },
  content: { gap: uiSpace.sm, paddingVertical: uiSpace.sm },
  winner: { flexDirection: 'row', alignItems: 'baseline', gap: uiSpace.xs, maxWidth: '100%' },
  name: { flexShrink: 1, minWidth: 0 },
  metric: { flexShrink: 0 },
});

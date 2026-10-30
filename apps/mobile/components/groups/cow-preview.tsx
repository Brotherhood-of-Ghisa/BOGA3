import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card, FigureText, Icon, ListRow, SegmentedControl, uiBorder, uiGeometry, uiRoles, uiSpace, uiText, uiTextEmphasis, uiTextTone } from '@/components/ui';
import type { ExerciseDateFormat } from '@/src/preferences/model';
import type { CoWMetric } from '@/src/groups/cow-scoring';
import type { CoWRankingWire, CoWResultWire } from '@/src/groups/cow-wire';
import { formatBoardMemberLabel } from '@/src/groups/board-view-model';
import { COW_METRIC_LABELS, coWAccessibleDates, coWDateRange, coWFigure, coWMetric, coWMetricHeading, coWStatus } from '@/src/groups/cow-presentation';

export function CoWMetricTabs({ metrics, metric, onChange, testID }: {
  metrics: CoWMetric[]; metric: CoWMetric; onChange: (metric: CoWMetric) => void; testID: string;
}) {
  return <SegmentedControl options={metrics.map(value => ({ value, label: COW_METRIC_LABELS[value] }))}
    value={metric} onChange={onChange} accessibilityLabel="CoW leaderboard" testIDPrefix={`${testID}-metric`} layout="fit" density="compact" />;
}

/** Server places and figures only: no viewer substitution, reranking or eligibility guesses. */
export function CoWRows({ ranking, userId, testID }: { ranking: CoWRankingWire; userId: string; testID: string }) {
  return <View testID={testID}>
    <Text allowFontScaling={false} style={[uiText.label, styles.column]}>{coWMetricHeading(ranking)}</Text>
    {ranking.entries.map(row => <View key={row.member.user_id} style={styles.row} testID={`${testID}-${row.member.user_id}`}>
      <Text allowFontScaling={false} style={[uiText.figure, uiTextTone.muted, styles.rank]}>{row.rank ?? ''}</Text>
      <Text allowFontScaling={false} numberOfLines={2} style={[uiText.body, styles.name, row.member.user_id === userId ? uiTextEmphasis.strong : null]}>
        {formatBoardMemberLabel(row.member, row.former, userId)}
      </Text>
      <Text allowFontScaling={false} style={[uiText.figure, styles.figure]}>
        {row.state === 'unranked' ? 'Not ranked' : row.value === null ? 'Unavailable' : coWFigure(row.value, ranking.metric)}
      </Text>
    </View>)}
    {ranking.entries.length === 0 ? <Text allowFontScaling={false} style={[uiText.meta, styles.empty]}>No qualifying results</Text> : null}
  </View>;
}

export function CoWResultHeading({ result, dateFormat, today = false, previous = false }: {
  result: CoWResultWire; dateFormat: ExerciseDateFormat; today?: boolean; previous?: boolean;
}) {
  return <View style={styles.heading}>
    <View style={styles.headingRow}>
      <Text allowFontScaling={false} style={uiText.title}>CoW</Text>
      <Text allowFontScaling={false} style={[uiText.figureSmall, styles.date]} accessibilityLabel={coWAccessibleDates(result.cow.week_start, dateFormat)}>
        <FigureText>{coWDateRange(result.cow.week_start, dateFormat, today)}</FigureText>
      </Text>
    </View>
    {!today ? <Text allowFontScaling={false} style={[uiText.meta, styles.zone]}>{result.cow.time_zone}</Text> : null}
    <View style={styles.headingRow}>
      <Text allowFontScaling={false} style={[uiText.title, styles.name]}>{result.exercise?.name ?? 'Exercise unavailable'}</Text>
      <Text allowFontScaling={false} style={[uiText.bodyStrong, uiTextTone.muted]}>{previous ? 'Last week · Final' : coWStatus(result.cow, result.state)}</Text>
    </View>
  </View>;
}

/** One preview is reused by Today, group management and the chronological browser. */
export function CoWPreview({ result, userId, dateFormat, today, previous, initialMetric, onOpen, onBrowse, browseLabel = 'View CoWs', testID }: {
  result: CoWResultWire; userId: string; dateFormat: ExerciseDateFormat; today?: boolean; previous?: boolean;
  browseLabel?: string; initialMetric?: string | null; onOpen: (metric: CoWMetric) => void; onBrowse?: (metric: CoWMetric) => void; testID: string;
}) {
  const [picked, setPicked] = useState<CoWMetric>(() => coWMetric(initialMetric, result.cow.metrics));
  const metric = coWMetric(picked, result.cow.metrics);
  const ranking = result.rankings.find(row => row.metric === metric);
  return <Card testID={testID}>
    <View style={styles.content}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${result.exercise?.name ?? 'CoW'}, ${COW_METRIC_LABELS[metric]}, ${coWAccessibleDates(result.cow.week_start, dateFormat)}, ${previous ? 'Last week · Final' : coWStatus(result.cow, result.state)}`}
        onPress={() => onOpen(metric)} testID={`${testID}-open`} style={styles.open}>
        <View style={styles.name}><CoWResultHeading result={result} dateFormat={dateFormat} today={today} previous={previous} /></View>
        <Icon name="chevron-right" color={uiRoles.inkMuted} size="sm" />
      </Pressable>
      <CoWMetricTabs metrics={result.cow.metrics} metric={metric} onChange={setPicked} testID={testID} />
      {result.state === 'ready' ? <CoWPodium rankings={result.rankings} metric={metric} userId={userId} testID={testID} />
        : <Text allowFontScaling={false} style={[uiText.meta, styles.empty]} testID={`${testID}-state`}>
          {result.state === 'unavailable' ? 'Group comparisons unavailable' : coWStatus(result.cow, result.state)}
        </Text>}
    </View>
    {onBrowse && (browseLabel !== 'Full standings' || result.state === 'ready' && ranking && ranking.entries.length > 0) ? <ListRow label={browseLabel} density="list" divider onPress={() => onBrowse(metric)}
      testID={`${testID}-browse`} trailing={<Icon name="chevron-right" size="sm" color={uiRoles.inkMuted} />} /> : null}
  </Card>;
}

/** Measure every enabled panel so metric switches retain the tallest real content. */
function CoWPodium({ rankings, metric, userId, testID }: { rankings: CoWRankingWire[]; metric: CoWMetric; userId: string; testID: string }) {
  const [height, setHeight] = useState(0);
  return <View style={{ minHeight: height }} testID={`${testID}-podium`}>
    {rankings.map(ranking => {
      const selected = ranking.metric === metric;
      return <View key={ranking.metric} style={selected ? undefined : styles.hiddenPodium}
        pointerEvents={selected ? 'auto' : 'none'} accessibilityElementsHidden={!selected} importantForAccessibility={selected ? 'auto' : 'no-hide-descendants'}
        onLayout={event => { const measured = event.nativeEvent.layout.height; setHeight(previous => Math.max(previous, measured)); }} testID={`${testID}-podium-${ranking.metric}`}>
        <CoWRows ranking={ranking} userId={userId} testID={selected ? `${testID}-rows` : `${testID}-hidden-${ranking.metric}`} />
      </View>;
    })}
  </View>;
}

const styles = StyleSheet.create({
  hiddenPodium: { position: 'absolute', top: 0, left: 0, right: 0, opacity: 0 },
  content: { padding: uiSpace.md, gap: uiSpace.md },
  open: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm, minHeight: uiGeometry.tapTarget },
  heading: { gap: uiSpace.sm }, headingRow: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.md, justifyContent: 'space-between', flexWrap: 'wrap' },
  date: { flexShrink: 1 }, zone: { textAlign: 'right' },
  row: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', minHeight: uiGeometry.tapTarget, gap: uiSpace.sm, borderTopColor: uiRoles.ruleSoft, borderTopWidth: uiBorder.width, paddingVertical: uiSpace.sm },
  rank: { minWidth: uiSpace.lg }, name: { flex: 1 }, figure: { textAlign: 'right', flexShrink: 0 },
  column: { textAlign: 'right', paddingVertical: uiSpace.sm }, empty: { paddingVertical: uiSpace.md },
});

import { StyleSheet, Text, View } from 'react-native';

import { todayText } from '@/components/today/text-styles';
import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import type { GroupHomeMetric } from '@/src/groups/home-mock';
import { GROUP_HOME_METRIC_COLUMN, type GroupRankEntry } from '@/src/groups/home-view-model';

function HeadCell({ label, width }: { label: string; width: number }) {
  return (
    <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelFaint, styles.figure, { width }]}>
      {label}
    </Text>
  );
}

function Row({ entry, metric, showMetric }: { entry: GroupRankEntry; metric: GroupHomeMetric; showMetric: boolean }) {
  const testID = `group-rank-table-row-${entry.userId}`;
  return (
    <View
      accessible
      accessibilityLabel={`${entry.rank}, ${entry.name}, ${entry.valueLabel}, ${entry.volumeLabel} kg·reps`}
      style={[styles.row, entry.isMe ? styles.rowMine : null]}
      testID={testID}>
      <Text allowFontScaling={false} style={styles.rank}>
        {entry.rank}
      </Text>
      <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={[styles.name, entry.isMe ? styles.nameMine : null]}>
        {entry.name}
      </Text>
      {showMetric ? (
        <Text allowFontScaling={false} style={[styles.figure, styles.value, { width: METRIC_WIDTH }]} testID={`${testID}-value`}>
          {entry.valueLabel}
        </Text>
      ) : null}
      <Text allowFontScaling={false} style={[styles.figure, styles.value, { width: VOLUME_WIDTH }]} testID={`${testID}-volume`}>
        {entry.volumeLabel}
      </Text>
    </View>
  );
}

/** The selected period's full ranking: place, member, the metric, the volume. */
export function GroupRankTable({ entries, metric }: { entries: GroupRankEntry[]; metric: GroupHomeMetric }) {
  // Volume is always the last column, so it is not also the metric column.
  const showMetric = metric !== 'volume';
  return (
    <View style={styles.table} testID="group-rank-table">
      <View style={styles.head}>
        <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelFaint, styles.headSpacer]}>
          Place
        </Text>
        {showMetric ? <HeadCell label={GROUP_HOME_METRIC_COLUMN[metric]} width={METRIC_WIDTH} /> : null}
        <HeadCell label="Vol" width={VOLUME_WIDTH} />
      </View>
      {entries.map((entry) => (
        <Row entry={entry} key={entry.userId} metric={metric} showMetric={showMetric} />
      ))}
    </View>
  );
}

const RANK_WIDTH = 18;
const METRIC_WIDTH = 44;
const VOLUME_WIDTH = 62;

const styles = StyleSheet.create({
  table: {
    gap: uiSpace.xs,
  },
  head: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: uiSpace.sm,
  },
  headSpacer: {
    flex: 1,
    minWidth: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: uiSpace.sm,
    paddingVertical: uiSpace.xs,
    marginHorizontal: -uiSpace.md,
    paddingHorizontal: uiSpace.md,
  },
  rowMine: {
    backgroundColor: uiRoles.paper,
  },
  rank: {
    width: RANK_WIDTH,
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.inkMuted,
  },
  name: {
    flex: 1,
    minWidth: 0,
    fontFamily: uiFonts.body.family,
    fontWeight: '400',
    fontSize: uiTypography.size.base,
    lineHeight: uiTypography.lineHeight.md,
    color: uiRoles.ink,
  },
  nameMine: {
    fontWeight: '600',
  },
  figure: {
    textAlign: 'right',
  },
  value: {
    fontFamily: uiFonts.figure.family,
    fontWeight: '500',
    fontSize: uiTypography.size.sm,
    lineHeight: uiTypography.lineHeight.sm,
    color: uiRoles.ink,
  },
});

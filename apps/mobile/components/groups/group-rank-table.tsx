import { StyleSheet, Text, View } from 'react-native';

import { todayText } from '@/components/today/text-styles';
import { uiFonts, uiRoles, uiSpace, uiTypography } from '@/components/ui/tokens';
import { GROUP_HOME_METRIC_COLUMN, type GroupRankEntry } from '@/src/groups/home-view-model';

function HeadCell({ label }: { label: string }) {
  return (
    <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelFaint, styles.figure, { width: FIGURE_WIDTH }]}>
      {label}
    </Text>
  );
}

function Figure({ label, testID }: { label: string; testID: string }) {
  return (
    <Text allowFontScaling={false} style={[styles.figure, styles.value, { width: FIGURE_WIDTH }]} testID={testID}>
      {label}
    </Text>
  );
}

function Row({ entry }: { entry: GroupRankEntry }) {
  const testID = `group-rank-table-row-${entry.userId}`;
  return (
    <View
      accessible
      accessibilityLabel={`${entry.rank}, ${entry.name}, ${entry.setsLabel} working sets, ${entry.prsLabel} group records`}
      style={[styles.row, entry.isMe ? styles.rowMine : null]}
      testID={testID}>
      <Text allowFontScaling={false} style={styles.rank}>
        {entry.rank}
      </Text>
      <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={[styles.name, entry.isMe ? styles.nameMine : null]}>
        {entry.name}
      </Text>
      <Figure label={entry.setsLabel} testID={`${testID}-sets`} />
      <Figure label={entry.prsLabel} testID={`${testID}-prs`} />
    </View>
  );
}

/** The selected period's full ranking: place, member, then both figures. */
export function GroupRankTable({ entries }: { entries: GroupRankEntry[] }) {
  return (
    <View style={styles.table} testID="group-rank-table">
      <View style={styles.head}>
        <Text allowFontScaling={false} style={[todayText.microLabel, todayText.microLabelFaint, styles.headSpacer]}>
          Place
        </Text>
        <HeadCell label={GROUP_HOME_METRIC_COLUMN.sets} />
        <HeadCell label={GROUP_HOME_METRIC_COLUMN.prs} />
      </View>
      {entries.map((entry) => (
        <Row entry={entry} key={entry.userId} />
      ))}
    </View>
  );
}

const RANK_WIDTH = 18;
const FIGURE_WIDTH = 44;

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

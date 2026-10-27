import { StyleSheet, Text, View } from 'react-native';

import { uiText, uiTextEmphasis, uiTextTone } from '@/components/ui/text-roles';
import { uiRoles, uiSpace } from '@/components/ui/tokens';
import { GROUP_HOME_METRIC_COLUMN, type GroupRankEntry } from '@/src/groups/home-view-model';

function HeadCell({ label }: { label: string }) {
  return (
    <Text allowFontScaling={false} style={[uiText.label, uiTextTone.faint, styles.figure, { width: FIGURE_WIDTH }]}>
      {label}
    </Text>
  );
}

function Figure({ label, testID }: { label: string; testID: string }) {
  return (
    <Text allowFontScaling={false} style={[uiText.figureSmall, uiTextTone.ink, styles.figure, { width: FIGURE_WIDTH }]} testID={testID}>
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
      <Text allowFontScaling={false} style={[uiText.figureSmall, styles.rank]}>
        {entry.rank}
      </Text>
      <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1} style={[uiText.body, entry.isMe ? uiTextEmphasis.strong : null, styles.name]}>
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
        <Text allowFontScaling={false} style={[uiText.label, uiTextTone.faint, styles.headSpacer]}>
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
  },
  name: {
    flex: 1,
    minWidth: 0,
  },
  figure: {
    textAlign: 'right',
  },
});

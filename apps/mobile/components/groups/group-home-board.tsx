import { Text, View } from 'react-native';
import { FigureText, ListCard, ListCardHeader, ListRow, makeStyles, uiGeometry, uiSpace, useTextRoles } from '@/components/ui';
import { statsTableColumnWidth } from '@/components/stats/stats-table';
import { GROUP_HOME_METRIC_COLUMN, type GroupHomeBoard as BoardModel, type GroupHomeBoardRow } from '@/src/groups/home-view-model';
import type { GroupHomeMetric } from '@/src/groups/home-periods';

function BoardValue({ record, testID, value, width }: { record: boolean; testID: string; value: string; width: number }) {
  const styles = useStyles();
  const { text, tone } = useTextRoles();
  return <Text allowFontScaling={false} style={[text.figure, tone.ink, record ? tone.record : null,
    styles.value, { width }]} testID={testID}>{value}</Text>;
}

function BoardRow({ metric, row, valueWidth }: { metric: GroupHomeMetric; row: GroupHomeBoardRow; valueWidth: number }) {
  const styles = useStyles();
  const { text, tone } = useTextRoles();
  const testID = `group-home-board-row-${row.userId}`;
  return <ListRow density="compact" own={row.isMe} testID={testID}
    leading={<Text allowFontScaling={false} style={[text.figure, tone.muted, styles.rank]} testID={`${testID}-rank`}>{row.rank}</Text>}
    meta={<BoardValue record={metric === 'prs' && row.value > 0} testID={`${testID}-value`} value={row.valueLabel} width={valueWidth} />}>
    <View style={styles.content}>
      <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1}
        style={[row.isMe ? text.bodyStrong : text.body, styles.name]} testID={`${testID}-name`}>{row.name}</Text>
      <View style={styles.track}><View style={[styles.fill, { width: `${Math.round(row.fraction * 100)}%` },
        row.leader ? styles.fillLeader : null]} testID={`${testID}-fill`} /></View>
    </View>
  </ListRow>;
}

/** Passive top-five board; ranking, ties, figures and full spoken names come from its model. */
export function GroupHomeBoard({ board, metric, title }: { board: BoardModel; metric: GroupHomeMetric; title?: string }) {
  const styles = useStyles();
  const { text, tone } = useTextRoles();
  const column = GROUP_HOME_METRIC_COLUMN[metric];
  const valueWidth = Math.max(40, statsTableColumnWidth(column, [...board.rows.map(row => row.valueLabel), board.me?.valueLabel ?? '']));
  return <ListCard testID="group-home-board-card" regionTestID="group-home-board" accessibilityLabel={board.accessibilityLabel}
    header={<ListCardHeader label={title ?? `Top ${board.rows.length}`} trailing={<Text allowFontScaling={false}
      style={[text.label, tone.faint, styles.value, { width: valueWidth }]}>{column}</Text>} />}
    footer={board.me ? <ListRow density="compact" testID="group-home-board-me"
      meta={<BoardValue record={false} testID="group-home-board-me-value" value={board.me.valueLabel} width={valueWidth} />}>
      <Text allowFontScaling={false} style={text.body} testID="group-home-board-me-label">
        <Text allowFontScaling={false} style={text.bodyStrong}>You</Text>
        <Text allowFontScaling={false} style={tone.muted}>{' · '}<FigureText>{board.me.rankLabel}</FigureText></Text>
      </Text>
    </ListRow> : null}>
    {board.rows.map(row => <BoardRow key={row.userId} metric={metric} row={row} valueWidth={valueWidth} />)}
  </ListCard>;
}

const useStyles = makeStyles((roles) => ({
  content: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm },
  rank: { width: 14 },
  name: { width: 76 },
  value: { textAlign: 'right' },
  track: { flex: 1, minWidth: 0, height: 12, borderRadius: uiGeometry.radius.control, backgroundColor: roles.viz0, overflow: 'hidden' },
  fill: { height: 12, borderRadius: uiGeometry.radius.control, backgroundColor: roles.viz3 },
  fillLeader: { backgroundColor: roles.viz4 },
}));

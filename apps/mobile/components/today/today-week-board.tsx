import type { ReactNode } from 'react';
import { Text, View } from 'react-native';
import { Card, ListCard, ListCardHeader, ListRow, makeStyles, uiGeometry, uiSpace, useUiText, useUiTextTone } from '@/components/ui';
import { statsTableColumnWidth } from '@/components/stats/stats-table';
import type { WeekBoardRowViewModel, WeekBoardViewModel } from '@/src/groups';
import { spokenGroupRecordCount } from '@/src/groups/record-boards';

type BoardColumns = { rank: number; sets: number; prs: number };

function BoardFigure({ value, record = false, testID, width }: { value: number; record?: boolean; testID: string; width: number }) {
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  return <Text allowFontScaling={false} style={[text.figure, styles.figure, { width }, record && value > 0 ? tone.record : null]} testID={testID}>{value}</Text>;
}

function RowFigures({ sets, prs, columns, testID }: { sets: number; prs: number; columns: BoardColumns; testID: string }) {
  const styles = useStyles();
  return <View style={styles.figures}>
    <BoardFigure testID={`${testID}-working-sets`} value={sets} width={columns.sets} />
    <BoardFigure record testID={`${testID}-records`} value={prs} width={columns.prs} />
  </View>;
}

function BoardRow({ row, columns }: { row: WeekBoardRowViewModel; columns: BoardColumns }) {
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  const testID = `today-group-board-row-${row.userId}`;
  return <ListRow density="compact" own={row.isMe} testID={testID}
    leading={<Text allowFontScaling={false} style={[text.figure, tone.muted, { width: columns.rank }]} testID={`${testID}-rank`}>{row.rank}</Text>}
    meta={<RowFigures sets={row.workingSets} prs={row.groupRecords} columns={columns} testID={testID} />}>
    <View style={styles.content}>
      <Text allowFontScaling={false} ellipsizeMode="tail" numberOfLines={1}
        style={[row.isMe ? text.bodyStrong : text.body, styles.name]} testID={`${testID}-name`}>{row.name}</Text>
      <View style={styles.track}><View style={[styles.bar, { width: `${Math.round(row.fraction * 100)}%` },
        row.leader ? styles.barLeader : null]} testID={`${testID}-fill`} /></View>
    </View>
  </ListRow>;
}

const boardAccessibilityLabel = (range: string, board: WeekBoardViewModel): string => [
  `This week, ${range}`,
  ...board.rows.map(row => `${row.rank}, ${row.name}, ${row.workingSets} sets, ${spokenGroupRecordCount(row.groupRecords)}`),
  board.me ? `You, ${board.me.rankLabel}, ${board.me.workingSets} sets, ${spokenGroupRecordCount(board.me.groupRecords)}` : null,
].filter(Boolean).join('; ');

/** The board alone is one target; group switching remains its sibling. */
export function TodayWeekBoardCard({ board, range, accessibilityRange, onOpenGroup, header }: {
  board: WeekBoardViewModel; range: string; accessibilityRange: string; onOpenGroup: () => void; header: ReactNode;
}) {
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  const all = [...board.rows, ...(board.me ? [board.me] : [])];
  const columns = {
    rank: Math.max(22, statsTableColumnWidth('', [board.me?.rankLabel ?? ''])),
    sets: Math.max(36, statsTableColumnWidth('Sets', all.map(row => String(row.workingSets)))),
    prs: Math.max(36, statsTableColumnWidth('GR', all.map(row => String(row.groupRecords)))),
  };
  return <Card testID="today-group-card">
    {header}
    <ListCard variant="embedded" regionTestID="today-group-board" onPress={onOpenGroup}
      accessibilityHint="Opens the group" accessibilityLabel={boardAccessibilityLabel(accessibilityRange, board)}
      header={<ListCardHeader label="This week" metadata={range} metadataAccessibilityLabel={accessibilityRange} metadataTestID="today-group-board-range" />}
      columnLabels={<>
        <Text allowFontScaling={false} style={[text.label, tone.faint, styles.figure, { width: columns.sets }]}>Sets</Text>
        <Text allowFontScaling={false} style={[text.label, tone.faint, styles.figure, { width: columns.prs }]}>GR</Text>
      </>}
      footer={board.me ? <ListRow density="compact" testID="today-group-board-me"
        leading={<Text allowFontScaling={false} style={[text.figure, tone.muted, { width: columns.rank }]}
          testID="today-group-board-me-rank">{board.me.rankLabel}</Text>}
        meta={<RowFigures sets={board.me.workingSets} prs={board.me.groupRecords} columns={columns} testID="today-group-board-me" />}>
        <Text allowFontScaling={false} style={text.bodyStrong}>You</Text>
      </ListRow> : null}>
      {board.rows.map(row => <BoardRow key={row.userId} row={row} columns={columns} />)}
    </ListCard>
  </Card>;
}

const useStyles = makeStyles((roles) => ({
  content: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm },
  name: { width: 104 },
  figures: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm },
  figure: { textAlign: 'right' },
  track: { flex: 1, minWidth: 0, height: 12, borderRadius: uiGeometry.radius.control, backgroundColor: roles.viz0, overflow: 'hidden' },
  bar: { height: 12, borderRadius: uiGeometry.radius.control, backgroundColor: roles.viz3 },
  barLeader: { backgroundColor: roles.viz4 },
}));

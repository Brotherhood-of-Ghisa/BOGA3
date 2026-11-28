import { useState } from 'react';
import { Text, View } from 'react-native';
import { ListCard, ListCardHeader, ListRow, makeStyles, uiSpace, useUiText, useUiTextTone } from '@/components/ui';
import { statsTableColumnWidth } from '@/components/stats/stats-table';
import type { MedalBoard, MedalRow } from '@/src/groups/medal-view-model';

const COLUMNS = [{ key: 'gold', label: 'Gold' }, { key: 'silver', label: 'Silver' }, { key: 'bronze', label: 'Bronze' }] as const;
const MARK_COLUMNS = [{ key: 'gold', label: '🥇' }, { key: 'silver', label: '🥈' }, { key: 'bronze', label: '🥉' }] as const;

type MedalBoardProps = {
  board: MedalBoard;
  /** The card's title; the group's Medals by default. */
  title?: string;
  /** Prefix of the card's testIDs (`<prefix>`, `-row-<id>`, `-me`, `-toggle`, `-empty`). */
  testIDPrefix?: string;
  emptyLabel?: string;
  /** Heads the counts with 🥇🥈🥉 instead of the words. */
  medalMarks?: boolean;
  /** Makes each row open that member (the Meets leaderboard's trophies). */
  onOpenMember?: (row: MedalRow) => void;
};

/** Standalone compact ListCard: top three, own-row footer, in-place expansion. */
export function GroupMedalBoard({ board, title = 'Medals', testIDPrefix = 'group-medals', emptyLabel = 'No medals yet', medalMarks = false, onOpenMember }: MedalBoardProps) {
  const columns = medalMarks ? MARK_COLUMNS : COLUMNS;
  const [expanded, setExpanded] = useState(false);
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  const widths = columns.map(column => statsTableColumnWidth(column.label, board.rows.map(row => String(row[column.key]))));
  const shown = expanded ? board.rows : board.rows.slice(0, 3);
  const own = board.me && !shown.some(row => row.isMe) ? board.me : null;
  const counts = (row?: MedalRow) => <View style={styles.counts}>
    {columns.map((column, index) => <Text allowFontScaling={false} key={column.key}
      style={[row ? text.figure : text.label, row ? tone.ink : tone.faint, styles.figure, { width: widths[index] }]}>
      {row ? row[column.key] : column.label}
    </Text>)}
  </View>;
  const medalRow = (row: MedalRow, footer = false) => <ListRow accessibilityLabel={row.accessibilityLabel} accessible={onOpenMember ? undefined : true}
    density="compact" key={row.userId} own={row.isMe} testID={footer ? `${testIDPrefix}-me` : `${testIDPrefix}-row-${row.userId}`}
    onPress={onOpenMember ? () => onOpenMember(row) : undefined}
    leading={<Text allowFontScaling={false} style={[text.figure, tone.muted, { width: rankWidth }]}>{row.rank}</Text>}
    meta={counts(row)} label={row.memberLabel} />;
  const rankWidth = statsTableColumnWidth('', board.rows.map(row => String(row.rank)));
  return <ListCard testID={testIDPrefix} header={<ListCardHeader label={title} trailing={counts()} />}
    footer={board.state === 'ready' ? <>
      {own ? medalRow(own, true) : null}
      {!board.me ? <ListRow density="compact" accessible accessibilityLabel="You, Not ranked" testID={`${testIDPrefix}-unranked`}>
        <Text allowFontScaling={false} style={text.body}><Text allowFontScaling={false} style={text.bodyStrong}>You</Text>
          <Text allowFontScaling={false} style={tone.muted}> · Not ranked</Text></Text>
      </ListRow> : null}
      {board.rows.length > 3 ? <ListRow density="compact" expanded={expanded}
        label={expanded ? 'Show less' : 'Show all'} onPress={() => setExpanded(!expanded)} testID={`${testIDPrefix}-toggle`} /> : null}
    </> : null}>
    {board.state === 'rebuilding' || board.rows.length === 0 ? <ListRow density="compact" testID={`${testIDPrefix}-empty`}
      label={board.state === 'rebuilding' ? 'Recalculating…' : emptyLabel} /> : shown.map(row => medalRow(row))}
  </ListCard>;
}

const useStyles = makeStyles(() => ({
  counts: { flexDirection: 'row', gap: uiSpace.sm },
  figure: { textAlign: 'right' },
}));

import { useState } from 'react';
import { Text, View } from 'react-native';
import { ListCard, ListCardHeader, ListRow, makeStyles, uiSpace, useUiText, useUiTextTone } from '@/components/ui';
import { statsTableColumnWidth } from '@/components/stats/stats-table';
import type { MedalBoard, MedalRow } from '@/src/groups/medal-view-model';

const COLUMNS = [{ key: 'gold', label: 'Gold' }, { key: 'silver', label: 'Silver' }, { key: 'bronze', label: 'Bronze' }] as const;

/** Standalone compact ListCard: top three, own-row footer, in-place expansion. */
export function GroupMedalBoard({ board }: { board: MedalBoard }) {
  const [expanded, setExpanded] = useState(false);
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  const widths = COLUMNS.map(column => statsTableColumnWidth(column.label, board.rows.map(row => String(row[column.key]))));
  const shown = expanded ? board.rows : board.rows.slice(0, 3);
  const own = board.me && !shown.some(row => row.isMe) ? board.me : null;
  const counts = (row?: MedalRow) => <View style={styles.counts}>
    {COLUMNS.map((column, index) => <Text allowFontScaling={false} key={column.key}
      style={[row ? text.figure : text.label, row ? tone.ink : tone.faint, styles.figure, { width: widths[index] }]}>
      {row ? row[column.key] : column.label}
    </Text>)}
  </View>;
  const medalRow = (row: MedalRow, footer = false) => <ListRow accessible accessibilityLabel={row.accessibilityLabel}
    density="compact" key={row.userId} own={row.isMe} testID={footer ? 'group-medals-me' : `group-medals-row-${row.userId}`}
    leading={<Text allowFontScaling={false} style={[text.figure, tone.muted, { width: rankWidth }]}>{row.rank}</Text>}
    meta={counts(row)} label={row.memberLabel} />;
  const rankWidth = statsTableColumnWidth('', board.rows.map(row => String(row.rank)));
  return <ListCard testID="group-medals" header={<ListCardHeader label="Medals" trailing={counts()} />}
    footer={board.state === 'ready' ? <>
      {own ? medalRow(own, true) : null}
      {!board.me ? <ListRow density="compact" accessible accessibilityLabel="You, Not ranked" testID="group-medals-unranked">
        <Text allowFontScaling={false} style={text.body}><Text allowFontScaling={false} style={text.bodyStrong}>You</Text>
          <Text allowFontScaling={false} style={tone.muted}> · Not ranked</Text></Text>
      </ListRow> : null}
      {board.rows.length > 3 ? <ListRow density="compact" expanded={expanded}
        label={expanded ? 'Show less' : 'Show all'} onPress={() => setExpanded(!expanded)} testID="group-medals-toggle" /> : null}
    </> : null}>
    {board.state === 'rebuilding' || board.rows.length === 0 ? <ListRow density="compact" testID="group-medals-empty"
      label={board.state === 'rebuilding' ? 'Recalculating…' : 'No medals yet'} /> : shown.map(row => medalRow(row))}
  </ListCard>;
}

const useStyles = makeStyles(() => ({
  counts: { flexDirection: 'row', gap: uiSpace.sm },
  figure: { textAlign: 'right' },
}));

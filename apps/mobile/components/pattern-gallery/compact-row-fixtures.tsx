import { StyleSheet, Text, View } from 'react-native';
import { IconButton, ListCard, ListCardHeader, ListRow, uiSpace, uiText } from '@/components/ui';
import { StatsTable } from '@/components/stats/stats-table';

/** Fixed row-only input for list/table comparison; no table migration is implied. */
export const COMPACT_ROW_FIXTURES = [
  { id: 'single', name: 'Lat pulldown', value: '123456' },
  { id: 'wrapped', name: 'Chest supported row\nwith a long exercise name', value: '123456' },
  { id: 'own', name: 'You', value: '128', own: true },
  { id: 'selected', name: 'Selected exercise', value: '98', selected: true },
] as const;

export function CompactRowFixtures({ surface, onAction }: { surface: 'list' | 'table'; onAction: (action: string) => void }) {
  return <View testID={`compact-${surface}-fixtures`}>
    {COMPACT_ROW_FIXTURES.map(row => <View key={row.id} onLayout={event => console.info('LIST_ROW_NATIVE', surface, row.id, event.nativeEvent.layout.height)}>
      <ListRow density="compact" testID={`${surface}-row-${row.id}`}
      own={'own' in row} selected={'selected' in row}
      leading={<Text allowFontScaling={false} style={uiText.figure}>1</Text>}
      meta={<Text allowFontScaling={false} style={[uiText.figure, styles.value]}>{row.value}</Text>}>
      <Text allowFontScaling={false} style={'own' in row || 'selected' in row ? uiText.bodyStrong : uiText.body}>{row.name}</Text>
    </ListRow></View>)}
    <ListRow density="compact" label="Row with action" testID={`${surface}-row-control`}
      trailing={<IconButton name="more-vertical" accessibilityLabel={`${surface} row actions`} onPress={() => onAction('Row action')} testID={`${surface}-row-action`} />} />
    <ListRow density="compact" label="Wrapped name" description="Second content line" testID={`${surface}-row-interactive`} onPress={() => onAction('Row action')} />
    <View onLayout={event => console.info('LIST_ROW_NATIVE', surface, 'history', event.nativeEvent.layout.height)}>
      <ListRow density="compact" label="Lat pulldown" testID={`${surface}-row-history`}
      contentAction={{ onPress: () => onAction('History'), accessibilityLabel: `Open ${surface} history`, accessibilityRole: 'link', testID: `${surface}-history` }}
      trailing={<IconButton name="chevron-down" accessibilityLabel={`Show ${surface} contributions`}
        onPress={() => onAction('Contributions')} testID={`${surface}-disclosure`} />} />
    </View>
  </View>;
}

export function CompactRowComparison({ onAction }: { onAction: (action: string) => void }) {
  return <View style={styles.stack}>
    <ListCard header={<ListCardHeader label="List rows" />}><CompactRowFixtures surface="list" onAction={onAction} /></ListCard>
    <StatsTable testID="gallery-table-row-host"><ListCardHeader label="Table row recipe" />
      <CompactRowFixtures surface="table" onAction={onAction} />
    </StatsTable>
  </View>;
}

const styles = StyleSheet.create({
  stack: { gap: uiSpace.md },
  value: { width: 60, textAlign: 'right' },
});

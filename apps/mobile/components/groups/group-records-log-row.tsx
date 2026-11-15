import { StyleSheet, Text, View } from 'react-native';

import { FigureText, Icon, makeStyles, uiBorder, uiSpace, useUiText, useUiTextTone } from '@/components/ui';
import type { RecordsLogRow } from '@/src/groups/records-history-view-model';

import { useCardListItemStyles } from './screen-styles';

// An entry under earlier rules stays legible but steps back.
const EARLIER_RULES_OPACITY = 0.55;

/**
 * One row of a board's records log: an entry inside its run's card (a star
 * for a new #1, an arrow for a member's own new best), or a rules-change
 * divider between runs.
 */
export function GroupRecordsLogRow({ row, testID }: { row: RecordsLogRow; testID: string }) {
  const styles = useStyles();
  const text = useUiText();
  const tone = useUiTextTone();
  const cardListItemStyles = useCardListItemStyles();
  if (row.kind === 'rules_change') {
    return (
      <View accessibilityLabel={row.label} accessible style={styles.divider} testID={testID}>
        <View style={styles.dividerRule} />
        <Text allowFontScaling={false} style={[text.label, tone.muted]}>{row.label}</Text>
        <View style={styles.dividerRule} />
      </View>
    );
  }
  const lead = row.mark === 'lead';
  return (
    <View style={[cardListItemStyles(row.index, row.count), row.earlierRules ? styles.earlier : null]}>
      <View accessibilityLabel={[lead ? 'New number one' : 'New best', row.title, row.figure, row.detail, row.date,
        row.earlierRules ? 'earlier rules' : null].filter(Boolean).join(', ')}
        accessible style={[styles.entry, row.index > 0 ? styles.rule : null]} testID={testID}>
        <View style={[styles.mark, lead ? styles.markLead : styles.markBest]} testID={`${testID}-${row.mark}`}>
          <Icon colorRole={lead ? 'record' : 'accent'} name={lead ? 'star' : 'arrow-up'} size="sm" />
        </View>
        <View style={styles.body}>
          <View style={styles.line}>
            <Text allowFontScaling={false} numberOfLines={1} style={[text.body, styles.grow]}>{row.title}</Text>
            <Text allowFontScaling={false} style={text.figure} testID={`${testID}-figure`}><FigureText>{row.figure}</FigureText></Text>
          </View>
          <View style={styles.line}>
            <Text allowFontScaling={false} numberOfLines={1} style={[text.figureSmall, tone.muted, styles.grow]} testID={`${testID}-detail`}>
              <FigureText>{row.detail}</FigureText>
            </Text>
            <Text allowFontScaling={false} style={[text.figureSmall, tone.muted]}>{row.date}</Text>
          </View>
        </View>
      </View>
    </View>
  );
}

const MARK_SIZE = 26;

const useStyles = makeStyles((roles) => ({
  entry: { flexDirection: 'row', gap: uiSpace.sm, paddingHorizontal: uiSpace.md, paddingVertical: uiSpace.sm },
  rule: { borderTopWidth: uiBorder.width, borderTopColor: roles.ruleSoft },
  earlier: { opacity: EARLIER_RULES_OPACITY },
  mark: { width: MARK_SIZE, height: MARK_SIZE, borderRadius: MARK_SIZE / 2, alignItems: 'center', justifyContent: 'center' },
  markLead: { borderWidth: uiBorder.width, borderColor: roles.record },
  markBest: { borderWidth: uiBorder.width, borderColor: roles.accent },
  body: { flex: 1, gap: uiSpace.xs },
  line: { flexDirection: 'row', alignItems: 'baseline', gap: uiSpace.sm },
  grow: { flex: 1 },
  divider: { flexDirection: 'row', alignItems: 'center', gap: uiSpace.sm, paddingVertical: uiSpace.md },
  dividerRule: { flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: roles.rule },
}));
